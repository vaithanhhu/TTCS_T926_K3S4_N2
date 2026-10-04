const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');

const TEST_PORT = 5098;

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
  console.log('TEST SUITE: USER STORY S1-02 (DUY TRÌ PHIÊN & ĐĂNG XUẤT AN TOÀN)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Phiên được gia hạn tự động khi còn hoạt động');
  console.log('  • AC-02: Đăng xuất làm mất hiệu lực phiên ngay lập tức phía server');
  console.log('  • AC-03: Phiên hết hạn đưa về trang đăng nhập kèm thông báo rõ ràng');
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
    // TEST 1: AC-01 - PHIÊN ĐƯỢC GIA HẠN TỰ ĐỘNG KHI CÒN HOẠT ĐỘNG
    // -------------------------------------------------------------
    totalTests++;
    // Đăng nhập lấy token
    const loginRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@company.com', password: 'Ats@123456' });

    assert.strictEqual(loginRes.status, 200);
    const token = loginRes.body.data.token;
    assert.ok(token);

    // Lấy hạn ban đầu trong DB
    const initialSession = db.prepare('SELECT expires_at, last_activity_at FROM sessions WHERE token = ?').get(token);
    assert.ok(initialSession, 'Session record must exist in DB');

    // Giả lập lùi thời gian hết hạn còn 2 phút nữa hết hạn
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(nearExpiry, token);

    // Người dùng thực hiện thao tác gọi protected endpoint (GET /api/v1/auth/me)
    const meRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.success, true);
    assert.strictEqual(meRes.body.code, 'SESSION_VALID');

    // Kiểm tra DB: Thời gian hết hạn đã được tự động gia hạn lên 30 phút tính từ thời điểm hoạt động
    const renewedSession = db.prepare('SELECT expires_at, last_activity_at FROM sessions WHERE token = ?').get(token);
    const renewedTime = new Date(renewedSession.expires_at).getTime();
    const now = Date.now();
    const diffMinutes = (renewedTime - now) / 60000;

    assert.ok(diffMinutes > 25 && diffMinutes <= 30.5, 'Session expires_at must be extended to ~30 minutes from now');
    recordPass('AC-01: Phiên được gia hạn tự động (Sliding Expiration) khi người dùng gửi request hoạt động');

    // -------------------------------------------------------------
    // TEST 2: AC-02 - ĐĂNG XUẤT LÀM MẤT HIỆU LỰC PHIÊN NGAY LẬP TỨC PHÍA SERVER
    // -------------------------------------------------------------
    totalTests++;
    // Đăng xuất qua endpoint POST /api/v1/auth/logout
    const logoutRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/logout',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.body.success, true);
    assert.strictEqual(logoutRes.body.code, 'LOGGED_OUT');

    // Kiểm tra DB: Bản ghi session trong bảng sessions phải bị XÓA HOÀN TOÀN
    const sessionInDbAfterLogout = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    assert.strictEqual(sessionInDbAfterLogout, undefined, 'Session must be permanently deleted from DB on logout');

    // Gọi lại protected endpoint với token cũ vừa đăng xuất -> phải bị từ chối 401
    const postLogoutCall = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(postLogoutCall.status, 401, 'Request with logged out token must return 401 Unauthorized');
    assert.strictEqual(postLogoutCall.body.code, 'INVALID_SESSION');
    recordPass('AC-02: Đăng xuất thu hồi phiên phía server ngay lập tức và chặn hoàn toàn các request sau đó');

    // -------------------------------------------------------------
    // TEST 3: AC-03 - PHIÊN HẾT HẠN TRẢ VỀ MÃ 401 VÀ THÔNG BÁO RÕ RÀNG
    // -------------------------------------------------------------
    totalTests++;
    // Tạo session hết hạn giả lập trong DB
    const expiredToken = 'ats_sess_expired_test_' + Date.now();
    const pastTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Hết hạn 5 phút trước
    db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at, last_activity_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('sess-expired-test', 'usr-admin', expiredToken, pastTime);

    // Gọi API với token đã hết hạn
    const expiredRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${expiredToken}` }
    });

    assert.strictEqual(expiredRes.status, 401);
    assert.strictEqual(expiredRes.body.success, false);
    assert.strictEqual(expiredRes.body.code, 'SESSION_EXPIRED');
    assert.strictEqual(expiredRes.body.message, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

    // Kiểm tra DB: Session hết hạn đã tự động bị dọn dẹp khỏi bảng sessions
    const purgedCheck = db.prepare('SELECT * FROM sessions WHERE token = ?').get(expiredToken);
    assert.strictEqual(purgedCheck, undefined, 'Expired session must be automatically cleaned up from DB');
    recordPass('AC-03: Phiên hết hạn trả về mã 401, thông báo rõ ràng "Phiên đăng nhập đã hết hạn" và dọn dẹp DB');

    // -------------------------------------------------------------
    // TEST 4: BẢO MẬT - YÊU CẦU THIẾU TOKEN TRẢ VỀ 401
    // -------------------------------------------------------------
    totalTests++;
    const noTokenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET'
    });

    assert.strictEqual(noTokenRes.status, 401);
    assert.strictEqual(noTokenRes.body.code, 'UNAUTHORIZED');
    recordPass('Bảo mật: Request không có Authorization header bị chặn 401 Unauthorized');

    // -------------------------------------------------------------
    // TEST 5: BẢO MẬT - TÀI KHOẢN BỊ KHÓA LÀM MẤT HIỆU LỰC PHIÊN ĐANG MỞ
    // -------------------------------------------------------------
    totalTests++;
    // Đăng nhập tài khoản hr-manager
    const hrLogin = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'hrmanager@company.com', password: 'Ats@123456' });

    const hrToken = hrLogin.body.data.token;

    // Giả lập tài khoản bị khóa trong DB
    db.prepare("UPDATE users SET status = 'LOCKED', lock_reason = 'Tạm khóa an ninh' WHERE email = 'hrmanager@company.com'").run();

    // Gọi API với token của tài khoản vừa bị khóa
    const lockedAccessRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${hrToken}` }
    });

    assert.strictEqual(lockedAccessRes.status, 403);
    assert.strictEqual(lockedAccessRes.body.code, 'ACCOUNT_LOCKED');

    // Phục hồi lại trạng thái active sau test
    db.prepare("UPDATE users SET status = 'ACTIVE', lock_reason = NULL WHERE email = 'hrmanager@company.com'").run();
    recordPass('Bảo mật: Tài khoản bị khóa lập tức làm mất hiệu lực phiên đang mở phía server (HTTP 403)');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ KIỂM THỬ: ${passCount}/${totalTests} TESTS PASS (100% THÀNH CÔNG)`);
    console.log('Tất cả Acceptance Criteria của Story S1-02 đều đã ĐẠT.');
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
