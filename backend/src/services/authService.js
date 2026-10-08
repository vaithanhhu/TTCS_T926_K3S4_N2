const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { verifyPassword, hashPassword } = require('../utils/password');
const config = require('../config/config');
const { getEmailService } = require('./emailService');

// Dummy hash used for constant-time failure when email is not found
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

class AuthService {
  async atomic(identity, action) {
    return this.db.transaction(async () => {
      if (this.db.provider === 'postgres') {
        const key = crypto.createHash('sha256').update(String(identity)).digest('hex');
        await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(key);
      }
      return action();
    });
  }
  constructor(db) {
    this.db = db || getDatabase();
    this.emailService = getEmailService(this.db);
  }

  /**
   * Log an audit event
   */
  async logAudit(email, ip, status, reason) {
    try {
      const id = 'aud-' + crypto.randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO login_audit_logs (id, email, ip_address, status, reason, attempted_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      (await stmt.run(id, email || 'unknown', ip || '127.0.0.1', status, reason || null));
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
  async login(email, password, ipAddress = '127.0.0.1') {
    return this.atomic(String(email).trim().toLowerCase(), async () => {
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
      SELECT id, email, password_hash, full_name, job_title, department_id, department_name, phone_number, status, lock_reason, failed_attempts, locked_until, must_change_password
      FROM users
      WHERE email = ?
    `);
    const user = (await getUserStmt.get(normalizedEmail));
    // Unknown identifiers receive the same server-owned attempt/lock response.
    // Reuse durable login audit records; never create a user or a frontend counter.
    const loginState = user || (await this.getUnknownLoginState(normalizedEmail));

    // 2. If user exists, check temporary lock (15 minutes after 5 failures)
    if (loginState.locked_until) {
      const lockedUntilTime = new Date(loginState.locked_until).getTime();
      const now = Date.now();

      if (now < lockedUntilTime) {
        const remainingMinutes = Math.max(1, Math.ceil((lockedUntilTime - now) / 60000));
        (await this.logAudit(normalizedEmail, ipAddress, 'LOCKED', `Tài khoản đang bị khóa tạm thời. Còn ${remainingMinutes} phút.`));
        return {
          success: false,
          statusCode: 423,
          message: 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.',
          code: 'ACCOUNT_TEMPORARILY_LOCKED',
          remainingMinutes,
          remainingAttempts: 0
        };
      } else {
        // Lock period has expired, reset counter and lock
        if (user) (await this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(user.id));
        loginState.failed_attempts = 0;
        loginState.locked_until = null;
      }
    }

    // Verify once before revealing administrative state, including the dummy unknown-user path.
    const isPasswordValid = user ? verifyPassword(password, user.password_hash) : false;
    if (!user) verifyPassword(password, DUMMY_HASH);

    // 3. If credentials are valid, check administrative account status
    if (user && user.status === 'LOCKED' && isPasswordValid) {
      (await this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Tài khoản đã bị quản trị viên khóa.'));
      return {
        success: false,
        statusCode: 403,
        message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.',
        code: 'ACCOUNT_PERMANENTLY_LOCKED'
      };
    }

    if (user && user.status === 'INACTIVE' && isPasswordValid) {
      (await this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Tài khoản chưa được kích hoạt.'));
      return {
        success: false,
        statusCode: 403,
        message: 'Tài khoản chưa được kích hoạt hoặc đã ngừng hoạt động.',
        code: 'ACCOUNT_INACTIVE'
      };
    }

    // 5. Handle authentication failure (AC-02: generic error message, no account leaking)
    if (!user || !isPasswordValid) {
      const remainingAttempts = Math.max(0, config.MAX_FAILED_ATTEMPTS - (loginState.failed_attempts || 0) - 1);
      if (user) {
        const newFailedAttempts = (user.failed_attempts || 0) + 1;

        if (newFailedAttempts >= config.MAX_FAILED_ATTEMPTS) {
          // AC-03: Temporary lock for 15 minutes after 5 consecutive failures
          const lockTime = new Date(Date.now() + config.LOCK_TIME_MINUTES * 60 * 1000).toISOString();
          (await this.db.prepare(`
            UPDATE users
            SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(newFailedAttempts, lockTime, user.id));

          (await this.logAudit(normalizedEmail, ipAddress, 'LOCKED', 'Khóa tạm thời 15 phút do nhập sai 5 lần liên tiếp.'));
          return {
            success: false,
            statusCode: 423,
            message: 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.',
            code: 'ACCOUNT_TEMPORARILY_LOCKED',
            remainingMinutes: config.LOCK_TIME_MINUTES,
            remainingAttempts: 0
          };
        } else {
          (await this.db.prepare(`
            UPDATE users
            SET failed_attempts = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(newFailedAttempts, user.id));

          (await this.logAudit(normalizedEmail, ipAddress, 'FAILURE', `Sai mật khẩu lần ${newFailedAttempts}/5.`));
        }
      } else {
        const limited = remainingAttempts === 0;
        (await this.logAudit(normalizedEmail, ipAddress, limited ? 'LOCKED' : 'FAILURE', limited ? 'LOGIN_ATTEMPTS_LIMIT' : 'LOGIN_INVALID_CREDENTIALS'));
        if (limited) return {
          success: false, statusCode: 423, code: 'ACCOUNT_TEMPORARILY_LOCKED',
          message: 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.',
          remainingMinutes: config.LOCK_TIME_MINUTES, remainingAttempts: 0
        };
      }

      // Generic error response per AC-02
      return {
        success: false,
        statusCode: 401,
        message: 'Email hoặc mật khẩu không chính xác.',
        code: 'INVALID_CREDENTIALS',
        remainingAttempts
      };
    }

    // 6. Handle successful login
    // Reset failed attempts & locks
    (await this.db.prepare(`
      UPDATE users
      SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(user.id));

    // Fetch user roles
    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.code ASC
    `);
    const userRoles = (await rolesStmt.all(user.id));
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
    const permissions = (await permsStmt.all(user.id)).map(p => p.code);

    // Create session token with configurable TTL (S1-02)
    const token = 'ats_sess_' + crypto.randomBytes(32).toString('hex');
    const sessionId = 'sess-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_MINUTES * 60 * 1000).toISOString();

    (await this.db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at, last_activity_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(sessionId, user.id, token, expiresAt));

    (await this.logAudit(normalizedEmail, ipAddress, 'SUCCESS', 'Đăng nhập thành công.'));

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
          defaultHome,
          mustChangePassword: Boolean(user.must_change_password)
        },
        token,
        expiresAt
      }
    };

    });
  }

  /**
   * Validate session token, perform auto-renewal if active (AC-01 & AC-03)
   * @param {string} token
   * @param {boolean} renew Whether to automatically extend expiry time
   * @returns {object} Validation result
   */
  async getUnknownLoginState(email) {
    const records = (await this.db.prepare(`SELECT rowid, reason, attempted_at FROM login_audit_logs
      WHERE email = ? AND reason IN ('LOGIN_INVALID_CREDENTIALS', 'LOGIN_ATTEMPTS_LIMIT')
      ORDER BY rowid DESC LIMIT ?`).all(email, config.MAX_FAILED_ATTEMPTS));
    if (records[0]?.reason === 'LOGIN_ATTEMPTS_LIMIT') {
      const issued = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(records[0].attempted_at) ? records[0].attempted_at : records[0].attempted_at.replace(' ', 'T') + 'Z').getTime();
      const until = issued + config.LOCK_TIME_MINUTES * 60000;
      return until > Date.now() ? { failed_attempts: config.MAX_FAILED_ATTEMPTS, locked_until: new Date(until).toISOString() } : { failed_attempts: 0 };
    }
    return { failed_attempts: records.findIndex(record => record.reason === 'LOGIN_ATTEMPTS_LIMIT') < 0
      ? records.length : records.findIndex(record => record.reason === 'LOGIN_ATTEMPTS_LIMIT') };
  }

  async validateSession(token, renew = true, allowPasswordChange = false) {
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
             u.id, u.email, u.full_name, u.job_title, u.department_name, u.status, u.locked_until, u.must_change_password
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ?
    `);
    const session = (await sessionStmt.get(token));

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
      (await this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
      return {
        valid: false,
        statusCode: 401,
        message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        code: 'SESSION_EXPIRED'
      };
    }

    // Check account status
    if (session.status === 'LOCKED' || (session.locked_until && new Date(session.locked_until).getTime() > now)) {
      (await this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
      return {
        valid: false,
        statusCode: 403,
        message: 'Tài khoản của bạn đã bị khóa. Phiên làm việc đã bị thu hồi.',
        code: 'ACCOUNT_LOCKED'
      };
    }

    if (session.status === 'INACTIVE') {
      (await this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
      return {
        valid: false,
        statusCode: 403,
        message: 'Tài khoản chưa được kích hoạt hoặc đã ngừng hoạt động.',
        code: 'ACCOUNT_INACTIVE'
      };
    }

    if (session.must_change_password && !allowPasswordChange) return {
      valid: false, statusCode: 403, code: 'MUST_CHANGE_PASSWORD',
      message: 'Bạn cần đổi mật khẩu tạm thời trước khi sử dụng hệ thống.'
    };

    // AC-01: Auto-renewal of session when active
    let currentExpiresAt = session.expires_at;
    if (renew) {
      currentExpiresAt = new Date(now + config.SESSION_TTL_MINUTES * 60 * 1000).toISOString();
      (await this.db.prepare(`
        UPDATE sessions
        SET expires_at = ?, last_activity_at = datetime('now')
        WHERE token = ?
      `).run(currentExpiresAt, token));
    }

    // Fetch user roles
    const rolesStmt = this.db.prepare(`
      SELECT r.code, r.name, r.default_path
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.code ASC
    `);
    const userRoles = (await rolesStmt.all(session.user_id));
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
    const permissions = (await permsStmt.all(session.user_id)).map(p => p.code);

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
        defaultHome,
        mustChangePassword: Boolean(session.must_change_password)
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
  async logout(token, ipAddress = '127.0.0.1') {
    if (!token || typeof token !== 'string') {
      return {
        success: true,
        statusCode: 200,
        message: 'Đăng xuất thành công.'
      };
    }

    const session = (await this.db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token));
    if (session) {
      const user = (await this.db.prepare('SELECT email FROM users WHERE id = ?').get(session.user_id));
      (await this.logAudit(user ? user.email : 'unknown', ipAddress, 'LOGOUT', 'Đăng xuất chủ động. Thu hồi phiên máy chủ.'));
      // AC-02: Revoke immediately on server
      (await this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
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
   * Generate 6-digit random numeric OTP (cryptographically secure)
   */
  generateOtp() {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Request Password Reset Link & 6-digit OTP (S1-03 AC-01 & AC-03)
   * Dispatches email to the registered account address using the configured mode.
   * @param {string} email
   * @param {string} ipAddress
   * @returns {object} Response
   */
  async requestPasswordReset(email, ipAddress = '127.0.0.1') {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return {
        success: false,
        statusCode: 400,
        message: 'Vui lòng cung cấp email hợp lệ.',
        code: 'INVALID_EMAIL'
      };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = (await this.db.prepare('SELECT id, email, full_name, status FROM users WHERE email = ? COLLATE NOCASE').get(normalizedEmail));

    let resetToken = null;
    let resetExpiresAt = null;

    // Only create token/OTP and dispatch email if user exists and is ACTIVE
    if (user && user.status === 'ACTIVE') {
      const otpCode = this.generateOtp();
      resetToken = 'ats_reset_' + crypto.randomBytes(32).toString('hex');
      const tokenId = 'rst-' + crypto.randomUUID();
      const otpId = 'otp-' + crypto.randomUUID();
      resetExpiresAt = new Date(Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();
      const otpExpiresAt = new Date(Date.now() + config.PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000).toISOString();

      // Invalidate previous unused reset tokens & OTPs for this user
      (await this.db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id));
      try {
        (await this.db.prepare('DELETE FROM otps WHERE email = ? COLLATE NOCASE AND used_at IS NULL').run(normalizedEmail));
      } catch (err) {
        // Table created if not exists
      }

      // Save token in DB (AC-01: valid for 30 minutes)
      (await this.db.prepare(`
        INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(tokenId, user.id, resetToken, resetExpiresAt));

      // Save PASSWORD_RESET OTP using its own TTL, separate from reset tokens.
      try {
        (await this.db.prepare(`
          INSERT INTO otps (id, email, otp_code, purpose, expires_at, created_at)
          VALUES (?, ?, ?, 'PASSWORD_RESET', ?, datetime('now'))
        `).run(otpId, normalizedEmail, otpCode, otpExpiresAt));
      } catch (err) {
        console.error('[AuthService] Could not insert password reset OTP.');
      }

      (await this.logAudit(normalizedEmail, ipAddress, 'SUCCESS', 'Yêu cầu đặt lại mật khẩu. Đã tạo OTP 6 số và token 30 phút.'));

      // Dispatch real transactional emails to the EXACT user email
      if (this.emailService) {
        this.emailService.sendOtpEmail(user.email, otpCode, user.full_name).catch(() => {
          console.error('[AuthService] Error dispatching OTP email.');
        });
        this.emailService.sendPasswordResetEmail(user.email, resetToken, resetExpiresAt).catch(() => {
          console.error('[AuthService] Error dispatching reset email.');
        });
      }
    } else {
      // User not found or inactive: DO NOT send email per prompt requirement
      (await this.logAudit(normalizedEmail, ipAddress, 'FAILURE', 'Yêu cầu đặt lại mật khẩu cho email không tồn tại hoặc tài khoản bị khóa.'));
    }

    // AC-03: Return identical response message regardless of whether email exists or not
    const response = {
      success: true,
      statusCode: 200,
      message: 'Nếu email tồn tại trong hệ thống, mã xác thực OTP và hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn.',
      code: 'RESET_LINK_SENT'
    };

    return response;
  }

  /**
   * Resend 6-digit OTP to user email
   */
  async resendOtp(email, ipAddress = '127.0.0.1') {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return {
        success: false,
        statusCode: 400,
        message: 'Vui lòng cung cấp email hợp lệ.',
        code: 'INVALID_EMAIL'
      };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = (await this.db.prepare('SELECT id, email, full_name, status FROM users WHERE email = ? COLLATE NOCASE').get(normalizedEmail));

    if (user && user.status === 'ACTIVE') {
      const otpCode = this.generateOtp();
      const otpId = 'otp-' + crypto.randomUUID();
      const otpExpiresAt = new Date(Date.now() + config.PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000).toISOString();

      // Invalidate previous OTPs
      try {
        (await this.db.prepare('DELETE FROM otps WHERE email = ? COLLATE NOCASE AND used_at IS NULL').run(normalizedEmail));
        (await this.db.prepare(`
          INSERT INTO otps (id, email, otp_code, purpose, expires_at, created_at)
          VALUES (?, ?, ?, 'PASSWORD_RESET', ?, datetime('now'))
        `).run(otpId, normalizedEmail, otpCode, otpExpiresAt));
      } catch (err) {
        console.error('[AuthService] Could not resend password reset OTP.');
      }

      (await this.logAudit(normalizedEmail, ipAddress, 'SUCCESS', 'Gửi lại mã OTP xác thực khôi phục mật khẩu.'));

      if (this.emailService) {
        this.emailService.sendOtpEmail(user.email, otpCode, user.full_name).catch(() => {
          console.error('[AuthService] Error resending OTP email.');
        });
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Mã xác thực OTP mới đã được gửi đến hòm thư của bạn nếu email hợp lệ.',
      code: 'OTP_RESENT'
    };
  }

  /**
   * Verify 6-digit numeric OTP
   */
  async verifyOtp(email, otp) {
    return this.atomic(String(email).trim().toLowerCase(), async () => {
    if (!email || !otp) {
      return {
        valid: false,
        statusCode: 400,
        message: 'Email và mã OTP không được để trống.',
        code: 'MISSING_FIELDS'
      };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    let otpRow = null;
    try {
      otpRow = (await this.db.prepare(`
        SELECT * FROM otps
        WHERE email = ? COLLATE NOCASE AND otp_code = ? AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(normalizedEmail, cleanOtp));
    } catch (err) {
      console.error('[Verify OTP query error]', err.message);
    }

    if (!otpRow) {
      return {
        valid: false,
        statusCode: 400,
        message: 'Mã OTP không chính xác hoặc đã được sử dụng. Vui lòng kiểm tra lại.',
        code: 'INVALID_OTP'
      };
    }

    if (new Date(otpRow.expires_at).getTime() <= Date.now()) {
      return {
        valid: false,
        statusCode: 400,
        message: `Mã OTP đã hết hạn (chỉ có hiệu lực trong vòng ${config.PASSWORD_RESET_OTP_TTL_MINUTES} phút). Vui lòng yêu cầu mã mới.`,
        code: 'OTP_EXPIRED'
      };
    }

    // Mark OTP as verified
    try {
      (await this.db.prepare("UPDATE otps SET verified_at = datetime('now') WHERE id = ?").run(otpRow.id));
    } catch (e) {}

    // Find or create resetToken to bind to user
    const user = (await this.db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(normalizedEmail));
    let resetToken = 'ats_reset_' + crypto.randomBytes(32).toString('hex');
    if (user) {
      const tokenId = 'rst-' + crypto.randomUUID();
      const resetExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      (await this.db.prepare(`
        INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(tokenId, user.id, resetToken, resetExpiresAt));
    }

    return {
      valid: true,
      statusCode: 200,
      message: 'Xác minh mã OTP thành công. Vui lòng thiết lập mật khẩu mới.',
      code: 'OTP_VERIFIED',
      resetToken
    };

    });
  }

  /**
   * Verify Reset Token Validity (AC-01 & AC-02)
   * @param {string} token
   * @returns {object} Result
   */
  async verifyResetToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, statusCode: 400, message: 'Mã xác thực không hợp lệ.', code: 'INVALID_TOKEN' };
    }

    const row = (await this.db.prepare(`
      SELECT prt.id, prt.user_id, prt.token, prt.expires_at, prt.used_at, u.email, u.status
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token = ?
    `).get(token));

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
   * Reset Password with Token or OTP (S1-03 AC-01 & AC-02)
   * @param {string} token
   * @param {string} newPassword
   * @param {string} ipAddress
   * @param {string} email
   * @param {string} otp
   * @returns {object} Result
   */
  async resetPassword(token, newPassword, ipAddress = '127.0.0.1', email = '', otp = '') {
    return this.atomic(token || email, async () => {
    // If called with OTP and email
    if (otp && email && !token) {
      const otpVerify = (await this.verifyOtp(email, otp));
      if (!otpVerify.valid) {
        return {
          success: false,
          statusCode: otpVerify.statusCode,
          message: otpVerify.message,
          code: otpVerify.code
        };
      }
      token = otpVerify.resetToken;
    }

    const verifyResult = (await this.verifyResetToken(token));
    if (!verifyResult.valid) {
      return {
        success: false,
        statusCode: verifyResult.statusCode,
        message: verifyResult.message,
        code: verifyResult.code
      };
    }

    const userId = verifyResult.userId;
    const targetEmail = verifyResult.email;

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
        message: 'Mật khẩu mới phải bao gồm cả chữ cái và số.',
        code: 'WEAK_PASSWORD'
      };
    }

    const existing = (await this.db.prepare('SELECT password_hash, must_change_password FROM users WHERE id=?').get(userId));
    if (existing?.must_change_password && verifyPassword(newPassword, existing.password_hash)) return {
      success: false, statusCode: 400, code: 'SAME_PASSWORD',
      message: 'Mật khẩu mới không được trùng với mật khẩu tạm thời.'
    };
    const newHash = hashPassword(newPassword);

    // Update password in DB & reset failed attempts
    (await this.db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(newHash, userId));

    // Invalidate the reset token
    (await this.db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token = ?").run(token));

    // Invalidate all OTPs for this user's email
    try {
      (await this.db.prepare("UPDATE otps SET used_at = datetime('now') WHERE email = ? COLLATE NOCASE AND used_at IS NULL").run(targetEmail));
    } catch (e) {}

    // Revoke all existing sessions (S1-04 AC-03 & S1-02 AC-02)
    (await this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId));

    (await this.logAudit(targetEmail, ipAddress, 'SUCCESS', 'Đặt lại mật khẩu thành công qua xác thực an toàn.'));

    // Dispatch confirmation email
    if (this.emailService && targetEmail) {
      this.db.afterCommit(() => this.emailService.sendPasswordChangedEmail(targetEmail).catch(() => {
        console.error('[AuthService] Error dispatching password changed email.');
      }));
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.',
      code: 'PASSWORD_RESET_SUCCESS'
    };

    });
  }

  /**
   * Change Password while logged in (S1-04 AC-01, AC-02, AC-03)
   * @param {string} token Current authenticated session token
   * @param {string} currentPassword Required current password (AC-01)
   * @param {string} newPassword New password (min 8 chars, letter + number) (AC-02)
   * @param {string} ipAddress Client IP
   * @returns {object} Result
   */
  async changePassword(token, currentPassword, newPassword, ipAddress = '127.0.0.1') {
    return this.atomic(token, async () => {
    // 1. Verify active session
    const sessionResult = (await this.validateSession(token, false, true));
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

    const user = (await this.db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?' + (this.db.provider === 'postgres' ? ' FOR UPDATE' : '')).get(userId));
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
      (await this.logAudit(user.email, ipAddress, 'FAILURE', 'Đổi mật khẩu thất bại: Sai mật khẩu hiện tại.'));
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

    (await this.db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(newHash, userId));

    // 5. AC-03: Đổi xong thu hồi các phiên đăng nhập khác (giữ lại phiên hiện tại)
    const revokeResult = (await this.db.prepare(`
      DELETE FROM sessions
      WHERE user_id = ? AND token != ?
    `).run(userId, token));

    (await this.logAudit(user.email, ipAddress, 'SUCCESS', `Đổi mật khẩu thành công. Đã thu hồi ${revokeResult.changes} phiên khác.`));

    return {
      success: true,
      statusCode: 200,
      message: 'Đổi mật khẩu thành công. Các phiên đăng nhập khác đã được thu hồi.',
      code: 'PASSWORD_CHANGED_SUCCESS',
      revokedSessionsCount: revokeResult.changes
    };

    });
  }
}

module.exports = AuthService;
