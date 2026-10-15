const crypto = require('node:crypto');
const RbacMiddleware = require('../middlewares/rbacMiddleware');

class ApprovalConfigurationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ApprovalConfigurationService {
  constructor(db) { this.db = db; this.rbac = new RbacMiddleware(db); }

  async lock(departmentId) {
    if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('approval-configuration:' + departmentId);
  }

  salary(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new ApprovalConfigurationError('INVALID_SALARY_LIMIT', 'Hạn mức phải là số VND hợp lệ, không âm.');
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) throw new ApprovalConfigurationError('INVALID_SALARY_LIMIT', 'Hạn mức phải là số VND hợp lệ, không âm.');
    return number;
  }

  async eligibleApprovers() {
    return this.db.prepare(`SELECT u.id, u.full_name AS name FROM users u WHERE u.status='ACTIVE'
      AND ${this.rbac.permissionPredicate('u.id',"'requisition.approve'")} ORDER BY u.full_name, u.id`).all();
  }

  async departments() {
    return this.db.prepare("SELECT id, name FROM departments WHERE status='ACTIVE' ORDER BY name, id").all();
  }

  async validate(departmentId, levels) {
    if (typeof departmentId !== 'string' || !departmentId.trim()) throw new ApprovalConfigurationError('INVALID_APPROVAL_DEPARTMENT', 'Vui lòng chọn phòng ban hợp lệ.');
    const department = await this.db.prepare("SELECT id, name FROM departments WHERE id=? AND status='ACTIVE'").get(departmentId);
    if (!department) throw new ApprovalConfigurationError('INVALID_APPROVAL_DEPARTMENT', 'Phòng ban không tồn tại hoặc đã ngừng hoạt động.');
    if (!Array.isArray(levels) || !levels.length) throw new ApprovalConfigurationError('APPROVAL_LEVELS_REQUIRED', 'Cấu hình cần ít nhất một cấp duyệt.');
    const normalized = levels.map(level => {
      if (!level || !Number.isSafeInteger(level.order) || level.order < 1) throw new ApprovalConfigurationError('INVALID_APPROVAL_ORDER', 'Thứ tự cấp phải là số nguyên liên tục bắt đầu từ 1.');
      if (typeof level.approverUserId !== 'string' || !level.approverUserId.trim()) throw new ApprovalConfigurationError('INVALID_APPROVER', 'Mỗi cấp cần một người duyệt cụ thể.');
      return { order: level.order, salaryLimit: this.salary(level.salaryLimit), approverUserId: level.approverUserId.trim() };
    }).sort((a, b) => a.order - b.order);
    if (new Set(normalized.map(level => level.approverUserId)).size !== normalized.length) throw new ApprovalConfigurationError('REPEATED_APPROVER_FORBIDDEN', 'Mỗi người chỉ được xuất hiện một lần trong chuỗi phê duyệt.');
    const approvers = new Map((await this.eligibleApprovers()).map(user => [user.id, user.name]));
    for (let index = 0; index < normalized.length; index++) {
      const level = normalized[index];
      if (level.order !== index + 1) throw new ApprovalConfigurationError('INVALID_APPROVAL_ORDER', 'Thứ tự cấp phải là số nguyên liên tục bắt đầu từ 1.');
      if (index && level.salaryLimit <= normalized[index - 1].salaryLimit) throw new ApprovalConfigurationError('INVALID_APPROVAL_LIMIT_ORDER', 'Hạn mức các cấp phải tăng dần, không được trùng nhau.');
      if (!approvers.has(level.approverUserId)) throw new ApprovalConfigurationError('APPROVER_NOT_ELIGIBLE', 'Người duyệt không tồn tại, không hoạt động hoặc thiếu quyền requisition.approve.');
      level.approverName = approvers.get(level.approverUserId);
    }
    return { department, levels: normalized };
  }

  async list() {
    return this.db.prepare(`SELECT c.id, c.department_id AS "departmentId", c.department_name AS "departmentName",
      c.published_version_id AS "publishedVersionId", v.version_number AS "publishedVersion",
      (SELECT MAX(version_number) FROM approval_configuration_versions WHERE configuration_id=c.id) AS "latestVersion"
      FROM approval_configurations c LEFT JOIN approval_configuration_versions v ON v.id=c.published_version_id ORDER BY c.department_name, c.id`).all();
  }

  async get(id) {
    const configuration = await this.db.prepare('SELECT * FROM approval_configurations WHERE id=?').get(id);
    if (!configuration) throw new ApprovalConfigurationError('APPROVAL_CONFIGURATION_NOT_FOUND', 'Không tìm thấy cấu hình phê duyệt.', 404);
    const versions = await this.db.prepare('SELECT * FROM approval_configuration_versions WHERE configuration_id=? ORDER BY version_number DESC').all(id);
    const levels = await this.db.prepare(`SELECT l.* FROM approval_configuration_levels l JOIN approval_configuration_versions v ON v.id=l.version_id WHERE v.configuration_id=? ORDER BY l.level_order`).all(id);
    return { id: configuration.id, departmentId: configuration.department_id, departmentName: configuration.department_name,
      publishedVersionId: configuration.published_version_id,
      versions: versions.map(version => ({ id: version.id, version: version.version_number, state: version.state, createdAt: version.created_at,
        publishedAt: version.published_at, levels: levels.filter(level => level.version_id === version.id).map(level => ({ order: level.level_order,
          salaryLimit: Number(level.salary_limit), approverUserId: level.approver_user_id, approverName: level.approver_name })) })) };
  }

  async create(data, actorId) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApprovalConfigurationError('INVALID_APPROVAL_CONFIGURATION', 'Cấu hình phải là một đối tượng hợp lệ.');
    return this.db.transaction(async () => {
      await this.lock(data.departmentId);
      const valid = await this.validate(data.departmentId, data.levels);
      if (await this.db.prepare('SELECT id FROM approval_configurations WHERE department_id=?').get(valid.department.id)) throw new ApprovalConfigurationError('APPROVAL_CONFIGURATION_EXISTS', 'Phòng ban đã có cấu hình. Hãy tạo phiên bản mới.', 409);
      const id = 'apc-' + crypto.randomUUID();
      await this.db.prepare('INSERT INTO approval_configurations(id,department_id,department_name) VALUES (?,?,?)').run(id, valid.department.id, valid.department.name);
      await this.insertVersion(id, 1, valid.levels, actorId);
      return this.get(id);
    });
  }

  async insertVersion(id, number, levels, actorId) {
    const versionId = 'apv-' + crypto.randomUUID();
    await this.db.prepare('INSERT INTO approval_configuration_versions(id,configuration_id,version_number,created_by) VALUES (?,?,?,?)').run(versionId, id, number, actorId);
    for (const level of levels) await this.db.prepare('INSERT INTO approval_configuration_levels(version_id,level_order,salary_limit,approver_user_id,approver_name) VALUES (?,?,?,?,?)').run(versionId, level.order, level.salaryLimit, level.approverUserId, level.approverName);
    return versionId;
  }

  async newVersion(id, data, actorId) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApprovalConfigurationError('INVALID_APPROVAL_CONFIGURATION', 'Cấu hình phải là một đối tượng hợp lệ.');
    return this.db.transaction(async () => {
      const configuration = await this.get(id);
      await this.lock(configuration.departmentId);
      const valid = await this.validate(configuration.departmentId, data.levels);
      const latest = await this.db.prepare('SELECT MAX(version_number) AS number FROM approval_configuration_versions WHERE configuration_id=?').get(id);
      if (data.expectedVersion !== latest.number) throw new ApprovalConfigurationError('APPROVAL_CONFIGURATION_CONFLICT', 'Cấu hình đã thay đổi. Vui lòng tải lại trước khi lưu.', 409);
      await this.insertVersion(id, latest.number + 1, valid.levels, actorId);
      return this.get(id);
    });
  }

  async publish(id, versionId, actorId) {
    return this.db.transaction(async () => {
      const configuration = await this.get(id);
      await this.lock(configuration.departmentId);
      const current = await this.get(id);
      const version = current.versions.find(item => item.id === versionId);
      if (!version) throw new ApprovalConfigurationError('APPROVAL_VERSION_NOT_FOUND', 'Không tìm thấy phiên bản cấu hình.', 404);
      if (version.state !== 'DRAFT' || version.version !== current.versions[0].version) throw new ApprovalConfigurationError('APPROVAL_CONFIGURATION_CONFLICT', 'Chỉ được công bố phiên bản nháp mới nhất.', 409);
      await this.validate(current.departmentId, version.levels);
      await this.db.prepare("UPDATE approval_configuration_versions SET state='PUBLISHED',published_by=?,published_at=datetime('now') WHERE id=? AND state='DRAFT'").run(actorId, versionId);
      await this.db.prepare('UPDATE approval_configurations SET published_version_id=? WHERE id=?').run(versionId, id);
      return this.get(id);
    });
  }

  async resolve(departmentId, proposedSalaryMax) {
    if (typeof departmentId !== 'string' || !departmentId.trim()) throw new ApprovalConfigurationError('INVALID_APPROVAL_DEPARTMENT', 'Vui lòng chọn phòng ban hợp lệ.');
    const salary = this.salary(proposedSalaryMax);
    const configuration = await this.db.prepare('SELECT id,published_version_id FROM approval_configurations WHERE department_id=?').get(departmentId);
    if (!configuration?.published_version_id) throw new ApprovalConfigurationError('APPROVAL_CONFIGURATION_UNAVAILABLE', 'Không có cấu hình đã công bố cho phòng ban này.', 409);
    const detail = await this.get(configuration.id);
    const version = detail.versions.find(item => item.id === configuration.published_version_id);
    const end = version.levels.findIndex(level => salary <= level.salaryLimit);
    if (end < 0) throw new ApprovalConfigurationError('APPROVAL_SALARY_NOT_COVERED', 'Không có cấp duyệt đủ hạn mức cho mức lương đề xuất.', 409);
    const chain = version.levels.slice(0, end + 1);
    await this.validate(departmentId, chain);
    return { configurationId: configuration.id, configurationVersionId: version.id, version: version.version, currency: 'VND',
      salaryBasis: 'proposedSalaryMax', proposedSalaryMax: salary, departmentId, levels: chain };
  }

  async bindSnapshot(workflowId, requisitionId) {
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new ApprovalConfigurationError('INVALID_APPROVAL_WORKFLOW', 'Thiếu định danh workflow.');
    return this.db.transaction(async () => {
      const previous = await this.db.prepare('SELECT * FROM requisition_approval_snapshots WHERE workflow_id=?').get(workflowId);
      if (previous) {
        if (previous.requisition_id !== requisitionId) throw new ApprovalConfigurationError('APPROVAL_SNAPSHOT_CONFLICT', 'Workflow đã gắn với yêu cầu khác.', 409);
        return JSON.parse(previous.snapshot_json);
      }
      const requisition = await this.db.prepare('SELECT department_id,proposed_salary_max FROM requisitions WHERE id=?' + (this.db.provider === 'postgres' ? ' FOR UPDATE' : '')).get(requisitionId);
      if (!requisition) throw new ApprovalConfigurationError('REQUISITION_NOT_FOUND', 'Không tìm thấy yêu cầu tuyển dụng.', 404);
      await this.lock(requisition.department_id);
      if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('approval-snapshot:' + workflowId);
      const concurrent = await this.db.prepare('SELECT * FROM requisition_approval_snapshots WHERE workflow_id=?').get(workflowId);
      if (concurrent) {
        if (concurrent.requisition_id !== requisitionId) throw new ApprovalConfigurationError('APPROVAL_SNAPSHOT_CONFLICT', 'Workflow đã gắn với yêu cầu khác.', 409);
        return JSON.parse(concurrent.snapshot_json);
      }
      const snapshot = { ...(await this.resolve(requisition.department_id, requisition.proposed_salary_max)), workflowId, requisitionId };
      await this.db.prepare('INSERT INTO requisition_approval_snapshots(workflow_id,requisition_id,configuration_version_id,snapshot_json) VALUES (?,?,?,?)').run(workflowId, requisitionId, snapshot.configurationVersionId, JSON.stringify(snapshot));
      return snapshot;
    });
  }
}

module.exports = { ApprovalConfigurationService, ApprovalConfigurationError };
