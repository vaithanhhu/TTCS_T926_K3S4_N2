const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {PostgresDatabase,pgTypes} = require('../src/db/postgres');
const Service = require('../src/services/requisitionService');
const runner = require('../src/db/migrate-interview-scheduling');
const {setupFixture} = require('./test_s6_02_interview_scheduling');

async function main() {
  const root=path.resolve(__dirname,'../..');
  for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-wal','backend/data/ats.db-shm']) assert.equal(fs.existsSync(path.join(root,file)),false,'ISOLATED_SOURCE_REQUIRED');
  if(!process.argv[2]) throw Error('EXPLICIT_DISPOSABLE_CLUSTER_CONFIG_REQUIRED');
  const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
  assert.equal(cfg.isolatedNewCluster,true);
  assert.equal(cfg.listen,'127.0.0.1');
  const relative=path.relative(fs.realpathSync.native(os.tmpdir()),fs.realpathSync.native(cfg.taskRoot));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /^ats-s602-pg\d+-[a-z0-9]+$/i.test(relative));
  assert.equal(path.resolve(cfg.data),path.join(path.resolve(cfg.taskRoot),'data'));
  assert.equal(path.resolve(cfg.passwordFile),path.join(path.resolve(cfg.taskRoot),'password.txt'));
  const connection={host:'127.0.0.1',port:cfg.port,user:cfg.user,password:fs.readFileSync(cfg.passwordFile,'utf8'),database:'postgres',max:4,types:pgTypes(),application_name:'ats-s602-isolated-test'};
  const admin=new Pool(connection);
  const database='ats_s602_fix_'+crypto.randomBytes(8).toString('hex');
  try {
    const identity=(await admin.query("SELECT version() AS version,current_setting('data_directory') AS data,host(inet_server_addr()) AS address")).rows[0];
    assert.equal(path.resolve(identity.data).toLowerCase(),path.resolve(cfg.data).toLowerCase());
    assert.equal(identity.address,'127.0.0.1');
    console.log(JSON.stringify({version:identity.version,database,testOnly:true}));
    await admin.query('CREATE DATABASE '+database);
  } finally { await admin.end(); }
  let count=0,sequence=0;
  const fixture=async (action,legacy=false) => {
    const schema='test_'+(++sequence);
    const bootstrap=new Pool({...connection,database});
    try { await bootstrap.query('CREATE SCHEMA '+schema); } finally { await bootstrap.end(); }
    const db=new PostgresDatabase({},new Pool({...connection,database,options:'-c search_path='+schema+' -c timezone=UTC'}));
    try {
      if(legacy) await db.exec('CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE candidates(id TEXT PRIMARY KEY); CREATE TABLE interviews(id TEXT PRIMARY KEY,interviewer_id TEXT,scheduled_time TEXT,location_or_link TEXT);');
      else await setupFixture(db,'postgres');
      await action(db);
      count++;
    } finally { await db.close(); }
  };
  await fixture(async db => {
    await db.exec("INSERT INTO users VALUES('primary'); INSERT INTO interviews VALUES('legacy','primary','2030-06-01T09:00:00','Room 101');");
    await runner.migrate(db); await runner.migrate(db); await runner.verify(db);
    const row=await db.prepare("SELECT scheduled_time,interview_format FROM interviews WHERE id='legacy'").get();
    assert.equal(row.scheduled_time,'2030-06-01T09:00:00');assert.equal(row.interview_format,null);
    assert.equal((await db.prepare("SELECT role FROM interview_interviewers WHERE interview_id='legacy' AND user_id='primary'").get()).role,'PRIMARY');
    await assert.rejects(() => db.prepare("INSERT INTO interview_interviewers(interview_id,user_id) VALUES('missing','primary')").run(),error => error.code==='23503');
    await assert.rejects(() => db.prepare("INSERT INTO interview_interviewers(interview_id,user_id) VALUES('legacy','primary')").run(),error => error.code==='23505');
    await db.exec("ALTER TABLE interviews ALTER COLUMN interview_format SET DEFAULT 'ONLINE'");
    await assert.rejects(() => runner.verify(db),/SCHEMA_DRIFT/);
    await assert.rejects(() => runner.migrate(db),/SCHEMA_DRIFT/);
    await db.exec('ALTER TABLE interviews ALTER COLUMN interview_format DROP DEFAULT');
    await db.exec('ALTER TABLE interviews ALTER COLUMN duration_minutes SET DEFAULT 90');
    await assert.rejects(() => runner.verify(db),/SCHEMA_DRIFT/);
    await db.exec('ALTER TABLE interviews ALTER COLUMN duration_minutes SET DEFAULT 60');
    await runner.verify(db);
    await db.exec('DROP INDEX idx_interview_interviewers_user');
    await assert.rejects(() => runner.verify(db),/SCHEMA_DRIFT/);
    await assert.rejects(() => runner.migrate(db),/SCHEMA_DRIFT/);
    console.log('PASS native migration, backfill, unchanged legacy time/room, retry, FK, unique and drift');
  },true);
  await fixture(async db => {
    const exec=db.exec.bind(db);
    db.exec=async sql => { await exec(sql); if(sql.includes('ADD COLUMN IF NOT EXISTS duration_minutes')) throw Error('DDL_FAILURE'); };
    await assert.rejects(() => runner.migrate(db),/DDL_FAILURE/);
    assert.equal(await db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interviews' AND column_name='duration_minutes'").get(),undefined);
    assert.equal(await db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='ats_interview_scheduling_migrations'").get(),undefined);
    db.exec=exec;await runner.migrate(db);await runner.verify(db);
    console.log('PASS native DDL rollback and retry');
  },true);
  const payload={candidateId:'cand-nguyen',requisitionId:'req-backend',interviewerIds:['usr-interviewer-1','usr-interviewer-2'],scheduledTime:'2031-06-01T09:00',durationMinutes:60,interviewFormat:'ONLINE',meetingLink:'https://example.invalid/meeting'};
  for(const resource of ['candidate','interviewer','actor-assignee']) await fixture(async db => {
    if(resource==='actor-assignee') await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES('usr-recruiter-1','role-interviewer')").run();
    const sharedPayload=resource==='actor-assignee'?{...payload,interviewerIds:['usr-recruiter-1']}:payload;
    const first=new Service(db),second=new Service(db);
    let entered,release;
    const enteredCheck=new Promise(resolve => {entered=resolve;});
    const hold=new Promise(resolve => {release=resolve;});
    const check=first.checkInterviewConflict.bind(first);
    let firstPid;
    first.checkInterviewConflict=async (...args) => {firstPid=(await db.prepare('SELECT pg_backend_pid() AS pid').get()).pid;entered();await hold;return check(...args);};
    const one=first.createInterview(sharedPayload,{id:'usr-recruiter-1'});
    let two;
    try {
      await enteredCheck;
      two=second.createInterview({...sharedPayload,...(resource==='candidate'?{}:{candidateId:'cand-tran'}),...(resource==='interviewer'?{interviewerIds:['usr-interviewer-2','usr-interviewer-1']}:{})},{id:'usr-recruiter-1'});
      let blocked=[];
      const deadline=Date.now()+5000;
      while(Date.now()<deadline) {
        blocked=await db.prepare("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>? AND wait_event_type='Lock' AND ?=ANY(pg_blocking_pids(pid))").all(firstPid,firstPid);
        if(blocked.length)break;
        await new Promise(resolve => setTimeout(resolve,20));
      }
      assert.equal(blocked.length,1,'Second independent connection must wait for the resource lock');
      assert.notEqual(blocked[0].pid,firstPid);
    } finally {release();}
    const results=await Promise.all([one,two]);
    assert.deepEqual(results.map(row => row.statusCode),[201,409]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,sharedPayload.interviewerIds.length);
    console.log('PASS two native connections, '+resource+' lock, stable ordering, 201/409, no duplicate INSERT');
  });
  await fixture(async db => {
    for(const id of ['usr-recruiter-1','usr-recruiter-2']) {
      await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,'role-interviewer')").run(id);
      await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,'role-hr')").run(id);
    }
    const Rbac=require('../src/middlewares/rbacMiddleware');
    const authorize=Rbac.prototype.getAuthorizedActor;
    const pids=new Set();
    let release;
    const barrier=new Promise(resolve => {release=resolve;});
    const timeout=setTimeout(() => release(),5000);
    Rbac.prototype.getAuthorizedActor=async function(id,permission) {
      const actor=await authorize.call(this,id,permission);
      if(permission==='interview.create' && ['usr-recruiter-1','usr-recruiter-2'].includes(id)) {
        pids.add((await this.db.prepare('SELECT pg_backend_pid() AS pid').get()).pid);
        if(pids.size===2)release();
        await barrier;
      }
      return actor;
    };
    try {
      const service=new Service(db);
      const results=await Promise.all([
        service.createInterview({...payload,interviewerIds:['usr-recruiter-2']},{id:'usr-recruiter-1'}),
        service.createInterview({...payload,candidateId:'cand-tran',interviewerIds:['usr-recruiter-1']},{id:'usr-recruiter-2'})
      ]);
      assert.equal(pids.size,2);
      assert.deepEqual(results.map(row => row.statusCode),[201,201]);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,2);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,2);
      console.log('PASS two native connections with cross-assigned multi-role actors without row lock upgrades');
    } finally {clearTimeout(timeout);release();Rbac.prototype.getAuthorizedActor=authorize;}
  });
  await fixture(async db => {
    const service=new Service(db);
    await db.exec("CREATE FUNCTION fail_s602() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'S602_FAILURE_AFTER_INSERT'; END $$; CREATE TRIGGER fail_s602 BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION fail_s602();");
    const before=await db.prepare('SELECT * FROM candidates ORDER BY id').all();
    await assert.rejects(() => service.createInterview(payload,{id:'usr-recruiter-1'}),/S602_FAILURE_AFTER_INSERT/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,0);
    assert.deepEqual(await db.prepare('SELECT * FROM candidates ORDER BY id').all(),before);
    await db.exec('DROP TRIGGER fail_s602 ON candidates');
    assert.equal((await service.createInterview(payload,{id:'usr-recruiter-1'})).statusCode,201);
    console.log('PASS native rollback after INSERT and retry');
  });
  await fixture(async db => {
    const service=new Service(db);
    const created=await service.createInterview(payload,{id:'usr-recruiter-1'});
    assert.equal(created.statusCode,201);
    const calendar=(await service.getInterviews({viewer:{id:'usr-interviewer-2'}})).interviews.find(row => row.id===created.id);
    assert.ok(calendar);assert.equal(Object.hasOwn(calendar.candidate,'email'),false);
    assert.equal(calendar.scheduledTime,'2031-06-01T02:00:00.000Z');
    const before=await db.prepare('SELECT * FROM interviews WHERE id=?').get(created.id);
    assert.equal((await service.updateInterviewStatus(created.id,'COMPLETED','denied',1,{id:'usr-interviewer-2'})).statusCode,403);
    assert.equal((await service.updateInterviewStatus(created.id,'COMPLETED','denied',1)).statusCode,403);
    assert.deepEqual(await db.prepare('SELECT * FROM interviews WHERE id=?').get(created.id),before);
    assert.equal((await service.updateInterviewStatus(created.id,'COMPLETED','primary',9,{id:'usr-interviewer-1'})).statusCode,200);
    assert.equal((await db.prepare('SELECT score FROM interviews WHERE id=?').get(created.id)).score,9);
    await db.prepare("UPDATE users SET email='nguyena@test.vn' WHERE id='usr-interviewer-2'").run();
    await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES('usr-interviewer-2','role-candidate')").run();
    const owned=(await service.getInterviews({viewer:{id:'usr-interviewer-2'}})).interviews.find(row => row.id===created.id);
    assert.equal(owned.candidate.email,'nguyena@test.vn');assert.equal(owned.score,null);assert.equal(owned.feedback,null);
    await db.prepare("UPDATE users SET status='LOCKED' WHERE id='usr-recruiter-1'").run();
    assert.equal((await service.createInterview({...payload,scheduledTime:'2031-06-02T09:00'},{id:'usr-recruiter-1',roles:['ADMIN']})).statusCode,403);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,1);
    console.log('PASS native calendar scope, timezone, evaluation policy, NULL actor and locked forged-role actor');
  });
  console.log(JSON.stringify({nativeGroupsPassed:count,nativeGroupsFailed:0,database}));
}

main().catch(error => { console.error(error.message, error.stack?.split('\n').find(line => line.includes(__filename)) || '');process.exitCode=1; });
