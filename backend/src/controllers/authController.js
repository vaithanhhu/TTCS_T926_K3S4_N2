const AuthService = require('../services/authService');
const AvatarService = require('../services/avatarService');

class AuthController {
  constructor(authService, avatarService) {
    this.authService = authService || new AuthService();
    this.avatarService = avatarService || new AvatarService();
  }

  /**
   * Handle POST /api/v1/auth/login
   */
  async handleLogin(req, res, body) {
    try {
      const { email, password } = body || {};
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

      const result = this.authService.login(email, password, ipAddress);

      res.writeHead(result.statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });

      const responsePayload = {
        success: result.success,
        message: result.message,
        code: result.code || (result.success ? 'SUCCESS' : 'ERROR')
      };

      if (result.data) {
        responsePayload.data = {
          ...result.data,
          user: { ...result.data.user, ...this.avatarService.getAvatarUrls(result.data.user.id) }
        };
      }
      if (result.remainingMinutes) {
        responsePayload.remainingMinutes = result.remainingMinutes;
      }

      res.end(JSON.stringify(responsePayload));
    } catch (err) {
      console.error('[Login Controller Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_SERVER_ERROR' }));
    }
  }

  /**
   * Handle POST /api/v1/auth/logout (AC-02)
   */
  async handleLogout(req, res, body) {
    try {
      const authHeader = req.headers['authorization'] || '';
      let token = '';
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (body && body.token) {
        token = body.token.trim();
      }

      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const result = this.authService.logout(token, ipAddress);

      res.writeHead(result.statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: result.success,
        message: result.message,
        code: 'LOGGED_OUT'
      }));
    } catch (err) {
      console.error('[Logout Controller Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ khi đăng xuất.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle GET /api/v1/auth/me (AC-01 & AC-03 session validation & auto-renewal)
   */
  async handleGetMe(req, res) {
    try {
      const authHeader = req.headers['authorization'] || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          statusCode: 401,
          message: 'Yêu cầu thiếu token xác thực trong header.',
          code: 'UNAUTHORIZED',
          recovery: {
            action: 'LOGIN',
            suggestedPath: '/login',
            label: 'Đăng nhập lại'
          }
        }));
        return;
      }

      const token = authHeader.substring(7).trim();
      const result = this.authService.validateSession(token, true);

      res.writeHead(result.statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
      });

      if (!result.valid) {
        res.end(JSON.stringify({
          success: false,
          statusCode: result.statusCode || 401,
          message: result.message,
          code: result.code,
          recovery: {
            action: 'LOGIN',
            suggestedPath: '/login',
            label: 'Đăng nhập lại'
          }
        }));
        return;
      }

      res.end(JSON.stringify({
        success: true,
        message: 'Phiên làm việc hợp lệ.',
        code: 'SESSION_VALID',
        data: {
          user: { ...result.user, ...this.avatarService.getAvatarUrls(result.user.id) },
          expiresAt: result.expiresAt
        }
      }));
    } catch (err) {
      console.error('[GetMe Controller Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle POST /api/v1/auth/forgot-password (S1-03 AC-01 & AC-03)
   */
  async handleForgotPassword(req, res, body) {
    try {
      const { email } = body || {};
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const result = this.authService.requestPasswordReset(email, ipAddress);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      const payload = {
        success: result.success,
        message: result.message,
        code: result.code
      };
      res.end(JSON.stringify(payload));
    } catch (err) {
      console.error('[Forgot Password Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle GET /api/v1/auth/verify-reset-token
   */
  async handleVerifyResetToken(req, res, token) {
    try {
      const result = this.authService.verifyResetToken(token);
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: result.valid,
        message: result.message || 'Mã xác thực hợp lệ.',
        code: result.code,
        email: result.email
      }));
    } catch (err) {
      console.error('[Verify Reset Token Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle POST /api/v1/auth/verify-otp
   */
  async handleVerifyOtp(req, res, body) {
    try {
      const { email, otp } = body || {};
      const result = this.authService.verifyOtp(email, otp);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: result.valid,
        message: result.message,
        code: result.code,
        resetToken: result.resetToken
      }));
    } catch (err) {
      console.error('[Verify OTP Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle POST /api/v1/auth/resend-otp
   */
  async handleResendOtp(req, res, body) {
    try {
      const { email } = body || {};
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const result = await this.authService.resendOtp(email, ipAddress);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: result.success,
        message: result.message,
        code: result.code
      }));
    } catch (err) {
      console.error('[Resend OTP Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle POST /api/v1/auth/reset-password (S1-03 AC-01 & AC-02)
   */
  async handleResetPassword(req, res, body) {
    try {
      const { token, newPassword, email, otp } = body || {};
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const result = this.authService.resetPassword(token, newPassword, ipAddress, email, otp);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: result.success,
        message: result.message,
        code: result.code
      }));
    } catch (err) {
      console.error('[Reset Password Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * Handle POST /api/v1/auth/change-password (S1-04 AC-01, AC-02, AC-03)
   */
  async handleChangePassword(req, res, body) {
    try {
      const authHeader = req.headers['authorization'] || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          statusCode: 401,
          message: 'Yêu cầu thiếu token xác thực.',
          code: 'UNAUTHORIZED',
          recovery: {
            action: 'LOGIN',
            suggestedPath: '/login',
            label: 'Đăng nhập lại'
          }
        }));
        return;
      }

      const token = authHeader.substring(7).trim();
      const { currentPassword, newPassword } = body || {};
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

      const result = this.authService.changePassword(token, currentPassword, newPassword, ipAddress);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: result.success,
        message: result.message,
        code: result.code,
        revokedSessionsCount: result.revokedSessionsCount
      }));
    } catch (err) {
      console.error('[Change Password Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }
}

module.exports = AuthController;

