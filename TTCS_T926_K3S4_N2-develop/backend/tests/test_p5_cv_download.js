const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Use an isolated source export');
assert.equal(fs.existsSync(path.join(root, '.env')), false, 'Use an isolated source export');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_PROVIDER, 'sqlite');
const Portal = require('../src/services/candidatePortalService');
const Controller = require('../src/controllers/candidatePortalController');
const config = require('../src/config/config');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
const storage = path.join(root, 'backend/data/cv_uploads');
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }
const pdf = (() => {
  const text='BT /F1 14 Tf 30 90 Td (ATS TEST CV - SYNTHETIC DATA) Tj ET';
  const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 150] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>','<< /Length '+text.length+' >>\nstream\n'+text+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let value='%PDF-1.4\n';const offsets=[0];
  for(const [i,body] of bodies.entries()){offsets.push(Buffer.byteLength(value));value+=(i+1)+' 0 obj\n'+body+'\nendobj\n';}
  const xref=Buffer.byteLength(value);value+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(value);
})();
async function fixture(db, provider) {
  config.REQUISITION_OPERATIONS_ENABLED = true;
  const boolean = provider === 'SQLite' ? 'INTEGER' : 'BOOLEAN';
  const bool = value => provider === 'SQLite' ? Number(value) : value;
  await db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${boolean},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT); CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT); CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE departments(id TEXT PRIMARY KEY,manager_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,recruiter_id TEXT,hiring_manager_id TEXT,created_by TEXT,department_id TEXT);
    CREATE TABLE requisition_recruiter_supports(requisition_id TEXT,user_id TEXT);
    CREATE TABLE interviews(candidate_id TEXT,interviewer_id TEXT,status TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,email TEXT,requisition_id TEXT);
    CREATE TABLE candidate_documents(id TEXT PRIMARY KEY,candidate_id TEXT,storage_path TEXT,file_name TEXT,mime_type TEXT,file_hash TEXT,file_size INTEGER,document_type TEXT);`);
  const roles = {admin:['ADMIN'],hr:['HR_MANAGER'],approver:['APPROVER'],primary:['RECRUITER'],support:['RECRUITER'],outside:['RECRUITER'],hiring:['HIRING_MGR'],manager:['HIRING_MGR'],creator:['HIRING_MGR'],wrongHiring:['HIRING_MGR'],candidate:['CANDIDATE'],other:['CANDIDATE'],interviewer:['INTERVIEWER'],history:['INTERVIEWER'],wrongInterviewer:['INTERVIEWER'],mixed:['RECRUITER','CANDIDATE'],noScope:['HIRING_MGR','INTERVIEWER'],unknown:['EMPLOYEE']};
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('read','candidate.read');
  for (const role of new Set(Object.values(roles).flat())) { await db.prepare('INSERT INTO roles VALUES (?,?)').run(role,role); await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role,'read'); }
  for (const [id,list] of Object.entries(roles)) { await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,['candidate','mixed'].includes(id)?'own@example.test':id+'@example.test','Verified '+id,'ACTIVE',bool(false),null); for (const role of list) await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id,role); }
  await db.prepare('INSERT INTO departments VALUES (?,?)').run('dept','manager');
  await db.prepare('INSERT INTO requisitions VALUES (?,?,?,?,?)').run('ra','primary','hiring','creator','dept');
  await db.prepare('INSERT INTO requisitions VALUES (?,?,?,?,?)').run('rb','outside','wrongHiring','other',null);
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','support');
  for (const [id,email,req] of [['ca','OWN@EXAMPLE.TEST','ra'],['cb','other@example.test','rb'],['cc','own@example.test','rb']]) await db.prepare('INSERT INTO candidates VALUES (?,?,?)').run(id,email,req);
  await db.prepare('INSERT INTO interviews VALUES (?,?,?)').run('ca','interviewer','SCHEDULED');
  await db.prepare('INSERT INTO interviews VALUES (?,?,?)').run('ca','history','COMPLETED');
  const service = new Portal(db);
  fs.writeFileSync(path.join(storage,'fixture.pdf'),pdf);
  const zip = new (require('jszip'))(); zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<document/>');
  const docx = await zip.generateAsync({type:'nodebuffer'});fs.writeFileSync(path.join(storage,'fixture.docx'),docx);
  const insert = (id,candidate='ca',file='fixture.pdf',name='CV tiếng Việt.pdf',type='CV',bytes=pdf) => db.prepare('INSERT INTO candidate_documents VALUES (?,?,?,?,?,?,?,?)').run(id,candidate,file,name,'text/html',crypto.createHash('sha256').update(bytes).digest('hex'),bytes.length,type);
  await insert('da');await insert('db','cb');await insert('dc','cc');await insert('docx','ca','fixture.docx','CV tiếng Việt.docx','CV',docx);await insert('noncv','ca','fixture.pdf','CV.pdf','OTHER');
  return {db,service,insert,actor:id=>id===null?null:{id,roles:['ADMIN'],email:'other@example.test'},bool};
}
async function consume(document) {
  assert.equal(document.success,true);
  const result=await document.openStream();assert.equal(result.success,true);
  const chunks=[];try {for await(const chunk of result.stream)chunks.push(chunk);} finally {await document.close();}
  return Buffer.concat(chunks);
}
async function run(db, provider) {
  const f=await fixture(db,provider), {service,actor,insert}=f;
  const get=(id='primary',doc='da')=>service.getCvDocument(doc,actor(id));
  const check=(name,fn)=>test(provider+' '+name,fn);
  for (const id of ['primary','support','candidate','interviewer','history','hiring','creator','manager','approver','hr','admin','mixed']) await check(id+' valid bytes',async()=>assert.deepEqual(await consume(await get(id)),pdf));
  for (const id of ['outside','wrongHiring','wrongInterviewer','other','noScope','unknown']) await check(id+' out of scope same 404',async()=>{assert.deepEqual(await get(id),await get(id,'missing'));assert.equal((await get(id)).statusCode,404);});
  await check('candidate cannot use matching email from caller',async()=>assert.equal((await get('candidate','db')).statusCode,404));
  await check('multi-role ownership union on another requisition',async()=>assert.deepEqual(await consume(await get('mixed','dc')),pdf));
  await check('same email never expands recruiter scope',async()=>assert.equal((await get('primary','dc')).statusCode,404));
  for(const id of [null,'fake']) await check('invalid actor '+id,async()=>assert.equal((await get(id)).statusCode,403));
  await check('LOCKED fresh account rejects stale role',async()=>{await db.prepare('UPDATE users SET status=? WHERE id=?').run('LOCKED','primary');assert.equal((await get()).statusCode,403);await db.prepare('UPDATE users SET status=? WHERE id=?').run('ACTIVE','primary');});
  await check('revoked grant rejects',async()=>{await db.prepare('DELETE FROM role_permissions WHERE role_id=?').run('RECRUITER');assert.equal((await get()).statusCode,403);await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','read');});
  await check('ADMIN bypasses physical grant only',async()=>{await db.prepare('DELETE FROM role_permissions WHERE role_id=?').run('ADMIN');assert.deepEqual(await consume(await get('admin')),pdf);await db.prepare('UPDATE users SET status=? WHERE id=?').run('LOCKED','admin');assert.equal((await get('admin')).statusCode,403);await db.prepare('UPDATE users SET status=? WHERE id=?').run('ACTIVE','admin');});
  await check('non-CV is absent',async()=>assert.equal((await get('admin','noncv')).statusCode,404));
  await check('invalid document control characters',async()=>assert.equal((await get('admin','bad\0')).statusCode,400));
  await check('denied request never opens or reads a file',async()=>{const real=fs.promises.open;let calls=0;fs.promises.open=async(...args)=>{calls++;return real(...args);};try {assert.equal((await get('outside')).statusCode,404);assert.equal((await get(null)).statusCode,403);assert.equal(calls,0);}finally{fs.promises.open=real;}});
  for(const [label,file] of [['absolute',path.join(storage,'fixture.pdf')],['drive','C:\\outside.pdf'],['traversal','../fixture.pdf'],['missing','missing.pdf'],['empty',''],['directory','folder']]) await check(label+' path blocked',async()=>{fs.mkdirSync(path.join(storage,'folder'),{recursive:true});await insert('path-'+label,'ca',file);const result=await get('admin','path-'+label);assert.equal(result.statusCode,404);assert.equal(JSON.stringify(result).includes(storage),false);});
  await check('symlink outside root blocked',async()=>{const outside=path.join(root,'outside-'+provider);fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,'fixture.pdf'),pdf);const link=path.join(storage,'escape-'+provider);fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');try {await insert('escape','ca','escape-'+provider+'/fixture.pdf');assert.equal((await get('admin','escape')).statusCode,404);}finally{fs.unlinkSync(link);}});
  await check('replace file between stat and open denied and descriptor closed',async()=>{const real=fs.promises.open;let opened;fs.promises.open=async(file,...args)=>{fs.renameSync(file,file+'.old');fs.writeFileSync(file,pdf);opened=await real(file,...args);return opened;};try{assert.equal((await get('admin')).statusCode,404);assert.equal(opened.fd,-1);}finally{fs.promises.open=real;fs.unlinkSync(path.join(storage,'fixture.pdf'));fs.renameSync(path.join(storage,'fixture.pdf.old'),path.join(storage,'fixture.pdf'));}});
  await check('DOCX format and MIME normalized',async()=>{const result=await get('admin','docx');assert.equal(result.mimeType,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.ok((await consume(result)).length>0);});
  for(const [id,bytes,name] of [['html',Buffer.from('<html>bad</html>'),'bad.pdf'],['svg',Buffer.from('<svg onload="evil"/>'),'bad.svg'],['zip',Buffer.from([80,75,3,4,1,2,3,4]),'bad.docx']]) await check(id+' not served as CV',async()=>{fs.writeFileSync(path.join(storage,id),bytes);await insert(id,'ca',id,name,'CV',bytes);assert.equal((await get('admin',id)).statusCode,404);});
  await check('mismatching hash rejected',async()=>{await db.prepare('UPDATE candidate_documents SET file_hash=? WHERE id=?').run('bad','da');assert.equal((await get('admin')).statusCode,404);await db.prepare('UPDATE candidate_documents SET file_hash=? WHERE id=?').run(crypto.createHash('sha256').update(pdf).digest('hex'),'da');});
  for(const kind of ['grant','locked','assignment','owner','path','hash','candidate-move']) await check(kind+' changes before stream: no bytes and fd closed',async()=>{
    const real=fs.promises.open;let opened;fs.promises.open=async(...args)=>(opened=await real(...args));let document;
    try{document=await get();assert.equal(document.success,true);}finally{fs.promises.open=real;}
    if(kind==='grant')await db.prepare('DELETE FROM role_permissions WHERE role_id=?').run('RECRUITER');
    if(kind==='locked')await db.prepare('UPDATE users SET status=? WHERE id=?').run('LOCKED','primary');
    if(kind==='assignment')await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('outside','ra');
    if(kind==='owner')await db.prepare('UPDATE candidate_documents SET candidate_id=? WHERE id=?').run('cb','da');
    if(kind==='path')await db.prepare('UPDATE candidate_documents SET storage_path=? WHERE id=?').run('fixture.docx','da');
    if(kind==='hash')await db.prepare('UPDATE candidate_documents SET file_hash=? WHERE id=?').run('changed','da');
    if(kind==='candidate-move')await db.prepare('UPDATE candidates SET requisition_id=? WHERE id=?').run('rb','ca');
    const result=await document.openStream();assert.equal(result.success,false);assert.equal(Object.hasOwn(result,'stream'),false);assert.equal(opened.fd,-1);
    if(kind==='grant')await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','read');
    await db.prepare('UPDATE users SET status=? WHERE id=?').run('ACTIVE','primary');await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('primary','ra');await db.prepare('UPDATE candidates SET requisition_id=? WHERE id=?').run('ra','ca');await db.prepare('UPDATE candidate_documents SET candidate_id=?,storage_path=?,file_hash=? WHERE id=?').run('ca','fixture.pdf',crypto.createHash('sha256').update(pdf).digest('hex'),'da');
  });
  await check('success and explicit close release descriptor',async()=>{const real=fs.promises.open;let opened;fs.promises.open=async(...args)=>(opened=await real(...args));try{const doc=await get('admin');assert.deepEqual(await consume(doc),pdf);assert.equal(opened.fd,-1);await doc.close();assert.equal((await doc.openStream()).success,false);}finally{fs.promises.open=real;}});
  await check('path changed during preparation fails final authorization and closes descriptor',async()=>{const real=fs.promises.open;let opened;fs.promises.open=async(...args)=>{opened=await real(...args);await db.prepare('UPDATE candidate_documents SET candidate_id=? WHERE id=?').run('cb','da');return opened;};try{assert.equal((await get()).statusCode,404);assert.equal(opened.fd,-1);}finally{fs.promises.open=real;await db.prepare('UPDATE candidate_documents SET candidate_id=? WHERE id=?').run('ca','da');}});
  await check('caller actor object mutation never changes authenticated identity',async()=>{const caller=actor('primary');const document=await service.getCvDocument('da',caller);caller.id='admin';await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('outside','ra');try{assert.equal((await document.openStream()).statusCode,404);}finally{await document.close();await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('primary','ra');}});
  await check('open failure is sanitized',async()=>{const real=fs.promises.open;fs.promises.open=async()=>{throw Error(storage);};try{const result=await get('admin');assert.equal(result.statusCode,404);assert.equal(JSON.stringify(result).includes(storage),false);}finally{fs.promises.open=real;}});
  await check('second stream and abandoned preparation close safely',async()=>{const real=fs.promises.open;let opened;fs.promises.open=async(...args)=>(opened=await real(...args));try{const doc=await get('admin');const started=await doc.openStream();assert.equal(started.success,true);assert.equal((await doc.openStream()).success,false);await doc.close();assert.equal(opened.fd,-1);assert.equal(started.stream.destroyed,true);}finally{fs.promises.open=real;}});
  await check('grant revoked during final descriptor verification prevents bytes',async()=>{const real=fs.promises.open;let opened;fs.promises.open=async(...args)=>(opened=await real(...args));let doc;try{doc=await get();}finally{fs.promises.open=real;}const stat=opened.stat.bind(opened);opened.stat=async()=>{await db.prepare('DELETE FROM role_permissions WHERE role_id=?').run('RECRUITER');return stat();};try{const result=await doc.openStream();assert.equal(result.statusCode,403);assert.equal(Object.hasOwn(result,'stream'),false);assert.equal(opened.fd,-1);}finally{await doc.close();await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','read');}});
  await check('authorization transactions finish before file IO and download',async()=>{const real=db.transaction,open=fs.promises.open;let inside=false,transactions=0;db.transaction=action=>real.call(db,async()=>{inside=true;transactions++;try{return await action();}finally{inside=false;}});fs.promises.open=async(...args)=>{assert.equal(inside,false);return open(...args);};try{const doc=await get('admin');assert.equal(inside,false);const prepared=await doc.openStream();assert.equal(inside,false);const chunks=[];for await(const chunk of prepared.stream){assert.equal(inside,false);chunks.push(chunk);}await doc.close();assert.deepEqual(Buffer.concat(chunks),pdf);assert.equal(transactions,3);}finally{db.transaction=real;fs.promises.open=open;}});
  return f;
}
async function httpBrowser(f) {
  const http=require('node:http');const {service}=f;
  const handles=new Set();const real=fs.promises.open;fs.promises.open=async(...args)=>{const h=await real(...args);handles.add(h);return h;};
  const rbac={async authorize(req,res){const id=req.headers.authorization?.replace(/^Bearer /,'');if(!id){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Unauthorized'}));return null;}const actor=await service.rbac.getAuthorizedActor(id,'candidate.read');if(!actor){res.writeHead(403,{'Content-Type':'application/json'});res.end('{}');return null;}return actor;}};
  const controller=new Controller(service,rbac,{});
  const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}return controller.handle(req,res,new URL(req.url,'http://localhost'),async()=>({}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const url=id=>base+'/api/v1/candidates/documents/'+id+'/download';
  const request=(id='da',token='admin')=>fetch(url(id),{headers:token?{Authorization:'Bearer '+token}:{}});
  let browser;
  try {
    await test('HTTP missing Bearer 401',async()=>assert.equal((await request('da',null)).status,401));
    await test('HTTP authentication infrastructure failure hides SQL path and stack',async()=>{const original=rbac.authorize;rbac.authorize=async()=>{throw Error('SELECT private SQL '+storage);};try{const response=await request();assert.equal(response.status,503);const text=await response.text();assert.equal(text.includes('SELECT'),false);assert.equal(text.includes(storage),false);assert.equal(text.includes('stack'),false);}finally{rbac.authorize=original;}});
    await test('HTTP malformed encoding 400',async()=>assert.equal((await request('%ZZ')).status,400));
    await test('HTTP outscope 404 identical absent',async()=>{const a=await request('da','outside'),b=await request('missing','outside');assert.equal(a.status,404);assert.equal(await a.text(),await b.text());});
    await test('HTTP PDF inline unicode filename security headers and exact bytes',async()=>{const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''CV/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);});
    await test('HTTP DOCX attachment',async()=>{const response=await request('docx');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);await response.arrayBuffer();});
    await test('HTTP unsafe file sanitized error',async()=>{const response=await request('path-absolute');assert.equal(response.status,404);const text=await response.text();assert.equal(text.includes(storage),false);assert.equal(text.includes('SELECT'),false);});
    await test('HTTP async stream failure cleans fd',async()=>{const original=service.getCvDocument.bind(service);service.getCvDocument=async(...args)=>{const d=await original(...args);const start=d.openStream;d.openStream=async()=>{const s=await start();s.stream._read=function(){this.destroy(Error('private-path-must-not-leak'));};return s;};return d;};try{await assert.rejects(async()=>{const response=await request();await response.arrayBuffer();});}finally{service.getCvDocument=original;}await new Promise(resolve=>setTimeout(resolve,50));assert.ok([...handles].every(h=>h.fd===-1));});
    await test('HTTP abort while preparing cleans descriptor',async()=>{const original=service.getCvDocument.bind(service);let prepared;service.getCvDocument=async(...args)=>{prepared=await original(...args);await new Promise(resolve=>setTimeout(resolve,50));return prepared;};try{await new Promise(resolve=>{const req=http.get(url('da'),{headers:{Authorization:'Bearer admin'}});req.on('error',()=>resolve());setTimeout(()=>req.destroy(),15);});await new Promise(resolve=>setTimeout(resolve,120));assert.ok([...handles].every(h=>h.fd===-1));}finally{service.getCvDocument=original;}});
    await test('HTTP client abort after first bytes closes opened descriptor',async()=>{const bytes=Buffer.concat([pdf,Buffer.alloc(2*1024*1024,32)]);fs.writeFileSync(path.join(storage,'large.pdf'),bytes);await f.insert('large','ca','large.pdf','large.pdf','CV',bytes);const original=service.getCvDocument.bind(service);service.getCvDocument=async(...args)=>{const d=await original(...args);const start=d.openStream;d.openStream=async()=>{const s=await start();const read=s.stream._read;s.stream._read=function(size){setTimeout(()=>{if(!this.destroyed)read.call(this,size);},20);};return s;};return d;};try{await new Promise((resolve,reject)=>{const req=http.get(url('large'),{headers:{Authorization:'Bearer admin'}},res=>{res.once('data',()=>{res.destroy();req.destroy();resolve();});res.on('error',()=>{});});req.on('error',error=>{if(error.code==='ECONNRESET')resolve();else reject(error);});});await new Promise(resolve=>setTimeout(resolve,120));assert.ok([...handles].every(h=>h.fd===-1));}finally{service.getCvDocument=original;}});
    await test('HTTP filename header injection neutralized',async()=>{await f.insert('header','ca','fixture.pdf','bad"\r\nX-Evil: yes.pdf');const response=await request('header');assert.equal(response.status,200);assert.equal(response.headers.get('x-evil'),null);assert.equal(response.headers.get('content-disposition').includes('\r'),false);assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8''/);await response.arrayBuffer();});
    await test('HTTP preserves supplementary Unicode in safe filename',async()=>{const name='CV\u{1f600}.pdf';await f.insert('emoji','ca','fixture.pdf',name);const response=await request('emoji');assert.equal(response.status,200);const filename=response.headers.get('content-disposition').split("filename*=UTF-8''")[1];assert.equal(decodeURIComponent(filename),name);await response.arrayBuffer();});
    await test('HTTP recheck fails never streams bytes',async()=>{const original=service.getCvDocument.bind(service);service.getCvDocument=async(...args)=>{const d=await original(...args);await f.db.prepare('UPDATE users SET status=? WHERE id=?').run('LOCKED','primary');return d;};try{const response=await request('da','primary');assert.equal(response.status,403);assert.equal((await response.text()).includes('%PDF'),false);}finally{service.getCvDocument=original;await f.db.prepare('UPDATE users SET status=? WHERE id=?').run('ACTIVE','primary');}});
    browser=await require('playwright').chromium.launch({headless:true,channel:'chromium'});
    await test('Chromium cross-origin binary flow keeps authenticated Unicode filename',async()=>{const frontend=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<meta name="ats-api-base" content="'+base+'/api/v1">');});await new Promise(resolve=>frontend.listen(0,'127.0.0.1',resolve));const context=await browser.newContext();const page=await context.newPage();try{await page.goto('http://127.0.0.1:'+frontend.address().port+'/fixture');await page.addScriptTag({path:path.join(root,'frontend/js/api.js')});const result=await page.evaluate(async()=>{const r=await window.ATS_API.downloadCandidateCvApi('admin','docx');return{ok:r.ok,fileName:r.fileName,mimeType:r.mimeType,status:r.status,data:r.data};});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.fileName,'CV tiếng Việt.docx');assert.equal(result.mimeType,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');}finally{await context.close();frontend.closeAllConnections();await new Promise(resolve=>frontend.close(resolve));}});
    for(const viewport of [{width:1366,height:768},{width:390,height:844}])await test('Chromium authenticated existing download flow '+viewport.width,async()=>{
      const context=await browser.newContext({viewport,acceptDownloads:true});await context.tracing.start({screenshots:true,snapshots:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<meta name="ats-api-base" content="/api/v1"><button data-cv-download="da">Xem / Tải CV</button>'}));await page.goto(base+'/fixture');
      await page.addScriptTag({path:path.join(root,'frontend/js/api.js')});
      const source=fs.readFileSync(path.join(root,'frontend/js/components/candidate-dialogs.js'),'utf8');const start=source.indexOf('  async function downloadCandidateCv('),end=source.indexOf('  async function loadCandidateUnifiedProfile(',start);
      await page.addScriptTag({content:source.slice(start,end)});
      const loadEnd=source.indexOf('  function renderCandidateTags(',end);
      await page.addScriptTag({content:"let candidateDetailsGeneration=1;function escapeHtml(s){const e=document.createElement('span');e.textContent=s;return e.innerHTML;}function renderCandidateTags(){}function renderCandidateNotes(){}"+source.slice(end,loadEnd)});
      await page.evaluate(async()=>{sessionStorage.setItem('ats_token','admin');document.body.innerHTML='<div id="cand-detail-documents-list"></div>';window.ATS_API.getUnifiedProfileApi=async()=>({ok:true,data:{data:{documents:[{id:'da',fileName:'Demo CV.pdf',fileSize:50}],applications:[],tags:[],notes:[]}}});await loadCandidateUnifiedProfile('ca','admin');});
      assert.equal(await page.locator('[data-cv-download]').count(),1);assert.equal(await page.locator('a[href*="/download"]').count(),0);assert.equal((await page.locator('[data-cv-download]').evaluate(e=>e.outerHTML)).includes('admin'),false);
      await page.evaluate(()=>{sessionStorage.setItem('ats_token','admin');window.__created=[];window.__revoked=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);window.__created.push(u);return u;};URL.revokeObjectURL=u=>{window.__revoked.push(u);revoke(u);};});
      const requests=[];page.on('request',req=>{if(req.url().includes('/download'))requests.push({url:req.url(),auth:req.headers().authorization});});
      const popupPromise=page.waitForEvent('popup');await page.locator('button').click();const popup=await popupPromise;await page.waitForFunction(()=>window.__created.length===1);assert.equal(requests[0].auth,'Bearer admin');assert.equal(requests[0].url.includes('admin'),false);assert.equal(await page.locator('button').getAttribute('disabled'),null);await popup.waitForURL(/^blob:/);assert.equal(popup.isClosed(),false);await popup.waitForTimeout(1500);const previewOut=process.env.ATS_E2E_ARTIFACTS;if(previewOut){fs.mkdirSync(previewOut,{recursive:true});await popup.screenshot({path:path.join(previewOut,'p5-preview-'+viewport.width+'.png')});}await popup.close();await page.waitForFunction(()=>window.__revoked.length===1);
      await page.evaluate(()=>document.querySelector('button').dataset.cvDownload='docx');const downloadPromise=page.waitForEvent('download');await page.locator('button').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'CV tiếng Việt.docx');await page.waitForFunction(()=>window.__revoked.length===2);
      assert.deepEqual(errors,[]);const out=process.env.ATS_E2E_ARTIFACTS;if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'p5-download-'+viewport.width+'.png')});await page.locator('button').focus();await page.keyboard.press('Tab');await context.tracing.stop({path:path.join(out,'p5-download-'+viewport.width+'.zip')});}await context.close();
    });
  } finally {fs.promises.open=real;if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const h of handles)await h.close().catch(()=>{});}
}
async function nativeConcurrency(db) {
  const service=new Portal(db);const client=await db.pool.connect();
  try {
    await test('native PostgreSQL independent connection revokes grant before stream',async()=>{const doc=await service.getCvDocument('da',{id:'primary'});assert.equal(doc.success,true);await client.query('BEGIN');await client.query("DELETE FROM role_permissions WHERE role_id='RECRUITER'");await client.query('COMMIT');const result=await doc.openStream();assert.equal(result.statusCode,403);assert.equal(Object.hasOwn(result,'stream'),false);await doc.close();await client.query("INSERT INTO role_permissions VALUES ('RECRUITER','read')");});
    await test('native PostgreSQL independent connection handover before stream',async()=>{const doc=await service.getCvDocument('da',{id:'primary'});assert.equal(doc.success,true);await client.query("UPDATE requisitions SET recruiter_id='outside' WHERE id='ra'");assert.equal((await doc.openStream()).statusCode,404);await doc.close();await client.query("UPDATE requisitions SET recruiter_id='primary' WHERE id='ra'");});
    await test('native PostgreSQL prepared download keeps no row lock blocking handover',async()=>{const doc=await service.getCvDocument('da',{id:'primary'});await client.query("SET statement_timeout='1000ms'");await client.query("UPDATE requisitions SET recruiter_id='outside' WHERE id='ra'");assert.equal((await doc.openStream()).success,false);await doc.close();await client.query("UPDATE requisitions SET recruiter_id='primary' WHERE id='ra'");});
  } finally {client.release();}
}
async function main() {
  const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));
  try{const f=await run(sqlite,'SQLite');if(process.argv.includes('--http-browser'))await httpBrowser(f);}finally{sqlite.close();}
  if(!process.argv.includes('--http-browser')) {
    const engine=new(require('@electric-sql/pglite').PGlite)();const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});try{await run(pg,'PGlite');}finally{await pg.close();}
    if(process.env.ATS_P5_PG_URL){const url=new URL(process.env.ATS_P5_PG_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/ats_p5_test(?:_[a-z0-9]+)?$/);const live=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});try{await run(live,'PostgreSQL');await nativeConcurrency(live);}finally{await live.close();}}
  }
  console.log('P5_RESULT '+JSON.stringify({passed,failed:0,livePostgres:Boolean(process.env.ATS_P5_PG_URL),httpBrowser:process.argv.includes('--http-browser')}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
