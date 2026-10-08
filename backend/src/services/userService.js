const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { getDatabase } = require('../db/database');
const { hashPassword } = require('../utils/password');
const { getEmailService } = require('./emailService');

/**
 * UserService: Quản lý tài khoản nội bộ (S1-08 AC-01, AC-02, AC-03, AC-04)
 * Vận hành trực tiếp trên CSDL SQLite thật (backend/data/ats.db).
 */
class UserService {
  async resolveDepartment(id, legacyName = '') {
    if (id !== undefined && id !== null && id !== '') {
      const department = (await this.db.prepare('SELECT id,name FROM departments WHERE id=?').get(id));
      if (!department) return { success: false, statusCode: 400, code: 'INVALID_DEPARTMENT', message: 'Phòng ban không tồn tại.' };
      return { success: true, id: department.id, name: department.name };
    }
    const matches = legacyName ? (await this.db.prepare('SELECT id,name FROM departments WHERE name=?').all(legacyName)) : [];
    return { success: true, id: matches.length === 1 ? matches[0].id : null, name: legacyName };
  }
  constructor(db) {
    this.db = db || getDatabase();
    this.emailService = getEmailService(this.db);
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
   * Tạo file Excel mẫu phục vụ nhập danh sách nhân sự hàng loạt.
   * Không ghi dữ liệu vào database.
   * @returns {Promise<Buffer>}
   */
  async buildBulkUserImportTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Internal ATS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('NhanSu');

    worksheet.columns = [
      { header: 'Họ và tên *', key: 'fullName', width: 28 },
      { header: 'Email *', key: 'email', width: 32 },
      { header: 'Chức danh', key: 'jobTitle', width: 28 },
      { header: 'Phòng ban', key: 'departmentName', width: 30 },
      { header: 'Số điện thoại', key: 'phoneNumber', width: 18 },
      { header: 'Mã vai trò', key: 'roleCode', width: 22 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = {
      vertical: 'middle',
      horizontal: 'center'
    };

    worksheet.views = [
      {
        state: 'frozen',
        ySplit: 1
      }
    ];

    worksheet.autoFilter = {
      from: 'A1',
      to: 'F1'
    };

    const roles = (await this.getRolesList()).map(role => role.code);
    const roleListFormula = `"${roles.join(',')}"`;

    for (let rowNumber = 2; rowNumber <= 501; rowNumber++) {
      worksheet.getCell(`F${rowNumber}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [roleListFormula],
        showErrorMessage: true,
        errorTitle: 'Vai trò không hợp lệ',
        error: 'Vui lòng chọn một mã vai trò trong danh sách.'
      };
    }

    const guideSheet = workbook.addWorksheet('HuongDan');

    guideSheet.columns = [
      { header: 'Trường', key: 'field', width: 24 },
      { header: 'Hướng dẫn', key: 'description', width: 80 }
    ];

    guideSheet.getRow(1).font = { bold: true };

    guideSheet.addRows([
      {
        field: 'Họ và tên *',
        description: 'Bắt buộc nhập.'
      },
      {
        field: 'Email *',
        description: 'Bắt buộc, phải đúng định dạng email và chưa tồn tại trong hệ thống.'
      },
      {
        field: 'Chức danh',
        description: 'Không bắt buộc.'
      },
      {
        field: 'Phòng ban',
        description: 'Không bắt buộc.'
      },
      {
        field: 'Số điện thoại',
        description: 'Không bắt buộc.'
      },
      {
        field: 'Mã vai trò',
        description: `Không bắt buộc. Nếu để trống hệ thống sẽ sử dụng INTERVIEWER. Các mã hợp lệ: ${roles.join(', ')}.`
      }
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Đọc và kiểm tra trước dữ liệu nhân sự từ file Excel.
   * Chỉ preview, tuyệt đối không ghi dữ liệu vào database.
   * @param {Buffer} fileBuffer
   * @returns {Promise<object>}
   */
  async previewBulkUserImport(fileBuffer) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMPTY_EXCEL_FILE',
        message: 'Tệp Excel không hợp lệ hoặc không có dữ liệu.'
      };
    }

    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(fileBuffer);
    } catch (err) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_EXCEL_FILE',
        message: 'Không thể đọc tệp Excel. Vui lòng sử dụng tệp .xlsx hợp lệ.'
      };
    }

    const worksheet = workbook.getWorksheet('NhanSu') || workbook.worksheets[0];

    if (!worksheet) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMPTY_WORKBOOK',
        message: 'Tệp Excel không chứa sheet dữ liệu nhân sự.'
      };
    }

    const expectedHeaders = [
      'Họ và tên *',
      'Email *',
      'Chức danh',
      'Phòng ban',
      'Số điện thoại',
      'Mã vai trò'
    ];

    const actualHeaders = expectedHeaders.map((_, index) =>
      worksheet.getCell(1, index + 1).text.trim()
    );

    const invalidHeader = expectedHeaders.some(
      (header, index) => actualHeaders[index] !== header
    );

    if (invalidHeader) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_EXCEL_TEMPLATE',
        message: 'Cấu trúc tệp Excel không đúng mẫu nhập nhân sự.',
        data: {
          expectedHeaders,
          actualHeaders
        }
      };
    }

    const rawRows = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);

      const fullName = row.getCell(1).text.trim();
      const email = row.getCell(2).text.trim().toLowerCase();
      const jobTitle = row.getCell(3).text.trim();
      const departmentName = row.getCell(4).text.trim();
      const phoneNumber = row.getCell(5).text.trim();
      const roleCode = row.getCell(6).text.trim().toUpperCase();

      const isEmpty = [
        fullName,
        email,
        jobTitle,
        departmentName,
        phoneNumber,
        roleCode
      ].every(value => !value);

      if (isEmpty) continue;

      rawRows.push({
        rowNumber,
        fullName,
        email,
        jobTitle,
        departmentName,
        phoneNumber,
        roleCode: roleCode || 'INTERVIEWER'
      });
    }

    if (rawRows.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'NO_IMPORT_ROWS',
        message: 'Tệp Excel không có dòng nhân sự nào để nhập.'
      };
    }

    const emailCounts = new Map();

    for (const row of rawRows) {
      if (!row.email) continue;
      emailCounts.set(
        row.email,
        (emailCounts.get(row.email) || 0) + 1
      );
    }

    const validRoleCodes = new Set(
      (await this.getRolesList()).map(role => role.code)
    );

    const existingEmailStmt = this.db.prepare(
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1'
    );

    const rows = (await Promise.all(rawRows.map(async row => {
      const errors = [];

      if (!row.fullName) {
        errors.push({
          field: 'fullName',
          code: 'REQUIRED_FULL_NAME',
          message: 'Họ và tên là trường bắt buộc.'
        });
      }

      if (!row.email) {
        errors.push({
          field: 'email',
          code: 'REQUIRED_EMAIL',
          message: 'Email là trường bắt buộc.'
        });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        errors.push({
          field: 'email',
          code: 'INVALID_EMAIL',
          message: 'Email không hợp lệ hoặc sai định dạng.'
        });
      } else {
        if ((emailCounts.get(row.email) || 0) > 1) {
          errors.push({
            field: 'email',
            code: 'DUPLICATE_EMAIL_IN_FILE',
            message: 'Email bị trùng trong tệp Excel.'
          });
        }

        if ((await existingEmailStmt.get(row.email))) {
          errors.push({
            field: 'email',
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'Email đã tồn tại trong hệ thống.'
          });
        }
      }

      if (!validRoleCodes.has(row.roleCode)) {
        errors.push({
          field: 'roleCode',
          code: 'INVALID_ROLE_CODE',
          message: `Mã vai trò '${row.roleCode}' không tồn tại trong hệ thống.`
        });
      }

      return {
        ...row,
        valid: errors.length === 0,
        errors
      };
    })));

    const validRows = rows.filter(row => row.valid).length;
    const invalidRows = rows.length - validRows;

    return {
      success: true,
      statusCode: 200,
      code: 'BULK_IMPORT_PREVIEW_READY',
      message: 'Đã kiểm tra tệp Excel. Vui lòng xem kết quả từng dòng trước khi nhập.',
      data: {
        rows,
        summary: {
          totalRows: rows.length,
          validRows,
          invalidRows
        }
      }
    };
  }
  /**
   * Nhập hàng loạt tài khoản từ file Excel.
   * Luôn kiểm tra lại file trước khi import.
   * Dòng lỗi bị bỏ qua, dòng hợp lệ tiếp tục được xử lý.
   * @param {Buffer} fileBuffer
   * @param {string} createdByUserId
   * @returns {Promise<object>}
   */
  async importBulkUsers(fileBuffer, createdByUserId = 'ADMIN') {
    const previewResult = await this.previewBulkUserImport(fileBuffer);

    if (!previewResult.success) {
      return previewResult;
    }

    const previewRows = previewResult.data.rows || [];
    const results = [];

    let importedRows = 0;
    let skippedRows = 0;

    for (const row of previewRows) {
      if (!row.valid) {
        skippedRows++;

        results.push({
          rowNumber: row.rowNumber,
          email: row.email,
          fullName: row.fullName,
          status: 'SKIPPED',
          imported: false,
          errors: row.errors
        });

        continue;
      }

      try {
        const createResult = await this.db.transaction(async () => {
          const result = await this.createUser({fullName:row.fullName,email:row.email,jobTitle:row.jobTitle,
            departmentName:row.departmentName,phoneNumber:row.phoneNumber,roleCode:row.roleCode}, createdByUserId);
          if (!result.success) { const error = new Error('ROW_IMPORT_REJECTED'); error.result = result; throw error; }
          return result;
        });
        importedRows++;
        results.push({rowNumber:row.rowNumber,email:row.email,fullName:row.fullName,status:'IMPORTED',imported:true,
          userId:createResult.data?.user?.id || null,errors:[]});
      } catch (error) {
        skippedRows++;
        results.push({rowNumber:row.rowNumber,email:row.email,fullName:row.fullName,status:'SKIPPED',imported:false,
          errors:[{field:'row',code:error.result?.code || 'USER_CREATE_ERROR',
            message:error.result?.message || 'Có lỗi khi tạo tài khoản cho dòng này.'}]});
      }
    }

    return {
      success: true,
      statusCode: 200,
      code: 'BULK_IMPORT_COMPLETED',
      message: `Hoàn tất nhập nhân sự: ${importedRows} dòng thành công, ${skippedRows} dòng bị bỏ qua.`,
      data: {
        rows: results,
        summary: {
          totalRows: previewRows.length,
          importedRows,
          skippedRows,
          previewValidRows: previewResult.data.summary.validRows,
          previewInvalidRows: previewResult.data.summary.invalidRows
        }
      }
    };
  }
  /**
   * Danh sách người dùng có phân trang, tìm kiếm & bộ lọc (AC-03, AC-04)
   * Mặc định 20 dòng/trang (AC-04).
   * @param {object} options
   * @returns {object}
   */
  async getUsers(options = {}) {
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
    const countResult = (await countStmt.get(...params));
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

    const users = (await dataStmt.all(...queryParams));

    // Lấy vai trò cho từng user
    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.code ASC
    `);

    const items = (await Promise.all(users.map(async user => {
      const userRoles = (await rolesStmt.all(user.id));
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
    })));

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
  async getUserById(id) {
    if (!id) return null;

    const userStmt = this.db.prepare(`
      SELECT id, email, full_name, job_title, department_id, department_name, phone_number, status, lock_reason, created_at, updated_at
      FROM users
      WHERE id = ?
    `);
    const user = (await userStmt.get(id));
    if (!user) return null;

    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `);
    const roles = (await rolesStmt.all(id));

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
  async createUser(data = {}, createdByUserId = 'ADMIN') {
    return this.db.transaction(async () => {
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const jobTitle = typeof data.jobTitle === 'string' ? data.jobTitle.trim() : '';
    let departmentName = typeof (data.departmentName ?? data.department) === 'string' ? (data.departmentName ?? data.department).trim() : '';
    const department = (await this.resolveDepartment(data.departmentId, departmentName));
    if (!department.success) return department;
    departmentName = department.name;
    const phoneNumber = typeof (data.phoneNumber ?? data.phone) === 'string' ? (data.phoneNumber ?? data.phone).trim() : '';
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
    if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('create-user:' + email);
    const checkEmailStmt = this.db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1');
    const existing = (await checkEmailStmt.get(email));
    if (existing) {
      return {
        success: false,
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: `Email '${email}' đã tồn tại trong hệ thống. Vui lòng sử dụng địa chỉ email khác.`
      };
    }

    // 3. Xác định Role ID từ database
    let roleRow = (await this.db.prepare('SELECT id, code, name FROM roles WHERE code = ? LIMIT 1').get(roleCode));
    if (!roleRow) {
      roleRow = (await this.db.prepare("SELECT id, code, name FROM roles WHERE code = 'INTERVIEWER' LIMIT 1").get());
      roleCode = roleRow.code;
    }

    // 4. AC-01: Tự động sinh mật khẩu tạm ngẫu nhiên và băm an toàn Scrypt
    const tempPassword = this.generateTemporaryPassword();
    const passwordHash = hashPassword(tempPassword);

    const newUserId = 'usr-' + crypto.randomUUID();

    const insertUserStmt = this.db.prepare(`
      INSERT INTO users (
        id, email, password_hash, full_name, job_title, department_id, department_name, phone_number, status, failed_attempts, must_change_password, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, TRUE, datetime('now'), datetime('now')
      )
    `);

    (await insertUserStmt.run(
      newUserId,
      email,
      passwordHash,
      fullName,
      jobTitle || null,
      department.id,
      departmentName || 'Hệ thống Nội bộ',
      phoneNumber || null
    ));

    // Gán vai trò ban đầu vào bảng user_roles
    const insertRoleStmt = this.db.prepare(`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (?, ?)
    `);
    (await insertRoleStmt.run(newUserId, roleRow.id));

    // Chuẩn bị email kích hoạt (AC-01)
    const activationEmail = {
      recipient: email,
      subject: '[ATS] Kích hoạt tài khoản nội bộ & Mật khẩu tạm thời',
      body: `Kính gửi ${fullName},\n\nTài khoản của bạn trên Hệ thống Tuyển dụng Nội bộ (ATS) đã được tạo thành công.\n\nThông tin đăng nhập:\n- Email: ${email}\n- Mật khẩu tạm: ${tempPassword}\n- Vai trò cấp quyền: ${roleRow.name} (${roleRow.code})\n\nVui lòng đăng nhập và đổi mật khẩu trong phiên làm việc đầu tiên.`
    };

    // Dispatch real email via EmailService
    if (this.emailService) {
      this.db.afterCommit(() => this.emailService.sendAccountActivationEmail(email, fullName, tempPassword, roleRow.name).catch(err => {
        console.error('[UserService] Error dispatching activation email:', err.message);
      }));
    }

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

    });
  }

  /**
   * Cập nhật thông tin người dùng (AC-03)
   * @param {string} id
   * @param {object} data
   * @param {string} updatedByUserId
   * @returns {object}
   */
  async updateUser(id, data = {}, updatedByUserId = 'ADMIN') {
    if (!id) {
      return { success: false, statusCode: 400, code: 'MISSING_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const checkStmt = this.db.prepare('SELECT id, email FROM users WHERE id = ?');
    const existing = (await checkStmt.get(id));
    if (!existing) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần cập nhật.' };
    }

    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const jobTitle = typeof data.jobTitle === 'string' ? data.jobTitle.trim() : '';
    let departmentName = typeof (data.departmentName ?? data.department) === 'string' ? (data.departmentName ?? data.department).trim() : '';
    const department = (await this.resolveDepartment(data.departmentId, departmentName));
    if (!department.success) return department;
    departmentName = department.name;
    const phoneNumber = typeof (data.phoneNumber ?? data.phone) === 'string' ? (data.phoneNumber ?? data.phone).trim() : '';

    if (!fullName) {
      return { success: false, statusCode: 400, code: 'VALIDATION_ERROR', message: 'Họ và tên là trường bắt buộc.' };
    }

    const updateStmt = this.db.prepare(`
      UPDATE users
      SET full_name = ?, job_title = ?, department_id = ?, department_name = ?, phone_number = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    (await updateStmt.run(fullName, jobTitle || null, department.id, departmentName || null, phoneNumber || null, id));

    const updatedUser = (await this.getUserById(id));

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
   * Cập nhật hồ sơ cá nhân của chính người dùng.
   * Chỉ cho phép sửa họ tên, chức danh và số điện thoại.
   * Email, phòng ban và vai trò luôn được giữ nguyên.
   */
  async updateProfile(id, data = {}, { validatePhone = true } = {}) {
    if (!id) {
      return {
        success: false,
        statusCode: 400,
        code: 'MISSING_ID',
        message: 'Mã người dùng không hợp lệ.'
      };
    }

    const existing = (await this.db.prepare(
      'SELECT id FROM users WHERE id = ?'
    ).get(id));

    if (!existing) {
      return {
        success: false,
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy người dùng.'
      };
    }

    const fullName =
      typeof data.fullName === 'string'
        ? data.fullName.trim()
        : '';

    const jobTitle =
      typeof data.jobTitle === 'string'
        ? data.jobTitle.trim()
        : '';

    const rawPhoneNumber =
      typeof data.phoneNumber === 'string'
        ? data.phoneNumber.trim()
        : '';

    if (!fullName) {
      return {
        success: false,
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Họ và tên là trường bắt buộc.'
      };
    }

    // Cho phép nhập: 0912345678, 0912 345 678,
    // 0912-345-678 hoặc +84912345678.
    const phoneNumber = validatePhone ? rawPhoneNumber.replace(/[\s.-]/g, '') : rawPhoneNumber;

    // Định dạng số di động Việt Nam hiện hành.
    const vietnamPhoneRegex =
      /^(?:0|\+84)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;

    if (validatePhone && phoneNumber && !vietnamPhoneRegex.test(phoneNumber)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_PHONE_NUMBER',
        message: 'Số điện thoại Việt Nam không đúng định dạng.'
      };
    }

    const updateStmt = this.db.prepare(`
      UPDATE users
      SET full_name = ?,
          job_title = ?,
          phone_number = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    (await updateStmt.run(
      fullName,
      jobTitle || null,
      phoneNumber || null,
      id
    ));

    const updatedUser = (await this.getUserById(id));

    return {
      success: true,
      statusCode: 200,
      code: 'USER_UPDATED',
      message: 'Cập nhật thông tin người dùng thành công (AC-03).',
      data: { user: updatedUser }
    };
  }
  /**
   * Lấy danh sách 7 vai trò để hiển thị trên Dropdown bộ lọc hoặc form tạo (AC-03)
   * @returns {Array<object>}
   */
  async getRolesList() {
    const stmt = this.db.prepare('SELECT id, code, name, default_path, description FROM roles ORDER BY code ASC');
    return (await stmt.all());
  }

  /**
   * Lấy vai trò hiện tại của 1 người dùng cùng toàn bộ danh mục vai trò hệ thống (S1-09)
   * @param {string} userId
   * @returns {object|null}
   */
  async getUserRoles(userId) {
    if (!userId) return null;

    const user = (await this.getUserById(userId));
    if (!user) return null;

    const allRoles = (await this.getRolesList());

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
  async assignUserRoles(targetUserId, roleCodes, requestingUser = {}) {
    return this.db.transaction(async () => {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = (await this.getUserById(targetUserId));
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
    if (normalizedCodes.length === 0) {
      return { success: false, statusCode: 400, code: 'EMPTY_ROLES', message: 'Người dùng phải được gán ít nhất một vai trò hợp lệ.' };
    }

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
    const allRoles = (await this.getRolesList());
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

    let updatedUser;
    (await this.db.exec('SAVEPOINT assign_user_roles'));
    try {
      (await deleteOldRoles.run(targetUserId));
      for (const code of normalizedCodes) {
        const roleId = validRoleMap.get(code);
        (await insertNewRole.run(targetUserId, roleId));
      }
      updatedUser = (await this.getUserById(targetUserId));
      (await this.db.exec('RELEASE SAVEPOINT assign_user_roles'));
    } catch (error) {
      (await this.db.exec('ROLLBACK TO SAVEPOINT assign_user_roles'));
      (await this.db.exec('RELEASE SAVEPOINT assign_user_roles'));
      throw error;
    }

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

    });
  }

  /**
   * Lấy danh sách vị trí tuyển dụng đang mở do người dùng phụ trách (S1-10 AC-03)
   * @param {string} userId
   * @returns {Array<object>}
   */
  async getUserHandoverRequisitions(userId) {
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
    return (await stmt.all(userId, userId, userId, userId, userId, userId));
  }

  /**
   * Khóa tài khoản người dùng (S1-10 AC-01, AC-02, AC-03)
   * @param {string} targetUserId
   * @param {string} reason Lý do khóa (bắt buộc - AC-02)
   * @param {object} requestingUser Người thực hiện khóa
   * @returns {object}
   */
  async lockUser(targetUserId, reason, requestingUser = {}) {
    return this.db.transaction(async () => {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = (await this.getUserById(targetUserId));
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
    (await updateStmt.run(trimmedReason, targetUserId));

    // AC-01: Thu hồi ngay lập tức tất cả các phiên đăng nhập đang mở phía server
    const deleteSessionsStmt = this.db.prepare('DELETE FROM sessions WHERE user_id = ?');
    (await deleteSessionsStmt.run(targetUserId));

    // Ghi audit log
    const auditStmt = this.db.prepare(`
      INSERT INTO login_audit_logs (id, email, ip_address, status, reason, attempted_at)
      VALUES (?, ?, ?, 'ACCOUNT_LOCKED', ?, datetime('now'))
    `);
    (await auditStmt.run(crypto.randomUUID(), targetUser.email, 'SYSTEM', `Khóa bởi ${requestingUser.email || 'ADMIN'}: ${trimmedReason}`));

    // AC-03: Kiểm tra vị trí tuyển dụng do người đó phụ trách
    const handoverRequisitions = (await this.getUserHandoverRequisitions(targetUserId));
    const handoverRequired = handoverRequisitions.length > 0;

    if (handoverRequired) {
      const markHandoverStmt = this.db.prepare(`
        UPDATE requisitions
        SET handover_required = TRUE,
            handover_notes = ?,
            updated_at = datetime('now')
        WHERE (recruiter_id = ? OR hiring_manager_id = ?)
          AND status IN ('OPEN', 'IN_PROGRESS')
      `);
      (await markHandoverStmt.run(
        `Cảnh báo: Nhân sự ${targetUser.fullName} (${targetUser.email}) đã bị khóa tài khoản vào lúc ${new Date().toISOString()}. Lý do: ${trimmedReason}. Cần bàn giao vị trí.`,
        targetUserId,
        targetUserId
      ));
    }

    const updatedUser = (await this.getUserById(targetUserId));

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

    });
  }

  /**
   * Mở khóa tài khoản người dùng (S1-10)
   * @param {string} targetUserId
   * @param {object} requestingUser
   * @returns {object}
   */
  async unlockUser(targetUserId, requestingUser = {}) {
    return this.db.transaction(async () => {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = (await this.getUserById(targetUserId));
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
    (await unlockStmt.run(targetUserId));

    // Ghi audit log
    const auditStmt = this.db.prepare(`
      INSERT INTO login_audit_logs (id, email, ip_address, status, reason, attempted_at)
      VALUES (?, ?, ?, 'ACCOUNT_UNLOCKED', ?, datetime('now'))
    `);
    (await auditStmt.run(crypto.randomUUID(), targetUser.email, 'SYSTEM', `Mở khóa bởi ${requestingUser.email || 'ADMIN'}`));

    const updatedUser = (await this.getUserById(targetUserId));

    return {
      success: true,
      statusCode: 200,
      code: 'ACCOUNT_UNLOCKED_SUCCESS',
      message: `Tài khoản '${targetUser.email}' đã được mở khóa thành công. Người dùng có thể đăng nhập bình thường.`,
      data: {
        user: updatedUser
      }
    };

    });
  }

  /**
   * Reset mật khẩu người dùng bởi Quản trị viên
   * Sinh mật khẩu tạm mới, cập nhật CSDL và gửi email
   */
  async resetUserPassword(targetUserId, requestingUser = {}) {
    return this.db.transaction(async () => {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = (await this.getUserById(targetUserId));
    if (!targetUser) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần đặt lại mật khẩu.' };
    }

    const tempPassword = this.generateTemporaryPassword();
    const passwordHash = hashPassword(tempPassword);

    const updateStmt = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `);
    (await updateStmt.run(passwordHash, targetUserId));

    // Chấm dứt các session cũ
    (await this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId));

    // Gửi email thông báo
    if (this.emailService) {
      this.db.afterCommit(() => this.emailService.sendAccountActivationEmail(targetUser.email, targetUser.fullName, tempPassword, targetUser.roles.join(', ')).catch(err => {
        console.error('[UserService] Error sending reset email:', err.message);
      }));
    }

    return {
      success: true,
      statusCode: 200,
      code: 'PASSWORD_RESET_SUCCESS',
      message: `Đặt lại mật khẩu cho tài khoản '${targetUser.email}' thành công.`,
      data: {
        userId: targetUserId,
        email: targetUser.email,
        temporaryPassword: tempPassword
      }
    };

    });
  }

  /**
   * Xóa tài khoản người dùng
   */
  async deleteUser(targetUserId, requestingUser = {}) {
    return this.db.transaction(async () => {
    if (!targetUserId) {
      return { success: false, statusCode: 400, code: 'MISSING_USER_ID', message: 'Mã người dùng không hợp lệ.' };
    }

    const targetUser = (await this.getUserById(targetUserId));
    if (!targetUser) {
      return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng cần xóa.' };
    }

    // Không thể xóa chính mình
    if (requestingUser && (requestingUser.id === targetUserId || requestingUser.email === targetUser.email)) {
      return { success: false, statusCode: 400, code: 'CANNOT_DELETE_SELF', message: 'Bạn không thể tự xóa tài khoản của chính mình.' };
    }

    // Department ownership introduced in Sprint 2 must never partially delete a user.
    (await this.db.exec('BEGIN IMMEDIATE'));
    try {
      if ((await this.db.prepare('SELECT 1 FROM departments WHERE manager_id = ? LIMIT 1').get(targetUserId))) {
        (await this.db.exec('ROLLBACK'));
        return { success: false, statusCode: 409, code: 'USER_IS_DEPARTMENT_MANAGER', message: 'Người dùng đang phụ trách phòng ban nên không thể xóa.' };
      }
      (await this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId));
      (await this.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(targetUserId));
      (await this.db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId));
      (await this.db.exec('COMMIT'));
    } catch (error) {
      (await this.db.exec('ROLLBACK'));
      throw error;
    }

    return {
      success: true,
      statusCode: 200,
      code: 'USER_DELETED_SUCCESS',
      message: `Đã xóa tài khoản '${targetUser.email}' khỏi hệ thống.`
    };

    });
  }
}

module.exports = UserService;
