const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');

const migrateOfferApprovals = require('../src/db/migrate-offer-approvals');
const migrateOfferDelivery = require('../src/db/migrate-offer-delivery');
const migrateOfferNegotiation = require('../src/db/migrate-offer-negotiation');
const OfferService = require('../src/services/offerService');
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
        stage TEXT NOT NULL DEFAULT 'OFFER',
        notes TEXT,
        rejection_reason_id TEXT
      );
      CREATE TABLE IF NOT EXISTS candidate_talent_pool (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        interested_title TEXT NOT NULL,
        reason TEXT NOT NULL,
        final_round_confirmed BOOLEAN NOT NULL,
        confirmed_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
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
    await migrateOfferNegotiation.migrate(db);
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
        stage TEXT NOT NULL DEFAULT 'OFFER',
        notes TEXT,
        rejection_reason_id TEXT
      );
      CREATE TABLE IF NOT EXISTS candidate_talent_pool (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        interested_title TEXT NOT NULL,
        reason TEXT NOT NULL,
        final_round_confirmed BOOLEAN NOT NULL,
        confirmed_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
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
    await migrateOfferNegotiation.migrate(db);
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

  const permissions = [
    ['p-off-read', 'offer.read', 'Xem offer'],
    ['p-off-create', 'offer.create', 'Lập offer'],
    ['p-off-approve', 'offer.approve', 'Duyệt offer'],
    ['p-cand-read', 'candidate.read', 'Xem ứng viên'],
    ['p-cand-update', 'candidate.update', 'Cập nhật ứng viên']
  ];
  for (const [pid, code, name] of permissions) {
    await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run(pid, code, name);
  }

  const rolePermMap = [
    ['r-adm', 'p-off-read'], ['r-adm', 'p-off-create'], ['r-adm', 'p-off-approve'], ['r-adm', 'p-cand-read'], ['r-adm', 'p-cand-update'],
    ['r-hr', 'p-off-read'], ['r-hr', 'p-off-create'], ['r-hr', 'p-off-approve'], ['r-hr', 'p-cand-read'], ['r-hr', 'p-cand-update'],
    ['r-rec', 'p-off-read'], ['r-rec', 'p-off-create'], ['r-rec', 'p-cand-read'],
    ['r-can', 'p-off-read']
  ];
  for (const [rid, pid] of rolePermMap) {
    await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(rid, pid);
  }

  await db.prepare('INSERT INTO departments (id, code, name, manager_id) VALUES (?, ?, ?, ?)').run('dept-eng', 'ENG', 'Kỹ thuật Công nghệ', 'u-hr-mgr');

  await db.prepare('INSERT INTO job_titles (id, code, name, min_salary, max_salary) VALUES (?, ?, ?, ?, ?)').run('jt-backend', 'BE-ENG', 'Kỹ sư Backend', 20000000, 35000000);

  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, job_title_id, proposed_salary_min, proposed_salary_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('req-backend-01', 'REQ-BE-01', 'Tuyển Senior Backend Developer', 'dept-eng', 'Kỹ thuật Công nghệ', 'u-recruiter', 'jt-backend', 20000000, 35000000);

  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, job_title_id, proposed_salary_min, proposed_salary_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('req-backend-02', 'REQ-BE-02', 'Tuyển Tech Lead', 'dept-eng', 'Kỹ thuật Công nghệ', 'u-other-recruiter', 'jt-backend', 30000000, 50000000);

  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cand-01', 'Nguyễn Văn An', 'cand1@example.com', '0901234567', 'req-backend-01', 'OFFER');

  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cand-02', 'Trần Thị Bình', 'cand2@example.com', '0912345678', 'req-backend-02', 'OFFER');
}

async function runTestsForDb(db, dialect) {
  await setupBaselineSchema(db);
  await seedData(db);

  const requisitionService = new RequisitionService(db);
  const offerService = new OfferService(db, requisitionService);

  const actorRecruiter = { id: 'u-recruiter', roles: ['RECRUITER'], email: 'recruiter@example.com' };
  const actorOtherRecruiter = { id: 'u-other-recruiter', roles: ['RECRUITER'], email: 'other.recruiter@example.com' };
  const actorHrMgr = { id: 'u-hr-mgr', roles: ['HR_MANAGER'], email: 'hrmanager@example.com' };
  const actorAdmin = { id: 'u-admin', roles: ['ADMIN'], email: 'admin@example.com' };

  await migrateOfferNegotiation.verify(db);

  const initialOfferRes = await offerService.createOffer({
    candidateId: 'cand-01',
    requisitionId: 'req-backend-01',
    jobTitleId: 'jt-backend',
    salaryMonthly: 22000000,
    allowances: 1500000,
    startDate: '2026-11-01',
    expirationDate: '2026-10-30',
    approverId: 'u-hr-mgr',
    notes: 'Đề xuất lương ban đầu 22M'
  }, actorRecruiter);

  assert.equal(initialOfferRes.success, true, `${dialect}: Initial offer created`);
  const offerId1 = initialOfferRes.data.id;

  const appRes = await offerService.decideOffer({
    id: offerId1,
    action: 'APPROVE',
    comment: 'Đồng ý mức lương 22M'
  }, actorHrMgr);
  assert.equal(appRes.success, true, `${dialect}: Offer approved`);

  const sendRes = await offerService.sendOffer(offerId1, actorRecruiter);
  assert.equal(sendRes.success, true, `${dialect}: Offer sent to candidate`);
  const responseToken = sendRes.data.responseToken;
  assert.ok(responseToken, `${dialect}: Response token generated`);

  const candRespondRes = await offerService.respondOffer(responseToken, {
    decision: 'REJECT',
    comment: 'Cảm ơn công ty, tôi muốn thương lượng lại mức lương vì có đề xuất khác cao hơn.',
    rejectionReasonCategory: 'SALARY'
  });
  assert.equal(candRespondRes.success, true, `${dialect}: Candidate declined offer`);
  assert.equal(candRespondRes.data.status, 'REJECTED');

  const candRowAfterReject = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
  assert.equal(candRowAfterReject.stage, 'REJECTED', `${dialect}: Candidate stage is REJECTED after candidate decline`);

  const rejOfferDetails = await offerService.getOfferById(offerId1, actorRecruiter);
  assert.equal(rejOfferDetails.success, true);
  assert.equal(rejOfferDetails.data.rejectionReasonCategory, 'SALARY');
  assert.equal(rejOfferDetails.data.candidateResponse, 'REJECTED');
  assert.ok(rejOfferDetails.data.talentPoolRecommendation, `${dialect}: Talent pool recommendation provided`);
  assert.equal(rejOfferDetails.data.talentPoolRecommendation.recommended, true);
  assert.equal(rejOfferDetails.data.capabilities.canRevise, true);
  assert.equal(rejOfferDetails.data.capabilities.canRecordRejection, true);

  const missingCatRes = await offerService.recordRejectionReason(offerId1, {
    category: '',
    notes: 'Không có lý do'
  }, actorRecruiter);
  assert.equal(missingCatRes.success, false);
  assert.equal(missingCatRes.code, 'CATEGORY_REQUIRED');

  const invalidCatRes = await offerService.recordRejectionReason(offerId1, {
    category: 'INVALID_CATEGORY',
    notes: 'Lý do sai'
  }, actorRecruiter);
  assert.equal(invalidCatRes.success, false);
  assert.equal(invalidCatRes.code, 'INVALID_REJECTION_CATEGORY');

  const otherRecruiterRejRes = await offerService.recordRejectionReason(offerId1, {
    category: 'LOCATION',
    notes: 'Recruiter khác can thiệp'
  }, actorOtherRecruiter);
  assert.equal(otherRecruiterRejRes.success, false);
  assert.equal(otherRecruiterRejRes.statusCode, 403);
  assert.ok(['OFFER_OUT_OF_SCOPE', 'CANDIDATE_OUT_OF_SCOPE'].includes(otherRecruiterRejRes.code));

  const updateRejRes = await offerService.recordRejectionReason(offerId1, {
    category: 'Lương',
    notes: 'Ứng viên đề xuất mức 28.000.000 VNĐ mới nhận việc.'
  }, actorRecruiter);
  assert.equal(updateRejRes.success, true);
  assert.equal(updateRejRes.data.rejectionReasonCategory, 'SALARY');
  assert.equal(updateRejRes.data.candidateComment, 'Ứng viên đề xuất mức 28.000.000 VNĐ mới nhận việc.');

  const poolRecruiterRes = await offerService.addToTalentPoolFromOffer(offerId1, {
    reason: 'Hồ sơ tiềm năng'
  }, actorRecruiter);
  assert.equal(poolRecruiterRes.success, false);
  assert.equal(poolRecruiterRes.statusCode, 403, `${dialect}: Pure recruiter cannot add directly to talent pool`);

  const poolHrRes = await offerService.addToTalentPoolFromOffer(offerId1, {
    reason: 'Ứng viên có kỹ năng tốt, từ chối lương đợt này, lưu để xem xét sau.'
  }, actorHrMgr);
  assert.equal(poolHrRes.success, true, `${dialect}: HR Manager can add candidate to talent pool`);
  assert.ok(poolHrRes.data.talentPoolId);

  const poolIdempotentRes = await offerService.addToTalentPoolFromOffer(offerId1, {
    reason: 'Thử lưu lần 2'
  }, actorAdmin);
  assert.equal(poolIdempotentRes.success, true);
  assert.equal(poolIdempotentRes.data.alreadyInPool, true, `${dialect}: Talent pool addition is idempotent`);

  const outOfScopeRevise = await offerService.reviseOffer(offerId1, {
    salaryMonthly: 28000000,
    startDate: '2026-11-15'
  }, actorOtherRecruiter);
  assert.equal(outOfScopeRevise.success, false);
  assert.equal(outOfScopeRevise.statusCode, 403);
  assert.ok(['OFFER_OUT_OF_SCOPE', 'CANDIDATE_OUT_OF_SCOPE'].includes(outOfScopeRevise.code));

  const oobNoJustRes = await offerService.reviseOffer(offerId1, {
    salaryMonthly: 40000000,
    startDate: '2026-11-15'
  }, actorRecruiter);
  assert.equal(oobNoJustRes.success, false);
  assert.equal(oobNoJustRes.code, 'JUSTIFICATION_REQUIRED', `${dialect}: Out of band revision requires justification`);

  const reviseInBandRes = await offerService.reviseOffer(offerId1, {
    salaryMonthly: 28000000,
    allowances: 2000000,
    startDate: '2026-11-15',
    expirationDate: '2026-11-10',
    notes: 'Điều chỉnh lương theo nguyện vọng ứng viên (28M)',
    submitForApproval: true
  }, actorRecruiter);

  assert.equal(reviseInBandRes.success, true, `${dialect}: In-band offer revision created`);
  assert.equal(reviseInBandRes.data.status, 'PENDING_APPROVAL');
  assert.equal(reviseInBandRes.data.requiredApprovalLevels, 1);
  assert.equal(reviseInBandRes.data.isOutOfBand, false);
  assert.equal(reviseInBandRes.data.predecessorOfferId, offerId1);

  const offerId2 = reviseInBandRes.data.id;
  assert.notEqual(offerId2, offerId1);

  const oldOfferRow = await db.prepare('SELECT status, superseded_by_offer_id FROM offers WHERE id = ?').get(offerId1);
  assert.equal(oldOfferRow.status, 'SUPERSEDED', `${dialect}: Predecessor offer transitioned to SUPERSEDED`);
  assert.equal(oldOfferRow.superseded_by_offer_id, offerId2, `${dialect}: Predecessor links to revised offer`);

  const candRowAfterRevise = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
  assert.equal(candRowAfterRevise.stage, 'OFFER', `${dialect}: Candidate stage returned to OFFER upon revision`);

  const secondActiveOfferRes = await offerService.createOffer({
    candidateId: 'cand-01',
    requisitionId: 'req-backend-01',
    salaryMonthly: 30000000,
    startDate: '2026-11-20'
  }, actorRecruiter);
  assert.ok(!secondActiveOfferRes.success || secondActiveOfferRes.statusCode >= 400, `${dialect}: Multiple active offers prevented`);

  const reviseSupersededRes = await offerService.reviseOffer(offerId1, {
    salaryMonthly: 29000000,
    startDate: '2026-11-15'
  }, actorRecruiter);
  assert.equal(reviseSupersededRes.success, false);
  assert.equal(reviseSupersededRes.code, 'OFFER_ALREADY_SUPERSEDED', `${dialect}: Already superseded offer cannot be revised again`);

  const revisedOfferDetails = await offerService.getOfferById(offerId2, actorRecruiter);
  assert.equal(revisedOfferDetails.success, true);
  assert.ok(revisedOfferDetails.data.predecessorOffer, `${dialect}: Details include predecessor offer info`);
  assert.equal(revisedOfferDetails.data.predecessorOffer.id, offerId1);
  assert.equal(revisedOfferDetails.data.predecessorOffer.status, 'SUPERSEDED');
  assert.equal(revisedOfferDetails.data.predecessorOffer.rejectionReasonCategory, 'SALARY');

  const oldOfferDetails = await offerService.getOfferById(offerId1, actorRecruiter);
  assert.equal(oldOfferDetails.success, true);
  assert.ok(oldOfferDetails.data.supersededByOffer, `${dialect}: Details of predecessor include supersededByOffer info`);
  assert.equal(oldOfferDetails.data.supersededByOffer.id, offerId2);

  const app2Res = await offerService.decideOffer({
    id: offerId2,
    action: 'APPROVE',
    comment: 'Đồng ý duyệt đề xuất sửa đổi 28M'
  }, actorHrMgr);
  assert.equal(app2Res.success, true, `${dialect}: Revised offer approved`);

  const send2Res = await offerService.sendOffer(offerId2, actorRecruiter);
  assert.equal(send2Res.success, true, `${dialect}: Revised offer sent to candidate`);
  const token2 = send2Res.data.responseToken;
  assert.ok(token2);
  assert.notEqual(token2, responseToken, `${dialect}: Fresh response token issued for revised offer`);

  const oldTokenRespondRes = await offerService.respondOffer(responseToken, {
    decision: 'ACCEPTED'
  });
  assert.equal(oldTokenRespondRes.success, false, `${dialect}: Old response token cannot be reused`);
  assert.equal(oldTokenRespondRes.code, 'OFFER_ALREADY_RESPONDED');

  const acceptRevisedRes = await offerService.respondOffer(token2, {
    decision: 'ACCEPTED',
    comment: 'Tôi rất vui được gia nhập công ty với điều khoản mới!'
  });
  assert.equal(acceptRevisedRes.success, true, `${dialect}: Candidate accepted revised offer`);
  assert.equal(acceptRevisedRes.data.status, 'ACCEPTED');

  const finalCandRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
  assert.equal(finalCandRow.stage, 'HIRED', `${dialect}: Candidate stage is HIRED after accepting revised offer`);

  const reviseAcceptedRes = await offerService.reviseOffer(offerId2, {
    salaryMonthly: 30000000,
    startDate: '2026-11-20'
  }, actorRecruiter);
  assert.equal(reviseAcceptedRes.success, false);
  assert.equal(reviseAcceptedRes.code, 'OFFER_ALREADY_ACCEPTED', `${dialect}: Accepted offer cannot be revised`);

  const oobOfferRes = await offerService.createOffer({
    candidateId: 'cand-02',
    requisitionId: 'req-backend-02',
    jobTitleId: 'jt-backend',
    salaryMonthly: 40000000,
    salaryJustification: 'Ứng viên có 10 năm kinh nghiệm dẫn dắt team lớn',
    startDate: '2026-12-01',
    expirationDate: '2026-11-25',
    approverId: 'u-hr-mgr',
    notes: 'Tech Lead lương cao ngoài dải'
  }, actorOtherRecruiter);
  assert.equal(oobOfferRes.success, true);
  const oobOfferId = oobOfferRes.data.id;
  assert.equal(oobOfferRes.data.requiredApprovalLevels, 2);

  const oobApp1 = await offerService.decideOffer({
    id: oobOfferId,
    action: 'APPROVE',
    comment: 'HR duyệt cấp 1'
  }, actorHrMgr);
  assert.equal(oobApp1.success, true);
  assert.equal(oobApp1.data.status, 'PENDING_APPROVAL');
  assert.equal(oobApp1.data.currentApprovalLevel, 2);

  const oobApp2 = await offerService.decideOffer({
    id: oobOfferId,
    action: 'APPROVE',
    comment: 'Giám đốc duyệt cấp 2'
  }, actorAdmin);
  assert.equal(oobApp2.success, true);
  assert.equal(oobApp2.data.status, 'APPROVED');

  const oobSend = await offerService.sendOffer(oobOfferId, actorOtherRecruiter);
  assert.equal(oobSend.success, true);

  const oobToken = oobSend.data.responseToken;
  await offerService.respondOffer(oobToken, {
    decision: 'REJECT',
    rejectionReasonCategory: 'LOCATION',
    comment: 'Khoảng cách đi lại quá xa, nhà cách công ty 25km'
  });

  const oobRevise = await offerService.reviseOffer(oobOfferId, {
    salaryMonthly: 42000000,
    salaryJustification: 'Hỗ trợ thêm ngân sách di chuyển và làm việc từ xa 2 ngày/tuần',
    startDate: '2026-12-01',
    submitForApproval: true
  }, actorOtherRecruiter);
  assert.equal(oobRevise.success, true);
  assert.equal(oobRevise.data.requiredApprovalLevels, 2, `${dialect}: Revised out-of-band offer requires 2 levels`);
  assert.equal(oobRevise.data.isOutOfBand, true);

  const oobPredecessor = await db.prepare('SELECT status, superseded_by_offer_id FROM offers WHERE id = ?').get(oobOfferId);
  assert.equal(oobPredecessor.status, 'SUPERSEDED');
  assert.equal(oobPredecessor.superseded_by_offer_id, oobRevise.data.id);
}

async function runAll() {
  console.log('Testing S7-07 Offer Negotiation on SQLite...');
  const sqliteDb = createSqliteDb();
  await runTestsForDb(sqliteDb, 'sqlite');
  console.log('PASS: SQLite S7-07 tests completed successfully.');

  console.log('Testing S7-07 Offer Negotiation on PGlite (Postgres)...');
  const pgliteDb = await createPgliteDb();
  await runTestsForDb(pgliteDb, 'pglite');
  await pgliteDb.close();
  console.log('PASS: PGlite S7-07 tests completed successfully.');

  console.log('ALL S7-07 TESTS PASSED (100% SQLite & PGlite compatibility).');
}

runAll().catch(err => {
  console.error('TEST S7-07 FAILED:', err);
  process.exit(1);
});
