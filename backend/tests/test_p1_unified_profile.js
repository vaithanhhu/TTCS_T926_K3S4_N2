const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.env')), false, 'Use an isolated source export');
assert.equal(fs.existsSync(path.join(root, '.git')), false, 'Use an isolated source export');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_PROVIDER, 'sqlite');
const Portal = require('../src/services/candidatePortalService');
const config = require('../src/config/config');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
let passed = 0;
async function run(db, provider) {
  config.REQUISITION_OPERATIONS_ENABLED = true;
  const boolean = provider === 'postgres' ? 'BOOLEAN' : 'INTEGER';
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${boolean},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE departments(id TEXT PRIMARY KEY,manager_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,title TEXT,code TEXT,department_id TEXT,department_name TEXT,recruiter_id TEXT,hiring_manager_id TEXT,created_by TEXT);
    CREATE TABLE requisition_recruiter_supports(requisition_id TEXT,user_id TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,phone_number TEXT,requisition_id TEXT,current_company TEXT,experience_years INTEGER,expected_salary INTEGER,source_id TEXT,created_at TEXT,job_posting_id TEXT,stage TEXT,cover_letter TEXT,tracking_code TEXT,withdrawn_at TEXT,withdrawn_reason TEXT,is_internal_referral ${boolean},referrer_name TEXT);
    CREATE TABLE candidate_documents(id TEXT,candidate_id TEXT,file_name TEXT,storage_path TEXT,mime_type TEXT,file_size INTEGER,document_type TEXT,parsed_data_json TEXT,created_at TEXT);
    CREATE TABLE candidate_tags(id TEXT,candidate_id TEXT,tag_name TEXT,created_by TEXT,created_at TEXT);
    CREATE TABLE candidate_notes(id TEXT,candidate_id TEXT,author_id TEXT,author_name TEXT,note_text TEXT,is_private ${boolean},created_at TEXT);
    CREATE TABLE candidate_status_history(id TEXT,candidate_id TEXT,before_stage TEXT,after_stage TEXT,actor_name TEXT,action TEXT,reason TEXT,notes TEXT,created_at TEXT);
  `);
  const bool = value => provider === 'postgres' ? value : Number(value);
  const actors = { admin: ['ADMIN'], hr: ['HR_MANAGER'], approver: ['APPROVER'], a: ['RECRUITER'], b: ['RECRUITER'], support: ['RECRUITER'], hiring: ['HIRING_MGR'], candidate: ['CANDIDATE'], interviewer: ['INTERVIEWER'], mixed: ['RECRUITER', 'HIRING_MGR'], limited: ['RECRUITER', 'CANDIDATE', 'INTERVIEWER'] };
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('read', 'candidate.read');
  for (const role of new Set(Object.values(actors).flat())) {
    await db.prepare('INSERT INTO roles VALUES (?,?)').run(role, role);
    await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role, 'read');
  }
  for (const [id, roles] of Object.entries(actors)) {
    await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, 'same@example.test', id, 'ACTIVE', bool(false), null);
    for (const role of roles) await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id, role);
  }
  await db.prepare('INSERT INTO departments VALUES (?,?)').run('dept', 'hiring');
  for (const [id, recruiter, hiring, department] of [['ra','a',null,null],['rb','b','mixed','dept']]) {
    await db.prepare('INSERT INTO requisitions VALUES (?,?,?,?,?,?,?,?)').run(id,id,id,department,'Department',recruiter,hiring,null);
  }
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','support');
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','mixed');
  await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','limited');
  for (const [id, req] of [['ca','ra'],['cb','rb']]) {
    await db.prepare('INSERT INTO candidates(id,email,full_name,requisition_id,stage,created_at,is_internal_referral,tracking_code) VALUES (?,?,?,?,?,?,?,?)').run(id,'Same@Example.test','Candidate',req,'NEW','2026-10-14',bool(false),'tracking-'+id);
    await db.prepare('INSERT INTO candidate_documents VALUES (?,?,?,?,?,?,?,?,?)').run('doc-'+id,id,id+'.pdf','file.pdf','application/pdf',100,'CV','{}','2026-10-14');
    await db.prepare('INSERT INTO candidate_tags VALUES (?,?,?,?,?)').run('tag-'+id,id,id,'a','2026-10-14');
    await db.prepare('INSERT INTO candidate_status_history VALUES (?,?,?,?,?,?,?,?,?)').run('hist-'+id,id,null,'NEW','Actor','CREATE','reason-'+id,null,'2026-10-14');
    for (const [suffix, author, privateNote] of [['public','b',false],['own','a',true],['other','b',true]]) {
      await db.prepare('INSERT INTO candidate_notes VALUES (?,?,?,?,?,?,?)').run(id+'-'+suffix,id,author,author,'note-'+id+'-'+suffix,bool(privateNote),'2026-10-14');
    }
  }
  const service = new Portal(db);
  const get = (id, actor) => service.getUnifiedProfile(id, actor === null ? null : { id: actor, roles: actors[actor] || [] });
  const test = async (name, action) => { await action(); passed++; console.log('PASS '+provider+' '+name); };
  const scoped = data => {
    assert.deepEqual(data.applications.map(a => a.id), ['ca']);
    for (const key of ['documents','tags','notes','history']) assert.ok(data[key].every(row => row.candidateId === 'ca'));
    assert.equal(JSON.stringify(data).includes('cb'), false);
  };
  await test('primary scope and all related data', async()=>scoped((await get('ca','a')).data));
  await test('forged actor role ignored',async()=>scoped((await service.getUnifiedProfile('ca',{id:'a',roles:['ADMIN']})).data));
  await test('private notes author only',async()=>assert.deepEqual((await get('ca','a')).data.notes.map(n=>n.id).sort(),['ca-own','ca-public']));
  await test('private author cannot bypass application scope',async()=>assert.equal((await get('cb','a')).statusCode,403));
  await test('support scope',async()=>{const result=await get('ca','support');scoped(result.data);assert.deepEqual(result.data.notes.map(n=>n.id),['ca-public']);});
  await test('support feature off',async()=>{config.REQUISITION_OPERATIONS_ENABLED=false;assert.equal((await get('ca','support')).statusCode,403);assert.equal((await get('ca','a')).success,true);config.REQUISITION_OPERATIONS_ENABLED=true;});
  await test('hiring department manager scope',async()=>assert.deepEqual((await get('cb','hiring')).data.applications.map(a=>a.id),['cb']));
  await test('multi-role union',async()=>assert.equal((await get('ca','mixed')).data.applications.length,2));
  await test('noninternal roles do not widen union',async()=>scoped((await get('ca','limited')).data));
  for (const actor of ['admin','hr','approver']) await test(actor+' broad scope and private notes',async()=>{const data=(await get('ca',actor)).data;assert.equal(data.applications.length,2);assert.equal(data.notes.length,actor==='approver'?2:6);});
  for (const actor of ['candidate','interviewer','nonexistent']) await test(actor+' denied',async()=>assert.equal((await get('ca',actor)).statusCode,403));
  await test('null actor denied',async()=>assert.equal((await get('ca',null)).statusCode,401));
  await test('missing candidate has no existence disclosure',async()=>{const result=await get('missing','a');assert.equal(result.statusCode,403);assert.equal(Object.hasOwn(result,'data'),false);});
  await test('assignment revocation',async()=>{await db.prepare('DELETE FROM requisition_recruiter_supports WHERE user_id=?').run('support');assert.equal((await get('ca','support')).statusCode,403);});
  await test('primary reassignment revocation',async()=>{await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('b','ra');assert.equal((await get('ca','a')).statusCode,403);await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('a','ra');});
  await test('locked actor denied',async()=>{await db.prepare("UPDATE users SET status='LOCKED' WHERE id=?").run('a');assert.equal((await get('ca','a')).statusCode,403);await db.prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run('a');});
  await test('password change required denied',async()=>{await db.prepare('UPDATE users SET must_change_password=? WHERE id=?').run(bool(true),'a');assert.equal((await get('ca','a')).statusCode,403);await db.prepare('UPDATE users SET must_change_password=? WHERE id=?').run(bool(false),'a');});
  await test('grant revocation',async()=>{await db.prepare('DELETE FROM role_permissions WHERE role_id=?').run('RECRUITER');assert.equal((await get('ca','a')).statusCode,403);await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','read');});
  await test('exact response contract',async()=>{const result=await get('ca','admin');assert.deepEqual(Object.keys(result).sort(),['data','statusCode','success']);assert.deepEqual(Object.keys(result.data).sort(),['applications','candidate','documents','history','notes','tags']);assert.deepEqual(Object.keys(result.data.applications[0]).sort(),['coverLetter','createdAt','departmentName','id','isInternalReferral','referrerName','requisitionCode','requisitionId','requisitionTitle','stage','trackingCode','withdrawnAt','withdrawnReason']);assert.deepEqual(Object.keys(result.data.documents[0]).sort(),['candidateId','createdAt','fileName','fileSize','id','mimeType','parsedData']);assert.deepEqual(Object.keys(result.data.notes[0]).sort(),['authorName','candidateId','createdAt','id','text']);assert.deepEqual(Object.keys(result.data.tags[0]).sort(),['candidateId','id','tagName']);assert.deepEqual(Object.keys(result.data.history[0]).sort(),['action','actorName','afterStage','beforeStage','candidateId','createdAt','id','reason']);assert.deepEqual(Object.keys(result.data.candidate).sort(),['createdAt','currentCompany','email','expectedSalary','experienceYears','fullName','id','phoneNumber','sourceName']);assert.equal(typeof result.data.applications[0].isInternalReferral,'boolean');});
}
async function main() {
  const sqlite = sqliteBoundary(new (require('node:sqlite').DatabaseSync)(':memory:'));
  try { await run(sqlite, 'sqlite'); } finally { sqlite.close(); }
  const engine = new (require('@electric-sql/pglite').PGlite)();
  const query = async (sql, params) => { const r=params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);return { rows:r?.rows||[],rowCount:r?.affectedRows||0 }; };
  const pg = new PostgresDatabase({}, { on(){},query,async connect(){return {query,release(){}};},async end(){await engine.close();} });
  try { await run(pg, 'postgres'); } finally { await pg.close(); }
  console.log('P1_RESULT '+JSON.stringify({passed,failed:0,providers:['SQLite','PGlite']}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
