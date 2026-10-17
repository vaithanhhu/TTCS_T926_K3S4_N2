const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-wal','backend/data/ats.db-shm','backend/data/ats_test.db']) assert.equal(fs.existsSync(path.join(root,file)),false,'ISOLATED_SOURCE_REQUIRED');
for(const key of Object.keys(process.env)) if(/^(ATS_POSTGRES_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|CANDIDATE_)/.test(key)) delete process.env[key];
Object.assign(process.env,{NODE_ENV:'test',DB_PROVIDER:'sqlite',EMAIL_MODE:'simulated'});

async function main() {
  const {startServer,server}=require('../src/server');
  await startServer(0);
  const db=require('../src/db/database').getDatabase();
  let passed=0;
  try {
    await require('../src/db/migrate-interview-scheduling').migrate(db);
    const password=crypto.randomBytes(20).toString('base64url')+'!aA7';
    const hash=require('../src/utils/password').hashPassword(password);
    await db.prepare('UPDATE users SET password_hash=?,failed_attempts=0,locked_until=NULL,must_change_password=FALSE').run(hash);
    await db.prepare("INSERT INTO users(id,email,password_hash,full_name,status) VALUES('s602-panel','s602-panel@example.invalid',?,'Synthetic panel','ACTIVE')").run(hash);
    await db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT 's602-panel',id FROM roles WHERE code='INTERVIEWER'").run();
    const base='http://127.0.0.1:'+server.address().port;
    const api=async (method,route,token,body) => {
      const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json()};
    };
    const sessions={};
    for(const [name,id] of [['admin','usr-admin'],['hr','usr-hr-mgr'],['primary','usr-interviewer'],['panel','s602-panel']]) {
      const user=await db.prepare('SELECT email FROM users WHERE id=?').get(id);
      const login=await api('POST','/api/v1/auth/login',null,{email:user.email,password});
      assert.equal(login.status,200);sessions[name]=login.data.data.token;
    }
    const payload={candidateId:'cand-001',requisitionId:'req-001',interviewerIds:['usr-interviewer','s602-panel'],roundName:'Synthetic HTTP scheduling',scheduledTime:'2032-06-01T09:00',durationMinutes:45,interviewFormat:'ONLINE',meetingLink:'https://example.invalid/meeting'};
    const before=await db.prepare('SELECT * FROM interviews ORDER BY id').all();
    assert.equal((await api('POST','/api/v1/interviews',null,payload)).status,401);
    assert.deepEqual(await db.prepare('SELECT * FROM interviews ORDER BY id').all(),before);
    passed++;console.log('PASS HTTP authentication before mutation');
    const created=await api('POST','/api/v1/interviews',sessions.admin,payload);
    assert.equal(created.status,201);
    const id=created.data.id;
    assert.ok(id);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interview_interviewers WHERE interview_id=?').get(id)).n,2);
    passed++;console.log('PASS HTTP new panel schedule persists all assignments');
    const saved=await db.prepare('SELECT * FROM interviews WHERE id=?').get(id);
    assert.equal((await api('PUT','/api/v1/interviews/'+id+'/status',sessions.panel,{status:'COMPLETED',score:1,feedback:'denied'})).status,403);
    assert.equal((await api('PUT','/interviews/'+id+'/status',sessions.panel,{status:'COMPLETED',score:1,feedback:'denied'})).status,403);
    assert.deepEqual(await db.prepare('SELECT * FROM interviews WHERE id=?').get(id),saved);
    passed++;console.log('PASS both HTTP aliases deny co-interviewer shared evaluation without writes');
    for(const route of ['/api/v1/interviews','/interviews']) {
      const list=await api('GET',route,sessions.panel);
      assert.equal(list.status,200);
      const row=list.data.interviews.find(item => item.id===id);
      assert.ok(row);assert.equal(row.score,null);assert.equal(row.feedback,null);
      assert.equal(Object.hasOwn(row.candidate,'email'),false);
      assert.equal(Object.hasOwn(row.candidate,'phone'),false);
    }
    assert.equal((await api('GET','/api/v1/candidates/cand-001',sessions.panel)).status,403);
    passed++;console.log('PASS calendar aliases use minimal projection without expanding candidate detail');
    assert.equal((await api('PUT','/api/v1/interviews/missing-s602/status',sessions.primary,{status:'COMPLETED',score:5})).status,404);
    passed++;console.log('PASS HTTP missing interview remains 404');
    for(const name of ['primary','hr','admin']) {
      assert.equal((await api('PUT','/api/v1/interviews/'+id+'/status',sessions[name],{status:'COMPLETED',score:9,feedback:name})).status,200);
      const row=await db.prepare('SELECT score,feedback FROM interviews WHERE id=?').get(id);
      assert.equal(row.score,9);assert.equal(row.feedback,name);
    }
    passed++;console.log('PASS primary HR and Admin retain shared evaluation and score scale');
    await db.prepare("UPDATE interviews SET status='SCHEDULED' WHERE id=?").run(id);
    const count=(await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n;
    assert.equal((await api('POST','/api/v1/interviews',sessions.admin,payload)).status,409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,count);
    passed++;console.log('PASS HTTP conflict is 409 without duplicate mutation');
    await db.prepare("DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE code='INTERVIEWER') AND permission_id=(SELECT id FROM permissions WHERE code='interview.read')").run();
    assert.equal((await api('GET','/api/v1/interviews',sessions.panel)).status,403);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,count);
    passed++;console.log('PASS HTTP revoked grant applies on next request');
    console.log(JSON.stringify({httpGroupsPassed:passed,httpGroupsFailed:0}));
  } finally {server.closeAllConnections();await new Promise(resolve => server.close(resolve));await db.close();}
}

main().catch(error => {console.error(error);process.exitCode=1;});
