const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const RequisitionService = require('./requisitionService');

class HiringDecisionService {
  constructor(db) {
    this.db = db || getDatabase();
    this.requisitionService = new RequisitionService(this.db);
  }

  async hasHiringDecisionsTable() {
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_name = 'hiring_decisions'").get();
        return Boolean(row);
      }
      const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hiring_decisions'").get();
      return Boolean(row);
    } catch {
      return false;
    }
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

  async getCandidateInterviewSummary(candidateId, actor = null) {
    if (!candidateId || typeof candidateId !== 'string') {
      return { success: false, statusCode: 400, code: 'BAD_REQUEST', message: 'Mã ứng viên không hợp lệ.' };
    }

    const candidate = await this.db.prepare(`
      SELECT c.id, c.full_name, c.email, c.phone_number, c.stage, c.requisition_id, c.rejection_reason_id, c.notes,
             r.code AS requisition_code, r.title AS requisition_title, r.department_id, r.department_name,
             r.hiring_manager_id, r.recruiter_id, r.job_title_id, jt.name AS job_title_name
      FROM candidates c
      LEFT JOIN requisitions r ON r.id = c.requisition_id
      LEFT JOIN job_titles jt ON jt.id = r.job_title_id
      WHERE c.id = ?
    `).get(candidateId.trim());

    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' };
    }

    if (actor) {
      const roles = actor.roles || [];
      const isAdminOrHr = roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r));
      let hasAccess = isAdminOrHr;

      if (!hasAccess && roles.includes('HIRING_MGR') && candidate.requisition_id) {
        if (candidate.hiring_manager_id === actor.id) {
          hasAccess = true;
        } else {
          try {
            hasAccess = await this.requisitionService.canReadHiringRequisition(candidate.requisition_id, actor.id);
          } catch {
            hasAccess = false;
          }
        }
      }

      if (!hasAccess && roles.includes('RECRUITER') && candidate.requisition_id) {
        try {
          hasAccess = await this.requisitionService.recruiterAssigned(candidate.requisition_id, actor.id);
        } catch {
          hasAccess = false;
        }
      }

      if (!hasAccess) {
        return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền xem thông tin ứng viên này.' };
      }
    }

    const interviews = await this.db.prepare(`
      SELECT i.id, i.round_name, i.scheduled_time, i.location_or_link, i.status, i.feedback, i.score,
             i.interviewer_id, u.full_name AS interviewer_name, u.email AS interviewer_email
      FROM interviews i
      LEFT JOIN users u ON u.id = i.interviewer_id
      WHERE i.candidate_id = ? AND i.status <> 'CANCELLED'
      ORDER BY i.scheduled_time ASC, i.created_at ASC
    `).all(candidate.id);

    const hasEvals = await this.hasEvaluationTables();
    const rounds = [];
    const allSubmittedEvals = [];
    const allEvaluationItems = [];

    for (const interview of (interviews || [])) {
      let evals = [];
      if (hasEvals) {
        evals = await this.db.prepare(`
          SELECT ev.id, ev.interview_id, ev.interviewer_id, ev.status, ev.recommendation, ev.general_notes,
                 ev.total_score, ev.submitted_at, u.full_name AS interviewer_name, u.email AS interviewer_email
          FROM interview_evaluations ev
          LEFT JOIN users u ON u.id = ev.interviewer_id
          WHERE ev.interview_id = ? AND ev.status = 'SUBMITTED'
          ORDER BY ev.submitted_at ASC, ev.created_at ASC
        `).all(interview.id);
      }

      const mappedEvals = [];
      for (const ev of (evals || [])) {
        allSubmittedEvals.push({ ...ev, round_name: interview.round_name });
        let items = [];
        if (hasEvals) {
          items = await this.db.prepare(`
            SELECT id, criterion_id, criterion_name, weight, score, comment, display_order
            FROM interview_evaluation_items
            WHERE evaluation_id = ?
            ORDER BY display_order ASC, id ASC
          `).all(ev.id);
        }

        for (const item of (items || [])) {
          allEvaluationItems.push({
            ...item,
            round_name: interview.round_name,
            interviewer_id: ev.interviewer_id,
            interviewer_name: ev.interviewer_name
          });
        }

        mappedEvals.push({
          id: ev.id,
          interviewerId: ev.interviewer_id,
          interviewerName: ev.interviewer_name || null,
          interviewerEmail: ev.interviewer_email || null,
          recommendation: ev.recommendation,
          generalNotes: ev.general_notes || '',
          totalScore: ev.total_score !== null ? Number(ev.total_score) : null,
          submittedAt: ev.submitted_at,
          criteria: (items || []).map(it => ({
            criterionId: it.criterion_id,
            criterionName: it.criterion_name,
            weight: Number(it.weight),
            score: it.score !== null ? Number(it.score) : null,
            comment: it.comment || '',
            displayOrder: Number(it.display_order)
          }))
        });
      }

      rounds.push({
        interviewId: interview.id,
        roundName: interview.round_name,
        scheduledTime: interview.scheduled_time,
        status: interview.status,
        interviewerName: interview.interviewer_name || null,
        legacyFeedback: interview.feedback || null,
        legacyScore: interview.score !== null ? Number(interview.score) : null,
        submittedEvaluationsCount: mappedEvals.length,
        evaluations: mappedEvals
      });
    }

    const criteriaMap = new Map();
    for (const it of allEvaluationItems) {
      if (!criteriaMap.has(it.criterion_id)) {
        criteriaMap.set(it.criterion_id, {
          criterionId: it.criterion_id,
          criterionName: it.criterion_name,
          weight: Number(it.weight),
          displayOrder: Number(it.display_order),
          scores: []
        });
      }
      if (it.score !== null && it.score !== undefined) {
        criteriaMap.get(it.criterion_id).scores.push({
          roundName: it.round_name,
          interviewerId: it.interviewer_id,
          interviewerName: it.interviewer_name || null,
          score: Number(it.score),
          comment: it.comment || ''
        });
      }
    }

    const criteriaSummary = Array.from(criteriaMap.values())
      .sort((a, b) => a.displayOrder - b.displayOrder || a.criterionId.localeCompare(b.criterionId))
      .map(cg => {
        const avg = cg.scores.length > 0
          ? Number((cg.scores.reduce((s, x) => s + x.score, 0) / cg.scores.length).toFixed(2))
          : null;
        return {
          criterionId: cg.criterionId,
          criterionName: cg.criterionName,
          weight: cg.weight,
          displayOrder: cg.displayOrder,
          averageScore: avg,
          scoresCount: cg.scores.length,
          evaluatorScores: cg.scores
        };
      });

    const totalScores = allSubmittedEvals.map(e => Number(e.total_score)).filter(s => !isNaN(s) && s !== null);
    const overallAverageScore = totalScores.length > 0
      ? Number((totalScores.reduce((s, x) => s + x, 0) / totalScores.length).toFixed(2))
      : null;

    const recommendationsSummary = { RECOMMENDED: 0, CONSIDER: 0, NOT_RECOMMENDED: 0 };
    for (const ev of allSubmittedEvals) {
      if (ev.recommendation && recommendationsSummary[ev.recommendation] !== undefined) {
        recommendationsSummary[ev.recommendation]++;
      }
    }

    let decisions = [];
    if (await this.hasHiringDecisionsTable()) {
      decisions = await this.db.prepare(`
        SELECT hd.id, hd.candidate_id, hd.requisition_id, hd.interview_id, hd.decision, hd.rejection_reason_id,
               hd.reason_text, hd.notes, hd.consensus_score, hd.next_action, hd.decided_by, hd.decided_at,
               u.full_name AS decided_by_name, u.email AS decided_by_email, rci.name AS rejection_reason_name
        FROM hiring_decisions hd
        LEFT JOIN users u ON u.id = hd.decided_by
        LEFT JOIN recruitment_catalog_items rci ON rci.id = hd.rejection_reason_id
        WHERE hd.candidate_id = ?
        ORDER BY hd.decided_at DESC, hd.created_at DESC
      `).all(candidate.id);
    }

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
          rejectionReasonId: candidate.rejection_reason_id,
          notes: candidate.notes
        },
        requisition: {
          id: candidate.requisition_id,
          code: candidate.requisition_code,
          title: candidate.requisition_title,
          departmentId: candidate.department_id,
          departmentName: candidate.department_name,
          jobTitleName: candidate.job_title_name
        },
        rounds,
        criteriaSummary,
        overallAverageScore,
        recommendationsSummary,
        submittedEvaluationsCount: allSubmittedEvals.length,
        interviewRoundsCount: rounds.length,
        decisions: (decisions || []).map(d => ({
          id: d.id,
          decision: d.decision,
          rejectionReasonId: d.rejection_reason_id,
          rejectionReasonName: d.rejection_reason_name || d.reason_text,
          reasonText: d.reason_text,
          notes: d.notes,
          consensusScore: d.consensus_score !== null ? Number(d.consensus_score) : null,
          nextAction: d.next_action,
          decidedBy: d.decided_by,
          decidedByName: d.decided_by_name,
          decidedByEmail: d.decided_by_email,
          decidedAt: d.decided_at
        }))
      }
    };
  }

  async recordHiringDecision(candidateId, data = {}, actor = null) {
    if (!candidateId || typeof candidateId !== 'string') {
      return { success: false, statusCode: 400, code: 'BAD_REQUEST', message: 'Mã ứng viên không hợp lệ.' };
    }

    if (!actor || !actor.roles || !actor.roles.some(r => ['ADMIN', 'HR_MANAGER', 'HIRING_MGR'].includes(r))) {
      return {
        success: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Chỉ Trưởng bộ phận hoặc quản lý mới có quyền ra quyết định tuyển dụng.'
      };
    }

    const candidate = await this.db.prepare(`
      SELECT c.id, c.stage, c.requisition_id, c.full_name, c.email, c.notes, r.hiring_manager_id
      FROM candidates c
      LEFT JOIN requisitions r ON r.id = c.requisition_id
      WHERE c.id = ?
    `).get(candidateId.trim());

    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' };
    }

    const roles = actor.roles || [];
    const isAdminOrHr = roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r));
    if (!isAdminOrHr && roles.includes('HIRING_MGR')) {
      if (!candidate.requisition_id) {
        return { success: false, statusCode: 403, code: 'DECISION_ACCESS_DENIED', message: 'Bạn không có quyền quyết định cho ứng viên ngoài bộ phận phụ trách.' };
      }
      let canManage = candidate.hiring_manager_id === actor.id;
      if (!canManage) {
        try {
          canManage = await this.requisitionService.canReadHiringRequisition(candidate.requisition_id, actor.id);
        } catch {
          canManage = false;
        }
      }
      if (!canManage) {
        return { success: false, statusCode: 403, code: 'DECISION_ACCESS_DENIED', message: 'Bạn không có quyền quyết định cho ứng viên ngoài bộ phận phụ trách.' };
      }
    }

    let submittedCount = 0;
    if (await this.hasEvaluationTables()) {
      const row = await this.db.prepare(`
        SELECT COUNT(ev.id) AS count
        FROM interview_evaluations ev
        JOIN interviews i ON i.id = ev.interview_id
        WHERE i.candidate_id = ? AND ev.status = 'SUBMITTED'
      `).get(candidate.id);
      submittedCount = Number(row?.count || 0);
    }

    if (submittedCount === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'NO_SUBMITTED_EVALUATIONS',
        message: 'Không thể ra quyết định khi chưa có phiếu đánh giá phỏng vấn nào được nộp.'
      };
    }

    let rawDecision = (data.decision || data.finalRecommendation || '').trim().toUpperCase();
    if (rawDecision === 'PROCEED_TO_OFFER') rawDecision = 'OFFER';
    if (rawDecision === 'PASS') rawDecision = 'OFFER';

    if (!['OFFER', 'REJECT'].includes(rawDecision)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_DECISION',
        message: 'Quyết định không hợp lệ. Chỉ chấp nhận OFFER hoặc REJECT.'
      };
    }

    const targetStage = rawDecision === 'OFFER' ? 'OFFER' : 'REJECTED';
    let rejectionReasonId = null;
    let reasonText = null;
    const notes = typeof data.notes === 'string' ? data.notes.trim() : (typeof data.consensusNotes === 'string' ? data.consensusNotes.trim() : '');

    if (rawDecision === 'REJECT') {
      rejectionReasonId = (data.rejectionReasonId || '').trim() || null;
      if (!rejectionReasonId) {
        return {
          success: false,
          statusCode: 400,
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Loại ứng viên bắt buộc phải chọn lý do từ danh mục.'
        };
      }

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

      reasonText = reasonItem.name;
      const isOther = reasonItem.code === 'REJ-OTHER' || reasonItem.name.trim().toLowerCase() === 'khác';
      if (isOther && !notes) {
        return {
          success: false,
          statusCode: 400,
          code: 'REJECTION_EXPLANATION_REQUIRED',
          message: 'Vui lòng nhập nội dung giải thích khi chọn lý do loại là "Khác".'
        };
      }
    }

    const decisionId = 'hd-' + crypto.randomUUID();
    const historyId = 'csh-' + crypto.randomUUID();
    const consensusScore = data.consensusScore !== undefined && data.consensusScore !== null ? Number(data.consensusScore) : null;
    const nextAction = data.nextAction || (rawDecision === 'OFFER' ? 'PROCEED_TO_OFFER' : 'REJECT');
    const interviewId = data.interviewId || null;

    await this.db.transaction(async () => {
      if (await this.hasHiringDecisionsTable()) {
        const sql = this.db.provider === 'postgres'
          ? `
            INSERT INTO hiring_decisions (
              id, candidate_id, requisition_id, interview_id, decision, rejection_reason_id,
              reason_text, notes, consensus_score, next_action, decided_by, decided_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `
          : `
            INSERT INTO hiring_decisions (
              id, candidate_id, requisition_id, interview_id, decision, rejection_reason_id,
              reason_text, notes, consensus_score, next_action, decided_by, decided_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
          `;
        await this.db.prepare(sql).run(
          decisionId,
          candidate.id,
          candidate.requisition_id || null,
          interviewId,
          rawDecision,
          rejectionReasonId,
          reasonText,
          notes || null,
          consensusScore,
          nextAction,
          actor.id
        );
      }

      await this.db.prepare(`
        UPDATE candidates
        SET stage = ?,
            notes = COALESCE(?, notes),
            rejection_reason_id = ?
        WHERE id = ?
      `).run(targetStage, notes || null, rejectionReasonId, candidate.id);

      const action = rawDecision === 'OFFER' ? 'HIRING_DECISION_OFFER' : 'HIRING_DECISION_REJECT';
      const actorName = actor.fullName || actor.id;

      try {
        const insertHistorySql = this.db.provider === 'postgres'
          ? `
            INSERT INTO candidate_status_history (
              id, candidate_id, before_stage, after_stage, actor_id, actor_name, action,
              reason, notes, rejection_reason_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `
          : `
            INSERT INTO candidate_status_history (
              id, candidate_id, before_stage, after_stage, actor_id, actor_name, action,
              reason, notes, rejection_reason_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `;
        await this.db.prepare(insertHistorySql).run(
          historyId,
          candidate.id,
          candidate.stage,
          targetStage,
          actor.id,
          actorName,
          action,
          reasonText || (rawDecision === 'OFFER' ? 'Đạt phỏng vấn - Đề xuất offer' : null),
          notes || null,
          rejectionReasonId
        );
      } catch {}
    });

    return {
      success: true,
      statusCode: 200,
      message: 'Đã ghi nhận quyết định tuyển dụng thành công.',
      data: {
        id: decisionId,
        candidateId: candidate.id,
        stage: targetStage,
        decision: rawDecision,
        rejectionReasonId,
        reasonText,
        notes: notes || null,
        nextAction,
        decidedBy: actor.id,
        decidedByName: actor.fullName || actor.id,
        decidedAt: new Date().toISOString()
      }
    };
  }

  async getInterviewConsensus(interviewId, actor = null) {
    if (!interviewId || typeof interviewId !== 'string') {
      return { success: false, statusCode: 400, code: 'BAD_REQUEST', message: 'Mã phỏng vấn không hợp lệ.' };
    }

    const interview = await this.db.prepare(`
      SELECT i.id, i.candidate_id, i.requisition_id, i.interviewer_id, i.round_name, i.status,
             c.full_name AS candidate_name, c.stage AS candidate_stage
      FROM interviews i
      LEFT JOIN candidates c ON c.id = i.candidate_id
      WHERE i.id = ?
    `).get(interviewId.trim());

    if (!interview) {
      return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND', message: 'Không tìm thấy buổi phỏng vấn.' };
    }

    const evals = await this.db.prepare(`
      SELECT ev.id, ev.interviewer_id, ev.status, ev.recommendation, ev.general_notes,
             ev.total_score, ev.submitted_at, u.full_name AS interviewer_name, u.email AS interviewer_email
      FROM interview_evaluations ev
      LEFT JOIN users u ON u.id = ev.interviewer_id
      WHERE ev.interview_id = ?
      ORDER BY ev.created_at ASC
    `).all(interview.id);

    const submittedEvals = evals.filter(e => e.status === 'SUBMITTED');
    const totalScores = submittedEvals.map(e => Number(e.total_score)).filter(s => !isNaN(s) && s !== null);
    const averageScore = totalScores.length > 0
      ? Number((totalScores.reduce((s, x) => s + x, 0) / totalScores.length).toFixed(2))
      : null;

    const recommendationSummary = { RECOMMENDED: 0, CONSIDER: 0, NOT_RECOMMENDED: 0 };
    for (const ev of submittedEvals) {
      if (ev.recommendation && recommendationSummary[ev.recommendation] !== undefined) {
        recommendationSummary[ev.recommendation]++;
      }
    }

    let consensus = null;
    if (await this.hasHiringDecisionsTable()) {
      consensus = await this.db.prepare(`
        SELECT hd.*, u.full_name AS decided_by_name
        FROM hiring_decisions hd
        LEFT JOIN users u ON u.id = hd.decided_by
        WHERE hd.interview_id = ? OR hd.candidate_id = ?
        ORDER BY hd.decided_at DESC
        LIMIT 1
      `).get(interview.id, interview.candidate_id);
    }

    return {
      success: true,
      statusCode: 200,
      data: {
        interviewId: interview.id,
        candidateId: interview.candidate_id,
        candidateName: interview.candidate_name,
        candidateStage: interview.candidate_stage,
        roundName: interview.round_name,
        evaluations: evals,
        submittedCount: submittedEvals.length,
        averageScore,
        recommendationSummary,
        consensus: consensus ? {
          id: consensus.id,
          decision: consensus.decision,
          finalRecommendation: consensus.decision,
          consensusScore: consensus.consensus_score,
          consensusNotes: consensus.notes,
          nextAction: consensus.next_action,
          decidedBy: consensus.decided_by,
          decidedByName: consensus.decided_by_name,
          decidedAt: consensus.decided_at
        } : null
      }
    };
  }

  async recordInterviewConsensus(interviewId, data = {}, actor = null) {
    if (!interviewId || typeof interviewId !== 'string') {
      return { success: false, statusCode: 400, code: 'BAD_REQUEST', message: 'Mã phỏng vấn không hợp lệ.' };
    }

    const interview = await this.db.prepare(`
      SELECT id, candidate_id, requisition_id, interviewer_id
      FROM interviews
      WHERE id = ?
    `).get(interviewId.trim());

    if (!interview) {
      return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND', message: 'Không tìm thấy buổi phỏng vấn.' };
    }

    const roles = actor?.roles || [];
    const isLeadInterviewer = interview.interviewer_id && actor?.id && interview.interviewer_id === actor.id;
    const isAuthorized = roles.some(r => ['ADMIN', 'HR_MANAGER', 'HIRING_MGR', 'RECRUITER'].includes(r)) || isLeadInterviewer;

    if (!actor || !isAuthorized) {
      return {
        success: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền chốt kết quả hội đồng phỏng vấn này.'
      };
    }

    let submittedCount = 0;
    if (await this.hasEvaluationTables()) {
      const row = await this.db.prepare(`
        SELECT COUNT(id) AS count
        FROM interview_evaluations
        WHERE interview_id = ? AND status = 'SUBMITTED'
      `).get(interview.id);
      submittedCount = Number(row?.count || 0);
    }

    if (submittedCount === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'NO_SUBMITTED_EVALUATIONS',
        message: 'Chưa có phiếu đánh giá nào được nộp cho buổi phỏng vấn này.'
      };
    }

    const finalRecommendation = (data.finalRecommendation || data.decision || '').toUpperCase();
    if (!['PASS', 'REJECT', 'HOLD', 'OFFER'].includes(finalRecommendation)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_FINAL_RECOMMENDATION',
        message: 'Kết luận chung phải là PASS, REJECT hoặc HOLD.'
      };
    }

    const nextAction = (data.nextAction || '').toUpperCase();
    if (!['SCHEDULE_NEXT_ROUND', 'PROCEED_TO_OFFER', 'REJECT', 'CONSIDER'].includes(nextAction)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_NEXT_ACTION',
        message: 'Hành động tiếp theo không hợp lệ.'
      };
    }

    const consensusScore = data.consensusScore !== undefined && data.consensusScore !== null ? Number(data.consensusScore) : null;
    if (consensusScore !== null && (isNaN(consensusScore) || consensusScore < 1.0 || consensusScore > 5.0)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CONSENSUS_SCORE',
        message: 'Điểm đồng thuận phải từ 1.00 đến 5.00.'
      };
    }

    if ((finalRecommendation === 'PASS' || finalRecommendation === 'OFFER') && nextAction === 'PROCEED_TO_OFFER') {
      return this.recordHiringDecision(interview.candidate_id, {
        decision: 'OFFER',
        interviewId: interview.id,
        consensusScore,
        nextAction,
        notes: data.consensusNotes || data.notes
      }, actor);
    }

    if (finalRecommendation === 'REJECT' || nextAction === 'REJECT') {
      let rejectionReasonId = (data.rejectionReasonId || '').trim();
      if (!rejectionReasonId) {
        const defaultReason = await this.db.prepare("SELECT id FROM recruitment_catalog_items WHERE type='REJECTION_REASON' AND status='ACTIVE' LIMIT 1").get();
        if (defaultReason) rejectionReasonId = defaultReason.id;
      }
      return this.recordHiringDecision(interview.candidate_id, {
        decision: 'REJECT',
        interviewId: interview.id,
        rejectionReasonId,
        consensusScore,
        nextAction,
        notes: data.consensusNotes || data.notes
      }, actor);
    }

    const decisionId = 'hd-' + crypto.randomUUID();
    const notes = typeof data.consensusNotes === 'string' ? data.consensusNotes.trim() : '';

    if (await this.hasHiringDecisionsTable()) {
      const sql = this.db.provider === 'postgres'
        ? `
          INSERT INTO hiring_decisions (
            id, candidate_id, requisition_id, interview_id, decision, notes,
            consensus_score, next_action, decided_by, decided_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `
        : `
          INSERT INTO hiring_decisions (
            id, candidate_id, requisition_id, interview_id, decision, notes,
            consensus_score, next_action, decided_by, decided_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
        `;
      await this.db.prepare(sql).run(
        decisionId,
        interview.candidate_id,
        interview.requisition_id || null,
        interview.id,
        finalRecommendation,
        notes || null,
        consensusScore,
        nextAction,
        actor.id
      );
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Đã lưu kết quả đồng thuận phỏng vấn thành công.',
      data: {
        id: decisionId,
        interviewId: interview.id,
        candidateId: interview.candidate_id,
        finalRecommendation,
        consensusScore,
        nextAction,
        decidedBy: actor.id,
        decidedAt: new Date().toISOString()
      }
    };
  }
}

module.exports = HiringDecisionService;
