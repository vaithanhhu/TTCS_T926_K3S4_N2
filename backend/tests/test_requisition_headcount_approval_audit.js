const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openApplication,cases}=require('./helpers/coverageApplication');
const {test,finish}=cases('REQUISITION_AUDIT_FIXES');
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
  const req=new Req(db),approval=new Approval(db),configurations=new Configurations(db),budget=new Budgets(db);
  const competency=new(require('../src/services/competencyService'))(db),job=await competency.createJobTitle({code:'AUDIT-JOB',name:'Audit Engineer',level:'Senior',minSalary:100,maxSalary:1000});assert.equal(job.success,true);
  const catalog=new(require('../src/services/recruitmentCatalogService'))(db),location=await catalog.createItem({type:'WORK_LOCATION',code:'AUDIT-LOC',name:'Audit Office'}),mode=await catalog.createItem({type:'WORK_MODE',code:'AUDIT-MODE',name:'Audit Mode'});
  const neededDate=req.businessDate(new Date(Date.now()+60*86400000)),year=Number(neededDate.slice(0,4));
  const version=await configurations.create({departmentId:'dept-3',levels:[{order:1,salaryLimit:500,approverUserId:users.hr.id},{order:2,salaryLimit:1000,approverUserId:users.approver.id}]},users.hr.id);
  await configurations.publish(version.id,version.versions[0].id,users.hr.id);
  const valid={title:'Audit position',jobTitleId:job.data.id,departmentId:'dept-3',headcount:2,recruitmentReason:'NEW_HEADCOUNT',proposedSalaryMin:200,proposedSalaryMax:400,neededDate,jobDescription:'Detailed job description for audit',candidateRequirements:'Comprehensive requirements for audit',workLocationId:location.data.id,workModeId:mode.data.id};
  return{db,config,users,req,approval,configurations,budget,valid,year,neededDate,job};
}

async function run(s,label){
  const {db,users,req,approval,budget,valid,year,neededDate}=s;
  const rejected=(action,code)=>assert.rejects(action,error=>error.code===code);

  await test(label,'BUG-01','Headcount availability excludes self requisition and does not hardcode',async()=>{
    await budget.save({departmentId:'dept-3',year,approvedHeadcount:7,annualSalaryBudget:10000000},users.hr);
    const existing=await require('./helpers/approvalPolicyFixture').createApproved(db,{...valid,headcount:7},users.owner);
    assert.equal(existing.success,true);
    const availWithSelf=await budget.availability({departmentId:'dept-3',year,requisitionId:existing.data.id},users.hr);
    assert.equal(availWithSelf.remainingHeadcount,7);
    assert.equal(availWithSelf.usedHeadcount,0);
    const availWithoutSelf=await budget.availability({departmentId:'dept-3',year},users.hr);
    assert.equal(availWithoutSelf.remainingHeadcount,0);
    assert.equal(availWithoutSelf.totalHeadcount,7);
  });

  await test(label,'BUG-02','Warning message format and real-time distinct warnings for headcount and budget',async()=>{
    const previewData={departmentId:'dept-3',year,headcount:9,proposedSalaryMax:400,neededDate};
    const avail=await budget.availability(previewData,users.hr);
    assert.ok(avail.projection);
    assert.ok(avail.projection.headcountOver>0);
    const remainingHeadcount=avail.projection.remainingHeadcount;
    const reqHeadcount=Number(previewData.headcount);
    const headcountOver=avail.projection.headcountOver;
    const isHeadcountOver=headcountOver>0;
    assert.equal(isHeadcountOver,true);
    const formatted='Chỉ tiêu còn lại: '+remainingHeadcount+' headcount (Còn '+remainingHeadcount+' headcount / '+avail.projection.remainingSalary+' VND khả dụng cho yêu cầu này · dự toán '+avail.projection.months+' tháng: '+avail.projection.annualCost+' VND.) · Cảnh báo vượt chỉ tiêu định biên: Số lượng yêu cầu ('+reqHeadcount+') vượt quá chỉ tiêu còn lại ('+remainingHeadcount+'). Vượt '+headcountOver+' người (Chỉ tiêu đã duyệt: '+avail.approvedHeadcount+').';
    assert.ok(formatted.includes('Chỉ tiêu còn lại:'));
    assert.ok(formatted.includes('Cảnh báo vượt chỉ tiêu định biên'));
    assert.ok(formatted.includes('Vượt '+headcountOver+' người'));
  });

  await test(label,'BUG-03','Direct transition from DRAFT to OPEN via updateRequisition is strictly blocked',async()=>{
    const draft=await req.createRequisition({...valid,status:'DRAFT'},users.owner);
    assert.equal(draft.success,true);
    await rejected(()=>req.updateRequisition(draft.data.id,{status:'OPEN'},users.owner),'REQUISITION_APPROVAL_REQUIRED');
    const adminAttempt=await req.updateRequisition(draft.data.id,{status:'OPEN'},users.admin);
    assert.equal(adminAttempt.code,'REQUISITION_DRAFT_FORBIDDEN');
    const adminDraft=await req.createRequisition({...valid,status:'DRAFT'},users.admin);
    assert.equal(adminDraft.success,true);
    await rejected(()=>req.updateRequisition(adminDraft.data.id,{status:'OPEN'},users.admin),'REQUISITION_APPROVAL_REQUIRED');
    const checked=await req.getRequisitionById(draft.data.id);
    assert.equal(checked.status,'DRAFT');
  });

  let submittedWorkflowId,submittedReqId;
  await test(label,'BUG-04','Submit draft to approval workflow and filter by PENDING_APPROVAL',async()=>{
    await budget.save({departmentId:'dept-3',year,approvedHeadcount:20,annualSalaryBudget:50000000,expectedVersion:1,reason:'Quota expansion for approval'},users.hr);
    const draft=await req.createRequisition({...valid,status:'DRAFT'},users.owner);
    assert.equal(draft.success,true);
    submittedReqId=draft.data.id;
    const submitted=await approval.submit(draft.data.id,{requestId:key(),expectedDraftVersion:draft.data.draftVersion},users.owner);
    assert.ok(submitted.id);
    submittedWorkflowId=submitted.id;
    const readWf=await approval.read(submitted.id,users.hr);
    assert.equal(readWf.status,'PENDING');
    const list=await req.getRequisitions({status:'PENDING_APPROVAL',viewer:users.owner,approvalEnabled:true});
    assert.ok(list.items.some(item=>item.id===submittedReqId));
    const allDrafts=await req.getRequisitions({status:'DRAFT',viewer:users.owner,approvalEnabled:true});
    const found=allDrafts.items.find(item=>item.id===submittedReqId);
    assert.ok(found);
    assert.equal(found.approvalStatus,'PENDING');
  });

  await test(label,'BUG-05','Rejection requires mandatory non-empty comment, updates to REJECTED, and releases reservation',async()=>{
    const readWf=await approval.read(submittedWorkflowId,users.hr);
    const step=readWf.steps.find(s=>s.status==='PENDING');
    await rejected(()=>approval.decide(submittedWorkflowId,{action:'REJECT',comment:'',requestId:key(),expectedVersion:readWf.version,expectedStepId:step.id},users.hr),'APPROVAL_COMMENT_REQUIRED');
    await rejected(()=>approval.decide(submittedWorkflowId,{action:'REJECT',comment:'   ',requestId:key(),expectedVersion:readWf.version,expectedStepId:step.id},users.hr),'APPROVAL_COMMENT_REQUIRED');
    const rejectComment='Rejecting requisition due to quarterly headcount restructuring';
    const decisionResult=await approval.decide(submittedWorkflowId,{action:'REJECT',comment:rejectComment,requestId:key(),expectedVersion:readWf.version,expectedStepId:step.id},users.hr);
    assert.equal(decisionResult.status,'REJECTED');
    const afterReject=await approval.read(submittedWorkflowId,users.hr);
    assert.equal(afterReject.status,'REJECTED');
    const reservations=await db.prepare('SELECT COUNT(*) AS count FROM headcount_budget_reservations WHERE requisition_id=?').get(submittedReqId);
    assert.equal(reservations.count,0);
    const rejectEvent=await db.prepare('SELECT action,comment,actor_id FROM requisition_approval_events WHERE workflow_id=? AND action=?').get(submittedWorkflowId,'REJECT');
    assert.ok(rejectEvent);
    assert.equal(rejectEvent.comment,rejectComment);
    assert.equal(rejectEvent.actor_id,users.hr.id);
  });

  await test(label,'BUG-06','Draft validation allows partial fields whereas submit validation requires all mandatory fields',async()=>{
    const partialDraft=await req.createRequisition({formVersion:'S2-10',status:'DRAFT',title:'Partial draft',departmentId:'dept-3'},users.owner);
    assert.equal(partialDraft.success,true);
    assert.equal(partialDraft.data.status,'DRAFT');
    await rejected(()=>approval.submit(partialDraft.data.id,{requestId:key(),expectedDraftVersion:partialDraft.data.draftVersion},users.owner),'MISSING_REQUISITION_FIELD');
  });

  await test(label,'BUG-07','Audit history and approval events are strictly immutable at trigger level',async()=>{
    const eventRow=await db.prepare('SELECT id FROM requisition_approval_events LIMIT 1').get();
    assert.ok(eventRow);
    await assert.rejects(async()=>db.prepare('UPDATE requisition_approval_events SET comment=? WHERE id=?').run('Tampered comment',eventRow.id),/IMMUTABLE/);
    await assert.rejects(async()=>db.prepare('DELETE FROM requisition_approval_events WHERE id=?').run(eventRow.id),/IMMUTABLE/);
    const submissionRow=await db.prepare('SELECT id FROM requisition_approval_submissions LIMIT 1').get();
    assert.ok(submissionRow);
    await assert.rejects(async()=>db.prepare('UPDATE requisition_approval_submissions SET document_json=? WHERE id=?').run('{}',submissionRow.id),/IMMUTABLE/);
    await assert.rejects(async()=>db.prepare('DELETE FROM requisition_approval_submissions WHERE id=?').run(submissionRow.id),/IMMUTABLE/);
    const budgetVersionRow=await db.prepare('SELECT id FROM headcount_budget_versions LIMIT 1').get();
    assert.ok(budgetVersionRow);
    await assert.rejects(async()=>db.prepare('UPDATE headcount_budget_versions SET reason=? WHERE id=?').run('Tampered reason',budgetVersionRow.id),/IMMUTABLE/);
    await assert.rejects(async()=>db.prepare('DELETE FROM headcount_budget_versions WHERE id=?').run(budgetVersionRow.id),/IMMUTABLE/);
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
