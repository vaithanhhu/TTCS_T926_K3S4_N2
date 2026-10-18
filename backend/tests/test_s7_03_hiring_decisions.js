const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const HiringDecisionService = require('../src/services/hiringDecisionService');
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
    }
  };
  return db;
}

async function setupBaselineSchema(db) {
  if (db.provider === 'postgres') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        manager_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS competency_frameworks (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS competency_criteria (
        id TEXT PRIMARY KEY,
        framework_id TEXT NOT NULL REFERENCES competency_frameworks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        weight INTEGER NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS job_titles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        framework_id TEXT REFERENCES competency_frameworks(id),
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS recruitment_catalog_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS requisitions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        department_id TEXT REFERENCES departments(id),
        department_name TEXT NOT NULL,
        hiring_manager_id TEXT REFERENCES users(id),
        recruiter_id TEXT REFERENCES users(id),
        created_by TEXT REFERENCES users(id),
        job_title_id TEXT REFERENCES job_titles(id),
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'NEW',
        rejection_reason_id TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS candidate_status_history (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id),
        before_stage TEXT,
        after_stage TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        notes TEXT,
        rejection_reason_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT REFERENCES candidates(id),
        requisition_id TEXT REFERENCES requisitions(id),
        interviewer_id TEXT REFERENCES users(id),
        round_name TEXT NOT NULL,
        scheduled_time TIMESTAMPTZ NOT NULL,
        location_or_link TEXT,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        feedback TEXT,
        score INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS interview_evaluations (
        id TEXT PRIMARY KEY,
        interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
        interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_title_id TEXT,
        framework_id TEXT,
        template_name TEXT NOT NULL,
        snapshot_criteria TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        recommendation TEXT,
        general_notes TEXT,
        total_score REAL,
        submitted_at TIMESTAMPTZ,
        reopened_at TIMESTAMPTZ,
        reopened_by TEXT,
        reopen_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS interview_evaluation_items (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL REFERENCES interview_evaluations(id) ON DELETE CASCADE,
        criterion_id TEXT NOT NULL,
        criterion_name TEXT NOT NULL,
        weight INTEGER NOT NULL,
        score INTEGER,
        comment TEXT,
        display_order INTEGER NOT NULL DEFAULT 0
      );
    `);
    const s20 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/020_hiring_decisions_postgres.sql'), 'utf8');
    await db.exec(s20);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        manager_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS competency_frameworks (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS competency_criteria (
        id TEXT PRIMARY KEY,
        framework_id TEXT NOT NULL REFERENCES competency_frameworks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        weight INTEGER NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS job_titles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        framework_id TEXT REFERENCES competency_frameworks(id),
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS recruitment_catalog_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS requisitions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        department_id TEXT REFERENCES departments(id),
        department_name TEXT NOT NULL,
        hiring_manager_id TEXT REFERENCES users(id),
        recruiter_id TEXT REFERENCES users(id),
        created_by TEXT REFERENCES users(id),
        job_title_id TEXT REFERENCES job_titles(id),
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'NEW',
        rejection_reason_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS candidate_status_history (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id),
        before_stage TEXT,
        after_stage TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        notes TEXT,
        rejection_reason_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT REFERENCES candidates(id),
        requisition_id TEXT REFERENCES requisitions(id),
        interviewer_id TEXT REFERENCES users(id),
        round_name TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
        location_or_link TEXT,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        feedback TEXT,
        score INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS interview_evaluations (
        id TEXT PRIMARY KEY,
        interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
        interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_title_id TEXT,
        framework_id TEXT,
        template_name TEXT NOT NULL,
        snapshot_criteria TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        recommendation TEXT,
        general_notes TEXT,
        total_score REAL,
        submitted_at TEXT,
        reopened_at TEXT,
        reopened_by TEXT,
        reopen_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS interview_evaluation_items (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL REFERENCES interview_evaluations(id) ON DELETE CASCADE,
        criterion_id TEXT NOT NULL,
        criterion_name TEXT NOT NULL,
        weight INTEGER NOT NULL,
        score INTEGER,
        comment TEXT,
        display_order INTEGER NOT NULL DEFAULT 0
      );
    `);
    const s20 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/020_hiring_decisions_sqlite.sql'), 'utf8');
    db.exec(s20);
  }
}

async function seedTestData(db) {
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-admin', 'admin@company.com', 'Admin User');
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-hr', 'hr@company.com', 'HR Manager User');
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-hm-it', 'hm.it@company.com', 'Hiring Manager IT');
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-hm-hr', 'hm.hr@company.com', 'Hiring Manager HR');
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-rec', 'rec@company.com', 'Recruiter User');
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-iv1', 'iv1@company.com', 'Interviewer 1');
  await db.prepare("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)").run('u-iv2', 'iv2@company.com', 'Interviewer 2');

  await db.prepare("INSERT INTO departments (id, code, name, manager_id) VALUES (?, ?, ?, ?)").run('dept-it', 'IT', 'Information Technology', 'u-hm-it');
  await db.prepare("INSERT INTO departments (id, code, name, manager_id) VALUES (?, ?, ?, ?)").run('dept-hr', 'HR', 'Human Resources', 'u-hm-hr');

  await db.prepare("INSERT INTO recruitment_catalog_items (id, type, code, name, status) VALUES (?, ?, ?, ?, ?)").run('rej-tech', 'REJECTION_REASON', 'REJ-TECH', 'Không đạt chuyên môn', 'ACTIVE');
  await db.prepare("INSERT INTO recruitment_catalog_items (id, type, code, name, status) VALUES (?, ?, ?, ?, ?)").run('rej-culture', 'REJECTION_REASON', 'REJ-CULTURE', 'Không phù hợp văn hóa', 'ACTIVE');
  await db.prepare("INSERT INTO recruitment_catalog_items (id, type, code, name, status) VALUES (?, ?, ?, ?, ?)").run('rej-other', 'REJECTION_REASON', 'REJ-OTHER', 'Khác', 'ACTIVE');
  await db.prepare("INSERT INTO recruitment_catalog_items (id, type, code, name, status) VALUES (?, ?, ?, ?, ?)").run('rej-inactive', 'REJECTION_REASON', 'REJ-OLD', 'Lý do cũ ngừng áp dụng', 'INACTIVE');

  await db.prepare("INSERT INTO requisitions (id, code, title, department_id, department_name, hiring_manager_id, recruiter_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run('req-it-01', 'REQ-IT-01', 'Senior Backend Engineer', 'dept-it', 'Information Technology', 'u-hm-it', 'u-rec');
  await db.prepare("INSERT INTO requisitions (id, code, title, department_id, department_name, hiring_manager_id, recruiter_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run('req-hr-01', 'REQ-HR-01', 'HR Specialist', 'dept-hr', 'Human Resources', 'u-hm-hr', 'u-rec');

  await db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)")
    .run('cand-01', 'Nguyễn Văn A', 'nva@example.com', '0901234567', 'req-it-01', 'INTERVIEW');
  await db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)")
    .run('cand-no-eval', 'Trần Thị B', 'ttb@example.com', '0907654321', 'req-it-01', 'INTERVIEW');

  await db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run('int-01', 'cand-01', 'req-it-01', 'u-iv1', 'Vòng 1: Kỹ thuật', '2026-10-15 09:00:00', 'COMPLETED');
  await db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run('int-02', 'cand-01', 'req-it-01', 'u-iv2', 'Vòng 2: Văn hóa & Quản lý', '2026-10-16 14:00:00', 'COMPLETED');

  await db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, general_notes, total_score, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run('eval-01', 'int-01', 'u-iv1', 'Khung Kỹ thuật', '[]', 'SUBMITTED', 'RECOMMENDED', 'Ứng viên nắm vững kiến thức backend, xử lý vấn đề tốt.', 4.25, '2026-10-15 10:30:00');
  await db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, general_notes, total_score, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run('eval-02', 'int-02', 'u-iv2', 'Khung Văn hóa', '[]', 'SUBMITTED', 'RECOMMENDED', 'Giao tiếp rõ ràng, thái độ hợp tác và trách nhiệm cao.', 4.75, '2026-10-16 15:30:00');

  await db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('item-01', 'eval-01', 'crit-tech', 'Chuyên môn backend', 4, 4, 'Vững cơ sở dữ liệu và Node.js', 1);
  await db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('item-02', 'eval-01', 'crit-problem', 'Giải quyết vấn đề', 3, 5, 'Tư duy thuật toán tốt', 2);
  await db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('item-03', 'eval-02', 'crit-comm', 'Kỹ năng giao tiếp', 3, 5, 'Truyền đạt tự tin', 1);
  await db.prepare("INSERT INTO interview_evaluation_items (id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('item-04', 'eval-02', 'crit-problem', 'Giải quyết vấn đề', 3, 4, 'Bình tĩnh tìm nguyên nhân gốc rễ', 2);
}

async function runTestSuite(providerName, createDbFn) {
  console.log(`\n================ Running S7-03 Tests for ${providerName} ================`);
  const db = await createDbFn();
  await setupBaselineSchema(db);
  await seedTestData(db);

  const hiringService = new HiringDecisionService(db);
  const evaluationService = new InterviewEvaluationService(db);

  const actorAdmin = { id: 'u-admin', fullName: 'Admin User', roles: ['ADMIN'] };
  const actorHr = { id: 'u-hr', fullName: 'HR Manager User', roles: ['HR_MANAGER'] };
  const actorHmIt = { id: 'u-hm-it', fullName: 'Hiring Manager IT', roles: ['HIRING_MGR'] };
  const actorHmHr = { id: 'u-hm-hr', fullName: 'Hiring Manager HR', roles: ['HIRING_MGR'] };
  const actorInterviewer = { id: 'u-iv1', fullName: 'Interviewer 1', roles: ['INTERVIEWER'] };

  console.log('Test 1: AC-1 & AC-2 - Summary of all interview evaluations across rounds');
  {
    const res = await hiringService.getCandidateInterviewSummary('cand-01', actorHmIt);
    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);
    const data = res.data;

    assert.equal(data.candidate.id, 'cand-01');
    assert.equal(data.candidate.fullName, 'Nguyễn Văn A');
    assert.equal(data.requisition.code, 'REQ-IT-01');
    assert.equal(data.interviewRoundsCount, 2);
    assert.equal(data.submittedEvaluationsCount, 2);
    assert.equal(data.overallAverageScore, 4.5);
    assert.deepEqual(data.recommendationsSummary, { RECOMMENDED: 2, CONSIDER: 0, NOT_RECOMMENDED: 0 });

    assert.equal(data.criteriaSummary.length, 3);
    const problemCrit = data.criteriaSummary.find(c => c.criterionId === 'crit-problem');
    assert.ok(problemCrit);
    assert.equal(problemCrit.scoresCount, 2);
    assert.equal(problemCrit.averageScore, 4.5);

    const techCrit = data.criteriaSummary.find(c => c.criterionId === 'crit-tech');
    assert.ok(techCrit);
    assert.equal(techCrit.scoresCount, 1);
    assert.equal(techCrit.averageScore, 4);

    assert.equal(data.rounds.length, 2);
    assert.equal(data.rounds[0].evaluations.length, 1);
    assert.equal(data.rounds[0].evaluations[0].recommendation, 'RECOMMENDED');
    assert.ok(data.rounds[0].evaluations[0].generalNotes.includes('backend'));
  }

  console.log('Test 2: AC-6 - Making decision when 0 submitted evaluations fails with 400');
  {
    const res = await hiringService.recordHiringDecision('cand-no-eval', { decision: 'OFFER' }, actorHmIt);
    assert.equal(res.success, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'NO_SUBMITTED_EVALUATIONS');
  }

  console.log('Test 3: RBAC - Interviewer cannot make hiring decision (403)');
  {
    const res = await hiringService.recordHiringDecision('cand-01', { decision: 'OFFER' }, actorInterviewer);
    assert.equal(res.success, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.code, 'FORBIDDEN');
  }

  console.log('Test 4: RBAC - Hiring Manager outside requisition scope is rejected (403)');
  {
    const res = await hiringService.recordHiringDecision('cand-01', { decision: 'OFFER' }, actorHmHr);
    assert.equal(res.success, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.code, 'DECISION_ACCESS_DENIED');
  }

  console.log('Test 5: AC-4 - Rejecting candidate requires rejection reason from catalog');
  {
    const resMissingReason = await hiringService.recordHiringDecision('cand-01', { decision: 'REJECT' }, actorHmIt);
    assert.equal(resMissingReason.success, false);
    assert.equal(resMissingReason.statusCode, 400);
    assert.equal(resMissingReason.code, 'REJECTION_REASON_REQUIRED');

    const resInactive = await hiringService.recordHiringDecision('cand-01', { decision: 'REJECT', rejectionReasonId: 'rej-inactive' }, actorHmIt);
    assert.equal(resInactive.success, false);
    assert.equal(resInactive.statusCode, 400);
    assert.equal(resInactive.code, 'INVALID_REJECTION_REASON');

    const resOtherWithoutNotes = await hiringService.recordHiringDecision('cand-01', { decision: 'REJECT', rejectionReasonId: 'rej-other' }, actorHmIt);
    assert.equal(resOtherWithoutNotes.success, false);
    assert.equal(resOtherWithoutNotes.statusCode, 400);
    assert.equal(resOtherWithoutNotes.code, 'REJECTION_EXPLANATION_REQUIRED');
  }

  console.log('Test 6: AC-4 & AC-5 - Record decision PROCEED_TO_OFFER -> candidate stage becomes OFFER and audit logged');
  {
    const res = await hiringService.recordHiringDecision('cand-01', {
      decision: 'OFFER',
      notes: 'Ứng viên xuất sắc cả 2 vòng. Đồng ý đề xuất mức lương Senior.'
    }, actorHmIt);

    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.stage, 'OFFER');
    assert.equal(res.data.decision, 'OFFER');

    const candInDb = await db.prepare("SELECT stage FROM candidates WHERE id = 'cand-01'").get();
    assert.equal(candInDb.stage, 'OFFER');

    const auditHistory = await db.prepare("SELECT * FROM candidate_status_history WHERE candidate_id = 'cand-01' AND after_stage = 'OFFER'").get();
    assert.ok(auditHistory);
    assert.equal(auditHistory.action, 'HIRING_DECISION_OFFER');
    assert.equal(auditHistory.actor_id, actorHmIt.id);

    const decisionRecord = await db.prepare("SELECT * FROM hiring_decisions WHERE candidate_id = 'cand-01' AND decision = 'OFFER'").get();
    assert.ok(decisionRecord);
    assert.equal(decisionRecord.decided_by, actorHmIt.id);
    assert.ok(decisionRecord.notes.includes('xuất sắc'));
  }

  console.log('Test 7: AC-4 & AC-5 - Record decision REJECT -> candidate stage becomes REJECTED and audit logged');
  {
    await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)")
      .run('cand-reject-test', 'Lê Văn C', 'lvc@example.com', 'req-it-01', 'INTERVIEW');
    await db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run('int-03', 'cand-reject-test', 'req-it-01', 'u-iv1', 'Vòng Chuyên môn', '2026-10-17 09:00:00', 'COMPLETED');
    await db.prepare("INSERT INTO interview_evaluations (id, interview_id, interviewer_id, template_name, snapshot_criteria, status, recommendation, total_score, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('eval-03', 'int-03', 'u-iv1', 'Tiêu chuẩn', '[]', 'SUBMITTED', 'NOT_RECOMMENDED', 2.0, '2026-10-17 10:00:00');

    const res = await hiringService.recordHiringDecision('cand-reject-test', {
      decision: 'REJECT',
      rejectionReasonId: 'rej-tech',
      notes: 'Chưa đáp ứng yêu cầu kiến trúc hệ thống phân tán.'
    }, actorHmIt);

    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.stage, 'REJECTED');

    const candInDb = await db.prepare("SELECT stage, rejection_reason_id FROM candidates WHERE id = 'cand-reject-test'").get();
    assert.equal(candInDb.stage, 'REJECTED');
    assert.equal(candInDb.rejection_reason_id, 'rej-tech');

    const auditHistory = await db.prepare("SELECT * FROM candidate_status_history WHERE candidate_id = 'cand-reject-test' AND after_stage = 'REJECTED'").get();
    assert.ok(auditHistory);
    assert.equal(auditHistory.action, 'HIRING_DECISION_REJECT');
    assert.equal(auditHistory.rejection_reason_id, 'rej-tech');
  }

  console.log('Test 8: Interview consensus methods on InterviewEvaluationService');
  {
    const summaryViaEvalService = await evaluationService.getCandidateInterviewSummary('cand-01', actorAdmin);
    assert.equal(summaryViaEvalService.success, true);
    assert.equal(summaryViaEvalService.data.decisions.length, 1);

    const intConsensus = await evaluationService.getInterviewConsensus('int-01', actorHmIt);
    assert.equal(intConsensus.success, true);
    assert.equal(intConsensus.data.interviewId, 'int-01');
    assert.equal(intConsensus.data.submittedCount, 1);
  }

  console.log(`ALL S7-03 tests PASS for ${providerName}!`);
}

async function main() {
  await runTestSuite('SQLite', createSqliteDb);
  await runTestSuite('PGlite (Postgres)', createPgliteDb);
  console.log('\n=== ALL S7-03 TEST SUITES COMPLETED SUCCESSFULLY ===');
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
