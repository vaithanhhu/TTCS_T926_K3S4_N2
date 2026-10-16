const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {PostgresDatabase,pgTypes}=require('../src/db/postgres');
const Bulk=require('../src/services/bulkInterviewService');
const Single=require('../src/services/requisitionService');
const Worker=require('../src/services/interviewInvitationWorker');
const {fixture,run,payload,actor}=require('./test_s6_03_bulk_interviews');

async function main(){
  const root=path.resolve(__dirname,'../..');
  for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-wal','backend/data/ats.db-shm'])assert.equal(fs.existsSync(path.join(root,file)),false,'ISOLATED_SOURCE_REQUIRED');
  if(!process.argv[2])throw Error('DISPOSABLE_LOCAL_CLUSTER_CONFIG_REQUIRED');
  const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
  assert.equal(cfg.isolatedNewCluster,true);assert.equal(cfg.listen,'127.0.0.1');
  const relative=path.relative(fs.realpathSync.native(os.tmpdir()),fs.realpathSync.native(cfg.taskRoot));
  assert.match(relative,/^ats-s60[23]-pg\d+-[a-z0-9]+$/i);
  assert.equal(path.resolve(cfg.data),path.join(path.resolve(cfg.taskRoot),'data'));
  assert.equal(path.resolve(cfg.passwordFile),path.join(path.resolve(cfg.taskRoot),'password.txt'));
  const connection={host:'127.0.0.1',port:cfg.port,user:cfg.user,password:fs.readFileSync(cfg.passwordFile,'utf8'),database:'postgres',max:4,types:pgTypes(),application_name:'ats-s603-isolated-test'};
  const admin=new Pool(connection),database='ats_s603_'+crypto.randomBytes(8).toString('hex');
  try{const row=(await admin.query("SELECT version() AS version,current_setting('data_directory') AS data,host(inet_server_addr()) AS address")).rows[0];assert.equal(fs.realpathSync.native(row.data).toLowerCase(),fs.realpathSync.native(cfg.data).toLowerCase());assert.equal(row.address,'127.0.0.1');console.log(JSON.stringify({version:row.version,database,testOnly:true}));await admin.query('CREATE DATABASE '+database);}finally{await admin.end();}
  let groups=0,sequence=0;
  const isolated=async(action,setup=true)=>{
    const schema='suite_'+(++sequence),pool=new Pool({...connection,database});
    try{await pool.query('CREATE SCHEMA '+schema);}finally{await pool.end();}
    const options={...connection,database,options:'-c search_path='+schema+' -c timezone=UTC -c statement_timeout=15000'};
    const first=new PostgresDatabase({},new Pool(options)),second=new PostgresDatabase({},new Pool(options));
    try{if(setup)await fixture(first,'postgres');await action(first,second);groups++;}finally{await first.close();await second.close();}
  };
  let cases=0;
  await isolated(async db=>{cases=await run(db,'PostgreSQL native');},false);
  for(const mode of ['bulk-bulk','same-key','single-bulk','bulk-single','panel-overlap'])await isolated(async(db,other)=>{
    const one=new Bulk(db),two=new Bulk(other),single=new Single(mode==='single-bulk'?db:other);
    const firstPayload=mode==='panel-overlap'?{...payload,candidateIds:['cand-nguyen']}:payload;
    const secondPayload=mode==='panel-overlap'?{...payload,candidateIds:['cand-tran'],interviewerIds:[...payload.interviewerIds].reverse()}:payload;
    const firstReq={...firstPayload,requestKey:'native-request-key-0001',fingerprint:(await one.preview(firstPayload,actor)).fingerprint};
    const secondReq={...secondPayload,requestKey:mode==='same-key'?firstReq.requestKey:'native-request-key-0002',fingerprint:(await two.preview(secondPayload,actor)).fingerprint};
    let entered,release;
    const barrier=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});
    let firstPid;
    if(mode==='single-bulk'){
      const check=single.checkInterviewConflict.bind(single);
      single.checkInterviewConflict=async(...args)=>{firstPid=(await db.prepare('SELECT pg_backend_pid() AS pid').get()).pid;entered();await hold;return check(...args);};
    }else{
      const lock=one.lock.bind(one);
      one.lock=async(...args)=>{await lock(...args);firstPid=(await db.prepare('SELECT pg_backend_pid() AS pid').get()).pid;entered();await hold;};
    }
    const singlePayload={...payload,candidateId:'cand-nguyen',scheduledTime:'2032-06-01T09:00'};
    const first=mode==='single-bulk'?single.createInterview(singlePayload,actor):one.create(firstReq,actor);
    let second;
    try{
      await Promise.race([barrier,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('LOCK_BARRIER_TIMEOUT')),10000);timer.unref();})]);
      second=mode==='bulk-single'?single.createInterview(singlePayload,actor):two.create(secondReq,actor);
      let waiting=[];const deadline=Date.now()+5000;
      while(Date.now()<deadline){waiting=await db.prepare("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>? AND wait_event_type='Lock' AND ?=ANY(pg_blocking_pids(pid))").all(firstPid,firstPid);if(waiting.length)break;await new Promise(resolve=>setTimeout(resolve,20));}
      assert.equal(waiting.length,1,'Independent connection must wait for candidate/panel/idempotency lock');assert.notEqual(waiting[0].pid,firstPid);
    }finally{release();}
    const results=await Promise.all([first,second]);
    assert.deepEqual(results.map(row=>row.statusCode),[201,mode==='same-key'?200:409]);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n),mode==='single-bulk' || mode==='panel-overlap'?1:2);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM interview_batches').get()).n),mode==='single-bulk'?0:1);
    if(mode==='same-key')assert.equal(results[0].batchId,results[1].batchId);
    console.log('PASS native independent connections '+mode);
  });
  await isolated(async(db,other)=>{
    const service=new Bulk(db),preview=await service.preview(payload,actor),result=await service.create({...payload,fingerprint:preview.fingerprint,requestKey:'native-delivery-key-01'},actor);
    let calls=0;const email={sendMail:async()=>{assert.equal(db.context.getStore(),undefined);assert.equal(other.context.getStore(),undefined);calls++;await new Promise(resolve=>setTimeout(resolve,20));return {success:true,simulated:true};}};
    await Promise.all([new Worker(db,email).deliver(result.batchId,actor),new Worker(other,email).deliver(result.batchId,actor)]);
    assert.equal(calls,2);assert.ok((await service.status(result.batchId,actor)).deliveries.every(row=>row.attempts===1));console.log('PASS native concurrent delivery claims');
  });
  console.log('S603_NATIVE_RESULT '+JSON.stringify({groups,cases,failed:0,database}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
