const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class QuestionBankService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  getQuestions(options = {}) {
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

    const rows = this.db.prepare(`
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
    `).all(...params);

    return {
      success: true,
      total: rows.length,
      questions: rows.map(row =>
        this.mapQuestion(row)
      )
    };
  }

  getFilterOptions() {
    const jobTitles = this.db.prepare(`
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
    `).all().map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      frameworkId: row.framework_id,
      frameworkName: row.framework_name
    }));

    const criteria = this.db.prepare(`
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
    `).all().map(row => ({
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

  getQuestionById(id) {
    if (!id) return null;

    const row = this.db.prepare(`
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
    `).get(id);

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

  getCriterion(criterionId) {
    if (!criterionId) return null;

    return this.db.prepare(`
      SELECT
        cc.id,
        cc.name,
        cc.framework_id,
        cf.status AS framework_status
      FROM competency_criteria cc
      JOIN competency_frameworks cf
        ON cc.framework_id = cf.id
      WHERE cc.id = ?
    `).get(criterionId);
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

  createQuestion(data = {}) {
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
      this.getCriterion(criterionId);

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

    this.db.prepare(`
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
    );

    return {
      success: true,
      statusCode: 201,
      message:
        'Tạo câu hỏi phỏng vấn thành công.',
      data: this.getQuestionById(id)
    };
  }

  updateQuestion(id, data = {}) {
    if (['criterionId', 'questionText', 'goodAnswerHint'].some(key => Object.hasOwn(data, key) && (typeof data[key] !== 'string' || !data[key].trim()))) {
      return { success: false, statusCode: 400, code: 'INTERVIEW_QUESTION_REQUIRED', message: 'Tiêu chí, câu hỏi và gợi ý trả lời không hợp lệ.' };
    }
    const current =
      this.getQuestionById(id);

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
      this.getCriterion(criterionId);

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

    this.db.prepare(`
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
    );

    return {
      success: true,
      statusCode: 200,
      message:
        'Cập nhật câu hỏi phỏng vấn thành công.',
      data: this.getQuestionById(id)
    };
  }
}

module.exports = QuestionBankService;
