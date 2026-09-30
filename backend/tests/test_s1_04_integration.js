const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const { hashPassword } = require('../src/utils/password');

const TEST_PORT = 5096;

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
  console.log('TEST SUITE: USER STORY S1-04 (ĐỔI MẬT KHẨU TRONG PHIÊN ĐĂNG NHẬP)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Bắt buộc nhập mật khẩu hiện tại');
  console.log('  • AC-02: Mật khẩu mới tối thiểu 8 ký tự, có chữ và số');
  console.log('  • AC-03: Đổi xong thu hồi các phiên đăng nhập khác');
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
    const targetEmail = 'hiringmgr@company.com';

    // Đăng nhập phiên chính (Session A)
    const loginA = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: 'Ats@123456' });

    assert.strictEqual(loginA.status, 200);
    const tokenA = loginA.body.data.token;

    // -------------------------------------------------------------
    // TEST 1: AC-01 - BẮT BUỘC NHẬP MẬT KHẨU HIỆN TẠI
    // -------------------------------------------------------------
    totalTests++;
    // 1A: Không truyền mật khẩu hiện tại
    const missingCurrentRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { newPassword: 'NewSecurePass@2026' });

    assert.strictEqual(missingCurrentRes.status, 400);
    assert.strictEqual(missingCurrentRes.body.code, 'MISSING_CURRENT_PASSWORD');

    // 1B: Truyền sai mật khẩu hiện tại
    const wrongCurrentRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { currentPassword: 'SaiMatKhauHienTai', newPassword: 'NewSecurePass@2026' });

    assert.strictEqual(wrongCurrentRes.status, 400);
    assert.strictEqual(wrongCurrentRes.body.code, 'INVALID_CURRENT_PASSWORD');
    assert.strictEqual(wrongCurrentRes.body.message, 'Mật khẩu hiện tại không chính xác.');
    recordPass('AC-01: Bắt buộc nhập mật khẩu hiện tại; thiếu hoặc sai đều bị từ chối HTTP 400');

    // -------------------------------------------------------------
    // TEST 2: AC-02 - MẬT KHẨU MỚI TỐI THIỂU 8 KÝ TỰ, CÓ CẢ CHỮ VÀ SỐ
    // -------------------------------------------------------------
    totalTests++;
    // 2A: Ngắn hơn 8 ký tự (7 ký tự)
    const shortPassRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { currentPassword: 'Ats@123456', newPassword: 'Abc1234' });

    assert.strictEqual(shortPassRes.status, 400);
    assert.strictEqual(shortPassRes.body.code, 'WEAK_PASSWORD');

    // 2B: Chỉ toàn chữ cái, không có số
    const onlyLettersRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { currentPassword: 'Ats@123456', newPassword: 'OnlyLettersPassword' });

    assert.strictEqual(onlyLettersRes.status, 400);
    assert.strictEqual(onlyLettersRes.body.code, 'WEAK_PASSWORD');

    // 2C: Chỉ toàn chữ số, không có chữ cái
    const onlyNumbersRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { currentPassword: 'Ats@123456', newPassword: '1234567890' });

    assert.strictEqual(onlyNumbersRes.status, 400);
    assert.strictEqual(onlyNumbersRes.body.code, 'WEAK_PASSWORD');

    // 2D: Trùng với mật khẩu hiện tại
    const samePassRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { currentPassword: 'Ats@123456', newPassword: 'Ats@123456' });

    assert.strictEqual(samePassRes.status, 400);
    assert.strictEqual(samePassRes.body.code, 'SAME_PASSWORD');
    recordPass('AC-02: Kiểm tra nghiêm ngặt mật khẩu mới tối thiểu 8 ký tự, có cả chữ và số, không trùng pass cũ');

    // -------------------------------------------------------------
    // TEST 3: AC-03 - ĐỔI XONG THU HỒI CÁC PHIÊN ĐĂNG NHẬP KHÁC
    // -------------------------------------------------------------
    totalTests++;
    // Tạo thêm 2 phiên khác cho cùng user (Session B và Session C)
    const loginB = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: 'Ats@123456' });
    const tokenB = loginB.body.data.token;

    const loginC = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: 'Ats@123456' });
    const tokenC = loginC.body.data.token;

    // Kiểm tra trong DB hiện có 3 phiên hoạt động
    const activeSessionsBefore = db.prepare(`
      SELECT count(*) AS total FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE u.email = ?
    `).get(targetEmail).total;
    assert.ok(activeSessionsBefore >= 3, 'Phải có ít nhất 3 phiên đăng nhập');

    // Thực hiện đổi mật khẩu từ Session A
    const validNewPassword = 'HiringMgr@Updated2026';
    const changeSuccessRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, { currentPassword: 'Ats@123456', newPassword: validNewPassword });

    assert.strictEqual(changeSuccessRes.status, 200);
    assert.strictEqual(changeSuccessRes.body.success, true);
    assert.strictEqual(changeSuccessRes.body.code, 'PASSWORD_CHANGED_SUCCESS');

    // Kiểm tra trong DB: Các phiên B và C phải bị XÓA KHỎI BẢNG SESSIONS (AC-03)
    const checkB = db.prepare('SELECT * FROM sessions WHERE token = ?').get(tokenB);
    const checkC = db.prepare('SELECT * FROM sessions WHERE token = ?').get(tokenC);
    assert.strictEqual(checkB, undefined, 'Session B phải bị thu hồi hoàn toàn khỏi DB');
    assert.strictEqual(checkC, undefined, 'Session C phải bị thu hồi hoàn toàn khỏi DB');

    // Gọi API từ Session B -> phải bị từ chối 401
    const callB = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(callB.status, 401, 'Phiên B đã bị thu hồi nên không thể gọi API');

    // Session A (phiên đang thao tác) vẫn tiếp tục làm việc bình thường
    const callA = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.strictEqual(callA.status, 200, 'Phiên hiện tại vẫn hoạt động bình thường');
    recordPass('AC-03: Đổi xong thu hồi ngay lập tức toàn bộ các phiên khác, phiên hiện tại được duy trì');

    // -------------------------------------------------------------
    // TEST 4: BẢO MẬT - ĐĂNG NHẬP BẰNG MẬT KHẨU MỚI
    // -------------------------------------------------------------
    totalTests++;
    // Thử đăng nhập bằng mật khẩu cũ -> Thất bại
    const oldLoginFail = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: 'Ats@123456' });
    assert.strictEqual(oldLoginFail.status, 401, 'Mật khẩu cũ không thể đăng nhập');

    // Đăng nhập bằng mật khẩu mới -> Thành công
    const newLoginOk = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: validNewPassword });
    assert.strictEqual(newLoginOk.status, 200, 'Đăng nhập thành công với mật khẩu mới');

    // Phục hồi lại mật khẩu mặc định Ats@123456 để bảo toàn dữ liệu cho các test sau
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword('Ats@123456'), targetEmail);
    recordPass('Bảo mật: Mật khẩu mới có hiệu lực ngay lập tức, mật khẩu cũ bị loại bỏ');

    // -------------------------------------------------------------
    // TEST 5: BẢO MẬT - YÊU CẦU ĐỔI PASS KHÔNG CÓ TOKEN BỊ CHẶN 401
    // -------------------------------------------------------------
    totalTests++;
    const noTokenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { currentPassword: 'Ats@123456', newPassword: 'SomePassword123' });
    assert.strictEqual(noTokenRes.status, 401);
    recordPass('Bảo mật: Yêu cầu đổi mật khẩu thiếu token xác thực bị từ chối 401');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ KIỂM THỬ: ${passCount}/${totalTests} TESTS PASS (100% THÀNH CÔNG)`);
    console.log('Tất cả Acceptance Criteria của Story S1-04 đều đã ĐẠT.');
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
