const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Use an isolated source export');
assert.equal(fs.existsSync(path.join(root, '.env')), false, 'Use an isolated source export');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_PROVIDER, 'sqlite');
const Requisitions = require('../src/services/requisitionService');
const Portal = require('../src/services/candidatePortalService');
const config = require('../src/config/config');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }
const publicKeys = ['createdAt','currentCompany','email','expectedSalary','experienceYears','fullName','id','phoneNumber','requisition','status','statusLabel'];
const internalKeys = ['code','createdAt','currentCompany','email','expectedSalary','experienceYears','fullName','id','notes','phoneNumber','rejectionReasonId','rejectionReasonName','requisition','sourceId','sourceName','stage'];
function publicRow(row) {
  assert.deepEqual(Object.keys(row).sort(), publicKeys);
  assert.deepEqual(Object.keys(row.requisition).sort(), ['departmentName','title']);
  assert.ok(['RECEIVED','IN_REVIEW','INTERVIEWING','CLOSED','WITHDRAWN'].includes(row.status));
  for (const key of ['notes','privateNotes','history','evaluation','score','storagePath','sourceId','sourceName','stage','code','rejectionReasonId','rejectionReasonName']) assert.equal(Object.hasOwn(row,key),false);
}
function internalRow(row) { assert.deepEqual(Object.keys(row).sort(),internalKeys); assert.deepEqual(Object.keys(row.requisition).sort(),['code','departmentName','id','title']); assert.equal(row.notes,'Internal note'); }
async function run(db, provider) {
  config.REQUISITION_OPERATIONS_ENABLED = true;
  const boolean = provider === 'SQLite' ? 'INTEGER' : 'BOOLEAN', bool = value => provider === 'SQLite' ? Number(value) : value;
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${boolean},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE departments(id TEXT PRIMARY KEY,manager_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,code TEXT,title TEXT,department_name TEXT,recruiter_id TEXT,hiring_manager_id TEXT,created_by TEXT,department_id TEXT);
    CREATE TABLE requisition_recruiter_supports(requisition_id TEXT,user_id TEXT);
    CREATE TABLE interviews(candidate_id TEXT,interviewer_id TEXT);
    CREATE TABLE recruitment_catalog_items(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,full_name TEXT,email TEXT,phone_number TEXT,stage TEXT,experience_years INTEGER,current_company TEXT,expected_salary INTEGER,notes TEXT,source_id TEXT,rejection_reason_id TEXT,created_at TEXT,requisition_id TEXT);
  `);
  const actors = {admin:['ADMIN'],hr:['HR_MANAGER'],approver:['APPROVER'],primary:['RECRUITER'],support:['RECRUITER'],hiring:['HIRING_MGR'],interviewer:['INTERVIEWER'],candidate:['CANDIDATE'],mixed:['RECRUITER','CANDIDATE'],other:['CANDIDATE']};
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('read','candidate.read');
  for (const role of new Set(Object.values(actors).flat())) { await db.prepare('INSERT INTO roles VALUES (?,?)').run(role,role); await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role,'read'); }
  for (const [id,roles] of Object.entries(actors)) { await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, ['candidate','mixed'].includes(id)?'own@example.test':id+'@example.test','Verified '+id,'ACTIVE',bool(false),null); for(const role of roles) await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id,role); }
  await db.prepare('INSERT INTO departments VALUES (?,?)').run('dept','hiring');
  for(const id of ['ra','rb']) await db.prepare('INSERT INTO requisitions VALUES (?,?,?,?,?,?,?,?)').run(id,'REQ-'+id,'Position '+id,'Department',id==='ra'?'primary':'other',id==='ra'?'hiring':'other',id==='ra'?'hiring':'other',id==='ra'?'dept':null);
  for(const id of ['support','mixed']) await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra',id);
  await db.prepare('INSERT INTO recruitment_catalog_items VALUES (?,?)').run('source','Internal source');
  await db.prepare('INSERT INTO recruitment_catalog_items VALUES (?,?)').run('rejection','Internal reason');
  for(const [id,email,req,stage] of [['ca','OWN@EXAMPLE.TEST','ra','NEW'],['cb','own@example.test','rb','HIRED'],['cc','own+other@example.test','rb','INTERVIEW'],['cd','outside@example.test','rb','SCREENING']]) await db.prepare('INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'Person '+id,email,'0123456789',stage,3,'Company',20000000,'Internal note','source','rejection','2026-10-01',req);
  await db.prepare('INSERT INTO interviews VALUES (?,?)').run('ca','interviewer');
  const service = new Requisitions(db), actor = id => id===null?null:{id,roles:['ADMIN'],email:'outside@example.test'};
  const list = (id='candidate',options={}) => service.getCandidates({...options,viewer:actor(id)});
  const detail = (id='candidate',candidate='ca') => service.getCandidateById(candidate,actor(id));
  const check = (name,fn) => test(provider+' '+name,fn);
  await check('own rows and count only',async()=>{const r=await list();assert.deepEqual(r.candidates.map(row=>row.id).sort(),['ca','cb']);assert.equal(r.total,2);r.candidates.forEach(publicRow);assert.equal(JSON.stringify(r).includes('Internal'),false);});
  await check('detail uses public projection',async()=>publicRow((await detail()).data));
  await check('foreign and missing detail indistinguishable',async()=>{assert.deepEqual(await detail('candidate','cc'),await detail('candidate','missing'));});
  await check('near email does not match',async()=>assert.equal((await detail('candidate','cc')).success,false));
  await check('search and requisition filter cannot widen scope',async()=>{assert.equal((await list('candidate',{search:'outside',requisitionId:'rb',candidateEmail:'outside@example.test'})).total,0);assert.equal((await list('candidate',{requisitionId:'rb'})).total,1);});
  await check('public field values preserved',async()=>{const row=(await detail()).data;assert.equal(row.phoneNumber,'0123456789');assert.equal(row.experienceYears,3);assert.equal(row.currentCompany,'Company');assert.equal(row.expectedSalary,20000000);assert.equal(row.requisition.title,'Position ra');assert.equal(row.requisition.departmentName,'Department');});
  for(const stage of ['NEW','APPLIED','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN']) await check(stage+' matches S4 public mapping',async()=>{await db.prepare('UPDATE candidates SET stage=? WHERE id=?').run(stage,'ca');const row=(await detail()).data;publicRow(row);const expected=Portal.mapPublicStatus(stage);assert.equal(row.status,expected.code);assert.equal(row.statusLabel,expected.label);});
  await db.prepare("UPDATE candidates SET stage='NEW' WHERE id='ca'").run();
  await check('internal stage filter cannot disclose public row stage',async()=>assert.equal((await list('candidate',{stage:'HIRED'})).total,0));
  await check('public status filter works',async()=>assert.deepEqual((await list('candidate',{stage:'CLOSED'})).candidates.map(row=>row.id),['cb']));
  for(const stage of ['LEGACY_UNKNOWN',null]) await check('S4 default CLOSED mapping and filter '+String(stage),async()=>{await db.prepare('UPDATE candidates SET stage=? WHERE id=?').run(stage,'ca');assert.equal((await detail()).data.status,'CLOSED');assert.ok((await list('candidate',{stage:'CLOSED'})).candidates.some(row=>row.id==='ca'));await db.prepare("UPDATE candidates SET stage='NEW' WHERE id='ca'").run();});
  for(const id of ['admin','hr','approver']) await check(id+' wide scope and exact internal DTO',async()=>{const r=await list(id);assert.equal(r.total,4);r.candidates.forEach(internalRow);});
  for(const id of ['primary','support','hiring','interviewer']) await check(id+' independent internal scope',async()=>{const r=await list(id);assert.deepEqual(r.candidates.map(row=>row.id),['ca']);internalRow(r.candidates[0]);assert.equal((await detail(id,'cb')).success,false);});
  await check('mixed per-row projection',async()=>{const r=await list('mixed');assert.equal(r.total,2);internalRow(r.candidates.find(row=>row.id==='ca'));publicRow(r.candidates.find(row=>row.id==='cb'));assert.equal((await detail('mixed','cd')).success,false);});
  await check('mixed filters preserve internal pipeline only in internal scope',async()=>{assert.equal((await list('mixed',{stage:'HIRED'})).total,0);assert.equal((await list('mixed',{stage:'NEW'})).total,1);assert.equal((await list('mixed',{stage:'CLOSED'})).total,1);});
  await check('current roles override forged actor',async()=>publicRow((await detail()).data));
  for(const id of [null,'missing']) await check(String(id)+' actor denied',async()=>{const r=await list(id);assert.equal(r.success,false);assert.deepEqual(r.candidates,[]);assert.equal(Object.hasOwn(r,'total'),false);});
  await check('missing viewer is denied',async()=>{const r=await service.getCandidates({candidateEmail:'own@example.test'});assert.equal(r.statusCode,403);assert.deepEqual(r.candidates,[]);});
  await check('locked account denied',async()=>{await db.prepare("UPDATE users SET status='LOCKED' WHERE id='candidate'").run();assert.equal((await list()).success,false);await db.prepare("UPDATE users SET status='ACTIVE' WHERE id='candidate'").run();});
  await check('revoked grant denied',async()=>{await db.prepare("DELETE FROM role_permissions WHERE role_id='CANDIDATE'").run();assert.equal((await list()).success,false);await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('CANDIDATE','read');});
  await check('assignment removal takes effect',async()=>{await db.prepare("DELETE FROM requisition_recruiter_supports WHERE user_id='support'").run();assert.equal((await list('support')).total,0);});
  await check('role revocation takes effect for stale actor',async()=>{await db.prepare("DELETE FROM user_roles WHERE user_id='mixed' AND role_id='RECRUITER'").run();(await list('mixed')).candidates.forEach(publicRow);});
  await check('report caller retains authenticated approver and internal stages',async()=>{service.getRequisitions=async()=>({items:['ra','rb'].map(id=>({id,status:'OPEN',headcount:1,departmentName:'Department'})),total:2});service.getInterviews=async()=>({interviews:[]});const r=await service.scopedDashboardStats({viewer:{id:'approver',roles:['APPROVER']}});assert.equal(r.stats.candidates.total,4);assert.equal(r.stats.candidates.hired,1);});
}
async function httpBrowser() {
  const {startServer,server} = require('../src/server');
  const {getDatabase} = require('../src/db/database');
  await startServer(0);
  const db=getDatabase(),base='http://127.0.0.1:'+server.address().port;
  let browser;
  try {
    await db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p WHERE r.code='CANDIDATE' AND p.code='candidate.read'").run();
    const service=new Requisitions(db),created=await service.createCandidate({fullName:'P4 Own',email:'candidate@example.com',notes:'P4 Secret',stage:'HIRED'}),foreign=await service.createCandidate({fullName:'P4 Foreign',email:'other@example.test',notes:'Other Secret'});
    assert.equal(created.success,true);assert.equal(foreign.success,true);
    await db.prepare('UPDATE candidates SET created_at=? WHERE id=?').run('2030-01-01',created.data.id);
    const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'candidate@example.com',password:'Ats@123456'})});
    const auth=await login.json();assert.equal(login.status,200);const token=auth.data.token;
    const api=async route=>{const r=await fetch(base+route,{headers:{Authorization:'Bearer '+token}});return{status:r.status,data:await r.json()};};
    for(const prefix of ['/api/v1/candidates','/candidates']) {
      await test('HTTP '+prefix+' scoped list public fields',async()=>{const r=await api(prefix+'?viewerId=usr-admin&candidateEmail=other@example.test');assert.equal(r.status,200);assert.ok(r.data.candidates.length>0);for(const row of r.data.candidates){assert.equal(row.email.toLowerCase(),'candidate@example.com');assert.equal(Object.hasOwn(row,'stage'),false);assert.equal(Object.hasOwn(row,'notes'),false);}});
      await test('HTTP '+prefix+' own detail public fields',async()=>{const r=await api(prefix+'/'+created.data.id);assert.equal(r.status,200);assert.equal(r.data.data.status,'CLOSED');assert.equal(Object.hasOwn(r.data.data,'rejectionReasonId'),false);});
      await test('HTTP '+prefix+' foreign detail denied',async()=>assert.equal((await api(prefix+'/'+foreign.data.id)).status,403));
      await test('HTTP '+prefix+' anonymous denied',async()=>assert.equal((await fetch(base+prefix)).status,401));
    }
    browser=await require('playwright').chromium.launch({headless:true});
    const html=fs.readFileSync(path.join(root,'frontend/pages/candidate-portal.html'),'utf8'),script=fs.readFileSync(path.join(root,'frontend/js/pages/candidate-portal.js'),'utf8');
    const row=(await api('/api/v1/candidates/'+created.data.id)).data.data;
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
      const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route(base+'/p4-tracker-fixture',route=>route.fulfill({contentType:'text/html',body:html.replace('class="hidden"','class=""')}));await page.goto(base+'/p4-tracker-fixture');await page.addScriptTag({content:script});
      for(const status of ['RECEIVED','IN_REVIEW','INTERVIEWING','CLOSED','WITHDRAWN']) await test('Chromium '+viewport.width+' public tracker '+status,async()=>{
        await page.evaluate(async({row,status,token})=>{sessionStorage.setItem('ats_token',token);window.currentAuthenticatedUser={email:'candidate@example.com',fullName:'P4 Own'};window.ATS_API={getCandidatesApi:async()=>({ok:true,data:{candidates:[{...row,status}]}}),getInterviewsApi:async()=>({ok:true,data:{interviews:[]}}),getOffersApi:async()=>({ok:true,data:{offers:[]}})};await loadCandidatePortal();},{row,status,token});
        const text=await page.locator('#cand-portal-pipeline-tracker').innerText();assert.equal(/Offer|Hired|Nhận Việc|Sơ loại/.test(text),false);assert.equal(await page.locator('[aria-current="step"]').count(),1);assert.equal(await page.locator('#cand-portal-stage-badge').innerText(),Portal.mapPublicStatus({RECEIVED:'NEW',IN_REVIEW:'SCREENING',INTERVIEWING:'INTERVIEW',CLOSED:'HIRED',WITHDRAWN:'WITHDRAWN'}[status]).label);assert.deepEqual(errors,[]);
      });
      const output=process.env.ATS_E2E_ARTIFACTS;if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'p4-tracker-'+viewport.width+'.png'),fullPage:true});}await page.close();
      await test('Chromium '+viewport.width+' actual login portal and API projection',async()=>{
        const context=await browser.newContext({viewport});
        try {
          await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({contentType:'text/css',body:''}));
          const live=await context.newPage();const errors=[];live.on('pageerror',error=>errors.push(error.message));
          await live.goto(base+'/login');await live.waitForSelector('html[data-app-ready="true"]');
          await live.locator('#email').fill('candidate@example.com');await live.locator('#password').fill('Ats@123456');
          const response=live.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/candidates'&&r.request().method()==='GET');
          await live.locator('#login-form button[type=submit]').click();await live.waitForURL(base+'/candidate');
          const payload=await (await response).json();assert.ok(payload.candidates.some(row=>row.id===created.data.id));for(const item of payload.candidates){assert.equal(Object.hasOwn(item,'notes'),false);assert.equal(Object.hasOwn(item,'stage'),false);}
          await live.waitForFunction(()=>document.getElementById('cand-portal-stage-badge')?.textContent==='Kết thúc quá trình xét duyệt');
          assert.equal(/Offer|Hired|Nhận Việc/.test(await live.locator('#cand-portal-pipeline-tracker').innerText()),false);assert.deepEqual(errors,[]);
          if(output)await live.screenshot({path:path.join(output,'p4-live-portal-'+viewport.width+'.png'),fullPage:true});
        } finally {await context.close();}
      });
    }
    await db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT 'usr-candidate',id FROM roles WHERE code='RECRUITER'").run();
    const position=await db.prepare('SELECT id FROM requisitions LIMIT 1').get();
    await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('usr-candidate',position.id);
    const internal=await service.createCandidate({fullName:'P4 Internal',email:'internal@example.test',requisitionId:position.id,stage:'SCREENING',notes:'Internal note'});assert.equal(internal.success,true);
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]) await test('Chromium '+viewport.width+' mixed list and detail consumers',async()=>{
      const context=await browser.newContext({viewport});
      try {
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({contentType:'text/css',body:''}));
        const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/login');await page.waitForSelector('html[data-app-ready="true"]');
        await page.locator('#email').fill('candidate@example.com');await page.locator('#password').fill('Ats@123456');await page.locator('#login-form button[type=submit]').click();await page.waitForURL(base+'/recruitment');await page.goto(base+'/candidates');
        const own=page.locator('#candidates-table-body tr').filter({hasText:'P4 Own'});await own.waitFor();assert.ok((await own.innerText()).includes('Kết thúc quá trình xét duyệt'));assert.equal((await own.innerText()).includes('undefined'),false);
        const internalRow=page.locator('#candidates-table-body tr').filter({hasText:'P4 Internal'});await internalRow.waitFor();assert.equal((await internalRow.innerText()).includes('undefined'),false);
        let unified=0;page.on('request',r=>{if(new URL(r.url()).pathname.includes('/candidates/unified/'))unified++;});await own.locator('button').click();await page.locator('#candidate-detail-modal').waitFor({state:'visible'});
        assert.equal(await page.locator('#cand-detail-stage-badge').innerText(),'Kết thúc quá trình xét duyệt');assert.equal(await page.locator('#cand-detail-save-stage-btn').isDisabled(),true);assert.equal(await page.locator('#cand-detail-notes-list').innerText(),'—');assert.equal(unified,0);
        await page.locator('#close-candidate-detail-modal').click();await internalRow.locator('button').click();await page.locator('#candidate-detail-modal').waitFor({state:'visible'});assert.equal(await page.locator('#cand-detail-save-stage-btn').isDisabled(),false);assert.deepEqual(errors,[]);
        await page.evaluate(()=>{window.ATS_API.getUnifiedProfileApi=()=>new Promise(resolve=>{window.__p4ResolveUnified=resolve;});});
        await page.locator('#close-candidate-detail-modal').click();await internalRow.locator('button').click();await page.locator('#candidate-detail-modal').waitFor({state:'visible'});
        await page.locator('#close-candidate-detail-modal').click();await own.locator('button').click();await page.locator('#candidate-detail-modal').waitFor({state:'visible'});
        await page.evaluate(async()=>{window.__p4ResolveUnified({ok:true,data:{data:{notes:[{text:'P4 Late Private',authorName:'HR'}],tags:[],documents:[],applications:[]}}});await new Promise(resolve=>setTimeout(resolve,0));});
        assert.equal(await page.locator('#cand-detail-notes-list').innerText(),'—');assert.equal((await page.locator('#candidate-detail-modal').innerText()).includes('P4 Late Private'),false);
        const output=process.env.ATS_E2E_ARTIFACTS;if(output)await page.screenshot({path:path.join(output,'p4-mixed-consumers-'+viewport.width+'.png'),fullPage:true});
      } finally {await context.close();}
    });
  } finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
}
async function main() {
  if(process.argv.includes('--http-browser')) await httpBrowser();
  else {
    const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));try{await run(sqlite,'SQLite');}finally{sqlite.close();}
    const engine=new(require('@electric-sql/pglite').PGlite)();const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});try{await run(pg,'PGlite');}finally{await pg.close();}
    if(process.env.ATS_P4_PG_URL){const url=new URL(process.env.ATS_P4_PG_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/ats_p4_test(?:_[a-z0-9]+)?$/);const live=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});try{await run(live,'PostgreSQL');}finally{await live.close();}}
  }
  console.log('P4_RESULT '+JSON.stringify({passed,failed:0,livePostgres:Boolean(process.env.ATS_P4_PG_URL),httpBrowser:process.argv.includes('--http-browser')}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
