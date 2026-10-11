const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const candidateStages = Object.freeze(['NEW', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']);

class RequisitionService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  /**
   * Get all requisitions with recruiter and hiring manager details
   */
  async getRequisitions(options = {}) {
    const tracking=require('../config/config').REQUISITION_TRACKING_ENABLED===true,tracker=tracking?new(require('./requisitionTrackingService'))(this.db):null;if(tracking){options=tracker.normalize(options);if(options.viewer){const actor=await new(require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(options.viewer.id,'requisition.read');if(!actor)throw new(require('./approvalConfigurationService').ApprovalConfigurationError)('REQUISITION_TRACKING_FORBIDDEN','Bạn không có quyền xem yêu cầu tuyển dụng.',403);options={...options,viewer:actor,viewerId:actor.id};}}
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
      conditions.push('r.handover_required = TRUE');
    }
    const draftViewerId=options.viewerId||options.viewer?.id;
    if (draftViewerId) {
      conditions.push("(r.s210_version = 0 OR r.status <> 'DRAFT' OR r.created_by = ?)");
      params.push(draftViewerId);
    }
    if (options.canReadS210 === false) conditions.push('r.s210_version = 0');
    if (options.hiringManagerId) {
      conditions.push(this.hiringRequisitionScope());
      params.push(options.hiringManagerId, options.hiringManagerId, options.hiringManagerId);
    }
    const visibility = this.requisitionVisibility(options.viewer, options.approvalEnabled);
    if (visibility) { conditions.push(visibility.condition); params.push(...visibility.params); }

    if(tracking)tracker.filters(conditions,params,options);
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
        ${tracking?'r.opened_at, le.created_at AS lifecycle_end,':''}
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
      ${tracking?'LEFT JOIN requisition_lifecycle_state ls ON ls.requisition_id=r.id LEFT JOIN requisition_lifecycle_events le ON le.id=ls.last_event_id':''}
      ${whereClause}
      ORDER BY r.handover_required DESC, r.created_at DESC${tracking?',r.id':''}
      ${tracking&&options.limit?'LIMIT ? OFFSET ?':''}
    `);

    const total=tracking&&options.limit?(await this.db.prepare('SELECT COUNT(*) AS n FROM requisitions r '+whereClause).get(...params)).n:null;
    const rows = (await stmt.all(...params,...(tracking&&options.limit?[options.limit,(options.page-1)*options.limit]:[])));
    const supports=tracking?await tracker.supports(rows.map(row=>row.id)):null;
    const trackingNow=tracking?new Date():null;
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
      ...(tracking?{...tracker.metrics(r,trackingNow),supportRecruiters:supports.get(r.id)||[]}:{}),
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
      features:{requisitionTracking:tracking,jobPostingDrafts:require('../config/config').JOB_POSTING_DRAFTS_ENABLED===true,requisitionLifecycle:require('../config/config').REQUISITION_LIFECYCLE_ENABLED===true,requisitionOperations:require('../config/config').REQUISITION_OPERATIONS_ENABLED===true},
      total: total??rows.length,
      ...(tracking&&options.limit?{pagination:{currentPage:options.page,pageSize:options.limit,totalItems:total,totalPages:Math.ceil(total/options.limit)}}:{}),
      items: mapped,
      requisitions: mapped
    };
  }

  /**
   * Create new recruitment requisition in SQLite
   */
  async createRequisition(data = {}, actor = null) {
    if(require('../config/config').REQUISITION_LIFECYCLE_ENABLED&&['CLOSED','PAUSED','CANCELLED'].includes(typeof data.status==='string'?data.status.trim().toUpperCase():data.status))return{success:false,statusCode:409,code:'REQUISITION_LIFECYCLE_ACTION_REQUIRED',message:'Vui lòng tạo Nháp/OPEN và dùng thao tác vòng đời với lý do phù hợp.'};
    return this.db.transaction(async () => {
      if(actor){const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,'requisition.create');if(!fresh)return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền tạo yêu cầu tuyển dụng.'};actor={...actor,...fresh};}
      if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('requisition-code');
    if (this.isS210Request(data)) return (await this.saveS210Requisition(null, data, actor));
    if(actor&&(data.recruiterId||data.assignedRecruiterId)&&!actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))return{success:false,statusCode:403,code:'REQUISITION_ASSIGN_FORBIDDEN',message:'Bạn không có quyền phân công recruiter.'};
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const departmentId = typeof data.departmentId === 'string'
      ? data.departmentId.trim()
      : '';

    const legacyDepartmentName = typeof data.departmentName === 'string'
      ? data.departmentName.trim()
      : (typeof data.department === 'string' ? data.department.trim() : '');

    const headcount = parseInt(data.headcount, 10) || 1;
    const recruiterId = data.recruiterId || data.assignedRecruiterId || null;
    if(actor&&recruiterId&&!await this.db.prepare("SELECT u.id FROM users u WHERE u.id=? AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='RECRUITER')").get(recruiterId))return{success:false,statusCode:400,code:'INVALID_RECRUITER',message:'Người phụ trách phải là Recruiter đang hoạt động.'};
    const workLocationId = data.workLocationId || null;
    const workModeId = data.workModeId || null;

    const workCatalogValidation = (await this.validateRequisitionCatalogs(
      workLocationId,
      workModeId
    ));

    if (!workCatalogValidation.success) return workCatalogValidation;
    const jobTitleId = typeof data.jobTitleId === 'string'
      ? data.jobTitleId.trim()
      : '';

    if (jobTitleId) {
      const jobTitle = (await this.db.prepare(`
        SELECT id, status, framework_id
        FROM job_titles
        WHERE id = ?
      `).get(jobTitleId));

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
      department = (await this.db.prepare(`
        SELECT id, name, manager_id, status
        FROM departments
        WHERE id = ?
      `).get(departmentId));
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
    if(actor&&!actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){
      if((departmentId&&department.manager_id!==actor.id)||(!departmentId&&data.hiringManagerId&&data.hiringManagerId!==actor.id))return{success:false,statusCode:403,code:'REQUISITION_DEPARTMENT_FORBIDDEN',message:'Bạn chỉ được tạo yêu cầu cho phòng ban hoặc vị trí mình phụ trách.'};
      if(!departmentId)department.manager_id=actor.id;
    }

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM requisitions');
    const nextNum = ((await countStmt.get()).count || 0) + 1;
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
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', FALSE, ?, datetime('now'), datetime('now')
      )
    `);

    (await insertStmt.run(
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
      recruiterId,
      actor?.id||null
    ));

    if(actor&&recruiterId&&require('../config/config').REQUISITION_OPERATIONS_ENABLED){await this.db.prepare('UPDATE requisitions SET recruiter_id=NULL WHERE id=?').run(id);await this.synchronizePrimaryRecruiter(id,recruiterId,actor);}
    if(require('./headcountBudgetService').HeadcountBudgetService.enabled())await new (require('./headcountBudgetService').HeadcountBudgetService)(this.db).effective(id);
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

    });
  }
  /**
   * Reassign recruiter or resolve handover requirement (S1-10)
   */
  async reassignHandover(requisitionId, newRecruiterId, notes = '', actor = null) {
    if(actor)return this.db.transaction(async()=>{
      const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,'requisition.edit');
      if(!fresh||!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))return{success:false,statusCode:403,code:'REQUISITION_ASSIGN_FORBIDDEN',message:'Bạn không có quyền phân công người phụ trách.'};
      const current=await this.db.prepare('SELECT status FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(requisitionId);
      if(!current)return{success:false,statusCode:404,code:'REQUISITION_NOT_FOUND',message:'Không tìm thấy yêu cầu tuyển dụng.'};
      if(!['OPEN','IN_PROGRESS'].includes(current.status))return{success:false,statusCode:409,code:'REQUISITION_EDIT_STATE_FORBIDDEN',message:'Yêu cầu tuyển dụng đang ở trạng thái không cho phép chỉnh sửa.'};
      if(!await this.db.prepare("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.status='ACTIVE' AND r.code='RECRUITER'").get(newRecruiterId))return{success:false,statusCode:400,code:'INVALID_RECRUITER',message:'Người phụ trách phải là Recruiter đang hoạt động.'};
      if(require('../config/config').REQUISITION_OPERATIONS_ENABLED){await this.synchronizePrimaryRecruiter(requisitionId,newRecruiterId,fresh,notes);await this.db.prepare("UPDATE requisitions SET handover_required=FALSE,handover_notes=?,updated_at=datetime('now') WHERE id=?").run(notes||'Đã bàn giao cho nhân sự mới',requisitionId);return{success:true,statusCode:200,message:'Phân công lại vị trí tuyển dụng và hoàn tất bàn giao thành công.'};}
      return this.reassignHandover(requisitionId,newRecruiterId,notes,null);
    });
    if (!requisitionId) {
      return { success: false, statusCode: 400, message: 'Thiếu ID vị trí cần phân công.' };
    }

    const updateStmt = this.db.prepare(`
      UPDATE requisitions
      SET recruiter_id = ?, handover_required = FALSE, handover_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = (await updateStmt.run(newRecruiterId, notes || 'Đã bàn giao cho nhân sự mới', requisitionId));
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
  async getRequisitionById(id) {
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
    const r = (await stmt.get(id));
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
  async updateRequisition(id, data = {}, actor = null, options = {}) {
    if(require('../config/config').REQUISITION_LIFECYCLE_ENABLED&&['CLOSED','PAUSED','CANCELLED'].includes(typeof data.status==='string'?data.status.trim().toUpperCase():data.status))return{success:false,statusCode:409,code:'REQUISITION_LIFECYCLE_ACTION_REQUIRED',message:'Vui lòng dùng thao tác vòng đời với lý do và kiểm tra pipeline.'};
    if (actor) return this.db.transaction(async () => {
      const initial = await this.getRequisitionById(id);
      const rbac = new (require('../middlewares/rbacMiddleware'))(this.db);
      const fresh = await rbac.getAuthorizedActor(actor.id,initial?.status==='DRAFT'?'requisition.draft.edit':'requisition.edit');
      if (!fresh) return {success:false,statusCode:403,code:'REQUISITION_EDIT_FORBIDDEN',message:'Bạn không có quyền chỉnh sửa yêu cầu tuyển dụng này.'};
      actor = {...actor,...fresh};
      await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(id);
      const current = await this.getRequisitionById(id);
      const access = await this.requisitionAccess(current,actor,true,options.approvalEnabled);
      if (!access.success) return access;
      if (data.expectedOperationVersion && data.expectedOperationVersion!==this.operationContentHash(current)) return {success:false,statusCode:409,code:'REQUISITION_REVISION_STALE',message:'Yêu cầu đã được cập nhật bởi người khác. Vui lòng tải lại.'};
      data={...data};delete data.expectedOperationVersion;
      if (current.status==='OPEN') return this.updateOpenRequisition(current,data,actor,access,options);
      if (current.formVersion==='S2-10' || this.isS210Request(data)) return this.saveS210Requisition(current,data,actor);
      return this.updateRequisition(id,data,null,options);
    });
    if (!id) {
      return {
        success: false,
        statusCode: 400,
        message: 'Thiếu mã vị trí cần cập nhật.'
      };
    }

    const current = (await this.getRequisitionById(id));

    if (!current) {
      return {
        success: false,
        statusCode: 404,
        message: 'Không tìm thấy vị trí tuyển dụng.'
      };
    }

    if (current.formVersion === 'S2-10' || this.isS210Request(data)) {
      return (await this.saveS210Requisition(current, data, actor));
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

    const workCatalogValidation = (await this.validateRequisitionCatalogs(
      validateWorkLocationId,
      validateWorkModeId
    ));
    if (!workCatalogValidation.success) return workCatalogValidation;

    const requestedJobTitleId = typeof data.jobTitleId === 'string'
      ? data.jobTitleId.trim()
      : '';

    if (requestedJobTitleId) {
      const jobTitle = (await this.db.prepare(`
        SELECT id, status, framework_id
        FROM job_titles
        WHERE id = ?
      `).get(requestedJobTitleId));

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
      const department = (await this.db.prepare(`
            SELECT id, name, manager_id, status
            FROM departments
            WHERE id = ?
          `).get(requestedDepartmentId));

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

    (await stmt.run(
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
    ));

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật vị trí tuyển dụng thành công.',
      data: (await this.getRequisitionById(id))
    };
  }
  isS210Request(data) {
    return data && (data.formVersion === 'S2-10' || data.status === 'DRAFT' ||
      ['recruitmentReason', 'proposedSalaryMin', 'proposedSalaryMax', 'neededDate',
        'jobDescription', 'candidateRequirements', 'salaryJustification'].some(key => Object.hasOwn(data, key)));
  }

  s210Fields(row) {
    if (!row.s210_version) return row.created_by?{createdBy:row.created_by}:{};
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

  async checkS210SalaryRange(data) {
    // Read-only preview: the caller cannot disable justification on a write request.
    const validation = (await this.validateS210({ status: 'DRAFT', jobTitleId: data.jobTitleId,
      proposedSalaryMin: data.proposedSalaryMin, proposedSalaryMax: data.proposedSalaryMax }, null, null, { requireJustification: false }));
    if (!validation.success) return validation;
    if (!validation.jobTitle || validation.values.proposedSalaryMin === null || validation.values.proposedSalaryMax === null) {
      return { success: false, statusCode: 400, code: 'MISSING_SALARY_CHECK_FIELD', message: 'Chọn chức danh và nhập đủ dải lương đề xuất để kiểm tra.' };
    }
    if (validation.jobTitle.min_salary === null || validation.jobTitle.max_salary === null) return this.unavailableS210SalaryRange();
    // Explicitly return only the classification, never the job title's standard values.
    return { success: true, statusCode: 200, salaryRangeStatus: validation.salaryRangeStatus };
  }

  async validateS210(data, current = null, actor = null, { requireJustification = true } = {}) {
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
    const jobTitle = values.jobTitleId ? (await this.db.prepare('SELECT id, name, min_salary, max_salary, status FROM job_titles WHERE id = ?').get(values.jobTitleId)) : null;
    if (values.jobTitleId && (!jobTitle || jobTitle.status !== 'ACTIVE')) return fail('INVALID_JOB_TITLE', 'Chức danh không tồn tại hoặc đã ngừng áp dụng.');
    const department = values.departmentId ? (await this.db.prepare('SELECT id, name, manager_id, status FROM departments WHERE id = ?').get(values.departmentId)) : null;
    if (values.departmentId && (!department || department.status !== 'ACTIVE')) return fail('INVALID_DEPARTMENT', 'Phòng ban không tồn tại hoặc đã ngừng áp dụng.');
    if (department && actor && !actor.roles.some(role=>['HR_MANAGER','ADMIN'].includes(role)) && department.manager_id !== actor.id) return { success: false, statusCode: 403, code: 'REQUISITION_DEPARTMENT_FORBIDDEN', message: 'Bạn chỉ được tạo yêu cầu cho phòng ban mình phụ trách.' };
    const catalogResult = (await this.validateRequisitionCatalogs(values.workLocationId, values.workModeId));
    if (!catalogResult.success) return catalogResult;
    if(actor&&Object.hasOwn(data,'recruiterId')&&(values.recruiterId||null)!==(current?.recruiterId||null)&&!actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))return{success:false,statusCode:403,code:'REQUISITION_ASSIGN_FORBIDDEN',message:'Bạn không có quyền phân công recruiter.'};
    if(values.recruiterId&&(!current||values.recruiterId!==current.recruiterId)&&!await this.db.prepare("SELECT u.id FROM users u WHERE u.id=? AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='RECRUITER')").get(values.recruiterId))return fail('INVALID_RECRUITER','Người phụ trách phải là Recruiter đang hoạt động.');
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

  async saveS210Requisition(current, data, actor) {
    return this.db.transaction(async () => {
      if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('requisition-code');
    if (current?.status === 'DRAFT' && actor && current.createdBy !== actor.id) {
      return { success: false, statusCode: 403, code: 'REQUISITION_DRAFT_FORBIDDEN', message: 'Bạn chỉ được sửa nháp do mình tạo.' };
    }
    const validation = (await this.validateS210(data, current, actor));
    if (!validation.success) return validation;
    const { values: v, status, jobTitle, department } = validation;
    const title = v.title || jobTitle?.name || '';
    const headcount = v.headcount ?? 0; // Existing NOT NULL column: zero denotes an unentered draft quantity only.
    const id = current?.id || 'req-' + crypto.randomUUID();
    const createdBy = current?.createdBy || actor?.id || null;
    const manager = department?.manager_id || null;
    const persistedRecruiterId=actor&&require('../config/config').REQUISITION_OPERATIONS_ENABLED?current?.recruiterId||null:v.recruiterId;
    if (current) {
      (await this.db.prepare(`UPDATE requisitions SET title=?, job_title_id=?, department_id=?, department_name=?,
        headcount=?, hiring_manager_id=?, recruiter_id=?, work_location_id=?, work_mode_id=?, status=?,
        s210_version=1, created_by=?, recruitment_reason=?, proposed_salary_min=?, proposed_salary_max=?,
        needed_date=?, job_description=?, candidate_requirements=?, salary_justification=?, updated_at=datetime('now') WHERE id=?`)
        .run(title, v.jobTitleId, v.departmentId, department?.name || '', headcount, manager,
          persistedRecruiterId, v.workLocationId, v.workModeId, status, createdBy, v.recruitmentReason,
          v.proposedSalaryMin, v.proposedSalaryMax, v.neededDate, v.jobDescription, v.candidateRequirements, v.salaryJustification, id));
    } else {
      let number = (await this.db.prepare('SELECT COUNT(*) AS count FROM requisitions').get()).count + 1;
      let code;
      do { code = `REQ-2026-${String(number++).padStart(3, '0')}`; } while ((await this.db.prepare('SELECT id FROM requisitions WHERE code=?').get(code)));
      (await this.db.prepare(`INSERT INTO requisitions (id,code,title,job_title_id,department_id,department_name,headcount,
        hiring_manager_id,recruiter_id,work_location_id,work_mode_id,status,s210_version,created_by,recruitment_reason,
        proposed_salary_min,proposed_salary_max,needed_date,job_description,candidate_requirements,salary_justification)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`)
        .run(id, code, title, v.jobTitleId, v.departmentId, department?.name || '', headcount, manager,
          persistedRecruiterId, v.workLocationId, v.workModeId, status, createdBy, v.recruitmentReason,
          v.proposedSalaryMin, v.proposedSalaryMax, v.neededDate, v.jobDescription, v.candidateRequirements, v.salaryJustification));
    }
    if(actor&&require('../config/config').REQUISITION_OPERATIONS_ENABLED&&(v.recruiterId||null)!==(current?.recruiterId||null)){await this.db.prepare('UPDATE requisitions SET recruiter_id=? WHERE id=?').run(current?.recruiterId||null,id);await this.synchronizePrimaryRecruiter(id,v.recruiterId,actor);}
    if(status==='OPEN'&&require('./headcountBudgetService').HeadcountBudgetService.enabled())await new (require('./headcountBudgetService').HeadcountBudgetService)(this.db).effective(id);
    return { success: true, statusCode: current ? 200 : 201, message: status === 'DRAFT' ? 'Đã lưu nháp yêu cầu tuyển dụng.' : 'Đã lưu yêu cầu tuyển dụng.',
      ...(validation.salaryRangeStatus ? { salaryRangeStatus: validation.salaryRangeStatus } : {}), data: (await this.getRequisitionById(id)) };

    });
  }

  async validateRequisitionCatalogs(workLocationId, workModeId) {
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

      const item = (await this.db.prepare(`
        SELECT id
        FROM recruitment_catalog_items
        WHERE id = ?
          AND type = ?
          AND status = 'ACTIVE'
      `).get(check.id, check.type));

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
  async getDashboardStats(options = {}) {
    if (options.viewer && !options.viewer.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))) return this.scopedDashboardStats(options);
    // 1. User stats
    const userStats = (await this.db.prepare(`
      SELECT
        COUNT(*) AS total_users,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_users,
        SUM(CASE WHEN status = 'LOCKED' THEN 1 ELSE 0 END) AS locked_users
      FROM users
    `).get());

    // 2. Active sessions count
    const sessionStats = (await this.db.prepare(`
      SELECT COUNT(*) AS active_sessions
      FROM sessions
      WHERE datetime(expires_at) > datetime('now')
    `).get());

    // 3. Requisition stats
    const reqStats = (await this.db.prepare(`
      SELECT
        COUNT(*) AS total_requisitions,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_requisitions,
        SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_requisitions,
        SUM(CASE WHEN handover_required = TRUE THEN 1 ELSE 0 END) AS handover_alerts,
        SUM(headcount) AS total_headcount
      FROM requisitions
    `).get());

    // 4. Candidate stats & Funnel
    let candStats = { total: 0, new: 0, screening: 0, interview: 0, offer: 0, hired: 0 };
    try {
      const cRow = (await this.db.prepare(`
        SELECT
          COUNT(*) AS total_candidates,
          SUM(CASE WHEN stage = 'NEW' THEN 1 ELSE 0 END) AS stage_new,
          SUM(CASE WHEN stage = 'SCREENING' THEN 1 ELSE 0 END) AS stage_screening,
          SUM(CASE WHEN stage = 'INTERVIEW' THEN 1 ELSE 0 END) AS stage_interview,
          SUM(CASE WHEN stage = 'OFFER' THEN 1 ELSE 0 END) AS stage_offer,
          SUM(CASE WHEN stage = 'HIRED' THEN 1 ELSE 0 END) AS stage_hired
        FROM candidates
      `).get());
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
      const iRow = (await this.db.prepare(`
        SELECT COUNT(*) AS c FROM interviews WHERE status = 'SCHEDULED'
      `).get());
      if (iRow) upcomingInterviewsCount = iRow.c || 0;
    } catch (e) {}

    // 6. Department breakdown
    let departmentBreakdown = [];
    try {
      departmentBreakdown = (await this.db.prepare(`
        SELECT department_name, COUNT(*) AS req_count, SUM(headcount) AS total_headcount
        FROM requisitions
        GROUP BY department_name
        ORDER BY req_count DESC
      `).all());
    } catch (e) {}

    // 7. Recent recruitment activities (from real SQLite records)
    const recentActivities = [];
    try {
      const recentCands = (await this.db.prepare(`
        SELECT c.full_name, c.stage, c.created_at, r.title AS req_title
        FROM candidates c
        LEFT JOIN requisitions r ON c.requisition_id = r.id
        ORDER BY c.created_at DESC LIMIT 3
      `).all());
      recentCands.forEach(c => {
        recentActivities.push({
          type: 'CANDIDATE',
          title: `${c.full_name} ứng tuyển vào ${c.req_title || 'vị trí tuyển dụng'}`,
          meta: `Giai đoạn: ${c.stage}`,
          timestamp: c.created_at
        });
      });

      const recentInts = (await this.db.prepare(`
        SELECT i.round_name, i.scheduled_time, i.status, c.full_name AS cand_name, u.full_name AS interviewer_name
        FROM interviews i
        LEFT JOIN candidates c ON i.candidate_id = c.id
        LEFT JOIN users u ON i.interviewer_id = u.id
        ORDER BY i.created_at DESC LIMIT 2
      `).all());
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
    const recentRequisitions = (await this.db.prepare(`
      SELECT r.id, r.code, r.title, r.department_name, r.headcount, r.status, r.handover_required, rec.full_name AS recruiter_name
      FROM requisitions r
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      ORDER BY r.handover_required DESC, r.created_at DESC
      LIMIT 5
    `).all());

    // 9. Recent audit logs
    const recentAudit = (await this.db.prepare(`
      SELECT email, status, reason, attempted_at
      FROM login_audit_logs
      ORDER BY attempted_at DESC
      LIMIT 5
    `).all());

    // 10. Role distribution
    const roleDistribution = (await this.db.prepare(`
      SELECT r.code, r.name, COUNT(ur.user_id) AS user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.id
      ORDER BY user_count DESC
    `).all());

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
  hiringRequisitionScope() {
    return '(r.hiring_manager_id=? OR r.created_by=? OR EXISTS (SELECT 1 FROM departments scope_department WHERE scope_department.id=r.department_id AND scope_department.manager_id=?))';
  }

  async updateOpenRequisition(current,data,actor,access,options) {
    const fail = (statusCode,code,message) => ({success:false,statusCode,code,message});
    if(require('../config/config').REQUISITION_LIFECYCLE_ENABLED&&data.status&&data.status!==current.status&&data.status==='CLOSED')return fail(409,'REQUISITION_LIFECYCLE_ACTION_REQUIRED','Vui lòng dùng thao tác Đã tuyển đủ với lý do và kiểm tra pipeline.');
    const protectedFields = Object.keys(data).filter(key=>!['handoverNotes','recruiterId',...access.significantFields,'formVersion','status'].includes(key));
    if (protectedFields.length) return fail(403,'REQUISITION_EDIT_FIELD_FORBIDDEN','Bạn không có quyền chỉnh sửa trường dữ liệu này.');
    if (data.status && data.status!==current.status && !actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))) return fail(409,'REQUISITION_EDIT_STATE_FORBIDDEN','Yêu cầu tuyển dụng đang ở trạng thái không cho phép chỉnh sửa.');
    if (data.status && !['OPEN','IN_PROGRESS','CLOSED'].includes(data.status)) return fail(400,'INVALID_REQUISITION_STATUS','Trạng thái yêu cầu tuyển dụng không hợp lệ.');
    const numericFields=['headcount','proposedSalaryMin','proposedSalaryMax'];
    const changedValue=(key,value)=>numericFields.includes(key)&&value!==null&&value!==''?Number(value):typeof value==='string'?value.trim():value;
    let normalized = Object.fromEntries(Object.entries(data).map(([key,value])=>[key,changedValue(key,value)]));
    const significantRaw = access.significantFields.filter(key=>Object.hasOwn(data,key)&&(normalized[key]??'')!==(current[key]??''));
    if (current.formVersion==='S2-10' && significantRaw.length) {
      const validation = await this.validateS210({...data,status:'OPEN'},current,actor);
      if (!validation.success) return validation;
      normalized = {...data,...validation.values};
    }
    const significant = access.significantFields.filter(key=>Object.hasOwn(data,key) && (normalized[key]??'')!==(current[key]??''));
    if (significant.length) {
      if (actor.roles.includes('RECRUITER') && !actor.roles.some(role=>['ADMIN','HR_MANAGER','HIRING_MGR'].includes(role))) return fail(403,'REQUISITION_EDIT_FIELD_FORBIDDEN','Bạn không có quyền chỉnh sửa nội dung tuyển dụng này.');
      const workflow = options.approvalEnabled ? await this.db.prepare('SELECT id,status,version,creator_id FROM requisition_approval_workflows WHERE requisition_id=?').get(current.id) : null;
      return {...fail(409,'REQUISITION_REAPPROVAL_REQUIRED','Thay đổi này ảnh hưởng đến nội dung đã phê duyệt và cần được gửi phê duyệt lại.'),changedFields:significant,workflowId:workflow?.id||null,workflowStatus:workflow?.status||null,expectedVersion:workflow?.version||null,approvalEnabled:Boolean(options.approvalEnabled),creatorId:current.createdBy};
    }
    if (Object.hasOwn(data,'handoverNotes') && data.handoverNotes!==null && typeof data.handoverNotes!=='string') return fail(400,'INVALID_HANDOVER_NOTES','Ghi chú vận hành phải là nội dung văn bản.');
    if (Object.hasOwn(data,'recruiterId') && (data.recruiterId||null)!==(current.recruiterId||current.recruiter?.id||null)) {
      if (!access.operationalFields.includes('recruiterId')) return fail(403,'REQUISITION_EDIT_FIELD_FORBIDDEN','Bạn không có quyền phân công người phụ trách.');
      if (data.recruiterId && !await this.db.prepare("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.status='ACTIVE' AND r.code='RECRUITER'").get(data.recruiterId)) return fail(400,'INVALID_RECRUITER','Người phụ trách phải là Recruiter đang hoạt động.');
    }
    if(Object.hasOwn(data,'recruiterId')&&(data.recruiterId||null)!==(current.recruiterId||null)&&require('../config/config').REQUISITION_OPERATIONS_ENABLED)await this.synchronizePrimaryRecruiter(current.id,data.recruiterId,actor,data.handoverNotes);
    await this.db.prepare("UPDATE requisitions SET handover_notes=?,recruiter_id=?,status=?,updated_at=datetime('now') WHERE id=?").run(Object.hasOwn(data,'handoverNotes')?data.handoverNotes:current.handoverNotes,Object.hasOwn(data,'recruiterId')?data.recruiterId||null:current.recruiterId,data.status||current.status,current.id);
    return {success:true,statusCode:200,message:'Đã cập nhật thông tin vận hành.',data:await this.getRequisitionById(current.id)};
  }

  requisitionVisibility(viewer, approvalEnabled = false) {
    if (!viewer || viewer.roles?.some(role => ['ADMIN','HR_MANAGER'].includes(role))) return null;
    const conditions = [], params = [];
    if (viewer.roles?.includes('HIRING_MGR')) { conditions.push(this.hiringRequisitionScope()); params.push(viewer.id,viewer.id,viewer.id); }
    if (viewer.roles?.includes('RECRUITER')) { const scope=this.recruiterScope('r',viewer.id);conditions.push(scope.condition);params.push(...scope.params); }
    if (approvalEnabled && viewer.roles?.includes('APPROVER')) {
      conditions.push('EXISTS (SELECT 1 FROM requisition_approval_workflows scope_workflow JOIN requisition_approval_steps scope_step ON scope_step.submission_id=scope_workflow.current_submission_id WHERE scope_workflow.requisition_id=r.id AND scope_step.approver_id=?)'); params.push(viewer.id);
    }
    return { condition: conditions.length ? '('+conditions.join(' OR ')+')' : '1=0', params };
  }

  async requisitionAccess(item, user, edit = false, approvalEnabled = false) {
    const fail = (statusCode,code,message) => ({success:false,statusCode,code,message});
    if (!item) return fail(404,'REQUISITION_NOT_FOUND','Không tìm thấy yêu cầu tuyển dụng.');
    if (item.formVersion === 'S2-10' && item.status === 'DRAFT' && item.createdBy !== user.id) return fail(403,'REQUISITION_DRAFT_FORBIDDEN','Bạn chỉ được đọc hoặc sửa nháp do mình tạo.');
    const visibility = this.requisitionVisibility(user,approvalEnabled);
    if (visibility && !await this.db.prepare('SELECT 1 FROM requisitions r WHERE r.id=? AND '+visibility.condition).get(item.id,...visibility.params)) return fail(403,'REQUISITION_OUT_OF_SCOPE','Yêu cầu tuyển dụng này không thuộc phạm vi quản lý hoặc quyền chỉnh sửa của bạn.');
    if (!edit) return {success:true};
    if (!await new (require('../middlewares/rbacMiddleware'))(this.db).hasPermission(user.id,item.status==='DRAFT'?'requisition.draft.edit':'requisition.edit')) return fail(403,'REQUISITION_EDIT_FORBIDDEN','Bạn không có quyền chỉnh sửa yêu cầu tuyển dụng này.');
    if (!['DRAFT','OPEN'].includes(item.status)) return fail(409,'REQUISITION_EDIT_STATE_FORBIDDEN','Yêu cầu tuyển dụng đang ở trạng thái không cho phép chỉnh sửa.');
    return {success:true,editVersion:this.approvalContentHash(item),operationVersion:this.operationContentHash(item),canEdit:true,canChangeSignificant:user.roles.some(role=>['ADMIN','HR_MANAGER','HIRING_MGR'].includes(role)),operationalFields:user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))?['handoverNotes','recruiterId','status']:['handoverNotes'],significantFields:['title','jobTitleId','departmentId','departmentName','headcount','recruitmentReason','proposedSalaryMin','proposedSalaryMax','salaryJustification','neededDate','jobDescription','candidateRequirements','workLocationId','workModeId']};
  }

  async canReadHiringRequisition(id, userId) {
    return Boolean(await this.db.prepare('SELECT 1 FROM requisitions r WHERE r.id=? AND ' + this.hiringRequisitionScope()).get(id, userId, userId, userId));
  }

  approvalContent(item) {
    return Object.fromEntries(['title','jobTitleId','departmentId','departmentName','headcount','recruitmentReason','proposedSalaryMin','proposedSalaryMax','salaryJustification','neededDate','jobDescription','candidateRequirements','workLocationId','workModeId'].map(key=>[key,item[key]??null]));
  }

  approvalContentHash(item) {
    return crypto.createHash('sha256').update(JSON.stringify(this.approvalContent(item))).digest('hex');
  }

  operationContentHash(item) {
    return crypto.createHash('sha256').update(JSON.stringify({...this.approvalContent(item),status:item.status,recruiterId:item.recruiterId,handoverNotes:item.handoverNotes})).digest('hex');
  }

  recruiterScope(alias,userId){const supports=require('../config/config').REQUISITION_OPERATIONS_ENABLED===true;return{condition:'('+alias+'.recruiter_id=?'+(supports?' OR EXISTS (SELECT 1 FROM requisition_recruiter_supports recruiter_support WHERE recruiter_support.requisition_id='+alias+'.id AND recruiter_support.user_id=?)':'')+')',params:supports?[userId,userId]:[userId]};}

  async synchronizePrimaryRecruiter(id,primary,actor,reason=null){const operations=new(require('./requisitionOperationsService').RequisitionOperationsService)(this.db),version=(await this.db.prepare('SELECT version FROM requisition_assignment_versions WHERE requisition_id=?').get(id))?.version||0,supports=await this.db.prepare('SELECT user_id FROM requisition_recruiter_supports WHERE requisition_id=? ORDER BY user_id').all(id);return operations.assign(id,{requestId:crypto.randomUUID(),expectedVersion:version,primaryRecruiterId:primary||null,supportRecruiterIds:supports.map(row=>row.user_id).filter(userId=>userId!==primary),reason},actor);}

  async recruiterAssigned(requisitionId,userId){if(this.db.provider==='postgres')await this.db.prepare('SELECT id FROM requisitions WHERE id=? FOR SHARE').get(requisitionId);const scope=this.recruiterScope('r',userId);return !!await this.db.prepare('SELECT r.id FROM requisitions r WHERE r.id=? AND '+scope.condition).get(requisitionId,...scope.params);}

  async candidateAccess(id,actor,permission='candidate.read'){
    const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor?.id,permission);
    if(!fresh)return{success:false,statusCode:403,code:'CANDIDATE_FORBIDDEN',message:'Bạn không có quyền thao tác hồ sơ ứng viên.'};
    const row=await this.db.prepare('SELECT id,requisition_id FROM candidates WHERE id=?').get(id);
    if(!row)return{success:false,statusCode:404,code:'CANDIDATE_NOT_FOUND',message:'Không tìm thấy hồ sơ ứng viên.'};
    if(!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))&&(!fresh.roles.includes('RECRUITER')||!await this.recruiterAssigned(row.requisition_id,fresh.id)))return{success:false,statusCode:403,code:'CANDIDATE_OUT_OF_SCOPE',message:'Hồ sơ ứng viên không thuộc vị trí bạn đang được phân công.'};
    return{success:true,actor:fresh,row};
  }

  async getCandidateById(id,viewer){const result=await this.getCandidates({viewer,candidateId:id});if(!result.success)return result;if(!result.candidates.length)return{success:false,statusCode:403,code:'CANDIDATE_OUT_OF_SCOPE',message:'Hồ sơ ứng viên không thuộc phạm vi truy cập của bạn.'};return{success:true,data:result.candidates[0]};}

  candidateVisibility(viewer) {
    if (!viewer || viewer.roles?.some(role => ['ADMIN', 'HR_MANAGER', 'APPROVER'].includes(role))) return null;
    const conditions = [], params = [];
    if(viewer.roles?.includes('RECRUITER')){const scope=this.recruiterScope('r',viewer.id);conditions.push(scope.condition);params.push(...scope.params);}
    if (viewer.roles?.includes('HIRING_MGR')) {
      conditions.push(this.hiringRequisitionScope());
      params.push(viewer.id, viewer.id, viewer.id);
    }
    if (viewer.roles?.includes('INTERVIEWER')) {
      conditions.push('EXISTS (SELECT 1 FROM interviews scope_interview WHERE scope_interview.candidate_id=c.id AND scope_interview.interviewer_id=?)');
      params.push(viewer.id);
    }
    if (viewer.roles?.includes('CANDIDATE')) {
      conditions.push('LOWER(c.email)=LOWER(?)');
      params.push(viewer.email);
    }
    return { condition: conditions.length ? '(' + conditions.join(' OR ') + ')' : '1=0', params };
  }

  async getCandidates(options = {}) {
    if(options.viewer){const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(options.viewer.id,'candidate.read');if(!fresh)return{success:false,statusCode:403,code:'CANDIDATE_FORBIDDEN',message:'Bạn không có quyền xem hồ sơ ứng viên.',candidates:[]};options={...options,viewer:fresh};}
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const stage = typeof options.stage === 'string' ? options.stage.trim() : 'ALL';
    const reqId = typeof options.requisitionId === 'string' ? options.requisitionId.trim() : 'ALL';

    const conditions = [];
    const params = [];
    if(options.candidateId){conditions.push('c.id=?');params.push(options.candidateId);}

    const visibility = this.candidateVisibility(options.viewer);
    if (visibility) {
      conditions.push(visibility.condition);
      params.push(...visibility.params);
    }

    if (options.candidateEmail) {
      conditions.push('LOWER(c.email) = LOWER(?)');
      params.push(options.candidateEmail);
    }

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

    const rows = (await stmt.all(...params));
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
  async getInterviews(options = {}) {
    if(options.viewer){const fresh=await new(require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(options.viewer.id,options.evaluationsOnly?'interview.evaluation.read':'interview.read');if(!fresh)return{success:false,statusCode:403,code:'INTERVIEW_FORBIDDEN',message:'Bạn không có quyền xem lịch phỏng vấn.',interviews:[]};options={...options,viewer:fresh};}
    const conditions=[],params=[];
    if (options.candidateEmail) { conditions.push('LOWER(c.email)=LOWER(?)');params.push(options.candidateEmail); }
    const viewer=options.viewer;
    if (viewer && !viewer.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)) && !(options.evaluationsOnly && viewer.roles.includes('APPROVER'))) {
      const scopes=[];
      if (viewer.roles.includes('HIRING_MGR')) {scopes.push(this.hiringRequisitionScope());params.push(viewer.id,viewer.id,viewer.id);}
      if(viewer.roles.includes('RECRUITER')){const scope=this.recruiterScope('r',viewer.id),candidateScope=this.recruiterScope('candidate_position',viewer.id);scopes.push('('+scope.condition+' AND EXISTS(SELECT 1 FROM requisitions candidate_position WHERE candidate_position.id=c.requisition_id AND '+candidateScope.condition+'))');params.push(...scope.params,...candidateScope.params);}
      if (viewer.roles.includes('INTERVIEWER')) {scopes.push('i.interviewer_id=?');params.push(viewer.id);}
      if (viewer.roles.includes('CANDIDATE')) {scopes.push('LOWER(c.email)=LOWER(?)');params.push(viewer.email);}
      conditions.push(scopes.length?'('+scopes.join(' OR ')+')':'1=0');
    }
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
      LEFT JOIN requisitions r ON COALESCE(i.requisition_id,c.requisition_id) = r.id
      LEFT JOIN users u ON i.interviewer_id = u.id
      ${conditions.length?'WHERE '+conditions.join(' AND '):''}
      ORDER BY i.scheduled_time DESC
    `);

    const rows = (await stmt.all(...params));
    return {
      success: true,
      total: rows.length,
      interviews: rows.map(r => ({
        id: r.id,
        roundName: r.round_name,
        scheduledTime: r.scheduled_time,
        locationOrLink: r.location_or_link,
        status: r.status,
        feedback: viewer?.roles.every(role=>role==='CANDIDATE')?null:r.feedback,
        score: viewer?.roles.every(role=>role==='CANDIDATE')?null:r.score,
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
  async getOffers(options = {}) {
    if(options.viewer){const fresh=await new(require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(options.viewer.id,'offer.read');if(!fresh)return{success:false,statusCode:403,code:'OFFER_FORBIDDEN',message:'Bạn không có quyền xem Offer.',offers:[]};options={...options,viewer:fresh};}
    const conditions=[],params=[];
    if(options.candidateEmail){conditions.push('LOWER(c.email)=LOWER(?)');params.push(options.candidateEmail);}
    const viewer=options.viewer;
    if(viewer&&!viewer.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){
      const scopes=[];
      if(viewer.roles.includes('HIRING_MGR')){scopes.push(this.hiringRequisitionScope());params.push(viewer.id,viewer.id,viewer.id);}
      if(viewer.roles.includes('RECRUITER')){const scope=this.recruiterScope('r',viewer.id),candidateScope=this.recruiterScope('candidate_position',viewer.id);scopes.push('('+scope.condition+' AND EXISTS(SELECT 1 FROM requisitions candidate_position WHERE candidate_position.id=c.requisition_id AND '+candidateScope.condition+'))');params.push(...scope.params,...candidateScope.params);}
      if(viewer.roles.includes('APPROVER')){scopes.push('o.approver_id=?');params.push(viewer.id);}
      if(viewer.roles.includes('CANDIDATE')){scopes.push('LOWER(c.email)=LOWER(?)');params.push(viewer.email);}
      conditions.push(scopes.length?'('+scopes.join(' OR ')+')':'1=0');
    }
    const stmt = this.db.prepare(`
      SELECT
        o.id,
        o.salary_monthly,
        o.start_date,
        o.status,
        r.recruiter_id AS responsible_recruiter_id,
        CASE WHEN ${viewer?.roles.includes('RECRUITER')?this.recruiterScope('r',viewer.id).condition:'1=0'} THEN 1 ELSE 0 END AS in_recruiter_scope,
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
      LEFT JOIN requisitions r ON COALESCE(o.requisition_id,c.requisition_id) = r.id
      LEFT JOIN users u ON o.approver_id = u.id
      ${conditions.length?'WHERE '+conditions.join(' AND '):''}
      ORDER BY o.created_at DESC
    `);

    const rows = (await stmt.all(...(viewer?.roles.includes('RECRUITER')?this.recruiterScope('r',viewer.id).params:[]),...params));
    return {
      success: true,
      total: rows.length,
      offers: rows.map(r => ({
        id: r.id,
        ...(viewer?{capabilities:{canApprove:viewer.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))||viewer.roles.includes('APPROVER')&&r.approver_id===viewer.id,canSend:viewer.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))||viewer.roles.includes('RECRUITER')&&r.in_recruiter_scope===1,canAccept:viewer.roles.every(role=>role==='CANDIDATE')&&r.candidate_email.toLowerCase()===viewer.email.toLowerCase()}}:{}),
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
  async scopedDashboardStats(options) {
    const viewer=options.viewer;
    const globalReport=viewer.roles.includes('APPROVER');
    const requests=await this.getRequisitions(globalReport?{}:{viewer,approvalEnabled:options.approvalEnabled});
    requests.items=requests.items.filter(row=>row.status!=='DRAFT'||row.createdBy===viewer.id);requests.total=requests.items.length;
    const ids=new Set(requests.items.map(row=>row.id));
    const candidates=(await this.getCandidates(globalReport?{}:{viewer})).candidates.filter(row=>ids.has(row.requisition?.id));
    const interviews=(await this.getInterviews(globalReport?{}:{viewer})).interviews.filter(row=>ids.has(row.requisition?.id));
    const reqs={total:requests.total,open:0,inProgress:0,handoverAlerts:0,totalHeadcount:0};
    const groups=new Map();
    for(const row of requests.items){if(row.status==='OPEN')reqs.open++;if(row.status==='IN_PROGRESS')reqs.inProgress++;if(row.handoverRequired)reqs.handoverAlerts++;reqs.totalHeadcount+=row.headcount||0;const group=groups.get(row.departmentName)||{department_name:row.departmentName,req_count:0,total_headcount:0};group.req_count++;group.total_headcount+=row.headcount||0;groups.set(row.departmentName,group);}
    const pipeline={total:candidates.length,new:0,screening:0,interview:0,offer:0,hired:0};
    for(const row of candidates){const key=row.stage.toLowerCase();if(Object.hasOwn(pipeline,key))pipeline[key]++;}
    return {success:true,stats:{users:{total:0,active:0,locked:0},sessions:{activeCount:0},requisitions:reqs,candidates:pipeline,upcomingInterviews:interviews.filter(row=>row.status==='SCHEDULED').length,departmentBreakdown:[...groups.values()],recentActivities:candidates.slice(0,3).map(row=>({type:'CANDIDATE',title:row.fullName+' ứng tuyển vào '+row.requisition.title,meta:'Giai đoạn: '+row.stage,timestamp:row.createdAt})),roleDistribution:[],recentRequisitions:requests.items.slice(0,5).map(row=>({id:row.id,code:row.code,title:row.title,department_name:row.departmentName,headcount:row.headcount,status:row.status,handover_required:row.handoverRequired,recruiter_name:row.recruiterName})),recentAudit:[]}};
  }

  async getReports(options = {}) {
    const stats = (await this.getDashboardStats(options));
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

  async validateCandidateCatalog(id, expectedType) {
    if (!id) return { success: true };

    const item = (await this.db.prepare(`
      SELECT id
      FROM recruitment_catalog_items
      WHERE id = ?
        AND type = ?
        AND status = 'ACTIVE'
    `).get(id, expectedType));

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
  validateCandidateStage(stage) {
    return candidateStages.includes(stage)
      ? { success: true }
      : { success: false, statusCode: 400, code: 'INVALID_CANDIDATE_STAGE', message: 'Giai đoạn không hợp lệ.' };
  }

  async createCandidate(data = {},actor=null,withinTransaction=false) {
    const stage = data.stage || 'NEW';
    const stageValidation = this.validateCandidateStage(stage);
    if (!stageValidation.success) return stageValidation;
    if(!actor&&!withinTransaction)return this.db.transaction(()=>this.createCandidate(data,null,true));
    if(actor)return this.db.transaction(async()=>{const fresh=await new(require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,'candidate.create');if(!fresh)return{success:false,statusCode:403,code:'CANDIDATE_FORBIDDEN',message:'Bạn không có quyền tạo hồ sơ ứng viên.'};if(fresh.roles.every(role=>role==='CANDIDATE')||fresh.roles.includes('CANDIDATE')&&!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))&&typeof data.email==='string'&&data.email.trim().toLowerCase()===fresh.email.toLowerCase())data={...data,email:fresh.email,fullName:fresh.fullName,stage:'NEW',notes:null,rejectionReasonId:null};else if(!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))&&(!fresh.roles.includes('RECRUITER')||!await this.recruiterAssigned(data.requisitionId,fresh.id)))return{success:false,statusCode:403,code:'CANDIDATE_OUT_OF_SCOPE',message:'Chỉ được tạo ứng viên cho vị trí bạn đang được phân công.'};return this.createCandidate(data,null,true);});
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    const requisitionId = data.requisitionId || null;
    if(requisitionId){const position=await this.db.prepare('SELECT status FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(requisitionId);if(position&&(['PAUSED','CANCELLED'].includes(position.status)||require('../config/config').REQUISITION_LIFECYCLE_ENABLED&&!['OPEN','IN_PROGRESS'].includes(position.status)))return{success:false,statusCode:409,code:'REQUISITION_NOT_ACCEPTING_APPLICATIONS',message:'Yêu cầu tuyển dụng hiện không nhận ứng tuyển mới.'};}
    const sourceId = data.sourceId || null;

    const sourceValidation = (await this.validateCandidateCatalog(
      sourceId,
      'CANDIDATE_SOURCE'
    ));

    if (!sourceValidation.success) return sourceValidation;
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
    (await insertStmt.run(id, fullName, email, phoneNumber, requisitionId, sourceId, stage, experienceYears, currentCompany, expectedSalary, notes));

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
  async updateCandidateStage(id, stage, notes, rejectionReasonId,actor=null) {
    if(actor)return this.db.transaction(async()=>{const access=await this.candidateAccess(id,actor,'candidate.update');if(!access.success)return access;await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(access.row.requisition_id);const checked=await this.candidateAccess(id,actor,'candidate.update');if(!checked.success)return checked;return this.updateCandidateStage(id,stage,notes,rejectionReasonId,null);});
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã ứng viên.' };
    const stageValidation = this.validateCandidateStage(stage);
    if (!stageValidation.success) return stageValidation;
    if (stage === 'REJECTED' && rejectionReasonId) {
      const reasonValidation = (await this.validateCandidateCatalog(
        rejectionReasonId,
        'REJECTION_REASON'
      ));

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

    const res = (await updateStmt.run(
      stage,
      notes || null,
      stage === 'REJECTED' && rejectionReasonId === undefined ? 1 : 0,
      rejectionReasonValue,
      id
    ));
    if (res.changes === 0) {
      return { success: false, statusCode: 404, message: 'Không tìm thấy hồ sơ ứng viên.' };
    }
    return { success: true, statusCode: 200, message: 'Cập nhật giai đoạn ứng viên thành công.' };
  }

  /**
   * Schedule new interview
   */
  async createInterview(data = {}, actor = null) {
    if(actor)return this.db.transaction(async()=>{
      const rbac=new (require('../middlewares/rbacMiddleware'))(this.db);
      if(!await rbac.getAuthorizedActor(actor.id,'interview.create'))return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền tạo lịch phỏng vấn.'};
      const candidate=await this.db.prepare('SELECT id,requisition_id FROM candidates WHERE id=?').get(data.candidateId);
      if(!candidate)return{success:false,statusCode:404,code:'CANDIDATE_NOT_FOUND',message:'Không tìm thấy ứng viên.'};
      if(candidate.requisition_id&&data.requisitionId&&candidate.requisition_id!==data.requisitionId)return{success:false,statusCode:400,code:'INTERVIEW_REQUISITION_MISMATCH',message:'Vị trí phỏng vấn không khớp hồ sơ ứng tuyển.'};
      const fresh=await rbac.getAuthorizedActor(actor.id,'interview.create');
      if(!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){const access=await this.candidateAccess(data.candidateId,fresh);if(!access.success)return access;}
      if(data.interviewerId&&!await rbac.getAuthorizedActor(data.interviewerId,'interview.evaluate'))return{success:false,statusCode:400,code:'INTERVIEW_ASSIGNEE_INVALID',message:'Người phỏng vấn phải đang hoạt động và có quyền đánh giá.'};
      return this.createInterview({...data,requisitionId:data.requisitionId||candidate.requisition_id},null);
    });
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
    (await stmt.run(id, candidateId, requisitionId, interviewerId, roundName, scheduledTime, locationOrLink));

    // Update candidate stage to INTERVIEW
    (await this.db.prepare("UPDATE candidates SET stage = 'INTERVIEW' WHERE id = ?").run(candidateId));

    return { success: true, statusCode: 201, message: 'Lên lịch phỏng vấn thành công.', data: { id } };
  }

  /**
   * Update interview status / score / feedback
   */
  async updateInterviewStatus(id, status, feedback, score, actor = null, permission = 'interview.evaluate') {
    if(actor)return this.db.transaction(async()=>{
      const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,permission);
      if(!fresh)return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền cập nhật lịch hoặc đánh giá.'};
      const row=await this.db.prepare('SELECT id,interviewer_id,candidate_id,requisition_id FROM interviews WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(id);
      if(!row)return{success:false,statusCode:404,code:'INTERVIEW_NOT_FOUND',message:'Không tìm thấy lịch phỏng vấn.'};
      if(permission==='interview.evaluate'&&!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))&&(!fresh.roles.includes('INTERVIEWER')||row.interviewer_id!==fresh.id))return{success:false,statusCode:403,code:'INTERVIEW_ASSIGNEE_REQUIRED',message:'Bạn chỉ được đánh giá vòng phỏng vấn được phân công.'};
      if(permission==='interview.update'&&!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){const access=await this.candidateAccess(row.candidate_id,fresh);if(!access.success)return access;if(!await this.recruiterAssigned(row.requisition_id||access.row.requisition_id,fresh.id))return{success:false,statusCode:403,code:'INTERVIEW_OUT_OF_SCOPE',message:'Lịch phỏng vấn không thuộc vị trí được giao.'};}
      return this.updateInterviewStatus(id,status,feedback,score,null);
    });
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã phỏng vấn.' };
    const stmt = this.db.prepare(`
      UPDATE interviews
      SET status = ?, feedback = COALESCE(?, feedback), score = COALESCE(?, score)
      WHERE id = ?
    `);
    const res = (await stmt.run(status, feedback || null, score ? parseInt(score, 10) : null, id));
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy lịch phỏng vấn.' };
    return { success: true, statusCode: 200, message: 'Cập nhật lịch phỏng vấn thành công.' };
  }

  /**
   * Create Job Offer
   */
  async createOffer(data = {}, actor = null) {
    if(actor)return this.db.transaction(async()=>{
      const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,'offer.create');
      if(!fresh)return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền soạn thảo Offer.'};
      actor={...actor,...fresh};
      const candidate=await this.db.prepare('SELECT requisition_id FROM candidates WHERE id=?').get(data.candidateId);
      if(!candidate)return{success:false,statusCode:404,code:'CANDIDATE_NOT_FOUND',message:'Không tìm thấy ứng viên.'};
      if(candidate.requisition_id&&data.requisitionId&&candidate.requisition_id!==data.requisitionId)return{success:false,statusCode:400,code:'OFFER_REQUISITION_MISMATCH',message:'Vị trí của Offer không khớp hồ sơ ứng viên.'};
      const requisitionId=data.requisitionId||candidate.requisition_id||null;
      if(!actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){const access=await this.candidateAccess(data.candidateId,actor);if(!access.success)return access;}
      if(!actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))&&!await this.recruiterAssigned(requisitionId,actor.id))return{success:false,statusCode:403,code:'OFFER_OUT_OF_SCOPE',message:'Offer không thuộc vị trí được giao cho bạn.'};
      return this.createOffer({...data,requisitionId},null);
    });
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
    (await stmt.run(id, candidateId, requisitionId, salaryMonthly, startDate, approverId));

    // Update candidate stage to OFFER
    (await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(candidateId));

    return { success: true, statusCode: 201, message: 'Khởi tạo đề xuất việc làm (Offer) thành công.', data: { id } };
  }

  /**
   * Approve / Reject Offer
   */
  async updateOfferStatus(id, status, actor = null) {
    if(actor)return this.db.transaction(async()=>{
      const candidateResponse=actor.roles.every(role=>role==='CANDIDATE')&&status==='ACCEPTED';
      const permission=candidateResponse?'offer.read':['APPROVED','REJECTED'].includes(status)?'offer.approve':'offer.create';
      const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,permission);
      if(!fresh)return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền cập nhật Offer.'};
      actor={...actor,...fresh};
      const row=await this.db.prepare('SELECT o.id,o.approver_id,o.candidate_id,c.email,r.recruiter_id,r.id AS requisition_id FROM offers o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requisitions r ON r.id=COALESCE(o.requisition_id,c.requisition_id) WHERE o.id=?'+(this.db.provider==='postgres'?' FOR UPDATE OF o':'')).get(id);
      if(!row)return{success:false,statusCode:404,code:'OFFER_NOT_FOUND',message:'Không tìm thấy Offer.'};
      if(!actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){
        if(!candidateResponse&&!['APPROVED','REJECTED'].includes(status)){const access=await this.candidateAccess(row.candidate_id,actor);if(!access.success)return access;}
        const allowed=candidateResponse?row.email.toLowerCase()===actor.email.toLowerCase():['APPROVED','REJECTED'].includes(status)?row.approver_id===actor.id:await this.recruiterAssigned(row.requisition_id,actor.id);
        if(!allowed)return{success:false,statusCode:403,code:'OFFER_OUT_OF_SCOPE',message:'Offer không thuộc phạm vi xử lý của bạn.'};
      }
      return this.updateOfferStatus(id,status,null);
    });
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã offer.' };
    const stmt = this.db.prepare(`UPDATE offers SET status = ? WHERE id = ?`);
    const res = (await stmt.run(status, id));
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy offer.' };

    if (status === 'APPROVED') {
      const off = (await this.db.prepare('SELECT candidate_id FROM offers WHERE id = ?').get(id));
      if (off && off.candidate_id) {
        (await this.db.prepare("UPDATE candidates SET stage = 'HIRED' WHERE id = ?").run(off.candidate_id));
      }
    }
    return { success: true, statusCode: 200, message: 'Cập nhật trạng thái offer thành công.' };
  }
}

module.exports = RequisitionService;
