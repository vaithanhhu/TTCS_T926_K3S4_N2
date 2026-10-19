const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openApplication,cases}=require('./helpers/coverageApplication');
const {test,finish}=cases('CONCURRENCY_SECURITY_AUDIT');
const key=()=>crypto.randomUUID();
const fmtMoney=n=>(n!=null&&!isNaN(n)&&n!=='')?Number(n).toLocaleString('vi-VN'):(n??'0');

async function setup(db,label){
  for(const name of ['migrate-approval-configurations','migrate-requisition-approvals','migrate-headcount-budgets','migrate-requisition-operations','migrate-requisition-lifecycle','migrate-requisition-tracking-job-drafts','migrate-job-publication','migrate-candidate-portal','migrate-requisition-open-policy'])await require('../src/db/'+name).migrate(db);
  const config=require('../src/config/config');
  for(const flag of ['APPROVAL_CONFIGURATION_ENABLED','REQUISITION_APPROVAL_ENABLED','HEADCOUNT_BUDGET_ENABLED','REQUISITION_OPERATIONS_ENABLED','REQUISITION_LIFECYCLE_ENABLED','REQUISITION_TRACKING_ENABLED','JOB_POSTING_DRAFTS_ENABLED','JOB_POSTING_PUBLICATION_ENABLED','CANDIDATE_PORTAL_ENABLED'])config[flag]=true;
  const Rbac=require('../src/middlewares/rbacMiddleware'),rbac=new Rbac(db),users={};
  for(const [name,email]of Object.entries({owner:'hiringmgr@company.com',hr:'hrmanager@company.com',approver:'approver@company.com',admin:'admin@company.com',rec:'recruiter@company.com',interviewer:'interviewer@company.com'})){
    const row=await db.prepare('SELECT id,email FROM users WHERE email=?').get(email);
    users[name]=await rbac.getAuthorizedActor(row.id,'requisition.read');
  }
  const Req=require('../src/services/requisitionService'),Approval=require('../src/services/requisitionApprovalService'),{ApprovalConfigurationService:Configurations}=require('../src/services/approvalConfigurationService'),{HeadcountBudgetService:Budgets}=require('../src/services/headcountBudgetService');
  const req=new Req(db),approval=new Approval(db),configurations=new Configurations(db),budget=new Budgets(db);
  const competency=new(require('../src/services/competencyService'))(db),job=await competency.createJobTitle({code:'CSA-'+label.replace(/\W/g,''),name:'CSA Audit Position',level:'Senior',minSalary:10000000,maxSalary:100000000});assert.equal(job.success,true);
  const catalog=new(require('../src/services/recruitmentCatalogService'))(db),location=await catalog.createItem({type:'WORK_LOCATION',code:'CSA-LOC-'+label.replace(/\W/g,''),name:'CSA Location'}),mode=await catalog.createItem({type:'WORK_MODE',code:'CSA-MOD-'+label.replace(/\W/g,''),name:'CSA Mode'});
  const year=Number(req.businessDate().slice(0,4))+1;
  const neededDate=year+'-01-15';
  const version=await configurations.create({departmentId:'dept-3',levels:[{order:1,salaryLimit:40000000,approverUserId:users.hr.id},{order:2,salaryLimit:100000000,approverUserId:users.approver.id}]},users.hr.id);
  await configurations.publish(version.id,version.versions[0].id,users.hr.id);
  const valid={title:'Audit large position',jobTitleId:job.data.id,departmentId:'dept-3',headcount:100,recruitmentReason:'NEW_HEADCOUNT',proposedSalaryMin:40000000,proposedSalaryMax:50000000,neededDate,jobDescription:'Audit description for large scale budget',candidateRequirements:'Comprehensive requirements',workLocationId:location.data.id,workModeId:mode.data.id};
  const submit=(extra={},actor=users.owner)=>approval.saveAndSubmit({requestId:key(),document:{...valid,...extra}},actor);
  const decision=async(id,action='APPROVE',comment='Audit decision comment')=>{
    const current=await approval.read(id,users.hr),step=current.steps.find(row=>row.status==='PENDING'),actor=Object.values(users).find(row=>row.id===step.approver_id);
    return approval.decide(id,{requestId:key(),expectedVersion:current.version,expectedStepId:step.id,action,comment},actor);
  };
  const complete=async id=>{
    while((await approval.read(id,users.hr)).status==='PENDING')await decision(id);
    return approval.read(id,users.hr);
  };
  return{db,config,users,req,approval,configurations,budget,valid,submit,decision,complete,year,neededDate};
}

async function runCases(s,label){
  const {db,users,req,approval,budget,valid,submit,decision,complete,year,neededDate}=s;
  const rejected=(action,code)=>assert.rejects(action,error=>error.code===code);

  await test(label,'CSA-01','Large-scale quota initialization to 1.000 Headcount and 500.000.000.000 VND',async()=>{
    const saved=await budget.save({departmentId:'dept-3',year,approvedHeadcount:1000,annualSalaryBudget:500000000000,reason:'Initial large scale quota'},users.hr);
    assert.equal(saved.approvedHeadcount,1000);
    assert.equal(saved.annualSalaryBudget,500000000000);
    assert.equal(saved.version,1);
    const current=await budget.current('dept-3',year);
    assert.equal(Number(current.approved_headcount),1000);
    assert.equal(Number(current.annual_salary_budget),500000000000);
    const history=await budget.history('dept-3',year,users.hr);
    assert.equal(history.versions.length,1);
    assert.equal(history.versions[0].approvedHeadcount,1000);
    assert.equal(history.versions[0].annualSalaryBudget,500000000000);
  });

  await test(label,'CSA-02','Large numbers recruitment cost projection and remaining calculation',async()=>{
    const previewData={departmentId:'dept-3',year,headcount:100,proposedSalaryMax:50000000,neededDate};
    const avail=await budget.availability(previewData,users.hr);
    assert.ok(avail.projection);
    assert.equal(avail.projection.months,12);
    assert.equal(avail.projection.annualCost,60000000000);
    assert.equal(avail.projection.remainingHeadcount,1000);
    assert.equal(avail.projection.remainingSalary,500000000000);
    assert.equal(avail.projection.headcountAfter,100);
    assert.equal(avail.projection.salaryAfter,60000000000);
    assert.equal(avail.projection.headcountOver,0);
    assert.equal(avail.projection.salaryOver,0);
  });

  await test(label,'CSA-03','Format vi-VN currency display and warning message fidelity',async()=>{
    assert.equal(fmtMoney(500000000000),'500.000.000.000');
    assert.equal(fmtMoney(440000000000),'440.000.000.000');
    assert.equal(fmtMoney(60000000000),'60.000.000.000');
    const avail=await budget.availability({departmentId:'dept-3',year,headcount:100,proposedSalaryMax:50000000,neededDate},users.hr);
    const p=avail.projection;
    const msg='Chỉ tiêu còn lại: '+p.remainingHeadcount+' headcount (Còn '+p.remainingHeadcount+' headcount / '+fmtMoney(p.remainingSalary)+' VND khả dụng cho yêu cầu này · dự toán '+p.months+' tháng: '+fmtMoney(p.annualCost)+' VND.)';
    assert.ok(msg.includes('Còn 1000 headcount / 500.000.000.000 VND'));
    assert.ok(msg.includes('dự toán 12 tháng: 60.000.000.000 VND'));
  });

  let firstFlow;
  await test(label,'CSA-04','Reservation delta and measure aggregation with large amounts',async()=>{
    const before=await budget.measure('dept-3',year);
    firstFlow=await submit({headcount:100,proposedSalaryMin:40000000,proposedSalaryMax:50000000,neededDate});
    const currentWf=await approval.read(firstFlow.id,users.hr);
    assert.equal(currentWf.status,'PENDING');
    const resRow=await db.prepare('SELECT headcount_delta,salary_delta FROM headcount_budget_reservations WHERE requisition_id=?').get(firstFlow.requisitionId);
    assert.equal(Number(resRow.headcount_delta),100);
    assert.equal(Number(resRow.salary_delta),60000000000);
    const after=await budget.measure('dept-3',year);
    assert.equal(after.usedHeadcount,before.usedHeadcount);
    assert.equal(after.reservedHeadcount-before.reservedHeadcount,100);
    assert.equal(after.reservedSalary-before.reservedSalary,60000000000);
    assert.equal(after.totalHeadcount,100);
    assert.equal(after.totalSalary,60000000000);
  });

  await test(label,'CSA-05','Approval completion releases reservation and establishes participation',async()=>{
    await complete(firstFlow.id);
    const completedWf=await approval.read(firstFlow.id,users.hr);
    assert.equal(completedWf.status,'APPROVED');
    const reqRow=await req.getRequisitionById(firstFlow.requisitionId);
    assert.equal(reqRow.status,'OPEN');
    const resCount=(await db.prepare('SELECT COUNT(*) AS n FROM headcount_budget_reservations WHERE requisition_id=?').get(firstFlow.requisitionId)).n;
    assert.equal(resCount,0);
    const partRow=await db.prepare('SELECT approved FROM headcount_budget_participation WHERE requisition_id=?').get(firstFlow.requisitionId);
    assert.ok(partRow);
    const measure=await budget.measure('dept-3',year);
    assert.equal(measure.usedHeadcount,100);
    assert.equal(measure.usedSalary,60000000000);
    assert.equal(measure.reservedHeadcount,0);
    assert.equal(measure.reservedSalary,0);
    assert.equal(measure.totalHeadcount,100);
    assert.equal(measure.totalSalary,60000000000);
  });

  await test(label,'CSA-06','Concurrent budget updates and pessimistic lock conflict handling',async()=>{
    const cur=await budget.current('dept-3',year);
    const update1=await budget.save({departmentId:'dept-3',year,approvedHeadcount:1000,annualSalaryBudget:500000000000,expectedVersion:cur.version_number,reason:'Version 2 bump'},users.hr);
    assert.equal(update1.version,cur.version_number+1);
    await rejected(()=>budget.save({departmentId:'dept-3',year,approvedHeadcount:1000,annualSalaryBudget:500000000000,expectedVersion:cur.version_number,reason:'Stale update'},users.hr),'BUDGET_VERSION_CONFLICT');
  });

  await test(label,'CSA-07','Large value budget exception workflow and warning message generation',async()=>{
    const overDoc={...valid,headcount:950,proposedSalaryMin:50000000,proposedSalaryMax:60000000,neededDate};
    const avail=await budget.availability(overDoc,users.hr);
    assert.equal(avail.projection.headcountOver,50);
    assert.equal(avail.projection.salaryOver,244000000000);
    const draftOver=await req.createRequisition({...overDoc,status:'DRAFT'},users.owner);
    assert.equal(draftOver.success,true);
    await rejected(()=>approval.submit(draftOver.data.id,{requestId:key(),expectedDraftVersion:draftOver.data.draftVersion},users.owner),'HEADCOUNT_BUDGET_EXCEEDED');
    const cur=await budget.current('dept-3',year);
    const exception=await budget.confirm({requisitionId:draftOver.data.id,document:overDoc,expectedVersion:cur.version_number,reason:'CEO approved large scale expansion'},users.hr);
    assert.equal(exception.headcountOver,50);
    assert.equal(exception.salaryOver,244000000000);
    assert.equal(fmtMoney(exception.salaryOver),'244.000.000.000');
    const submitResult=await approval.submit(draftOver.data.id,{requestId:key(),expectedDraftVersion:draftOver.data.draftVersion},users.owner);
    assert.ok(submitResult.id);
    const wf=await approval.read(submitResult.id,users.hr);
    assert.equal(wf.status,'PENDING');
  });

  await test(label,'CSA-08','Safe integer boundaries and overflow rejection',async()=>{
    await rejected(()=>budget.save({departmentId:'dept-3',year,approvedHeadcount:2147483648,annualSalaryBudget:500000000000},users.hr),'INVALID_BUDGET_LIMIT');
    await rejected(()=>budget.save({departmentId:'dept-3',year,approvedHeadcount:-1,annualSalaryBudget:500000000000},users.hr),'INVALID_BUDGET_LIMIT');
    await rejected(()=>budget.save({departmentId:'dept-3',year,approvedHeadcount:1000,annualSalaryBudget:-5000},users.hr),'INVALID_BUDGET_LIMIT');
    await rejected(()=>budget.projection({departmentId:'dept-3',neededDate,headcount:1000000000,proposedSalaryMax:10000000000000}),'BUDGET_DOCUMENT_INCOMPLETE');
  });

  await test(label,'CSA-09','RBAC authorization, cross-department scope and role enforcement',async()=>{
    await rejected(()=>budget.save({departmentId:'dept-3',year,approvedHeadcount:1000,annualSalaryBudget:500000000000},users.owner),'BUDGET_FORBIDDEN');
    await rejected(()=>budget.save({departmentId:'dept-3',year,approvedHeadcount:1000,annualSalaryBudget:500000000000},users.rec),'BUDGET_FORBIDDEN');
    await rejected(()=>budget.confirm({requisitionId:key(),document:valid,expectedVersion:1,reason:'Unauthorized'},users.owner),'BUDGET_FORBIDDEN');
    await rejected(()=>budget.availability({departmentId:'dept-2',year},users.owner),'BUDGET_OUT_OF_SCOPE');
    await rejected(()=>budget.history('dept-2',year,users.owner),'BUDGET_OUT_OF_SCOPE');
  });

  await test(label,'CSA-10','Immutability of budget versions and exception history records',async()=>{
    const vRow=await db.prepare('SELECT id FROM headcount_budget_versions LIMIT 1').get();
    assert.ok(vRow);
    await assert.rejects(async()=>db.prepare('UPDATE headcount_budget_versions SET reason=? WHERE id=?').run('tampered',vRow.id),/IMMUTABLE/);
    await assert.rejects(async()=>db.prepare('DELETE FROM headcount_budget_versions WHERE id=?').run(vRow.id),/IMMUTABLE/);
    const eRow=await db.prepare('SELECT id FROM headcount_budget_exceptions LIMIT 1').get();
    assert.ok(eRow);
    await assert.rejects(async()=>db.prepare('UPDATE headcount_budget_exceptions SET reason=? WHERE id=?').run('tampered',eRow.id),/IMMUTABLE/);
    await assert.rejects(async()=>db.prepare('DELETE FROM headcount_budget_exceptions WHERE id=?').run(eRow.id),/IMMUTABLE/);
  });
}

(async()=>{
  const app=await openApplication();
  try{
    const fixture=await setup(app.db,'SQLite');
    await runCases(fixture,'SQLITE');
  }finally{
    await app.close();
  }
  const {PGlite}=require('@electric-sql/pglite'),{PostgresDatabase,pgTypes}=require('../src/db/postgres'),engine=new PGlite();
  let tail=Promise.resolve();
  const query=async(sql,params)=>{
    const z=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);
    return{
      rows:(z?.rows||[]).map(row=>Object.fromEntries(Object.entries(row).map(([name,value])=>{
        const type=z.fields.find(f=>f.name===name)?.dataTypeID;
        return[name,value instanceof Date?(type===1082?value.toISOString().slice(0,10):value.toISOString()):typeof value==='string'&&[20,1700].includes(type)?pgTypes().getTypeParser(type)(value):value];
      }))),
      rowCount:z?.affectedRows||z?.rows?.length||0
    };
  };
  const pgDb=new PostgresDatabase({},{on(){},query,async connect(){
    const before=tail;let release;
    tail=new Promise(resolve=>release=resolve);
    await before;
    return{query,release};
  },async end(){await engine.close();}});
  try{
    await require('../src/db/migrate-postgres').migrate(pgDb);
    await pgDb.transaction(()=>require('../src/db/seed').seedDatabase(pgDb));
    const pgFixture=await setup(pgDb,'PGlite');
    await runCases(pgFixture,'PGLITE');
  }finally{
    await pgDb.close();
  }
  finish();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
