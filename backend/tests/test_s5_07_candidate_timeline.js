const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const CandidateTimelineService = require('../src/services/candidateTimelineService');

/**
 * ==============================================================================
 * TEST SUITE: USER STORY S5-07 / SCRUM-117
 * ==============================================================================
 *
 * Nội dung: Là Nhân viên tuyển dụng, tôi muốn xem nhật ký toàn bộ tương tác với một ứng viên,
 * để biết ai đã liên hệ ứng viên này và nói gì trước khi mình gọi.
 *
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Dòng thời gian gồm: nộp hồ sơ, chuyển giai đoạn, email đã gửi, lịch phỏng vấn, đánh giá
 *   • AC-02: Sắp xếp mới nhất trước (DESC by timestamp)
 *   • AC-03: Kiểm soát phân quyền IDOR: Recruiter chính & hỗ trợ được xem, recruiter ngoài bị chặn
 *   • AC-04: Phân quyền đa vai trò: Hiring Manager, Interviewer, HR Manager, Admin
 *   • AC-05: Bảo vệ dữ liệu ứng viên: Chặn tài khoản ứng viên bên ngoài (CANDIDATE role)
 *   • AC-06: Bảo vệ ghi chú riêng tư (Private notes) và xử lý 404 cho ứng viên không tồn tại
 *   • AC-07: Hỗ trợ tích hợp cả 2 nguồn email: email_logs (Base schema) và email_outbox (Sprint 4)
 *   • AC-08: Lịch sử tương tác hợp nhất (Unified timeline) khi ứng viên từng ứng tuyển nhiều vị trí
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
      code TEXT UNIQUE NOT NULL
    );

    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      manager_id TEXT NOT NULL
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
      tracking_code TEXT,
      cover_letter TEXT,
      is_internal_referral INTEGER NOT NULL DEFAULT 0,
      referrer_name TEXT,
      withdrawn_at TEXT,
      withdrawn_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      before_stage TEXT,
      after_stage TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE email_logs (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SENT',
      error_message TEXT,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE email_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SENT',
      error_message TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      requisition_id TEXT,
      interviewer_id TEXT,
      round_name TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      feedback TEXT,
      score INTEGER,
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

async function runTestSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S5-07 / SCRUM-117');
  console.log('Là Nhân viên tuyển dụng, tôi muốn xem nhật ký toàn bộ tương tác với một ứng viên,');
  console.log('để biết ai đã liên hệ ứng viên này và nói gì trước khi mình gọi.');
  console.log('================================================================\n');

  const db = setupDatabase();
  const timelineService = new CandidateTimelineService(db);

  let passCount = 0;
  let totalTests = 0;

  function recordPass(testName) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  }

  // Khởi tạo phòng ban
  db.prepare(`INSERT INTO departments VALUES ('dept-tech', 'TECH', 'Khối Kỹ Thuật', 'usr-hm')`).run();

  // Khởi tạo người dùng hệ thống
  db.prepare(`INSERT INTO users VALUES ('usr-admin', 'admin@company.com', 'Vũ Quản Trị', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-hr', 'hrmanager@company.com', 'Phạm Trưởng Phòng HR', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-rec-primary', 'recruiter1@company.com', 'Nguyễn Thị Tuyển Dụng', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-rec-support', 'recruiter.support@company.com', 'Trần Hỗ Trợ Tuyển Dụng', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-rec-other', 'recruiter.other@company.com', 'Hoàng Recruiter Khác', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-hm', 'hiringmgr@company.com', 'Đặng Trưởng Bộ Phận', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-int', 'interviewer@company.com', 'Lê Kỹ Sư Phỏng Vấn', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO users VALUES ('usr-candidate', 'applicant@example.com', 'Nguyễn Văn Ứng Viên', 'ACTIVE')`).run();

  // Tạo Requisition 1: Vị trí hiện tại
  db.prepare(`
    INSERT INTO requisitions VALUES (
      'req-01', 'REQ-2026-001', 'Senior Backend Engineer (Node.js)', 'dept-tech', 'Khối Kỹ Thuật',
      'usr-rec-primary', 'usr-hm', 'usr-hm', 'OPEN'
    )
  `).run();

  // Phân công Recruiter hỗ trợ cho req-01
  db.prepare(`INSERT INTO requisition_recruiter_supports VALUES ('req-01', 'usr-rec-support')`).run();

  // Tạo Requisition 2: Vị trí trong quá khứ của ứng viên
  db.prepare(`
    INSERT INTO requisitions VALUES (
      'req-02', 'REQ-2025-088', 'Junior Backend Developer', 'dept-tech', 'Khối Kỹ Thuật',
      'usr-rec-other', 'usr-hm', 'usr-hm', 'CLOSED'
    )
  `).run();

  // Tạo ứng viên:
  // Hồ sơ 1: Đã ứng tuyển vị trí cũ 6 tháng trước
  db.prepare(`
    INSERT INTO candidates VALUES (
      'cand-past', 'req-02', 'Nguyễn Văn Ứng Viên', 'applicant@example.com', '0912345678',
      'REJECTED', 'TOPCV', 'TRK-2025-088', 'Đơn ứng tuyển năm trước',
      0, NULL, NULL, NULL, '2025-10-10T08:00:00Z'
    )
  `).run();

  // Phỏng vấn và đánh giá vòng cuối vị trí cũ
  db.prepare(`
    INSERT INTO interviews VALUES (
      'inv-past-01', 'cand-past', 'req-02', 'usr-int', 'Vòng phỏng vấn chuyên môn năm 2025',
      '2025-10-20T14:00:00Z', 'Google Meet', 'COMPLETED',
      'Kỹ năng tư duy logic tốt nhưng kinh nghiệm thực tế về Distributed Systems còn thiếu tại thời điểm 2025. Rất tiềm năng cho các năm sau.',
      4, '2025-10-20T16:00:00Z'
    )
  `).run();

  // Hồ sơ 2: Vị trí hiện tại (Senior Backend)
  db.prepare(`
    INSERT INTO candidates VALUES (
      'cand-current', 'req-01', 'Nguyễn Văn Ứng Viên', 'applicant@example.com', '0912345678',
      'INTERVIEW', 'LINKEDIN', 'TRK-2026-001', 'Tôi đã tích lũy 2 năm kinh nghiệm kiến trúc hệ thống lớn và mong muốn thử sức lại.',
      1, 'Phạm Trưởng Phòng HR', NULL, NULL, '2026-10-01T08:00:00Z'
    )
  `).run();

  // Các sự kiện tương tác cho hồ sơ hiện tại:
  // 1. Chuyển giai đoạn: NEW -> SCREENING (2026-10-02)
  db.prepare(`
    INSERT INTO candidate_status_history VALUES (
      'csh-01', 'cand-current', 'NEW', 'SCREENING', 'Nguyễn Thị Tuyển Dụng',
      'Duyệt hồ sơ sơ bộ', NULL, 'Hồ sơ đạt tiêu chuẩn, có thư giới thiệu nội bộ', '2026-10-02T09:00:00Z'
    )
  `).run();

  // 2. Email xác nhận gửi từ hệ thống cơ sở (email_logs)
  db.prepare(`
    INSERT INTO email_logs VALUES (
      'em-01', 'applicant@example.com', 'Xác nhận tiếp nhận hồ sơ ứng tuyển Senior Backend Engineer',
      'APPLICATION_CONFIRMATION', 'SENT', NULL, '2026-10-01T08:05:00Z'
    )
  `).run();

  // 3. Email mời phỏng vấn gửi từ email_outbox
  db.prepare(`
    INSERT INTO email_outbox VALUES (
      'em-02', 'applicant@example.com', 'Thư mời phỏng vấn kỹ thuật vòng 1',
      'INTERVIEW_INVITATION', 'SENT', NULL, '2026-10-03T10:00:00Z', '2026-10-03T10:00:00Z'
    )
  `).run();

  // 4. Lịch phỏng vấn vòng 1
  db.prepare(`
    INSERT INTO interviews VALUES (
      'inv-current-01', 'cand-current', 'req-01', 'usr-int', 'Vòng 1: Đánh giá Kiến trúc Hệ thống',
      '2026-10-05T14:30:00Z', 'Phòng họp Tech Room 302', 'COMPLETED',
      'Ứng viên đã tiến bộ vượt bậc so với lần trước. Giải quyết trọn vẹn bài toán High Concurrency và Cache Invalidation.',
      5, '2026-10-05T16:00:00Z'
    )
  `).run();

  // 5. Ghi chú nội bộ điện thoại trao đổi mức lương (2026-10-06)
  db.prepare(`
    INSERT INTO candidate_notes VALUES (
      'cn-01', 'cand-current', 'usr-rec-primary', 'Nguyễn Thị Tuyển Dụng',
      'Đã gọi điện trao đổi trước: Ứng viên mong muốn mức lương 45.000.000 VNĐ, có thể bắt đầu làm việc từ ngày 15/11.',
      0, '2026-10-06T15:30:00Z'
    )
  `).run();

  // 6. Ghi chú mật nội bộ (2026-10-07)
  db.prepare(`
    INSERT INTO candidate_notes VALUES (
      'cn-private-01', 'cand-current', 'usr-rec-primary', 'Nguyễn Thị Tuyển Dụng',
      'Ghi chú mật: Ứng viên đang có 1 offer cạnh tranh từ đối thủ, cần đẩy nhanh tiến độ duyệt offer.',
      1, '2026-10-07T08:30:00Z'
    )
  `).run();

  // Định nghĩa các đối tượng vai trò
  const actorAdmin = { id: 'usr-admin', roles: ['ADMIN'] };
  const actorHr = { id: 'usr-hr', roles: ['HR_MANAGER'] };
  const actorPrimaryRecruiter = { id: 'usr-rec-primary', roles: ['RECRUITER'] };
  const actorSupportRecruiter = { id: 'usr-rec-support', roles: ['RECRUITER'] };
  const actorUnassignedRecruiter = { id: 'usr-rec-other', roles: ['RECRUITER'] };
  const actorHiringMgr = { id: 'usr-hm', roles: ['HIRING_MGR'] };
  const actorInterviewer = { id: 'usr-int', roles: ['INTERVIEWER'] };
  const actorCandidate = { id: 'usr-candidate', roles: ['CANDIDATE'] };

  require('../src/config/config').REQUISITION_OPERATIONS_ENABLED=true;
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN locked_until TEXT; CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT); CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT); INSERT INTO permissions VALUES('timeline-read','candidate.read');");
  for(const [user,role] of [[actorAdmin,'ADMIN'],[actorHr,'HR_MANAGER'],[actorPrimaryRecruiter,'RECRUITER'],[actorSupportRecruiter,'RECRUITER'],[actorUnassignedRecruiter,'RECRUITER'],[actorHiringMgr,'HIRING_MGR'],[actorInterviewer,'INTERVIEWER'],[actorCandidate,'CANDIDATE']]){
    db.prepare('INSERT OR IGNORE INTO roles(id,code) VALUES(?,?)').run('role-'+role,role);
    db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(user.id,'role-'+role);
  }
  for(const role of ['ADMIN','HR_MANAGER','RECRUITER','HIRING_MGR','INTERVIEWER','CANDIDATE'])db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)').run('role-'+role,'timeline-read');
  db.prepare('INSERT INTO requisition_recruiter_supports(requisition_id,user_id) VALUES(?,?)').run('req-02',actorPrimaryRecruiter.id);

  try {
    // --------------------------------------------------------------------------
    // TEST 1: AC-01 - ĐẦY ĐỦ 5 NHÓM SỰ KIỆN TƯƠNG TÁC
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 1] AC-01: Kiểm tra tính đầy đủ của 5 nhóm sự kiện tương tác...');
    const result = await timelineService.getCandidateTimeline('cand-current', actorPrimaryRecruiter);
    assert.strictEqual(result.success, true, 'Lấy timeline thành công');
    assert.strictEqual(result.statusCode, 200);

    const timeline = result.data.timeline;
    assert.ok(Array.isArray(timeline) && timeline.length >= 5, 'Dòng thời gian phải chứa ít nhất 5 sự kiện');

    const eventTypes = new Set(timeline.map(e => e.eventType));
    assert.ok(eventTypes.has('APPLICATION_SUBMITTED'), 'Phải có sự kiện: Nộp hồ sơ');
    assert.ok(eventTypes.has('STAGE_CHANGED'), 'Phải có sự kiện: Chuyển giai đoạn');
    assert.ok(eventTypes.has('EMAIL_SENT'), 'Phải có sự kiện: Email đã gửi');
    assert.ok(eventTypes.has('INTERVIEW_SCHEDULED'), 'Phải có sự kiện: Lịch phỏng vấn');
    assert.ok(eventTypes.has('EVALUATION_SUBMITTED'), 'Phải có sự kiện: Đánh giá phỏng vấn');
    assert.ok(eventTypes.has('NOTE_ADDED'), 'Phải có sự kiện: Ghi chú nội bộ');

    recordPass('AC-01: Đầy đủ toàn bộ 5 nhóm sự kiện tương tác theo mô tả Jira');

    // --------------------------------------------------------------------------
    // TEST 2: AC-02 - SẮP XẾP MỚI NHẤT TRƯỚC (ORDER BY timestamp DESC)
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 2] AC-02: Kiểm tra thứ tự sắp xếp dòng thời gian mới nhất trước...');
    for (let i = 0; i < timeline.length - 1; i++) {
      const currentTimestamp = new Date(timeline[i].timestamp).getTime();
      const nextTimestamp = new Date(timeline[i + 1].timestamp).getTime();
      assert.ok(
        currentTimestamp >= nextTimestamp,
        `Sự kiện ở vị trí ${i} (${timeline[i].timestamp}) phải xảy ra sau hoặc cùng lúc với vị trí ${i + 1} (${timeline[i + 1].timestamp})`
      );
    }
    // Sự kiện gần nhất phải là ghi chú ngày 2026-10-07
    assert.strictEqual(timeline[0].eventType, 'NOTE_ADDED');
    assert.ok(timeline[0].timestamp.startsWith('2026-10-07'));

    recordPass('AC-02: Sắp xếp dòng thời gian chính xác 100% theo thứ tự MỚI NHẤT TRƯỚC');

    // --------------------------------------------------------------------------
    // TEST 3: AC-03 - PHÂN QUYỀN IDOR CHO RECRUITER (PRIMARY vs SUPPORT vs UNASSIGNED)
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 3] AC-03: Kiểm tra phân quyền IDOR và phạm vi phụ trách của Recruiter...');

    // 3a. Recruiter chính được phép xem
    const resPrimary = await timelineService.getCandidateTimeline('cand-current', actorPrimaryRecruiter);
    assert.strictEqual(resPrimary.success, true, 'Primary Recruiter phải truy cập được');

    // 3b. Recruiter hỗ trợ (trong bảng requisition_recruiter_supports) được phép xem
    const resSupport = await timelineService.getCandidateTimeline('cand-current', actorSupportRecruiter);
    assert.strictEqual(resSupport.success, true, 'Support Recruiter phải truy cập được');

    // 3c. Recruiter không được phân công bị chặn truy cập (HTTP 403)
    const resUnassigned = await timelineService.getCandidateTimeline('cand-current', actorUnassignedRecruiter);
    assert.strictEqual(resUnassigned.success, false);
    assert.strictEqual(resUnassigned.statusCode, 403, 'Recruiter ngoài phạm vi phải nhận 403');
    assert.strictEqual(resUnassigned.code, 'CANDIDATE_OUT_OF_SCOPE');

    recordPass('AC-03: Kiểm soát phân quyền IDOR hoàn hảo giữa Primary, Support và Unassigned Recruiter');

    // --------------------------------------------------------------------------
    // TEST 4: AC-04 - PHÂN QUYỀN ĐA VAI TRÒ (HIRING MGR, INTERVIEWER, HR, ADMIN)
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 4] AC-04: Kiểm tra quyền xem của Hiring Manager, Interviewer, HR Manager và Admin...');

    const resHm = await timelineService.getCandidateTimeline('cand-current', actorHiringMgr);
    assert.strictEqual(resHm.success, true, 'Hiring Manager của vị trí phải truy cập được');

    const resInt = await timelineService.getCandidateTimeline('cand-current', actorInterviewer);
    assert.strictEqual(resInt.success, true, 'Interviewer phụ trách phỏng vấn ứng viên phải truy cập được');

    const resHr = await timelineService.getCandidateTimeline('cand-current', actorHr);
    assert.strictEqual(resHr.success, true, 'HR Manager phải có quyền xem');

    const resAdmin = await timelineService.getCandidateTimeline('cand-current', actorAdmin);
    assert.strictEqual(resAdmin.success, true, 'Admin phải có toàn quyền');

    recordPass('AC-04: Phân quyền đa vai trò nội bộ đúng chuẩn ma trận phân quyền hệ thống');

    // --------------------------------------------------------------------------
    // TEST 5: AC-05 - BẢO VỆ DỮ LIỆU ỨNG VIÊN BÊN NGOÀI (CANDIDATE ROLE CHẶN 403)
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 5] AC-05: Kiểm tra tài khoản ứng viên ngoài không được đọc timeline nội bộ...');

    const resCand = await timelineService.getCandidateTimeline('cand-current', actorCandidate);
    assert.strictEqual(resCand.success, false);
    assert.strictEqual(resCand.statusCode, 403, 'Tài khoản CANDIDATE phải bị chặn 403');
    assert.strictEqual(resCand.code, 'CANDIDATE_OUT_OF_SCOPE');

    recordPass('AC-05: Chặn tuyệt đối tài khoản ứng viên xem nhật ký trao đổi nội bộ');

    // --------------------------------------------------------------------------
    // TEST 6: AC-06 - XỬ LÝ GHI CHÚ RIÊNG TƯ & MÃ ỨNG VIÊN KHÔNG TỒN TẠI (404)
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 6] AC-06: Kiểm tra xử lý ghi chú riêng tư và lỗi 404...');

    // 6a. Ứng viên không tồn tại trả về 404
    const resNotFound = await timelineService.getCandidateTimeline('cand-nonexistent-999', actorAdmin);
    assert.strictEqual(resNotFound.success, false);
    assert.strictEqual(resNotFound.statusCode, 404);
    assert.strictEqual(resNotFound.code, 'CANDIDATE_NOT_FOUND');

    // 6b. Ghi chú riêng tư chỉ tác giả hoặc HR/Admin được đọc
    const resInterviewerNotes = await timelineService.getCandidateTimeline('cand-current', actorInterviewer);
    const interviewerTimeline = resInterviewerNotes.data.timeline;
    const hasPrivateNote = interviewerTimeline.some(e => e.eventType === 'NOTE_ADDED' && e.details?.isPrivate === true);
    assert.strictEqual(hasPrivateNote, false, 'Interviewer không phải tác giả không được đọc ghi chú riêng tư');

    recordPass('AC-06: Bảo vệ ghi chú riêng tư và xử lý 404 CANDIDATE_NOT_FOUND chính xác');

    // --------------------------------------------------------------------------
    // TEST 7: AC-07 - HỖ TRỢ ĐỒNG THỜI CẢ EMAIL_LOGS VÀ EMAIL_OUTBOX
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 7] AC-07: Kiểm tra tổng hợp email từ cả email_logs (Base) và email_outbox (Sprint 4)...');

    const emailEvents = timeline.filter(e => e.eventType === 'EMAIL_SENT');
    assert.ok(emailEvents.length >= 2, 'Phải có ít nhất 2 email được ghi nhận trong timeline');
    const sources = new Set(emailEvents.map(e => e.details?.sourceTable));
    assert.ok(sources.has('email_logs'), 'Phải đọc được email từ email_logs');
    assert.ok(sources.has('email_outbox'), 'Phải đọc được email từ email_outbox');

    recordPass('AC-07: Hỗ trợ hợp nhất 2 nguồn lưu email (email_logs và email_outbox)');

    // --------------------------------------------------------------------------
    // TEST 8: AC-08 - LỊCH SỬ TƯƠNG TÁC HỢP NHẤT CHO ỨNG VIÊN ĐA HỒ SƠ (UNIFIED)
    // --------------------------------------------------------------------------
    totalTests++;
    console.log('[TEST 8] AC-08: Kiểm tra lịch sử đa hồ sơ (Recruiter đọc được đánh giá phỏng vấn năm trước)...');

    // Tìm sự kiện đánh giá từ hồ sơ cũ năm 2025
    const pastEval = timeline.find(
      e => e.eventType === 'EVALUATION_SUBMITTED' && e.summary.includes('Distributed Systems')
    );
    assert.ok(pastEval, 'Recruiter phải xem được đánh giá từ lần ứng tuyển trước');
    assert.strictEqual(pastEval.details.score, 4);

    // Tìm ghi chú trao đổi điện thoại hiện tại
    const currentNote = timeline.find(
      e => e.eventType === 'NOTE_ADDED' && e.summary.includes('45.000.000 VNĐ')
    );
    assert.ok(currentNote, 'Recruiter phải xem được nội dung trao đổi lương trước khi gọi');
    assert.strictEqual(currentNote.actorName, 'Nguyễn Thị Tuyển Dụng');

    recordPass('AC-08: Dòng thời gian hợp nhất đa hồ sơ cung cấp trọn vẹn bối cảnh cho Recruiter trước cuộc gọi');

    totalTests++;
    assert.strictEqual((await timelineService.getCandidateTimeline('cand-current',null)).statusCode,401);
    assert.strictEqual((await timelineService.getCandidateTimeline('cand-current',{id:'missing',roles:['ADMIN']})).statusCode,403);
    assert.strictEqual((await timelineService.getCandidateTimeline('cand-current',{...actorUnassignedRecruiter,roles:['ADMIN']})).statusCode,403);
    recordPass('Actor và role giả không vượt service authorization');

    totalTests++;
    db.prepare("UPDATE users SET status='LOCKED' WHERE id=?").run(actorPrimaryRecruiter.id);
    assert.strictEqual((await timelineService.getCandidateTimeline('cand-current',actorPrimaryRecruiter)).statusCode,403);
    db.prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run(actorPrimaryRecruiter.id);
    db.prepare("DELETE FROM role_permissions WHERE role_id='role-RECRUITER'").run();
    assert.strictEqual((await timelineService.getCandidateTimeline('cand-current',actorPrimaryRecruiter)).statusCode,403);
    db.prepare("INSERT INTO role_permissions VALUES('role-RECRUITER','timeline-read')").run();
    recordPass('LOCKED và thu hồi grant có hiệu lực ngay');

    totalTests++;
    db.prepare("DELETE FROM requisition_recruiter_supports WHERE requisition_id='req-02' AND user_id=?").run(actorPrimaryRecruiter.id);
    const scoped=await timelineService.getCandidateTimeline('cand-current',actorPrimaryRecruiter);
    assert.strictEqual(scoped.success,true);
    assert.ok(!scoped.data.timeline.some(event=>event.details?.candidateId==='cand-past'));
    assert.ok(!scoped.data.timeline.some(event=>event.id==='interview-inv-past-01' || event.id==='evaluation-inv-past-01'));
    assert.ok(!JSON.stringify(scoped).includes('Distributed Systems'));
    assert.strictEqual(scoped.data.timeline.filter(event=>event.eventType==='EMAIL_SENT').length,0);
    const global=await timelineService.getCandidateTimeline('cand-current',actorHr);
    assert.ok(global.data.timeline.some(event=>event.eventType==='EVALUATION_SUBMITTED' && event.details?.score===4));
    recordPass('Application cùng email ngoài scope không lộ history hoặc đánh giá; HR vẫn xem được');

    console.log('\n================================================================');
    console.log(`🎉 KẾT QUẢ: ${passCount}/${totalTests} BÀI TEST ĐẠT (100% PASS)!`);
    console.log('USER STORY S5-07 (SCRUM-117) ĐÃ HOÀN TẤT ĐÚNG CHUẨN ĐẶC TẢ.');
    console.log('================================================================');
  } catch (err) {
    console.error('\n❌ TEST THẤT BẠI TẠI:', err);
    process.exit(1);
  }
}

runTestSuite();
