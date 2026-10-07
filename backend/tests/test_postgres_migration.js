const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
for (const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-wal','backend/data/ats.db-shm','backend/data/ats_test.db']) {
  assert.equal(fs.existsSync(path.join(root,file)),false,'Isolated TEMP copy required');
}
process.env.NODE_ENV='test';process.env.EMAIL_MODE='simulated';process.env.DB_PROVIDER='sqlite';
const {PostgresDatabase,postgresSQL,pgTypes}=require('../src/db/postgres');
const {migrate,verifyMigration}=require('../src/db/migrate-postgres');
const {TABLES,plan,importRows,utc}=require('../src/db/import-sqlite');
let passed=0,failed=0;
async function test(name,action){try{await action();passed++;console.log('[PASS] '+name);}catch(error){failed++;console.error('[FAIL] '+name+'\n'+error.stack);}}
function fakePool(){const calls=[],clients=[];return {calls,clients,on(){},async query(sql,params){calls.push({client:'pool',sql,params});return {rows:[{n:1}],rowCount:1};},async connect(){const id=clients.length;const client={id,released:false,async query(sql,params){calls.push({client:id,sql,params});return {rows:[{n:1}],rowCount:1};},release(){client.released=true;}};clients.push(client);return client;},async end(){}};}
async function main(){
 await test('SQL placeholders ignore quoted strings, identifiers, comments and dollar literals',async()=>{
  const sql=postgresSQL("SELECT '?', \"?\", $$?;$$, ? -- ?\n/* ? */ WHERE id=?");
  assert.equal(sql,"SELECT '?', \"?\", $$?;$$, $1 -- ?\n/* ? */ WHERE id=$2");
 });
 await test('SQL dialect converts each IGNORE insert, UTC time, CI equality/sort and search',async()=>{
  const sql=postgresSQL("INSERT OR IGNORE INTO roles(id) VALUES (?); INSERT OR IGNORE INTO users(id) VALUES (?);");
  assert.equal((sql.match(/ON CONFLICT DO NOTHING/g)||[]).length,2);
  assert.match(postgresSQL("SELECT rowid FROM login_audit_logs WHERE email = ? COLLATE NOCASE AND datetime(expires_at)>datetime('now') ORDER BY name COLLATE NOCASE"),/sequence_id.*lower\(email\).*expires_at>CURRENT_TIMESTAMP.*lower\(name\)/);
  assert.equal(postgresSQL("SELECT 'LIKE rowid ?' WHERE name LIKE ?"),"SELECT 'LIKE rowid ?' WHERE name ILIKE $1");
  assert.throws(()=>postgresSQL('PRAGMA foreign_keys'),/NOT_SUPPORTED/);
 });
 await test('Terminal calls are promises and bind values without SQL interpolation',async()=>{
  const pool=fakePool(),db=new PostgresDatabase({},pool),injection="x' OR 1=1--";
  const pending=db.prepare('SELECT n WHERE email=?').get(injection);assert.ok(pending instanceof Promise);await pending;
  assert.equal(pool.calls[0].sql,'SELECT n WHERE lower(email) = lower($1)');assert.deepEqual(pool.calls[0].params,[injection]);
 });
 await test('Concurrent transactions isolate checked-out clients, including nested SAVEPOINT',async()=>{
  const pool=fakePool(),db=new PostgresDatabase({},pool);
  await Promise.all(['A','B'].map(label=>db.transaction(async()=>{await db.prepare('SELECT ?').get(label);await db.exec('SAVEPOINT role_update');await db.prepare('SELECT ?').get(label);await db.exec('RELEASE SAVEPOINT role_update');})));
  assert.equal(pool.calls.some(c=>c.client==='pool'),false);assert.equal(pool.clients.length,2);
  for(const client of pool.clients){const calls=pool.calls.filter(c=>c.client===client.id);assert.equal(calls[0].sql,'BEGIN');assert.equal(calls.at(-1).sql,'COMMIT');assert.equal(new Set(calls.filter(c=>c.params).map(c=>c.params[0])).size,1);assert.equal(client.released,true);}
 });
 await test('Failure rolls back; post-commit actions run after release and never after rollback',async()=>{
  const pool=fakePool(),db=new PostgresDatabase({},pool);let delivered=0;
  await assert.rejects(db.transaction(async()=>{db.afterCommit(()=>{delivered++;});throw new Error('row failure');}),/row failure/);
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');assert.equal(delivered,0);
  await db.transaction(async()=>{db.afterCommit(()=>{assert.equal(pool.clients.at(-1).released,true);delivered++;});});assert.equal(delivered,1);
 });
 await test('Dates and system UTC normalization do not depend on host timezone',async()=>{
  assert.equal(pgTypes().getTypeParser(1082)('2026-10-07'),'2026-10-07');
  assert.equal(utc('2026-10-07 10:08:58'),'2026-10-07T10:08:58.000Z');
  assert.equal(utc('2026-10-07T17:08:58+07:00'),'2026-10-07T10:08:58.000Z');
  assert.equal(pgTypes().getTypeParser(1184)('2026-10-07 10:08:58+00'),'2026-10-07T10:08:58.000Z');
 });
 await test('Import plans exact matches, preserves ambiguous labels and requires explicit decision',async()=>{
  const data=Object.fromEntries(TABLES.map(t=>[t,[]]));data.departments=[{id:'dept-real',name:'Canonical Name'}];
  data.users=[{id:'a',email:'Mixed@Example.com',department_id:'dept-auto',department_name:'Canonical Name'},{id:'b',email:'b@example.com',department_id:'dept-auto',department_name:'Ambiguous Name'},{id:'c',email:'c@example.com',department_id:'dept-ext',department_name:'Public'}];
  data.login_audit_logs=[{id:'a',source_order:7,attempted_at:'2026-10-07 10:08:58'},{id:'b',source_order:8,attempted_at:'2026-10-07 10:08:58'}];
  data.interviews=[{id:'i',scheduled_time:'2026-10-07T17:08'}];
  const prepared=plan(data);assert.equal(prepared.ready,false);assert.equal(prepared.rows.users[0].department_id,'dept-real');assert.equal(prepared.rows.users[0].email,'mixed@example.com');assert.equal(prepared.rows.users[2].department_id,null);
  assert.deepEqual(prepared.rows.login_audit_logs.map(r=>r.sequence_id),[7,8]);assert.equal(prepared.rows.interviews[0].scheduled_time,'2026-10-07T17:08');
  assert.equal(plan(data,{'b':'dept-real'}).ready,true);assert.equal(plan(data,{},true).rows.users[1].department_id,null);assert.equal(data.users[0].department_id,'dept-auto');
 });

 // Real PostgreSQL SQL engine in memory, no network/Neon/credential. It is not pg-wire live verification.
 const {PGlite}=require('@electric-sql/pglite');const engine=new PGlite();await engine.exec('SET TIME ZONE UTC');
 let tail=Promise.resolve();
 const query=async(sql,params)=>{
  const raw=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);
  const rows=(raw?.rows||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,
    value instanceof Date ? (raw.fields.find(field=>field.name===key)?.dataTypeID===1082 ? value.toISOString().slice(0,10) : value.toISOString()) : typeof value==='bigint'?Number(value):value])));
  return {rows,rowCount:raw?.affectedRows||rows.length};
 };
 const pool={on(){},query,async connect(){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query,release};},async end(){await engine.close();}};
 const db=new PostgresDatabase({},pool);
 try{
  await test('Authoritative migration executes in embedded PostgreSQL and is idempotent',async()=>{
   await migrate(db);await migrate(db);await verifyMigration(db);
   const actual=await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'ats_schema_migrations'").all();assert.deepEqual(actual.map(r=>r.tablename).sort(),[...TABLES].sort());
  });
  await test('PostgreSQL types match bool/date/timestamptz/text contracts',async()=>{
   const rows=await db.prepare("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'").all();
   const type=(t,c)=>rows.find(r=>r.table_name===t&&r.column_name===c).data_type;
   assert.equal(type('users','must_change_password'),'boolean');assert.equal(type('requisitions','handover_required'),'boolean');assert.equal(type('requisitions','s210_version'),'integer');assert.equal(type('career_page_settings','id'),'integer');
   assert.equal(type('offers','start_date'),'date');assert.equal(type('requisitions','needed_date'),'date');assert.equal(type('sessions','expires_at'),'timestamp with time zone');assert.equal(type('interviews','scheduled_time'),'text');
  });
  await test('Actual import preserves cyclic FK, password hash, audit ordering and mixed interview time; refuses overwrite',async()=>{
   await db.exec('CREATE SCHEMA import_sandbox');await db.exec('SET search_path TO import_sandbox');
   try{
    await migrate(db);
    const data=Object.fromEntries(TABLES.map(table=>[table,[]]));
    data.users=[{id:'imported-user',email:'Imported@Example.com',full_name:'Imported user',password_hash:'preserved-hash',department_id:'orphan',department_name:'Canonical Import',created_at:'2026-10-07 10:08:58'}];
    data.departments=[{id:'imported-department',code:'IMPORT',name:'Canonical Import',manager_id:'imported-user'}];
    data.login_audit_logs=[7,8].map(n=>({id:'audit-'+n,email:'imported@example.com',status:'FAILURE',reason:'LOGIN_INVALID_CREDENTIALS',attempted_at:'2026-10-07 10:08:58',source_order:n}));
    data.interviews=[{id:'imported-interview',interviewer_id:'imported-user',scheduled_time:'2026-10-07T17:08'}];
    const prepared=plan(data);assert.equal(prepared.ready,true);await importRows(db,prepared);
    const user=await db.prepare('SELECT * FROM users WHERE id=?').get('imported-user');assert.equal(user.department_id,'imported-department');assert.equal(user.password_hash,'preserved-hash');assert.equal(user.created_at,'2026-10-07T10:08:58.000Z');
    assert.equal((await db.prepare('SELECT scheduled_time FROM interviews WHERE id=?').get('imported-interview')).scheduled_time,'2026-10-07T17:08');
    await db.prepare("INSERT INTO login_audit_logs(id,email,status) VALUES ('future-audit','imported@example.com','FAILURE')").run();
    assert.deepEqual((await db.prepare('SELECT sequence_id FROM login_audit_logs ORDER BY sequence_id').all()).map(row=>row.sequence_id),[7,8,9]);
    await assert.rejects(importRows(db,prepared),/IMPORT_REQUIRES_EMPTY_DATABASE/);
   }finally{await db.exec('SET search_path TO public');await db.exec('DROP SCHEMA import_sandbox CASCADE');}
  });
  await test('Application seed runs through async PostgreSQL, including circular department dependencies',async()=>{
   await db.transaction(()=>require('../src/db/seed').seedDatabase(db));
   assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n),25);
   assert.equal((await db.prepare("SELECT department_id FROM users WHERE id='usr-candidate'").get()).department_id,null);
  });
  await test('Case insensitive email constraint and lookup are enforced by PostgreSQL',async()=>{
   const found=await db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get('ADMIN@COMPANY.COM');assert.equal(found.id,'usr-admin');
   await assert.rejects(db.prepare("INSERT INTO users(id,email,password_hash,full_name) VALUES ('case-clash','ADMIN@COMPANY.COM','x','x')").run(),error=>error.code==='23505');
  });
  await test('Async auth preserves login roles, unknown counter ordering and UTC semantics on PostgreSQL',async()=>{
   const auth=new (require('../src/services/authService'))(db);const session=await auth.login('ADMIN@company.com','Ats@123456');assert.equal(session.success,true);assert.equal(session.data.user.defaultHome,'/admin');
   for(let i=0;i<4;i++)assert.equal((await auth.login('pg-missing@example.com','wrong')).remainingAttempts,4-i);
   assert.equal((await auth.login('pg-missing@example.com','wrong')).statusCode,423);
   const logs=await db.prepare("SELECT sequence_id FROM login_audit_logs WHERE email='pg-missing@example.com' ORDER BY sequence_id").all();assert.equal(new Set(logs.map(r=>r.sequence_id)).size,5);
  });
  await test('PostgreSQL department contracts, multi-role readback and forced password state persist',async()=>{
   const users=new (require('../src/services/userService'))(db),department=await db.prepare("SELECT id,name FROM departments WHERE id='dept-3'").get();
   const created=await users.createUser({fullName:'PG User',email:'PG.NEW@example.com',departmentId:department.id,departmentName:'forged',roleCode:'INTERVIEWER'});
   assert.equal(created.success,true);assert.equal(created.data.user.departmentName,department.name);
   const auth=new (require('../src/services/authService'))(db),session=await auth.login(created.data.user.email,created.data.temporaryPassword);assert.equal(session.data.user.mustChangePassword,true);
   assert.equal((await auth.validateSession(session.data.token)).code,'MUST_CHANGE_PASSWORD');
   const assigned=await users.assignUserRoles(created.data.user.id,['RECRUITER','HIRING_MGR','INTERVIEWER'],{id:'usr-admin',roles:['ADMIN']});assert.equal(assigned.success,true);
   assert.deepEqual((await users.getUserById(created.data.user.id)).roles.sort(),['HIRING_MGR','INTERVIEWER','RECRUITER']);
   const changed=await auth.changePassword(session.data.token,created.data.temporaryPassword,'Permanent@123');assert.equal(changed.success,true);
   assert.equal((await auth.login(created.data.user.email,'Permanent@123')).data.user.mustChangePassword,false);
  });
  await test('Real PostgreSQL framework shared readback, catalogs and requisition dates/salary validation',async()=>{
   const competency=new (require('../src/services/competencyService'))(db);
   const framework=await competency.createFramework({code:'PG-FRAMEWORK',name:'PG Framework',criteria:[{name:'PG Criterion',weight:100}]});assert.equal(framework.success,true);
   const a=await competency.createJobTitle({code:'PG-A',name:'PG A',level:'Senior',frameworkId:framework.data.id,minSalary:100,maxSalary:200},{includeSalary:true});
   const b=await competency.createJobTitle({code:'PG-B',name:'PG B',level:'Senior',minSalary:100,maxSalary:200,frameworkId:framework.data.id},{includeSalary:true});assert.equal(a.success,true);assert.equal(b.success,true);
   assert.equal((await competency.getFrameworkForJobTitle(a.data.id)).data.framework.id,framework.data.id);assert.equal((await competency.getFrameworkForJobTitle(b.data.id)).data.framework.id,framework.data.id);
   await db.prepare('UPDATE job_titles SET min_salary=NULL,max_salary=NULL WHERE id=?').run(b.data.id);
   const catalog=new (require('../src/services/recruitmentCatalogService'))(db);const item=await catalog.createItem({type:'WORK_MODE',code:'PG-HYBRID',name:'Hybrid'});assert.equal(item.success,true);assert.ok((await catalog.getItems('WORK_MODE')).items.length>0);
   const requisitions=new (require('../src/services/requisitionService'))(db),actor={id:'usr-hr-mgr',roles:['HR_MANAGER']};
   const data={status:'OPEN',jobTitleId:a.data.id,departmentId:'dept-3',headcount:1,recruitmentReason:'REPLACEMENT',proposedSalaryMin:110,proposedSalaryMax:190,neededDate:requisitions.businessDate(),jobDescription:'PG description',candidateRequirements:'PG requirements'};
   const request=await requisitions.createRequisition(data,actor);assert.equal(request.success,true);assert.equal(request.data.neededDate,data.neededDate);
   assert.equal((await requisitions.createRequisition({...data,proposedSalaryMax:300},actor)).success,false);
   const draft=await requisitions.createRequisition({status:'DRAFT',jobTitleId:b.data.id},actor);assert.equal(draft.success,true);
   const unavailable=await requisitions.updateRequisition(draft.data.id,{...data,jobTitleId:b.data.id},actor);assert.equal(unavailable.statusCode,409);assert.equal(unavailable.code,'JOB_TITLE_SALARY_RANGE_UNAVAILABLE');
   assert.equal((await requisitions.getRequisitions({})).success,true);
  });
 }finally{await db.close();}
 console.log('POSTGRES_MIGRATION_RESULT '+JSON.stringify({passed,failed,total:passed+failed,engine:'embedded PostgreSQL; no live pg-wire/Neon'}));process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
