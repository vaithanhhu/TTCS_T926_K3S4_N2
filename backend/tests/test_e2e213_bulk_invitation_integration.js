const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {sqliteBoundary,PostgresDatabase}=require('../src/db/postgres');
const {fixture,payload,actor}=require('./test_s6_03_bulk_interviews');
const Bulk=require('../src/services/bulkInterviewService');

async function verify(db,provider){
  await fixture(db,provider);
  await require('../src/db/migrate-interview-invitations').migrate(db);
  const bulk=new Bulk(db),preview=await bulk.preview(payload,actor);
  assert.equal(preview.statusCode,200);
  const request={...payload,fingerprint:preview.fingerprint,requestKey:'e2e213_invitation_integration'};
  const created=await bulk.create(request,actor);
  assert.equal(created.statusCode,201);
  const messages=await db.prepare('SELECT o.id,o.body_text,o.body_html,o.recipient,o.template_name,d.interview_id FROM email_outbox o JOIN interview_invitation_deliveries d ON d.outbox_id=o.id ORDER BY d.interview_id').all();
  assert.equal(messages.length,2);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get()).n),2);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM interview_invitation_tokens').get()).n),2);
  for(const message of messages){
    assert.equal(message.template_name,'S603_INTERVIEW_INVITATION');
    assert.ok(message.body_text.includes('/interviews/invitation?token='));
    assert.ok(message.body_html.includes('/interviews/invitation?token='));
    const own=message.recipient==='nguyena@test.vn';
    assert.ok(message.body_text.includes(own?'Nguyen Van A':'Tran Thi B'));
    assert.ok(!message.body_text.includes(own?'Tran Thi B':'Nguyen Van A'));
    assert.ok(message.body_text.includes(own?'09:30':'10:10'));
  }
  const replay=await bulk.create(request,actor);
  assert.equal(replay.replayed,true);
  assert.equal(replay.batchId,created.batchId);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get()).n),2);
  console.log('PASS '+provider+' bulk invitations coexist with S6-05, one outbox per interview, private response links, end times, replay');
  await require('../src/db/migrate-interview-reschedule-cancel').migrate(db);
  const scheduling=new(require('../src/services/requisitionService'))(db);
  const interview=created.interviews[0];
  const {roundName,...changedPayload}=payload;
  const changed=await scheduling.updateInterviewSchedule(interview.id,{...changedPayload,scheduledTime:'2032-06-01T13:00',interviewerIds:['usr-interviewer-2'],reason:'E2E213 panel notification'},actor);
  assert.equal(changed.success,true);
  assert.equal((await db.prepare('SELECT round_name FROM interviews WHERE id=?').get(interview.id)).round_name,roundName);
  const panel=await db.prepare("SELECT recipient,body_html FROM email_outbox WHERE template_name='S606_PANEL_RESCHEDULED'").all();
  const expected=await db.prepare("SELECT email FROM users WHERE id IN ('usr-interviewer-1','usr-interviewer-2')").all();
  assert.deepEqual(panel.map(row=>row.recipient).sort(),expected.map(row=>row.email).sort());
  assert.ok(panel.every(row=>!row.body_html.includes('?token=')));
  const cancelled=await scheduling.cancelInterview(interview.id,{reason:'E2E213 <img src=x onerror=alert(1)>'},actor);
  assert.equal(cancelled.success,true);
  const cancellation=await db.prepare("SELECT recipient,body_html FROM email_outbox WHERE template_name IN ('S606_INTERVIEW_CANCELLATION','S606_PANEL_CANCELLED')").all();
  const candidate=await db.prepare('SELECT email FROM candidates WHERE id=?').get(interview.candidateId);
  const remaining=await db.prepare("SELECT email FROM users WHERE id='usr-interviewer-2'").get();
  assert.deepEqual(cancellation.map(row=>row.recipient).sort(),[candidate.email,remaining.email].sort());
  assert.ok(cancellation.every(row=>!row.body_html.includes('<img')));
  console.log('PASS '+provider+' reschedule notifies old and new panel, cancellation notifies candidate and current panel, escaped HTML');
}

(async()=>{
  const sqlite=sqliteBoundary(new DatabaseSync(':memory:'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  try{await verify(sqlite,'SQLite');}finally{sqlite.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();
  const query=async(sql,params)=>{const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:result?.rows||[],rowCount:result?.affectedRows||0};};
  const postgres=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});
  try{await verify(postgres,'PGlite');}finally{await postgres.close();}
})().catch(error=>{console.error(error.code,error.message);process.exitCode=1;});
