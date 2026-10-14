const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.env')), false, 'Use an isolated source export');
assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Use an isolated source export');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_PROVIDER, 'sqlite');
let state = {}, inTransaction = false, passed = 0;
const parserModule = require.resolve('pdf-parse');
require.cache[parserModule] = { id:parserModule,filename:parserModule,loaded:true,exports:{PDFParse:class {
  async getText() { state.calls++;assert.equal(inTransaction,false,'Parser must run outside a transaction');if(state.hook)await state.hook();if(state.throw)throw Error('TEST_PARSER_FAILURE');return {text:state.text}; }
  async destroy() { state.destroyed++; }
}} };
const Portal = require('../src/services/candidatePortalService');
const config = require('../src/config/config');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
async function run(db, provider, peer = db) {
  config.REQUISITION_OPERATIONS_ENABLED = true;
  const bool = value => provider === 'sqlite' ? Number(value) : value;
  const boolean = provider === 'sqlite' ? 'INTEGER' : 'BOOLEAN';
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${boolean},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,recruiter_id TEXT);
    CREATE TABLE requisition_recruiter_supports(requisition_id TEXT,user_id TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,requisition_id TEXT,email TEXT);
    CREATE TABLE candidate_documents(id TEXT PRIMARY KEY,candidate_id TEXT,file_name TEXT,storage_path TEXT,file_hash TEXT,mime_type TEXT,document_type TEXT,created_at TEXT,parsed_text TEXT,parsed_data_json TEXT);
  `);
  const roles = {admin:['ADMIN'],hr:['HR_MANAGER'],a:['RECRUITER'],b:['RECRUITER'],support:['RECRUITER'],hiring:['HIRING_MGR'],approver:['APPROVER'],candidate:['CANDIDATE'],interviewer:['INTERVIEWER'],mixed:['RECRUITER','HIRING_MGR','APPROVER']};
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('parse','candidate.cv.parse');
  for (const role of new Set(Object.values(roles).flat())) {
    await db.prepare('INSERT INTO roles VALUES (?,?)').run(role,role);
    await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role,'parse');
  }
  for (const [id, rs] of Object.entries(roles)) {
    await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id+'@example.test',id,'ACTIVE',bool(false),null);
    for(const role of rs)await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id,role);
  }
  await db.prepare('INSERT INTO requisitions VALUES (?,?)').run('ra','a');
  await db.prepare('INSERT INTO requisitions VALUES (?,?)').run('rb','b');
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','support');
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','mixed');
  await db.prepare('INSERT INTO candidates VALUES (?,?,?)').run('ca','ra','same@example.test');
  await db.prepare('INSERT INTO candidates VALUES (?,?,?)').run('cb','rb','same@example.test');
  const portal = new Portal(db), storage = path.join(root,'backend/data/cv_uploads');
  const contents=Buffer.from('%PDF-1.4 empty test fixture');
  fs.writeFileSync(path.join(storage,'p2.pdf'),contents);
  const hash=crypto.createHash('sha256').update(contents).digest('hex');
  for(const [id,candidate,created] of [['da','ca','2026-10-12'],['latest','ca','2026-10-14'],['db','cb','2026-10-14']]) {
    await db.prepare('INSERT INTO candidate_documents VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,candidate,'fixture.pdf','p2.pdf',hash,'application/pdf','CV',created,'OLD','{"old":true}');
  }
  const originalRead=fs.readFileSync,originalPrepare=db.prepare.bind(db),originalTransaction=db.transaction.bind(db);
  fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.endsWith('.pdf'))state.reads++;return originalRead.call(this,file,...args);};
  db.prepare=sql=>{const stmt=originalPrepare(sql);if(/^\s*UPDATE candidate_documents SET parsed_text = \?/.test(sql)){const original=stmt.run.bind(stmt);stmt.run=async(...args)=>{assert.equal(inTransaction,true,'Write must use the transaction boundary');state.writes++;if(state.beforeSave)await state.beforeSave();const result=await original(...args);if(state.failSave)throw Error('TEST_SAVE_FAILURE');return result;};}return stmt;};
  db.transaction=action=>originalTransaction(async()=>{inTransaction=true;try{return await action();}finally{inTransaction=false;}});
  const actor = id=>({id,roles:['ADMIN'],permissions:['candidate.cv.parse']});
  const get=()=>db.prepare('SELECT parsed_text,parsed_data_json FROM candidate_documents WHERE id=?').get('da');
  const call=(id='a',candidate='ca',document='da')=>portal.parseCvPdf(candidate,document,id===null?null:actor(id));
  const test=async(name,fn)=>{state={calls:0,destroyed:0,reads:0,writes:0,text:'Test Person\ntest@example.test\n0912345678'};await db.prepare("UPDATE candidate_documents SET parsed_text='OLD',parsed_data_json='{\"old\":true}',candidate_id='ca',storage_path='p2.pdf',file_hash=? WHERE id='da'").run(hash);await fn();passed++;console.log('PASS '+provider+' '+name);};
  const denied=async(action,status=403)=>{const result=await action();assert.equal(result.success,false);assert.equal(result.statusCode,status);assert.equal(state.reads,0);assert.equal(state.calls,0);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');assert.equal(Object.hasOwn(result,'parsedData'),false);};
  const success=async action=>{const result=await action();assert.equal(result.success,true);assert.deepEqual(Object.keys(result).sort(),['data','message','parsedData','statusCode','success']);assert.deepEqual(Object.keys(result.parsedData).sort(),['email','fullName','phoneNumber']);assert.deepEqual(result.data,result.parsedData);assert.equal(state.writes,1);return result;};
  try {
    await test('primary parses and persists',async()=>{const result=await success(()=>call());assert.deepEqual(JSON.parse((await get()).parsed_data_json),result.parsedData);});
    await test('support parses',async()=>success(()=>call('support')));
    await test('support feature off denied',async()=>{config.REQUISITION_OPERATIONS_ENABLED=false;await denied(()=>call('support'));config.REQUISITION_OPERATIONS_ENABLED=true;});
    await test('candidate ID outside assignment',async()=>denied(()=>call('a','cb',null)));
    await test('candidate and document IDs outside assignment',async()=>denied(()=>call('a','cb','db')));
    await test('document belongs to another candidate',async()=>denied(()=>call('a','ca','db'),404));
    await test('unknown candidate',async()=>denied(()=>call('a','missing','da'),404));
    await test('latest CV and two-argument compatibility',async()=>{await success(()=>portal.parseCvPdf('ca',actor('a')));assert.equal((await db.prepare("SELECT parsed_text FROM candidate_documents WHERE id='latest'").get()).parsed_text,state.text);assert.equal((await get()).parsed_text,'OLD');});
    for(const id of ['admin','hr'])await test(id+' allowed',async()=>success(()=>call(id,'cb','db')));
    for(const id of ['hiring','approver','candidate','interviewer','missing'])await test(id+' denied despite claimed role',async()=>denied(()=>call(id)));
    await test('multi-role allowed only assigned scope',async()=>{await denied(()=>call('mixed','cb','db'));await success(()=>call('mixed'));});
    await test('null actor',async()=>denied(()=>call(null),401));
    await test('locked account',async()=>{await db.prepare("UPDATE users SET status='LOCKED' WHERE id='a'").run();await denied(()=>call());await db.prepare("UPDATE users SET status='ACTIVE' WHERE id='a'").run();});
    await test('permission revoked despite forged ADMIN',async()=>{await db.prepare("DELETE FROM role_permissions WHERE role_id='RECRUITER'").run();await denied(()=>call());await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','parse');});
    await test('primary assignment revoked',async()=>{await db.prepare("UPDATE requisitions SET recruiter_id='b' WHERE id='ra'").run();await denied(()=>call());await db.prepare("UPDATE requisitions SET recruiter_id='a' WHERE id='ra'").run();});
    await test('assignment revoked during parse',async()=>{state.hook=()=>peer.prepare("UPDATE requisitions SET recruiter_id='b' WHERE id='ra'").run();const result=await call();assert.equal(result.statusCode,403);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');assert.equal(Object.hasOwn(result,'parsedData'),false);await db.prepare("UPDATE requisitions SET recruiter_id='a' WHERE id='ra'").run();});
    await test('support revoked during parse',async()=>{state.hook=()=>peer.prepare("DELETE FROM requisition_recruiter_supports WHERE user_id='support'").run();assert.equal((await call('support')).statusCode,403);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','support');});
    await test('grant revoked during parse',async()=>{state.hook=()=>peer.prepare("DELETE FROM role_permissions WHERE role_id='RECRUITER'").run();assert.equal((await call()).statusCode,403);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','parse');});
    await test('account locked during parse',async()=>{state.hook=()=>peer.prepare("UPDATE users SET status='LOCKED' WHERE id='a'").run();assert.equal((await call()).statusCode,403);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');await db.prepare("UPDATE users SET status='ACTIVE' WHERE id='a'").run();});
    for(const [field,value] of [['candidate_id','cb'],['storage_path','new.pdf'],['file_hash','changed']])await test(field+' changed during parse',async()=>{state.hook=()=>peer.prepare('UPDATE candidate_documents SET '+field+'=? WHERE id=?').run(value,'da');assert.equal((await call()).statusCode,409);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');});
    await test('path traversal rejected before file read',async()=>{await db.prepare("UPDATE candidate_documents SET storage_path='../outside.pdf' WHERE id='da'").run();await denied(()=>call(),404);});
    await test('canonical symlink escape rejected',async()=>{const outside=path.join(root,'p2-outside');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,'outside.pdf'),contents);const link=path.join(storage,'p2-link');if(!fs.existsSync(link))fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');await db.prepare("UPDATE candidate_documents SET storage_path='p2-link/outside.pdf' WHERE id='da'").run();await denied(()=>call(),404);});
    await test('file hash mismatch',async()=>{await db.prepare("UPDATE candidate_documents SET file_hash='invalid' WHERE id='da'").run();const result=await call();assert.equal(result.statusCode,409);assert.equal(state.calls,0);assert.equal(state.writes,0);});
    await test('parser failure without valid fallback',async()=>{state.throw=true;assert.equal((await call()).statusCode,422);assert.equal(state.destroyed,1);assert.equal(state.writes,0);assert.equal((await get()).parsed_text,'OLD');});
    await test('valid fallback preserved',async()=>{const fallback=Buffer.from('%PDF-1.4\nstream\nTest Person\ntest@example.test\n0912345678\nendstream');fs.writeFileSync(path.join(storage,'fallback.pdf'),fallback);await db.prepare('UPDATE candidate_documents SET storage_path=?,file_hash=? WHERE id=?').run('fallback.pdf',crypto.createHash('sha256').update(fallback).digest('hex'),'da');state.throw=true;await success(()=>call());assert.equal(state.destroyed,1);});
    if (peer !== db) await test('independent assignment update waits for final transaction',async()=>{let pending;state.beforeSave=async()=>{let settled=false;pending=peer.prepare("UPDATE requisitions SET recruiter_id='b' WHERE id='ra'").run();pending.then(()=>{settled=true;});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false,'Requisition share lock must block reassignment');};await success(()=>call());await pending;assert.notEqual((await get()).parsed_text,'OLD');await db.prepare("UPDATE requisitions SET recruiter_id='a' WHERE id='ra'").run();});
    await test('save failure rolls back and never reports success',async()=>{state.failSave=true;await assert.rejects(()=>call(),/TEST_SAVE_FAILURE/);assert.equal((await get()).parsed_text,'OLD');});
  } finally {fs.readFileSync=originalRead;db.prepare=originalPrepare;db.transaction=originalTransaction;}
}
async function main() {
  const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));
  try{await run(sqlite,'sqlite');}finally{sqlite.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();
  const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};
  const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});
  try{await run(pg,'postgres');}finally{await pg.close();}
  if(process.env.ATS_P2_PG_URL){const url=new URL(process.env.ATS_P2_PG_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/ats_p2_test(?:_[a-z0-9]+)?$/);const live=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'}),peer=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});try{await run(live,'pg-wire',peer);}finally{await peer.close();await live.close();}}
  console.log('P2_RESULT '+JSON.stringify({passed,failed:0,livePostgres:Boolean(process.env.ATS_P2_PG_URL)}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
