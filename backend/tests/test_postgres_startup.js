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
 await test('Actual PostgreSQL startup reaches HTTP readiness using only SELECT statements',async()=>{
  const config=require('../src/config/config');config.DB_PROVIDER='postgres';config.EMAIL_MODE='simulated';
  const {PostgresDatabase}=require('../src/db/postgres');const database=require('../src/db/database');
  const original=database.getDatabase,queries=[];
  const pool={on(){},async query(sql){queries.push(sql);if(sql.includes('ats_schema_migrations'))return {rows:[{checksum:expected}]};if(sql.includes('COUNT(*) AS c FROM users'))return {rows:[{c:59}]};throw new Error('Unexpected startup SQL');},async end(){}};
  const db=new PostgresDatabase({},pool);database.getDatabase=()=>db;
  const {startServer,server}=require('../src/server');
  try{await startServer(0);const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/health');assert.equal(response.status,200);assert.equal((await response.json()).status,'ok');assert.equal(queries.length,2);assert.ok(queries.every(query=>/^SELECT\b/.test(query)));}
  finally{database.getDatabase=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();}
 });
 console.log('POSTGRES_STARTUP_RESULT '+JSON.stringify({passed,failed,total:passed+failed}));process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
