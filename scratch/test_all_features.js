const http = require('node:http');
const assert = require('node:assert');

const BASE_URL = 'http://localhost:5050';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(data));
      req.write(data);
    }
    req.end();
  });
}

async function runAudit() {
  console.log('================================================================');
  console.log('BẮT ĐẦU KIỂM THỬ TOÀN DIỆN TOÀN BỘ CHỨC NĂNG HỆ THỐNG ATS');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    return fn()
      .then(() => {
        passed++;
        console.log(`[PASS] ${name}`);
      })
      .catch((err) => {
        console.error(`[FAIL] ${name}:`, err.message);
      });
  }

  // 1. Health check
  await test('1. GET /api/v1/health', async () => {
    const res = await request('/api/v1/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  // 2. Authentication: Login
  let adminToken, recruiterToken, hrToken, devToken;
  await test('2. POST /api/v1/auth/login (Admin, Recruiter, HR Manager)', async () => {
    const resAdmin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@company.com', password: 'Ats@123456' }
    });
    assert.strictEqual(resAdmin.status, 200);
    adminToken = resAdmin.body.data.token;

    const resRecruiter = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'recruiter@company.com', password: 'Ats@123456' }
    });
    assert.strictEqual(resRecruiter.status, 200);
    recruiterToken = resRecruiter.body.data.token;

    const resHr = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'hr.manager@company.com', password: 'Ats@123456' }
    });
    assert.strictEqual(resHr.status, 200);
    hrToken = resHr.body.data.token;
  });

  // 3. S1-06 Role-based navigation menu
  await test('3. GET /api/v1/navigation/menu (Phân quyền menu theo vai trò)', async () => {
    const resAdmin = await request('/api/v1/navigation/menu', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(resAdmin.status, 200);
    const adminPaths = resAdmin.body.menuItems.map(m => m.path);
    assert.ok(adminPaths.includes('/admin/users'));
    assert.ok(adminPaths.includes('/admin/roles'));

    const resRecruiter = await request('/api/v1/navigation/menu', {
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(resRecruiter.status, 200);
    const recPaths = resRecruiter.body.menuItems.map(m => m.path);
    assert.ok(recPaths.includes('/candidates'));
    assert.ok(recPaths.includes('/requisitions'));
    assert.ok(!recPaths.includes('/admin/users'), 'Recruiter không có quyền xem menu /admin/users');
  });

  // 4. Dashboard Stats
  await test('4. GET /api/v1/dashboard/stats (Thống kê realtime)', async () => {
    const res = await request('/api/v1/dashboard/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.stats);
    assert.ok(typeof res.body.stats.totalUsers === 'number');
  });

  // 5. Requisitions CRUD
  let createdReqId;
  await test('5. Requisitions: Tạo vị trí, xem danh sách, bàn giao', async () => {
    // List
    const listRes = await request('/api/v1/requisitions', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.body.requisitions.length >= 4);

    // Create
    const createRes = await request('/api/v1/requisitions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        title: 'Fullstack React NodeJS Senior',
        departmentName: 'Khối Công Nghệ',
        headcount: 2,
        assignedRecruiterId: 'usr-recruiter'
      }
    });
    assert.strictEqual(createRes.status, 201);
    assert.ok(createRes.body.requisition.id);
    createdReqId = createRes.body.requisition.id;

    // Handover
    const handoverRes = await request(`/api/v1/requisitions/${createdReqId}/handover`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        newRecruiterId: 'usr-admin',
        notes: 'Bàn giao chuyển giao công việc'
      }
    });
    assert.strictEqual(handoverRes.status, 200);
    assert.strictEqual(handoverRes.body.success, true);
  });

  // 6. Candidates CRUD & Stage Transition
  let testCandId;
  await test('6. Candidates: Thêm ứng viên mới, đổi vòng tuyển dụng', async () => {
    // Create candidate
    const createCandRes = await request('/api/v1/candidates', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recruiterToken}` },
      body: {
        fullName: 'Lê Văn Kiểm Thử',
        email: 'kiemthu.le@example.com',
        phoneNumber: '0988776655',
        requisitionId: createdReqId,
        stage: 'APPLIED',
        rating: 5,
        experienceYears: 4,
        expectedSalary: '30.000.000 đ',
        notes: 'Chuyên gia React và NodeJS'
      }
    });
    assert.strictEqual(createCandRes.status, 201);
    assert.ok(createCandRes.body.data.id);
    testCandId = createCandRes.body.data.id;

    // List candidates
    const candListRes = await request('/api/v1/candidates', {
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(candListRes.status, 200);
    assert.ok(candListRes.body.candidates.some(c => c.id === testCandId));

    // Update Stage to INTERVIEW
    const updateStageRes = await request(`/api/v1/candidates/${testCandId}/stage`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${recruiterToken}` },
      body: { stage: 'INTERVIEW' }
    });
    assert.strictEqual(updateStageRes.status, 200);
    assert.strictEqual(updateStageRes.body.success, true);
  });

  // 7. Interviews CRUD & Evaluation
  let testIntId;
  await test('7. Interviews: Lên lịch phỏng vấn, chấm điểm & đánh giá', async () => {
    // Create interview
    const createIntRes = await request('/api/v1/interviews', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recruiterToken}` },
      body: {
        candidateId: testCandId,
        requisitionId: createdReqId,
        interviewerId: 'usr-interviewer',
        roundName: 'Vòng 1 - Kỹ thuật chuyên sâu',
        scheduledTime: '2026-10-05T10:00:00.000Z',
        locationOrLink: 'Google Meet'
      }
    });
    assert.strictEqual(createIntRes.status, 201);
    assert.ok(createIntRes.body.data.id);
    testIntId = createIntRes.body.data.id;

    // List interviews
    const intListRes = await request('/api/v1/interviews', {
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(intListRes.status, 200);
    assert.ok(intListRes.body.interviews.some(i => i.id === testIntId));

    // Update status & score & feedback
    const updateIntRes = await request(`/api/v1/interviews/${testIntId}/status`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${recruiterToken}` },
      body: {
        status: 'COMPLETED',
        score: 5,
        feedback: 'Ứng viên trả lời xuất sắc câu hỏi thuật toán và kiến trúc hệ thống.'
      }
    });
    assert.strictEqual(updateIntRes.status, 200);
    assert.strictEqual(updateIntRes.body.success, true);
  });

  // 8. Offers CRUD & Automatic Candidate HIRED
  let testOfferId;
  await test('8. Offers: Lập offer, phê duyệt và tự động cập nhật HIRED', async () => {
    // Create offer
    const createOffRes = await request('/api/v1/offers', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recruiterToken}` },
      body: {
        candidateId: testCandId,
        requisitionId: createdReqId,
        salaryMonthly: 32000000,
        startDate: '2026-11-01',
        approverId: 'usr-hr-mgr'
      }
    });
    assert.strictEqual(createOffRes.status, 201);
    assert.ok(createOffRes.body.data.id);
    testOfferId = createOffRes.body.data.id;

    // List offers
    const offListRes = await request('/api/v1/offers', {
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    assert.strictEqual(offListRes.status, 200);
    assert.ok(offListRes.body.offers.some(o => o.id === testOfferId));

    // Approve offer (should update candidate stage to HIRED!)
    const approveOffRes = await request(`/api/v1/offers/${testOfferId}/status`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${hrToken}` },
      body: { status: 'APPROVED' }
    });
    assert.strictEqual(approveOffRes.status, 200);
    assert.strictEqual(approveOffRes.body.success, true);

    // Verify candidate is now HIRED
    const checkCandRes = await request('/api/v1/candidates', {
      headers: { 'Authorization': `Bearer ${recruiterToken}` }
    });
    const hiredCand = checkCandRes.body.candidates.find(c => c.id === testCandId);
    assert.strictEqual(hiredCand.stage, 'HIRED', 'Ứng viên phải tự động chuyển thành HIRED khi offer được duyệt!');
  });

  // 9. Users Management & Lock/Unlock
  let testUserId;
  await test('9. Users: Tạo user mới, khóa tài khoản và kiểm tra đăng nhập bị chặn', async () => {
    const uniqueEmail = `test.emp.${Date.now()}@company.com`;
    // Create user
    const createRes = await request('/api/v1/admin/users', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        fullName: 'Nhân Viên Mới',
        email: uniqueEmail,
        department: 'Khối Công Nghệ',
        jobTitle: 'Kỹ sư Phần mềm',
        role: 'INTERVIEWER'
      }
    });
    assert.strictEqual(createRes.status, 201);
    testUserId = createRes.body.data.id;
    const tempPassword = createRes.body.data.temporaryPassword;

    // Login with temp password -> should succeed
    const loginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: uniqueEmail, password: tempPassword }
    });
    assert.strictEqual(loginRes.status, 200);

    // Lock user account
    const lockRes = await request(`/api/v1/admin/users/${testUserId}/lock`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { reason: 'Vi phạm quy chế bảo mật công ty' }
    });
    assert.strictEqual(lockRes.status, 200);

    // Attempt login while locked -> must be 403 Forbidden!
    const lockedLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: uniqueEmail, password: tempPassword }
    });
    assert.strictEqual(lockedLoginRes.status, 403, 'Tài khoản bị khóa phải bị từ chối 403!');
    assert.strictEqual(lockedLoginRes.body.code, 'ACCOUNT_PERMANENTLY_LOCKED');

    // Unlock user account
    const unlockRes = await request(`/api/v1/admin/users/${testUserId}/unlock`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(unlockRes.status, 200);

    // Login after unlock -> should succeed again!
    const unlockedLoginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: uniqueEmail, password: tempPassword }
    });
    assert.strictEqual(unlockedLoginRes.status, 200, 'Tài khoản sau khi mở khóa phải đăng nhập được!');
  });

  // 10. Change Password, Logout and Persistence Test
  await test('10. Đổi mật khẩu, Logout và Đăng nhập lại với mật khẩu mới', async () => {
    // Login dev1
    const loginDev = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'dev1@company.com', password: 'Ats@123456' }
    });
    assert.strictEqual(loginDev.status, 200);
    const devToken = loginDev.body.data.token;

    // Change password to Ats@NewPass2026
    const changeRes = await request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { currentPassword: 'Ats@123456', newPassword: 'Ats@NewPass2026' }
    });
    assert.strictEqual(changeRes.status, 200);

    // Logout
    const logoutRes = await request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${devToken}` }
    });
    assert.strictEqual(logoutRes.status, 200);

    // Relogin with old password -> must fail!
    const oldLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'dev1@company.com', password: 'Ats@123456' }
    });
    assert.strictEqual(oldLogin.status, 401);

    // Relogin with new password -> must succeed!
    const newLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'dev1@company.com', password: 'Ats@NewPass2026' }
    });
    assert.strictEqual(newLogin.status, 200);
    assert.strictEqual(newLogin.body.success, true);
  });

  console.log('\n================================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passed}/${total} BÀI TEST ĐẠT (${Math.round(passed/total*100)}%)`);
  console.log('================================================================');
}

runAudit();
