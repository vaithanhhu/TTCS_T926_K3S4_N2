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
    console.log('\n--- Kiểm thử S4-03: Nộp hồ sơ ứng tuyển kèm CV ---');
    const validCandidateEmail = `cand.test.${Date.now()}@example.com`;
    const validPdfFile = {
      filename: 'my_cv.pdf',
      mimeType: 'application/pdf',
      buffer: createSamplePdfBuffer('Nguyễn Văn An\nEmail: ' + validCandidateEmail + '\nPhone: 0912345678')
    };

    // 1. Nộp hồ sơ hợp lệ thành công
    const applyRes = await portalService.submitApplication({
      jobPostingId: testJobId,
      fullName: 'Nguyễn Văn An',
      email: validCandidateEmail,
      phoneNumber: '0912345678',
      source: 'WEBSITE',
      coverLetter: 'Tôi mong muốn ứng tuyển vị trí này.'
    }, validPdfFile, '127.0.0.1');

    assert.equal(applyRes.success, true, 'Nộp hồ sơ hợp lệ phải thành công');
    assert.ok(applyRes.data.trackingCode && applyRes.data.trackingCode.startsWith('TRK-'), 'Phải sinh mã tra cứu TRK- duy nhất');
    const generatedTrackingCode = applyRes.data.trackingCode;
    console.log(`✓ Nộp hồ sơ hợp lệ thành công với Mã tra cứu: ${generatedTrackingCode}`);

    // 2. Từ chối nộp trùng cùng vị trí với cùng email
    const duplicateRes = await portalService.submitApplication({
      jobPostingId: testJobId,
      fullName: 'Nguyễn Văn An',
      email: validCandidateEmail,
      phoneNumber: '0912345678'
    }, validPdfFile, '127.0.0.1');
    assert.equal(duplicateRes.success, false, 'Phải từ chối nộp trùng cùng email vào cùng vị trí');
    assert.equal(duplicateRes.code, 'APPLICATION_DUPLICATE_JOB');
    console.log('✓ Chống nộp trùng email cùng vị trí hoạt động chính xác (APPLICATION_DUPLICATE_JOB)');

    // 3. Từ chối tệp sai định dạng (ví dụ file .exe)
    const invalidExtFile = {
      filename: 'malware.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('malicious content')
    };
    const invalidExtRes = await portalService.submitApplication({
      jobPostingId: testJobId,
      fullName: 'Hacker',
      email: 'hacker@example.com',
      phoneNumber: '0999999999'
    }, invalidExtFile, '127.0.0.1');
    assert.equal(invalidExtRes.success, false);
    assert.equal(invalidExtRes.code, 'CV_FILE_INVALID_EXTENSION');
    console.log('✓ Chặn tệp sai phần mở rộng không phải PDF/DOCX');

    // 4. Từ chối tệp PDF giả mạo chữ ký magic bytes
    const fakePdfFile = {
      filename: 'fake.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('NOT_A_REAL_PDF_MAGIC_BYTES_HEADER')
    };
    const fakePdfRes = await portalService.submitApplication({
      jobPostingId: testJobId,
      fullName: 'Test Fake',
      email: 'fake@example.com',
      phoneNumber: '0988888888'
    }, fakePdfFile, '127.0.0.1');
    assert.equal(fakePdfRes.success, false);
    assert.equal(fakePdfRes.code, 'CV_FILE_INVALID_SIGNATURE');
    console.log('✓ Chặn tệp PDF giả mạo sai magic bytes %PDF');

    // 5. Từ chối tệp vượt quá 10MB
    const oversizedFile = {
      filename: 'huge_cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(11 * 1024 * 1024) // 11MB
    };
    const oversizedRes = await portalService.submitApplication({
      jobPostingId: testJobId,
      fullName: 'Test Big',
      email: 'big@example.com',
      phoneNumber: '0977777777'
    }, oversizedFile, '127.0.0.1');
    assert.equal(oversizedRes.success, false);
    assert.equal(oversizedRes.code, 'CV_FILE_TOO_LARGE');
    console.log('✓ Chặn tệp vượt quá dung lượng tối đa 10MB');

    // 6. Kiểm tra Anti-spam IP rate limiting
    console.log('Kiểm tra IP rate limiting (tối đa 5 lần/giờ)...');
    const testRateIp = '198.51.100.99';
    for (let i = 0; i < 5; i++) {
      await portalService.checkRateLimit(testRateIp, 'APPLY', 5);
    }
    const rateLimitCheck = await portalService.checkRateLimit(testRateIp, 'APPLY', 5);
    assert.equal(rateLimitCheck.allowed, false, 'Lần thứ 6 từ cùng IP phải bị chặn');
    assert.equal(rateLimitCheck.code, 'RATE_LIMIT_EXCEEDED');
    console.log('✓ IP rate limiting chặn chính xác sau 5 lần yêu cầu trong 1 giờ');

    // =============================================================
    // TEST S4-04: BÓC TÁCH THÔNG TIN TỪ CV PDF
    // =============================================================
    console.log('\n--- Kiểm thử S4-04: Bóc tách thông tin từ CV PDF (pdf-parse) ---');
    const candidateRecord = await db.prepare('SELECT id FROM candidates WHERE email=?').get(validCandidateEmail);
    assert.ok(candidateRecord, 'Ứng viên vừa tạo phải tồn tại trong DB');

    const parseRes = await portalService.parseCvPdf(candidateRecord.id, null, recruiter);
    assert.equal(parseRes.success, true, 'Bóc tách PDF có text phải thành công');
    assert.ok(parseRes.parsedData, 'Phải có dữ liệu trích xuất');
    console.log('✓ Bóc tách CV thành công, dữ liệu trích xuất:', parseRes.parsedData);
    assert.ok(parseRes.parsedData.email.includes('@'), 'Phải trích xuất được email từ CV');

    // =============================================================
    // TEST S4-05: TRA CỨU TRẠNG THÁI HỒ SƠ
    // =============================================================
    console.log('\n--- Kiểm thử S4-05: Tra cứu trạng thái hồ sơ ---');
    // 1. Tra cứu đúng mã và đúng email
    const lookupSuccess = await portalService.lookupStatus({
      trackingCode: generatedTrackingCode,
      email: validCandidateEmail
    }, '127.0.0.1');
    assert.equal(lookupSuccess.success, true);
    assert.equal(lookupSuccess.data.statusCode, 'RECEIVED');
    assert.equal(lookupSuccess.data.statusLabel, 'Đã nhận hồ sơ');
    assert.strictEqual(lookupSuccess.data.internalNotes, undefined, 'Không được để lộ internal notes');
    assert.strictEqual(lookupSuccess.data.interviewer, undefined, 'Không được để lộ interviewer');
    console.log(`✓ Tra cứu đúng trả về trạng thái tổng quát: "${lookupSuccess.data.statusLabel}"`);

    // 2. Tra cứu sai email hoặc sai mã không tiết lộ thông tin
    const lookupFail = await portalService.lookupStatus({
      trackingCode: generatedTrackingCode,
      email: 'wrong.email@company.com'
    }, '127.0.0.1');
    assert.equal(lookupFail.success, false);
    assert.equal(lookupFail.code, 'LOOKUP_INVALID_CREDENTIALS');
    console.log('✓ Sai email trả về thông báo an toàn, không rò rỉ dữ liệu');

    // =============================================================
    // TEST S4-06: ỨNG VIÊN RÚT HỒ SƠ
    // =============================================================
    console.log('\n--- Kiểm thử S4-06: Ứng viên rút hồ sơ ---');
    // Lấy token rút hồ sơ từ database
    const tokenRow = await db.prepare('SELECT token_hash FROM application_tracking_tokens WHERE candidate_id=?').get(candidateRecord.id);
    assert.ok(tokenRow, 'Phải có bản ghi token rút hồ sơ');

    // Giả lập ứng viên rút hồ sơ bằng token hợp lệ
    // Vì token_hash lưu hash SHA-256, hãy test rút hồ sơ qua token
    const testRawToken = 'wtoken-' + crypto.randomUUID();
    const testTokenHash = crypto.createHash('sha256').update(testRawToken).digest('hex');
    await db.prepare('UPDATE application_tracking_tokens SET token_hash=? WHERE candidate_id=?').run(testTokenHash, candidateRecord.id);

    const withdrawRes = await portalService.withdrawApplication({ withdrawToken: testRawToken });
    assert.equal(withdrawRes.success, true, 'Rút hồ sơ bằng token hợp lệ phải thành công');
    assert.equal(withdrawRes.data.stage, 'WITHDRAWN');
    console.log('✓ Rút hồ sơ thành công, trạng thái chuyển sang WITHDRAWN');

    // Kiểm tra trạng thái tra cứu sau khi rút
    const lookupAfterWithdraw = await portalService.lookupStatus({
      trackingCode: generatedTrackingCode,
      email: validCandidateEmail
    }, '127.0.0.1');
    assert.equal(lookupAfterWithdraw.data.statusCode, 'WITHDRAWN');
    console.log('✓ Trạng thái công khai cập nhật chính xác sang: "Ứng viên đã rút hồ sơ"');

    // =============================================================
    // TEST S4-07: NHÂN SỰ NỘI BỘ GIỚI THIỆU ỨNG VIÊN
    // =============================================================
    console.log('\n--- Kiểm thử S4-07: Nhân sự nội bộ giới thiệu ứng viên ---');
    const referralEmail = `referred.${Date.now()}@example.com`;
    const referralCv = {
      filename: 'referral_cv.pdf',
      mimeType: 'application/pdf',
      buffer: createSamplePdfBuffer('Lê Văn C - 0988776655')
    };

    const referRes = await portalService.referCandidate({
      requisitionId: testReqId,
      fullName: 'Lê Văn C',
      email: referralEmail,
      phoneNumber: '0988776655',
      notes: 'Đồng nghiệp cũ tại công ty trước, rất giỏi về distributed systems.'
    }, referralCv, employee);

    assert.equal(referRes.success, true, 'Nhân viên giới thiệu ứng viên phải thành công');
    assert.equal(referRes.data.isInternalReferral, true);
    assert.equal(referRes.data.referrerId, employee.id);
    console.log(`✓ Giới thiệu ứng viên thành công, gắn đúng referrerId: ${employee.id}`);

    // Nhân viên xem danh sách các hồ sơ mình đã giới thiệu
    const myReferrals = await portalService.getMyReferrals(employee);
    assert.ok(Array.isArray(myReferrals), 'Phải trả về danh sách giới thiệu của nhân viên');
    assert.ok(myReferrals.some(r => r.candidateEmail === referralEmail), 'Phải có hồ sơ vừa giới thiệu');
    console.log(`✓ Người giới thiệu xem được danh sách (${myReferrals.length} hồ sơ) với trạng thái tổng quát`);

    // =============================================================
    // TEST S4-08: GỠ TIN VÀ TỰ ĐỘNG ẨN TIN HẾT HẠN
    // =============================================================
    console.log('\n--- Kiểm thử S4-08: Gỡ tin và tự động ẩn tin hết hạn ---');
    // Tạo 1 tin quá hạn
    const expiredJobId = 'job-expired-' + crypto.randomUUID().slice(0, 8);
    await db.prepare(`
      INSERT INTO job_postings (id, requisition_id, title, job_description, candidate_requirements, status, application_deadline, version, created_by, updated_by)
      VALUES (?, ?, 'Vị trí đã hết hạn', 'Mô tả', 'Yêu cầu', 'PUBLISHED', '2020-01-01', 1, ?, ?)
    `).run(expiredJobId, testReqId, admin.id, admin.id);

    // Chạy tác vụ quét tin hết hạn
    const expireTaskRes = await portalService.expireOverdueJobs(admin);
    assert.ok(expireTaskRes.expiredCount >= 1, 'Tác vụ phải phát hiện và gỡ ít nhất 1 tin quá hạn');
    console.log(`✓ Tác vụ expireOverdueJobs đã ẩn thành công ${expireTaskRes.expiredCount} tin quá hạn`);

    // Kiểm tra tin đã hết hạn không xuất hiện ở danh sách công khai
    const checkPublic = await publicationService.publicList(expiredJobId);
    assert.equal(checkPublic.length, 0, 'Tin hết hạn tuyệt đối không xuất hiện ở cổng công khai');
    console.log('✓ Tin hết hạn biến mất khỏi cổng công khai ngay lập tức');

    // =============================================================
    // TEST S4-09: HỒ SƠ ỨNG VIÊN HỢP NHẤT & IDOR PERMISSION
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
