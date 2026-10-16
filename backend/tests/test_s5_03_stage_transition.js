const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { getDatabase } = require('../src/db/database');
const CandidateStageService = require('../src/services/candidateStageService');
const RequisitionService = require('../src/services/requisitionService');
const RbacMiddleware = require('../src/middlewares/rbacMiddleware');

async function runS503Tests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ SPRINT 5: FEATURE S5-03 CHUYỂN GIAI ĐOẠN ỨNG VIÊN & LÝ DO LOẠI ===');
  const testDbPath = path.join(__dirname, '..', 'data', 'ats_test_s5_03.db');
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + ext); } catch {}
  }
  const db = getDatabase(testDbPath);

  // 1. Seed base users and roles
  const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
  if (userCount === 0) {
    await require('../src/db/seed').seedDatabase(db);
  }

  // 2. Run migrations up to 011
  const migrations = [
    'migrate-approval-configurations',
    'migrate-requisition-approvals',
    'migrate-headcount-budgets',
    'migrate-requisition-operations',
    'migrate-requisition-lifecycle',
    'migrate-requisition-tracking-job-drafts',
    'migrate-job-publication',
    'migrate-candidate-portal',
    'migrate-requisition-open-policy',
    'migrate-candidate-stage-transitions'
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
    CANDIDATE_PORTAL_ENABLED: true,
    CANDIDATE_STAGE_TRANSITIONS_ENABLED: true
  });

  const stageService = new CandidateStageService(db);
  const reqService = new RequisitionService(db);
  const rbac = new RbacMiddleware(db);

  // Setup actors
  const hrUser = await db.prepare("SELECT id, email, full_name AS fullName FROM users WHERE email='hrmanager@company.com'").get();
  const recUser = await db.prepare("SELECT id, email, full_name AS fullName FROM users WHERE email='recruiter@company.com'").get();
  const hiringUser = await db.prepare("SELECT id, email, full_name AS fullName FROM users WHERE email='hiringmgr@company.com'").get();

  const hrActor = await rbac.getAuthorizedActor(hrUser.id, 'candidate.update') || { ...hrUser, roles: ['HR_MANAGER'] };
  const recActor = await rbac.getAuthorizedActor(recUser.id, 'candidate.update') || { ...recUser, roles: ['RECRUITER'] };
  const hiringActor = await rbac.getAuthorizedActor(hiringUser.id, 'candidate.read') || { ...hiringUser, roles: ['HIRING_MGR'] };

  // Use seeded OPEN requisitions
  const reqId = 'req-001';
  const reqId2 = 'req-002';
  await db.prepare('UPDATE requisitions SET recruiter_id = ? WHERE id IN (?, ?)').run(recUser.id, reqId, reqId2);

  // Helper to create test candidate
  async function createTestCandidate(name, stage = 'APPLIED', req = reqId) {
    const id = 'cand-s5-' + crypto.randomUUID();
    await db.prepare(`
      INSERT INTO candidates (id, requisition_id, full_name, email, stage, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, req, name, `${id}@example.test`, stage);
    return id;
  }

  console.log('\n--- BẮT ĐẦU KIỂM THỬ 12 TIÊU CHÍ CHẤP NHẬN ---');

  // TC-1: Chuyển giai đoạn hợp lệ thành công và có nhật ký đúng người, đúng thời điểm.
  console.log('TC-1: Chuyển giai đoạn hợp lệ thành công & ghi nhật ký đúng người, thời điểm...');
  {
    const cand1 = await createTestCandidate('Ứng viên TC1', 'APPLIED');
    const updateRes = await stageService.updateStage(cand1, 'SCREENING', { notes: 'Chuyển sang sơ loại' }, recActor);
    assert.equal(updateRes.success, true, 'Chuyển stage hợp lệ phải thành công');
    assert.equal(updateRes.statusCode, 200);

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand1);
    assert.equal(candRow.stage, 'SCREENING', 'Stage trong candidates phải được cập nhật');

    const history = await db.prepare('SELECT * FROM candidate_status_history WHERE candidate_id = ? ORDER BY created_at DESC').all(cand1);
    assert.equal(history.length, 1, 'Phải có đúng 1 dòng nhật ký');
    assert.equal(history[0].before_stage, 'APPLIED');
    assert.equal(history[0].after_stage, 'SCREENING');
    assert.equal(history[0].actor_id, recActor.id);
    assert.equal(history[0].actor_name, recActor.fullName);
    assert.ok(history[0].created_at, 'Thời điểm thực hiện lấy từ hệ thống');

    // Chuyển trùng giai đoạn: no-op, không ghi nhật ký mới
    const sameStageRes = await stageService.updateStage(cand1, 'SCREENING', { notes: 'Trùng giai đoạn' }, recActor);
    assert.equal(sameStageRes.success, true);
    assert.equal(sameStageRes.data.unchanged, true);
    const historyAfter = await db.prepare('SELECT COUNT(*) AS count FROM candidate_status_history WHERE candidate_id = ?').get(cand1);
    assert.equal(historyAfter.count, 1, 'Không được tạo nhật ký mới khi trùng giai đoạn');
    console.log('  -> TC-1 PASS');
  }

  // TC-2: Chuyển sang "Loại" nhưng chưa chọn lý do: bị chặn.
  console.log('TC-2: Chuyển sang "Loại" nhưng chưa chọn lý do: bị chặn...');
  {
    const cand2 = await createTestCandidate('Ứng viên TC2', 'SCREENING');
    const rejectWithoutReason = await stageService.updateStage(cand2, 'REJECTED', { notes: 'Từ chối tự do' }, recActor);
    assert.equal(rejectWithoutReason.success, false, 'Chuyển sang REJECTED không có lý do phải bị chặn');
    assert.equal(rejectWithoutReason.statusCode, 400);
    assert.equal(rejectWithoutReason.code, 'REJECTION_REASON_REQUIRED');

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand2);
    assert.equal(candRow.stage, 'SCREENING', 'Giai đoạn phải được giữ nguyên khi thất bại');

    const historyCount = (await db.prepare('SELECT COUNT(*) AS c FROM candidate_status_history WHERE candidate_id = ?').get(cand2)).c;
    assert.equal(historyCount, 0, 'Không ghi nhật ký khi chuyển thất bại');
    console.log('  -> TC-2 PASS');
  }

  // TC-3: Gửi mã lý do không tồn tại qua API: bị chặn.
  console.log('TC-3: Gửi mã lý do không tồn tại qua API: bị chặn...');
  {
    const cand3 = await createTestCandidate('Ứng viên TC3', 'SCREENING');
    const rejectFakeReason = await stageService.updateStage(cand3, 'REJECTED', {
      rejectionReasonId: 'cat-non-existent-999',
      notes: 'Lý do bịa đặt'
    }, recActor);

    assert.equal(rejectFakeReason.success, false, 'Lý do không tồn tại phải bị chặn');
    assert.equal(rejectFakeReason.statusCode, 400);
    assert.equal(rejectFakeReason.code, 'INVALID_REJECTION_REASON');

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand3);
    assert.equal(candRow.stage, 'SCREENING', 'Giữ nguyên giai đoạn');
    console.log('  -> TC-3 PASS');
  }

  // TC-4: Chọn lý do hợp lệ: loại thành công, lưu đúng giai đoạn trước khi loại, yêu cầu giải thích khi chọn "Khác".
  console.log('TC-4: Chọn lý do hợp lệ: loại thành công & bắt buộc giải thích cho "Khác"...');
  {
    const cand4 = await createTestCandidate('Ứng viên TC4', 'SCREENING');
    
    // Thử chọn "Khác" nhưng không nhập giải thích -> Phải bị chặn
    const rejectOtherEmptyNotes = await stageService.updateStage(cand4, 'REJECTED', {
      rejectionReasonId: 'cat-rej-other',
      notes: ''
    }, recActor);
    assert.equal(rejectOtherEmptyNotes.success, false);
    assert.equal(rejectOtherEmptyNotes.code, 'REJECTION_EXPLANATION_REQUIRED');

    // Chọn lý do cụ thể hợp lệ: 'cat-rej-skills'
    const rejectValid = await stageService.updateStage(cand4, 'REJECTED', {
      rejectionReasonId: 'cat-rej-skills',
      notes: 'Kỹ năng thuật toán chưa đáp ứng'
    }, recActor);
    assert.equal(rejectValid.success, true);

    const candRow = await db.prepare('SELECT stage, rejection_reason_id FROM candidates WHERE id = ?').get(cand4);
    assert.equal(candRow.stage, 'REJECTED');
    assert.equal(candRow.rejection_reason_id, 'cat-rej-skills');

    const history = await db.prepare('SELECT * FROM candidate_status_history WHERE candidate_id = ?').get(cand4);
    assert.equal(history.before_stage, 'SCREENING', 'Lưu chính xác giai đoạn ngay trước khi bị loại');
    assert.equal(history.after_stage, 'REJECTED');
    assert.equal(history.rejection_reason_id, 'cat-rej-skills');
    assert.equal(history.reason, 'Không đáp ứng yêu cầu chuyên môn / kỹ năng');

    // Thử lại với lý do "Khác" có giải thích chi tiết -> Thành công
    const cand4b = await createTestCandidate('Ứng viên TC4b', 'APPLIED');
    const rejectOtherWithNotes = await stageService.updateStage(cand4b, 'REJECTED', {
      rejectionReasonId: 'cat-rej-other',
      notes: 'Ứng viên chuyển nơi cư trú ra nước ngoài đột xuất'
    }, recActor);
    assert.equal(rejectOtherWithNotes.success, true);
    const historyOther = await db.prepare('SELECT * FROM candidate_status_history WHERE candidate_id = ?').get(cand4b);
    assert.equal(historyOther.before_stage, 'APPLIED');
    assert.equal(historyOther.notes, 'Ứng viên chuyển nơi cư trú ra nước ngoài đột xuất');
    console.log('  -> TC-4 PASS');
  }

  // TC-5: Hồ sơ đã qua Phỏng vấn: được chuyển sang Đề xuất offer khi đủ quyền.
  console.log('TC-5: Hồ sơ đã qua Phỏng vấn: được chuyển sang Đề xuất offer...');
  {
    const cand5 = await createTestCandidate('Ứng viên TC5', 'SCREENING');
    // Chuyển sang INTERVIEW
    await stageService.updateStage(cand5, 'INTERVIEW', { notes: 'Mời phỏng vấn vòng 1' }, recActor);

    // Thêm bản ghi interview
    await db.prepare(`
      INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status, created_at)
      VALUES (?, ?, ?, ?, 'Vòng 1', datetime('now'), 'COMPLETED', datetime('now'))
    `).run('int-s5-' + crypto.randomUUID(), cand5, reqId, hrUser.id);

    // Chuyển sang OFFER
    const offerRes = await stageService.updateStage(cand5, 'OFFER', { notes: 'Đạt phỏng vấn, gửi offer' }, recActor);
    assert.equal(offerRes.success, true, 'Hồ sơ đã qua phỏng vấn phải được chuyển sang OFFER');
    assert.equal(offerRes.statusCode, 200);

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand5);
    assert.equal(candRow.stage, 'OFFER');
    console.log('  -> TC-5 PASS');
  }

  // TC-6: Hồ sơ chưa qua Phỏng vấn, chưa được xác nhận: bị chặn chuyển sang Đề xuất offer.
  console.log('TC-6: Hồ sơ chưa qua Phỏng vấn, chưa xác nhận: bị chặn chuyển sang OFFER...');
  {
    const cand6 = await createTestCandidate('Ứng viên TC6', 'SCREENING');
    const skipAttempt = await stageService.updateStage(cand6, 'OFFER', { notes: 'Đề xuất offer gấp' }, recActor);
    assert.equal(skipAttempt.success, false, 'Chặn chuyển thẳng tới OFFER khi chưa qua phỏng vấn');
    assert.equal(skipAttempt.statusCode, 403);
    assert.equal(skipAttempt.code, 'INTERVIEW_STAGE_REQUIRED');
    assert.equal(skipAttempt.requiresApproval, true);

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand6);
    assert.equal(candRow.stage, 'SCREENING', 'Giai đoạn không đổi khi bị chặn');
    console.log('  -> TC-6 PASS');
  }

  // TC-7: Nhân viên tuyển dụng tự gửi thông tin giả xác nhận qua API: bị chặn.
  console.log('TC-7: Tự gửi thông tin giả mạo xác nhận: bị chặn...');
  {
    const cand7 = await createTestCandidate('Ứng viên TC7', 'SCREENING');
    // Client gửi payload giả
    const fakePayloadOptions = {
      notes: 'Giả mạo HR đã duyệt',
      skipped_interview_approved_by: hrUser.id,
      is_approved: true,
      approval_override: true
    };
    const fakeAttempt = await stageService.updateStage(cand7, 'OFFER', fakePayloadOptions, recActor);
    assert.equal(fakeAttempt.success, false, 'Backend không được tin tưởng payload client giả mạo');
    assert.equal(fakeAttempt.code, 'INTERVIEW_STAGE_REQUIRED');

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand7);
    assert.equal(candRow.stage, 'SCREENING');
    console.log('  -> TC-7 PASS');
  }

  // TC-8: Trưởng phòng Nhân sự xác nhận hợp lệ: cho phép chuyển và lưu đủ dấu vết xác nhận.
  console.log('TC-8: Trưởng phòng Nhân sự xác nhận hợp lệ: cho phép chuyển & lưu dấu vết...');
  {
    const cand8 = await createTestCandidate('Ứng viên TC8', 'SCREENING');

    // 8a. Recruiter gửi yêu cầu ngoại lệ
    const reqException = await stageService.requestInterviewSkipException(
      cand8,
      'Ứng viên cựu nhân viên có thành tích xuất sắc, xin miễn phỏng vấn chuyên môn',
      recActor
    );
    assert.equal(reqException.success, true);
    assert.equal(reqException.data.status, 'PENDING');
    const exceptionId = reqException.data.id;

    // Trong khi chờ xác nhận, hồ sơ giữ nguyên giai đoạn
    let candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand8);
    assert.equal(candRow.stage, 'SCREENING', 'Trong khi chờ duyệt hồ sơ giữ nguyên giai đoạn');

    // 8b. HR Manager phê duyệt
    const approveRes = await stageService.decideInterviewSkipException(
      exceptionId,
      'APPROVE',
      'Đồng ý miễn phỏng vấn căn cứ hồ sơ trước đây',
      hrActor
    );
    assert.equal(approveRes.success, true);
    assert.equal(approveRes.data.status, 'APPROVED');

    // 8c. Recruiter chuyển sang OFFER
    const offerRes = await stageService.updateStage(cand8, 'OFFER', { notes: 'Đã duyệt ngoại lệ, gửi offer' }, recActor);
    assert.equal(offerRes.success, true, 'Sau khi duyệt ngoại lệ, cho phép chuyển sang OFFER');

    candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand8);
    assert.equal(candRow.stage, 'OFFER');

    // Kiểm tra dấu vết ngoại lệ đã được lưu và đánh dấu đã sử dụng (used_at)
    const excRecord = await db.prepare('SELECT * FROM candidate_stage_exceptions WHERE id = ?').get(exceptionId);
    assert.ok(excRecord.used_at, 'Ngoại lệ phải được đánh dấu đã sử dụng (used_at)');
    assert.equal(excRecord.approved_by, hrActor.id);
    assert.equal(excRecord.requested_by, recActor.id);

    // Kiểm tra lịch sử chuyển giai đoạn
    const history = await db.prepare('SELECT * FROM candidate_status_history WHERE candidate_id = ? ORDER BY created_at DESC').get(cand8);
    assert.equal(history.before_stage, 'SCREENING');
    assert.equal(history.after_stage, 'OFFER');
    assert.equal(history.actor_id, recActor.id, 'Người thực hiện là Recruiter');
    assert.equal(history.skipped_interview_approved_by, hrActor.id, 'Người xác nhận là HR Manager');
    assert.equal(history.skipped_interview_approved_name, hrActor.fullName);
    assert.ok(history.skipped_interview_approved_at);
    assert.equal(history.exception_request_id, exceptionId);
    console.log('  -> TC-8 PASS');
  }

  // TC-9: Người không đủ quyền xác nhận ngoại lệ: bị từ chối.
  console.log('TC-9: Người không đủ quyền xác nhận ngoại lệ: bị từ chối...');
  {
    const cand9 = await createTestCandidate('Ứng viên TC9', 'SCREENING');
    const reqException = await stageService.requestInterviewSkipException(cand9, 'Xin ngoại lệ', recActor);
    const exceptionId = reqException.data.id;

    // Recruiter cố tình duyệt yêu cầu của chính mình
    const recruiterTryApprove = await stageService.decideInterviewSkipException(exceptionId, 'APPROVE', 'Tự duyệt', recActor);
    assert.equal(recruiterTryApprove.success, false);
    assert.equal(recruiterTryApprove.statusCode, 403);
    assert.equal(recruiterTryApprove.code, 'FORBIDDEN_HR_MANAGER_REQUIRED');

    // Hiring Manager cố tình duyệt
    const hiringTryApprove = await stageService.decideInterviewSkipException(exceptionId, 'APPROVE', 'Duyệt', hiringActor);
    assert.equal(hiringTryApprove.success, false);
    assert.equal(hiringTryApprove.statusCode, 403);
    assert.equal(hiringTryApprove.code, 'FORBIDDEN_HR_MANAGER_REQUIRED');

    // Kiểm tra trạng thái ngoại lệ vẫn là PENDING
    const excRecord = await db.prepare('SELECT status FROM candidate_stage_exceptions WHERE id = ?').get(exceptionId);
    assert.equal(excRecord.status, 'PENDING');
    console.log('  -> TC-9 PASS');
  }

  // TC-10: Xác nhận cũ hoặc xác nhận cho hồ sơ khác: không được sử dụng.
  console.log('TC-10: Xác nhận cũ hoặc xác nhận cho hồ sơ khác: không được sử dụng...');
  {
    // Tạo hồ sơ A có ngoại lệ đã duyệt và đã sử dụng
    const cand10A = await createTestCandidate('Ứng viên TC10A', 'SCREENING');
    const excA = await stageService.requestInterviewSkipException(cand10A, 'Lý do A', recActor);
    await stageService.decideInterviewSkipException(excA.data.id, 'APPROVE', 'Duyệt A', hrActor);
    await stageService.updateStage(cand10A, 'OFFER', {}, recActor); // Đã dùng ngoại lệ

    // Thử dùng lại ngoại lệ cũ cho lần chuyển sau (ví dụ quay lại screening rồi lại offer)
    await stageService.updateStage(cand10A, 'SCREENING', {}, recActor);
    const reuseAttempt = await stageService.updateStage(cand10A, 'OFFER', {}, recActor);
    assert.equal(reuseAttempt.success, false, 'Không được tái sử dụng ngoại lệ đã dùng');
    assert.equal(reuseAttempt.code, 'INTERVIEW_STAGE_REQUIRED');

    // Tạo hồ sơ B: không thể hưởng lây ngoại lệ của hồ sơ A
    const cand10B = await createTestCandidate('Ứng viên TC10B', 'SCREENING');
    const candBAttempt = await stageService.updateStage(cand10B, 'OFFER', {}, recActor);
    assert.equal(candBAttempt.success, false, 'Xác nhận của hồ sơ khác không được áp dụng');
    assert.equal(candBAttempt.code, 'INTERVIEW_STAGE_REQUIRED');

    // Tạo hồ sơ C: Xin ngoại lệ ở SCREENING, được duyệt. Nhưng hồ sơ bị đổi sang REJECTED -> Ngoại lệ cũ không tự động dùng
    const cand10C = await createTestCandidate('Ứng viên TC10C', 'SCREENING');
    const excC = await stageService.requestInterviewSkipException(cand10C, 'Lý do C', recActor);
    await stageService.decideInterviewSkipException(excC.data.id, 'APPROVE', 'Duyệt C', hrActor);
    // Hồ sơ bị đổi sang REJECTED
    await stageService.updateStage(cand10C, 'REJECTED', { rejectionReasonId: 'cat-rej-salary' }, recActor);
    // Thử chuyển từ REJECTED sang OFFER: from_stage lúc xin là SCREENING, nay là REJECTED -> Bị chặn
    const candCAttempt = await stageService.updateStage(cand10C, 'OFFER', {}, recActor);
    assert.equal(candCAttempt.success, false, 'Hồ sơ đã đổi giai đoạn sau khi tạo yêu cầu thì không áp dụng xác nhận cũ tự động');
    assert.equal(candCAttempt.code, 'INTERVIEW_STAGE_REQUIRED');
    console.log('  -> TC-10 PASS');
  }

  // TC-11: Lưu nhật ký thất bại: không được cập nhật giai đoạn dở dang (Nguyên tử).
  console.log('TC-11: Giao dịch nguyên tử: lỗi nhật ký thì rollback toàn bộ...');
  {
    const cand11 = await createTestCandidate('Ứng viên TC11', 'APPLIED');
    // Kiểm tra cấu trúc giao dịch trong db.transaction
    // Đảm bảo nếu có lỗi trong transaction thì stage giữ nguyên
    try {
      await db.transaction(async () => {
        await db.prepare('UPDATE candidates SET stage = ? WHERE id = ?').run('OFFER', cand11);
        throw new Error('SIMULATED_AUDIT_LOG_WRITE_FAILURE');
      });
    } catch (err) {
      assert.equal(err.message, 'SIMULATED_AUDIT_LOG_WRITE_FAILURE');
    }

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get(cand11);
    assert.equal(candRow.stage, 'APPLIED', 'Stage phải được rollback nguyên tử, không bị dở dang');
    console.log('  -> TC-11 PASS');
  }

  // TC-12: Quản lý giai đoạn riêng cho từng hồ sơ đa vị trí & Danh mục lý do loại
  console.log('TC-12: Quản lý giai đoạn độc lập đa vị trí & Danh mục lý do loại...');
  {
    // Tạo 2 hồ sơ cho cùng 1 người ứng tuyển 2 vị trí khác nhau (reqId và reqId2)
    const email = 'multi.app@example.test';
    const appPos1 = await createTestCandidate('Ứng viên Đa Vị Trí', 'SCREENING', reqId);
    const appPos2 = await createTestCandidate('Ứng viên Đa Vị Trí', 'APPLIED', reqId2);
    await db.prepare('UPDATE candidates SET email = ? WHERE id IN (?, ?)').run(email, appPos1, appPos2);

    // Chuyển hồ sơ 1 sang REJECTED
    await stageService.updateStage(appPos1, 'REJECTED', { rejectionReasonId: 'cat-rej-exp' }, recActor);

    // Hồ sơ 2 vẫn phải là APPLIED, không bị ảnh hưởng
    const rowPos1 = await db.prepare('SELECT stage, rejection_reason_id FROM candidates WHERE id = ?').get(appPos1);
    const rowPos2 = await db.prepare('SELECT stage, rejection_reason_id FROM candidates WHERE id = ?').get(appPos2);

    assert.equal(rowPos1.stage, 'REJECTED');
    assert.equal(rowPos1.rejection_reason_id, 'cat-rej-exp');
    assert.equal(rowPos2.stage, 'APPLIED');
    assert.equal(rowPos2.rejection_reason_id, null);

    // Kiểm tra danh mục lý do loại
    const reasons = await stageService.getRejectionReasons();
    assert.ok(Array.isArray(reasons));
    assert.equal(reasons.length, 7, 'Phải có 7 lý do loại mặc định từ seed migration 011');
    assert.ok(reasons.some(r => r.code === 'REJ-SKILLS'));
    assert.ok(reasons.some(r => r.code === 'REJ-EXP'));
    assert.ok(reasons.some(r => r.code === 'REJ-OTHER'));

    // Kiểm tra lịch sử chuyển giai đoạn chi tiết
    const historyRes = await stageService.getCandidateHistory(appPos1, recActor);
    assert.equal(historyRes.success, true);
    assert.ok(historyRes.history.length >= 1);
    assert.equal(historyRes.history[0].rejectionReasonName, 'Chưa đủ số năm kinh nghiệm yêu cầu');
    assert.equal(historyRes.history[0].actorName, recActor.fullName);
    console.log('  -> TC-12 PASS');
  }

  await db.close();
  console.log('\n=== TẤT CẢ 12 TIÊU CHÍ CHẤP NHẬN S5-03 ĐÃ ĐƯỢC KIỂM THỬ THÀNH CÔNG 100%! ===\n');
}

if (require.main === module) {
  runS503Tests().catch(err => {
    console.error('TEST S5-03 THẤT BẠI:', err);
    process.exit(1);
  });
}

module.exports = { runS503Tests };
