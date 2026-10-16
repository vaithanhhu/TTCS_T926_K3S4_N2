const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-wal','backend/data/ats.db-shm'])assert.equal(fs.existsSync(path.join(root,file)),false,'ISOLATED_SOURCE_REQUIRED');
for(const key of Object.keys(process.env))if(/^(ATS_POSTGRES_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|CANDIDATE_)/.test(key))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'test',DB_PROVIDER:'sqlite',EMAIL_MODE:'simulated'});

async function main(){
  const {startServer,server}=require('../src/server');await startServer(0);
  const db=require('../src/db/database').getDatabase();let passed=0;
  try{
    await require('../src/db/migrate-interview-scheduling').migrate(db);
    const sql=fs.readFileSync(path.join(root,'backend/src/db/migrations/009_candidate_portal_sqlite.sql'),'utf8');
    await db.exec(sql.match(/CREATE TABLE IF NOT EXISTS email_outbox \([\s\S]*?\);/)[0]);
    await require('../src/db/migrate-bulk-interviews').migrate(db);
    await db.prepare("INSERT INTO candidates(id,requisition_id,full_name,email,stage) VALUES('s603-other','req-001','Synthetic second','second@example.invalid','NEW')").run();
    const password=crypto.randomBytes(20).toString('base64url')+'!aA7';
    const hash=require('../src/utils/password').hashPassword(password);
    await db.prepare('UPDATE users SET password_hash=?,failed_attempts=0,locked_until=NULL,must_change_password=FALSE').run(hash);
    const base='http://127.0.0.1:'+server.address().port;
    const api=async(method,route,token,body)=>{const res=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};};
    const sessions={};
    for(const id of ['usr-admin','usr-interviewer']){const user=await db.prepare('SELECT email FROM users WHERE id=?').get(id);const login=await api('POST','/api/v1/auth/login',null,{email:user.email,password});assert.equal(login.status,200);sessions[id]=login.data.data.token;}
    const payload={candidateIds:['cand-001','s603-other'],requisitionId:'req-001',interviewerIds:['usr-interviewer'],roundName:'Synthetic bulk HTTP',windowStart:'2034-06-01T09:00',windowEnd:'2034-06-01T12:00',durationMinutes:30,breakMinutes:0,interviewFormat:'IN_PERSON',meetingRoom:'Synthetic test room'};
    const before=await db.prepare('SELECT * FROM interviews ORDER BY id').all();
    for(const prefix of ['/api/v1','']){
      assert.equal((await api('POST',prefix+'/interviews/bulk-preview',null,payload)).status,401);
      assert.equal((await api('POST',prefix+'/interviews/bulk-create',sessions['usr-interviewer'],{...payload,actor:{roles:['ADMIN']}})).status,403);
    }
    assert.deepEqual(await db.prepare('SELECT * FROM interviews ORDER BY id').all(),before);passed++;console.log('PASS HTTP authentication/grants and both aliases');
    const malformed=await fetch(base+'/api/v1/interviews/bulk-preview',{method:'POST',headers:{Authorization:'Bearer '+sessions['usr-admin'],'Content-Type':'application/json'},body:'{invalid'});assert.equal(malformed.status,400);assert.equal((await malformed.json()).code,'BAD_REQUEST');assert.deepEqual(await db.prepare('SELECT * FROM interviews ORDER BY id').all(),before);passed++;console.log('PASS HTTP malformed JSON is 400 without writes');
    const preview=await api('POST','/api/v1/interviews/bulk-preview',sessions['usr-admin'],payload);
    assert.equal(preview.status,200);assert.equal(preview.data.slots.length,2);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interview_batches').get()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get()).n,0);passed++;console.log('PASS HTTP preview has no business writes');
    const request={...payload,fingerprint:preview.data.fingerprint,requestKey:'http-bulk-test-key-0001'};
    const created=await api('POST','/api/v1/interviews/bulk-create',sessions['usr-admin'],request);
    assert.equal(created.status,201);assert.equal(created.data.interviews.length,2);assert.ok(created.data.deliveries.every(row=>row.state==='SIMULATED'));assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get()).n,2);passed++;console.log('PASS HTTP batch commits and simulated invitations deliver after commit');
    const replay=await api('POST','/interviews/bulk-create',sessions['usr-admin'],request);assert.equal(replay.status,200);assert.equal(replay.data.batchId,created.data.batchId);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get()).n,2);passed++;console.log('PASS HTTP alias replay returns committed identity');
    const status=await api('GET','/api/v1/interviews/batches/'+created.data.batchId,sessions['usr-admin']);assert.equal(status.status,200);assert.equal(status.data.deliveries.length,2);assert.equal(status.data.deliveries[0].attempts,1);assert.equal((await api('GET','/interviews/batches/'+created.data.batchId,sessions['usr-interviewer'])).status,403);passed++;console.log('PASS HTTP batch observation scoped and no duplicate deliveries');
    const snapshot=await db.prepare('SELECT * FROM interview_batches ORDER BY id').all();assert.equal((await api('POST','/api/v1/interviews/bulk-create',sessions['usr-admin'],{...request,roundName:'different'})).status,409);assert.deepEqual(await db.prepare('SELECT * FROM interview_batches ORDER BY id').all(),snapshot);passed++;console.log('PASS HTTP idempotency payload conflict without writes');
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
  console.log('S603_HTTP_RESULT '+JSON.stringify({passed,failed:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
