const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const InterviewEvaluationService = require('../src/services/interviewEvaluationService');

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
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TEXT
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
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
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      manager_id TEXT REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      department_id TEXT REFERENCES departments(id),
      department_name TEXT,
      job_title_id TEXT REFERENCES job_titles(id),
      recruiter_id TEXT REFERENCES users(id),
      hiring_manager_id TEXT REFERENCES users(id),
      created_by TEXT REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE requisition_recruiter_supports (
      id TEXT PRIMARY KEY,
      requisition_id TEXT NOT NULL REFERENCES requisitions(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'INTERVIEWER',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (interview_id, user_id)
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
    ['r-hm', 'HIRING_MGR', 'Trưởng bộ phận'],
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
    'HIRING_MGR': ['interview.read', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
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
    ['u-admin', 'admin@example.com', 'Admin System', 'ADMIN'],
    ['u-hr', 'hr@example.com', 'HR Director', 'HR_MANAGER'],
    ['u-hm-qa', 'hm.qa@example.com', 'Head of QA Department', 'HIRING_MGR'],
    ['u-hm-dev', 'hm.dev@example.com', 'Head of Dev Department', 'HIRING_MGR'],
    ['u-rec-qa', 'rec.qa@example.com', 'QA Recruiter', 'RECRUITER'],
    ['u-rec-other', 'rec.other@example.com', 'Other Recruiter', 'RECRUITER'],
    ['u-iv1', 'iv1@example.com', 'Principal Engineer', 'INTERVIEWER'],
    ['u-iv2', 'iv2@example.com', 'Staff Engineer', 'INTERVIEWER'],
    ['u-iv-stranger', 'stranger@example.com', 'Stranger Interviewer', 'INTERVIEWER']
  ];
  for (const [uid, email, name, rCode] of users) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, 'ACTIVE', 0, NULL)").run(uid, email, name);
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(rCode);
    db.prepare('INSERT INTO user_roles VALUES (?, ?)').run(uid, role.id);
  }
}

async function runTests() {
  console.log('=== TEST SUITE: S6-09 CANDIDATE EVALUATIONS COMPARISON ===');

  let passedCount = 0;
  let totalCount = 0;

  async function testCase(name, fn) {
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

  db.prepare("INSERT INTO competency_frameworks (id, code, name, description) VALUES ('cf-qa', 'CF-QA', 'Khung Năng Lực QA/QC', 'Khung kiểm thử')").run();
  db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-testcase', 'cf-qa', 'Thiết kế Test Case', 'Kỹ năng thiết kế test case', 40, 1)").run();
  db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-automation', 'cf-qa', 'Automation Testing', 'Kỹ năng automation', 30, 2)").run();
  db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-quality-mindset', 'cf-qa', 'Tư duy chất lượng', 'Quality mindset', 30, 3)").run();

  db.prepare("INSERT INTO job_titles (id, code, name, level, framework_id) VALUES ('jt-qa', 'QA-MID', 'QA Mid Engineer', 'Mid', 'cf-qa')").run();
  db.prepare("INSERT INTO departments (id, name, manager_id) VALUES ('dept-qa', 'Phòng Đảm Bảo Chất Lượng', 'u-hm-qa')").run();
  db.prepare("INSERT INTO departments (id, name, manager_id) VALUES ('dept-dev', 'Phòng Phát Triển Phần Mềm', 'u-hm-dev')").run();

  db.prepare("INSERT INTO requisitions (id, code, title, department_id, department_name, job_title_id, recruiter_id, hiring_manager_id, status) VALUES ('req-qa-01', 'REQ-QA-001', 'QA Automation Engineer', 'dept-qa', 'Phòng Đảm Bảo Chất Lượng', 'jt-qa', 'u-rec-qa', 'u-hm-qa', 'OPEN')").run();
  db.prepare("INSERT INTO requisitions (id, code, title, department_id, department_name, job_title_id, recruiter_id, hiring_manager_id, status) VALUES ('req-dev-01', 'REQ-DEV-001', 'Backend Golang Engineer', 'dept-dev', 'Phòng Phát Triển Phần Mềm', NULL, 'u-rec-other', 'u-hm-dev', 'OPEN')").run();

  db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-1', 'Đỗ Anh Tuấn', 'tuan.do@test.com', '0901111111', 'req-qa-01', 'INTERVIEW')").run();
  db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-2', 'Nguyễn Thị Mai', 'mai.nguyen@test.com', '0902222222', 'req-qa-01', 'INTERVIEW')").run();
  db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-3', 'Trần Quốc Bảo', 'bao.tran@test.com', '0903333333', 'req-qa-01', 'INTERVIEW')").run();
  db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-4-draft', 'Lê Hữu Đạt', 'dat.le@test.com', '0904444444', 'req-qa-01', 'INTERVIEW')").run();
  db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-5-round1', 'Phạm Minh Quân', 'quan.pham@test.com', '0905555555', 'req-qa-01', 'INTERVIEW')").run();

  db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-dev-1', 'Vũ Đức Thịnh', 'thinh.vu@test.com', '0909999999', 'req-dev-01', 'INTERVIEW')").run();

  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-c1-final', 'cand-1', 'req-qa-01', 'u-iv1', 'Vòng Phỏng Vấn Cuối', '2026-11-20T10:00:00Z', 'COMPLETED')").run();
  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c1', 'int-c1-final', 'u-iv1', 'Khung Năng Lực QA/QC', '[]', 'SUBMITTED', 'RECOMMENDED', 4.60, '2026-11-20T11:30:00Z')").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c1-1', 'eval-c1', 'crit-testcase', 'Thiết kế Test Case', 40, 5, 'Kỹ thuật xuất sắc', 1)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c1-2', 'eval-c1', 'crit-automation', 'Automation Testing', 30, 4, 'Thành thạo Playwright', 2)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c1-3', 'eval-c1', 'crit-quality-mindset', 'Tư duy chất lượng', 30, 5, 'Rất cẩn thận', 3)").run();

  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-c2-final', 'cand-2', 'req-qa-01', 'u-iv1', 'Vòng Phỏng Vấn Cuối', '2026-11-21T14:00:00Z', 'COMPLETED')").run();
  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c2', 'int-c2-final', 'u-iv1', 'Khung Năng Lực QA/QC', '[]', 'SUBMITTED', 'CONSIDER', 3.70, '2026-11-21T15:30:00Z')").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c2-1', 'eval-c2', 'crit-testcase', 'Thiết kế Test Case', 40, 4, 'Test case đạt chuẩn', 1)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c2-2', 'eval-c2', 'crit-automation', 'Automation Testing', 30, 3, 'Cần thêm kinh nghiệm CI/CD', 2)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c2-3', 'eval-c2', 'crit-quality-mindset', 'Tư duy chất lượng', 30, 4, 'Tư duy tốt', 3)").run();

  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-c3-final', 'cand-3', 'req-qa-01', 'u-iv1', 'Vòng Phỏng Vấn Cuối', '2026-11-22T09:00:00Z', 'COMPLETED')").run();
  db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('int-c3-final', 'u-iv1', 'INTERVIEWER')").run();
  db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('int-c3-final', 'u-iv2', 'INTERVIEWER')").run();
  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c3-iv1', 'int-c3-final', 'u-iv1', 'Khung Năng Lực QA/QC', '[]', 'SUBMITTED', 'RECOMMENDED', 4.40, '2026-11-22T10:15:00Z')").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c3-1-1', 'eval-c3-iv1', 'crit-testcase', 'Thiết kế Test Case', 40, 5, 'Rất tốt', 1)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c3-1-2', 'eval-c3-iv1', 'crit-automation', 'Automation Testing', 30, 4, 'Khá vững', 2)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c3-1-3', 'eval-c3-iv1', 'crit-quality-mindset', 'Tư duy chất lượng', 30, 4, 'Chủ động', 3)").run();

  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c3-iv2', 'int-c3-final', 'u-iv2', 'Khung Năng Lực QA/QC', '[]', 'SUBMITTED', 'RECOMMENDED', 4.00, '2026-11-22T10:30:00Z')").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c3-2-1', 'eval-c3-iv2', 'crit-testcase', 'Thiết kế Test Case', 40, 4, 'Đạt yêu cầu', 1)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c3-2-2', 'eval-c3-iv2', 'crit-automation', 'Automation Testing', 30, 4, 'Tương đương mid level', 2)").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-c3-2-3', 'eval-c3-iv2', 'crit-quality-mindset', 'Tư duy chất lượng', 30, 4, 'Thái độ tốt', 3)").run();

  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-c4-draft', 'cand-4-draft', 'req-qa-01', 'u-iv1', 'Vòng Phỏng Vấn Cuối', '2026-11-23T10:00:00Z', 'SCHEDULED')").run();
  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c4-draft', 'int-c4-draft', 'u-iv1', 'Khung Năng Lực QA/QC', '[]', 'DRAFT', NULL, 3.20, NULL)").run();

  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-c5-r1', 'cand-5-round1', 'req-qa-01', 'u-iv1', 'Vòng 1 - Phỏng Vấn Sơ Loại', '2026-11-10T09:00:00Z', 'COMPLETED')").run();
  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c5-r1', 'int-c5-r1', 'u-iv1', 'Khung Năng Lực QA/QC', '[]', 'SUBMITTED', 'CONSIDER', 3.00, '2026-11-10T10:00:00Z')").run();

  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-dev-final', 'cand-dev-1', 'req-dev-01', 'u-iv1', 'Vòng Phỏng Vấn Cuối', '2026-11-24T10:00:00Z', 'COMPLETED')").run();
  db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-dev-1', 'int-dev-final', 'u-iv1', 'Tiêu chuẩn', '[]', 'SUBMITTED', 'RECOMMENDED', 4.50, '2026-11-24T11:00:00Z')").run();
  db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES ('item-dev-1', 'eval-dev-1', 'crit-tech-01', 'Kỹ năng chuyên môn', 4, 5, 'Go giỏi', 1)").run();

  const hmActor = { id: 'u-hm-qa', roles: ['HIRING_MGR'] };
  const adminActor = { id: 'u-admin', roles: ['ADMIN'] };
  const hrActor = { id: 'u-hr', roles: ['HR_MANAGER'] };
  const recActor = { id: 'u-rec-qa', roles: ['RECRUITER'] };
  const unassignedRecActor = { id: 'u-rec-other', roles: ['RECRUITER'] };
  const otherHmActor = { id: 'u-hm-dev', roles: ['HIRING_MGR'] };
  const interviewerActor = { id: 'u-iv1', roles: ['INTERVIEWER'] };

  await testCase('TC01: Position isolation - only returns candidates belonging to the target requisition', async () => {
    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);

    const candIds = res.data.candidates.map(c => c.candidateId);
    assert.equal(candIds.includes('cand-dev-1'), false);
    assert.ok(candIds.length > 0);
  });

  await testCase('TC02: Submitted-only filtering - excludes candidates with zero or draft-only evaluations', async () => {
    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);

    const candIds = res.data.candidates.map(c => c.candidateId);
    assert.equal(candIds.includes('cand-4-draft'), false);
  });

  await testCase('TC03: Final-round filtering - selects final round interviews and excludes earlier rounds', async () => {
    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);

    const candIds = res.data.candidates.map(c => c.candidateId);
    assert.equal(candIds.includes('cand-5-round1'), false);
    for (const cand of res.data.candidates) {
      assert.equal(cand.roundName, 'Vòng Phỏng Vấn Cuối');
    }
  });

  await testCase('TC04: Criteria score breakdown - returns individual criterion scores and weights', async () => {
    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);

    const headers = res.data.criteriaHeaders;
    assert.equal(headers.length, 3);
    assert.equal(headers[0].id, 'crit-testcase');
    assert.equal(headers[0].weight, 40);

    const cand1 = res.data.candidates.find(c => c.candidateId === 'cand-1');
    assert.ok(cand1);
    assert.equal(cand1.criteriaScores['crit-testcase'], 5);
    assert.equal(cand1.criteriaScores['crit-automation'], 4);
    assert.equal(cand1.criteriaScores['crit-quality-mindset'], 5);
  });

  await testCase('TC05: Total score calculation and descending sort order (highest score first)', async () => {
    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);

    const candidates = res.data.candidates;
    assert.equal(candidates.length, 3);

    assert.equal(candidates[0].candidateId, 'cand-1');
    assert.equal(candidates[0].rank, 1);
    assert.equal(candidates[0].totalScore, 4.60);

    assert.equal(candidates[1].candidateId, 'cand-3');
    assert.equal(candidates[1].rank, 2);
    assert.equal(candidates[1].totalScore, 4.20);

    assert.equal(candidates[2].candidateId, 'cand-2');
    assert.equal(candidates[2].rank, 3);
    assert.equal(candidates[2].totalScore, 3.70);

    const ascRes = await evalService.compareCandidateEvaluations('req-qa-01', { order: 'ASC' }, hmActor);
    assert.equal(ascRes.data.candidates[0].candidateId, 'cand-2');
    assert.equal(ascRes.data.candidates[2].candidateId, 'cand-1');
  });

  await testCase('TC06: Multi-interviewer aggregation - averages scores per criterion and total score', async () => {
    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);

    const cand3 = res.data.candidates.find(c => c.candidateId === 'cand-3');
    assert.ok(cand3);
    assert.equal(cand3.evaluationCount, 2);
    assert.equal(cand3.totalScore, 4.20);
    assert.equal(cand3.criteriaScores['crit-testcase'], 4.5);
    assert.equal(cand3.criteriaScores['crit-automation'], 4.0);
    assert.equal(cand3.criteriaScores['crit-quality-mindset'], 4.0);
    assert.equal(cand3.recommendationSummary.RECOMMENDED, 2);
    assert.equal(cand3.evaluations.length, 2);
  });

  await testCase('TC07: Framework version handling - gracefully unions criteria when candidates have different criteria', async () => {
    db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES ('cand-legacy', 'Đặng Văn Cũ', 'cu@test.com', 'req-qa-01', 'INTERVIEW')").run();
    db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-c-legacy', 'cand-legacy', 'req-qa-01', 'u-iv1', 'Vòng Phỏng Vấn Cuối', '2026-11-23T14:00:00Z', 'COMPLETED')").run();
    db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('eval-c-legacy', 'int-c-legacy', 'u-iv1', 'Bản cũ', '[]', 'SUBMITTED', 'RECOMMENDED', 4.00, '2026-11-23T15:00:00Z')").run();
    db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, display_order) VALUES ('item-leg-1', 'eval-c-legacy', 'crit-legacy-special', 'Kỹ Năng Cũ Đặc Thù', 20, 4, 4)").run();

    const res = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(res.success, true);

    const headerIds = res.data.criteriaHeaders.map(h => h.id);
    assert.ok(headerIds.includes('crit-legacy-special'));
    assert.ok(headerIds.includes('crit-testcase'));

    const legCand = res.data.candidates.find(c => c.candidateId === 'cand-legacy');
    assert.equal(legCand.criteriaScores['crit-legacy-special'], 4);
    assert.equal(legCand.criteriaScores['crit-testcase'], null);

    const cand1 = res.data.candidates.find(c => c.candidateId === 'cand-1');
    assert.equal(cand1.criteriaScores['crit-legacy-special'], null);
    assert.equal(cand1.criteriaScores['crit-testcase'], 5);
  });

  await testCase('TC08: Authorization - Hiring Manager with requisition in scope can view; out of scope rejected with 403', async () => {
    const authorizedRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, hmActor);
    assert.equal(authorizedRes.success, true);

    const forbiddenRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, otherHmActor);
    assert.equal(forbiddenRes.code, 'FORBIDDEN');
    assert.equal(forbiddenRes.statusCode, 403);
  });

  await testCase('TC09: Authorization - Pure interviewer role without requisition scope rejected with 403', async () => {
    const ivRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, interviewerActor);
    assert.equal(ivRes.code, 'FORBIDDEN');
    assert.equal(ivRes.statusCode, 403);
  });

  await testCase('TC10: Authorization - Recruiter assigned can view; unassigned recruiter rejected with 403', async () => {
    const assignedRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, recActor);
    assert.equal(assignedRes.success, true);

    const unassignedRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, unassignedRecActor);
    assert.equal(unassignedRes.code, 'FORBIDDEN');
    assert.equal(unassignedRes.statusCode, 403);

    const adminRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, adminActor);
    assert.equal(adminRes.success, true);

    const hrRes = await evalService.compareCandidateEvaluations('req-qa-01', {}, hrActor);
    assert.equal(hrRes.success, true);
  });

  await testCase('TC11: Edge case - Non-existent requisition returns 404 REQUISITION_NOT_FOUND', async () => {
    const notFoundRes = await evalService.compareCandidateEvaluations('req-non-existent', {}, adminActor);
    assert.equal(notFoundRes.code, 'REQUISITION_NOT_FOUND');
    assert.equal(notFoundRes.statusCode, 404);
  });

  await testCase('TC12: Edge case - Requisition with no candidates returns empty list with 200', async () => {
    db.prepare("INSERT INTO requisitions (id, code, title, department_id, department_name, status) VALUES ('req-empty', 'REQ-EMPTY', 'Trống', 'dept-qa', 'QA', 'OPEN')").run();

    const emptyRes = await evalService.compareCandidateEvaluations('req-empty', {}, adminActor);
    assert.equal(emptyRes.success, true);
    assert.equal(emptyRes.data.totalCandidates, 0);
    assert.equal(emptyRes.data.candidates.length, 0);
    assert.equal(emptyRes.data.criteriaHeaders.length, 0);
  });

  await testCase('TC13: Full migration and verification on PGlite (PostgreSQL)', async () => {
    const pgDb = await createPgliteDb();
    try {
      await pgDb.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        CREATE TABLE departments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          manager_id TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        CREATE TABLE job_titles (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        CREATE TABLE requisitions (
          id TEXT PRIMARY KEY,
          code TEXT,
          title TEXT NOT NULL,
          department_id TEXT,
          department_name TEXT,
          job_title_id TEXT,
          recruiter_id TEXT,
          hiring_manager_id TEXT,
          created_by TEXT,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        CREATE TABLE requisition_recruiter_supports (
          id TEXT PRIMARY KEY,
          requisition_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE candidates (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone_number TEXT,
          requisition_id TEXT,
          stage TEXT NOT NULL DEFAULT 'INTERVIEW',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE interviews (
          id TEXT PRIMARY KEY,
          candidate_id TEXT NOT NULL,
          requisition_id TEXT,
          interviewer_id TEXT,
          round_name TEXT NOT NULL DEFAULT 'Vòng chuyên môn',
          scheduled_time TIMESTAMPTZ NOT NULL,
          location_or_link TEXT,
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE interview_evaluations (
          id TEXT PRIMARY KEY,
          interview_id TEXT NOT NULL,
          interviewer_id TEXT NOT NULL,
          template_name TEXT NOT NULL,
          snapshot_criteria TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          recommendation TEXT,
          general_notes TEXT,
          total_score REAL,
          submitted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE interview_evaluation_items (
          id TEXT PRIMARY KEY,
          evaluation_id TEXT NOT NULL,
          criterion_id TEXT NOT NULL,
          criterion_name TEXT NOT NULL,
          weight INTEGER NOT NULL,
          score INTEGER,
          comment TEXT,
          display_order INTEGER NOT NULL DEFAULT 0
        );
      `);

      await pgDb.prepare("INSERT INTO users VALUES ('pg-u1', 'u1@pg.com', 'PG Admin', 'ACTIVE')").run();
      await pgDb.prepare("INSERT INTO requisitions (id, code, title, status) VALUES ('pg-req', 'REQ-PG', 'PG Position', 'OPEN')").run();
      await pgDb.prepare("INSERT INTO candidates (id, full_name, email, requisition_id) VALUES ('pg-c1', 'PG Candidate 1', 'c1@pg.com', 'pg-req')").run();
      await pgDb.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('pg-int-1', 'pg-c1', 'pg-req', 'pg-u1', 'Vòng Cuối', '2026-11-20T10:00:00Z', 'COMPLETED')").run();
      await pgDb.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES ('pg-ev-1', 'pg-int-1', 'pg-u1', 'Standard', '[]', 'SUBMITTED', 'RECOMMENDED', 4.80, '2026-11-20T11:00:00Z')").run();
      await pgDb.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, display_order) VALUES ('pg-item-1', 'pg-ev-1', 'crit-pg-1', 'PG Tech', 50, 5, 1)").run();

      const pgService = new InterviewEvaluationService(pgDb);
      const pgActor = { id: 'pg-u1', roles: ['ADMIN'] };
      const pgRes = await pgService.compareCandidateEvaluations('pg-req', {}, pgActor);
      assert.equal(pgRes.success, true);
      assert.equal(pgRes.data.candidates.length, 1);
      assert.equal(pgRes.data.candidates[0].totalScore, 4.80);
      assert.equal(pgRes.data.candidates[0].criteriaScores['crit-pg-1'], 5);
      console.log('PGlite PostgreSQL candidate comparison verified successfully.');
    } finally {
      await pgDb.close();
    }
  });

  console.log('================================================================');
  console.log(`TOTAL: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);
  if (passedCount === totalCount) {
    console.log('ALL S6-09 TESTS PASSED!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
