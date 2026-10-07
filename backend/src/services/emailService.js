const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const config = require('../config/config');
const { getDatabase } = require('../db/database');

function cleanEmailText(value) {
  return String(value || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/ {2,}/g, ' ').trim();
}

function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

// Inline the small existing template styles: email clients often ignore head CSS.
// No web fonts or external assets; preserve links, tokens, OTP and plain-text alternative.
function prepareEmailHtml(html) {
  html = cleanEmailText(html).replace(/<html>/g, '<html lang="vi">');
  html = html.replace(/font-family:\s*[^;}]+/g, 'font-family: Arial, Helvetica, sans-serif')
    .replace(/background-color: #0f172a/g, 'background-color: #f8fafc')
    .replace(/background-color: #1e293b/g, 'background-color: #ffffff')
    .replace(/color: #f8fafc/g, 'color: #0f172a').replace(/color: #cbd5e1/g, 'color: #334155')
    .replace(/box-shadow:[^;}]+;?/g, '').replace(/2px dashed/g, '1px solid');
  const styles = new Map();
  for (const match of html.matchAll(/(body|\.[\w-]+)\s*\{([^}]+)\}/g)) styles.set(match[1], match[2].trim());
  return html.replace(/<([a-z][a-z0-9]*)([^>]*)>/gi, (tag, name, attributes) => {
    const classes = attributes.match(/\bclass="([^"]+)"/)?.[1].split(/\s+/) || [];
    const css = [styles.get(name.toLowerCase()), ...classes.map(c => styles.get('.' + c))].filter(Boolean).join('; ');
    if (!css) return tag;
    const inline = attributes.match(/\bstyle="([^"]*)"/)?.[1] || '';
    attributes = attributes.replace(/\sstyle="[^"]*"/, '');
    return `<${name}${attributes} style="${css}; ${inline}">`;
  });
}

class EmailService {
  constructor(db) {
    this.db = db || getDatabase();
    this.transporter = null;
    this.mode = config.EMAIL_MODE;
    this.authMode = null;
    this.configurationError = null;
    this.sentEmails = []; // Delivery metadata; message bodies only in explicit simulation
    this.initTransporter();
  }

  initTransporter() {
    if (this.mode === 'simulated') {
      console.log('[EmailService] Explicit simulated email mode (no SMTP delivery).');
      return;
    }
    const hasOAuthConfig = Boolean(config.GOOGLE_OAUTH_CLIENT_ID ||
      config.GOOGLE_OAUTH_CLIENT_SECRET || config.GOOGLE_OAUTH_REFRESH_TOKEN);
    if (config.EMAIL_AUTH_MODE && !['oauth2', 'password'].includes(config.EMAIL_AUTH_MODE)) {
      this.configurationError = 'SMTP_AUTH_MODE_INVALID';
      console.error('[EmailService] SMTP_AUTH_MODE_INVALID');
      return;
    }
    // Any OAuth setting selects OAuth2, so incomplete credentials cannot fall back
    // to a password left in the local environment. Explicit selection also covers
    // the case where all OAuth credentials are missing.
    this.authMode = config.EMAIL_AUTH_MODE === 'oauth2' || hasOAuthConfig ? 'oauth2' : 'password';
    const authConfigured = this.authMode === 'oauth2'
      ? [config.SMTP_USER, config.GOOGLE_OAUTH_CLIENT_ID,
        config.GOOGLE_OAUTH_CLIENT_SECRET, config.GOOGLE_OAUTH_REFRESH_TOKEN]
        .every(value => typeof value === 'string' && value.trim().length > 0)
      : Boolean(config.SMTP_USER && config.SMTP_PASSWORD);
    if (config.SMTP_HOST && authConfigured) {
      const auth = this.authMode === 'oauth2' ? {
        type: 'OAuth2',
        user: config.SMTP_USER,
        clientId: config.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken: config.GOOGLE_OAUTH_REFRESH_TOKEN
      } : { user: config.SMTP_USER, pass: config.SMTP_PASSWORD };
      try {
        this.transporter = nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          auth,
          logger: false,
          debug: false
        });
        console.log(`[EmailService] Real SMTP Transporter initialized: ${config.SMTP_HOST}:${config.SMTP_PORT} (${this.authMode})`);
      } catch (err) {
        this.configurationError = 'SMTP_INITIALIZATION_FAILED';
        console.error('[EmailService] SMTP_INITIALIZATION_FAILED');
        this.transporter = null;
      }
    } else {
      this.configurationError = this.authMode === 'oauth2' && !authConfigured
        ? 'SMTP_OAUTH_NOT_CONFIGURED' : 'SMTP_NOT_CONFIGURED';
      console.error('[EmailService]', this.configurationError);
    }
  }

  /**
   * Log email event into SQLite database table email_logs
   */
  async logEmail(recipient, subject, templateName, status, errorMessage = null) {
    try {
      const id = 'eml-' + crypto.randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO email_logs (id, recipient, subject, template_name, status, error_message, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      (await stmt.run(id, recipient, subject, templateName, status, errorMessage));
    } catch (err) {
      console.error('[EmailService] EMAIL_AUDIT_FAILED');
    }
  }

  /**
   * Send using the configured mode. "delivered" means accepted by SMTP,
   * not proof of arrival in an Internet inbox. Cache entries track outcomes.
   */
  async sendMail({ to, subject, html, text, templateName = 'GENERAL' }) {
    subject = cleanEmailText(subject);
    html = prepareEmailHtml(html);
    text = cleanEmailText(text);
    const mailOptions = {
      from: config.MAIL_FROM,
      to,
      subject,
      text,
      html
    };

    const record = {
      to,
      subject,
      templateName,
      sentAt: new Date().toISOString(),
      mode: this.mode,
      authMode: this.authMode,
      status: 'PENDING',
      delivered: false,
      simulated: this.mode === 'simulated'
    };
    if (this.mode === 'simulated') record.content = html;
    this.sentEmails.push(record);

    if (this.mode === 'simulated') {
      record.status = 'SENT_LOCAL';
      (await this.logEmail(to, subject, templateName, record.status));
      return { success: true, delivered: false, simulated: true, mode: this.mode };
    }

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        const accepted = Array.isArray(info.accepted) && info.accepted.some(address =>
          String(address).toLowerCase() === String(to).toLowerCase());
        if (!accepted) throw new Error('SMTP_RECIPIENT_REJECTED');
        record.status = 'DELIVERED';
        record.delivered = true;
        (await this.logEmail(to, subject, templateName, 'DELIVERED'));
        return { success: true, messageId: info.messageId, delivered: true, simulated: false, mode: this.mode };
      } catch (error) {
        const code = error.message === 'SMTP_RECIPIENT_REJECTED' ? 'SMTP_RECIPIENT_REJECTED' : 'SMTP_SEND_FAILED';
        record.status = 'FAILED';
        record.error = code;
        console.error('[EmailService]', code);
        (await this.logEmail(to, subject, templateName, 'FAILED', code));
        return { success: false, error: code, delivered: false, simulated: false, mode: this.mode };
      }
    }

    const code = this.configurationError || 'SMTP_NOT_CONFIGURED';
    record.status = 'FAILED';
    record.error = code;
    (await this.logEmail(to, subject, templateName, 'FAILED', code));
    return { success: false, error: code, delivered: false, simulated: false, mode: this.mode };
  }

  /**
   * Send Password Reset Email (S1-03)
   */
  async sendPasswordResetEmail(recipientEmail, resetToken, expiresAt) {
    const resetUrl = `${config.APP_URL}/?reset_token=${resetToken}`;
    const subject = '🔐 [ATS] Hướng dẫn đặt lại mật khẩu tài khoản tuyển dụng';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; }
          .card { max-width: 560px; margin: 0 auto; background-color: #1e293b; border-radius: 8px; border: 1px solid #334155; padding: 32px; }
          .header { border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 24px; }
          .title { font-size: 18px; font-weight: 700; color: #38bdf8; margin: 0; }
          .body-text { font-size: 14px; line-height: 1.6; color: #cbd5e1; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 20px 0; }
          .footer { font-size: 12px; color: #64748b; margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px; }
          .token-box { background: #0f172a; border: 1px solid #334155; padding: 8px 12px; border-radius: 4px; font-family: monospace; color: #38bdf8; font-size: 13px; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h2 class="title">HỆ THỐNG TUYỂN DỤNG NỘI BỘ (ATS)</h2>
          </div>
          <p class="body-text">Xin chào <strong>${escapeEmailHtml(recipientEmail)}</strong>,</p>
          <p class="body-text">Hệ thống nhận được yêu cầu đặt lại mật khẩu cho tài khoản nhân sự của bạn. Liên kết dưới đây có hiệu lực trong <strong>30 phút</strong> và chỉ có thể sử dụng <strong>1 lần duy nhất</strong>:</p>
          <div style="text-align: center;">
            <a href="${resetUrl}" class="btn">👉 Đặt lại mật khẩu ngay</a>
          </div>
          <p class="body-text" style="font-size: 13px;">Nếu nút trên không mở được, bạn có thể truy cập qua liên kết sau:</p>
          <div class="token-box">${resetUrl}</div>
          <p class="body-text" style="margin-top: 16px; font-size: 12px; color: #94a3b8;">Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email. Mật khẩu hiện tại của bạn vẫn an toàn tuyệt đối.</p>
          <div class="footer">
            <p>© 2026 Internal Recruitment System · Hệ thống bảo mật doanh nghiệp</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Xin chào ${recipientEmail},\n\nHệ thống nhận được yêu cầu đặt lại mật khẩu của bạn. Vui lòng truy cập đường dẫn sau để đặt lại mật khẩu (hiệu lực trong 30 phút):\n${resetUrl}\n\nNếu bạn không yêu cầu, vui lòng bỏ qua email này.`;

    return (await this.sendMail({
      to: recipientEmail,
      subject,
      html,
      text,
      templateName: 'PASSWORD_RESET'
    }));
  }

  /**
   * Send Account Activation Email with Temporary Password (S1-08)
   */
  async sendAccountActivationEmail(recipientEmail, fullName, tempPassword, roleName) {
    const loginUrl = `${config.APP_URL}/`;
    const subject = '🎉 [ATS] Kích hoạt tài khoản nhân sự & Cấp mật khẩu tạm thời';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; }
          .card { max-width: 560px; margin: 0 auto; background-color: #1e293b; border-radius: 8px; border: 1px solid #334155; padding: 32px; }
          .header { border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 24px; }
          .title { font-size: 18px; font-weight: 700; color: #38bdf8; margin: 0; }
          .body-text { font-size: 14px; line-height: 1.6; color: #cbd5e1; }
          .cred-box { background: #0f172a; border: 1px solid #3b82f6; border-radius: 6px; padding: 16px; margin: 16px 0; }
          .cred-row { margin-bottom: 8px; font-size: 14px; }
          .cred-label { color: #94a3b8; font-size: 12px; }
          .cred-val { font-family: monospace; color: #60a5fa; font-size: 15px; font-weight: 700; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 16px 0; }
          .footer { font-size: 12px; color: #64748b; margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h2 class="title">CHÀO MỪNG ĐẾN VỚI HỆ THỐNG TUYỂN DỤNG ATS</h2>
          </div>
          <p class="body-text">Xin chào <strong>${escapeEmailHtml(fullName)}</strong>,</p>
          <p class="body-text">Tài khoản nhân sự của bạn đã được khởi tạo thành công trên Hệ thống Tuyển dụng Nội bộ với vai trò ban đầu: <strong>${escapeEmailHtml(roleName)}</strong>.</p>
          <div class="cred-box">
            <div class="cred-row">
              <div class="cred-label">Email đăng nhập:</div>
              <div class="cred-val">${escapeEmailHtml(recipientEmail)}</div>
            </div>
            <div class="cred-row" style="margin-bottom: 0;">
              <div class="cred-label">Mật khẩu tạm thời:</div>
              <div class="cred-val" style="color: #4ade80;">${escapeEmailHtml(tempPassword)}</div>
            </div>
          </div>
          <p class="body-text" style="color: #facc15; font-size: 13px;">⚠️ <strong>Bắt buộc đổi mật khẩu:</strong> Vì lý do an toàn thông tin, vui lòng đổi mật khẩu mới ngay trong phiên đăng nhập đầu tiên.</p>
          <div style="text-align: center;">
            <a href="${loginUrl}" class="btn">🚀 Đăng nhập hệ thống ngay</a>
          </div>
          <div class="footer">
            <p>© 2026 Internal Recruitment System · Hệ thống bảo mật doanh nghiệp</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Xin chào ${fullName},\n\nTài khoản của bạn đã được khởi tạo trên Hệ thống Tuyển dụng ATS với vai trò ${roleName}.\nEmail: ${recipientEmail}\nMật khẩu tạm: ${tempPassword}\n\nVui lòng đăng nhập tại ${loginUrl} và đổi mật khẩu mới ngay lần đầu đăng nhập.`;

    return (await this.sendMail({
      to: recipientEmail,
      subject,
      html,
      text,
      templateName: 'ACCOUNT_ACTIVATION'
    }));
  }

  /**
   * Send 6-digit OTP Verification Email for Password Reset
   */
  async sendOtpEmail(recipientEmail, otpCode, fullName = '') {
    const greeting = fullName ? `Xin chào <strong>${escapeEmailHtml(fullName)}</strong>,` : `Xin chào <strong>${escapeEmailHtml(recipientEmail)}</strong>,`;
    const subject = '🔐 [ATS] Mã xác thực OTP khôi phục mật khẩu';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; padding: 24px; margin: 0; }
          .card { max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); padding: 32px; }
          .header { border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 24px; }
          .title { font-size: 18px; font-weight: 800; color: #1e3a8a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
          .body-text { font-size: 14px; line-height: 1.6; color: #334155; }
          .otp-container { background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
          .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; color: #1d4ed8; letter-spacing: 8px; margin: 0; }
          .otp-hint { font-size: 12px; color: #64748b; margin-top: 8px; }
          .warning-box { background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #991b1b; margin-top: 20px; }
          .footer { font-size: 12px; color: #94a3b8; margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h2 class="title">Hệ Thống Tuyển Dụng Nội Bộ (ATS)</h2>
          </div>
          <p class="body-text">${greeting}</p>
          <p class="body-text">Hệ thống nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Dưới đây là <strong>mã xác thực OTP gồm 6 chữ số</strong> của bạn:</p>
          
          <div class="otp-container">
            <div class="otp-code">${otpCode}</div>
            <div class="otp-hint">Hiệu lực trong vòng <strong>${config.PASSWORD_RESET_OTP_TTL_MINUTES} phút</strong> · Chỉ sử dụng 1 lần</div>
          </div>

          <div class="warning-box">
            <strong>Cảnh báo an ninh:</strong> Tuyệt đối không chia sẻ mã OTP này cho bất kỳ ai, bao gồm cả quản trị viên hệ thống để bảo vệ tài khoản nội bộ.
          </div>

          <p class="body-text" style="font-size: 13px; color: #64748b; margin-top: 16px;">
            Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ ngay với bộ phận IT Lead để kiểm tra an toàn thông tin.
          </p>

          <div class="footer">
            <p>© 2026 Internal Recruitment Management System · Bảo mật Doanh nghiệp</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Xin chào,\n\nMã xác thực OTP của bạn là: ${otpCode}\nMã có hiệu lực trong vòng ${config.PASSWORD_RESET_OTP_TTL_MINUTES} phút. Tuyệt đối không chia sẻ mã này cho người khác.`;

    return (await this.sendMail({
      to: recipientEmail,
      subject,
      html,
      text,
      templateName: 'OTP_VERIFICATION'
    }));
  }

  /**
   * Send Password Changed Success Notification
   */
  async sendPasswordChangedEmail(recipientEmail, fullName = '') {
    const greeting = fullName ? `Xin chào <strong>${escapeEmailHtml(fullName)}</strong>,` : `Xin chào <strong>${escapeEmailHtml(recipientEmail)}</strong>,`;
    const subject = '🔒 [ATS] Thông báo: Mật khẩu tài khoản của bạn đã được thay đổi thành công';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; padding: 24px; }
          .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; }
          .title { font-size: 18px; font-weight: 800; color: #059669; }
          .body-text { font-size: 14px; line-height: 1.6; color: #334155; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 class="title">✅ Đổi Mật Khẩu Thành Công</h2>
          <p class="body-text">${greeting}</p>
          <p class="body-text">Mật khẩu tài khoản của bạn trên Hệ thống Tuyển dụng Nội bộ (ATS) vừa được thay đổi thành công vào lúc <strong>${new Date().toLocaleString('vi-VN')}</strong>.</p>
          <p class="body-text">Mọi phiên làm việc cũ trên các thiết bị khác đã được hệ thống tự động thu hồi để bảo vệ an toàn thông tin.</p>
          <p class="body-text" style="color: #dc2626; font-size: 13px;">Nếu bạn KHÔNG thực hiện thay đổi này, vui lòng liên hệ ngay với Quản trị viên hệ thống để phong tỏa tài khoản.</p>
        </div>
      </body>
      </html>
    `;

    return (await this.sendMail({
      to: recipientEmail,
      subject,
      html,
      text: 'Mật khẩu tài khoản của bạn đã được thay đổi thành công.',
      templateName: 'PASSWORD_CHANGED'
    }));
  }

  getLastSentEmail() {
    return this.sentEmails[this.sentEmails.length - 1] || null;
  }
}

// Singleton export
let emailServiceInstance = null;
function getEmailService(db) {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService(db);
  }
  return emailServiceInstance;
}

module.exports = {
  EmailService,
  getEmailService
};
