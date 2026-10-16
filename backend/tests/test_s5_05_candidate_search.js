const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
assert.equal(fs.existsSync(path.join(root,'.git')),false,'Run in an isolated source export');
assert.equal(fs.existsSync(path.join(root,'.env')),false,'No environment file in test export');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.DB_PROVIDER,'sqlite');
const {sqliteBoundary,PostgresDatabase}=require('../src/db/postgres');
const Rbac=require('../src/middlewares/rbacMiddleware');
const Requisitions=require('../src/services/requisitionService');
const config=require('../src/config/config');
let passed=0;
async function test(name,action){await action();passed++;console.log('PASS '+name);}
async function denied(action,status=403){await assert.rejects(action,error=>error.statusCode===status);}
async function fixture(db){
  config.REQUISITION_OPERATIONS_ENABLED=true;
  await db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password BOOLEAN DEFAULT FALSE,locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE departments(id TEXT PRIMARY KEY,manager_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,code TEXT,title TEXT,department_name TEXT,recruiter_id TEXT,hiring_manager_id TEXT,created_by TEXT,department_id TEXT,job_title_id TEXT,status TEXT);
    CREATE TABLE requisition_recruiter_supports(requisition_id TEXT,user_id TEXT);
    CREATE TABLE recruitment_catalog_items(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,full_name TEXT,email TEXT,phone_number TEXT,requisition_id TEXT,stage TEXT,experience_years INTEGER,current_company TEXT,expected_salary INTEGER,notes TEXT,source_id TEXT,rejection_reason_id TEXT,created_at TEXT,cover_letter TEXT);
    CREATE TABLE candidate_tags(id TEXT PRIMARY KEY,candidate_id TEXT,tag_name TEXT);
    CREATE TABLE interviews(id TEXT PRIMARY KEY,candidate_id TEXT,interviewer_id TEXT,status TEXT,score INTEGER,requisition_id TEXT);
    CREATE TABLE candidate_documents(id TEXT PRIMARY KEY,candidate_id TEXT,document_type TEXT,parsed_text TEXT);
    CREATE TABLE requisition_screening_criteria(requisition_id TEXT,required_skills_json TEXT);
    CREATE TABLE candidate_status_history(id TEXT PRIMARY KEY,candidate_id TEXT,action TEXT);
    INSERT INTO permissions VALUES('read','candidate.read'),('write','candidate.update'),('interview','interview.read'),('evaluations','interview.evaluation.read');
    INSERT INTO recruitment_catalog_items VALUES('src-a','LinkedIn'),('src-b','Referral');
    INSERT INTO departments VALUES('dep','hiring');
    INSERT INTO requisitions VALUES('ra','R-A','Engineer','Engineering','recruiter','hiring','hiring','dep','jt-a','OPEN'),('rb','R-B','Designer','Design','other','other','other','dep','jt-b','OPEN'),('rc','R-C','Engineer','Engineering','other','other','other','dep','jt-a','DRAFT');
    INSERT INTO requisition_recruiter_supports VALUES('ra','support');
    INSERT INTO candidates VALUES('ca','Alice Nguyen','same@example.invalid','0901112222','ra','INTERVIEW',3,'Acme',2000,'Internal A','src-a',NULL,'2026-01-01T00:00:00Z','Kubernetes contributor'),('cb','Secret Bob','same@example.invalid','0903334444','rb','REJECTED',4,'Hidden',3000,'Internal B','src-b',NULL,'2026-01-31T23:59:59Z','Hidden cover letter'),('cc','Carol','carol@example.invalid','0905556666','ra','REJECTED',5,'Company',4000,'Internal C','src-a',NULL,'2026-02-01T00:00:00Z','Engineering'),('own','Mixed own','mixed@example.invalid','0909999999','rb','OFFER',2,'Owned',1000,'Never public','src-b',NULL,'2026-01-15T00:00:00Z','Own letter');
    INSERT INTO candidate_tags VALUES('ta','ca','Node.js'),('tb','cb','Secret tag'),('tc','cc','Node.js'),('td','ca','Node.js');
    INSERT INTO interviews(id,candidate_id,interviewer_id,status,score) VALUES('ia','ca','interviewer','COMPLETED',9),('ia2','ca','other','COMPLETED',7),('ia3','ca','interviewer','COMPLETED',NULL),('ia4','ca','interviewer','SCHEDULED',100),('ib','cb','other','COMPLETED',10),('ic','cc','interviewer','COMPLETED',NULL);
    INSERT INTO candidate_documents VALUES('da','ca','CV','Node.js Docker'),('db','cb','CV','Design Figma'),('dc','cc','CV','Node.js Kubernetes');
    INSERT INTO requisition_screening_criteria VALUES('ra','["Node.js","Docker"]');
    INSERT INTO candidate_status_history VALUES('history','cc','REJECTED');`);
  for(const code of ['ADMIN','HR_MANAGER','RECRUITER','HIRING_MGR','APPROVER','INTERVIEWER','CANDIDATE']){
    await db.prepare('INSERT INTO roles VALUES(?,?)').run(code,code);
    await db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(code,'read');
    if(['HR_MANAGER','RECRUITER'].includes(code))await db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(code,'write');
    if(['HR_MANAGER','RECRUITER','HIRING_MGR','INTERVIEWER','CANDIDATE'].includes(code))await db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(code,'interview');
    if(code==='APPROVER')await db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(code,'evaluations');
  }
  for(const [id,role]of [['admin','ADMIN'],['hr','HR_MANAGER'],['recruiter','RECRUITER'],['other','RECRUITER'],['support','RECRUITER'],['mixed','RECRUITER'],['hiring','HIRING_MGR'],['approver','APPROVER'],['interviewer','INTERVIEWER'],['candidate','CANDIDATE'],['locked','HR_MANAGER']]){
    await db.prepare('INSERT INTO users(id,email,full_name,status) VALUES(?,?,?,?)').run(id,id==='candidate'?'same@example.invalid':id+'@example.invalid','Verified '+id,id==='locked'?'LOCKED':'ACTIVE');
    await db.prepare('INSERT INTO user_roles VALUES(?,?)').run(id,role);
  }
  await db.prepare('INSERT INTO user_roles VALUES(?,?)').run('mixed','CANDIDATE');
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES(?,?)').run('ra','mixed');
}
async function providers(run){
  const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));sqlite.exec('PRAGMA foreign_keys=ON');try{await fixture(sqlite);await run(sqlite,'SQLite');}finally{sqlite.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();const query=async(sql,params)=>{const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return {rows:result?.rows || [],rowCount:result?.affectedRows || 0};};
  const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});try{await fixture(pg);await run(pg,'PGlite');}finally{await pg.close();}
}

const Search=require('../src/services/candidateSearchService');
const migrate=require('../src/db/migrate-candidate-search').migrate;
async function run(db,provider){
  const service=new Search(db),viewer={id:'recruiter'},search=filters=>service.search(filters,viewer);
  const check=(name,action)=>test(provider+' '+name,action);
  await check('availability false before schema, no implicit DDL',async()=>assert.equal((await service.availability(viewer)).enabled,false));
  await check('missing prerequisite fails and rolls back without ledger',async()=>{await assert.rejects(()=>db.transaction(async()=>{await db.exec('DROP TABLE candidate_tags');await migrate(db);}));assert.equal((await service.availability(viewer)).enabled,false);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidate_tags').get()).n),4);});
  await check('migration repeat preserves grants',async()=>{const before=await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all();await migrate(db);await migrate(db);assert.deepEqual(await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all(),before);});
  await check('availability true with matching schema ledger',async()=>assert.equal((await service.availability(viewer)).enabled,true));
  await check('pre-merge schema supports repeated searches in one transaction',async()=>{
    await db.transaction(async()=>{
      if(db.provider==='postgres')await db.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      assert.equal(await service.hasMergeColumn(),false);
      for(let index=0;index<2;index++)assert.deepEqual((await service.searchRows({search:'Alice'},viewer)).candidates.map(row=>row.id),['ca']);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).n),4);
    });
  });
  await check('merge schema metadata errors are propagated',async()=>{
    const prepare=db.prepare,error=new Error('S505_METADATA_FAILURE');
    db.prepare=()=>{throw error;};
    try{await assert.rejects(()=>service.hasMergeColumn(),actual=>actual===error);}finally{db.prepare=prepare;}
    assert.equal((await search({search:'Alice'})).total,1);
  });
  for(const [name,value]of [['name','Alice'],['email','same@example.invalid'],['phone','090111'],['cover letter','Kubernetes'],['company compatibility','Acme']])await check('search '+name,async()=>assert.deepEqual((await search({search:value})).candidates.map(row=>row.id),['ca']));
  await check('literal SQL payload and wildcard',async()=>{for(const search of ["%' OR 1=1 --",'%','_'])assert.equal((await service.search({search},viewer)).total,0);});
  await check('Vietnamese case-insensitive name and cover letter',async()=>{await db.prepare("UPDATE candidates SET full_name=?,cover_letter=? WHERE id='ca'").run('ĐỨC Nguyễn'.normalize('NFD'),'Kỹ sư ĐIỆN'.normalize('NFD'));try{assert.equal((await search({search:'đức'})).total,1);assert.equal((await search({search:'kỹ sư điện'})).total,1);}finally{await db.prepare("UPDATE candidates SET full_name='Alice Nguyen',cover_letter='Kubernetes contributor' WHERE id='ca'").run();}});
  await check('ALL is literal in keyword and tag',async()=>{assert.equal((await search({search:'ALL'})).total,0);assert.equal((await search({tag:'ALL'})).total,0);});
  await check('requisition filter uses ID',async()=>{assert.equal((await search({requisitionId:'rb'})).total,0);assert.equal((await search({requisitionId:'ra'})).total,2);});
  await check('stage filter',async()=>assert.deepEqual((await search({stage:'REJECTED'})).candidates.map(row=>row.id),['cc']));
  await check('source filter',async()=>assert.equal((await search({sourceId:'src-b'})).total,0));
  await check('tag duplicate does not duplicate result',async()=>assert.equal((await search({tag:'node.JS'})).total,2));
  await check('inclusive dates',async()=>assert.equal((await search({submittedFrom:'2026-01-01',submittedTo:'2026-01-01'})).total,1));
  await check('January range',async()=>assert.equal((await service.search({submittedFrom:'2026-01-01',submittedTo:'2026-01-31'},{id:'hr'})).total,3));
  await check('average completed only ignores NULL and scheduled score',async()=>{const result=await search({ratingMin:'8',ratingMax:'8'});assert.equal(result.total,1);assert.equal(result.candidates[0].interviewAverage,8);});
  await check('interviewer average excludes other assigned rounds',async()=>{const result=await service.search({candidateId:'ca',search:'Alice'},{id:'interviewer'});assert.equal(result.candidates[0].interviewAverage,9);assert.equal((await service.search({ratingMin:'8',ratingMax:'8'},{id:'interviewer'})).total,0);});
  await check('score read grant revoked does not disclose or filter hidden scores',async()=>{await db.prepare("DELETE FROM role_permissions WHERE role_id='RECRUITER' AND permission_id='interview'").run();try{const result=await search({search:'Alice'});assert.equal(Object.hasOwn(result.candidates[0],'interviewAverage'),false);assert.equal((await search({ratingMin:'8'})).total,0);}finally{await db.prepare("INSERT INTO role_permissions VALUES('RECRUITER','interview')").run();}});
  await check('broad candidate role without evaluation grant cannot widen score scope',async()=>{
    await db.prepare("INSERT INTO user_roles VALUES('mixed','APPROVER')").run();await db.prepare("DELETE FROM role_permissions WHERE role_id='APPROVER' AND permission_id='evaluations'").run();
    try{const result=await service.search({search:'Secret Bob'},{id:'mixed'});assert.equal(result.total,1);assert.equal(result.candidates[0].interviewAverage,null);assert.equal((await service.search({ratingMin:'10'},{id:'mixed'})).total,0);}finally{await db.prepare("DELETE FROM user_roles WHERE user_id='mixed' AND role_id='APPROVER'").run();await db.prepare("INSERT INTO role_permissions VALUES('APPROVER','evaluations')").run();}
  });
  await check('interview associated with another requisition remains out of score scope',async()=>{await db.prepare("UPDATE interviews SET requisition_id='rb' WHERE id='ia'").run();try{assert.equal((await search({search:'Alice'})).candidates[0].interviewAverage,7);}finally{await db.prepare("UPDATE interviews SET requisition_id=NULL WHERE id='ia'").run();}});
  await check('unrated not coerced to zero',async()=>{assert.equal((await search({ratingMax:'0'})).total,0);assert.equal((await search({stage:'REJECTED'})).candidates[0].interviewAverage,null);});
  await check('combined all filters',async()=>assert.equal((await search({search:'contributor',requisitionId:'ra',sourceId:'src-a',stage:'INTERVIEW',tag:'Node.js',submittedFrom:'2026-01-01',submittedTo:'2026-01-31',ratingMin:'7.5',ratingMax:'8.5'})).total,1));
  await check('empty result',async()=>assert.deepEqual((await search({search:'No match'})).candidates,[]));
  await check('pagination stable scoped total',async()=>{const first=await search({page:'1',pageSize:'1'}),second=await search({page:'2',pageSize:'1'});assert.equal(first.total,2);assert.equal(second.total,2);assert.notEqual(first.candidates[0].id,second.candidates[0].id);assert.deepEqual((await search({page:'3',pageSize:'1'})).candidates,[]);});
  await check('over 1000 profiles pagination and count remain scoped',async()=>{
    await db.transaction(async()=>{for(let index=0;index<1002;index++)await db.prepare('INSERT INTO candidates(id,full_name,email,requisition_id,stage,created_at) VALUES(?,?,?,?,?,?)').run('load-'+index,'Load fixture','load'+index+'@example.invalid',index===1001?'rb':'ra','NEW','2026-01-01T00:00:00Z');});
    try{const first=await search({search:'Load fixture',page:'1',pageSize:'100'}),second=await search({search:'Load fixture',page:'2',pageSize:'100'}),last=await search({search:'Load fixture',page:'11',pageSize:'100'});assert.equal(first.total,1001);assert.equal(first.candidates.length,100);assert.equal(last.candidates.length,1);assert.equal(first.candidates.some(row=>row.id==='load-1001'),false);assert.equal(first.candidates.some(row=>second.candidates.some(other=>other.id===row.id)),false);}finally{await db.prepare("DELETE FROM candidates WHERE id LIKE 'load-%'").run();}
  });
  for(const filters of [{stage:'BAD'},{submittedFrom:'2026-02-30'},{submittedFrom:'2026-02-01',submittedTo:'2026-01-01'},{ratingMin:'NaN'},{ratingMin:'9',ratingMax:'1'},{search:[]},{page:'0'},{pageSize:'101'}])await check('invalid '+JSON.stringify(filters),()=>denied(()=>search(filters),400));
  for(const actor of [null,{id:'fake',roles:['ADMIN']},{id:'locked'}])await check('invalid actor '+actor?.id,()=>denied(()=>service.search({},actor)));
  await check('primary and support scopes',async()=>{assert.equal((await service.search({},{id:'support'})).total,2);assert.equal((await service.search({},{id:'other'})).total,2);});
  await check('HR ADMIN APPROVER broad read',async()=>{for(const id of ['hr','admin','approver'])assert.equal((await service.search({},{id})).total,4);});
  await check('multi-role per-row public projection',async()=>{const result=await service.search({},{id:'mixed',roles:['ADMIN']});assert.equal(result.total,3);const own=result.candidates.find(row=>row.id==='own');for(const key of ['stage','notes','sourceId','interviewAverage'])assert.equal(Object.hasOwn(own,key),false);assert.equal(own.status,'CLOSED');assert.equal(result.candidates.some(row=>row.id==='cb'),false);});
  await check('internal filter cannot infer own public metadata',async()=>assert.equal((await service.search({sourceId:'src-b'},{id:'mixed'})).total,0));
  await check('public CLOSED retains unknown and NULL mapping',async()=>{for(const stage of ['LEGACY_UNKNOWN',null]){await db.prepare("UPDATE candidates SET stage=? WHERE id='own'").run(stage);assert.equal((await service.search({stage:'CLOSED'},{id:'mixed'})).candidates.some(row=>row.id==='own'),true);}await db.prepare("UPDATE candidates SET stage='OFFER' WHERE id='own'").run();});
  await check('options scope hides other requisition/source/tag',async()=>{const result=await service.options(viewer);assert.deepEqual(result.requisitions.map(row=>row.id),['ra']);assert.deepEqual(result.sources.map(row=>row.id),['src-a']);assert.deepEqual(result.tags.map(row=>row.name),['Node.js']);});
  await check('saved filter persists criteria only',async()=>{const created=await service.saved(viewer,'POST',{name:'Monthly',filters:{tag:'Node.js',ratingMin:'8',roles:['ADMIN'],candidateId:'cb'}});const filters=(await service.saved(viewer)).filters;assert.equal(filters.length,1);assert.deepEqual(filters[0].filters,{tag:'Node.js',ratingMin:'8'});assert.equal((await search(filters[0].filters)).total,1);await service.saved({id:'other'},'DELETE',{},created.id);assert.equal((await service.saved(viewer)).filters.length,1);await service.saved(viewer,'DELETE',{},created.id);assert.equal((await service.saved(viewer)).filters.length,0);});
  await check('saved invalid rejected',()=>denied(()=>service.saved(viewer,'POST',{name:'',filters:{}}),400));
  await check('saved filter limit and locked owner enforced',async()=>{
    for(let index=0;index<50;index++)await service.saved(viewer,'POST',{name:'Filter '+index,filters:{search:'Alice'}});
    try{await denied(()=>service.saved(viewer,'POST',{name:'Over limit',filters:{}}),409);assert.equal((await service.saved(viewer)).filters.length,50);await denied(()=>service.saved({id:'locked'}));}finally{await db.prepare('DELETE FROM candidate_saved_filters WHERE user_id=?').run(viewer.id);}
  });
  await check('assignment revocation takes effect in saved search',async()=>{await service.saved({id:'support'},'POST',{name:'Saved',filters:{requisitionId:'ra'}});await db.prepare('DELETE FROM requisition_recruiter_supports WHERE user_id=?').run('support');assert.equal((await service.search((await service.saved({id:'support'})).filters[0].filters,{id:'support'})).total,0);});
  await check('grant revocation takes effect',async()=>{await db.prepare("DELETE FROM role_permissions WHERE role_id='RECRUITER' AND permission_id='read'").run();await denied(()=>search({}));await db.prepare("INSERT INTO role_permissions VALUES('RECRUITER','read')").run();});
  await check('HTTP auth alias and errors',async()=>{
    const Controller=require('../src/controllers/candidateSearchController'),controller=new Controller(service,new Rbac(db),{validateSession:async token=>({valid:token==='recruiter',user:{id:'recruiter',roles:['ADMIN']}})});
    const request=async(url,authorization,method='GET',body={})=>{let status,data;await controller.handle({method,headers:{authorization}}, {writeHead(code){status=code;},end(value){data=JSON.parse(value);}},new URL(url,'http://localhost'),async()=>body);return{status,data};};
    for(const prefix of ['/api/v1','']){assert.equal((await request(prefix+'/candidate-search','Bearer recruiter')).data.total,2);assert.equal((await request(prefix+'/candidate-search')).status,401);assert.equal((await request(prefix+'/candidate-search?page=0','Bearer recruiter')).status,400);assert.equal((await request(prefix+'/candidate-search-options','Bearer recruiter')).status,200);}
    assert.equal((await request('/api/v1/candidate-search','Bearer recruiter','POST')).status,405);
  });
  await check('merge column is detected after schema changes without recreating service',async()=>{
    assert.equal(await service.hasMergeColumn(),false);
    await db.exec('ALTER TABLE candidates ADD COLUMN merged_into_id TEXT REFERENCES candidates(id) ON DELETE SET NULL');
    assert.equal(await service.hasMergeColumn(),true);
    assert.equal((await search({})).total,2);
  });
  await check('merged candidates are excluded from results counts and pagination',async()=>{
    await db.prepare("UPDATE candidates SET merged_into_id='ca' WHERE id='cc'").run();
    try{
      const result=await search({pageSize:'1'});
      assert.equal(result.total,1);assert.deepEqual(result.candidates.map(row=>row.id),['ca']);
      assert.equal((await search({search:'Carol'})).total,0);
      assert.deepEqual((await search({page:'2',pageSize:'1'})).candidates,[]);
    }finally{await db.prepare("UPDATE candidates SET merged_into_id=NULL WHERE id='cc'").run();}
    assert.equal((await search({})).total,2);
  });
  await check('post-merge schema supports repeated searches in one transaction',async()=>{
    await db.transaction(async()=>{
      if(db.provider==='postgres')await db.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      for(let index=0;index<2;index++)assert.equal((await service.searchRows({},viewer)).total,2);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).n),4);
    });
  });
  await check('checksum tampering rejected',async()=>{await db.prepare("UPDATE ats_candidate_search_migrations SET checksum='wrong'").run();await assert.rejects(()=>migrate(db),/S505_CHECKSUM_MISMATCH/);});
  await check('availability false after checksum drift',async()=>assert.equal((await service.availability(viewer)).enabled,false));
}
async function browserTests(){
  await browserFixture('s5-05',async(page,viewport,db)=>{
    await test('Browser '+viewport.width+' search all fields and show real average',async()=>{
      await page.evaluate(()=>loadCandidates());await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('2'));
      await page.locator('#candidate-advanced-filters summary').click();
      await page.locator('#candidates-search-input').fill('Kubernetes');await page.locator('#candidates-search-input').press('Enter');
      await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('1'));
      assert.match(await page.locator('#candidates-table-body').innerText(),/Alice/);assert.match(await page.locator('#candidates-table-body').innerText(),/8\.00/);
      assert.equal(await page.locator('#candidates-table-body img').count(),0);
    });
    await test('Browser '+viewport.width+' save reuse survives reload',async()=>{
      await page.locator('#candidate-filter-name').fill('Monthly '+viewport.width);await page.locator('#candidate-filter-save').click();
      await page.waitForFunction(()=>document.getElementById('candidate-filter-saved').options.length>1);
      assert.ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidate_saved_filters').get()).n)>0);
      await page.locator('#candidate-filter-reset').click();await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('2'));
      const saved=await db.prepare('SELECT id FROM candidate_saved_filters WHERE name=?').get('Monthly '+viewport.width);
      await page.locator('#candidate-filter-saved').selectOption(saved.id);await page.locator('#candidate-filter-apply').click();
      await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('1'));assert.equal(await page.locator('#candidates-search-input').inputValue(),'Kubernetes');
      await page.reload();await page.addScriptTag({path:path.join(root,'frontend/js/api.js')});
      await page.evaluate(()=>{window.currentCandidatesList=[];window.currentRequisitionsList=[];window.STAGE_BADGES={};window.STAGE_LABELS={};window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));});
      await page.addScriptTag({path:path.join(root,'frontend/js/pages/candidates.js')});await page.evaluate(()=>loadCandidates());await page.waitForFunction(()=>document.getElementById('candidate-filter-saved').options.length>1);
      await page.locator('#candidate-advanced-filters summary').click();await page.locator('#candidate-filter-saved').selectOption(saved.id);await page.locator('#candidate-filter-apply').click();await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('1'));
    });
    await test('Browser '+viewport.width+' invalid filters visible error and no stale rows',async()=>{
      await page.locator('#candidate-date-from').fill('2026-03-01');await page.locator('#candidate-date-to').fill('2026-01-01');await page.locator('#candidates-refresh-btn').click();
      await page.waitForFunction(()=>document.getElementById('candidate-search-message').textContent.length>0);assert.doesNotMatch(await page.locator('#candidates-table-body').innerText(),/Alice/);
      await page.locator('#candidate-filter-reset').click();await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('2'));
      assert.equal(await page.locator('#candidate-rating-min').isVisible(),true);
    });
    await test('Browser '+viewport.width+' unapplied feature keeps legacy list without server errors',async()=>{
      const checksum=(await db.prepare('SELECT checksum FROM ats_candidate_search_migrations WHERE version=1').get()).checksum;
      await db.prepare("UPDATE ats_candidate_search_migrations SET checksum='pending'").run();
      try{await page.evaluate(()=>loadCandidates());await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('2'));assert.equal(await page.locator('#candidate-advanced-filters').isVisible(),false);assert.match(await page.locator('#candidates-table-body').innerText(),/Alice/);}finally{await db.prepare('UPDATE ats_candidate_search_migrations SET checksum=?').run(checksum);}
      await page.evaluate(()=>loadCandidates());await page.waitForFunction(()=>!document.getElementById('candidate-advanced-filters').classList.contains('hidden'));
    });
    await test('Browser '+viewport.width+' CSV preserves all filtered pages',async()=>{
      await db.transaction(async()=>{for(let index=0;index<60;index++)await db.prepare('INSERT INTO candidates(id,full_name,email,requisition_id,stage,created_at) VALUES(?,?,?,?,?,?)').run('export-'+index,'Export fixture','export'+index+'@example.invalid','ra','NEW','2026-01-01T00:00:00Z');});
      try{
        await page.evaluate(()=>{window.exportTableToCsv=(filename,headers,rows)=>{window.exportedRows=rows;};return loadCandidates();});
        assert.equal(await page.locator('#candidates-table-body tr').count(),50);
        await page.locator('#candidates-export-btn').click();await page.waitForFunction(()=>window.exportedRows?.length===62);assert.equal(await page.evaluate(()=>window.exportedRows.length),62);
      }finally{await db.prepare("DELETE FROM candidates WHERE id LIKE 'export-%'").run();}
      await page.evaluate(()=>loadCandidates());
    });
    await test('Browser '+viewport.width+' position action filters by requisition ID not candidate name',async()=>{
      await page.addScriptTag({path:path.join(root,'frontend/js/pages/requisitions.js')});
      await page.evaluate(async()=>{
        window.currentActiveView='requisitions';window.escapeDepartmentHtml=window.escapeHtml;window.showToast=()=>{};
        window.switchView=view=>{window.currentActiveView=view;return loadCandidates();};
        window.ATS_API.getRequisitions=async()=>({ok:true,data:{success:true,requisitions:[{id:'ra',title:'Engineer',status:'OPEN',code:'R-A'}]}});
        document.getElementById('requisitions-view').classList.remove('hidden');await loadRequisitions();
      });
      await page.locator('.btn-view-candidates-req').click();await page.waitForFunction(()=>document.getElementById('candidates-total-badge').textContent.startsWith('2')&&document.getElementById('candidates-table-body').textContent.includes('Alice'));
      assert.equal(await page.locator('#candidates-req-filter').inputValue(),'ra');assert.equal(await page.locator('#candidates-search-input').inputValue(),'');
      assert.match(await page.locator('#candidates-table-body').innerText(),/Alice/);await page.evaluate(()=>document.getElementById('requisitions-view').classList.add('hidden'));
    });
  });
}
async function runtimeTests(){
  config.REQUISITION_OPERATIONS_ENABLED=false;
  const {setup}=require('./test_s3_10'),app=await require('./helpers/coverageApplication').openApplication();
  try{
    await setup(app.db,'S505 runtime');await require('../src/db/migrate-candidate-portal').migrate(app.db);await migrate(app.db);
    const session=await app.login('hrmanager@company.com');
    await test('ATS runtime authenticated search and saved filter routes',async()=>{
      const id=(await app.db.prepare('SELECT id FROM candidates ORDER BY id LIMIT 1').get()).id;
      await app.db.prepare('UPDATE candidates SET cover_letter=? WHERE id=?').run('s505-runtime-unique-letter',id);
      assert.equal((await app.api('GET','/candidate-search-availability',session.token)).data.enabled,true);
      const result=await app.api('GET','/candidate-search?search=s505-runtime-unique-letter',session.token);assert.equal(result.status,200);assert.equal(result.data.total,1);assert.equal(result.data.candidates[0].id,id);
      const list=await app.api('GET','/candidates?advanced=1&search=s505-runtime-unique-letter',session.token);assert.equal(list.status,200);assert.equal(list.data.features.candidateSearch,true);assert.equal(list.data.total,1);assert.equal(list.data.candidates[0].id,id);
      assert.equal((await app.api('GET','/candidates?advanced=1&ratingMin=9&ratingMax=1',session.token)).status,400);
      assert.equal((await app.api('GET','/candidate-search')).status,401);
      const saved=await app.api('POST','/candidate-filters',session.token,{name:'Runtime',filters:{search:'s505-runtime-unique-letter'}});assert.equal(saved.status,201);
      assert.equal((await app.api('GET','/candidate-filters',session.token)).data.filters.length,1);assert.equal((await app.api('DELETE','/candidate-filters/'+saved.data.id,session.token)).status,200);
      assert.equal(Number((await app.db.prepare('SELECT COUNT(*) AS n FROM candidate_saved_filters').get()).n),0);
    });
  }finally{await app.close();}
}
providers(run).then(browserTests).then(runtimeTests).then(()=>console.log('S505_RESULT '+JSON.stringify({passed,failed:0,providers:['SQLite','PGlite'],browser:'Chromium desktop/mobile',nativePostgres:'NOT RUN'}))).catch(error=>{console.error(error);process.exitCode=1;});

async function browserFixture(story,action){
  const db=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));await fixture(db);await migrate(db);
  const service=new (story==='s5-05'?require('../src/services/candidateSearchService'):require('../src/services/talentPoolService'))(db);
  const Controller=story==='s5-05'?require('../src/controllers/candidateSearchController'):require('../src/controllers/talentPoolController');
  const controller=new Controller(service,new Rbac(db),{validateSession:async id=>({valid:Boolean(await db.prepare('SELECT id FROM users WHERE id=?').get(id)),user:{id,roles:[]}})});
  const server=require('node:http').createServer((req,res)=>db.withConnection(async()=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture'){
      let html=fs.readFileSync(path.join(root,'frontend/pages/candidates.html'),'utf8').replace('class="hidden"','class=""');
      if(story==='s5-05')html+=fs.readFileSync(path.join(root,'frontend/pages/requisitions.html'),'utf8');
      if(story==='s5-06')html+='<div id="requisitions-view"></div>';
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ats-api-base" content="/api/v1"><style>'+fs.readFileSync(path.join(root,'frontend/css/style.css'),'utf8')+'.hidden{display:none!important}body{padding:12px}</style>'+html);return;
    }
    if(story==='s5-05'&&url.pathname.startsWith('/api/v1/candidate-')||story==='s5-06'&&url.pathname.startsWith('/api/v1/talent-pool')){
      await controller.handle(req,res,url,async()=>{let body='';for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{};});return;
    }
    if(story==='s5-05'&&url.pathname==='/api/v1/candidates'){
      const id=(req.headers.authorization || '').replace('Bearer ','');
      const enabled=(await service.availability({id})).enabled;
      const result=enabled?await service.search(Object.fromEntries(url.searchParams),{id}):await new Requisitions(db).getCandidates({...Object.fromEntries(url.searchParams),viewer:{id}});result.features={candidateSearch:enabled};res.writeHead(result.statusCode || 200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
    }
    res.writeHead(404);res.end();
  }).catch(error=>{console.error(error);if(!res.headersSent)res.writeHead(500);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await require('playwright').chromium.launch({headless:true});
  try{
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
      const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
      await page.evaluate(story=>{
        sessionStorage.setItem('ats_token',story==='s5-05'?'recruiter':'hr');
        window.currentAuthenticatedUser={id:story==='s5-05'?'recruiter':'hr',roles:[story==='s5-05'?'RECRUITER':'HR_MANAGER']};
        window.currentCandidatesList=[];window.currentRequisitionsList=[];window.STAGE_BADGES={};window.STAGE_LABELS={};window.showToast=()=>{};window.exportTableToCsv=()=>{};window.switchView=()=>{};
        window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));window.ATS_APP_HELPERS={viewCandidateDetails:id=>{window.lastViewedCandidate=id;}};
      },story);
      await page.addScriptTag({path:path.join(root,'frontend/js/api.js')});
      if(story==='s5-05')await page.addScriptTag({path:path.join(root,'frontend/js/pages/candidates.js')});
      else await page.addScriptTag({path:path.join(root,'frontend/js/components/talent-pool.js')});
      await action(page,viewport,db);
      assert.deepEqual(errors,[]);
      const artifacts=process.env.ATS_E2E_ARTIFACTS;if(artifacts){fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,story+'-'+viewport.width+'.png'),fullPage:true});}
      await page.close();
    }
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
}
