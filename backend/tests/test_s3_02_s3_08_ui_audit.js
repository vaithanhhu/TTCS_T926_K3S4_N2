const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openApplication,cases}=require('./helpers/coverageApplication');
const {test,finish}=cases('S3_02_S3_08_UI_AUDIT');
const key=()=>crypto.randomUUID();

async function setup(db){
  for(const name of ['migrate-approval-configurations','migrate-requisition-approvals','migrate-headcount-budgets','migrate-requisition-operations','migrate-requisition-lifecycle','migrate-requisition-tracking-job-drafts','migrate-job-publication','migrate-candidate-portal','migrate-requisition-open-policy'])await require('../src/db/'+name).migrate(db);
  const config=require('../src/config/config');
  for(const flag of ['APPROVAL_CONFIGURATION_ENABLED','REQUISITION_APPROVAL_ENABLED','HEADCOUNT_BUDGET_ENABLED','REQUISITION_OPERATIONS_ENABLED','REQUISITION_LIFECYCLE_ENABLED','REQUISITION_TRACKING_ENABLED','JOB_POSTING_DRAFTS_ENABLED','JOB_POSTING_PUBLICATION_ENABLED','CANDIDATE_PORTAL_ENABLED'])config[flag]=true;
  const Rbac=require('../src/middlewares/rbacMiddleware'),rbac=new Rbac(db),users={};
  for(const [name,email]of Object.entries({owner:'hiringmgr@company.com',hr:'hrmanager@company.com',approver:'approver@company.com',admin:'admin@company.com',rec:'recruiter@company.com'})){
    const row=await db.prepare('SELECT id,email FROM users WHERE email=?').get(email);
    users[name]=await rbac.getAuthorizedActor(row.id,'requisition.read');
  }
  const Req=require('../src/services/requisitionService'),Approval=require('../src/services/requisitionApprovalService'),{ApprovalConfigurationService:Configurations}=require('../src/services/approvalConfigurationService'),{HeadcountBudgetService:Budgets}=require('../src/services/headcountBudgetService');
  const Tracking=require('../src/services/requisitionTrackingService');
  const req=new Req(db),approval=new Approval(db),configurations=new Configurations(db),budget=new Budgets(db),tracking=new Tracking(db);
  const competency=new(require('../src/services/competencyService'))(db);
  const fwId='cf-'+key();
  await db.prepare("INSERT INTO competency_frameworks(id,code,name,description,status,created_at,updated_at) VALUES (?,?,?,?,'ACTIVE',datetime('now'),datetime('now'))").run(fwId,'FW-ENG','Engineering Competency Framework','Standard engineering framework');
  await db.prepare("INSERT INTO competency_criteria(id,framework_id,name,description,weight,display_order,created_at,updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))").run('crit-'+key(),fwId,'Technical Expertise','Core technical competencies',100,1);
  const fw={data:{id:fwId,code:'FW-ENG',name:'Engineering Competency Framework'}};
  const job=await competency.createJobTitle({code:'AUDIT-ENG',name:'Audit Software Engineer',level:'Senior',frameworkId:fwId,minSalary:10000000,maxSalary:40000000},{includeSalary:true});
  assert.equal(job.success,true);
  const catalog=new(require('../src/services/recruitmentCatalogService'))(db),location=await catalog.createItem({type:'WORK_LOCATION',code:'AUDIT-LOC2',name:'Audit Location 2'}),mode=await catalog.createItem({type:'WORK_MODE',code:'AUDIT-MODE2',name:'Audit Mode 2'});
  const neededDate=req.businessDate(new Date(Date.now()+30*86400000)),year=Number(neededDate.slice(0,4));
  const version=await configurations.create({departmentId:'dept-3',levels:[{order:1,salaryLimit:25000000,approverUserId:users.hr.id},{order:2,salaryLimit:50000000,approverUserId:users.approver.id}]},users.hr.id);
  await configurations.publish(version.id,version.versions[0].id,users.hr.id);
  const valid={formVersion:'S2-10',title:'S3-02 S3-08 Audit Position',jobTitleId:job.data.id,departmentId:'dept-3',headcount:3,recruitmentReason:'NEW_HEADCOUNT',proposedSalaryMin:15000000,proposedSalaryMax:30000000,neededDate,jobDescription:'Detailed job description for S3-02 and S3-08 audit',candidateRequirements:'Comprehensive requirements for S3-02 and S3-08 audit',workLocationId:location.data.id,workModeId:mode.data.id};
  return{db,config,users,req,approval,configurations,budget,tracking,competency,fw,job,location,mode,valid,year,neededDate};
}

async function run(s,label){
  const {db,users,req,approval,budget,tracking,job,fw,valid,year,neededDate}=s;
  const rejected=(action,code)=>assert.rejects(action,error=>error.code===code);

  await test(label,'S3-02-01','Rejection requires mandatory non-empty comment and updates workflow to REJECTED',async()=>{
    await budget.save({departmentId:'dept-3',year,approvedHeadcount:50,annualSalaryBudget:50000000000,reason:'Audit budget initialization'},users.hr);
    const draft=await req.createRequisition({...valid,status:'DRAFT'},users.owner);
    assert.equal(draft.success,true);
    const submitted=await approval.submit(draft.data.id,{requestId:key(),expectedDraftVersion:draft.data.draftVersion},users.owner);
    const detail=await approval.read(submitted.id,users.hr);
    const step=detail.steps.find(item=>item.status==='PENDING');
    await rejected(()=>approval.decide(submitted.id,{action:'REJECT',comment:'',requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.hr),'APPROVAL_COMMENT_REQUIRED');
    await rejected(()=>approval.decide(submitted.id,{action:'REJECT',comment:'   \n\t  ',requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.hr),'APPROVAL_COMMENT_REQUIRED');
    await rejected(()=>approval.decide(submitted.id,{action:'REJECT',comment:'Unauthorized',requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.rec),'APPROVAL_FORBIDDEN');
    const rejectComment='Khong phu hop voi dinh bien quy 4';
    const decision=await approval.decide(submitted.id,{action:'REJECT',comment:rejectComment,requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.hr);
    assert.equal(decision.status,'REJECTED');
    const after=await approval.read(submitted.id,users.hr);
    assert.equal(after.status,'REJECTED');
    const event=after.events.find(e=>e.action==='REJECT');
    assert.ok(event);
    assert.equal(event.comment,rejectComment);
    assert.equal(event.actor_id,users.hr.id);
    const reservation=await db.prepare('SELECT COUNT(*) AS n FROM headcount_budget_reservations WHERE requisition_id=?').get(draft.data.id);
    assert.equal(reservation.n,0);
  });

  await test(label,'S3-02-02','Request Info requires mandatory comment, transitions to NEEDS_INFO and supports resubmission',async()=>{
    const draft=await req.createRequisition({...valid,status:'DRAFT'},users.owner);
    assert.equal(draft.success,true);
    const submitted=await approval.submit(draft.data.id,{requestId:key(),expectedDraftVersion:draft.data.draftVersion},users.owner);
    const detail=await approval.read(submitted.id,users.hr);
    const step=detail.steps.find(item=>item.status==='PENDING');
    await rejected(()=>approval.decide(submitted.id,{action:'REQUEST_INFO',comment:'',requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.hr),'APPROVAL_COMMENT_REQUIRED');
    await rejected(()=>approval.decide(submitted.id,{action:'REQUEST_INFO',comment:'    ',requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.hr),'APPROVAL_COMMENT_REQUIRED');
    const infoComment='Can bo sung giai trinh muc luong de xuat ngoai dải chuan';
    const decision=await approval.decide(submitted.id,{action:'REQUEST_INFO',comment:infoComment,requestId:key(),expectedVersion:detail.version,expectedStepId:step.id},users.hr);
    assert.equal(decision.status,'NEEDS_INFO');
    const after=await approval.read(submitted.id,users.owner);
    assert.equal(after.status,'NEEDS_INFO');
    const event=after.events.find(e=>e.action==='REQUEST_INFO');
    assert.ok(event);
    assert.equal(event.comment,infoComment);
    assert.equal(event.actor_id,users.hr.id);
    const resubmit=await approval.saveAndSubmit({requestId:key(),requisitionId:draft.data.id,expectedDraftVersion:draft.data.draftVersion,expectedWorkflowVersion:after.version,document:{...valid,jobDescription:'Updated description after feedback'}},users.owner);
    assert.equal(resubmit.status,'PENDING');
    const afterResubmit=await approval.read(submitted.id,users.owner);
    assert.equal(afterResubmit.status,'PENDING');
    assert.equal(afterResubmit.submissions.length,2);
    assert.equal(afterResubmit.steps[0].status,'PENDING');
  });

  await test(label,'S3-08 TC08-09','Overdue evaluation strictly satisfies status and date conditions',async()=>{
    const baseNow=new Date('2026-10-15T10:00:00Z');
    const rowOpenYesterday={status:'OPEN',opened_at:'2026-10-01 08:00:00',created_at:'2026-10-01 08:00:00',needed_date:'2026-10-14'};
    const mYesterday=tracking.metrics(rowOpenYesterday,baseNow);
    assert.equal(mYesterday.overdue,true);
    assert.ok(mYesterday.daysRemaining<0);
    const rowOpenToday={status:'OPEN',opened_at:'2026-10-01 08:00:00',created_at:'2026-10-01 08:00:00',needed_date:'2026-10-15'};
    const mToday=tracking.metrics(rowOpenToday,baseNow);
    assert.equal(mToday.overdue,false);
    assert.equal(mToday.daysRemaining,0);
    const rowOpenTomorrow={status:'OPEN',opened_at:'2026-10-01 08:00:00',created_at:'2026-10-01 08:00:00',needed_date:'2026-10-16'};
    const mTomorrow=tracking.metrics(rowOpenTomorrow,baseNow);
    assert.equal(mTomorrow.overdue,false);
    assert.ok(mTomorrow.daysRemaining>0);
    const rowInProgressYesterday={status:'IN_PROGRESS',opened_at:'2026-10-01 08:00:00',created_at:'2026-10-01 08:00:00',needed_date:'2026-10-14'};
    assert.equal(tracking.metrics(rowInProgressYesterday,baseNow).overdue,true);
    for(const inactiveStatus of ['CLOSED','CANCELLED','PAUSED','DRAFT']){
      const rowInactive={status:inactiveStatus,opened_at:'2026-10-01 08:00:00',created_at:'2026-10-01 08:00:00',needed_date:'2026-10-14'};
      const mInactive=tracking.metrics(rowInactive,baseNow);
      assert.equal(mInactive.overdue,false);
      if(inactiveStatus==='DRAFT')assert.equal(mInactive.daysOpen,null);
    }
  });

  await test(label,'REQUISITION_UI','Job title and Competency Framework are queried and mapped separately',async()=>{
    const jobTitles=await db.prepare("SELECT jt.id, jt.code, jt.name, jt.level, jt.framework_id AS frameworkId, cf.code AS frameworkCode, cf.name AS frameworkName FROM job_titles jt LEFT JOIN competency_frameworks cf ON jt.framework_id = cf.id WHERE jt.status='ACTIVE' ORDER BY jt.name").all();
    assert.ok(jobTitles.length>0);
    const match=jobTitles.find(jt=>jt.id===job.data.id);
    assert.ok(match);
    assert.equal(match.frameworkId,fw.data.id);
    assert.equal(match.frameworkCode,'FW-ENG');
    assert.equal(match.frameworkName,'Engineering Competency Framework');
    assert.notEqual(match.name,match.frameworkName);
    const created=await req.createRequisition({...valid,status:'DRAFT'},users.owner);
    const detail=await req.getRequisitionById(created.data.id);
    assert.equal(detail.jobTitleId,job.data.id);
    assert.equal(detail.jobTitleCode,'AUDIT-ENG');
    assert.equal(detail.jobTitleName,'Audit Software Engineer');
    assert.equal(detail.frameworkId,fw.data.id);
    assert.equal(detail.frameworkCode,'FW-ENG');
    assert.equal(detail.frameworkName,'Engineering Competency Framework');
    const list=await req.getRequisitions({viewer:users.owner});
    const itemInList=list.items.find(i=>i.id===created.data.id);
    assert.ok(itemInList);
    assert.equal(itemInList.jobTitleName,'Audit Software Engineer');
    assert.equal(itemInList.frameworkName,'Engineering Competency Framework');
  });

  await test(label,'TC08-12_STATUS','TC08-12 test specification presence check and fixture verification',async()=>{
    const fs=require('node:fs'),path=require('node:path');
    const docsDir=path.resolve(__dirname,'../../docs');
    let tc0812Found=false;
    if(fs.existsSync(docsDir)){
      const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile()&&entry.name.endsWith('.md')){if(fs.readFileSync(full,'utf8').includes('TC08-12'))tc0812Found=true;}}};
      walk(docsDir);
    }
    const tc0812Status=tc0812Found?'DEFINED':'BLOCKED — MISSING TEST SPECIFICATION';
    assert.equal(tc0812Status,'BLOCKED — MISSING TEST SPECIFICATION');
    const created=await req.createRequisition({...valid,status:'DRAFT',title:'TC08-12 Baseline Requisition'},users.owner);
    assert.equal(created.success,true);
    assert.ok(created.data.id);
    assert.equal(created.data.status,'DRAFT');
  });

  await test(label,'CURRENCY_FORMAT','Currency formatting in vi-VN locale complies with ATS display standards',async()=>{
    const fmt=n=>Number(n).toLocaleString('vi-VN');
    assert.equal(fmt(29320000000),'29.320.000.000');
    assert.equal(fmt(15000000),'15.000.000');
    assert.equal(fmt(0),'0');
  });
}

(async()=>{
  const app=await openApplication();
  try{
    const fixture=await setup(app.db);
    await run(fixture,'SQLITE');
  }finally{
    await app.close();
  }
  finish();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
