const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const CandidateScreeningService = require('../src/services/candidateScreeningService');
const CandidateScreeningController = require('../src/controllers/candidateScreeningController');

/**
 * ==============================================================================
 * TEST SUITE: USER STORY S5-09 / SCRUM-119
 * ==============================================================================
 *
 * Nội dung: Là Nhân viên tuyển dụng, tôi muốn có hồ sơ mới được chấm điểm sàng lọc theo
 * tiêu chí bắt buộc của vị trí, để ưu tiên đọc trước những hồ sơ có khả năng phù hợp nhất.
 *
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Khai báo tiêu chí bắt buộc cho vị trí: số năm kinh nghiệm, bằng cấp, kỹ năng
 *   • AC-02: Hồ sơ mới được gắn điểm phù hợp và cờ Đạt hoặc Không đạt tiêu chí bắt buộc
 *   • AC-03: Điểm chỉ để gợi ý sắp xếp, không tự động loại ứng viên
 * ==============================================================================
 */

function setupDatabase() {
  const db = new DatabaseSync(':memory:');

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
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

    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      department_name TEXT,
      recruiter_id TEXT,
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
      experience_years INTEGER NOT NULL DEFAULT 1,
      education_level TEXT,
      skills TEXT,
      notes TEXT,
      cover_letter TEXT,
      current_company TEXT,
      expected_salary TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_tags (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      tag_name TEXT NOT NULL
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
      parsed_text TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S5-09 / SCRUM-119');
  console.log('Là Nhân viên tuyển dụng, tôi muốn có hồ sơ mới được chấm điểm sàng lọc theo');
  console.log('tiêu chí bắt buộc của vị trí, để ưu tiên đọc trước những hồ sơ có khả năng');
  console.log('phù hợp nhất.');
  console.log('================================================================\n');

  const db = setupDatabase();
  const service = new CandidateScreeningService(db);

  let passCount = 0;
  function recordPass(testName) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  }

  // --- DỮ LIỆU FIXTURE ---
  // Người dùng
  const recruiterAssigned = { id: 'usr-rec-1', email: 'rec1@cty.vn', fullName: 'Lê Recruiter Chính', roles: ['RECRUITER'] };
  const recruiterSupport = { id: 'usr-rec-2', email: 'rec2@cty.vn', fullName: 'Phạm Recruiter Hỗ Trợ', roles: ['RECRUITER'] };
  const recruiterOutside = { id: 'usr-rec-3', email: 'rec3@cty.vn', fullName: 'Trần Recruiter Ngoài', roles: ['RECRUITER'] };
  const adminUser = { id: 'usr-admin', email: 'admin@cty.vn', fullName: 'Vũ Quản Trị Viên', roles: ['ADMIN'] };
  const interviewerUser = { id: 'usr-int', email: 'int@cty.vn', fullName: 'Đặng Phỏng Vấn Viên', roles: ['INTERVIEWER'] };

  for (const u of [recruiterAssigned, recruiterSupport, recruiterOutside, adminUser, interviewerUser]) {
    db.prepare(`INSERT INTO users VALUES (?, ?, ?, 'ACTIVE')`).run(u.id, u.email, u.fullName);
  }

  // Vị trí tuyển dụng
  db.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, recruiter_id, status)
    VALUES ('req-senior-dev', 'REQ-SR-DEV', 'Senior Backend Engineer', 'Khối Kỹ Thuật', 'usr-rec-1', 'OPEN')
  `).run();

  // Recruiter hỗ trợ
  db.prepare(`INSERT INTO requisition_recruiter_supports VALUES ('req-senior-dev', 'usr-rec-2')`).run();

  // ==============================================================================
  // NHÓM 1: AC-01 - KHAI BÁO TIÊU CHÍ BẮT BUỘC CHO VỊ TRÍ
  // ==============================================================================

  // TEST 1: Lấy tiêu chí mặc định khi vị trí chưa cấu hình
  const defaultCriteria = await service.getRequisitionCriteria('req-senior-dev', recruiterAssigned);
  assert.equal(defaultCriteria.success, true);
  assert.equal(defaultCriteria.isConfigured, false);
  assert.equal(defaultCriteria.data.minExperienceYears, 0);
  assert.equal(defaultCriteria.data.requiredEducation, 'NONE');
  recordPass('Test 1: AC-01 Lấy cấu hình tiêu chí ban đầu (template mặc định) thành công');

  // TEST 2: Khai báo tiêu chí bắt buộc (3 năm KN, Đại học, kỹ năng [Node.js, SQL, Docker])
  const setRes = await service.setRequisitionCriteria('req-senior-dev', {
    minExperienceYears: 3,
    requiredEducation: 'BACHELOR',
    requiredSkills: ['Node.js', 'SQL', 'Docker'],
    weightExperience: 40,
    weightEducation: 20,
    weightSkills: 40
  }, recruiterAssigned);

  assert.equal(setRes.success, true);
  assert.equal(setRes.statusCode, 200);
  assert.equal(setRes.data.minExperienceYears, 3);
  assert.equal(setRes.data.requiredEducation, 'BACHELOR');
  assert.deepEqual(setRes.data.requiredSkills, ['Node.js', 'SQL', 'Docker']);
  assert.equal(setRes.data.weightExperience, 40);
  assert.equal(setRes.data.weightEducation, 20);
  assert.equal(setRes.data.weightSkills, 40);
  recordPass('Test 2: AC-01 Khai báo tiêu chí bắt buộc cho vị trí (KN, bằng cấp, kỹ năng) thành công');

  // TEST 3: Đọc lại tiêu chí sau khi lưu và kiểm tra tính toàn vẹn
  const getRes = await service.getRequisitionCriteria('req-senior-dev', recruiterAssigned);
  assert.equal(getRes.success, true);
  assert.equal(getRes.isConfigured, true);
  assert.equal(getRes.data.minExperienceYears, 3);
  assert.equal(getRes.data.requiredEducation, 'BACHELOR');
  assert.deepEqual(getRes.data.requiredSkills, ['Node.js', 'SQL', 'Docker']);
  recordPass('Test 3: AC-01 Đọc lại tiêu chí đã lưu đảm bảo tính toàn vẹn dữ liệu');

  // ==============================================================================
  // NHÓM 2: AC-02 - CHẤM ĐIỂM SÀNG LỌC & GẮN CỜ ĐẠT / KHÔNG ĐẠT
  // ==============================================================================

  // Tạo các hồ sơ ứng viên để kiểm thử
  // Ứng viên 1: ĐẠT TOÀN DIỆN (4 năm KN >= 3, Bằng Đại học, đủ cả 3 kỹ năng)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, experience_years, education_level, stage, notes, created_at)
    VALUES ('cand-qualified', 'req-senior-dev', 'Nguyễn Toàn Diện', 'toandien@gmail.com', 4, 'BACHELOR', 'NEW', 'Thành thạo Node.js, SQL Server và Docker containers', datetime('now', '-5 days'))
  `).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-1', 'cand-qualified', 'Node.js')`).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-2', 'cand-qualified', 'SQL')`).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-3', 'cand-qualified', 'Docker')`).run();

  // TEST 4: Chấm điểm ứng viên đạt toàn bộ tiêu chí bắt buộc -> mandatoryPass: true, 100 điểm
  const screen1 = await service.screenCandidate('cand-qualified', recruiterAssigned);
  assert.equal(screen1.success, true);
  assert.equal(screen1.data.mandatoryPass, true);
  assert.equal(screen1.data.fitScore, 100);
  assert.equal(screen1.data.experiencePassed, true);
  assert.equal(screen1.data.educationPassed, true);
  assert.equal(screen1.data.skillsPassed, true);
  assert.deepEqual(screen1.data.breakdown.skills.missing, []);
  recordPass('Test 4: AC-02 Ứng viên thoả mãn toàn bộ tiêu chí được gắn cờ Đạt (mandatoryPass: true) và 100 điểm');

  // Ứng viên 2: KHÔNG ĐẠT KINH NGHIỆM (1 năm KN < 3 năm yêu cầu, nhưng có Đại học và kỹ năng)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, experience_years, education_level, stage, notes, created_at)
    VALUES ('cand-low-exp', 'req-senior-dev', 'Trần Ít Kinh Nghiệm', 'itkinhnghiem@gmail.com', 1, 'BACHELOR', 'NEW', 'Kỹ năng: Node.js, SQL, Docker', datetime('now', '-4 days'))
  `).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-4', 'cand-low-exp', 'Node.js')`).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-5', 'cand-low-exp', 'SQL')`).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-6', 'cand-low-exp', 'Docker')`).run();

  // TEST 5: Chấm điểm ứng viên trượt kinh nghiệm -> mandatoryPass: false, điểm tỉ lệ
  const screen2 = await service.screenCandidate('cand-low-exp', recruiterAssigned);
  assert.equal(screen2.success, true);
  assert.equal(screen2.data.mandatoryPass, false);
  assert.equal(screen2.data.experiencePassed, false);
  assert.equal(screen2.data.educationPassed, true);
  assert.equal(screen2.data.skillsPassed, true);
  assert.ok(screen2.data.fitScore < 100 && screen2.data.fitScore >= 70); // 13.3 exp + 20 edu + 40 skills = ~73.3
  recordPass('Test 5: AC-02 Ứng viên thiếu kinh nghiệm bị gắn cờ Không đạt (mandatoryPass: false) kèm điểm kinh nghiệm theo tỉ lệ');

  // Ứng viên 3: KHÔNG ĐẠT BẰNG CẤP (5 năm KN, có kỹ năng nhưng chỉ tốt nghiệp THPT, yêu cầu Đại học)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, experience_years, education_level, stage, notes, created_at)
    VALUES ('cand-low-edu', 'req-senior-dev', 'Lê Bằng Cấp Thấp', 'bangcapthap@gmail.com', 5, 'HIGH_SCHOOL', 'NEW', 'Kinh nghiệm lập trình Node.js, SQL, Docker', datetime('now', '-3 days'))
  `).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-7', 'cand-low-edu', 'Node.js')`).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-8', 'cand-low-edu', 'SQL')`).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-9', 'cand-low-edu', 'Docker')`).run();

  // TEST 6: Chấm điểm ứng viên trượt bằng cấp -> educationPassed: false
  const screen3 = await service.screenCandidate('cand-low-edu', recruiterAssigned);
  assert.equal(screen3.success, true);
  assert.equal(screen3.data.mandatoryPass, false);
  assert.equal(screen3.data.educationPassed, false);
  assert.equal(screen3.data.experiencePassed, true);
  assert.equal(screen3.data.skillsPassed, true);
  recordPass('Test 6: AC-02 Ứng viên bằng cấp dưới mức yêu cầu bị đánh dấu Không đạt tiêu chí bằng cấp');

  // Ứng viên 4: KHÔNG ĐẠT KỸ NĂNG (4 năm KN, Đại học, nhưng chỉ biết Node.js, thiếu SQL và Docker)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, experience_years, education_level, stage, notes, created_at)
    VALUES ('cand-missing-skills', 'req-senior-dev', 'Phạm Thiếu Kỹ Năng', 'thieukynang@gmail.com', 4, 'BACHELOR', 'NEW', 'Chỉ làm Node.js Express và MongoDB', datetime('now', '-2 days'))
  `).run();
  db.prepare(`INSERT INTO candidate_tags VALUES ('tag-10', 'cand-missing-skills', 'Node.js')`).run();

  // TEST 7: Chấm điểm ứng viên thiếu kỹ năng -> skillsPassed: false, ghi rõ missingSkills
  const screen4 = await service.screenCandidate('cand-missing-skills', recruiterAssigned);
  assert.equal(screen4.success, true);
  assert.equal(screen4.data.mandatoryPass, false);
  assert.equal(screen4.data.skillsPassed, false);
  assert.ok(screen4.data.breakdown.skills.missing.includes('SQL'));
  assert.ok(screen4.data.breakdown.skills.missing.includes('Docker'));
  recordPass('Test 7: AC-02 Ứng viên thiếu kỹ năng bắt buộc bị cờ Không đạt và liệt kê chính xác các kỹ năng còn thiếu');

  // TEST 8: Nhận diện trình độ bằng cấp và kỹ năng từ văn bản CV (parsed_text)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, experience_years, stage, created_at)
    VALUES ('cand-cv-text', 'req-senior-dev', 'Hoàng CV Văn Bản', 'cvtext@gmail.com', 3, 'NEW', datetime('now', '-1 days'))
  `).run();
  db.prepare(`
    INSERT INTO candidate_documents (id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, parsed_text, created_at)
    VALUES ('doc-cv-text', 'cand-cv-text', 'hoang_cv.pdf', 'cv.pdf', 'application/pdf', 1024, 'hash1', 'Học vấn: Tốt nghiệp Đại học Bách Khoa Hà Nội. Kỹ năng lập trình: Node.js, PostgreSQL/SQL, Docker containerization.', datetime('now'))
  `).run();

  const screen5 = await service.screenCandidate('cand-cv-text', recruiterAssigned);
  assert.equal(screen5.success, true);
  assert.equal(screen5.data.educationPassed, true); // Trích xuất được "Đại học"
  assert.equal(screen5.data.skillsPassed, true);    // Trích xuất được Node.js, SQL, Docker
  assert.equal(screen5.data.mandatoryPass, true);
  recordPass('Test 8: AC-02 Trích xuất bằng cấp và đối chiếu kỹ năng tự động từ văn bản CV (parsed_text)');

  // ==============================================================================
  // NHÓM 3: AC-03 - KHÔNG TỰ ĐỘNG LOẠI ỨNG VIÊN & SẮP XẾP ƯU TIÊN ĐỌC TRƯỚC
  // ==============================================================================

  // TEST 9: Đảm bảo stage của ứng viên trượt tiêu chí VẪN GIỮ NGUYÊN LÀ 'NEW' (Không tự động REJECT)
  const cand2Db = db.prepare(`SELECT stage FROM candidates WHERE id = 'cand-low-exp'`).get();
  const cand3Db = db.prepare(`SELECT stage FROM candidates WHERE id = 'cand-low-edu'`).get();
  const cand4Db = db.prepare(`SELECT stage FROM candidates WHERE id = 'cand-missing-skills'`).get();

  assert.equal(cand2Db.stage, 'NEW', 'Stage của ứng viên trượt kinh nghiệm phải giữ nguyên NEW');
  assert.equal(cand3Db.stage, 'NEW', 'Stage của ứng viên trượt bằng cấp phải giữ nguyên NEW');
  assert.equal(cand4Db.stage, 'NEW', 'Stage của ứng viên trượt kỹ năng phải giữ nguyên NEW');
  recordPass('Test 9: AC-03 TUYỆT ĐỐI KHÔNG TỰ ĐỘNG LOẠI: Ứng viên trượt tiêu chí bắt buộc vẫn giữ nguyên trạng thái NEW');

  // TEST 10: Sắp xếp danh sách ứng viên theo điểm phù hợp (Fit Score DESC, Đạt lên trước)
  const rankedRes = await service.getCandidatesRankedByScreening('req-senior-dev', recruiterAssigned, {
    sortBy: 'fit_score_desc'
  });

  assert.equal(rankedRes.success, true);
  assert.equal(rankedRes.candidates.length, 5);

  // 2 ứng viên đạt 100 điểm (cand-qualified và cand-cv-text) phải đứng đầu danh sách
  assert.equal(rankedRes.candidates[0].screening.mandatoryPass, true);
  assert.equal(rankedRes.candidates[0].screening.fitScore, 100);
  assert.equal(rankedRes.candidates[1].screening.mandatoryPass, true);
  assert.equal(rankedRes.candidates[1].screening.fitScore, 100);

  // Các ứng viên không đạt tiêu chí xếp ở phía dưới
  assert.equal(rankedRes.candidates[2].screening.mandatoryPass, false);
  assert.ok(rankedRes.candidates[2].screening.fitScore <= rankedRes.candidates[1].screening.fitScore);
  recordPass('Test 10: AC-03 Sắp xếp ưu tiên: Hồ sơ đạt tiêu chí và điểm cao nhất được đẩy lên đầu trang để đọc trước');

  // TEST 11: Lọc danh sách: Chỉ lấy hồ sơ ĐẠT tiêu chí (passed_only)
  const filterPassed = await service.getCandidatesRankedByScreening('req-senior-dev', recruiterAssigned, {
    filter: 'passed_only'
  });
  assert.equal(filterPassed.success, true);
  assert.equal(filterPassed.candidates.length, 2);
  assert.ok(filterPassed.candidates.every(c => c.screening.mandatoryPass === true));
  recordPass('Test 11: AC-03 Bộ lọc passed_only lọc chính xác các hồ sơ đạt toàn bộ tiêu chí');

  // TEST 12: Lọc danh sách: Chỉ lấy hồ sơ KHÔNG ĐẠT tiêu chí (failed_only)
  const filterFailed = await service.getCandidatesRankedByScreening('req-senior-dev', recruiterAssigned, {
    filter: 'failed_only'
  });
  assert.equal(filterFailed.success, true);
  assert.equal(filterFailed.candidates.length, 3);
  assert.ok(filterFailed.candidates.every(c => c.screening.mandatoryPass === false));
  recordPass('Test 12: AC-03 Bộ lọc failed_only lọc chính xác các hồ sơ chưa đạt tiêu chí');

  // ==============================================================================
  // NHÓM 4: CHẤM ĐIỂM HÀNG LOẠT & PHÂN QUYỀN IDOR / RBAC
  // ==============================================================================

  // TEST 13: Chấm điểm hàng loạt toàn bộ hồ sơ trong vị trí (Batch Rescreening)
  const batchRes = await service.screenRequisitionCandidates('req-senior-dev', recruiterAssigned);
  assert.equal(batchRes.success, true);
  assert.equal(batchRes.data.totalScreened, 5);
  assert.equal(batchRes.data.passedCount, 2);
  assert.equal(batchRes.data.failedCount, 3);
  recordPass('Test 13: Chấm điểm hàng loạt toàn bộ hồ sơ trong vị trí thành công (2 đạt, 3 trượt)');

  // TEST 14: Phân quyền IDOR: Recruiter hỗ trợ được cấp quyền chấm điểm
  const supportRes = await service.screenCandidate('cand-qualified', recruiterSupport);
  assert.equal(supportRes.success, true);
  assert.equal(supportRes.statusCode, 200);
  recordPass('Test 14: Phân quyền IDOR: Recruiter hỗ trợ được phép thao tác trên vị trí được phân công');

  // TEST 15: Phân quyền IDOR: Recruiter ngoài không được phân công bị chặn HTTP 403
  const outsideRes = await service.screenCandidate('cand-qualified', recruiterOutside);
  assert.equal(outsideRes.success, false);
  assert.equal(outsideRes.statusCode, 403);
  assert.equal(outsideRes.code, 'CANDIDATE_OUT_OF_SCOPE');
  recordPass('Test 15: Chống IDOR: Recruiter ngoài vị trí bị từ chối 403 CANDIDATE_OUT_OF_SCOPE');

  // TEST 16: Admin / HR Manager có toàn quyền thao tác trên mọi vị trí
  const adminRes = await service.setRequisitionCriteria('req-senior-dev', {
    minExperienceYears: 2,
    requiredEducation: 'ASSOCIATE',
    requiredSkills: ['Node.js']
  }, adminUser);
  assert.equal(adminRes.success, true);
  assert.equal(adminRes.statusCode, 200);
  recordPass('Test 16: Admin / HR Manager có toàn quyền cấu hình và chấm điểm mọi vị trí');

  // TEST 17: Vai trò không có quyền (Interviewer) bị chặn HTTP 403
  const intRes = await service.setRequisitionCriteria('req-senior-dev', { minExperienceYears: 1 }, interviewerUser);
  assert.equal(intRes.success, false);
  assert.equal(intRes.statusCode, 403);
  assert.equal(intRes.code, 'CANDIDATE_FORBIDDEN');
  recordPass('Test 17: Vai trò không có quyền bị từ chối HTTP 403 CANDIDATE_FORBIDDEN');

  // ==============================================================================
  // NHÓM 5: TÍCH HỢP CONTROLLER & HTTP ENDPOINTS
  // ==============================================================================

  const mockRbac = {
    async authorize(req, res, auth, permission) {
      return recruiterAssigned;
    }
  };
  const mockAuth = {};
  const controller = new CandidateScreeningController(service, mockRbac, mockAuth);

  function createMockHttp(method, pathname, body = {}, searchParams = '') {
    const req = { method, headers: { 'content-type': 'application/json' } };
    let responseStatus = 0;
    let responseBody = '';
    const res = {
      writeHead(status) { responseStatus = status; },
      end(data) { responseBody = data; }
    };
    const parsedUrl = new URL('http://localhost:5050' + pathname + (searchParams ? '?' + searchParams : ''));
    const parseBody = async () => body;
    return { req, res, parsedUrl, parseBody, getResult: () => ({ status: responseStatus, body: JSON.parse(responseBody || '{}') }) };
  }

  // TEST 18: Controller GET /api/v1/requisitions/:id/screening-criteria
  const httpGetCrit = createMockHttp('GET', '/api/v1/requisitions/req-senior-dev/screening-criteria');
  await controller.handle(httpGetCrit.req, httpGetCrit.res, httpGetCrit.parsedUrl, httpGetCrit.parseBody);
  assert.equal(httpGetCrit.getResult().status, 200);
  assert.equal(httpGetCrit.getResult().body.success, true);
  recordPass('Test 18: Controller xử lý GET /screening-criteria thành công');

  // TEST 19: Controller POST /api/v1/candidates/:id/screen
  const httpScreenOne = createMockHttp('POST', '/api/v1/candidates/cand-qualified/screen');
  await controller.handle(httpScreenOne.req, httpScreenOne.res, httpScreenOne.parsedUrl, httpScreenOne.parseBody);
  assert.equal(httpScreenOne.getResult().status, 200);
  assert.equal(httpScreenOne.getResult().body.data.fitScore, 100);
  recordPass('Test 19: Controller xử lý POST /candidates/:id/screen thành công');

  // TEST 20: Controller GET /api/v1/requisitions/:id/screening-candidates (Xếp hạng)
  const httpRanked = createMockHttp('GET', '/api/v1/requisitions/req-senior-dev/screening-candidates', {}, 'sortBy=fit_score_desc&filter=all');
  await controller.handle(httpRanked.req, httpRanked.res, httpRanked.parsedUrl, httpRanked.parseBody);
  assert.equal(httpRanked.getResult().status, 200);
  assert.equal(httpRanked.getResult().body.candidates.length, 5);
  recordPass('Test 20: Controller xử lý GET /screening-candidates (xếp hạng ưu tiên đọc trước) thành công');

  console.log('\n================================================================');
  console.log(`KẾT QUẢ TEST SUITE S5-09: HOÀN THÀNH XUẤT SẮC 20/20 TESTS (100% PASS)`);
  console.log('Tất cả các tiêu chí AC-01, AC-02, AC-03, IDOR & RBAC đã được xác minh hoàn hảo!');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('[FATAL ERROR IN TEST SUITE S5-09]', err);
  process.exit(1);
});
