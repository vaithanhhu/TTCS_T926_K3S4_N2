const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats_test.db'])assert.equal(fs.existsSync(path.join(root,file)),false);
const {installFailureTrigger,assertNoOpenTransaction,foreignKeyViolations}=require('./helpers/databaseCompatibilityFixture');
const {sqliteBoundary,PostgresDatabase}=require('../src/db/postgres');
let passed=0;
async function run(db,label){
 const test=async(name,action)=>{await action();passed++;console.log('PASS '+label+' '+name);};
 await db.exec('CREATE TABLE qa_fixture_rows(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
 for(const event of ['INSERT','UPDATE','DELETE'])await test(event+' trigger rejects the target only and rollback is real',async()=>{
  await db.prepare("INSERT INTO qa_fixture_rows(id,value) VALUES (1,'original')").run();
  const remove=await installFailureTrigger(db,{name:'qa_fail_'+event.toLowerCase(),table:'qa_fixture_rows',event,condition:(event==='DELETE'?'OLD':'NEW')+'.id=1'});
  try{
   await assert.rejects(()=>db.transaction(async()=>{if(event==='INSERT'){await db.prepare("DELETE FROM qa_fixture_rows WHERE id=1").run();await db.prepare("INSERT INTO qa_fixture_rows VALUES(1,'failed')").run();}else if(event==='UPDATE')await db.prepare("UPDATE qa_fixture_rows SET value='failed' WHERE id=1").run();else await db.prepare('DELETE FROM qa_fixture_rows WHERE id=1').run();}),error=>db.provider==='postgres'?error.code==='P0001':error.message.includes('test failure'));
   const expected=db.provider==='postgres'?{id:1,value:'original'}:Object.assign(Object.create(null),{id:1,value:'original'});
   assert.deepEqual(await db.prepare('SELECT * FROM qa_fixture_rows WHERE id=1').get(),expected);
   if(event==='INSERT')await db.prepare("INSERT INTO qa_fixture_rows VALUES(2,'allowed')").run();
   if(event==='UPDATE'){await db.prepare("INSERT INTO qa_fixture_rows VALUES(2,'allowed')").run();await db.prepare("UPDATE qa_fixture_rows SET value='changed' WHERE id=2").run();assert.equal((await db.prepare('SELECT value FROM qa_fixture_rows WHERE id=2').get()).value,'changed');}
   if(event==='DELETE'){await db.prepare("INSERT INTO qa_fixture_rows VALUES(2,'allowed')").run();assert.equal((await db.prepare('DELETE FROM qa_fixture_rows WHERE id=2').run()).changes,1);}
   await assertNoOpenTransaction(db);
  }finally{await remove();await db.prepare('DELETE FROM qa_fixture_rows').run();}
 });
 await test('cleanup removes failure behavior and unsafe identifiers rejected',async()=>{assert.equal((await db.prepare("INSERT INTO qa_fixture_rows VALUES(1,'after cleanup')").run()).changes,1);await assert.rejects(()=>installFailureTrigger(db,{name:'bad;sql',table:'qa_fixture_rows',event:'INSERT',condition:'TRUE'}),assert.AssertionError);});
 await db.exec('CREATE TABLE qa_fk_parent(id INTEGER PRIMARY KEY);CREATE TABLE qa_fk_child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES qa_fk_parent(id))');
 await test('valid and nullable FKs return no violations; bad new rows rejected',async()=>{await db.prepare('INSERT INTO qa_fk_parent VALUES(1)').run();await db.prepare('INSERT INTO qa_fk_child VALUES(1,1),(2,NULL)').run();assert.deepEqual(await foreignKeyViolations(db),[]);await assert.rejects(async()=>await db.prepare('INSERT INTO qa_fk_child VALUES(3,99)').run(),error=>db.provider==='postgres'?error.code==='23503':error.message.includes('FOREIGN KEY constraint failed'));assert.equal((await db.prepare('SELECT count(*) AS n FROM qa_fk_child').get()).n,2);});
 await test('existing orphan is detected rather than masking metadata differences',async()=>{
  if(db.provider==='postgres'){
   await db.exec('CREATE TABLE qa_fk_legacy(id INTEGER PRIMARY KEY,parent_id INTEGER);INSERT INTO qa_fk_legacy VALUES(1,99);ALTER TABLE qa_fk_legacy ADD CONSTRAINT qa_legacy_fk FOREIGN KEY(parent_id) REFERENCES qa_fk_parent(id) NOT VALID');
   const violations=await foreignKeyViolations(db);assert.ok(violations.some(row=>row.constraint==='qa_legacy_fk'&&row.rows===1));assert.ok(violations.some(row=>row.constraint==='qa_legacy_fk'&&row.unvalidated));
   await db.prepare('UPDATE qa_fk_legacy SET parent_id=1').run();await db.exec('ALTER TABLE qa_fk_legacy VALIDATE CONSTRAINT qa_legacy_fk');
  }else{
   await db.exec('PRAGMA foreign_keys=OFF');await db.prepare('INSERT INTO qa_fk_child VALUES(3,99)').run();await db.exec('PRAGMA foreign_keys=ON');assert.equal((await foreignKeyViolations(db)).length,1);await db.prepare('UPDATE qa_fk_child SET parent_id=1 WHERE id=3').run();
  }
  assert.deepEqual(await foreignKeyViolations(db),[]);
 });
 if(db.provider==='postgres')await test('independent connection idle transaction is detected and rollback releases it',async()=>{const peer=await db.pool.connect();try{await peer.query('BEGIN');await assert.rejects(()=>assertNoOpenTransaction(db),assert.AssertionError);}finally{await peer.query('ROLLBACK');peer.release();}await assertNoOpenTransaction(db);});
}
async function main(){
 const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));await sqlite.exec('PRAGMA foreign_keys=ON');try{await run(sqlite,'SQLite');}finally{sqlite.close();}
 if(process.env.ATS_NATIVE_VALIDATION_URL){const url=new URL(process.env.ATS_NATIVE_VALIDATION_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/ats_native_validation_[a-f0-9]{8}$/);const db=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});try{assert.match((await db.prepare('SELECT version() AS version').get()).version,/PostgreSQL 16\./);await run(db,'PostgreSQL native 16');}finally{await db.close();}}
 console.log('COMPATIBILITY_FIXTURE_RESULT '+JSON.stringify({passed,failed:0,livePostgres:Boolean(process.env.ATS_NATIVE_VALIDATION_URL)}));
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={run};
