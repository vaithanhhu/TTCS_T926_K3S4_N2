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
    CREATE TABLE candidate_notes(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,author_id TEXT REFERENCES users(id),author_name TEXT,note_text TEXT,is_private ${boolean} NOT NULL DEFAULT ${provider === 'sqlite' ? '0' : 'FALSE'},created_at TEXT);
    CREATE TABLE candidate_tags(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,tag_name TEXT,created_by TEXT,created_at TEXT);
  `);
  const actors={admin:['ADMIN'],hr:['HR_MANAGER'],a:['RECRUITER'],b:['RECRUITER'],support:['RECRUITER'],mixed:['RECRUITER','HIRING_MGR','APPROVER'],hiring:['HIRING_MGR'],approver:['APPROVER'],interviewer:['INTERVIEWER'],candidate:['CANDIDATE']};
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('update','candidate.update');
  for(const role of new Set(Object.values(actors).flat())){await db.prepare('INSERT INTO roles VALUES (?,?)').run(role,role);await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run(role,'update');}
  for(const [id,roles] of Object.entries(actors)){await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id+'@example.test','Verified '+id,'ACTIVE',bool(false),null);for(const role of roles)await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id,role);}
  await db.prepare('INSERT INTO requisitions VALUES (?,?)').run('ra','a');
  await db.prepare('INSERT INTO requisitions VALUES (?,?)').run('rb','b');
  for(const id of ['support','mixed'])await db.prepare('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra',id);
  for(const [id,req] of [['ca','ra'],['cb','rb']])await db.prepare('INSERT INTO candidates VALUES (?,?,?)').run(id,req,'same@example.test');
  const portal=new Portal(db),raw=db.prepare.bind(db),transaction=db.transaction.bind(db);
  let state={},active=false;
  db.transaction=action=>transaction(async()=>{active=true;try{return await action();}finally{active=false;}});
  db.prepare=sql=>{const stmt=raw(sql);if(/^\s*(INSERT INTO candidate_(notes|tags)|DELETE FROM candidate_tags)/.test(sql)){const run=stmt.run.bind(stmt);stmt.run=async(...args)=>{assert.equal(active,true,'Mutation must hold the transaction');if(state.beforeMutation)await state.beforeMutation();state.writes++;const result=await run(...args);if(state.failAfter)throw Error('P3_AFTER_MUTATION_FAILURE');return result;};}if(state.beforeActor&&sql.startsWith('SELECT id,email,full_name,locked_until')){const get=stmt.get.bind(stmt);stmt.get=async(...args)=>{const hook=state.beforeActor;state.beforeActor=null;await hook();return get(...args);};}if(state.beforeCandidate&&sql==='SELECT id FROM candidates WHERE id=? FOR SHARE'){const get=stmt.get.bind(stmt);stmt.get=async(...args)=>{const hook=state.beforeCandidate;state.beforeCandidate=null;await hook();return get(...args);};}if(state.beforeRequisition&&sql==='SELECT id FROM requisitions WHERE id=? FOR SHARE'){const get=stmt.get.bind(stmt);stmt.get=async(...args)=>{const hook=state.beforeRequisition;state.beforeRequisition=null;await hook();return get(...args);};}if(state.beforeSupport&&sql==='SELECT user_id FROM requisition_recruiter_supports WHERE requisition_id=? AND user_id=? FOR SHARE'){const get=stmt.get.bind(stmt);stmt.get=async(...args)=>{const hook=state.beforeSupport;state.beforeSupport=null;await hook();return get(...args);};}return stmt;};
  const actor=id=>id===null?null:{id,roles:['ADMIN'],fullName:'Forged name',email:'forged@example.test'};
  const operations={note:(id='a',candidate='ca')=>portal.addNote(candidate,'  valid note  ',actor(id)),tag:(id='a',candidate='ca')=>portal.addTag(candidate,'  Shared  ',actor(id)),remove:(id='a',candidate='ca')=>portal.removeTag(candidate,'Shared',actor(id))};
  const snapshot=async()=>({notes:await raw('SELECT * FROM candidate_notes ORDER BY id').all(),tags:await raw('SELECT * FROM candidate_tags ORDER BY id').all()});
  const test=async(name,fn)=>{state={writes:0};await raw('DELETE FROM candidate_notes').run();await raw('DELETE FROM candidate_tags').run();for(const [id,candidate]of [['ta','ca'],['tb','cb']])await raw('INSERT INTO candidate_tags(id,candidate_id,tag_name,created_by) VALUES (?,?,?,?)').run(id,candidate,'Shared','b');await fn();passed++;console.log('PASS '+provider+' '+name);};
  const denied=async(fn,status=403)=>{const before=await snapshot(),result=await fn();assert.equal(result.success,false);assert.equal(result.statusCode,status);assert.equal(state.writes,0);assert.deepEqual(await snapshot(),before);assert.equal(Object.hasOwn(result,'data'),false);};
  try{
    for(const id of ['admin','hr','a','support'])for(const [name,op]of Object.entries(operations))await test(id+' '+name+' valid',async()=>{const result=await op(id);assert.equal(result.success,true);assert.equal(result.statusCode,name==='remove'?200:201);assert.deepEqual(Object.keys(result).sort(),name==='remove'?['message','statusCode','success']:['data','message','statusCode','success']);if(name==='note'){assert.deepEqual(Object.keys(result.data).sort(),['id','noteText']);const row=await raw('SELECT * FROM candidate_notes WHERE id=?').get(result.data.id);assert.equal(row.author_id,id);assert.equal(row.author_name,'Verified '+id);assert.equal(row.note_text,'valid note');assert.equal(Boolean(row.is_private),false);}if(name==='tag'){assert.deepEqual(Object.keys(result.data).sort(),['id','tagName']);assert.equal((await raw('SELECT created_by FROM candidate_tags WHERE id=?').get(result.data.id)).created_by,id);}if(name==='remove'){assert.equal((await raw("SELECT count(*) AS n FROM candidate_tags WHERE candidate_id='ca'").get()).n,0);assert.equal((await raw("SELECT count(*) AS n FROM candidate_tags WHERE candidate_id='cb'").get()).n,1);}});
    for(const [name,op]of Object.entries(operations)){
      await test(name+' foreign candidate same email',()=>denied(()=>op('a','cb')));
      for(const id of ['hiring','approver','interviewer','candidate','missing'])await test(name+' '+id+' forged role denied',()=>denied(()=>op(id)));
      await test(name+' null actor',()=>denied(()=>op(null),401));
      await test(name+' missing candidate',()=>denied(()=>op('a','missing')));
      await test(name+' locked account',async()=>{await raw("UPDATE users SET status='LOCKED' WHERE id='a'").run();await denied(()=>op());await raw("UPDATE users SET status='ACTIVE' WHERE id='a'").run();});
      await test(name+' revoked grant',async()=>{await raw("DELETE FROM role_permissions WHERE role_id='RECRUITER'").run();await denied(()=>op());await raw('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','update');});
      await test(name+' primary revoked',async()=>{await raw("UPDATE requisitions SET recruiter_id='b' WHERE id='ra'").run();await denied(()=>op());await raw("UPDATE requisitions SET recruiter_id='a' WHERE id='ra'").run();});
      await test(name+' support revoked',async()=>{await raw("DELETE FROM requisition_recruiter_supports WHERE user_id='support'").run();await denied(()=>op('support'));await raw('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','support');});
      await test(name+' multi-role narrow write scope',async()=>{await denied(()=>op('mixed','cb'));assert.equal((await op('mixed')).success,true);});
      await test(name+' failure after mutation rolls back',async()=>{const before=await snapshot();state.failAfter=true;await assert.rejects(()=>op(),/P3_AFTER_MUTATION_FAILURE/);assert.equal(state.writes,1);assert.deepEqual(await snapshot(),before);});
      await test(name+' candidate moved before request',async()=>{await raw("UPDATE candidates SET requisition_id='rb' WHERE id='ca'").run();await denied(()=>op());await raw("UPDATE candidates SET requisition_id='ra' WHERE id='ca'").run();});
    }
    await test('note validation unchanged',async()=>{assert.equal((await portal.addNote('ca',' ',actor('a'))).statusCode,400);assert.equal(state.writes,0);});
    await test('tag validation unchanged',async()=>{assert.equal((await portal.addTag('ca',' ',actor('a'))).statusCode,400);assert.equal(state.writes,0);});
    await test('missing tag remains successful no-op',async()=>{const before=await snapshot();const result=await portal.removeTag('ca','Missing',actor('a'));assert.equal(result.statusCode,200);assert.equal(result.success,true);assert.deepEqual(await snapshot(),before);});
    await test('duplicate tag semantics retained',async()=>{await raw("INSERT INTO candidate_tags(id,candidate_id,tag_name) VALUES ('duplicate','ca','Shared')").run();assert.equal((await operations.remove()).success,true);assert.equal((await raw("SELECT count(*) AS n FROM candidate_tags WHERE candidate_id='ca'").get()).n,0);assert.equal((await raw("SELECT count(*) AS n FROM candidate_tags WHERE candidate_id='cb'").get()).n,1);});
    if(peer!==db){
      await test('handover committed before authorization denies',async()=>{state.beforeRequisition=()=>peer.prepare("UPDATE requisitions SET recruiter_id='b' WHERE id='ra'").run();await denied(()=>operations.note());await raw("UPDATE requisitions SET recruiter_id='a' WHERE id='ra'").run();});
      await test('candidate move committed before authorization denies',async()=>{state.beforeCandidate=()=>peer.prepare("UPDATE candidates SET requisition_id='rb' WHERE id='ca'").run();await denied(()=>operations.tag());await raw("UPDATE candidates SET requisition_id='ra' WHERE id='ca'").run();});
      await test('support removed before membership lock is rechecked',async()=>{state.beforeSupport=()=>peer.prepare("DELETE FROM requisition_recruiter_supports WHERE user_id='support'").run();await denied(()=>operations.note('support'));await raw('INSERT INTO requisition_recruiter_supports VALUES (?,?)').run('ra','support');});
      await test('grant revoked before authorization denies',async()=>{state.beforeActor=()=>peer.prepare("DELETE FROM role_permissions WHERE role_id='RECRUITER'").run();await denied(()=>operations.remove());await raw('INSERT INTO role_permissions VALUES (?,?)').run('RECRUITER','update');});
      for(const [operation,op] of Object.entries(operations))for(const [name,sql,restore]of [
        ['handover',"UPDATE requisitions SET recruiter_id='b' WHERE id='ra'","UPDATE requisitions SET recruiter_id='a' WHERE id='ra'"],
        ['support removal',"DELETE FROM requisition_recruiter_supports WHERE user_id='support'","INSERT INTO requisition_recruiter_supports VALUES ('ra','support')"],
        ['candidate move',"UPDATE candidates SET requisition_id='rb' WHERE id='ca'","UPDATE candidates SET requisition_id='ra' WHERE id='ca'"],
        ['candidate deletion',"DELETE FROM candidates WHERE id='ca'","INSERT INTO candidates VALUES ('ca','ra','same@example.test')"],
        ['grant revocation',"DELETE FROM role_permissions WHERE role_id='RECRUITER'","INSERT INTO role_permissions VALUES ('RECRUITER','update')"]])await test(operation+' '+name+' waits until mutation commits',async()=>{let pending;state.beforeMutation=async()=>{let settled=false;pending=peer.prepare(sql).run();pending.then(()=>{settled=true;});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false,'Concurrent writer must wait for authorization locks');};const result=await op(name==='support removal'?'support':'a');assert.equal(result.success,true);await pending;await raw(restore).run();});
    }
  }finally{db.prepare=raw;db.transaction=transaction;}
}
async function main(){
  const sqlite=sqliteBoundary(new(require('node:sqlite').DatabaseSync)(':memory:'));sqlite.exec('PRAGMA foreign_keys=ON');try{await run(sqlite,'sqlite');}finally{sqlite.close();}
  const engine=new(require('@electric-sql/pglite').PGlite)();const query=async(sql,params)=>{const r=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return{rows:r?.rows||[],rowCount:r?.affectedRows||0};};const pg=new PostgresDatabase({},{on(){},query,async connect(){return{query,release(){}};},async end(){await engine.close();}});try{await run(pg,'postgres');}finally{await pg.close();}
  if(process.env.ATS_P3_PG_URL){const url=new URL(process.env.ATS_P3_PG_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/ats_p3_test(?:_[a-z0-9]+)?$/);const live=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'}),peer=new PostgresDatabase({DATABASE_URL:url.href,PG_SSL_MODE:'disable'});try{await run(live,'pg-wire',peer);}finally{await peer.close();await live.close();}}
  console.log('P3_RESULT '+JSON.stringify({passed,failed:0,livePostgres:Boolean(process.env.ATS_P3_PG_URL)}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
