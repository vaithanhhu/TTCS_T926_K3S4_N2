const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const CandidateManualEntryService = require('../src/services/candidateManualEntryService');
const CandidateManualEntryController = require('../src/controllers/candidateManualEntryController');

/**
 * ==============================================================================
 * TEST SUITE: USER STORY S5-08 / SCRUM-118
 * ==============================================================================
 * 
 * Nội dung: Là Nhân viên tuyển dụng, tôi muốn thêm ứng viên thủ công vào một vị trí,
 * để đưa được ứng viên tìm từ LinkedIn vào cùng một pipeline.
 * 
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Nhập tay thông tin và tải CV cho ứng viên tìm được từ nguồn khác
 *             (Họ tên, email, phone, requisition_id, source_id như LinkedIn/Headhunter,
 *              kinh nghiệm, lương kỳ vọng, ghi chú và tệp CV đính kèm PDF/DOCX <= 10MB)
 *   • AC-02: Ứng viên thêm tay vẫn đi qua đúng luồng phát hiện trùng
 *             (Kiểm tra trùng lặp theo Email hoặc Số điện thoại trên cùng vị trí và
 *              cảnh báo trùng lặp chéo trên toàn hệ thống)
 * ==============================================================================
 */

function setupDatabase() {
  const db = new DatabaseSync(':memory:');

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      locked_until TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE role_permissions (
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      manager_id TEXT NOT NULL
    );

    CREATE TABLE recruitment_catalog_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, code)
    );

    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      department_id TEXT,
      department_name TEXT,
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      created_by TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );

    CREATE TABLE requisition_recruiter_supports (
      requisition_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (requisition_id, user_id)
    );

    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      requisition_id TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      stage TEXT NOT NULL DEFAULT 'NEW',
      source_id TEXT,
      experience_years INTEGER NOT NULL DEFAULT 1,
      current_company TEXT,
      expected_salary TEXT,
      notes TEXT,
      tracking_code TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_documents (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'CV',
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      before_stage TEXT,
      after_stage TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_notes (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      note_text TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

// Tạo mock PDF buffer hợp lệ (%PDF-1.4...)
function createValidPdfBuffer(content = 'Sample CV text') {
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from(content),
    Buffer.from('\n%%EOF')
  ]);
}

// Tạo mock DOCX buffer hợp lệ (PK\x03\x04...)
function createValidDocxBuffer(content = 'Sample DOCX text') {
  return Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x03, 0x04]),
    Buffer.from(content)
  ]);
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S5-08 / SCRUM-118');
  console.log('Là Nhân viên tuyển dụng, tôi muốn thêm ứng viên thủ công vào một vị trí,');
  console.log('để đưa được ứng viên tìm từ LinkedIn vào cùng một pipeline.');
  console.log('================================================================\n');

  const db = setupDatabase();
  const service = new CandidateManualEntryService(db);

  let passCount = 0;
  function recordPass(testName) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  }

  // --- DỮ LIỆU FIXTURE ---
  // 1. Phân quyền và Người dùng
  db.prepare(`INSERT INTO roles VALUES ('r-rec', 'RECRUITER', 'Nhân viên tuyển dụng')`).run();
  db.prepare(`INSERT INTO roles VALUES ('r-admin', 'ADMIN', 'Quản trị viên')`).run();
  db.prepare(`INSERT INTO roles VALUES ('r-hr', 'HR_MANAGER', 'Trưởng phòng Nhân sự')`).run();
  db.prepare(`INSERT INTO roles VALUES ('r-int', 'INTERVIEWER', 'Người phỏng vấn')`).run();

  db.prepare(`INSERT INTO permissions VALUES ('p-cand-create', 'candidate.create', 'Tạo hồ sơ ứng viên', 'CANDIDATES', 'Thêm hồ sơ')`).run();
  db.prepare(`INSERT INTO permissions VALUES ('p-cand-read', 'candidate.read', 'Xem hồ sơ ứng viên', 'CANDIDATES', 'Xem hồ sơ')`).run();

  db.prepare(`INSERT INTO role_permissions VALUES ('r-rec', 'p-cand-create')`).run();
  db.prepare(`INSERT INTO role_permissions VALUES ('r-rec', 'p-cand-read')`).run();
  db.prepare(`INSERT INTO role_permissions VALUES ('r-admin', 'p-cand-create')`).run();
  db.prepare(`INSERT INTO role_permissions VALUES ('r-hr', 'p-cand-create')`).run();

  // Người dùng
  const recruiterAssigned = { id: 'usr-rec-assigned', email: 'recruiter.assigned@cty.vn', fullName: 'Lê Recruiter Chính', roles: ['RECRUITER'] };
  const recruiterSupport = { id: 'usr-rec-support', email: 'recruiter.support@cty.vn', fullName: 'Phạm Recruiter Hỗ Trợ', roles: ['RECRUITER'] };
  const recruiterOutside = { id: 'usr-rec-outside', email: 'recruiter.outside@cty.vn', fullName: 'Trần Recruiter Ngoài', roles: ['RECRUITER'] };
  const adminUser = { id: 'usr-admin', email: 'admin@cty.vn', fullName: 'Vũ Quản Trị Viên', roles: ['ADMIN'] };
  const interviewerUser = { id: 'usr-interviewer', email: 'interviewer@cty.vn', fullName: 'Đặng Phỏng Vấn Viên', roles: ['INTERVIEWER'] };

  for (const u of [recruiterAssigned, recruiterSupport, recruiterOutside, adminUser, interviewerUser]) {
    db.prepare(`INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, 'ACTIVE')`).run(u.id, u.email, u.fullName);
  }

  // Gán role
  db.prepare(`INSERT INTO user_roles VALUES ('usr-rec-assigned', 'r-rec')`).run();
  db.prepare(`INSERT INTO user_roles VALUES ('usr-rec-support', 'r-rec')`).run();
  db.prepare(`INSERT INTO user_roles VALUES ('usr-rec-outside', 'r-rec')`).run();
  db.prepare(`INSERT INTO user_roles VALUES ('usr-admin', 'r-admin')`).run();
  db.prepare(`INSERT INTO user_roles VALUES ('usr-interviewer', 'r-int')`).run();

  // 2. Vị trí tuyển dụng
  db.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, recruiter_id, status)
    VALUES ('req-frontend', 'REQ-2026-FE', 'Kỹ Sư Frontend React/Next.js', 'Phòng Kỹ Thuật', 'usr-rec-assigned', 'OPEN')
  `).run();

  db.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, recruiter_id, status)
    VALUES ('req-backend', 'REQ-2026-BE', 'Kỹ Sư Backend Node.js/Go', 'Phòng Kỹ Thuật', 'usr-rec-assigned', 'OPEN')
  `).run();

  db.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, recruiter_id, status)
    VALUES ('req-paused', 'REQ-2026-PAUSED', 'Vị Trí Tạm Dừng', 'Phòng Marketing', 'usr-rec-assigned', 'PAUSED')
  `).run();

  // Gán recruiter hỗ trợ cho req-frontend
  db.prepare(`INSERT INTO requisition_recruiter_supports VALUES ('req-frontend', 'usr-rec-support')`).run();

  // 3. Danh mục nguồn ứng viên (Recruitment Catalog)
  db.prepare(`
    INSERT INTO recruitment_catalog_items (id, type, code, name, status)
    VALUES ('src-linkedin', 'CANDIDATE_SOURCE', 'LINKEDIN', 'LinkedIn', 'ACTIVE')
  `).run();
  db.prepare(`
    INSERT INTO recruitment_catalog_items (id, type, code, name, status)
    VALUES ('src-headhunter', 'CANDIDATE_SOURCE', 'HEADHUNTER', 'Headhunter / Đại Lý', 'ACTIVE')
  `).run();

  // ==============================================================================
  // NHÓM 1: AC-01 - THÊM ỨNG VIÊN THỦ CÔNG & TẢI CV
  // ==============================================================================

  // TEST 1: Thêm ứng viên thủ công với nguồn LinkedIn và đính kèm CV PDF hợp lệ
  const pdfCvBuffer = createValidPdfBuffer('CV of Nguyen Van A - Senior Frontend Developer');
  const res1 = await service.createManualCandidate(
    {
      fullName: 'Nguyễn Văn A',
      email: 'nguyenvana@gmail.com',
      phoneNumber: '0912 345 678',
      requisitionId: 'req-frontend',
      sourceId: 'LINKEDIN',
      experienceYears: 4,
      currentCompany: 'Công ty Công nghệ XYZ',
      expectedSalary: '35,000,000 VND',
      notes: 'Tìm thấy hồ sơ xuất sắc trên LinkedIn, đã nhắn tin kết nối.'
    },
    {
      filename: 'NguyenVanA_CV.pdf',
      buffer: pdfCvBuffer,
      mimeType: 'application/pdf'
    },
    recruiterAssigned
  );

  assert.equal(res1.success, true);
  assert.equal(res1.statusCode, 201);
  assert.equal(res1.data.fullName, 'Nguyễn Văn A');
  assert.equal(res1.data.email, 'nguyenvana@gmail.com');
  assert.equal(res1.data.stage, 'NEW');
  assert.equal(res1.data.document.fileName, 'NguyenVanA_CV.pdf');
  assert.equal(res1.data.document.mimeType, 'application/pdf');

  // Kiểm tra lưu DB
  const candInDb = db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(res1.data.id);
  assert.ok(candInDb);
  assert.equal(candInDb.full_name, 'Nguyễn Văn A');
  assert.equal(candInDb.stage, 'NEW');
  assert.equal(candInDb.experience_years, 4);

  const docInDb = db.prepare(`SELECT * FROM candidate_documents WHERE candidate_id = ?`).get(res1.data.id);
  assert.ok(docInDb);
  assert.equal(docInDb.document_type, 'CV');
  assert.equal(docInDb.file_name, 'NguyenVanA_CV.pdf');
  assert.equal(docInDb.file_hash, crypto.createHash('sha256').update(pdfCvBuffer).digest('hex'));

  const histInDb = db.prepare(`SELECT * FROM candidate_status_history WHERE candidate_id = ?`).get(res1.data.id);
  assert.ok(histInDb);
  assert.equal(histInDb.action, 'MANUAL_ENTRY');
  assert.equal(histInDb.actor_id, recruiterAssigned.id);

  recordPass('Test 1: AC-01 Thêm ứng viên thủ công hợp lệ từ nguồn LinkedIn kèm tệp CV PDF lưu thành công');

  // TEST 2: Thêm ứng viên thủ công với tệp CV DOCX hợp lệ
  const docxCvBuffer = createValidDocxBuffer('CV Word document binary contents');
  const res2 = await service.createManualCandidate(
    {
      fullName: 'Trần Thị B',
      email: 'tranthib@gmail.com',
      phoneNumber: '0988 123 456',
      requisitionId: 'req-frontend',
      sourceId: 'HEADHUNTER',
      experienceYears: 2
    },
    {
      filename: 'TranThiB_CV.docx',
      buffer: docxCvBuffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    },
    recruiterAssigned
  );

  assert.equal(res2.success, true);
  assert.equal(res2.statusCode, 201);
  assert.equal(res2.data.document.fileName, 'TranThiB_CV.docx');
  assert.equal(res2.data.document.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  recordPass('Test 2: AC-01 Thêm ứng viên thủ công kèm tệp CV DOCX chuẩn lưu thành công');

  // TEST 3: Từ chối tệp CV vượt quá 10MB (HTTP 413)
  const hugeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024); // 10MB + 1KB
  hugeBuffer[0] = 0x25; hugeBuffer[1] = 0x50; hugeBuffer[2] = 0x44; hugeBuffer[3] = 0x46; // %PDF
  const res3 = await service.createManualCandidate(
    {
      fullName: 'Ứng Viên File Lớn',
      email: 'bigfile@gmail.com',
      requisitionId: 'req-frontend'
    },
    {
      filename: 'LargeCV.pdf',
      buffer: hugeBuffer
    },
    recruiterAssigned
  );

  assert.equal(res3.success, false);
  assert.equal(res3.statusCode, 413);
  assert.equal(res3.code, 'CV_FILE_TOO_LARGE');

  recordPass('Test 3: AC-01 Từ chối tệp CV vượt quá dung lượng 10MB trả về HTTP 413');

  // TEST 4: Từ chối tệp CV có định dạng không được phép (.exe, .txt)
  const res4 = await service.createManualCandidate(
    {
      fullName: 'Ứng Viên File Lạ',
      email: 'invalidext@gmail.com',
      requisitionId: 'req-frontend'
    },
    {
      filename: 'malicious.exe',
      buffer: Buffer.from('executable binary code')
    },
    recruiterAssigned
  );

  assert.equal(res4.success, false);
  assert.equal(res4.statusCode, 400);
  assert.equal(res4.code, 'CV_FILE_INVALID_EXTENSION');

  recordPass('Test 4: AC-01 Từ chối phần mở rộng tệp không hợp lệ trả về HTTP 400');

  // TEST 5: Từ chối tệp giả mạo chữ ký định dạng (Fake PDF)
  const fakePdfBuffer = Buffer.from('This is not a real PDF file header');
  const res5 = await service.createManualCandidate(
    {
      fullName: 'Ứng Viên Fake PDF',
      email: 'fakepdf@gmail.com',
      requisitionId: 'req-frontend'
    },
    {
      filename: 'fake.pdf',
      buffer: fakePdfBuffer
    },
    recruiterAssigned
  );

  assert.equal(res5.success, false);
  assert.equal(res5.statusCode, 400);
  assert.equal(res5.code, 'CV_FILE_INVALID_SIGNATURE');

  recordPass('Test 5: AC-01 Từ chối tệp PDF giả mạo chữ ký magic bytes trả về HTTP 400');

  // ==============================================================================
  // NHÓM 2: AC-02 - PHÁT HIỆN TRÙNG LẶP HỒ SƠ ỨNG VIÊN
  // ==============================================================================

  // TEST 6: Chống trùng trên CÙNG vị trí theo Email (Case-Insensitive) -> HTTP 409
  // Thử thêm lại "NGUYENVANA@GMAIL.COM" vào vị trí req-frontend (đã có từ Test 1)
  const res6 = await service.createManualCandidate(
    {
      fullName: 'Nguyễn Văn A (Trùng Email)',
      email: 'NGUYENVANA@GMAIL.COM', // Viết hoa
      phoneNumber: '0999 888 777',
      requisitionId: 'req-frontend'
    },
    null,
    recruiterAssigned
  );

  assert.equal(res6.success, false);
  assert.equal(res6.statusCode, 409);
  assert.equal(res6.code, 'DUPLICATE_CANDIDATE_IN_POSITION');
  assert.equal(res6.data.duplicateType, 'SAME_POSITION');
  assert.equal(res6.data.matchField, 'EMAIL');
  assert.equal(res6.data.existingCandidate.candidateId, res1.data.id);

  recordPass('Test 6: AC-02 Chống trùng trên cùng vị trí theo Email (Case-Insensitive) trả về HTTP 409');

  // TEST 7: Chống trùng trên CÙNG vị trí theo Số điện thoại (chuẩn hoá ký tự đặc biệt) -> HTTP 409
  // Thử thêm email khác nhưng số điện thoại "0912-345-678" (trùng với 0912 345 678 của Nguyễn Văn A)
  const res7 = await service.createManualCandidate(
    {
      fullName: 'Nguyễn Văn A Fake',
      email: 'another.email@gmail.com',
      phoneNumber: '0912-345-678', // Dấu gạch ngang
      requisitionId: 'req-frontend'
    },
    null,
    recruiterAssigned
  );

  assert.equal(res7.success, false);
  assert.equal(res7.statusCode, 409);
  assert.equal(res7.code, 'DUPLICATE_CANDIDATE_IN_POSITION');
  assert.equal(res7.data.duplicateType, 'SAME_POSITION');
  assert.equal(res7.data.matchField, 'PHONE');

  recordPass('Test 7: AC-02 Chống trùng trên cùng vị trí theo Số điện thoại trả về HTTP 409');

  // TEST 8: Cho phép thêm nếu hồ sơ trùng email ở cùng vị trí đã RÚT ĐƠN (stage = 'WITHDRAWN')
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, stage, created_at)
    VALUES ('cand-withdrawn', 'req-backend', 'Lê Đã Rút', 'withdrawn@gmail.com', 'WITHDRAWN', datetime('now'))
  `).run();

  const res8 = await service.createManualCandidate(
    {
      fullName: 'Lê Đã Rút Nộp Lại',
      email: 'withdrawn@gmail.com',
      requisitionId: 'req-backend'
    },
    null,
    recruiterAssigned
  );

  assert.equal(res8.success, true);
  assert.equal(res8.statusCode, 201);

  recordPass('Test 8: AC-02 Bỏ qua kiểm tra trùng với hồ sơ đã rút đơn (stage = WITHDRAWN)');

  // TEST 9: Phát hiện trùng lặp chéo ở vị trí KHÁC (Cross-requisition) -> Yêu cầu xác nhận (HTTP 409)
  // Ứng viên nguyenvana@gmail.com đã nộp ở req-frontend, giờ thêm vào req-backend mà CHƯA có confirmDuplicate
  const res9 = await service.createManualCandidate(
    {
      fullName: 'Nguyễn Văn A',
      email: 'nguyenvana@gmail.com',
      phoneNumber: '0912 345 678',
      requisitionId: 'req-backend' // Vị trí khác
    },
    null,
    recruiterAssigned
  );

  assert.equal(res9.success, false);
  assert.equal(res9.statusCode, 409);
  assert.equal(res9.code, 'POTENTIAL_DUPLICATE_CROSS_REQUISITION');
  assert.equal(res9.data.duplicateType, 'CROSS_POSITION');
  assert.ok(res9.data.matches.length >= 1);
  assert.equal(res9.data.matches[0].requisitionId, 'req-frontend');

  recordPass('Test 9: AC-02 Phát hiện trùng lặp chéo trên vị trí khác trả về POTENTIAL_DUPLICATE_CROSS_REQUISITION');

  // TEST 10: Khi có confirmDuplicate: true, cho phép tạo ứng viên ở vị trí mới và ghi nhận ghi chú hệ thống
  const res10 = await service.createManualCandidate(
    {
      fullName: 'Nguyễn Văn A',
      email: 'nguyenvana@gmail.com',
      phoneNumber: '0912 345 678',
      requisitionId: 'req-backend',
      confirmDuplicate: true // Recruiter chủ động xác nhận
    },
    null,
    recruiterAssigned
  );

  assert.equal(res10.success, true);
  assert.equal(res10.statusCode, 201);
  assert.ok(res10.data.crossPositionMatches.length >= 1);

  // Kiểm tra hệ thống tự động ghi nhận vào candidate_notes để đội ngũ biết hồ sơ trùng chéo
  const autoNote = db.prepare(`SELECT * FROM candidate_notes WHERE candidate_id = ?`).get(res10.data.id);
  assert.ok(autoNote);
  assert.ok(autoNote.note_text.includes('Phát hiện trùng lặp hệ thống'));

  recordPass('Test 10: AC-02 Khi confirmDuplicate=true cho phép đưa vào pipeline mới và lưu chú thích trùng lặp');

  // ==============================================================================
  // NHÓM 3: AC-03 - PHÂN QUYỀN IDOR & RBAC
  // ==============================================================================

  // TEST 11: Recruiter hỗ trợ được phép thêm ứng viên vào vị trí được phân công
  const res11 = await service.createManualCandidate(
    {
      fullName: 'Ứng viên Rec Hỗ Trợ',
      email: 'cand.support@gmail.com',
      requisitionId: 'req-frontend' // usr-rec-support được phân công hỗ trợ vị trí này
    },
    null,
    recruiterSupport
  );

  assert.equal(res11.success, true);
  assert.equal(res11.statusCode, 201);

  recordPass('Test 11: AC-03 Recruiter hỗ trợ được phân công có quyền thêm ứng viên thủ công');

  // TEST 12: Recruiter ngoài không được phân công bị chặn HTTP 403 (IDOR Protection)
  const res12 = await service.createManualCandidate(
    {
      fullName: 'Ứng viên Bị Chặn',
      email: 'cand.blocked@gmail.com',
      requisitionId: 'req-frontend'
    },
    null,
    recruiterOutside // Không thuộc req-frontend
  );

  assert.equal(res12.success, false);
  assert.equal(res12.statusCode, 403);
  assert.equal(res12.code, 'CANDIDATE_OUT_OF_SCOPE');

  recordPass('Test 12: AC-03 Chống IDOR: Recruiter ngoài không được giao vị trí bị từ chối 403 CANDIDATE_OUT_OF_SCOPE');

  // TEST 13: Admin & HR Manager có quyền thêm ứng viên cho bất kỳ vị trí nào
  const res13 = await service.createManualCandidate(
    {
      fullName: 'Ứng viên Do Admin Thêm',
      email: 'cand.admin@gmail.com',
      requisitionId: 'req-frontend'
    },
    null,
    adminUser
  );

  assert.equal(res13.success, true);
  assert.equal(res13.statusCode, 201);

  recordPass('Test 13: AC-03 Admin / HR Manager có toàn quyền thêm ứng viên cho mọi vị trí');

  // TEST 14: Vai trò không có quyền (Interviewer) bị chặn HTTP 403
  const res14 = await service.createManualCandidate(
    {
      fullName: 'Ứng viên Test Interviewer',
      email: 'cand.int@gmail.com',
      requisitionId: 'req-frontend'
    },
    null,
    interviewerUser
  );

  assert.equal(res14.success, false);
  assert.equal(res14.statusCode, 403);
  assert.equal(res14.code, 'CANDIDATE_FORBIDDEN');

  recordPass('Test 14: AC-03 Vai trò không có quyền candidate.create bị từ chối HTTP 403 CANDIDATE_FORBIDDEN');

  // ==============================================================================
  // NHÓM 4: AC-04 - KIỂM TRA TÍNH TOÀN VẸN VÀ RÀNG BUỘC DỮ LIỆU
  // ==============================================================================

  // TEST 15: Từ chối khi thiếu họ tên hoặc tên quá ngắn
  const res15 = await service.createManualCandidate(
    { fullName: ' ', email: 'valid@gmail.com', requisitionId: 'req-frontend' },
    null,
    recruiterAssigned
  );
  assert.equal(res15.statusCode, 400);
  assert.equal(res15.code, 'FULL_NAME_REQUIRED');
  recordPass('Test 15: AC-04 Từ chối khi thiếu họ tên ứng viên (HTTP 400 FULL_NAME_REQUIRED)');

  // TEST 16: Từ chối khi email sai định dạng
  const res16 = await service.createManualCandidate(
    { fullName: 'Nguyễn Văn C', email: 'invalid-email-format', requisitionId: 'req-frontend' },
    null,
    recruiterAssigned
  );
  assert.equal(res16.statusCode, 400);
  assert.equal(res16.code, 'EMAIL_INVALID_FORMAT');
  recordPass('Test 16: AC-04 Từ chối khi email sai định dạng (HTTP 400 EMAIL_INVALID_FORMAT)');

  // TEST 17: Từ chối khi vị trí tuyển dụng không tồn tại
  const res17 = await service.createManualCandidate(
    { fullName: 'Nguyễn Văn D', email: 'vand@gmail.com', requisitionId: 'req-not-exist' },
    null,
    recruiterAssigned
  );
  assert.equal(res17.statusCode, 404);
  assert.equal(res17.code, 'REQUISITION_NOT_FOUND');
  recordPass('Test 17: AC-04 Từ chối khi vị trí tuyển dụng không tồn tại (HTTP 404 REQUISITION_NOT_FOUND)');

  // TEST 18: Từ chối khi vị trí tuyển dụng đang tạm dừng (PAUSED)
  const res18 = await service.createManualCandidate(
    { fullName: 'Nguyễn Văn E', email: 'vane@gmail.com', requisitionId: 'req-paused' },
    null,
    recruiterAssigned
  );
  assert.equal(res18.statusCode, 409);
  assert.equal(res18.code, 'REQUISITION_NOT_ACCEPTING_APPLICATIONS');
  recordPass('Test 18: AC-04 Từ chối khi vị trí tuyển dụng tạm dừng (HTTP 409 REQUISITION_NOT_ACCEPTING_APPLICATIONS)');

  // ==============================================================================
  // NHÓM 5: ENDPOINT KIỂM TRA TRÙNG LẶP THỜI GIAN THỰC (REALTIME CHECK API)
  // ==============================================================================

  // TEST 19: API checkDuplicateCandidate kiểm tra chính xác
  const dupCheckSame = await service.checkDuplicateCandidate({
    email: 'nguyenvana@gmail.com',
    requisitionId: 'req-frontend'
  });
  assert.equal(dupCheckSame.isDuplicate, true);
  assert.equal(dupCheckSame.hasSamePositionDuplicate, true);

  const dupCheckClean = await service.checkDuplicateCandidate({
    email: 'completely.new.candidate@gmail.com',
    phoneNumber: '0977 111 222',
    requisitionId: 'req-frontend'
  });
  assert.equal(dupCheckClean.isDuplicate, false);
  assert.equal(dupCheckClean.hasSamePositionDuplicate, false);
  assert.equal(dupCheckClean.hasCrossPositionDuplicate, false);

  recordPass('Test 19: AC-05 Hàm checkDuplicateCandidate hoạt động chuẩn xác cho kiểm tra thời gian thực');

  // ==============================================================================
  // NHÓM 6: KIỂM TRA CONTROLLER TÍCH HỢP HTTP
  // ==============================================================================

  // Mock RBAC Middleware và AuthService cho Controller
  const mockRbac = {
    async authorize(req, res, auth, permission) {
      if (req.headers['x-mock-role'] === 'unauthorized') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, code: 'UNAUTHORIZED' }));
        return null;
      }
      return recruiterAssigned;
    }
  };
  const mockAuth = {};

  const controller = new CandidateManualEntryController(service, mockRbac, mockAuth);

  // Helper mô phỏng HTTP request / response
  function createMockHttp(method, pathname, body = {}, headers = {}) {
    const req = {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers
      }
    };
    let responseStatus = 0;
    let responseHeaders = {};
    let responseBody = '';

    const res = {
      writeHead(status, hdrs) {
        responseStatus = status;
        responseHeaders = hdrs;
      },
      end(data) {
        responseBody = data;
      }
    };

    const parsedUrl = new URL('http://localhost:5050' + pathname);
    const parseBody = async () => body;

    return { req, res, parsedUrl, parseBody, getResult: () => ({ status: responseStatus, body: JSON.parse(responseBody || '{}') }) };
  }

  // TEST 20: Controller POST /api/v1/candidates/check-duplicate
  const httpCheck = createMockHttp('POST', '/api/v1/candidates/check-duplicate', {
    email: 'nguyenvana@gmail.com',
    requisitionId: 'req-frontend'
  });
  await controller.handle(httpCheck.req, httpCheck.res, httpCheck.parsedUrl, httpCheck.parseBody);
  const checkRes = httpCheck.getResult();
  assert.equal(checkRes.status, 200);
  assert.equal(checkRes.body.success, true);
  assert.equal(checkRes.body.data.hasSamePositionDuplicate, true);

  recordPass('Test 20: Controller xử lý POST /api/v1/candidates/check-duplicate thành công');

  // TEST 21: Controller POST /api/v1/candidates/manual
  const httpManual = createMockHttp('POST', '/api/v1/candidates/manual', {
    fullName: 'Hoàng Văn F',
    email: 'hoangvanf@gmail.com',
    phoneNumber: '0933 444 555',
    requisitionId: 'req-frontend',
    sourceId: 'LINKEDIN',
    cvFile: {
      filename: 'HoangVanF_CV.pdf',
      base64: Buffer.from('%PDF-1.4\nHoang Van F CV Content\n%%EOF').toString('base64')
    }
  });
  await controller.handle(httpManual.req, httpManual.res, httpManual.parsedUrl, httpManual.parseBody);
  const manualRes = httpManual.getResult();
  assert.equal(manualRes.status, 201);
  assert.equal(manualRes.body.success, true);
  assert.equal(manualRes.body.data.fullName, 'Hoàng Văn F');

  recordPass('Test 21: Controller xử lý POST /api/v1/candidates/manual với CV base64 thành công (201)');

  // TEST 22: Chặn triệt để ứng viên trùng email (kien@gmail.com) và số điện thoại (+84/0...) vào cùng một vị trí (AC-02)
  const firstCand = await service.createManualCandidate({
    fullName: 'Nguyễn Văn Kiên',
    email: 'kien@gmail.com',
    phoneNumber: '0987654321',
    requisitionId: 'req-frontend',
    sourceId: 'LINKEDIN'
  }, null, recruiterAssigned);
  assert.equal(firstCand.success, true);
  assert.equal(firstCand.statusCode, 201);

  // Thử thêm lại ứng viên trùng y hệt email và định dạng số điện thoại quốc tế (+84 987 654 321) vào cùng vị trí
  const dupCandSameReq = await service.createManualCandidate({
    fullName: 'Kiên Nguyễn',
    email: 'KIEN@GMAIL.COM ', // test trim và case-insensitive
    phoneNumber: '+84 987 654 321', // test phone format normalization
    requisitionId: 'req-frontend',
    sourceId: 'LINKEDIN'
  }, null, recruiterAssigned);

  assert.equal(dupCandSameReq.success, false);
  assert.equal(dupCandSameReq.statusCode, 409);
  assert.equal(dupCandSameReq.code, 'DUPLICATE_CANDIDATE_IN_POSITION');
  assert.ok(dupCandSameReq.message.includes('đã có hồ sơ đang xử lý tại vị trí'));

  recordPass('Test 22: AC-02 Chặn triệt để ứng viên trùng kien@gmail.com và định dạng số điện thoại khác nhau vào cùng một vị trí (HTTP 409)');

  console.log('\n================================================================');
  console.log(`KẾT QUẢ TEST SUITE S5-08: HOÀN THÀNH XUẤT SẮC ${passCount}/22 TESTS`);
  console.log('Tất cả các tiêu chí AC-01, AC-02, IDOR & RBAC đã được xác minh 100%!');
  console.log('================================================================\n');
}

runTestSuite()
  .catch(err => {
    console.error('[FATAL ERROR IN TEST SUITE]', err);
    process.exit(1);
  })
  .finally(() => {
    // Dọn dẹp tệp tạm trong thư mục uploads sau khi test xong
    const uploadsDir = require('node:path').resolve(__dirname, '../../uploads');
    if (require('node:fs').existsSync(uploadsDir)) {
      try {
        require('node:fs').rmSync(uploadsDir, { recursive: true, force: true });
      } catch {}
    }
  });
