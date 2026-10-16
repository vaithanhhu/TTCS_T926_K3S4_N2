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
    CREATE TABLE interviews(id TEXT PRIMARY KEY,candidate_id TEXT,interviewer_id TEXT,status TEXT,score INTEGER);
    CREATE TABLE candidate_documents(id TEXT PRIMARY KEY,candidate_id TEXT,document_type TEXT,parsed_text TEXT);
    CREATE TABLE requisition_screening_criteria(requisition_id TEXT,required_skills_json TEXT);
    CREATE TABLE candidate_status_history(id TEXT PRIMARY KEY,candidate_id TEXT,action TEXT);
    INSERT INTO permissions VALUES('read','candidate.read'),('write','candidate.update');
    INSERT INTO recruitment_catalog_items VALUES('src-a','LinkedIn'),('src-b','Referral');
    INSERT INTO departments VALUES('dep','hiring');
    INSERT INTO requisitions VALUES('ra','R-A','Engineer','Engineering','recruiter','hiring','hiring','dep','jt-a','OPEN'),('rb','R-B','Designer','Design','other','other','other','dep','jt-b','OPEN'),('rc','R-C','Engineer','Engineering','other','other','other','dep','jt-a','DRAFT');
    INSERT INTO requisition_recruiter_supports VALUES('ra','support');
    INSERT INTO candidates VALUES('ca','Alice Nguyen','same@example.invalid','0901112222','ra','INTERVIEW',3,'Acme',2000,'Internal A','src-a',NULL,'2026-01-01T00:00:00Z','Kubernetes contributor'),('cb','Secret Bob','same@example.invalid','0903334444','rb','REJECTED',4,'Hidden',3000,'Internal B','src-b',NULL,'2026-01-31T23:59:59Z','Hidden cover letter'),('cc','Carol','carol@example.invalid','0905556666','ra','REJECTED',5,'Company',4000,'Internal C','src-a',NULL,'2026-02-01T00:00:00Z','Engineering'),('own','Mixed own','mixed@example.invalid','0909999999','rb','OFFER',2,'Owned',1000,'Never public','src-b',NULL,'2026-01-15T00:00:00Z','Own letter');
    INSERT INTO candidate_tags VALUES('ta','ca','Node.js'),('tb','cb','Secret tag'),('tc','cc','Node.js'),('td','ca','Node.js');
    INSERT INTO interviews VALUES('ia','ca','interviewer','COMPLETED',9),('ia2','ca','interviewer','COMPLETED',7),('ia3','ca','interviewer','COMPLETED',NULL),('ia4','ca','interviewer','SCHEDULED',100),('ib','cb','other','COMPLETED',10),('ic','cc','interviewer','COMPLETED',NULL);
    INSERT INTO candidate_documents VALUES('da','ca','CV','Node.js Docker'),('db','cb','CV','Design Figma'),('dc','cc','CV','Node.js Kubernetes');
    INSERT INTO requisition_screening_criteria VALUES('ra','["Node.js","Docker"]');
    INSERT INTO candidate_status_history VALUES('history','cc','REJECTED');`);
  for(const code of ['ADMIN','HR_MANAGER','RECRUITER','HIRING_MGR','APPROVER','INTERVIEWER','CANDIDATE']){
    await db.prepare('INSERT INTO roles VALUES(?,?)').run(code,code);
    await db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(code,'read');
    if(['HR_MANAGER','RECRUITER'].includes(code))await db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(code,'write');
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

const Pool=require('../src/services/talentPoolService');
const migrate=require('../src/db/migrate-talent-pool').migrate;
async function run(db,provider){
  const service=new Pool(db),hr={id:'hr'},valid={candidateId:'cc',reason:'Strong final round; retain for future role',finalRoundConfirmed:true};
  const check=(name,action)=>test(provider+' '+name,action);
  await check('availability false before schema without writes',async()=>assert.equal((await service.availability(hr)).enabled,false));
  await check('missing prerequisite fails without ledger or partial schema',async()=>{await assert.rejects(()=>db.transaction(async()=>{await db.exec('DROP TABLE candidate_tags');await migrate(db);}));assert.equal((await service.availability(hr)).enabled,false);assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidate_tags').get()).n),4);});
  await check('independent migration repeat preserves grants',async()=>{const before=await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all();await migrate(db);await migrate(db);assert.deepEqual(await db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_id').all(),before);});
  await check('availability true after matching migration',async()=>assert.equal((await service.availability(hr)).enabled,true));
  await check('no automatic pool enrollment',async()=>assert.equal((await service.search({},hr)).total,0));
  for(const id of ['recruiter','other','support','hiring','approver','interviewer','candidate','mixed','locked','fake'])await check('denied role/account '+id,async()=>{await denied(()=>service.add(valid,{id,roles:['ADMIN']}));await denied(()=>service.search({},{id,roles:['ADMIN']}));await denied(()=>service.suggest('ra',{id,roles:['ADMIN']}));assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidate_talent_pool').get()).n),0);});
  await check('missing actor denied before validation',()=>denied(()=>service.add({},null)));
  await check('confirmation required boolean',async()=>{for(const finalRoundConfirmed of [false,undefined,'true',1])await denied(()=>service.add({...valid,finalRoundConfirmed},hr),400);});
  await check('reason required',()=>denied(()=>service.add({...valid,reason:' '},hr),400));
  await check('candidate must exist',()=>denied(()=>service.add({...valid,candidateId:'missing'},hr),404));
  await check('candidate must be REJECTED',()=>denied(()=>service.add({...valid,candidateId:'ca'},hr),409));
  await check('HR add keeps history and stage',async()=>{const before=await db.prepare('SELECT * FROM candidate_status_history').all();const candidate=await db.prepare("SELECT * FROM candidates WHERE id='cc'").get();const result=await service.add({...valid,confirmedBy:'admin'},hr);assert.equal(result.statusCode,201);const row=await db.prepare("SELECT * FROM candidate_talent_pool WHERE candidate_id='cc'").get();assert.equal(row.confirmed_by,'hr');assert.equal(row.reason,valid.reason);assert.ok(row.final_round_confirmed);assert.deepEqual(await db.prepare('SELECT * FROM candidate_status_history').all(),before);assert.deepEqual(await db.prepare("SELECT * FROM candidates WHERE id='cc'").get(),candidate);});
  await check('idempotent add does not overwrite confirmation or reason',async()=>{const result=await service.add({...valid,reason:'Replacement reason'},hr);assert.equal(result.alreadyInPool,true);assert.equal((await db.prepare("SELECT reason FROM candidate_talent_pool WHERE candidate_id='cc'").get()).reason,valid.reason);});
  await check('ADMIN bypass retains real identity',async()=>{assert.equal((await service.add({...valid,candidateId:'cb',interestedTitle:'Designer'},{id:'admin'})).statusCode,201);});
  await check('search title',async()=>assert.deepEqual((await service.search({title:'Engineer'},hr)).candidates.map(row=>row.candidateId),['cc']));
  await check('Vietnamese title and skill case-insensitive',async()=>{await db.prepare("UPDATE candidate_talent_pool SET interested_title=? WHERE candidate_id='cc'").run('Kỹ sư ĐIỆN'.normalize('NFD'));await db.prepare("INSERT INTO candidate_tags VALUES('vietnamese','cc',?)").run('ĐIỆN tử'.normalize('NFD'));try{assert.equal((await service.search({title:'kỹ sư điện',skill:'điện tử'},hr)).total,1);}finally{await db.prepare("UPDATE candidate_talent_pool SET interested_title='Engineer' WHERE candidate_id='cc'").run();await db.prepare("DELETE FROM candidate_tags WHERE id='vietnamese'").run();}});
  await check('search skill from tags',async()=>assert.deepEqual((await service.search({skill:'Node.js'},hr)).candidates.map(row=>row.candidateId),['cc']));
  await check('search skill from parsed CV',async()=>assert.deepEqual((await service.search({skill:'Figma'},hr)).candidates.map(row=>row.candidateId),['cb']));
  await check('combined title and skill',async()=>assert.equal((await service.search({title:'Engineer',skill:'Figma'},hr)).total,0));
  await check('no SQL injection or wildcard expansion',async()=>{for(const title of ["%' OR 1=1 --",'%','_'])assert.equal((await service.search({title},hr)).total,0);});
  await check('pagination count and empty',async()=>{const a=await service.search({pageSize:'1'},hr),b=await service.search({pageSize:'1',page:'2'},hr);assert.equal(a.total,2);assert.equal(b.total,2);assert.notEqual(a.candidates[0].candidateId,b.candidates[0].candidateId);assert.deepEqual((await service.search({page:'3',pageSize:'1'},hr)).candidates,[]);});
  await check('invalid pagination/filter',async()=>{for(const input of [{page:'0'},{pageSize:'101'},{title:[]},{skill:'a'.repeat(201)}])await denied(()=>service.search(input,hr),400);});
  await check('suggest matches title and skills with evidence',async()=>{const result=await service.suggest('ra',hr);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].candidateId,'cc');assert.equal(result.candidates[0].titleMatch,true);assert.deepEqual(result.candidates[0].matchedSkills,['Node.js']);assert.equal(result.candidates[0].matchScore,2);assert.equal(Object.hasOwn(result.candidates[0],'parsed_text'),false);assert.equal(Object.hasOwn(result.candidates[0],'storage_path'),false);});
  await check('suggest does not require S5-05 schema',async()=>{const result=await service.suggest('rb',hr);assert.equal(result.candidates[0].candidateId,'cb');});
  await check('draft and missing requisition refused',async()=>{await denied(()=>service.suggest('rc',hr),409);await denied(()=>service.suggest('missing',hr),404);});
  await check('missing screening criteria table uses title only',async()=>{await db.exec('DROP TABLE requisition_screening_criteria');assert.equal((await service.suggest('ra',hr)).candidates[0].titleMatch,true);});
  await check('grant revoked blocks read and write',async()=>{await db.prepare("DELETE FROM role_permissions WHERE role_id='HR_MANAGER'").run();await denied(()=>service.add(valid,hr));await denied(()=>service.search({},hr));await db.prepare("INSERT INTO role_permissions VALUES('HR_MANAGER','read'),('HR_MANAGER','write')").run();});
  await check('rollback after insert restores previous state',async()=>{await db.prepare("UPDATE candidates SET stage='REJECTED' WHERE id='ca'").run();const prepare=db.prepare.bind(db);db.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO candidate_talent_pool'))return{...statement,run:async(...params)=>{await statement.run(...params);throw Error('INJECTED_FAILURE');}};return statement;};try{await assert.rejects(()=>service.add({...valid,candidateId:'ca'},hr),/INJECTED_FAILURE/);}finally{db.prepare=prepare;}assert.equal(await db.prepare("SELECT id FROM candidate_talent_pool WHERE candidate_id='ca'").get(),undefined);});
  await check('HTTP boundary alias and denied spoof',async()=>{
    const Controller=require('../src/controllers/talentPoolController'),controller=new Controller(service,new Rbac(db),{validateSession:async token=>({valid:['hr','recruiter'].includes(token),user:{id:token,roles:['ADMIN']}})});
    const request=async(url,token,method='GET',body={})=>{let status,data;await controller.handle({method,headers:{authorization:token?'Bearer '+token:undefined}}, {writeHead(code){status=code;},end(value){data=JSON.parse(value);}},new URL(url,'http://localhost'),async()=>body);return{status,data};};
    for(const prefix of ['/api/v1','']){assert.equal((await request(prefix+'/talent-pool','hr')).data.total,2);assert.equal((await request(prefix+'/talent-pool','recruiter')).status,403);assert.equal((await request(prefix+'/talent-pool')).status,401);assert.equal((await request(prefix+'/talent-pool/suggestions?requisitionId=ra','hr')).status,200);}
  });
  await check('checksum drift rejected',async()=>{await db.prepare("UPDATE ats_talent_pool_migrations SET checksum='wrong'").run();await assert.rejects(()=>migrate(db),/S506_CHECKSUM_MISMATCH/);});
  await check('availability false after checksum drift',async()=>assert.equal((await service.availability(hr)).enabled,false));
}
async function browserTests(){
  await browserFixture('s5-06',async(page,viewport,db)=>{
    await db.prepare("DELETE FROM candidate_talent_pool WHERE candidate_id='cc'").run();
    await test('Browser '+viewport.width+' explicit final-round confirmation and reason',async()=>{
      await page.evaluate(()=>window.ATS_TALENT_POOL.refreshCandidates([{id:'cc',fullName:'Carol',stage:'REJECTED'}]));
      await page.locator('#talent-pool-panel').waitFor({state:'visible'});await page.locator('#talent-pool-candidate').selectOption('cc');
      await page.locator('#talent-pool-reason').fill('Browser confirmed final-round');
      assert.equal(await page.locator('#talent-pool-confirm').evaluate(node=>node.checkValidity()),false);
      await page.locator('#talent-pool-confirm').check();await page.locator('#talent-pool-add button').click();
      await page.waitForFunction(()=>document.getElementById('talent-pool-results').textContent.includes('Browser confirmed final-round'));
      assert.equal((await db.prepare("SELECT stage FROM candidates WHERE id='cc'").get()).stage,'REJECTED');
      assert.equal((await db.prepare("SELECT confirmed_by FROM candidate_talent_pool WHERE candidate_id='cc'").get()).confirmed_by,'hr');
    });
    await test('Browser '+viewport.width+' skill search and new position suggestions',async()=>{
      await page.locator('#talent-pool-search-skill').fill('Node.js');await page.locator('#talent-pool-search button').click();
      await page.waitForFunction(()=>document.getElementById('talent-pool-results').textContent.includes('Carol'));
      await page.evaluate(()=>window.ATS_TALENT_POOL.refreshRequisitions([{id:'ra',title:'Engineer',status:'OPEN'}]));
      await page.waitForFunction(()=>document.getElementById('talent-pool-suggestion-results').textContent.includes('Carol'));
      assert.match(await page.locator('#talent-pool-suggestion-results').innerText(),/Node\.js/);await page.locator('#talent-pool-suggestion-results button').click();assert.equal(await page.evaluate(()=>window.lastViewedCandidate),'cc');
    });
    await test('Browser '+viewport.width+' recruiter cannot see pool or suggestions',async()=>{
      await page.evaluate(()=>{currentAuthenticatedUser={id:'recruiter',roles:['RECRUITER']};sessionStorage.setItem('ats_token','recruiter');window.ATS_TALENT_POOL.refreshCandidates([]);window.ATS_TALENT_POOL.refreshRequisitions([]);});
      assert.equal(await page.locator('#talent-pool-panel').isVisible(),false);assert.equal(await page.locator('#talent-pool-suggestions').isVisible(),false);
      const response=await page.evaluate(()=>window.ATS_API.talentPoolApi('recruiter'));assert.equal(response.ok,false);assert.equal(response.data.statusCode,403);
    });
  });
}
async function runtimeTests(){
  config.REQUISITION_OPERATIONS_ENABLED=false;
  const {setup}=require('./test_s3_10'),app=await require('./helpers/coverageApplication').openApplication();
  try{
    await setup(app.db,'S506 runtime');await require('../src/db/migrate-candidate-portal').migrate(app.db);
    await require('../src/db/migrate-candidate-stage-transitions').migrate(app.db);config.CANDIDATE_STAGE_TRANSITIONS_ENABLED=true;
    await migrate(app.db);
    const hr=await app.login('hrmanager@company.com'),recruiter=await app.login('recruiter@company.com');
    await test('ATS runtime HR add and suggestions, recruiter denied',async()=>{
      const candidate=await app.db.prepare("SELECT c.id,c.requisition_id FROM candidates c JOIN requisitions r ON r.id=c.requisition_id WHERE r.status='OPEN' AND c.stage<>'REJECTED' ORDER BY c.id LIMIT 1").get();assert.ok(candidate);
      const reason=await app.db.prepare("SELECT id FROM recruitment_catalog_items WHERE type='REJECTION_REASON' AND status='ACTIVE' ORDER BY id LIMIT 1").get();assert.ok(reason);
      const rejected=await app.api('PUT','/candidates/'+candidate.id+'/stage',hr.token,{stage:'REJECTED',rejectionReasonId:reason.id,notes:'Final-round retention fixture'});assert.equal(rejected.status,200);
      const before=await app.db.prepare('SELECT * FROM candidate_status_history ORDER BY id').all();
      assert.ok(before.some(row=>row.candidate_id===candidate.id&&row.after_stage==='REJECTED'));
      assert.equal((await app.api('GET','/talent-pool/availability',hr.token)).data.enabled,true);
      const result=await app.api('POST','/talent-pool',hr.token,{candidateId:candidate.id,reason:'Runtime confirmed final round',finalRoundConfirmed:true});assert.equal(result.status,201);
      assert.equal((await app.api('GET','/talent-pool',hr.token)).data.total,1);
      const suggested=await app.api('GET','/talent-pool/suggestions?requisitionId='+encodeURIComponent(candidate.requisition_id),hr.token);assert.equal(suggested.status,200);assert.equal(suggested.data.candidates[0].candidateId,candidate.id);
      assert.equal((await app.api('GET','/talent-pool',recruiter.token)).status,403);assert.equal((await app.api('POST','/talent-pool',recruiter.token,{candidateId:candidate.id,reason:'Denied',finalRoundConfirmed:true,roles:['ADMIN']})).status,403);
      assert.deepEqual(await app.db.prepare('SELECT * FROM candidate_status_history ORDER BY id').all(),before);
      assert.equal(Number((await app.db.prepare('SELECT COUNT(*) AS n FROM candidate_talent_pool').get()).n),1);
    });
  }finally{await app.close();}
}
providers(run).then(browserTests).then(runtimeTests).then(()=>console.log('S506_RESULT '+JSON.stringify({passed,failed:0,providers:['SQLite','PGlite'],browser:'Chromium desktop/mobile',nativePostgres:'NOT RUN'}))).catch(error=>{console.error(error);process.exitCode=1;});

async function browserFixture(story,action){
  const db=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));await fixture(db);await migrate(db);
  const service=new (story==='s5-05'?require('../src/services/candidateSearchService'):require('../src/services/talentPoolService'))(db);
  const Controller=story==='s5-05'?require('../src/controllers/candidateSearchController'):require('../src/controllers/talentPoolController');
  const controller=new Controller(service,new Rbac(db),{validateSession:async id=>({valid:Boolean(await db.prepare('SELECT id FROM users WHERE id=?').get(id)),user:{id,roles:[]}})});
  const server=require('node:http').createServer((req,res)=>db.withConnection(async()=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture'){
      let html=fs.readFileSync(path.join(root,'frontend/pages/candidates.html'),'utf8').replace('class="hidden"','class=""');
      if(story==='s5-06')html+='<div id="requisitions-view"></div>';
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ats-api-base" content="/api/v1"><style>'+fs.readFileSync(path.join(root,'frontend/css/style.css'),'utf8')+'.hidden{display:none!important}body{padding:12px}</style>'+html);return;
    }
    if(story==='s5-05'&&url.pathname.startsWith('/api/v1/candidate-')||story==='s5-06'&&url.pathname.startsWith('/api/v1/talent-pool')){
      await controller.handle(req,res,url,async()=>{let body='';for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{};});return;
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
