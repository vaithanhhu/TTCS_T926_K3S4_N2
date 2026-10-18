const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class InterviewEvaluationService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  async hasEvaluationTables() {
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_name = 'interview_evaluations'").get();
        return Boolean(row);
      }
      const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_evaluations'").get();
      return Boolean(row);
    } catch {
      return false;
    }
  }

  getStandardDefaultCriteria() {
    return [
      {
        id: 'crit-tech-01',
        name: 'Kỹ năng chuyên môn',
        description: 'Kiến thức và kỹ năng thực hành theo yêu cầu công việc',
        weight: 4,
        displayOrder: 1
      },
      {
        id: 'crit-problem-02',
        name: 'Giải quyết vấn đề',
        description: 'Tư duy logic, phân tích và tìm giải pháp cho vấn đề',
        weight: 3,
        displayOrder: 2
      },
      {
        id: 'crit-comm-03',
        name: 'Giao tiếp & Làm việc nhóm',
        description: 'Khả năng truyền đạt, lắng nghe và phối hợp hiệu quả',
        weight: 2,
        displayOrder: 3
      },
      {
        id: 'crit-culture-04',
        name: 'Mức độ phù hợp văn hóa',
        description: 'Thái độ tích cực, tinh thần trách nhiệm và phù hợp giá trị cốt lõi',
        weight: 2,
        displayOrder: 4
      }
    ];
  }

  calculateWeightedScore(criteria) {
    if (!Array.isArray(criteria) || criteria.length === 0) {
      return { success: false, statusCode: 400, code: 'CRITERIA_REQUIRED', message: 'Danh sách tiêu chí đánh giá không được để trống.' };
    }
    let sumScore = 0;
    let sumWeight = 0;
    for (const item of criteria) {
      const weight = Number(item.weight);
      const score = Number(item.score);
      if (!Number.isInteger(weight) || weight <= 0) {
        return { success: false, statusCode: 400, code: 'INVALID_CRITERION_WEIGHT', message: 'Trọng số tiêu chí phải là số nguyên dương.' };
      }
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        return { success: false, statusCode: 400, code: 'INVALID_CRITERION_SCORE', message: 'Điểm đánh giá từng tiêu chí phải là số nguyên từ 1 đến 5.' };
      }
      sumScore += score * weight;
      sumWeight += weight;
    }
    if (sumWeight === 0) {
      return { success: false, statusCode: 400, code: 'INVALID_CRITERIA_WEIGHT_TOTAL', message: 'Tổng trọng số phải lớn hơn 0.' };
    }
    const totalScore = Number((sumScore / sumWeight).toFixed(2));
    return { success: true, totalScore };
  }

  async getInterviewInfo(interviewId) {
    return this.db.prepare(`
      SELECT
        i.id,
        i.candidate_id,
        i.requisition_id,
        i.interviewer_id,
        i.round_name,
        i.status,
        r.job_title_id,
        jt.name AS job_title_name,
        jt.framework_id,
        cf.name AS framework_name
      FROM interviews i
      LEFT JOIN requisitions r ON r.id = i.requisition_id
      LEFT JOIN job_titles jt ON jt.id = r.job_title_id
      LEFT JOIN competency_frameworks cf ON cf.id = jt.framework_id
      WHERE i.id = ?
    `).get(interviewId);
  }

  async isInterviewerAssigned(interviewId, userId) {
    const primary = await this.db.prepare('SELECT id FROM interviews WHERE id = ? AND interviewer_id = ?').get(interviewId, userId);
    if (primary) return true;
    try {
      const participant = await this.db.prepare('SELECT user_id FROM interview_interviewers WHERE interview_id = ? AND user_id = ?').get(interviewId, userId);
      return Boolean(participant);
    } catch {
      return false;
    }
  }

  async getOrCreateEvaluationForm(interviewId, interviewerId = null, actor = null) {
    const access=await require('./interviewScopeService').authorizeInterview(this.db,interviewId,actor,'interview.read');if(!access.success)return access;actor=access.actor;
    if (!await this.hasEvaluationTables()) {
      return { success: false, statusCode: 503, code: 'EVALUATION_SERVICE_UNAVAILABLE', message: 'Bảng đánh giá chưa sẵn sàng.' };
    }

    const interview = await this.getInterviewInfo(interviewId);
    if (!interview) {
      return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND', message: 'Không tìm thấy buổi phỏng vấn.' };
    }

    let targetInterviewerId = interviewerId;
    if (actor) {
      const isPrivileged = actor.roles && actor.roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r));
      const isInterviewerRole = actor.roles && actor.roles.includes('INTERVIEWER');

      if (isInterviewerRole && !isPrivileged) {
        const assigned = await this.isInterviewerAssigned(interviewId, actor.id);
        if (!assigned) {
          return { success: false, statusCode: 403, code: 'INTERVIEW_ACCESS_DENIED', message: 'Bạn không được phân công phỏng vấn buổi này.' };
        }
        targetInterviewerId = actor.id;
      } else if (!targetInterviewerId) {
        targetInterviewerId = interview.interviewer_id || actor.id;
      }
    } else if (!targetInterviewerId) {
      targetInterviewerId = interview.interviewer_id;
    }

    if (!targetInterviewerId) {
      return { success: false, statusCode: 400, code: 'INTERVIEWER_REQUIRED', message: 'Không xác định được người phỏng vấn.' };
    }

    let evalRow = await this.db.prepare(`
      SELECT * FROM interview_evaluations
      WHERE interview_id = ? AND interviewer_id = ?
    `).get(interviewId, targetInterviewerId);

    if (!evalRow) {
      let criteriaList = [];
      let templateName = 'Khung năng lực tiêu chuẩn';

      if (interview.framework_id) {
        const rows = await this.db.prepare(`
          SELECT id, name, description, weight, display_order
          FROM competency_criteria
          WHERE framework_id = ?
          ORDER BY display_order ASC, created_at ASC
        `).all(interview.framework_id);

        if (rows && rows.length > 0) {
          criteriaList = rows.map(r => ({
            id: r.id,
            name: r.name,
            description: r.description || '',
            weight: Number(r.weight),
            displayOrder: Number(r.display_order || 0)
          }));
          templateName = interview.framework_name || 'Khung năng lực chức danh';
        }
      }

      if (criteriaList.length === 0) {
        criteriaList = this.getStandardDefaultCriteria();
      }

      const evalId = 'eval-' + crypto.randomUUID();
      const snapshotCriteriaJson = JSON.stringify(criteriaList);

      await this.db.transaction(async () => {
        await this.db.prepare(`
          INSERT INTO interview_evaluations (
            id, interview_id, interviewer_id, job_title_id, framework_id,
            template_name, snapshot_criteria, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', datetime('now'), datetime('now'))
        `).run(
          evalId,
          interviewId,
          targetInterviewerId,
          interview.job_title_id || null,
          interview.framework_id || null,
          templateName,
          snapshotCriteriaJson
        );

        for (const crit of criteriaList) {
          const itemId = 'ei-' + crypto.randomUUID();
          await this.db.prepare(`
            INSERT INTO interview_evaluation_items (
              id, evaluation_id, criterion_id, criterion_name, weight, score, comment, display_order
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
          `).run(
            itemId,
            evalId,
            crit.id,
            crit.name,
            crit.weight,
            crit.displayOrder
          );
        }
      });

      evalRow = await this.db.prepare(`
        SELECT * FROM interview_evaluations WHERE id = ?
      `).get(evalId);
    }

    const items = await this.db.prepare(`
      SELECT id, criterion_id, criterion_name, weight, score, comment, display_order
      FROM interview_evaluation_items
      WHERE evaluation_id = ?
      ORDER BY display_order ASC, id ASC
    `).all(evalRow.id);

    return {
      success: true,
      evaluation: {
        id: evalRow.id,
        interviewId: evalRow.interview_id,
        interviewerId: evalRow.interviewer_id,
        jobTitleId: evalRow.job_title_id,
        jobTitleName: interview.job_title_name || null,
        frameworkId: evalRow.framework_id,
        templateName: evalRow.template_name,
        status: evalRow.status,
        recommendation: evalRow.recommendation,
        generalNotes: evalRow.general_notes || '',
        totalScore: evalRow.total_score !== null ? Number(evalRow.total_score) : null,
        submittedAt: evalRow.submitted_at,
        reopenedAt: evalRow.reopened_at,
        reopenedBy: evalRow.reopened_by,
        reopenReason: evalRow.reopen_reason,
        criteria: items.map(item => ({
          id: item.criterion_id,
          itemId: item.id,
          name: item.criterion_name,
          weight: Number(item.weight),
          score: item.score !== null ? Number(item.score) : null,
          comment: item.comment || '',
          displayOrder: Number(item.display_order)
        })),
        createdAt: evalRow.created_at,
        updatedAt: evalRow.updated_at
      }
    };
  }

  async saveEvaluation(interviewId, data = {}, actor = null) {
    const access=await require('./interviewScopeService').authorizeInterview(this.db,interviewId,actor,'interview.evaluate');if(!access.success)return access;actor=access.actor;
    if (!await this.hasEvaluationTables()) {
      return { success: false, statusCode: 503, code: 'EVALUATION_SERVICE_UNAVAILABLE', message: 'Bảng đánh giá chưa sẵn sàng.' };
    }

    let targetInterviewerId = data.interviewerId;
    if (actor && actor.roles && actor.roles.includes('INTERVIEWER') && !actor.roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r))) {
      targetInterviewerId = actor.id;
    }

    const interview = await this.getInterviewInfo(interviewId);
    if (interview && interview.status === 'CANCELLED') {
      return {
        success: false,
        statusCode: 400,
        code: 'INTERVIEW_CANCELLED',
        message: 'Không thể đánh giá buổi phỏng vấn đã bị hủy.'
      };
    }

    const formResult = await this.getOrCreateEvaluationForm(interviewId, targetInterviewerId, actor);
    if (!formResult.success) return formResult;

    const evaluation = formResult.evaluation;
    if (evaluation.status === 'SUBMITTED') {
      return {
        success: false,
        statusCode: 400,
        code: 'EVALUATION_ALREADY_SUBMITTED',
        message: 'Phiếu đánh giá đã nộp không thể chỉnh sửa trừ khi được mở lại.'
      };
    }

    const isSubmitting = data.status === 'SUBMITTED';
    const criteriaInputs = Array.isArray(data.criteria) ? data.criteria : [];
    const inputMap = new Map(criteriaInputs.map(c => [c.id || c.criterionId, c]));

    const evaluatedCriteria = [];

    for (const crit of evaluation.criteria) {
      const input = inputMap.get(crit.id);
      let score = input && input.score !== undefined ? input.score : crit.score;
      const comment = input && input.comment !== undefined ? (typeof input.comment === 'string' ? input.comment.trim() : '') : crit.comment;

      if (isSubmitting) {
        if (score === null || score === undefined || score === '') {
          return {
            success: false,
            statusCode: 400,
            code: 'CRITERION_SCORE_REQUIRED',
            message: `Tiêu chí "${crit.name}" bắt buộc phải được chấm điểm.`
          };
        }
        score = Number(score);
        if (!Number.isInteger(score) || score < 1 || score > 5) {
          return {
            success: false,
            statusCode: 400,
            code: 'INVALID_CRITERION_SCORE',
            message: `Điểm đánh giá của tiêu chí "${crit.name}" phải là số nguyên từ 1 đến 5.`
          };
        }
      } else if (score !== null && score !== undefined && score !== '') {
        score = Number(score);
        if (!Number.isInteger(score) || score < 1 || score > 5) {
          return {
            success: false,
            statusCode: 400,
            code: 'INVALID_CRITERION_SCORE',
            message: `Điểm đánh giá phải là số nguyên từ 1 đến 5.`
          };
        }
      } else {
        score = null;
      }

      evaluatedCriteria.push({
        id: crit.id,
        itemId: crit.itemId,
        weight: crit.weight,
        score,
        comment
      });
    }

    let recommendation = data.recommendation !== undefined ? data.recommendation : evaluation.recommendation;
    if (isSubmitting) {
      if (!recommendation || !['RECOMMENDED', 'CONSIDER', 'NOT_RECOMMENDED'].includes(recommendation)) {
        return {
          success: false,
          statusCode: 400,
          code: 'RECOMMENDATION_REQUIRED',
          message: 'Kết luận phỏng vấn là bắt buộc khi nộp (Nên tuyển, Cân nhắc, hoặc Không nên tuyển).'
        };
      }
    } else if (recommendation && !['RECOMMENDED', 'CONSIDER', 'NOT_RECOMMENDED'].includes(recommendation)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_RECOMMENDATION',
        message: 'Kết luận không hợp lệ.'
      };
    }

    let calculatedTotalScore = null;
    if (isSubmitting) {
      const calcResult = this.calculateWeightedScore(evaluatedCriteria);
      if (!calcResult.success) return calcResult;
      calculatedTotalScore = calcResult.totalScore;
    } else {
      const scorable = evaluatedCriteria.filter(c => c.score !== null);
      if (scorable.length === evaluatedCriteria.length && evaluatedCriteria.length > 0) {
        const calcResult = this.calculateWeightedScore(scorable);
        if (calcResult.success) calculatedTotalScore = calcResult.totalScore;
      }
    }

    const generalNotes = data.generalNotes !== undefined
      ? (typeof data.generalNotes === 'string' ? data.generalNotes.trim() : '')
      : evaluation.generalNotes;

    try {
      await this.db.transaction(async () => {
        const locked = await this.db.prepare(
          'SELECT id, status FROM interview_evaluations WHERE id = ?' + (this.db.provider === 'postgres' ? ' FOR UPDATE' : '')
        ).get(evaluation.id);
        if (locked && locked.status === 'SUBMITTED') {
          throw new Error('EVALUATION_ALREADY_SUBMITTED');
        }

        for (const crit of evaluatedCriteria) {
          await this.db.prepare(`
            UPDATE interview_evaluation_items
            SET score = ?, comment = ?
            WHERE id = ?
          `).run(crit.score, crit.comment || null, crit.itemId);
        }

        const nextStatus = isSubmitting ? 'SUBMITTED' : (evaluation.status === 'REOPENED' ? 'REOPENED' : 'DRAFT');
        const submittedAtClause = isSubmitting ? ", submitted_at = datetime('now')" : '';

        await this.db.prepare(`
          UPDATE interview_evaluations
          SET status = ?,
              recommendation = ?,
              general_notes = ?,
              total_score = ?,
              updated_at = datetime('now')
              ${submittedAtClause}
          WHERE id = ?
        `).run(nextStatus, recommendation || null, generalNotes || null, calculatedTotalScore, evaluation.id);

        if (isSubmitting) {
          const interview = await this.db.prepare('SELECT interviewer_id FROM interviews WHERE id = ?').get(interviewId);
          if (interview && interview.interviewer_id === evaluation.interviewerId) {
            await this.db.prepare(`
              UPDATE interviews
              SET score = ?, feedback = ?, status = 'COMPLETED'
              WHERE id = ?
            `).run(Math.round(calculatedTotalScore), generalNotes || recommendation, interviewId);
          }
        }
      });
    } catch (err) {
      if (err.message === 'EVALUATION_ALREADY_SUBMITTED') {
        return {
          success: false,
          statusCode: 400,
          code: 'EVALUATION_ALREADY_SUBMITTED',
          message: 'Phiếu đánh giá đã nộp không thể chỉnh sửa trừ khi được mở lại.'
        };
      }
      throw err;
    }

    return this.getOrCreateEvaluationForm(interviewId, evaluation.interviewerId, actor);
  }

  async reopenEvaluation(interviewId, interviewerId, actor, data = {}) {
    const access=await require('./interviewScopeService').authorizeInterview(this.db,interviewId,actor,'interview.update');if(!access.success)return access.statusCode===403?{...access,code:'FORBIDDEN'}:access;actor=access.actor;
    if (!await this.hasEvaluationTables()) {
      return { success: false, statusCode: 503, code: 'EVALUATION_SERVICE_UNAVAILABLE', message: 'Bảng đánh giá chưa sẵn sàng.' };
    }

    if (!actor || !actor.roles || !actor.roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r))) {
      return {
        success: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Chỉ nhân viên tuyển dụng hoặc quản lý mới có quyền mở lại phiếu đánh giá.'
      };
    }

    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (reason.length < 3) {
      return {
        success: false,
        statusCode: 400,
        code: 'REOPEN_REASON_REQUIRED',
        message: 'Lý do mở lại phiếu đánh giá phải từ 3 ký tự trở lên.'
      };
    }

    const evalRow = await this.db.prepare(`
      SELECT * FROM interview_evaluations
      WHERE interview_id = ? AND interviewer_id = ?
    `).get(interviewId, interviewerId);

    if (!evalRow) {
      return {
        success: false,
        statusCode: 404,
        code: 'EVALUATION_NOT_FOUND',
        message: 'Không tìm thấy phiếu đánh giá.'
      };
    }

    if (evalRow.status !== 'SUBMITTED') {
      return {
        success: false,
        statusCode: 400,
        code: 'EVALUATION_NOT_SUBMITTED',
        message: 'Chỉ có thể mở lại phiếu đánh giá đã nộp.'
      };
    }

    if (!evalRow.submitted_at) {
      return {
        success: false,
        statusCode: 400,
        code: 'SUBMISSION_TIMESTAMP_MISSING',
        message: 'Phiếu chưa có thời gian nộp hợp lệ.'
      };
    }

    const submittedTime = new Date(evalRow.submitted_at).getTime();
    const now = Date.now();
    const diffHours = (now - submittedTime) / (1000 * 60 * 60);

    if (diffHours > 24) {
      return {
        success: false,
        statusCode: 400,
        code: 'REOPEN_WINDOW_EXPIRED',
        message: 'Đã quá thời hạn 24 giờ kể từ thời điểm nộp, không thể mở lại phiếu.'
      };
    }

    await this.db.prepare(`
      UPDATE interview_evaluations
      SET status = 'REOPENED',
          reopened_at = datetime('now'),
          reopened_by = ?,
          reopen_reason = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(actor.id, reason, evalRow.id);

    try {
      const historyId = 'csh-' + crypto.randomUUID();
      const interview = await this.db.prepare('SELECT candidate_id FROM interviews WHERE id = ?').get(interviewId);
      if (interview?.candidate_id) {
        await this.db.prepare(`
          INSERT INTO candidate_status_history (
            id, candidate_id, from_stage, to_stage, change_reason, changed_by, notes, created_at
          ) VALUES (?, ?, 'INTERVIEW', 'INTERVIEW', 'REOPEN_EVALUATION', ?, ?, datetime('now'))
        `).run(historyId, interview.candidate_id, actor.id, `Mở lại phiếu đánh giá: ${reason}`);
      }
    } catch {}

    return this.getOrCreateEvaluationForm(interviewId, interviewerId, actor);
  }

  async getEvaluationsForInterview(interviewId, actor = null) {
    const access=await require('./interviewScopeService').authorizeInterview(this.db,interviewId,actor,'interview.evaluation.read');if(!access.success)return access;actor=access.actor;
    if (!await this.hasEvaluationTables()) {
      return { success: true, evaluations: [] };
    }

    const isPrivileged = actor && actor.roles && actor.roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER', 'HIRING_MGR'].includes(r));
    const isInterviewer = actor && actor.roles && actor.roles.includes('INTERVIEWER');

    const evals = await this.db.prepare(`
      SELECT e.*, u.full_name AS interviewer_name, u.email AS interviewer_email
      FROM interview_evaluations e
      LEFT JOIN users u ON u.id = e.interviewer_id
      WHERE e.interview_id = ?
      ORDER BY e.created_at ASC
    `).all(interviewId);

    if (isInterviewer && !isPrivileged) {
      const assigned = await this.isInterviewerAssigned(interviewId, actor.id);
      if (!assigned) {
        return { success: false, statusCode: 403, code: 'INTERVIEW_ACCESS_DENIED', message: 'Bạn không được phân công phỏng vấn buổi này.' };
      }
      const myEval = evals.find(e => e.interviewer_id === actor.id);
      if (!myEval || myEval.status !== 'SUBMITTED') {
        const ownOnly = evals.filter(e => e.interviewer_id === actor.id);
        return {
          success: true,
          evaluations: await Promise.all(ownOnly.map(async row => (await this.mapEvaluationRow(row))))
        };
      }
    }

    const filtered = isPrivileged
      ? evals
      : evals.filter(e => e.status === 'SUBMITTED' || (actor && e.interviewer_id === actor.id));

    return {
      success: true,
      evaluations: await Promise.all(filtered.map(async row => (await this.mapEvaluationRow(row))))
    };
  }

  async mapEvaluationRow(row) {
    const items = await this.db.prepare(`
      SELECT id, criterion_id, criterion_name, weight, score, comment, display_order
      FROM interview_evaluation_items
      WHERE evaluation_id = ?
      ORDER BY display_order ASC, id ASC
    `).all(row.id);

    return {
      id: row.id,
      interviewId: row.interview_id,
      interviewerId: row.interviewer_id,
      interviewerName: row.interviewer_name || null,
      interviewerEmail: row.interviewer_email || null,
      templateName: row.template_name,
      status: row.status,
      recommendation: row.recommendation,
      generalNotes: row.general_notes || '',
      totalScore: row.total_score !== null ? Number(row.total_score) : null,
      submittedAt: row.submitted_at,
      reopenedAt: row.reopened_at,
      criteria: items.map(i => ({
        id: i.criterion_id,
        name: i.criterion_name,
        weight: Number(i.weight),
        score: i.score !== null ? Number(i.score) : null,
        comment: i.comment || '',
        displayOrder: Number(i.display_order)
      }))
    };
  }

  async hasSubmittedEvaluations(interviewId) {
    if (!await this.hasEvaluationTables()) return false;
    const row = await this.db.prepare("SELECT id FROM interview_evaluations WHERE interview_id = ? AND status = 'SUBMITTED' LIMIT 1").get(interviewId);
    return Boolean(row);
  }

  async compareCandidateEvaluations(requisitionId, options = {}, actor = null) {
    actor=await new(require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor?.id,'interview.evaluation.read');if(!actor)return {success:false,statusCode:403,code:'FORBIDDEN',message:'Access denied.'};
    if (!await this.hasEvaluationTables()) {
      return { success: false, statusCode: 503, code: 'EVALUATION_SERVICE_UNAVAILABLE', message: 'Bảng đánh giá chưa sẵn sàng.' };
    }

    if (!requisitionId || typeof requisitionId !== 'string' || !requisitionId.trim()) {
      return { success: false, statusCode: 400, code: 'BAD_REQUEST', message: 'Mã yêu cầu tuyển dụng không hợp lệ.' };
    }
    const reqId = requisitionId.trim();

    const reqRow = await this.db.prepare(`
      SELECT r.id, r.code, r.title, r.job_title_id, r.department_id, r.department_name, r.hiring_manager_id, r.recruiter_id,
             jt.name AS job_title_name
      FROM requisitions r
      LEFT JOIN job_titles jt ON jt.id = r.job_title_id
      WHERE r.id = ?
    `).get(reqId);

    if (!reqRow) {
      return { success: false, statusCode: 404, code: 'REQUISITION_NOT_FOUND', message: 'Không tìm thấy yêu cầu tuyển dụng.' };
    }

    if (actor) {
      const userRoles = actor.roles || [];
      const isAdminOrHr = userRoles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r));
      let hasAccess = isAdminOrHr;

      const reqService = new (require('./requisitionService'))(this.db);

      if (!hasAccess && userRoles.includes('HIRING_MGR')) {
        try {
          hasAccess = await reqService.canReadHiringRequisition(reqId, actor.id);
        } catch {
          hasAccess = false;
        }
      }

      if (!hasAccess && userRoles.includes('RECRUITER')) {
        try {
          hasAccess = await reqService.recruiterAssigned(reqId, actor.id);
        } catch {
          hasAccess = false;
        }
      }

      if (!hasAccess) {
        return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền xem so sánh ứng viên cho yêu cầu này.' };
      }
    }

    const interviewRows = await this.db.prepare(`
      SELECT i.id AS interview_id, i.candidate_id, i.round_name, i.scheduled_time, i.status AS interview_status, i.created_at,
             c.full_name AS candidate_name, c.email AS candidate_email, c.phone_number AS candidate_phone, c.stage AS candidate_stage
      FROM interviews i
      JOIN candidates c ON c.id = i.candidate_id
      WHERE (i.requisition_id = ? OR c.requisition_id = ?) AND i.status <> 'CANCELLED'
      ORDER BY i.scheduled_time DESC, i.created_at DESC
    `).all(reqId, reqId);

    const interviewsByCandidate = new Map();
    for (const row of (interviewRows || [])) {
      if (!interviewsByCandidate.has(row.candidate_id)) {
        interviewsByCandidate.set(row.candidate_id, []);
      }
      interviewsByCandidate.get(row.candidate_id).push(row);
    }

    const submittedEvalsByInterview = new Map();
    for (const row of (interviewRows || [])) {
      const evals = await this.db.prepare(`
        SELECT ev.id, ev.interview_id, ev.interviewer_id, ev.recommendation, ev.general_notes, ev.total_score, ev.submitted_at,
               u.full_name AS interviewer_name, u.email AS interviewer_email
        FROM interview_evaluations ev
        LEFT JOIN users u ON u.id = ev.interviewer_id
        WHERE ev.interview_id = ? AND ev.status = 'SUBMITTED'
      `).all(row.interview_id);
      if (evals && evals.length > 0) {
        submittedEvalsByInterview.set(row.interview_id, evals);
      }
    }

    const allSubmittedInterviews = (interviewRows || []).filter(i => submittedEvalsByInterview.has(i.interview_id));
    let targetRoundFilter = options.roundName ? options.roundName.trim().toLowerCase() : null;
    let finalRoundNameFound = null;

    if (!targetRoundFilter && options.finalRoundOnly !== false) {
      const explicitFinal = allSubmittedInterviews.find(i => {
        const rn = (i.round_name || '').toLowerCase();
        return rn.includes('cuối') || rn.includes('final');
      });
      if (explicitFinal) {
        targetRoundFilter = explicitFinal.round_name.toLowerCase();
        finalRoundNameFound = explicitFinal.round_name;
      }
    }

    const candidateSelectedInterviews = [];
    for (const [candId, candInterviews] of interviewsByCandidate.entries()) {
      const candSubmitted = candInterviews.filter(i => submittedEvalsByInterview.has(i.interview_id));
      if (candSubmitted.length === 0) continue;

      let chosen = null;
      if (targetRoundFilter) {
        chosen = candSubmitted.find(i => (i.round_name || '').toLowerCase() === targetRoundFilter);
      } else {
        chosen = candSubmitted[0];
      }

      if (chosen) {
        candidateSelectedInterviews.push({
          interview: chosen,
          evaluations: submittedEvalsByInterview.get(chosen.interview_id)
        });
      }
    }

    const allCriteriaMap = new Map();
    const candidateComparisonList = [];

    for (const entry of candidateSelectedInterviews) {
      const interview = entry.interview;
      const evals = entry.evaluations;
      const evalIds = evals.map(e => e.id);

      const items = await this.db.prepare(`
        SELECT item.evaluation_id, item.criterion_id, item.criterion_name, item.weight, item.score, item.comment, item.display_order,
               ev.interviewer_id, u.full_name AS interviewer_name
        FROM interview_evaluation_items item
        JOIN interview_evaluations ev ON ev.id = item.evaluation_id
        LEFT JOIN users u ON u.id = ev.interviewer_id
        WHERE item.evaluation_id IN (${evalIds.map(() => '?').join(',')})
        ORDER BY item.display_order ASC, item.criterion_id ASC
      `).all(...evalIds);

      const criteriaGroup = new Map();
      for (const it of (items || [])) {
        if (!allCriteriaMap.has(it.criterion_id)) {
          allCriteriaMap.set(it.criterion_id, {
            id: it.criterion_id,
            name: it.criterion_name,
            weight: Number(it.weight),
            displayOrder: Number(it.display_order)
          });
        }
        if (!criteriaGroup.has(it.criterion_id)) {
          criteriaGroup.set(it.criterion_id, {
            criterionId: it.criterion_id,
            criterionName: it.criterion_name,
            weight: Number(it.weight),
            displayOrder: Number(it.display_order),
            scores: []
          });
        }
        if (it.score !== null && it.score !== undefined) {
          criteriaGroup.get(it.criterion_id).scores.push({
            interviewerId: it.interviewer_id,
            interviewerName: it.interviewer_name || null,
            score: Number(it.score),
            comment: it.comment || ''
          });
        }
      }

      const criteriaDetails = [];
      const criteriaScores = {};
      for (const [critId, cg] of criteriaGroup.entries()) {
        const avgScore = cg.scores.length > 0
          ? Number((cg.scores.reduce((sum, s) => sum + s.score, 0) / cg.scores.length).toFixed(2))
          : null;
        criteriaScores[critId] = avgScore;
        criteriaDetails.push({
          criterionId: critId,
          criterionName: cg.criterionName,
          weight: cg.weight,
          displayOrder: cg.displayOrder,
          averageScore: avgScore,
          evaluatorScores: cg.scores
        });
      }

      const totalScoresList = evals.map(e => Number(e.total_score)).filter(s => !isNaN(s) && s !== null);
      const overallTotalScore = totalScoresList.length > 0
        ? Number((totalScoresList.reduce((sum, s) => sum + s, 0) / totalScoresList.length).toFixed(2))
        : 0;

      const recSummary = { RECOMMENDED: 0, CONSIDER: 0, NOT_RECOMMENDED: 0 };
      for (const e of evals) {
        if (e.recommendation && recSummary[e.recommendation] !== undefined) {
          recSummary[e.recommendation]++;
        }
      }

      candidateComparisonList.push({
        candidateId: interview.candidate_id,
        candidateName: interview.candidate_name,
        candidateEmail: interview.candidate_email,
        candidatePhone: interview.candidate_phone,
        candidateStage: interview.candidate_stage,
        interviewId: interview.interview_id,
        roundName: interview.round_name,
        scheduledTime: interview.scheduled_time,
        evaluationCount: evals.length,
        totalScore: overallTotalScore,
        recommendationSummary: recSummary,
        criteriaScores,
        criteriaDetails,
        evaluations: evals.map(e => ({
          interviewerId: e.interviewer_id,
          interviewerName: e.interviewer_name,
          totalScore: Number(e.total_score),
          recommendation: e.recommendation,
          submittedAt: e.submitted_at,
          generalNotes: e.general_notes || ''
        }))
      });
    }

    for (const cand of candidateComparisonList) {
      for (const critId of allCriteriaMap.keys()) {
        if (cand.criteriaScores[critId] === undefined) {
          cand.criteriaScores[critId] = null;
        }
      }
    }

    const isAsc = (options.order || '').toUpperCase() === 'ASC';
    candidateComparisonList.sort((a, b) => {
      if (a.totalScore !== b.totalScore) {
        return isAsc ? a.totalScore - b.totalScore : b.totalScore - a.totalScore;
      }
      return (a.candidateName || '').localeCompare(b.candidateName || '');
    });

    candidateComparisonList.forEach((cand, idx) => {
      cand.rank = idx + 1;
    });

    const criteriaHeaders = Array.from(allCriteriaMap.values()).sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.id.localeCompare(b.id);
    });

    return {
      success: true,
      statusCode: 200,
      data: {
        requisition: {
          id: reqRow.id,
          code: reqRow.code,
          title: reqRow.title,
          jobTitleName: reqRow.job_title_name || null,
          departmentName: reqRow.department_name || null,
          finalRoundName: finalRoundNameFound || (candidateComparisonList[0]?.roundName || null)
        },
        criteriaHeaders,
        totalCandidates: candidateComparisonList.length,
        candidates: candidateComparisonList
      }
    };
  }

  get hiringDecisionService() {
    if (!this._hiringDecisionService) {
      const HiringDecisionService = require('./hiringDecisionService');
      this._hiringDecisionService = new HiringDecisionService(this.db);
    }
    return this._hiringDecisionService;
  }

  async getCandidateInterviewSummary(candidateId, actor = null) {
    return this.hiringDecisionService.getCandidateInterviewSummary(candidateId, actor);
  }

  async recordHiringDecision(candidateId, data = {}, actor = null) {
    return this.hiringDecisionService.recordHiringDecision(candidateId, data, actor);
  }

  async getInterviewConsensus(interviewId, actor = null) {
    return this.hiringDecisionService.getInterviewConsensus(interviewId, actor);
  }

  async recordInterviewConsensus(interviewId, data = {}, actor = null) {
    return this.hiringDecisionService.recordInterviewConsensus(interviewId, data, actor);
  }
}

module.exports = InterviewEvaluationService;
