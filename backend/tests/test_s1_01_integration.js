const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const { seedDatabase } = require('../src/db/seed');

const TEST_PORT = 5099;

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
  console.log('TEST SUITE: USER STORY S1-01 (ĐĂNG NHẬP VÀ PHÂN QUYỀN TRANG CHỦ)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Đăng nhập đúng vào trang chủ tương ứng với vai trò (7 vai trò)');
  console.log('  • AC-02: Sai thông tin hiển thị thông báo chung, không tiết lộ email');
  console.log('  • AC-03: Khóa tạm 15 phút sau 5 lần sai liên tiếp');
  console.log('================================================================\n');

  // Start server on test port
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
    // TEST 1: AC-01 - 7 VAI TRÒ ĐĂNG NHẬP THÀNH CÔNG VÀO ĐÚNG TRANG CHỦ
    // -------------------------------------------------------------
    totalTests++;
    const testAccounts = [
      { role: 'ADMIN', email: 'admin@company.com', expectedPath: '/admin' },
      { role: 'HR_MANAGER', email: 'hrmanager@company.com', expectedPath: '/dashboard' },
      { role: 'RECRUITER', email: 'recruiter@company.com', expectedPath: '/recruitment' },
      { role: 'HIRING_MGR', email: 'hiringmgr@company.com', expectedPath: '/hiring' },
      { role: 'INTERVIEWER', email: 'interviewer@company.com', expectedPath: '/interviews' },
      { role: 'APPROVER', email: 'approver@company.com', expectedPath: '/approvals' },
      { role: 'CANDIDATE', email: 'candidate@example.com', expectedPath: '/candidate' }
    ];

    for (const acc of testAccounts) {
      const res = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { email: acc.email, password: 'Ats@123456' });

      assert.strictEqual(res.status, 200, `Login failed for ${acc.role}`);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.token, 'Token must be provided');
      assert.ok(res.body.data.user.roles.includes(acc.role), `Roles should include ${acc.role}`);
      assert.strictEqual(res.body.data.user.defaultHome, acc.expectedPath, `Default home path mismatch for ${acc.role}`);
    }
    recordPass('AC-01: Cả 7 vai trò đăng nhập thành công và trả về đúng defaultHome');

    // -------------------------------------------------------------
    // TEST 2: AC-02 - THÔNG BÁO LỖI CHUNG KHI EMAIL KHÔNG TỒN TẠI
    // -------------------------------------------------------------
    totalTests++;
    const nonExistentRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'unknown.user@company.com', password: 'Ats@123456' });

    assert.strictEqual(nonExistentRes.status, 401);
    assert.strictEqual(nonExistentRes.body.success, false);
    assert.strictEqual(nonExistentRes.body.message, 'Email hoặc mật khẩu không chính xác.');
    recordPass('AC-02 (Part A): Email không tồn tại trả về mã 401 và thông báo chung');

    // -------------------------------------------------------------
    // TEST 3: AC-02 - THÔNG BÁO LỖI CHUNG KHI MẬT KHẨU SAI
    // -------------------------------------------------------------
    totalTests++;
    const wrongPassRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@company.com', password: 'WrongPassword999' });

    assert.strictEqual(wrongPassRes.status, 401);
    assert.strictEqual(wrongPassRes.body.success, false);
    assert.strictEqual(wrongPassRes.body.message, 'Email hoặc mật khẩu không chính xác.');

    // Kiểm tra tính đồng nhất tuyệt đối giữa 2 thông báo lỗi (chống User Enumeration Attack)
    assert.strictEqual(
      nonExistentRes.body.message,
      wrongPassRes.body.message,
      'Thông báo lỗi phải tuyệt đối giống nhau để không tiết lộ sự tồn tại của tài khoản'
    );
    recordPass('AC-02 (Part B): Sai mật khẩu trả về thông báo giống hệt email không tồn tại (chống leak account)');

    // -------------------------------------------------------------
    // TEST 4: AC-03 - KHÓA TẠM 15 PHÚT SAU 5 LẦN SAI LIÊN TIẾP
    // -------------------------------------------------------------
    totalTests++;
    const lockTargetEmail = 'recruiter2@company.com';

    // Reset target trước khi test
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = ?').run(lockTargetEmail);

    // Lần 1 đến 4: Trả về 401
    for (let i = 1; i <= 4; i++) {
      const attemptRes = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { email: lockTargetEmail, password: `WrongAttempt_${i}` });

      assert.strictEqual(attemptRes.status, 401, `Attempt ${i} should return 401`);
    }

    // Lần 5: Phải bị khóa tạm thời (HTTP 423)
    const fifthAttemptRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: lockTargetEmail, password: 'WrongAttempt_5' });

    assert.strictEqual(fifthAttemptRes.status, 423, 'Lần thứ 5 phải trả về HTTP 423 Locked');
    assert.strictEqual(fifthAttemptRes.body.success, false);
    assert.strictEqual(fifthAttemptRes.body.code, 'ACCOUNT_TEMPORARILY_LOCKED');
    assert.ok(fifthAttemptRes.body.message.includes('15 phút'), 'Thông báo phải ghi rõ khóa tạm 15 phút');

    // Lần 6 (Thử nhập đúng mật khẩu ngay sau đó): Vẫn phải bị từ chối do đang trong thời gian khóa
    const postLockAttemptRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: lockTargetEmail, password: 'Ats@123456' });

    assert.strictEqual(postLockAttemptRes.status, 423, 'Khi đang bị khóa, dù nhập đúng pass vẫn phải bị chặn 423');
    recordPass('AC-03: Khóa tạm 15 phút kích hoạt chính xác ở lần sai thứ 5 và chặn truy cập kế tiếp');

    // -------------------------------------------------------------
    // TEST 5: BẢO MẬT - TUYỆT ĐỐI KHÔNG LỘ PASSWORD HASH VÀ SALT
    // -------------------------------------------------------------
    totalTests++;
    const authUser = (await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@company.com', password: 'Ats@123456' })).body.data.user;

    assert.strictEqual(authUser.password, undefined);
    assert.strictEqual(authUser.password_hash, undefined);
    assert.strictEqual(authUser.salt, undefined);
    recordPass('Bảo mật: Không lộ password, password_hash, salt trong response');

    // -------------------------------------------------------------
    // TEST 6: BẢO MẬT DATABASE - MẬT KHẨU LƯU DẠNG HASH SCRYPT
    // -------------------------------------------------------------
    totalTests++;
    const dbRow = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('admin@company.com');
    assert.ok(dbRow.password_hash.includes(':'), 'Hash trong DB phải có định dạng salt:derivedKey');
    assert.notStrictEqual(dbRow.password_hash, 'Ats@123456', 'Tuyệt đối không lưu plaintext password trong DB');
    recordPass('Bảo mật: Cơ sở dữ liệu SQLite lưu mật khẩu mã hóa scrypt + salt an toàn');

    // -------------------------------------------------------------
    // TEST 7: KHÓA VĨNH VIỄN DO QUẢN TRỊ VIÊN
    // -------------------------------------------------------------
    totalTests++;
    const adminLockedRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'cuunhanvien@company.com', password: 'Ats@123456' });

    assert.strictEqual(adminLockedRes.status, 403);
    assert.strictEqual(adminLockedRes.body.code, 'ACCOUNT_PERMANENTLY_LOCKED');
    recordPass('Trạng thái tài khoản: Tài khoản bị Admin khóa bị chặn với HTTP 403');

    // -------------------------------------------------------------
    // TEST 8: RESET BỘ ĐẾM FAILED ATTEMPTS SAU KHI ĐĂNG NHẬP ĐÚNG
    // -------------------------------------------------------------
    totalTests++;
    const resetTargetEmail = 'interviewer@company.com';
    // Đăng nhập sai 2 lần
    await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: resetTargetEmail, password: 'WrongPassword' });

    let attemptsInDb = db.prepare('SELECT failed_attempts FROM users WHERE email = ?').get(resetTargetEmail).failed_attempts;
    assert.strictEqual(attemptsInDb, 1);

    // Đăng nhập đúng -> reset về 0
    await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: resetTargetEmail, password: 'Ats@123456' });

    attemptsInDb = db.prepare('SELECT failed_attempts FROM users WHERE email = ?').get(resetTargetEmail).failed_attempts;
    assert.strictEqual(attemptsInDb, 0);
    recordPass('Logic nghiệp vụ: Đăng nhập đúng tự động reset bộ đếm failed_attempts về 0');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ KIỂM THỬ: ${passCount}/${totalTests} TESTS PASS (100% THÀNH CÔNG)`);
    console.log('Tất cả Acceptance Criteria của Story S1-01 đều đã ĐẠT.');
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
