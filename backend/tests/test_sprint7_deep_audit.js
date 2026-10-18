const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'../..');
assert.equal(fs.existsSync(path.join(root,'.git')),false);assert.equal(fs.existsSync(path.join(root,'.env')),false);assert.equal(process.env.NODE_ENV,'test');
const {PostgresDatabase}=require('../src/db/postgres');
let passed=0,failed=0;
async function test(name,action){try{await action();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+' '+error.stack);}}
async function run(db,label){
 await db.transaction(()=>require('../src/db/seed').seedDatabase(db));
 if(db.provider==='postgres')await require('../src/db/migrate-requisition-open-policy').migrate(db);
 await db.exec('CREATE TABLE IF NOT EXISTS candidate_status_history(id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL REFERENCES candidates(id),before_stage TEXT,after_stage TEXT NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,action TEXT NOT NULL,reason TEXT,notes TEXT,rejection_reason_id TEXT,created_at TEXT)');
 await require('../src/db/migrate-bulk-candidate-communications').migrate(db);
 const Offer=require('../src/services/offerService'),Onboarding=require('../src/services/onboardingService'),Hiring=require('../src/services/hiringDecisionService'),{CandidateCommunicationService:Communication}=require('../src/services/candidateCommunicationService');
 const offer=new Offer(db),onboarding=new Onboarding(db),hiring=new Hiring(db),hr={id:'usr-hr-mgr',roles:['HR_MANAGER']},outsider={id:'usr-candidate',roles:['HR_MANAGER']};
 const check=(name,fn)=>test(label+' '+name,fn);
 await check('PostgreSQL email assignments remain valid while predicates ignore case',async()=>{
  const {postgresSQL}=require('../src/db/postgres');
  assert.equal(postgresSQL('UPDATE candidates SET email = ? WHERE email = ?'),'UPDATE candidates SET email = $1 WHERE lower(email) = lower($2)');
  assert.equal(postgresSQL('SELECT id FROM candidates WHERE (email = ?) OR c.email=?'),'SELECT id FROM candidates WHERE (lower(email) = lower($1)) OR lower(c.email) = lower($2)');
 });
 await check('questions and evaluations reject missing or forged actor',async()=>{
  const questions=new(require('../src/services/questionBankService'))(db),evaluation=new(require('../src/services/interviewEvaluationService'))(db);
  for(const actor of [null,{id:'not-a-user',roles:['ADMIN']},outsider]){
   assert.equal((await questions.getSuggestedQuestionsForInterview('int-001',{},actor)).statusCode,403);
   assert.equal((await evaluation.getEvaluationsForInterview('int-001',actor)).statusCode,403);
  }
 });
 await check('recruiter cannot read questions or evaluations outside assignment',async()=>{
  const actor={id:'usr-recruiter-2',roles:['RECRUITER']};
  assert.equal((await new(require('../src/services/questionBankService'))(db).getSuggestedQuestionsForInterview('int-001',{},actor)).statusCode,403);
  assert.equal((await new(require('../src/services/interviewEvaluationService'))(db).getEvaluationsForInterview('int-001',actor)).statusCode,403);
 });
 await check('stale draft cannot overwrite a concurrently submitted evaluation',async()=>{
  const service=new(require('../src/services/interviewEvaluationService'))(db),actor={id:'usr-interviewer'},form=await service.getOrCreateEvaluationForm('int-002',null,actor);
  assert.equal(form.success,true);const original=db.transaction;
  db.transaction=async function(fn){await db.prepare("UPDATE interview_evaluations SET status='SUBMITTED' WHERE id=?").run(form.evaluation.id);return original.call(this,fn);};
  try{const result=await service.saveEvaluation('int-002',{status:'DRAFT',generalNotes:'stale draft'},actor);assert.equal(result.code,'EVALUATION_ALREADY_SUBMITTED');assert.equal((await db.prepare('SELECT status FROM interview_evaluations WHERE id=?').get(form.evaluation.id)).status,'SUBMITTED');}finally{db.transaction=original;}
 });
 await check('offer list rejects missing actor without expiring records',async()=>{
  const before=await db.prepare('SELECT id,status FROM offers ORDER BY id').all();
  assert.equal((await offer.getOffers()).statusCode,403);
  assert.deepEqual(await db.prepare('SELECT id,status FROM offers ORDER BY id').all(),before);
 });
 await check('offer HTML escapes applicant supplied markup',async()=>{
  const result=offer.generateOfferLetter({candidateName:'<img src=x onerror=alert(1)>',candidateEmail:'<b>email</b>',jobTitleName:'<svg onload=alert(1)>',departmentName:'<iframe src=x>',startDate:'<img src=x>'});
  assert.doesNotMatch(result.html,/<(?:img|svg|iframe|b)[ >]/i);assert.match(result.html,/&lt;img/);
 });
 await check('onboarding rejects forged manager before template mutation',async()=>{
  const before=Number((await db.prepare('SELECT COUNT(*) AS n FROM onboarding_templates').get()).n);
  const result=await onboarding.createTemplate({name:'Audit',items:[{title:'Account',category:'ACCOUNT'}]},outsider);
  assert.equal(result.statusCode,403);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM onboarding_templates').get()).n),before);
 });
 await check('hiring summary rejects missing or forged actor',async()=>{
  for(const actor of [null,{id:'missing',roles:['ADMIN']}])assert.equal((await hiring.getCandidateInterviewSummary('cand-001',actor)).statusCode,403);
 });
 await check('consensus cannot disclose another interview to Candidate',async()=>assert.equal((await hiring.getInterviewConsensus('int-001',outsider)).statusCode,403));
 await check('submitted NULL scores do not count as zero',async()=>{
  await db.prepare("INSERT INTO interview_evaluations(id,interview_id,interviewer_id,template_name,snapshot_criteria,status,total_score) VALUES('audit-e1','int-001','usr-interviewer','Audit','[]','SUBMITTED',4),('audit-e2','int-001','usr-hr-mgr','Audit','[]','SUBMITTED',NULL)").run();
  const result=await hiring.getInterviewConsensus('int-001',hr);assert.equal(result.success,true);assert.equal(result.data.averageScore,4);
 });
 await check('hiring decision cannot attach another candidate interview',async()=>{
  const before=await db.prepare("SELECT stage FROM candidates WHERE id='cand-001'").get(),count=Number((await db.prepare('SELECT COUNT(*) AS n FROM hiring_decisions').get()).n);
  const result=await hiring.recordHiringDecision('cand-001',{decision:'OFFER',interviewId:'int-002'},hr);
  assert.equal(result.statusCode,400);assert.deepEqual(await db.prepare("SELECT stage FROM candidates WHERE id='cand-001'").get(),before);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM hiring_decisions').get()).n),count);
 });
 await check('hiring history failure rolls back decision and stage',async()=>{
  const before=await db.prepare("SELECT stage FROM candidates WHERE id='cand-001'").get(),count=Number((await db.prepare('SELECT COUNT(*) AS n FROM hiring_decisions').get()).n),original=db.prepare;
  db.prepare=function(sql){if(sql.includes('INSERT INTO candidate_status_history'))throw Error('HIRING_HISTORY_INJECTED');return original.call(this,sql);};
  try{await assert.rejects(()=>hiring.recordHiringDecision('cand-001',{decision:'OFFER'},hr),/HIRING_HISTORY_INJECTED/);}finally{db.prepare=original;}
  assert.deepEqual(await db.prepare("SELECT stage FROM candidates WHERE id='cand-001'").get(),before);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM hiring_decisions').get()).n),count);
 });
 await db.prepare("UPDATE offers SET status='EXPIRED'").run();
 await db.prepare("INSERT INTO offers(id,candidate_id,requisition_id,status,salary_monthly,start_date,response_token,token_expires_at,expiration_date) VALUES('audit-old','cand-001','req-001','SUPERSEDED',100,'2099-01-01','audit-old-token','2000-01-01T00:00:00Z','2000-01-01')").run();
 await check('expired old token cannot rewrite SUPERSEDED state',async()=>{
  const result=await offer.respondOffer('audit-old-token',{decision:'ACCEPTED'});assert.equal(result.success,false);assert.equal((await db.prepare("SELECT status FROM offers WHERE id='audit-old'").get()).status,'SUPERSEDED');
 });
 await check('stale public expiry read cannot overwrite accepted offer',async()=>{
  await db.prepare("UPDATE offers SET status='SENT',response_token='audit-race-token' WHERE id='audit-old'").run();
  const original=db.prepare;let injected=false;
  db.prepare=function(sql){const statement=original.call(this,sql);if(sql.includes('WHERE o.response_token = ?'))return {...statement,get:async(...args)=>{const row=await statement.get(...args);if(!injected){injected=true;await original.call(db,"UPDATE offers SET status='ACCEPTED',responded_at=CURRENT_TIMESTAMP WHERE id='audit-old'").run();}return row;}};return statement;};
  try{const result=await offer.getOfferByToken('audit-race-token');assert.equal((await original.call(db,"SELECT status FROM offers WHERE id='audit-old'").get()).status,'ACCEPTED');assert.equal(result.data.status,'ACCEPTED');}finally{db.prepare=original;}
 });
 await check('onboarding reads cannot expose unrelated applications',async()=>assert.equal((await onboarding.getOnboardingByCandidate('cand-003',outsider)).statusCode,403));
 await db.prepare("UPDATE candidates SET stage='HIRED' WHERE id='cand-001'").run();
 const initialized=await onboarding.initializeOnboarding({candidateId:'cand-001'},hr);assert.equal(initialized.success,true);
 await check('Candidate ownership does not expose internal onboarding tasks',async()=>{
  const owner=await db.prepare('SELECT email FROM users WHERE id=?').get(outsider.id),candidate=await db.prepare("SELECT email FROM candidates WHERE id='cand-001'").get();
  await db.prepare("UPDATE candidates SET email=? WHERE id='cand-001'").run(owner.email);
  try{assert.equal((await onboarding.getOnboardingByCandidate('cand-001',outsider)).statusCode,403);}finally{await db.prepare("UPDATE candidates SET email=? WHERE id='cand-001'").run(candidate.email);}
 });
 await check('onboarding history failure rolls back completion',async()=>{
  for(const item of initialized.data.items.slice(0,-1))assert.equal((await onboarding.updateChecklistItem(initialized.data.id,item.id,{status:'COMPLETED'},hr)).success,true);
  const original=db.prepare;
  db.prepare=function(sql){if(sql.includes('INSERT INTO candidate_status_history'))throw Error('AUDIT_HISTORY_INJECTED');return original.call(this,sql);};
  try{await assert.rejects(()=>onboarding.updateChecklistItem(initialized.data.id,initialized.data.items.at(-1).id,{status:'COMPLETED'},hr),/AUDIT_HISTORY_INJECTED/);}finally{db.prepare=original;}
  assert.equal((await db.prepare('SELECT status FROM onboarding_checklist_items WHERE id=?').get(initialized.data.items.at(-1).id)).status,'PENDING');
  assert.equal((await db.prepare("SELECT stage FROM candidates WHERE id='cand-001'").get()).stage,'HIRED');
 });
 await check('completion retries do not duplicate stage history',async()=>{
  for(const item of initialized.data.items)assert.equal((await onboarding.updateChecklistItem(initialized.data.id,item.id,{status:'COMPLETED'},hr)).success,true);
  const before=Number((await db.prepare("SELECT COUNT(*) AS n FROM candidate_status_history WHERE candidate_id='cand-001' AND action='ONBOARD_COMPLETE'").get()).n);
  assert.equal(before,1);await onboarding.updateChecklistItem(initialized.data.id,initialized.data.items.at(-1).id,{status:'COMPLETED'},hr);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM candidate_status_history WHERE candidate_id='cand-001' AND action='ONBOARD_COMPLETE'").get()).n),1);
 });
 await check('communication variables preserve literal dollar sequences',async()=>{
  await db.prepare("UPDATE candidates SET full_name=?,stage='REJECTED' WHERE id='cand-002'").run('Name $& $$ $`');
  const service=new Communication(db),result=await service.previewBulk({type:'REJECTION',candidateIds:['cand-002'],customSubject:'Hello {{candidateName}}'},hr);
  assert.equal(result.previews?.[0]?.subject,'Hello Name $& $$ $`');
 });
 await check('concurrent rejection requests send one message',async()=>{
  const a=new Communication(db),b=new Communication(db);let sends=0;
  const mail=async()=>{sends++;await new Promise(resolve=>setTimeout(resolve,15));return {success:true,simulated:true};};a.emailService.sendMail=mail;b.emailService.sendMail=mail;
  const transactions=db.transaction,connections=new Set();let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  if(db.auditNative)db.transaction=fn=>transactions.call(db,async()=>{connections.add((await db.prepare('SELECT pg_backend_pid() AS pid').get()).pid);if(connections.size===2)release();await Promise.race([barrier,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('CONCURRENT_CONNECTIONS_NOT_OBSERVED')),3000);timer.unref();})]);return fn();});
  let result;
  try{result=await Promise.all([a.sendBulk({type:'REJECTION',candidateIds:['cand-002']},hr),b.sendBulk({type:'REJECTION',candidateIds:['cand-002']},hr)]);}finally{db.transaction=transactions;}
  if(db.auditNative)assert.equal(connections.size,2);
  assert.equal(sends,1);assert.equal(result.reduce((n,r)=>n+r.sentCount,0),1);assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM candidate_communications WHERE candidate_id='cand-002' AND status IN ('DELIVERED','SENT_LOCAL')").get()).n),1);
 });
 await check('unknown SMTP result reserves rejection and blocks blind resend',async()=>{
  await db.prepare("UPDATE candidates SET stage='REJECTED' WHERE id='cand-003'").run();
  const service=new Communication(db);let sends=0;
  service.emailService.sendMail=async()=>{sends++;return {success:false,error:'SMTP_SEND_FAILED'};};
  const first=await service.sendBulk({type:'REJECTION',candidateIds:['cand-003']},hr);
  assert.equal(first.results[0].status,'PENDING');
  await service.sendBulk({type:'REJECTION',candidateIds:['cand-003']},hr);assert.equal(sends,1);
 });
}
async function main(){
 const configIndex=process.argv.indexOf('--native-config');
 if(configIndex>=0){
  const config=JSON.parse(fs.readFileSync(process.argv[configIndex+1],'utf8').replace(/^\uFEFF/,''));
  assert.equal(config.user,'ats_s7_audit');assert.equal(config.port,55589);assert.match(path.basename(config.root),/^ats-s7-audit-pg17-[a-f0-9]{32}$/);
  const {Pool}=require('pg'),options={host:'127.0.0.1',port:config.port,user:config.user,password:fs.readFileSync(config.passwordFile,'utf8'),ssl:false,max:4,connectionTimeoutMillis:5000};
  const admin=new Pool({...options,database:'postgres'}),name='ats_s7_audit_'+require('node:crypto').randomBytes(8).toString('hex');
  try{await admin.query('CREATE DATABASE "'+name+'"');}finally{await admin.end();}
  const pool=new Pool({...options,database:name}),db=new PostgresDatabase({},pool);db.auditNative=true;
  try{const identity=await db.prepare('SELECT version() AS version,current_database() AS database').get();console.log('NATIVE_IDENTITY '+JSON.stringify(identity));await require('../src/db/migrate-postgres').migrate(db);await run(db,'PostgreSQL native');}finally{await db.close();}
  console.log('SPRINT7_AUDIT_RESULT '+JSON.stringify({passed,failed}));process.exitCode=failed?1:0;return;
 }
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ats-s7-audit-')),sqlite=require('../src/db/database').getDatabase(path.join(temp,'audit.sqlite'));
 try{await run(sqlite,'SQLite');}finally{sqlite.close();}
 const engine=new(require('@electric-sql/pglite').PGlite)();
 const query=async(sql,params)=>{const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return {rows:result?.rows||[],rowCount:result?.affectedRows||0};};
 let tail=Promise.resolve();
 const pg=new PostgresDatabase({},{on(){},query,async connect(){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query,release};},async end(){await engine.close();}});
 try{await require('../src/db/migrate-postgres').migrate(pg);await run(pg,'PGlite');}finally{await pg.close();}
 console.log('SPRINT7_AUDIT_RESULT '+JSON.stringify({passed,failed}));process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
