const RequisitionService = require('./requisitionService');

/**
 * ==============================================================================
 * USER STORY S5-07 (SCRUM-117) - CANDIDATE INTERACTION TIMELINE SERVICE
 * ==============================================================================
 *
 * Là Nhân viên tuyển dụng, tôi muốn xem nhật ký toàn bộ tương tác với một ứng viên,
 * để biết ai đã liên hệ ứng viên này và nói gì trước khi mình gọi.
 *
 * Tiêu chí chấp nhận (AC):
 * • Dòng thời gian gồm: nộp hồ sơ, chuyển giai đoạn, email đã gửi, lịch phỏng vấn, đánh giá
 * • Sắp xếp mới nhất trước (DESC by timestamp)
 * • Kiểm soát phân quyền server-side (IDOR & RBAC)
 * ==============================================================================
 */
class CandidateTimelineService {
  constructor(db) {
    this.db = db;
    this.requisitions = new RequisitionService(db);
  }

  /**
   * Lấy nhật ký toàn bộ tương tác của ứng viên theo thứ tự mới nhất trước
   * @param {string} candidateId ID của hồ sơ ứng viên
   * @param {object} currentUser Người dùng đang thực hiện yêu cầu
   * @param {object} options Các tùy chọn lọc bổ sung
   */
  async getCandidateTimeline(candidateId, currentUser, options = {}) {
    // 1. Kiểm tra xác thực
    if (!currentUser || !currentUser.id) {
      return {
        success: false,
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Yêu cầu đăng nhập để truy cập nhật ký tương tác ứng viên.'
      };
    }

    if (!candidateId || typeof candidateId !== 'string' || !candidateId.trim()) {
      return {
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Mã hồ sơ ứng viên không hợp lệ.'
      };
    }

    // 2. Tìm kiếm hồ sơ ứng viên hiện tại
    let candidate;
    try {
      candidate = await this.db.prepare(
        `SELECT c.*, r.title AS requisition_title, r.code AS requisition_code,
                r.department_name, r.recruiter_id, r.hiring_manager_id
         FROM candidates c
         LEFT JOIN requisitions r ON r.id = c.requisition_id
         WHERE c.id = ?`
      ).get(candidateId.trim());
    } catch {
      candidate = await this.db.prepare(
        `SELECT * FROM candidates WHERE id = ?`
      ).get(candidateId.trim());
    }

    if (!candidate) {
      return {
        success: false,
        statusCode: 404,
        code: 'CANDIDATE_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ ứng viên.'
      };
    }

    // 3. Kiểm tra phân quyền RBAC & IDOR (Phạm vi dữ liệu)
    const userRoles = currentUser.roles || [];
    const isAdminOrHr = userRoles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r));
    let hasAccess = isAdminOrHr;

    // 3.1 Kiểm tra Recruiter (chính hoặc hỗ trợ)
    if (!hasAccess && userRoles.includes('RECRUITER')) {
      if (candidate.requisition_id) {
        try {
          hasAccess = await this.requisitions.recruiterAssigned(candidate.requisition_id, currentUser.id);
        } catch {
          hasAccess = false;
        }

        // Hỗ trợ kiểm tra trực tiếp bảng requisition_recruiter_supports
        if (!hasAccess) {
          try {
            const supportCheck = await this.db.prepare(
              `SELECT 1 FROM requisition_recruiter_supports WHERE requisition_id = ? AND user_id = ? LIMIT 1`
            ).get(candidate.requisition_id, currentUser.id);
            hasAccess = Boolean(supportCheck);
          } catch {
            // Bảng hỗ trợ chưa được migrate
          }
        }
      }
    }

    // 3.2 Kiểm tra Hiring Manager (sở hữu vị trí hoặc quản lý phòng ban)
    if (!hasAccess && userRoles.includes('HIRING_MGR')) {
      if (candidate.requisition_id) {
        try {
          hasAccess = await this.requisitions.canReadHiringRequisition(candidate.requisition_id, currentUser.id);
        } catch {
          hasAccess = false;
        }

        if (!hasAccess) {
          try {
            const directCheck = await this.db.prepare(
              `SELECT id FROM requisitions WHERE id = ? AND (hiring_manager_id = ? OR created_by = ?)`
            ).get(candidate.requisition_id, currentUser.id, currentUser.id);
            hasAccess = Boolean(directCheck);
          } catch {
            // Bảng requisitions lỗi truy vấn
          }
        }
      }
    }

    // 3.3 Kiểm tra Interviewer (tham gia phỏng vấn ứng viên này)
    if (!hasAccess && userRoles.includes('INTERVIEWER')) {
      try {
        const interviewAssigned = await this.db.prepare(
          `SELECT id FROM interviews WHERE candidate_id = ? AND interviewer_id = ? LIMIT 1`
        ).get(candidate.id, currentUser.id);
        hasAccess = Boolean(interviewAssigned);
      } catch {
        hasAccess = false;
      }
    }

    // Chặn người dùng ngoài phạm vi hoặc tài khoản ứng viên (CANDIDATE)
    if (!hasAccess) {
      return {
        success: false,
        statusCode: 403,
        code: 'CANDIDATE_OUT_OF_SCOPE',
        message: 'Hồ sơ ứng viên không thuộc phạm vi bạn được phân công phụ trách.'
      };
    }

    // 4. Xác định danh sách ID hồ sơ liên quan theo email (Hồ sơ hợp nhất - Multi-Application)
    const relatedCandidateIds = [candidate.id];
    if (candidate.email && options.includeHistoricalApplications !== false) {
      try {
        const related = await this.db.prepare(
          `SELECT id FROM candidates WHERE LOWER(email) = LOWER(?) AND id <> ?`
        ).all(candidate.email, candidate.id);
        for (const row of (related || [])) {
          relatedCandidateIds.push(row.id);
        }
      } catch {
        // Bỏ qua nếu lỗi
      }
    }

    const events = [];

    // ==========================================================================
    // NHÓM 1: NỘP HỒ SƠ ỨNG TUYỂN (APPLICATION SUBMISSION)
    // ==========================================================================
    try {
      const appRows = await this.db.prepare(
        `SELECT c.id, c.requisition_id, c.full_name, c.created_at, c.source_id,
                c.tracking_code, c.cover_letter, c.is_internal_referral, c.referrer_name,
                c.withdrawn_at, c.withdrawn_reason,
                r.code AS requisition_code, r.title AS requisition_title
         FROM candidates c
         LEFT JOIN requisitions r ON r.id = c.requisition_id
         WHERE c.id IN (${relatedCandidateIds.map(() => '?').join(',')})`
      ).all(...relatedCandidateIds);

      for (const app of (appRows || [])) {
        const isCurrent = app.id === candidate.id;
        const positionSuffix = app.requisition_title ? ` cho vị trí ${app.requisition_title} (${app.requisition_code || ''})` : '';

        events.push({
          id: `app-submit-${app.id}`,
          eventType: 'APPLICATION_SUBMITTED',
          timestamp: app.created_at,
          actorName: app.is_internal_referral
            ? (app.referrer_name || 'Người giới thiệu nội bộ')
            : (app.full_name || 'Ứng viên'),
          title: app.is_internal_referral
            ? `Giới thiệu ứng viên nội bộ${positionSuffix}`
            : `Nộp hồ sơ ứng tuyển${positionSuffix}`,
          summary: `Ứng tuyển${positionSuffix}. Nguồn: ${app.source_id || 'Trực tuyến'}${app.is_internal_referral ? ` (Giới thiệu bởi ${app.referrer_name || 'Nội bộ'})` : ''}.`,
          details: {
            candidateId: app.id,
            isCurrentApplication: isCurrent,
            requisitionId: app.requisition_id,
            requisitionTitle: app.requisition_title,
            requisitionCode: app.requisition_code,
            trackingCode: app.tracking_code || null,
            coverLetter: app.cover_letter || null,
            isInternalReferral: Boolean(app.is_internal_referral),
            referrerName: app.referrer_name || null
          }
        });

        // Nếu ứng viên từng rút hồ sơ
        if (app.withdrawn_at) {
          events.push({
            id: `app-withdraw-${app.id}`,
            eventType: 'APPLICATION_WITHDRAWN',
            timestamp: app.withdrawn_at,
            actorName: app.full_name || 'Ứng viên',
            title: `Ứng viên rút hồ sơ${positionSuffix}`,
            summary: `Ứng viên đã chủ động rút hồ sơ. Lý do: ${app.withdrawn_reason || 'Không cung cấp lý do'}`,
            details: {
              candidateId: app.id,
              withdrawnReason: app.withdrawn_reason
            }
          });
        }
      }
    } catch {
      // Fallback cho hồ sơ hiện tại
      events.push({
        id: `app-submit-${candidate.id}`,
        eventType: 'APPLICATION_SUBMITTED',
        timestamp: candidate.created_at,
        actorName: candidate.full_name || 'Ứng viên',
        title: 'Nộp hồ sơ ứng tuyển',
        summary: `Ứng tuyển vị trí ${candidate.requisition_title || ''}.`,
        details: { candidateId: candidate.id }
      });
    }

    // ==========================================================================
    // NHÓM 2: CHUYỂN GIAI ĐOẠN TUYỂN DỤNG (STAGE TRANSITIONS)
    // ==========================================================================
    try {
      const statusHistory = await this.db.prepare(
        `SELECT h.id, h.candidate_id, h.before_stage, h.after_stage, h.actor_name,
                h.action, h.reason, h.notes, h.created_at,
                r.title AS requisition_title
         FROM candidate_status_history h
         LEFT JOIN candidates c ON c.id = h.candidate_id
         LEFT JOIN requisitions r ON r.id = c.requisition_id
         WHERE h.candidate_id IN (${relatedCandidateIds.map(() => '?').join(',')})`
      ).all(...relatedCandidateIds);

      for (const h of (statusHistory || [])) {
        const fromStage = h.before_stage || 'Mới';
        const toStage = h.after_stage;
        let desc = `${h.action || 'Thay đổi trạng thái'}`;
        if (h.reason) desc += ` - Lý do: ${h.reason}`;
        if (h.notes) desc += ` - Ghi chú: ${h.notes}`;

        events.push({
          id: `stage-${h.id}`,
          eventType: 'STAGE_CHANGED',
          timestamp: h.created_at,
          actorName: h.actor_name || 'Hệ thống Tuyển dụng',
          title: `Chuyển giai đoạn: ${fromStage} ➔ ${toStage}`,
          summary: desc,
          details: {
            candidateId: h.candidate_id,
            beforeStage: h.before_stage,
            afterStage: h.after_stage,
            action: h.action,
            reason: h.reason,
            notes: h.notes,
            requisitionTitle: h.requisition_title || null
          }
        });
      }
    } catch {
      // Bảng candidate_status_history chưa tồn tại
    }

    // ==========================================================================
    // NHÓM 3: EMAIL ĐÃ GỬI (SENT EMAILS) - Hỗ trợ cả email_logs và email_outbox
    // ==========================================================================
    if (candidate.email) {
      const processedEmailKeys = new Set();

      // 3.1 Đọc từ email_logs (Base schema)
      try {
        const emailLogs = await this.db.prepare(
          `SELECT id, recipient, subject, template_name, status, error_message, sent_at
           FROM email_logs
           WHERE LOWER(recipient) = LOWER(?)`
        ).all(candidate.email);

        for (const m of (emailLogs || [])) {
          const dedupeKey = `${m.template_name}-${m.sent_at}`;
          if (!processedEmailKeys.has(dedupeKey)) {
            processedEmailKeys.add(dedupeKey);
            const statusText = m.status === 'SENT' ? 'Đã gửi thành công' : (m.status === 'FAILED' ? 'Gửi thất bại' : m.status);

            events.push({
              id: `email-log-${m.id}`,
              eventType: 'EMAIL_SENT',
              timestamp: m.sent_at,
              actorName: 'Hệ thống Email',
              title: `Email: ${m.subject || m.template_name || 'Thông báo tuyển dụng'}`,
              summary: `Mẫu: ${m.template_name || 'Thông báo'} | Trạng thái: ${statusText}${m.error_message ? ` (Lỗi: ${m.error_message})` : ''}`,
              details: {
                emailId: m.id,
                sourceTable: 'email_logs',
                recipient: m.recipient,
                subject: m.subject,
                templateName: m.template_name,
                status: m.status,
                errorMessage: m.error_message || null
              }
            });
          }
        }
      } catch {
        // Bảng email_logs chưa sẵn sàng
      }

      // 3.2 Đọc từ email_outbox (Sprint 4 schema)
      try {
        const outboxEmails = await this.db.prepare(
          `SELECT id, recipient, subject, template_name, status, error_message, sent_at, created_at
           FROM email_outbox
           WHERE LOWER(recipient) = LOWER(?)`
        ).all(candidate.email);

        for (const m of (outboxEmails || [])) {
          const timestamp = m.sent_at || m.created_at;
          const dedupeKey = `${m.template_name}-${timestamp}`;
          if (!processedEmailKeys.has(dedupeKey)) {
            processedEmailKeys.add(dedupeKey);
            const statusText = m.status === 'SENT' ? 'Đã gửi thành công' : (m.status === 'FAILED' ? 'Gửi thất bại' : 'Đang xử lý');

            events.push({
              id: `email-outbox-${m.id}`,
              eventType: 'EMAIL_SENT',
              timestamp,
              actorName: 'Hệ thống Email',
              title: `Email: ${m.subject || m.template_name || 'Thông báo tuyển dụng'}`,
              summary: `Mẫu: ${m.template_name || 'Thông báo'} | Trạng thái: ${statusText}${m.error_message ? ` (Lỗi: ${m.error_message})` : ''}`,
              details: {
                emailId: m.id,
                sourceTable: 'email_outbox',
                recipient: m.recipient,
                subject: m.subject,
                templateName: m.template_name,
                status: m.status,
                errorMessage: m.error_message || null
              }
            });
          }
        }
      } catch {
        // Bảng email_outbox chưa sẵn sàng
      }
    }

    // ==========================================================================
    // NHÓM 4: LỊCH PHỎNG VẤN (INTERVIEWS)
    // ==========================================================================
    try {
      const interviewRows = await this.db.prepare(
        `SELECT i.id, i.candidate_id, i.round_name, i.scheduled_time, i.location_or_link,
                i.status, i.feedback, i.score, i.created_at,
                u.full_name AS interviewer_name, u.email AS interviewer_email,
                r.title AS requisition_title
         FROM interviews i
         LEFT JOIN users u ON u.id = i.interviewer_id
         LEFT JOIN requisitions r ON r.id = i.requisition_id
         WHERE i.candidate_id IN (${relatedCandidateIds.map(() => '?').join(',')})`
      ).all(...relatedCandidateIds);

      for (const inv of (interviewRows || [])) {
        // Sự kiện Đặt lịch phỏng vấn
        events.push({
          id: `interview-sched-${inv.id}`,
          eventType: 'INTERVIEW_SCHEDULED',
          timestamp: inv.created_at || inv.scheduled_time,
          actorName: inv.interviewer_name || 'Hội đồng phỏng vấn',
          title: `Lịch phỏng vấn: ${inv.round_name || 'Phỏng vấn chuyên môn'}`,
          summary: `Thời gian: ${inv.scheduled_time} | Hình thức/Phòng: ${inv.location_or_link || 'Trực tuyến'} [Trạng thái: ${inv.status || 'SCHEDULED'}]`,
          details: {
            interviewId: inv.id,
            candidateId: inv.candidate_id,
            roundName: inv.round_name,
            scheduledTime: inv.scheduled_time,
            locationOrLink: inv.location_or_link,
            status: inv.status,
            interviewerName: inv.interviewer_name,
            interviewerEmail: inv.interviewer_email,
            requisitionTitle: inv.requisition_title || null
          }
        });

        // ======================================================================
        // NHÓM 5a: ĐÁNH GIÁ PHỎNG VẤN (INTERVIEW EVALUATION)
        // ======================================================================
        if (inv.feedback || (inv.score !== null && inv.score !== undefined)) {
          const scoreText = inv.score !== null ? `${inv.score}/5 sao` : 'Chưa chấm điểm';
          events.push({
            id: `interview-eval-${inv.id}`,
            eventType: 'EVALUATION_SUBMITTED',
            timestamp: inv.created_at,
            actorName: inv.interviewer_name || 'Người phỏng vấn',
            title: `Đánh giá phỏng vấn: ${inv.round_name || 'Vòng phỏng vấn'}`,
            summary: `Điểm đánh giá: ${scoreText} - Nhận xét: "${inv.feedback || 'Không có nhận xét'}"`,
            details: {
              interviewId: inv.id,
              candidateId: inv.candidate_id,
              roundName: inv.round_name,
              score: inv.score,
              feedback: inv.feedback,
              interviewerName: inv.interviewer_name,
              requisitionTitle: inv.requisition_title || null
            }
          });
        }
      }
    } catch {
      // Bảng interviews chưa tồn tại
    }

    // ==========================================================================
    // NHÓM 5b: GHI CHÚ NỘI BỘ (CANDIDATE NOTES)
    // ==========================================================================
    try {
      const notes = await this.db.prepare(
        `SELECT n.id, n.candidate_id, n.author_id, n.author_name, n.note_text, n.is_private, n.created_at
         FROM candidate_notes n
         WHERE n.candidate_id IN (${relatedCandidateIds.map(() => '?').join(',')})`
      ).all(...relatedCandidateIds);

      for (const n of (notes || [])) {
        // Ghi chú riêng tư (is_private): chỉ Admin, HR Manager hoặc chính tác giả được xem
        if (n.is_private && !isAdminOrHr && n.author_id !== currentUser.id) {
          continue;
        }

        events.push({
          id: `note-${n.id}`,
          eventType: 'NOTE_ADDED',
          timestamp: n.created_at,
          actorName: n.author_name || 'Nhân viên tuyển dụng',
          title: n.is_private ? 'Ghi chú nội bộ (Riêng tư)' : 'Ghi chú nội bộ',
          summary: n.note_text,
          details: {
            noteId: n.id,
            candidateId: n.candidate_id,
            authorId: n.author_id,
            isPrivate: Boolean(n.is_private)
          }
        });
      }
    } catch {
      // Bảng candidate_notes chưa tồn tại
    }

    // ==========================================================================
    // SẮP XẾP DÒNG THỜI GIAN: MỚI NHẤT TRƯỚC (ORDER BY timestamp DESC)
    // ==========================================================================
    events.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime() || 0;
      const timeB = new Date(b.timestamp).getTime() || 0;
      return timeB - timeA;
    });

    return {
      success: true,
      statusCode: 200,
      data: {
        candidate: {
          id: candidate.id,
          fullName: candidate.full_name,
          email: candidate.email,
          phoneNumber: candidate.phone_number,
          stage: candidate.stage,
          requisitionId: candidate.requisition_id,
          requisitionTitle: candidate.requisition_title || null,
          requisitionCode: candidate.requisition_code || null
        },
        totalEvents: events.length,
        timeline: events
      }
    };
  }
}

module.exports = CandidateTimelineService;
