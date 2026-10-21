const assert = require('node:assert/strict');
async function run(db) {
  await db.transaction(() => require('../src/db/seed').seedDatabase(db));
  if(db.provider!=='postgres'){
    const exec=db.exec.bind(db);db.exec=sql=>{if(/CREATE TABLE IF NOT EXISTS candidate_sla_breaches/.test(sql))throw Error('SYNTHETIC_SLA_SCHEMA_FAILURE');return exec(sql);};
    try{assert.throws(()=>new(require('../src/services/slaNotificationService'))(db),/SYNTHETIC_SLA_SCHEMA_FAILURE/);assert.notEqual(db.__slaTablesInitialized,true);}finally{db.exec=exec;}
  }
  const service = new (require('../src/services/slaNotificationService'))(db);
  await service.ensureTables();
  const timezone=process.env.TZ;
  try{for(const zone of ['UTC','Asia/Ho_Chi_Minh']){process.env.TZ=zone;const boundary=await service.calculateCandidateSla({id:'synthetic-boundary',stage:'NEW',created_at:'2026-10-01 00:00:00'},{NEW:{thresholdDays:3,warningDays:2}},new Date('2026-10-03T23:59:59Z'));assert.equal(boundary.daysInStage,2);assert.equal(boundary.isOverdue,false);}}finally{if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone;}
  const count = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM sla_job_executions').get()).n);
  const before = await count();
  assert.equal((await service.runDailySlaCheck()).statusCode, 401);
  for (const actor of [{ id: 'missing', roles: ['ADMIN'] }, { id: 'usr-candidate', roles: ['ADMIN'] }]) {
    assert.equal((await service.runDailySlaCheck(null, actor)).statusCode, 403);
    assert.equal((await service.getOverdueCandidates(actor)).statusCode, 403);
    assert.equal((await service.updateSlaConfigurations([], actor)).statusCode, 403);
  }
  assert.equal(await count(), before);
  await db.prepare("UPDATE users SET status='LOCKED' WHERE id='usr-recruiter'").run();
  assert.equal((await service.getOverdueCandidates({ id: 'usr-recruiter', roles: ['ADMIN'] })).statusCode, 403);
  await db.prepare("UPDATE users SET status='ACTIVE' WHERE id='usr-recruiter'").run();
  const result = await service.getOverdueCandidates({ id: 'usr-recruiter', roles: ['ADMIN'] }, { includeAll: true });
  assert.equal(result.success, true);
  const ids = new Set((await db.prepare("SELECT c.id FROM candidates c JOIN requisitions r ON r.id=c.requisition_id WHERE r.recruiter_id='usr-recruiter'").all()).map(row => row.id));
  for (const candidate of result.data.candidates) assert.ok(ids.has(candidate.id));
  assert.equal((await service.runDailySlaCheck('invalid-date', { id: 'usr-hr-mgr' })).statusCode, 400);
  assert.equal(await count(), before);
  const candidate = await db.prepare('SELECT c.id,c.requisition_id FROM candidates c JOIN requisitions r ON r.id=c.requisition_id WHERE r.recruiter_id=? LIMIT 1').get('usr-recruiter');
  assert.ok(candidate);
  await db.prepare("INSERT INTO sla_reminders(id,candidate_id,requisition_id,recruiter_id,stage,threshold_days,days_in_stage,reminder_date,reminder_title,reminder_message) VALUES ('scope-reminder',?,?,?,'NEW',3,5,'2099-01-01','Private reminder','Private content')").run(candidate.id,candidate.requisition_id,'usr-recruiter');
  assert.equal((await service.getRecruiterReminders({id:'usr-recruiter'})).data.reminders.length,1);
  await db.prepare('UPDATE requisitions SET recruiter_id=NULL WHERE id=?').run(candidate.requisition_id);
  const revoked = await service.getRecruiterReminders({id:'usr-recruiter',roles:['ADMIN']});
  assert.equal(revoked.data.reminders.length,0); assert.equal(revoked.data.unreadCount,0);
  assert.equal((await service.markReminderAsRead('scope-reminder',{id:'usr-recruiter'})).statusCode,404);
  const configurations = await service.getSlaConfigurations();
  const beforeConfig = configurations.data.find(row=>row.stage==='NEW').thresholdDays;
  assert.equal((await service.updateSlaConfigurations([{stage:'NEW',thresholdDays:2},{stage:'INVALID',thresholdDays:3}],{id:'usr-hr-mgr'})).statusCode,400);
  assert.equal((await service.getSlaConfigurations()).data.find(row=>row.stage==='NEW').thresholdDays,beforeConfig);
  assert.equal((await service.updateSlaConfigurations([{stage:'NEW',thresholdDays:3,warningDays:0}],{id:'usr-hr-mgr'})).success,true);
  assert.equal((await service.getSlaConfigurations()).data.find(row=>row.stage==='NEW').warningDays,0);
  assert.equal((await service.updateSlaConfigurations([{stage:'NEW',thresholdDays:8,warningDays:0}],{id:'usr-hr-mgr'},candidate.requisition_id)).success,true);
  const scopedSla=await service.calculateCandidateSla({id:'synthetic-scoped',requisition_id:candidate.requisition_id,stage:'NEW',created_at:'2026-10-01 00:00:00'},{NEW:{thresholdDays:3,warningDays:2}},new Date('2026-10-05T00:00:00Z'));
  assert.equal(scopedSla.thresholdDays,8);assert.equal(scopedSla.warningDays,0);assert.equal(scopedSla.isOverdue,false);
  assert.equal((await service.updateSlaConfigurations([{stage:'NEW',thresholdDays:3}],{id:'usr-recruiter'},candidate.requisition_id)).statusCode,404);
  assert.equal((await service.updateSlaConfigurations([{stage:'NEW',thresholdDays:'3junk'}],{id:'usr-hr-mgr'})).statusCode,400);
  const prepare=db.prepare.bind(db);let writes=0;
  db.prepare=sql=>{const statement=prepare(sql);if(/UPDATE sla_configurations/.test(sql)){const run=statement.run.bind(statement);statement.run=(...params)=>{if(++writes===2)throw Error('SYNTHETIC_SLA_WRITE_FAILURE');return run(...params);};}return statement;};
  try{await assert.rejects(()=>service.updateSlaConfigurations([{stage:'NEW',thresholdDays:2},{stage:'SCREENING',thresholdDays:4}],{id:'usr-hr-mgr'}),/SYNTHETIC_SLA_WRITE_FAILURE/);}finally{db.prepare=prepare;}
  assert.equal(writes,2);assert.equal((await service.getSlaConfigurations()).data.find(row=>row.stage==='NEW').thresholdDays,3);
  const snapshot=async()=>JSON.stringify(await db.prepare('SELECT * FROM candidate_sla_breaches ORDER BY id').all())+JSON.stringify(await db.prepare('SELECT * FROM sla_reminders ORDER BY id').all());
  const beforeDaily=await snapshot(),Email=require('../src/services/emailService').EmailService,send=Email.prototype.sendMail;let deliveries=0;Email.prototype.sendMail=async()=>{deliveries++;return{success:true};};
  db.prepare=sql=>{if(/INSERT INTO sla_job_executions/.test(sql))throw Error('SYNTHETIC_SLA_JOB_FAILURE');return prepare(sql);};
  try{await assert.rejects(()=>service.runDailySlaCheck('2099-01-01',{id:'usr-hr-mgr'}),/SYNTHETIC_SLA_JOB_FAILURE/);}finally{db.prepare=prepare;Email.prototype.sendMail=send;}
  assert.equal(await snapshot(),beforeDaily);assert.equal(deliveries,0);
  Email.prototype.sendMail=async()=>{deliveries++;return{success:true};};
  try{const completed=await service.runDailySlaCheck('2099-01-01',{id:'usr-hr-mgr'});assert.equal(completed.success,true);assert.ok(completed.data.remindersCreated>0);assert.equal(deliveries,completed.data.remindersCreated);}finally{Email.prototype.sendMail=send;}
  const Controller = require('../src/controllers/slaNotificationController');
  let calls = 0, reply;
  const controller = new Controller({ runDailySlaCheck: async () => { calls++; return {success:true}; } }, { authorize:async()=>({id:'usr-hr-mgr'}) }, {});
  const response = { writeHead(status){reply={status};},end(body){reply.data=JSON.parse(body);} };
  await controller.handle({method:'POST'},response,new URL('http://localhost/api/v1/sla/check'),async()=>{throw new SyntaxError('synthetic malformed body');});
  assert.equal(reply.status,400); assert.equal(calls,0);
  controller.service.runDailySlaCheck=async()=>{throw new Error('synthetic sensitive database path');};
  await controller.handle({method:'POST'},response,new URL('http://localhost/api/v1/sla/check'),async()=>({}));
  assert.equal(reply.status,500); assert.equal(JSON.stringify(reply.data).includes('synthetic sensitive'),false);
  console.log('SLA_SECURITY_PASS');
}
async function main() {
  const db=require('../src/db/database').getDatabase(':memory:');
  try{await run(db);}finally{await db.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();
  const query=async(sql,params)=>{const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:result?.rows||[],rowCount:result?.affectedRows||0};};
  const pg=new(require('../src/db/postgres').PostgresDatabase)({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});
  try{await require('../src/db/migrate-postgres').migrate(pg);await run(pg);}finally{await pg.close();}
}
module.exports={run};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
