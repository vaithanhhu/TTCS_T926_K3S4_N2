const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {sqliteBoundary}=require('../src/db/postgres');
const RequisitionService=require('../src/services/requisitionService');
const {setupFixture}=require('./test_s6_02_interview_scheduling');

async function main(){
  const db=sqliteBoundary(new DatabaseSync(':memory:'));
  try{
    await setupFixture(db,'sqlite');
    await db.exec('ALTER TABLE permissions ADD COLUMN module TEXT; ALTER TABLE permissions ADD COLUMN description TEXT; CREATE UNIQUE INDEX test_permissions_code ON permissions(code);');
    await db.prepare("INSERT INTO candidates(id,requisition_id,full_name,email,stage) VALUES('cand-test','req-backend','Test Candidate','test-candidate@example.invalid','NEW')").run();
    await db.prepare("INSERT INTO candidates(id,requisition_id,full_name,email,stage) VALUES('cand-other','req-backend','Other Candidate','other-candidate@example.invalid','NEW')").run();
    await db.prepare("INSERT INTO candidates(id,requisition_id,full_name,email,stage) VALUES('cand-race1','req-backend','Race One','race1@example.invalid','NEW'),('cand-race2','req-backend','Race Two','race2@example.invalid','NEW')").run();
    await require('../src/db/migrate-interview-conflict-override').migrate(db);
    const service=new RequisitionService(db), recruiter={id:'usr-recruiter-1'};
    const create=(candidateId,interviewerId,scheduledTime,meetingRoom,extra={})=>service.createInterview({candidateId,interviewerIds:[interviewerId],scheduledTime,durationMinutes:60,interviewFormat:'IN_PERSON',meetingRoom,...extra},recruiter);
    const first=await create('cand-nguyen','usr-interviewer-1','2035-06-01T09:00','Room A');assert.equal(first.success,true);
    const roomConflict=await create('cand-tran','usr-interviewer-2','2035-06-01T09:30',' room a ');
    assert.equal(roomConflict.code,'INTERVIEW_RESOURCE_CONFLICT');assert.equal(roomConflict.conflicts.length,1);assert.equal(roomConflict.conflicts[0].resourceConflicts[0].type,'ROOM');
    const interviewerConflict=await create('cand-tran','usr-interviewer-1','2035-06-01T09:45','Room B');
    assert.equal(interviewerConflict.conflicts[0].resourceConflicts[0].type,'INTERVIEWER');
    const adjacent=await create('cand-test','usr-interviewer-2','2035-06-01T10:00','Room A');assert.equal(adjacent.success,true);
    const independent=await create('cand-other','usr-interviewer-3','2035-06-01T14:00','Room Z');assert.equal(independent.success,true,'different interviewers and rooms may overlap independently');
    const unauthorized=await service.createInterview({candidateId:'cand-other',interviewerIds:['usr-interviewer-3'],scheduledTime:'2035-06-01T09:30',durationMinutes:30,interviewFormat:'IN_PERSON',meetingRoom:'Room A',conflictOverrideConfirmed:true,conflictOverrideReason:'Approved by HR'},{id:'usr-hr'});
    assert.equal(unauthorized.code,'INTERVIEW_OVERRIDE_FORBIDDEN');
    const missingReason=await create('cand-tran','usr-interviewer-3','2035-06-01T09:30','Room A',{conflictOverrideConfirmed:true,conflictOverrideReason:'  '});
    assert.equal(missingReason.code,'INTERVIEW_OVERRIDE_REASON_REQUIRED');
    const overridden=await create('cand-tran','usr-interviewer-3','2035-06-01T09:30','Room A',{conflictOverrideConfirmed:true,conflictOverrideReason:'Approved room exception'});
    assert.equal(overridden.success,true);const audit=await db.prepare('SELECT actor_id,reason,conflicts_json FROM interview_conflict_override_audit WHERE interview_id=?').get(overridden.id);
    assert.equal(audit.actor_id,recruiter.id);assert.equal(audit.reason,'Approved room exception');assert.ok(JSON.parse(audit.conflicts_json).length);
    const updated=await service.updateInterviewSchedule(first.id,{scheduledTime:'2035-06-01T09:00',durationMinutes:30,interviewFormat:'IN_PERSON',meetingRoom:'Room A',interviewerIds:['usr-interviewer-1']},recruiter);
    assert.equal(updated.success,true,'an interview does not conflict with itself while being updated');
    const race=await Promise.all([create('cand-race1','usr-interviewer-2','2035-06-02T09:00','Room Race'),create('cand-race2','usr-interviewer-3','2035-06-02T09:00','Room Race')]);
    assert.equal(race.filter(result=>result.success).length,1,'concurrent same-room bookings allow only one request');assert.equal(race.filter(result=>result.code==='INTERVIEW_RESOURCE_CONFLICT').length,1);
    console.log('S604_RESULT '+JSON.stringify({passed:11,failed:0,provider:'SQLite'}));
  }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
