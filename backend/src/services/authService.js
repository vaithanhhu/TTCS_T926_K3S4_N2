const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { verifyPassword } = require('../utils/password');
const config = require('../config/config');

// Dummy hash used for constant-time failure when email is not found
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

class AuthService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  /**
   * Log an audit event
   */
  logAudit(email, ip, status, reason) {
    try {
      const id = 'aud-' + crypto.randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO login_audit_logs (id, email, ip_address, status, reason, attempted_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      stmt.run(id, email || 'unknown', ip || '127.0.0.1', status, reason || null);
    } catch (err) {
      console.error('[Audit Error]', err.message);
    }
  }

  /**
   * Handle Login per User Story S1-01
   * @param {string} email
   * @param {string} password
   * @param {string} ipAddress
   * @returns {object} Result with statusCode, success, message, and optional data
   */
  login(email, password, ipAddress = '127.0.0.1') {
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return {
        success: false,
        statusCode: 400,
        message: 'Email và mật khẩu không được để trống.',
        code: 'MISSING_FIELDS'
      };
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Find user by email
    const getUserStmt = this.db.prepare(`
      SELECT id, email, password_hash, full_name, job_title, department_id, department_name, phone_number, status, lock_reason, failed_attempts, locked_until
      FROM users
      WHERE email = ?
    `);
    const user = getUserStmt.get(normalizedEmail);

    // 2. If user exists, check temporary lock (15 minutes after 5 failures)
    if (user && user.locked_until) {
      const lockedUntilTime = new Date(user.locked_until).getTime();
      const now = Date.now();

      if (now < lockedUntilTime) {
        const remainingMinutes = Math.max(1, Math.ceil((lockedUntilTime - now) / 60000));
        this.logAudit(normalizedEmail, ipAddress, 'LOCKED', `Tài khoản đang bị khóa tạm thời. Còn ${remainingMinutes} phút.`);
        return {
          success: false,
          statusCode: 423,
          message: 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.',
          code: 'ACCOUNT_TEMPORARILY_LOCKED',
          remainingMinutes
        };
      } else {
        // Lock period has expired, reset counter and lock
        this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(user.id);
        user.failed_attempts = 0;
        user.locked_until = null;
      }
    }

    // 3. If user exists, check administrative account status
    if (user && user.status === 'LOCKED') {
      this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Tài khoản đã bị quản trị viên khóa.');
      return {
        success: false,
        statusCode: 403,
        message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.',
        code: 'ACCOUNT_PERMANENTLY_LOCKED'
      };
    }

    if (user && user.status === 'INACTIVE') {
      this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Tài khoản chưa được kích hoạt.');
      return {
        success: false,
        statusCode: 403,
        message: 'Tài khoản chưa được kích hoạt hoặc đã ngừng hoạt động.',
        code: 'ACCOUNT_INACTIVE'
      };
    }

    // 4. Verify password (using constant-time scrypt verification)
    let isPasswordValid = false;
    if (user) {
      isPasswordValid = verifyPassword(password, user.password_hash);
    } else {
      // Mitigate timing attacks by verifying dummy hash
      verifyPassword(password, DUMMY_HASH);
    }

    // 5. Handle authentication failure (AC-02: generic error message, no account leaking)
    if (!user || !isPasswordValid) {
      if (user) {
        const newFailedAttempts = (user.failed_attempts || 0) + 1;

        if (newFailedAttempts >= config.MAX_FAILED_ATTEMPTS) {
          // AC-03: Temporary lock for 15 minutes after 5 consecutive failures
          const lockTime = new Date(Date.now() + config.LOCK_TIME_MINUTES * 60 * 1000).toISOString();
          this.db.prepare(`
            UPDATE users
            SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(newFailedAttempts, lockTime, user.id);

          this.logAudit(normalizedEmail, ipAddress, 'LOCKED', 'Khóa tạm thời 15 phút do nhập sai 5 lần liên tiếp.');
          return {
            success: false,
            statusCode: 423,
            message: 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.',
            code: 'ACCOUNT_TEMPORARILY_LOCKED',
            remainingMinutes: config.LOCK_TIME_MINUTES
          };
        } else {
          this.db.prepare(`
            UPDATE users
            SET failed_attempts = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(newFailedAttempts, user.id);

          this.logAudit(normalizedEmail, ipAddress, 'FAILURE', `Sai mật khẩu lần ${newFailedAttempts}/5.`);
        }
      } else {
        this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Email không tồn tại trong hệ thống.');
      }

      // Generic error response per AC-02
      return {
        success: false,
        statusCode: 401,
        message: 'Email hoặc mật khẩu không chính xác.',
        code: 'INVALID_CREDENTIALS'
      };
    }

    // 6. Handle successful login
    // Reset failed attempts & locks
    this.db.prepare(`
      UPDATE users
      SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(user.id);

    // Fetch user roles
    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.code ASC
    `);
    const userRoles = rolesStmt.all(user.id);
    const roleCodes = userRoles.map(r => r.code);

    // AC-01: Determine default home path for the role
    const defaultHome = this.determineDefaultHome(roleCodes, userRoles);

    // Fetch user permissions from DB (S1-05 RBAC)
    const permsStmt = this.db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY p.code ASC
    `);
    const permissions = permsStmt.all(user.id).map(p => p.code);

    // Create session token with configurable TTL (S1-02)
    const token = 'ats_sess_' + crypto.randomBytes(32).toString('hex');
    const sessionId = 'sess-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_MINUTES * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at, last_activity_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(sessionId, user.id, token, expiresAt);

    this.logAudit(normalizedEmail, ipAddress, 'SUCCESS', 'Đăng nhập thành công.');

    return {
      success: true,
      statusCode: 200,
      message: 'Đăng nhập thành công.',
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          jobTitle: user.job_title,
          departmentName: user.department_name,
          roles: roleCodes,
          permissions,
          defaultHome
        },
        token,
        expiresAt
      }
    };
  }

  /**
   * Validate session token, perform auto-renewal if active (AC-01 & AC-03)
   * @param {string} token
   * @param {boolean} renew Whether to automatically extend expiry time
   * @returns {object} Validation result
   */
  validateSession(token, renew = true) {
    if (!token || typeof token !== 'string') {
      return {
        valid: false,
        statusCode: 401,
        message: 'Yêu cầu không có phiên làm việc hợp lệ.',
        code: 'MISSING_TOKEN'
      };
    }

    const sessionStmt = this.db.prepare(`
      SELECT s.id AS session_id, s.user_id, s.token, s.expires_at, s.last_activity_at,
             u.id, u.email, u.full_name, u.job_title, u.department_name, u.status, u.locked_until
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ?
    `);
    const session = sessionStmt.get(token);

    if (!session) {
      return {
        valid: false,
        statusCode: 401,
        message: 'Phiên đăng nhập không tồn tại hoặc đã bị đăng xuất.',
        code: 'INVALID_SESSION'
      };
    }

    // AC-03: Check expiration
    const expiresAtTime = new Date(session.expires_at).getTime();
    const now = Date.now();

    if (now > expiresAtTime) {
      // Invalidate expired session in DB
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return {
        valid: false,
        statusCode: 401,
        message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        code: 'SESSION_EXPIRED'
      };
    }

    // Check account status
    if (session.status === 'LOCKED' || (session.locked_until && new Date(session.locked_until).getTime() > now)) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return {
        valid: false,
        statusCode: 403,
        message: 'Tài khoản của bạn đã bị khóa. Phiên làm việc đã bị thu hồi.',
        code: 'ACCOUNT_LOCKED'
      };
    }

    if (session.status === 'INACTIVE') {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return {
        valid: false,
        statusCode: 403,
        message: 'Tài khoản chưa được kích hoạt hoặc đã ngừng hoạt động.',
        code: 'ACCOUNT_INACTIVE'
      };
    }

    // AC-01: Auto-renewal of session when active
    let currentExpiresAt = session.expires_at;
    if (renew) {
      currentExpiresAt = new Date(now + config.SESSION_TTL_MINUTES * 60 * 1000).toISOString();
      this.db.prepare(`
        UPDATE sessions
        SET expires_at = ?, last_activity_at = datetime('now')
        WHERE token = ?
      `).run(currentExpiresAt, token);
    }

    // Fetch user roles
    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.code ASC
    `);
    const userRoles = rolesStmt.all(session.user_id);
    const roleCodes = userRoles.map(r => r.code);
    const defaultHome = this.determineDefaultHome(roleCodes, userRoles);

    // Fetch user permissions from DB (S1-05 RBAC)
    const permsStmt = this.db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY p.code ASC
    `);
    const permissions = permsStmt.all(session.user_id).map(p => p.code);

    return {
      valid: true,
      statusCode: 200,
      user: {
        id: session.id,
        email: session.email,
        fullName: session.full_name,
        jobTitle: session.job_title,
        departmentName: session.department_name,
        roles: roleCodes,
        permissions,
        defaultHome
      },
      token,
      expiresAt: currentExpiresAt
    };
  }

  /**
   * Secure Logout - Immediately invalidate session on server (AC-02)
   * @param {string} token
   * @param {string} ipAddress
   * @returns {object} Result
   */
  logout(token, ipAddress = '127.0.0.1') {
    if (!token || typeof token !== 'string') {
      return {
        success: true,
        statusCode: 200,
        message: 'Đăng xuất thành công.'
      };
    }

    const session = this.db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
    if (session) {
      const user = this.db.prepare('SELECT email FROM users WHERE id = ?').get(session.user_id);
      this.logAudit(user ? user.email : 'unknown', ipAddress, 'LOGOUT', 'Đăng xuất chủ động. Thu hồi phiên máy chủ.');
      // AC-02: Revoke immediately on server
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Đăng xuất thành công. Phiên làm việc đã mất hiệu lực.'
    };
  }

  /**
   * Determine primary landing path based on roles (AC-01)
   */
  determineDefaultHome(roleCodes, roleObjects = []) {
    if (roleCodes.includes('ADMIN')) return '/admin';
    if (roleCodes.includes('HR_MANAGER')) return '/dashboard';
    if (roleCodes.includes('RECRUITER')) return '/recruitment';
    if (roleCodes.includes('HIRING_MGR')) return '/hiring';
    if (roleCodes.includes('INTERVIEWER')) return '/interviews';
    if (roleCodes.includes('APPROVER')) return '/approvals';
    if (roleCodes.includes('CANDIDATE')) return '/candidate';
    if (roleObjects.length > 0 && roleObjects[0].default_path) {
      return roleObjects[0].default_path;
    }
    return '/dashboard';
  }

  /**
   * Request Password Reset Link (S1-03 AC-01 & AC-03)
   * @param {string} email
   * @param {string} ipAddress
   * @returns {object} Response
   */
  requestPasswordReset(email, ipAddress = '127.0.0.1') {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return {
        success: false,
        statusCode: 400,
        message: 'Vui lòng cung cấp email hợp lệ.',
        code: 'INVALID_EMAIL'
      };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = this.db.prepare('SELECT id, email, status FROM users WHERE email = ?').get(normalizedEmail);

    let resetToken = null;
    let resetExpiresAt = null;

    // Only create token if user exists and is not locked/inactive
    if (user && user.status === 'ACTIVE') {
      resetToken = 'ats_reset_' + crypto.randomBytes(32).toString('hex');
      const tokenId = 'rst-' + crypto.randomUUID();
      resetExpiresAt = new Date(Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();

      // Invalidate previous unused reset tokens for this user
      this.db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);

      // Save token in DB (AC-01: valid for 30 minutes)
      this.db.prepare(`
        INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(tokenId, user.id, resetToken, resetExpiresAt);

      this.logAudit(normalizedEmail, ipAddress, 'SUCCESS', 'Yêu cầu đặt lại mật khẩu. Đã tạo token 30 phút.');
    } else {
      // User not found or inactive: Still log audit failure
      this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Yêu cầu đặt lại mật khẩu cho email không tồn tại hoặc tài khoản bị khóa.');
    }

    // AC-03: Return identical response message regardless of whether email exists or not
    return {
      success: true,
      statusCode: 200,
      message: 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn.',
      code: 'RESET_LINK_SENT',
      demoResetToken: resetToken // Provided for integration testing and demo environment
    };
  }

  /**
   * Verify Reset Token Validity (AC-01 & AC-02)
   * @param {string} token
   * @returns {object} Result
   */
  verifyResetToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, statusCode: 400, message: 'Mã xác thực không hợp lệ.', code: 'INVALID_TOKEN' };
    }

    const row = this.db.prepare(`
      SELECT prt.id, prt.user_id, prt.token, prt.expires_at, prt.used_at, u.email, u.status
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token = ?
    `).get(token);

    if (!row) {
      return { valid: false, statusCode: 400, message: 'Liên kết đặt lại mật khẩu không tồn tại hoặc không hợp lệ.', code: 'TOKEN_NOT_FOUND' };
    }

    // AC-02: Single use only
    if (row.used_at) {
      return { valid: false, statusCode: 400, message: 'Liên kết đặt lại mật khẩu này đã được sử dụng trước đó.', code: 'TOKEN_ALREADY_USED' };
    }

    // AC-01: 30 minutes expiration
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { valid: false, statusCode: 400, message: 'Liên kết đặt lại mật khẩu đã hết hạn (chỉ có hiệu lực 30 phút). Vui lòng yêu cầu liên kết mới.', code: 'TOKEN_EXPIRED' };
    }

    if (row.status !== 'ACTIVE') {
      return { valid: false, statusCode: 403, message: 'Tài khoản liên kết hiện không hoạt động hoặc đã bị khóa.', code: 'ACCOUNT_NOT_ACTIVE' };
    }

    return { valid: true, statusCode: 200, userId: row.user_id, email: row.email };
  }

  /**
   * Reset Password with Token (S1-03 AC-01 & AC-02)
   * @param {string} token
   * @param {string} newPassword
   * @param {string} ipAddress
   * @returns {object} Result
   */
  resetPassword(token, newPassword, ipAddress = '127.0.0.1') {
    const verifyResult = this.verifyResetToken(token);
    if (!verifyResult.valid) {
      return {
        success: false,
        statusCode: verifyResult.statusCode,
        message: verifyResult.message,
        code: verifyResult.code
      };
    }

    // Password validation (minimum 8 characters with letter and number)
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return {
        success: false,
        statusCode: 400,
        message: 'Mật khẩu mới phải có tối thiểu 8 ký tự.',
        code: 'WEAK_PASSWORD'
      };
    }

    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return {
        success: false,
        statusCode: 400,
        message: 'Mật khẩu mới phải bao gồm cả chữ cái và chữ số.',
        code: 'WEAK_PASSWORD'
      };
    }

    // Hash new password using Scrypt + salt
    const { hashPassword } = require('../utils/password');
    const newPasswordHash = hashPassword(newPassword);

    // Update user password and reset failed attempts/locks
    this.db.prepare(`
      UPDATE users
      SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(newPasswordHash, verifyResult.userId);

    // AC-02: Mark token as used (single use guarantee)
    this.db.prepare(`
      UPDATE password_reset_tokens
      SET used_at = datetime('now')
      WHERE token = ?
    `).run(token);

    // Revoke all existing sessions for this user for security
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(verifyResult.userId);

    this.logAudit(verifyResult.email, ipAddress, 'SUCCESS', 'Đặt lại mật khẩu thành công qua email.');

    return {
      success: true,
      statusCode: 200,
      message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
      code: 'PASSWORD_RESET_SUCCESS'
    };
  }

  /**
   * Change Password while logged in (S1-04 AC-01, AC-02, AC-03)
   * @param {string} token Current authenticated session token
   * @param {string} currentPassword Required current password (AC-01)
   * @param {string} newPassword New password (min 8 chars, letter + number) (AC-02)
   * @param {string} ipAddress Client IP
   * @returns {object} Result
   */
  changePassword(token, currentPassword, newPassword, ipAddress = '127.0.0.1') {
    // 1. Verify active session
    const sessionResult = this.validateSession(token, false);
    if (!sessionResult.valid) {
      return {
        success: false,
        statusCode: 401,
        message: 'Phiên làm việc không hợp lệ hoặc đã hết hạn.',
        code: 'UNAUTHORIZED'
      };
    }

    const userId = sessionResult.user.id;

    // 2. AC-01: Bắt buộc nhập mật khẩu hiện tại
    if (!currentPassword || typeof currentPassword !== 'string') {
      return {
        success: false,
        statusCode: 400,
        message: 'Bắt buộc nhập mật khẩu hiện tại.',
        code: 'MISSING_CURRENT_PASSWORD'
      };
    }

    const user = this.db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?').get(userId);
    if (!user) {
      return {
        success: false,
        statusCode: 404,
        message: 'Không tìm thấy người dùng.',
        code: 'USER_NOT_FOUND'
      };
    }

    // Verify current password with constant-time scrypt check
    const isCurrentPasswordCorrect = verifyPassword(currentPassword, user.password_hash);
    if (!isCurrentPasswordCorrect) {
      this.logAudit(user.email, ipAddress, 'FAILURE', 'Đổi mật khẩu thất bại: Sai mật khẩu hiện tại.');
      return {
        success: false,
        statusCode: 400,
        message: 'Mật khẩu hiện tại không chính xác.',
        code: 'INVALID_CURRENT_PASSWORD'
      };
    }

    // 3. AC-02: Mật khẩu mới tối thiểu 8 ký tự, có chữ và số
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return {
        success: false,
        statusCode: 400,
        message: 'Mật khẩu mới phải có tối thiểu 8 ký tự.',
        code: 'WEAK_PASSWORD'
      };
    }

    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return {
        success: false,
        statusCode: 400,
        message: 'Mật khẩu mới phải bao gồm cả chữ cái và chữ số.',
        code: 'WEAK_PASSWORD'
      };
    }

    if (currentPassword === newPassword) {
      return {
        success: false,
        statusCode: 400,
        message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.',
        code: 'SAME_PASSWORD'
      };
    }

    // 4. Hash new password with Scrypt + salt
    const { hashPassword } = require('../utils/password');
    const newHash = hashPassword(newPassword);

    this.db.prepare(`
      UPDATE users
      SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(newHash, userId);

    // 5. AC-03: Đổi xong thu hồi các phiên đăng nhập khác (giữ lại phiên hiện tại)
    const revokeResult = this.db.prepare(`
      DELETE FROM sessions
      WHERE user_id = ? AND token != ?
    `).run(userId, token);

    this.logAudit(user.email, ipAddress, 'SUCCESS', `Đổi mật khẩu thành công. Đã thu hồi ${revokeResult.changes} phiên khác.`);

    return {
      success: true,
      statusCode: 200,
      message: 'Đổi mật khẩu thành công. Các phiên đăng nhập khác đã được thu hồi.',
      code: 'PASSWORD_CHANGED_SUCCESS',
      revokedSessionsCount: revokeResult.changes
    };
  }
}

module.exports = AuthService;
