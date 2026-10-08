const fs = require('node:fs');
const path = require('node:path');

// Auto-load .env file if present
function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch (err) {
      console.warn('[Config] Could not parse .env file:', err.message);
    }
  }
}

loadEnv();

const isTestEnv = process.env.NODE_ENV === 'test' || (process.argv[1] && (process.argv[1].includes('tests') || process.argv[1].includes('test_s1_')));

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 5050,
  DB_PROVIDER: process.env.DB_PROVIDER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
  DATABASE_URL: process.env.DATABASE_URL || '',
  PG_SSL_MODE: process.env.PG_SSL_MODE || 'url',
  APPROVAL_CONFIGURATION_ENABLED: process.env.APPROVAL_CONFIGURATION_ENABLED === 'true',
  HEADCOUNT_BUDGET_ENABLED: process.env.HEADCOUNT_BUDGET_ENABLED === 'true',
  REQUISITION_OPERATIONS_ENABLED: process.env.REQUISITION_OPERATIONS_ENABLED === 'true',
  REQUISITION_APPROVAL_ENABLED: process.env.REQUISITION_APPROVAL_ENABLED === 'true',
  DB_PATH: isTestEnv
    ? path.join(__dirname, '..', '..', 'data', 'ats_test.db')
    : (process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', '..', 'data', 'ats.db')),
  APP_URL: process.env.APP_URL || 'http://localhost:5050',
  LOCK_TIME_MINUTES: parseInt(process.env.LOCK_TIME_MINUTES, 10) || 15,
  MAX_FAILED_ATTEMPTS: parseInt(process.env.MAX_FAILED_ATTEMPTS, 10) || 5,
  SESSION_TTL_MINUTES: parseInt(process.env.SESSION_TTL_MINUTES, 10) || 30,
  PASSWORD_RESET_TTL_MINUTES: parseInt(process.env.PASSWORD_RESET_TTL_MINUTES, 10) || 30,
  PASSWORD_RESET_OTP_TTL_MINUTES: 5,
  STATIC_DIR: path.join(__dirname, '..', '..', '..', 'frontend'),

  // Real SMTP Configuration (Supports both MAIL_* and SMTP_* env standards)
  // Tests never use SMTP. Development simulation must be explicitly enabled.
  EMAIL_MODE: process.env.NODE_ENV !== 'production' &&
    (isTestEnv || (process.env.NODE_ENV === 'development' && process.env.EMAIL_MODE === 'simulated'))
    ? 'simulated' : 'smtp',
  EMAIL_AUTH_MODE: (process.env.EMAIL_AUTH_MODE || '').trim().toLowerCase(),
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  GOOGLE_OAUTH_REFRESH_TOKEN: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
  SMTP_HOST: process.env.MAIL_HOST || process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.MAIL_PORT || process.env.SMTP_PORT, 10) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true' || (process.env.MAIL_PORT === '465' || process.env.SMTP_PORT === '465'),
  SMTP_USER: process.env.MAIL_USERNAME || process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.MAIL_PASSWORD || process.env.SMTP_PASSWORD || '',
  MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_FROM || ((process.env.MAIL_USERNAME || process.env.SMTP_USER) ? `Hệ thống Tuyển dụng ATS <${process.env.MAIL_USERNAME || process.env.SMTP_USER}>` : 'ATS Internal Recruitment <no-reply@company.com>')
};
