const crypto = require('node:crypto');
const RequisitionService = require('./requisitionService');
const RbacMiddleware = require('../middlewares/rbacMiddleware');

const TASK_CATEGORIES = Object.freeze(['ACCOUNT', 'EQUIPMENT', 'WORKSPACE', 'DOCUMENTATION']);
const ITEM_STATUSES = Object.freeze(['PENDING', 'COMPLETED', 'SKIPPED']);
const CHECKLIST_STATUSES = Object.freeze(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

class OnboardingService {
  constructor(db, requisitionService, rbacMiddleware) {
    this.db = db;
    this.requisitionService = requisitionService || new RequisitionService(db);
    this.rbacMiddleware = rbacMiddleware || new RbacMiddleware(db);
  }

  isManager(actor) {
    if (!actor) return false;
    const roles = Array.isArray(actor.roles) ? actor.roles : [];
    return roles.includes('ADMIN') || roles.includes('HR_MANAGER');
  }

  async authorize(actor,permission='candidate.read') {
    return this.rbacMiddleware.getAuthorizedActor(actor?.id,permission);
  }

  denied() { return {success:false,statusCode:403,code:'ONBOARDING_FORBIDDEN',message:'Access denied.'}; }

  readScope(actor) {
    return this.requisitionService.candidateVisibility({...actor,roles:actor.roles.filter(role=>['ADMIN','HR_MANAGER','RECRUITER','HIRING_MGR','APPROVER'].includes(role))})||{condition:'1=1',params:[]};
  }

  async canRead(candidateId,actor) {
    const scope=this.readScope(actor);
    return Boolean(await this.db.prepare('SELECT c.id FROM candidates c LEFT JOIN requisitions r ON r.id=c.requisition_id WHERE c.id=? AND (('+scope.condition+') OR EXISTS (SELECT 1 FROM onboarding_checklists oc JOIN onboarding_checklist_items oi ON oi.checklist_id=oc.id WHERE oc.candidate_id=c.id AND oi.assignee_id=?))').get(candidateId,...scope.params,actor.id));
  }

  formatDateOnly(d) {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().split('T')[0];
    if (typeof d === 'string') return d.split('T')[0];
    return String(d);
  }

  calculateDueDate(startDateStr, relativeDays = 1) {
    try {
      const base = startDateStr ? new Date(startDateStr) : new Date();
      if (isNaN(base.getTime())) {
        const now = new Date();
        now.setDate(now.getDate() + Number(relativeDays || 1));
        return now.toISOString().split('T')[0];
      }
      base.setDate(base.getDate() + Number(relativeDays || 1));
      return base.toISOString().split('T')[0];
    } catch {
      const now = new Date();
      now.setDate(now.getDate() + 1);
      return now.toISOString().split('T')[0];
    }
  }

  async getTemplates(options = {}, actor = null) {
    actor=await this.authorize(actor);if(!actor||!this.isManager(actor))return this.denied();
    const departmentId = options.departmentId ? String(options.departmentId).trim() : null;
    let sql = `SELECT * FROM onboarding_templates`;
    const params = [];
    if (departmentId) {
      sql += ` WHERE department_id = ? OR department_id IS NULL OR is_default = ${this.db.provider === 'postgres' ? 'TRUE' : '1'} ORDER BY (CASE WHEN department_id = ? THEN 0 ELSE 1 END), created_at DESC`;
      params.push(departmentId, departmentId);
    } else {
      sql += ` ORDER BY created_at DESC`;
    }
    const templates = await this.db.prepare(sql).all(...params);
    for (const tmpl of templates) {
      tmpl.items = await this.db.prepare(
        `SELECT * FROM onboarding_template_items WHERE template_id = ? ORDER BY display_order ASC, created_at ASC`
      ).all(tmpl.id);
    }
    return { success: true, statusCode: 200, data: templates };
  }

  async getTemplateById(templateId, actor = null) {
    actor=await this.authorize(actor);if(!actor||!this.isManager(actor))return this.denied();
    if (!templateId) {
      return { success: false, statusCode: 400, code: 'TEMPLATE_ID_REQUIRED', message: 'Thiếu mã mẫu onboarding.' };
    }
    const template = await this.db.prepare(`SELECT * FROM onboarding_templates WHERE id = ?`).get(templateId);
    if (!template) {
      return { success: false, statusCode: 404, code: 'TEMPLATE_NOT_FOUND', message: 'Không tìm thấy mẫu onboarding.' };
    }
    template.items = await this.db.prepare(
      `SELECT * FROM onboarding_template_items WHERE template_id = ? ORDER BY display_order ASC, created_at ASC`
    ).all(template.id);
    return { success: true, statusCode: 200, data: template };
  }

  async createTemplate(data = {}, actor = null) {
    actor=await this.authorize(actor,'candidate.update');
    if (!this.isManager(actor)) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Chỉ Trưởng phòng Nhân sự hoặc Quản trị viên mới có quyền tạo mẫu onboarding.' };
    }
    const name = data.name ? String(data.name).trim() : '';
    if (!name) {
      return { success: false, statusCode: 400, code: 'NAME_REQUIRED', message: 'Tên mẫu onboarding là bắt buộc.' };
    }
    const departmentId = data.departmentId ? String(data.departmentId).trim() : null;
    const description = data.description ? String(data.description).trim() : null;
    const isDefault = Boolean(data.isDefault);
    const rawItems = Array.isArray(data.items) ? data.items : [];
    if (rawItems.length === 0) {
      return { success: false, statusCode: 400, code: 'ITEMS_REQUIRED', message: 'Mẫu onboarding cần ít nhất 1 mục công việc.' };
    }
    for (const it of rawItems) {
      if (!it.title || !String(it.title).trim()) {
        return { success: false, statusCode: 400, code: 'ITEM_TITLE_REQUIRED', message: 'Tiêu đề công việc là bắt buộc.' };
      }
      const cat = String(it.category || '').toUpperCase().trim();
      if (!TASK_CATEGORIES.includes(cat)) {
        return { success: false, statusCode: 400, code: 'INVALID_CATEGORY', message: `Nhóm công việc '${cat}' không hợp lệ. Phải thuộc: ${TASK_CATEGORIES.join(', ')}` };
      }
    }

    return this.db.transaction(async () => {
      const templateId = 'tmpl-' + crypto.randomUUID();
      const insertTmplSql = this.db.provider === 'postgres'
        ? `INSERT INTO onboarding_templates (id, department_id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        : `INSERT INTO onboarding_templates (id, department_id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
      await this.db.prepare(insertTmplSql).run(templateId, departmentId, name, description, isDefault ? (this.db.provider === 'postgres' ? true : 1) : (this.db.provider === 'postgres' ? false : 0));

      const createdItems = [];
      let order = 1;
      for (const it of rawItems) {
        const itemId = 'tmpi-' + crypto.randomUUID();
        const cat = String(it.category).toUpperCase().trim();
        const title = String(it.title).trim();
        const itemDesc = it.description ? String(it.description).trim() : null;
        const relativeDays = Number(it.relativeDueDays || it.relative_due_days || 1);
        const req = it.isRequired !== false && it.is_required !== false;
        const insertItemSql = this.db.provider === 'postgres'
          ? `INSERT INTO onboarding_template_items (id, template_id, category, title, description, default_assignee_role, default_assignee_id, relative_due_days, display_order, is_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          : `INSERT INTO onboarding_template_items (id, template_id, category, title, description, default_assignee_role, default_assignee_id, relative_due_days, display_order, is_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
        await this.db.prepare(insertItemSql).run(
          itemId, templateId, cat, title, itemDesc, it.defaultAssigneeRole || it.default_assignee_role || null,
          it.defaultAssigneeId || it.default_assignee_id || null, relativeDays, order,
          req ? (this.db.provider === 'postgres' ? true : 1) : (this.db.provider === 'postgres' ? false : 0)
        );
        createdItems.push({ id: itemId, templateId, category: cat, title, description: itemDesc, relativeDueDays: relativeDays, displayOrder: order, isRequired: req });
        order++;
      }

      return {
        success: true,
        statusCode: 201,
        message: 'Tạo mẫu onboarding thành công.',
        data: { id: templateId, departmentId, name, description, isDefault, items: createdItems }
      };
    });
  }

  async initializeOnboarding(data = {}, actor = null) {
    return this.db.transaction(()=>this.#initializeOnboarding(data,actor));
  }

  async #initializeOnboarding(data,actor) {
    actor=await this.authorize(actor,'candidate.update');
    if (!this.isManager(actor)) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Chỉ Trưởng phòng Nhân sự hoặc Quản trị viên mới có quyền khởi tạo checklist onboarding.' };
    }
    const candidateId = data.candidateId ? String(data.candidateId).trim() : null;
    if (!candidateId) {
      return { success: false, statusCode: 400, code: 'CANDIDATE_ID_REQUIRED', message: 'Thiếu mã ứng viên cần khởi tạo onboarding.' };
    }

    const candidate = await this.db.prepare('SELECT * FROM candidates WHERE id = ?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(candidateId);
    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy ứng viên.' };
    }

    const latestOffer = await this.db.prepare(`SELECT * FROM offers WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`).get(candidateId);
    const isAcceptedOffer = latestOffer && latestOffer.status === 'ACCEPTED';
    const isHiredCandidate = candidate.stage === 'HIRED' || candidate.stage === 'ONBOARDED';

    if (!isAcceptedOffer && !isHiredCandidate) {
      return {
        success: false,
        statusCode: 400,
        code: 'OFFER_NOT_ACCEPTED',
        message: 'Chỉ khởi tạo onboarding cho ứng viên đã chấp nhận offer hợp lệ.'
      };
    }

    const existingChecklist = await this.db.prepare(`SELECT * FROM onboarding_checklists WHERE candidate_id = ?`).get(candidateId);
    if (existingChecklist) {
      if (existingChecklist.status) {
        const full = await this.getOnboardingByCandidate(candidateId, actor);
        return {
          success: false,
          statusCode: 409,
          code: 'ONBOARDING_ALREADY_EXISTS',
          message: 'Ứng viên đã có quy trình onboarding đang thực hiện.',
          data: full.data
        };
      }
    }

    let requisition = null;
    if (candidate.requisition_id) {
      requisition = await this.db.prepare(`SELECT * FROM requisitions WHERE id = ?`).get(candidate.requisition_id);
    }

    const departmentId = data.departmentId || requisition?.department_id || null;
    let template = null;
    if (data.templateId) {
      template = await this.db.prepare(`SELECT * FROM onboarding_templates WHERE id = ?`).get(data.templateId);
    }
    if (!template && departmentId) {
      template = await this.db.prepare(`SELECT * FROM onboarding_templates WHERE department_id = ? ORDER BY created_at DESC LIMIT 1`).get(departmentId);
    }
    if (!template) {
      template = await this.db.prepare(`SELECT * FROM onboarding_templates WHERE is_default = ${this.db.provider === 'postgres' ? 'TRUE' : '1'} OR department_id IS NULL ORDER BY created_at DESC LIMIT 1`).get();
    }

    let templateItems = [];
    if (template) {
      templateItems = await this.db.prepare(
        `SELECT * FROM onboarding_template_items WHERE template_id = ? ORDER BY display_order ASC, created_at ASC`
      ).all(template.id);
    }

    if (templateItems.length === 0) {
      templateItems = [
        { category: 'ACCOUNT', title: 'Khởi tạo tài khoản email công ty và Slack', description: 'Tạo tài khoản Google Workspace và chat nội bộ', relative_due_days: 1, is_required: 1, display_order: 1 },
        { category: 'ACCOUNT', title: 'Cấp quyền truy cập hệ thống nghiệp vụ nội bộ', description: 'Cấp quyền vào Jira, Git, ATS', relative_due_days: 1, is_required: 1, display_order: 2 },
        { category: 'EQUIPMENT', title: 'Cấp phát máy tính xách tay và thiết bị làm việc', description: 'Chuẩn bị laptop và phụ kiện', relative_due_days: 1, is_required: 1, display_order: 3 },
        { category: 'WORKSPACE', title: 'Bố trí chỗ ngồi và thẻ ra vào văn phòng', description: 'Bàn làm việc, ghế và phát thẻ từ', relative_due_days: 1, is_required: 1, display_order: 4 },
        { category: 'DOCUMENTATION', title: 'Tiếp nhận hồ sơ nhân sự và ký HĐLĐ', description: 'Thu thập CCCD, bằng cấp, ký hợp đồng lao động', relative_due_days: 3, is_required: 1, display_order: 5 }
      ];
    }

    const startDate = data.startDate || latestOffer?.start_date || new Date().toISOString().split('T')[0];

    return (async () => {
      const checklistId = 'obc-' + crypto.randomUUID();
      const insertCkSql = this.db.provider === 'postgres'
        ? `INSERT INTO onboarding_checklists (id, candidate_id, requisition_id, department_id, template_id, status, progress_percentage, start_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        : `INSERT INTO onboarding_checklists (id, candidate_id, requisition_id, department_id, template_id, status, progress_percentage, start_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', 0, ?, ?, datetime('now'), datetime('now'))`;

      await this.db.prepare(insertCkSql).run(
        checklistId, candidate.id, candidate.requisition_id || null, departmentId,
        template ? template.id : null, startDate, actor.id
      );

      const itemsCreated = [];
      let ord = 1;
      for (const tItem of templateItems) {
        const itemId = 'obi-' + crypto.randomUUID();
        const cat = String(tItem.category).toUpperCase().trim();
        const title = String(tItem.title).trim();
        const desc = tItem.description ? String(tItem.description).trim() : null;
        const assigneeId = data.itemsAssigneeMap?.[tItem.id] || tItem.default_assignee_id || data.defaultAssigneeId || actor.id;
        const relativeDays = Number(tItem.relative_due_days || tItem.relativeDueDays || 1);
        const dueDate = this.calculateDueDate(startDate, relativeDays);
        const req = tItem.is_required !== undefined ? (Number(tItem.is_required) === 1 || tItem.is_required === true) : true;

        const insertItemSql = this.db.provider === 'postgres'
          ? `INSERT INTO onboarding_checklist_items (id, checklist_id, category, title, description, assignee_id, due_date, status, display_order, is_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          : `INSERT INTO onboarding_checklist_items (id, checklist_id, category, title, description, assignee_id, due_date, status, display_order, is_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, datetime('now'), datetime('now'))`;

        await this.db.prepare(insertItemSql).run(
          itemId, checklistId, cat, title, desc, assigneeId, dueDate, ord,
          req ? (this.db.provider === 'postgres' ? true : 1) : (this.db.provider === 'postgres' ? false : 0)
        );

        itemsCreated.push({
          id: itemId, checklistId, category: cat, title, description: desc,
          assigneeId, dueDate, status: 'PENDING', displayOrder: ord, isRequired: req
        });
        ord++;
      }

      const logId = 'oba-' + crypto.randomUUID();
      const insertLogSql = this.db.provider === 'postgres'
        ? `INSERT INTO onboarding_audit_logs (id, checklist_id, actor_id, action, details, created_at) VALUES (?, ?, ?, 'INITIALIZE', ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO onboarding_audit_logs (id, checklist_id, actor_id, action, details, created_at) VALUES (?, ?, ?, 'INITIALIZE', ?, datetime('now'))`;
      await this.db.prepare(insertLogSql).run(logId, checklistId, actor.id, JSON.stringify({
        candidateId, departmentId, templateId: template?.id, itemCount: itemsCreated.length
      }));

      return {
        success: true,
        statusCode: 201,
        message: 'Khởi tạo quy trình onboarding thành công.',
        data: {
          id: checklistId,
          candidateId: candidate.id,
          candidateName: candidate.full_name,
          departmentId,
          templateId: template?.id || null,
          templateName: template?.name || 'Mẫu Onboarding Tiêu chuẩn',
          status: 'IN_PROGRESS',
          progressPercentage: 0,
          startDate,
          items: itemsCreated
        }
      };
    })();
  }

  async getOnboardingByCandidate(candidateId, actor = null) {
    actor=await this.authorize(actor);if(!actor||!await this.canRead(candidateId,actor))return this.denied();
    if (!candidateId) {
      return { success: false, statusCode: 400, code: 'CANDIDATE_ID_REQUIRED', message: 'Thiếu mã ứng viên.' };
    }

    const candidate = await this.db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(candidateId);
    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy ứng viên.' };
    }

    const checklist = await this.db.prepare(`SELECT * FROM onboarding_checklists WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`).get(candidateId);
    if (!checklist) {
      return {
        success: true,
        statusCode: 200,
        data: {
          candidateId: candidate.id,
          candidateName: candidate.full_name,
          candidateStage: candidate.stage,
          checklist: null,
          hasOnboarding: false
        }
      };
    }

    return this.buildChecklistResponse(checklist, candidate, actor);
  }

  async getChecklistById(checklistId, actor = null) {
    actor=await this.authorize(actor);if(!actor)return this.denied();
    if (!checklistId) {
      return { success: false, statusCode: 400, code: 'CHECKLIST_ID_REQUIRED', message: 'Thiếu mã checklist.' };
    }
    const checklist = await this.db.prepare(`SELECT * FROM onboarding_checklists WHERE id = ?`).get(checklistId);
    if (!checklist) {
      return { success: false, statusCode: 404, code: 'CHECKLIST_NOT_FOUND', message: 'Không tìm thấy checklist onboarding.' };
    }
    const candidate = await this.db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(checklist.candidate_id);
    return this.buildChecklistResponse(checklist, candidate, actor);
  }

  async buildChecklistResponse(checklist, candidate, actor = null) {
    actor=await this.authorize(actor);if(!actor||!await this.canRead(checklist.candidate_id,actor))return this.denied();
    const rawItems = await this.db.prepare(
      `SELECT i.*, u.full_name AS assignee_name, u.email AS assignee_email, cb.full_name AS completed_by_name
       FROM onboarding_checklist_items i
       LEFT JOIN users u ON i.assignee_id = u.id
       LEFT JOIN users cb ON i.completed_by = cb.id
       WHERE i.checklist_id = ?
       ORDER BY i.display_order ASC, i.created_at ASC`
    ).all(checklist.id);

    const isMgr = this.isManager(actor);
    const currentUserId = actor?.id;

    let completedCount = 0;
    const totalCount = rawItems.length;

    const items = rawItems.map(item => {
      const isCompleted = item.status === 'COMPLETED';
      if (isCompleted) completedCount++;
      const canUpdate = isMgr || (Boolean(currentUserId) && currentUserId === item.assignee_id);
      return {
        id: item.id,
        checklistId: item.checklist_id,
        category: item.category,
        title: item.title,
        description: item.description,
        assigneeId: item.assignee_id,
        assigneeName: item.assignee_name || 'Chưa phân công',
        assigneeEmail: item.assignee_email || null,
        dueDate: this.formatDateOnly(item.due_date),
        status: item.status,
        completedAt: item.completed_at,
        completedBy: item.completed_by,
        completedByName: item.completed_by_name || null,
        notes: item.notes,
        displayOrder: item.display_order,
        isRequired: Boolean(item.is_required),
        canUpdate
      };
    });

    const progressPercentage = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

    const categories = {};
    for (const cat of TASK_CATEGORIES) {
      const catItems = items.filter(it => it.category === cat);
      const catCompleted = catItems.filter(it => it.status === 'COMPLETED').length;
      categories[cat] = {
        name: cat === 'ACCOUNT' ? 'Tài khoản' : cat === 'EQUIPMENT' ? 'Thiết bị' : cat === 'WORKSPACE' ? 'Chỗ ngồi' : 'Hồ sơ giấy tờ',
        items: catItems,
        total: catItems.length,
        completed: catCompleted,
        progressPercentage: catItems.length === 0 ? 0 : Math.round((catCompleted / catItems.length) * 100)
      };
    }

    let departmentName = 'Chung';
    if (checklist.department_id) {
      const dept = await this.db.prepare(`SELECT name FROM departments WHERE id = ?`).get(checklist.department_id);
      if (dept) departmentName = dept.name;
    }

    return {
      success: true,
      statusCode: 200,
      data: {
        id: checklist.id,
        candidateId: candidate ? candidate.id : checklist.candidate_id,
        candidateName: candidate ? candidate.full_name : null,
        candidateEmail: candidate ? candidate.email : null,
        candidateStage: candidate ? candidate.stage : null,
        requisitionId: checklist.requisition_id,
        departmentId: checklist.department_id,
        departmentName,
        templateId: checklist.template_id,
        status: checklist.status,
        progressPercentage,
        completedCount,
        totalCount,
        startDate: this.formatDateOnly(checklist.start_date),
        completedAt: checklist.completed_at,
        completedBy: checklist.completed_by,
        createdAt: checklist.created_at,
        updatedAt: checklist.updated_at,
        canManage: isMgr,
        hasOnboarding: true,
        items,
        categories
      }
    };
  }

  async updateChecklistItem(checklistId, itemId, data = {}, actor = null) {
    return this.db.transaction(()=>this.#updateChecklistItem(checklistId,itemId,data,actor));
  }

  async #updateChecklistItem(checklistId,itemId,data,actor) {
    actor=await this.authorize(actor);if(!actor)return this.denied();
    if(this.isManager(actor)&&!await this.authorize(actor,'candidate.update'))return this.denied();
    if (!checklistId || !itemId) {
      return { success: false, statusCode: 400, code: 'PARAM_REQUIRED', message: 'Thiếu mã checklist hoặc mã công việc.' };
    }

    const checklist = await this.db.prepare('SELECT * FROM onboarding_checklists WHERE id = ?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(checklistId);
    if (!checklist) {
      return { success: false, statusCode: 404, code: 'CHECKLIST_NOT_FOUND', message: 'Không tìm thấy checklist onboarding.' };
    }

    const item = await this.db.prepare(`SELECT * FROM onboarding_checklist_items WHERE id = ? AND checklist_id = ?`).get(itemId, checklistId);
    if (!item) {
      return { success: false, statusCode: 404, code: 'ITEM_NOT_FOUND', message: 'Không tìm thấy mục công việc trong checklist.' };
    }

    const isMgr = this.isManager(actor);
    const isAssignee = actor && actor.id === item.assignee_id;

    if (!isMgr && !isAssignee) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền cập nhật mục công việc này.' };
    }

    if (!isMgr && (data.assigneeId !== undefined || data.dueDate !== undefined)) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Chỉ Trưởng phòng Nhân sự mới có quyền phân công người phụ trách hoặc đổi hạn hoàn thành.' };
    }

    let newStatus = item.status;
    let completedAt = item.completed_at;
    let completedBy = item.completed_by;

    if (data.status !== undefined) {
      const s = String(data.status).toUpperCase().trim();
      if (!ITEM_STATUSES.includes(s)) {
        return { success: false, statusCode: 400, code: 'INVALID_STATUS', message: `Trạng thái không hợp lệ: ${s}` };
      }
      newStatus = s;
      if (newStatus === 'COMPLETED') {
        if (item.status !== 'COMPLETED') {
          completedAt = new Date().toISOString();
          completedBy = actor ? actor.id : 'system';
        }
      } else {
        completedAt = null;
        completedBy = null;
      }
    }

    let newAssigneeId = item.assignee_id;
    if (data.assigneeId !== undefined && isMgr) {
      const targetUser = data.assigneeId ? await this.db.prepare(`SELECT id FROM users WHERE id = ?`).get(data.assigneeId) : null;
      newAssigneeId = targetUser ? targetUser.id : null;
    }

    let newDueDate = item.due_date;
    if (data.dueDate !== undefined && isMgr) {
      newDueDate = data.dueDate ? String(data.dueDate).trim() : null;
    }

    let newNotes = item.notes;
    if (data.notes !== undefined) {
      newNotes = data.notes ? String(data.notes).trim() : null;
    }

    return (async () => {
      const updateItemSql = this.db.provider === 'postgres'
        ? `UPDATE onboarding_checklist_items SET status = ?, completed_at = ?, completed_by = ?, assignee_id = ?, due_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        : `UPDATE onboarding_checklist_items SET status = ?, completed_at = ?, completed_by = ?, assignee_id = ?, due_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`;

      await this.db.prepare(updateItemSql).run(
        newStatus, completedAt, completedBy, newAssigneeId, newDueDate, newNotes, itemId
      );

      const items = await this.db.prepare(`SELECT id, status, is_required FROM onboarding_checklist_items WHERE checklist_id = ?`).all(checklistId);
      const totalCount = items.length;
      const completedCount = items.filter(it => it.status === 'COMPLETED').length;
      const newProgress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

      const allCompleted = totalCount > 0 && completedCount === totalCount;
      let newChecklistStatus = checklist.status;
      let checklistCompletedAt = checklist.completed_at;
      let checklistCompletedBy = checklist.completed_by;

      if (allCompleted && checklist.status !== 'COMPLETED') {
        newChecklistStatus = 'COMPLETED';
        checklistCompletedAt = checklist.completed_at || new Date().toISOString();
        checklistCompletedBy = checklist.completed_by || (actor ? actor.id : 'system');

        await this.db.prepare(`UPDATE candidates SET stage = 'ONBOARDED' WHERE id = ?`).run(checklist.candidate_id);

        {
          const histId = 'csh-' + crypto.randomUUID();
          const insertHistSql = this.db.provider === 'postgres'
            ? `INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, reason, created_at) VALUES (?, ?, 'HIRED', 'ONBOARDED', ?, ?, 'ONBOARD_COMPLETE', 'Hoàn tất toàn bộ checklist onboarding', CURRENT_TIMESTAMP)`
            : `INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, reason, created_at) VALUES (?, ?, 'HIRED', 'ONBOARDED', ?, ?, 'ONBOARD_COMPLETE', 'Hoàn tất toàn bộ checklist onboarding', datetime('now'))`;
          await this.db.prepare(insertHistSql).run(histId, checklist.candidate_id, actor ? actor.id : 'system', actor ? (actor.fullName || actor.id) : 'Hệ thống');
        }
      } else if (checklist.status === 'COMPLETED' && !allCompleted) {
        newChecklistStatus = 'IN_PROGRESS';
        checklistCompletedAt = null;
        checklistCompletedBy = null;

        const cand = await this.db.prepare(`SELECT stage FROM candidates WHERE id = ?`).get(checklist.candidate_id);
        if (cand && cand.stage === 'ONBOARDED') {
          await this.db.prepare(`UPDATE candidates SET stage = 'HIRED' WHERE id = ?`).run(checklist.candidate_id);
          {
            const histId = 'csh-' + crypto.randomUUID();
            const insertHistSql = this.db.provider === 'postgres'
              ? `INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, reason, created_at) VALUES (?, ?, 'ONBOARDED', 'HIRED', ?, ?, 'ONBOARD_REOPEN', 'Mục onboarding được mở lại', CURRENT_TIMESTAMP)`
              : `INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, reason, created_at) VALUES (?, ?, 'ONBOARDED', 'HIRED', ?, ?, 'ONBOARD_REOPEN', 'Mục onboarding được mở lại', datetime('now'))`;
            await this.db.prepare(insertHistSql).run(histId, checklist.candidate_id, actor ? actor.id : 'system', actor ? (actor.fullName || actor.id) : 'Hệ thống');
          }
        }
      }

      const updateCkSql = this.db.provider === 'postgres'
        ? `UPDATE onboarding_checklists SET status = ?, progress_percentage = ?, completed_at = ?, completed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        : `UPDATE onboarding_checklists SET status = ?, progress_percentage = ?, completed_at = ?, completed_by = ?, updated_at = datetime('now') WHERE id = ?`;

      await this.db.prepare(updateCkSql).run(
        newChecklistStatus, newProgress, checklistCompletedAt, checklistCompletedBy, checklistId
      );

      const logId = 'oba-' + crypto.randomUUID();
      const insertLogSql = this.db.provider === 'postgres'
        ? `INSERT INTO onboarding_audit_logs (id, checklist_id, item_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, 'UPDATE_ITEM', ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO onboarding_audit_logs (id, checklist_id, item_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, 'UPDATE_ITEM', ?, datetime('now'))`;
      await this.db.prepare(insertLogSql).run(
        logId, checklistId, itemId, actor ? actor.id : 'system',
        JSON.stringify({ status: newStatus, assigneeId: newAssigneeId, progress: newProgress, allCompleted })
      );

      const candidate = await this.db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(checklist.candidate_id);
      const updatedChecklist = await this.db.prepare(`SELECT * FROM onboarding_checklists WHERE id = ?`).get(checklistId);
      return this.buildChecklistResponse(updatedChecklist, candidate, actor);
    })();
  }

  async listChecklists(options = {}, actor = null) {
    actor=await this.authorize(actor);if(!actor)return this.denied();
    let sql = `
      SELECT c.*, cd.full_name AS candidate_name, cd.email AS candidate_email, cd.stage AS candidate_stage,
             d.name AS department_name, t.name AS template_name
      FROM onboarding_checklists c
      LEFT JOIN candidates cd ON c.candidate_id = cd.id
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN onboarding_templates t ON c.template_id = t.id
      WHERE 1=1
    `;
    const params = [];
    const scope=this.readScope(actor);
    sql+=' AND (c.candidate_id IN (SELECT c.id FROM candidates c LEFT JOIN requisitions r ON r.id=c.requisition_id WHERE '+scope.condition+') OR EXISTS (SELECT 1 FROM onboarding_checklist_items assigned WHERE assigned.checklist_id=c.id AND assigned.assignee_id=?))';
    params.push(...scope.params,actor.id);
    if (options.departmentId) {
      sql += ` AND c.department_id = ?`;
      params.push(options.departmentId);
    }
    if (options.status) {
      sql += ` AND c.status = ?`;
      params.push(options.status);
    }
    if (options.search) {
      sql += ` AND (cd.full_name LIKE ? OR cd.email LIKE ? OR d.name LIKE ?)`;
      const term = `%${options.search}%`;
      params.push(term, term, term);
    }
    const rawRows = await this.db.prepare(sql).all(...params);
    const rows = rawRows.map(r => ({ ...r, start_date: this.formatDateOnly(r.start_date) }));
    return { success: true, statusCode: 200, data: rows };
  }
}

module.exports = OnboardingService;
