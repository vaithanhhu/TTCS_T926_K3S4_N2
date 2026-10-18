const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');

const migrateOfferApprovals = require('../src/db/migrate-offer-approvals');
const migrateOfferDelivery = require('../src/db/migrate-offer-delivery');
const OfferService = require('../src/services/offerService');
const RbacMiddleware = require('../src/middlewares/rbacMiddleware');
const { getEmailService } = require('../src/services/emailService');

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
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone_number TEXT,
        requisition_id TEXT REFERENCES requisitions(id),
        stage TEXT NOT NULL DEFAULT 'OFFER',
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
    await migrateOfferApprovals.migrate(db);
    await migrateOfferDelivery.migrate(db);
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
        stage TEXT NOT NULL DEFAULT 'OFFER',
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
    await migrateOfferApprovals.migrate(db);
    await migrateOfferDelivery.migrate(db);
  }
}

async function seedData(db) {
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-recruiter', 'recruiter@example.com', 'Nguyễn Thị Tuyển Dụng');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-other-recruiter', 'other.recruiter@example.com', 'Lê Khác Recruiter');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-hr-mgr', 'hrmanager@example.com', 'Trần Thị Trưởng Phòng HR');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-admin', 'admin@example.com', 'Admin Giám Đốc');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-interviewer', 'interviewer@example.com', 'Ngô Văn Phỏng Vấn');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-candidate', 'cand1@example.com', 'Ứng Viên Nguyễn');

  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-rec', 'RECRUITER', 'Nhân viên tuyển dụng');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-hr', 'HR_MANAGER', 'Trưởng phòng nhân sự');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-adm', 'ADMIN', 'Quản trị hệ thống');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-int', 'INTERVIEWER', 'Người phỏng vấn');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-can', 'CANDIDATE', 'Ứng viên');

  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-recruiter', 'r-rec');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-other-recruiter', 'r-rec');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-hr-mgr', 'r-hr');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-admin', 'r-adm');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-interviewer', 'r-int');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-candidate', 'r-can');

  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-read', 'offer.read', 'Xem offer');
  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-create', 'offer.create', 'Soạn và gửi offer');
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

  await db.prepare('INSERT INTO departments (id, code, name, manager_id) VALUES (?, ?, ?, ?)').run('dept-01', 'ENG', 'Phòng Kỹ thuật Phần mềm', 'u-admin');
  await db.prepare('INSERT INTO job_titles (id, code, name, min_salary, max_salary) VALUES (?, ?, ?, ?, ?)').run('jt-backend', 'BE-ENG', 'Kỹ sư Backend Senior', 18000000, 30000000);
  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, hiring_manager_id, recruiter_id, job_title_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('req-01', 'REQ-2026-001', 'Tuyển dụng Kỹ sư Backend Senior', 'dept-01', 'Phòng Kỹ thuật Phần mềm', 'u-admin', 'u-recruiter', 'jt-backend', 'OPEN');

  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run('cand-01', 'Nguyễn Văn A', 'cand1@example.com', '0901234567', 'req-01', 'OFFER');
  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run('cand-02', 'Trần Thị B', 'cand2@example.com', '0912345678', 'req-01', 'OFFER');
  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run('cand-03', 'Lê Văn C', 'cand3@example.com', '0923456789', 'req-01', 'OFFER');
  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run('cand-04', 'Phạm Thị D', 'cand4@example.com', '0934567890', 'req-01', 'OFFER');
}

async function runTests(provider) {
  const dbProviderName = provider === 'sqlite' ? 'SQLite' : 'PGlite (PostgreSQL)';
  console.log(`\n=== Running S7-06 Offer Delivery Tests on [${dbProviderName}] ===`);

  const db = provider === 'sqlite' ? createSqliteDb() : await createPgliteDb();
  await setupBaselineSchema(db);
  await seedData(db);
  await migrateOfferDelivery.verify(db);

  console.log(`[${dbProviderName}] Migration 023 executed and verified successfully.`);

  const emailService = getEmailService(db);
  emailService.mode = 'simulated';
  emailService.sentEmails = [];

  const reqMock = {
    recruiterScope: (alias, recruiterId) => ({
      condition: `${alias}.recruiter_id = ?`,
      params: [recruiterId]
    }),
    hiringRequisitionScope: () => '1=1',
    candidateAccess: async (candidateId, actor) => ({ success: true }),
    recruiterAssigned: async (reqId, userId) => userId === 'u-recruiter',
    openPolicy: null
  };

  const rbacMock = new RbacMiddleware(db);
  const offerService = new OfferService(db, reqMock, rbacMock);

  const actorAdmin = { id: 'u-admin', email: 'admin@example.com', roles: ['ADMIN'] };
  const actorHrMgr = { id: 'u-hr-mgr', email: 'hrmanager@example.com', roles: ['HR_MANAGER'] };
  const actorRecruiter = { id: 'u-recruiter', email: 'recruiter@example.com', roles: ['RECRUITER'] };
  const actorOtherRecruiter = { id: 'u-other-recruiter', email: 'other.recruiter@example.com', roles: ['RECRUITER'] };
  const actorInterviewer = { id: 'u-interviewer', email: 'interviewer@example.com', roles: ['INTERVIEWER'] };

  {
    const draftOffer = await offerService.createOffer({
      candidateId: 'cand-01',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 24000000,
      startDate: '2027-03-01',
      expirationDate: '2027-03-10',
      saveAsDraft: true
    }, actorRecruiter);
    assert.equal(draftOffer.success, true);
    assert.equal(draftOffer.data.status, 'DRAFT');

    const sendDraftAttempt = await offerService.sendOffer(draftOffer.data.id, actorRecruiter);
    assert.equal(sendDraftAttempt.success, false);
    assert.equal(sendDraftAttempt.statusCode, 400);
    assert.equal(sendDraftAttempt.code, 'OFFER_NOT_APPROVED');

    const submitRes = await offerService.updateOffer(draftOffer.data.id, { submitForApproval: true }, actorRecruiter);
    assert.equal(submitRes.success, true);

    const sendPendingAttempt = await offerService.sendOffer(draftOffer.data.id, actorRecruiter);
    assert.equal(sendPendingAttempt.success, false);
    assert.equal(sendPendingAttempt.statusCode, 400);
    assert.equal(sendPendingAttempt.code, 'OFFER_NOT_APPROVED');

    const forbiddenSend = await offerService.sendOffer(draftOffer.data.id, actorInterviewer);
    assert.equal(forbiddenSend.success, false);
    assert.equal(forbiddenSend.statusCode, 403);

    const approveRes = await offerService.decideOffer({
      offerId: draftOffer.data.id,
      action: 'APPROVE',
      comment: 'Đồng ý thông qua offer dải chuẩn.'
    }, actorHrMgr);
    assert.equal(approveRes.success, true);
    assert.equal(approveRes.data.status, 'APPROVED');

    const candAfterApprove = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
    assert.equal(candAfterApprove.stage, 'OFFER');

    const outOfScopeAttempt = await offerService.sendOffer(draftOffer.data.id, actorOtherRecruiter);
    assert.equal(outOfScopeAttempt.success, false);
    assert.equal(outOfScopeAttempt.statusCode, 403);
    assert.equal(outOfScopeAttempt.code, 'OFFER_OUT_OF_SCOPE');

    const initialEmailCount = emailService.sentEmails.length;
    const sendRes = await offerService.sendOffer(draftOffer.data.id, actorRecruiter);
    assert.equal(sendRes.success, true);
    assert.equal(sendRes.statusCode, 200);
    assert.equal(sendRes.data.status, 'SENT');
    assert.ok(sendRes.data.responseToken);
    assert.equal(sendRes.data.responseToken.length, 64);
    assert.ok(sendRes.data.tokenExpiresAt);
    assert.equal(sendRes.data.emailSent, true);

    const dbOffer = await db.prepare('SELECT status, response_token, sent_at, token_expires_at FROM offers WHERE id = ?').get(draftOffer.data.id);
    assert.equal(dbOffer.status, 'SENT');
    assert.equal(dbOffer.response_token, sendRes.data.responseToken);
    assert.ok(dbOffer.sent_at);
    assert.ok(dbOffer.token_expires_at);

    assert.equal(emailService.sentEmails.length, initialEmailCount + 1);
    const lastEmail = emailService.getLastSentEmail();
    assert.equal(lastEmail.to, 'cand1@example.com');
    assert.ok(lastEmail.content.includes(sendRes.data.responseToken));
    assert.ok(lastEmail.content.includes('24.000.000'));

    const duplicateSend = await offerService.sendOffer(draftOffer.data.id, actorRecruiter);
    assert.equal(duplicateSend.success, false);
    assert.equal(duplicateSend.statusCode, 400);
    assert.equal(duplicateSend.code, 'OFFER_ALREADY_SENT');

    console.log(`[${dbProviderName}] PASS: Send offer gatekeeping, token generation, and email dispatch`);
  }

  {
    const offerRow = await db.prepare("SELECT response_token FROM offers WHERE candidate_id = 'cand-01'").get();
    const validToken = offerRow.response_token;

    const badTokenRes = await offerService.getOfferByToken('invalid-fake-token-123456');
    assert.equal(badTokenRes.success, false);
    assert.equal(badTokenRes.statusCode, 404);
    assert.equal(badTokenRes.code, 'OFFER_NOT_FOUND');

    const emptyTokenRes = await offerService.getOfferByToken('');
    assert.equal(emptyTokenRes.success, false);
    assert.equal(emptyTokenRes.statusCode, 400);

    const publicView = await offerService.getOfferByToken(validToken);
    assert.equal(publicView.success, true);
    assert.equal(publicView.statusCode, 200);
    assert.equal(publicView.data.candidateName, 'Nguyễn Văn A');
    assert.equal(publicView.data.candidateEmail, 'cand1@example.com');
    assert.equal(publicView.data.jobTitleName, 'Kỹ sư Backend Senior');
    assert.equal(publicView.data.status, 'SENT');
    assert.equal(publicView.data.isExpired, false);
    assert.equal(publicView.data.isResponded, false);
    assert.equal(publicView.data.salaryMonthly, 24000000);
    assert.equal(publicView.data.approverId, undefined);
    assert.equal(publicView.data.notes, undefined);

    console.log(`[${dbProviderName}] PASS: Public candidate offer view with token and privacy isolation`);
  }

  {
    const offerRow = await db.prepare("SELECT id, response_token FROM offers WHERE candidate_id = 'cand-01'").get();
    const validToken = offerRow.response_token;

    const invalidDecision = await offerService.respondOffer(validToken, { decision: 'MAYBE' });
    assert.equal(invalidDecision.success, false);
    assert.equal(invalidDecision.statusCode, 400);
    assert.equal(invalidDecision.code, 'INVALID_DECISION');

    const acceptRes = await offerService.respondOffer(validToken, {
      decision: 'ACCEPTED',
      comment: 'Tôi rất vui mừng đồng ý gia nhập đội ngũ.'
    });
    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.statusCode, 200);
    assert.equal(acceptRes.data.status, 'ACCEPTED');
    assert.equal(acceptRes.data.candidateResponse, 'ACCEPTED');
    assert.equal(acceptRes.data.candidateComment, 'Tôi rất vui mừng đồng ý gia nhập đội ngũ.');

    const updatedOffer = await db.prepare('SELECT status, candidate_response, candidate_comment, responded_at FROM offers WHERE id = ?').get(offerRow.id);
    assert.equal(updatedOffer.status, 'ACCEPTED');
    assert.equal(updatedOffer.candidate_response, 'ACCEPTED');
    assert.equal(updatedOffer.candidate_comment, 'Tôi rất vui mừng đồng ý gia nhập đội ngũ.');
    assert.ok(updatedOffer.responded_at);

    const candidateRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
    assert.equal(candidateRow.stage, 'HIRED');

    const replayAccept = await offerService.respondOffer(validToken, { decision: 'ACCEPTED' });
    assert.equal(replayAccept.success, false);
    assert.equal(replayAccept.statusCode, 409);
    assert.equal(replayAccept.code, 'OFFER_ALREADY_RESPONDED');

    const replayReject = await offerService.respondOffer(validToken, { decision: 'REJECTED' });
    assert.equal(replayReject.success, false);
    assert.equal(replayReject.statusCode, 409);
    assert.equal(replayReject.code, 'OFFER_ALREADY_RESPONDED');

    const candStillHired = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
    assert.equal(candStillHired.stage, 'HIRED');

    console.log(`[${dbProviderName}] PASS: Candidate acceptance, pipeline stage sync (HIRED), and replay prevention`);
  }

  {
    const cand2Offer = await offerService.createOffer({
      candidateId: 'cand-02',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 28000000,
      startDate: '2027-03-15',
      expirationDate: '2027-03-22'
    }, actorRecruiter);
    assert.equal(cand2Offer.success, true);

    await offerService.decideOffer({
      offerId: cand2Offer.data.id,
      action: 'APPROVE',
      comment: 'Duyệt tuyển dụng ứng viên 2.'
    }, actorHrMgr);

    const send2Res = await offerService.sendOffer(cand2Offer.data.id, actorRecruiter);
    assert.equal(send2Res.success, true);
    const token2 = send2Res.data.responseToken;

    const rejectRes = await offerService.respondOffer(token2, {
      decision: 'REJECTED',
      comment: 'Tôi đã nhận được cơ hội làm việc khác phù hợp hơn.',
      rejectionReasonCategory: 'ACCEPTED_ELSEWHERE'
    });
    assert.equal(rejectRes.success, true);
    assert.equal(rejectRes.statusCode, 200);
    assert.equal(rejectRes.data.status, 'REJECTED');
    assert.equal(rejectRes.data.candidateResponse, 'REJECTED');

    const dbOffer2 = await db.prepare('SELECT status, candidate_response, candidate_comment, rejection_reason_category, responded_at FROM offers WHERE id = ?').get(cand2Offer.data.id);
    assert.equal(dbOffer2.status, 'REJECTED');
    assert.equal(dbOffer2.candidate_response, 'REJECTED');
    assert.equal(dbOffer2.candidate_comment, 'Tôi đã nhận được cơ hội làm việc khác phù hợp hơn.');
    assert.equal(dbOffer2.rejection_reason_category, 'ACCEPTED_ELSEWHERE');

    const cand2Stage = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-02');
    assert.equal(cand2Stage.stage, 'REJECTED');

    const replay2 = await offerService.respondOffer(token2, { decision: 'ACCEPTED' });
    assert.equal(replay2.success, false);
    assert.equal(replay2.statusCode, 409);
    assert.equal(replay2.code, 'OFFER_ALREADY_RESPONDED');

    console.log(`[${dbProviderName}] PASS: Candidate rejection, structured feedback capture, and pipeline stage sync`);
  }

  {
    const cand3Offer = await offerService.createOffer({
      candidateId: 'cand-03',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 20000000,
      startDate: '2027-03-01',
      expirationDate: '2026-01-01'
    }, actorRecruiter);
    assert.equal(cand3Offer.success, true);

    await offerService.decideOffer({
      offerId: cand3Offer.data.id,
      action: 'APPROVE',
      comment: 'Duyệt ứng viên 3.'
    }, actorHrMgr);

    const send3Res = await offerService.sendOffer(cand3Offer.data.id, actorRecruiter);
    assert.equal(send3Res.success, true);
    const token3 = send3Res.data.responseToken;

    await db.prepare("UPDATE offers SET token_expires_at = '2025-01-01T00:00:00.000Z', expiration_date = '2025-01-01' WHERE id = ?")
      .run(cand3Offer.data.id);

    const getExpired = await offerService.getOfferByToken(token3);
    assert.equal(getExpired.success, true);
    assert.equal(getExpired.data.status, 'EXPIRED');
    assert.equal(getExpired.data.isExpired, true);

    const dbCheckExpired = await db.prepare('SELECT status FROM offers WHERE id = ?').get(cand3Offer.data.id);
    assert.equal(dbCheckExpired.status, 'EXPIRED');

    const tryRespondExpired = await offerService.respondOffer(token3, { decision: 'ACCEPTED' });
    assert.equal(tryRespondExpired.success, false);
    assert.equal(tryRespondExpired.statusCode, 410);
    assert.equal(tryRespondExpired.code, 'OFFER_EXPIRED');

    console.log(`[${dbProviderName}] PASS: Token expiration check blocks acceptance/rejection (HTTP 410)`);
  }

  {
    const cand4Offer = await offerService.createOffer({
      candidateId: 'cand-04',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 21000000,
      startDate: '2027-03-01',
      expirationDate: '2025-01-01'
    }, actorRecruiter);
    assert.equal(cand4Offer.success, true);

    await offerService.decideOffer({
      offerId: cand4Offer.data.id,
      action: 'APPROVE',
      comment: 'Duyệt ứng viên 4.'
    }, actorHrMgr);

    const send4Res = await offerService.sendOffer(cand4Offer.data.id, actorRecruiter);
    assert.equal(send4Res.success, true);

    await db.prepare("UPDATE offers SET token_expires_at = '2025-01-01T00:00:00.000Z', expiration_date = '2025-01-01' WHERE id = ?")
      .run(cand4Offer.data.id);

    const expiredCount = await offerService.expireOverdueOffers();
    assert.ok(expiredCount >= 1);

    const dbOffer4 = await db.prepare('SELECT status FROM offers WHERE id = ?').get(cand4Offer.data.id);
    assert.equal(dbOffer4.status, 'EXPIRED');

    console.log(`[${dbProviderName}] PASS: Resilient auto-expiry background sweep transitions overdue offers to EXPIRED`);
  }

  {
    const cand2OfferRow = await db.prepare("SELECT id FROM offers WHERE candidate_id = 'cand-02'").get();
    const detailedOffer = await offerService.getOfferById(cand2OfferRow.id, actorHrMgr);
    assert.equal(detailedOffer.success, true);
    assert.equal(detailedOffer.data.status, 'REJECTED');
    assert.equal(detailedOffer.data.candidateResponse, 'REJECTED');
    assert.equal(detailedOffer.data.rejectionReasonCategory, 'ACCEPTED_ELSEWHERE');
    assert.ok(detailedOffer.data.respondedAt);
    assert.ok(detailedOffer.data.sentAt);
    assert.ok(detailedOffer.data.responseToken);

    console.log(`[${dbProviderName}] PASS: getOfferById includes delivery, token, response metadata and audit trail`);
  }

  console.log(`=== All S7-06 Offer Delivery Tests PASSED on [${dbProviderName}] ===\n`);
  if (db.close) await db.close();
}

async function main() {
  await runTests('sqlite');
  await runTests('postgres');
  console.log('\nS7-06 OFFER DELIVERY SUITE RESULT: 100% PASS across SQLite and PGlite.\n');
}

main().catch(err => {
  console.error('S7-06 TEST FAILED:', err);
  process.exitCode = 1;
});
