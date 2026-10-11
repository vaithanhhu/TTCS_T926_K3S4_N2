const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openApplication } = require('./helpers/coverageApplication');
const { ApprovalConfigurationService } = require('../src/services/approvalConfigurationService');
const migration = require('../src/db/migrate-approval-configurations');
const root = path.resolve(__dirname, '../..');
for (const file of ['.git','.env','backend/data/ats.db','backend/data/ats.db-shm','backend/data/ats.db-wal','backend/data/ats_test.db']) assert.equal(fs.existsSync(path.join(root,file)),false,'Isolated copy required');
let passed=0,failed=0;
async function test(name, action) { try { await action(); passed++; console.log('[PASS] '+name); } catch(error) { failed++; console.error('[FAIL] '+name+' '+error.stack); } }

async function databaseCases(db, provider) {
  const service = new ApprovalConfigurationService(db);
  let configuration, firstVersion, snapshot;
  const levels=[{order:1,salaryLimit:20000000,approverUserId:'usr-hr-mgr'},{order:2,salaryLimit:40000000,approverUserId:'usr-approver'}];
  const error = (action,code)=>assert.rejects(action, e=>e.code===code);
  const unchanged = async(action,code)=>{
    const before=await db.prepare('SELECT COUNT(*) AS n FROM approval_configuration_versions').get();
    await error(action,code);
    assert.deepEqual(await db.prepare('SELECT COUNT(*) AS n FROM approval_configuration_versions').get(),before);
  };
  await test(provider+' migration is explicit, verified and idempotent',async()=>{await assert.rejects(migration.verify(db),/S301_MIGRATION_REQUIRED/);await migration.migrate(db);await migration.verify(db);await migration.migrate(db);});
  await test(provider+' AC1 creates department-specific version without auto-publishing',async()=>{configuration=await service.create({departmentId:'dept-3',levels},'usr-hr-mgr');assert.equal(configuration.departmentId,'dept-3');assert.equal(configuration.versions[0].version,1);assert.equal(configuration.publishedVersionId,null);assert.deepEqual(configuration.versions[0].levels.map(l=>l.approverUserId),levels.map(l=>l.approverUserId));firstVersion=configuration.versions[0].id;});
  await test(provider+' draft configurations cannot resolve',()=>error(()=>service.resolve('dept-3',1),'APPROVAL_CONFIGURATION_UNAVAILABLE'));
  await test(provider+' AC1 publish uses persisted levels',async()=>{configuration=await service.publish(configuration.id,firstVersion,'usr-hr-mgr');assert.equal(configuration.publishedVersionId,firstVersion);assert.equal(configuration.versions[0].state,'PUBLISHED');});
  for(const [name,salary,count] of [['below',1,1],['equal first',20000000,1],['above first',20000001,2],['equal final',40000000,2]]) await test(provider+' AC2 '+name+' selects cumulative ordered chain',async()=>{const result=await service.resolve('dept-3',salary);assert.equal(result.levels.length,count);assert.deepEqual(result.levels.map(l=>l.order),Array.from({length:count},(_,i)=>i+1));assert.equal(result.currency,'VND');assert.equal(result.proposedSalaryMax,salary);});
  await test(provider+' AC3 uncovered salary never creates a replacement level',()=>error(()=>service.resolve('dept-3',40000001),'APPROVAL_SALARY_NOT_COVERED'));
  await test(provider+' AC3 missing department configuration has no implicit inheritance',()=>error(()=>service.resolve('dept-2',1),'APPROVAL_CONFIGURATION_UNAVAILABLE'));
  for(const [name,change,code] of [
    ['empty levels',[], 'APPROVAL_LEVELS_REQUIRED'],
    ['gap',[{...levels[0],order:2}], 'INVALID_APPROVAL_ORDER'],
    ['duplicate order',[levels[0],{...levels[1],order:1}], 'INVALID_APPROVAL_ORDER'],
    ['negative limit',[{...levels[0],salaryLimit:-1}], 'INVALID_SALARY_LIMIT'],
    ['non-numeric limit',[{...levels[0],salaryLimit:'wrong'}], 'INVALID_SALARY_LIMIT'],
    ['null limit',[{...levels[0],salaryLimit:null}], 'INVALID_SALARY_LIMIT'],
    ['descending limits',[levels[0],{...levels[1],salaryLimit:10}], 'INVALID_APPROVAL_LIMIT_ORDER'],
    ['equal limits',[levels[0],{...levels[1],salaryLimit:20000000}], 'INVALID_APPROVAL_LIMIT_ORDER'],
    ['unknown user',[{...levels[0],approverUserId:'missing'}], 'APPROVER_NOT_ELIGIBLE'],
    ['no approval permission',[{...levels[0],approverUserId:'usr-interviewer'}], 'APPROVER_NOT_ELIGIBLE'],
    ['multiple user IDs',[{...levels[0],approverUserId:['usr-hr-mgr','usr-approver']}], 'INVALID_APPROVER']
  ]) await test(provider+' AC3 '+name+' rejected atomically',()=>unchanged(()=>service.newVersion(configuration.id,{levels:change,expectedVersion:1},'usr-hr-mgr'),code));
  await test(provider+' AC3 invalid department rejected',()=>error(()=>service.create({departmentId:'missing',levels},'usr-hr-mgr'),'INVALID_APPROVAL_DEPARTMENT'));
  await test(provider+' duplicate configuration rejected',()=>error(()=>service.create({departmentId:'dept-3',levels},'usr-hr-mgr'),'APPROVAL_CONFIGURATION_EXISTS'));
  await test(provider+' inactive approver rejected',async()=>{await db.prepare("UPDATE users SET status='INACTIVE' WHERE id='usr-approver'").run();try{await unchanged(()=>service.newVersion(configuration.id,{levels,expectedVersion:1},'usr-hr-mgr'),'APPROVER_NOT_ELIGIBLE');}finally{await db.prepare("UPDATE users SET status='ACTIVE' WHERE id='usr-approver'").run();}});
  await test(provider+' AC4 real persisted snapshot binds requisition and version',async()=>{await db.prepare("UPDATE requisitions SET department_id='dept-3',proposed_salary_max=30000000 WHERE id='req-001'").run();snapshot=await service.bindSnapshot('workflow-s301','req-001');assert.equal(snapshot.configurationVersionId,firstVersion);assert.equal(snapshot.levels.length,2);assert.deepEqual(JSON.parse((await db.prepare("SELECT snapshot_json FROM requisition_approval_snapshots WHERE workflow_id='workflow-s301'").get()).snapshot_json),snapshot);});
  await test(provider+' optimistic version protects concurrent updates',()=>unchanged(()=>service.newVersion(configuration.id,{levels,expectedVersion:0},'usr-hr-mgr'),'APPROVAL_CONFIGURATION_CONFLICT'));
  await test(provider+' new version leaves current publication unchanged',async()=>{configuration=await service.newVersion(configuration.id,{levels:[{...levels[0],salaryLimit:35000000,approverUserId:'usr-approver'},{...levels[1],salaryLimit:50000000,approverUserId:'usr-hr-mgr'}],expectedVersion:1},'usr-hr-mgr');assert.equal(configuration.publishedVersionId,firstVersion);assert.equal(configuration.versions[0].version,2);assert.equal((await service.resolve('dept-3',30000000)).levels.length,2);});
  await test(provider+' AC4 new publication does not change old snapshot',async()=>{configuration=await service.publish(configuration.id,configuration.versions[0].id,'usr-hr-mgr');const resolved=await service.resolve('dept-3',30000000);assert.equal(resolved.levels.length,1);assert.equal(resolved.levels[0].approverUserId,'usr-approver');assert.deepEqual(await service.bindSnapshot('workflow-s301','req-001'),snapshot);assert.equal((await service.get(configuration.id)).versions.find(v=>v.id===firstVersion).levels[0].salaryLimit,20000000);});
  await test(provider+' published version and level SQL cannot be edited or deleted',async()=>{
    for(const sql of ['UPDATE approval_configuration_versions SET created_by=? WHERE id=?','DELETE FROM approval_configuration_versions WHERE id=?','UPDATE approval_configuration_levels SET salary_limit=1 WHERE version_id=?','DELETE FROM approval_configuration_levels WHERE version_id=?','INSERT INTO approval_configuration_levels(version_id,level_order,salary_limit,approver_user_id,approver_name) VALUES (?,3,100000000,\'usr-approver\',\'Changed\')']) await assert.rejects(async()=>db.prepare(sql).run(...(sql.includes('created_by')?['changed',firstVersion]:[firstVersion])),/IMMUTABLE/);
  });
  await test(provider+' snapshot UPDATE DELETE are rejected and readback unchanged',async()=>{await assert.rejects(async()=>db.prepare("UPDATE requisition_approval_snapshots SET snapshot_json='{}' WHERE workflow_id='workflow-s301'").run(),/IMMUTABLE/);await assert.rejects(async()=>db.prepare("DELETE FROM requisition_approval_snapshots WHERE workflow_id='workflow-s301'").run(),/IMMUTABLE/);assert.deepEqual(await service.bindSnapshot('workflow-s301','req-001'),snapshot);});
  await test(provider+' snapshot retry cannot rebind another requisition',()=>error(()=>service.bindSnapshot('workflow-s301','req-002'),'APPROVAL_SNAPSHOT_CONFLICT'));
  await test(provider+' repeat snapshot initialization persists exactly one row',async()=>{await Promise.all([service.bindSnapshot('workflow-repeat','req-001'),service.bindSnapshot('workflow-repeat','req-001')]);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM requisition_approval_snapshots WHERE workflow_id='workflow-repeat'").get()).n,1);});
  await test(provider+' late permission withdrawal blocks new snapshot without changing old',async()=>{
    const role=await db.prepare("SELECT id FROM roles WHERE code='APPROVER'").get();
    await db.prepare("DELETE FROM role_permissions WHERE role_id=? AND permission_id='perm-req-approve'").run(role.id);
    try{await error(()=>service.bindSnapshot('workflow-withdrawn','req-001'),'APPROVER_NOT_ELIGIBLE');assert.deepEqual(await service.bindSnapshot('workflow-s301','req-001'),snapshot);}finally{await db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES (?,?)').run(role.id,'perm-req-approve');}
  });
  await test(provider+' AC1 independent department configurations resolve independently',async()=>{
    const other=await service.create({departmentId:'dept-9',levels:[{...levels[0],salaryLimit:100}]},'usr-hr-mgr');
    await service.publish(other.id,other.versions[0].id,'usr-hr-mgr');
    assert.equal((await service.resolve('dept-9',100)).configurationId,other.id);assert.equal((await service.resolve('dept-3',30000000)).configurationId,configuration.id);
  });
  await test(provider+' concurrent version creation detects stale version without lost update',async()=>{
    const other=(await service.list()).find(item=>item.departmentId==='dept-9');
    const results=await Promise.allSettled([service.newVersion(other.id,{levels,expectedVersion:1},'usr-hr-mgr'),service.newVersion(other.id,{levels,expectedVersion:1},'usr-hr-mgr')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'APPROVAL_CONFIGURATION_CONFLICT');assert.equal((await service.get(other.id)).versions.length,2);
  });
  await test(provider+' transaction rolls back partial level/version/configuration on insert failure',async()=>{
    const original=db.prepare.bind(db);let inserted=0;
    db.prepare=sql=>{const statement=original(sql);if(sql.startsWith('INSERT INTO approval_configuration_levels'))return {run:async(...args)=>{if(++inserted===2)throw new Error('TEST_INSERT_FAILURE');return statement.run(...args);}};return statement;};
    try{await assert.rejects(service.create({departmentId:'dept-8',levels},'usr-hr-mgr'),/TEST_INSERT_FAILURE/);}finally{db.prepare=original;}
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM approval_configurations WHERE department_id='dept-8'").get()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM approval_configuration_versions v LEFT JOIN approval_configurations c ON c.id=v.configuration_id WHERE c.id IS NULL').get()).n,0);
  });
  await test(provider+' inactive department rejected without persistence',async()=>{
    await db.prepare("UPDATE departments SET status='INACTIVE' WHERE id='dept-8'").run();
    try{await error(()=>service.create({departmentId:'dept-8',levels},'usr-hr-mgr'),'INVALID_APPROVAL_DEPARTMENT');}finally{await db.prepare("UPDATE departments SET status='ACTIVE' WHERE id='dept-8'").run();}
  });
  await test(provider+' approver permissions use multi-role union',async()=>{
    const role=await db.prepare("SELECT id FROM roles WHERE code='APPROVER'").get();
    await db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run('usr-interviewer',role.id);
    try{assert.ok((await service.eligibleApprovers()).some(user=>user.id==='usr-interviewer'));await service.validate('dept-3',[{...levels[0],approverUserId:'usr-interviewer'}]);}
    finally{await db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_id=?').run('usr-interviewer',role.id);}
  });
  await test(provider+' uncovered salary cannot persist a workflow snapshot',async()=>{
    await db.prepare("UPDATE requisitions SET proposed_salary_max=50000001 WHERE id='req-001'").run();
    try{await error(()=>service.bindSnapshot('workflow-uncovered','req-001'),'APPROVAL_SALARY_NOT_COVERED');assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM requisition_approval_snapshots WHERE workflow_id='workflow-uncovered'").get()).n,0);}finally{await db.prepare("UPDATE requisitions SET proposed_salary_max=30000000 WHERE id='req-001'").run();}
  });
  await test(provider+' publication revalidates permissions after draft creation',async()=>{
    const other=(await service.list()).find(item=>item.departmentId==='dept-9');const draft=(await service.get(other.id)).versions[0];
    await db.prepare("UPDATE users SET status='INACTIVE' WHERE id='usr-approver'").run();
    try{await error(()=>service.publish(other.id,draft.id,'usr-hr-mgr'),'APPROVER_NOT_ELIGIBLE');assert.equal((await service.get(other.id)).versions[0].state,'DRAFT');}finally{await db.prepare("UPDATE users SET status='ACTIVE' WHERE id='usr-approver'").run();}
  });
  await test(provider+' migration checksum mismatch is rejected',async()=>{
    const previous=await db.prepare('SELECT checksum FROM ats_approval_configuration_migrations WHERE version=1').get();
    await db.prepare("UPDATE ats_approval_configuration_migrations SET checksum='wrong' WHERE version=1").run();
    try{await assert.rejects(migration.verify(db),/S301_MIGRATION_REQUIRED/);await assert.rejects(migration.migrate(db),/S301_MIGRATION_CHECKSUM_MISMATCH/);}finally{await db.prepare('UPDATE ats_approval_configuration_migrations SET checksum=? WHERE version=1').run(previous.checksum);}
  });
  await test(provider+' fixed policy rejects duplicate approvers on create without persistence',async()=>{const duplicate=[levels[0],{...levels[1],approverUserId:levels[0].approverUserId}];await error(()=>service.create({departmentId:'dept-7',levels:duplicate},'usr-hr-mgr'),'REPEATED_APPROVER_FORBIDDEN');assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM approval_configurations WHERE department_id='dept-7'").get()).n,0);});
  await test(provider+' fixed policy rejects duplicate approvers in new version atomically',async()=>{const before=await service.get(configuration.id),duplicate=[levels[0],{...levels[1],approverUserId:levels[0].approverUserId}];await error(()=>service.newVersion(configuration.id,{expectedVersion:before.versions[0].version,levels:duplicate},'usr-hr-mgr'),'REPEATED_APPROVER_FORBIDDEN');assert.deepEqual(await service.get(configuration.id),before);});
  await test(provider+' fixed policy revalidates legacy duplicate draft before publication',async()=>{const other=await service.create({departmentId:'dept-8',levels},'usr-hr-mgr'),id=await db.transaction(()=>service.insertVersion(other.id,2,[{...levels[0],approverName:'HR'},{...levels[1],approverUserId:levels[0].approverUserId,approverName:'HR'}],'usr-hr-mgr')),before=await service.get(other.id);await error(()=>service.publish(other.id,id,'usr-hr-mgr'),'REPEATED_APPROVER_FORBIDDEN');assert.deepEqual(await service.get(other.id),before);});
  await test(provider+' fixed policy legacy duplicate publication cannot create new snapshot',async()=>{const other=(await service.list()).find(item=>item.departmentId==='dept-8'),detail=await service.get(other.id),versionId=detail.versions[0].id;await db.prepare("UPDATE approval_configuration_versions SET state='PUBLISHED',published_by='usr-hr-mgr',published_at=datetime('now') WHERE id=?").run(versionId);await db.prepare('UPDATE approval_configurations SET published_version_id=? WHERE id=?').run(versionId,other.id);await db.prepare("UPDATE requisitions SET department_id='dept-8',proposed_salary_max=30000000 WHERE id='req-002'").run();const before=await service.get(other.id);await error(()=>service.bindSnapshot('legacy-duplicate-rejected','req-002'),'REPEATED_APPROVER_FORBIDDEN');assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM requisition_approval_snapshots WHERE workflow_id='legacy-duplicate-rejected'").get()).n,0);assert.deepEqual(await service.get(other.id),before);});
  return {service,configuration,levels};
}

async function main() {
  const app=await openApplication();
  try {
    const config=require('../src/config/config');
    await test('feature disabled before explicit migration',async()=>assert.equal((await app.api('GET','/approval-configurations',null)).data.code,'S301_DISABLED'));
    const state=await databaseCases(app.db,'SQLite');
    config.APPROVAL_CONFIGURATION_ENABLED=true;
    const hr=await app.login('hrmanager@company.com'),admin=await app.login('admin@company.com'),recruiter=await app.login('recruiter@company.com');
    await test('AC1 authenticated configuration API readback',async()=>{const result=await app.api('GET','/approval-configurations/'+state.configuration.id,hr.token);assert.equal(result.status,200);assert.equal(result.data.data.versions.length,2);});
    await test('AC1 unauthorized API create/publish/resolve remain default-deny',async()=>{for(const token of [null,recruiter.token])for(const route of ['/approval-configurations','/approval-configurations/resolve','/approval-configurations/'+state.configuration.id+'/versions/'+state.configuration.versions[0].id+'/publish'])assert.equal((await app.api('POST',route,token,{})).status,token?403:401);assert.equal((await app.api('POST','/approval-configurations',admin.token,{})).status,400);assert.equal((await app.api('POST','/approval-configurations/resolve',admin.token,{})).status,400);});
    await test('AC3 API returns validation code without internal details',async()=>{const result=await app.api('POST','/approval-configurations',hr.token,{departmentId:'dept-2',levels:[]});assert.equal(result.status,400);assert.equal(result.data.code,'APPROVAL_LEVELS_REQUIRED');assert.ok(!/stack|SELECT|\.js/.test(JSON.stringify(result.data)));});
    await test('API save version and publish use real persisted flow',async()=>{let result=await app.api('POST','/approval-configurations',hr.token,{departmentId:'dept-2',levels:state.levels});assert.equal(result.status,201);const id=result.data.data.id,versionId=result.data.data.versions[0].id;result=await app.api('POST','/approval-configurations/'+id+'/versions/'+versionId+'/publish',hr.token,{});assert.equal(result.status,200);result=await app.api('GET','/approval-configurations/'+id,hr.token);assert.equal(result.data.data.publishedVersionId,versionId);});
    await test('API salary resolver honors equality and all mandatory levels',async()=>{for(const [salary,count] of [[20000000,1],[20000001,2]]){const result=await app.api('POST','/approval-configurations/resolve',hr.token,{departmentId:'dept-2',proposedSalaryMax:salary});assert.equal(result.status,200);assert.equal(result.data.data.levels.length,count);}});
    await test('navigation adds only permitted configuration item',async()=>{for(const session of [hr,admin,recruiter]){const result=await app.api('GET','/navigation/menu',session.token);assert.equal(result.data.menuItems.some(item=>item.path==='/admin/approval-configurations'),session===hr||session===admin);}});
    await test('enabled S3-01 preserves legacy requisition response and does not auto-submit',async()=>{
      const before=(await app.db.prepare('SELECT COUNT(*) AS n FROM requisition_approval_snapshots').get()).n;
      const result=await app.api('POST','/requisitions',hr.token,{title:'S301 compatibility',departmentName:'Legacy free text',headcount:2,hiringManagerId:'usr-hiring-mgr'});
      assert.equal(result.status,201);assert.equal(result.data.data.status,'OPEN');assert.deepEqual(Object.keys(result.data.data).sort(),['id','code','title','departmentName','headcount','status'].sort());assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM requisition_approval_snapshots').get()).n,before);
    });
    await test('enabled S3-01 preserves S2-10 DRAFT completion to OPEN without workflow creation',async()=>{
      const before=(await app.db.prepare('SELECT COUNT(*) AS n FROM requisition_approval_snapshots').get()).n;
      const title=await app.api('POST','/job-titles',hr.token,{code:'S301-COMPAT',name:'S301 compatibility',level:'Senior',minSalary:100,maxSalary:200});assert.equal(title.status,201);
      const draft=await app.api('POST','/requisitions',hr.token,{status:'DRAFT'});assert.equal(draft.status,201);assert.equal(draft.data.data.status,'DRAFT');
      const date=new(require('../src/services/requisitionService'))(app.db).businessDate();
      const completed=await app.api('PUT','/requisitions/'+draft.data.data.id,hr.token,{status:'OPEN',jobTitleId:title.data.data.id,departmentId:'dept-2',headcount:1,recruitmentReason:'REPLACEMENT',proposedSalaryMin:110,proposedSalaryMax:190,neededDate:date,jobDescription:'Unchanged description',candidateRequirements:'Unchanged requirements'});
      assert.equal(completed.status,200);assert.equal(completed.data.data.status,'OPEN');assert.equal(completed.data.data.proposedSalaryMax,190);assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM requisition_approval_snapshots').get()).n,before);
    });
    const {createFrontendRuntime}=require('./helpers/frontendRuntime');
    const runtime=await createFrontendRuntime(app.base,'/login');
    await test('real frontend bootstrap login and configuration page load',async()=>{runtime.nodes.get('email').value='hrmanager@company.com';runtime.nodes.get('password').value='Ats@123456';await runtime.nodes.get('login-form').dispatch('submit');await runtime.settle();runtime.window.ATS_ROUTER.navigate('/admin/approval-configurations');await runtime.settle();assert.equal(runtime.window.location.pathname,'/admin/approval-configurations');assert.equal(runtime.nodes.get('s301-department').children.length>1,true);assert.deepEqual(runtime.errors,[]);});
    await test('frontend add level, validation feedback and double submit protection',async()=>{await runtime.nodes.get('s301-add-level').dispatch('click');const rows=runtime.nodes.get('s301-levels').children;assert.equal(rows.length,2);rows[0].querySelector('.s301-limit').value='1';rows[0].querySelector('.s301-approver').value='usr-hr-mgr';rows[1].querySelector('.s301-limit').value='0';rows[1].querySelector('.s301-approver').value='usr-approver';runtime.nodes.get('s301-department').value='dept-4';runtime.requests.length=0;await Promise.all([runtime.nodes.get('s301-form').dispatch('submit'),runtime.nodes.get('s301-form').dispatch('submit')]);await runtime.settle();assert.equal(runtime.requests.filter(r=>r.path==='/api/v1/approval-configurations'&&r.method==='POST').length,1);assert.match(runtime.nodes.get('s301-message').textContent,/tăng dần/);assert.equal(runtime.nodes.get('s301-save').disabled,false);});
    await test('frontend save and publish persisted version through actual API',async()=>{const rows=runtime.nodes.get('s301-levels').children;rows[1].querySelector('.s301-limit').value='2';await runtime.nodes.get('s301-form').dispatch('submit');await runtime.settle();assert.equal(runtime.nodes.get('s301-publish').disabled,false);await runtime.nodes.get('s301-publish').dispatch('click');await runtime.settle();assert.equal(runtime.nodes.get('s301-publish').disabled,true);const result=await app.api('GET','/approval-configurations',hr.token);assert.ok(result.data.data.some(c=>c.departmentId==='dept-4'&&c.publishedVersion===1));});
    await test('repeated page navigation does not bind another submit listener',async()=>{for(let i=0;i<3;i++){runtime.window.ATS_ROUTER.navigate('/dashboard');await runtime.settle();runtime.window.ATS_ROUTER.navigate('/admin/approval-configurations');await runtime.settle();}assert.equal(runtime.nodes.get('s301-form').listeners.get('submit').length,1);assert.deepEqual(runtime.errors,[]);});
    await test('frontend removes a level and renumbers the remaining form rows',async()=>{
      await runtime.nodes.get('s301-add-level').dispatch('click');const container=runtime.nodes.get('s301-levels'),row=container.children[0];
      row.remove=()=>container.children.splice(container.children.indexOf(row),1);
      await container.dispatch('click',{target:row.querySelector('.s301-remove')});
      assert.equal(container.children.length,1);assert.equal(container.children[0].querySelector('.s301-level-title').textContent,'Cấp 1');
    });
    await test('API duplicate approvers are rejected independently of frontend validation',async()=>{const before=await app.api('GET','/approval-configurations',hr.token),result=await app.api('POST','/approval-configurations',hr.token,{departmentId:'dept-7',levels:[state.levels[0],{...state.levels[1],approverUserId:state.levels[0].approverUserId}]});assert.equal(result.status,400);assert.equal(result.data.code,'REPEATED_APPROVER_FORBIDDEN');assert.match(result.data.message,/Mỗi người chỉ được xuất hiện một lần/);assert.deepEqual((await app.api('GET','/approval-configurations',hr.token)).data,before.data);});
    await test('API malformed configuration bodies return 400 without leaking details',async()=>{for(const body of [null,[],{departmentId:'dept-2',levels:[]}]){const result=await app.api('POST','/approval-configurations',hr.token,body);assert.equal(result.status,400);assert.ok(result.data.code);}});
    await test('frontend duplicate approvers display Vietnamese feedback and do not send configuration',async()=>{runtime.window.ATS_ROUTER.navigate('/admin/approval-configurations');await runtime.settle();await runtime.nodes.get('s301-add-level').dispatch('click');const rows=runtime.nodes.get('s301-levels').children;rows[0].querySelector('.s301-limit').value='100';rows[1].querySelector('.s301-limit').value='200';for(const row of rows)row.querySelector('.s301-approver').value='usr-hr-mgr';runtime.nodes.get('s301-department').value='dept-7';runtime.requests.length=0;await runtime.nodes.get('s301-form').dispatch('submit');await runtime.settle();assert.match(runtime.nodes.get('s301-message').textContent,/Mỗi người chỉ được xuất hiện một lần/);assert.equal(runtime.requests.filter(item=>item.path==='/api/v1/approval-configurations'&&item.method==='POST').length,0);});
    await test('leaving page clears retained configuration data',async()=>{runtime.window.ATS_ROUTER.navigate('/dashboard');await runtime.settle();assert.equal(runtime.nodes.get('s301-configurations').children.length,0);assert.equal(runtime.nodes.get('s301-levels').children.length,0);});
  } finally {await app.close();}
  const {PGlite}=require('@electric-sql/pglite');
  const {PostgresDatabase}=require('../src/db/postgres');
  const engine=new PGlite();let tail=Promise.resolve();
  async function query(sql,params){const raw=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);const rows=(raw?.rows||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():typeof value==='bigint'?Number(value):value])));return {rows,rowCount:raw?.affectedRows||rows.length};}
  const pool={on(){},query,async connect(){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {query,release};},async end(){await engine.close();}};
  const db=new PostgresDatabase({},pool);
  try {await require('../src/db/migrate-postgres').migrate(db);await db.transaction(()=>require('../src/db/seed').seedDatabase(db));await databaseCases(db,'PostgreSQL embedded');}
  finally{await db.close();}
  console.log('S301_RESULT '+JSON.stringify({passed,failed,total:passed+failed}));process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
