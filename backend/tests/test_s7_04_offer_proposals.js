const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const OfferService = require('../src/services/offerService');

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
  }
}

async function seedData(db) {
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-recruiter', 'recruiter@example.com', 'Nguyễn Thị Tuyển Dụng');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-recruiter-other', 'recruiter.other@example.com', 'Trần Văn Khác');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-approver', 'approver@example.com', 'Trần Thị Giám Đốc');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-admin', 'admin@example.com', 'Admin Quản Trị');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-candidate', 'cand.user@example.com', 'Ứng Viên Nguyễn');

  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-rec', 'RECRUITER', 'Nhân viên tuyển dụng');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-app', 'APPROVER', 'Người phê duyệt');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-adm', 'ADMIN', 'Quản trị hệ thống');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-can', 'CANDIDATE', 'Ứng viên');

  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-recruiter', 'r-rec');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-recruiter-other', 'r-rec');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-approver', 'r-app');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-admin', 'r-adm');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-candidate', 'r-can');

  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-read', 'offer.read', 'Xem offer');
  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-create', 'offer.create', 'Soạn offer');
  await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run('p-off-app', 'offer.approve', 'Duyệt offer');

  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-rec', 'p-off-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-rec', 'p-off-create');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-app', 'p-off-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-app', 'p-off-app');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-adm', 'p-off-read');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-adm', 'p-off-create');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-adm', 'p-off-app');
  await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run('r-can', 'p-off-read');

  await db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('d-eng', 'ENG', 'Phòng Công Nghệ');

  await db.prepare('INSERT INTO job_titles (id, code, name, min_salary, max_salary) VALUES (?, ?, ?, ?, ?)').run('jt-backend', 'BE-SR', 'Senior Backend Engineer', 20000000, 30000000);
  await db.prepare('INSERT INTO job_titles (id, code, name, min_salary, max_salary) VALUES (?, ?, ?, ?, ?)').run('jt-intern', 'INTERN', 'Intern Developer', null, null);

  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, job_title_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'req-01', 'REQ-01', 'Tuyển Senior Backend', 'd-eng', 'Phòng Công Nghệ', 'u-recruiter', 'jt-backend'
  );
  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, job_title_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'req-02', 'REQ-02', 'Tuyển Thực Tập Sinh', 'd-eng', 'Phòng Công Nghệ', 'u-recruiter', 'jt-intern'
  );

  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
    'cand-01', 'Lê Văn An', 'an.le@example.com', '0901234567', 'req-01', 'INTERVIEW'
  );
  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
    'cand-02', 'Trần Thị Bình', 'binh.tran@example.com', '0901234568', 'req-01', 'OFFER'
  );
  await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
    'cand-rejected', 'Phạm Văn C', 'c.pham@example.com', '0901234569', 'req-01', 'REJECTED'
  );
}

function createMockReqService(db) {
  return {
    db,
    openPolicy: {
      async notDraft() {}
    },
    async candidateAccess(candidateId, actor) {
      return { success: true };
    },
    async recruiterAssigned(requisitionId, userId) {
      if (!requisitionId) return true;
      const req = await db.prepare('SELECT recruiter_id FROM requisitions WHERE id = ?').get(requisitionId);
      return req?.recruiter_id === userId;
    },
    hiringRequisitionScope() {
      return '1=1';
    },
    recruiterScope(tableAlias, userId) {
      return {
        condition: `${tableAlias}.recruiter_id = ?`,
        params: [userId]
      };
    }
  };
}

function createMockRbac(db) {
  return {
    async getAuthorizedActor(userId, permission) {
      const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!u) return null;
      const roles = (await db.prepare(`
        SELECT r.code FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `).all(userId)).map(r => r.code);

      const perms = (await db.prepare(`
        SELECT p.code FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = ?
      `).all(userId)).map(p => p.code);

      if (permission && !perms.includes(permission) && !roles.includes('ADMIN')) {
        return null;
      }
      return {
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        roles,
        permissions: perms
      };
    }
  };
}

async function runTestsForDb(db, providerName) {
  await setupBaselineSchema(db);
  await seedData(db);

  const reqService = createMockReqService(db);
  const rbac = createMockRbac(db);
  const offerService = new OfferService(db, reqService, rbac);

  const recruiter = await rbac.getAuthorizedActor('u-recruiter', 'offer.create');
  const recruiterOther = await rbac.getAuthorizedActor('u-recruiter-other', 'offer.create');
  const candidateUser = await rbac.getAuthorizedActor('u-candidate', 'offer.read');
  const approver = await rbac.getAuthorizedActor('u-approver', 'offer.approve');

  {
    const res = await offerService.createOffer({
      candidateId: 'cand-01',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 25000000,
      allowances: 1500000,
      startDate: '2026-11-01',
      expirationDate: '2026-10-25',
      approverId: 'u-approver'
    }, recruiter);

    assert.equal(res.success, true);
    assert.equal(res.statusCode, 201);
    assert.equal(res.data.status, 'PENDING_APPROVAL');
    assert.equal(res.data.salaryMonthly, 25000000);
    assert.equal(res.data.allowances, 1500000);
    assert.equal(res.data.isOutOfBand, false);

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-01');
    assert.equal(candRow.stage, 'OFFER');
  }

  {
    const res = await offerService.createOffer({
      candidateId: 'cand-01',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 26000000,
      startDate: '2026-11-01'
    }, recruiter);

    assert.equal(res.success, false);
    assert.equal(res.statusCode, 409);
    assert.equal(res.code, 'ACTIVE_OFFER_ALREADY_EXISTS');
  }

  {
    const res = await offerService.createOffer({
      candidateId: 'cand-02',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 35000000,
      startDate: '2026-11-01'
    }, recruiter);

    assert.equal(res.success, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'SALARY_JUSTIFICATION_REQUIRED');
  }

  {
    const res = await offerService.createOffer({
      candidateId: 'cand-02',
      requisitionId: 'req-01',
      jobTitleId: 'jt-backend',
      salaryMonthly: 35000000,
      salaryJustification: 'Ứng viên có hơn 10 năm kinh nghiệm kiến trúc hệ thống phân tán, vượt chuẩn tuyển dụng.',
      allowances: 2000000,
      startDate: '2026-11-01',
      expirationDate: '2026-10-25',
      isDraft: true
    }, recruiter);

    assert.equal(res.success, true);
    assert.equal(res.statusCode, 201);
    assert.equal(res.data.status, 'DRAFT');
    assert.equal(res.data.isOutOfBand, true);

    const draftOfferId = res.data.id;

    const previewRes = await offerService.previewOffer({ offerId: draftOfferId }, recruiter);
    assert.equal(previewRes.success, true);
    assert.ok(previewRes.data.text.includes('THƯ MỜI NHẬN VIỆC'));
    assert.ok(previewRes.data.text.includes('Trần Thị Bình'));
    assert.ok(previewRes.data.text.includes('Senior Backend Engineer'));
    assert.ok(previewRes.data.text.includes('35.000.000'));
    assert.ok(previewRes.data.html.includes('THƯ MỜI NHẬN VIỆC'));

    const updateRes = await offerService.updateOffer(draftOfferId, {
      salaryMonthly: 36000000,
      salaryJustification: 'Cập nhật lý do đãi ngộ và kinh nghiệm chuyên sâu.',
      allowances: 2500000,
      submitForApproval: true
    }, recruiter);

    assert.equal(updateRes.success, true);
    assert.equal(updateRes.data.status, 'PENDING_APPROVAL');
    assert.equal(updateRes.data.salaryMonthly, 36000000);
    assert.equal(updateRes.data.allowances, 2500000);
  }

  {
    const band = await offerService.validateSalaryBand('jt-backend', 18000000);
    assert.equal(band.isOutOfBand, true);
    assert.equal(band.minSalary, 20000000);

    const bandIn = await offerService.validateSalaryBand('jt-backend', 25000000);
    assert.equal(bandIn.isOutOfBand, false);

    const bandUnset = await offerService.validateSalaryBand('jt-intern', 5000000);
    assert.equal(bandUnset.isOutOfBand, false);
  }

  {
    const offersRes = await offerService.getOffers({ viewer: recruiter });
    assert.equal(offersRes.success, true);
    assert.ok(offersRes.offers.length >= 2);
    const first = offersRes.offers[0];
    assert.ok(first.candidate);
    assert.ok(first.requisition);
    assert.ok(first.capabilities);
  }

  {
    const rejectedRes = await offerService.createOffer({
      candidateId: 'cand-rejected',
      salaryMonthly: 22000000,
      startDate: '2026-11-01'
    }, recruiter);
    assert.equal(rejectedRes.success, false);
    assert.equal(rejectedRes.statusCode, 400);
    assert.equal(rejectedRes.code, 'CANDIDATE_NOT_ELIGIBLE');

    const unauthorizedRes = await offerService.createOffer({
      candidateId: 'cand-01',
      salaryMonthly: 22000000,
      startDate: '2026-11-01'
    }, candidateUser);
    assert.equal(unauthorizedRes.success, false);
    assert.equal(unauthorizedRes.statusCode, 403);
  }

  {
    await db.prepare('INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'cand-concurrent', 'Hoàng Văn Đồng Thời', 'dongthoi@example.com', '0909999999', 'req-01', 'OFFER'
    );

    let conflictCount = 0;
    let successCount = 0;

    const p1 = offerService.createOffer({
      candidateId: 'cand-concurrent',
      salaryMonthly: 22000000,
      startDate: '2026-11-01'
    }, recruiter);

    const p2 = offerService.createOffer({
      candidateId: 'cand-concurrent',
      salaryMonthly: 22000000,
      startDate: '2026-11-01'
    }, recruiter);

    const results = await Promise.all([p1, p2]);
    for (const r of results) {
      if (r.success) successCount++;
      if (r.statusCode === 409) conflictCount++;
    }

    assert.equal(successCount, 1);
    assert.equal(conflictCount, 1);
  }

  console.log(`[PASS] ${providerName} - All S7-04 Offer Proposal tests completed successfully.`);
}

async function main() {
  console.log('[TEST] Running S7-04 Offer Proposal tests on SQLite...');
  const sqliteDb = createSqliteDb();
  await runTestsForDb(sqliteDb, 'SQLite');

  console.log('[TEST] Running S7-04 Offer Proposal tests on PGlite (PostgreSQL)...');
  const pgliteDb = await createPgliteDb();
  await runTestsForDb(pgliteDb, 'PGlite');

  console.log('[ALL PASS] S7-04 Offer Proposal suite finished.');
}

main().catch(err => {
  console.error('[FAIL] S7-04 test failure:', err);
  process.exit(1);
});
