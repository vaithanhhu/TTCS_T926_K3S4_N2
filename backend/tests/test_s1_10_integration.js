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

async function loginUser(email, password = 'Ats@123456') {
  const res = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email, password });

  return res;
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S1-10 (KHÓA VÀ MỞ KHÓA TÀI KHOẢN)');
  console.log('================================================================');

  const db = getDatabase();
  seedDatabase(db);

  await startServer(TEST_PORT);
  console.log(`[Test S1-10] Server started on port ${TEST_PORT}\n`);

  let passedTests = 0;

  try {
    // --------------------------------------------------------------------------
    // Test 1: AC-01 Khóa tài khoản thành công và kiểm tra cập nhật CSDL
    // --------------------------------------------------------------------------
    console.log('Test 1: AC-01 Khóa tài khoản thành công & cập nhật trạng thái trong CSDL');
    const adminLogin = await loginUser('admin@company.com');
    const adminToken = adminLogin.body.data.token;

    const lockReason = 'Nhân sự xin nghỉ việc theo quyết định số 88/QĐ-NS. Đình chỉ mọi quyền truy cập tuyển dụng.';
    const lockRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: lockReason });

    assert.strictEqual(lockRes.status, 200);
    assert.strictEqual(lockRes.body.success, true);
    assert.strictEqual(lockRes.body.code, 'ACCOUNT_LOCKED_SUCCESS');
    assert.strictEqual(lockRes.body.data.user.status, 'LOCKED');
    assert.strictEqual(lockRes.body.data.user.lockReason, lockReason);

    // Kiểm tra trực tiếp bảng SQLite users
    const dbUser = db.prepare('SELECT status, lock_reason FROM users WHERE id = ?').get('usr-dev-01');
    assert.strictEqual(dbUser.status, 'LOCKED');
    assert.strictEqual(dbUser.lock_reason, lockReason);
    console.log('   ✓ CSDL SQLite cập nhật chính xác status = LOCKED và lưu đúng lock_reason.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 2: AC-01 Tài khoản bị khóa không thể đăng nhập vào hệ thống
    // --------------------------------------------------------------------------
    console.log('\nTest 2: AC-01 Tài khoản bị khóa không đăng nhập được (HTTP 403)');
    const blockedLogin = await loginUser('dev1@company.com', 'Ats@123456');
    assert.strictEqual(blockedLogin.status, 403);
    assert.strictEqual(blockedLogin.body.success, false);
    assert.strictEqual(blockedLogin.body.code, 'ACCOUNT_PERMANENTLY_LOCKED');
    assert(blockedLogin.body.message.includes('Tài khoản của bạn đã bị khóa'));
    console.log('   ✓ Người dùng bị khóa đăng nhập thất bại với HTTP 403 ACCOUNT_PERMANENTLY_LOCKED.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 3: AC-01 Thu hồi ngay lập tức các phiên đăng nhập đang mở phía server
    // --------------------------------------------------------------------------
    console.log('\nTest 3: AC-01 Thu hồi ngay lập tức phiên đăng nhập đang mở (Active Session)');
    // Đăng nhập một tài khoản khác đang ACTIVE: usr-dev-02 (dev2@company.com)
    const activeLogin = await loginUser('dev2@company.com', 'Ats@123456');
    assert.strictEqual(activeLogin.status, 200);
    const dev2Token = activeLogin.body.data.token;

    // Xác nhận session đang hợp lệ trước khi khóa
    const preLockCheck = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${dev2Token}` }
    });
    assert.strictEqual(preLockCheck.status, 200, 'Session trước khi khóa phải hợp lệ');

    // Admin tiến hành khóa tài khoản usr-dev-02
    await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-02/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: 'Nghi ngờ rò rỉ dữ liệu, tạm khóa khẩn cấp.' });

    // Phiên làm việc dev2Token gửi request kế tiếp ngay lập tức
    const postLockCheck = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${dev2Token}` }
    });

    // Phải bị từ chối 403 ACCOUNT_LOCKED hoặc 401 INVALID_SESSION vì session đã bị thu hồi
    assert(postLockCheck.status === 403 || postLockCheck.status === 401);
    assert(postLockCheck.body.code === 'ACCOUNT_LOCKED' || postLockCheck.body.code === 'INVALID_SESSION');

    // Kiểm tra bảng sessions trong CSDL: token của usr-dev-02 không còn tồn tại
    const sessionCount = db.prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = ?').get('usr-dev-02').cnt;
    assert.strictEqual(sessionCount, 0, 'Toàn bộ phiên của người dùng bị khóa phải bị xóa khỏi bảng sessions');
    console.log('   ✓ Phiên đăng nhập đang mở bị thu hồi tức thời, request tiếp theo bị từ chối và xóa khỏi DB.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 4: AC-02 Bắt buộc ghi lý do khóa (Validation Error)
    // --------------------------------------------------------------------------
    console.log('\nTest 4: AC-02 Bắt buộc ghi lý do khóa tài khoản (HTTP 400)');
    // Thử khóa không truyền reason
    const emptyReasonRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-interviewer/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: '' });

    assert.strictEqual(emptyReasonRes.status, 400);
    assert.strictEqual(emptyReasonRes.body.code, 'MISSING_LOCK_REASON');

    // Thử khóa với reason quá ngắn
    const shortReasonRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-interviewer/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: 'abc' });

    assert.strictEqual(shortReasonRes.status, 400);
    assert.strictEqual(shortReasonRes.body.code, 'MISSING_LOCK_REASON');
    console.log('   ✓ Khóa tài khoản thiếu lý do bị từ chối ngay lập tức với HTTP 400 MISSING_LOCK_REASON.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 5: AC-03 Vị trí tuyển dụng do người đó phụ trách được cảnh báo cần bàn giao
    // --------------------------------------------------------------------------
    console.log('\nTest 5: AC-03 Vị trí tuyển dụng do người đó phụ trách được cảnh báo cần bàn giao');
    // usr-recruiter (Hoàng Thu Thảo) phụ trách REQ-2026-001 (OPEN) và REQ-2026-003 (IN_PROGRESS)
    const lockRecruiterRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-recruiter/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: 'Chuyển công tác sang chi nhánh khác, bàn giao toàn bộ pipeline tuyển dụng.' });

    assert.strictEqual(lockRecruiterRes.status, 200);
    assert.strictEqual(lockRecruiterRes.body.data.handoverRequired, true);
    assert.strictEqual(lockRecruiterRes.body.data.handoverCount, 2);
    assert(lockRecruiterRes.body.message.includes('CẢNH BÁO BÀN GIAO'));

    const reqCodes = lockRecruiterRes.body.data.handoverRequisitions.map(r => r.code);
    assert(reqCodes.includes('REQ-2026-001'));
    assert(reqCodes.includes('REQ-2026-003'));

    // Kiểm tra CSDL SQLite bảng requisitions xem handover_required đã được bật thành 1
    const dbReqs = db.prepare(`
      SELECT code, handover_required, handover_notes
      FROM requisitions
      WHERE recruiter_id = ?
    `).all('usr-recruiter');

    assert.strictEqual(dbReqs.length, 2);
    for (const r of dbReqs) {
      assert.strictEqual(r.handover_required, 1);
      assert(r.handover_notes.includes('Cần bàn giao vị trí'));
    }
    console.log(`   ✓ Hệ thống phát hiện ${dbReqs.length} vị trí tuyển dụng phụ trách và cập nhật handover_required = 1 trong CSDL.`);
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 6: Chống tự khóa tài khoản quản trị của chính mình
    // --------------------------------------------------------------------------
    console.log('\nTest 6: Chống tự khóa tài khoản của chính mình (Self-Lock Prevention)');
    const selfLockRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-admin/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: 'Thử tự khóa tài khoản admin của mình.' });

    assert.strictEqual(selfLockRes.status, 400);
    assert.strictEqual(selfLockRes.body.code, 'CANNOT_LOCK_OWN_ACCOUNT');

    const adminStatus = db.prepare('SELECT status FROM users WHERE id = ?').get('usr-admin').status;
    assert.strictEqual(adminStatus, 'ACTIVE', 'Admin phải luôn giữ trạng thái ACTIVE');
    console.log('   ✓ Hệ thống từ chối HTTP 400 CANNOT_LOCK_OWN_ACCOUNT khi Admin cố tự khóa chính mình.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 7: Mở khóa tài khoản thành công & đăng nhập lại bình thường
    // --------------------------------------------------------------------------
    console.log('\nTest 7: Mở khóa tài khoản thành công & người dùng đăng nhập lại bình thường');
    const unlockRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/unlock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });

    assert.strictEqual(unlockRes.status, 200);
    assert.strictEqual(unlockRes.body.code, 'ACCOUNT_UNLOCKED_SUCCESS');
    assert.strictEqual(unlockRes.body.data.user.status, 'ACTIVE');
    assert.strictEqual(unlockRes.body.data.user.lockReason, null);

    // Người dùng đăng nhập lại thành công
    const reloginRes = await loginUser('dev1@company.com', 'Ats@123456');
    assert.strictEqual(reloginRes.status, 200);
    assert.strictEqual(reloginRes.body.data.user.email, 'dev1@company.com');
    console.log('   ✓ Mở khóa thành công, tài khoản dev1@company.com đăng nhập lại bình thường.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 8: RBAC Default Deny cho quyền account.lock và account.unlock
    // --------------------------------------------------------------------------
    console.log('\nTest 8: RBAC Default Deny - Chỉ Admin có quyền account.lock & account.unlock');
    const interviewerLogin = await loginUser('interviewer@company.com', 'Ats@123456');
    const interviewerToken = interviewerLogin.body.data.token;

    // Interviewer cố khóa tài khoản khác
    const forbiddenLock = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/lock',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${interviewerToken}`,
        'Content-Type': 'application/json'
      }
    }, { reason: 'Interviewer cố tình khóa nhân sự khác' });

    assert.strictEqual(forbiddenLock.status, 403);
    assert.strictEqual(forbiddenLock.body.code, 'FORBIDDEN_PERMISSION_DENIED');

    // Yêu cầu không có token -> 401
    const unauthLock = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/lock',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { reason: 'Không có token' });
    assert.strictEqual(unauthLock.status, 401);
    console.log('   ✓ Default Deny chặn Interviewer (HTTP 403) và yêu cầu thiếu token (HTTP 401) thành công.');
    passedTests++;

    console.log('\n================================================================');
    console.log(`KẾT QUẢ TEST S1-10: TẤT CẢ ${passedTests}/8 TESTS ĐÃ PASS 100%!`);
    console.log('================================================================');
  } finally {
    seedDatabase(db);
    server.close();
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test suite S1-10 failed with error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
