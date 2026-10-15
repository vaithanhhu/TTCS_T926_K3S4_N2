const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
  if(!process.env.ATS_POSTGRES_TEST_URL){console.log('POSTGRES_LIVE: NOT RUN — ATS_POSTGRES_TEST_URL must name a disposable test database (never production).');return;}
  const root=path.resolve(__dirname,'../..');assert.equal(fs.existsSync(path.join(root,'.env')),false,'Isolated test copy required');assert.equal(fs.existsSync(path.join(root,'.git')),false,'Isolated test copy required');
  const {PostgresDatabase}=require('../src/db/postgres');const db=new PostgresDatabase({DATABASE_URL:process.env.ATS_POSTGRES_TEST_URL});
  const schema='ats_test_'+require('node:crypto').randomBytes(8).toString('hex');
  const client=await db.pool.connect();
  try{
    await client.query('CREATE SCHEMA '+schema);
    const testDb=new PostgresDatabase({}, {on(){},query:(sql,params)=>client.query(sql,params),async connect(){return {query:(sql,params)=>client.query(sql,params),release(){}};},async end(){}});
    await client.query('SET search_path TO '+schema);
    await require('../src/db/migrate-postgres').migrate(testDb);await require('../src/db/migrate-postgres').verifyMigration(testDb);
    await testDb.transaction(()=>require('../src/db/seed').seedDatabase(testDb));
    assert.equal(Number((await testDb.prepare('SELECT COUNT(*) AS n FROM users').get()).n),25);
    console.log('POSTGRES_LIVE: 3/3 PASS (schema, idempotent migration, seed readback).');
  }finally{await client.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');client.release();await db.close();}
}
main().catch(error=>{console.error('[PostgreSQL Live Test]',error.code||'FAILED');process.exitCode=1;});
