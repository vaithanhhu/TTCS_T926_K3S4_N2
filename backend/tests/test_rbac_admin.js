const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
for(const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-shm','backend/data/ats.db-wal','backend/data/ats_test.db'])assert.equal(fs.existsSync(path.join(root,file)),false,'Isolated TEMP copy required');
const Rbac=require('../src/middlewares/rbacMiddleware');
const Auth=require('../src/services/authService');
const Configurations=require('../src/services/approvalConfigurationService').ApprovalConfigurationService;
const Approvals=require('../src/services/requisitionApprovalService');
const {synchronizePermissions}=require('../src/db/sync-permissions');
const {seedDatabase}=require('../src/db/seed');
let passed=0,failed=0;
async function test(name,action){try{await action();passed++;console.log('[PASS] '+name);}catch(error){failed++;console.error('[FAIL] '+name+' '+error.stack);}}
const reject=(action,code)=>assert.rejects(action,error=>error.code===code);
async function databaseCases(db,label){
  const rbac=new Rbac(db),auth=new Auth(db),configs=new Configurations(db),service=new Approvals(db);
  const grants=()=>db.prepare('SELECT role_id,permission_id FROM role_permissions ORDER BY role_id,permission_id').all();
  await test(label+' S3 migrations grant HR_MANAGER and remain idempotent',async()=>{
    await db.prepare("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code='approval_configuration.manage')").run();
    await require('../src/db/migrate-approval-configurations').migrate(db);
    await require('../src/db/migrate-requisition-approvals').migrate(db);
    assert.equal(await rbac.hasPermission('usr-hr-mgr','approval_configuration.manage'),true);
    const before=await grants();await require('../src/db/migrate-approval-configurations').migrate(db);await require('../src/db/migrate-requisition-approvals').migrate(db);
    assert.deepEqual(await grants(),before);
  });
  await test(label+' seed preserves module grants and is idempotent',async()=>{
    await db.prepare("INSERT INTO permissions(id,code,name,module) VALUES ('perm-test-module','test.module.read','Test module','TEST')").run();
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT id,'perm-test-module' FROM roles WHERE code='RECRUITER'").run();
    const before=await grants();await db.transaction(()=>seedDatabase(db));assert.deepEqual(await grants(),before);
    await db.transaction(()=>seedDatabase(db));assert.deepEqual(await grants(),before);
    assert.equal(await rbac.hasPermission('usr-hr-mgr','approval_configuration.manage'),true);
    assert.equal(await rbac.hasPermission('usr-recruiter','test.module.read'),true);
  });
  await test(label+' explicit sync repairs missing HR grant without domain or unrelated grant changes',async()=>{
    await db.prepare("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code='HR_MANAGER') AND permission_id IN (SELECT id FROM permissions WHERE code='approval_configuration.manage')").run();
    assert.equal(await rbac.hasPermission('usr-hr-mgr','approval_configuration.manage'),false);
    const before=await db.prepare('SELECT * FROM requisitions ORDER BY id').all();await synchronizePermissions(db);const first=await grants();await synchronizePermissions(db);
    assert.deepEqual(await grants(),first);assert.deepEqual(await db.prepare('SELECT * FROM requisitions ORDER BY id').all(),before);
    assert.equal(await rbac.hasPermission('usr-hr-mgr','approval_configuration.manage'),true);
  });
  await db.prepare("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code='ADMIN')").run();
  await test(label+' ADMIN has every catalog permission without any physical grants',async()=>{
    const all=(await db.prepare('SELECT code FROM permissions ORDER BY code').all()).map(row=>row.code);
    assert.deepEqual(await rbac.getUserPermissions('usr-admin'),all);
    assert.deepEqual((await rbac.getUserPermissionDetails('usr-admin')).map(row=>row.code).sort(),all);
    for(const code of all)assert.equal(await rbac.hasPermission('usr-admin',code),true,code);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code='ADMIN'").get()).n,0);
    assert.deepEqual((await rbac.getRbacMatrix()).ADMIN.permissions,all);
  });
  await test(label+' future permission is effective immediately for ADMIN and denied to other roles',async()=>{
    assert.equal(await rbac.hasPermission('usr-admin','future.permission.manage'),true);
    await db.prepare("INSERT INTO permissions(id,code,name,module) VALUES ('perm-test-future','future.permission.manage','Future permission','TEST')").run();
    assert.ok((await rbac.getUserPermissions('usr-admin')).includes('future.permission.manage'));
    for(const id of ['usr-hr-mgr','usr-hiring-mgr','usr-recruiter','usr-interviewer','usr-approver','usr-candidate'])assert.equal(await rbac.hasPermission(id,'future.permission.manage'),false);
    assert.equal(await rbac.hasPermission(null,'user.read'),false);assert.equal(await rbac.hasPermission('missing','user.read'),false);
  });
  await test(label+' only HR_MANAGER gets S3 configuration grant automatically',async()=>{
    for(const id of ['usr-hiring-mgr','usr-recruiter','usr-interviewer','usr-approver','usr-candidate'])assert.equal(await rbac.hasPermission(id,'approval_configuration.manage'),false,id);
    const matrix=await rbac.getRbacMatrix();for(const code of ['HR_MANAGER','RECRUITER','HIRING_MGR','INTERVIEWER','APPROVER','CANDIDATE']){
      const rows=await db.prepare('SELECT p.code FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.code=? ORDER BY p.code').all(code);
      assert.deepEqual(matrix[code].permissions,rows.map(row=>row.code));
    }
  });
  await test(label+' login and session use the same effective permission source',async()=>{
    const login=await auth.login('admin@company.com','Ats@123456');assert.equal(login.success,true);
    const expected=await rbac.getUserPermissions('usr-admin');assert.deepEqual(login.data.user.permissions,expected);
    assert.deepEqual((await auth.validateSession(login.data.token,false)).user.permissions,expected);
  });
  await test(label+' ADMIN revocation takes effect without trusting cached role labels',async()=>{
    const role=await db.prepare("SELECT id FROM roles WHERE code='ADMIN'").get();await db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_id=?').run('usr-admin',role.id);
    try{assert.equal(await rbac.hasPermission('usr-admin','approval_configuration.manage'),false);assert.deepEqual(await rbac.getUserPermissions('usr-admin'),[]);assert.equal(await db.transaction(()=>rbac.getAuthorizedActor('usr-admin','requisition.approve')),null);}
    finally{await db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run('usr-admin',role.id);}
  });
  await test(label+' normal multi-role permissions are an exact union without ADMIN escalation',async()=>{
    const role=await db.prepare("SELECT id FROM roles WHERE code='APPROVER'").get(),before=await rbac.getUserPermissions('usr-interviewer'),approval=(await rbac.getRbacMatrix()).APPROVER.permissions;
    await db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run('usr-interviewer',role.id);
    try{assert.deepEqual(await rbac.getUserPermissions('usr-interviewer'),[...new Set([...before,...approval])].sort());assert.equal(await rbac.hasPermission('usr-interviewer','approval_configuration.manage'),false);}
    finally{await db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_id=?').run('usr-interviewer',role.id);}
  });
  await test(label+' ADMIN is eligible approver without explicit approval grant',async()=>{assert.ok((await configs.eligibleApprovers()).some(user=>user.id==='usr-admin'));});
  const admin=(await auth.login('admin@company.com','Ats@123456')).data.user,hiring=(await auth.login('hiringmgr@company.com','Ats@123456')).data.user,approver=(await auth.login('approver@company.com','Ats@123456')).data.user;
  const requisitions=new(require('../src/services/requisitionService'))(db),title=await new(require('../src/services/competencyService'))(db).createJobTitle({code:'RBAC-'+label.replace(/\W/g,''),name:'RBAC test',level:'Senior',minSalary:100,maxSalary:500},{includeSalary:true});
  assert.equal(title.success,true);
  const payload={formVersion:'S2-10',departmentId:'dept-3',jobTitleId:title.data.id,headcount:1,recruitmentReason:'REPLACEMENT',proposedSalaryMin:150,proposedSalaryMax:300,neededDate:requisitions.businessDate(),jobDescription:'RBAC document',candidateRequirements:'Required skills'};
  let configuration=await configs.create({departmentId:'dept-3',levels:[{order:1,salaryLimit:200,approverUserId:admin.id},{order:2,salaryLimit:500,approverUserId:approver.id}]},admin.id);
  await configs.publish(configuration.id,configuration.versions[0].id,admin.id);
  const create=async()=>{const result=await requisitions.createRequisition(payload,hiring);assert.equal(result.success,true);return result.data.id;};
  const workflow=await service.submit(await create(),{requestId:crypto.randomUUID()},hiring);
  let detail=await service.read(workflow.id,admin),body={requestId:crypto.randomUUID(),action:'APPROVE',expectedVersion:detail.version,expectedStepId:detail.steps[0].id};
  await test(label+' unassigned user cannot process ADMIN step',()=>reject(()=>service.decide(workflow.id,{...body,requestId:crypto.randomUUID()},approver),'APPROVAL_ASSIGNEE_REQUIRED'));
  await test(label+' ADMIN processes assigned step atomically and exact retry does not advance twice',async()=>{
    const result=await service.decide(workflow.id,body,admin);assert.equal(result.status,'PENDING');assert.deepEqual(await service.decide(workflow.id,body,admin),result);
    detail=await service.read(workflow.id,admin);assert.equal(detail.steps[0].status,'APPROVED');assert.equal(detail.steps[1].status,'PENDING');assert.equal(detail.events.length,2);
    assert.equal((await requisitions.getRequisitionById(workflow.requisitionId)).status,'OPEN');
  });
  await test(label+' ADMIN cannot process next step assigned to another user',()=>reject(()=>service.decide(workflow.id,{requestId:crypto.randomUUID(),action:'APPROVE',expectedVersion:detail.version,expectedStepId:detail.steps[1].id},admin),'APPROVAL_ASSIGNEE_REQUIRED'));
  await test(label+' ADMIN delegated submission cannot omit a reason',async()=>{const id=await create();await reject(()=>service.submit(id,{requestId:crypto.randomUUID()},admin),'APPROVAL_DELEGATION_REASON_REQUIRED');});
  await test(label+' ADMIN still cannot self approve or repeat an approver',async()=>{
    await reject(()=>configs.validate('dept-3',[{order:1,salaryLimit:100,approverUserId:admin.id},{order:2,salaryLimit:200,approverUserId:admin.id}]),'REPEATED_APPROVER_FORBIDDEN');
    await db.prepare("UPDATE departments SET manager_id='usr-admin' WHERE id='dept-3'").run();
    try{const request=await requisitions.createRequisition(payload,admin);assert.equal(request.success,true);await reject(()=>service.submit(request.data.id,{requestId:crypto.randomUUID()},admin),'SELF_APPROVAL_FORBIDDEN');assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM requisition_approval_workflows WHERE requisition_id=?').get(request.data.id)).n,0);}
    finally{await db.prepare("UPDATE departments SET manager_id='usr-hiring-mgr' WHERE id='dept-3'").run();}
  });
  await test(label+' inactive locked or password-change ADMIN cannot execute transaction actions',async()=>{
    for(const sql of ["UPDATE users SET status='INACTIVE' WHERE id='usr-admin'","UPDATE users SET must_change_password=TRUE WHERE id='usr-admin'","UPDATE users SET locked_until='2099-01-01T00:00:00Z' WHERE id='usr-admin'"]){
      await db.prepare(sql).run();try{assert.equal(await db.transaction(()=>rbac.getAuthorizedActor('usr-admin','requisition.approve')),null);}finally{await db.prepare("UPDATE users SET status='ACTIVE',must_change_password=FALSE,locked_until=NULL WHERE id='usr-admin'").run();}
    }
  });
  return {configuration,admin,hiring,approver,workflow,create,service};
}
async function apiCases(app,state){
  const config=require('../src/config/config');config.APPROVAL_CONFIGURATION_ENABLED=true;config.REQUISITION_APPROVAL_ENABLED=true;
  const sessions={};for(const [role,email] of [['ADMIN','admin'],['HR_MANAGER','hrmanager'],['HIRING_MGR','hiringmgr'],['RECRUITER','recruiter'],['INTERVIEWER','interviewer'],['APPROVER','approver'],['CANDIDATE','candidate']])sessions[role]=await app.login(email+(role==='CANDIDATE'?'@example.com':'@company.com'));
  await test('HTTP anonymous S3-01 and S3-02 remain 401',async()=>{for(const route of ['/approval-configurations','/approval-configurations/options','/requisition-approvals'])assert.equal((await app.api('GET',route,null)).status,401);});
  await test('HTTP S3-01 list options and navigation agree for every role',async()=>{
    for(const [role,session] of Object.entries(sessions)){
      const permitted=['ADMIN','HR_MANAGER'].includes(role);
      for(const route of ['/approval-configurations','/approval-configurations/options'])assert.equal((await app.api('GET',route,session.token)).status,permitted?200:403,role+route);
      const menu=await app.api('GET','/navigation/menu',session.token);assert.equal(menu.data.menuItems.some(item=>item.path==='/admin/approval-configurations'),permitted);
      assert.equal(menu.data.menuItems.some(item=>item.path==='/reports'),['ADMIN','HR_MANAGER','HIRING_MGR','RECRUITER','APPROVER'].includes(role));
    }
  });
  await test('HTTP ADMIN creates publishes and reads actual configuration',async()=>{
    const result=await app.api('POST','/approval-configurations',sessions.ADMIN.token,{departmentId:'dept-8',levels:[{order:1,salaryLimit:500,approverUserId:'usr-admin'}]});assert.equal(result.status,201);
    const row=result.data.data;assert.equal((await app.api('POST','/approval-configurations/'+row.id+'/versions/'+row.versions[0].id+'/publish',sessions.ADMIN.token,{})).status,200);
    assert.equal((await app.api('GET','/approval-configurations/'+row.id,sessions.ADMIN.token)).data.data.publishedVersionId,row.versions[0].id);
  });
  await test('HTTP ADMIN permissions and session metadata match effective catalog',async()=>{
    const expected=await new Rbac(app.db).getUserPermissions('usr-admin');const response=await app.api('GET','/auth/permissions',sessions.ADMIN.token);assert.equal(response.status,200);assert.deepEqual(response.data.permissions,expected);
    const me=await app.api('GET','/auth/me',sessions.ADMIN.token);assert.deepEqual(me.data.data.user.permissions,expected);
  });
  await test('HTTP ADMIN keeps HR-only standard salary confidentiality',async()=>{
    const admin=await app.api('GET','/job-titles',sessions.ADMIN.token),hr=await app.api('GET','/job-titles',sessions.HR_MANAGER.token);assert.equal(admin.status,200);assert.equal(hr.status,200);
    assert.ok(admin.data.jobTitles.length>0);for(const row of admin.data.jobTitles)assert.equal(Object.hasOwn(row,'minSalary')||Object.hasOwn(row,'maxSalary'),false);
    assert.ok(hr.data.jobTitles.some(row=>Object.hasOwn(row,'minSalary')));
    const row=admin.data.jobTitles[0];assert.equal((await app.api('PUT','/job-titles/'+row.id,sessions.ADMIN.token,{minSalary:1,maxSalary:2})).status,403);
  });
  const {createFrontendRuntime}=require('./helpers/frontendRuntime');
  const runtime=await createFrontendRuntime(app.base,'/login');
  await test('frontend ADMIN login navigation route guard and S3-01 options execute real APIs',async()=>{
    runtime.nodes.get('email').value='admin@company.com';runtime.nodes.get('password').value='Ats@123456';await runtime.nodes.get('login-form').dispatch('submit');await runtime.settle();
    assert.equal(runtime.nodes.get('nav-item-approval-configurations').style.display,'');
    runtime.window.ATS_ROUTER.navigate('/admin/approval-configurations');await runtime.settle();assert.equal(runtime.window.location.pathname,'/admin/approval-configurations');
    assert.ok(runtime.nodes.get('s301-department').children.length>1);assert.ok(runtime.nodes.get('s301-levels').children[0].querySelector('.s301-approver').children.some(row=>row.value==='usr-admin'));assert.deepEqual(runtime.errors,[]);
  });
  await test('frontend backend permission source enables ADMIN question bank management',async()=>{
    runtime.window.ATS_ROUTER.navigate('/question-bank');await runtime.settle();assert.equal(runtime.nodes.get('question-bank-create-btn').classes.has('hidden'),false);assert.deepEqual(runtime.errors,[]);
  });
  await test('frontend ADMIN reports navigation uses the existing page and API',async()=>{
    assert.equal(runtime.nodes.get('nav-item-reports').style.display,'');await runtime.nodes.get('nav-item-reports').dispatch('click');await runtime.settle();assert.equal(runtime.window.location.pathname,'/reports');assert.equal(runtime.nodes.get('reports-view').classes.has('hidden'),false);assert.deepEqual(runtime.errors,[]);
  });
  await test('frontend ADMIN S3-02 actions follow assignment and execute real decision API',async()=>{
    const workflow=await state.service.submit(await state.create(),{requestId:crypto.randomUUID()},state.hiring);
    await runtime.window.ATS_REQUISITION_APPROVAL_UI.open(workflow.id);await runtime.settle();assert.equal(runtime.nodes.get('s302-actions').classes.has('hidden'),false);
    await runtime.nodes.get('s302-approve').dispatch('click');await runtime.settle();const detail=await state.service.read(workflow.id,state.hiring);
    assert.equal(detail.steps[0].status,'APPROVED');assert.equal(detail.steps[1].status,'PENDING');assert.equal(runtime.nodes.get('s302-actions').classes.has('hidden'),true);
    assert.equal(detail.events.length,2);assert.deepEqual(runtime.errors,[]);
  });
  await test('frontend question bank follows granted permission rather than role name',async()=>{
    await app.db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='question_bank.manage' WHERE r.code='INTERVIEWER'").run();
    try{const granted=await createFrontendRuntime(app.base,'/login');granted.nodes.get('email').value='interviewer@company.com';granted.nodes.get('password').value='Ats@123456';await granted.nodes.get('login-form').dispatch('submit');await granted.settle();granted.window.ATS_ROUTER.navigate('/question-bank');await granted.settle();assert.equal(granted.nodes.get('question-bank-create-btn').classes.has('hidden'),false);assert.deepEqual(granted.errors,[]);}
    finally{await app.db.prepare("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code='INTERVIEWER') AND permission_id IN (SELECT id FROM permissions WHERE code='question_bank.manage')").run();}
    const denied=await createFrontendRuntime(app.base,'/login');denied.nodes.get('email').value='interviewer@company.com';denied.nodes.get('password').value='Ats@123456';await denied.nodes.get('login-form').dispatch('submit');await denied.settle();denied.window.ATS_ROUTER.navigate('/question-bank');await denied.settle();assert.equal(denied.nodes.get('question-bank-create-btn').classes.has('hidden'),true);
  });
  await test('frontend denied role cannot open S3-01 or fetch configuration data',async()=>{
    const denied=await createFrontendRuntime(app.base,'/login');denied.nodes.get('email').value='recruiter@company.com';denied.nodes.get('password').value='Ats@123456';await denied.nodes.get('login-form').dispatch('submit');await denied.settle();
    denied.requests.length=0;denied.window.ATS_ROUTER.navigate('/admin/approval-configurations');await denied.settle();assert.equal(denied.nodes.get('error-view').classes.has('hidden'),false);assert.match(denied.nodes.get('error-heading-display').textContent,/403/);assert.equal(denied.requests.some(row=>row.path.startsWith('/api/v1/approval-configurations')),false);
  });
  await test('ADMIN plus CANDIDATE retains administrative and candidate navigation',async()=>{
    const role=await app.db.prepare("SELECT id FROM roles WHERE code='CANDIDATE'").get();await app.db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run('usr-admin',role.id);
    try{const result=await app.api('GET','/navigation/menu',sessions.ADMIN.token);for(const route of ['/candidate','/admin/users','/admin/approval-configurations','/dashboard'])assert.ok(result.data.menuItems.some(row=>row.path===route),route);}
    finally{await app.db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_id=?').run('usr-admin',role.id);}
  });
  await test('frontend heartbeat refreshes withdrawn ADMIN privileges from the real backend',async()=>{
    const fresh=await createFrontendRuntime(app.base,'/login');fresh.nodes.get('email').value='admin@company.com';fresh.nodes.get('password').value='Ats@123456';await fresh.nodes.get('login-form').dispatch('submit');await fresh.settle();fresh.window.ATS_ROUTER.navigate('/admin/audit');await fresh.settle();
    await app.db.prepare("DELETE FROM user_roles WHERE user_id='usr-admin'").run();await app.db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT 'usr-admin',id FROM roles WHERE code='INTERVIEWER'").run();
    try{const heartbeat=[...fresh.intervals.values()][0];assert.ok(heartbeat);await heartbeat();await fresh.settle();assert.deepEqual(JSON.parse(fresh.storage.get('ats_user')).roles,['INTERVIEWER']);assert.equal(fresh.nodes.get('nav-item-audit').style.display,'none');assert.equal(fresh.nodes.get('error-view').classes.has('hidden'),false);assert.equal(fresh.nodes.get('error-code-display').textContent,403);assert.equal(fresh.intervals.size,1);assert.deepEqual(fresh.errors,[]);}
    finally{await app.db.prepare("DELETE FROM user_roles WHERE user_id='usr-admin'").run();await app.db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT 'usr-admin',id FROM roles WHERE code='ADMIN'").run();}
  });
  await test('feature flags still hide and block S3 even for ADMIN',async()=>{
    config.APPROVAL_CONFIGURATION_ENABLED=false;try{assert.equal((await app.api('GET','/approval-configurations',sessions.ADMIN.token)).data.code,'S301_DISABLED');assert.equal((await app.api('GET','/navigation/menu',sessions.ADMIN.token)).data.menuItems.some(row=>row.path==='/admin/approval-configurations'),false);}finally{config.APPROVAL_CONFIGURATION_ENABLED=true;}
  });
  await test('HTTP mandatory password change still blocks ADMIN privileged API',async()=>{
    await app.db.prepare("UPDATE users SET must_change_password=TRUE WHERE id='usr-admin'").run();try{const result=await app.api('GET','/approval-configurations/options',sessions.ADMIN.token);assert.equal(result.status,403);assert.equal(result.data.code,'MUST_CHANGE_PASSWORD');}finally{await app.db.prepare("UPDATE users SET must_change_password=FALSE WHERE id='usr-admin'").run();}
  });
}
async function postgresCases(){
  const {PGlite}=require('@electric-sql/pglite'),{PostgresDatabase}=require('../src/db/postgres');const engine=new PGlite();let tail=Promise.resolve();
  async function query(sql,params){const raw=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);const rows=(raw?.rows||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?(raw.fields.find(field=>field.name===key)?.dataTypeID===1082?value.toISOString().slice(0,10):value.toISOString()):typeof value==='bigint'?Number(value):value])));return {rows,rowCount:raw?.affectedRows||rows.length};}
  const pool={on(){},query,async connect(){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query,release};},async end(){await engine.close();}};
  const db=new PostgresDatabase({},pool);try{await require('../src/db/migrate-postgres').migrate(db);await db.transaction(()=>seedDatabase(db));await databaseCases(db,'PostgreSQL embedded');}finally{await db.close();}
}
async function main(){const app=await require('./helpers/coverageApplication').openApplication();try{const state=await databaseCases(app.db,'SQLite');await apiCases(app,state);}finally{await app.close();}await postgresCases();console.log('RBAC_RESULT '+JSON.stringify({passed,failed,total:passed+failed}));process.exitCode=failed?1:0;}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
