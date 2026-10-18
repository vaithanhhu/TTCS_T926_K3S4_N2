const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const candidateStages = Object.freeze(['NEW', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']);

class RequisitionService {
  constructor(db) {
    this.db = db || getDatabase();
    this.openPolicy = new (require('./requisitionOpenPolicyService'))(this.db);
    this.offerService = new (require('./offerService'))(this.db, this);
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
    const approvalRows=require('../config/config').REQUISITION_APPROVAL_ENABLED&&rows.length?await this.db.prepare('SELECT w.requisition_id,w.status,w.version,s.approver_name FROM requisition_approval_workflows w LEFT JOIN requisition_approval_steps s ON s.submission_id=w.current_submission_id AND s.status=\'PENDING\' WHERE w.requisition_id IN ('+rows.map(()=>'?').join(',')+')').all(...rows.map(row=>row.id)):[];
    const approvalById=new Map(approvalRows.map(row=>[row.requisition_id,row]));
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
      ...(require('../config/config').REQUISITION_APPROVAL_ENABLED?{approvalStatus:approvalById.get(r.id)?.status||'NOT_SUBMITTED',approvalVersion:approvalById.get(r.id)?.version||null,waitingFor:approvalById.get(r.id)?.approver_name||null}:{}),
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
      const legacyBody=!this.isS210Request(data);
      this.openPolicy.client(data);
      if(data.status&&data.status!=='DRAFT'){this.openPolicy.enabled();this.openPolicy.fail('REQUISITION_APPROVAL_REQUIRED','Hãy lưu nháp hoặc Lưu và Gửi phê duyệt. Chỉ cấp cuối được mở tuyển dụng.');}
      if(!await this.openPolicy.available())this.openPolicy.fail('OPEN_POLICY_MIGRATION_REQUIRED','Cần áp dụng migration chính sách mở tuyển dụng.');
      data={...data,status:'DRAFT'};
      if(!data.departmentId&&typeof(data.departmentName||data.department)==='string'){const matches=await this.db.prepare("SELECT id FROM departments WHERE name=? AND status='ACTIVE'").all((data.departmentName||data.department).trim());if(matches.length===1)data.departmentId=matches[0].id;}
      if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('requisition-code');
    if (this.isS210Request(data)){const result=await this.saveS210Requisition(null,data,actor);if(result.success&&legacyBody)result.data=Object.fromEntries(['id','code','title','departmentName','headcount','status','draftVersion'].map(key=>[key,result.data[key]]));return result;}
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
  async approvalState(id) {
    const workflow=await this.db.prepare('SELECT id,status,version FROM requisition_approval_workflows WHERE requisition_id=?').get(id);
    return {approvalStatus:workflow?.status||'NOT_SUBMITTED',approvalVersion:workflow?.version||null,approvalWorkflowId:workflow?.id||null};
  }
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
      draftVersion: await this.openPolicy.version(r.id),
      ...(require('../config/config').REQUISITION_APPROVAL_ENABLED?await this.approvalState(r.id):{}),
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
    if(['createdBy','created_by'].some(key=>Object.hasOwn(data,key)))return{success:false,statusCode:403,code:'REQUISITION_PROTECTED_FIELD',message:'Không được thay đổi người tạo yêu cầu.'};
    this.openPolicy.client(data);
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
      if(current?.status==='DRAFT')await this.openPolicy.editable(current,data.expectedDraftVersion);
      if((!current||current.status==='DRAFT')&&data.status&&data.status!=='DRAFT'){this.openPolicy.enabled();this.openPolicy.fail('REQUISITION_APPROVAL_REQUIRED','Hồ sơ chỉ được OPEN sau phê duyệt cấp cuối.');}
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
    const manager = department?.manager_id || (actor?.roles?.includes('HIRING_MGR')?actor.id:current?.hiringManagerId||null);
    const persistedRecruiterId=actor&&require('../config/config').REQUISITION_OPERATIONS_ENABLED?current?.recruiterId||null:v.recruiterId;
    if (current) {
      (await this.db.prepare(`UPDATE requisitions SET title=?, job_title_id=?, department_id=?, department_name=?,
        headcount=?, hiring_manager_id=?, recruiter_id=?, work_location_id=?, work_mode_id=?, status=?,
        s210_version=1, created_by=?, recruitment_reason=?, proposed_salary_min=?, proposed_salary_max=?,
        needed_date=?, job_description=?, candidate_requirements=?, salary_justification=?, updated_at=datetime('now') WHERE id=?`)
        .run(title, v.jobTitleId, v.departmentId, department?.name || (status==='DRAFT'?String(data.departmentName||data.department||current?.departmentName||'').trim():''), headcount, manager,
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
        .run(id, code, title, v.jobTitleId, v.departmentId, department?.name || (status==='DRAFT'?String(data.departmentName||data.department||current?.departmentName||'').trim():''), headcount, manager,
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
    if(item.status==='DRAFT'&&item.approvalStatus==='PENDING')return fail(409,'APPROVAL_PENDING_EDIT_FORBIDDEN','Hồ sơ đang chờ duyệt; chưa được chỉnh sửa nội dung.');
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

  async canAccessCandidateCv(candidateId, actor) {
    if (!actor) return false;
    if (actor.roles?.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r))) return true;
    if (actor.roles?.includes('INTERVIEWER')) {
      let hasII = false;
      try {
        if (this.db.provider === 'postgres') {
          const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_interviewers'").get();
          hasII = Boolean(row);
        } else {
          const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_interviewers'").get();
          hasII = Boolean(row);
        }
      } catch { hasII = false; }
      if (hasII) {
        const isAssigned = await this.db.prepare(`
          SELECT 1 FROM interviews i
          LEFT JOIN interview_interviewers ii ON ii.interview_id = i.id
          WHERE i.candidate_id = ? AND (i.interviewer_id = ? OR ii.user_id = ?)
        `).get(candidateId, actor.id, actor.id);
        return Boolean(isAssigned);
      } else {
        const isAssigned = await this.db.prepare('SELECT 1 FROM interviews WHERE candidate_id = ? AND interviewer_id = ?').get(candidateId, actor.id);
        return Boolean(isAssigned);
      }
    }
    return false;
  }

  async getCandidates(options = {}) {
    const actor = await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(options.viewer?.id, 'candidate.read');
    if (!actor) return {success:false,statusCode:403,code:'CANDIDATE_FORBIDDEN',message:'Bạn không có quyền xem hồ sơ ứng viên.',candidates:[]};
    options = {...options, viewer:actor};
    const internalScope = this.candidateVisibility({...actor, roles:actor.roles.filter(role => role !== 'CANDIDATE')});
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const stage = typeof options.stage === 'string' ? options.stage.trim() : 'ALL';
    const reqId = typeof options.requisitionId === 'string' ? options.requisitionId.trim() : 'ALL';

    const conditions = [];
    const params = [];
    if(options.candidateId){conditions.push('c.id=?');params.push(options.candidateId);}
    if (Array.isArray(options.candidateIds)) {
      conditions.push(options.candidateIds.length ? `c.id IN (${options.candidateIds.map(() => '?').join(',')})` : '1=0');
      params.push(...options.candidateIds);
    }

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
      const closed = stage === 'CLOSED';
      const publicStages = [...candidateStages, 'WITHDRAWN'].filter(value => closed ? require('./candidatePortalService').mapPublicStatus(value).code !== stage : require('./candidatePortalService').mapPublicStatus(value).code === stage);
      const placeholders = publicStages.map(() => '?').join(',');
      const publicCondition = closed ? `(c.stage IS NULL OR c.stage NOT IN (${placeholders}))` : publicStages.length ? `c.stage IN (${placeholders})` : '1=0';
      const internalCondition = internalScope ? internalScope.condition : '1=1';
      conditions.push(`((${internalCondition} AND c.stage=?) OR (NOT ${internalCondition} AND ${publicCondition}))`);
      params.push(...(internalScope?.params || []), stage, ...(internalScope?.params || []), ...publicStages);
    }

    if (reqId && reqId !== 'ALL') {
      conditions.push('c.requisition_id = ?');
      params.push(reqId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = this.db.prepare(`
      SELECT
        CASE WHEN ${internalScope ? internalScope.condition : '1=1'} THEN 1 ELSE 0 END AS in_internal_scope,
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

    const rows = (await stmt.all(...(internalScope?.params || []), ...params));
    return {
      success: true,
      total: rows.length,
      candidates: rows.map(r => {
        if (!Number(r.in_internal_scope)) {
          const status = require('./candidatePortalService').mapPublicStatus(r.stage);
          return {
            id:r.id,
            fullName:r.full_name,
            email:r.email,
            phoneNumber:r.phone_number,
            createdAt:r.created_at,
            experienceYears:r.experience_years,
            currentCompany:r.current_company,
            expectedSalary:r.expected_salary,
            requisition:r.requisition_id ? {title:r.requisition_title, departmentName:r.department_name} : null,
            status:status.code,
            statusLabel:status.label
          };
        }
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
  async hasInterviewSchedulingColumns() {
    const columns = this.db.provider === 'postgres'
      ? await this.db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interviews'").all()
      : await this.db.prepare('PRAGMA table_info(interviews)').all();
    const ready = ['duration_minutes', 'interview_format', 'meeting_room', 'meeting_link'].every(name => columns.some(column => column.name === name));
    if (!ready) return false;
    const tables = this.db.provider === 'postgres'
      ? await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_interviewers'").all()
      : await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_interviewers'").all();
    return tables.length === 1;
  }

  async hasCancelReschedCols() {
    try {
      const columns = this.db.provider === 'postgres'
        ? await this.db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interviews'").all()
        : await this.db.prepare('PRAGMA table_info(interviews)').all();
      return ['cancellation_reason', 'cancelled_at', 'rescheduled_at', 'reschedule_reason'].every(name => columns.some(c => (c.name || c.column_name) === name));
    } catch {
      return false;
    }
  }

  async hasResponseCols() {
    try {
      const columns = this.db.provider === 'postgres'
        ? await this.db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interviews'").all()
        : await this.db.prepare('PRAGMA table_info(interviews)').all();
      return ['candidate_response_status', 'candidate_response_note', 'candidate_responded_at'].every(name => columns.some(c => (c.name || c.column_name) === name));
    } catch {
      return false;
    }
  }

  async hasEvaluationTable() {
    if (this.db.provider === 'postgres') {
      const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_evaluations'").get();
      return Boolean(row);
    }
    const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_evaluations'").get();
    return Boolean(row);
  }

  async hasInvitationTokensTable() {
    if (this.db.provider === 'postgres') {
      const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_invitation_tokens'").get();
      return Boolean(row);
    }
    const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_invitation_tokens'").get();
    return Boolean(row);
  }

  async hasEmailOutboxTable() {
    if (this.db.provider === 'postgres') {
      const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='email_outbox'").get();
      return Boolean(row);
    }
    const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_outbox'").get();
    return Boolean(row);
  }

  async recordCandidateStatusHistory(data) {
    const cols = this.db.provider === 'postgres'
      ? (await this.db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='candidate_status_history'").all()).map(c => c.name)
      : (await this.db.prepare("PRAGMA table_info(candidate_status_history)").all()).map(c => c.name);
    if (!cols || cols.length === 0) return;
    if (cols.includes('actor_id')) {
      await this.db.prepare(`
        INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data.id, data.candidateId, data.beforeStage, data.afterStage, data.actorId, data.actorName, data.action, data.notes, data.createdAt);
    } else if (cols.includes('actor_name')) {
      await this.db.prepare(`
        INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_name, action, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data.id, data.candidateId, data.beforeStage, data.afterStage, data.actorName, data.action, data.notes, data.createdAt);
    }
  }

  async hasInvitationTokensTable() {
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

  async getInterviews(options = {}) {
    if(options.viewer){const fresh=await new(require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(options.viewer.id,options.evaluationsOnly?'interview.evaluation.read':'interview.read');if(!fresh)return{success:false,statusCode:403,code:'INTERVIEW_FORBIDDEN',message:'Bạn không có quyền xem lịch phỏng vấn.',interviews:[]};options={...options,viewer:fresh};}
    const conditions=[],params=[];
    if (options.candidateEmail) { conditions.push('LOWER(c.email)=LOWER(?)');params.push(options.candidateEmail); }
    const viewer=options.viewer;
    const hasColumns = await this.hasInterviewSchedulingColumns();
    const hasCancelResched = hasColumns && await this.hasCancelReschedCols();
    if (options.mySchedule && viewer) {
      if (hasColumns) {
        conditions.push('(i.interviewer_id=? OR EXISTS (SELECT 1 FROM interview_interviewers ii WHERE ii.interview_id=i.id AND ii.user_id=?))');
        params.push(viewer.id, viewer.id);
      } else {
        conditions.push('i.interviewer_id=?');
        params.push(viewer.id);
      }
    } else if (viewer && !viewer.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)) && !(options.evaluationsOnly && viewer.roles.includes('APPROVER'))) {
      const scopes=[];
      if (viewer.roles.includes('HIRING_MGR')) {scopes.push(this.hiringRequisitionScope());params.push(viewer.id,viewer.id,viewer.id);}
      if(viewer.roles.includes('RECRUITER')){const scope=this.recruiterScope('r',viewer.id),candidateScope=this.recruiterScope('candidate_position',viewer.id);scopes.push('('+scope.condition+' AND EXISTS(SELECT 1 FROM requisitions candidate_position WHERE candidate_position.id=c.requisition_id AND '+candidateScope.condition+'))');params.push(...scope.params,...candidateScope.params);}
      if (viewer.roles.includes('INTERVIEWER')) {
        if (hasColumns && !options.evaluationsOnly) {
          scopes.push('(i.interviewer_id=? OR EXISTS (SELECT 1 FROM interview_interviewers ii WHERE ii.interview_id=i.id AND ii.user_id=?))');
          params.push(viewer.id, viewer.id);
        } else {
          scopes.push('i.interviewer_id=?');
          params.push(viewer.id);
        }
      }
      if (viewer.roles.includes('CANDIDATE')) {scopes.push('LOWER(c.email)=LOWER(?)');params.push(viewer.email);}
      conditions.push(scopes.length?'('+scopes.join(' OR ')+')':'1=0');
    }
    if (options.status && options.status !== 'ALL') {
      conditions.push('i.status = ?');
      params.push(options.status);
    }
    if (options.search && typeof options.search === 'string' && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      conditions.push('(c.full_name LIKE ? OR r.title LIKE ? OR i.round_name LIKE ?)');
      params.push(term, term, term);
    }
    if (options.timeframe === 'UPCOMING') {
      const now = new Date().toISOString();
      conditions.push("i.status != 'CANCELLED' AND i.scheduled_time >= ?");
      params.push(now);
    } else if (options.timeframe === 'PAST') {
      const now = new Date().toISOString();
      conditions.push("i.scheduled_time < ?");
      params.push(now);
    }
    const hasResponseCols = hasColumns && (this.db.provider === 'postgres'
      ? Boolean(await this.db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interviews' AND column_name='candidate_response_status'").get())
      : (await this.db.prepare("PRAGMA table_info(interviews)").all()).some(c => c.name === 'candidate_response_status'));

    const sortOrder = (options.sortOrder === 'ASC' || (options.mySchedule && options.sortOrder !== 'DESC')) ? 'ASC' : 'DESC';

    const stmt = this.db.prepare(hasColumns ? `
      SELECT
        i.id,
        i.round_name,
        i.scheduled_time,
        i.location_or_link,
        i.duration_minutes,
        i.interview_format,
        i.meeting_room,
        i.meeting_link,
        i.status,
        i.feedback,
        i.score,
        ${hasResponseCols ? 'i.candidate_response_status, i.candidate_response_note, i.candidate_responded_at,' : 'NULL AS candidate_response_status, NULL AS candidate_response_note, NULL AS candidate_responded_at,'}
        ${hasCancelResched ? 'i.cancellation_reason, i.cancelled_at, i.rescheduled_at, i.reschedule_reason,' : 'NULL AS cancellation_reason, NULL AS cancelled_at, NULL AS rescheduled_at, NULL AS reschedule_reason,'}
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
      ORDER BY i.scheduled_time ${sortOrder}
    ` : `
      SELECT
        i.id,
        i.round_name,
        i.scheduled_time,
        i.location_or_link,
        i.status,
        i.feedback,
        i.score,
        NULL AS candidate_response_status, NULL AS candidate_response_note, NULL AS candidate_responded_at,
        NULL AS cancellation_reason, NULL AS cancelled_at, NULL AS rescheduled_at, NULL AS reschedule_reason,
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
      ORDER BY i.scheduled_time ${sortOrder}
    `);
    const rows = (await stmt.all(...params));

    const interviewIds = rows.map(r => r.id);
    let interviewerMap = new Map();
    if (hasColumns && interviewIds.length > 0) {
      {
        const placeholders = interviewIds.map(() => '?').join(',');
        const assignees = await this.db.prepare(`
          SELECT ii.interview_id, ii.user_id, ii.role, u.full_name, u.email
          FROM interview_interviewers ii
          JOIN users u ON u.id = ii.user_id
          WHERE ii.interview_id IN (${placeholders})
          ORDER BY ii.role DESC, u.full_name ASC
        `).all(...interviewIds);
        for (const a of assignees) {
          if (!interviewerMap.has(a.interview_id)) interviewerMap.set(a.interview_id, []);
          interviewerMap.get(a.interview_id).push({
            id: a.user_id,
            fullName: a.full_name,
            email: a.email,
            role: a.role
          });
        }
      }
    }

    const candidateIds = [...new Set(rows.map(r => r.candidate_id).filter(Boolean))];
    let candidateCvMap = new Map();
    if (candidateIds.length > 0) {
      let hasDocsTable = false;
      try {
        if (this.db.provider === 'postgres') {
          hasDocsTable = true;
        } else {
          hasDocsTable = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='candidate_documents'").get());
        }
      } catch {
        hasDocsTable = false;
      }
      if (hasDocsTable) {
        try {
          const placeholders = candidateIds.map(() => '?').join(',');
          const docs = await this.db.prepare(`
            SELECT id, candidate_id, file_name, created_at
            FROM candidate_documents
            WHERE candidate_id IN (${placeholders}) AND document_type = 'CV'
            ORDER BY created_at DESC
          `).all(...candidateIds);
          for (const d of docs) {
            if (!candidateCvMap.has(d.candidate_id)) {
              candidateCvMap.set(d.candidate_id, {
                documentId: d.id,
                fileName: d.file_name,
                downloadUrl: `/api/v1/candidates/documents/${d.id}/download`
              });
            }
          }
        } catch {
          candidateCvMap = new Map();
        }
      }
    }

    let evaluationsMap = new Map();
    if (interviewIds.length > 0) {
      let hasEvalsTable = false;
      try {
        if (this.db.provider === 'postgres') {
          hasEvalsTable = true;
        } else {
          hasEvalsTable = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='interview_evaluations'").get());
        }
      } catch {
        hasEvalsTable = false;
      }
      if (hasEvalsTable) {
        try {
          const placeholders = interviewIds.map(() => '?').join(',');
          const evals = await this.db.prepare(`
            SELECT id, interview_id, interviewer_id, status, total_score, submitted_at
            FROM interview_evaluations
            WHERE interview_id IN (${placeholders})
          `).all(...interviewIds);
          for (const ev of evals) {
            if (!evaluationsMap.has(ev.interview_id)) evaluationsMap.set(ev.interview_id, []);
            evaluationsMap.get(ev.interview_id).push(ev);
          }
        } catch {
          evaluationsMap = new Map();
        }
      }
    }

    const calendarOnly = new Set();
    if (viewer?.roles.includes('INTERVIEWER') && !viewer.roles.some(role => ['ADMIN','HR_MANAGER'].includes(role)) && !(options.evaluationsOnly && viewer.roles.includes('APPROVER'))) {
      for (const row of rows) {
        if (row.interviewer_id === viewer.id || !interviewerMap.get(row.id)?.some(member => member.id === viewer.id)) continue;
        let internalRead = false;
        if (viewer.roles.includes('HIRING_MGR')) internalRead = await this.canReadHiringRequisition(row.requisition_id,viewer.id);
        if (!internalRead && viewer.roles.includes('RECRUITER')) {
          const candidate = await this.db.prepare('SELECT requisition_id FROM candidates WHERE id=?').get(row.candidate_id);
          internalRead = await this.recruiterAssigned(row.requisition_id,viewer.id) && await this.recruiterAssigned(candidate?.requisition_id,viewer.id);
        }
        if (!internalRead) calendarOnly.add(row.id);
      }
    }

    let mappedInterviews = rows.map(r => {
      const interviewers = interviewerMap.get(r.id) || (r.interviewer_id ? [{
        id: r.interviewer_id,
        fullName: r.interviewer_name,
        email: r.interviewer_email,
        role: 'PRIMARY'
      }] : []);
      const hideEvaluation = calendarOnly.has(r.id) || viewer?.roles.every(role => role === 'CANDIDATE');
      const ownApplication = viewer?.roles.includes('CANDIDATE') && typeof viewer.email === 'string' && typeof r.candidate_email === 'string' && viewer.email.toLowerCase() === r.candidate_email.toLowerCase();

      const cvDoc = candidateCvMap.get(r.candidate_id);
      const evals = evaluationsMap.get(r.id) || [];
      const viewerEval = viewer?.id ? evals.find(e => e.interviewer_id === viewer.id) : null;
      let evaluationStatus = 'NOT_SUBMITTED';
      let hasSubmittedEvaluation = false;
      let evaluationId = null;
      let submittedAt = null;

      const isAssignedToInterview = viewer?.id ? (r.interviewer_id === viewer.id || (interviewerMap.get(r.id)?.some(m => m.id === viewer.id) || false)) : false;

      if (isAssignedToInterview || options.mySchedule) {
        if (viewerEval) {
          evaluationStatus = viewerEval.status;
          hasSubmittedEvaluation = viewerEval.status === 'SUBMITTED';
          evaluationId = viewerEval.id;
          submittedAt = viewerEval.submitted_at || null;
        } else {
          evaluationStatus = 'NOT_SUBMITTED';
          hasSubmittedEvaluation = false;
          evaluationId = null;
          submittedAt = null;
        }
      } else if (evals.length > 0) {
        const allSubmitted = evals.every(e => e.status === 'SUBMITTED');
        const anySubmitted = evals.some(e => e.status === 'SUBMITTED');
        hasSubmittedEvaluation = anySubmitted;
        evaluationStatus = allSubmitted ? 'SUBMITTED' : (anySubmitted ? 'PARTIALLY_SUBMITTED' : (evals[0].status || 'NOT_SUBMITTED'));
        evaluationId = evals[0].id;
        submittedAt = evals.find(e => e.submitted_at)?.submitted_at || null;
      }

      const scheduledMs = this.parseInterviewTimestamp(r.scheduled_time);
      const isUpcoming = r.status !== 'CANCELLED' && scheduledMs !== null && scheduledMs >= Date.now();

      return {
        id: r.id,
        roundName: r.round_name,
        scheduledTime: scheduledMs === null ? r.scheduled_time : new Date(scheduledMs).toISOString(),
        durationMinutes: r.duration_minutes || 60,
        interviewFormat: r.interview_format || ((typeof r.location_or_link === 'string' && r.location_or_link.trim() && !/^https?:\/\//i.test(r.location_or_link.trim())) ? 'IN_PERSON' : 'ONLINE'),
        meetingRoom: r.meeting_room || null,
        meetingLink: r.meeting_link || null,
        locationOrLink: r.location_or_link || r.meeting_room || r.meeting_link || 'Google Meet Online',
        status: r.status,
        candidateResponseStatus: r.candidate_response_status || 'PENDING',
        candidateResponseNote: r.candidate_response_note || null,
        candidateRespondedAt: r.candidate_responded_at || null,
        cancellationReason: r.cancellation_reason || null,
        cancelledAt: r.cancelled_at || null,
        rescheduledAt: r.rescheduled_at || null,
        rescheduleReason: r.reschedule_reason || null,
        isRescheduled: Boolean(r.rescheduled_at),
        isCancelled: r.status === 'CANCELLED',
        isUpcoming,
        cvDocumentId: cvDoc?.documentId || null,
        cvFileName: cvDoc?.fileName || null,
        cvUrl: cvDoc?.downloadUrl || null,
        evaluationStatus,
        hasSubmittedEvaluation,
        evaluationId,
        evaluationSubmittedAt: submittedAt,
        feedback: hideEvaluation?null:r.feedback,
        score: hideEvaluation?null:r.score,
        createdAt: r.created_at,
        candidate: calendarOnly.has(r.id) && !ownApplication ? {
          id: r.candidate_id,
          fullName: r.candidate_name,
          cvDocumentId: cvDoc?.documentId || null,
          cvFileName: cvDoc?.fileName || null,
          cvUrl: cvDoc?.downloadUrl || null
        } : {
          id: r.candidate_id,
          fullName: r.candidate_name,
          email: r.candidate_email,
          phone: r.candidate_phone,
          cvDocumentId: cvDoc?.documentId || null,
          cvFileName: cvDoc?.fileName || null,
          cvUrl: cvDoc?.downloadUrl || null
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
        } : (interviewers[0] ? {
          id: interviewers[0].id,
          fullName: interviewers[0].fullName,
          email: interviewers[0].email
        } : null),
        interviewers: calendarOnly.has(r.id) ? interviewers.map(({email,...member}) => member) : interviewers
      };
    });

    if (options.evaluationStatus === 'SUBMITTED') {
      mappedInterviews = mappedInterviews.filter(iv => iv.hasSubmittedEvaluation);
    } else if (options.evaluationStatus === 'NOT_SUBMITTED') {
      mappedInterviews = mappedInterviews.filter(iv => !iv.hasSubmittedEvaluation);
    }

    return {
      success: true,
      total: mappedInterviews.length,
      interviews: mappedInterviews
    };
  }

  /**
   * Get offers list
   */
  async getOffers(options = {}) {
    return this.offerService.getOffers(options);
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
    const candidates=(await this.getCandidates({viewer})).candidates.filter(row=>ids.has(row.requisition?.id));
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
    if(requisitionId){const position=await this.db.prepare('SELECT status FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(requisitionId);if(position&&(['PAUSED','CANCELLED'].includes(position.status)||require('../config/config').REQUISITION_LIFECYCLE_ENABLED&&!['OPEN','IN_PROGRESS'].includes(position.status)))return{success:false,statusCode:409,code:'REQUISITION_NOT_ACCEPTING_APPLICATIONS',message:'Yêu cầu tuyển dụng hiện không nhận ứng tuyển mới.'};await this.openPolicy.recruiting(requisitionId);}
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
    if (require('../config/config').CANDIDATE_STAGE_TRANSITIONS_ENABLED) {
      const CandidateStageService = require('./candidateStageService');
      const stageService = new CandidateStageService(this.db);
      return stageService.updateStage(id, stage, { notes, rejectionReasonId }, actor);
    }
    if(actor)return this.db.transaction(async()=>{const access=await this.candidateAccess(id,actor,'candidate.update');if(!access.success)return access;await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(access.row.requisition_id);const checked=await this.candidateAccess(id,actor,'candidate.update');if(!checked.success)return checked;return this.updateCandidateStage(id,stage,notes,rejectionReasonId,null);});
    await this.openPolicy.notDraft((await this.db.prepare('SELECT requisition_id FROM candidates WHERE id=?').get(id))?.requisition_id);
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
  parseInterviewTimestamp(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(value.trim());
    if (!match) return null;
    const [,year,month,day,hour,minute,second = '00',fraction = '',offset = '+07:00'] = match;
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    if (offset.toUpperCase() !== 'Z' && (Number(offset.slice(1,3)) > 23 || Number(offset.replace(':','').slice(3)) > 59)) return null;
    const result = Date.parse(year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + (fraction ? '.' + fraction : '') + offset);
    return Number.isFinite(result) ? result : null;
  }

  async checkInterviewConflict(candidateId, interviewerIds, startMs, durationMinutes, meetingRoom = null, excludeInterviewId = null) {
    const endMs=startMs+durationMinutes*60000;
    if(!await this.hasInterviewSchedulingColumns())return null;
    const exclusion=excludeInterviewId?' AND i.id<>?':'';
    const rows=await this.db.prepare(`SELECT i.id,i.candidate_id,i.scheduled_time,i.duration_minutes,i.meeting_room,c.full_name AS candidate_name,c.email AS candidate_email,u.id AS interviewer_id,u.full_name AS interviewer_name FROM interviews i LEFT JOIN candidates c ON c.id=i.candidate_id LEFT JOIN interview_interviewers ii ON ii.interview_id=i.id LEFT JOIN users u ON u.id=COALESCE(ii.user_id,i.interviewer_id) WHERE i.status='SCHEDULED'${exclusion}`).all(...(excludeInterviewId?[excludeInterviewId]:[]));
    const own=new Set(interviewerIds), roomKey=String(meetingRoom||'').trim().toLocaleLowerCase(), grouped=new Map();
    for(const row of rows){const start=this.parseInterviewTimestamp(row.scheduled_time);if(start===null)continue;const finish=start+(Number(row.duration_minutes)||60)*60000;if(!(startMs<finish&&start<endMs))continue;let item=grouped.get(row.id);if(!item){item={id:row.id,candidateId:row.candidate_id,candidateName:row.candidate_name,candidateEmail:row.candidate_email,scheduledTime:new Date(start).toISOString(),endTime:new Date(finish).toISOString(),meetingRoom:row.meeting_room||null,interviewers:[],resourceConflicts:[]};grouped.set(row.id,item);}if(row.interviewer_id&&!item.interviewers.some(person=>person.id===row.interviewer_id))item.interviewers.push({id:row.interviewer_id,fullName:row.interviewer_name});}
    for(const item of grouped.values()){const shared=item.interviewers.filter(person=>own.has(person.id));if(shared.length)item.resourceConflicts.push({type:'INTERVIEWER',interviewers:shared});if(roomKey&&item.meetingRoom&&item.meetingRoom.trim().toLocaleLowerCase()===roomKey)item.resourceConflicts.push({type:'ROOM',meetingRoom:item.meetingRoom});if(item.candidateId===candidateId)item.resourceConflicts.push({type:'CANDIDATE'});}
    const conflicts=[...grouped.values()].filter(item=>item.resourceConflicts.length);
    return conflicts.length?{success:false,statusCode:409,code:'INTERVIEW_RESOURCE_CONFLICT',message:'Interview schedule conflicts with an interviewer or room booking.',conflicts,proposed:{candidateId,startTime:new Date(startMs).toISOString(),endTime:new Date(endMs).toISOString(),interviewerIds,meetingRoom:meetingRoom||null}}:null;
  }

  async createInterview(data = {}, actor = null) {
    return this.#scheduleInterview(data, actor, false, null);
  }

  async updateInterviewSchedule(id, data = {}, actor = null) { return this.#scheduleInterview(data, actor, false, id); }

  async previewInterview(data = {}, actor = null) {
    return this.#scheduleInterview(data, actor, true);
  }

  async #scheduleInterview(data, actor, preview, updateId = null) {
    if (!actor?.id) return {success:false,statusCode:403,code:'INTERVIEW_ACTOR_REQUIRED'};
    const action = async()=>{
      const rbac=new (require('../middlewares/rbacMiddleware'))(this.db);
      const permission=updateId?'interview.update':'interview.create';
      const existing=updateId?await this.db.prepare('SELECT id,candidate_id,requisition_id,status,feedback,score FROM interviews WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(updateId):null;
      if(updateId&&!existing)return{success:false,statusCode:404,code:'INTERVIEW_NOT_FOUND'};
      if(updateId){
        if(existing.status==='COMPLETED'||existing.score!==null||existing.feedback!==null)return{success:false,statusCode:400,code:'INTERVIEW_ALREADY_EVALUATED',message:'Không thể dời lịch buổi phỏng vấn đã hoàn thành hoặc đã có đánh giá.'};
        if (await this.hasEvaluationTable()) {
          const hasEval = await this.db.prepare("SELECT id FROM interview_evaluations WHERE interview_id = ? AND status = 'SUBMITTED' LIMIT 1").get(updateId);
          if (hasEval) return {success:false,statusCode:400,code:'INTERVIEW_ALREADY_EVALUATED',message:'Không thể dời lịch buổi phỏng vấn đã có đánh giá đã nộp.'};
        }
        if(existing.status==='CANCELLED')return{success:false,statusCode:400,code:'INTERVIEW_ALREADY_CANCELLED',message:'Không thể dời lịch buổi phỏng vấn đã bị hủy.'};
        data={...data,candidateId:existing.candidate_id};
      }
      if(!await rbac.getAuthorizedActor(actor.id,permission))return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền điều phối lịch phỏng vấn.'};
      const candidate=await this.db.prepare('SELECT id,requisition_id FROM candidates WHERE id=?'+(this.db.provider==='postgres' && !preview?' FOR UPDATE':'')).get(data.candidateId);
      if(!candidate)return{success:false,statusCode:404,code:'CANDIDATE_NOT_FOUND',message:'Không tìm thấy ứng viên.'};
      if(candidate.requisition_id&&data.requisitionId&&candidate.requisition_id!==data.requisitionId)return{success:false,statusCode:400,code:'INTERVIEW_REQUISITION_MISMATCH',message:'Vị trí phỏng vấn không khớp hồ sơ ứng tuyển.'};


      let interviewerIds = [];
      if (Object.hasOwn(data,'interviewerIds') && !Array.isArray(data.interviewerIds)) return {success:false,statusCode:400,code:'INTERVIEW_ASSIGNEES_INVALID'};
      if (Array.isArray(data.interviewerIds)) {
        if (data.interviewerIds.length === 0) return { success: false, statusCode: 400, code: 'INTERVIEW_ASSIGNEES_REQUIRED', message: 'Vui lòng chọn ít nhất một người phỏng vấn.' };
        if (new Set(data.interviewerIds).size !== data.interviewerIds.length) return { success: false, statusCode: 400, code: 'INTERVIEW_ASSIGNEES_DUPLICATE', message: 'Danh sách người phỏng vấn có người bị trùng lặp.' };
        interviewerIds = data.interviewerIds;
      } else if (data.interviewerId) {
        interviewerIds = [data.interviewerId];
      }
      if (interviewerIds.some(id => typeof id !== 'string' || !id.trim())) return {success:false,statusCode:400,code:'INTERVIEW_ASSIGNEE_INVALID'};
      const roomKey=typeof data.meetingRoom==='string'?data.meetingRoom.trim().toLocaleLowerCase():'';
      if (this.db.provider === 'postgres' && !preview) {
        const lockKeys=[...interviewerIds.map(id=>'interview-scheduling:user:'+id),...(roomKey?['interview-scheduling:room:'+roomKey]:[])].sort();
        for (const key of lockKeys) await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(key);
      }
      const fresh=await rbac.getAuthorizedActor(actor.id,permission);
      if(!fresh)return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED'};
      if(!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){const access=await this.candidateAccess(data.candidateId,fresh);if(!access.success)return access;}
      for (const uid of interviewerIds) {
        if (!await rbac.getAuthorizedActor(uid, 'interview.evaluate')) {
          return { success: false, statusCode: 400, code: 'INTERVIEW_ASSIGNEE_INVALID', message: 'Người phỏng vấn phải đang hoạt động và có quyền đánh giá.' };
        }
      }
      return this.#createInterviewCore({...data, _actorId:actor.id, _actorName:fresh.fullName, _updateId:updateId, excludeInterviewId:updateId||null, interviewerId: interviewerIds[0] || data.interviewerId || null, requisitionId: data.requisitionId || candidate.requisition_id}, preview);
    };
    return preview ? action() : this.db.transaction(action);
  }

  async #createInterviewCore(data, preview = false) {
    const candidateId = data.candidateId;
    const hasSchedulingPayload = ['interviewerIds','durationMinutes','interviewFormat','meetingRoom','meetingLink'].some(key => Object.hasOwn(data,key));
    if (!candidateId) return { success: false, statusCode: 400, code: 'CANDIDATE_REQUIRED', message: 'Vui lòng chọn ứng viên.' };
    const candidate = await this.db.prepare('SELECT id, requisition_id FROM candidates WHERE id = ?' + (this.db.provider === 'postgres' && !preview ? ' FOR UPDATE' : '')).get(candidateId);
    if (!candidate) return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy ứng viên.' };

    const policyRequisitionId = data.requisitionId || candidate.requisition_id;
    if (policyRequisitionId) await this.openPolicy.notDraft(policyRequisitionId);

    let scheduledTime = data.scheduledTime;
    if (!scheduledTime) return { success: false, statusCode: 400, code: 'SCHEDULED_TIME_REQUIRED', message: 'Vui lòng chọn thời gian phỏng vấn.' };

    const startMs = this.parseInterviewTimestamp(scheduledTime);
    if (startMs === null) return { success: false, statusCode: 400, code: 'INVALID_SCHEDULED_TIME', message: 'Thời gian phỏng vấn không hợp lệ.' };
    if (startMs < Date.now()) return { success: false, statusCode: 400, code: 'SCHEDULED_TIME_IN_PAST', message: 'Không được đặt lịch phỏng vấn trong quá khứ.' };

    scheduledTime = new Date(startMs).toISOString();

    let durationMinutes = 60;
    if (data.durationMinutes !== undefined && data.durationMinutes !== null && data.durationMinutes !== '') {
      const dur = Number(data.durationMinutes);
      if (!Number.isInteger(dur) || dur < 15 || dur > 480) {
        return { success: false, statusCode: 400, code: 'INVALID_DURATION', message: 'Thời lượng phỏng vấn không hợp lệ.' };
      }
      durationMinutes = dur;
    }

    let interviewFormat = 'ONLINE';
    if (data.interviewFormat !== undefined && data.interviewFormat !== null) {
      if (!['ONLINE', 'IN_PERSON'].includes(data.interviewFormat)) {
        return { success: false, statusCode: 400, code: 'INVALID_INTERVIEW_FORMAT', message: 'Hình thức phỏng vấn không hợp lệ.' };
      }
      interviewFormat = data.interviewFormat;
    } else if (typeof data.locationOrLink === 'string' && !/^https?:\/\//i.test(data.locationOrLink.trim()) && data.locationOrLink.trim()) {
      interviewFormat = 'IN_PERSON';
    }

    let meetingRoom = typeof data.meetingRoom === 'string' ? data.meetingRoom.trim() : null;
    let meetingLink = typeof data.meetingLink === 'string' ? data.meetingLink.trim() : null;

    if (!hasSchedulingPayload && !meetingLink && interviewFormat === 'ONLINE' && typeof data.locationOrLink === 'string' && data.locationOrLink.trim()) {
      meetingLink = data.locationOrLink.trim();
    }
    if (!hasSchedulingPayload && !meetingRoom && interviewFormat === 'IN_PERSON' && typeof data.locationOrLink === 'string' && data.locationOrLink.trim()) {
      meetingRoom = data.locationOrLink.trim();
    }

    if (interviewFormat === 'IN_PERSON' && hasSchedulingPayload) {
      if (!meetingRoom) {
        return { success: false, statusCode: 400, code: 'MEETING_ROOM_REQUIRED', message: 'Vui lòng nhập phòng phỏng vấn trực tiếp.' };
      }
    }

    if (interviewFormat === 'ONLINE' && hasSchedulingPayload) {
      if (!meetingLink) {
        return { success: false, statusCode: 400, code: 'MEETING_LINK_REQUIRED', message: 'Vui lòng nhập liên kết họp trực tuyến hợp lệ.' };
      }
    }

    if (meetingLink && interviewFormat === 'ONLINE') {
      try {
        const url = new URL(meetingLink);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('INVALID_URL');
      } catch { return {success:false,statusCode:400,code:'INVALID_MEETING_LINK'}; }
    }

    let interviewerIds = [];
    if (Array.isArray(data.interviewerIds)) {
      if (data.interviewerIds.length === 0) return { success: false, statusCode: 400, code: 'INTERVIEW_ASSIGNEES_REQUIRED', message: 'Vui lòng chọn ít nhất một người phỏng vấn.' };
      if (new Set(data.interviewerIds).size !== data.interviewerIds.length) return { success: false, statusCode: 400, code: 'INTERVIEW_ASSIGNEES_DUPLICATE', message: 'Danh sách người phỏng vấn có người bị trùng lặp.' };
      interviewerIds = data.interviewerIds;
    } else if (data.interviewerId) {
      interviewerIds = [data.interviewerId];
    } else if (data.durationMinutes !== undefined || data.interviewFormat !== undefined || data.meetingRoom !== undefined || data.meetingLink !== undefined) {
      return { success: false, statusCode: 400, code: 'INTERVIEW_ASSIGNEES_REQUIRED', message: 'Vui lòng chọn ít nhất một người phỏng vấn.' };
    }

    if (hasSchedulingPayload) {
      try { await require('../db/migrate-interview-scheduling').verify(this.db); }
      catch { return {success:false,statusCode:503,code:'INTERVIEW_SCHEDULING_MIGRATION_REQUIRED'}; }
    }
    const conflict = await this.checkInterviewConflict(candidateId, interviewerIds, startMs, durationMinutes, interviewFormat==='IN_PERSON'?meetingRoom:null, data.excludeInterviewId||null);
    const overrideReason=typeof data.conflictOverrideReason==='string'?data.conflictOverrideReason.trim():'';
    if(conflict){
      if(conflict.conflicts.some(item=>item.resourceConflicts.some(reason=>reason.type==='CANDIDATE')))return{...conflict,code:'INTERVIEW_CANDIDATE_CONFLICT',message:'This candidate already has an interview scheduled during the requested time.'};
      if(!data.conflictOverrideConfirmed)return conflict;
      try { await require('../db/migrate-interview-conflict-override').verify(this.db); }
      catch { return {success:false,statusCode:503,code:'INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_REQUIRED',message:'Interview conflict override migration required.'}; }
      if(overrideReason.length<3)return{success:false,statusCode:400,code:'INTERVIEW_OVERRIDE_REASON_REQUIRED',message:'Vui lòng nhập lý do ghi đè (ít nhất 3 ký tự).',conflicts:conflict.conflicts};
      const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(data._actorId,'interview.conflict.override');
      if(!fresh||!fresh.roles.includes('RECRUITER'))return{success:false,statusCode:403,code:'INTERVIEW_OVERRIDE_FORBIDDEN',message:'Chỉ recruiter có quyền phù hợp mới được ghi đè xung đột lịch.',conflicts:conflict.conflicts};
      data._override={actorId:fresh.id,reason:overrideReason,conflicts:conflict.conflicts};
    }else if(data.conflictOverrideConfirmed)return{success:false,statusCode:409,code:'INTERVIEW_CONFLICT_CHANGED',message:'Xung đột đã thay đổi. Vui lòng kiểm tra lại lịch.'};

    if (preview) return {success:true,statusCode:200};

    return this.db.transaction(async () => {
      if(data._updateId){
        const id=data._updateId,primaryInterviewerId=interviewerIds[0]||null,locationOrLink=data.locationOrLink||(interviewFormat==='IN_PERSON'?meetingRoom:meetingLink)||'Google Meet Online';
        const hasReschedCols = await this.hasCancelReschedCols();
        const rescheduleReason = typeof data.rescheduleReason === 'string' ? data.rescheduleReason.trim() : (typeof data.reason === 'string' ? data.reason.trim() : null);
        const hasResponseCols = await this.hasResponseCols();
        if (hasReschedCols) {
          await this.db.prepare(`UPDATE interviews SET requisition_id=?,interviewer_id=?,round_name=?,scheduled_time=?,location_or_link=?,duration_minutes=?,interview_format=?,meeting_room=?,meeting_link=?,candidate_response_status='PENDING',candidate_response_note=NULL,candidate_responded_at=NULL,rescheduled_at=${this.db.provider==='postgres'?'CURRENT_TIMESTAMP':"datetime('now')"},reschedule_reason=? WHERE id=?`).run(data.requisitionId||candidate.requisition_id||null,primaryInterviewerId,data.roundName||'Interview',scheduledTime,locationOrLink,durationMinutes,interviewFormat,meetingRoom,meetingLink,rescheduleReason,id);
        } else if (hasResponseCols) {
          await this.db.prepare("UPDATE interviews SET requisition_id=?,interviewer_id=?,round_name=?,scheduled_time=?,location_or_link=?,duration_minutes=?,interview_format=?,meeting_room=?,meeting_link=?,candidate_response_status='PENDING',candidate_response_note=NULL,candidate_responded_at=NULL WHERE id=?").run(data.requisitionId||candidate.requisition_id||null,primaryInterviewerId,data.roundName||'Interview',scheduledTime,locationOrLink,durationMinutes,interviewFormat,meetingRoom,meetingLink,id);
        } else {
          await this.db.prepare("UPDATE interviews SET requisition_id=?,interviewer_id=?,round_name=?,scheduled_time=?,location_or_link=?,duration_minutes=?,interview_format=?,meeting_room=?,meeting_link=? WHERE id=?").run(data.requisitionId||candidate.requisition_id||null,primaryInterviewerId,data.roundName||'Interview',scheduledTime,locationOrLink,durationMinutes,interviewFormat,meetingRoom,meetingLink,id);
        }
        await this.db.prepare('DELETE FROM interview_interviewers WHERE interview_id=?').run(id);
        for(const uid of interviewerIds)await this.db.prepare('INSERT INTO interview_interviewers(interview_id,user_id,role) VALUES(?,?,?)').run(id,uid,uid===primaryInterviewerId?'PRIMARY':'INTERVIEWER');
        if(data._override)await this.db.prepare('INSERT INTO interview_conflict_override_audit(id,actor_id,interview_id,reason,conflicts_json,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)').run('iov-'+crypto.randomUUID(),data._override.actorId,id,data._override.reason,JSON.stringify(data._override.conflicts));

        if (await this.hasInvitationTokensTable()) {
          await this.db.prepare("UPDATE interview_invitation_tokens SET status='REVOKED' WHERE interview_id=? AND status='ACTIVE'").run(id);
          const InvitationService = require('./interviewInvitationService');
          await new InvitationService(this.db).createInvitation(id);
        }

        await this.recordCandidateStatusHistory({
          id: 'csh-' + crypto.randomUUID(),
          candidateId,
          beforeStage: 'INTERVIEW',
          afterStage: 'INTERVIEW',
          actorId: data._actorId || null,
          actorName: data._actorName || 'Nhân viên tuyển dụng',
          action: 'INTERVIEW_RESCHEDULED',
          notes: rescheduleReason || 'Dời lịch phỏng vấn',
          createdAt: new Date().toISOString()
        });

        return{success:true,statusCode:200,message:'Interview schedule updated.',id,candidateId,requisitionId:data.requisitionId||candidate.requisition_id,interviewerIds,scheduledTime,durationMinutes,interviewFormat,meetingRoom,meetingLink,rescheduledAt:new Date().toISOString(),rescheduleReason};
      }
      const id = 'int-' + crypto.randomUUID();
      const primaryInterviewerId = interviewerIds[0] || data.interviewerId || null;
      const locationOrLink = data.locationOrLink || (interviewFormat === 'IN_PERSON' ? meetingRoom : meetingLink) || 'Google Meet Online';
      const roundName = (typeof data.roundName === 'string' && data.roundName.trim()) ? data.roundName.trim() : 'Phỏng vấn chuyên môn';
      const requisitionId = data.requisitionId || candidate.requisition_id || null;

      const hasColumns = await this.hasInterviewSchedulingColumns();
      if (hasColumns) {
        await this.db.prepare(`
          INSERT INTO interviews (
            id, candidate_id, requisition_id, interviewer_id,
            round_name, scheduled_time, location_or_link, status,
            duration_minutes, interview_format, meeting_room, meeting_link,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, datetime('now'))
        `).run(
          id, candidateId, requisitionId, primaryInterviewerId,
          roundName, scheduledTime, locationOrLink,
          durationMinutes, interviewFormat, meetingRoom, meetingLink
        );

        for (const uid of interviewerIds) {
          await this.db.prepare(`
            INSERT INTO interview_interviewers (interview_id, user_id, role)
            VALUES (?, ?, ?)
            ON CONFLICT (interview_id, user_id) DO NOTHING
          `).run(id, uid, uid === primaryInterviewerId ? 'PRIMARY' : 'INTERVIEWER');
        }
      } else {
        await this.db.prepare(`
          INSERT INTO interviews (
            id, candidate_id, requisition_id, interviewer_id,
            round_name, scheduled_time, location_or_link, status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', datetime('now'))
        `).run(
          id, candidateId, requisitionId, primaryInterviewerId,
          roundName, scheduledTime, locationOrLink
        );
      }

      await this.db.prepare("UPDATE candidates SET stage = 'INTERVIEW' WHERE id = ?").run(candidateId);
      if(data._override) await this.db.prepare('INSERT INTO interview_conflict_override_audit(id,actor_id,interview_id,reason,conflicts_json,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)').run('iov-'+crypto.randomUUID(),data._override.actorId,id,data._override.reason,JSON.stringify(data._override.conflicts));

      let invitation = null;
      try {
        if (await this.hasInvitationTokensTable()) {
          const InvitationService = require('./interviewInvitationService');
          invitation = await new InvitationService(this.db).createInvitation(id);
        }
      } catch {}

      return {
        success: true,
        statusCode: 201,
        message: 'Lên lịch phỏng vấn thành công.',
        id,
        candidateId,
        requisitionId,
        interviewerId: primaryInterviewerId,
        interviewerIds,
        roundName,
        scheduledTime,
        durationMinutes,
        interviewFormat,
        meetingRoom,
        meetingLink,
        locationOrLink,
        invitation: invitation?.success ? {
          invitationUrl: invitation.invitationUrl,
          expiresAt: invitation.expiresAt
        } : null,
        data: {
          id,
          candidateId,
          requisitionId,
          interviewerId: primaryInterviewerId,
          interviewerIds,
          roundName,
          scheduledTime,
          durationMinutes,
          interviewFormat,
          meetingRoom,
          meetingLink,
          locationOrLink,
          invitation: invitation?.success ? {
            invitationUrl: invitation.invitationUrl,
            expiresAt: invitation.expiresAt
          } : null
        }
      };
    });
  }

  async cancelInterview(id, data = {}, actor = null) {
    if (!actor?.id) return { success: false, statusCode: 403, code: 'INTERVIEW_ACTOR_REQUIRED', message: 'Yêu cầu thông tin người thực hiện.' };
    return this.db.transaction(async () => {
      const rbac = new (require('../middlewares/rbacMiddleware'))(this.db);
      const fresh = await rbac.getAuthorizedActor(actor.id, 'interview.update');
      if (!fresh) return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền hủy lịch phỏng vấn.' };

      const existing = await this.db.prepare('SELECT id, candidate_id, requisition_id, round_name, scheduled_time, status, feedback, score FROM interviews WHERE id=?' + (this.db.provider === 'postgres' ? ' FOR UPDATE' : '')).get(id);
      if (!existing) return { success: false, statusCode: 404, code: 'INTERVIEW_NOT_FOUND', message: 'Không tìm thấy buổi phỏng vấn.' };

      if (existing.status === 'COMPLETED' || existing.score !== null || existing.feedback !== null) {
        return { success: false, statusCode: 400, code: 'INTERVIEW_ALREADY_EVALUATED', message: 'Không thể hủy buổi phỏng vấn đã hoàn thành hoặc đã có đánh giá.' };
      }
      if (await this.hasEvaluationTable()) {
        const hasEval = await this.db.prepare("SELECT id FROM interview_evaluations WHERE interview_id = ? AND status = 'SUBMITTED' LIMIT 1").get(id);
        if (hasEval) return { success: false, statusCode: 400, code: 'INTERVIEW_ALREADY_EVALUATED', message: 'Không thể hủy buổi phỏng vấn đã có đánh giá đã nộp.' };
      }
      if (existing.status === 'CANCELLED') {
        return { success: false, statusCode: 400, code: 'INTERVIEW_ALREADY_CANCELLED', message: 'Buổi phỏng vấn đã bị hủy trước đó.' };
      }

      if (!fresh.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
        const access = await this.candidateAccess(existing.candidate_id, fresh);
        if (!access.success) return access;
        const reqId = existing.requisition_id || access.row.requisition_id;
        if (!await this.recruiterAssigned(reqId, fresh.id)) {
          return { success: false, statusCode: 403, code: 'INTERVIEW_OUT_OF_SCOPE', message: 'Lịch phỏng vấn không thuộc vị trí được giao.' };
        }
      }

      const rawReason = typeof data.cancellationReason === 'string' ? data.cancellationReason : (typeof data.reason === 'string' ? data.reason : (typeof data.notes === 'string' ? data.notes : (typeof data.feedback === 'string' ? data.feedback : '')));
      const cancellationReason = rawReason.trim();
      if (!cancellationReason || cancellationReason.length < 3) {
        return { success: false, statusCode: 400, code: 'CANCELLATION_REASON_REQUIRED', message: 'Vui lòng nhập lý do hủy buổi phỏng vấn (tối thiểu 3 ký tự).' };
      }

      const hasReschedCols = await this.hasCancelReschedCols();
      if (hasReschedCols) {
        await this.db.prepare(`
          UPDATE interviews
          SET status = 'CANCELLED',
              cancellation_reason = ?,
              cancelled_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
          WHERE id = ?
        `).run(cancellationReason, id);
      } else {
        await this.db.prepare("UPDATE interviews SET status = 'CANCELLED' WHERE id = ?").run(id);
      }

      if (await this.hasInvitationTokensTable()) {
        await this.db.prepare("UPDATE interview_invitation_tokens SET status='REVOKED' WHERE interview_id=? AND status='ACTIVE'").run(id);
      }

      const candidate = await this.db.prepare('SELECT id, full_name, email FROM candidates WHERE id = ?').get(existing.candidate_id);
      const reqRow = existing.requisition_id ? await this.db.prepare('SELECT title FROM requisitions WHERE id = ?').get(existing.requisition_id) : null;
      const requisitionTitle = reqRow?.title || 'Vị trí tuyển dụng';

      if (candidate?.email && await this.hasEmailOutboxTable()) {
        const outboxId = 'out-' + crypto.randomUUID();
        const subject = `[Thông báo hủy] Lịch phỏng vấn vị trí ${requisitionTitle}`;
        const bodyText = `Kính gửi ${candidate.full_name},\n\nBuổi phỏng vấn vị trí ${requisitionTitle} (${existing.round_name}) dự kiến diễn ra lúc ${existing.scheduled_time} đã bị hủy.\nLý do: ${cancellationReason}\n\nBộ phận tuyển dụng xin lỗi vì sự bất tiện này.`;
        const bodyHtml = `<p>Kính gửi <strong>${candidate.full_name}</strong>,</p><p>Chúng tôi rất tiếc phải thông báo buổi phỏng vấn vị trí <strong>${requisitionTitle}</strong> (${existing.round_name}) dự kiến lúc ${existing.scheduled_time} đã bị hủy.</p><p><strong>Lý do:</strong> ${cancellationReason}</p><p>Bộ phận tuyển dụng xin lỗi vì sự bất tiện này.</p>`;

        await this.db.prepare(`
          INSERT INTO email_outbox (id, recipient, subject, body_html, body_text, template_name, status)
          VALUES (?, ?, ?, ?, ?, 'S606_INTERVIEW_CANCELLATION', 'PENDING')
        `).run(outboxId, candidate.email, subject, bodyHtml, bodyText);
      }

      await this.recordCandidateStatusHistory({
        id: 'csh-' + crypto.randomUUID(),
        candidateId: existing.candidate_id,
        beforeStage: 'INTERVIEW',
        afterStage: 'INTERVIEW',
        actorId: fresh.id,
        actorName: fresh.fullName || 'Nhân viên tuyển dụng',
        action: 'INTERVIEW_CANCELLED',
        notes: cancellationReason,
        createdAt: new Date().toISOString()
      });

      return {
        success: true,
        statusCode: 200,
        message: 'Đã hủy buổi phỏng vấn thành công.',
        id,
        status: 'CANCELLED',
        cancellationReason,
        cancelledAt: new Date().toISOString()
      };
    });
  }

  async updateInterviewStatus(id, status, feedback, score, actor = null, permission = 'interview.evaluate') {
    if (!actor?.id) return {success:false,statusCode:403,code:'INTERVIEW_ACTOR_REQUIRED'};
    return this.db.transaction(async()=>{
      const fresh=await new (require('../middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(actor.id,permission);
      if(!fresh)return{success:false,statusCode:403,code:'FORBIDDEN_PERMISSION_DENIED',message:'Bạn không có quyền cập nhật lịch hoặc đánh giá.'};
      const row=await this.db.prepare('SELECT id,interviewer_id,candidate_id,requisition_id FROM interviews WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(id);
      if(!row)return{success:false,statusCode:404,code:'INTERVIEW_NOT_FOUND'};
      const isAssigned = row.interviewer_id === fresh.id;
      if(permission==='interview.evaluate'&&!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))&&(!fresh.roles.includes('INTERVIEWER')||!isAssigned))return{success:false,statusCode:403,code:'INTERVIEW_ASSIGNEE_REQUIRED',message:'Bạn chỉ được đánh giá vòng phỏng vấn được phân công.'};
      if(permission==='interview.update'&&!fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){const access=await this.candidateAccess(row.candidate_id,fresh);if(!access.success)return access;if(!await this.recruiterAssigned(row.requisition_id||access.row.requisition_id,fresh.id))return{success:false,statusCode:403,code:'INTERVIEW_OUT_OF_SCOPE',message:'Lịch phỏng vấn không thuộc vị trí được giao.'};}
      return this.#updateInterviewStatusCore(id,status,feedback,score);
    });
  }

  async #updateInterviewStatusCore(id,status,feedback,score) {
    if (!['SCHEDULED','COMPLETED','CANCELLED'].includes(status)) return {success:false,statusCode:400,code:'INVALID_INTERVIEW_STATUS',message:'Trạng thái phỏng vấn không hợp lệ.'};
    const hasScore = score !== undefined && score !== null && score !== '';
    if (hasScore && (!['number','string'].includes(typeof score) || typeof score === 'string' && !score.trim() || !Number.isSafeInteger(Number(score)))) return {success:false,statusCode:400,code:'INVALID_INTERVIEW_SCORE',message:'Điểm đánh giá phải là số nguyên hợp lệ.'};
    await this.openPolicy.notDraft((await this.db.prepare('SELECT COALESCE(x.requisition_id,c.requisition_id) AS requisition_id FROM interviews x LEFT JOIN candidates c ON c.id=x.candidate_id WHERE x.id=?').get(id))?.requisition_id);
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã phỏng vấn.' };
    const stmt = this.db.prepare(`
      UPDATE interviews
      SET status = ?, feedback = COALESCE(?, feedback), score = COALESCE(?, score)
      WHERE id = ?
    `);
    const res = (await stmt.run(status, feedback || null, hasScore ? Number(score) : null, id));
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy lịch phỏng vấn.' };
    if (status === 'CANCELLED' && await this.hasInvitationTokensTable()) {
      await this.db.prepare("UPDATE interview_invitation_tokens SET status='REVOKED' WHERE interview_id=? AND status='ACTIVE'").run(id);
    }
    return { success: true, statusCode: 200, message: 'Cập nhật lịch phỏng vấn thành công.' };
  }

  /**
   * Create Job Offer
   */
  async createOffer(data = {}, actor = null) {
    return this.offerService.createOffer(data, actor);
  }

  async updateOffer(id, data = {}, actor = null) {
    return this.offerService.updateOffer(id, data, actor);
  }

  async getOfferById(id, actor = null) {
    return this.offerService.getOfferById(id, actor);
  }

  async previewOffer(data = {}, actor = null) {
    return this.offerService.previewOffer(data, actor);
  }

  async updateOfferStatus(id, status, actor = null) {
    return this.offerService.updateOfferStatus(id, status, actor);
  }
}

module.exports = RequisitionService;
