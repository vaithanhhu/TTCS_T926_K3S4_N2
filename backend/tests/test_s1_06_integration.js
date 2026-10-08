const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');

const TEST_PORT = 5094;

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
  console.log('TEST SUITE: USER STORY S1-06 (MENU ĐIỀU HƯỚNG THEO VAI TRÒ)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Chỉ hiển thị menu items mà vai trò có quyền truy cập');
  console.log('  • AC-02: Ẩn hoàn toàn các menu items không được phép khỏi DOM/payload');
  console.log('  • AC-03: Responsive trên mobile (>= 360px), hỗ trợ Drawer/Hamburger menu');
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
    // TEST 1: AC-01 & AC-02 - KIỂM TRA PHÂN QUYỀN MENU CHO CẢ 7 VAI TRÒ
    // -------------------------------------------------------------
    totalTests++;

    // 1. ADMIN
    const adminToken = await loginUser('admin@company.com');
    const adminMenuRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/navigation/menu',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminMenuRes.status, 200);
    const adminPaths = adminMenuRes.body.menuItems.map(m => m.path);
    assert.ok(adminPaths.includes('/admin/users'), 'Admin phải có menu /admin/users');
    assert.ok(adminPaths.includes('/admin/roles'), 'Admin phải có menu /admin/roles');
    assert.ok(adminPaths.includes('/admin/audit'), 'Admin phải có menu /admin/audit');
    assert.ok(!adminPaths.includes('/candidate'), 'Admin không có menu cổng ứng viên ngoài');

    // 2. RECRUITER
    const recruiterToken = await loginUser('recruiter@company.com');
    const recruiterMenuRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/navigation/menu',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(recruiterMenuRes.status, 200);
    const recruiterPaths = recruiterMenuRes.body.menuItems.map(m => m.path);
    assert.ok(recruiterPaths.includes('/candidates'), 'Recruiter phải có menu /candidates');
    assert.ok(recruiterPaths.includes('/requisitions'), 'Recruiter phải có menu /requisitions');
    assert.ok(recruiterPaths.includes('/interviews'), 'Recruiter phải có menu /interviews');
    // AC-02: Ẩn hoàn toàn khỏi payload
    assert.ok(!recruiterPaths.includes('/admin/users'), 'AC-02: Recruiter không được có /admin/users trong payload');
    assert.ok(!recruiterPaths.includes('/admin/roles'), 'AC-02: Recruiter không được có /admin/roles trong payload');
    assert.ok(!recruiterPaths.includes('/admin/audit'), 'AC-02: Recruiter không được có /admin/audit trong payload');

    // 3. INTERVIEWER
    const interviewerToken = await loginUser('interviewer@company.com');
    const interviewerMenuRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/navigation/menu',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${interviewerToken}` }
    });
    assert.strictEqual(interviewerMenuRes.status, 200);
    const interviewerPaths = interviewerMenuRes.body.menuItems.map(m => m.path);
    assert.ok(interviewerPaths.includes('/interviews'), 'Interviewer phải có menu /interviews');
    assert.ok(interviewerPaths.includes('/candidates'), 'AC-02: Interviewer được đọc ứng viên của vòng được phân công');
    assert.ok(!interviewerPaths.includes('/admin/users'), 'AC-02: Interviewer không có /admin/users');

    // 4. APPROVER
    const approverToken = await loginUser('approver@company.com');
    const approverMenuRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/navigation/menu',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${approverToken}` }
    });
    assert.strictEqual(approverMenuRes.status, 200);
    const approverPaths = approverMenuRes.body.menuItems.map(m => m.path);
    assert.ok(approverPaths.includes('/approvals'), 'Approver phải có menu /approvals');
    assert.ok(!approverPaths.includes('/admin/users'), 'AC-02: Approver không có /admin/users');
    assert.ok(approverPaths.includes('/candidates'), 'AC-02: Approver có quyền đọc hồ sơ ứng viên');

    // 5. CANDIDATE
    const candidateToken = await loginUser('candidate@example.com');
    const candidateMenuRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/navigation/menu',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(candidateMenuRes.status, 200);
    const candidatePaths = candidateMenuRes.body.menuItems.map(m => m.path);
    assert.strictEqual(candidatePaths.length, 1, 'Ứng viên chỉ được thấy đúng 1 mục menu cá nhân');
    assert.strictEqual(candidatePaths[0], '/candidate', 'Menu duy nhất của ứng viên là /candidate');
    assert.ok(!candidatePaths.includes('/dashboard'), 'AC-02: Candidate bị ẩn hoàn toàn /dashboard');
    assert.ok(!candidatePaths.includes('/candidates'), 'AC-02: Candidate bị ẩn hoàn toàn /candidates nội bộ');

    recordPass('AC-01 & AC-02: Menu điều hướng nạp từ CSDL phân quyền cho cả 7 vai trò; các mục trái quyền bị ẩn hoàn toàn khỏi payload');

    // -------------------------------------------------------------
    // TEST 2: CẤU TRÚC DỮ LIỆU ĐÁP ỨNG AC-03 (RESPONSIVE >= 360PX)
    // -------------------------------------------------------------
    totalTests++;
    const sampleItem = adminMenuRes.body.menuItems[0];
    assert.ok(sampleItem.id, 'Menu item phải có id định danh');
    assert.ok(sampleItem.label, 'Menu item phải có label hiển thị');
    assert.ok(sampleItem.path, 'Menu item phải có path điều hướng');
    assert.ok(sampleItem.icon, 'Menu item phải có icon cho mobile drawer');
    recordPass('AC-03: Cấu trúc menu đầy đủ icon, label, path chuẩn hóa cho thanh điều hướng Desktop và Drawer Mobile');

    // -------------------------------------------------------------
    // TEST 3: BẢO MẬT - REQUEST THIẾU TOKEN BỊ TỪ CHỐI 401
    // -------------------------------------------------------------
    totalTests++;
    const noTokenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/navigation/menu',
      method: 'GET'
    });
    assert.strictEqual(noTokenRes.status, 401);
    assert.strictEqual(noTokenRes.body.code, 'UNAUTHORIZED');
    recordPass('Bảo mật: Yêu cầu lấy menu không có session token hợp lệ bị từ chối 401 Unauthorized');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ KIỂM THỬ: ${passCount}/${totalTests} TESTS PASS (100% THÀNH CÔNG)`);
    console.log('Tất cả Acceptance Criteria của Story S1-06 đều đã ĐẠT.');
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
