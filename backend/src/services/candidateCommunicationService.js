const crypto = require('node:crypto');
const migration = require('../db/migrate-bulk-candidate-communications');
const RBAC = require('../middlewares/rbacMiddleware');
const { getEmailService, escapeEmailHtml } = require('./emailService');

function renderTextVariables(text, vars) {
  return String(text || '').replace(/\{\{([A-Za-z_]\w*)\}\}|\{([A-Za-z_]\w*)\}/g,(match,double,single)=>Object.hasOwn(vars,double||single)?String(vars[double||single]??''):match);
}

class CandidateCommunicationService {
  constructor(db, requisitionService = null) {
    this.db = db;
    this.rbac = new RBAC(db);
    this.requisitionService = requisitionService;
    this.emailService = new (require('./emailService')).EmailService(db);
  }

  getReqService() {
    if (!this.requisitionService) {
      const RequisitionService = require('./requisitionService');
      this.requisitionService = new RequisitionService(this.db);
    }
    return this.requisitionService;
  }

  async actor(actor) {
    const fresh = await this.rbac.getAuthorizedActor(actor?.id, 'candidate.read');
    if (!fresh || !fresh.roles.some(role => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role))) {
      const error = new Error('COMMUNICATION_FORBIDDEN');
      error.statusCode = 403;
      error.code = 'COMMUNICATION_FORBIDDEN';
      throw error;
    }
    return fresh;
  }

  async getTemplates(actor) {
    await migration.verify(this.db);
    await this.actor(actor);
    const rows = await this.db.prepare('SELECT id, type, name, subject, body_html, body_text, is_default, created_at, updated_at FROM communication_templates ORDER BY is_default DESC, name ASC').all();
    return {
      success: true,
      statusCode: 200,
      data: rows.map(r => ({
        id: r.id,
        type: r.type,
        name: r.name,
        subject: r.subject,
        bodyHtml: r.body_html,
        bodyText: r.body_text,
        isDefault: Boolean(r.is_default),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    };
  }

  async previewBulk(payload, actor) {
    await migration.verify(this.db);
    const fresh = await this.actor(actor);

    const type = payload?.type;
    if (!['THANK_YOU', 'REJECTION'].includes(type)) {
      return { success: false, statusCode: 400, code: 'INVALID_COMMUNICATION_TYPE', message: 'Loại thư gửi không hợp lệ (chỉ hỗ trợ THANK_YOU hoặc REJECTION).' };
    }

    const candidateIds = payload?.candidateIds;
    if (!Array.isArray(candidateIds) || !candidateIds.length || candidateIds.length > 100 || candidateIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(candidateIds).size !== candidateIds.length) {
      return { success: false, statusCode: 400, code: 'CANDIDATES_LIST_INVALID', message: 'Danh sách mã ứng viên không hợp lệ hoặc vượt quá giới hạn 100.' };
    }

    const candidates = [];
    for (const id of candidateIds) {
      const access = await this.getReqService().candidateAccess(id, fresh, 'candidate.read');
      if (!access.success) {
        return { success: false, statusCode: access.statusCode || 403, code: access.code || 'CANDIDATE_OUT_OF_SCOPE', message: access.message };
      }
      const cand = await this.db.prepare(`
        SELECT c.id, c.full_name, c.email, c.stage, c.requisition_id, r.title AS requisition_title, d.name AS department_name
        FROM candidates c
        LEFT JOIN requisitions r ON r.id = c.requisition_id
        LEFT JOIN departments d ON d.id = r.department_id
        WHERE c.id = ?
      `).get(id);
      if (!cand) {
        return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên ' + id };
      }
      if (typeof cand.email !== 'string' || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(cand.email)) {
        return { success: false, statusCode: 400, code: 'CANDIDATE_EMAIL_INVALID', message: 'Email của ứng viên ' + cand.full_name + ' không hợp lệ.' };
      }
      candidates.push(cand);
    }

    const stages = new Set(candidates.map(c => c.stage));
    if (stages.size > 1) {
      return {
        success: false,
        statusCode: 400,
        code: 'CANDIDATES_STAGE_MISMATCH',
        message: 'Tất cả ứng viên được chọn phải có cùng giai đoạn tuyển dụng.'
      };
    }

    const commonStage = candidates[0].stage;
    if (type === 'REJECTION' && (commonStage === 'HIRED' || commonStage === 'ONBOARDED')) {
      return {
        success: false,
        statusCode: 400,
        code: 'CANNOT_REJECT_HIRED_CANDIDATE',
        message: 'Không thể gửi thư từ chối cho ứng viên đã được tuyển dụng hoặc hoàn tất onboarding.'
      };
    }

    const tmplRow = await this.db.prepare('SELECT subject, body_html, body_text FROM communication_templates WHERE type = ? ORDER BY is_default DESC LIMIT 1').get(type);
    const subjectTemplate = payload?.customSubject || tmplRow?.subject || (type === 'THANK_YOU' ? 'Thư cảm ơn ứng tuyển' : 'Thông báo kết quả ứng tuyển');
    const bodyHtmlTemplate = payload?.customBody || tmplRow?.body_html || '';
    const bodyTextTemplate = tmplRow?.body_text || '';

    const previews = [];
    for (const cand of candidates) {
      const vars = {
        candidateName: cand.full_name,
        candidate_name: cand.full_name,
        jobTitle: cand.requisition_title || 'Vị trí ứng tuyển',
        job_title: cand.requisition_title || 'Vị trí ứng tuyển',
        department: cand.department_name || 'Phòng ban chuyên môn',
        companyName: 'Công ty',
        company_name: 'Công ty'
      };

      const renderedSubject = renderTextVariables(subjectTemplate, vars);
      const renderedHtml = renderTextVariables(bodyHtmlTemplate, {
        ...vars,
        candidateName: escapeEmailHtml(cand.full_name),
        candidate_name: escapeEmailHtml(cand.full_name),
        jobTitle: escapeEmailHtml(cand.requisition_title || 'Vị trí ứng tuyển'),
        job_title: escapeEmailHtml(cand.requisition_title || 'Vị trí ứng tuyển'),
        department: escapeEmailHtml(cand.department_name || 'Phòng ban chuyên môn')
      });
      const renderedText = renderTextVariables(bodyTextTemplate, vars);

      const existingRejection = await this.db.prepare("SELECT id, sent_at FROM candidate_communications WHERE candidate_id = ? AND type = 'REJECTION' AND status IN ('DELIVERED', 'SENT_LOCAL')").get(cand.id);

      previews.push({
        candidateId: cand.id,
        candidateName: cand.full_name,
        candidateEmail: cand.email,
        stage: cand.stage,
        jobTitle: cand.requisition_title || 'Vị trí ứng tuyển',
        department: cand.department_name || 'Phòng ban chuyên môn',
        subject: renderedSubject,
        bodyHtml: renderedHtml,
        bodyText: renderedText,
        alreadyReceivedRejection: Boolean(existingRejection),
        canSend: !(type === 'REJECTION' && existingRejection)
      });
    }

    return {
      success: true,
      statusCode: 200,
      stage: commonStage,
      type,
      total: candidates.length,
      previews
    };
  }

  async sendBulk(payload, actor) {
    await migration.verify(this.db);
    const fresh = await this.actor(actor);

    const type = payload?.type;
    if (!['THANK_YOU', 'REJECTION'].includes(type)) {
      return { success: false, statusCode: 400, code: 'INVALID_COMMUNICATION_TYPE', message: 'Loại thư gửi không hợp lệ (chỉ hỗ trợ THANK_YOU hoặc REJECTION).' };
    }

    const candidateIds = payload?.candidateIds;
    if (!Array.isArray(candidateIds) || !candidateIds.length || candidateIds.length > 100 || candidateIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(candidateIds).size !== candidateIds.length) {
      return { success: false, statusCode: 400, code: 'CANDIDATES_LIST_INVALID', message: 'Danh sách mã ứng viên không hợp lệ hoặc vượt quá giới hạn 100.' };
    }

    const candidates = [];
    for (const id of candidateIds) {
      const access = await this.getReqService().candidateAccess(id, fresh, 'candidate.read');
      if (!access.success) {
        return { success: false, statusCode: access.statusCode || 403, code: access.code || 'CANDIDATE_OUT_OF_SCOPE', message: access.message };
      }
      const cand = await this.db.prepare(`
        SELECT c.id, c.full_name, c.email, c.stage, c.requisition_id, r.title AS requisition_title, d.name AS department_name
        FROM candidates c
        LEFT JOIN requisitions r ON r.id = c.requisition_id
        LEFT JOIN departments d ON d.id = r.department_id
        WHERE c.id = ?
      `).get(id);
      if (!cand) {
        return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên ' + id };
      }
      if (typeof cand.email !== 'string' || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(cand.email)) {
        return { success: false, statusCode: 400, code: 'CANDIDATE_EMAIL_INVALID', message: 'Email của ứng viên ' + cand.full_name + ' không hợp lệ.' };
      }
      candidates.push(cand);
    }

    const stages = new Set(candidates.map(c => c.stage));
    if (stages.size > 1) {
      return {
        success: false,
        statusCode: 400,
        code: 'CANDIDATES_STAGE_MISMATCH',
        message: 'Tất cả ứng viên được chọn phải có cùng giai đoạn tuyển dụng.'
      };
    }

    const commonStage = candidates[0].stage;
    if (type === 'REJECTION' && (commonStage === 'HIRED' || commonStage === 'ONBOARDED')) {
      return {
        success: false,
        statusCode: 400,
        code: 'CANNOT_REJECT_HIRED_CANDIDATE',
        message: 'Không thể gửi thư từ chối cho ứng viên đã được tuyển dụng hoặc hoàn tất onboarding.'
      };
    }

    const tmplRow = await this.db.prepare('SELECT subject, body_html, body_text FROM communication_templates WHERE type = ? ORDER BY is_default DESC LIMIT 1').get(type);
    const subjectTemplate = payload?.customSubject || tmplRow?.subject || (type === 'THANK_YOU' ? 'Thư cảm ơn ứng tuyển' : 'Thông báo kết quả ứng tuyển');
    const bodyHtmlTemplate = payload?.customBody || tmplRow?.body_html || '';
    const bodyTextTemplate = tmplRow?.body_text || '';

    const batchId = 'cb-' + crypto.randomUUID();
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const cand of candidates) {
      if (type === 'REJECTION') {
        const existingRejection = await this.db.prepare("SELECT id, sent_at FROM candidate_communications WHERE candidate_id = ? AND type = 'REJECTION' AND status IN ('PENDING', 'DELIVERED', 'SENT_LOCAL')").get(cand.id);
        if (existingRejection) {
          skippedCount++;
          results.push({
            candidateId: cand.id,
            candidateName: cand.full_name,
            email: cand.email,
            status: 'SKIPPED_DUPLICATE',
            reason: 'REJECTION_ALREADY_SENT'
          });
          continue;
        }
      }

      const vars = {
        candidateName: cand.full_name,
        candidate_name: cand.full_name,
        jobTitle: cand.requisition_title || 'Vị trí ứng tuyển',
        job_title: cand.requisition_title || 'Vị trí ứng tuyển',
        department: cand.department_name || 'Phòng ban chuyên môn',
        companyName: 'Công ty',
        company_name: 'Công ty'
      };

      const renderedSubject = renderTextVariables(subjectTemplate, vars);
      const renderedHtml = renderTextVariables(bodyHtmlTemplate, {
        ...vars,
        candidateName: escapeEmailHtml(cand.full_name),
        candidate_name: escapeEmailHtml(cand.full_name),
        jobTitle: escapeEmailHtml(cand.requisition_title || 'Vị trí ứng tuyển'),
        job_title: escapeEmailHtml(cand.requisition_title || 'Vị trí ứng tuyển'),
        department: escapeEmailHtml(cand.department_name || 'Phòng ban chuyên môn')
      });
      const renderedText = renderTextVariables(bodyTextTemplate, vars);

      const commId = 'comm-' + crypto.randomUUID();
      let attempted=false;
      try {
        const reserved=await this.db.transaction(async()=>{
          const current=await this.actor(actor);
          const row=await this.db.prepare('SELECT id,email,stage,requisition_id FROM candidates WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(cand.id);
          if(!row||row.email!==cand.email||row.stage!==cand.stage||row.requisition_id!==cand.requisition_id)throw Error('COMMUNICATION_PREVIEW_STALE');
          if(row.requisition_id)await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(row.requisition_id);
          const access=await this.getReqService().candidateAccess(cand.id,current,'candidate.read');
          if(!access.success)throw Error('COMMUNICATION_FORBIDDEN');
          if(type==='REJECTION'&&await this.db.prepare("SELECT id FROM candidate_communications WHERE candidate_id=? AND type='REJECTION' AND status IN ('PENDING','DELIVERED','SENT_LOCAL')").get(cand.id))return false;
        await this.db.prepare(`
          INSERT INTO candidate_communications (id, candidate_id, requisition_id, batch_id, type, sender_id, recipient_email, recipient_name, subject, body_html, body_text, status, error_message, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ` + (this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')") + `)
        `).run(commId, cand.id, cand.requisition_id, batchId, type, fresh.id, cand.email, cand.full_name, renderedSubject, renderedHtml, renderedText);
          return true;
        });
        if(!reserved){skippedCount++;results.push({candidateId:cand.id,candidateName:cand.full_name,email:cand.email,status:'SKIPPED_DUPLICATE',reason:'REJECTION_ALREADY_SENT'});continue;}
        attempted=true;

        const mailRes = await this.emailService.sendMail({
          to: cand.email,
          subject: renderedSubject,
          html: renderedHtml,
          text: renderedText,
          templateName: type
        });

        if (mailRes.success && (mailRes.delivered || mailRes.simulated)) {
          const finalStatus = mailRes.delivered ? 'DELIVERED' : 'SENT_LOCAL';
          await this.db.prepare('UPDATE candidate_communications SET status = ?, error_message = NULL WHERE id = ?').run(finalStatus, commId);
          sentCount++;
          results.push({
            candidateId: cand.id,
            candidateName: cand.full_name,
            email: cand.email,
            status: finalStatus,
            communicationId: commId
          });
        } else {
          const errorCode = mailRes.error || 'SMTP_SEND_FAILED';
          await this.db.prepare('UPDATE candidate_communications SET status = ?, error_message = ? WHERE id = ?').run(errorCode==='SMTP_SEND_FAILED'?'PENDING':'FAILED', errorCode, commId);
          failedCount++;
          results.push({
            candidateId: cand.id,
            candidateName: cand.full_name,
            email: cand.email,
            status: errorCode==='SMTP_SEND_FAILED'?'PENDING':'FAILED',
            error: errorCode,
            communicationId: commId
          });
        }
      } catch (err) {
        try {
          await this.db.prepare('UPDATE candidate_communications SET status = ?, error_message = ? WHERE id = ?').run(attempted?'PENDING':'FAILED', attempted?'COMMUNICATION_DELIVERY_UNKNOWN':'COMMUNICATION_SEND_FAILED', commId);
        } catch {}
        failedCount++;
        results.push({
          candidateId: cand.id,
          candidateName: cand.full_name,
          email: cand.email,
          status: attempted?'PENDING':'FAILED',
          error: attempted?'COMMUNICATION_DELIVERY_UNKNOWN':'COMMUNICATION_SEND_FAILED',
          communicationId: commId
        });
      }
    }

    return {
      success: true,
      statusCode: 200,
      batchId,
      type,
      stage: commonStage,
      total: candidateIds.length,
      sentCount,
      failedCount,
      skippedCount,
      results
    };
  }

  async getHistory(filters, actor) {
    await migration.verify(this.db);
    const fresh = await this.actor(actor);
    const conditions = [];
    const params = [];

    if (filters?.candidateId) {
      const access = await this.getReqService().candidateAccess(filters.candidateId, fresh, 'candidate.read');
      if (!access.success) {
        return { success: false, statusCode: access.statusCode || 403, code: access.code || 'CANDIDATE_OUT_OF_SCOPE', message: access.message };
      }
      conditions.push('candidate_id = ?');
      params.push(filters.candidateId);
    }

    if (filters?.batchId) {
      conditions.push('batch_id = ?');
      params.push(filters.batchId);
    }

    if (filters?.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }

    if (!fresh.roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r)) && fresh.roles.includes('RECRUITER')) {
      conditions.push('EXISTS (SELECT 1 FROM candidates c JOIN requisitions r ON r.id = c.requisition_id WHERE c.id = candidate_communications.candidate_id AND r.recruiter_id = ?)');
      params.push(fresh.id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = Math.max(1, Math.min(Number(filters?.limit) || 50, 100));
    const offset = Math.max(0, Number(filters?.offset) || 0);

    const rows = await this.db.prepare(`
      SELECT id, candidate_id, requisition_id, batch_id, type, sender_id, recipient_email, recipient_name, subject, body_html, body_text, status, error_message, sent_at
      FROM candidate_communications
      ${where}
      ORDER BY sent_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      success: true,
      statusCode: 200,
      data: rows.map(r => ({
        id: r.id,
        candidateId: r.candidate_id,
        requisitionId: r.requisition_id,
        batchId: r.batch_id,
        type: r.type,
        senderId: r.sender_id,
        recipientEmail: r.recipient_email,
        recipientName: r.recipient_name,
        subject: r.subject,
        bodyHtml: r.body_html,
        bodyText: r.body_text,
        status: r.status,
        errorMessage: r.error_message,
        sentAt: r.sent_at
      }))
    };
  }
}

let candidateCommunicationServiceInstance = null;
function getCandidateCommunicationService(db) {
  if (!candidateCommunicationServiceInstance || (db && candidateCommunicationServiceInstance.db !== db)) {
    candidateCommunicationServiceInstance = new CandidateCommunicationService(db);
  }
  return candidateCommunicationServiceInstance;
}

module.exports = {
  CandidateCommunicationService,
  getCandidateCommunicationService,
  renderTextVariables
};
