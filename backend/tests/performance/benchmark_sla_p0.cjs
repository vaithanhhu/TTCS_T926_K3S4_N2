'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../../..'); for(const name of ['.env','.git'])assert.equal(fs.existsSync(path.join(root,name)),false);
for(const key of Object.keys(process.env))if(/^(DATABASE_|DB_|PG|ATS_|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|CANDIDATE_)/.test(key))delete process.env[key];
let testUrl;
try { testUrl=new URL(process.env.P0_TEST_DATABASE_URL || ''); }
catch { throw Error('LOOPBACK_DISPOSABLE_TEST_DATABASE_REQUIRED'); }
assert.ok(testUrl.protocol==='postgresql:' && testUrl.hostname==='127.0.0.1' && testUrl.port && testUrl.port!=='5432' && testUrl.pathname==='/ats_perf_audit_d' && testUrl.username==='ats_perf' && !testUrl.password && !testUrl.search, 'LOOPBACK_DISPOSABLE_TEST_DATABASE_REQUIRED');
Object.assign(process.env,{NODE_ENV:'test',DB_PROVIDER:'postgres',DATABASE_URL:testUrl.href,PG_SSL_MODE:'disable',EMAIL_MODE:'simulated',ATS_LOCAL_DEMO:'true'});
const als=new AsyncLocalStorage(),nativeStringify=JSON.stringify;
const metrics=[],templates=new Map(),poolPeaks={total:0,idle:0,waiting:0,created:0};
const now=()=>performance.now(),round=v=>Math.round(v*1000)/1000;
function mark(proto,name,kind){const orig=proto[name];if(typeof orig!=='function')return;proto[name]=async function(...args){const c=als.getStore(),start=now();try{return await orig.apply(this,args);}finally{if(c)c[kind].push([start,now()]);}};}
function union(spans){const sorted=spans.slice().sort((a,b)=>a[0]-b[0]);let total=0,start=-1,end=-1;for(const [a,b]of sorted){if(a>end){if(end>=0)total+=end-start;start=a;end=b;}else end=Math.max(end,b);}return total+(end<0?0:end-start);}
function quantile(xs,p){const a=xs.slice().sort((a,b)=>a-b);return round(a[Math.max(0,Math.ceil(p*a.length)-1)]||0);}
function distribution(xs){return{p50:quantile(xs,.5),p95:quantile(xs,.95),p99:quantile(xs,.99),max:round(Math.max(0,...xs)),mean:round(xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length))};}
const pg=require('pg'),origClient=pg.Client.prototype.query;
pg.Client.prototype.query=function(...args){
 const c=als.getStore();if(!c)return origClient.apply(this,args);
 const start=now(),sql=typeof args[0]==='string'?args[0]:args[0]?.text||'';
 const normalized=sql.replace(/'([^']|'')*'/g,'?').replace(/\$\d+/g,'?').replace(/\s+/g,' ').trim();
 const hash=crypto.createHash('sha256').update(normalized).digest('hex').slice(0,12);
 const tables=[...new Set([...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_.]*)/ig)].map(m=>m[1]))].filter(v=>!['SET','SELECT'].includes(v));
 if(!templates.has(hash))templates.set(hash,{sql,params:Array.isArray(args[1])?args[1]:[],tables});
 let finished=false;const finish=()=>{if(finished)return;finished=true;const ms=now()-start;c.sqlCount++;c.sqlMs+=ms;c.patterns[hash]=(c.patterns[hash]||0)+1;};
 const cbIndex=args.findLastIndex(v=>typeof v==='function');
 if(cbIndex>=0){const cb=args[cbIndex];args[cbIndex]=function(...a){finish();return cb.apply(this,a);};return origClient.apply(this,args);}
 try{const ret=origClient.apply(this,args);if(ret?.then)return ret.then(x=>{finish();return x;},e=>{finish();throw e;});finish();return ret;}catch(e){finish();throw e;}
};
JSON.stringify=function(...args){const c=als.getStore(),t=now(),value=nativeStringify.apply(JSON,args);if(c)c.lastJson={value,ms:now()-t};return value;};
async function main(){
 const config=require(path.join(root,'backend/src/config/config'));
 const db=require(path.join(root,'backend/src/db/database')).getDatabase();
 const identity=await db.prepare("SELECT version() AS v,current_database() AS d").get();assert.equal(identity.d,'ats_perf_audit_d');assert.match(identity.v,/PostgreSQL 16\./);
 assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=current_schema()').get()).n),0,'Fresh empty disposable database required');
 await require(path.join(root,'backend/src/db/migrate-postgres')).migrate(db);
 await db.transaction(()=>require(path.join(root,'backend/src/db/seed')).seedDatabase(db));
 const reqCount=Number((await db.prepare('SELECT COUNT(*) AS n FROM requisitions').get()).n);
 await db.exec("INSERT INTO requisitions(id,code,title,department_id,department_name,headcount,status,hiring_manager_id,recruiter_id,created_by,created_at,updated_at) SELECT 'perf-req-'||g,'PERF-'||g,'Synthetic position '||g,r.department_id,r.department_name,10,'OPEN',r.hiring_manager_id,r.recruiter_id,r.created_by,CURRENT_TIMESTAMP-(g||' hours')::interval,CURRENT_TIMESTAMP FROM generate_series(1,"+(1000-reqCount)+") g CROSS JOIN (SELECT * FROM requisitions WHERE recruiter_id IS NOT NULL AND hiring_manager_id IS NOT NULL ORDER BY id LIMIT 1) r");
 const migrations=['approval-configurations','requisition-approvals','headcount-budgets','requisition-operations','requisition-lifecycle','requisition-tracking-job-drafts','job-publication','candidate-portal','requisition-open-policy','candidate-stage-transitions','candidate-search','talent-pool','interview-scheduling','bulk-interviews','candidate-merges','interview-conflict-override','interview-invitations','interview-reschedule-cancel','interview-evaluations','interview-question-suggestions','hiring-decisions','offer-proposals','offer-approvals','offer-delivery','offer-negotiation','onboarding-checklists','bulk-candidate-communications','candidate-quick-rating'];
 for(const name of migrations){const mod=require(path.join(root,'backend/src/db/migrate-'+name));if(name==='candidate-quick-rating'&&await mod.hasColumn(db))continue;await mod.migrate(db);}
 for(const name of ['APPROVAL_CONFIGURATION_ENABLED','HEADCOUNT_BUDGET_ENABLED','REQUISITION_TRACKING_ENABLED','JOB_POSTING_PUBLICATION_ENABLED','JOB_POSTING_DRAFTS_ENABLED','REQUISITION_LIFECYCLE_ENABLED','REQUISITION_OPERATIONS_ENABLED','REQUISITION_APPROVAL_ENABLED','CANDIDATE_PORTAL_ENABLED','CANDIDATE_STAGE_TRANSITIONS_ENABLED'])config[name]=true;
 await require(path.join(root,'backend/src/db/sync-permissions')).synchronizeCandidatePortalPermissions(db);
 const sla=new(require(path.join(root,'backend/src/services/slaNotificationService')))(db);await sla.ensureTables();
 const ddl=[];const originalExec=db.exec.bind(db);db.exec=sql=>{const task=originalExec(sql);ddl.push(task);return task;};new(require(path.join(root,'backend/src/services/candidateScreeningService')))(db);await Promise.all(ddl);db.exec=originalExec;
 const candCount=Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).n),toAdd=10000-candCount;
 await db.exec("INSERT INTO candidates(id,full_name,email,phone_number,requisition_id,stage,experience_years,current_company,expected_salary,created_at,cover_letter) SELECT 'perf-cand-'||g,'Synthetic applicant '||g,'fixture-'||g||'@example.invalid','0000000000',r.id,(ARRAY['NEW','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN'])[1+(g%7)],1+(g%8),'Synthetic company','10000000',CURRENT_TIMESTAMP-((g%45+1)||' days')::interval,'Synthetic Node PostgreSQL fixture' FROM generate_series(1,"+toAdd+") g JOIN (SELECT id,row_number() OVER(ORDER BY id) AS n FROM requisitions) r ON r.n=1+(g%1000)");
 await db.exec("INSERT INTO candidate_status_history(id,candidate_id,before_stage,after_stage,actor_name,action,created_at) SELECT 'perf-hist-'||c.id||'-'||g,c.id,CASE WHEN g=1 THEN NULL ELSE 'NEW' END,CASE WHEN g=3 THEN c.stage ELSE 'NEW' END,'Synthetic actor','STAGE_CHANGED',c.created_at+(g||' hours')::interval FROM candidates c CROSS JOIN generate_series(1,3) g WHERE c.id LIKE 'perf-cand-%'");
 await db.exec("INSERT INTO candidate_tags(id,candidate_id,tag_name,created_by) SELECT 'perf-tag-'||id,id,'Node','fixture' FROM candidates WHERE id LIKE 'perf-cand-%'");
 await db.exec("INSERT INTO interviews(id,candidate_id,requisition_id,interviewer_id,scheduled_time,status,score) SELECT 'perf-int-'||c.id,c.id,c.requisition_id,r.hiring_manager_id,'2026-11-01T00:00:00.000Z','COMPLETED',7 FROM candidates c JOIN requisitions r ON r.id=c.requisition_id WHERE c.id LIKE 'perf-cand-%' AND c.stage IN ('INTERVIEW','OFFER','HIRED')");
 await db.exec("INSERT INTO offers(id,candidate_id,requisition_id,salary_monthly,start_date,status) SELECT 'perf-offer-'||c.id,c.id,c.requisition_id,10000000,'2026-11-01','ACCEPTED' FROM candidates c WHERE c.id LIKE 'perf-cand-%' AND c.stage='HIRED'");
 await db.exec("ANALYZE");
 const dataset={};for(const table of ['users','requisitions','candidates','candidate_status_history','interviews','offers','candidate_tags'])dataset[table]=Number((await db.prepare('SELECT COUNT(*) AS n FROM '+table).get()).n);
 dataset.slaEligible=Number((await db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE stage IS NULL OR stage NOT IN ('HIRED','REJECTED','WITHDRAWN')").get()).n);
 assert.equal(dataset.candidates,10000);assert.equal(dataset.requisitions,1000);
 console.log('DATASET '+nativeStringify(dataset));
 const origConnect=db.pool.connect.bind(db.pool);
 db.pool.on('connect',()=>poolPeaks.created++);
 db.pool.connect=function(cb){const c=als.getStore(),t=now();const done=()=>{if(c)c.poolWaitMs+=now()-t;poolPeaks.total=Math.max(poolPeaks.total,db.pool.totalCount);poolPeaks.waiting=Math.max(poolPeaks.waiting,db.pool.waitingCount);};
  if(typeof cb==='function')return origConnect((...args)=>{done();als.run(c,()=>cb(...args));});
  return origConnect().then(client=>{done();return client;});
 };
 const Auth=require(path.join(root,'backend/src/services/authService')),Rbac=require(path.join(root,'backend/src/middlewares/rbacMiddleware'));
 for(const n of ['login','validateSession'])mark(Auth.prototype,n,'auth');
 for(const n of ['authorize','getAuthorizedActor','hasPermission','getUserPermissions','getUserPermissionDetails'])mark(Rbac.prototype,n,'auth');
 const Reqs=require(path.join(root,'backend/src/services/requisitionService')),Users=require(path.join(root,'backend/src/services/userService')),Search=require(path.join(root,'backend/src/services/candidateSearchService')),Sla=require(path.join(root,'backend/src/services/slaNotificationService'));
 for(const [proto,names]of [[Reqs.prototype,['getDashboardStats','scopedDashboardStats','getRequisitions','getReports']],[Users.prototype,['getUsers']],[Search.prototype,['availability','search','searchRows']],[Sla.prototype,['getSlaConfigurations','getOverdueCandidates','getRecruiterReminders']]])for(const n of names)mark(proto,n,'service');
 const before=db.withConnection.bind(db);
 db.withConnection=action=>{if(als.getStore())return before(action);const c={start:now(),auth:[],service:[],sqlCount:0,sqlMs:0,poolWaitMs:0,patterns:{}};return als.run(c,()=>before(action));};
 const {server,startServer}=require(path.join(root,'backend/src/server'));
 server.prependListener('request',(req,res)=>{ // ALS is entered later by the unchanged HTTP handler.
  const end=res.end;
  res.end=function(body,...args){const c=als.getStore();if(c&&!c.recorded){c.recorded=true;c.serverMs=now()-c.start;c.authMs=union(c.auth);c.serviceMs=union(c.service);c.serializeMs=c.lastJson?.value===body?c.lastJson.ms:0;c.bytes=typeof body==='string'?Buffer.byteLength(body):body?.length||0;c.status=res.statusCode;c.id=req.headers['x-perf-id'];delete c.lastJson;delete c.auth;delete c.service;metrics.push(c);}
   return end.call(this,body,...args);};
 });
 await startServer(0,'127.0.0.1');
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 const auth=new Auth(db);
 const hr=await auth.login('hrmanager@company.com','Ats@123456'),admin=await auth.login('admin@company.com','Ats@123456');assert.equal(hr.success,true);assert.equal(admin.success,true);
 const userTokens={hr:[],admin:[]};
 for(const [kind,session]of Object.entries({hr,admin})){
  const token=session.data.token;assert.ok(token);
  const source=await db.prepare('SELECT user_id FROM sessions WHERE token=?').get(token);
  for(let i=0;i<50;i++){const t='fixture-perf-'+kind+'-'+crypto.randomUUID();await db.prepare('INSERT INTO sessions(id,user_id,token,expires_at) VALUES(?,?,?,?)').run(crypto.randomUUID(),source.user_id,t,new Date(Date.now()+86400000).toISOString());userTokens[kind].push(t);}
 }
 const endpoints=[{key:'candidates_advanced',path:'/candidates?advanced=1&page=1&pageSize=50'},{key:'overdue_all',path:'/sla/overdue-candidates?includeAll=true'}];
 const SlaPrototype=Sla.prototype,Reference=require(path.join(root,'backend/tests/fixtures/slaReference20261022'));
 const optimized={calculateCandidateSla:SlaPrototype.calculateCandidateSla,getOverdueCandidates:SlaPrototype.getOverdueCandidates,prepareCandidateSlaBatch:SlaPrototype.prepareCandidateSlaBatch};
 const hashes=new Map();let mode='before';
 const runs=[],results={engine:identity.v,dataset,poolConfigured:{max:db.pool.options.max,idleTimeoutMillis:db.pool.options.idleTimeoutMillis,connectionTimeoutMillis:db.pool.options.connectionTimeoutMillis||0},profiles:runs,notes:['Paired C20 reference and optimized same database; optimized also C1/5/10/50. Synthetic data; no Azure. SQL time includes driver/wire latency. SHA256 of entire HTTP response must equal frozen reference; no response bodies exported.'],explain:[]};
 fs.writeFileSync(path.join(root,'benchmark-state.json'),nativeStringify({state:'running',dataset}));
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function call(ep,id,index=0){
  const t=now(),token=userTokens[ep.role||'hr'][index%50],opts={method:ep.method||'GET',headers:{'X-Perf-Id':id,Authorization:'Bearer '+token}};
  const response=await fetch(base+ep.path,opts);const text=await response.text();let body;try{body=JSON.parse(text);}catch{}
  assert.equal(response.status,200,ep.key+' status');assert.equal(body?.success,true,ep.key+' success');
  const hash=crypto.createHash('sha256').update(text).digest('hex');if(!hashes.has(ep.key))hashes.set(ep.key,hash);assert.equal(hash,hashes.get(ep.key),'Full response bytes/order differ: '+mode+'/'+ep.key);
  return {clientMs:now()-t,status:response.status,success:body?.success===true,bytes:Buffer.byteLength(text),count:Array.isArray(body?.candidates)?body.candidates.length:body?.data?.candidates?.length};
 }
 try{
 for(mode of ['before','after']){
 if(mode==='before')Object.assign(SlaPrototype,{calculateCandidateSla:Reference.prototype.calculateCandidateSla,getOverdueCandidates:Reference.prototype.getOverdueCandidates,prepareCandidateSlaBatch:async()=>null});else Object.assign(SlaPrototype,optimized);
 for(const ep of endpoints){
  const warm=await call(ep,'warm-'+ep.key);assert.equal(warm.status,200,ep.key+' warm status');assert.equal(warm.success,true,ep.key+' success');
  for(const concurrency of (mode==='before'?[20]:[1,5,10,20,50])){
   const sampleCount=concurrency===50?60:30,tag=mode+'-'+ep.key+'-c'+concurrency;
   const loop=monitorEventLoopDelay({resolution:10});loop.enable();const utilization=performance.eventLoopUtilization(),cpu=process.cpuUsage(),started=now();
   const samples=[];let next=0,completed=0;
   console.log('START '+tag+' n='+sampleCount);
   await Promise.all(Array.from({length:Math.min(concurrency,sampleCount)},async()=>{
    while(next<sampleCount){const index=next++;const id=tag+'-'+index;const sample=await call(ep,id,index);samples.push({...sample,id});completed++;if(ep.key==='overdue_all'&&completed%5===0)console.log('PROGRESS '+tag+' '+completed+'/'+sampleCount);}
   }));
   loop.disable();const elapsed=now()-started,elu=performance.eventLoopUtilization(utilization),cpuUsed=process.cpuUsage(cpu);
   const ids=new Set(samples.map(s=>s.id)),m=metrics.filter(x=>ids.has(x.id));
   assert.equal(m.length,sampleCount,'All samples must carry server metrics');assert.ok(m.every(x=>x.sqlCount>0),'Each response must retain SQL context');
   const patterns={};for(const row of m)for(const [hash,n]of Object.entries(row.patterns))patterns[hash]=(patterns[hash]||0)+n;
   const run={mode,endpoint:ep.key,concurrency,n:sampleCount,statusCounts:Object.fromEntries([...new Set(samples.map(x=>x.status))].map(s=>[s,samples.filter(x=>x.status===s).length])),errorRate:samples.filter(x=>!x.success||x.status!==200).length/sampleCount,client:distribution(samples.map(s=>s.clientMs)),server:distribution(m.map(s=>s.serverMs)),auth:distribution(m.map(s=>s.authMs)),poolWait:distribution(m.map(s=>s.poolWaitMs)),sql:distribution(m.map(s=>s.sqlMs)),queryCount:distribution(m.map(s=>s.sqlCount)),service:distribution(m.map(s=>s.serviceMs)),serialize:distribution(m.map(s=>s.serializeMs)),bytes:distribution(samples.map(s=>s.bytes)),returnedCount:samples.find(s=>s.count!==undefined)?.count,elapsedMs:round(elapsed),throughputPerSecond:round(sampleCount*1000/elapsed),eventLoop:{p95Ms:round(loop.percentile(95)/1e6),maxMs:round(loop.max/1e6),utilization:round(elu.utilization)},processCpuMs:round((cpuUsed.user+cpuUsed.system)/1000),topPatterns:Object.entries(patterns).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([hash,count])=>({hash,countPerRequest:count/sampleCount,tables:templates.get(hash)?.tables}))};
   runs.push(run);console.log('RESULT '+nativeStringify({mode,endpoint:ep.key,c:concurrency,p95:run.client.p95,queries:run.queryCount.p50,errorRate:run.errorRate}));
   fs.writeFileSync(path.join(root,'benchmark-results.json'),nativeStringify(results,null,2));await sleep(30);
  }
 }
 }
 results.responseParity={fullResponseBytesEqual:true,hashes:Object.fromEntries(hashes)};
 for(const [hash,t]of templates){
  if(!/^\s*(SELECT|WITH)\b/i.test(t.sql)||!((/candidate_status_history/.test(t.sql)&&/LIMIT 1/.test(t.sql))||(/WITH candidate_scores/.test(t.sql)&&/LIMIT/.test(t.sql))||(/SELECT threshold_days,warning_days FROM sla_configurations/.test(t.sql))||(/ROW_NUMBER\(\) OVER/.test(t.sql)&&/candidate_status_history/.test(t.sql))))continue;
  const plan=await db.pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+t.sql,t.params);
  const sanitize=v=>typeof v==='string'?v.replace(/'([^']|'')*'/g,"'[redacted]'"):Array.isArray(v)?v.map(sanitize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,w])=>[k,sanitize(w)])):v;
  results.explain.push({hash,tables:t.tables,plan:sanitize(plan.rows[0]['QUERY PLAN'])});
 }
 results.poolObserved=poolPeaks;results.finished=true;fs.writeFileSync(path.join(root,'benchmark-results.json'),nativeStringify(results,null,2));
 console.log('BENCHMARK_COMPLETE');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
}
main().catch(error=>{console.error('BENCHMARK_FAILED '+(error.code||error.message));process.exitCode=1;});
