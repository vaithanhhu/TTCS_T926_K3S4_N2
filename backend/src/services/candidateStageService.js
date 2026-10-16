const crypto = require('node:crypto');
const RbacMiddleware = require('../middlewares/rbacMiddleware');
const RequisitionService = require('./requisitionService');
const config = require('../config/config');

const candidateStages = Object.freeze(['NEW', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']);

class CandidateStageService {
  constructor(db) {
    this.db = db;
    this.rbac = new RbacMiddleware(db);
    this.requisitionService = new RequisitionService(db);
  }

  /**
   * Get all active rejection reasons from catalog
   */
  async getRejectionReasons() {
    return this.db.prepare(`
      SELECT id, code, name, display_order
      FROM recruitment_catalog_items
      WHERE type = 'REJECTION_REASON' AND status = 'ACTIVE'
      ORDER BY display_order ASC, name ASC
    `).all();
  }

  /**
   * Check whether candidate has completed or passed the INTERVIEW stage
   */
  async hasPassedInterviewStage(candidateId, currentStage) {
    if (currentStage === 'INTERVIEW') return true;

    // Check if there is an interview record
    const interviewCount = await this.db.prepare(`
      SELECT COUNT(*) AS count FROM interviews WHERE candidate_id = ?
    `).get(candidateId);
    if (Number(interviewCount?.count || 0) > 0) return true;

    // Check if status history contains an INTERVIEW stage
    try {
      const historyRecord = await this.db.prepare(`
        SELECT 1 FROM candidate_status_history
        WHERE candidate_id = ? AND (before_stage = 'INTERVIEW' OR after_stage = 'INTERVIEW')
        LIMIT 1
      `).get(candidateId);
      if (historyRecord) return true;
    } catch {
      // Table may not have records yet
    }

    return false;
  }

  /**
   * Core method to update candidate stage with strict S5-03 validations and transactional audit logging
   */
  async updateStage(candidateId, newStage, options = {}, actor = null) {
    if (!candidateId) {
      return { success: false, statusCode: 400, code: 'CANDIDATE_ID_REQUIRED', message: 'Thiếu mã hồ sơ ứng viên.' };
    }

    // 1. Authorize actor
    let authorizedActor = actor;
    if (actor) {
      const access = await this.requisitionService.candidateAccess(candidateId, actor, 'candidate.update');
      if (!access.success) return access;
      authorizedActor = access.actor;
    }

    // 2. Fetch current candidate data
    const candidate = await this.db.prepare(`
      SELECT id, requisition_id, stage, full_name, email, notes, rejection_reason_id
      FROM candidates
      WHERE id = ?
    `).get(candidateId);

    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' };
    }

    if (candidate.requisition_id && this.requisitionService.openPolicy) {
      await this.requisitionService.openPolicy.notDraft(candidate.requisition_id);
    }

    // 3. Validate newStage
    if (!candidateStages.includes(newStage)) {
      return { success: false, statusCode: 400, code: 'INVALID_CANDIDATE_STAGE', message: 'Giai đoạn không hợp lệ.' };
    }

    // 4. Same-stage check: Do not write history if new stage is identical to current stage
    if (newStage === candidate.stage) {
      return {
        success: true,
        statusCode: 200,
        message: 'Giai đoạn không thay đổi.',
        data: { id: candidateId, stage: candidate.stage, unchanged: true }
      };
    }

    // Extract payload params
    const notes = options.notes !== undefined ? (options.notes ? String(options.notes).trim() : '') : '';
    const rejectionReasonId = options.rejectionReasonId ? String(options.rejectionReasonId).trim() : null;

    let reasonName = null;
    let skippedApprovedBy = null;
    let skippedApprovedName = null;
    let skippedApprovedAt = null;
    let exceptionRequestId = null;

    // 5. AC-1: Chuyển sang "Loại" (REJECTED) bắt buộc chọn lý do từ danh mục
    if (newStage === 'REJECTED') {
      if (!rejectionReasonId) {
        return {
          success: false,
          statusCode: 400,
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Chuyển sang trạng thái Loại bắt buộc chọn lý do từ danh mục.'
        };
      }

      // Check reason exists and is ACTIVE
      const reasonItem = await this.db.prepare(`
        SELECT id, code, name, status
        FROM recruitment_catalog_items
        WHERE id = ? AND type = 'REJECTION_REASON'
      `).get(rejectionReasonId);

      if (!reasonItem || reasonItem.status !== 'ACTIVE') {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_REJECTION_REASON',
          message: 'Lý do loại hồ sơ không tồn tại hoặc đã ngừng áp dụng.'
        };
      }

      reasonName = reasonItem.name;

      // Check if reason is "Khác" -> Require explanatory notes
      const isOtherReason = reasonItem.code === 'REJ-OTHER' ||
        reasonItem.code === 'OTHER' ||
        reasonItem.name.trim().toLowerCase() === 'khác';

      if (isOtherReason && (!notes || !notes.trim())) {
        return {
          success: false,
          statusCode: 400,
          code: 'REJECTION_EXPLANATION_REQUIRED',
          message: 'Vui lòng nhập nội dung giải thích khi chọn lý do loại là "Khác".'
        };
      }
    }

    // 6. AC-3: Kiểm soát bỏ qua Phỏng vấn khi đi thẳng tới "Đề xuất offer" (OFFER)
    if (newStage === 'OFFER') {
      const hasPassedInterview = await this.hasPassedInterviewStage(candidateId, candidate.stage);

      if (!hasPassedInterview) {
        const isHrManager = authorizedActor && authorizedActor.roles &&
          (authorizedActor.roles.includes('HR_MANAGER') || authorizedActor.roles.includes('ADMIN'));

        if (isHrManager) {
          // Trưởng phòng Nhân sự trực tiếp thực hiện ngoại lệ
          skippedApprovedBy = authorizedActor.id;
          skippedApprovedName = authorizedActor.fullName || authorizedActor.id;
          skippedApprovedAt = new Date().toISOString();
        } else {
          // Nhân viên tuyển dụng (RECRUITER) chuyển trực tiếp: Kiểm tra xác nhận ngoại lệ đã được HR_MANAGER duyệt
          const approvedException = await this.db.prepare(`
            SELECT * FROM candidate_stage_exceptions
            WHERE candidate_id = ?
              AND from_stage = ?
              AND target_stage = 'OFFER'
              AND status = 'APPROVED'
              AND used_at IS NULL
            ORDER BY approved_at DESC
            LIMIT 1
          `).get(candidateId, candidate.stage);

          if (!approvedException) {
            return {
              success: false,
              statusCode: 403,
              code: 'INTERVIEW_STAGE_REQUIRED',
              message: 'Không cho phép bỏ qua giai đoạn Phỏng vấn khi đi thẳng tới Đề xuất offer trừ khi có xác nhận từ Trưởng phòng Nhân sự.',
              requiresApproval: true,
              candidateId,
              currentStage: candidate.stage,
              targetStage: 'OFFER'
            };
          }

          // Use the approved exception
          skippedApprovedBy = approvedException.approved_by;
          skippedApprovedName = approvedException.approver_name;
          skippedApprovedAt = approvedException.approved_at;
          exceptionRequestId = approvedException.id;
        }
      }
    }

    // 7. Execute update and audit log in a single transaction
    return this.db.transaction(async () => {
      // Mark exception as used
      if (exceptionRequestId) {
        const usedQuery = this.db.provider === 'postgres'
          ? "UPDATE candidate_stage_exceptions SET used_at = CURRENT_TIMESTAMP WHERE id = ?"
          : "UPDATE candidate_stage_exceptions SET used_at = datetime('now') WHERE id = ?";
        await this.db.prepare(usedQuery).run(exceptionRequestId);
      }

      // Update candidate stage & rejection reason in candidates table
      const finalNotes = notes || candidate.notes || null;
      const finalRejectionReason = newStage === 'REJECTED' ? rejectionReasonId : null;

      await this.db.prepare(`
        UPDATE candidates
        SET stage = ?,
            notes = COALESCE(?, notes),
            rejection_reason_id = ?
        WHERE id = ?
      `).run(newStage, finalNotes, finalRejectionReason, candidateId);

      // Insert audit entry into candidate_status_history
      const historyId = 'csh-' + crypto.randomUUID();
      const action = newStage === 'REJECTED' ? 'REJECT' : 'STAGE_CHANGE';
      const actorId = authorizedActor?.id || 'system';
      const actorName = authorizedActor?.fullName || authorizedActor?.id || 'Hệ thống';

      const insertHistorySql = this.db.provider === 'postgres'
        ? `
          INSERT INTO candidate_status_history (
            id, candidate_id, before_stage, after_stage, actor_id, actor_name, action,
            reason, notes, rejection_reason_id, skipped_interview_approved_by,
            skipped_interview_approved_name, skipped_interview_approved_at, exception_request_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `
        : `
          INSERT INTO candidate_status_history (
            id, candidate_id, before_stage, after_stage, actor_id, actor_name, action,
            reason, notes, rejection_reason_id, skipped_interview_approved_by,
            skipped_interview_approved_name, skipped_interview_approved_at, exception_request_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `;

      await this.db.prepare(insertHistorySql).run(
        historyId,
        candidateId,
        candidate.stage,
        newStage,
        actorId,
        actorName,
        action,
        reasonName || (exceptionRequestId ? 'Bỏ qua phỏng vấn (Đã duyệt)' : null),
        finalNotes,
        finalRejectionReason,
        skippedApprovedBy || null,
        skippedApprovedName || null,
        skippedApprovedAt || null,
        exceptionRequestId || null
      );

      return {
        success: true,
        statusCode: 200,
        message: `Chuyển giai đoạn ứng viên sang "${newStage}" thành công.`,
        data: {
          id: candidateId,
          beforeStage: candidate.stage,
          stage: newStage,
          rejectionReasonId: finalRejectionReason,
          rejectionReasonName: reasonName || null,
          skippedInterviewApprovedBy: skippedApprovedBy || null,
          skippedInterviewApprovedName: skippedApprovedName || null,
          skippedInterviewApprovedAt: skippedApprovedAt || null,
          historyId
        }
      };
    });
  }

  /**
   * Recruiter requests interview skip exception from HR Manager
   */
  async requestInterviewSkipException(candidateId, reason, actor) {
    if (!candidateId) {
      return { success: false, statusCode: 400, code: 'CANDIDATE_ID_REQUIRED', message: 'Thiếu mã ứng viên.' };
    }
    if (!reason || !String(reason).trim()) {
      return { success: false, statusCode: 400, code: 'REASON_REQUIRED', message: 'Vui lòng nhập lý do đề xuất bỏ qua phỏng vấn.' };
    }

    const access = await this.requisitionService.candidateAccess(candidateId, actor, 'candidate.update');
    if (!access.success) return access;

    const candidate = await this.db.prepare(`
      SELECT id, requisition_id, stage, full_name FROM candidates WHERE id = ?
    `).get(candidateId);

    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' };
    }

    if (['INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'].includes(candidate.stage)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CURRENT_STAGE_FOR_EXCEPTION',
        message: `Hồ sơ đang ở trạng thái "${candidate.stage}", không cần hoặc không được phép xin ngoại lệ bỏ qua phỏng vấn.`
      };
    }

    // Check if there is already a PENDING request
    const existingPending = await this.db.prepare(`
      SELECT id FROM candidate_stage_exceptions
      WHERE candidate_id = ? AND from_stage = ? AND target_stage = 'OFFER' AND status = 'PENDING'
    `).get(candidateId, candidate.stage);

    if (existingPending) {
      return {
        success: true,
        statusCode: 200,
        message: 'Đã có yêu cầu bỏ qua phỏng vấn đang chờ Trưởng phòng Nhân sự duyệt.',
        data: { id: existingPending.id, status: 'PENDING' }
      };
    }

    const id = 'cser-' + crypto.randomUUID();
    const insertSql = this.db.provider === 'postgres'
      ? `
        INSERT INTO candidate_stage_exceptions (
          id, candidate_id, requisition_id, from_stage, target_stage, reason,
          requested_by, requester_name, status, created_at
        ) VALUES (?, ?, ?, ?, 'OFFER', ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
      `
      : `
        INSERT INTO candidate_stage_exceptions (
          id, candidate_id, requisition_id, from_stage, target_stage, reason,
          requested_by, requester_name, status, created_at
        ) VALUES (?, ?, ?, ?, 'OFFER', ?, ?, ?, 'PENDING', datetime('now'))
      `;

    await this.db.prepare(insertSql).run(
      id,
      candidateId,
      candidate.requisition_id,
      candidate.stage,
      String(reason).trim(),
      access.actor.id,
      access.actor.fullName || access.actor.id
    );

    return {
      success: true,
      statusCode: 201,
      message: 'Đã gửi yêu cầu bỏ qua phỏng vấn tới Trưởng phòng Nhân sự.',
      data: {
        id,
        candidateId,
        fromStage: candidate.stage,
        targetStage: 'OFFER',
        reason: String(reason).trim(),
        requestedBy: access.actor.id,
        requesterName: access.actor.fullName || access.actor.id,
        status: 'PENDING'
      }
    };
  }

  /**
   * HR Manager decides (APPROVE or REJECT) an interview skip request
   */
  async decideInterviewSkipException(exceptionId, action, comment, actor) {
    if (!exceptionId) {
      return { success: false, statusCode: 400, code: 'EXCEPTION_ID_REQUIRED', message: 'Thiếu mã yêu cầu ngoại lệ.' };
    }
    if (!['APPROVE', 'REJECT'].includes(action)) {
      return { success: false, statusCode: 400, code: 'INVALID_ACTION', message: 'Hành động phải là APPROVE hoặc REJECT.' };
    }

    // Role check: Only HR_MANAGER or ADMIN can approve
    const authorized = await this.rbac.getAuthorizedActor(actor?.id, 'candidate.update');
    if (!authorized || (!authorized.roles.includes('HR_MANAGER') && !authorized.roles.includes('ADMIN'))) {
      return {
        success: false,
        statusCode: 403,
        code: 'FORBIDDEN_HR_MANAGER_REQUIRED',
        message: 'Chỉ Trưởng phòng Nhân sự mới có quyền xác nhận ngoại lệ bỏ qua phỏng vấn.'
      };
    }

    const exception = await this.db.prepare(`
      SELECT * FROM candidate_stage_exceptions WHERE id = ?
    `).get(exceptionId);

    if (!exception) {
      return { success: false, statusCode: 404, code: 'EXCEPTION_NOT_FOUND', message: 'Không tìm thấy yêu cầu ngoại lệ.' };
    }

    if (exception.status !== 'PENDING') {
      return {
        success: false,
        statusCode: 400,
        code: 'EXCEPTION_ALREADY_DECIDED',
        message: `Yêu cầu này đã được xử lý trước đó với trạng thái "${exception.status}".`
      };
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const nowIso = new Date().toISOString();
    const approverName = authorized.fullName || authorized.id;

    const updateSql = this.db.provider === 'postgres'
      ? `
        UPDATE candidate_stage_exceptions
        SET status = ?,
            approved_by = ?,
            approver_name = ?,
            approved_at = CURRENT_TIMESTAMP,
            decision_comment = ?
        WHERE id = ?
      `
      : `
        UPDATE candidate_stage_exceptions
        SET status = ?,
            approved_by = ?,
            approver_name = ?,
            approved_at = datetime('now'),
            decision_comment = ?
        WHERE id = ?
      `;

    await this.db.prepare(updateSql).run(
      newStatus,
      authorized.id,
      approverName,
      comment ? String(comment).trim() : null,
      exceptionId
    );

    return {
      success: true,
      statusCode: 200,
      message: `Đã ${newStatus === 'APPROVED' ? 'phê duyệt' : 'từ chối'} yêu cầu bỏ qua phỏng vấn.`,
      data: {
        id: exceptionId,
        candidateId: exception.candidate_id,
        status: newStatus,
        approvedBy: authorized.id,
        approverName,
        approvedAt: nowIso,
        decisionComment: comment || null
      }
    };
  }

  /**
   * Get all exception requests for a candidate
   */
  async getCandidateExceptions(candidateId, actor) {
    if (actor) {
      const access = await this.requisitionService.candidateAccess(candidateId, actor, 'candidate.read');
      if (!access.success) return access;
    }

    const rows = await this.db.prepare(`
      SELECT * FROM candidate_stage_exceptions
      WHERE candidate_id = ?
      ORDER BY created_at DESC
    `).all(candidateId);

    return { success: true, statusCode: 200, items: rows };
  }

  /**
   * Get candidate stage transition history with clear details
   */
  async getCandidateHistory(candidateId, actor) {
    if (actor) {
      const access = await this.requisitionService.candidateAccess(candidateId, actor, 'candidate.read');
      if (!access.success) return access;
    }

    const rows = await this.db.prepare(`
      SELECT
        h.id,
        h.candidate_id AS "candidateId",
        h.before_stage AS "beforeStage",
        h.after_stage AS "afterStage",
        h.actor_id AS "actorId",
        h.actor_name AS "actorName",
        h.action,
        h.reason,
        h.notes,
        h.rejection_reason_id AS "rejectionReasonId",
        r.name AS "rejectionReasonName",
        h.skipped_interview_approved_by AS "skippedInterviewApprovedBy",
        h.skipped_interview_approved_name AS "skippedInterviewApprovedName",
        h.skipped_interview_approved_at AS "skippedInterviewApprovedAt",
        h.exception_request_id AS "exceptionRequestId",
        h.created_at AS "createdAt"
      FROM candidate_status_history h
      LEFT JOIN recruitment_catalog_items r ON r.id = h.rejection_reason_id
      WHERE h.candidate_id = ?
      ORDER BY h.created_at DESC, h.id DESC
    `).all(candidateId);

    return { success: true, statusCode: 200, history: rows };
  }
}

module.exports = CandidateStageService;
