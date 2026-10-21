const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {sqliteBoundary,PostgresDatabase}=require('../src/db/postgres');
const {setupFixture}=require('./test_s6_02_interview_scheduling');
const Requisitions=require('../src/services/requisitionService');

async function run(db,label){
  await setupFixture(db,db.provider);
  await db.exec("INSERT INTO permissions(id,code,name) VALUES('report-test','report.read','Report'); INSERT INTO role_permissions(role_id,permission_id) SELECT id,'report-test' FROM roles WHERE code='RECRUITER'; CREATE TABLE offers(candidate_id TEXT,requisition_id TEXT,status TEXT,sent_at TEXT,responded_at TEXT); CREATE TABLE job_postings(id TEXT,requisition_id TEXT,published_at TEXT); CREATE TABLE job_posting_publication_events(posting_id TEXT,action TEXT,created_at TEXT);");
  await db.exec("INSERT INTO offers VALUES('a','req-backend','ACCEPTED','2026-01-09T00:00:00Z','2026-01-11T00:00:00Z'),('b','req-backend','REJECTED','2026-01-10T00:00:00Z',NULL),('foreign','req-mobile','ACCEPTED','2026-01-01T00:00:00Z','2026-05-01T00:00:00Z'); INSERT INTO job_postings VALUES('j','req-backend','2026-01-05T00:00:00Z'),('foreign','req-mobile','2026-01-01T00:00:00Z'); INSERT INTO job_posting_publication_events VALUES('j','PUBLISH','2026-01-01T00:00:00Z');");
  await db.exec("INSERT INTO candidate_status_history(id,candidate_id,before_stage,after_stage) VALUES('h1','a','NEW','SCREENING'),('h2','a','SCREENING','INTERVIEW'),('h3','a','INTERVIEW','OFFER'),('h4','a','OFFER','HIRED'),('h5','b','NEW','REJECTED'),('foreign','foreign','NEW','SCREENING')");
  await db.exec("INSERT INTO offers VALUES('a','req-mobile','ACCEPTED','2026-01-01T00:00:00Z','2026-05-01T00:00:00Z')");
  const service=new Requisitions(db);
  service.getDashboardStats=async()=>({success:true,stats:{requisitions:{totalHeadcount:4},candidates:{total:2}}});
  service.getRequisitions=async()=>({items:[{id:'req-backend',departmentName:'Scoped',headcount:4,status:'OPEN'}]});
  const own={id:'req-backend',departmentName:'Scoped'};
  service.getCandidates=async()=>({candidates:[{id:'a',stage:'HIRED',sourceName:'Source A',requisition:own,createdAt:'2026-01-01T00:00:00Z'},{id:'b',stage:'REJECTED',sourceName:'Source B',rejectionReasonName:'Skills',requisition:own,createdAt:'2026-01-01T00:00:00Z'},{id:'foreign',stage:'HIRED',requisition:{id:'req-mobile'}}]});
  const result=await service.getReports({viewer:{id:'usr-recruiter-1',roles:['ADMIN']}});
  assert.equal(result.success,true);
  assert.equal(result.report.kpis.avgTimeToHireDays,10);
  assert.equal(result.report.timeToHireSampleCount,1);
  assert.equal(result.report.kpis.offerAcceptanceRate,50);
  assert.equal(result.report.kpis.fillRatePercent,25);
  assert.equal(result.report.pipelineFunnel.find(row=>row.code==='SCREENING').conversionFromPrevious,50);
  assert.equal(result.report.pipelineFunnel.find(row=>row.code==='INTERVIEW').conversionFromPrevious,100);
  assert.equal(result.report.pipelineFunnel.find(row=>row.code==='OFFER').percent,0);
  assert.equal(result.report.departmentPerformance[0].totalCandidates,2);
  assert.equal(result.report.rejectionReasons[0].count,1);
  assert.equal(result.report.sourceEffectiveness.length,2);
  for(const viewer of [undefined,{id:'missing',roles:['ADMIN']},{id:'usr-interviewer-1',roles:['ADMIN']}])assert.equal((await service.getReports({viewer})).statusCode,403);
  service.getCandidates=async()=>({candidates:[]});
  const empty=await service.getReports({viewer:{id:'usr-recruiter-1'}});
  assert.equal(empty.report.kpis.avgTimeToHireDays,null);
  assert.equal(empty.report.kpis.offerAcceptanceRate,null);
  assert.equal(empty.report.kpis.fillRatePercent,0);
  assert.ok(empty.report.pipelineFunnel.every(row=>row.percent===null));
  await db.prepare("DELETE FROM role_permissions WHERE permission_id='report-test'").run();
  assert.equal((await service.getReports({viewer:{id:'usr-recruiter-1',roles:['ADMIN']}})).statusCode,403);
  console.log('PASS '+label+' real publication-to-acceptance metrics, scoped data, zero/null, fake actor and revoked grants');
}

(async()=>{
  const db=sqliteBoundary(new DatabaseSync(':memory:'));
  try{await run(db,'SQLite');}finally{db.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();
  const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};
  const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});
  try{await run(pg,'PGlite');}finally{await pg.close();}
  const cards=Object.fromEntries(['report-time-to-hire','report-offer-acceptance','report-fill-rate','report-new-candidates'].map(id=>[id,{textContent:''}]));
  const context=vm.createContext({window:{ATS_API:{getRecruitmentReportsApi:async()=>({ok:true,data:{success:true,report:{kpis:{avgTimeToHireDays:0,offerAcceptanceRate:0,fillRatePercent:0,newCandidatesThisMonth:0}}}})}},sessionStorage:{getItem:()=> 'fixture'},document:{getElementById:id=>cards[id]||null},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/js/pages/reports.js'),'utf8'),context);
  await context.loadReports();
  assert.deepEqual(Object.values(cards).map(row=>row.textContent),['0 ngày','0%','0%','0']);
  console.log('PASS UI zero metrics do not render fabricated defaults');
})().catch(error=>{console.error(error.code,error.message);process.exitCode=1;});
