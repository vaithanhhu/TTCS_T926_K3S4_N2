const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const SlaNotificationService = require('../src/services/slaNotificationService');
const SlaNotificationController = require('../src/controllers/slaNotificationController');

/**
 * ==============================================================================
 * TEST SUITE: USER STORY S5-10 / SCRUM-120
 * ==============================================================================
 * 
 * Là Nhân viên tuyển dụng, tôi muốn được nhắc khi công việc quá hạn SLA,
 * để không để hồ sơ nằm im ba ngày mà chưa ai đọc.
 * 
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Cấu hình ngưỡng SLA cho từng giai đoạn, ví dụ hồ sơ mới phải sàng lọc trong 3 ngày
 *   • AC-02: Quá hạn thì hồ sơ được gắn cờ và recruiter nhận nhắc việc
 *   • AC-03: Tác vụ định kỳ chạy mỗi ngày một lần, không nhắc trùng trong cùng ngày
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
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      before_stage TEXT,
      after_stage TEXT NOT NULL,
      actor_name TEXT,
      action TEXT,
      reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S5-10 / SCRUM-120');
  console.log('Candidate SLA Configuration, Breach Flagging & Daily Reminders');
  console.log('================================================================\n');

  let passedTests = 0;
  const db = setupDatabase();

  // Nạp người dùng thử nghiệm
  db.prepare(`INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)`).run('admin-1', 'admin@example.com', 'Admin User');
  db.prepare(`INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)`).run('recruiter-1', 'rec1@example.com', 'Nguyễn Tuyển Dụng 1');
  db.prepare(`INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)`).run('recruiter-2', 'rec2@example.com', 'Trần Tuyển Dụng 2');
  db.prepare(`INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)`).run('recruiter-support', 'recsub@example.com', 'Lê Hỗ Trợ');
  db.prepare(`INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)`).run('cand-user-1', 'candidate@example.com', 'Ứng Viên Nguyễn');

  db.prepare(`INSERT INTO roles (id, code, name) VALUES (?, ?, ?)`).run('role-admin', 'ADMIN', 'Quản trị viên');
  db.prepare(`INSERT INTO roles (id, code, name) VALUES (?, ?, ?)`).run('role-recruiter', 'RECRUITER', 'Nhân viên tuyển dụng');
  db.prepare(`INSERT INTO roles (id, code, name) VALUES (?, ?, ?)`).run('role-candidate', 'CANDIDATE', 'Ứng viên');

  db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).run('admin-1', 'role-admin');
  db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).run('recruiter-1', 'role-recruiter');
  db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).run('recruiter-2', 'role-recruiter');
  db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).run('recruiter-support', 'role-recruiter');
  db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).run('cand-user-1', 'role-candidate');

  // Nạp 2 vị trí tuyển dụng
  db.prepare(`INSERT INTO requisitions (id, code, title, recruiter_id) VALUES (?, ?, ?, ?)`).run(
    'req-frontend', 'REQ-FE', 'Lập trình viên Frontend React', 'recruiter-1'
  );
  db.prepare(`INSERT INTO requisitions (id, code, title, recruiter_id) VALUES (?, ?, ?, ?)`).run(
    'req-backend', 'REQ-BE', 'Lập trình viên Backend Node.js', 'recruiter-2'
  );

  // Phân công recruiter-support hỗ trợ vị trí req-frontend
  db.prepare(`INSERT INTO requisition_recruiter_supports (requisition_id, user_id) VALUES (?, ?)`).run(
    'req-frontend', 'recruiter-support'
  );

  // Mock currentUser
  const adminActor = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };
  const rec1Actor = { id: 'recruiter-1', email: 'rec1@example.com', roles: ['RECRUITER'] };
  const rec2Actor = { id: 'recruiter-2', email: 'rec2@example.com', roles: ['RECRUITER'] };
  const candActor = { id: 'cand-user-1', email: 'candidate@example.com', roles: ['CANDIDATE'] };

  // Khởi tạo service
  const slaService = new SlaNotificationService(db);

  // Mốc thời gian thử nghiệm: 2026-10-16 12:00:00Z
  const BASE_TIME = new Date('2026-10-16T12:00:00Z');

  // ============================================================================
  // NHÓM 1: AC-01 CẤU HÌNH NGƯỠNG SLA CHO TỪNG GIAI ĐOẠN
  // ============================================================================

  // Test 1: Khởi tạo bảng thành công và nạp sẵn cấu hình SLA mặc định
  {
    const configs = await slaService.getSlaConfigurations();
    assert.strictEqual(configs.success, true);
    assert.strictEqual(configs.data.length, 4);

    const newStageCfg = configs.data.find(c => c.stage === 'NEW');
    assert.ok(newStageCfg);
    assert.strictEqual(newStageCfg.thresholdDays, 3, 'Hồ sơ mới phải có ngưỡng mặc định 3 ngày');
    console.log('[PASS] Test 1: AC-01 Tự động nạp cấu hình SLA mặc định (NEW: 3 ngày) thành công');
    passedTests++;
  }

  // Test 2: Đọc danh sách cấu hình SLA đầy đủ thông tin các giai đoạn
  {
    const configs = await slaService.getSlaConfigurations();
    const stages = configs.data.map(c => c.stage);
    assert.ok(stages.includes('NEW'));
    assert.ok(stages.includes('SCREENING'));
    assert.ok(stages.includes('INTERVIEW'));
    assert.ok(stages.includes('OFFER'));
    console.log('[PASS] Test 2: AC-01 Đọc đầy đủ cấu hình 4 giai đoạn NEW, SCREENING, INTERVIEW, OFFER');
    passedTests++;
  }

  // Test 3: Cập nhật cấu hình SLA thành công (ví dụ NEW: 2 ngày, SCREENING: 4 ngày)
  {
    const updateRes = await slaService.updateSlaConfigurations([
      { stage: 'NEW', thresholdDays: 2, description: 'Sàng lọc gấp trong 2 ngày' },
      { stage: 'SCREENING', thresholdDays: 4, description: 'Sàng lọc chuyên sâu 4 ngày' }
    ], rec1Actor);

    assert.strictEqual(updateRes.success, true);
    assert.strictEqual(updateRes.statusCode, 200);
    console.log('[PASS] Test 3: AC-01 Cập nhật ngưỡng SLA cho từng giai đoạn thành công');
    passedTests++;
  }

  // Test 4: Đọc lại cấu hình đã cập nhật đảm bảo tính toàn vẹn
  {
    const configs = await slaService.getSlaConfigurations();
    const newCfg = configs.data.find(c => c.stage === 'NEW');
    assert.strictEqual(newCfg.thresholdDays, 2);
    assert.strictEqual(newCfg.description, 'Sàng lọc gấp trong 2 ngày');

    // Khôi phục lại ngưỡng chuẩn 3 ngày cho các test sau
    await slaService.updateSlaConfigurations([
      { stage: 'NEW', thresholdDays: 3, description: 'Hồ sơ mới phải sàng lọc trong 3 ngày' },
      { stage: 'SCREENING', thresholdDays: 5, description: 'Sàng lọc trong 5 ngày' }
    ], adminActor);
    console.log('[PASS] Test 4: AC-01 Đọc lại cấu hình đã cập nhật đảm bảo tính toàn vẹn dữ liệu');
    passedTests++;
  }

  // ============================================================================
  // NHÓM 2: AC-02 GẮN CỜ HỒ SƠ QUÁ HẠN & DANH SÁCH HỒ SƠ
  // ============================================================================

  // Nạp các ứng viên với các mốc thời gian khác nhau:
  // cand-fresh: nộp 1 ngày trước (2026-10-15T12:00:00Z) -> chưa quá hạn 3 ngày
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-fresh', 'req-frontend', 'Nguyễn Thị Tươi Mới', 'fresh@gmail.com', '0911111111', 'NEW', '2026-10-15T12:00:00Z');

  // cand-overdue-new: nộp 4 ngày trước (2026-10-12T12:00:00Z) -> quá hạn 3 ngày (quá 1 ngày)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-overdue-new', 'req-frontend', 'Phạm Quá Hạn Mới', 'overdue_new@gmail.com', '0922222222', 'NEW', '2026-10-12T12:00:00Z');

  // cand-overdue-screening: nộp 10 ngày trước, vào stage SCREENING cách đây 6 ngày (> 5 ngày)
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-overdue-scr', 'req-frontend', 'Hoàng Quá Hạn Sàng Lọc', 'overdue_scr@gmail.com', '0933333333', 'SCREENING', '2026-10-06T12:00:00Z');
  db.prepare(`
    INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('hist-1', 'cand-overdue-scr', 'NEW', 'SCREENING', '2026-10-10T12:00:00Z'); // 6 ngày trước

  // cand-hired: nộp 20 ngày trước, nhưng đã ở stage HIRED -> không tính quá hạn
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-hired', 'req-frontend', 'Đỗ Thành Công', 'hired@gmail.com', '0944444444', 'HIRED', '2026-09-26T12:00:00Z');

  // cand-req-be: nộp 5 ngày trước ở vị trí Backend
  db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-req-be', 'req-backend', 'Trần Backend Trễ', 'backend_late@gmail.com', '0955555555', 'NEW', '2026-10-11T12:00:00Z');

  // Test 5: Hồ sơ mới nộp 1 ngày trước (< 3 ngày) -> Đang trong hạn (isOverdue = false, flag = 'ON_TRACK')
  {
    const cand = await db.prepare('SELECT * FROM candidates WHERE id = ?').get('cand-fresh');
    const sla = await slaService.calculateCandidateSla(cand, null, BASE_TIME);

    assert.strictEqual(sla.isOverdue, false);
    assert.strictEqual(sla.daysInStage, 1);
    assert.strictEqual(sla.thresholdDays, 3);
    assert.strictEqual(sla.flag, 'ON_TRACK');
    console.log('[PASS] Test 5: AC-02 Hồ sơ mới 1 ngày được tính đúng hạn (1/3 ngày, ON_TRACK)');
    passedTests++;
  }

  // Test 6: Hồ sơ mới nộp 4 ngày trước (> 3 ngày) -> Gắn cờ vi phạm quá hạn SLA
  {
    const cand = await db.prepare('SELECT * FROM candidates WHERE id = ?').get('cand-overdue-new');
    const sla = await slaService.calculateCandidateSla(cand, null, BASE_TIME);

    assert.strictEqual(sla.isOverdue, true);
    assert.strictEqual(sla.daysInStage, 4);
    assert.strictEqual(sla.thresholdDays, 3);
    assert.strictEqual(sla.overdueDays, 1);
    assert.strictEqual(sla.flag, 'BREACHED');
    console.log('[PASS] Test 6: AC-02 Hồ sơ nằm im 4 ngày (> 3 ngày) bị gắn cờ quá hạn SLA (BREACHED)');
    passedTests++;
  }

  // Test 7: Hồ sơ ở giai đoạn kết thúc (HIRED, REJECTED, WITHDRAWN) không bị tính quá hạn SLA
  {
    const cand = await db.prepare('SELECT * FROM candidates WHERE id = ?').get('cand-hired');
    const sla = await slaService.calculateCandidateSla(cand, null, BASE_TIME);

    assert.strictEqual(sla.isOverdue, false);
    assert.strictEqual(sla.flag, 'RESOLVED');
    console.log('[PASS] Test 7: AC-02 Hồ sơ giai đoạn HIRED không bị tính vi phạm SLA');
    passedTests++;
  }

  // Test 8: Lấy danh sách hồ sơ quá hạn (getOverdueCandidates) trả về chính xác hồ sơ vi phạm
  {
    const res = await slaService.getOverdueCandidates(adminActor, { referenceDate: BASE_TIME });
    assert.strictEqual(res.success, true);
    assert.ok(res.data.totalOverdue >= 3, 'Phải phát hiện ít nhất 3 hồ sơ quá hạn');

    const ids = res.data.candidates.map(c => c.id);
    assert.ok(ids.includes('cand-overdue-new'));
    assert.ok(ids.includes('cand-overdue-scr'));
    assert.ok(ids.includes('cand-req-be'));
    assert.ok(!ids.includes('cand-fresh'));
    assert.ok(!ids.includes('cand-hired'));
    console.log('[PASS] Test 8: AC-02 getOverdueCandidates lọc chính xác danh sách hồ sơ quá hạn');
    passedTests++;
  }

  // Test 9: Lọc danh sách hồ sơ quá hạn theo vị trí (requisitionId)
  {
    const res = await slaService.getOverdueCandidates(adminActor, {
      requisitionId: 'req-backend',
      referenceDate: BASE_TIME
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.candidates.length, 1);
    assert.strictEqual(res.data.candidates[0].id, 'cand-req-be');
    console.log('[PASS] Test 9: AC-02 Lọc hồ sơ quá hạn theo vị trí (requisitionId) chính xác');
    passedTests++;
  }

  // ============================================================================
  // NHÓM 3: AC-03 TÁC VỤ ĐỊNH KỲ & CHỐNG NHẮC TRÙNG TRONG CÙNG NGÀY
  // ============================================================================

  // Test 10: Chạy tác vụ quét SLA định kỳ ngày 1 (2026-10-16) -> Tạo nhắc việc cho recruiter
  {
    const jobRes = await slaService.runDailySlaCheck('2026-10-16', adminActor);
    assert.strictEqual(jobRes.success, true);
    assert.ok(jobRes.data.breachesFound >= 3);
    assert.ok(jobRes.data.remindersCreated > 0, 'Phải tạo nhắc việc cho recruiter phụ trách');

    // Kiểm tra bảng candidate_sla_breaches
    const breach = await db.prepare('SELECT * FROM candidate_sla_breaches WHERE candidate_id = ?').get('cand-overdue-new');
    assert.ok(breach);
    assert.strictEqual(breach.is_overdue, 1);
    assert.strictEqual(breach.status, 'ACTIVE');

    // Kiểm tra bảng sla_reminders
    const reminders = await db.prepare('SELECT * FROM sla_reminders WHERE candidate_id = ?').all('cand-overdue-new');
    assert.ok(reminders.length >= 1);
    assert.strictEqual(reminders[0].reminder_date, '2026-10-16');
    console.log('[PASS] Test 10: AC-03 Chạy tác vụ định kỳ thành công: Gắn cờ và tạo nhắc việc cho recruiter');
    passedTests++;
  }

  // Test 11: CHỐNG NHẮC TRÙNG TRONG CÙNG NGÀY (AC-03 CRITICAL)
  {
    // Chạy lại tác vụ một lần nữa trong cùng ngày 2026-10-16
    const repeatRes = await slaService.runDailySlaCheck('2026-10-16', adminActor);
    assert.strictEqual(repeatRes.success, true);
    assert.strictEqual(repeatRes.data.remindersCreated, 0, 'KHÔNG ĐƯỢC TẠO NHẮC VIỆC TRÙNG LẶP TRONG CÙNG NGÀY');

    const totalRemindersToday = await db.prepare('SELECT COUNT(*) AS c FROM sla_reminders WHERE reminder_date = ?').get('2026-10-16');
    assert.ok(totalRemindersToday.c > 0);
    console.log('[PASS] Test 11: AC-03 ĐẢM BẢO CHỐNG NHẮC TRÙNG: Chạy lại trong cùng ngày tạo 0 nhắc việc mới');
    passedTests++;
  }

  // Test 12: Chạy tác vụ sang ngày hôm sau (2026-10-17) -> Tạo bản ghi nhắc việc mới cho ngày mới
  {
    const nextDayRes = await slaService.runDailySlaCheck('2026-10-17', adminActor);
    assert.strictEqual(nextDayRes.success, true);
    assert.ok(nextDayRes.data.remindersCreated > 0, 'Sang ngày mới được phép nhắc tiếp nếu vẫn quá hạn');

    const remNextDay = await db.prepare('SELECT * FROM sla_reminders WHERE candidate_id = ? AND reminder_date = ?').get('cand-overdue-new', '2026-10-17');
    assert.ok(remNextDay);
    console.log('[PASS] Test 12: AC-03 Sang ngày hôm sau (2026-10-17) nhắc việc ngày mới được tạo chính xác');
    passedTests++;
  }

  // Test 13: Recruiter hỗ trợ được phân công (requisition_recruiter_supports) cũng nhận được nhắc việc
  {
    const supportReminders = await db.prepare(
      `SELECT * FROM sla_reminders WHERE recruiter_id = ? AND candidate_id = ?`
    ).all('recruiter-support', 'cand-overdue-new');
    assert.ok(supportReminders.length > 0, 'Recruiter hỗ trợ phải nhận được nhắc việc');
    console.log('[PASS] Test 13: AC-03 Recruiter hỗ trợ được phân công trên vị trí cũng nhận được nhắc việc');
    passedTests++;
  }

  // Test 14: Lấy danh sách nhắc việc của Recruiter (getRecruiterReminders)
  {
    const remResult = await slaService.getRecruiterReminders(rec1Actor);
    assert.strictEqual(remResult.success, true);
    assert.ok(remResult.data.reminders.length > 0);
    assert.ok(remResult.data.unreadCount > 0);
    assert.ok(remResult.data.reminders.some(r => r.candidateId === 'cand-overdue-new'));
    console.log('[PASS] Test 14: getRecruiterReminders hiển thị đúng danh sách nhắc việc và số lượng chưa đọc');
    passedTests++;
  }

  // Test 15: Recruiter đánh dấu 1 nhắc việc là đã đọc (markReminderAsRead)
  {
    const remResult = await slaService.getRecruiterReminders(rec1Actor);
    const target = remResult.data.reminders[0];

    const markRes = await slaService.markReminderAsRead(target.id, rec1Actor);
    assert.strictEqual(markRes.success, true);

    const checked = await db.prepare('SELECT is_read FROM sla_reminders WHERE id = ?').get(target.id);
    assert.strictEqual(checked.is_read, 1);
    console.log('[PASS] Test 15: markReminderAsRead đánh dấu đã đọc thành công');
    passedTests++;
  }

  // Test 16: Recruiter đánh dấu tất cả nhắc việc là đã đọc (markAllRemindersAsRead)
  {
    const markAllRes = await slaService.markAllRemindersAsRead(rec1Actor);
    assert.strictEqual(markAllRes.success, true);

    const unread = await slaService.getRecruiterReminders(rec1Actor, { unreadOnly: true });
    assert.strictEqual(unread.data.unreadCount, 0);
    assert.strictEqual(unread.data.reminders.length, 0);
    console.log('[PASS] Test 16: markAllRemindersAsRead đánh dấu toàn bộ nhắc việc đã đọc thành công');
    passedTests++;
  }

  // Test 17: Hồ sơ chuyển stage sang INTERVIEW thì cờ vi phạm cũ được chuyển thành RESOLVED
  {
    db.prepare(`UPDATE candidates SET stage = 'INTERVIEW' WHERE id = ?`).run('cand-overdue-new');
    db.prepare(`
      INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('hist-2', 'cand-overdue-new', 'NEW', 'INTERVIEW', '2026-10-17T12:00:00Z');

    await slaService.runDailySlaCheck('2026-10-17', adminActor);

    const breach = await db.prepare('SELECT status FROM candidate_sla_breaches WHERE candidate_id = ? AND stage = ?').get('cand-overdue-new', 'NEW');
    assert.strictEqual(breach.status, 'RESOLVED');
    console.log('[PASS] Test 17: Cờ vi phạm cũ được tự động đánh dấu RESOLVED khi hồ sơ chuyển giai đoạn');
    passedTests++;
  }

  // ============================================================================
  // NHÓM 4: BẢO MẬT PHÂN QUYỀN RBAC, IDOR & CONTROLLER
  // ============================================================================

  // Test 18: Phân quyền IDOR: Recruiter-2 chỉ xem được hồ sơ của req-backend, không thấy req-frontend
  {
    const res = await slaService.getOverdueCandidates(rec2Actor, { referenceDate: BASE_TIME });
    assert.strictEqual(res.success, true);
    for (const c of res.data.candidates) {
      assert.strictEqual(c.requisitionId, 'req-backend', 'Recruiter 2 không được thấy hồ sơ ngoài vị trí');
    }
    console.log('[PASS] Test 18: Chống IDOR: Recruiter chỉ xem được hồ sơ quá hạn thuộc vị trí được phân công');
    passedTests++;
  }

  // Test 19: Admin / HR có toàn quyền xem tất cả hồ sơ quá hạn trên hệ thống
  {
    const res = await slaService.getOverdueCandidates(adminActor, { referenceDate: BASE_TIME });
    assert.strictEqual(res.success, true);
    const reqIds = new Set(res.data.candidates.map(c => c.requisitionId));
    assert.ok(reqIds.has('req-frontend'));
    assert.ok(reqIds.has('req-backend'));
    console.log('[PASS] Test 19: Phân quyền RBAC: Admin xem được toàn bộ hồ sơ quá hạn trên hệ thống');
    passedTests++;
  }

  // Test 20: Vai trò không có quyền (CANDIDATE) bị từ chối 403 CANDIDATE_FORBIDDEN
  {
    const res = await slaService.getOverdueCandidates(candActor, { referenceDate: BASE_TIME });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.code, 'CANDIDATE_FORBIDDEN');
    console.log('[PASS] Test 20: Chặn truy cập trái phép: CANDIDATE bị từ chối HTTP 403');
    passedTests++;
  }

  // Controller Tests
  const mockRbac = {
    authorize: async (req, res, authService, permission) => {
      return req.user;
    }
  };
  const controller = new SlaNotificationController(slaService, mockRbac, {});

  function createMockRes() {
    let statusCode = 200;
    let headers = {};
    let body = '';
    return {
      writeHead(code, h) { statusCode = code; headers = h; },
      end(data) { body = data; },
      getResponse() { return { statusCode, headers, data: JSON.parse(body || '{}') }; }
    };
  }

  // Test 21: Controller xử lý GET /api/v1/sla/configs thành công
  {
    const req = { method: 'GET', user: rec1Actor };
    const res = createMockRes();
    const url = new URL('http://localhost/api/v1/sla/configs');

    await controller.handle(req, res, url);
    const response = res.getResponse();
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.data.success, true);
    assert.ok(Array.isArray(response.data.data));
    console.log('[PASS] Test 21: Controller GET /api/v1/sla/configs thành công');
    passedTests++;
  }

  // Test 22: Controller xử lý PUT /api/v1/sla/configs thành công
  {
    const req = { method: 'PUT', user: adminActor };
    const res = createMockRes();
    const url = new URL('http://localhost/api/v1/sla/configs');
    const parseBody = async () => ([
      { stage: 'NEW', thresholdDays: 3 },
      { stage: 'SCREENING', thresholdDays: 5 }
    ]);

    await controller.handle(req, res, url, parseBody);
    const response = res.getResponse();
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.data.success, true);
    console.log('[PASS] Test 22: Controller PUT /api/v1/sla/configs thành công');
    passedTests++;
  }

  // Test 23: Controller xử lý GET /api/v1/sla/overdue-candidates thành công
  {
    const req = { method: 'GET', user: rec1Actor };
    const res = createMockRes();
    const url = new URL('http://localhost/api/v1/sla/overdue-candidates');

    await controller.handle(req, res, url);
    const response = res.getResponse();
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.data.success, true);
    assert.ok(Array.isArray(response.data.data.candidates));
    console.log('[PASS] Test 23: Controller GET /api/v1/sla/overdue-candidates thành công');
    passedTests++;
  }

  // Test 24: Controller xử lý POST /api/v1/sla/check thành công
  {
    const req = { method: 'POST', user: adminActor };
    const res = createMockRes();
    const url = new URL('http://localhost/api/v1/sla/check');
    const parseBody = async () => ({ date: '2026-10-18' });

    await controller.handle(req, res, url, parseBody);
    const response = res.getResponse();
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.data.success, true);
    assert.strictEqual(response.data.data.date, '2026-10-18');
    console.log('[PASS] Test 24: Controller POST /api/v1/sla/check (quét định kỳ) thành công');
    passedTests++;
  }

  // Test 25: Controller xử lý GET /api/v1/sla/summary thành công
  {
    const req = { method: 'GET', user: rec1Actor };
    const res = createMockRes();
    const url = new URL('http://localhost/api/v1/sla/summary');

    await controller.handle(req, res, url);
    const response = res.getResponse();
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.data.success, true);
    assert.ok('complianceRate' in response.data.data);
    console.log('[PASS] Test 25: Controller GET /api/v1/sla/summary (KPI & tỷ lệ tuân thủ SLA) thành công');
    passedTests++;
  }

  console.log('\n================================================================');
  console.log(`KẾT QUẢ TEST SUITE S5-10: HOÀN THÀNH XUẤT SẮC ${passedTests}/25 TESTS (100% PASS)`);
  console.log('Tất cả các tiêu chí AC-01, AC-02, AC-03, IDOR & RBAC đã được xác minh hoàn hảo!');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
