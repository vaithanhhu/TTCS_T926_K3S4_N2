const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, server } = require('../src/server');

const TEST_PORT = 5095;

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

  assert.strictEqual(res.status, 200, `Login failed for ${email}`);
  return res.body.data.token;
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S1-07 (TRANG LỖI 401, 403, 404 & RECOVERY)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Chuẩn hóa thông điệp và mã lỗi cho 401, 403, 404');
  console.log('  • AC-02: Giữ nguyên bố cục ứng dụng, không làm đứt gãy trải nghiệm');
  console.log('  • AC-03: Cung cấp hành động phục hồi (Recovery Actions: LOGIN, NAVIGATE_HOME)');
  console.log('================================================================\n');

  await startServer(TEST_PORT);

  let passCount = 0;
  let totalTests = 0;

  function recordPass(testName) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: AC-01 & AC-03 - LỖI 401 UNAUTHORIZED / SESSION EXPIRED
    // -------------------------------------------------------------
    totalTests++;
    console.log('[TEST 1] Kiểm tra mã lỗi 401 và recovery action "LOGIN"...');

    // 1.1 Yêu cầu API bảo vệ không có token
    const noTokenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST'
    });
    assert.strictEqual(noTokenRes.status, 401, 'Yêu cầu không token phải trả về 401');
    assert.strictEqual(noTokenRes.body.success, false);
    assert.strictEqual(noTokenRes.body.statusCode, 401);
    assert.strictEqual(noTokenRes.body.code, 'UNAUTHORIZED');
    assert.ok(noTokenRes.body.message.length > 0, 'Phải có thông báo lỗi rõ ràng');
    assert.ok(noTokenRes.body.recovery, 'Phải có metadata recovery');
    assert.strictEqual(noTokenRes.body.recovery.action, 'LOGIN', 'Action phải là LOGIN');
    assert.strictEqual(noTokenRes.body.recovery.suggestedPath, '/login');

    // 1.2 Yêu cầu API bảo vệ với token giả/hết hạn
    const invalidTokenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': 'Bearer token_khong_ton_tai_hoac_da_het_han' }
    });
    assert.strictEqual(invalidTokenRes.status, 401, 'Token giả phải trả về 401');
    assert.strictEqual(invalidTokenRes.body.statusCode, 401);
    assert.strictEqual(invalidTokenRes.body.recovery.action, 'LOGIN');

    recordPass('TEST 1: Chuẩn hóa mã lỗi 401 (UNAUTHORIZED) kèm recovery action LOGIN thành công');

    // -------------------------------------------------------------
    // TEST 2: AC-01 & AC-03 - LỖI 403 FORBIDDEN PERMISSION DENIED
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 2] Kiểm tra mã lỗi 403 và recovery action "NAVIGATE_HOME"...');

    // 2.1 Recruiter truy cập route admin (cần user.create)
    const recruiterToken = await loginUser('recruiter@company.com');
    const forbiddenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(forbiddenRes.status, 403, 'Recruiter tạo user phải bị từ chối 403');
    assert.strictEqual(forbiddenRes.body.success, false);
    assert.strictEqual(forbiddenRes.body.statusCode, 403);
    assert.strictEqual(forbiddenRes.body.code, 'FORBIDDEN_PERMISSION_DENIED');
    assert.strictEqual(forbiddenRes.body.requiredPermission, 'user.create');
    assert.ok(forbiddenRes.body.userRoles.includes('RECRUITER'));
    assert.ok(forbiddenRes.body.recovery, 'Phải có metadata recovery');
    assert.strictEqual(forbiddenRes.body.recovery.action, 'NAVIGATE_HOME');
    assert.strictEqual(forbiddenRes.body.recovery.suggestedPath, '/recruitment', 'suggestedPath phải là defaultHome của Recruiter (/recruitment)');

    // 2.2 Candidate truy cập danh sách ứng viên nội bộ (cần candidate.read)
    const candidateToken = await loginUser('candidate@example.com');
    const candidateForbiddenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/recruitment/candidates/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(candidateForbiddenRes.status, 403, 'Candidate xem pipeline phải bị từ chối 403');
    assert.strictEqual(candidateForbiddenRes.body.code, 'FORBIDDEN_PERMISSION_DENIED');
    assert.strictEqual(candidateForbiddenRes.body.requiredPermission, 'candidate.read');
    assert.strictEqual(candidateForbiddenRes.body.recovery.action, 'NAVIGATE_HOME');
    assert.strictEqual(candidateForbiddenRes.body.recovery.suggestedPath, '/candidate', 'suggestedPath phải là defaultHome của Candidate (/candidate)');

    recordPass('TEST 2: Chuẩn hóa mã lỗi 403 (FORBIDDEN_PERMISSION_DENIED) kèm recovery action NAVIGATE_HOME theo vai trò thành công');

    // -------------------------------------------------------------
    // TEST 3: AC-01 & AC-03 - LỖI 404 NOT FOUND CHO TÀI NGUYÊN KHÔNG TỒN TẠI
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 3] Kiểm tra mã lỗi 404 cho API route không tồn tại...');

    const notFoundRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/recruitment/non-existent-endpoint-demo',
      method: 'GET'
    });
    assert.strictEqual(notFoundRes.status, 404, 'Route không tồn tại phải trả về 404');
    assert.strictEqual(notFoundRes.body.success, false);
    assert.strictEqual(notFoundRes.body.statusCode, 404);
    assert.strictEqual(notFoundRes.body.code, 'NOT_FOUND');
    assert.strictEqual(notFoundRes.body.requestedPath, '/api/v1/recruitment/non-existent-endpoint-demo');
    assert.ok(notFoundRes.body.recovery, 'Phải có metadata recovery');
    assert.strictEqual(notFoundRes.body.recovery.action, 'NAVIGATE_HOME');
    assert.strictEqual(notFoundRes.body.recovery.suggestedPath, '/dashboard');

    recordPass('TEST 3: Chuẩn hóa mã lỗi 404 (NOT_FOUND) kèm recovery action NAVIGATE_HOME thành công');

    // -------------------------------------------------------------
    // TEST 4: AC-02 - KIỂM TRA BỐ CỤC ỨNG DỤNG & ERROR VIEW TRONG FRONTEND
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 4] Kiểm tra cấu trúc layout và Error View trong frontend HTML & JS...');

    const htmlPath = path.join(__dirname, '../../frontend/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Xác nhận container error-view nằm trong app-layout chuẩn
    assert.ok(htmlContent.includes('id="error-view"'), 'Frontend phải có #error-view container');
    assert.ok(htmlContent.includes('id="error-code-display"'), 'Phải có #error-code-display');
    assert.ok(htmlContent.includes('id="error-heading-display"'), 'Phải có #error-heading-display');
    assert.ok(htmlContent.includes('id="error-message-display"'), 'Phải có #error-message-display');
    assert.ok(htmlContent.includes('id="error-code-raw"'), 'Phải có #error-code-raw');
    assert.ok(htmlContent.includes('id="error-primary-btn"'), 'Phải có #error-primary-btn cho recovery action');
    assert.ok(htmlContent.includes('id="error-secondary-btn"'), 'Phải có #error-secondary-btn cho quay lại');

    // Xác nhận header branding giữ nguyên
    assert.ok(htmlContent.includes('INTERNAL ATS'), 'Header branding phải giữ nguyên');

    // Xác nhận logic app.js hỗ trợ showErrorView và recovery
    const jsPath = path.join(__dirname, '../../frontend/js/app.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert.ok(jsContent.includes('function showErrorView'), 'app.js phải có hàm showErrorView');
    assert.ok(jsContent.includes('errorPrimaryBtn'), 'app.js phải có event listener cho errorPrimaryBtn');
    assert.ok(jsContent.includes('errorSecondaryBtn'), 'app.js phải có event listener cho errorSecondaryBtn');
    assert.ok(jsContent.includes('performLogout'), 'Phục hồi 401 phải hỗ trợ performLogout');

    recordPass('TEST 4: Bố cục giao diện, header branding và các thành phần error view frontend đảm bảo AC-02 & AC-03');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ TEST S1-07: ${passCount}/${totalTests} TESTS PASS (100%)`);
    console.log('================================================================\n');

    process.exitCode = 0;
  } catch (err) {
    console.error('\n[FAIL] Kiểm thử S1-07 thất bại:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTests();
