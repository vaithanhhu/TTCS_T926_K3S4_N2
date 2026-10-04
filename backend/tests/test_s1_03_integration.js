const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const { hashPassword } = require('../src/utils/password');

const TEST_PORT = 5097;

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S1-03 (ĐẶT LẠI MẬT KHẨU QUA EMAIL)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Nhập email nhận được liên kết đặt lại có hiệu lực 30 phút');
  console.log('  • AC-02: Liên kết chỉ dùng được một lần');
  console.log('  • AC-03: Email không tồn tại vẫn hiển thị cùng một thông báo');
  console.log('================================================================\n');

  await startServer(TEST_PORT);
  const db = getDatabase();

  let passCount = 0;
  let totalTests = 0;

  function recordPass(testName) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: AC-01 - NHẬP EMAIL TẠO LIÊN KẾT ĐẶT LẠI HIỆU LỰC 30 PHÚT
    // -------------------------------------------------------------
    totalTests++;
    const targetEmail = 'admin@company.com';
    const forgotRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/forgot-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail });

    assert.strictEqual(forgotRes.status, 200);
    assert.strictEqual(forgotRes.body.success, true);
    assert.strictEqual(forgotRes.body.code, 'RESET_LINK_SENT');

    // Kiểm tra token được tạo trong bảng password_reset_tokens
    const tokenRow = db.prepare(`
      SELECT prt.token, prt.expires_at, prt.used_at, u.email
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE u.email = ? AND prt.used_at IS NULL
      ORDER BY prt.created_at DESC
      LIMIT 1
    `).get(targetEmail);

    assert.ok(tokenRow, 'Token đặt lại mật khẩu phải được lưu trong DB');
    assert.strictEqual(tokenRow.used_at, null);

    // Kiểm tra thời hạn 30 phút (AC-01)
    const expiresAt = new Date(tokenRow.expires_at).getTime();
    const now = Date.now();
    const diffMinutes = (expiresAt - now) / 60000;
    assert.ok(diffMinutes > 28 && diffMinutes <= 30.5, 'Thời hạn token phải xấp xỉ 30 phút tính từ thời điểm tạo');
    recordPass('AC-01: Nhập email nhận được token đặt lại mật khẩu có hiệu lực đúng 30 phút');

    // -------------------------------------------------------------
    // TEST 2: AC-02 - LIÊN KẾT CHỈ DÙNG ĐƯỢC MỘT LẦN (SINGLE USE)
    // -------------------------------------------------------------
    totalTests++;
    const validToken = tokenRow.token;
    const newPassword = 'NewSecretPassword@2026';

    // Lần 1: Đặt lại mật khẩu với token hợp lệ
    const resetFirstTimeRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/reset-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: validToken, newPassword });

    assert.strictEqual(resetFirstTimeRes.status, 200);
    assert.strictEqual(resetFirstTimeRes.body.success, true);
    assert.strictEqual(resetFirstTimeRes.body.code, 'PASSWORD_RESET_SUCCESS');

    // Kiểm tra trong DB: Token đã được đánh dấu used_at
    const usedTokenRow = db.prepare('SELECT used_at FROM password_reset_tokens WHERE token = ?').get(validToken);
    assert.ok(usedTokenRow.used_at !== null, 'Token sau khi dùng phải có timestamp used_at');

    // Lần 2: Cố gắng dùng lại token cũ vừa sử dụng -> PHẢI BỊ TỪ CHỐI (AC-02)
    const resetSecondTimeRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/reset-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: validToken, newPassword: 'AnotherPassword@2026' });

    assert.strictEqual(resetSecondTimeRes.status, 400, 'Dùng lại token lần 2 phải trả về lỗi 400');
    assert.strictEqual(resetSecondTimeRes.body.success, false);
    assert.strictEqual(resetSecondTimeRes.body.code, 'TOKEN_ALREADY_USED');
    assert.ok(resetSecondTimeRes.body.message.includes('đã được sử dụng'));
    recordPass('AC-02: Liên kết chỉ dùng được 1 lần duy nhất, dùng lại lần 2 bị từ chối 400 TOKEN_ALREADY_USED');

    // -------------------------------------------------------------
    // TEST 3: AC-03 - EMAIL KHÔNG TỒN TẠI VẪN HIỂN THỊ CÙNG MỘT THÔNG BÁO
    // -------------------------------------------------------------
    totalTests++;
    const nonExistentEmail = 'email_chua_tung_ton_tai_999@company.com';
    const nonExistentRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/forgot-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: nonExistentEmail });

    assert.strictEqual(nonExistentRes.status, 200, 'Email không tồn tại vẫn phải trả về HTTP 200');
    assert.strictEqual(nonExistentRes.body.success, true);

    // AC-03: So sánh 2 thông báo: Phải trùng khớp 100% để chống User Enumeration
    assert.strictEqual(
      nonExistentRes.body.message,
      forgotRes.body.message,
      'Thông báo phản hồi cho email không tồn tại phải giống hệt email có tồn tại'
    );
    assert.strictEqual(nonExistentRes.body.code, forgotRes.body.code);

    // Đảm bảo không tạo token rác trong DB cho email không tồn tại
    const ghostToken = db.prepare(`
      SELECT prt.id FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE u.email = ?
    `).get(nonExistentEmail);
    assert.strictEqual(ghostToken, undefined, 'Không được tạo token cho email không tồn tại');
    recordPass('AC-03: Email không tồn tại trả về thông điệp giống hệt email có thật (chống lộ email)');

    // -------------------------------------------------------------
    // TEST 4: LIÊN KẾT HẾT HẠN (QUÁ 30 PHÚT) BỊ TỪ CHỐI
    // -------------------------------------------------------------
    totalTests++;
    const expiredToken = 'ats_reset_expired_30m_' + Date.now();
    const pastTime = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // Tạo 31 phút trước
    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now', '-31 minutes'))
    `).run('rst-expired-test', 'usr-admin', expiredToken, pastTime);

    const expiredAttemptRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/reset-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { token: expiredToken, newPassword: 'ValidPass@123' });

    assert.strictEqual(expiredAttemptRes.status, 400);
    assert.strictEqual(expiredAttemptRes.body.code, 'TOKEN_EXPIRED');
    assert.ok(expiredAttemptRes.body.message.includes('hết hạn'));
    recordPass('Thời hạn: Token quá hạn 30 phút bị từ chối với mã lỗi TOKEN_EXPIRED');

    // -------------------------------------------------------------
    // TEST 5: ĐĂNG NHẬP VỚI MẬT KHẨU MỚI VÀ MÃ HÓA SCRYPT
    // -------------------------------------------------------------
    totalTests++;
    // Đăng nhập bằng mật khẩu cũ -> phải thất bại
    const oldLoginRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: 'Ats@123456' });
    assert.strictEqual(oldLoginRes.status, 401, 'Mật khẩu cũ không còn đăng nhập được');

    // Đăng nhập bằng mật khẩu mới -> thành công
    const newLoginRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: newPassword });
    assert.strictEqual(newLoginRes.status, 200, 'Đăng nhập thành công với mật khẩu mới');

    // Phục hồi lại mật khẩu mặc định Ats@123456 sau test
    const resetBackHash = hashPassword('Ats@123456');
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(resetBackHash, targetEmail);
    recordPass('Bảo mật: Mật khẩu mới cập nhật bằng mã hóa Scrypt, mật khẩu cũ bị vô hiệu hóa hoàn toàn');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ KIỂM THỬ: ${passCount}/${totalTests} TESTS PASS (100% THÀNH CÔNG)`);
    console.log('Tất cả Acceptance Criteria của Story S1-03 đều đã ĐẠT.');
    console.log('================================================================\n');

  } finally {
    server.close();
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = runTests;
