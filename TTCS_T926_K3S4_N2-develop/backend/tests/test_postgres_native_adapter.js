const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
for(const name of ['.git','.env','backend/data/ats.db','backend/data/ats_test.db'])assert.equal(fs.existsSync(path.join(root,name)),false);
assert.equal(process.env.NODE_ENV,'test');
const {PostgresDatabase,postgresSQL}=require('../src/db/postgres');
async function main(){
  const url=new URL(process.env.ATS_NATIVE_VALIDATION_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/ats_native_validation_[a-f0-9]{8}$/);
  const db=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});let passed=0;
  const check=async(name,action)=>{await action();passed++;console.log('PASS '+name);};
  try{
    const identity=await db.prepare('SELECT version() AS version,current_database() AS name,host(inet_server_addr()) AS address').get();assert.match(identity.version,/PostgreSQL 16\./);assert.equal(identity.name,url.pathname.slice(1));assert.equal(identity.address,'127.0.0.1');
    await check('existing unmodified now and column conversion retained',async()=>{assert.equal(postgresSQL("SELECT datetime('now'),datetime(expires_at)"),'SELECT CURRENT_TIMESTAMP,expires_at');});
    await check('SQLite signed offsets compare to native UTC timestamp',async()=>{for(const [modifier,seconds]of [['-31 minutes',-1860],['-20 minutes',-1200],['-16 minutes',-960],['-1 hour',-3600],['+2 days',172800],['0 seconds',0],['1.5 seconds',1.5]]){const row=await db.prepare("SELECT EXTRACT(EPOCH FROM (datetime('now', '"+modifier+"') - CURRENT_TIMESTAMP)) AS delta").get();assert.equal(row.delta,seconds);}});
    await check('literal placeholder masking preserved with interval',async()=>{const row=await db.prepare("SELECT ?::text AS value, '?' AS literal,datetime('now','-1 hour') AS instant").get("x'; SELECT secret; --");assert.equal(row.value,"x'; SELECT secret; --");assert.equal(row.literal,'?');assert.ok(Number.isFinite(Date.parse(row.instant)));});
    await check('unsupported modifiers rejected before SQL execution',async()=>{for(const modifier of ['localtime','start of month','1 month','1; DROP TABLE users','9007199254740992 days'])assert.throws(()=>postgresSQL("SELECT datetime('now', '"+modifier+"')"),/UNSUPPORTED_SQLITE_DATETIME/);assert.throws(()=>postgresSQL("SELECT datetime('now', '-1 hour', '+1 day')"),/UNSUPPORTED_SQLITE_DATETIME/);});
    await check('unquoted camelCase result aliases retain the SQLite API contract',async()=>{const row=await db.prepare("SELECT 15 AS minSalary,25 AS maxSalary,'Tên tiếng Việt' AS fullName,'dept' AS parentId,12 AS count,13 AS TOTAL,CAST(2 AS INTEGER) AS quantity").get();assert.deepEqual(row,{minSalary:15,maxSalary:25,fullName:'Tên tiếng Việt',parentId:'dept',count:12,total:13,quantity:2});assert.equal(postgresSQL('SELECT 1 AS "minSalary"'),'SELECT 1 AS "minSalary"');assert.equal(postgresSQL("SELECT 'AS fullName ?' AS label"),"SELECT 'AS fullName ?' AS label");});
    await check('native type semantics remain Boolean ISO UTC date and numeric',async()=>{const row=await db.prepare("SELECT TRUE AS flag,DATE '2026-10-14' AS date,TIMESTAMPTZ '2026-10-14 07:00:00+07' AS time,12.25::numeric AS number").get();assert.deepEqual(row,{flag:true,date:'2026-10-14',time:'2026-10-14T00:00:00.000Z',number:12.25});});
    await check('short native transaction rollback preserves empty fixture',async()=>{await db.exec('CREATE TABLE adapter_rollback(id INTEGER PRIMARY KEY)');await assert.rejects(()=>db.transaction(async()=>{await db.prepare('INSERT INTO adapter_rollback(id) VALUES (?)').run(1);throw Error('INJECTED_FAILURE');}),/INJECTED_FAILURE/);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM adapter_rollback').get()).n,0);});
    console.log('NATIVE_ADAPTER_RESULT '+JSON.stringify({passed,failed:0,provider:'PostgreSQL 16'}));
  }finally{await db.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
