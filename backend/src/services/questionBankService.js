const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class QuestionBankService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  async getQuestions(options = {}) {
    const search =
      typeof options.search === 'string'
        ? options.search.trim()
        : '';

    const jobTitleId =
      typeof options.jobTitleId === 'string'
        ? options.jobTitleId.trim()
        : '';

    const criterionId =
      typeof options.criterionId === 'string'
        ? options.criterionId.trim()
        : '';

    const difficulty =
      typeof options.difficulty === 'string'
        ? options.difficulty.trim().toUpperCase()
        : 'ALL';

    const status =
      typeof options.status === 'string'
        ? options.status.trim().toUpperCase()
        : 'ALL';

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push(`
        (
          iq.question_text LIKE ?
          OR iq.good_answer_hint LIKE ?
          OR cc.name LIKE ?
          OR cf.name LIKE ?
        )
      `);

      const pattern = `%${search}%`;
      params.push(
        pattern,
        pattern,
        pattern,
        pattern
      );
    }

    if (jobTitleId) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM job_titles jt
          WHERE jt.id = ?
            AND jt.framework_id = cc.framework_id
        )
      `);

      params.push(jobTitleId);
    }

    if (criterionId) {
      conditions.push('iq.criterion_id = ?');
      params.push(criterionId);
    }

    if (
      difficulty &&
      difficulty !== 'ALL'
    ) {
      conditions.push('iq.difficulty = ?');
      params.push(difficulty);
    }

    if (status && status !== 'ALL') {
      conditions.push('iq.status = ?');
      params.push(status);
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

    const rows = (await this.db.prepare(`
      SELECT
        iq.id,
        iq.criterion_id,
        iq.question_text,
        iq.difficulty,
        iq.good_answer_hint,
        iq.status,
        iq.created_at,
        iq.updated_at,
        cc.name AS criterion_name,
        cc.framework_id,
        cf.code AS framework_code,
        cf.name AS framework_name
      FROM interview_questions iq
      JOIN competency_criteria cc
        ON iq.criterion_id = cc.id
      JOIN competency_frameworks cf
        ON cc.framework_id = cf.id
      ${whereClause}
      ORDER BY
        cf.name ASC,
        cc.display_order ASC,
        iq.created_at DESC
    `).all(...params));

    return {
      success: true,
      total: rows.length,
      questions: rows.map(row =>
        this.mapQuestion(row)
      )
    };
  }

  async getFilterOptions() {
    const jobTitles = (await this.db.prepare(`
      SELECT
        jt.id,
        jt.code,
        jt.name,
        jt.framework_id,
        cf.name AS framework_name
      FROM job_titles jt
      JOIN competency_frameworks cf
        ON jt.framework_id = cf.id
      WHERE jt.status = 'ACTIVE'
        AND cf.status = 'ACTIVE'
      ORDER BY jt.name COLLATE NOCASE ASC
    `).all()).map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      frameworkId: row.framework_id,
      frameworkName: row.framework_name
    }));

    const criteria = (await this.db.prepare(`
      SELECT
        cc.id,
        cc.name,
        cc.framework_id,
        cc.display_order,
        cf.code AS framework_code,
        cf.name AS framework_name
      FROM competency_criteria cc
      JOIN competency_frameworks cf
        ON cc.framework_id = cf.id
      WHERE cf.status = 'ACTIVE'
      ORDER BY
        cf.name COLLATE NOCASE ASC,
        cc.display_order ASC,
        cc.name COLLATE NOCASE ASC
    `).all()).map(row => ({
      id: row.id,
      name: row.name,
      frameworkId: row.framework_id,
      frameworkCode: row.framework_code,
      frameworkName: row.framework_name
    }));

    return {
      success: true,
      jobTitles,
      criteria
    };
  }

  async getQuestionById(id) {
    if (!id) return null;

    const row = (await this.db.prepare(`
      SELECT
        iq.id,
        iq.criterion_id,
        iq.question_text,
        iq.difficulty,
        iq.good_answer_hint,
        iq.status,
        iq.created_at,
        iq.updated_at,
        cc.name AS criterion_name,
        cc.framework_id,
        cf.code AS framework_code,
        cf.name AS framework_name
      FROM interview_questions iq
      JOIN competency_criteria cc
        ON iq.criterion_id = cc.id
      JOIN competency_frameworks cf
        ON cc.framework_id = cf.id
      WHERE iq.id = ?
    `).get(id));

    return row
      ? this.mapQuestion(row)
      : null;
  }

  mapQuestion(row) {
    return {
      id: row.id,
      questionText: row.question_text,
      difficulty: row.difficulty,
      goodAnswerHint: row.good_answer_hint,
      status: row.status,
      criterion: {
        id: row.criterion_id,
        name: row.criterion_name
      },
      framework: {
        id: row.framework_id,
        code: row.framework_code,
        name: row.framework_name
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getCriterion(criterionId) {
    if (!criterionId) return null;

    return (await this.db.prepare(`
      SELECT
        cc.id,
        cc.name,
        cc.framework_id,
        cf.status AS framework_status
      FROM competency_criteria cc
      JOIN competency_frameworks cf
        ON cc.framework_id = cf.id
      WHERE cc.id = ?
    `).get(criterionId));
  }

  validateDifficulty(value) {
    const difficulty =
      typeof value === 'string'
        ? value.trim().toUpperCase()
        : '';

    if (
      !['EASY', 'MEDIUM', 'HARD']
        .includes(difficulty)
    ) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_QUESTION_DIFFICULTY',
        message:
          'Mức độ khó phải là EASY, MEDIUM hoặc HARD.'
      };
    }

    return {
      success: true,
      difficulty
    };
  }

  async createQuestion(data = {}) {
    const criterionId =
      typeof data.criterionId === 'string'
        ? data.criterionId.trim()
        : '';

    const questionText =
      typeof data.questionText === 'string'
        ? data.questionText.trim()
        : '';

    const goodAnswerHint =
      typeof data.goodAnswerHint === 'string'
        ? data.goodAnswerHint.trim()
        : '';

    if (
      !criterionId ||
      !questionText ||
      !goodAnswerHint
    ) {
      return {
        success: false,
        statusCode: 400,
        code: 'INTERVIEW_QUESTION_REQUIRED',
        message:
          'Tiêu chí, nội dung câu hỏi và gợi ý câu trả lời tốt là bắt buộc.'
      };
    }

    const difficultyValidation =
      this.validateDifficulty(
        data.difficulty
      );

    if (!difficultyValidation.success) {
      return difficultyValidation;
    }

    const criterion =
      (await this.getCriterion(criterionId));

    if (!criterion) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_COMPETENCY_CRITERION',
        message:
          'Tiêu chí năng lực không tồn tại.'
      };
    }

    if (
      criterion.framework_status !== 'ACTIVE'
    ) {
      return {
        success: false,
        statusCode: 400,
        code: 'COMPETENCY_FRAMEWORK_INACTIVE',
        message:
          'Khung năng lực của tiêu chí đã ngừng áp dụng.'
      };
    }

    const id =
      `iq-${crypto.randomUUID()}`;

    (await this.db.prepare(`
      INSERT INTO interview_questions (
        id,
        criterion_id,
        question_text,
        difficulty,
        good_answer_hint,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?,
        'ACTIVE',
        datetime('now'),
        datetime('now')
      )
    `).run(
      id,
      criterionId,
      questionText,
      difficultyValidation.difficulty,
      goodAnswerHint
    ));

    return {
      success: true,
      statusCode: 201,
      message:
        'Tạo câu hỏi phỏng vấn thành công.',
      data: (await this.getQuestionById(id))
    };
  }

  async updateQuestion(id, data = {}) {
    if (['criterionId', 'questionText', 'goodAnswerHint'].some(key => Object.hasOwn(data, key) && (typeof data[key] !== 'string' || !data[key].trim()))) {
      return { success: false, statusCode: 400, code: 'INTERVIEW_QUESTION_REQUIRED', message: 'Tiêu chí, câu hỏi và gợi ý trả lời không hợp lệ.' };
    }
    const current =
      (await this.getQuestionById(id));

    if (!current) {
      return {
        success: false,
        statusCode: 404,
        code: 'INTERVIEW_QUESTION_NOT_FOUND',
        message:
          'Không tìm thấy câu hỏi phỏng vấn.'
      };
    }

    const criterionId =
      typeof data.criterionId === 'string'
        ? data.criterionId.trim()
        : current.criterion.id;

    const questionText =
      typeof data.questionText === 'string'
        ? data.questionText.trim()
        : current.questionText;

    const goodAnswerHint =
      typeof data.goodAnswerHint === 'string'
        ? data.goodAnswerHint.trim()
        : current.goodAnswerHint;

    if (!criterionId || !questionText || !goodAnswerHint) {
      return { success: false, statusCode: 400, code: 'INTERVIEW_QUESTION_REQUIRED', message: 'Tiêu chí, câu hỏi và gợi ý trả lời là bắt buộc.' };
    }
    const difficultyValidation =
      this.validateDifficulty(
        Object.hasOwn(data, 'difficulty') ? data.difficulty : current.difficulty
      );

    if (!difficultyValidation.success) {
      return difficultyValidation;
    }

    const criterion =
      (await this.getCriterion(criterionId));

    if (!criterion) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_COMPETENCY_CRITERION',
        message:
          'Tiêu chí năng lực không tồn tại.'
      };
    }

    if (criterionId !== current.criterion.id && criterion.framework_status !== 'ACTIVE') {
      return { success: false, statusCode: 400, code: 'COMPETENCY_FRAMEWORK_INACTIVE', message: 'Khung năng lực đã ngừng áp dụng.' };
    }
    const requestedStatus =
      typeof data.status === 'string'
        ? data.status.trim().toUpperCase()
        : current.status;

    if (
      !['ACTIVE', 'INACTIVE']
        .includes(requestedStatus)
    ) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_QUESTION_STATUS',
        message:
          'Trạng thái câu hỏi không hợp lệ.'
      };
    }

    (await this.db.prepare(`
      UPDATE interview_questions
      SET
        criterion_id = ?,
        question_text = ?,
        difficulty = ?,
        good_answer_hint = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      criterionId,
      questionText,
      difficultyValidation.difficulty,
      goodAnswerHint,
      requestedStatus,
      id
    ));

    return {
      success: true,
      statusCode: 200,
      message:
        'Cập nhật câu hỏi phỏng vấn thành công.',
      data: (await this.getQuestionById(id))
    };
  }

  async hasAskedQuestionsTable() {
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_name = 'interview_asked_questions'").get();
        return Boolean(row);
      }
      const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_asked_questions'").get();
      return Boolean(row);
    } catch {
      return false;
    }
  }

  async ensureAskedQuestionsTable() {
    if (await this.hasAskedQuestionsTable()) return;
    try {
      if (this.db.provider === 'postgres') {
        await this.db.exec(`
          CREATE TABLE IF NOT EXISTS interview_asked_questions (
            id TEXT PRIMARY KEY,
            interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
            asked_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            asked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_interview_asked_questions UNIQUE(interview_id, question_id)
          );
          CREATE INDEX IF NOT EXISTS idx_asked_questions_int ON interview_asked_questions(interview_id);
          CREATE INDEX IF NOT EXISTS idx_asked_questions_q ON interview_asked_questions(question_id);
        `);
      } else {
        await this.db.exec(`
          CREATE TABLE IF NOT EXISTS interview_asked_questions (
            id TEXT PRIMARY KEY,
            interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
            asked_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            asked_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(interview_id, question_id)
          );
          CREATE INDEX IF NOT EXISTS idx_asked_questions_int ON interview_asked_questions(interview_id);
          CREATE INDEX IF NOT EXISTS idx_asked_questions_q ON interview_asked_questions(question_id);
        `);
      }
    } catch {}
  }

  async getSuggestedQuestionsForInterview(interviewId, options = {}, actor = null) {
    const access=await require('./interviewScopeService').authorizeInterview(this.db,interviewId,actor,'interview.read');if(!access.success)return access;actor=access.actor;
    if (!interviewId) {
      return { success: false, statusCode: 400, code: 'INTERVIEW_ID_REQUIRED', message: 'Mã phỏng vấn không được để trống.' };
    }
    const interview = await this.db.prepare(`
      SELECT
        i.id,
        i.candidate_id,
        i.requisition_id,
        i.interviewer_id,
        i.round_name,
        i.scheduled_time,
        i.status,
        c.requisition_id AS cand_requisition_id,
        COALESCE(i.requisition_id, c.requisition_id) AS effective_requisition_id,
        r.job_title_id,
        r.title AS requisition_title,
        jt.name AS job_title_name,
        jt.framework_id,
        cf.name AS framework_name
      FROM interviews i
      LEFT JOIN candidates c ON c.id = i.candidate_id
      LEFT JOIN requisitions r ON r.id = COALESCE(i.requisition_id, c.requisition_id)
      LEFT JOIN job_titles jt ON jt.id = r.job_title_id
      LEFT JOIN competency_frameworks cf ON cf.id = jt.framework_id
      WHERE i.id = ?
    `).get(interviewId);

    if (!interview) {
      return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND', message: 'Không tìm thấy buổi phỏng vấn.' };
    }

    if (actor) {
      const isPrivileged = actor.roles && actor.roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r));
      if (!isPrivileged) {
        let isAssigned = interview.interviewer_id === actor.id;
        if (!isAssigned) {
          try {
            const row = await this.db.prepare('SELECT user_id FROM interview_interviewers WHERE interview_id = ? AND user_id = ?').get(interviewId, actor.id);
            isAssigned = Boolean(row);
          } catch {}
        }
        if (!isAssigned) {
          return { success: false, statusCode: 403, code: 'INTERVIEW_ACCESS_DENIED', message: 'Bạn không có quyền trong phiên phỏng vấn này.' };
        }
      }
    }

    await this.ensureAskedQuestionsTable();

    let frameworkId = interview.framework_id;
    let criteriaIds = [];
    try {
      const evalRow = await this.db.prepare('SELECT snapshot_criteria FROM interview_evaluations WHERE interview_id = ? LIMIT 1').get(interviewId);
      if (evalRow?.snapshot_criteria) {
        const parsed = JSON.parse(evalRow.snapshot_criteria);
        if (Array.isArray(parsed)) criteriaIds = parsed.map(c => c.id).filter(Boolean);
      }
    } catch {}

    const conditions = ["iq.status = 'ACTIVE'"];
    const params = [];

    if (options.criterionId) {
      conditions.push('iq.criterion_id = ?');
      params.push(options.criterionId);
    } else if (frameworkId) {
      conditions.push('cc.framework_id = ?');
      params.push(frameworkId);
    } else if (criteriaIds.length > 0) {
      conditions.push(`iq.criterion_id IN (${criteriaIds.map(() => '?').join(', ')})`);
      params.push(...criteriaIds);
    } else if (interview.job_title_id) {
      conditions.push('EXISTS (SELECT 1 FROM job_titles jt WHERE jt.id = ? AND jt.framework_id = cc.framework_id)');
      params.push(interview.job_title_id);
    }

    if (options.difficulty && options.difficulty !== 'ALL') {
      conditions.push('iq.difficulty = ?');
      params.push(options.difficulty.toUpperCase());
    }

    if (options.search && typeof options.search === 'string' && options.search.trim()) {
      const p = `%${options.search.trim()}%`;
      conditions.push('(iq.question_text LIKE ? OR iq.good_answer_hint LIKE ? OR cc.name LIKE ?)');
      params.push(p, p, p);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const questions = await this.db.prepare(`
      SELECT
        iq.id,
        iq.criterion_id,
        iq.question_text,
        iq.difficulty,
        iq.good_answer_hint,
        iq.status,
        cc.name AS criterion_name,
        cc.weight AS criterion_weight,
        cc.display_order AS criterion_display_order,
        cc.framework_id,
        cf.name AS framework_name
      FROM interview_questions iq
      JOIN competency_criteria cc ON iq.criterion_id = cc.id
      JOIN competency_frameworks cf ON cc.framework_id = cf.id
      ${whereClause}
      ORDER BY cc.display_order ASC, iq.difficulty ASC, iq.created_at ASC
    `).all(...params);

    let currentAskedQuestionIds = new Set();
    try {
      const rows = await this.db.prepare('SELECT question_id FROM interview_asked_questions WHERE interview_id = ?').all(interviewId);
      currentAskedQuestionIds = new Set((rows || []).map(r => r.question_id));
    } catch {}

    const previousAskedMap = new Map();
    try {
      const prevInterviews = await this.db.prepare(`
        SELECT i.id, i.round_name, i.scheduled_time
        FROM interviews i
        WHERE i.candidate_id = ?
          AND COALESCE(i.requisition_id, ?) = ?
          AND i.id != ?
          AND i.status != 'CANCELLED'
        ORDER BY i.scheduled_time ASC, i.created_at ASC
      `).all(interview.candidate_id, interview.effective_requisition_id, interview.effective_requisition_id, interviewId);

      if (prevInterviews && prevInterviews.length > 0) {
        for (const prev of prevInterviews) {
          const askedRows = await this.db.prepare('SELECT question_id FROM interview_asked_questions WHERE interview_id = ?').all(prev.id);
          for (const ar of (askedRows || [])) {
            if (!previousAskedMap.has(ar.question_id)) {
              previousAskedMap.set(ar.question_id, prev.round_name || 'Vòng trước');
            }
          }
        }
      }
    } catch {}

    const suggested = (questions || []).map(q => {
      const isAskedInCurrentRound = currentAskedQuestionIds.has(q.id);
      const isAskedInPreviousRound = previousAskedMap.has(q.id);
      const previousRoundName = isAskedInPreviousRound ? previousAskedMap.get(q.id) : null;

      return {
        id: q.id,
        questionText: q.question_text,
        criterionId: q.criterion_id,
        criterionName: q.criterion_name,
        category: q.criterion_name,
        goodAnswerHint: q.good_answer_hint,
        difficultyLevel: q.difficulty,
        difficulty: q.difficulty,
        isAskedInCurrentRound,
        isAskedInPreviousRound,
        previousRoundName,
        frameworkId: q.framework_id,
        frameworkName: q.framework_name
      };
    });

    return {
      success: true,
      statusCode: 200,
      interviewId,
      candidateId: interview.candidate_id,
      requisitionId: interview.effective_requisition_id,
      jobTitleId: interview.job_title_id || null,
      jobTitleName: interview.job_title_name || null,
      frameworkId: interview.framework_id || null,
      frameworkName: interview.framework_name || null,
      questions: suggested,
      data: suggested
    };
  }

  async toggleAskedQuestion(interviewId, questionId, actor = null) {
    return this.db.transaction(()=>this.#toggleAskedQuestion(interviewId,questionId,actor));
  }

  async #toggleAskedQuestion(interviewId,questionId,actor) {
    const access=await require('./interviewScopeService').authorizeInterview(this.db,interviewId,actor,'interview.read');if(!access.success)return access;actor=access.actor;
    if (!interviewId || !questionId) {
      return { success: false, statusCode: 400, code: 'PARAMS_REQUIRED', message: 'Mã phỏng vấn và câu hỏi không được để trống.' };
    }
    const interview = await this.db.prepare('SELECT id, interviewer_id FROM interviews WHERE id = ?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(interviewId);
    if (!interview) {
      return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND', message: 'Không tìm thấy buổi phỏng vấn.' };
    }

    if (actor) {
      const isPrivileged = actor.roles && actor.roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r));
      if (!isPrivileged) {
        let isAssigned = interview.interviewer_id === actor.id;
        if (!isAssigned) {
          try {
            const row = await this.db.prepare('SELECT user_id FROM interview_interviewers WHERE interview_id = ? AND user_id = ?').get(interviewId, actor.id);
            isAssigned = Boolean(row);
          } catch {}
        }
        if (!isAssigned) {
          return { success: false, statusCode: 403, code: 'INTERVIEW_ACCESS_DENIED', message: 'Bạn không có quyền trong phiên phỏng vấn này.' };
        }
      }
    }

    const question = await this.db.prepare('SELECT id FROM interview_questions WHERE id = ?').get(questionId);
    if (!question) {
      return { success: false, statusCode: 404, code: 'QUESTION_NOT_FOUND', message: 'Không tìm thấy câu hỏi.' };
    }

    await this.ensureAskedQuestionsTable();

    const existing = await this.db.prepare('SELECT id FROM interview_asked_questions WHERE interview_id = ? AND question_id = ?').get(interviewId, questionId);
    if (existing) {
      await this.db.prepare('DELETE FROM interview_asked_questions WHERE interview_id = ? AND question_id = ?').run(interviewId, questionId);
      return {
        success: true,
        statusCode: 200,
        interviewId,
        questionId,
        asked: false,
        isAskedInCurrentRound: false
      };
    } else {
      const rowId = 'iaq-' + crypto.randomUUID();
      const askedBy = actor?.id || interview.interviewer_id || 'system';
      if (this.db.provider === 'postgres') {
        await this.db.prepare(`
          INSERT INTO interview_asked_questions (id, interview_id, question_id, asked_by, asked_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(rowId, interviewId, questionId, askedBy);
      } else {
        await this.db.prepare(`
          INSERT INTO interview_asked_questions (id, interview_id, question_id, asked_by, asked_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(rowId, interviewId, questionId, askedBy);
      }
      return {
        success: true,
        statusCode: 200,
        interviewId,
        questionId,
        asked: true,
        isAskedInCurrentRound: true
      };
    }
  }
}

module.exports = QuestionBankService;
