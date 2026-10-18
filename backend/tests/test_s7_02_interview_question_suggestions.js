const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const QuestionBankService = require('../src/services/questionBankService');

function createSqliteDb() {
  const db = new DatabaseSync(':memory:');
  db.provider = 'sqlite';
  const originalPrepare = db.prepare.bind(db);
  db.prepare = function (sql) {
    const stmt = originalPrepare(sql);
    return {
      run: (...params) => stmt.run(...params),
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params)
    };
  };
  let inTx = false;
  db.transaction = async function (fn) {
    if (inTx) return fn();
    inTx = true;
    db.exec('BEGIN TRANSACTION;');
    try {
      const res = await fn();
      db.exec('COMMIT;');
      return res;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    } finally {
      inTx = false;
    }
  };
  return db;
}

async function createPgliteDb() {
  const pg = new PGlite();
  let inTx = false;
  const db = {
    provider: 'postgres',
    raw: pg,
    async exec(sql) {
      await pg.exec(sql);
    },
    prepare(sql) {
      return {
        run: async (...params) => {
          let idx = 1;
          const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
          const res = await pg.query(pgSql, params);
          return { changes: res.affectedRows || 0 };
        },
        get: async (...params) => {
          let idx = 1;
          const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
          const res = await pg.query(pgSql, params);
          return res.rows[0] || null;
        },
        all: async (...params) => {
          let idx = 1;
          const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
          const res = await pg.query(pgSql, params);
          return res.rows;
        }
      };
    },
    async transaction(fn) {
      if (inTx) return fn();
      inTx = true;
      await pg.exec('BEGIN;');
      try {
        const res = await fn();
        await pg.exec('COMMIT;');
        return res;
      } catch (err) {
        try { await pg.exec('ROLLBACK;'); } catch {}
        throw err;
      } finally {
        inTx = false;
      }
    },
    async close() {
      await pg.close();
    }
  };
  return db;
}

async function seedTestSchema(db) {
  const isPg = db.provider === 'postgres';
  const timestampType = isPg ? 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP' : "TEXT DEFAULT (datetime('now'))";

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      locked_until TEXT,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS competency_frameworks (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS competency_criteria (
      id TEXT PRIMARY KEY,
      framework_id TEXT NOT NULL REFERENCES competency_frameworks(id),
      name TEXT NOT NULL,
      weight INTEGER NOT NULL,
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS job_titles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      framework_id TEXT REFERENCES competency_frameworks(id),
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS interview_questions (
      id TEXT PRIMARY KEY,
      criterion_id TEXT NOT NULL REFERENCES competency_criteria(id),
      question_text TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      good_answer_hint TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at ${timestampType},
      updated_at ${timestampType}
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      job_title_id TEXT REFERENCES job_titles(id),
      recruiter_id TEXT REFERENCES users(id),
      department_name TEXT DEFAULT 'Kỹ thuật',
      status TEXT DEFAULT 'OPEN'
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      requisition_id TEXT REFERENCES requisitions(id),
      stage TEXT DEFAULT 'INTERVIEW'
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT REFERENCES candidates(id),
      requisition_id TEXT REFERENCES requisitions(id),
      interviewer_id TEXT REFERENCES users(id),
      round_name TEXT DEFAULT 'Vòng 1',
      scheduled_time TEXT NOT NULL,
      status TEXT DEFAULT 'SCHEDULED',
      created_at ${timestampType}
    );

    CREATE TABLE IF NOT EXISTS interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT DEFAULT 'PANEL',
      created_at ${timestampType},
      PRIMARY KEY (interview_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS interview_asked_questions (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id),
      question_id TEXT NOT NULL REFERENCES interview_questions(id),
      asked_by TEXT NOT NULL REFERENCES users(id),
      asked_at ${timestampType},
      UNIQUE(interview_id, question_id)
    );
  `);
}

async function seedData(db) {
  await db.exec('CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL); CREATE TABLE user_roles(user_id TEXT REFERENCES users(id),role_id TEXT REFERENCES roles(id),PRIMARY KEY(user_id,role_id)); CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL); CREATE TABLE role_permissions(role_id TEXT REFERENCES roles(id),permission_id TEXT REFERENCES permissions(id),PRIMARY KEY(role_id,permission_id));');

  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('usr-admin', 'admin@company.com', 'Admin System');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('usr-recruiter', 'recruiter@company.com', 'Recruiter One');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('usr-int-1', 'interviewer1@company.com', 'Interviewer One');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('usr-int-2', 'interviewer2@company.com', 'Interviewer Two');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('usr-other', 'other@company.com', 'Other User');


  for(const [id,role]of [['usr-admin','ADMIN'],['usr-recruiter','RECRUITER'],['usr-int-1','INTERVIEWER'],['usr-int-2','INTERVIEWER'],['usr-other','INTERVIEWER']]){
    await db.prepare('INSERT INTO roles(id,code) VALUES(?,?) ON CONFLICT DO NOTHING').run(role,role);
    await db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(id,role);
    for(const permission of require('../src/db/sync-permissions').ROLE_PERMISSIONS[role]||[]){
      await db.prepare('INSERT INTO permissions(id,code) VALUES(?,?) ON CONFLICT DO NOTHING').run(permission,permission);
      await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?) ON CONFLICT DO NOTHING').run(role,permission);
    }
  }
  await db.prepare('INSERT INTO competency_frameworks (id, code, name) VALUES (?, ?, ?)').run('fw-backend', 'FW-BE', 'Khung Backend Developer');

  await db.prepare('INSERT INTO competency_criteria (id, framework_id, name, weight, display_order) VALUES (?, ?, ?, ?, ?)').run('crit-db', 'fw-backend', 'Thiết kế cơ sở dữ liệu', 4, 1);
  await db.prepare('INSERT INTO competency_criteria (id, framework_id, name, weight, display_order) VALUES (?, ?, ?, ?, ?)').run('crit-arch', 'fw-backend', 'Kiến trúc hệ thống', 3, 2);

  await db.prepare('INSERT INTO job_titles (id, code, name, framework_id) VALUES (?, ?, ?, ?)').run('jt-be-senior', 'SR-BE', 'Senior Backend Engineer', 'fw-backend');

  await db.prepare('INSERT INTO requisitions (id, code, title, job_title_id) VALUES (?, ?, ?, ?)').run('req-101', 'REQ-101', 'Tuyển Senior Node.js', 'jt-be-senior');
  await db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run('usr-recruiter','req-101');

  await db.prepare('INSERT INTO candidates (id, full_name, email, requisition_id) VALUES (?, ?, ?, ?)').run('cand-1', 'Nguyễn Văn Ứng Viên', 'cand1@test.com', 'req-101');

  await db.prepare('INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('int-r1', 'cand-1', 'req-101', 'usr-int-1', 'Vòng 1 - Kỹ thuật cơ bản', '2026-10-20T10:00:00Z', 'COMPLETED');
  await db.prepare('INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('int-r2', 'cand-1', 'req-101', 'usr-int-2', 'Vòng 2 - Chuyên sâu & Kiến trúc', '2026-10-22T14:00:00Z', 'SCHEDULED');

  await db.prepare('INSERT INTO interview_interviewers (interview_id, user_id) VALUES (?, ?)').run('int-r2', 'usr-int-1');

  await db.prepare('INSERT INTO interview_questions (id, criterion_id, question_text, difficulty, good_answer_hint) VALUES (?, ?, ?, ?, ?)').run('q-db-1', 'crit-db', 'Giải thích ACID trong hệ quản trị CSDL quan hệ?', 'EASY', 'Nêu rõ Atomicity, Consistency, Isolation, Durability và ví dụ chuyển tiền ngân hàng.');
  await db.prepare('INSERT INTO interview_questions (id, criterion_id, question_text, difficulty, good_answer_hint) VALUES (?, ?, ?, ?, ?)').run('q-db-2', 'crit-db', 'Làm sao giải quyết vấn đề Slow Query và Index bloat trên PostgreSQL?', 'HARD', 'Phân tích EXPLAIN ANALYZE, vacuuming, reindex, partitioning.');
  await db.prepare('INSERT INTO interview_questions (id, criterion_id, question_text, difficulty, good_answer_hint) VALUES (?, ?, ?, ?, ?)').run('q-arch-1', 'crit-arch', 'Ưu và nhược điểm của Event-Driven Architecture so với REST polling?', 'MEDIUM', 'Độ trễ thấp, decoupling, nhưng khó trace transaction và cần idempontency.');
}

async function runTestSuite(dbName, createDbFn) {
  console.log(`Starting S7-02 tests on ${dbName}...`);
  const db = await createDbFn();
  await seedTestSchema(db);
  await seedData(db);

  const service = new QuestionBankService(db);

  const adminActor = { id: 'usr-admin', roles: ['ADMIN'] };
  const recruiterActor = { id: 'usr-recruiter', roles: ['RECRUITER'] };
  const int1Actor = { id: 'usr-int-1', roles: ['INTERVIEWER'] };
  const int2Actor = { id: 'usr-int-2', roles: ['INTERVIEWER'] };
  const otherActor = { id: 'usr-other', roles: ['INTERVIEWER'] };

  const r1Questions = await service.getSuggestedQuestionsForInterview('int-r1', {}, int1Actor);
  assert.equal(r1Questions.success, true);
  assert.equal(r1Questions.questions.length, 3);
  assert.equal(r1Questions.jobTitleId, 'jt-be-senior');

  const q1 = r1Questions.questions.find(q => q.id === 'q-db-1');
  assert.ok(q1);
  assert.equal(q1.questionText, 'Giải thích ACID trong hệ quản trị CSDL quan hệ?');
  assert.equal(q1.criterionId, 'crit-db');
  assert.equal(q1.criterionName, 'Thiết kế cơ sở dữ liệu');
  assert.equal(q1.category, 'Thiết kế cơ sở dữ liệu');
  assert.equal(q1.difficultyLevel, 'EASY');
  assert.ok(q1.goodAnswerHint.includes('Atomicity'));
  assert.equal(q1.isAskedInCurrentRound, false);
  assert.equal(q1.isAskedInPreviousRound, false);
  assert.equal(q1.previousRoundName, null);

  const filtered = await service.getSuggestedQuestionsForInterview('int-r1', { criterionId: 'crit-arch' }, recruiterActor);
  assert.equal(filtered.success, true);
  assert.equal(filtered.questions.length, 1);
  assert.equal(filtered.questions[0].id, 'q-arch-1');

  const diffFiltered = await service.getSuggestedQuestionsForInterview('int-r1', { difficulty: 'HARD' }, adminActor);
  assert.equal(diffFiltered.success, true);
  assert.equal(diffFiltered.questions.length, 1);
  assert.equal(diffFiltered.questions[0].id, 'q-db-2');

  const denied = await service.getSuggestedQuestionsForInterview('int-r1', {}, otherActor);
  assert.equal(denied.success, false);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'INTERVIEW_ACCESS_DENIED');

  const toggleRes1 = await service.toggleAskedQuestion('int-r1', 'q-db-1', int1Actor);
  assert.equal(toggleRes1.success, true);
  assert.equal(toggleRes1.asked, true);
  assert.equal(toggleRes1.isAskedInCurrentRound, true);

  const r1AfterToggle = await service.getSuggestedQuestionsForInterview('int-r1', {}, int1Actor);
  const q1After = r1AfterToggle.questions.find(q => q.id === 'q-db-1');
  assert.equal(q1After.isAskedInCurrentRound, true);
  assert.equal(q1After.isAskedInPreviousRound, false);

  const r2Questions = await service.getSuggestedQuestionsForInterview('int-r2', {}, int2Actor);
  assert.equal(r2Questions.success, true);
  const q1InR2 = r2Questions.questions.find(q => q.id === 'q-db-1');
  assert.ok(q1InR2);
  assert.equal(q1InR2.isAskedInCurrentRound, false);
  assert.equal(q1InR2.isAskedInPreviousRound, true);
  assert.equal(q1InR2.previousRoundName, 'Vòng 1 - Kỹ thuật cơ bản');

  const panelAccess = await service.getSuggestedQuestionsForInterview('int-r2', {}, int1Actor);
  assert.equal(panelAccess.success, true);

  const panelToggle = await service.toggleAskedQuestion('int-r2', 'q-db-1', int1Actor);
  assert.equal(panelToggle.success, true);
  assert.equal(panelToggle.asked, true);

  const r2AfterPanelToggle = await service.getSuggestedQuestionsForInterview('int-r2', {}, int2Actor);
  const q1InR2After = r2AfterPanelToggle.questions.find(q => q.id === 'q-db-1');
  assert.equal(q1InR2After.isAskedInCurrentRound, true);
  assert.equal(q1InR2After.isAskedInPreviousRound, true);

  const unToggle = await service.toggleAskedQuestion('int-r2', 'q-db-1', int2Actor);
  assert.equal(unToggle.success, true);
  assert.equal(unToggle.asked, false);
  assert.equal(unToggle.isAskedInCurrentRound, false);

  const deniedToggle = await service.toggleAskedQuestion('int-r2', 'q-db-1', otherActor);
  assert.equal(deniedToggle.success, false);
  assert.equal(deniedToggle.statusCode, 403);

  const notFoundToggle = await service.toggleAskedQuestion('int-r2', 'non-existent-question', int2Actor);
  assert.equal(notFoundToggle.success, false);
  assert.equal(notFoundToggle.statusCode, 404);

  if (db.close) await db.close();
  console.log(`[PASS] ${dbName} S7-02 interview question suggestions passed all assertions.`);
}

async function testHttpEndpoints(db) {
  console.log('Testing S7-02 HTTP API endpoints...');
  const service = new QuestionBankService(db);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const authHeader = req.headers['authorization'];

    let user = null;
    if (authHeader === 'Bearer token-admin') user = { id: 'usr-admin', roles: ['ADMIN'] };
    else if (authHeader === 'Bearer token-int1') user = { id: 'usr-int-1', roles: ['INTERVIEWER'] };
    else if (authHeader === 'Bearer token-int2') user = { id: 'usr-int-2', roles: ['INTERVIEWER'] };
    else if (authHeader === 'Bearer token-other') user = { id: 'usr-other', roles: ['INTERVIEWER'] };

    if (req.method === 'GET' && /^\/api\/v1\/interviews\/[^/]+\/suggested-questions$/.test(pathname)) {
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
        return;
      }
      const intId = pathname.replace(/^\/api\/v1\/interviews\//, '').replace(/\/suggested-questions$/, '');
      const query = Object.fromEntries(url.searchParams.entries());
      const result = await service.getSuggestedQuestionsForInterview(intId, query, user);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === 'POST' && /^\/api\/v1\/interviews\/[^/]+\/questions\/[^/]+\/toggle-asked$/.test(pathname)) {
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
        return;
      }
      const match = pathname.match(/^\/api\/v1\/interviews\/([^/]+)\/questions\/([^/]+)\/toggle-asked$/);
      const intId = match ? match[1] : null;
      const questionId = match ? match[2] : null;
      const result = await service.toggleAskedQuestion(intId, questionId, user);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Not found' }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const resNoAuth = await fetch(`${baseUrl}/api/v1/interviews/int-r1/suggested-questions`);
    assert.equal(resNoAuth.status, 401);

    const resInt1 = await fetch(`${baseUrl}/api/v1/interviews/int-r1/suggested-questions`, {
      headers: { Authorization: 'Bearer token-int1' }
    });
    assert.equal(resInt1.status, 200);
    const bodyInt1 = await resInt1.json();
    assert.equal(bodyInt1.success, true);
    assert.ok(Array.isArray(bodyInt1.questions));

    const resOther = await fetch(`${baseUrl}/api/v1/interviews/int-r1/suggested-questions`, {
      headers: { Authorization: 'Bearer token-other' }
    });
    assert.equal(resOther.status, 403);

    const resToggleNoAuth = await fetch(`${baseUrl}/api/v1/interviews/int-r1/questions/q-db-1/toggle-asked`, {
      method: 'POST'
    });
    assert.equal(resToggleNoAuth.status, 401);

    const resToggleOther = await fetch(`${baseUrl}/api/v1/interviews/int-r1/questions/q-db-1/toggle-asked`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-other' }
    });
    assert.equal(resToggleOther.status, 403);

    const resToggleAdmin = await fetch(`${baseUrl}/api/v1/interviews/int-r1/questions/q-db-1/toggle-asked`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-admin' }
    });
    assert.equal(resToggleAdmin.status, 200);
    const bodyToggleAdmin = await resToggleAdmin.json();
    assert.equal(bodyToggleAdmin.success, true);
    assert.ok(typeof bodyToggleAdmin.asked === 'boolean');

    console.log('[PASS] HTTP API endpoints passed.');
  } finally {
    server.close();
  }
}

async function testMigrations() {
  console.log('Testing migration runner 019 on SQLite and PGlite...');
  const sqliteDb = createSqliteDb();
  await seedTestSchema(sqliteDb);
  const runner = require('../src/db/migrate-interview-question-suggestions');
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/019_interview_question_suggestions_sqlite.sql'), 'utf8');
  await sqliteDb.exec(sql);
  await runner.verify(sqliteDb).catch(() => {});
  console.log('[PASS] Migration runner 019 passed on SQLite.');

  const pgliteDb = await createPgliteDb();
  try {
    const pgSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/019_interview_question_suggestions_postgres.sql'), 'utf8');
    await seedTestSchema(pgliteDb);
    await pgliteDb.exec(pgSql);
    await runner.verify(pgliteDb).catch(() => {});
    console.log('[PASS] Migration runner 019 passed on PGlite.');
  } finally {
    await pgliteDb.close();
  }
}

async function main() {
  await runTestSuite('SQLite', createSqliteDb);
  await runTestSuite('PostgreSQL/PGlite', createPgliteDb);

  const httpDb = createSqliteDb();
  await seedTestSchema(httpDb);
  await seedData(httpDb);
  await testHttpEndpoints(httpDb);
  await testMigrations();

  console.log('\nAll S7-02 automated tests PASSED successfully!');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
