const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-wal','backend/data/ats.db-shm','backend/data/ats_test.db'])assert.equal(fs.existsSync(path.join(root,file)),false,'Fresh isolated copy required');
for(const name of Object.keys(process.env))if(/^(ATS_POSTGRES_|SMTP_|MAIL_|GOOGLE_OAUTH_|DATABASE_|DB_|PG|EMAIL_|APPROVAL_|REQUISITION_APPROVAL_)/.test(name))delete process.env[name];
Object.assign(process.env,{NODE_ENV:'test',DB_PROVIDER:'sqlite',EMAIL_MODE:'simulated'});
const {openApplication}=require('./helpers/coverageApplication');
const Requisitions=require('../src/services/requisitionService');
const Rbac=require('../src/middlewares/rbacMiddleware');
const {ROLE_PERMISSIONS,synchronizePermissions}=require('../src/db/sync-permissions');
const roles={ADMIN:'usr-admin',HR_MANAGER:'usr-hr-mgr',HIRING_MGR:'usr-hiring-mgr',RECRUITER:'usr-recruiter',INTERVIEWER:'usr-interviewer',APPROVER:'usr-approver',CANDIDATE:'usr-candidate'};
let passed=0,failed=0;
async function test(name,action){try{await action();passed++;console.log('[PASS] '+name);}catch(error){failed++;console.error('[FAIL] '+name+'\n'+error.stack);}}
async function storageCases(db,label){
  const rbac=new Rbac(db),service=new Requisitions(db);
  const actor=role=>({id:roles[role],roles:[role],email:role==='CANDIDATE'?'candidate@example.com':role.toLowerCase()+'@example.test'});
  for(const [role,id]of Object.entries(roles))await test(label+' canonical grants '+role,async()=>{
    const actual=await rbac.getUserPermissions(id);
    if(role==='ADMIN')assert.deepEqual(actual,(await db.prepare('SELECT code FROM permissions ORDER BY code').all()).map(row=>row.code));
    else assert.deepEqual(actual,[...ROLE_PERMISSIONS[role]].sort());
  });
  await test(label+' seed and sync preserve legitimate module grants and revoke forbidden legacy grants',async()=>{
    await db.prepare("INSERT INTO permissions(id,code,name,module) VALUES('test-preserved','test.module.read','Preserved','TEST')").run();
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT id,'test-preserved' FROM roles WHERE code='RECRUITER'").run();
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='candidate.update' WHERE r.code='HIRING_MGR' ON CONFLICT DO NOTHING").run();
    await synchronizePermissions(db);assert.equal(await rbac.hasPermission(roles.HIRING_MGR,'candidate.update'),false);assert.equal(await rbac.hasPermission(roles.RECRUITER,'test.module.read'),true);
    const first=await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all();await synchronizePermissions(db);assert.deepEqual(await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all(),first);
    await db.transaction(()=>require('../src/db/seed').seedDatabase(db));assert.deepEqual(await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all(),first);
  });
  const hr=actor('HR_MANAGER'),hiring=actor('HIRING_MGR'),admin=actor('ADMIN');
  const title=await new (require('../src/services/competencyService'))(db).createJobTitle({code:'FINAL-'+label.replace(/\W/g,''),name:'Final title',level:'Senior',minSalary:10000000,maxSalary:50000000});assert.equal(title.success,true);
  const valid={formVersion:'S2-10',jobTitleId:title.data.id,departmentId:'dept-3',headcount:2,recruitmentReason:'REPLACEMENT',proposedSalaryMin:15000000,proposedSalaryMax:30000000,neededDate:service.businessDate(),jobDescription:'Original document',candidateRequirements:'Original requirements',recruiterId:'usr-recruiter'};
  const request=await service.createRequisition({...valid,recruiterId:null},hiring);assert.equal(request.success,true);const id=request.data.id;assert.equal((await service.updateRequisition(id,{recruiterId:'usr-recruiter'},hr)).success,true);
  await test(label+' OPEN operational note updates directly without altering significant content',async()=>{
    const before=await service.getRequisitionById(id);const result=await service.updateRequisition(id,{handoverNotes:'Operational note'},hiring);assert.equal(result.success,true);
    const after=await service.getRequisitionById(id);assert.equal(after.handoverNotes,'Operational note');for(const field of ['jobTitleId','departmentId','headcount','proposedSalaryMax','jobDescription'])assert.equal(after[field],before[field]);
  });
  await test(label+' important OPEN fields require reapproval with no main row changes',async()=>{
    for(const changes of [{headcount:3},{jobDescription:'Revised document'},{proposedSalaryMax:40000000},{neededDate:service.businessDate()}]){
      if(changes.neededDate)changes.neededDate=new Date(Date.parse(changes.neededDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);
      const before=await service.getRequisitionById(id);const result=await service.updateRequisition(id,changes,hiring);assert.equal(result.statusCode,409);assert.equal(result.code,'REQUISITION_REAPPROVAL_REQUIRED');assert.deepEqual(await service.getRequisitionById(id),before);
    }
  });
  await test(label+' protected fields and recruiter reassignment cannot be forged by Hiring Manager',async()=>{
    for(const changes of [{createdBy:roles.ADMIN},{hiringManagerId:roles.ADMIN},{recruiterId:'usr-recruiter-2'}])assert.equal((await service.updateRequisition(id,changes,hiring)).statusCode,403);
  });
  await test(label+' HR and ADMIN retain metadata access while significant edits require approval',async()=>{
    for(const user of [hr,admin]){assert.equal((await service.updateRequisition(id,{handoverNotes:user.id},user)).success,true);assert.equal((await service.updateRequisition(id,{headcount:4},user)).code,'REQUISITION_REAPPROVAL_REQUIRED');}
  });
  await test(label+' IN_PROGRESS and CLOSED block content edits for every editing role',async()=>{
    for(const state of ['IN_PROGRESS','CLOSED']){await db.prepare('UPDATE requisitions SET status=? WHERE id=?').run(state,id);for(const user of [hiring,hr,admin])assert.equal((await service.updateRequisition(id,{handoverNotes:'Denied'},user)).code,'REQUISITION_EDIT_STATE_FORBIDDEN');}
    await db.prepare("UPDATE requisitions SET status='OPEN' WHERE id=?").run(id);
  });
  await test(label+' foreign owner and role without edit permission remain forbidden',async()=>{
    const foreign=await service.createRequisition({...valid,departmentId:'dept-2'},hr);assert.equal(foreign.success,true);
    assert.equal((await service.updateRequisition(foreign.data.id,{handoverNotes:'Denied'},hiring)).code,'REQUISITION_OUT_OF_SCOPE');
    assert.equal((await service.updateRequisition(id,{handoverNotes:'Denied'},actor('APPROVER'))).statusCode,403);
  });
  await test(label+' DRAFT completion and creator-only protection remain unchanged',async()=>{
    const draft=await service.createRequisition({...valid,status:'DRAFT',recruiterId:null},hiring);assert.equal(draft.success,true);
    assert.equal((await service.updateRequisition(draft.data.id,{jobDescription:'Draft revision'},hiring)).success,true);
    assert.equal((await service.updateRequisition(draft.data.id,{jobDescription:'Denied'},hr)).code,'REQUISITION_DRAFT_FORBIDDEN');
    assert.equal((await service.updateRequisition(draft.data.id,{status:'OPEN'},hiring)).success,true);
  });
}
async function main(){
  const app=await openApplication();
  try{
    await storageCases(app.db,'SQLite');
    const sessions={};for(const [role,email]of Object.entries({ADMIN:'admin@company.com',HR_MANAGER:'hrmanager@company.com',HIRING_MGR:'hiringmgr@company.com',RECRUITER:'recruiter@company.com',INTERVIEWER:'interviewer@company.com',APPROVER:'approver@company.com',CANDIDATE:'candidate@example.com'}))sessions[role]=await app.login(email);
    await test('HTTP new matrix has no read-to-write escalation and keeps HR-only standard salary',async()=>{
      for(const role of ['HIRING_MGR','RECRUITER','INTERVIEWER','APPROVER']){const res=await app.api('GET','/job-titles',sessions[role].token);assert.equal(res.status,200);assert.equal(JSON.stringify(res.data).includes('minSalary'),false);assert.equal((await app.api('POST','/job-titles',sessions[role].token,{})).status,403);}
      assert.equal((await app.api('GET','/admin/audit-logs',sessions.HR_MANAGER.token)).status,200);
      for(const role of ['INTERVIEWER','CANDIDATE'])for(const route of ['/requisitions','/dashboard/stats','/reports/recruitment'])assert.equal((await app.api('GET',route,sessions[role].token)).status,403);
      for(const role of ['HIRING_MGR','INTERVIEWER','APPROVER','CANDIDATE'])assert.equal((await app.api('PUT','/candidates/cand-001/stage',sessions[role].token,{stage:'SCREENING'})).status,403);
      for(const role of ['RECRUITER','HR_MANAGER'])assert.equal((await app.api('PUT','/candidates/cand-001/stage',sessions[role].token,{stage:'SCREENING'})).status,200);
    });
    await test('HTTP evaluation and scheduling have separate permissions and assignee scope',async()=>{
      assert.equal((await app.api('GET','/interviews',sessions.APPROVER.token)).status,403);assert.equal((await app.api('GET','/interview-evaluations',sessions.APPROVER.token)).status,200);
      assert.equal((await app.api('PUT','/interviews/int-001/status',sessions.HIRING_MGR.token,{status:'COMPLETED',feedback:'Denied',score:9})).status,403);
      assert.equal((await app.api('PUT','/interviews/int-003/status',sessions.INTERVIEWER.token,{status:'COMPLETED',feedback:'Denied',score:9})).status,403);
      assert.equal((await app.api('PUT','/interviews/int-001/status',sessions.INTERVIEWER.token,{status:'COMPLETED',feedback:'Assigned evaluation',score:9})).status,200);
      assert.equal((await app.api('PUT','/interviews/int-001/status',sessions.RECRUITER.token,{status:'CANCELLED'})).status,200);
      assert.equal((await app.api('PUT','/interviews/int-001/status',sessions.RECRUITER.token,{status:'COMPLETED',score:9})).status,403);
    });
    await test('HTTP recruiter Offer writes cannot escape assigned requisition',async()=>{
      const own=await app.api('POST','/offers',sessions.RECRUITER.token,{candidateId:'cand-001',startDate:'2027-01-01',salaryMonthly:20000000,approverId:'usr-approver'});assert.equal(own.status,201);
      assert.equal((await app.api('POST','/offers',sessions.RECRUITER.token,{candidateId:'cand-003',startDate:'2027-01-01',salaryMonthly:20000000})).status,403);
      assert.equal((await app.api('PUT','/offers/'+own.data.data.id+'/status',sessions.RECRUITER.token,{status:'APPROVED'})).status,403);
      assert.equal((await app.api('PUT','/offers/'+own.data.data.id+'/status',sessions.APPROVER.token,{status:'APPROVED'})).status,200);
    });
  }finally{await app.close();}
  const {PGlite}=require('@electric-sql/pglite'),{PostgresDatabase}=require('../src/db/postgres'),engine=new PGlite();
  const query=async(sql,params)=>{const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:(result?.rows||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?(result.fields.find(field=>field.name===key)?.dataTypeID===1082?value.toISOString().slice(0,10):value.toISOString()):typeof value==='bigint'?Number(value):value]))),rowCount:result?.affectedRows||result?.rows?.length||0};};
  const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});
  try{await require('../src/db/migrate-postgres').migrate(pg);await pg.transaction(()=>require('../src/db/seed').seedDatabase(pg));await storageCases(pg,'PostgreSQL embedded');}finally{await pg.close();}
  console.log('FINAL_RBAC_OPEN_RESULT '+JSON.stringify({passed,failed,total:passed+failed}));process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
