const assert = require('node:assert');
const http = require('node:http');
const { startServer, server } = require('../src/server');

const TEST_PORT = 5093;

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
  console.log('TEST SUITE: USER STORY S1-08 (QUẢN TRỊ TÀI KHOẢN NỘI BỘ)');
  console.log('Acceptance Criteria:');
  console.log('  • AC-01: Tạo tài khoản gửi email kích hoạt kèm mật khẩu tạm');
  console.log('  • AC-02: Email trùng bị từ chối kèm thông báo cụ thể (HTTP 409)');
  console.log('  • AC-03: Tìm theo tên, email, phòng ban; lọc theo vai trò và trạng thái; sửa thông tin');
  console.log('  • AC-04: Danh sách phân trang, mặc định 20 dòng');
  console.log('================================================================\n');

  await startServer(TEST_PORT);

  let passCount = 0;
  let totalTests = 0;

  function recordPass(testName) {
    passCount++;
    console.log(`[PASS] ${testName}`);
  }

  try {
    const adminToken = await loginUser('admin@company.com');
    const recruiterToken = await loginUser('recruiter@company.com');
    const candidateToken = await loginUser('candidate@example.com');

    // -------------------------------------------------------------
    // TEST 1: AC-01 - TẠO TÀI KHOẢN MỚI KÈM MẬT KHẨU TẠM & EMAIL KÍCH HOẠT
    // -------------------------------------------------------------
    totalTests++;
    console.log('[TEST 1] Tạo tài khoản mới, kiểm tra mật khẩu tạm và đăng nhập thực tế...');

    const newEmail = `interviewer.new.${Date.now()}@company.com`;
    const createRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      fullName: 'Vũ Đức Thành',
      email: newEmail,
      jobTitle: 'Kỹ sư Cấp cao / Thành viên Hội đồng Phỏng vấn',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      phoneNumber: '0981992883',
      roleCode: 'INTERVIEWER'
    });

    assert.strictEqual(createRes.status, 201, 'Tạo tài khoản phải trả về HTTP 201 Created');
    assert.strictEqual(createRes.body.success, true);
    assert.strictEqual(createRes.body.code, 'USER_CREATED');
    assert.ok(createRes.body.data.user.id.startsWith('usr-'), 'ID người dùng phải có tiền tố usr-');
    assert.strictEqual(createRes.body.data.user.email, newEmail);
    assert.ok(createRes.body.data.user.roles.includes('INTERVIEWER'));

    // Kiểm tra mật khẩu tạm (AC-01)
    const tempPassword = createRes.body.data.temporaryPassword;
    assert.ok(tempPassword, 'Phải sinh mật khẩu tạm thời');
    assert.ok(tempPassword.length >= 8, 'Mật khẩu tạm phải có tối thiểu 8 ký tự');
    assert.ok(/[A-Za-z]/.test(tempPassword) && /[0-9]/.test(tempPassword), 'Mật khẩu tạm phải có cả chữ và số');

    // Kiểm tra email kích hoạt mô phỏng (AC-01)
    assert.ok(createRes.body.data.activationEmail, 'Phải có nội dung email kích hoạt');
    assert.strictEqual(createRes.body.data.activationEmail.recipient, newEmail);
    assert.ok(createRes.body.data.activationEmail.body.includes(tempPassword), 'Nội dung email phải chứa mật khẩu tạm');

    // Kiểm tra tài khoản mới đăng nhập được ngay bằng mật khẩu tạm thật
    const newLoginRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      email: newEmail,
      password: tempPassword
    });
    assert.strictEqual(newLoginRes.status, 200, 'Tài khoản mới phải đăng nhập thành công với mật khẩu tạm được cấp');
    assert.strictEqual(newLoginRes.body.data.user.email, newEmail);
    assert.ok(newLoginRes.body.data.user.roles.includes('INTERVIEWER'));

    recordPass('TEST 1: AC-01 Tạo tài khoản mới, sinh mật khẩu tạm an toàn và gửi email kích hoạt thành công');

    // -------------------------------------------------------------
    // TEST 2: AC-02 - CHỐNG TRÙNG EMAIL KÈM THÔNG BÁO CỤ THỂ
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 2] Thử tạo tài khoản với email trùng lặp...');

    const duplicateRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      fullName: 'Người Dùng Giả Mạo Trùng Email',
      email: newEmail, // Dùng lại email vừa tạo ở Test 1
      jobTitle: 'Developer',
      roleCode: 'INTERVIEWER'
    });

    assert.strictEqual(duplicateRes.status, 409, 'Email trùng phải trả về HTTP 409 Conflict');
    assert.strictEqual(duplicateRes.body.success, false);
    assert.strictEqual(duplicateRes.body.code, 'EMAIL_ALREADY_EXISTS');
    assert.ok(duplicateRes.body.message.includes('đã tồn tại trong hệ thống'), 'Thông báo phải nêu rõ email đã tồn tại');

    // Thử lại với chữ hoa / thường để kiểm tra Case-Insensitive (NOCASE)
    const duplicateCaseRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      fullName: 'Người Dùng Hoa Thường',
      email: newEmail.toUpperCase(),
      jobTitle: 'Developer',
      roleCode: 'INTERVIEWER'
    });
    assert.strictEqual(duplicateCaseRes.status, 409, 'Email trùng case-insensitive phải bị từ chối 409');

    recordPass('TEST 2: AC-02 Chống trùng email (Case-Insensitive) trả về HTTP 409 EMAIL_ALREADY_EXISTS cụ thể');

    // -------------------------------------------------------------
    // TEST 3: AC-03 - TÌM KIẾM, BỘ LỌC ĐA TRƯỜNG & CẬP NHẬT THÔNG TIN
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 3] Kiểm tra tìm kiếm đa trường, lọc theo vai trò, trạng thái và cập nhật thông tin...');

    // 3.1 Tìm theo tên
    const searchNameRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users?search=' + encodeURIComponent('Phạm Đức Huy'),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(searchNameRes.status, 200);
    assert.ok(searchNameRes.body.data.items.length >= 1);
    assert.ok(searchNameRes.body.data.items.some(u => u.fullName === 'Phạm Đức Huy'));

    // 3.2 Tìm theo email
    const searchEmailRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users?search=cfo@company.com',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(searchEmailRes.status, 200);
    assert.strictEqual(searchEmailRes.body.data.items.length, 1);
    assert.strictEqual(searchEmailRes.body.data.items[0].email, 'cfo@company.com');

    // 3.3 Tìm theo phòng ban
    const searchDeptRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users?search=' + encodeURIComponent('Phòng Tài Chính - Kế Toán'),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(searchDeptRes.status, 200);
    assert.ok(searchDeptRes.body.data.items.length >= 2);
    for (const item of searchDeptRes.body.data.items) {
      assert.strictEqual(item.departmentName, 'Phòng Tài Chính - Kế Toán');
    }

    // 3.4 Lọc theo vai trò (APPROVER)
    const filterRoleRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users?role=APPROVER',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(filterRoleRes.status, 200);
    assert.ok(filterRoleRes.body.data.items.length >= 1);
    for (const item of filterRoleRes.body.data.items) {
      assert.ok(item.roles.includes('APPROVER'), 'Mọi bản ghi phải có vai trò APPROVER');
    }

    // 3.5 Lọc theo trạng thái LOCKED
    const filterLockedRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users?status=LOCKED',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(filterLockedRes.status, 200);
    assert.ok(filterLockedRes.body.data.items.length >= 1);
    for (const item of filterLockedRes.body.data.items) {
      assert.strictEqual(item.status, 'LOCKED');
    }

    // 3.6 Sửa thông tin người dùng (user.update)
    const updateTargetId = createRes.body.data.user.id;
    const updateRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/v1/admin/users/${updateTargetId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      fullName: 'Vũ Đức Thành (Đã cập nhật)',
      jobTitle: 'Principal Engineer & Trưởng ban Phỏng vấn',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      phoneNumber: '0989998888'
    });
    assert.strictEqual(updateRes.status, 200, 'Cập nhật người dùng phải thành công HTTP 200');
    assert.strictEqual(updateRes.body.data.user.fullName, 'Vũ Đức Thành (Đã cập nhật)');
    assert.strictEqual(updateRes.body.data.user.jobTitle, 'Principal Engineer & Trưởng ban Phỏng vấn');

    recordPass('TEST 3: AC-03 Tìm kiếm đa trường, lọc theo vai trò, trạng thái và sửa thông tin người dùng thành công');

    // -------------------------------------------------------------
    // TEST 4: AC-04 - DANH SÁCH PHÂN TRANG MẶC ĐỊNH 20 DÒNG
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 4] Kiểm tra phân trang danh sách người dùng mặc định 20 dòng...');

    // 4.1 Gọi danh sách mặc định không truyền tham số phân trang
    const defaultPageRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(defaultPageRes.status, 200);
    const pagination = defaultPageRes.body.data.pagination;
    assert.strictEqual(pagination.limit, 20, 'AC-04: Mặc định phải là 20 dòng/trang');
    assert.strictEqual(pagination.currentPage, 1);
    assert.strictEqual(defaultPageRes.body.data.items.length, 20, 'Trang 1 phải trả về chính xác 20 dòng');
    assert.ok(pagination.totalItems >= 26, 'Tổng số tài khoản phải >= 26 (25 seed + 1 mới tạo)');
    assert.ok(pagination.totalPages >= 2, 'Tổng số trang phải >= 2');
    assert.strictEqual(pagination.hasNextPage, true, 'Trang 1 phải có trang tiếp theo');
    assert.strictEqual(pagination.hasPrevPage, false, 'Trang 1 không có trang trước');

    // 4.2 Gọi trang 2
    const page2Res = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users?page=2&limit=20',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(page2Res.status, 200);
    assert.strictEqual(page2Res.body.data.pagination.currentPage, 2);
    assert.ok(page2Res.body.data.items.length >= 6, 'Trang 2 phải chứa các bản ghi còn lại (>= 6 dòng)');
    assert.strictEqual(page2Res.body.data.pagination.hasPrevPage, true, 'Trang 2 phải có trang trước');

    recordPass('TEST 4: AC-04 Phân trang danh sách người dùng mặc định 20 dòng (Trang 1: 20 dòng, Trang 2: các dòng còn lại) chính xác');

    // -------------------------------------------------------------
    // TEST 5: BẢO MẬT & RBAC DEFAULT DENY (401 & 403)
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n[TEST 5] Kiểm tra bảo mật và Default Deny (401 & 403)...');

    // 5.1 Không có token
    const noTokenList = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'GET'
    });
    assert.strictEqual(noTokenList.status, 401, 'Không có token xem danh sách phải trả về 401');

    // 5.2 Recruiter (không có user.create) cố tạo tài khoản
    const recruiterCreateRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${recruiterToken}`
      }
    }, {
      fullName: 'Tài Khoản Thất Bại',
      email: 'recruiter.hack@company.com',
      roleCode: 'INTERVIEWER'
    });
    assert.strictEqual(recruiterCreateRes.status, 403, 'Recruiter không có user.create phải bị từ chối 403');
    assert.strictEqual(recruiterCreateRes.body.code, 'FORBIDDEN_PERMISSION_DENIED');

    // 5.3 Candidate (không có user.read) cố xem danh sách người dùng
    const candidateListRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${candidateToken}` }
    });
    assert.strictEqual(candidateListRes.status, 403, 'Candidate không có user.read phải bị từ chối 403');
    assert.strictEqual(candidateListRes.body.code, 'FORBIDDEN_PERMISSION_DENIED');

    recordPass('TEST 5: Bảo mật RBAC Default Deny chặn 401 không xác thực và 403 với Recruiter/Candidate thành công');

    console.log('\n================================================================');
    console.log(`KẾT QUẢ TEST S1-08: ${passCount}/${totalTests} TESTS PASS (100%)`);
    console.log('Tất cả Acceptance Criteria của Story S1-08 đều đã ĐẠT.');
    console.log('================================================================\n');

    process.exitCode = 0;
  } catch (err) {
    console.error('\n[FAIL] Kiểm thử S1-08 thất bại:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTests();
