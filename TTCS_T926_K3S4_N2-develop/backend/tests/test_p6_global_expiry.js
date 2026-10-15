const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Use an isolated source export');
assert.equal(fs.existsSync(path.join(root, '.env')), false, 'Use an isolated source export');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_PROVIDER, 'sqlite');
const Portal = require('../src/services/candidatePortalService');
const Controller = require('../src/controllers/candidatePortalController');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
async function run(db, provider, peer = null) {
  const boolean = provider === 'SQLite' ? 'INTEGER' : 'BOOLEAN';
  const bool = value => provider === 'SQLite' ? Number(value) : value;
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${boolean},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE job_postings(id TEXT PRIMARY KEY,title TEXT,status TEXT,version INTEGER NOT NULL,content_version INTEGER NOT NULL,application_deadline DATE,updated_at TEXT);
    CREATE TABLE job_posting_publication_events(id TEXT PRIMARY KEY,posting_id TEXT REFERENCES job_postings(id),event_version INTEGER,content_version INTEGER,action TEXT,before_status TEXT,after_status TEXT,actor_id TEXT,actor_name TEXT,reason TEXT,response_json TEXT,created_at TEXT,UNIQUE(posting_id,event_version));
    CREATE TABLE candidates(id TEXT PRIMARY KEY,stage TEXT);
    CREATE TABLE applications(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,status TEXT);
  `);
  const actors = {admin:['ADMIN'],hr:['HR_MANAGER'],recruiter:['RECRUITER'],hiring:['HIRING_MGR'],approver:['APPROVER'],interviewer:['INTERVIEWER'],candidate:['CANDIDATE'],mixed:['RECRUITER','HR_MANAGER'],narrow:['RECRUITER','APPROVER']};
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('manage','job_posting.manage');
  for (const role of new Set(Object.values(actors).flat())) {
    await db.prepare('INSERT INTO roles VALUES (?,?)').run(role,role);
    if (role !== 'ADMIN') await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role,'manage');
  }
  for (const [id,roles] of Object.entries(actors)) {
    await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id+'@example.test','Verified '+id,'ACTIVE',bool(false),null);
    for (const role of roles) await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id,role);
  }
  await db.exec("INSERT INTO candidates VALUES ('candidate-data','NEW'); INSERT INTO applications VALUES ('application-data','RECEIVED'); INSERT INTO requisitions VALUES ('req-data','OPEN');");
  const service = new Portal(db),raw=db.prepare.bind(db),transaction=db.transaction.bind(db);
  service.requisitions.businessDate=()=> '2026-10-14';
  const actor = id => id === null ? null : {id,roles:['ADMIN'],status:'ACTIVE',fullName:'Forged',trusted:true};
  let state={},active=false;
  db.transaction=action=>transaction(async()=>{active=true;try{return await action();}finally{active=false;}});
  db.prepare=sql=>{
    const stmt=raw(sql);
    if (sql.includes('UPDATE job_postings SET') || sql.includes('INSERT INTO job_posting_publication_events')) {
      const run=stmt.run.bind(stmt);stmt.run=async(...args)=>{
        assert.equal(active,true,'Mutation and audit must be inside transaction');state.writes++;
        const result=await run(...args);
        if(sql.includes('INSERT INTO job_posting_publication_events')) {state.events++;if(state.failEvent===state.events)throw Error('P6_INJECTED_AUDIT_FAILURE');}
        if(sql.includes('UPDATE job_postings SET')&&state.failUpdate)throw Error('P6_INJECTED_UPDATE_FAILURE');
        return result;
      };
    }
    if (sql.includes('FROM job_postings')&&sql.includes('ORDER BY id')) {
      const all=stmt.all.bind(stmt);stmt.all=async(...args)=>{const rows=await all(...args);if(state.afterLock)await state.afterLock(rows);return rows;};
    }
    return stmt;
  };
  const snapshot=async()=>({jobs:await raw('SELECT * FROM job_postings ORDER BY id').all(),events:await raw('SELECT * FROM job_posting_publication_events ORDER BY id').all(),candidates:await raw('SELECT * FROM candidates').all(),applications:await raw('SELECT * FROM applications').all(),reqs:await raw('SELECT * FROM requisitions').all()});
  const reset=async()=>{
    state={writes:0,events:0};await raw('DELETE FROM job_posting_publication_events').run();await raw('DELETE FROM job_postings').run();
    for(const [id,status,date] of [['overdue-a','PUBLISHED','2026-10-13'],['overdue-b','PUBLISHED','2026-02-28'],['today','PUBLISHED','2026-10-14'],['future','PUBLISHED','2026-10-15'],['null-date','PUBLISHED',null],...['DRAFT','APPROVED','PENDING_APPROVAL','REJECTED','PAUSED','UNPUBLISHED'].map(s=>[s,s,'2020-01-01'])])await raw('INSERT INTO job_postings(id,title,status,version,content_version,application_deadline) VALUES (?,?,?,?,?,?)').run(id,'Title '+id,status,7,3,date);
  };
  const check=async(name,fn)=>test(provider+' '+name,async()=>{await reset();await fn();});
  const denied=async(user)=>{const before=await snapshot(),result=await service.expireOverdueJobs(user);assert.equal(result.statusCode,403);assert.equal(result.code,'GLOBAL_JOB_EXPIRY_FORBIDDEN');assert.equal(state.writes,0);assert.deepEqual(await snapshot(),before);};
  try {
    for(const id of ['admin','hr','mixed']) await check(id+' authorized, exact DTO and immutable actors',async()=>{
      const before=await snapshot(),result=await service.expireOverdueJobs(actor(id));
      assert.deepEqual(result,{expiredCount:2,expiredJobs:[{id:'overdue-a',title:'Title overdue-a'},{id:'overdue-b',title:'Title overdue-b'}]});
      const after=await snapshot();assert.deepEqual(after.jobs.filter(j=>!j.id.startsWith('overdue-')),before.jobs.filter(j=>!j.id.startsWith('overdue-')));
      for(const job of after.jobs.filter(j=>j.id.startsWith('overdue-'))){assert.equal(job.status,'UNPUBLISHED');assert.equal(job.version,8);assert.ok(job.updated_at);}
      assert.equal(after.events.length,2);for(const e of after.events){assert.equal(e.actor_id,id);assert.equal(e.actor_name,'Verified '+id);assert.equal(e.content_version,3);assert.equal(e.event_version,8);assert.equal(e.action,'AUTO_EXPIRE');assert.equal(e.before_status,'PUBLISHED');assert.equal(e.after_status,'UNPUBLISHED');assert.ok(e.created_at);assert.equal(JSON.parse(e.response_json).id,e.posting_id);}
      for(const key of ['candidates','applications','reqs'])assert.deepEqual(after[key],before[key]);
    });
    for(const id of ['recruiter','hiring','approver','interviewer','candidate','narrow','missing',null])await check(String(id)+' denied despite spoofed ADMIN/system flags',()=>denied(actor(id)));
    await check('actor without id denied',()=>denied({roles:['ADMIN'],isSystem:true}));
    await check('actor object id rejected',()=>denied({id:{toString:()=> 'admin'},roles:['ADMIN']}));
    await check('LOCKED account denied',async()=>{await raw("UPDATE users SET status='LOCKED' WHERE id='hr'").run();try{await denied(actor('hr'));}finally{await raw("UPDATE users SET status='ACTIVE' WHERE id='hr'").run();}});
    await check('temporarily locked account denied',async()=>{await raw("UPDATE users SET locked_until='2999-01-01' WHERE id='admin'").run();try{await denied(actor('admin'));}finally{await raw("UPDATE users SET locked_until=NULL WHERE id='admin'").run();}});
    await check('password reset required denied',async()=>{await raw('UPDATE users SET must_change_password=? WHERE id=?').run(bool(true),'admin');try{await denied(actor('admin'));}finally{await raw('UPDATE users SET must_change_password=? WHERE id=?').run(bool(false),'admin');}});
    await check('HR grant revoked denied',async()=>{await raw("DELETE FROM role_permissions WHERE role_id='HR_MANAGER'").run();try{await denied(actor('hr'));}finally{await raw("INSERT INTO role_permissions VALUES ('HR_MANAGER','manage')").run();}});
    await check('HR role revoked, recruiter grant cannot bypass',async()=>{await raw("DELETE FROM user_roles WHERE user_id='mixed' AND role_id='HR_MANAGER'").run();try{await denied(actor('mixed'));}finally{await raw("INSERT INTO user_roles VALUES ('mixed','HR_MANAGER')").run();}});
    await check('ADMIN role revoked denied',async()=>{await raw("DELETE FROM user_roles WHERE user_id='admin'").run();try{await denied(actor('admin'));}finally{await raw("INSERT INTO user_roles VALUES ('admin','ADMIN')").run();}});
    await check('repeated expiry is exact no-op, no duplicate audit',async()=>{await service.expireOverdueJobs(actor('admin'));const before=await snapshot();assert.deepEqual(await service.expireOverdueJobs(actor('hr')),{expiredCount:0,expiredJobs:[]});assert.deepEqual(await snapshot(),before);});
    await check('deadline today remains valid',async()=>{await service.expireOverdueJobs(actor('admin'));assert.equal((await raw("SELECT status FROM job_postings WHERE id='today'").get()).status,'PUBLISHED');});
    await check('business-date helper and leap day boundary',async()=>{await raw("UPDATE job_postings SET application_deadline='2028-02-29' WHERE id='overdue-a'").run();await raw("UPDATE job_postings SET application_deadline='2028-03-01' WHERE id='overdue-b'").run();service.requisitions.businessDate=()=> '2028-02-29';try{const first=await service.expireOverdueJobs(actor('admin'));assert.equal(first.expiredJobs.some(j=>j.id==='overdue-a'||j.id==='overdue-b'),false);service.requisitions.businessDate=()=> '2028-03-01';assert.deepEqual((await service.expireOverdueJobs(actor('admin'))).expiredJobs,[{id:'overdue-a',title:'Title overdue-a'}]);}finally{service.requisitions.businessDate=()=> '2026-10-14';}});
    await check('conditional update skips changed status, version and deadline',async()=>{state.afterLock=async()=>{await raw("UPDATE job_postings SET application_deadline='2026-10-14' WHERE id='overdue-a'").run();await raw("UPDATE job_postings SET version=9 WHERE id='overdue-b'").run();};assert.deepEqual(await service.expireOverdueJobs(actor('admin')),{expiredCount:0,expiredJobs:[]});assert.equal((await raw('SELECT count(*) AS n FROM job_posting_publication_events').get()).n,0);});
    for(const event of [1,2])await check('audit failure '+event+' rolls back all updates and events',async()=>{const before=await snapshot();state.failEvent=event;await assert.rejects(()=>service.expireOverdueJobs(actor('admin')),/P6_INJECTED_AUDIT_FAILURE/);assert.deepEqual(await snapshot(),before);});
    await check('update failure rolls back',async()=>{const before=await snapshot();state.failUpdate=true;await assert.rejects(()=>service.expireOverdueJobs(actor('admin')),/P6_INJECTED_UPDATE_FAILURE/);assert.deepEqual(await snapshot(),before);});
    if(provider==='SQLite'||peer)await check('two simultaneous callers expire each posting once',async()=>{
      const second=peer?new Portal(peer):service;second.requisitions.businessDate=()=> '2026-10-14';
      const results=await Promise.all([service.expireOverdueJobs(actor('admin')),second.expireOverdueJobs(actor('hr'))]);
      assert.equal(results.reduce((n,r)=>n+r.expiredCount,0),2);assert.equal((await raw('SELECT count(*) AS n FROM job_posting_publication_events').get()).n,2);
      assert.deepEqual((await raw("SELECT version FROM job_postings WHERE id LIKE 'overdue-%'").all()).map(r=>r.version),[8,8]);
    });
    if(peer) {
      for(const [name,sql]of [['status change',"UPDATE job_postings SET status='UNPUBLISHED',version=version+1 WHERE id='overdue-a'"],['grant revocation',"DELETE FROM role_permissions WHERE role_id='HR_MANAGER'"]])await check('native independent connection '+name+' waits for expiry commit',async()=>{
        let pending;state.afterLock=async()=>{let done=false;pending=peer.prepare(sql).run();pending.then(()=>done=true);await new Promise(r=>setTimeout(r,120));assert.equal(done,false);};
        try{assert.equal((await service.expireOverdueJobs(actor('hr'))).expiredCount,2);await pending;assert.equal((await raw('SELECT count(*) AS n FROM job_posting_publication_events').get()).n,2);}finally{if(name==='grant revocation')await raw("INSERT INTO role_permissions VALUES ('HR_MANAGER','manage')").run();}
      });
      await check('native independent grant revocation committed first denies',async()=>{await peer.prepare("DELETE FROM role_permissions WHERE role_id='HR_MANAGER'").run();try{await denied(actor('hr'));}finally{await raw("INSERT INTO role_permissions VALUES ('HR_MANAGER','manage')").run();}});
    }
    if(provider==='SQLite')await httpTests(service,reset,snapshot,actor);
  } finally {db.prepare=raw;db.transaction=transaction;}
}
async function httpTests(service,reset,snapshot,actor) {
  const auth={validateSession:async token=>({valid:true,user:actor(token)})};
  let called=0;const expire=service.expireOverdueJobs.bind(service);service.expireOverdueJobs=async user=>{called++;return expire(user);};
  const controller=new Controller(service,service.rbac,auth);
  const server=http.createServer((req,res)=>service.db.withConnection(()=>controller.handle(req,res,new URL(req.url,'http://localhost'),async()=>{throw Error('Expiry must not trust request body');})).catch(()=>{res.writeHead(500);res.end();}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v1/admin/expire-overdue-jobs';
  const request=(id,extra={})=>fetch(base+'?role=ADMIN&trusted=true',{method:'POST',headers:{...(id?{Authorization:'Bearer '+id}:{}),'Content-Type':'application/json','X-System':'true',...extra},body:JSON.stringify({roles:['ADMIN'],isSystem:true,actor:{id:'admin'}})});
  try {
    for(const id of [null,'recruiter','hiring','approver','interviewer','candidate','missing'])await test('HTTP '+id+' cannot bypass',async()=>{await reset();const before=await snapshot(),n=called,r=await request(id);assert.equal(r.status,id?403:401);assert.equal((await r.json()).success,false);assert.equal(called,n,'HTTP boundary denies before service');assert.deepEqual(await snapshot(),before);});
    for(const id of ['admin','hr'])await test('HTTP '+id+' returns original success contract',async()=>{await reset();const r=await request(id);assert.equal(r.status,200);const data=await r.json();assert.deepEqual(Object.keys(data).sort(),['data','success']);assert.equal(data.success,true);assert.equal(data.data.expiredCount,2);});
    await test('HTTP service revocation after boundary is rejected',async()=>{await reset();service.expireOverdueJobs=async()=>({success:false,statusCode:403,code:'GLOBAL_JOB_EXPIRY_FORBIDDEN'});try{const before=await snapshot(),r=await request('admin');assert.equal(r.status,403);assert.deepEqual(await snapshot(),before);}finally{service.expireOverdueJobs=expire;}});
    await test('HTTP authorization database failure sanitized',async()=>{await reset();const get=service.rbac.getAuthorizedActor;service.rbac.getAuthorizedActor=async()=>{throw Error('secret-SQL-path');};try{const r=await request('admin');assert.equal(r.status,500);const text=await r.text();assert.equal(text.includes('secret'),false);assert.equal(text.includes('SQL'),false);}finally{service.rbac.getAuthorizedActor=get;}});
    await test('HTTP transaction failure sanitized',async()=>{await reset();service.expireOverdueJobs=async()=>{throw Error('secret-path-SQL');};try{const r=await request('admin');assert.equal(r.status,500);const text=await r.text();assert.equal(text.includes('secret-path'),false);assert.equal(text.includes('SQL'),false);assert.equal(JSON.parse(text).code,'GLOBAL_JOB_EXPIRY_FAILED');}finally{service.expireOverdueJobs=expire;}});
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));service.expireOverdueJobs=expire;}
}
async function main() {
  const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));
  try{await run(sqlite,'SQLite');}finally{sqlite.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};
  const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});
  try{await run(pg,'PGlite');}finally{await pg.close();}
  if(process.env.ATS_P6_PG_URL){const url=new URL(process.env.ATS_P6_PG_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/ats_p6_test(?:_[a-z0-9]+)?$/);const live=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'}),peer=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});try{await run(live,'PostgreSQL',peer);}finally{await peer.close();await live.close();}}
  console.log('P6_RESULT '+JSON.stringify({passed,failed:0,livePostgres:Boolean(process.env.ATS_P6_PG_URL)}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
