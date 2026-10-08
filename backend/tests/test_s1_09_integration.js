const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const { seedDatabase } = require('../src/db/seed');

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
  console.log('TEST SUITE: USER STORY S1-09 (GÁN VÀ THU HỒI VAI TRÒ)');
  console.log('================================================================');

  // Reset database state using seed
  const db = getDatabase();
  (await seedDatabase(db));

  await startServer(TEST_PORT);
  console.log(`[Test S1-09] Server started on port ${TEST_PORT}\n`);

  let passedTests = 0;

  try {
    // --------------------------------------------------------------------------
    // Test 1: Lấy danh sách vai trò hiện tại của người dùng (GET /api/v1/admin/users/:id/roles)
    // --------------------------------------------------------------------------
    console.log('Test 1: Lấy danh sách vai trò hiện tại của người dùng (GET /roles)');
    const adminToken = await loginUser('admin@company.com');

    const getRolesRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-interviewer/roles',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(getRolesRes.status, 200);
    assert.strictEqual(getRolesRes.body.success, true);
    assert.strictEqual(getRolesRes.body.data.userId, 'usr-interviewer');
    assert.deepStrictEqual(getRolesRes.body.data.currentRoles, ['INTERVIEWER']);
    assert(Array.isArray(getRolesRes.body.data.availableRoles));
    assert.strictEqual(getRolesRes.body.data.availableRoles.length, 7);
    console.log('   ✓ GET /roles trả về đúng thông tin user, vai trò hiện tại và 7 vai trò hệ thống.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 2: AC-01 Gán đa vai trò (Multi-role) & Hợp nhất toàn bộ quyền (Union)
    // --------------------------------------------------------------------------
    console.log('\nTest 2: AC-01 Gán đa vai trò (Multi-role) và sở hữu hợp nhất quyền hạn');
    // Gán cho usr-interviewer cả vai trò HIRING_MGR và INTERVIEWER
    const assignMultiRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-interviewer/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: ['HIRING_MGR', 'INTERVIEWER'] });

    assert.strictEqual(assignMultiRes.status, 200);
    assert.strictEqual(assignMultiRes.body.success, true);
    assert.strictEqual(assignMultiRes.body.code, 'ROLES_ASSIGNED_SUCCESS');
    assert.strictEqual(assignMultiRes.body.data.roles.length, 2);
    assert(assignMultiRes.body.data.roles.includes('HIRING_MGR'));
    assert(assignMultiRes.body.data.roles.includes('INTERVIEWER'));

    // Kiểm tra trực tiếp bảng user_roles trong CSDL SQLite thật
    const dbRoles = (await db.prepare(`
      SELECT r.code
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = 'usr-interviewer'
      ORDER BY r.code ASC
    `).all()).map(r => r.code);

    assert.deepStrictEqual(dbRoles, ['HIRING_MGR', 'INTERVIEWER']);
    console.log('   ✓ Bảng CSDL thật user_roles đã lưu chính xác cả 2 vai trò HIRING_MGR và INTERVIEWER.');

    // Kiểm tra người dùng có hợp nhất toàn bộ quyền của cả 2 vai trò qua /api/v1/auth/permissions
    const targetUserToken = await loginUser('interviewer@company.com');
    const permRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/permissions',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${targetUserToken}` }
    });

    assert.strictEqual(permRes.status, 200);
    const userPerms = permRes.body.permissions;
    // Từ HIRING_MGR: requisition.read, requisition.create, candidate.read, interview.read, interview.evaluate
    // Từ INTERVIEWER: interview.read, interview.evaluate
    // Hợp nhất (Union): phải có requisition.create VÀ interview.evaluate
    assert(userPerms.includes('requisition.create'), 'Thiếu quyền requisition.create từ HIRING_MGR');
    assert(userPerms.includes('interview.evaluate'), 'Thiếu quyền interview.evaluate từ INTERVIEWER');
    assert(userPerms.includes('candidate.read'), 'Thiếu quyền candidate.read từ HIRING_MGR');
    console.log(`   ✓ Người dùng sở hữu ${userPerms.length} quyền hợp nhất (union) của cả 2 vai trò.`);
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 3: AC-02 Thay đổi vai trò có hiệu lực NGAY ở thao tác kế tiếp mà không cần relogin
    // --------------------------------------------------------------------------
    console.log('\nTest 3: AC-02 Thay đổi vai trò có hiệu lực ngay ở thao tác kế tiếp (Không cần relogin / restart)');
    // Đăng nhập tài khoản dev1@company.com (usr-dev-01, ban đầu chỉ là INTERVIEWER)
    const devToken = await loginUser('dev1@company.com');

    // Thao tác 1: Gọi endpoint ứng viên /api/v1/recruitment/candidates/test-list (yêu cầu candidate.read)
    // Ban đầu INTERVIEWER không có candidate.read -> Phải bị 403 Forbidden
    const initialReq = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/candidates/cand-001/stage',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${devToken}`, 'Content-Type':'application/json' }
    }, {stage:'SCREENING'});
    assert.strictEqual(initialReq.status, 403, 'Ban đầu phải bị từ chối 403');
    assert.strictEqual(initialReq.body.code, 'FORBIDDEN_PERMISSION_DENIED');
    console.log('   ✓ Thao tác ban đầu: Dev1 bị chặn HTTP 403 do chưa có vai trò RECRUITER.');

    // Admin thực hiện cấp thêm vai trò RECRUITER cho dev1
    const grantRoleRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: ['INTERVIEWER', 'RECRUITER'] });
    assert.strictEqual(grantRoleRes.status, 200);
    console.log('   ✓ Admin đã gán thêm vai trò RECRUITER vào CSDL SQLite cho dev1.');

    // Thao tác 2 KẾ TIẾP NGAY LẬP TỨC: Dev1 gọi lại endpoint ứng viên VỚI CÙNG TOKEN ĐANG SỬ DỤNG
    const nextReq = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/candidates/cand-001/stage',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${devToken}`, 'Content-Type':'application/json' }
    }, {stage:'SCREENING'});
    assert.strictEqual(nextReq.status, 200, 'Thao tác kế tiếp phải thành công 200 ngay lập tức');
    assert.strictEqual(nextReq.body.success, true);
    const currentSession=await request({hostname:'localhost',port:TEST_PORT,path:'/api/v1/auth/me',method:'GET',headers:{Authorization:`Bearer ${devToken}`}});
    assert.strictEqual(currentSession.body.data.user.email,'dev1@company.com');
    assert.ok(currentSession.body.data.user.roles.includes('RECRUITER'));
    console.log('   ✓ Thao tác kế tiếp: Dev1 lập tức được phép truy cập HTTP 200 mà KHÔNG CẦN đăng nhập lại hay khởi động lại server.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 4: AC-03 Chặn tự thu hồi vai trò quản trị (ADMIN) của chính mình
    // --------------------------------------------------------------------------
    console.log('\nTest 4: AC-03 Không thể tự thu hồi vai trò quản trị (ADMIN) của chính mình');
    // Admin đang đăng nhập (usr-admin) cố gắng gán cho chính mình vai trò khác và bỏ ADMIN
    const selfRevokeRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-admin/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: ['RECRUITER', 'INTERVIEWER'] }); // Omitted ADMIN

    assert.strictEqual(selfRevokeRes.status, 400);
    assert.strictEqual(selfRevokeRes.body.success, false);
    assert.strictEqual(selfRevokeRes.body.code, 'CANNOT_REVOKE_OWN_ADMIN_ROLE');
    assert(selfRevokeRes.body.message.includes('không thể tự thu hồi vai trò Quản trị hệ thống (ADMIN)'));

    // Kiểm tra CSDL xem vai trò ADMIN của usr-admin vẫn còn nguyên vẹn
    const adminRolesInDb = (await db.prepare(`
      SELECT r.code
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = 'usr-admin'
    `).all()).map(r => r.code);

    assert(adminRolesInDb.includes('ADMIN'), 'Vai trò ADMIN của quản trị viên phải được giữ nguyên');
    console.log('   ✓ Hệ thống từ chối HTTP 400 CANNOT_REVOKE_OWN_ADMIN_ROLE khi Admin cố tự gỡ vai trò ADMIN của mình.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 5: AC-03 Admin ĐƯỢC PHÉP tự gán thêm vai trò khác miễn là vẫn giữ ADMIN
    // --------------------------------------------------------------------------
    console.log('\nTest 5: AC-03 Admin được phép gán thêm vai trò khác cho chính mình khi giữ ADMIN');
    const selfAddRoleRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-admin/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: ['ADMIN', 'HR_MANAGER'] });

    assert.strictEqual(selfAddRoleRes.status, 200);
    assert.strictEqual(selfAddRoleRes.body.success, true);
    assert(selfAddRoleRes.body.data.roles.includes('ADMIN'));
    assert(selfAddRoleRes.body.data.roles.includes('HR_MANAGER'));
    console.log('   ✓ Admin tự cấp thêm HR_MANAGER thành công khi vai trò ADMIN vẫn được bảo lưu.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 6: Default Deny & Phân quyền bảo vệ endpoint gán vai trò (RBAC role.assign)
    // --------------------------------------------------------------------------
    console.log('\nTest 6: RBAC Default Deny - Chỉ tài khoản có quyền role.assign mới được gán vai trò');
    const recruiterToken = await loginUser('recruiter@company.com');

    // Recruiter cố gắng gọi PUT /api/v1/admin/users/:id/roles
    const recruiterAttempt = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${recruiterToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: ['ADMIN'] });

    assert.strictEqual(recruiterAttempt.status, 403);
    assert.strictEqual(recruiterAttempt.body.code, 'FORBIDDEN_PERMISSION_DENIED');
    console.log('   ✓ Recruiter bị từ chối HTTP 403 FORBIDDEN_PERMISSION_DENIED theo Default Deny.');

    // Yêu cầu không có token -> 401
    const unauthAttempt = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/roles',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { roles: ['ADMIN'] });
    assert.strictEqual(unauthAttempt.status, 401);
    console.log('   ✓ Yêu cầu thiếu token xác thực bị từ chối HTTP 401 UNAUTHORIZED.');
    passedTests++;

    // --------------------------------------------------------------------------
    // Test 7: Kiểm tra ràng buộc dữ liệu đầu vào (Empty roles & Invalid role code)
    // --------------------------------------------------------------------------
    console.log('\nTest 7: Ràng buộc dữ liệu - Từ chối mảng rỗng và mã vai trò không tồn tại');
    // Mảng rỗng
    const emptyRolesRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: [] });
    assert.strictEqual(emptyRolesRes.status, 400);
    assert.strictEqual(emptyRolesRes.body.code, 'EMPTY_ROLES');

    // Mã vai trò không tồn tại
    const invalidRoleRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users/usr-dev-01/roles',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, { roles: ['FAKE_ROLE_CODE'] });
    assert.strictEqual(invalidRoleRes.status, 400);
    assert.strictEqual(invalidRoleRes.body.code, 'INVALID_ROLE_CODE');
    console.log('   ✓ Hệ thống từ chối mảng rỗng (EMPTY_ROLES) và mã vai trò không tồn tại (INVALID_ROLE_CODE).');
    passedTests++;

    console.log('\n================================================================');
    console.log(`KẾT QUẢ TEST S1-09: TẤT CẢ ${passedTests}/7 TESTS ĐÃ PASS 100%!`);
    console.log('================================================================');
  } finally {
    // Reset seed back to clean state
    (await seedDatabase(db));
    server.close();
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test suite S1-09 failed with error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
