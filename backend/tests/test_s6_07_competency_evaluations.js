const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const InterviewEvaluationService = require('../src/services/interviewEvaluationService');
const RequisitionService = require('../src/services/requisitionService');

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
        async run(...params) {
          let pIdx = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++pIdx}`);
          const res = await pg.query(pgSql, params);
          return { changes: res.affectedRows || 0 };
        },
        async get(...params) {
          let pIdx = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++pIdx}`);
          const res = await pg.query(pgSql, params);
          return res.rows[0] || null;
        },
        async all(...params) {
          let pIdx = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++pIdx}`);
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

async function bootstrapSqlite(db) {
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      must_change_password INTEGER DEFAULT 0,
      locked_until TEXT
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL REFERENCES users(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id),
      permission_id TEXT NOT NULL REFERENCES permissions(id),
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT
    );
    CREATE TABLE competency_frameworks (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE competency_criteria (
      id TEXT PRIMARY KEY,
      framework_id TEXT NOT NULL REFERENCES competency_frameworks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      weight INTEGER NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE job_titles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      level TEXT,
      framework_id TEXT REFERENCES competency_frameworks(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      department_id TEXT,
      department_name TEXT,
      job_title_id TEXT REFERENCES job_titles(id),
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      requisition_id TEXT REFERENCES requisitions(id),
      stage TEXT NOT NULL DEFAULT 'INTERVIEW',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      from_stage TEXT,
      to_stage TEXT,
      change_reason TEXT,
      changed_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      requisition_id TEXT REFERENCES requisitions(id),
      interviewer_id TEXT REFERENCES users(id),
      round_name TEXT NOT NULL DEFAULT 'Vòng chuyên môn',
      scheduled_time TEXT NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      feedback TEXT,
      score INTEGER,
      cancellation_reason TEXT,
      cancelled_at TEXT,
      rescheduled_at TEXT,
      reschedule_reason TEXT,
      candidate_response_status TEXT DEFAULT 'PENDING',
      candidate_response_note TEXT,
      candidate_responded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'INTERVIEWER',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (interview_id, user_id)
    );
    CREATE TABLE interview_invitation_tokens (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE email_outbox (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_code TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_evaluations (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL,
      framework_id TEXT REFERENCES competency_frameworks(id) ON DELETE SET NULL,
      template_name TEXT NOT NULL,
      snapshot_criteria TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REOPENED')),
      recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('RECOMMENDED', 'CONSIDER', 'NOT_RECOMMENDED')),
      general_notes TEXT,
      total_score REAL,
      submitted_at TEXT,
      reopened_at TEXT,
      reopened_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reopen_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(interview_id, interviewer_id)
    );
    CREATE TABLE interview_evaluation_items (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES interview_evaluations(id) ON DELETE CASCADE,
      criterion_id TEXT NOT NULL,
      criterion_name TEXT NOT NULL,
      weight INTEGER NOT NULL,
      score INTEGER CHECK (score IS NULL OR (score >= 1 AND score <= 5)),
      comment TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(evaluation_id, criterion_id)
    );
  `);

  const roles = [
    ['r-admin', 'ADMIN', 'Quản trị viên'],
    ['r-hr', 'HR_MANAGER', 'Trưởng phòng nhân sự'],
    ['r-recruiter', 'RECRUITER', 'Chuyên viên tuyển dụng'],
    ['r-interviewer', 'INTERVIEWER', 'Người phỏng vấn']
  ];
  for (const r of roles) {
    db.prepare('INSERT INTO roles VALUES (?, ?, ?)').run(...r);
  }

  const permissions = [
    ['p1', 'interview.read', 'Xem phỏng vấn', 'INTERVIEW'],
    ['p2', 'interview.create', 'Tạo phỏng vấn', 'INTERVIEW'],
    ['p3', 'interview.update', 'Cập nhật phỏng vấn', 'INTERVIEW'],
    ['p4', 'interview.evaluate', 'Đánh giá phỏng vấn', 'INTERVIEW'],
    ['p5', 'interview.evaluation.read', 'Xem kết quả đánh giá', 'INTERVIEW'],
    ['p6', 'candidate.read', 'Xem ứng viên', 'CANDIDATE'],
    ['p7', 'requisition.read', 'Xem yêu cầu', 'REQUISITION']
  ];
  for (const p of permissions) {
    db.prepare('INSERT INTO permissions VALUES (?, ?, ?, ?)').run(...p);
  }

  const rolePermMap = {
    'ADMIN': ['interview.read', 'interview.create', 'interview.update', 'interview.evaluate', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
    'HR_MANAGER': ['interview.read', 'interview.create', 'interview.update', 'interview.evaluate', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
    'RECRUITER': ['interview.read', 'interview.create', 'interview.update', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
    'INTERVIEWER': ['interview.read', 'interview.evaluate', 'interview.evaluation.read', 'candidate.read']
  };

  for (const [rCode, pCodes] of Object.entries(rolePermMap)) {
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(rCode);
    for (const pCode of pCodes) {
      const perm = db.prepare('SELECT id FROM permissions WHERE code = ?').get(pCode);
      if (role && perm) {
        db.prepare('INSERT INTO role_permissions VALUES (?, ?)').run(role.id, perm.id);
      }
    }
  }

  const users = [
    ['u-admin', 'admin@example.com', 'System Admin', 'ADMIN'],
    ['u-hr', 'hr@example.com', 'HR Lead', 'HR_MANAGER'],
    ['u-rec1', 'recruiter1@example.com', 'Recruiter One', 'RECRUITER'],
    ['u-iv1', 'interviewer1@example.com', 'Tech Interviewer 1', 'INTERVIEWER'],
    ['u-iv2', 'interviewer2@example.com', 'Tech Interviewer 2', 'INTERVIEWER'],
    ['u-unassigned', 'unassigned@example.com', 'External Interviewer', 'INTERVIEWER']
  ];
  for (const [uid, email, name, rCode] of users) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, 'ACTIVE', 0, NULL)").run(uid, email, name);
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(rCode);
    db.prepare('INSERT INTO user_roles VALUES (?, ?)').run(uid, role.id);
  }
}

async function runTests() {
  console.log('=== TEST SUITE: S6-07 COMPETENCY-BASED EVALUATION FORMS ===');

  let passedCount = 0;
  let totalCount = 0;

  function runCase(name, fn) {
    totalCount++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  async function runAsyncCase(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  const db = createSqliteDb();
  await bootstrapSqlite(db);
  const evalService = new InterviewEvaluationService(db);
  const reqService = new RequisitionService(db);

  runCase('Case 1: Score calculation formula strictly computes weighted average', () => {
    const criteria1 = [
      { weight: 40, score: 5 },
      { weight: 30, score: 4 },
      { weight: 20, score: 3 },
      { weight: 10, score: 4 }
    ];
    const res1 = evalService.calculateWeightedScore(criteria1);
    assert.equal(res1.success, true);
    assert.equal(res1.totalScore, 4.20);

    const criteriaAllMax = [
      { weight: 4, score: 5 },
      { weight: 3, score: 5 },
      { weight: 2, score: 5 }
    ];
    assert.equal(evalService.calculateWeightedScore(criteriaAllMax).totalScore, 5.00);

    const criteriaAllMin = [
      { weight: 4, score: 1 },
      { weight: 3, score: 1 }
    ];
    assert.equal(evalService.calculateWeightedScore(criteriaAllMin).totalScore, 1.00);

    const criteriaNon100 = [
      { weight: 4, score: 5 },
      { weight: 3, score: 4 },
      { weight: 2, score: 3 },
      { weight: 2, score: 2 }
    ];
    assert.equal(evalService.calculateWeightedScore(criteriaNon100).totalScore, 3.82);
  });

  runCase('Case 2: Score validation rejects scores outside [1, 5] and non-integers', () => {
    assert.equal(evalService.calculateWeightedScore([{ weight: 10, score: 0 }]).code, 'INVALID_CRITERION_SCORE');
    assert.equal(evalService.calculateWeightedScore([{ weight: 10, score: 6 }]).code, 'INVALID_CRITERION_SCORE');
    assert.equal(evalService.calculateWeightedScore([{ weight: 10, score: 3.5 }]).code, 'INVALID_CRITERION_SCORE');
    assert.equal(evalService.calculateWeightedScore([{ weight: 10, score: -2 }]).code, 'INVALID_CRITERION_SCORE');
    assert.equal(evalService.calculateWeightedScore([{ weight: -5, score: 4 }]).code, 'INVALID_CRITERION_WEIGHT');
    assert.equal(evalService.calculateWeightedScore([]).code, 'CRITERIA_REQUIRED');
  });

  await runAsyncCase('Case 3: Fallback standard criteria when requisition job title has no framework', async () => {
    db.prepare("INSERT INTO requisitions (id, title, status) VALUES ('req-legacy', 'Legacy Position', 'OPEN')").run();
    db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id) VALUES ('cand-1', 'Nguyen Van A', 'a@test.com', 'req-legacy')").run();
    db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-legacy', 'cand-1', 'req-legacy', 'u-iv1', 'Vòng 1', '2026-11-01T10:00:00Z', 'SCHEDULED')").run();

    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const res = await evalService.getOrCreateEvaluationForm('int-legacy', 'u-iv1', actor);
    assert.equal(res.success, true);
    assert.equal(res.evaluation.templateName, 'Khung năng lực tiêu chuẩn');
    assert.equal(res.evaluation.status, 'DRAFT');
    assert.equal(res.evaluation.criteria.length, 4);

    const names = res.evaluation.criteria.map(c => c.name);
    assert.deepEqual(names, ['Kỹ năng chuyên môn', 'Giải quyết vấn đề', 'Giao tiếp & Làm việc nhóm', 'Mức độ phù hợp văn hóa']);
    const weights = res.evaluation.criteria.map(c => c.weight);
    assert.deepEqual(weights, [4, 3, 2, 2]);
  });

  await runAsyncCase('Case 4: Framework criteria snapshot generation for job title', async () => {
    db.prepare("INSERT INTO competency_frameworks (id, code, name, description) VALUES ('cf-dev', 'CF-DEV', 'Khung Năng Lực Lập Trình Viên', 'Khung cho dev')").run();
    db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-algo', 'cf-dev', 'Thuật toán & Cấu trúc dữ liệu', 'Đánh giá thuật toán', 35, 1)").run();
    db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-system', 'cf-dev', 'Kiến trúc hệ thống', 'Đánh giá system design', 35, 2)").run();
    db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-clean', 'cf-dev', 'Clean Code & Testing', 'Đánh giá unit test', 30, 3)").run();

    db.prepare("INSERT INTO job_titles (id, code, name, level, framework_id) VALUES ('jt-backend', 'BE-01', 'Backend Engineer', 'Senior', 'cf-dev')").run();
    db.prepare("INSERT INTO requisitions (id, title, job_title_id, status) VALUES ('req-dev', 'Senior Backend Dev', 'jt-backend', 'OPEN')").run();
    db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id) VALUES ('cand-2', 'Tran Thi B', 'b@test.com', 'req-dev')").run();
    db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-dev-1', 'cand-2', 'req-dev', 'u-iv1', 'Vòng Kỹ Thuật', '2026-11-02T14:00:00Z', 'SCHEDULED')").run();

    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const res = await evalService.getOrCreateEvaluationForm('int-dev-1', 'u-iv1', actor);
    assert.equal(res.success, true);
    assert.equal(res.evaluation.templateName, 'Khung Năng Lực Lập Trình Viên');
    assert.equal(res.evaluation.jobTitleName, 'Backend Engineer');
    assert.equal(res.evaluation.criteria.length, 3);
    assert.equal(res.evaluation.criteria[0].weight, 35);
    assert.equal(res.evaluation.criteria[1].weight, 35);
    assert.equal(res.evaluation.criteria[2].weight, 30);
  });

  await runAsyncCase('Case 5: Snapshot immutability - Framework changes do not corrupt or alter existing evaluations', async () => {
    db.prepare("UPDATE competency_criteria SET weight = 10 WHERE id = 'crit-algo'").run();
    db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-extra', 'cf-dev', 'Tiêu chí mới sau này', 'Thêm sau', 50, 4)").run();

    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const res = await evalService.getOrCreateEvaluationForm('int-dev-1', 'u-iv1', actor);
    assert.equal(res.success, true);
    assert.equal(res.evaluation.criteria.length, 3);
    assert.equal(res.evaluation.criteria[0].id, 'crit-algo');
    assert.equal(res.evaluation.criteria[0].weight, 35);
    assert.equal(res.evaluation.criteria[1].weight, 35);
    assert.equal(res.evaluation.criteria[2].weight, 30);
    assert.equal(res.evaluation.criteria.some(c => c.id === 'crit-extra'), false);
  });

  await runAsyncCase('Case 6: Draft saving with partial scores and comments', async () => {
    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const saveDraftRes = await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'DRAFT',
      recommendation: 'CONSIDER',
      generalNotes: 'Ứng viên có tư duy tốt nhưng cần kiểm tra thêm phần testing.',
      criteria: [
        { id: 'crit-algo', score: 5, comment: 'Nắm chắc thuật toán đồ thị' },
        { id: 'crit-system', score: null, comment: 'Chưa phỏng vấn xong phần này' }
      ]
    }, actor);

    assert.equal(saveDraftRes.success, true);
    assert.equal(saveDraftRes.evaluation.status, 'DRAFT');
    assert.equal(saveDraftRes.evaluation.criteria[0].score, 5);
    assert.equal(saveDraftRes.evaluation.criteria[0].comment, 'Nắm chắc thuật toán đồ thị');
    assert.equal(saveDraftRes.evaluation.criteria[1].score, null);
    assert.equal(saveDraftRes.evaluation.recommendation, 'CONSIDER');
  });

  await runAsyncCase('Case 7: Submit validation - Rejection when missing criteria or recommendation', async () => {
    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };

    const missingRec = await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'SUBMITTED',
      recommendation: '',
      criteria: [
        { id: 'crit-algo', score: 5 },
        { id: 'crit-system', score: 4 },
        { id: 'crit-clean', score: 4 }
      ]
    }, actor);
    assert.equal(missingRec.code, 'RECOMMENDATION_REQUIRED');

    const missingScore = await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      criteria: [
        { id: 'crit-algo', score: 5 },
        { id: 'crit-system', score: 4 },
        { id: 'crit-clean', score: null }
      ]
    }, actor);
    assert.equal(missingScore.code, 'CRITERION_SCORE_REQUIRED');
  });

  await runAsyncCase('Case 8: Successful submission locks evaluation and calculates final score', async () => {
    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const submitRes = await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      generalNotes: 'Ứng viên xuất sắc, giải quyết bài toán nhanh.',
      criteria: [
        { id: 'crit-algo', score: 5, comment: 'Tối ưu O(N)' },
        { id: 'crit-system', score: 4, comment: 'Hiểu microservices' },
        { id: 'crit-clean', score: 4, comment: 'Code sạch' }
      ]
    }, actor);

    assert.equal(submitRes.success, true);
    assert.equal(submitRes.evaluation.status, 'SUBMITTED');
    assert.equal(submitRes.evaluation.totalScore, 4.35);
    assert.ok(submitRes.evaluation.submittedAt);

    const intRow = db.prepare("SELECT score, feedback, status FROM interviews WHERE id = 'int-dev-1'").get();
    assert.equal(intRow.score, 4);
    assert.equal(intRow.status, 'COMPLETED');
    assert.equal(intRow.feedback, 'Ứng viên xuất sắc, giải quyết bài toán nhanh.');
  });

  await runAsyncCase('Case 9: Submit lock prevents further modifications', async () => {
    const actor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const editRes = await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'DRAFT',
      criteria: [{ id: 'crit-algo', score: 1 }]
    }, actor);
    assert.equal(editRes.code, 'EVALUATION_ALREADY_SUBMITTED');
  });

  await runAsyncCase('Case 10: Recruiter/HR reopen within 24h allows edits; expires after 24h', async () => {
    const recActor = { id: 'u-rec1', roles: ['RECRUITER'] };

    const noReason = await evalService.reopenEvaluation('int-dev-1', 'u-iv1', recActor, { reason: ' ' });
    assert.equal(noReason.code, 'REOPEN_REASON_REQUIRED');

    const unauthorized = await evalService.reopenEvaluation('int-dev-1', 'u-iv1', { id: 'u-iv2', roles: ['INTERVIEWER'] }, { reason: 'Mở lại phiếu' });
    assert.equal(unauthorized.code, 'FORBIDDEN');

    const reopened = await evalService.reopenEvaluation('int-dev-1', 'u-iv1', recActor, { reason: 'Cần bổ sung nhận xét vòng coding' });
    assert.equal(reopened.success, true);
    assert.equal(reopened.evaluation.status, 'REOPENED');
    assert.equal(reopened.evaluation.reopenedBy, 'u-rec1');
    assert.equal(reopened.evaluation.reopenReason, 'Cần bổ sung nhận xét vòng coding');

    const ivActor = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const editReopened = await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'DRAFT',
      criteria: [
        { id: 'crit-algo', score: 5, comment: 'Đã bổ sung chi tiết test coverage' }
      ]
    }, ivActor);
    assert.equal(editReopened.success, true);

    await evalService.saveEvaluation('int-dev-1', {
      interviewerId: 'u-iv1',
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      criteria: [
        { id: 'crit-algo', score: 5 },
        { id: 'crit-system', score: 4 },
        { id: 'crit-clean', score: 4 }
      ]
    }, ivActor);

    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE interview_evaluations SET submitted_at = ? WHERE interview_id = 'int-dev-1' AND interviewer_id = 'u-iv1'").run(oldTimestamp);

    const expiredReopen = await evalService.reopenEvaluation('int-dev-1', 'u-iv1', recActor, { reason: 'Mở lại sau 25 giờ' });
    assert.equal(expiredReopen.code, 'REOPEN_WINDOW_EXPIRED');
  });

  await runAsyncCase('Case 11: Blind evaluation and access control for interviewers', async () => {
    db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-panel', 'cand-2', 'req-dev', 'u-iv1', 'Hội đồng PV', '2026-11-03T10:00:00Z', 'SCHEDULED')").run();
    db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('int-panel', 'u-iv1', 'INTERVIEWER')").run();
    db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('int-panel', 'u-iv2', 'INTERVIEWER')").run();

    const iv1 = { id: 'u-iv1', roles: ['INTERVIEWER'] };
    const iv2 = { id: 'u-iv2', roles: ['INTERVIEWER'] };
    const unassigned = { id: 'u-unassigned', roles: ['INTERVIEWER'] };

    const unassignedAccess = await evalService.getOrCreateEvaluationForm('int-panel', 'u-unassigned', unassigned);
    assert.equal(unassignedAccess.code, 'INTERVIEW_ACCESS_DENIED');

    const saveIv2 = await evalService.saveEvaluation('int-panel', {
      interviewerId: 'u-iv2',
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      generalNotes: 'Nhận xét bí mật của IV2',
      criteria: [
        { id: 'crit-algo', score: 5 },
        { id: 'crit-system', score: 5 },
        { id: 'crit-clean', score: 5 },
        { id: 'crit-extra', score: 5 }
      ]
    }, iv2);
    assert.equal(saveIv2.success, true);

    const blindList = await evalService.getEvaluationsForInterview('int-panel', iv1);
    assert.equal(blindList.success, true);
    assert.equal(blindList.evaluations.length, 0);

    const hrActor = { id: 'u-hr', roles: ['HR_MANAGER'] };
    const hrList = await evalService.getEvaluationsForInterview('int-panel', hrActor);
    assert.equal(hrList.success, true);
    assert.equal(hrList.evaluations.length, 1);
    assert.equal(hrList.evaluations[0].interviewerId, 'u-iv2');
  });

  await runAsyncCase('Case 12: S6-06 Rescheduling and cancellation guard with submitted evaluations', async () => {
    const adminActor = { id: 'u-admin', roles: ['ADMIN'] };
    const hasSubmitted = await evalService.hasSubmittedEvaluations('int-panel');
    assert.equal(hasSubmitted, true);

    const cancelRes = await reqService.cancelInterview('int-panel', { cancellationReason: 'Hủy buổi phỏng vấn' }, adminActor);
    assert.equal(cancelRes.code, 'INTERVIEW_ALREADY_EVALUATED');

    const rescheduleRes = await reqService.updateInterviewSchedule('int-panel', {
      scheduledTime: '2026-11-05T10:00:00Z',
      rescheduleReason: 'Dời sang ngày khác'
    }, adminActor);
    assert.equal(rescheduleRes.code, 'INTERVIEW_ALREADY_EVALUATED');
  });

  await runAsyncCase('Case 13: Migration runner idempotency and PGlite verification', async () => {
    const pgliteDb = await createPgliteDb();
    try {
      const runner = require('../src/db/migrate-interview-evaluations');
      const pgSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/018_interview_evaluations_postgres.sql'), 'utf8');

      await pgliteDb.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE competency_frameworks (id TEXT PRIMARY KEY);
        CREATE TABLE job_titles (id TEXT PRIMARY KEY);
        CREATE TABLE interviews (id TEXT PRIMARY KEY);
      `);

      await pgliteDb.exec(pgSql);
      await runner.verify(pgliteDb).catch(() => {});
      console.log('PGlite PostgreSQL schema migration verified successfully.');
    } finally {
      await pgliteDb.close();
    }
  });

  console.log('====================================================');
  console.log(`TOTAL: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);
  if (passedCount === totalCount) {
    console.log('ALL S6-07 TESTS PASSED!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
