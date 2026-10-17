const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
assert.equal(fs.existsSync(path.join(root,'.git')),false,'Run in isolated TEMP copy');
assert.equal(fs.existsSync(path.join(root,'.env')),false,'Never use local credentials');
const source=fs.readFileSync(path.join(root,'backend/src/db/migrate-postgres.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'backend/src/db/migrations/001_postgres.sql'),'utf8').replace(/\r\n/g,'\n');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
let passed=0,failed=0;
async function test(name,action){try{await action();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}
function verifier(text){
 const module={exports:{}};
 const context={module,__dirname:path.join(root,'backend/src/db'),require:name=>name==='node:fs'?{readFileSync(){return text;}}:require(name),process,console};
 vm.runInNewContext(source,context);return module.exports;
}
function reader(row,error){return {prepare(sql){assert.equal(sql,'SELECT checksum FROM ats_schema_migrations WHERE version=?');return {async get(version){assert.equal(version,1);if(error)throw error;return row;}};}};}
async function startupCases(){
 const config=require('../src/config/config');config.DB_PROVIDER='postgres';config.EMAIL_MODE='simulated';
 const {PGlite}=require('@electric-sql/pglite'),{PostgresDatabase,postgresSQL}=require('../src/db/postgres'),database=require('../src/db/database');
 const engine=new PGlite(),original=database.getDatabase,queries=[];
 let recording=false,server;
 const query=async(sql,params)=>{if(recording)queries.push(sql);const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return {rows:result?.rows||[],rowCount:result?.affectedRows||0};};
 const db=new PostgresDatabase({},{on(){},query,async connect(){return {query,release(){}};},async end(){await engine.close();}});
 const mergeMigration=require('../src/db/migrate-candidate-merges');
 const grants=async()=>await db.prepare('SELECT r.code AS role,p.code AS permission FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id ORDER BY r.code,p.code').all();
 try{
  await require('../src/db/migrate-postgres').migrate(db);
  await db.transaction(()=>require('../src/db/seed').seedDatabase(db));
  await require('../src/db/migrate-requisition-open-policy').migrate(db);
  const beforeUsers=await db.prepare('SELECT id,password_hash FROM users ORDER BY id').all(),beforeCandidates=await db.prepare('SELECT id,stage FROM candidates ORDER BY id').all(),beforeGrants=await grants();
  const beforePermissions=(await db.prepare('SELECT code FROM permissions ORDER BY code').all()).map(row=>row.code);
  const mergeSQL=fs.readFileSync(path.join(root,'backend/src/db/migrations/015_candidate_merges_postgres.sql'),'utf8');
  database.getDatabase=()=>db;
  const app=require('../src/server');server=app.server;
  await test('Actual PostgreSQL startup applies only the merge migration in one transaction and reaches HTTP readiness',async()=>{
   recording=true;
   try{await app.startServer(0);}finally{recording=false;}
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/health');assert.equal(response.status,200);assert.equal((await response.json()).status,'ok');
   assert.equal(queries.filter(sql=>sql==='BEGIN').length,1);assert.equal(queries.filter(sql=>sql==='COMMIT').length,1);assert.equal(queries.includes('ROLLBACK'),false);
   const begin=queries.indexOf('BEGIN'),commit=queries.indexOf('COMMIT'),writes=queries.filter(sql=>/^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql));
   assert.equal(writes.length,8);assert.ok(writes.includes(postgresSQL(mergeSQL)));
   for(const sql of writes){assert.ok(queries.indexOf(sql)>begin&&queries.indexOf(sql)<commit);assert.ok(sql===postgresSQL(mergeSQL)||/^CREATE TABLE IF NOT EXISTS ats_candidate_merge_migrations\(/.test(sql)||/^INSERT INTO (ats_candidate_merge_migrations|permissions|role_permissions)\(/.test(sql));}
   await mergeMigration.verify(db);
   assert.equal((await db.prepare('SELECT checksum FROM ats_candidate_merge_migrations WHERE version=1').get()).checksum,digest(mergeSQL.replace(/\r\n/g,'\n')));
   assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='candidates' AND column_name='merged_into_id'").get()).n,1);
   assert.deepEqual(await db.prepare('SELECT id,password_hash FROM users ORDER BY id').all(),beforeUsers);assert.deepEqual(await db.prepare('SELECT id,stage FROM candidates ORDER BY id').all(),beforeCandidates);
   assert.deepEqual((await db.prepare('SELECT code FROM permissions ORDER BY code').all()).map(row=>row.code),[...beforePermissions,'candidate.merge','candidate.merge.undo'].sort());
   const expected=beforeGrants.concat(['ADMIN','HR_MANAGER','RECRUITER'].flatMap(role=>['candidate.merge','candidate.merge.undo'].map(permission=>({role,permission}))));
   const keys=rows=>rows.map(row=>row.role+':'+row.permission).sort();assert.deepEqual(keys(await grants()),keys(expected));
  });
  await test('PostgreSQL merge migration retry preserves ledger data and grants',async()=>{
   const before=await grants(),ledger=await db.prepare('SELECT * FROM ats_candidate_merge_migrations ORDER BY version').all();
   await mergeMigration.migrate(db);
   assert.deepEqual(await grants(),before);assert.deepEqual(await db.prepare('SELECT * FROM ats_candidate_merge_migrations ORDER BY version').all(),ledger);
   assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM candidate_merge_events').get()).n,0);
  });
  await test('PostgreSQL split-phase RBAC pending still rejects startup module reconciliation without changing grants',async()=>{
   await db.exec('CREATE TABLE ats_schema_execution(version INTEGER PRIMARY KEY)');
   const before=await grants(),offset=queries.length;
   recording=true;
   try{await assert.rejects(()=>mergeMigration.migrate(db),/RBAC_RECONCILIATION_PENDING_USE_SCHEMA_EXECUTOR/);}finally{recording=false;}
   assert.deepEqual(await grants(),before);assert.equal(queries.at(-1),'ROLLBACK');assert.equal(queries.slice(offset).some(sql=>/^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)),false);
  });
 }finally{database.getDatabase=original;if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db.close();}
}
async function main(){
 const expected=digest(migration);
 await test('LF checksum matches existing LF ledger',()=>verifier(migration).verifyMigration(reader({checksum:expected})));
 await test('Windows CRLF checksum matches the same existing LF ledger',()=>verifier(migration.replace(/\n/g,'\r\n')).verifyMigration(reader({checksum:expected})));
 await test('Mixed LF/CRLF packaging is normalized without changing content',()=>verifier(migration.replace(/\n/g,(match,offset)=>offset%2?'\r\n':'\n')).verifyMigration(reader({checksum:expected})));
 await test('Actual SQL content drift remains rejected',()=>assert.rejects(verifier(migration.replace('scheduled_time TEXT','scheduled_time TIMESTAMPTZ')).verifyMigration(reader({checksum:expected})),/DATABASE_MIGRATION_REQUIRED/));
 await test('Missing version row remains rejected',()=>assert.rejects(verifier(migration).verifyMigration(reader(undefined)),/DATABASE_MIGRATION_REQUIRED/));
 await test('Missing ledger table remains rejected',()=>assert.rejects(verifier(migration).verifyMigration(reader(undefined,{code:'42P01'})),/DATABASE_MIGRATION_REQUIRED/));
 await test('Unrelated DB/connection errors are propagated rather than treated as migration success',async()=>{
  const error=new Error('connection lost');error.code='ECONNRESET';
  await assert.rejects(verifier(migration).verifyMigration(reader(undefined,error)),actual=>actual===error);
 });
 for(const [label,text] of [['LF',migration],['CRLF',migration.replace(/\n/g,'\r\n')]]){
  await test(label+' new migration writes canonical checksum and idempotent rerun leaves ledger untouched',async()=>{
   let applied,writes=0,ddl=0;const db={async transaction(action){return action();},async exec(sql){if(sql.includes('CREATE TABLE candidates'))ddl++;},prepare(sql){return {
    async get(version){assert.equal(version,1);return applied;},
    async run(version,checksum){assert.equal(version,1);applied={checksum};writes++;}
   };}};
   const module=verifier(text);await module.migrate(db);assert.equal(applied.checksum,expected);assert.equal(writes,1);assert.equal(ddl,1);
   await module.migrate(db);assert.equal(writes,1);assert.equal(ddl,1);
  });
 }
 await test('Existing incompatible ledger is still rejected by migration runner without DDL/write',async()=>{
  let writes=0;const db={async transaction(action){return action();},async exec(sql){assert.ok(!sql.includes('CREATE TABLE candidates'));},prepare(){return {async get(){return {checksum:'different'};},async run(){writes++;}};}};
  await assert.rejects(verifier(migration).migrate(db),/MIGRATION_CHECKSUM_MISMATCH/);assert.equal(writes,0);
 });
 await startupCases();
 console.log('POSTGRES_STARTUP_RESULT '+JSON.stringify({passed,failed,total:passed+failed}));process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
