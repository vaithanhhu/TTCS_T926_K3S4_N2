const crypto = require('node:crypto');
const config = require('../config/config');
const { escapeEmailHtml } = require('./emailService');

class InterviewInvitationService {
  constructor(db) {
    this.db = db;
  }

  formatVietnamDate(dateStr) {
    return new Date(dateStr).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async hasTokensTable() {
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_invitation_tokens'").get();
        return Boolean(row);
      }
      const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_invitation_tokens'").get();
      return Boolean(row);
    } catch {
      return false;
    }
  }

  async createInvitation(interviewId, options = {}) {
    if (!await this.hasTokensTable()) {
      return { success: false, statusCode: 503, code: 'INVITATION_SERVICE_UNAVAILABLE', message: 'Bảng lời mời chưa sẵn sàng.' };
    }
    if (!interviewId) return { success: false, statusCode: 400, code: 'INTERVIEW_ID_REQUIRED' };

    const interview = await this.db.prepare(`
      SELECT i.id, i.candidate_id, i.round_name, i.scheduled_time, i.duration_minutes,
             i.interview_format, i.meeting_room, i.meeting_link, i.location_or_link, i.status,
             c.full_name AS candidate_name, c.email AS candidate_email,
             r.title AS requisition_title
      FROM interviews i
      LEFT JOIN candidates c ON c.id = i.candidate_id
      LEFT JOIN requisitions r ON r.id = COALESCE(i.requisition_id, c.requisition_id)
      WHERE i.id = ?
    `).get(interviewId);

    if (!interview) return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND' };
    if (interview.status !== 'SCHEDULED') return { success: false, statusCode: 400, code: 'INTERVIEW_NOT_SCHEDULED' };
    if (!interview.candidate_email) return { success: false, statusCode: 400, code: 'CANDIDATE_EMAIL_REQUIRED' };

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = 'iit-' + crypto.randomUUID();
    const expiresInDays = options.expiresInDays || 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    await this.db.transaction(async () => {
      await this.db.prepare("UPDATE interview_invitation_tokens SET status = 'REVOKED' WHERE interview_id = ? AND status = 'ACTIVE'").run(interviewId);

      await this.db.prepare(`
        INSERT INTO interview_invitation_tokens (id, interview_id, token_hash, status, expires_at, created_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?)
      `).run(tokenId, interviewId, tokenHash, expiresAt, createdAt);

      await this.db.prepare("UPDATE interviews SET candidate_response_status = 'PENDING' WHERE id = ? AND candidate_response_status IS NULL").run(interviewId);

      const appUrl = config.APP_URL || 'http://localhost:3000';
      const invitationUrl = `${appUrl}/interviews/invitation?token=${rawToken}`;
      const locationText = interview.interview_format === 'ONLINE'
        ? `Liên kết họp trực tuyến: ${interview.meeting_link || interview.location_or_link || 'Google Meet'}`
        : `Phòng phỏng vấn trực tiếp: ${interview.meeting_room || interview.location_or_link || 'Văn phòng công ty'}`;
      const instructions = 'Vui lòng kiểm tra thiết bị, đường truyền mạng và chuẩn bị phòng yên tĩnh trước giờ phỏng vấn ít nhất 10 phút. Mang theo CV bản in và giấy tờ tùy thân nếu phỏng vấn trực tiếp.';

      const bodyText = `Xin chào ${interview.candidate_name},\n\nBạn nhận được lời mời tham gia phỏng vấn cho vị trí: ${interview.requisition_title || 'Vị trí tuyển dụng'}.\nVòng phỏng vấn: ${interview.round_name}\nThời gian: ${this.formatVietnamDate(interview.scheduled_time)} (Thời lượng: ${interview.duration_minutes || 60} phút)\nHình thức: ${interview.interview_format === 'ONLINE' ? 'Trực tuyến' : 'Trực tiếp'}\n${locationText}\n\nHướng dẫn chuẩn bị: ${instructions}\n\nVui lòng bấm vào liên kết sau để xác nhận tham dự hoặc đề nghị đổi lịch:\n${invitationUrl}\n\nTrân trọng,\nBộ phận Tuyển dụng`;

      const bodyHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">Thư mời phỏng vấn</h2>
          <p>Xin chào <strong>${escapeEmailHtml(interview.candidate_name)}</strong>,</p>
          <p>Chúng tôi trân trọng mời bạn tham dự buổi phỏng vấn cho vị trí <strong>${escapeEmailHtml(interview.requisition_title || 'Vị trí tuyển dụng')}</strong>.</p>
          <div style="background: #f8fafc; padding: 16px; border-radius: 6px; border-left: 4px solid #2563eb; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Vòng phỏng vấn:</strong> ${escapeEmailHtml(interview.round_name)}</p>
            <p style="margin: 4px 0;"><strong>Thời gian:</strong> ${this.formatVietnamDate(interview.scheduled_time)} (${interview.duration_minutes || 60} phút)</p>
            <p style="margin: 4px 0;"><strong>Hình thức:</strong> ${interview.interview_format === 'ONLINE' ? '💻 Trực tuyến' : '🏢 Trực tiếp'}</p>
            <p style="margin: 4px 0;"><strong>${interview.interview_format === 'ONLINE' ? 'Liên kết họp' : 'Địa điểm'}:</strong> ${escapeEmailHtml(interview.interview_format === 'ONLINE' ? (interview.meeting_link || interview.location_or_link) : (interview.meeting_room || interview.location_or_link))}</p>
          </div>
          <div style="background: #fffbeb; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 14px; color: #92400e;">
            <strong>📌 Hướng dẫn chuẩn bị:</strong> ${escapeEmailHtml(instructions)}
          </div>
          <p style="margin: 24px 0; text-align: center;">
            <a href="${escapeEmailHtml(invitationUrl)}" style="background: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Xác nhận hoặc Đổi lịch phỏng vấn</a>
          </p>
          <p style="font-size: 12px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">Liên kết này chỉ có giá trị cho buổi phỏng vấn được nêu ở trên và sẽ hết hạn sau ${expiresInDays} ngày.</p>
        </div>
      `;

      const outboxId = 'outbox-' + crypto.randomUUID();
      const subject = `[ATS] Thư mời phỏng vấn vị trí ${interview.requisition_title || ''} - ${interview.candidate_name}`;

      try {
        await this.db.prepare(`
          INSERT INTO email_outbox (id, recipient, subject, body_html, body_text, template_name, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'S605_INTERVIEW_INVITATION', 'PENDING', ?)
        `).run(outboxId, interview.candidate_email.trim(), subject, bodyHtml, bodyText, createdAt);

        await this.db.prepare(`
          INSERT INTO interview_invitation_deliveries (outbox_id, interview_id, state, attempts, updated_at)
          VALUES (?, ?, 'PENDING', 0, ?)
          ON CONFLICT (interview_id) DO UPDATE SET outbox_id = excluded.outbox_id, state = 'PENDING', attempts = 0, updated_at = excluded.updated_at
        `).run(outboxId, interviewId, createdAt);
      } catch {}
    });

    return {
      success: true,
      statusCode: 201,
      interviewId,
      token: rawToken,
      tokenHash,
      expiresAt
    };
  }

  async getInvitationByToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { success: false, statusCode: 400, code: 'INVALID_TOKEN', message: 'Token không hợp lệ.' };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

    const row = await this.db.prepare(`
      SELECT t.id AS token_id, t.interview_id, t.status AS token_status, t.expires_at, t.used_at,
             i.round_name, i.scheduled_time, i.duration_minutes, i.interview_format,
             i.meeting_room, i.meeting_link, i.location_or_link, i.status AS interview_status,
             i.candidate_response_status, i.candidate_response_note, i.candidate_responded_at,
             c.full_name AS candidate_name, c.email AS candidate_email,
             r.title AS requisition_title
      FROM interview_invitation_tokens t
      JOIN interviews i ON i.id = t.interview_id
      LEFT JOIN candidates c ON c.id = i.candidate_id
      LEFT JOIN requisitions r ON r.id = COALESCE(i.requisition_id, c.requisition_id)
      WHERE t.token_hash = ?
    `).get(tokenHash);

    if (!row) {
      return { success: false, statusCode: 404, code: 'TOKEN_NOT_FOUND', message: 'Liên kết mời phỏng vấn không tồn tại.' };
    }

    if (row.token_status === 'REVOKED') {
      return { success: false, statusCode: 400, code: 'TOKEN_REVOKED', message: 'Liên kết mời phỏng vấn này đã bị huỷ do lịch đã được cập nhật lại.' };
    }

    if (row.token_status === 'USED') {
      return {
        success: false,
        statusCode: 409,
        code: 'TOKEN_ALREADY_USED',
        message: 'Bạn đã phản hồi cho buổi phỏng vấn này rồi.',
        responseStatus: row.candidate_response_status,
        respondedAt: row.candidate_responded_at
      };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { success: false, statusCode: 400, code: 'TOKEN_EXPIRED', message: 'Liên kết mời phỏng vấn đã hết hạn.' };
    }

    if (row.interview_status === 'CANCELLED') {
      return { success: false, statusCode: 400, code: 'INTERVIEW_CANCELLED', message: 'Buổi phỏng vấn này đã bị huỷ.' };
    }

    if (row.interview_status !== 'SCHEDULED') {
      return { success: false, statusCode: 400, code: 'INTERVIEW_NOT_ACTIVE', message: 'Buổi phỏng vấn không ở trạng thái hoạt động.' };
    }

    return {
      success: true,
      statusCode: 200,
      interview: {
        interviewId: row.interview_id,
        candidateName: row.candidate_name,
        candidateEmail: row.candidate_email,
        requisitionTitle: row.requisition_title,
        roundName: row.round_name,
        scheduledTime: row.scheduled_time,
        durationMinutes: row.duration_minutes || 60,
        interviewFormat: row.interview_format || 'ONLINE',
        meetingRoom: row.meeting_room,
        meetingLink: row.meeting_link,
        locationOrLink: row.location_or_link,
        instructions: 'Vui lòng kiểm tra thiết bị, đường truyền mạng và chuẩn bị phòng yên tĩnh trước giờ phỏng vấn ít nhất 10 phút. Mang theo CV bản in và giấy tờ tùy thân nếu phỏng vấn trực tiếp.',
        responseStatus: row.candidate_response_status || 'PENDING',
        responseNote: row.candidate_response_note || null,
        respondedAt: row.candidate_responded_at || null
      }
    };
  }

  async respondToInvitation(rawToken, data = {}) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { success: false, statusCode: 400, code: 'INVALID_TOKEN', message: 'Token không hợp lệ.' };
    }

    const action = data.action;
    if (!['CONFIRM', 'REQUEST_RESCHEDULE'].includes(action)) {
      return { success: false, statusCode: 400, code: 'INVALID_RESPONSE_ACTION', message: 'Hành động phản hồi không hợp lệ (phải là CONFIRM hoặc REQUEST_RESCHEDULE).' };
    }

    const note = typeof data.note === 'string' ? data.note.trim() : null;
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

    return this.db.transaction(async () => {
      const lockQuery = this.db.provider === 'postgres'
        ? `SELECT t.id, t.interview_id, t.status AS token_status, t.expires_at,
                  i.candidate_id, i.round_name, i.scheduled_time, i.status AS interview_status,
                  i.candidate_response_status, c.full_name AS candidate_name, c.email AS candidate_email
           FROM interview_invitation_tokens t
           JOIN interviews i ON i.id = t.interview_id
           LEFT JOIN candidates c ON c.id = i.candidate_id
           WHERE t.token_hash = ? FOR UPDATE OF t, i`
        : `SELECT t.id, t.interview_id, t.status AS token_status, t.expires_at,
                  i.candidate_id, i.round_name, i.scheduled_time, i.status AS interview_status,
                  i.candidate_response_status, c.full_name AS candidate_name, c.email AS candidate_email
           FROM interview_invitation_tokens t
           JOIN interviews i ON i.id = t.interview_id
           LEFT JOIN candidates c ON c.id = i.candidate_id
           WHERE t.token_hash = ?`;

      const tokenRow = await this.db.prepare(lockQuery).get(tokenHash);

      if (!tokenRow) {
        return { success: false, statusCode: 404, code: 'TOKEN_NOT_FOUND', message: 'Liên kết mời phỏng vấn không tồn tại.' };
      }

      if (tokenRow.token_status === 'REVOKED') {
        return { success: false, statusCode: 400, code: 'TOKEN_REVOKED', message: 'Liên kết mời phỏng vấn này đã bị vô hiệu hoá do lịch đã được cập nhật lại.' };
      }

      if (tokenRow.token_status === 'USED') {
        return { success: false, statusCode: 409, code: 'TOKEN_ALREADY_USED', message: 'Bạn đã phản hồi cho buổi phỏng vấn này rồi.' };
      }

      if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
        return { success: false, statusCode: 400, code: 'TOKEN_EXPIRED', message: 'Liên kết mời phỏng vấn đã hết hạn.' };
      }

      if (tokenRow.interview_status === 'CANCELLED') {
        return { success: false, statusCode: 400, code: 'INTERVIEW_CANCELLED', message: 'Buổi phỏng vấn này đã bị huỷ.' };
      }

      if (tokenRow.interview_status !== 'SCHEDULED') {
        return { success: false, statusCode: 400, code: 'INTERVIEW_NOT_ACTIVE', message: 'Buổi phỏng vấn không ở trạng thái hoạt động.' };
      }

      const now = new Date().toISOString();
      const newResponseStatus = (action === 'CONFIRM') ? 'CONFIRMED' : 'RESCHEDULE_REQUESTED';

      await this.db.prepare(`
        UPDATE interview_invitation_tokens
        SET status = 'USED', used_at = ?
        WHERE id = ?
      `).run(now, tokenRow.id);

      await this.db.prepare(`
        UPDATE interviews
        SET candidate_response_status = ?,
            candidate_response_note = ?,
            candidate_responded_at = ?
        WHERE id = ?
      `).run(newResponseStatus, note, now, tokenRow.interview_id);

      if (tokenRow.candidate_id) {
        const histId = 'csh-' + crypto.randomUUID();
        const actionText = (action === 'CONFIRM') ? 'Ứng viên xác nhận tham gia phỏng vấn' : 'Ứng viên đề nghị dời lịch phỏng vấn';
        const noteText = note ? `Ghi chú ứng viên: ${note}` : actionText;

        try {
          await this.db.prepare(`
            INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at)
            VALUES (?, ?, 'INTERVIEW', 'INTERVIEW', NULL, ?, ?, ?, ?)
          `).run(histId, tokenRow.candidate_id, tokenRow.candidate_name || 'Ứng viên', action, noteText, now);
        } catch {}
      }

      return {
        success: true,
        statusCode: 200,
        message: action === 'CONFIRM' ? 'Xác nhận tham dự phỏng vấn thành công.' : 'Đã ghi nhận yêu cầu đề nghị đổi lịch phỏng vấn.',
        responseStatus: newResponseStatus,
        responseNote: note,
        respondedAt: now,
        interviewId: tokenRow.interview_id,
        candidateName: tokenRow.candidate_name
      };
    });
  }
}

module.exports = InterviewInvitationService;
