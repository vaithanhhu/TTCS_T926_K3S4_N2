const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Isolated source export required');
assert.equal(fs.existsSync(path.join(root, '.env')), false, 'Isolated source export required');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_PROVIDER, 'sqlite');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
const Requisitions = require('../src/services/requisitionService');
const Portal = require('../src/services/candidatePortalService');
const Auth = require('../src/services/authService');
const results = [];
async function run(db, provider) {
  const boolean = provider === 'SQLite' ? 'INTEGER' : 'BOOLEAN';
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${boolean},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,title TEXT,status TEXT,department_name TEXT,recruiter_id TEXT);
    CREATE TABLE job_postings(id TEXT PRIMARY KEY,title TEXT,requisition_id TEXT,status TEXT,application_deadline TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,full_name TEXT,email TEXT,phone_number TEXT,requisition_id TEXT,job_posting_id TEXT,stage TEXT,cover_letter TEXT,tracking_code TEXT,withdraw_token_hash TEXT,source_id TEXT,created_at TEXT,experience_years INTEGER,current_company TEXT,expected_salary TEXT,notes TEXT,referrer_id TEXT,referrer_name TEXT,referral_notes TEXT,is_internal_referral ${boolean});
    CREATE TABLE candidate_documents(id TEXT PRIMARY KEY,candidate_id TEXT,file_name TEXT,storage_path TEXT,mime_type TEXT,file_size INTEGER,file_hash TEXT,document_type TEXT,created_at TEXT);
    CREATE TABLE candidate_status_history(id TEXT PRIMARY KEY,candidate_id TEXT,before_stage TEXT,after_stage TEXT,actor_id TEXT,actor_name TEXT,action TEXT,notes TEXT,created_at TEXT);
    CREATE TABLE application_tracking_tokens(id TEXT PRIMARY KEY,candidate_id TEXT,token_hash TEXT,token_type TEXT,created_at TEXT);
    CREATE TABLE application_rate_limits(id TEXT PRIMARY KEY,ip_address TEXT,action TEXT,attempt_time ${provider === 'SQLite' ? 'TEXT' : 'TIMESTAMPTZ'});
    CREATE TABLE offers(id TEXT PRIMARY KEY,candidate_id TEXT,requisition_id TEXT,status TEXT,approver_id TEXT);
    CREATE TABLE interviews(id TEXT PRIMARY KEY,candidate_id TEXT,requisition_id TEXT,interviewer_id TEXT,status TEXT,feedback TEXT,score INTEGER);
    CREATE TABLE otps(id TEXT PRIMARY KEY,email TEXT,otp_code TEXT,purpose TEXT,expires_at TEXT,created_at TEXT,used_at TEXT,verified_at TEXT);
    CREATE TABLE password_reset_tokens(id TEXT PRIMARY KEY,user_id TEXT,token TEXT,expires_at TEXT,created_at TEXT,used_at TEXT);
  `);
  for (const [id, role] of [['admin','ADMIN'],['candidate','CANDIDATE'],['recruiter','RECRUITER']]) {
    await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id+'@audit.test',id,'ACTIVE',provider === 'SQLite' ? 0 : false,null);
    await db.prepare('INSERT INTO roles VALUES (?,?)').run(role,role);
    await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id,role);
  }
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('read','offer.read');
  for (const role of ['CANDIDATE','RECRUITER']) await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role,'read');
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('refer','candidate.refer');
  await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','refer');
  await db.prepare('INSERT INTO requisitions VALUES (?,?,?,?,?)').run('r','Position','OPEN','Department','recruiter');
  await db.prepare('INSERT INTO job_postings VALUES (?,?,?,?,?)').run('job','Position','r','PUBLISHED','2099-01-01');
  await db.prepare('INSERT INTO candidates(id,email,requisition_id,stage) VALUES (?,?,?,?)').run('own','candidate@audit.test','r','OFFER');
  await db.prepare('INSERT INTO candidates(id,email,requisition_id,stage) VALUES (?,?,?,?)').run('rec-own','recruiter@audit.test','r','OFFER');
  const req = new Requisitions(db), portal = new Portal(db), auth = new Auth(db);
  req.openPolicy.notDraft = async () => {};
  portal.emailService.sendMail = async () => ({ success:true });
  const check = async (name, fn) => {
    try { await fn(); results.push({provider,name,status:'PASS'}); console.log('PASS '+provider+' '+name); }
    catch(error) { results.push({provider,name,status:'FAIL',message:error.message}); console.error('FAIL '+provider+' '+name+' '+error.message); }
  };
  let next = 0;
  async function offer(status, candidate='own') {
    const id='o'+(++next);
    await db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(id,candidate,'r',status,null);
    return id;
  }
  await check('candidate cannot accept an unsent offer', async () => {
    for (const status of ['PENDING_APPROVAL','APPROVED','REJECTED']) {
      const id=await offer(status), result=await req.updateOfferStatus(id,'ACCEPTED',{id:'candidate',roles:['CANDIDATE']});
      assert.equal(result.statusCode,409);
      assert.equal((await db.prepare('SELECT status FROM offers WHERE id=?').get(id)).status,status);
    }
  });
  await check('candidate accepts sent offer with actor id only', async () => {
    const id=await offer('SENT');assert.equal((await req.updateOfferStatus(id,'ACCEPTED',{id:'candidate'})).success,true);
    assert.equal((await db.prepare('SELECT status FROM offers WHERE id=?').get(id)).status,'ACCEPTED');
  });
  await check('forged candidate role does not select a weaker permission', async () => {
    const id=await offer('SENT','rec-own');assert.equal((await req.updateOfferStatus(id,'ACCEPTED',{id:'recruiter',roles:['CANDIDATE']})).statusCode,403);
    assert.equal((await db.prepare('SELECT status FROM offers WHERE id=?').get(id)).status,'SENT');
  });
  await db.prepare('INSERT INTO interviews VALUES (?,?,?,?,?,?,?)').run('iv','own','r','admin','SCHEDULED','original',4);
  await check('malformed interview score cannot silently become a number', async () => {
    const r=await req.updateInterviewStatus('iv','COMPLETED','changed','9junk',{id:'admin'});assert.equal(r.statusCode,400);
    assert.equal((await db.prepare('SELECT feedback,score FROM interviews WHERE id=?').get('iv')).feedback,'original');
  });
  await check('invalid interview status is rejected before mutation', async () => {
    assert.equal((await req.updateInterviewStatus('iv','INVENTED',null,9,{id:'admin'})).statusCode,400);
    assert.equal((await db.prepare('SELECT status FROM interviews WHERE id=?').get('iv')).status,'SCHEDULED');
  });
  await check('existing score scale including nine and zero is preserved', async () => {
    for(const score of [9,0]) {assert.equal((await req.updateInterviewStatus('iv','COMPLETED','valid',score,{id:'admin'})).success,true);assert.equal((await db.prepare('SELECT score FROM interviews WHERE id=?').get('iv')).score,score);}
  });
  await check('OTP verification cannot mint multiple reset links by replay', async () => {
    await db.prepare('INSERT INTO otps VALUES (?,?,?,?,?,?,?,?)').run('otp','candidate@audit.test','123456','PASSWORD_RESET','2099-01-01','2026-01-01',null,null);
    assert.equal((await auth.verifyOtp('candidate@audit.test','123456')).valid,true);
    const count=Number((await db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()).n);
    assert.equal((await auth.verifyOtp('candidate@audit.test','123456')).valid,false);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()).n),count);
  });
  await db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;ALTER TABLE users ADD COLUMN failed_attempts INTEGER;ALTER TABLE users ADD COLUMN updated_at TEXT;CREATE TABLE sessions(id TEXT,user_id TEXT,token TEXT);CREATE TABLE login_audit_logs(id TEXT,email TEXT,ip_address TEXT,status TEXT,reason TEXT,attempted_at TEXT);`);
  await db.prepare('UPDATE users SET password_hash=?').run(require('../src/utils/password').hashPassword('OldPassword123'));
  auth.emailService={sendPasswordChangedEmail:async()=>({success:true})};
  await check('password reset invalidates every outstanding link for that user', async () => {
    for(const token of ['reset-a','reset-b'])await db.prepare('INSERT INTO password_reset_tokens(id,user_id,token,expires_at) VALUES (?,?,?,?)').run(token,'candidate',token,'2099-01-01');
    assert.equal((await auth.resetPassword('reset-a','ChangedPassword123')).success,true);
    assert.equal((await auth.verifyResetToken('reset-b')).valid,false);
  });
  await check('concurrent reset links have only one committed winner', async () => {
    for(const token of ['race-a','race-b'])await db.prepare('INSERT INTO password_reset_tokens(id,user_id,token,expires_at) VALUES (?,?,?,?)').run(token,'candidate',token,'2099-01-01');
    const auditBefore=Number((await db.prepare('SELECT COUNT(*) AS n FROM login_audit_logs').get()).n);
    const responses=await Promise.all([auth.resetPassword('race-a','ChangedAgain123'),auth.resetPassword('race-b','ChangedAgain456')]);
    assert.equal(responses.filter(x=>x.success).length,1);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL').get('candidate')).n),0);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM login_audit_logs').get()).n),auditBefore+1);
    const hash=(await db.prepare('SELECT password_hash FROM users WHERE id=?').get('candidate')).password_hash;
    assert.equal(require('../src/utils/password').verifyPassword(responses[0].success?'ChangedAgain123':'ChangedAgain456',hash),true);
  });
  await check('CV upload rejects a ZIP that cannot be downloaded as DOCX', async () => {
    const invalid=await portal.validateCvFile({filename:'fake.docx',buffer:Buffer.from([80,75,3,4,1,2,3,4])});
    assert.equal(invalid.success,false);
    const JSZip=require(require.resolve('jszip',{paths:[path.dirname(require.resolve('exceljs'))]}));
    const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<document/>');
    assert.equal((await portal.validateCvFile({filename:'valid.docx',buffer:await zip.generateAsync({type:'nodebuffer'})})).success,true);
    assert.equal((await portal.validateCvFile({filename:'fake.pdf',buffer:Buffer.from('%PDFnot-a-document')})).success,false);
  });
  await check('untrusted forwarded header cannot select a rate limit identity', async () => {
    const Controller=require('../src/controllers/candidatePortalController'),controller=new Controller(portal,portal.rbac,auth);
    for(const forwarded of ['1.2.3.4','9.8.7.6'])assert.equal(controller.getClientIp({headers:{'x-forwarded-for':forwarded},socket:{remoteAddress:'127.0.0.1'}}),'127.0.0.1');
  });
  const cv={filename:'fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFake isolated fixture\n%%EOF')};
  const input=email=>({fullName:'Audit Fixture',email,phoneNumber:'0901234567',jobPostingId:'job'});
  await check('simultaneous duplicate public applications persist exactly once', async () => {
    const responses=await Promise.all([portal.submitApplication(input('same@audit.test'),cv),portal.submitApplication(input('same@audit.test'),cv)]);
    assert.deepEqual(responses.map(x=>x.statusCode).sort(),[201,409]);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE email=?').get('same@audit.test')).n),1);
  });
  await check('concurrent public rate limit does not admit a sixth request', async () => {
    const rows=await Promise.all(Array.from({length:6},()=>portal.checkRateLimit('test-'+provider,'AUDIT',5)));
    assert.equal(rows.filter(x=>x.allowed).length,5);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM application_rate_limits WHERE ip_address=?').get('test-'+provider)).n),5);
  });
  const uploads=path.join(root,'backend/data/cv_uploads');
  await check('failure after candidate insert rolls back rows and removes its own file', async () => {
    const before=fs.readdirSync(uploads).sort(),prepare=db.prepare.bind(db);
    db.prepare=sql=>{if(/INSERT INTO candidate_documents/.test(sql))throw Error('AUDIT_DOCUMENT_FAILURE');return prepare(sql);};
    try {await assert.rejects(portal.submitApplication(input('rollback@audit.test'),cv),/AUDIT_DOCUMENT_FAILURE/);} finally {db.prepare=prepare;}
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE email=?').get('rollback@audit.test')).n),0);
    assert.deepEqual(fs.readdirSync(uploads).sort(),before);
  });
  await check('job closed after initial validation is rechecked before insert', async () => {
    const transaction=db.transaction.bind(db);let injected=false;
    db.transaction=async fn=>{if(!injected){injected=true;await db.prepare("UPDATE job_postings SET status='UNPUBLISHED' WHERE id='job'").run();}return transaction(fn);};
    try {assert.equal((await portal.submitApplication(input('closed@audit.test'),cv)).statusCode,409);} finally {db.transaction=transaction;await db.prepare("UPDATE job_postings SET status='PUBLISHED' WHERE id='job'").run();}
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE email=?').get('closed@audit.test')).n),0);
  });
  const referral=email=>({...input(email),requisitionId:'r'});
  await check('simultaneous referrals do not duplicate candidates', async () => {
    const responses=await Promise.all([portal.referCandidate(referral('refer@audit.test'),{id:'recruiter'}),portal.referCandidate(referral('refer@audit.test'),{id:'recruiter'})]);
    assert.deepEqual(responses.map(x=>x.statusCode).sort(),[201,409]);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE email=?').get('refer@audit.test')).n),1);
  });
  await check('referral transaction rechecks a revoked grant', async () => {
    const transaction=db.transaction.bind(db);let injected=false;
    db.transaction=async fn=>{if(!injected){injected=true;await db.prepare("DELETE FROM role_permissions WHERE role_id='RECRUITER' AND permission_id='refer'").run();}return transaction(fn);};
    try {assert.equal((await portal.referCandidate(referral('revoked@audit.test'),{id:'recruiter'})).statusCode,403);} finally {db.transaction=transaction;await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','refer');}
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE email=?').get('revoked@audit.test')).n),0);
  });
  await check('referral rollback removes its own uploaded file', async () => {
    const before=fs.readdirSync(uploads).sort(),prepare=db.prepare.bind(db);
    db.prepare=sql=>{if(/INSERT INTO candidate_status_history/.test(sql))throw Error('AUDIT_REFERRAL_FAILURE');return prepare(sql);};
    try {await assert.rejects(portal.referCandidate(referral('ref-rollback@audit.test'),cv,{id:'recruiter'}),/AUDIT_REFERRAL_FAILURE/);} finally {db.prepare=prepare;}
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE email=?').get('ref-rollback@audit.test')).n),0);
    assert.deepEqual(fs.readdirSync(uploads).sort(),before);
  });
  await check('application confirmation treats supplied names as text', async () => {
    let html='';const send=portal.emailService.sendMail;
    portal.emailService.sendMail=async message=>{html=message.html;};
    const payload='<img src=x onerror="window.__auditXss=1">';
    try {assert.equal((await portal.submitApplication({...input('html@audit.test'),fullName:payload},cv)).success,true);} finally {portal.emailService.sendMail=send;}
    assert.equal(html.includes(payload),false);assert.ok(html.includes('&lt;img'));
    assert.equal((await db.prepare('SELECT full_name FROM candidates WHERE email=?').get('html@audit.test')).full_name,payload);
  });
  await check('public controller hides private filesystem errors and normalizes pagination', async () => {
    const http=require('node:http'),Controller=require('../src/controllers/candidatePortalController');
    const Publications=require('../src/services/jobPostingPublicationService'),list=Publications.prototype.publicList;
    Publications.prototype.publicList=async()=>[];
    const controller=new Controller({db,submitApplication:async()=>{throw Error('PRIVATE_PATH_SENTINEL');}},portal.rbac,auth);
    const server=http.createServer((req,res)=>controller.handle(req,res,new URL(req.url,'http://localhost'),async()=>({})));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const url='http://127.0.0.1:'+server.address().port;
      const error=await fetch(url+'/api/v1/public/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(error.status,500);assert.equal(JSON.stringify(await error.json()).includes('PRIVATE_PATH_SENTINEL'),false);
      const response=await fetch(url+'/api/v1/public/job-postings?page=invalid&pageSize=invalid'),body=await response.json();
      assert.equal(response.status,200);assert.equal(body.pagination.page,1);assert.equal(body.pagination.pageSize,10);
    } finally {Publications.prototype.publicList=list;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
}
async function main() {
  const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));
  try {await run(sqlite,'SQLite');} finally {await sqlite.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();
  const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};
  let tail=Promise.resolve();
  const acquire=async()=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return release;};
  const pg=new PostgresDatabase({},{on(){},async query(...args){const release=await acquire();try{return await query(...args);}finally{release();}},async connect(){const release=await acquire();return{query,release};},async end(){await engine.close();}});
  try {await run(pg,'PGlite');} finally {await pg.close();}
  let nativePostgres='NOT RUN';
  if(process.env.ATS_DEEP_AUDIT_PG_URL) {
    const url=new URL(process.env.ATS_DEEP_AUDIT_PG_URL);
    assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/ats_deep_audit_[a-z0-9]+$/);
    const native=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});
    try {
      const identity=await native.prepare('SELECT current_database() AS name,version() AS version').get();assert.equal(identity.name,url.pathname.slice(1));
      const a=await native.pool.connect(),b=await native.pool.connect();try{assert.notEqual(a.processID,b.processID);}finally{a.release();b.release();}
      await run(native,'PostgreSQL native');nativePostgres=identity.version;
    } finally {await native.close();}
  }
  const report={passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results,nativePostgres};
  if(process.env.ATS_DEEP_AUDIT_RESULT)fs.writeFileSync(process.env.ATS_DEEP_AUDIT_RESULT,JSON.stringify(report,null,2));
  console.log('DEEP_AUDIT_RESULT '+JSON.stringify(report));process.exitCode=report.failed?1:0;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
