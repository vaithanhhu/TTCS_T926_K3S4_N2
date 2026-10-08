(async () => {
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Run from a clean isolated copy, never alongside working databases or secrets.
const root = path.resolve(__dirname, '..', '..');
assert.ok(!fs.existsSync(path.join(root, '.git')), 'Use an isolated copy without .git');
assert.ok(!fs.existsSync(path.join(root, '.env')), 'Use an isolated copy without .env');
for (const name of ['ats.db', 'ats.db-wal', 'ats.db-shm']) {
  assert.ok(!fs.existsSync(path.join(root, 'backend', 'data', name)), 'Do not use runtime databases');
}
process.env.NODE_ENV = 'test';
const nodemailer = require('nodemailer');
const createRealTransport = nodemailer.createTransport;
const config = require('../src/config/config');
const { getDatabase } = require('../src/db/database');
const { seedDatabase } = require('../src/db/seed');
const { EmailService } = require('../src/services/emailService');
const AuthService = require('../src/services/authService');
const AuthController = require('../src/controllers/authController');
const { verifyPassword } = require('../src/utils/password');

// A transport factory that blocks networking even if the test is misconfigured.
nodemailer.createTransport = () => { throw new Error('Network transport forbidden in automated tests'); };
const db = getDatabase(':memory:');
(await seedDatabase(db));
const auth = new AuthService(db);
const controller = new AuthController(auth);
const savedConfig = { ...config };
const realNow = Date.now;
const email = 'admin@company.com';
const missingEmail = 'not-registered@example.invalid';
const ttl = 5 * 60000;
let count = 0;

async function test(name, fn) {
  try {
    await fn();
    count++;
    console.log(`[PASS] ${name}`);
  } finally {
    Object.assign(config, savedConfig);
    Date.now = realNow;
    nodemailer.createTransport = () => { throw new Error('Network transport forbidden in automated tests'); };
    auth.emailService = new EmailService(db);
  }
}

function modeInProcess(nodeEnv, emailMode, testPath = false) {
  const env = { ...process.env, NODE_ENV: nodeEnv, EMAIL_MODE: emailMode };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'MAIL_HOST', 'SMTP_HOST',
    'MAIL_USERNAME', 'SMTP_USER', 'MAIL_PASSWORD', 'SMTP_PASSWORD']) delete env[key];
  const script = (testPath ? "process.argv[1] = 'backend/tests/fixture.js';" : '') +
    "process.stdout.write(require('./backend/src/config/config').EMAIL_MODE)";
  return execFileSync(process.execPath, ['-e', script],
    { cwd: root, env, encoding: 'utf8' });
}

function smtpService(sendMail) {
  config.EMAIL_MODE = 'smtp';
  config.SMTP_HOST = 'smtp.example.invalid';
  config.SMTP_USER = 'smtp-fixture@example.invalid';
  config.SMTP_PASSWORD = 'fake-test-credential';
  nodemailer.createTransport = () => ({ sendMail });
  return new EmailService(db);
}

function configureOAuth() {
  config.EMAIL_MODE = 'smtp';
  config.EMAIL_AUTH_MODE = 'oauth2';
  config.SMTP_HOST = 'smtp.gmail.com';
  config.SMTP_PORT = 587;
  config.SMTP_SECURE = false;
  config.SMTP_USER = 'oauth-fixture@example.invalid';
  config.SMTP_PASSWORD = '';
  config.GOOGLE_OAUTH_CLIENT_ID = 'fixture-client-id';
  config.GOOGLE_OAUTH_CLIENT_SECRET = 'fixture-client-secret';
  config.GOOGLE_OAUTH_REFRESH_TOKEN = 'fixture-refresh-token';
}

function oauthService(sendMail) {
  configureOAuth();
  nodemailer.createTransport = () => ({ sendMail });
  return new EmailService(db);
}

async function issueOtp(at = realNow()) {
  Date.now = () => at;
  (await auth.requestPasswordReset(email));
  return (await db.prepare("SELECT * FROM otps WHERE email = ? AND used_at IS NULL").get(email));
}

async function publicRequest(method, address) {
  let status;
  let body;
  const res = {
    writeHead(code) { status = code; },
    end(json) { body = JSON.parse(json); }
  };
  await controller[method]({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res, { email: address });
  await new Promise(resolve => setImmediate(resolve));
  return { status, body };
}

async function run() {
  await test('Production defaults to real SMTP when configuration is absent', () => {
    assert.equal(modeInProcess('production', ''), 'smtp');
  });
  await test('Production cannot enable simulated delivery', () => {
    assert.equal(modeInProcess('production', 'simulated'), 'smtp');
    assert.equal(modeInProcess('production', 'simulated', true), 'smtp');
  });
  await test('Development simulation requires explicit opt-in', () => {
    assert.equal(modeInProcess('development', 'simulated'), 'simulated');
    assert.equal(modeInProcess('development', ''), 'smtp');
  });
  await test('Automated test mode uses simulation', () => {
    assert.equal(modeInProcess('test', 'smtp'), 'simulated');
  });
  await test('Unspecified environment does not silently simulate', () => {
    assert.equal(modeInProcess('', ''), 'smtp');
  });
  await test('Simulation cache and audit explicitly indicate no SMTP delivery', async () => {
    config.EMAIL_MODE = 'simulated';
    config.SMTP_HOST = 'smtp.example.invalid';
    config.SMTP_USER = 'fixture@example.invalid';
    config.SMTP_PASSWORD = 'fake-test-credential';
    const service = new EmailService(db); // Network factory must not be called.
    const result = await service.sendOtpEmail(email, '123456');
    assert.equal(result.success, true);
    assert.equal(result.delivered, false);
    assert.equal(result.simulated, true);
    assert.equal(service.getLastSentEmail().delivered, false);
    assert.equal(service.getLastSentEmail().status, 'SENT_LOCAL');
    assert.equal((await db.prepare('SELECT status FROM email_logs ORDER BY rowid DESC LIMIT 1').get()).status, 'SENT_LOCAL');
  });
  await test('Missing real SMTP is FAILED, never simulated or delivered', async () => {
    config.EMAIL_MODE = 'smtp';
    config.SMTP_HOST = config.SMTP_USER = config.SMTP_PASSWORD = '';
    const service = new EmailService(db);
    const result = await service.sendOtpEmail(email, '123456');
    assert.equal(result.success, false);
    assert.equal(result.delivered, false);
    assert.equal(result.simulated, false);
    assert.equal(result.error, 'SMTP_NOT_CONFIGURED');
    assert.equal(service.getLastSentEmail().status, 'FAILED');
    assert.equal(service.getLastSentEmail().content, undefined);
    const audit = (await db.prepare('SELECT * FROM email_logs ORDER BY rowid DESC LIMIT 1').get());
    assert.equal(audit.status, 'FAILED');
    assert.equal(audit.error_message, 'SMTP_NOT_CONFIGURED');
  });
  await test('SMTP initialization failure has a safe internal error', async () => {
    config.EMAIL_MODE = 'smtp';
    config.SMTP_HOST = 'smtp.example.invalid';
    config.SMTP_USER = 'fixture@example.invalid';
    config.SMTP_PASSWORD = 'fake-test-credential';
    nodemailer.createTransport = () => { throw new Error('SECRET_TRANSPORT_INITIALIZATION'); };
    const result = await new EmailService(db).sendOtpEmail(email, '123456');
    assert.equal(result.delivered, false);
    assert.equal(result.success, false);
    assert.equal(result.error, 'SMTP_INITIALIZATION_FAILED');
  });
  await test('SMTP send failure does not claim delivery or expose raw errors', async () => {
    const service = smtpService(async () => { throw new Error('SECRET_SMTP_PASSWORD OTP:123456 reset-token'); });
    const result = await service.sendOtpEmail(email, '123456');
    assert.equal(result.success, false);
    assert.equal(result.delivered, false);
    assert.equal(result.simulated, false);
    assert.equal(result.error, 'SMTP_SEND_FAILED');
    assert.equal(service.getLastSentEmail().status, 'FAILED');
    const audit = (await db.prepare('SELECT * FROM email_logs ORDER BY rowid DESC LIMIT 1').get());
    assert.equal(audit.error_message, 'SMTP_SEND_FAILED');
    assert.ok(!JSON.stringify(audit).includes('123456'));
  });
  await test('An unaccepted recipient cannot be reported as delivered', async () => {
    const result = await smtpService(async () => ({ accepted: [], rejected: [email] })).sendOtpEmail(email, '123456');
    assert.equal(result.delivered, false);
    assert.equal(result.error, 'SMTP_RECIPIENT_REJECTED');
  });
  await test('Pending cache is not evidence of real delivery; accepted SMTP updates it', async () => {
    let finish;
    const service = smtpService(() => new Promise(resolve => { finish = resolve; }));
    const pending = (await service.sendOtpEmail(email, '123456'));
    assert.equal(service.getLastSentEmail().status, 'PENDING');
    assert.equal(service.getLastSentEmail().delivered, false);
    assert.equal(service.getLastSentEmail().content, undefined);
    finish({ accepted: [email], messageId: 'fake-message-id' });
    const result = await pending;
    assert.equal(result.delivered, true);
    assert.equal(result.simulated, false);
    assert.equal(service.getLastSentEmail().status, 'DELIVERED');
    assert.equal((await db.prepare('SELECT status FROM email_logs ORDER BY rowid DESC LIMIT 1').get()).status, 'DELIVERED');
  });
  await test('Real SMTP retains certificate verification', () => {
    let options;
    config.EMAIL_MODE = 'smtp';
    config.SMTP_HOST = 'smtp.example.invalid';
    config.SMTP_USER = 'fixture@example.invalid';
    config.SMTP_PASSWORD = 'fake-test-credential';
    nodemailer.createTransport = supplied => { options = supplied; return {}; };
    new EmailService(db);
    assert.notEqual(options.tls && options.tls.rejectUnauthorized, false);
  });
  await test('Real mode logs, cache and audit contain no OTP, reset token or credentials', async () => {
    const captured = [];
    const originalLog = console.log;
    const originalError = console.error;
    try {
      console.log = console.error = (...parts) => captured.push(parts.join(' '));
      const service = smtpService(async () => { throw new Error('123456 PRIVATE_RESET_TOKEN fake-test-credential'); });
      await service.sendOtpEmail(email, '123456');
      await service.sendPasswordResetEmail(email, 'PRIVATE_RESET_TOKEN');
      await service.sendAccountActivationEmail(email, 'Fixture', 'PRIVATE_TEMP_PASSWORD', 'Fixture');
      const stored = captured.join(' ') + JSON.stringify(service.sentEmails) + JSON.stringify(
        (await db.prepare('SELECT subject, error_message FROM email_logs ORDER BY rowid DESC LIMIT 3').all()));
      for (const secret of ['123456', 'PRIVATE_RESET_TOKEN', 'fake-test-credential', 'PRIVATE_TEMP_PASSWORD']) {
        assert.ok(!stored.includes(secret), `Must not retain secret: ${secret}`);
      }
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
  await test('OTP email advertises 5 minutes without putting OTP in its subject', async () => {
    const service = new EmailService(db);
    await service.sendOtpEmail(email, '123456');
    const record = service.getLastSentEmail();
    assert.ok(record.content.includes('<strong>5 phút</strong>'));
    assert.ok(!record.content.includes('10 phút'));
    assert.ok(!record.subject.includes('123456'));
  });
  await test('Issued PASSWORD_RESET OTP expires exactly 5 minutes after issuance', async () => {
    const at = realNow();
    const otp = (await issueOtp(at));
    assert.equal(otp.purpose, 'PASSWORD_RESET');
    assert.equal(new Date(otp.expires_at).getTime() - at, ttl);
  });
  await test('OTP is valid immediately before its 5-minute deadline', async () => {
    const at = realNow();
    const otp = (await issueOtp(at));
    Date.now = () => at + ttl - 1;
    assert.equal((await auth.verifyOtp(email, otp.otp_code)).valid, true);
  });
  await test('OTP is rejected at the exact 5-minute deadline', async () => {
    const at = realNow();
    const otp = (await issueOtp(at));
    Date.now = () => at + ttl;
    const result = (await auth.verifyOtp(email, otp.otp_code));
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 400);
    assert.equal(result.code, 'OTP_EXPIRED');
    assert.ok(result.message.includes('5 phút'));
  });
  await test('OTP is rejected after 5 minutes even though the old TTL was 10', async () => {
    const at = realNow();
    const otp = (await issueOtp(at));
    Date.now = () => at + ttl + 1;
    assert.equal((await auth.verifyOtp(email, otp.otp_code)).code, 'OTP_EXPIRED');
  });
  await test('Resend starts a new 5-minute TTL and invalidates the previous OTP', async () => {
    const at = realNow();
    const old = (await issueOtp(at));
    const generateOtp = auth.generateOtp;
    try {
      auth.generateOtp = () => old.otp_code === '654321' ? '654322' : '654321';
      Date.now = () => at + 60000;
      assert.equal((await auth.resendOtp(email)).success, true);
      const current = (await db.prepare('SELECT * FROM otps WHERE email = ? AND used_at IS NULL').get(email));
      assert.equal(new Date(current.expires_at).getTime(), at + 60000 + ttl);
      assert.equal((await db.prepare('SELECT id FROM otps WHERE id = ?').get(old.id)), undefined);
      assert.equal((await auth.verifyOtp(email, old.otp_code)).code, 'INVALID_OTP');
      assert.equal((await auth.verifyOtp(email, current.otp_code)).valid, true);
    } finally { auth.generateOtp = generateOtp; }
  });
  await test('New forgot request invalidates previous unused OTP and reset link', async () => {
    (await issueOtp());
    const old = (await db.prepare('SELECT token FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').get('usr-admin'));
    const oldOtp = (await db.prepare('SELECT id FROM otps WHERE email = ? AND used_at IS NULL').get(email));
    (await issueOtp());
    assert.equal((await auth.verifyResetToken(old.token)).valid, false);
    assert.equal((await db.prepare('SELECT id FROM otps WHERE id = ?').get(oldOtp.id)), undefined);
  });
  await test('Forgot reset link retains 30-minute TTL, independent of OTP', async () => {
    const at = realNow();
    (await issueOtp(at));
    const row = (await db.prepare('SELECT * FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').get('usr-admin'));
    assert.equal(new Date(row.expires_at).getTime() - at, 30 * 60000);
    Date.now = () => at + 6 * 60000;
    assert.equal((await auth.verifyResetToken(row.token)).valid, true);
  });
  await test('Token issued by OTP verification also retains 30-minute TTL', async () => {
    const at = realNow();
    const otp = (await issueOtp(at));
    Date.now = () => at + 60000;
    const result = (await auth.verifyOtp(email, otp.otp_code));
    const token = (await db.prepare('SELECT expires_at FROM password_reset_tokens WHERE token = ?').get(result.resetToken));
    assert.equal(new Date(token.expires_at).getTime(), at + 60000 + 30 * 60000);
  });
  await test('Expired 30-minute reset token is rejected', async () => {
    const at = realNow();
    (await issueOtp(at));
    const token = (await db.prepare('SELECT token FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').get('usr-admin')).token;
    Date.now = () => at + 30 * 60000 + 1;
    assert.equal((await auth.verifyResetToken(token)).code, 'TOKEN_EXPIRED');
  });
  await test('Reset remains single-use and revokes the OTP and old password using Scrypt', async () => {
    const otp = (await issueOtp());
    const token = (await auth.verifyOtp(email, otp.otp_code)).resetToken;
    const password = 'FixtureReset2026!';
    const oldHash = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get('usr-admin')).password_hash;
    assert.equal((await auth.resetPassword(token, password)).success, true);
    const hash = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get('usr-admin')).password_hash;
    assert.notEqual(hash, oldHash);
    assert.notEqual(hash, password);
    assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.equal(verifyPassword(password, hash), true);
    assert.equal(verifyPassword('Ats@123456', hash), false);
    assert.equal((await auth.login(email, password)).success, true);
    assert.equal((await auth.login(email, 'Ats@123456')).statusCode, 401);
    assert.equal((await auth.resetPassword(token, 'AnotherFixture2026!')).code, 'TOKEN_ALREADY_USED');
    assert.equal((await auth.verifyOtp(email, otp.otp_code)).code, 'INVALID_OTP');
  });
  await test('Forgot HTTP payload is identical for existing/nonexistent accounts in simulation', async () => {
    const existing = await publicRequest('handleForgotPassword', email);
    const missing = await publicRequest('handleForgotPassword', missingEmail);
    assert.equal(existing.status, 200);
    assert.deepEqual(existing, missing);
    assert.deepEqual(Object.keys(existing.body).sort(), ['code', 'message', 'success']);
  });
  await test('Missing SMTP does not reveal account existence through forgot or resend', async () => {
    config.EMAIL_MODE = 'smtp';
    config.SMTP_HOST = config.SMTP_USER = config.SMTP_PASSWORD = '';
    auth.emailService = new EmailService(db);
    for (const method of ['handleForgotPassword', 'handleResendOtp']) {
      const existing = await publicRequest(method, email);
      assert.equal(existing.status, 200);
      assert.deepEqual(existing, await publicRequest(method, missingEmail));
      assert.ok(!JSON.stringify(existing).includes('SMTP'));
    }
    assert.ok(auth.emailService.sentEmails.every(record => !record.delivered && !record.simulated && record.status === 'FAILED'));
  });
  await test('SMTP send failure does not reveal account existence through forgot or resend', async () => {
    auth.emailService = smtpService(async () => { throw new Error('SECRET_SMTP_FAILURE'); });
    for (const method of ['handleForgotPassword', 'handleResendOtp']) {
      const existing = await publicRequest(method, email);
      assert.equal(existing.status, 200);
      assert.deepEqual(existing, await publicRequest(method, missingEmail));
      assert.ok(!JSON.stringify(existing).includes('SECRET_SMTP_FAILURE'));
    }
    assert.ok(auth.emailService.sentEmails.every(record => !record.delivered && record.status === 'FAILED'));
  });
  await test('Unregistered address creates neither OTP nor token and never sends mail', async () => {
    const before = (await db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()).n;
    auth.emailService.sentEmails = [];
    await publicRequest('handleForgotPassword', missingEmail);
    await publicRequest('handleResendOtp', missingEmail);
    assert.equal(auth.emailService.sentEmails.length, 0);
    assert.equal((await db.prepare('SELECT id FROM otps WHERE email = ?').get(missingEmail)), undefined);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get()).n, before);
  });
  await test('Inactive account keeps its existing no-token/no-mail business rule', async () => {
    const address = 'interviewer@company.com';
    const user = (await db.prepare('SELECT id, status FROM users WHERE email = ?').get(address));
    (await db.prepare("UPDATE users SET status = 'LOCKED' WHERE id = ?").run(user.id));
    try {
      auth.emailService.sentEmails = [];
      assert.deepEqual(await publicRequest('handleForgotPassword', address), await publicRequest('handleForgotPassword', missingEmail));
      assert.equal(auth.emailService.sentEmails.length, 0);
      assert.equal((await db.prepare('SELECT id FROM otps WHERE email = ?').get(address)), undefined);
      assert.equal((await db.prepare('SELECT id FROM password_reset_tokens WHERE user_id = ?').get(user.id)), undefined);
    } finally { (await db.prepare('UPDATE users SET status = ? WHERE id = ?').run(user.status, user.id)); }
  });
  await test('Forgot/resend send only to the stored account email, not a separate address', async () => {
    const address = 'interviewer@company.com';
    auth.emailService.sentEmails = [];
    await publicRequest('handleForgotPassword', '  INTERVIEWER@COMPANY.COM  ');
    await publicRequest('handleResendOtp', '  INTERVIEWER@COMPANY.COM  ');
    assert.equal(auth.emailService.sentEmails.length, 3);
    assert.ok(auth.emailService.sentEmails.every(record => record.to === address));
  });
  await test('Forgot real-SMTP path passes OTP 5-minute and reset-link 30-minute content to a fake transport', async () => {
    const messages = [];
    auth.emailService = smtpService(async message => {
      messages.push(message);
      return { accepted: [message.to], messageId: 'fake-message-id' };
    });
    const existing = await publicRequest('handleForgotPassword', '  INTERVIEWER@COMPANY.COM  ');
    assert.deepEqual(existing, await publicRequest('handleForgotPassword', missingEmail));
    assert.equal(messages.length, 2);
    assert.ok(messages.every(message => message.to === 'interviewer@company.com'));
    assert.ok(messages[0].text.includes('5 phút'));
    assert.ok(messages[1].text.includes('30 phút'));
    assert.ok(auth.emailService.sentEmails.every(record => record.delivered && !record.simulated && record.content === undefined));
  });
  await test('OAuth environment variables load through the existing config without exposing values', () => {
    const env = { ...process.env, NODE_ENV: 'test', EMAIL_AUTH_MODE: 'OAuth2',
      GOOGLE_OAUTH_CLIENT_ID: 'fixture-client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-client-secret',
      GOOGLE_OAUTH_REFRESH_TOKEN: 'fixture-refresh-token' };
    const script = "const c=require('./backend/src/config/config'); process.stdout.write(JSON.stringify({mode:c.EMAIL_AUTH_MODE,id:c.GOOGLE_OAUTH_CLIENT_ID==='fixture-client-id',secret:c.GOOGLE_OAUTH_CLIENT_SECRET==='fixture-client-secret',refresh:c.GOOGLE_OAUTH_REFRESH_TOKEN==='fixture-refresh-token'}))";
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8' })),
      { mode: 'oauth2', id: true, secret: true, refresh: true });
  });
  await test('Complete OAuth2 config creates the Gmail SMTP transporter without a password', () => {
    configureOAuth();
    let options;
    nodemailer.createTransport = supplied => { options = supplied; return {}; };
    const service = new EmailService(db);
    assert.equal(service.configurationError, null);
    assert.equal(service.authMode, 'oauth2');
    assert.equal(options.host, 'smtp.gmail.com');
    assert.equal(options.port, 587);
    assert.equal(options.secure, false);
    assert.deepEqual(options.auth, { type: 'OAuth2', user: config.SMTP_USER,
      clientId: config.GOOGLE_OAUTH_CLIENT_ID, clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: config.GOOGLE_OAUTH_REFRESH_TOKEN });
    assert.equal(options.auth.pass, undefined);
    assert.equal(options.auth.accessToken, undefined);
    assert.equal(options.logger, false);
    assert.equal(options.debug, false);
  });
  await test('OAuth configuration automatically takes priority over a stale SMTP password', () => {
    configureOAuth();
    for (const mode of ['', 'password']) {
      config.EMAIL_AUTH_MODE = mode;
      config.SMTP_PASSWORD = 'fixture-stale-password';
      let authOptions;
      nodemailer.createTransport = options => { authOptions = options.auth; return {}; };
      assert.equal(new EmailService(db).authMode, 'oauth2');
      assert.equal(authOptions.type, 'OAuth2');
      assert.equal(authOptions.pass, undefined);
    }
  });
  for (const key of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'SMTP_USER']) {
    await test(`Missing ${key} rejects OAuth configuration without password fallback`, async () => {
      configureOAuth();
      config.SMTP_PASSWORD = 'fixture-stale-password';
      let created = 0;
      nodemailer.createTransport = () => { created++; return {}; };
      for (const value of ['', null, undefined, '   ']) {
        config[key] = value;
        const service = new EmailService(db);
        assert.equal(service.configurationError, 'SMTP_OAUTH_NOT_CONFIGURED');
        assert.equal(service.transporter, null);
        const result = await service.sendOtpEmail(email, '123456');
        assert.equal(result.success, false);
        assert.equal(result.delivered, false);
        assert.equal(result.simulated, false);
        assert.equal(result.error, 'SMTP_OAUTH_NOT_CONFIGURED');
      }
      assert.equal(created, 0);
    });
  }
  await test('Explicit OAuth selection rejects all missing OAuth credentials even with a password present', async () => {
    configureOAuth();
    config.SMTP_PASSWORD = 'fixture-stale-password';
    config.GOOGLE_OAUTH_CLIENT_ID = config.GOOGLE_OAUTH_CLIENT_SECRET = config.GOOGLE_OAUTH_REFRESH_TOKEN = '';
    const service = new EmailService(db);
    assert.equal(service.transporter, null);
    assert.equal((await service.sendOtpEmail(email, '123456')).error, 'SMTP_OAUTH_NOT_CONFIGURED');
  });
  await test('Partial auto-detected OAuth config cannot silently fall back to password auth', async () => {
    configureOAuth();
    config.EMAIL_AUTH_MODE = '';
    config.SMTP_PASSWORD = 'fixture-stale-password';
    config.GOOGLE_OAUTH_CLIENT_ID = config.GOOGLE_OAUTH_CLIENT_SECRET = '';
    const service = new EmailService(db);
    assert.equal(service.authMode, 'oauth2');
    assert.equal((await service.sendOtpEmail(email, '123456')).success, false);
    assert.equal(service.transporter, null);
  });
  await test('Invalid auth mode fails safely rather than choosing password or simulation', async () => {
    configureOAuth();
    config.EMAIL_AUTH_MODE = 'invalid-fixture-mode';
    const result = await new EmailService(db).sendOtpEmail(email, '123456');
    assert.equal(result.error, 'SMTP_AUTH_MODE_INVALID');
    assert.equal(result.success, false);
    assert.equal(result.delivered, false);
  });
  await test('OAuth transport initialization failure is safe and never falls back', async () => {
    configureOAuth();
    config.SMTP_PASSWORD = 'fixture-stale-password';
    let created = 0;
    nodemailer.createTransport = () => { created++; throw new Error('fixture-client-secret fixture-refresh-token'); };
    const service = new EmailService(db);
    assert.equal(service.configurationError, 'SMTP_INITIALIZATION_FAILED');
    const result = await service.sendOtpEmail(email, '123456');
    assert.equal(result.success, false);
    assert.equal(result.delivered, false);
    assert.equal(result.simulated, false);
    assert.equal(created, 1);
  });
  await test('OAuth authentication and token-refresh failures return false without auth-mode fallback', async () => {
    for (const code of ['EAUTH', 'EOAUTH2']) {
      configureOAuth();
      config.SMTP_PASSWORD = 'fixture-stale-password';
      let created = 0;
      let attempts = 0;
      nodemailer.createTransport = options => {
        created++;
        assert.equal(options.auth.type, 'OAuth2');
        assert.equal(options.auth.pass, undefined);
        return { sendMail: async () => { attempts++; throw Object.assign(new Error('fixture-refresh-token'), { code }); } };
      };
      const service = new EmailService(db);
      const result = await service.sendOtpEmail(email, '123456');
      assert.equal(result.success, false);
      assert.equal(result.delivered, false);
      assert.equal(result.simulated, false);
      assert.equal(result.error, 'SMTP_SEND_FAILED');
      assert.equal(service.getLastSentEmail().status, 'FAILED');
      assert.equal(service.getLastSentEmail().authMode, 'oauth2');
      assert.equal(created, 1);
      assert.equal(attempts, 1);
    }
  });
  await test('OAuth-configured simulation still avoids transporter creation and real delivery', async () => {
    configureOAuth();
    config.EMAIL_MODE = 'simulated';
    const service = new EmailService(db); // Default transport factory forbids networking.
    const result = await service.sendOtpEmail(email, '123456');
    assert.equal(result.simulated, true);
    assert.equal(result.delivered, false);
    assert.equal(service.transporter, null);
  });
  await test('Non-Gmail SMTP password compatibility works with no OAuth configuration', async () => {
    config.EMAIL_AUTH_MODE = 'password';
    config.EMAIL_MODE = 'smtp';
    config.SMTP_HOST = 'smtp.other-provider.invalid';
    config.SMTP_USER = 'fixture@example.invalid';
    config.SMTP_PASSWORD = 'fixture-provider-password';
    let supplied;
    nodemailer.createTransport = options => {
      supplied = options;
      return { sendMail: async message => ({ accepted: [message.to], messageId: 'fixture-message' }) };
    };
    const service = new EmailService(db);
    assert.equal(service.authMode, 'password');
    assert.deepEqual(supplied.auth, { user: config.SMTP_USER, pass: config.SMTP_PASSWORD });
    const result = await service.sendOtpEmail(email, '123456');
    assert.equal(result.success, true);
    assert.equal(result.delivered, true);
  });
  await test('OAuth failure and missing config preserve identical forgot/resend HTTP responses', async () => {
    for (const incomplete of [false, true]) {
      auth.emailService = oauthService(async () => { throw Object.assign(new Error('fixture-refresh-token'), { code: 'EOAUTH2' }); });
      if (incomplete) {
        config.GOOGLE_OAUTH_REFRESH_TOKEN = '';
        auth.emailService = new EmailService(db);
      }
      for (const method of ['handleForgotPassword', 'handleResendOtp']) {
        const existing = await publicRequest(method, email);
        assert.equal(existing.status, 200);
        assert.deepEqual(existing, await publicRequest(method, missingEmail));
        assert.deepEqual(Object.keys(existing.body).sort(), ['code', 'message', 'success']);
        assert.ok(!JSON.stringify(existing).includes('fixture-refresh-token'));
      }
      assert.ok(auth.emailService.sentEmails.every(record => !record.delivered && !record.simulated && record.status === 'FAILED'));
    }
  });
  await test('OAuth success keeps OTP 5 minutes and both reset token paths 30 minutes', async () => {
    const messages = [];
    auth.emailService = oauthService(async message => {
      messages.push(message);
      return { accepted: [message.to], messageId: 'fixture-message' };
    });
    const at = realNow();
    const otp = (await issueOtp(at));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(new Date(otp.expires_at).getTime() - at, 5 * 60000);
    const link = (await db.prepare('SELECT * FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').get('usr-admin'));
    assert.equal(new Date(link.expires_at).getTime() - at, 30 * 60000);
    const verified = (await auth.verifyOtp(email, otp.otp_code));
    assert.equal(verified.valid, true);
    const token = (await db.prepare('SELECT expires_at FROM password_reset_tokens WHERE token = ?').get(verified.resetToken));
    assert.equal(new Date(token.expires_at).getTime() - at, 30 * 60000);
    assert.ok(messages[0].text.includes('5 phút'));
    assert.ok(messages[1].text.includes('30 phút'));
    assert.ok(auth.emailService.sentEmails.every(record => record.delivered && record.authMode === 'oauth2'));
  });
  await test('OAuth secrets and raw errors never appear in application logs, cache or email audit', async () => {
    const captured = [];
    const originalLog = console.log;
    const originalError = console.error;
    try {
      console.log = console.error = (...parts) => captured.push(parts.join(' '));
      const service = oauthService(async () => { throw new Error('fixture-client-secret fixture-refresh-token fixture-access-token 123456 PRIVATE_RESET_TOKEN'); });
      await service.sendOtpEmail(email, '123456');
      await service.sendPasswordResetEmail(email, 'PRIVATE_RESET_TOKEN');
      const stored = captured.join(' ') + JSON.stringify(service.sentEmails) + JSON.stringify(
        (await db.prepare('SELECT subject, error_message FROM email_logs ORDER BY rowid DESC LIMIT 2').all()));
      for (const secret of ['fixture-client-secret', 'fixture-refresh-token', 'fixture-access-token', '123456', 'PRIVATE_RESET_TOKEN']) {
        assert.ok(!stored.includes(secret));
      }
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
  await test('Installed Nodemailer selects XOAUTH2 and refreshes/caches access tokens using a stubbed HTTP request', async () => {
    configureOAuth();
    // Construct the actual dependency without connecting SMTP or Google.
    nodemailer.createTransport = options => createRealTransport(options);
    const service = new EmailService(db);
    const transport = service.transporter.transporter;
    assert.equal(transport.auth.method, 'XOAUTH2');
    const oauth = transport.auth.oauth2;
    let requests = 0;
    oauth.postRequest = (url, values, options, callback) => {
      requests++;
      assert.equal(values.grant_type, 'refresh_token');
      assert.equal(values.client_id, config.GOOGLE_OAUTH_CLIENT_ID);
      assert.equal(values.client_secret, config.GOOGLE_OAUTH_CLIENT_SECRET);
      assert.equal(values.refresh_token, config.GOOGLE_OAUTH_REFRESH_TOKEN);
      callback(null, Buffer.from(JSON.stringify({ access_token: 'fixture-access-token-' + requests, expires_in: 3600 })));
    };
    const getToken = renew => new Promise((resolve, reject) => oauth.getToken(renew, (error, token) => error ? reject(error) : resolve(token)));
    try {
      assert.equal(await getToken(false), 'fixture-access-token-1');
      assert.equal(await getToken(false), 'fixture-access-token-1');
      assert.equal(requests, 1);
      oauth.expires = realNow() - 1;
      assert.equal(await getToken(false), 'fixture-access-token-2');
      assert.equal(requests, 2);
      assert.equal(service.sentEmails.length, 0);
    } finally { service.transporter.close(); }
  });
  console.log(`S1-03 EMAIL SECURITY: ${count}/${count} PASS (mock/simulated only; no Internet SMTP)`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.close());

})().catch(error => { console.error(error.stack); process.exitCode = 1; });
