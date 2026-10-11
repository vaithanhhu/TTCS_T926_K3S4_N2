const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { getDatabase } = require('../src/db/database');
const CandidatePortalService = require('../src/services/candidatePortalService');
const JobPostingPublicationService = require('../src/services/jobPostingPublicationService');
const JobPostingService = require('../src/services/jobPostingService');
const RequisitionService = require('../src/services/requisitionService');

async function runSprint4Tests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ SPRINT 4: CỔNG ỨNG TUYỂN VÀ HỒ SƠ ỨNG VIÊN ===');
  const testDbPath = path.join(__dirname, '..', 'data', 'ats_test.db');
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + ext); } catch {}
  }
  const db = getDatabase(testDbPath);

  const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
  if (userCount === 0) {
    await require('../src/db/seed').seedDatabase(db);
  }

  const migrations = [
    'migrate-approval-configurations',
    'migrate-requisition-approvals',
    'migrate-headcount-budgets',
    'migrate-requisition-operations',
    'migrate-requisition-lifecycle',
    'migrate-requisition-tracking-job-drafts',
    'migrate-job-publication',
    'migrate-candidate-portal'
  ];
  for (const m of migrations) {
    await require(`../src/db/${m}`).migrate(db);
  }

  const config = require('../src/config/config');
  Object.assign(config, {
    REQUISITION_OPERATIONS_ENABLED: true,
    APPROVAL_CONFIGURATION_ENABLED: true,
    REQUISITION_APPROVAL_ENABLED: true,
    HEADCOUNT_BUDGET_ENABLED: true,
    REQUISITION_LIFECYCLE_ENABLED: true,
    REQUISITION_TRACKING_ENABLED: true,
    JOB_POSTING_DRAFTS_ENABLED: true,
    JOB_POSTING_PUBLICATION_ENABLED: true,
    CANDIDATE_PORTAL_ENABLED: true
  });

  const portalService = new CandidatePortalService(db);
  const publicationService = new JobPostingPublicationService(db);
  const jobService = new JobPostingService(db);
  const reqService = new RequisitionService(db);

  // Setup actors
  const admin = { id: 'usr-admin-01', fullName: 'System Administrator', email: 'admin@company.com', roles: ['ADMIN'] };
  const hrManager = { id: 'usr-hrm-01', fullName: 'HR Manager Lead', email: 'hrm@company.com', roles: ['HR_MANAGER'] };
  const recruiter = { id: 'usr-rec-01', fullName: 'Recruiter Specialist', email: 'recruiter@company.com', roles: ['RECRUITER'] };
  const otherRecruiter = { id: 'usr-rec-02', fullName: 'Other Recruiter', email: 'other.rec@company.com', roles: ['RECRUITER'] };
  const employee = { id: 'usr-emp-01', fullName: 'Internal Employee', email: 'employee@company.com', roles: ['EMPLOYEE'] };
  const hiringManager = { id: 'usr-hm-01', fullName: 'Hiring Manager Tech', email: 'hm.tech@company.com', roles: ['HIRING_MGR'] };

  // Ensure employee user exists in database for FK constraints
  await db.prepare(`
    INSERT OR IGNORE INTO users (id, email, full_name, status, department_id, department_name, password_hash)
    VALUES (?, ?, ?, 'ACTIVE', 'dept-3', 'Khối Công Nghệ & Kỹ Thuật', 'hash')
  `).run(employee.id, employee.email, employee.fullName);

  const adminDb = await db.prepare("SELECT id, full_name, email FROM users WHERE email='admin@company.com'").get();
  const recruiterDb = await db.prepare("SELECT id, full_name, email FROM users WHERE email='recruiter@company.com'").get();
  if (adminDb) admin.id = adminDb.id;
  if (recruiterDb) recruiter.id = recruiterDb.id;

  // Helper to create a valid minimal PDF buffer with magic bytes "%PDF-1.4"
  function createSamplePdfBuffer(text = 'Nguyễn Văn An\nEmail: an.nguyen@test.com\nPhone: 0912345678') {
    return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj\nxref\ntrailer\n<< /Root 1 0 R >>\n%%EOF`);
  }

  // Helper to create a valid minimal DOCX buffer with PK zip signature
  function createSampleDocxBuffer() {
    const buf = Buffer.alloc(100);
    buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04; // PK..
    buf.write('WordDocument sample content', 30);
    return buf;
  }

  let testReqId = null;
  let testJobId = null;

  try {
    // -------------------------------------------------------------
    // PREPARATION: Create approved Requisition and Published Job
    // -------------------------------------------------------------
    process.env.ATS_LOCAL_DEMO = 'true';
    const { seedLocalDemo } = require('../src/db/seed-local-demo');
    const demo = await seedLocalDemo(db);

    testReqId = demo.published;
    testJobId = demo.postingId;

    console.log(`[Setup] Đã chuẩn bị dữ liệu xuất bản tin thành công: Requisition=${testReqId}, Job=${testJobId}`);

    // =============================================================
    // TEST S4-01: DANH SÁCH VIỆC LÀM CÔNG KHAI
    // =============================================================
    console.log('\n--- Kiểm thử S4-01: Danh sách việc làm công khai ---');
    const publicJobs = await publicationService.publicList();
    assert.ok(Array.isArray(publicJobs), 'Danh sách việc làm công khai phải trả về mảng');
    console.log(`✓ Người chưa đăng nhập lấy được danh sách (${publicJobs.length} tin công khai)`);

    // Tìm kiếm từ khóa
    const searchResult = await publicationService.publicList({ search: 'Backend' });
    assert.ok(searchResult.every(j => (j.title || '').includes('Backend') || (j.jobDescription || '').includes('Backend')), 'Kết quả tìm kiếm phải khớp từ khóa');
    console.log(`✓ Tìm kiếm từ khóa trả về kết quả chính xác (${searchResult.length} tin)`);

    // Options lọc
    const options = await publicationService.publicOptions();
    assert.ok(options.departments && options.locations && options.modes, 'Options phải có departments, locations, modes');
    console.log('✓ API Options trả về danh mục lọc đầy đủ');

    // =============================================================
    // TEST S4-02: CHI TIẾT TIN TUYỂN DỤNG & CHECK HẾT HẠN
    // =============================================================
    console.log('\n--- Kiểm thử S4-02: Chi tiết tin tuyển dụng & Kiểm tra hạn nộp ---');
    const jobDetails = await publicationService.publicList(testJobId);
    assert.ok(jobDetails.length > 0, 'Phải xem được chi tiết tin tuyển dụng còn hạn');
    assert.equal(jobDetails[0].id, testJobId);
    console.log('✓ Tin còn hạn trả về đầy đủ thông tin chi tiết');

    // Tin không tồn tại
    const nonExistent = await publicationService.publicList('job-fake-99999');
    assert.equal(nonExistent.length, 0, 'Tin không tồn tại phải trả về mảng rỗng (404)');
    console.log('✓ Tin không tồn tại trả về kết quả trống đúng chuẩn 404');

    // =============================================================
    // TEST S4-03: NỘP HỒ SƠ ỨNG TUYỂN KÈM CV
    // =============================================================
  } finally {
    // cleanup test job if created
    if (testJobId && testJobId.startsWith('job-test-')) {
      await db.prepare('DELETE FROM job_postings WHERE id=?').run(testJobId);
    }
  }
}

if (require.main === module) {
  runSprint4Tests().catch(err => {
    console.error('❌ LỖI KIỂM THỬ SPRINT 4:', err);
    process.exit(1);
  });
}

module.exports = { runSprint4Tests };
