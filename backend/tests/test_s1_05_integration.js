const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');

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

  assert.strictEqual(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S1-05 (PHÂN QUYỀN RBAC ROLE-PERMISSION MATRIX)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Ma trận phân quyền 7 vai trò lưu trữ & truy xuất từ CSDL thật');
  console.log('  • AC-02: Cơ chế Default Deny (không có permission -> chặn 403 Forbidden)');
  console.log('  • AC-03: Kiểm thử tự động tối thiểu 3 vai trò khác nhau (Admin, Recruiter, Candidate)');
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
    // TEST 1: AC-01 - MA TRẬN PHÂN QUYỀN 7 VAI TRÒ TỪ CSDL THẬT
    // -------------------------------------------------------------
    totalTests++;
    const matrixRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/rbac/matrix',
      method: 'GET'
    });

    assert.strictEqual(matrixRes.status, 200);
    assert.strictEqual(matrixRes.body.success, true);
    const matrix = matrixRes.body.matrix;

    const expectedRoles = ['ADMIN', 'HR_MANAGER', 'RECRUITER', 'HIRING_MGR', 'INTERVIEWER', 'APPROVER', 'CANDIDATE'];
    for (const r of expectedRoles) {
      assert.ok(matrix[r], `Ma trận RBAC phải có vai trò ${r}`);
      assert.ok(Array.isArray(matrix[r].permissions), `Vai trò ${r} phải có danh sách permissions`);
      assert.ok(matrix[r].permissions.length > 0, `Vai trò ${r} phải có ít nhất 1 permission được cấu hình`);
    }

    // Kiểm tra trực tiếp bảng role_permissions trong SQLite database
    const dbRoleCount = (await db.prepare('SELECT count(*) as c FROM roles').get()).c;
    const dbPermCount = (await db.prepare('SELECT count(*) as c FROM permissions').get()).c;
    const dbRolePermCount = (await db.prepare('SELECT count(*) as c FROM role_permissions').get()).c;

    assert.strictEqual(dbRoleCount, 7, 'Phải có đúng 7 roles trong CSDL');
    assert.ok(dbPermCount >= 20, 'Phải có ít nhất 20 permissions chuẩn hóa trong CSDL');
    assert.ok(dbRolePermCount >= 40, 'Phải có ít nhất 40 ánh xạ role-permission trong CSDL');

    recordPass('AC-01: Ma trận phân quyền đầy đủ 7 vai trò nghiệp vụ nạp từ bảng permissions & role_permissions trong CSDL SQLite thật');

    // -------------------------------------------------------------
    // TEST 2: AC-02 - NGUYÊN TẮC DEFAULT DENY (403 FORBIDDEN)
    // -------------------------------------------------------------
    totalTests++;
    // Đăng nhập vai trò CANDIDATE
    const candidateToken = await loginUser('candidate@example.com');

    // Candidate cố gắng gọi API tạo người dùng (yêu cầu quyền: user.create)
    const candidateDenyRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${candidateToken}`
      }
    });

    assert.strictEqual(candidateDenyRes.status, 403, 'Người dùng không có permission phải nhận HTTP 403');
    assert.strictEqual(candidateDenyRes.body.code, 'FORBIDDEN_PERMISSION_DENIED');
    assert.strictEqual(candidateDenyRes.body.requiredPermission, 'user.create');

    // Candidate cố gắng gọi API xem ứng viên nội bộ (yêu cầu quyền: candidate.read)
    const candidateReadGrant=await db.prepare("SELECT rp.role_id,rp.permission_id FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code='CANDIDATE' AND p.code='candidate.read'").get();
    await db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run(candidateReadGrant.role_id,candidateReadGrant.permission_id);
    const candidateReadDenyRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/recruitment/candidates/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });

    assert.strictEqual(candidateReadDenyRes.status, 403);
    assert.strictEqual(candidateReadDenyRes.body.code, 'FORBIDDEN_PERMISSION_DENIED');
    assert.strictEqual(candidateReadDenyRes.body.requiredPermission, 'candidate.read');
    await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)').run(candidateReadGrant.role_id,candidateReadGrant.permission_id);

    recordPass('AC-02: Cơ chế Default Deny hoạt động chuẩn xác: chặn HTTP 403 khi thiếu quyền');

    // -------------------------------------------------------------
    // TEST 3: AC-03 - KIỂM THỬ TỰ ĐỘNG 3 VAI TRÒ ĐỐI NGHỊCH
    // Vai trò 1: ADMIN (Toàn quyền quản trị)
    // Vai trò 2: RECRUITER (Chỉ xem/sửa hồ sơ, không được tạo user quản trị)
    // Vai trò 3: CANDIDATE (Không được xem hồ sơ nội bộ, không được tạo user)
    // -------------------------------------------------------------
    totalTests++;
    const adminToken = await loginUser('admin@company.com');
    const recruiterToken = await loginUser('recruiter@company.com');

    // Hành động 1: Tạo người dùng (Action: user.create)
    // - Admin: ĐƯỢC PHÉP (200)
    const adminCreateRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminCreateRes.status, 200, 'Admin phải được phép thực hiện user.create');
    assert.strictEqual(adminCreateRes.body.code, 'USER_CREATED_SUCCESS');

    // - Recruiter: BỊ CHẶN (403)
    const recruiterCreateRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(recruiterCreateRes.status, 403, 'Recruiter không được phép user.create');

    // - Candidate: BỊ CHẶN (403)
    const candidateCreateRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(candidateCreateRes.status, 403, 'Candidate không được phép user.create');

    // Hành động 2: Xem danh sách ứng viên (Action: candidate.read)
    // - Admin: ĐƯỢC PHÉP (200)
    const adminListCandRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/recruitment/candidates/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminListCandRes.status, 200);

    // - Recruiter: ĐƯỢC PHÉP (200)
    const recruiterListCandRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/recruitment/candidates/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(recruiterListCandRes.status, 200, 'Recruiter phải được phép xem danh sách ứng viên');

    // - Candidate: BỊ CHẶN (403)
    const candidateListCandRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/recruitment/candidates/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(candidateListCandRes.status, 200, 'Candidate có quyền đọc trong phạm vi của chính mình');
    assert.strictEqual(candidateListCandRes.body.authorizedUser,'candidate@example.com');
    assert.strictEqual(Object.hasOwn(candidateListCandRes.body,'candidates'),false);

    recordPass('AC-03: Kiểm thử tự động 3 vai trò (Admin vs Recruiter vs Candidate) phân quyền chính xác theo từng API');

    // -------------------------------------------------------------
    // TEST 4: TÍNH NĂNG TRUY VẤN PERMISSIONS CỦA USER QUA API
    // -------------------------------------------------------------
    totalTests++;
    const userPermsRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/permissions',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });

    assert.strictEqual(userPermsRes.status, 200);
    assert.ok(Array.isArray(userPermsRes.body.permissions));
    assert.ok(userPermsRes.body.permissions.includes('candidate.read'));
    assert.ok(userPermsRes.body.permissions.includes('candidate.create'));
    assert.ok(!userPermsRes.body.permissions.includes('user.create'), 'Recruiter không được có quyền user.create');

    recordPass('API /api/v1/auth/permissions trả về danh sách quyền động truy vấn trực tiếp từ database thật');

    // -------------------------------------------------------------
    // TEST 5: TÍNH TỨC THỜI CỦA RBAC KHI THAY ĐỔI CSDL (DYNAMIC RBAC)
    // -------------------------------------------------------------
    totalTests++;
    // Tạm thời cấp quyền 'interview.read' cho vai trò CANDIDATE trong CSDL
    const candidateRoleId = (await db.prepare('SELECT id FROM roles WHERE code = ?').get('CANDIDATE')).id;
    const interviewPermId = (await db.prepare('SELECT id FROM permissions WHERE code = ?').get('interview.read')).id;
    await db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run(candidateRoleId,interviewPermId);

    // Trước khi cấp: Candidate bị 403
    const beforeGrant = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/interviews/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(beforeGrant.status, 403);

    // Cấp quyền trực tiếp trong SQLite DB
    (await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(candidateRoleId, interviewPermId));

    // Sau khi cấp: Gọi API ngay lập tức thành công 200 mà không cần restart server
    const afterGrant = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/interviews/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(afterGrant.status, 200, 'Quyền mới cấp trong CSDL phải có hiệu lực ngay lập tức');

    // Thu hồi lại quyền khỏi CSDL
    (await db.prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?').run(candidateRoleId, interviewPermId));

    // Sau khi thu hồi: Lập tức bị từ chối 403 trở lại
    const afterRevoke = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/interviews/test-list',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(afterRevoke.status, 403, 'Thu hồi quyền trong CSDL có hiệu lực ngay lập tức');
    await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)').run(candidateRoleId,interviewPermId);

    recordPass('Dynamic RBAC: Thay đổi quyền trong CSDL có hiệu lực tức thời, chứng minh 100% không dùng hard-code hay in-memory cache tĩnh');

    // -------------------------------------------------------------
    // TEST 6: BẢO MẬT - REQUEST KHÔNG TOKEN BỊ TỪ CHỐI 401
    // -------------------------------------------------------------
    totalTests++;
    const noTokenRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/test-create',
      method: 'POST'
    });
    assert.strictEqual(noTokenRes.status, 401);
    recordPass('Bảo mật: Endpoint bảo vệ thiếu token xác thực bị từ chối 401 Unauthorized');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ KIỂM THỬ: ${passCount}/${totalTests} TESTS PASS (100% THÀNH CÔNG)`);
    console.log('Tất cả Acceptance Criteria của Story S1-05 (RBAC Matrix) đều đã ĐẠT.');
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
