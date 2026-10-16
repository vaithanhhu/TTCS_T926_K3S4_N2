const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDatabase } = require('../src/db/database');
const CandidateMergeService = require('../src/services/candidateMergeService');
const { PostgresDatabase } = require('../src/db/postgres');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-candidate-merge-'));
  const db = getDatabase(path.join(dir, 'merge.sqlite'));
  try {
    await db.prepare("INSERT INTO roles(id,code,name,default_path) VALUES ('role-recruiter','HR_MANAGER','HR Manager','/candidates')").run();
    await db.prepare("INSERT INTO users(id,email,password_hash,full_name) VALUES ('actor','recruiter@example.test','hash','Recruiter')").run();
    await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES ('actor','role-recruiter')").run();
    await db.prepare("INSERT INTO permissions(id,code,name,module) VALUES ('merge','candidate.merge','Merge','CANDIDATES'),('undo','candidate.merge.undo','Undo','CANDIDATES'),('read','candidate.read','Read','CANDIDATES')").run();
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) VALUES ('role-recruiter','merge'),('role-recruiter','undo'),('role-recruiter','read')").run();
    await db.prepare("INSERT INTO candidates(id,full_name,email,phone_number) VALUES ('primary','Primary','same@example.test','0900000000'),('secondary','Secondary','same@example.test','0900000000')").run();
    await db.prepare("INSERT INTO candidates(id,full_name,email,phone_number) VALUES ('third','Third','third@example.test','0911111111')").run();
    await db.exec('CREATE TABLE candidate_notes(id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL REFERENCES candidates(id),note_text TEXT)');
    await db.prepare("INSERT INTO candidate_notes(id,candidate_id,note_text) VALUES ('note-1','secondary','history')").run();
    const migrate = require('../src/db/migrate-candidate-merges');
    await migrate.migrate(db);
    const service = new CandidateMergeService(db);
    const actor = { id: 'actor' };
    await assert.rejects(() => service.merge({ primaryId: 'primary', secondaryId: 'secondary' }, { id: 'missing' }), error => error.code === 'CANDIDATE_MERGE_FORBIDDEN');
    const compared = await service.compare('primary','secondary',actor);
    assert.equal(compared.first.related.candidate_notes, 0);
    assert.equal(compared.second.related.candidate_notes, 1);
    const merged = await service.merge({ primaryId: 'primary', secondaryId: 'secondary' }, actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_notes WHERE id='note-1'").get()).candidate_id, 'primary');
    assert.equal((await db.prepare("SELECT merged_into_id FROM candidates WHERE id='secondary'").get()).merged_into_id, 'primary');
    await db.prepare("UPDATE candidate_notes SET candidate_id='third' WHERE id='note-1'").run();
    await assert.rejects(() => service.undo(merged.eventId, actor), error => error.code === 'CANDIDATE_MERGE_UNDO_CONFLICT');
    assert.equal((await db.prepare('SELECT status FROM candidate_merge_events WHERE id=?').get(merged.eventId)).status, 'MERGED');
    await db.prepare("UPDATE candidate_notes SET candidate_id='primary' WHERE id='note-1'").run();
    await db.prepare("UPDATE candidate_merge_events SET merged_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(merged.eventId);
    await assert.rejects(() => service.undo(merged.eventId, actor), error => error.code === 'CANDIDATE_MERGE_UNDO_EXPIRED');
    await db.prepare("UPDATE candidate_merge_events SET merged_at=? WHERE id=?").run(new Date().toISOString(), merged.eventId);
    await service.undo(merged.eventId, actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_notes WHERE id='note-1'").get()).candidate_id, 'secondary');
    assert.equal((await db.prepare("SELECT merged_into_id FROM candidates WHERE id='secondary'").get()).merged_into_id, null);
    assert.equal((await db.prepare('SELECT status FROM candidate_merge_events WHERE id=?').get(merged.eventId)).status, 'UNDONE');
    const concurrent = await Promise.allSettled([
      service.merge({ primaryId: 'primary', secondaryId: 'secondary' }, actor),
      service.merge({ primaryId: 'primary', secondaryId: 'secondary' }, actor)
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason.code === 'CANDIDATE_ALREADY_MERGED').length, 1);
    console.log('PASS candidate merge compare, transactional relation transfer, audit, and undo');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function postgresCase() {
  const { PGlite } = require('@electric-sql/pglite'), engine = new PGlite();
  const query = async (sql, params) => { const result=params===undefined?(await engine.exec(sql)).at(-1):await engine.query(sql,params);return {rows:(result?.rows||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value]))),rowCount:result?.affectedRows||result?.rows?.length||0}; };
  const db = new PostgresDatabase({}, { on(){}, query, async connect(){return {query,release(){}};}, async end(){await engine.close();} });
  try {
    await db.exec(`CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT,name TEXT,default_path TEXT);
      CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT UNIQUE,name TEXT,module TEXT,description TEXT);
      CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT DEFAULT 'ACTIVE',must_change_password BOOLEAN DEFAULT FALSE,locked_until TIMESTAMPTZ);
      CREATE TABLE user_roles(user_id TEXT,role_id TEXT,PRIMARY KEY(user_id,role_id));
      CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT,PRIMARY KEY(role_id,permission_id));
      CREATE TABLE candidates(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,email TEXT NOT NULL,phone_number TEXT,requisition_id TEXT,stage TEXT,experience_years INTEGER,current_company TEXT,expected_salary TEXT,notes TEXT);
      CREATE TABLE candidate_notes(id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL REFERENCES candidates(id),note_text TEXT);`);
    await db.prepare("INSERT INTO roles VALUES('role-hr','HR_MANAGER','HR Manager','/candidates')").run();
    await db.prepare("INSERT INTO users(id,email,full_name) VALUES('actor','hr@example.test','HR')").run();
    await db.prepare("INSERT INTO user_roles VALUES('actor','role-hr')").run();
    await db.prepare("INSERT INTO candidates(id,full_name,email,phone_number) VALUES('primary','Primary','same@example.test','0900000000'),('secondary','Secondary','same@example.test','0900000000')").run();
    await db.prepare("INSERT INTO candidate_notes VALUES('note-1','secondary','history')").run();
    await require('../src/db/migrate-candidate-merges').migrate(db);
    const service=new CandidateMergeService(db),actor={id:'actor'};
    const merged=await service.merge({primaryId:'primary',secondaryId:'secondary'},actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_notes WHERE id='note-1'").get()).candidate_id,'primary');
    await service.undo(merged.eventId,actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_notes WHERE id='note-1'").get()).candidate_id,'secondary');
    console.log('PASS PGlite candidate merge migration, transaction, and undo');
  } finally { await db.close(); }
}
main().then(postgresCase).catch(error => { console.error(error); process.exitCode = 1; });
