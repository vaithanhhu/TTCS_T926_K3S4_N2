const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const config = require('../config/config');
const { getDatabase } = require('../db/database');

class EmailService {
  constructor(db) {
    this.db = db || getDatabase();
    this.transporter = null;
    this.sentEmails = []; // In-memory cache for inspection & test assertions
    this.initTransporter();
  }

  initTransporter() {
    if (config.SMTP_HOST && config.SMTP_USER) {
      try {
        this.transporter = nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          auth: {
            user: config.SMTP_USER,
            pass: config.SMTP_PASSWORD
          },
          tls: {
            rejectUnauthorized: false
          }
        });
        console.log(`[EmailService] Real SMTP Transporter initialized: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
      } catch (err) {
        console.error('[EmailService] Failed to create SMTP transporter:', err.message);
        this.transporter = null;
      }
    } else {
      console.log('[EmailService] SMTP credentials not set in .env. Running in corporate dispatch mode with audit logging.');
    }
  }

  /**
   * Log email event into SQLite database table email_logs
   */
  logEmail(recipient, subject, templateName, status, errorMessage = null) {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id TEXT PRIMARY KEY,
          recipient TEXT NOT NULL,
          subject TEXT NOT NULL,
          template_name TEXT NOT NULL,
          status TEXT NOT NULL,
          error_message TEXT,
          sent_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const id = 'eml-' + crypto.randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO email_logs (id, recipient, subject, template_name, status, error_message, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      stmt.run(id, recipient, subject, templateName, status, errorMessage);
    } catch (err) {
      console.error('[EmailService] Failed to log email into DB:', err.message);
    }
  }

  /**
   * Send transactional email (real SMTP or mock fallback)
   */
  async sendMail({ to, subject, html, text, templateName = 'GENERAL' }) {
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
      content: html
    };
    this.sentEmails.push(record);

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        console.log(`[EmailService] Real SMTP email sent to ${to}: ${info.messageId}`);
        this.logEmail(to, subject, templateName, 'DELIVERED');
        return { success: true, messageId: info.messageId, delivered: true };
      } catch (error) {
        console.error(`[EmailService] Failed to deliver real SMTP email to ${to}:`, error.message);
        this.logEmail(to, subject, templateName, 'FAILED', error.message);
        return { success: false, error: error.message, delivered: false };
      }
    } else {
      // Dispatch simulation & DB log (used when SMTP credentials are not yet added to .env)
      console.log(`[EmailService:Simulated] Email dispatched to ${to} | Subject: "${subject}"`);
      this.logEmail(to, subject, templateName, 'SENT_LOCAL');
      return { success: true, delivered: false, simulated: true };
    }
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
          <p class="body-text">Xin chào <strong>${recipientEmail}</strong>,</p>
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

    return this.sendMail({
      to: recipientEmail,
      subject,
      html,
      text,
      templateName: 'PASSWORD_RESET'
    });
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
          <p class="body-text">Xin chào <strong>${fullName}</strong>,</p>
          <p class="body-text">Tài khoản nhân sự của bạn đã được khởi tạo thành công trên Hệ thống Tuyển dụng Nội bộ với vai trò ban đầu: <strong>${roleName}</strong>.</p>
          <div class="cred-box">
            <div class="cred-row">
              <div class="cred-label">Email đăng nhập:</div>
              <div class="cred-val">${recipientEmail}</div>
            </div>
            <div class="cred-row" style="margin-bottom: 0;">
              <div class="cred-label">Mật khẩu tạm thời:</div>
              <div class="cred-val" style="color: #4ade80;">${tempPassword}</div>
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

    return this.sendMail({
      to: recipientEmail,
      subject,
      html,
      text,
      templateName: 'ACCOUNT_ACTIVATION'
    });
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
