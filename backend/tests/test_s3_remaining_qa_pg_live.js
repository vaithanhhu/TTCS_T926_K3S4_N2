const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const address=process.env.ATS_POSTGRES_TEST_URL;
if(!address){console.log('QA_S3_BATCH_PG_LIVE: NOT RUN — isolated local PostgreSQL URL required');process.exit(0);}
const parsed=new URL(address),root=path.resolve(__dirname,'../..');
assert.equal(process.env.ATS_QA_PG_TEST_ISOLATED,'true');
assert.equal(parsed.hostname,'127.0.0.1');
assert.ok(Number(parsed.port)>1024);
assert.match(parsed.pathname,/^\/ats_qa_s3_06_[a-f0-9]{12}$/);
assert.equal(parsed.username,'qa_app');
assert.equal(fs.existsSync(path.join(root,'.env')),false);
assert.equal(fs.existsSync(path.join(root,'.git')),false);
Object.assign(process.env,{NODE_ENV:'test',DB_PROVIDER:'postgres',DATABASE_URL:address,PG_SSL_MODE:'disable',EMAIL_MODE:'simulated'});
const db=require('../src/db/database').getDatabase();
async function main(){
 try{
  const row=await db.prepare("SELECT current_database() AS name,current_schema() AS schema,current_user AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser").get();
  assert.equal(row.name,parsed.pathname.slice(1));assert.equal(row.schema,'public');assert.equal(row.role,'qa_app');assert.equal(row.superuser,false);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'").get()).n,0);
  await require('../src/db/migrate-postgres').migrate(db);
  await db.transaction(()=>require('../src/db/seed').seedDatabase(db));
  const batch=require('./test_s3_remaining_qa');
  await batch.backendCases(await require('./test_qa_s3_06').setup(db),'Real PostgreSQL 17 pg-wire');
  console.log('QA_S3_BATCH_MEASUREMENTS '+JSON.stringify(batch.measurements));batch.finish();assert.notEqual(process.exitCode,1);
  console.log('QA_S3_BATCH_PG_ENV '+JSON.stringify({version:(await db.prepare('SHOW server_version').get()).server_version,role:row.role,schema:row.schema,email:'simulated',database:'fresh disposable loopback cluster'}));
 }finally{await db.close();}
}
main().catch(error=>{console.error('QA_BATCH_PG_FAILURE '+(error.code||error.message));process.exitCode=1;});
