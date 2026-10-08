const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class CompetencyService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  async getFrameworks() {
    const frameworks = (await this.db.prepare(`
      SELECT
        id,
        code,
        name,
        description,
        status,
        created_at,
        updated_at
      FROM competency_frameworks
      ORDER BY name ASC
    `).all());

    return {
      success: true,
      total: frameworks.length,
      frameworks: (await Promise.all(frameworks.map(async row => (await this.mapFramework(row)))))
    };
  }

  async getFrameworkById(id) {
    if (!id) return null;

    const row = (await this.db.prepare(`
      SELECT
        id,
        code,
        name,
        description,
        status,
        created_at,
        updated_at
      FROM competency_frameworks
      WHERE id = ?
    `).get(id));

    if (!row) return null;

    return (await this.mapFramework(row));
  }

  async mapFramework(row) {
    const criteria = (await this.db.prepare(`
      SELECT
        id,
        name,
        description,
        weight,
        display_order
      FROM competency_criteria
      WHERE framework_id = ?
      ORDER BY display_order ASC, created_at ASC
    `).all(row.id));

    const jobTitles = (await this.db.prepare(`
      SELECT id, code, name, status
      FROM job_titles
      WHERE framework_id = ?
      ORDER BY name ASC
    `).all(row.id));

    const totalWeight = criteria.reduce(
      (sum, item) => sum + Number(item.weight || 0),
      0
    );

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description || '',
      status: row.status,
      totalWeight,
      criteria: criteria.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        weight: Number(item.weight),
        displayOrder: Number(item.display_order || 0)
      })),
      jobTitles: jobTitles.map(item => ({
        id: item.id,
        code: item.code,
        name: item.name,
        status: item.status
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  validateCriteria(criteria) {
    if (!Array.isArray(criteria) || criteria.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'COMPETENCY_CRITERIA_REQUIRED',
        message: 'Khung năng lực phải có ít nhất một tiêu chí đánh giá.'
      };
    }

    let totalWeight = 0;
    const criterionIds = new Set();

    for (const item of criteria) {
      if (!item || typeof item !== 'object' || (item.id && criterionIds.has(item.id))) {
        return { success: false, statusCode: 400, code: 'INVALID_COMPETENCY_CRITERIA', message: 'Tiêu chí không hợp lệ hoặc bị trùng mã.' };
      }
      if (item.id) criterionIds.add(item.id);
      const name =
        typeof item.name === 'string'
          ? item.name.trim()
          : '';

      const weight = Number(item.weight);

      if (!name) {
        return {
          success: false,
          statusCode: 400,
          code: 'COMPETENCY_CRITERION_NAME_REQUIRED',
          message: 'Tên tiêu chí đánh giá là bắt buộc.'
        };
      }

      if (
        !Number.isInteger(weight) ||
        weight <= 0 ||
        weight > 100
      ) {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_COMPETENCY_WEIGHT',
          message: 'Trọng số mỗi tiêu chí phải là số nguyên từ 1 đến 100.'
        };
      }

      totalWeight += weight;
    }

    if (totalWeight !== 100) {
      return {
        success: false,
        statusCode: 400,
        code: 'COMPETENCY_WEIGHT_TOTAL_INVALID',
        message: `Tổng trọng số của khung năng lực phải bằng 100%. Hiện tại là ${totalWeight}%.`,
        totalWeight
      };
    }

    return {
      success: true,
      totalWeight
    };
  }

  async createFramework(data = {}) {
    return this.db.transaction(async () => {
    const code =
      typeof data.code === 'string'
        ? data.code.trim().toUpperCase()
        : '';

    const name =
      typeof data.name === 'string'
        ? data.name.trim()
        : '';

    const description =
      typeof data.description === 'string'
        ? data.description.trim()
        : '';

    const criteria = Array.isArray(data.criteria)
      ? data.criteria
      : [];

    if (!code || !name) {
      return {
        success: false,
        statusCode: 400,
        code: 'COMPETENCY_FRAMEWORK_REQUIRED',
        message: 'Mã và tên khung năng lực là bắt buộc.'
      };
    }

    const validation = this.validateCriteria(criteria);
    if (!validation.success) return validation;

    const duplicate = (await this.db.prepare(`
      SELECT id
      FROM competency_frameworks
      WHERE code = ?
    `).get(code));

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'COMPETENCY_FRAMEWORK_CODE_EXISTS',
        message: 'Mã khung năng lực đã tồn tại.'
      };
    }

    const frameworkId =
      `cf-${crypto.randomUUID()}`;

    (await this.db.exec('BEGIN'));

    try {
      (await this.db.prepare(`
        INSERT INTO competency_frameworks (
          id,
          code,
          name,
          description,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, 'ACTIVE',
          datetime('now'),
          datetime('now')
        )
      `).run(
        frameworkId,
        code,
        name,
        description || null
      ));

      const insertCriterion = this.db.prepare(`
        INSERT INTO competency_criteria (
          id,
          framework_id,
          name,
          description,
          weight,
          display_order,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          datetime('now'),
          datetime('now')
        )
      `);

      (await Promise.all(criteria.map(async (item, index) => {
        (await insertCriterion.run(
          `cc-${crypto.randomUUID()}`,
          frameworkId,
          item.name.trim(),
          typeof item.description === 'string'
            ? item.description.trim() || null
            : null,
          Number(item.weight),
          index + 1
        ));
      })));

      (await this.db.exec('COMMIT'));
    } catch (error) {
      (await this.db.exec('ROLLBACK'));
      throw error;
    }

    return {
      success: true,
      statusCode: 201,
      message: 'Tạo khung năng lực thành công.',
      data: (await this.getFrameworkById(frameworkId))
    };

    });
  }

  async updateFramework(id, data = {}) {
    return this.db.transaction(async () => {
    if (['code', 'name'].some(key => Object.hasOwn(data, key) && (typeof data[key] !== 'string' || !data[key].trim())) ||
        (Object.hasOwn(data, 'criteria') && !Array.isArray(data.criteria))) {
      return { success: false, statusCode: 400, code: 'INVALID_COMPETENCY_FRAMEWORK', message: 'Mã, tên và danh sách tiêu chí không hợp lệ.' };
    }
    const current = (await this.getFrameworkById(id));

    if (!current) {
      return {
        success: false,
        statusCode: 404,
        code: 'COMPETENCY_FRAMEWORK_NOT_FOUND',
        message: 'Không tìm thấy khung năng lực.'
      };
    }

    const code =
      typeof data.code === 'string' && data.code.trim()
        ? data.code.trim().toUpperCase()
        : current.code;

    const name =
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : current.name;

    const description =
      typeof data.description === 'string'
        ? data.description.trim()
        : current.description;

    const criteria = Array.isArray(data.criteria)
      ? data.criteria
      : current.criteria;

    const validation = this.validateCriteria(criteria);
    if (!validation.success) return validation;

    const duplicate = (await this.db.prepare(`
      SELECT id
      FROM competency_frameworks
      WHERE code = ? AND id <> ?
    `).get(code, id));

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'COMPETENCY_FRAMEWORK_CODE_EXISTS',
        message: 'Mã khung năng lực đã tồn tại.'
      };
    }

    const existingIds = (await this.db.prepare('SELECT id FROM competency_criteria WHERE framework_id = ?').all(id)).map(row => row.id);
    if (criteria.some(item => item.id && !existingIds.includes(item.id))) {
      return { success: false, statusCode: 400, code: 'INVALID_COMPETENCY_CRITERION', message: 'Tiêu chí không thuộc khung năng lực này.' };
    }
    for (const criterionId of existingIds.filter(value => !criteria.some(item => item.id === value))) {
      if ((await this.db.prepare('SELECT 1 FROM interview_questions WHERE criterion_id = ? LIMIT 1').get(criterionId))) {
        return { success: false, statusCode: 409, code: 'COMPETENCY_CRITERION_IN_USE', message: 'Tiêu chí đang có câu hỏi phỏng vấn nên không thể xóa.' };
      }
    }
    (await this.db.exec('BEGIN'));

    try {
      (await this.db.prepare(`
        UPDATE competency_frameworks
        SET
          code = ?,
          name = ?,
          description = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        code,
        name,
        description || null,
        id
      ));

      const existingCriteria = (await this.db.prepare(`
        SELECT id, description
        FROM competency_criteria
        WHERE framework_id = ?
      `).all(id));

      const existingById = new Map(
        existingCriteria.map(item => [item.id, item])
      );

      const retainedIds = new Set();

      const updateCriterion = this.db.prepare(`
        UPDATE competency_criteria
        SET
          name = ?,
          description = ?,
          weight = ?,
          display_order = ?,
          updated_at = datetime('now')
        WHERE id = ? AND framework_id = ?
      `);

      const insertCriterion = this.db.prepare(`
        INSERT INTO competency_criteria (
          id,
          framework_id,
          name,
          description,
          weight,
          display_order,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          datetime('now'),
          datetime('now')
        )
      `);

      (await Promise.all(criteria.map(async (item, index) => {
        const requestedId =
          typeof item.id === 'string'
            ? item.id.trim()
            : '';

        const existingCriterion = requestedId
          ? existingById.get(requestedId)
          : null;

        const description =
          typeof item.description === 'string'
            ? item.description.trim() || null
            : (
                existingCriterion
                  ? existingCriterion.description
                  : null
              );

        if (existingCriterion) {
          (await updateCriterion.run(
            item.name.trim(),
            description,
            Number(item.weight),
            index + 1,
            requestedId,
            id
          ));

          retainedIds.add(requestedId);
          return;
        }

        const newCriterionId =
          `cc-${crypto.randomUUID()}`;

        (await insertCriterion.run(
          newCriterionId,
          id,
          item.name.trim(),
          description,
          Number(item.weight),
          index + 1
        ));

        retainedIds.add(newCriterionId);
      })));

      const deleteCriterion = this.db.prepare(`
        DELETE FROM competency_criteria
        WHERE id = ? AND framework_id = ?
      `);

      (await Promise.all(existingCriteria
        .filter(item => !retainedIds.has(item.id))
        .map(async item => {
          (await deleteCriterion.run(item.id, id));
        })));

      (await this.db.exec('COMMIT'));
    } catch (error) {
      (await this.db.exec('ROLLBACK'));
      throw error;
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật khung năng lực thành công.',
      data: (await this.getFrameworkById(id))
    };

    });
  }

  async getJobTitles({ includeSalary = false } = {}) {
    const rows = (await this.db.prepare(`
      SELECT jt.*, cf.code AS framework_code, cf.name AS framework_name
      FROM job_titles jt
      LEFT JOIN competency_frameworks cf ON jt.framework_id = cf.id
      ORDER BY jt.name ASC
    `).all());
    return {
      success: true, total: rows.length, canViewSalary: includeSalary,
      jobTitles: rows.map(row => ({
        id: row.id, code: row.code, name: row.name, level: row.level || '', status: row.status,
        framework: row.framework_id ? { id: row.framework_id, code: row.framework_code, name: row.framework_name } : null,
        ...(includeSalary ? { minSalary: row.min_salary, maxSalary: row.max_salary } : {})
      }))
    };
  }

  async validateJobTitle(data, current = null) {
    const text = (key, fallback = '') => Object.hasOwn(data, key)
      ? (typeof data[key] === 'string' ? data[key].trim() : '') : fallback;
    const code = text('code', current?.code).toUpperCase();
    const name = text('name', current?.name);
    const level = text('level', current?.level || '');
    const frameworkId = text('frameworkId', current?.framework_id || '');
    const minSalary = Object.hasOwn(data, 'minSalary') ? data.minSalary : current?.min_salary;
    const maxSalary = Object.hasOwn(data, 'maxSalary') ? data.maxSalary : current?.max_salary;
    const error = (code, message) => ({ success: false, statusCode: 400, code, message });
    if (!code || !name || (!current && !level) || (Object.hasOwn(data, 'level') && !level)) {
      return error('JOB_TITLE_REQUIRED', 'Mã, tên và cấp bậc chức danh là bắt buộc.');
    }
    const changingSalary = Object.hasOwn(data, 'minSalary') || Object.hasOwn(data, 'maxSalary');
    if (!current || changingSalary) {
      const valid = value => (typeof value === 'number' || typeof value === 'string') &&
        String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
      if (!valid(minSalary) || !valid(maxSalary) || Number(minSalary) > Number(maxSalary)) {
        return error('INVALID_SALARY_RANGE', 'Lương tối thiểu và tối đa phải là số nguyên không âm; tối thiểu không vượt tối đa.');
      }
    }
    if (frameworkId && (!current || frameworkId !== current.framework_id)) {
      const framework = (await this.getFrameworkById(frameworkId));
      if (!framework || framework.status !== 'ACTIVE' || framework.totalWeight !== 100) {
        return error('INVALID_COMPETENCY_FRAMEWORK', 'Khung năng lực phải đang áp dụng và có tổng trọng số 100%.');
      }
    }
    const duplicate = (await this.db.prepare('SELECT id FROM job_titles WHERE code = ? AND id <> ?').get(code, current?.id || ''));
    if (duplicate) return { success: false, statusCode: 409, code: 'JOB_TITLE_CODE_EXISTS', message: 'Mã chức danh đã tồn tại.' };
    return { success: true, code, name, level, frameworkId, minSalary: minSalary == null ? null : Number(minSalary), maxSalary: maxSalary == null ? null : Number(maxSalary) };
  }

  async createJobTitle(data = {}, options = {}) {
    const value = (await this.validateJobTitle(data));
    if (!value.success) return value;
    const id = 'jt-' + crypto.randomUUID();
    (await this.db.prepare(`
      INSERT INTO job_titles (id, code, name, level, min_salary, max_salary, framework_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(id, value.code, value.name, value.level, value.minSalary, value.maxSalary, value.frameworkId || null));
    return { success: true, statusCode: 201, message: 'Tạo chức danh thành công.', data: (await this.getJobTitles(options)).jobTitles.find(item => item.id === id) };
  }

  async updateJobTitle(id, data = {}, options = {}) {
    const current = (await this.db.prepare('SELECT * FROM job_titles WHERE id = ?').get(id));
    if (!current) return { success: false, statusCode: 404, code: 'JOB_TITLE_NOT_FOUND', message: 'Không tìm thấy chức danh.' };
    const value = (await this.validateJobTitle(data, current));
    if (!value.success) return value;
    (await this.db.prepare(`
      UPDATE job_titles SET code = ?, name = ?, level = ?, min_salary = ?, max_salary = ?,
        framework_id = ?, updated_at = datetime('now') WHERE id = ?
    `).run(value.code, value.name, value.level || null, value.minSalary, value.maxSalary, value.frameworkId || null, id));
    return { success: true, statusCode: 200, message: 'Cập nhật chức danh thành công.', data: (await this.getJobTitles(options)).jobTitles.find(item => item.id === id) };
  }

  async getFrameworkForJobTitle(jobTitleId) {
    const jobTitle = (await this.db.prepare(`
      SELECT id, code, name, framework_id, status
      FROM job_titles
      WHERE id = ?
    `).get(jobTitleId));

    if (!jobTitle) {
      return {
        success: false,
        statusCode: 404,
        code: 'JOB_TITLE_NOT_FOUND',
        message: 'Không tìm thấy chức danh.'
      };
    }

    const framework = jobTitle.framework_id
      ? (await this.getFrameworkById(jobTitle.framework_id))
      : null;

    return {
      success: true,
      data: {
        jobTitle: {
          id: jobTitle.id,
          code: jobTitle.code,
          name: jobTitle.name,
          status: jobTitle.status
        },
        framework
      }
    };
  }
}

module.exports = CompetencyService;
