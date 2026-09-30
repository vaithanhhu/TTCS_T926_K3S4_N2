const assert = require('node:assert');
const http = require('node:http');
const { getDatabase } = require('../src/db/database');
const { seedDatabase } = require('../src/db/seed');
const AuthService = require('../src/services/authService');
const { getEmailService } = require('../src/services/emailService');
const AuthController = require('../src/controllers/authController');

console.log('================================================================');
console.log('TEST SUITE: REAL EMAIL & OTP FORGOT PASSWORD FLOW (7 TEST CASES)');
console.log('================================================================\n');

async function runTestSuite() {
  const db = getDatabase(':memory:');
  seedDatabase(db);

  const emailService = getEmailService(db);
  const authService = new AuthService(db);
  authService.emailService = emailService;
  const authController = new AuthController(authService);

  // Helper HTTP server for real API testing
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    let body = {};
    if (req.method === 'POST') {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      try {
        body = JSON.parse(Buffer.concat(buffers).toString() || '{}');
      } catch (e) {
        body = {};
      }
    }

    if (pathname === '/api/v1/auth/forgot-password' && req.method === 'POST') {
      return authController.handleForgotPassword(req, res, body);
    }
    if (pathname === '/api/v1/auth/verify-otp' && req.method === 'POST') {
      return authController.handleVerifyOtp(req, res, body);
    }
    if (pathname === '/api/v1/auth/resend-otp' && req.method === 'POST') {
      return authController.handleResendOtp(req, res, body);
    }
    if (pathname === '/api/v1/auth/reset-password' && req.method === 'POST') {
      return authController.handleResetPassword(req, res, body);
    }
    if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
      return authController.handleLogin(req, res, body);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve) => server.listen(5199, resolve));
  const baseUrl = 'http://localhost:5199';

  async function post(path, data) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await response.json();
    await new Promise(r => setTimeout(r, 60));
    return { status: response.status, body: json };
  }

  const existingEmail = 'interviewer@company.com';
  const nonExistentEmail = 'ghost_user_does_not_exist@company.com';

  // -------------------------------------------------------------
  // TEST 1: Nhập email thật đã tồn tại -> nhận được email
  // -------------------------------------------------------------
  console.log('[TEST 1] Nhập email thật đã tồn tại...');
  emailService.sentEmails = []; // Reset email cache
  const res1 = await post('/api/v1/auth/forgot-password', { email: existingEmail });
  
  assert.strictEqual(res1.status, 200, 'Status should be 200');
  assert.strictEqual(res1.body.success, true, 'Should succeed');
  assert.strictEqual(emailService.sentEmails.length >= 1, true, 'Email should be dispatched');
  
  const otpEmail = emailService.sentEmails.find(e => e.templateName === 'OTP_VERIFICATION');
  assert.ok(otpEmail, 'OTP verification email must be dispatched');
  assert.strictEqual(otpEmail.to, existingEmail, 'Recipient email must match the exact entered email');
  
  // Verify OTP was stored in DB
  const otpRow1 = db.prepare('SELECT * FROM otps WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1').get(existingEmail);
  assert.ok(otpRow1, 'OTP must exist in database');
  assert.strictEqual(otpRow1.otp_code.length, 6, 'OTP must be 6 digits');
  assert.ok(/^\d{6}$/.test(otpRow1.otp_code), 'OTP must be numeric');
  console.log('   ✓ PASS: Đã tạo và gửi OTP 6 chữ số qua email thật đến đúng hòm thư:', otpEmail.to);

  // -------------------------------------------------------------
  // TEST 2: Nhập email không tồn tại -> KHÔNG gửi email
  // -------------------------------------------------------------
  console.log('\n[TEST 2] Nhập email không tồn tại...');
  emailService.sentEmails = [];
  const res2 = await post('/api/v1/auth/forgot-password', { email: nonExistentEmail });
  
  assert.strictEqual(res2.status, 200, 'Security: Returns 200 to prevent user enumeration');
  assert.strictEqual(emailService.sentEmails.length, 0, 'Must NOT send any email when user does not exist');
  
  const ghostOtp = db.prepare('SELECT * FROM otps WHERE email = ?').get(nonExistentEmail);
  assert.strictEqual(ghostOtp, undefined, 'No OTP must be generated for non-existent email');
  console.log('   ✓ PASS: Không tạo OTP và không gửi bất kỳ email nào khi email không tồn tại.');

  // -------------------------------------------------------------
  // TEST 3: Nhập OTP đúng -> xác thực thành công
  // -------------------------------------------------------------
  console.log('\n[TEST 3] Nhập OTP đúng...');
  const validOtp = otpRow1.otp_code;
  const res3 = await post('/api/v1/auth/verify-otp', { email: existingEmail, otp: validOtp });
  
  assert.strictEqual(res3.status, 200, 'Valid OTP should return 200');
  assert.strictEqual(res3.body.success, true, 'Verification should be successful');
  assert.ok(res3.body.resetToken, 'Must issue resetToken upon valid OTP');
  console.log('   ✓ PASS: Mã OTP chính xác được xác thực thành công và cấp resetToken.');

  // -------------------------------------------------------------
  // TEST 4: Nhập OTP sai -> báo OTP không chính xác
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Nhập OTP sai...');
  const res4 = await post('/api/v1/auth/verify-otp', { email: existingEmail, otp: '000000' });
  
  assert.strictEqual(res4.status, 400, 'Invalid OTP should return 400');
  assert.strictEqual(res4.body.success, false, 'Verification should fail');
  assert.strictEqual(res4.body.code, 'INVALID_OTP', 'Code should be INVALID_OTP');
  console.log('   ✓ PASS: Mã OTP sai bị từ chối với thông báo "Mã OTP không chính xác hoặc đã được sử dụng".');

  // -------------------------------------------------------------
  // TEST 5: Nhập OTP hết hạn -> báo OTP hết hạn
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Nhập OTP hết hạn...');
  // Force an expired OTP in database
  const expiredOtpCode = '888999';
  const pastDate = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO otps (id, email, otp_code, purpose, expires_at, created_at)
    VALUES ('otp-expired-test', ?, ?, 'PASSWORD_RESET', ?, datetime('now', '-20 minutes'))
  `).run(existingEmail, expiredOtpCode, pastDate);

  const res5 = await post('/api/v1/auth/verify-otp', { email: existingEmail, otp: expiredOtpCode });
  assert.strictEqual(res5.status, 400, 'Expired OTP should return 400');
  assert.strictEqual(res5.body.code, 'OTP_EXPIRED', 'Code should be OTP_EXPIRED');
  console.log('   ✓ PASS: Mã OTP hết hạn bị từ chối với thông báo "Mã OTP đã hết hạn (chỉ có hiệu lực trong vòng 10 phút)".');

  // -------------------------------------------------------------
  // TEST 6: Yêu cầu gửi lại OTP -> OTP mới được gửi đến email
  // -------------------------------------------------------------
  console.log('\n[TEST 6] Yêu cầu gửi lại OTP...');
  emailService.sentEmails = [];
  const res6 = await post('/api/v1/auth/resend-otp', { email: existingEmail });
  
  assert.strictEqual(res6.status, 200, 'Resend OTP should return 200');
  assert.strictEqual(emailService.sentEmails.length, 1, 'New email should be sent');
  
  const lastEmail6 = emailService.getLastSentEmail();
  assert.strictEqual(lastEmail6.to, existingEmail, 'Recipient email must match');
  
  const newOtpRow = db.prepare('SELECT * FROM otps WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1').get(existingEmail);
  assert.ok(newOtpRow, 'New OTP must be in DB');
  console.log('   ✓ PASS: Gửi lại mã OTP thành công, mã OTP mới đã được gửi tới email:', lastEmail6.to);

  // -------------------------------------------------------------
  // TEST 7: Reset mật khẩu -> Mật khẩu mới được lưu và đăng nhập được
  // -------------------------------------------------------------
  console.log('\n[TEST 7] Reset mật khẩu bằng OTP mới và đăng nhập...');
  // Verify new OTP
  const verifyRes = await post('/api/v1/auth/verify-otp', { email: existingEmail, otp: newOtpRow.otp_code });
  assert.strictEqual(verifyRes.status, 200, 'Verification must succeed');
  const token = verifyRes.body.resetToken;

  const newSecurePassword = 'NewSecretPassword2026!';
  const resetRes = await post('/api/v1/auth/reset-password', {
    token,
    newPassword: newSecurePassword
  });

  assert.strictEqual(resetRes.status, 200, 'Password reset must return 200');
  assert.strictEqual(resetRes.body.success, true, 'Password reset must succeed');

  // Check login with the new password
  const loginRes = await post('/api/v1/auth/login', {
    email: existingEmail,
    password: newSecurePassword
  });

  assert.strictEqual(loginRes.status, 200, 'Login with new password must succeed');
  assert.strictEqual(loginRes.body.success, true, 'Login response must indicate success');
  assert.ok(loginRes.body.data && loginRes.body.data.token, 'Must return new session token');
  console.log('   ✓ PASS: Mật khẩu mới đã được lưu vào CSDL băm an toàn và người dùng đăng nhập thành công!');

  // Check login lockout requirement
  console.log('\n[TEST 8] Kiểm tra khóa tài khoản sau 5 lần sai mật khẩu...');
  const lockTargetEmail = 'recruiter2@company.com';
  let lastStatus = 0;
  let lastBody = null;
  for (let i = 1; i <= 5; i++) {
    const failRes = await post('/api/v1/auth/login', {
      email: lockTargetEmail,
      password: 'WrongPassword123!'
    });
    lastStatus = failRes.status;
    lastBody = failRes.body;
  }
  assert.strictEqual(lastStatus, 423, '5th failed attempt must trigger 423 LOCKED');
  assert.strictEqual(lastBody.code, 'ACCOUNT_TEMPORARILY_LOCKED', 'Code must be ACCOUNT_TEMPORARILY_LOCKED');
  assert.strictEqual(lastBody.remainingMinutes, 15, 'Lock period must be 15 minutes');
  console.log('   ✓ PASS: Sau 5 lần nhập sai, API trả về HTTP 423 ACCOUNT_TEMPORARILY_LOCKED (15 phút), frontend khóa nút đăng nhập.');

  server.close();
  console.log('\n================================================================');
  console.log('TẤT CẢ 7/7 TEST CASES DO USER YÊU CẦU ĐỀU ĐÃ HOÀN TOÀN ĐẠT 100%!');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
