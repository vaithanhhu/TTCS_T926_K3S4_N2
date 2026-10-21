const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDatabase } = require('../src/db/database');
const CandidateMergeService = require('../src/services/candidateMergeService');
const { PostgresDatabase } = require('../src/db/postgres');

async function testSqlite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-audit-merge-'));
  const db = getDatabase(path.join(dir, 'audit.sqlite'));
  try {
    await db.prepare("INSERT INTO roles(id,code,name,default_path) VALUES ('role-hr','HR_MANAGER','HR Manager','/candidates')").run();
    await db.prepare("INSERT INTO users(id,email,password_hash,full_name) VALUES ('actor','hr@example.test','hash','HR Manager')").run();
    await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES ('actor','role-hr')").run();
    await db.prepare("INSERT INTO permissions(id,code,name,module) VALUES ('merge','candidate.merge','Merge','CANDIDATES'),('undo','candidate.merge.undo','Undo','CANDIDATES'),('read','candidate.read','Read','CANDIDATES')").run();
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) VALUES ('role-hr','merge'),('role-hr','undo'),('role-hr','read')").run();
    await db.prepare("INSERT INTO candidates(id,full_name,email,phone_number) VALUES ('cand-1','Cand 1','c1@test.com','0900000001'),('cand-2','Cand 2','c2@test.com','0900000002')").run();

    await require('../src/db/migrate-candidate-merges').migrate(db);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS interview_batches (
        id TEXT PRIMARY KEY NOT NULL,
        actor_id TEXT,
        actor_snapshot TEXT NOT NULL,
        request_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(actor_id, request_key)
      );
      CREATE TABLE IF NOT EXISTS interview_batch_items (
        batch_id TEXT NOT NULL REFERENCES interview_batches(id) ON DELETE CASCADE,
        interview_id TEXT PRIMARY KEY NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
        candidate_id TEXT NOT NULL REFERENCES candidates(id),
        UNIQUE(batch_id, candidate_id)
      );
      CREATE TABLE IF NOT EXISTS hiring_decisions (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT,
        interview_id TEXT,
        decision TEXT NOT NULL,
        rejection_reason_id TEXT,
        reason_text TEXT,
        notes TEXT,
        consensus_score REAL,
        next_action TEXT,
        decided_by TEXT NOT NULL,
        decided_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS onboarding_checklists (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT,
        department_id TEXT,
        template_id TEXT,
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        progress_percentage INTEGER NOT NULL DEFAULT 0,
        start_date DATE,
        completed_at TEXT,
        completed_by TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS candidate_communications (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT,
        batch_id TEXT,
        type TEXT NOT NULL,
        sender_id TEXT,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        body_text TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_rejection_sent ON candidate_communications (candidate_id)
      WHERE type = 'REJECTION' AND status IN ('DELIVERED', 'SENT_LOCAL');
    `);

    const intDate = new Date(Date.now() + 86400000).toISOString();
    await db.prepare("INSERT INTO interviews(id,candidate_id,round_name,scheduled_time) VALUES ('int-2','cand-2','Round 1',?)").run(intDate);
    await db.prepare("INSERT INTO hiring_decisions(id,candidate_id,interview_id,decision,decided_by) VALUES ('dec-2','cand-2','int-2','OFFER','actor')").run();
    await db.prepare("INSERT INTO interview_batches(id,actor_snapshot,request_key,payload_hash,fingerprint,result_json,created_at) VALUES ('batch-1','actor','rk-1','h-1','fp-1','{}',?)").run(new Date().toISOString());
    await db.prepare("INSERT INTO interview_batch_items(batch_id,interview_id,candidate_id) VALUES ('batch-1','int-2','cand-2')").run();
    await db.prepare("INSERT INTO onboarding_checklists(id,candidate_id,status,created_by) VALUES ('ob-2','cand-2','IN_PROGRESS','actor')").run();
    await db.prepare("INSERT INTO candidate_communications(id,candidate_id,type,recipient_email,recipient_name,subject,body_html,status) VALUES ('comm-2','cand-2','THANK_YOU','c2@test.com','Cand 2','Thanks','<p>Thanks</p>','DELIVERED')").run();

    const service = new CandidateMergeService(db);
    const actor = { id: 'actor' };

    const compared = await service.compare('cand-1', 'cand-2', actor);
    assert.equal(compared.second.related.hiring_decisions, 1);
    assert.equal(compared.second.related.onboarding_checklists, 1);
    assert.equal(compared.second.related.candidate_communications, 1);
    assert.equal(compared.second.related.interview_batch_items, 1);

    const merged = await service.merge({ primaryId: 'cand-1', secondaryId: 'cand-2' }, actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM hiring_decisions WHERE id='dec-2'").get()).candidate_id, 'cand-1');
    assert.equal((await db.prepare("SELECT candidate_id FROM interview_batch_items WHERE interview_id='int-2'").get()).candidate_id, 'cand-1');
    assert.equal((await db.prepare("SELECT candidate_id FROM onboarding_checklists WHERE id='ob-2'").get()).candidate_id, 'cand-1');
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_communications WHERE id='comm-2'").get()).candidate_id, 'cand-1');

    const intRow = await db.prepare("SELECT candidate_id FROM interviews WHERE id='int-2'").get();
    const decRow = await db.prepare("SELECT candidate_id FROM hiring_decisions WHERE id='dec-2'").get();
    assert.equal(intRow.candidate_id, decRow.candidate_id);

    await service.undo(merged.eventId, actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM hiring_decisions WHERE id='dec-2'").get()).candidate_id, 'cand-2');
    assert.equal((await db.prepare("SELECT candidate_id FROM interview_batch_items WHERE interview_id='int-2'").get()).candidate_id, 'cand-2');
    assert.equal((await db.prepare("SELECT candidate_id FROM onboarding_checklists WHERE id='ob-2'").get()).candidate_id, 'cand-2');
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_communications WHERE id='comm-2'").get()).candidate_id, 'cand-2');

    await db.prepare("INSERT INTO offers(id,candidate_id,salary_monthly,start_date,status) VALUES ('off-1','cand-1',1000,'2026-11-01','APPROVED')").run();
    await db.prepare("INSERT INTO offers(id,candidate_id,salary_monthly,start_date,status) VALUES ('off-2','cand-2',1200,'2026-11-01','APPROVED')").run();
    await assert.rejects(
      () => service.merge({ primaryId: 'cand-1', secondaryId: 'cand-2' }, actor),
      error => error.code === 'CANDIDATE_MERGE_OFFER_CONFLICT' && error.statusCode === 409
    );

    console.log('PASS SQLite candidate merge cross-sprint deep audit probe');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPostgres() {
  const { PGlite } = require('@electric-sql/pglite');
  const engine = new PGlite();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return {
      rows: (result?.rows || []).map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))),
      rowCount: result?.affectedRows || result?.rows?.length || 0
    };
  };
  const db = new PostgresDatabase({}, { on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); } });
  try {
    await db.exec(`
      CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT,name TEXT,default_path TEXT);
      CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT UNIQUE,name TEXT,module TEXT,description TEXT);
      CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT DEFAULT 'ACTIVE',must_change_password BOOLEAN DEFAULT FALSE,locked_until TIMESTAMPTZ);
      CREATE TABLE user_roles(user_id TEXT,role_id TEXT,PRIMARY KEY(user_id,role_id));
      CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT,PRIMARY KEY(role_id,permission_id));
      CREATE TABLE candidates(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,email TEXT NOT NULL,phone_number TEXT,requisition_id TEXT,stage TEXT,experience_years INTEGER,current_company TEXT,expected_salary TEXT,notes TEXT);
      CREATE TABLE interviews(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES candidates(id),requisition_id TEXT,interviewer_id TEXT,round_name TEXT NOT NULL,scheduled_time TEXT NOT NULL,location_or_link TEXT,status TEXT NOT NULL DEFAULT 'SCHEDULED',feedback TEXT,score INTEGER);
      CREATE TABLE offers(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES candidates(id),requisition_id TEXT,salary_monthly NUMERIC NOT NULL,start_date DATE NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL');
    `);

    await db.prepare("INSERT INTO roles VALUES('role-hr','HR_MANAGER','HR Manager','/candidates')").run();
    await db.prepare("INSERT INTO users(id,email,full_name) VALUES('actor','hr@example.test','HR')").run();
    await db.prepare("INSERT INTO user_roles VALUES('actor','role-hr')").run();
    await db.prepare("INSERT INTO permissions(id,code,name,module) VALUES ('merge','candidate.merge','Merge','CANDIDATES'),('undo','candidate.merge.undo','Undo','CANDIDATES'),('read','candidate.read','Read','CANDIDATES')").run();
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) VALUES ('role-hr','merge'),('role-hr','undo'),('role-hr','read')").run();
    await db.prepare("INSERT INTO candidates(id,full_name,email,phone_number) VALUES('cand-1','Cand 1','c1@test.com','0900000001'),('cand-2','Cand 2','c2@test.com','0900000002')").run();

    await require('../src/db/migrate-candidate-merges').migrate(db);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS interview_batches (
        id TEXT PRIMARY KEY NOT NULL,
        actor_id TEXT,
        actor_snapshot TEXT NOT NULL,
        request_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE(actor_id, request_key)
      );
      CREATE TABLE IF NOT EXISTS interview_batch_items (
        batch_id TEXT NOT NULL REFERENCES interview_batches(id) ON DELETE CASCADE,
        interview_id TEXT PRIMARY KEY NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
        candidate_id TEXT NOT NULL REFERENCES candidates(id),
        UNIQUE(batch_id, candidate_id)
      );
      CREATE TABLE IF NOT EXISTS hiring_decisions (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT,
        interview_id TEXT,
        decision TEXT NOT NULL,
        rejection_reason_id TEXT,
        reason_text TEXT,
        notes TEXT,
        consensus_score REAL,
        next_action TEXT,
        decided_by TEXT NOT NULL,
        decided_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS onboarding_checklists (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT,
        department_id TEXT,
        template_id TEXT,
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        progress_percentage INTEGER NOT NULL DEFAULT 0,
        start_date DATE,
        completed_at TIMESTAMPTZ,
        completed_by TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS candidate_communications (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT,
        batch_id TEXT,
        type TEXT NOT NULL,
        sender_id TEXT,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        body_text TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_rejection_sent ON candidate_communications (candidate_id)
      WHERE type = 'REJECTION' AND status IN ('DELIVERED', 'SENT_LOCAL');
    `);

    const intDate = new Date(Date.now() + 86400000).toISOString();
    await db.prepare("INSERT INTO interviews(id,candidate_id,round_name,scheduled_time) VALUES ('int-2','cand-2','Round 1',?)").run(intDate);
    await db.prepare("INSERT INTO hiring_decisions(id,candidate_id,interview_id,decision,decided_by) VALUES ('dec-2','cand-2','int-2','OFFER','actor')").run();
    await db.prepare("INSERT INTO interview_batches(id,actor_snapshot,request_key,payload_hash,fingerprint,result_json,created_at) VALUES ('batch-1','actor','rk-1','h-1','fp-1','{}',?)").run(new Date().toISOString());
    await db.prepare("INSERT INTO interview_batch_items(batch_id,interview_id,candidate_id) VALUES ('batch-1','int-2','cand-2')").run();
    await db.prepare("INSERT INTO onboarding_checklists(id,candidate_id,status,created_by) VALUES ('ob-2','cand-2','IN_PROGRESS','actor')").run();
    await db.prepare("INSERT INTO candidate_communications(id,candidate_id,type,recipient_email,recipient_name,subject,body_html,status) VALUES ('comm-2','cand-2','THANK_YOU','c2@test.com','Cand 2','Thanks','<p>Thanks</p>','DELIVERED')").run();

    const service = new CandidateMergeService(db);
    const actor = { id: 'actor' };

    const compared = await service.compare('cand-1', 'cand-2', actor);
    assert.equal(compared.second.related.hiring_decisions, 1);
    assert.equal(compared.second.related.onboarding_checklists, 1);
    assert.equal(compared.second.related.candidate_communications, 1);
    assert.equal(compared.second.related.interview_batch_items, 1);

    const merged = await service.merge({ primaryId: 'cand-1', secondaryId: 'cand-2' }, actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM hiring_decisions WHERE id='dec-2'").get()).candidate_id, 'cand-1');
    assert.equal((await db.prepare("SELECT candidate_id FROM interview_batch_items WHERE interview_id='int-2'").get()).candidate_id, 'cand-1');
    assert.equal((await db.prepare("SELECT candidate_id FROM onboarding_checklists WHERE id='ob-2'").get()).candidate_id, 'cand-1');
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_communications WHERE id='comm-2'").get()).candidate_id, 'cand-1');

    await service.undo(merged.eventId, actor);
    assert.equal((await db.prepare("SELECT candidate_id FROM hiring_decisions WHERE id='dec-2'").get()).candidate_id, 'cand-2');
    assert.equal((await db.prepare("SELECT candidate_id FROM interview_batch_items WHERE interview_id='int-2'").get()).candidate_id, 'cand-2');
    assert.equal((await db.prepare("SELECT candidate_id FROM onboarding_checklists WHERE id='ob-2'").get()).candidate_id, 'cand-2');
    assert.equal((await db.prepare("SELECT candidate_id FROM candidate_communications WHERE id='comm-2'").get()).candidate_id, 'cand-2');

    console.log('PASS PGlite candidate merge cross-sprint deep audit probe');
  } finally {
    await db.close();
  }
}

async function run() {
  await testSqlite();
  await testPostgres();
  console.log('ALL FULL-SYSTEM DEEP AUDIT PROBES PASSED');
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
