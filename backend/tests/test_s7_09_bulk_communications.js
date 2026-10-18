const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');

const migrateOfferApprovals = require('../src/db/migrate-offer-approvals');
const migrateOfferDelivery = require('../src/db/migrate-offer-delivery');
const migrateOfferNegotiation = require('../src/db/migrate-offer-negotiation');
const migrateOnboardingChecklists = require('../src/db/migrate-onboarding-checklists');
const migrateBulkCommunications = require('../src/db/migrate-bulk-candidate-communications');
const { CandidateCommunicationService } = require('../src/services/candidateCommunicationService');
const RequisitionService = require('../src/services/requisitionService');
const RbacMiddleware = require('../src/middlewares/rbacMiddleware');

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
    while (inTx) await new Promise(r => setTimeout(r, 5));
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
          let i = 1;
          const pgSql = sql.replace(/\?/g, () => `$${i++}`);
          const res = await pg.query(pgSql, params);
          return { changes: res.affectedRows || 0 };
        },
        get: async (...params) => {
          let i = 1;
          const pgSql = sql.replace(/\?/g, () => `$${i++}`);
          const res = await pg.query(pgSql, params);
          return res.rows[0];
        },
        all: async (...params) => {
          let i = 1;
          const pgSql = sql.replace(/\?/g, () => `$${i++}`);
          const res = await pg.query(pgSql, params);
          return res.rows;
        }
      };
    },
    async transaction(fn) {
      while (inTx) await new Promise(r => setTimeout(r, 5));
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

async function setupBaselineSchema(db) {
  if (db.provider === 'postgres') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        locked_until TIMESTAMPTZ,
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE
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
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        manager_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS job_titles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        min_salary NUMERIC,
        max_salary NUMERIC,
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
        proposed_salary_min NUMERIC,
        proposed_salary_max NUMERIC,
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'APPLIED',
        notes TEXT,
        rejection_reason_id TEXT
      );
      CREATE TABLE IF NOT EXISTS candidate_status_history (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        before_stage TEXT NOT NULL,
        after_stage TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        notes TEXT,
        rejection_reason_id TEXT,
        skipped_interview_approved_by TEXT,
        skipped_interview_approved_name TEXT,
        skipped_interview_approved_at TIMESTAMPTZ,
        exception_request_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS offers (
        id TEXT PRIMARY KEY,
        candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
        job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL,
        salary_monthly NUMERIC NOT NULL,
        allowances NUMERIC DEFAULT 0,
        start_date DATE NOT NULL,
        expiration_date DATE,
        salary_justification TEXT,
        offer_letter TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
        approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_active_candidate ON offers(candidate_id) WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT');
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        template_name TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const s21 = require('../src/db/migrate-offer-proposals').source(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(s21.checksum);
    await migrateOfferApprovals.migrate(db);
    await migrateOfferDelivery.migrate(db);
    await migrateOfferNegotiation.migrate(db);
    await migrateOnboardingChecklists.migrate(db);
    await migrateBulkCommunications.migrate(db);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        locked_until TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 0
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
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        manager_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS job_titles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        min_salary INTEGER,
        max_salary INTEGER,
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
        proposed_salary_min INTEGER,
        proposed_salary_max INTEGER,
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'APPLIED',
        notes TEXT,
        rejection_reason_id TEXT
      );
      CREATE TABLE IF NOT EXISTS candidate_status_history (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        before_stage TEXT NOT NULL,
        after_stage TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        notes TEXT,
        rejection_reason_id TEXT,
        skipped_interview_approved_by TEXT,
        skipped_interview_approved_name TEXT,
        skipped_interview_approved_at TEXT,
        exception_request_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS offers (
        id TEXT PRIMARY KEY,
        candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
        job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL,
        salary_monthly INTEGER NOT NULL,
        allowances INTEGER DEFAULT 0,
        start_date TEXT NOT NULL,
        expiration_date TEXT,
        salary_justification TEXT,
        offer_letter TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
        approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_active_candidate ON offers(candidate_id) WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT');
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        template_name TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const s21 = require('../src/db/migrate-offer-proposals').source(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(s21.checksum);
    await migrateOfferApprovals.migrate(db);
    await migrateOfferDelivery.migrate(db);
    await migrateOfferNegotiation.migrate(db);
    await migrateOnboardingChecklists.migrate(db);
    await migrateBulkCommunications.migrate(db);
  }

  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('role-admin', 'ADMIN', 'Quản trị viên');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('role-hr', 'HR_MANAGER', 'Trưởng phòng Nhân sự');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('role-recruiter', 'RECRUITER', 'Chuyên viên tuyển dụng');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('role-candidate', 'CANDIDATE', 'Ứng viên');

  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('perm-cand-read', 'candidate.read', 'Xem hồ sơ ứng viên');
  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('perm-cand-update', 'candidate.update', 'Cập nhật hồ sơ');

  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('role-admin', 'perm-cand-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('role-admin', 'perm-cand-update');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('role-hr', 'perm-cand-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('role-hr', 'perm-cand-update');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('role-recruiter', 'perm-cand-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('role-recruiter', 'perm-cand-update');

  await db.prepare('INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, ?)').run('usr-admin', 'admin@ats.local', 'Hệ thống Quản trị', 'ACTIVE');
  await db.prepare('INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, ?)').run('usr-hr', 'hr.lead@ats.local', 'Trần Thị Nhân Sự', 'ACTIVE');
  await db.prepare('INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, ?)').run('usr-recruiter-1', 'recruiter1@ats.local', 'Lê Tuyển Dụng', 'ACTIVE');
  await db.prepare('INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, ?)').run('usr-recruiter-2', 'recruiter2@ats.local', 'Phạm Tuyển Dụng 2', 'ACTIVE');
  await db.prepare('INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, ?)').run('usr-candidate', 'cand.user@test.local', 'Người Ứng Tuyển', 'ACTIVE');

  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('usr-admin', 'role-admin');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('usr-hr', 'role-hr');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('usr-recruiter-1', 'role-recruiter');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('usr-recruiter-2', 'role-recruiter');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('usr-candidate', 'role-candidate');

  await db.prepare('INSERT INTO departments (id, code, name, status) VALUES (?, ?, ?, ?)').run('dept-eng', 'ENG', 'Kỹ thuật Công nghệ', 'ACTIVE');
  await db.prepare('INSERT INTO departments (id, code, name, status) VALUES (?, ?, ?, ?)').run('dept-sales', 'SALES', 'Kinh doanh & Bán hàng', 'ACTIVE');

  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('req-backend', 'REQ-BE-01', 'Senior Backend Engineer', 'dept-eng', 'Kỹ thuật Công nghệ', 'usr-recruiter-1', 'OPEN');
  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('req-frontend', 'REQ-FE-01', 'Frontend Developer', 'dept-eng', 'Kỹ thuật Công nghệ', 'usr-recruiter-1', 'OPEN');
  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('req-sales', 'REQ-SA-01', 'Sales Executive', 'dept-sales', 'Kinh doanh & Bán hàng', 'usr-recruiter-2', 'OPEN');
}

async function runTestSuite(dbName, createDbFn) {
  console.log(`\n======================================================`);
  console.log(`RUNNING S7-09 TEST SUITE ON: ${dbName.toUpperCase()}`);
  console.log(`======================================================`);

  const db = await createDbFn();
  await setupBaselineSchema(db);

  const commService = new CandidateCommunicationService(db);
  const reqService = new RequisitionService(db);

  const actorAdmin = { id: 'usr-admin' };
  const actorHr = { id: 'usr-hr' };
  const actorRecruiter1 = { id: 'usr-recruiter-1' };
  const actorRecruiter2 = { id: 'usr-recruiter-2' };
  const actorCandidate = { id: 'usr-candidate' };

  console.log('\n[TEST 1] Migration verification & default seeded templates');
  await migrateBulkCommunications.verify(db);
  const tmplRes = await commService.getTemplates(actorRecruiter1);
  assert.equal(tmplRes.success, true);
  assert.equal(tmplRes.statusCode, 200);
  assert.equal(tmplRes.data.length >= 2, true);
  const thankYouTmpl = tmplRes.data.find(t => t.type === 'THANK_YOU');
  const rejectionTmpl = tmplRes.data.find(t => t.type === 'REJECTION');
  assert.ok(thankYouTmpl, 'Default thank you template must exist');
  assert.ok(rejectionTmpl, 'Default rejection template must exist');
  assert.equal(thankYouTmpl.isDefault, true);
  assert.equal(rejectionTmpl.isDefault, true);
  console.log(' -> PASS: Templates seeded and loaded successfully.');

  console.log('\n[TEST 2] Input validation on preview and send');
  const invalidTypeRes = await commService.previewBulk({ candidateIds: ['c1'], type: 'UNKNOWN' }, actorRecruiter1);
  assert.equal(invalidTypeRes.success, false);
  assert.equal(invalidTypeRes.code, 'INVALID_COMMUNICATION_TYPE');

  const emptyListRes = await commService.previewBulk({ candidateIds: [], type: 'THANK_YOU' }, actorRecruiter1);
  assert.equal(emptyListRes.success, false);
  assert.equal(emptyListRes.code, 'CANDIDATES_LIST_INVALID');

  const dupListRes = await commService.previewBulk({ candidateIds: ['c1', 'c1'], type: 'THANK_YOU' }, actorRecruiter1);
  assert.equal(dupListRes.success, false);
  assert.equal(dupListRes.code, 'CANDIDATES_LIST_INVALID');
  console.log(' -> PASS: Invalid input formats rejected.');

  console.log('\n[TEST 3] Stage consistency check (AC1: all candidates must share identical stage)');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-stage-1', 'Candidate Stage 1', 'stage1@test.local', 'req-backend', 'APPLIED');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-stage-2', 'Candidate Stage 2', 'stage2@test.local', 'req-backend', 'INTERVIEW');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-stage-3', 'Candidate Stage 3', 'stage3@test.local', 'req-backend', 'APPLIED');

  const mixedPreviewRes = await commService.previewBulk({
    candidateIds: ['cand-stage-1', 'cand-stage-2'],
    type: 'THANK_YOU'
  }, actorRecruiter1);
  assert.equal(mixedPreviewRes.success, false);
  assert.equal(mixedPreviewRes.statusCode, 400);
  assert.equal(mixedPreviewRes.code, 'CANDIDATES_STAGE_MISMATCH');

  const mixedSendRes = await commService.sendBulk({
    candidateIds: ['cand-stage-1', 'cand-stage-2'],
    type: 'THANK_YOU'
  }, actorRecruiter1);
  assert.equal(mixedSendRes.success, false);
  assert.equal(mixedSendRes.statusCode, 400);
  assert.equal(mixedSendRes.code, 'CANDIDATES_STAGE_MISMATCH');

  const sameStagePreviewRes = await commService.previewBulk({
    candidateIds: ['cand-stage-1', 'cand-stage-3'],
    type: 'THANK_YOU'
  }, actorRecruiter1);
  assert.equal(sameStagePreviewRes.success, true);
  assert.equal(sameStagePreviewRes.statusCode, 200);
  assert.equal(sameStagePreviewRes.stage, 'APPLIED');
  console.log(' -> PASS: Stage mismatch rejected with CANDIDATES_STAGE_MISMATCH; matching stages accepted.');

  console.log('\n[TEST 4] Stage eligibility check for Rejection (Cannot reject HIRED / ONBOARDED)');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-hired', 'Candidate Hired', 'hired@test.local', 'req-backend', 'HIRED');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-onboarded', 'Candidate Onboarded', 'onboarded@test.local', 'req-backend', 'ONBOARDED');

  const rejectHiredRes = await commService.previewBulk({ candidateIds: ['cand-hired'], type: 'REJECTION' }, actorRecruiter1);
  assert.equal(rejectHiredRes.success, false);
  assert.equal(rejectHiredRes.statusCode, 400);
  assert.equal(rejectHiredRes.code, 'CANNOT_REJECT_HIRED_CANDIDATE');

  const rejectOnboardedRes = await commService.sendBulk({ candidateIds: ['cand-onboarded'], type: 'REJECTION' }, actorRecruiter1);
  assert.equal(rejectOnboardedRes.success, false);
  assert.equal(rejectOnboardedRes.statusCode, 400);
  assert.equal(rejectOnboardedRes.code, 'CANNOT_REJECT_HIRED_CANDIDATE');

  const thankYouHiredRes = await commService.previewBulk({ candidateIds: ['cand-hired'], type: 'THANK_YOU' }, actorRecruiter1);
  assert.equal(thankYouHiredRes.success, true);
  console.log(' -> PASS: Rejection of HIRED/ONBOARDED candidates forbidden; thank you permitted.');

  console.log('\n[TEST 5] Real data preview rendering without cross-candidate data leakage (AC2)');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-alpha', 'Nguyễn Văn Alpha', 'alpha@corp.vn', 'req-backend', 'APPLIED');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-beta', 'Trần Thị Beta', 'beta@corp.vn', 'req-frontend', 'APPLIED');

  const previewRes = await commService.previewBulk({
    candidateIds: ['cand-alpha', 'cand-beta'],
    type: 'THANK_YOU'
  }, actorRecruiter1);

  assert.equal(previewRes.success, true);
  assert.equal(previewRes.previews.length, 2);

  const prevAlpha = previewRes.previews.find(p => p.candidateId === 'cand-alpha');
  const prevBeta = previewRes.previews.find(p => p.candidateId === 'cand-beta');

  assert.ok(prevAlpha.bodyHtml.includes('Nguyễn Văn Alpha'));
  assert.ok(prevAlpha.bodyHtml.includes('Senior Backend Engineer'));
  assert.equal(prevAlpha.bodyHtml.includes('Trần Thị Beta'), false);
  assert.equal(prevAlpha.bodyHtml.includes('Frontend Developer'), false);

  assert.ok(prevBeta.bodyHtml.includes('Trần Thị Beta'));
  assert.ok(prevBeta.bodyHtml.includes('Frontend Developer'));
  assert.equal(prevBeta.bodyHtml.includes('Nguyễn Văn Alpha'), false);
  assert.equal(prevBeta.bodyHtml.includes('Senior Backend Engineer'), false);
  console.log(' -> PASS: Real personalized preview rendered; strict isolation confirmed.');

  console.log('\n[TEST 6] Bulk send execution for Thank You letters');
  const sendThankYouRes = await commService.sendBulk({
    candidateIds: ['cand-alpha', 'cand-beta'],
    type: 'THANK_YOU'
  }, actorRecruiter1);

  assert.equal(sendThankYouRes.success, true);
  assert.equal(sendThankYouRes.total, 2);
  assert.equal(sendThankYouRes.sentCount, 2);
  assert.equal(sendThankYouRes.failedCount, 0);
  assert.equal(sendThankYouRes.skippedCount, 0);

  const records = await db.prepare("SELECT * FROM candidate_communications WHERE batch_id = ?").all(sendThankYouRes.batchId);
  assert.equal(records.length, 2);
  assert.ok(['SENT_LOCAL', 'DELIVERED'].includes(records[0].status));
  assert.ok(['SENT_LOCAL', 'DELIVERED'].includes(records[1].status));
  console.log(' -> PASS: Bulk thank you communications delivered and logged.');

  console.log('\n[TEST 7] Duplicate rejection prevention (AC3)');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-rej-1', 'Đỗ Từ Chối 1', 'rej1@test.local', 'req-backend', 'REJECTED');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-rej-2', 'Vũ Từ Chối 2', 'rej2@test.local', 'req-backend', 'REJECTED');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-rej-3', 'Hoàng Từ Chối 3', 'rej3@test.local', 'req-backend', 'REJECTED');

  const firstBatchRes = await commService.sendBulk({
    candidateIds: ['cand-rej-1', 'cand-rej-2'],
    type: 'REJECTION'
  }, actorRecruiter1);

  assert.equal(firstBatchRes.success, true);
  assert.equal(firstBatchRes.sentCount, 2);
  assert.equal(firstBatchRes.skippedCount, 0);

  const previewRejRes = await commService.previewBulk({
    candidateIds: ['cand-rej-1', 'cand-rej-3'],
    type: 'REJECTION'
  }, actorRecruiter1);

  assert.equal(previewRejRes.success, true);
  const p1 = previewRejRes.previews.find(p => p.candidateId === 'cand-rej-1');
  const p3 = previewRejRes.previews.find(p => p.candidateId === 'cand-rej-3');
  assert.equal(p1.alreadyReceivedRejection, true);
  assert.equal(p1.canSend, false);
  assert.equal(p3.alreadyReceivedRejection, false);
  assert.equal(p3.canSend, true);

  const secondBatchRes = await commService.sendBulk({
    candidateIds: ['cand-rej-1', 'cand-rej-3'],
    type: 'REJECTION'
  }, actorRecruiter1);

  assert.equal(secondBatchRes.success, true);
  assert.equal(secondBatchRes.total, 2);
  assert.equal(secondBatchRes.sentCount, 1);
  assert.equal(secondBatchRes.skippedCount, 1);
  const skippedItem = secondBatchRes.results.find(r => r.candidateId === 'cand-rej-1');
  assert.equal(skippedItem.status, 'SKIPPED_DUPLICATE');
  assert.equal(skippedItem.reason, 'REJECTION_ALREADY_SENT');
  const sentItem = secondBatchRes.results.find(r => r.candidateId === 'cand-rej-3');
  assert.ok(['SENT_LOCAL', 'DELIVERED'].includes(sentItem.status));

  let dbConstraintViolated = false;
  try {
    const dummyCommId = 'comm-dup-' + crypto.randomUUID();
    const query = db.provider === 'postgres'
      ? "INSERT INTO candidate_communications (id, candidate_id, requisition_id, type, recipient_email, recipient_name, subject, body_html, status, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SENT_LOCAL', CURRENT_TIMESTAMP)"
      : "INSERT INTO candidate_communications (id, candidate_id, requisition_id, type, recipient_email, recipient_name, subject, body_html, status, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SENT_LOCAL', datetime('now'))";
    await db.prepare(query).run(dummyCommId, 'cand-rej-1', 'req-backend', 'REJECTION', 'rej1@test.local', 'Đỗ Từ Chối 1', 'Subj', 'Body');
  } catch (err) {
    dbConstraintViolated = true;
  }
  assert.equal(dbConstraintViolated, true, 'Database partial unique index must forbid duplicate delivered rejection');
  console.log(' -> PASS: Duplicate rejection prevention verified at service and database level.');

  console.log('\n[TEST 8] Error resilience (Single candidate failure does not block batch)');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-err-1', 'Candidate Ok 1', 'ok1@test.local', 'req-backend', 'SCREENING');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-err-2', 'Candidate Fail', 'fail@test.local', 'req-backend', 'SCREENING');
  await db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)").run('cand-err-3', 'Candidate Ok 2', 'ok2@test.local', 'req-backend', 'SCREENING');

  const originalSendMail = commService.emailService.sendMail.bind(commService.emailService);
  commService.emailService.sendMail = async (options) => {
    if (options.to === 'fail@test.local') {
      return { success: false, error: 'SIMULATED_TRANSPORTER_FAILURE', delivered: false, simulated: false };
    }
    return originalSendMail(options);
  };

  const batchErrorRes = await commService.sendBulk({
    candidateIds: ['cand-err-1', 'cand-err-2', 'cand-err-3'],
    type: 'THANK_YOU'
  }, actorRecruiter1);

  commService.emailService.sendMail = originalSendMail;

  assert.equal(batchErrorRes.success, true);
  assert.equal(batchErrorRes.total, 3);
  assert.equal(batchErrorRes.sentCount, 2);
  assert.equal(batchErrorRes.failedCount, 1);
  assert.equal(batchErrorRes.skippedCount, 0);

  const failResult = batchErrorRes.results.find(r => r.candidateId === 'cand-err-2');
  assert.equal(failResult.status, 'FAILED');
  assert.equal(failResult.error, 'SIMULATED_TRANSPORTER_FAILURE');

  const pass1 = batchErrorRes.results.find(r => r.candidateId === 'cand-err-1');
  const pass2 = batchErrorRes.results.find(r => r.candidateId === 'cand-err-3');
  assert.ok(['SENT_LOCAL', 'DELIVERED'].includes(pass1.status));
  assert.ok(['SENT_LOCAL', 'DELIVERED'].includes(pass2.status));

  const dbFailRecord = await db.prepare("SELECT status, error_message FROM candidate_communications WHERE candidate_id = ?").get('cand-err-2');
  assert.equal(dbFailRecord.status, 'FAILED');
  assert.equal(dbFailRecord.error_message, 'SIMULATED_TRANSPORTER_FAILURE');
  console.log(' -> PASS: Individual recipient failure recorded properly without breaking batch.');

  console.log('\n[TEST 9] RBAC & Authorization scope');
  let candAccessForbidden = false;
  try {
    await commService.previewBulk({ candidateIds: ['cand-alpha'], type: 'THANK_YOU' }, actorCandidate);
  } catch (err) {
    candAccessForbidden = (err.statusCode === 403);
  }
  assert.equal(candAccessForbidden, true, 'Non-recruiter role must be forbidden (403)');

  const outOfScopeRes = await commService.previewBulk({
    candidateIds: ['cand-alpha'],
    type: 'THANK_YOU'
  }, actorRecruiter2);
  assert.equal(outOfScopeRes.success, false);
  assert.equal(outOfScopeRes.statusCode, 403);
  assert.equal(outOfScopeRes.code, 'CANDIDATE_OUT_OF_SCOPE');

  const adminScopeRes = await commService.previewBulk({
    candidateIds: ['cand-alpha'],
    type: 'THANK_YOU'
  }, actorAdmin);
  assert.equal(adminScopeRes.success, true);
  console.log(' -> PASS: Candidate role blocked (403); recruiter out-of-scope blocked; admin permitted.');

  console.log('\n[TEST 10] Communications history & RequisitionService delegation');
  const historyRes = await reqService.getCommunicationsHistory({ type: 'THANK_YOU' }, actorAdmin);
  assert.equal(historyRes.success, true);
  assert.equal(historyRes.data.length >= 2, true);

  const candHistoryRes = await reqService.getCommunicationsHistory({ candidateId: 'cand-alpha' }, actorAdmin);
  assert.equal(candHistoryRes.success, true);
  assert.equal(candHistoryRes.data.length >= 1, true);
  assert.equal(candHistoryRes.data[0].candidateId, 'cand-alpha');
  console.log(' -> PASS: RequisitionService delegation and communication history verified.');

  if (typeof db.close === 'function') await db.close();
  console.log(`\nALL TESTS PASSED ON: ${dbName.toUpperCase()}`);
}

async function run() {
  await runTestSuite('sqlite', createSqliteDb);
  await runTestSuite('pglite (postgres)', createPgliteDb);
  console.log('\n======================================================');
  console.log('S7-09 DUAL-DATABASE VERIFICATION COMPLETE: 100% PASS');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
