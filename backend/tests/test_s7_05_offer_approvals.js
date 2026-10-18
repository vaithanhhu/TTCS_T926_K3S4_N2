const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const OfferService = require('../src/services/offerService');
const migrateOfferApprovals = require('../src/db/migrate-offer-approvals');

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
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'INTERVIEW',
        notes TEXT,
        rejection_reason_id TEXT
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
      CREATE INDEX IF NOT EXISTS idx_offers_job_title ON offers(job_title_id);
    `);
    const s21 = require('../src/db/migrate-offer-proposals').source(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(s21.checksum);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        locked_until TEXT,
        must_change_password BOOLEAN NOT NULL DEFAULT 0
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
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'INTERVIEW',
        notes TEXT,
        rejection_reason_id TEXT
      );
      CREATE TABLE IF NOT EXISTS offers (
        id TEXT PRIMARY KEY,
        candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
        requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
        job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL,
        salary_monthly INTEGER NOT NULL,
        allowances NUMERIC DEFAULT 0,
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
      CREATE INDEX IF NOT EXISTS idx_offers_job_title ON offers(job_title_id);
    `);
    const s21 = require('../src/db/migrate-offer-proposals').source(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(s21.checksum);
  }
}

async function seedData(db) {
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-recruiter', 'recruiter@example.com', 'Nguyễn Thị Tuyển Dụng');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-hr-mgr', 'hrmanager@example.com', 'Trần Thị Trưởng Phòng HR');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-admin', 'admin@example.com', 'Admin Giám Đốc');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-interviewer', 'interviewer@example.com', 'Ngô Văn Phỏng Vấn');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-candidate', 'cand.user@example.com', 'Ứng Viên Nguyễn');

  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-rec', 'RECRUITER', 'Nhân viên tuyển dụng');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-hr', 'HR_MANAGER', 'Trưởng phòng nhân sự');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-adm', 'ADMIN', 'Quản trị hệ thống');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-int', 'INTERVIEWER', 'Người phỏng vấn');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-can', 'CANDIDATE', 'Ứng viên');

  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-recruiter', 'r-rec');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-hr-mgr', 'r-hr');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-admin', 'r-adm');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-interviewer', 'r-int');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-candidate', 'r-can');

  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-read', 'offer.read', 'Xem offer');
  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-create', 'offer.create', 'Soạn offer');
  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-app', 'offer.approve', 'Duyệt offer');

  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-rec', 'p-off-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-rec', 'p-off-create');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-hr', 'p-off-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-hr', 'p-off-create');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-hr', 'p-off-app');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-adm', 'p-off-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-adm', 'p-off-create');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-adm', 'p-off-app');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-can', 'p-off-read');

  await db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('d-eng', 'ENG', 'Phòng Công Nghệ');

  await db.prepare('INSERT INTO job_titles (id, code, name, min_salary, max_salary) VALUES (?, ?, ?, ?, ?)').run(
    'jt-backend', 'BE-SR', 'Senior Backend Engineer', 20000000, 30000000
  );

  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, job_title_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'req-01', 'REQ-01', 'Tuyển Senior Backend', 'd-eng', 'Phòng Công Nghệ', 'u-recruiter', 'jt-backend'
  );

  for (let i = 1; i <= 10; i++) {
    const pad = String(i).padStart(2, '0');
    await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      `cand-${pad}`, `Ứng viên ${pad}`, `cand${pad}@example.com`, `09010000${pad}`, 'req-01', 'INTERVIEW'
    );
  }
}

function createMockReqService(db) {
  return {
    async candidateAccess() {
      return { success: true };
    },
    async recruiterAssigned() {
      return true;
    },
    hiringRequisitionScope() {
      return '1=1';
    },
    recruiterScope() {
      return { condition: '1=1', params: [] };
    }
  };
}

async function runTestSuite(dbProviderName, createDbFn) {
  console.log(`\n=== Running S7-05 Offer Approval Tests on [${dbProviderName}] ===`);

  const db = await createDbFn();
  await setupBaselineSchema(db);
  await seedData(db);

  await migrateOfferApprovals.migrate(db);
  await migrateOfferApprovals.verify(db);
  console.log(`[${dbProviderName}] Migration 022 executed and verified successfully.`);

  const mockReqService = createMockReqService(db);
  const offerService = new OfferService(db, mockReqService);

  const actorRecruiter = { id: 'u-recruiter', roles: ['RECRUITER'], email: 'recruiter@example.com' };
  const actorHrMgr = { id: 'u-hr-mgr', roles: ['HR_MANAGER'], email: 'hrmanager@example.com' };
  const actorAdmin = { id: 'u-admin', roles: ['ADMIN'], email: 'admin@example.com' };
  const actorInterviewer = { id: 'u-interviewer', roles: ['INTERVIEWER'], email: 'interviewer@example.com' };

  {
    const created = await offerService.createOffer({
      candidateId: 'cand-01',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 25000000,
      startDate: '2027-02-01'
    }, actorRecruiter);

    assert.equal(created.success, true);
    assert.equal(created.data.isOutOfBand, false);
    assert.equal(created.data.currentApprovalLevel, 1);
    assert.equal(created.data.requiredApprovalLevels, 1);
    assert.equal(created.data.status, 'PENDING_APPROVAL');

    const unauthorized = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Tôi muốn duyệt'
    }, actorInterviewer);
    assert.equal(unauthorized.success, false);
    assert.equal(unauthorized.statusCode, 403);

    const approved = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Mức lương phù hợp dải chuẩn.'
    }, actorHrMgr);

    assert.equal(approved.success, true);
    assert.equal(approved.data.status, 'APPROVED');

    const offerRow = await db.prepare('SELECT status, current_approval_level, required_approval_levels FROM offers WHERE id = ?').get(created.data.id);
    assert.equal(offerRow.status, 'APPROVED');

    const candidateRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
    assert.equal(candidateRow.stage, 'HIRED');

    const historyRes = await offerService.getOfferApprovals(created.data.id, actorHrMgr);
    assert.equal(historyRes.success, true);
    assert.equal(historyRes.data.length, 1);
    assert.equal(historyRes.data[0].level, 1);
    assert.equal(historyRes.data[0].action, 'APPROVE');
    assert.equal(historyRes.data[0].approverId, 'u-hr-mgr');
    assert.equal(historyRes.data[0].approverRole, 'HR_MANAGER');
    assert.equal(historyRes.data[0].comment, 'Mức lương phù hợp dải chuẩn.');

    console.log(`[${dbProviderName}] PASS: In-band offer 1-level approval (HR Manager -> APPROVED -> HIRED)`);
  }

  {
    const created = await offerService.createOffer({
      candidateId: 'cand-02',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 35000000,
      salaryJustification: 'Ứng viên có năng lực vượt trội và 8 năm kinh nghiệm chuyên sâu.',
      startDate: '2027-02-01'
    }, actorRecruiter);

    assert.equal(created.success, true);
    assert.equal(created.data.isOutOfBand, true);
    assert.equal(created.data.currentApprovalLevel, 1);
    assert.equal(created.data.requiredApprovalLevels, 2);

    const skipAttempt = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      level: 2
    }, actorAdmin);
    assert.equal(skipAttempt.success, false);
    assert.equal(skipAttempt.statusCode, 400);
    assert.equal(skipAttempt.code, 'INVALID_APPROVAL_LEVEL_SEQUENCE');

    const lvl1Approved = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'HR Manager đồng ý thông qua Cấp 1.'
    }, actorHrMgr);

    assert.equal(lvl1Approved.success, true);
    assert.equal(lvl1Approved.data.status, 'PENDING_APPROVAL');
    assert.equal(lvl1Approved.data.currentApprovalLevel, 2);
    assert.equal(lvl1Approved.data.requiredApprovalLevels, 2);

    const candAfterLvl1 = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-02');
    assert.notEqual(candAfterLvl1.stage, 'HIRED');

    const nonAdminLvl2 = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'HR Manager duyệt cấp 2'
    }, actorHrMgr);
    assert.equal(nonAdminLvl2.success, false);
    assert.equal(nonAdminLvl2.statusCode, 403);
    assert.equal(nonAdminLvl2.code, 'FORBIDDEN_HIGHER_APPROVAL_REQUIRED');

    const lvl2Approved = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Giám đốc phê duyệt đặc cách vượt khung ngân sách.'
    }, actorAdmin);

    assert.equal(lvl2Approved.success, true);
    assert.equal(lvl2Approved.data.status, 'APPROVED');

    const offerRow = await db.prepare('SELECT status, current_approval_level FROM offers WHERE id = ?').get(created.data.id);
    assert.equal(offerRow.status, 'APPROVED');

    const candAfterLvl2 = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-02');
    assert.equal(candAfterLvl2.stage, 'HIRED');

    const historyRes = await offerService.getOfferApprovals(created.data.id, actorAdmin);
    assert.equal(historyRes.success, true);
    assert.equal(historyRes.data.length, 2);
    assert.equal(historyRes.data[0].level, 1);
    assert.equal(historyRes.data[0].approverRole, 'HR_MANAGER');
    assert.equal(historyRes.data[1].level, 2);
    assert.equal(historyRes.data[1].approverRole, 'ADMIN');

    console.log(`[${dbProviderName}] PASS: Out-of-band offer 2-level sequential approval (HR Manager -> Admin -> APPROVED -> HIRED)`);
  }

  {
    const created = await offerService.createOffer({
      candidateId: 'cand-03',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 25000000,
      startDate: '2027-02-01'
    }, actorRecruiter);

    const noCommentReject = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'REJECT',
      comment: '   '
    }, actorHrMgr);
    assert.equal(noCommentReject.success, false);
    assert.equal(noCommentReject.statusCode, 400);
    assert.equal(noCommentReject.code, 'COMMENT_REQUIRED');

    const validReject = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'REJECT',
      comment: 'Kế hoạch ngân sách phòng ban bị tạm hoãn.'
    }, actorHrMgr);

    assert.equal(validReject.success, true);
    assert.equal(validReject.data.status, 'REJECTED');

    const offerRow = await db.prepare('SELECT status FROM offers WHERE id = ?').get(created.data.id);
    assert.equal(offerRow.status, 'REJECTED');

    const doubleReject = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Thử duyệt lại'
    }, actorAdmin);
    assert.equal(doubleReject.success, false);
    assert.equal(doubleReject.statusCode, 400);
    assert.equal(doubleReject.code, 'OFFER_ALREADY_REJECTED');

    console.log(`[${dbProviderName}] PASS: REJECT action requires non-empty comment and terminates workflow`);
  }

  {
    const created = await offerService.createOffer({
      candidateId: 'cand-04',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 25000000,
      startDate: '2027-02-01'
    }, actorRecruiter);

    const noCommentRevision = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'REQUEST_REVISION',
      comment: ''
    }, actorHrMgr);
    assert.equal(noCommentRevision.success, false);
    assert.equal(noCommentRevision.statusCode, 400);
    assert.equal(noCommentRevision.code, 'COMMENT_REQUIRED');

    const validRevision = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'REQUEST_REVISION',
      comment: 'Cần dời ngày bắt đầu sang tháng 3/2027 theo kế hoạch dự án.'
    }, actorHrMgr);

    assert.equal(validRevision.success, true);
    assert.equal(validRevision.data.status, 'REVISION_REQUESTED');

    const historyBeforeResubmit = await offerService.getOfferApprovals(created.data.id, actorRecruiter);
    assert.equal(historyBeforeResubmit.data.length, 1);
    assert.equal(historyBeforeResubmit.data[0].action, 'REQUEST_REVISION');

    const cannotDecideWhileAwaitingRevision = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Duyệt thử khi chưa sửa'
    }, actorAdmin);
    assert.equal(cannotDecideWhileAwaitingRevision.success, false);
    assert.equal(cannotDecideWhileAwaitingRevision.statusCode, 400);
    assert.equal(cannotDecideWhileAwaitingRevision.code, 'OFFER_AWAITING_REVISION');

    const updated = await offerService.updateOffer(created.data.id, {
      startDate: '2027-03-01',
      submitForApproval: true
    }, actorRecruiter);

    assert.equal(updated.success, true);
    assert.equal(updated.data.status, 'PENDING_APPROVAL');

    const historyAfterResubmit = await offerService.getOfferApprovals(created.data.id, actorRecruiter);
    assert.equal(historyAfterResubmit.data.length, 1);
    assert.equal(historyAfterResubmit.data[0].action, 'REQUEST_REVISION');

    const approvedAfterResubmit = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Đã cập nhật đúng ngày bắt đầu làm việc.'
    }, actorHrMgr);

    assert.equal(approvedAfterResubmit.success, true);
    assert.equal(approvedAfterResubmit.data.status, 'APPROVED');

    const finalHistory = await offerService.getOfferApprovals(created.data.id, actorRecruiter);
    assert.equal(finalHistory.data.length, 2);
    assert.equal(finalHistory.data[0].action, 'REQUEST_REVISION');
    assert.equal(finalHistory.data[1].action, 'APPROVE');

    console.log(`[${dbProviderName}] PASS: REQUEST_REVISION preserves immutable history upon editing and resubmitting`);
  }

  {
    const historyRows = await db.prepare('SELECT id FROM offer_approvals LIMIT 1').all();
    assert.ok(historyRows.length > 0);
    const targetId = historyRows[0].id;

    let updateFailed = false;
    try {
      await db.prepare('UPDATE offer_approvals SET comment = ? WHERE id = ?').run('HACKED COMMENT', targetId);
    } catch (err) {
      updateFailed = true;
      assert.ok(err.message.includes('OFFER_APPROVALS_ARE_IMMUTABLE'));
    }
    assert.equal(updateFailed, true, 'Database trigger must prevent UPDATE on offer_approvals');

    let deleteFailed = false;
    try {
      await db.prepare('DELETE FROM offer_approvals WHERE id = ?').run(targetId);
    } catch (err) {
      deleteFailed = true;
      assert.ok(err.message.includes('OFFER_APPROVALS_ARE_IMMUTABLE'));
    }
    assert.equal(deleteFailed, true, 'Database trigger must prevent DELETE on offer_approvals');

    console.log(`[${dbProviderName}] PASS: Database triggers enforce strict immutability (no UPDATE/DELETE on offer_approvals)`);
  }

  {
    const created = await offerService.createOffer({
      candidateId: 'cand-05',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 25000000,
      startDate: '2027-02-01'
    }, actorRecruiter);

    const approve1 = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'First approval'
    }, actorHrMgr);
    assert.equal(approve1.success, true);

    const duplicateApprove = await offerService.decideOffer({
      offerId: created.data.id,
      action: 'APPROVE',
      comment: 'Duplicate approval attempt'
    }, actorHrMgr);
    assert.equal(duplicateApprove.success, false);
    assert.equal(duplicateApprove.statusCode, 400);
    assert.equal(duplicateApprove.code, 'OFFER_ALREADY_APPROVED');

    console.log(`[${dbProviderName}] PASS: Prevent duplicate approval on already decided offer`);
  }

  {
    const createdDraft = await offerService.createOffer({
      candidateId: 'cand-06',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 25000000,
      startDate: '2027-03-01',
      isDraft: true
    }, actorRecruiter);

    assert.equal(createdDraft.data.status, 'DRAFT');

    const draftDecide = await offerService.decideOffer({
      offerId: createdDraft.data.id,
      action: 'APPROVE'
    }, actorHrMgr);
    assert.equal(draftDecide.success, false);
    assert.equal(draftDecide.statusCode, 400);
    assert.equal(draftDecide.code, 'OFFER_NOT_SUBMITTED');

    console.log(`[${dbProviderName}] PASS: Prevent decision on DRAFT offer before submission`);
  }

  {
    const offerDetails = await offerService.getOfferById('cand-01', actorHrMgr);
    const offerByCand = (await offerService.getOffers({ candidateId: 'cand-01', viewer: actorHrMgr })).offers[0];
    assert.ok(offerByCand);
    const detailRes = await offerService.getOfferById(offerByCand.id, actorHrMgr);
    assert.equal(detailRes.success, true);
    assert.ok(Array.isArray(detailRes.data.approvals));
    assert.equal(detailRes.data.approvals.length, 1);
    assert.equal(detailRes.data.approvals[0].action, 'APPROVE');

    console.log(`[${dbProviderName}] PASS: getOfferById includes approvals timeline array`);
  }

  console.log(`=== All S7-05 Offer Approval Tests PASSED on [${dbProviderName}] ===\n`);
}

async function main() {
  await runTestSuite('SQLite', createSqliteDb);
  await runTestSuite('PGlite (PostgreSQL)', createPgliteDb);
  console.log('\nS7-05 OFFER APPROVALS SUITE RESULT: 100% PASS across SQLite and PGlite.\n');
}

main().catch(err => {
  console.error('TEST_S7_05_FAILED:', err);
  process.exitCode = 1;
});
