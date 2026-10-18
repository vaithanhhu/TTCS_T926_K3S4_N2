const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');

const migrateOfferApprovals = require('../src/db/migrate-offer-approvals');
const migrateOfferDelivery = require('../src/db/migrate-offer-delivery');
const migrateOfferNegotiation = require('../src/db/migrate-offer-negotiation');
const migrateOnboardingChecklists = require('../src/db/migrate-onboarding-checklists');
const OnboardingService = require('../src/services/onboardingService');
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
    `);
    const s21 = require('../src/db/migrate-offer-proposals').source(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(s21.checksum);
    await migrateOfferApprovals.migrate(db);
    await migrateOfferDelivery.migrate(db);
    await migrateOfferNegotiation.migrate(db);
    await migrateOnboardingChecklists.migrate(db);
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
    `);
    const s21 = require('../src/db/migrate-offer-proposals').source(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(s21.checksum);
    await migrateOfferApprovals.migrate(db);
    await migrateOfferDelivery.migrate(db);
    await migrateOfferNegotiation.migrate(db);
    await migrateOnboardingChecklists.migrate(db);
  }
}

async function seedData(db) {
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-recruiter', 'recruiter@example.com', 'Nguyễn Thị Tuyển Dụng');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-hr-mgr', 'hrmanager@example.com', 'Trần Thị Trưởng Phòng HR');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-admin', 'admin@example.com', 'Admin Giám Đốc');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-it-admin', 'itadmin@example.com', 'Võ IT Quản Trị Hệ Thống');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-ops-admin', 'ops@example.com', 'Đỗ Hành Chính Văn Phòng');
  await db.prepare('INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)').run('u-other-staff', 'other@example.com', 'Nhân Viên Khác');

  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-rec', 'RECRUITER', 'Nhân viên tuyển dụng');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-hr', 'HR_MANAGER', 'Trưởng phòng nhân sự');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-adm', 'ADMIN', 'Quản trị hệ thống');
  await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run('r-it', 'IT_ADMIN', 'Quản trị IT');

  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-recruiter', 'r-rec');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-hr-mgr', 'r-hr');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-admin', 'r-adm');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run('u-it-admin', 'r-it');

  const permissions = [
    ['p-cand-read', 'candidate.read', 'Xem ứng viên'],
    ['p-cand-update', 'candidate.update', 'Cập nhật ứng viên']
  ];
  for (const [pid, code, name] of permissions) {
    await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run(pid, code, name);
  }

  const rolePermMap = [
    ['r-adm', 'p-cand-read'], ['r-adm', 'p-cand-update'],
    ['r-hr', 'p-cand-read'], ['r-hr', 'p-cand-update'],
    ['r-rec', 'p-cand-read'], ['r-rec', 'p-cand-update'],
    ['r-it', 'p-cand-read']
  ];
  for (const [rid, pid] of rolePermMap) {
    await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(rid, pid);
  }

  await db.prepare('INSERT INTO departments (id, code, name, manager_id) VALUES (?, ?, ?, ?)').run('dept-eng', 'ENG', 'Kỹ thuật Công nghệ', 'u-hr-mgr');
  await db.prepare('INSERT INTO departments (id, code, name, manager_id) VALUES (?, ?, ?, ?)').run('dept-sales', 'SALES', 'Khối Kinh Doanh', 'u-hr-mgr');

  await db.prepare('INSERT INTO job_titles (id, code, name, min_salary, max_salary) VALUES (?, ?, ?, ?, ?)').run('jt-dev', 'DEV', 'Lập trình viên', 20000000, 35000000);

  await db.prepare('INSERT INTO requisitions (id, code, title, department_id, department_name, recruiter_id, job_title_id, proposed_salary_min, proposed_salary_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('req-eng-01', 'REQ-ENG-01', 'Tuyển Kỹ sư Phần mềm', 'dept-eng', 'Kỹ thuật Công nghệ', 'u-recruiter', 'jt-dev', 20000000, 35000000);

  await db.prepare('INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)')
    .run('cand-hired-01', 'Phạm Hired Một', 'hired1@example.com', 'req-eng-01', 'HIRED');

  await db.prepare('INSERT INTO offers (id, candidate_id, requisition_id, salary_monthly, start_date, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run('off-acc-01', 'cand-hired-01', 'req-eng-01', 25000000, '2026-11-01', 'ACCEPTED');

  await db.prepare('INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)')
    .run('cand-unaccepted-01', 'Trần Chưa Chấp Nhận', 'unaccepted@example.com', 'req-eng-01', 'OFFER');

  await db.prepare('INSERT INTO offers (id, candidate_id, requisition_id, salary_monthly, start_date, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run('off-sent-01', 'cand-unaccepted-01', 'req-eng-01', 22000000, '2026-11-01', 'SENT');

  await db.prepare('INSERT INTO candidates (id, full_name, email, requisition_id, stage) VALUES (?, ?, ?, ?, ?)')
    .run('cand-screening-01', 'Lê Sơ Loại', 'screening@example.com', 'req-eng-01', 'SCREENING');
}

async function runTestsFor(provider) {
  console.log(`\n========================================`);
  console.log(`RUNNING S7-08 ONBOARDING TESTS FOR: ${provider.toUpperCase()}`);
  console.log(`========================================\n`);

  const db = provider === 'postgres' ? await createPgliteDb() : createSqliteDb();
  await setupBaselineSchema(db);
  await seedData(db);

  const reqService = new RequisitionService(db);
  const onboardingService = new OnboardingService(db, reqService);

  const actorHrMgr = { id: 'u-hr-mgr', email: 'hrmanager@example.com', fullName: 'Trần Thị Trưởng Phòng HR', roles: ['HR_MANAGER'] };
  const actorAdmin = { id: 'u-admin', email: 'admin@example.com', fullName: 'Admin Giám Đốc', roles: ['ADMIN'] };
  const actorRecruiter = { id: 'u-recruiter', email: 'recruiter@example.com', fullName: 'Nguyễn Thị Tuyển Dụng', roles: ['RECRUITER'] };
  const actorIt = { id: 'u-it-admin', email: 'itadmin@example.com', fullName: 'Võ IT Quản Trị Hệ Thống', roles: ['IT_ADMIN'] };
  const actorOther = { id: 'u-other-staff', email: 'other@example.com', fullName: 'Nhân Viên Khác', roles: [] };

  console.log('Test 1: Verify seeded default template');
  const defaultTemplates = await onboardingService.getTemplates();
  assert.equal(defaultTemplates.success, true);
  assert.ok(defaultTemplates.data.length >= 1);
  const defTmpl = defaultTemplates.data.find(t => t.id === 'tmpl-default');
  assert.ok(defTmpl, 'Default template tmpl-default must exist');
  assert.equal(defTmpl.items.length, 5);
  const categoriesPresent = new Set(defTmpl.items.map(i => i.category));
  assert.ok(categoriesPresent.has('ACCOUNT'), 'Must have ACCOUNT category');
  assert.ok(categoriesPresent.has('EQUIPMENT'), 'Must have EQUIPMENT category');
  assert.ok(categoriesPresent.has('WORKSPACE'), 'Must have WORKSPACE category');
  assert.ok(categoriesPresent.has('DOCUMENTATION'), 'Must have DOCUMENTATION category');
  console.log('  -> Passed: Default template covers all 4 mandatory task categories');

  console.log('Test 2: Create department-specific template for dept-eng');
  const createTmplRes = await onboardingService.createTemplate({
    name: 'Quy trình Onboarding Khối Công nghệ',
    departmentId: 'dept-eng',
    description: 'Checklist chuẩn bị tài nguyên kỹ thuật cho Kỹ sư phần mềm',
    items: [
      { category: 'ACCOUNT', title: 'Tạo email và tài khoản GitHub Org', description: 'Google Workspace + GitHub', defaultAssigneeId: 'u-it-admin', relativeDueDays: 1 },
      { category: 'ACCOUNT', title: 'Cấp quyền AWS sandbox và VPN', description: 'Truy cập môi trường dev', defaultAssigneeId: 'u-it-admin', relativeDueDays: 1 },
      { category: 'EQUIPMENT', title: 'Cấp Macbook Pro M3 32GB', description: 'Máy tính kèm màn hình 4K', defaultAssigneeId: 'u-it-admin', relativeDueDays: 1 },
      { category: 'WORKSPACE', title: 'Bố trí chỗ ngồi tại Tầng 4 Tech Hub', description: 'Khu vực engineering', defaultAssigneeId: 'u-ops-admin', relativeDueDays: 1 },
      { category: 'DOCUMENTATION', title: 'Ký thỏa thuận NDA và HĐLĐ', description: 'Bảo mật thông tin mã nguồn', defaultAssigneeId: 'u-hr-mgr', relativeDueDays: 3 }
    ]
  }, actorHrMgr);
  assert.equal(createTmplRes.success, true);
  assert.equal(createTmplRes.statusCode, 201);
  const engTmplId = createTmplRes.data.id;
  assert.ok(engTmplId);
  console.log('  -> Passed: Department template created successfully');

  console.log('Test 3: Recruiter cannot create template (RBAC check)');
  const recCreateTmplRes = await onboardingService.createTemplate({
    name: 'Mẫu bất hợp lệ',
    items: [{ category: 'ACCOUNT', title: 'Task' }]
  }, actorRecruiter);
  assert.equal(recCreateTmplRes.success, false);
  assert.equal(recCreateTmplRes.statusCode, 403);
  console.log('  -> Passed: Non-HR Manager prevented from creating template');

  console.log('Test 4: Cannot initialize onboarding for candidate without accepted offer');
  const failUnacceptedRes = await onboardingService.initializeOnboarding({
    candidateId: 'cand-unaccepted-01'
  }, actorHrMgr);
  assert.equal(failUnacceptedRes.success, false);
  assert.equal(failUnacceptedRes.statusCode, 400);
  assert.equal(failUnacceptedRes.code, 'OFFER_NOT_ACCEPTED');

  const failScreeningRes = await onboardingService.initializeOnboarding({
    candidateId: 'cand-screening-01'
  }, actorHrMgr);
  assert.equal(failScreeningRes.success, false);
  assert.equal(failScreeningRes.statusCode, 400);
  assert.equal(failScreeningRes.code, 'OFFER_NOT_ACCEPTED');
  console.log('  -> Passed: Reject onboarding for candidates without accepted offer');

  console.log('Test 5: Recruiter cannot initialize onboarding (RBAC check)');
  const failRecruiterInit = await onboardingService.initializeOnboarding({
    candidateId: 'cand-hired-01'
  }, actorRecruiter);
  assert.equal(failRecruiterInit.success, false);
  assert.equal(failRecruiterInit.statusCode, 403);
  console.log('  -> Passed: Recruiter cannot initialize onboarding');

  console.log('Test 6: HR Manager initializes onboarding for cand-hired-01 (Department Template Auto-selection)');
  const initRes = await onboardingService.initializeOnboarding({
    candidateId: 'cand-hired-01',
    startDate: '2026-11-01'
  }, actorHrMgr);
  assert.equal(initRes.success, true);
  assert.equal(initRes.statusCode, 201);
  assert.equal(initRes.data.templateId, engTmplId, 'Must auto-select dept-eng template');
  assert.equal(initRes.data.progressPercentage, 0);
  assert.equal(initRes.data.status, 'IN_PROGRESS');
  assert.equal(initRes.data.items.length, 5);
  const checklistId = initRes.data.id;
  console.log('  -> Passed: Onboarding instantiated with department template');

  console.log('Test 7: Template modification isolation check');
  await db.prepare("UPDATE onboarding_template_items SET title = 'SỬA ĐỔI SAU ĐÓ' WHERE template_id = ?").run(engTmplId);
  const candidateOnboarding = await onboardingService.getOnboardingByCandidate('cand-hired-01', actorHrMgr);
  assert.equal(candidateOnboarding.success, true);
  const instantiatedTitles = candidateOnboarding.data.items.map(i => i.title);
  assert.ok(!instantiatedTitles.includes('SỬA ĐỔI SAU ĐÓ'), 'Instantiated checklist items must NOT be altered by template edits');
  console.log('  -> Passed: Modifying template does not alter existing instantiated checklist');

  console.log('Test 8: Prevent duplicate active onboarding initialization');
  const duplicateInitRes = await onboardingService.initializeOnboarding({
    candidateId: 'cand-hired-01'
  }, actorHrMgr);
  assert.equal(duplicateInitRes.success, false);
  assert.equal(duplicateInitRes.statusCode, 409);
  assert.equal(duplicateInitRes.code, 'ONBOARDING_ALREADY_EXISTS');
  console.log('  -> Passed: Duplicate onboarding initialization prevented');

  console.log('Test 9: Verify task categories, assignees, and due dates');
  const fullChecklist = candidateOnboarding.data;
  assert.equal(fullChecklist.totalCount, 5);
  assert.equal(fullChecklist.completedCount, 0);
  assert.equal(fullChecklist.progressPercentage, 0);
  assert.ok(fullChecklist.categories.ACCOUNT.total === 2);
  assert.ok(fullChecklist.categories.EQUIPMENT.total === 1);
  assert.ok(fullChecklist.categories.WORKSPACE.total === 1);
  assert.ok(fullChecklist.categories.DOCUMENTATION.total === 1);

  const itItem = fullChecklist.items.find(i => i.assigneeId === 'u-it-admin');
  assert.ok(itItem, 'Item assigned to IT Admin must exist');
  assert.equal(itItem.dueDate, '2026-11-02');
  console.log('  -> Passed: Category groups, assignees, and due dates verified');

  console.log('Test 10: Assignee updates item status & RBAC restrictions');
  const unauthUpdate = await onboardingService.updateChecklistItem(checklistId, itItem.id, {
    status: 'COMPLETED'
  }, actorOther);
  assert.equal(unauthUpdate.success, false);
  assert.equal(unauthUpdate.statusCode, 403);

  const nonMgrReassign = await onboardingService.updateChecklistItem(checklistId, itItem.id, {
    assigneeId: 'u-other-staff'
  }, actorIt);
  assert.equal(nonMgrReassign.success, false);
  assert.equal(nonMgrReassign.statusCode, 403);

  const itValidUpdate = await onboardingService.updateChecklistItem(checklistId, itItem.id, {
    status: 'COMPLETED',
    notes: 'Đã tạo xong tài khoản GitHub Org'
  }, actorIt);
  assert.equal(itValidUpdate.success, true);
  assert.equal(itValidUpdate.data.progressPercentage, 20);
  assert.equal(itValidUpdate.data.completedCount, 1);
  console.log('  -> Passed: Assignee successfully completed their task; unauthorized update rejected');

  console.log('Test 11: Idempotency of completing items');
  const repeatComplete = await onboardingService.updateChecklistItem(checklistId, itItem.id, {
    status: 'COMPLETED'
  }, actorIt);
  assert.equal(repeatComplete.success, true);
  assert.equal(repeatComplete.data.progressPercentage, 20);
  assert.equal(repeatComplete.data.completedCount, 1);
  console.log('  -> Passed: Re-completing item is idempotent');

  console.log('Test 12: Complete remaining items and verify candidate stage -> ONBOARDED');
  for (const item of fullChecklist.items) {
    if (item.id === itItem.id) continue;
    const res = await onboardingService.updateChecklistItem(checklistId, item.id, {
      status: 'COMPLETED'
    }, actorHrMgr);
    assert.equal(res.success, true);
  }

  const finalChecklist = await onboardingService.getOnboardingByCandidate('cand-hired-01', actorHrMgr);
  assert.equal(finalChecklist.data.progressPercentage, 100);
  assert.equal(finalChecklist.data.completedCount, 5);
  assert.equal(finalChecklist.data.status, 'COMPLETED');

  const candRecord = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-hired-01');
  assert.equal(candRecord.stage, 'ONBOARDED', 'Candidate stage must automatically transition to ONBOARDED');

  const history = await db.prepare('SELECT * FROM candidate_status_history WHERE candidate_id = ? AND action = ?').get('cand-hired-01', 'ONBOARD_COMPLETE');
  assert.ok(history, 'Audit history entry for ONBOARD_COMPLETE must exist');
  assert.equal(history.before_stage, 'HIRED');
  assert.equal(history.after_stage, 'ONBOARDED');
  console.log('  -> Passed: 100% completion transitions candidate stage to ONBOARDED');

  console.log('Test 13: Reopening an item reverts checklist to IN_PROGRESS and candidate stage to HIRED');
  const reopenRes = await onboardingService.updateChecklistItem(checklistId, itItem.id, {
    status: 'PENDING'
  }, actorHrMgr);
  assert.equal(reopenRes.success, true);
  assert.equal(reopenRes.data.status, 'IN_PROGRESS');
  assert.equal(reopenRes.data.progressPercentage, 80);

  const candReopened = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-hired-01');
  assert.equal(candReopened.stage, 'HIRED', 'Candidate stage must revert to HIRED when an onboarding item is reopened');
  console.log('  -> Passed: Reopening item properly reverts pipeline stage');

  console.log('Test 14: List checklists with filters');
  const listRes = await onboardingService.listChecklists({ departmentId: 'dept-eng' }, actorHrMgr);
  assert.equal(listRes.success, true);
  assert.equal(listRes.data.length, 1);
  assert.equal(listRes.data[0].candidate_id, 'cand-hired-01');
  assert.equal(listRes.data[0].department_name, 'Kỹ thuật Công nghệ');
  console.log('  -> Passed: Checklist list and filtering verified');

  if (provider === 'postgres') {
    await db.close();
  }
  console.log(`\nALL TESTS PASSED FOR ${provider.toUpperCase()}!\n`);
}

async function main() {
  await runTestsFor('sqlite');
  await runTestsFor('postgres');
  console.log('🎉 ALL S7-08 ONBOARDING TESTS COMPLETED SUCCESSFULLY (SQLITE & POSTGRES)!');
}

main().catch(err => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
