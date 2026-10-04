const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class RequisitionService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  /**
   * Get all requisitions with recruiter and hiring manager details
   */
  getRequisitions(options = {}) {
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const status = typeof options.status === 'string' ? options.status.trim() : 'ALL';
    const handoverOnly = options.handoverOnly === true || options.handoverOnly === 'true';

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(r.title LIKE ? OR r.code LIKE ? OR r.department_name LIKE ?)');
      const p = `%${search}%`;
      params.push(p, p, p);
    }

    if (status && status !== 'ALL') {
      conditions.push('r.status = ?');
      params.push(status);
    }

    if (handoverOnly) {
      conditions.push('r.handover_required = 1');
    }
    if (options.viewerId) {
      conditions.push("(r.s210_version = 0 OR r.status <> 'DRAFT' OR r.created_by = ?)");
      params.push(options.viewerId);
    }
    if (options.canReadS210 === false) conditions.push('r.s210_version = 0');

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = this.db.prepare(`
      SELECT 
        r.id,
        r.code,
        r.title,
        r.job_title_id,
        r.department_id,
        r.department_name,
        r.work_location_id,
        r.work_mode_id,
        r.headcount,
        r.s210_version, r.created_by, r.recruitment_reason,
        r.proposed_salary_min, r.proposed_salary_max, r.needed_date,
        r.job_description, r.candidate_requirements, r.salary_justification,
        r.status,
        r.handover_required,
        r.handover_notes,
        r.created_at,
        r.updated_at,
        hm.id AS hiring_manager_id,
        hm.full_name AS hiring_manager_name,
        hm.email AS hiring_manager_email,
        rec.id AS recruiter_id,
        rec.full_name AS recruiter_name,
        rec.email AS recruiter_email
      FROM requisitions r
      LEFT JOIN users hm ON r.hiring_manager_id = hm.id
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      ${whereClause}
      ORDER BY r.handover_required DESC, r.created_at DESC
    `);

    const rows = stmt.all(...params);

    const mapped = rows.map(r => ({
      id: r.id,
      code: r.code,
      title: r.title,
      jobTitleId: r.job_title_id || null,
      departmentId: r.department_id || null,
      departmentName: r.department_name,
      workLocationId: r.work_location_id || null,
      workModeId: r.work_mode_id || null,
      headcount: r.s210_version && r.headcount === 0 ? null : r.headcount,
      ...this.s210Fields(r),
      status: r.status,
      handoverRequired: Boolean(r.handover_required),
      handoverNotes: r.handover_notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      recruiterName: r.recruiter_name,
      recruiterEmail: r.recruiter_email,
      hiringManager: r.hiring_manager_id ? {
        id: r.hiring_manager_id,
        fullName: r.hiring_manager_name,
        email: r.hiring_manager_email
      } : null,
      recruiter: r.recruiter_id ? {
        id: r.recruiter_id,
        fullName: r.recruiter_name,
        email: r.recruiter_email
      } : null
    }));

    return {
      success: true,
      total: rows.length,
      items: mapped,
      requisitions: mapped
    };
  }

  /**
   * Create new recruitment requisition in SQLite
   */
  createRequisition(data = {}, actor = null) {
    if (this.isS210Request(data)) return this.saveS210Requisition(null, data, actor);
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const departmentId = typeof data.departmentId === 'string'
      ? data.departmentId.trim()
      : '';

    const legacyDepartmentName = typeof data.departmentName === 'string'
      ? data.departmentName.trim()
      : (typeof data.department === 'string' ? data.department.trim() : '');

    const headcount = parseInt(data.headcount, 10) || 1;
    const recruiterId = data.recruiterId || data.assignedRecruiterId || null;
    const workLocationId = data.workLocationId || null;
    const workModeId = data.workModeId || null;

    const workCatalogValidation = this.validateRequisitionCatalogs(
      workLocationId,
      workModeId
    );

    if (!workCatalogValidation.success) return workCatalogValidation;
    const jobTitleId = typeof data.jobTitleId === 'string'
      ? data.jobTitleId.trim()
      : '';

    if (jobTitleId) {
      const jobTitle = this.db.prepare(`
        SELECT id, status, framework_id
        FROM job_titles
        WHERE id = ?
      `).get(jobTitleId);

      if (!jobTitle) {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_JOB_TITLE',
          message: 'Chức danh tuyển dụng không tồn tại.'
        };
      }

      if (jobTitle.status !== 'ACTIVE') {
        return {
          success: false,
          statusCode: 400,
          code: 'JOB_TITLE_INACTIVE',
          message: 'Chức danh đã ngừng áp dụng.'
        };
      }

      if (!jobTitle.framework_id) {
        return {
          success: false,
          statusCode: 400,
          code: 'JOB_TITLE_FRAMEWORK_REQUIRED',
          message: 'Chức danh chưa được gắn khung năng lực.'
        };
      }
    }

    if (!title) {
      return {
        success: false,
        statusCode: 400,
        message: 'Tiêu đề vị trí tuyển dụng là bắt buộc.'
      };
    }

    let department = null;

    if (departmentId) {
      department = this.db.prepare(`
        SELECT id, name, manager_id, status
        FROM departments
        WHERE id = ?
      `).get(departmentId);
    } else if (legacyDepartmentName) {
      // Sprint 1 accepts free-text departments and the caller's Hiring Manager.
      department = { id: null, name: legacyDepartmentName, manager_id: data.hiringManagerId || null, status: 'ACTIVE' };
    } else {
      return { success: false, statusCode: 400, message: 'Phòng ban tuyển dụng là bắt buộc.' };
    }

    if (!department) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_DEPARTMENT',
        message: 'Phòng ban tuyển dụng không tồn tại.'
      };
    }

    if (department.status !== 'ACTIVE') {
      return {
        success: false,
        statusCode: 400,
        code: 'DEPARTMENT_INACTIVE',
        message: 'Phòng ban đã ngừng áp dụng và không thể tạo yêu cầu tuyển dụng mới.'
      };
    }

    if (departmentId && !department.manager_id) {
      return {
        success: false,
        statusCode: 400,
        code: 'DEPARTMENT_MANAGER_REQUIRED',
        message: 'Phòng ban chưa có người phụ trách.'
      };
    }

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM requisitions');
    const nextNum = (countStmt.get().count || 0) + 1;
    const code = `REQ-2026-${String(nextNum).padStart(3, '0')}`;
    const id = 'req-' + crypto.randomUUID();

    const insertStmt = this.db.prepare(`
      INSERT INTO requisitions (
        id,
        code,
        title,
        job_title_id,
        department_id,
        department_name,
        work_location_id,
        work_mode_id,
        headcount,
        hiring_manager_id,
        recruiter_id,
        status,
        handover_required,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 0, datetime('now'), datetime('now')
      )
    `);

    insertStmt.run(
      id,
      code,
      title,
      jobTitleId || null,
      department.id,
      department.name,
      workLocationId,
      workModeId,
      headcount,
      department.manager_id,
      recruiterId
    );

    return {
      success: true,
      statusCode: 201,
      message: 'Khởi tạo vị trí tuyển dụng thành công.',
      data: {
        id,
        code,
        title,
        departmentName: department.name,
        ...(departmentId ? { departmentId: department.id, hiringManagerId: department.manager_id } : {}),
        headcount,
        status: 'OPEN'
      }
    };
  }
  /**
   * Reassign recruiter or resolve handover requirement (S1-10)
   */
  reassignHandover(requisitionId, newRecruiterId, notes = '') {
    if (!requisitionId) {
      return { success: false, statusCode: 400, message: 'Thiếu ID vị trí cần phân công.' };
    }

    const updateStmt = this.db.prepare(`
      UPDATE requisitions
      SET recruiter_id = ?, handover_required = 0, handover_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = updateStmt.run(newRecruiterId, notes || 'Đã bàn giao cho nhân sự mới', requisitionId);
    if (result.changes === 0) {
      return { success: false, statusCode: 404, message: 'Không tìm thấy vị trí tuyển dụng tương ứng.' };
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Phân công lại vị trí tuyển dụng và hoàn tất bàn giao thành công.'
    };
  }

  /**
   * Get single requisition by ID
   */
  getRequisitionById(id) {
    if (!id) return null;
    const stmt = this.db.prepare(`
      SELECT 
        r.id, r.code, r.title, r.job_title_id, r.department_id, r.department_name, r.work_location_id, r.work_mode_id, r.headcount, r.status, r.handover_required, r.handover_notes,
        r.created_at, r.updated_at,
        r.s210_version, r.created_by, r.recruitment_reason,
        r.proposed_salary_min, r.proposed_salary_max, r.needed_date,
        r.job_description, r.candidate_requirements, r.salary_justification,
        r.recruiter_id, rec.full_name AS recruiter_name, rec.email AS recruiter_email,
        r.hiring_manager_id, hm.full_name AS hiring_manager_name, hm.email AS hiring_manager_email
      FROM requisitions r
      LEFT JOIN users hm ON r.hiring_manager_id = hm.id
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      WHERE r.id = ?
    `);
    const r = stmt.get(id);
    if (!r) return null;
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      jobTitleId: r.job_title_id || null,
      departmentId: r.department_id || null,
      departmentName: r.department_name,
      workLocationId: r.work_location_id || null,
      workModeId: r.work_mode_id || null,
      headcount: r.s210_version && r.headcount === 0 ? null : r.headcount,
      ...this.s210Fields(r),
      status: r.status,
      handoverRequired: Boolean(r.handover_required),
      handoverNotes: r.handover_notes,
      recruiterId: r.recruiter_id,
      recruiterName: r.recruiter_name,
      hiringManagerId: r.hiring_manager_id,
      hiringManagerName: r.hiring_manager_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  /**
   * Update requisition details and status
   */
  updateRequisition(id, data = {}, actor = null) {
    if (!id) {
      return {
        success: false,
        statusCode: 400,
        message: 'Thiếu mã vị trí cần cập nhật.'
      };
    }

    const current = this.getRequisitionById(id);

    if (!current) {
      return {
        success: false,
        statusCode: 404,
        message: 'Không tìm thấy vị trí tuyển dụng.'
      };
    }

    if (current.formVersion === 'S2-10' || this.isS210Request(data)) {
      return this.saveS210Requisition(current, data, actor);
    }

    const title = typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : current.title;

    const headcount = data.headcount !== undefined
      ? (parseInt(data.headcount, 10) || current.headcount)
      : current.headcount;

    const status = typeof data.status === 'string' && data.status.trim()
      ? data.status.trim().toUpperCase()
      : current.status;

    const recruiterId = data.recruiterId !== undefined
      ? (data.recruiterId || null)
      : current.recruiterId;
    let jobTitleId = current.jobTitleId || null;

    const workLocationId = Object.prototype.hasOwnProperty.call(data, 'workLocationId')
      ? (data.workLocationId || null)
      : current.workLocationId;

    const workModeId = Object.prototype.hasOwnProperty.call(data, 'workModeId')
      ? (data.workModeId || null)
      : current.workModeId;

    const validateWorkLocationId =
      Object.prototype.hasOwnProperty.call(data, 'workLocationId') &&
      workLocationId !== current.workLocationId
        ? workLocationId
        : null;

    const validateWorkModeId =
      Object.prototype.hasOwnProperty.call(data, 'workModeId') &&
      workModeId !== current.workModeId
        ? workModeId
        : null;

    const workCatalogValidation = this.validateRequisitionCatalogs(
      validateWorkLocationId,
      validateWorkModeId
    );
    if (!workCatalogValidation.success) return workCatalogValidation;

    const requestedJobTitleId = typeof data.jobTitleId === 'string'
      ? data.jobTitleId.trim()
      : '';

    if (requestedJobTitleId) {
      const jobTitle = this.db.prepare(`
        SELECT id, status, framework_id
        FROM job_titles
        WHERE id = ?
      `).get(requestedJobTitleId);

      if (!jobTitle) {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_JOB_TITLE',
          message: 'Chức danh tuyển dụng không tồn tại.'
        };
      }

      if (jobTitle.status !== 'ACTIVE') {
        return {
          success: false,
          statusCode: 400,
          code: 'JOB_TITLE_INACTIVE',
          message: 'Chức danh đã ngừng áp dụng.'
        };
      }

      if (!jobTitle.framework_id) {
        return {
          success: false,
          statusCode: 400,
          code: 'JOB_TITLE_FRAMEWORK_REQUIRED',
          message: 'Chức danh chưa được gắn khung năng lực.'
        };
      }

      jobTitleId = jobTitle.id;
    }

    let departmentId = current.departmentId || null;
    let departmentName = current.departmentName;
    let hiringManagerId = current.hiringManagerId || null;

    const requestedDepartmentId = typeof data.departmentId === 'string'
      ? data.departmentId.trim()
      : '';

    const requestedDepartmentName = typeof data.departmentName === 'string'
      ? data.departmentName.trim()
      : (typeof data.department === 'string' ? data.department.trim() : '');

    if (requestedDepartmentId) {
      const department = this.db.prepare(`
            SELECT id, name, manager_id, status
            FROM departments
            WHERE id = ?
          `).get(requestedDepartmentId);

      if (!department) {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_DEPARTMENT',
          message: 'Phòng ban tuyển dụng không tồn tại.'
        };
      }

      if (department.status !== 'ACTIVE') {
        return {
          success: false,
          statusCode: 400,
          code: 'DEPARTMENT_INACTIVE',
          message: 'Phòng ban đã ngừng áp dụng.'
        };
      }

      departmentId = department.id;
      departmentName = department.name;
      hiringManagerId = department.manager_id;
    } else if (requestedDepartmentName) {
      if (requestedDepartmentName !== current.departmentName) departmentId = null;
      departmentName = requestedDepartmentName;
    }

    const stmt = this.db.prepare(`
      UPDATE requisitions
      SET
                title = ?,
        job_title_id = ?,
        department_id = ?,
        department_name = ?,
        hiring_manager_id = ?,
        work_location_id = ?,
        work_mode_id = ?,
        headcount = ?,
        status = ?,
        recruiter_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
            title,
      jobTitleId,
      departmentId,
      departmentName,
      hiringManagerId,
      workLocationId,
      workModeId,
      headcount,
      status,
      recruiterId,
      id
    );

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật vị trí tuyển dụng thành công.',
      data: this.getRequisitionById(id)
    };
  }
  isS210Request(data) {
    return data && (data.formVersion === 'S2-10' || data.status === 'DRAFT' ||
      ['recruitmentReason', 'proposedSalaryMin', 'proposedSalaryMax', 'neededDate',
        'jobDescription', 'candidateRequirements', 'salaryJustification'].some(key => Object.hasOwn(data, key)));
  }

  s210Fields(row) {
    if (!row.s210_version) return {};
    return {
      formVersion: 'S2-10', createdBy: row.created_by,
      recruitmentReason: row.recruitment_reason,
      proposedSalaryMin: row.proposed_salary_min, proposedSalaryMax: row.proposed_salary_max,
      neededDate: row.needed_date, jobDescription: row.job_description,
      candidateRequirements: row.candidate_requirements, salaryJustification: row.salary_justification
    };
  }

  businessDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  s210SalaryRangeStatus(jobTitle, min, max) {
    if (!jobTitle || jobTitle.min_salary === null || jobTitle.max_salary === null) return null;
    if ((min !== null && min < jobTitle.min_salary) || (max !== null && max > jobTitle.max_salary)) return 'OUTSIDE_STANDARD_RANGE';
    if (min === null || max === null) return null;
    return 'WITHIN_STANDARD_RANGE';
  }

  unavailableS210SalaryRange() {
    return { success: false, statusCode: 409, code: 'JOB_TITLE_SALARY_RANGE_UNAVAILABLE', message: 'Chức danh chưa được cấu hình đầy đủ dải lương chuẩn. HR Manager cần thiết lập dải lương trước khi yêu cầu tuyển dụng có thể được hoàn tất. Có thể lưu nháp.' };
  }

  checkS210SalaryRange(data) {
    // Read-only preview: the caller cannot disable justification on a write request.
    const validation = this.validateS210({ status: 'DRAFT', jobTitleId: data.jobTitleId,
      proposedSalaryMin: data.proposedSalaryMin, proposedSalaryMax: data.proposedSalaryMax }, null, null, { requireJustification: false });
    if (!validation.success) return validation;
    if (!validation.jobTitle || validation.values.proposedSalaryMin === null || validation.values.proposedSalaryMax === null) {
      return { success: false, statusCode: 400, code: 'MISSING_SALARY_CHECK_FIELD', message: 'Chọn chức danh và nhập đủ dải lương đề xuất để kiểm tra.' };
    }
    if (validation.jobTitle.min_salary === null || validation.jobTitle.max_salary === null) return this.unavailableS210SalaryRange();
    // Explicitly return only the classification, never the job title's standard values.
    return { success: true, statusCode: 200, salaryRangeStatus: validation.salaryRangeStatus };
  }

  validateS210(data, current = null, actor = null, { requireJustification = true } = {}) {
    const fail = (code, message) => ({ success: false, statusCode: 400, code, message });
    const fields = ['title', 'jobTitleId', 'departmentId', 'headcount', 'recruitmentReason',
      'proposedSalaryMin', 'proposedSalaryMax', 'neededDate', 'jobDescription',
      'candidateRequirements', 'salaryJustification', 'recruiterId', 'workLocationId', 'workModeId'];
    const values = {};
    for (const key of fields) values[key] = Object.hasOwn(data, key) ? data[key] : current?.[key] ?? null;
    const status = Object.hasOwn(data, 'status') ? data.status : current?.status || 'OPEN';
    if (!['DRAFT', 'OPEN', 'IN_PROGRESS', 'CLOSED'].includes(status)) return fail('INVALID_REQUISITION_STATUS', 'Trạng thái yêu cầu tuyển dụng không hợp lệ.');
    if ((!current || current.status === 'DRAFT') && !['DRAFT', 'OPEN'].includes(status)) return fail('INVALID_DRAFT_TRANSITION', 'Hoàn tất nháp bằng trạng thái OPEN hiện có.');
    if (current && current.status !== 'DRAFT' && status === 'DRAFT') return fail('INVALID_DRAFT_TRANSITION', 'Yêu cầu đã hoàn tất không thể chuyển lại thành nháp.');
    const draft = status === 'DRAFT';
    for (const key of fields.filter(key => !['headcount', 'proposedSalaryMin', 'proposedSalaryMax'].includes(key))) {
      if (values[key] === null || values[key] === undefined || values[key] === '') { values[key] = null; continue; }
      if (typeof values[key] !== 'string') return fail('INVALID_REQUISITION_FIELD', `Trường ${key} phải là chuỗi.`);
      // Preserve the complete authored JD/requirements, including line breaks and spacing.
      if (!['jobDescription', 'candidateRequirements'].includes(key)) values[key] = values[key].trim() || null;
    }
    for (const key of ['headcount', 'proposedSalaryMin', 'proposedSalaryMax']) {
      const value = values[key];
      if (value === null || value === undefined || value === '') { values[key] = null; continue; }
      if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return fail('INVALID_REQUISITION_NUMBER', `Trường ${key} phải là số hợp lệ.`);
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || number < 0 ||
        (key === 'headcount' && (!Number.isSafeInteger(number) || number <= 0))) {
        return fail(key === 'headcount' ? 'INVALID_HEADCOUNT' : 'INVALID_PROPOSED_SALARY', key === 'headcount' ? 'Số lượng cần tuyển phải là số nguyên lớn hơn 0.' : 'Lương đề xuất phải là số hợp lệ, không âm.');
      }
      values[key] = number;
    }
    if (values.proposedSalaryMin !== null && values.proposedSalaryMax !== null && values.proposedSalaryMin > values.proposedSalaryMax) return fail('INVALID_PROPOSED_SALARY_RANGE', 'Lương tối thiểu không được lớn hơn lương tối đa.');
    if (values.recruitmentReason && !['REPLACEMENT', 'NEW_HEADCOUNT'].includes(values.recruitmentReason)) return fail('INVALID_RECRUITMENT_REASON', 'Lý do tuyển chỉ gồm Thay thế hoặc Tăng mới.');
    if (values.neededDate) {
      const date = new Date(`${values.neededDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.neededDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== values.neededDate) return fail('INVALID_NEEDED_DATE', 'Ngày cần người phải là ngày hợp lệ theo YYYY-MM-DD.');
      if ((!current || current.status === 'DRAFT' || Object.hasOwn(data, 'neededDate')) && values.neededDate < this.businessDate()) return fail('NEEDED_DATE_IN_PAST', 'Ngày cần người không được ở quá khứ (múi giờ Việt Nam).');
    }
    const jobTitle = values.jobTitleId ? this.db.prepare('SELECT id, name, min_salary, max_salary, status FROM job_titles WHERE id = ?').get(values.jobTitleId) : null;
    if (values.jobTitleId && (!jobTitle || jobTitle.status !== 'ACTIVE')) return fail('INVALID_JOB_TITLE', 'Chức danh không tồn tại hoặc đã ngừng áp dụng.');
    const department = values.departmentId ? this.db.prepare('SELECT id, name, manager_id, status FROM departments WHERE id = ?').get(values.departmentId) : null;
    if (values.departmentId && (!department || department.status !== 'ACTIVE')) return fail('INVALID_DEPARTMENT', 'Phòng ban không tồn tại hoặc đã ngừng áp dụng.');
    if (department && actor && !actor.roles.includes('HR_MANAGER') && department.manager_id !== actor.id) return { success: false, statusCode: 403, code: 'REQUISITION_DEPARTMENT_FORBIDDEN', message: 'Bạn chỉ được tạo yêu cầu cho phòng ban mình phụ trách.' };
    const catalogResult = this.validateRequisitionCatalogs(values.workLocationId, values.workModeId);
    if (!catalogResult.success) return catalogResult;
    if (values.recruiterId && !this.db.prepare('SELECT id FROM users WHERE id = ?').get(values.recruiterId)) return fail('INVALID_RECRUITER', 'Nhân sự phụ trách không tồn tại.');
    if (!draft) {
      for (const key of ['jobTitleId', 'departmentId', 'headcount', 'recruitmentReason', 'proposedSalaryMin', 'proposedSalaryMax', 'neededDate', 'jobDescription', 'candidateRequirements']) {
        if (values[key] === null || (typeof values[key] === 'string' && !values[key].trim())) return fail('MISSING_REQUISITION_FIELD', `Vui lòng nhập đầy đủ ${key} trước khi hoàn tất yêu cầu.`);
      }
      // A missing standard range is allowed for drafts only, without invented defaults.
      if (jobTitle.min_salary === null || jobTitle.max_salary === null) {
        return this.unavailableS210SalaryRange();
      }
    }
    const salaryRangeStatus = this.s210SalaryRangeStatus(jobTitle, values.proposedSalaryMin, values.proposedSalaryMax);
    if (requireJustification && salaryRangeStatus === 'OUTSIDE_STANDARD_RANGE' && !values.salaryJustification) {
      return { ...fail('SALARY_JUSTIFICATION_REQUIRED', 'Dải lương đề xuất nằm ngoài chuẩn chức danh; bắt buộc nhập giải trình.'), salaryRangeStatus };
    }
    return { success: true, values, status, jobTitle, department, salaryRangeStatus };
  }

  saveS210Requisition(current, data, actor) {
    if (current?.status === 'DRAFT' && actor && current.createdBy !== actor.id) {
      return { success: false, statusCode: 403, code: 'REQUISITION_DRAFT_FORBIDDEN', message: 'Bạn chỉ được sửa nháp do mình tạo.' };
    }
    const validation = this.validateS210(data, current, actor);
    if (!validation.success) return validation;
    const { values: v, status, jobTitle, department } = validation;
    const title = v.title || jobTitle?.name || '';
    const headcount = v.headcount ?? 0; // Existing NOT NULL column: zero denotes an unentered draft quantity only.
    const id = current?.id || 'req-' + crypto.randomUUID();
    const createdBy = current?.createdBy || actor?.id || null;
    const manager = department?.manager_id || null;
    if (current) {
      this.db.prepare(`UPDATE requisitions SET title=?, job_title_id=?, department_id=?, department_name=?,
        headcount=?, hiring_manager_id=?, recruiter_id=?, work_location_id=?, work_mode_id=?, status=?,
        s210_version=1, created_by=?, recruitment_reason=?, proposed_salary_min=?, proposed_salary_max=?,
        needed_date=?, job_description=?, candidate_requirements=?, salary_justification=?, updated_at=datetime('now') WHERE id=?`)
        .run(title, v.jobTitleId, v.departmentId, department?.name || '', headcount, manager,
          v.recruiterId, v.workLocationId, v.workModeId, status, createdBy, v.recruitmentReason,
          v.proposedSalaryMin, v.proposedSalaryMax, v.neededDate, v.jobDescription, v.candidateRequirements, v.salaryJustification, id);
    } else {
      let number = this.db.prepare('SELECT COUNT(*) AS count FROM requisitions').get().count + 1;
      let code;
      do { code = `REQ-2026-${String(number++).padStart(3, '0')}`; } while (this.db.prepare('SELECT id FROM requisitions WHERE code=?').get(code));
      this.db.prepare(`INSERT INTO requisitions (id,code,title,job_title_id,department_id,department_name,headcount,
        hiring_manager_id,recruiter_id,work_location_id,work_mode_id,status,s210_version,created_by,recruitment_reason,
        proposed_salary_min,proposed_salary_max,needed_date,job_description,candidate_requirements,salary_justification)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`)
        .run(id, code, title, v.jobTitleId, v.departmentId, department?.name || '', headcount, manager,
          v.recruiterId, v.workLocationId, v.workModeId, status, createdBy, v.recruitmentReason,
          v.proposedSalaryMin, v.proposedSalaryMax, v.neededDate, v.jobDescription, v.candidateRequirements, v.salaryJustification);
    }
    return { success: true, statusCode: current ? 200 : 201, message: status === 'DRAFT' ? 'Đã lưu nháp yêu cầu tuyển dụng.' : 'Đã lưu yêu cầu tuyển dụng.',
      ...(validation.salaryRangeStatus ? { salaryRangeStatus: validation.salaryRangeStatus } : {}), data: this.getRequisitionById(id) };
  }

  validateRequisitionCatalogs(workLocationId, workModeId) {
    const checks = [
      {
        id: workLocationId,
        type: 'WORK_LOCATION',
        code: 'INVALID_WORK_LOCATION',
        message: 'Địa điểm làm việc không hợp lệ hoặc đã ngừng áp dụng.'
      },
      {
        id: workModeId,
        type: 'WORK_MODE',
        code: 'INVALID_WORK_MODE',
        message: 'Hình thức làm việc không hợp lệ hoặc đã ngừng áp dụng.'
      }
    ];

    for (const check of checks) {
      if (!check.id) continue;

      const item = this.db.prepare(`
        SELECT id
        FROM recruitment_catalog_items
        WHERE id = ?
          AND type = ?
          AND status = 'ACTIVE'
      `).get(check.id, check.type);

      if (!item) {
        return {
          success: false,
          statusCode: 400,
          code: check.code,
          message: check.message
        };
      }
    }

    return { success: true };
  }
  /**
   * Get enterprise real-time dashboard statistics from SQLite
   */
  getDashboardStats() {
    // 1. User stats
    const userStats = this.db.prepare(`
      SELECT 
        COUNT(*) AS total_users,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_users,
        SUM(CASE WHEN status = 'LOCKED' THEN 1 ELSE 0 END) AS locked_users
      FROM users
    `).get();

    // 2. Active sessions count
    const sessionStats = this.db.prepare(`
      SELECT COUNT(*) AS active_sessions
      FROM sessions
      WHERE datetime(expires_at) > datetime('now')
    `).get();

    // 3. Requisition stats
    const reqStats = this.db.prepare(`
      SELECT 
        COUNT(*) AS total_requisitions,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_requisitions,
        SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_requisitions,
        SUM(CASE WHEN handover_required = 1 THEN 1 ELSE 0 END) AS handover_alerts,
        SUM(headcount) AS total_headcount
      FROM requisitions
    `).get();

    // 4. Candidate stats & Funnel
    let candStats = { total: 0, new: 0, screening: 0, interview: 0, offer: 0, hired: 0 };
    try {
      const cRow = this.db.prepare(`
        SELECT 
          COUNT(*) AS total_candidates,
          SUM(CASE WHEN stage = 'NEW' THEN 1 ELSE 0 END) AS stage_new,
          SUM(CASE WHEN stage = 'SCREENING' THEN 1 ELSE 0 END) AS stage_screening,
          SUM(CASE WHEN stage = 'INTERVIEW' THEN 1 ELSE 0 END) AS stage_interview,
          SUM(CASE WHEN stage = 'OFFER' THEN 1 ELSE 0 END) AS stage_offer,
          SUM(CASE WHEN stage = 'HIRED' THEN 1 ELSE 0 END) AS stage_hired
        FROM candidates
      `).get();
      if (cRow) {
        candStats = {
          total: cRow.total_candidates || 0,
          new: cRow.stage_new || 0,
          screening: cRow.stage_screening || 0,
          interview: cRow.stage_interview || 0,
          offer: cRow.stage_offer || 0,
          hired: cRow.stage_hired || 0
        };
      }
    } catch (e) {}

    // 5. Upcoming interviews
    let upcomingInterviewsCount = 0;
    try {
      const iRow = this.db.prepare(`
        SELECT COUNT(*) AS c FROM interviews WHERE status = 'SCHEDULED'
      `).get();
      if (iRow) upcomingInterviewsCount = iRow.c || 0;
    } catch (e) {}

    // 6. Department breakdown
    let departmentBreakdown = [];
    try {
      departmentBreakdown = this.db.prepare(`
        SELECT department_name, COUNT(*) AS req_count, SUM(headcount) AS total_headcount
        FROM requisitions
        GROUP BY department_name
        ORDER BY req_count DESC
      `).all();
    } catch (e) {}

    // 7. Recent recruitment activities (from real SQLite records)
    const recentActivities = [];
    try {
      const recentCands = this.db.prepare(`
        SELECT c.full_name, c.stage, c.created_at, r.title AS req_title
        FROM candidates c
        LEFT JOIN requisitions r ON c.requisition_id = r.id
        ORDER BY c.created_at DESC LIMIT 3
      `).all();
      recentCands.forEach(c => {
        recentActivities.push({
          type: 'CANDIDATE',
          title: `${c.full_name} ứng tuyển vào ${c.req_title || 'vị trí tuyển dụng'}`,
          meta: `Giai đoạn: ${c.stage}`,
          timestamp: c.created_at
        });
      });

      const recentInts = this.db.prepare(`
        SELECT i.round_name, i.scheduled_time, i.status, c.full_name AS cand_name, u.full_name AS interviewer_name
        FROM interviews i
        LEFT JOIN candidates c ON i.candidate_id = c.id
        LEFT JOIN users u ON i.interviewer_id = u.id
        ORDER BY i.created_at DESC LIMIT 2
      `).all();
      recentInts.forEach(it => {
        recentActivities.push({
          type: 'INTERVIEW',
          title: `${it.round_name} cho ứng viên ${it.cand_name}`,
          meta: `Người phỏng vấn: ${it.interviewer_name || 'Hội đồng chuyên môn'} | Thời gian: ${it.scheduled_time}`,
          timestamp: it.scheduled_time
        });
      });
    } catch (e) {}

    // 8. Recent requisitions
    const recentRequisitions = this.db.prepare(`
      SELECT r.id, r.code, r.title, r.department_name, r.headcount, r.status, r.handover_required, rec.full_name AS recruiter_name
      FROM requisitions r
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      ORDER BY r.handover_required DESC, r.created_at DESC
      LIMIT 5
    `).all();

    // 9. Recent audit logs
    const recentAudit = this.db.prepare(`
      SELECT email, status, reason, attempted_at
      FROM login_audit_logs
      ORDER BY attempted_at DESC
      LIMIT 5
    `).all();

    // 10. Role distribution
    const roleDistribution = this.db.prepare(`
      SELECT r.code, r.name, COUNT(ur.user_id) AS user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.id
      ORDER BY user_count DESC
    `).all();

    return {
      success: true,
      stats: {
        users: {
          total: userStats.total_users || 0,
          active: userStats.active_users || 0,
          locked: userStats.locked_users || 0
        },
        sessions: {
          activeCount: sessionStats.active_sessions || 0
        },
        requisitions: {
          total: reqStats.total_requisitions || 0,
          open: reqStats.open_requisitions || 0,
          inProgress: reqStats.in_progress_requisitions || 0,
          handoverAlerts: reqStats.handover_alerts || 0,
          totalHeadcount: reqStats.total_headcount || 0
        },
        candidates: candStats,
        upcomingInterviews: upcomingInterviewsCount,
        departmentBreakdown,
        recentActivities,
        roleDistribution,
        recentRequisitions,
        recentAudit
      }
    };
  }

  /**
   * Get candidates list with search and filters
   */
  getCandidates(options = {}) {
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const stage = typeof options.stage === 'string' ? options.stage.trim() : 'ALL';
    const reqId = typeof options.requisitionId === 'string' ? options.requisitionId.trim() : 'ALL';

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(c.full_name LIKE ? OR c.email LIKE ? OR c.phone_number LIKE ? OR c.current_company LIKE ?)');
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    if (stage && stage !== 'ALL') {
      conditions.push('c.stage = ?');
      params.push(stage);
    }

    if (reqId && reqId !== 'ALL') {
      conditions.push('c.requisition_id = ?');
      params.push(reqId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = this.db.prepare(`
      SELECT 
        c.id,
        c.full_name,
        c.email,
        c.phone_number,
        c.stage,
        c.experience_years,
        c.current_company,
        c.expected_salary,
        c.notes,
        c.source_id,
        c.rejection_reason_id,
        source.name AS source_name,
        rejection_reason.name AS rejection_reason_name,
        c.created_at,
        r.id AS requisition_id,
        r.code AS requisition_code,
        r.title AS requisition_title,
        r.department_name
      FROM candidates c
      LEFT JOIN requisitions r ON c.requisition_id = r.id
      LEFT JOIN recruitment_catalog_items source
        ON c.source_id = source.id
      LEFT JOIN recruitment_catalog_items rejection_reason
        ON c.rejection_reason_id = rejection_reason.id
      ${whereClause}
      ORDER BY c.created_at DESC
    `);

    const rows = stmt.all(...params);
    return {
      success: true,
      total: rows.length,
      candidates: rows.map(r => {
        let code = 'CAND-001';
        if (r.id && r.id.startsWith('cand-0')) {
          code = 'CAND-' + r.id.replace('cand-', '');
        } else if (r.id) {
          const raw = r.id.replace(/^cand-/, '');
          code = 'CAND-' + (raw.length <= 4 ? raw.toUpperCase() : raw.substring(0, 4).toUpperCase());
        }
        return {
          id: r.id,
          code,
          fullName: r.full_name,
          email: r.email,
          phoneNumber: r.phone_number,
          stage: r.stage,
          experienceYears: r.experience_years,
          currentCompany: r.current_company,
          expectedSalary: r.expected_salary,
          notes: r.notes,
          sourceId: r.source_id || null,
          sourceName: r.source_name || null,
          rejectionReasonId: r.rejection_reason_id || null,
          rejectionReasonName: r.rejection_reason_name || null,
          createdAt: r.created_at,
          requisition: r.requisition_id ? {
            id: r.requisition_id,
            code: r.requisition_code,
            title: r.requisition_title,
            departmentName: r.department_name
          } : null
        };
      })
    };
  }

  /**
   * Get interviews list
   */
  getInterviews(options = {}) {
    const stmt = this.db.prepare(`
      SELECT 
        i.id,
        i.round_name,
        i.scheduled_time,
        i.location_or_link,
        i.status,
        i.feedback,
        i.score,
        i.created_at,
        c.id AS candidate_id,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone_number AS candidate_phone,
        r.id AS requisition_id,
        r.title AS requisition_title,
        r.department_id,
        r.department_name,
        u.id AS interviewer_id,
        u.full_name AS interviewer_name,
        u.email AS interviewer_email
      FROM interviews i
      LEFT JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN requisitions r ON i.requisition_id = r.id
      LEFT JOIN users u ON i.interviewer_id = u.id
      ORDER BY i.scheduled_time DESC
    `);

    const rows = stmt.all();
    return {
      success: true,
      total: rows.length,
      interviews: rows.map(r => ({
        id: r.id,
        roundName: r.round_name,
        scheduledTime: r.scheduled_time,
        locationOrLink: r.location_or_link,
        status: r.status,
        feedback: r.feedback,
        score: r.score,
        createdAt: r.created_at,
        candidate: {
          id: r.candidate_id,
          fullName: r.candidate_name,
          email: r.candidate_email,
          phone: r.candidate_phone
        },
        requisition: {
          id: r.requisition_id,
          title: r.requisition_title,
          departmentName: r.department_name
        },
        interviewer: r.interviewer_id ? {
          id: r.interviewer_id,
          fullName: r.interviewer_name,
          email: r.interviewer_email
        } : null
      }))
    };
  }

  /**
   * Get offers list
   */
  getOffers(options = {}) {
    const stmt = this.db.prepare(`
      SELECT 
        o.id,
        o.salary_monthly,
        o.start_date,
        o.status,
        o.created_at,
        c.id AS candidate_id,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        r.id AS requisition_id,
        r.title AS requisition_title,
        r.department_id,
        r.department_name,
        u.id AS approver_id,
        u.full_name AS approver_name
      FROM offers o
      LEFT JOIN candidates c ON o.candidate_id = c.id
      LEFT JOIN requisitions r ON o.requisition_id = r.id
      LEFT JOIN users u ON o.approver_id = u.id
      ORDER BY o.created_at DESC
    `);

    const rows = stmt.all();
    return {
      success: true,
      total: rows.length,
      offers: rows.map(r => ({
        id: r.id,
        salaryMonthly: r.salary_monthly,
        startDate: r.start_date,
        status: r.status,
        createdAt: r.created_at,
        candidate: {
          id: r.candidate_id,
          fullName: r.candidate_name,
          email: r.candidate_email
        },
        requisition: {
          id: r.requisition_id,
          title: r.requisition_title,
          departmentName: r.department_name
        },
        approver: r.approver_id ? {
          id: r.approver_id,
          fullName: r.approver_name
        } : null
      }))
    };
  }

  /**
   * Get recruitment reports
   */
  getReports() {
    const stats = this.getDashboardStats();
    return {
      success: true,
      report: {
        summary: stats.stats,
        pipelineFunnel: [
          { stage: 'Ứng tuyển mới', count: stats.stats.candidates.new || 0, percent: 100 },
          { stage: 'Sàng lọc hồ sơ', count: stats.stats.candidates.screening || 0, percent: 80 },
          { stage: 'Phỏng vấn', count: stats.stats.candidates.interview || 0, percent: 50 },
          { stage: 'Đề xuất Offer', count: stats.stats.candidates.offer || 0, percent: 30 },
          { stage: 'Tuyển dụng thành công', count: stats.stats.candidates.hired || 0, percent: 20 }
        ],
        timeToHireAverageDays: 18,
        costPerHireAverageVnd: '12.500.000 đ'
      }
    };
  }

  validateCandidateCatalog(id, expectedType) {
    if (!id) return { success: true };

    const item = this.db.prepare(`
      SELECT id
      FROM recruitment_catalog_items
      WHERE id = ?
        AND type = ?
        AND status = 'ACTIVE'
    `).get(id, expectedType);

    if (!item) {
      return {
        success: false,
        statusCode: 400,
        code: expectedType === 'CANDIDATE_SOURCE'
          ? 'INVALID_CANDIDATE_SOURCE'
          : 'INVALID_REJECTION_REASON',
        message: expectedType === 'CANDIDATE_SOURCE'
          ? 'Nguồn ứng viên không hợp lệ hoặc đã ngừng áp dụng.'
          : 'Lý do loại hồ sơ không hợp lệ hoặc đã ngừng áp dụng.'
      };
    }

    return { success: true };
  }
  /**
   * Create candidate record
   */
  createCandidate(data = {}) {
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    const requisitionId = data.requisitionId || null;
    const sourceId = data.sourceId || null;

    const sourceValidation = this.validateCandidateCatalog(
      sourceId,
      'CANDIDATE_SOURCE'
    );

    if (!sourceValidation.success) return sourceValidation;
    const stage = data.stage || 'NEW';
    const experienceYears = parseInt(data.experienceYears, 10) || 1;
    const currentCompany = data.currentCompany || '';
    const expectedSalary = data.expectedSalary || '';
    const notes = data.notes || '';

    if (!fullName) {
      return { success: false, statusCode: 400, message: 'Họ và tên ứng viên là bắt buộc.' };
    }
    if (!email) {
      return { success: false, statusCode: 400, message: 'Email ứng viên là bắt buộc.' };
    }

    const id = 'cand-' + crypto.randomUUID();
    const insertStmt = this.db.prepare(`
      INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, source_id, stage, experience_years, current_company, expected_salary, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    insertStmt.run(id, fullName, email, phoneNumber, requisitionId, sourceId, stage, experienceYears, currentCompany, expectedSalary, notes);

    return {
      success: true,
      statusCode: 201,
      message: 'Thêm hồ sơ ứng viên thành công.',
      data: { id, code: 'CAND-' + id.replace(/^cand-/, '').substring(0, 4).toUpperCase(), fullName, email, stage }
    };
  }

  /**
   * Update candidate stage / pipeline status
   */
  updateCandidateStage(id, stage, notes, rejectionReasonId) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã ứng viên.' };
    const validStages = ['NEW', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];
    if (!validStages.includes(stage)) {
      return { success: false, statusCode: 400, message: 'Giai đoạn không hợp lệ.' };
    }
    if (stage === 'REJECTED' && rejectionReasonId) {
      const reasonValidation = this.validateCandidateCatalog(
        rejectionReasonId,
        'REJECTION_REASON'
      );

      if (!reasonValidation.success) return reasonValidation;
    }
    const updateStmt = this.db.prepare(`
      UPDATE candidates 
      SET stage = ?, notes = COALESCE(?, notes),
          rejection_reason_id = CASE WHEN ? THEN rejection_reason_id ELSE ? END
      WHERE id = ?
    `);
    const rejectionReasonValue = stage === 'REJECTED'
      ? (rejectionReasonId || null)
      : null;

    const res = updateStmt.run(
      stage,
      notes || null,
      stage === 'REJECTED' && rejectionReasonId === undefined ? 1 : 0,
      rejectionReasonValue,
      id
    );
    if (res.changes === 0) {
      return { success: false, statusCode: 404, message: 'Không tìm thấy hồ sơ ứng viên.' };
    }
    return { success: true, statusCode: 200, message: 'Cập nhật giai đoạn ứng viên thành công.' };
  }

  /**
   * Schedule new interview
   */
  createInterview(data = {}) {
    const candidateId = data.candidateId;
    const requisitionId = data.requisitionId || null;
    const interviewerId = data.interviewerId || null;
    const roundName = data.roundName || 'Phỏng vấn chuyên môn';
    const scheduledTime = data.scheduledTime;
    const locationOrLink = data.locationOrLink || 'Google Meet Online';

    if (!candidateId) return { success: false, statusCode: 400, message: 'Vui lòng chọn ứng viên.' };
    if (!scheduledTime) return { success: false, statusCode: 400, message: 'Vui lòng chọn thời gian phỏng vấn.' };

    const id = 'int-' + crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', datetime('now'))
    `);
    stmt.run(id, candidateId, requisitionId, interviewerId, roundName, scheduledTime, locationOrLink);

    // Update candidate stage to INTERVIEW
    this.db.prepare("UPDATE candidates SET stage = 'INTERVIEW' WHERE id = ?").run(candidateId);

    return { success: true, statusCode: 201, message: 'Lên lịch phỏng vấn thành công.', data: { id } };
  }

  /**
   * Update interview status / score / feedback
   */
  updateInterviewStatus(id, status, feedback, score) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã phỏng vấn.' };
    const stmt = this.db.prepare(`
      UPDATE interviews
      SET status = ?, feedback = COALESCE(?, feedback), score = COALESCE(?, score)
      WHERE id = ?
    `);
    const res = stmt.run(status, feedback || null, score ? parseInt(score, 10) : null, id);
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy lịch phỏng vấn.' };
    return { success: true, statusCode: 200, message: 'Cập nhật lịch phỏng vấn thành công.' };
  }

  /**
   * Create Job Offer
   */
  createOffer(data = {}) {
    const candidateId = data.candidateId;
    const requisitionId = data.requisitionId || null;
    const salaryMonthly = parseInt(data.salaryMonthly, 10) || 0;
    const startDate = data.startDate || null;
    const approverId = data.approverId || null;

    if (!candidateId) return { success: false, statusCode: 400, message: 'Vui lòng chọn ứng viên.' };
    if (!salaryMonthly) return { success: false, statusCode: 400, message: 'Vui lòng nhập mức lương đề xuất.' };

    const id = 'off-' + crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO offers (id, candidate_id, requisition_id, salary_monthly, start_date, status, approver_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, datetime('now'))
    `);
    stmt.run(id, candidateId, requisitionId, salaryMonthly, startDate, approverId);

    // Update candidate stage to OFFER
    this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(candidateId);

    return { success: true, statusCode: 201, message: 'Khởi tạo đề xuất việc làm (Offer) thành công.', data: { id } };
  }

  /**
   * Approve / Reject Offer
   */
  updateOfferStatus(id, status) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã offer.' };
    const stmt = this.db.prepare(`UPDATE offers SET status = ? WHERE id = ?`);
    const res = stmt.run(status, id);
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy offer.' };

    if (status === 'APPROVED') {
      const off = this.db.prepare('SELECT candidate_id FROM offers WHERE id = ?').get(id);
      if (off && off.candidate_id) {
        this.db.prepare("UPDATE candidates SET stage = 'HIRED' WHERE id = ?").run(off.candidate_id);
      }
    }
    return { success: true, statusCode: 200, message: 'Cập nhật trạng thái offer thành công.' };
  }
}

module.exports = RequisitionService;
