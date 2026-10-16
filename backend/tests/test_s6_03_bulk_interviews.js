const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {sqliteBoundary,PostgresDatabase}=require('../src/db/postgres');
const {setupFixture}=require('./test_s6_02_interview_scheduling');
const Bulk=require('../src/services/bulkInterviewService');
const Worker=require('../src/services/interviewInvitationWorker');
const migration=require('../src/db/migrate-bulk-interviews');
const actor={id:'usr-recruiter-1'};
const payload={candidateIds:['cand-tran','cand-nguyen'],requisitionId:'req-backend',interviewerIds:['usr-interviewer-1','usr-interviewer-2'],roundName:'Final',windowStart:'2032-06-01T09:00',windowEnd:'2032-06-01T11:00',durationMinutes:30,breakMinutes:10,interviewFormat:'ONLINE',meetingLink:'https://example.invalid/interview'};

async function fixture(db,provider,applyMigration=true){
  await setupFixture(db,db.provider==='postgres'?'postgres':'sqlite');
  await db.exec(`CREATE TABLE email_outbox(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,subject TEXT NOT NULL,body_html TEXT NOT NULL,body_text TEXT,template_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED')),retry_count INTEGER NOT NULL DEFAULT 0,error_message TEXT,sent_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE email_logs(id TEXT PRIMARY KEY,recipient TEXT,subject TEXT,template_name TEXT,status TEXT,error_message TEXT,sent_at TEXT);`);
  if(applyMigration)await migration.migrate(db);
}

async function run(db,provider){
  let passed=0;
  const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+provider+' '+name);};
  await fixture(db,provider,false);
  const service=new Bulk(db),count=async table=>Number((await db.prepare('SELECT COUNT(*) AS n FROM '+table).get()).n);
  const snapshot=async()=>{const rows={};for(const table of ['candidates','interviews','interview_interviewers','interview_batches','interview_batch_items','email_outbox','interview_invitation_deliveries','email_logs'])rows[table]=await db.prepare('SELECT * FROM '+table+' ORDER BY 1').all();return rows;};
  const denied=async(data,user,status)=>{const before=await snapshot(),result=await service.preview(data,user);assert.equal(result.success,false);assert.equal(result.statusCode,status);assert.deepEqual(await snapshot(),before);};
  await test('DDL failure rolls back schema and ledger, retry verifies schema',async()=>{
    const exec=db.exec.bind(db);db.exec=async sql=>{await exec(sql);if(sql.includes('CREATE TABLE interview_batches'))throw Error('INJECT_DDL_FAILURE');};
    try{await assert.rejects(()=>migration.migrate(db),/INJECT_DDL_FAILURE/);}finally{db.exec=exec;}
    const tables=db.provider==='postgres'?await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('interview_batches','ats_bulk_interview_migrations')").all():await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('interview_batches','ats_bulk_interview_migrations')").all();
    assert.deepEqual(tables,[]);await migration.migrate(db);await migration.migrate(db);await migration.verify(db);
  });
  await test('preview never executes INSERT UPDATE DELETE or DDL',async()=>{const prepare=db.prepare.bind(db),exec=db.exec.bind(db),queries=[];db.prepare=sql=>{queries.push(sql);return prepare(sql);};db.exec=sql=>{queries.push(sql);return exec(sql);};try{assert.equal((await service.preview(payload,actor)).success,true);}finally{db.prepare=prepare;db.exec=exec;}assert.equal(queries.some(sql=>/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql.replace(/FOR (?:SHARE|UPDATE)/g,''))),false);});
  await test('preview is read only and sorts slots in Vietnam timezone',async()=>{const before=await snapshot(),preview=await service.preview(payload,actor);assert.equal(preview.statusCode,200);assert.deepEqual(preview.slots.map(row=>row.candidateId),['cand-nguyen','cand-tran']);assert.equal(preview.slots[0].start,'2032-06-01T02:00:00.000Z');assert.equal(preview.slots[1].start,'2032-06-01T02:40:00.000Z');assert.deepEqual(await snapshot(),before);});
  for(const [name,change] of [['empty',{candidateIds:[]}],['duplicate',{candidateIds:['cand-tran','cand-tran']}],['mixed',{candidateIds:['cand-tran','cand-le']}],['duration',{durationMinutes:14}],['break',{breakMinutes:-1}],['window',{windowEnd:'2032-06-01T09:01'}],['past',{windowStart:'2000-01-01T09:00',windowEnd:'2000-01-01T12:00'}],['invalid date',{windowStart:'2032-02-30T09:00'}],['trailing time',{windowStart:'2032-06-01T09:00garbage'}],['link',{meetingLink:'javascript:alert(1)'}],['room',{interviewFormat:'IN_PERSON',meetingRoom:''}],['panel',{interviewerIds:['usr-candidate']}]])await test('reject '+name,()=>denied({...payload,...change},name==='mixed'?{id:'usr-hr'}:actor,400));
  for(const user of [null,{id:'missing',roles:['ADMIN']},{id:'usr-candidate',roles:['ADMIN']},{id:'usr-interviewer-1',roles:['ADMIN']},{id:'usr-recruiter-2'}])await test('fresh actor and scope '+user?.id,()=>denied(payload,user,403));
  await test('account lock and revoked grant take effect',async()=>{await db.prepare("UPDATE users SET status='LOCKED' WHERE id=?").run(actor.id);await denied(payload,actor,403);await db.prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run(actor.id);await db.prepare("DELETE FROM role_permissions WHERE role_id='role-recruiter' AND permission_id='p-int-create'").run();await denied(payload,actor,403);await db.prepare("INSERT INTO role_permissions VALUES('role-recruiter','p-int-create')").run();});
  await test('support and HR use valid existing scopes',async()=>{for(const id of ['usr-recruiter-support','usr-hr','usr-admin'])assert.equal((await service.preview(payload,{id})).success,true);});
  await test('boundary and explicit timezone equivalent',async()=>{const p=await service.preview({...payload,windowStart:'2032-06-01T02:00:00Z',windowEnd:'2032-06-01T03:10:00Z'},actor);assert.equal(p.success,true);assert.equal(p.slots.at(-1).end,'2032-06-01T03:10:00.000Z');});
  const request=async(data=payload,key='test-request-key-0001')=>({...data,requestKey:key,fingerprint:(await service.preview(data,actor)).fingerprint});
  await test('stale candidate metadata rejected without writes',async()=>{const req=await request();await db.prepare("UPDATE candidates SET stage='APPLIED' WHERE id='cand-tran'").run();const before=await snapshot();assert.equal((await service.create(req,actor)).code,'BULK_PREVIEW_STALE');assert.deepEqual(await snapshot(),before);await db.prepare("UPDATE candidates SET stage='NEW' WHERE id='cand-tran'").run();});
  await test('assignment revoked between preview and confirm cannot write',async()=>{const req=await request();await db.prepare("UPDATE requisitions SET recruiter_id='usr-recruiter-2' WHERE id='req-backend'").run();const before=await snapshot();assert.equal((await service.create(req,actor)).statusCode,403);assert.deepEqual(await snapshot(),before);await db.prepare("UPDATE requisitions SET recruiter_id='usr-recruiter-1' WHERE id='req-backend'").run();});
  await test('failure after second insert rolls back all stage, batch and outbox writes',async()=>{
    const req=await request(),before=await snapshot(),prepare=db.prepare.bind(db);
    db.prepare=sql=>{const stmt=prepare(sql);if(/INSERT INTO interviews/.test(sql))return {...stmt,run:async(...args)=>{const result=await stmt.run(...args);if(args[1]==='cand-tran')throw Error('INJECT_AFTER_SECOND_INSERT');return result;}};return stmt;};
    try{await assert.rejects(()=>service.create(req,actor),/INJECT_AFTER_SECOND_INSERT/);}finally{db.prepare=prepare;}
    assert.deepEqual(await snapshot(),before);
  });
  let committed,committedRequest;
  await test('atomic confirm, persistent replay and changed payload conflict',async()=>{committedRequest=await request();committed=await service.create(committedRequest,actor);assert.equal(committed.statusCode,201);assert.equal(await count('interviews'),2);assert.equal(await count('interview_batch_items'),2);assert.equal(await count('email_outbox'),2);assert.equal(await count('email_logs'),0);const before=await snapshot();const replay=await service.create(committedRequest,actor);assert.equal(replay.replayed,true);assert.equal(replay.batchId,committed.batchId);assert.deepEqual(await snapshot(),before);assert.equal((await service.create({...committedRequest,roundName:'Changed'},actor)).code,'BULK_IDEMPOTENCY_CONFLICT');assert.deepEqual(await snapshot(),before);});
  await test('replay after committed interview time still returns original batch',async()=>{const now=Date.now;Date.now=()=>Date.parse('2033-06-01T00:00:00Z');try{const result=await service.create(committedRequest,actor);assert.equal(result.statusCode,200);assert.equal(result.batchId,committed.batchId);}finally{Date.now=now;}});
  await test('delivery sends after commit, separately, no cross candidate data',async()=>{let calls=0;const worker=new Worker(db,{sendMail:async msg=>{calls++;assert.equal(await count('interviews'),2);assert.equal(await count('interview_batches'),1);if(msg.to==='nguyena@test.vn'){assert.ok(msg.text.includes('Nguyen Van A'));assert.ok(!msg.text.includes('Tran Thi B'));assert.ok(msg.text.includes('09:00'));}else{assert.equal(msg.to,'tranb@test.vn');assert.ok(msg.text.includes('09:40'));assert.ok(!msg.text.includes('Nguyen Van A'));}return {success:true,simulated:true};}});const result=await worker.deliver(committed.batchId,actor);assert.equal(calls,2);assert.ok(result.deliveries.every(row=>row.state==='SIMULATED'));await worker.deliver(committed.batchId,actor);assert.equal(calls,2);});
  await test('outside actor cannot observe batch or retry delivery',async()=>{assert.equal((await service.status(committed.batchId,{id:'usr-recruiter-2'})).statusCode,404);const before=await snapshot();assert.equal((await service.retry(committed.batchId,{id:'usr-candidate'})).statusCode,403);assert.deepEqual(await snapshot(),before);});
  await test('new conflict is detected after preview and cancelled schedules free slots',async()=>{const p=await service.preview(payload,actor);assert.equal(p.success,false);assert.equal(p.errors.length,2);await db.prepare("UPDATE interviews SET status='CANCELLED'").run();assert.equal((await service.preview(payload,actor)).success,true);});
  await test('known delivery failure retries, uncertain transport never blindly resends',async()=>{
    const req=await request({...payload,windowStart:'2032-06-02T09:00',windowEnd:'2032-06-02T11:00'},'test-request-key-0002'),result=await service.create(req,actor);assert.equal(result.success,true);
    let calls=0;const failedWorker=new Worker(db,{sendMail:async()=>{calls++;return {success:false,error:'SMTP_NOT_CONFIGURED'};}});
    assert.ok((await failedWorker.deliver(result.batchId,actor)).deliveries.every(row=>row.state==='FAILED'));assert.equal(calls,2);
    await service.retry(result.batchId,actor);
    const uncertainWorker=new Worker(db,{sendMail:async()=>{calls++;return {success:false,error:'SMTP_SEND_FAILED'};}});
    assert.ok((await uncertainWorker.deliver(result.batchId,actor)).deliveries.every(row=>row.state==='UNKNOWN'));const before=await snapshot();assert.equal((await service.retry(result.batchId,actor)).statusCode,409);await uncertainWorker.deliver(result.batchId,actor);assert.equal(calls,4);assert.deepEqual(await snapshot(),before);
  });
  await test('same email cannot expose foreign application invitation metadata through timeline',async()=>{
    await db.prepare("UPDATE candidates SET email='nguyena@test.vn' WHERE id='cand-le'").run();
    const foreign={...payload,candidateIds:['cand-le'],requisitionId:'req-frontend',interviewerIds:['usr-interviewer-3'],windowStart:'2032-06-03T09:00',windowEnd:'2032-06-03T11:00'};
    const preview=await service.preview(foreign,{id:'usr-recruiter-2'});assert.equal(preview.success,true);
    const created=await service.create({...foreign,fingerprint:preview.fingerprint,requestKey:'foreign-request-key-01'},{id:'usr-recruiter-2'});assert.equal(created.success,true);
    await new Worker(db).deliver(created.batchId,{id:'usr-recruiter-2'});
    const foreignOutbox=await db.prepare('SELECT d.outbox_id FROM interview_invitation_deliveries d JOIN interview_batch_items i ON i.interview_id=d.interview_id WHERE i.batch_id=?').get(created.batchId);
    const Timeline=require('../src/services/candidateTimelineService');
    const timeline=await new Timeline(db).getCandidateTimeline('cand-nguyen',{...actor,roles:['RECRUITER']});assert.equal(timeline.success,true);
    const emails=timeline.data.timeline.filter(event=>event.details?.templateName==='S603_INTERVIEW_INVITATION');assert.equal(emails.length,2);assert.ok(emails.every(event=>event.details.emailId!==foreignOutbox.outbox_id));assert.ok(emails.every(event=>event.details.sourceTable==='email_outbox'));
    assert.ok(!timeline.data.timeline.some(event=>event.details?.candidateId==='cand-le'));
    await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES('usr-recruiter-1','role-candidate')").run();
    await db.prepare("UPDATE users SET email='nguyena@test.vn' WHERE id='usr-recruiter-1'").run();
    const mixed=await new Timeline(db).getCandidateTimeline('cand-nguyen',{...actor,roles:['ADMIN']});assert.equal(mixed.success,true);assert.equal(mixed.data.timeline.filter(event=>event.details?.templateName==='S603_INTERVIEW_INVITATION').length,2);assert.ok(!mixed.data.timeline.some(event=>event.details?.candidateId==='cand-le'));
    const all=await new Timeline(db).getCandidateTimeline('cand-nguyen',{id:'usr-admin',roles:['ADMIN']});assert.equal(all.data.timeline.filter(event=>event.details?.templateName==='S603_INTERVIEW_INVITATION').length,3);
  });
  await test('schema drift fails verify and retry without accepting ledger',async()=>{
    if(db.provider==='postgres'){
      await db.exec("ALTER TABLE interview_invitation_deliveries DROP CONSTRAINT interview_invitation_deliveries_state_check; ALTER TABLE interview_invitation_deliveries ADD CONSTRAINT interview_invitation_deliveries_state_check CHECK(state IN ('PENDING','SENDING','SENT','SIMULATED','FAILED','UNKNOWN','UNAPPROVED'))");
      await assert.rejects(()=>migration.verify(db),/SCHEMA_DRIFT/);
      await assert.rejects(()=>migration.migrate(db),/SCHEMA_DRIFT/);
      await db.exec("ALTER TABLE interview_invitation_deliveries DROP CONSTRAINT interview_invitation_deliveries_state_check; ALTER TABLE interview_invitation_deliveries ADD CONSTRAINT interview_invitation_deliveries_state_check CHECK(state IN ('PENDING','SENDING','SENT','SIMULATED','FAILED','UNKNOWN'))");
      await migration.verify(db);
    }
    await db.exec('DROP INDEX idx_interview_deliveries_state');await assert.rejects(()=>migration.verify(db),/SCHEMA_DRIFT/);await assert.rejects(()=>migration.migrate(db),/SCHEMA_DRIFT/);
  });
  await test('deleting an actor preserves batch identity without blocking user deletion',async()=>{await db.prepare('DELETE FROM user_roles WHERE user_id=?').run(actor.id);await db.prepare('DELETE FROM users WHERE id=?').run(actor.id);const batch=await db.prepare('SELECT actor_id,actor_snapshot FROM interview_batches WHERE id=?').get(committed.batchId);assert.equal(batch.actor_id,null);assert.equal(batch.actor_snapshot,actor.id);assert.equal(await count('interview_batches'),3);assert.equal(await count('interviews'),5);});
  return passed;
}

async function main(){
  let passed=0;
  const db=sqliteBoundary(new DatabaseSync(':memory:'));db.exec('PRAGMA foreign_keys=ON');
  try{passed+=await run(db,'SQLite');}finally{db.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();
  const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return {rows:r?.rows || [],rowCount:r?.affectedRows || 0};};
  const pg=new PostgresDatabase({},{on(){},query,async connect(){return {query,release(){}};},async end(){await engine.close();}});
  try{passed+=await run(pg,'PGlite');}finally{await pg.close();}
  console.log('S603_RESULT '+JSON.stringify({passed,failed:0,providers:['SQLite','PGlite']}));
}
module.exports={fixture,payload,actor,run};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
