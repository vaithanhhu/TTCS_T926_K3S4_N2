const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { hashPassword } = require('../utils/password');

/**
 * UserService: Quản lý tài khoản nội bộ (S1-08 AC-01, AC-02, AC-03, AC-04)
 * Vận hành trực tiếp trên CSDL SQLite thật (backend/data/ats.db).
 */
class UserService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  /**
   * Sinh mật khẩu tạm an toàn đáp ứng AC-01 & AC-02 S1-04 (Tối thiểu 8 ký tự, có chữ và số)
   * @returns {string} Mật khẩu tạm thời ngẫu nhiên
   */
  generateTemporaryPassword() {
    const charsUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const charsLower = 'abcdefghijkmnpqrstuvwxyz';
    const charsDigits = '23456789';
    const charsSpecial = '@#$%&*';

    let pwd = 'Ats@';
    for (let i = 0; i < 3; i++) {
      pwd += charsUpper.charAt(crypto.randomInt(0, charsUpper.length));
      pwd += charsLower.charAt(crypto.randomInt(0, charsLower.length));
      pwd += charsDigits.charAt(crypto.randomInt(0, charsDigits.length));
    }
    return pwd;
  }

  /**
   * Danh sách người dùng có phân trang, tìm kiếm & bộ lọc (AC-03, AC-04)
   * Mặc định 20 dòng/trang (AC-04).
   * @param {object} options
   * @returns {object}
   */
  getUsers(options = {}) {
    let page = parseInt(options.page, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(options.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20; // AC-04: Mặc định 20 dòng

    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const role = typeof options.role === 'string' ? options.role.trim() : '';
    const status = typeof options.status === 'string' ? options.status.trim() : '';

    const conditions = [];
    const params = [];

    // Tìm kiếm đa trường theo tên, email, phòng ban (AC-03)
    if (search) {
      conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.department_name LIKE ? OR u.job_title LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    // Lọc theo vai trò (AC-03)
    if (role && role !== 'ALL') {
      conditions.push(`EXISTS (
        SELECT 1 FROM user_roles ur2
        JOIN roles r2 ON ur2.role_id = r2.id
        WHERE ur2.user_id = u.id AND (r2.code = ? OR r2.name = ?)
      )`);
      params.push(role, role);
    }

    // Lọc theo trạng thái (AC-03)
    if (status && status !== 'ALL') {
      conditions.push('u.status = ?');
      params.push(status);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 1. Tính tổng số dòng
    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM users u ${whereSql}`);
    const countResult = countStmt.get(...params);
    const totalItems = countResult ? countResult.total : 0;
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // 2. Lấy dữ liệu trang
    const offset = (page - 1) * limit;
    const queryParams = [...params, limit, offset];

    const dataStmt = this.db.prepare(`
      SELECT u.id, u.email, u.full_name, u.job_title, u.department_id, u.department_name, u.phone_number, u.status, u.lock_reason, u.created_at, u.updated_at
      FROM users u
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const users = dataStmt.all(...queryParams);

    // Lấy vai trò cho từng user
    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.code ASC
    `);

    const items = users.map(user => {
      const userRoles = rolesStmt.all(user.id);
      return {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        jobTitle: user.job_title || '',
        departmentId: user.department_id || '',
        departmentName: user.department_name || '',
        phoneNumber: user.phone_number || '',
        status: user.status,
        lockReason: user.lock_reason || null,
        roles: userRoles.map(r => r.code),
        roleNames: userRoles.map(r => r.name),
        createdAt: user.created_at,
        updatedAt: user.updated_at
      };
    });

    return {
      success: true,
      data: {
        items,
        pagination: {
          totalItems,
          totalPages,
          currentPage: page,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    };
  }

  /**
   * Lấy chi tiết 1 người dùng theo ID
   * @param {string} id
   * @returns {object|null}
   */
  getUserById(id) {
    if (!id) return null;

    const userStmt = this.db.prepare(`
      SELECT id, email, full_name, job_title, department_id, department_name, phone_number, status, lock_reason, created_at, updated_at
      FROM users
      WHERE id = ?
    `);
    const user = userStmt.get(id);
    if (!user) return null;

    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `);
    const roles = rolesStmt.all(id);

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      jobTitle: user.job_title || '',
      departmentId: user.department_id || '',
      departmentName: user.department_name || '',
      phoneNumber: user.phone_number || '',
      status: user.status,
      lockReason: user.lock_reason || null,
      roles: roles.map(r => r.code),
      roleNames: roles.map(r => r.name),
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };
  }

  /**
   * Tạo tài khoản người dùng nội bộ mới (AC-01 & AC-02)
   * @param {object} data
   * @param {string} createdByUserId
   * @returns {object}
   */
  createUser(data = {}, createdByUserId = 'ADMIN') {
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const jobTitle = typeof data.jobTitle === 'string' ? data.jobTitle.trim() : '';
    const departmentName = typeof data.departmentName === 'string' ? data.departmentName.trim() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    let roleCode = typeof data.roleCode === 'string' ? data.roleCode.trim() : 'INTERVIEWER';

    // 1. Kiểm tra đầu vào bắt buộc
    if (!fullName) {
      return {
        success: false,
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Họ và tên là trường bắt buộc.'
      };
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_EMAIL',
        message: 'Email không hợp lệ hoặc sai định dạng.'
      };
    }

    // 2. AC-02: Kiểm tra email trùng lặp (Collated NOCASE)
    const checkEmailStmt = this.db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1');
    const existing = checkEmailStmt.get(email);
    if (existing) {
      return {
        success: false,
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: `Email '${email}' đã tồn tại trong hệ thống. Vui lòng sử dụng địa chỉ email khác.`
      };
    }

    // 3. Xác định Role ID từ database
    let roleRow = this.db.prepare('SELECT id, code, name FROM roles WHERE code = ? LIMIT 1').get(roleCode);
    if (!roleRow) {
      roleRow = this.db.prepare('SELECT id, code, name FROM roles WHERE code = "INTERVIEWER" LIMIT 1').get();
      roleCode = roleRow.code;
    }

    // 4. AC-01: Tự động sinh mật khẩu tạm ngẫu nhiên và băm an toàn Scrypt
    const tempPassword = this.generateTemporaryPassword();
    const passwordHash = hashPassword(tempPassword);

    const newUserId = 'usr-' + crypto.randomUUID();

    const insertUserStmt = this.db.prepare(`
      INSERT INTO users (
        id, email, password_hash, full_name, job_title, department_id, department_name, phone_number, status, failed_attempts, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, datetime('now'), datetime('now')
      )
    `);

    insertUserStmt.run(
      newUserId,
      email,
      passwordHash,
      fullName,
      jobTitle || null,
      'dept-auto',
      departmentName || 'Hệ thống Nội bộ',
      phoneNumber || null
    );

    // Gán vai trò ban đầu vào bảng user_roles
    const insertRoleStmt = this.db.prepare(`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (?, ?)
    `);
    insertRoleStmt.run(newUserId, roleRow.id);

    // Chuẩn bị email kích hoạt mô phỏng (AC-01)
    const activationEmail = {
      recipient: email,
      subject: '🔐 [ATS] Kích hoạt tài khoản nội bộ & Mật khẩu tạm thời',
      body: `Kính gửi ${fullName},\n\nTài khoản của bạn trên Hệ thống Tuyển dụng Nội bộ (ATS) đã được tạo thành công.\n\nThông tin đăng nhập:\n- Email: ${email}\n- Mật khẩu tạm: ${tempPassword}\n- Vai trò cấp quyền: ${roleRow.name} (${roleRow.code})\n\nVui lòng đăng nhập và đổi mật khẩu trong phiên làm việc đầu tiên.`
    };

    return {
      success: true,
      statusCode: 201,
      code: 'USER_CREATED',
      message: 'Tạo tài khoản người dùng nội bộ thành công (AC-01).',
      data: {
        user: {
          id: newUserId,
          email,
          fullName,
          jobTitle: jobTitle || '',
          departmentName: departmentName || 'Hệ thống Nội bộ',
          phoneNumber: phoneNumber || '',
          status: 'ACTIVE',
          roles: [roleRow.code],
          roleNames: [roleRow.name]
        },
        temporaryPassword: tempPassword,
        activationEmail
      }
    };
  }

  /**
   * Cập nhật thông tin người dùng (AC-03)
   * @param {string} id
   * @param {object} data
   * @param {string} updatedByUserId
   * @returns {object}
   */
  updateUser(id, data = {}, updatedByUserId = 'ADMIN') {
    if (!id) {
      return { success: false, statusCode: 400, code: 'MISSING_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const checkStmt = this.db.prepare('SELECT id, email FROM users WHERE id = ?');
    const existing = checkStmt.get(id);
    if (!existing) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần cập nhật.' };
    }

    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const jobTitle = typeof data.jobTitle === 'string' ? data.jobTitle.trim() : '';
    const departmentName = typeof data.departmentName === 'string' ? data.departmentName.trim() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';

    if (!fullName) {
      return { success: false, statusCode: 400, code: 'VALIDATION_ERROR', message: 'Họ và tên là trường bắt buộc.' };
    }

    const updateStmt = this.db.prepare(`
      UPDATE users
      SET full_name = ?, job_title = ?, department_name = ?, phone_number = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    updateStmt.run(fullName, jobTitle || null, departmentName || null, phoneNumber || null, id);

    const updatedUser = this.getUserById(id);

    return {
      success: true,
      statusCode: 200,
      code: 'USER_UPDATED',
      message: 'Cập nhật thông tin người dùng thành công (AC-03).',
      data: {
        user: updatedUser
      }
    };
  }

  /**
   * Lấy danh sách 7 vai trò để hiển thị trên Dropdown bộ lọc hoặc form tạo (AC-03)
   * @returns {Array<object>}
   */
  getRolesList() {
    const stmt = this.db.prepare('SELECT id, code, name, default_path, description FROM roles ORDER BY code ASC');
    return stmt.all();
  }

  /**
   * Lấy vai trò hiện tại của 1 người dùng cùng toàn bộ danh mục vai trò hệ thống (S1-09)
   * @param {string} userId
   * @returns {object|null}
   */
  getUserRoles(userId) {
    if (!userId) return null;

    const user = this.getUserById(userId);
    if (!user) return null;

    const allRoles = this.getRolesList();

    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      currentRoles: user.roles,
      currentRoleNames: user.roleNames,
      availableRoles: allRoles
    };
  }

  /**
   * Gán và thu hồi vai trò cho một người dùng (S1-09 AC-01, AC-02, AC-03)
   * @param {string} targetUserId ID người dùng được gán vai trò
   * @param {Array<string>} roleCodes Danh sách mã vai trò mới (AC-01 Multi-role)
   * @param {object} requestingUser Người dùng đang thực hiện yêu cầu
   * @returns {object}
   */
  assignUserRoles(targetUserId, roleCodes, requestingUser = {}) {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = this.getUserById(targetUserId);
    if (!targetUser) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần phân vai trò.' };
    }

    if (!Array.isArray(roleCodes) || roleCodes.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMPTY_ROLES',
        message: 'Người dùng phải được gán ít nhất một vai trò hợp lệ.'
      };
    }

    // Chuẩn hóa và lọc danh sách vai trò
    const normalizedCodes = [...new Set(roleCodes.map(r => typeof r === 'string' ? r.trim().toUpperCase() : ''))].filter(Boolean);

    // AC-03: Không thể tự thu hồi vai trò quản trị (ADMIN) của chính mình
    const isSelfEdit = requestingUser && (requestingUser.id === targetUserId || requestingUser.email === targetUser.email);
    const requestingUserRoles = (requestingUser && requestingUser.roles) || [];
    const isSelfAdmin = isSelfEdit && (requestingUserRoles.includes('ADMIN') || targetUser.roles.includes('ADMIN'));

    if (isSelfAdmin && !normalizedCodes.includes('ADMIN')) {
      return {
        success: false,
        statusCode: 400,
        code: 'CANNOT_REVOKE_OWN_ADMIN_ROLE',
        message: 'Bạn không thể tự thu hồi vai trò Quản trị hệ thống (ADMIN) của chính mình để tránh nguy cơ mất quyền quản trị.'
      };
    }

    // Kiểm tra tất cả mã vai trò có tồn tại trong CSDL không
    const allRoles = this.getRolesList();
    const validRoleMap = new Map(allRoles.map(r => [r.code, r.id]));

    for (const code of normalizedCodes) {
      if (!validRoleMap.has(code)) {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_ROLE_CODE',
          message: `Vai trò '${code}' không tồn tại trong hệ thống.`
        };
      }
    }

    // AC-02: Cập nhật trực tiếp CSDL thật để có hiệu lực ngay ở thao tác kế tiếp
    const deleteOldRoles = this.db.prepare('DELETE FROM user_roles WHERE user_id = ?');
    const insertNewRole = this.db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');

    deleteOldRoles.run(targetUserId);
    for (const code of normalizedCodes) {
      const roleId = validRoleMap.get(code);
      insertNewRole.run(targetUserId, roleId);
    }

    const updatedUser = this.getUserById(targetUserId);

    return {
      success: true,
      statusCode: 200,
      code: 'ROLES_ASSIGNED_SUCCESS',
      message: 'Cập nhật phân quyền vai trò cho người dùng thành công (S1-09).',
      data: {
        userId: targetUserId,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        roles: updatedUser.roles,
        roleNames: updatedUser.roleNames
      }
    };
  }

  /**
   * Lấy danh sách vị trí tuyển dụng đang mở do người dùng phụ trách (S1-10 AC-03)
   * @param {string} userId
   * @returns {Array<object>}
   */
  getUserHandoverRequisitions(userId) {
    if (!userId) return [];
    const stmt = this.db.prepare(`
      SELECT r.id, r.code, r.title, r.department_name, r.status, r.headcount, r.handover_required,
             CASE
               WHEN r.recruiter_id = ? AND r.hiring_manager_id = ? THEN 'RECRUITER_AND_HIRING_MGR'
               WHEN r.recruiter_id = ? THEN 'RECRUITER'
               WHEN r.hiring_manager_id = ? THEN 'HIRING_MGR'
               ELSE 'UNKNOWN'
             END AS assigned_role
      FROM requisitions r
      WHERE (r.recruiter_id = ? OR r.hiring_manager_id = ?)
        AND r.status IN ('OPEN', 'IN_PROGRESS')
      ORDER BY r.code ASC
    `);
    return stmt.all(userId, userId, userId, userId, userId, userId);
  }

  /**
   * Khóa tài khoản người dùng (S1-10 AC-01, AC-02, AC-03)
   * @param {string} targetUserId
   * @param {string} reason Lý do khóa (bắt buộc - AC-02)
   * @param {object} requestingUser Người thực hiện khóa
   * @returns {object}
   */
  lockUser(targetUserId, reason, requestingUser = {}) {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = this.getUserById(targetUserId);
    if (!targetUser) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần khóa.' };
    }

    // Chặn Admin tự khóa tài khoản của chính mình (chống self-lockout)
    const isSelfLock = requestingUser && (requestingUser.id === targetUserId || requestingUser.email === targetUser.email);
    if (isSelfLock) {
      return {
        success: false,
        statusCode: 400,
        code: 'CANNOT_LOCK_OWN_ACCOUNT',
        message: 'Bạn không thể tự khóa tài khoản quản trị của chính mình.'
      };
    }

    // AC-02: Bắt buộc ghi lý do khóa
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason || trimmedReason.length < 5) {
      return {
        success: false,
        statusCode: 400,
        code: 'MISSING_LOCK_REASON',
        message: 'Lý do khóa tài khoản là trường bắt buộc (AC-02), tối thiểu 5 ký tự.'
      };
    }

    // AC-01: Cập nhật trạng thái người dùng thành LOCKED và lưu lý do
    const updateStmt = this.db.prepare(`
      UPDATE users
      SET status = 'LOCKED', lock_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    updateStmt.run(trimmedReason, targetUserId);

    // AC-01: Thu hồi ngay lập tức tất cả các phiên đăng nhập đang mở phía server
    const deleteSessionsStmt = this.db.prepare('DELETE FROM sessions WHERE user_id = ?');
    deleteSessionsStmt.run(targetUserId);

    // Ghi audit log
    const auditStmt = this.db.prepare(`
      INSERT INTO login_audit_logs (id, email, ip_address, status, reason, attempted_at)
      VALUES (?, ?, ?, 'ACCOUNT_LOCKED', ?, datetime('now'))
    `);
    auditStmt.run(crypto.randomUUID(), targetUser.email, 'SYSTEM', `Khóa bởi ${requestingUser.email || 'ADMIN'}: ${trimmedReason}`);

    // AC-03: Kiểm tra vị trí tuyển dụng do người đó phụ trách
    const handoverRequisitions = this.getUserHandoverRequisitions(targetUserId);
    const handoverRequired = handoverRequisitions.length > 0;

    if (handoverRequired) {
      const markHandoverStmt = this.db.prepare(`
        UPDATE requisitions
        SET handover_required = 1,
            handover_notes = ?,
            updated_at = datetime('now')
        WHERE (recruiter_id = ? OR hiring_manager_id = ?)
          AND status IN ('OPEN', 'IN_PROGRESS')
      `);
      markHandoverStmt.run(
        `Cảnh báo: Nhân sự ${targetUser.fullName} (${targetUser.email}) đã bị khóa tài khoản vào lúc ${new Date().toISOString()}. Lý do: ${trimmedReason}. Cần bàn giao vị trí.`,
        targetUserId,
        targetUserId
      );
    }

    const updatedUser = this.getUserById(targetUserId);

    return {
      success: true,
      statusCode: 200,
      code: 'ACCOUNT_LOCKED_SUCCESS',
      message: handoverRequired
        ? `Tài khoản '${targetUser.email}' đã bị khóa thành công (AC-01 & AC-02). CẢNH BÁO BÀN GIAO (AC-03): Người này đang phụ trách ${handoverRequisitions.length} vị trí tuyển dụng cần bàn giao!`
        : `Tài khoản '${targetUser.email}' đã bị khóa thành công (AC-01 & AC-02).`,
      data: {
        user: updatedUser,
        handoverRequired,
        handoverCount: handoverRequisitions.length,
        handoverRequisitions
      }
    };
  }

  /**
   * Mở khóa tài khoản người dùng (S1-10)
   * @param {string} targetUserId
   * @param {object} requestingUser
   * @returns {object}
   */
  unlockUser(targetUserId, requestingUser = {}) {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = this.getUserById(targetUserId);
    if (!targetUser) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần mở khóa.' };
    }

    const unlockStmt = this.db.prepare(`
      UPDATE users
      SET status = 'ACTIVE',
          lock_reason = NULL,
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    unlockStmt.run(targetUserId);

    // Ghi audit log
    const auditStmt = this.db.prepare(`
      INSERT INTO login_audit_logs (id, email, ip_address, status, reason, attempted_at)
      VALUES (?, ?, ?, 'ACCOUNT_UNLOCKED', ?, datetime('now'))
    `);
    auditStmt.run(crypto.randomUUID(), targetUser.email, 'SYSTEM', `Mở khóa bởi ${requestingUser.email || 'ADMIN'}`);

    const updatedUser = this.getUserById(targetUserId);

    return {
      success: true,
      statusCode: 200,
      code: 'ACCOUNT_UNLOCKED_SUCCESS',
      message: `Tài khoản '${targetUser.email}' đã được mở khóa thành công. Người dùng có thể đăng nhập bình thường.`,
      data: {
        user: updatedUser
      }
    };
  }
}

module.exports = UserService;
