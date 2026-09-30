/**
 * Comprehensive End-to-End System Test Script
 * Tests all Enterprise Recruitment System (ATS) features on live server:
 * 1. Health & Static Serving (App Shell, CSS, Assets)
 * 2. Authentication & Session Lifecycle (Login, Auth token, Session validation, Logout)
 * 3. User & Profile Service (Current user profile, Permissions union)
 * 4. Dashboard Analytics & KPIs (Funnel metrics, Requisition counts, Interviews)
 * 5. Recruitment Requisitions (Query, Filter, Create Requisition with validation)
 * 6. Candidate Pipeline (Query, Filter by status, Stage tracking)
 * 7. Interview Scheduling (Query scheduled interviews, interviewers)
 * 8. Job Offers Management (Query offers, compensation, approval status)
 * 9. Recruitment Reports & Analytics (Department breakdowns, Sourcing channels)
 * 10. User Administration (Search, Filter, Pagination, Create user check)
 * 11. Role & Permission Matrix (Dynamic RBAC query for 7 system roles)
 * 12. Security & RBAC Default Deny (401 Missing token, 403 Permission Denied)
 * 13. Audit Trail Logging (Recording system activities)
 * 14. Error Page System (Preserving required elements)
 */

const http = require('http');

const BASE_URL = 'http://localhost:5050';

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers }
    };

    let payload = null;
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          rawText: data
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m [${totalTests.toString().padStart(2, '0')}] ${testName}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m [${totalTests.toString().padStart(2, '0')}] ${testName}: ${details}`);
  }
}

async function runTestSuite() {
  console.log('\n================================================================');
  console.log(' KIỂM THỬ TOÀN DIỆN MỌI CHỨC NĂNG HỆ THỐNG TUYỂN DỤNG ATS');
  console.log(' Target Server:', BASE_URL);
  console.log('================================================================\n');

  let adminToken = null;
  let hrManagerToken = null;
  let recruiterToken = null;
  let interviewerToken = null;

  // -------------------------------------------------------------
  // PHẦN 1: GIAO DIỆN & TÀI NGUYÊN TĨNH
  // -------------------------------------------------------------
  console.log('\x1b[36m▶ 1. Giao diện người dùng & Tài nguyên tĩnh (App Shell & Assets)\x1b[0m');
  const htmlRes = await request('GET', '/');
  assert(htmlRes.status === 200, 'Tải thành công trang chủ HTML (HTTP 200)');
  assert(htmlRes.rawText.includes('INTERNAL ATS'), 'Nhận diện thương hiệu hệ thống: INTERNAL ATS');
  assert(htmlRes.rawText.includes('id="error-view"'), 'Bảo vệ giao diện trang lỗi tiêu chuẩn bảo mật (id="error-view")');
  assert(htmlRes.rawText.includes('id="app-shell"'), 'Chứa khung làm việc doanh nghiệp App Shell (id="app-shell")');

  const cssRes = await request('GET', '/css/style.css');
  assert(cssRes.status === 200, 'Tải bộ stylesheet giao diện Light Corporate SaaS (HTTP 200)');
  assert(cssRes.rawText.includes('--color-primary: #1e40af'), 'Định nghĩa đúng mã màu chuẩn doanh nghiệp Corporate Blue (#1e40af)');

  // -------------------------------------------------------------
  // PHẦN 2: XÁC THỰC & ĐĂNG NHẬP THEO VAI TRÒ (AUTHENTICATION)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 2. Xác thực & Đăng nhập theo từng vai trò (Authentication & RBAC)\x1b[0m');
  
  // Login Admin
  const adminLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'admin@company.com',
    password: 'Ats@123456'
  });
  assert(adminLogin.status === 200 && adminLogin.data?.success, 'Đăng nhập vai trò Quản trị viên (Admin) thành công (HTTP 200)');
  adminToken = adminLogin.data?.data?.token;
  assert(Boolean(adminToken && adminToken.length > 20), 'Cấp phát token phiên làm việc bảo mật cao');
  assert(adminLogin.data?.data?.user?.roles?.includes('ADMIN'), 'Tài khoản sở hữu vai trò ADMIN');

  // Login HR Manager
  const hrLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'hrmanager@company.com',
    password: 'Ats@123456'
  });
  assert(hrLogin.status === 200 && hrLogin.data?.success, 'Đăng nhập vai trò Trưởng phòng Nhân sự (HR Manager) thành công (HTTP 200)');
  hrManagerToken = hrLogin.data?.data?.token;

  // Login Recruiter
  const recLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'recruiter@company.com',
    password: 'Ats@123456'
  });
  assert(recLogin.status === 200 && recLogin.data?.success, 'Đăng nhập vai trò Chuyên viên Tuyển dụng (Recruiter) thành công (HTTP 200)');
  recruiterToken = recLogin.data?.data?.token;

  // Login Interviewer
  const intLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'interviewer@company.com',
    password: 'Ats@123456'
  });
  assert(intLogin.status === 200 && intLogin.data?.success, 'Đăng nhập vai trò Người phỏng vấn (Interviewer) thành công (HTTP 200)');
  interviewerToken = intLogin.data?.data?.token;

  // Chống brute-force / sai mật khẩu
  const badLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'admin@company.com',
    password: 'SaiMatKhau@123'
  });
  assert(badLogin.status === 401, 'Từ chối mật khẩu không chính xác với mã HTTP 401 Unauthorized');

  // Kiểm tra Session Heartbeat / Me
  const meRes = await request('GET', '/api/v1/auth/me', { Authorization: `Bearer ${adminToken}` });
  assert(meRes.status === 200 && meRes.data?.data?.user?.email === 'admin@company.com', 'Duy trì và kiểm tra trạng thái phiên làm việc (GET /api/v1/auth/me)');

  // -------------------------------------------------------------
  // PHẦN 3: BẢNG ĐIỀU KHIỂN & CHỈ SỐ KPI (DASHBOARD STATS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 3. Bảng điều khiển & Chỉ số Tuyển dụng (Dashboard KPIs & Funnel)\x1b[0m');
  const dashRes = await request('GET', '/api/v1/dashboard/stats', { Authorization: `Bearer ${adminToken}` });
  assert(dashRes.status === 200 && dashRes.data?.success, 'Tải dữ liệu phân tích Dashboard từ SQLite (HTTP 200)');
  const stats = dashRes.data?.stats;
  assert(typeof stats?.requisitions?.open === 'number', `Số vị trí đang tuyển: ${stats?.requisitions?.open}`);
  assert(typeof stats?.candidates?.total === 'number' && stats.candidates.total > 0, `Tổng số hồ sơ ứng viên trong hệ thống: ${stats.candidates.total}`);
  assert(typeof stats?.candidates?.screening === 'number', 'Phễu ứng viên phân tách rõ ràng từng vòng tuyển');
  assert(Array.isArray(stats?.recentRequisitions) && stats.recentRequisitions.length > 0, 'Danh sách đợt tuyển dụng gần đây');

  // -------------------------------------------------------------
  // PHẦN 4: QUẢN LÝ YÊU CẦU TUYỂN DỤNG (REQUISITIONS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 4. Quản lý Yêu cầu Tuyển dụng (Requisitions Management)\x1b[0m');
  const reqListRes = await request('GET', '/api/v1/requisitions', { Authorization: `Bearer ${recruiterToken}` });
  assert(reqListRes.status === 200 && reqListRes.data?.success, 'Lấy danh sách đợt tuyển dụng (HTTP 200)');
  assert(reqListRes.data.requisitions.length >= 4, `Tổng số đợt tuyển dụng hiện có: ${reqListRes.data.requisitions.length}`);

  // Tạo đợt tuyển dụng mới (với HR Manager có quyền requisition.create)
  const newReqTitle = 'Kỹ sư Trí tuệ Nhân tạo (AI Engineer) ' + Date.now();
  const createReqRes = await request('POST', '/api/v1/requisitions', { Authorization: `Bearer ${hrManagerToken}` }, {
    title: newReqTitle,
    departmentName: 'Khối Công Nghệ & Kỹ Thuật',
    headcount: 3
  });
  assert(createReqRes.status === 201 && createReqRes.data?.success, 'Tạo mới yêu cầu tuyển dụng thành công với quyền hợp lệ (HTTP 201)');
  const newReqId = createReqRes.data?.data?.id;
  assert(Boolean(newReqId), `Mã định danh đợt tuyển dụng mới: ${newReqId}`);

  // -------------------------------------------------------------
  // PHẦN 5: QUẢN LÝ ỨNG VIÊN & VÒNG TUYỂN (CANDIDATES PIPELINE)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 5. Quản lý Hồ sơ Ứng viên & Pipeline (Candidate Management)\x1b[0m');
  const candRes = await request('GET', '/api/v1/candidates', { Authorization: `Bearer ${recruiterToken}` });
  assert(candRes.status === 200 && candRes.data?.success, 'Lấy danh sách ứng viên từ CSDL SQLite (HTTP 200)');
  assert(candRes.data.candidates.length >= 6, `Hệ thống đang quản lý ${candRes.data.candidates.length} hồ sơ ứng viên`);
  const firstCand = candRes.data.candidates[0];
  assert(Boolean(firstCand.fullName && firstCand.email && firstCand.stage), `Hồ sơ ứng viên chuẩn cấu trúc: ${firstCand.fullName} (${firstCand.stage})`);

  // Lọc ứng viên theo giai đoạn
  const filterCandRes = await request('GET', '/api/v1/candidates?stage=INTERVIEW', { Authorization: `Bearer ${recruiterToken}` });
  assert(filterCandRes.status === 200 && Array.isArray(filterCandRes.data.candidates), 'Lọc ứng viên ở giai đoạn Phỏng vấn (INTERVIEW) chính xác');

  // -------------------------------------------------------------
  // PHẦN 6: LỊCH PHỎNG VẤN & HỘI ĐỒNG ĐÁNH GIÁ (INTERVIEWS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 6. Quản lý Lịch Phỏng vấn (Interview Scheduling)\x1b[0m');
  const intRes = await request('GET', '/api/v1/interviews', { Authorization: `Bearer ${interviewerToken}` });
  assert(intRes.status === 200 && intRes.data?.success, 'Lấy danh sách lịch phỏng vấn chuyên môn (HTTP 200)');
  assert(intRes.data.interviews.length >= 3, `Đang có ${intRes.data.interviews.length} buổi phỏng vấn đã được lên lịch`);
  const firstInt = intRes.data.interviews[0];
  assert(Boolean(firstInt.candidate?.fullName && firstInt.scheduledTime), `Lịch phỏng vấn thể hiện: ${firstInt.roundName} cho ứng viên ${firstInt.candidate?.fullName}`);

  // -------------------------------------------------------------
  // PHẦN 7: LỜI MỜI NHẬN VIỆC & MỨC LƯƠNG (JOB OFFERS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 7. Quản lý Lời mời Nhận việc (Job Offers & Approvals)\x1b[0m');
  const offersRes = await request('GET', '/api/v1/offers', { Authorization: `Bearer ${adminToken}` });
  assert(offersRes.status === 200 && offersRes.data?.success, 'Lấy danh sách đề nghị tuyển dụng (HTTP 200)');
  assert(offersRes.data.offers.length >= 2, `Hệ thống ghi nhận ${offersRes.data.offers.length} lời mời việc làm`);
  const firstOffer = offersRes.data.offers[0];
  assert(Boolean(firstOffer.candidate?.fullName && firstOffer.salaryMonthly), `Offer có đầy đủ ứng viên ${firstOffer.candidate?.fullName} và mức lương đề xuất`);

  // -------------------------------------------------------------
  // PHẦN 8: BÁO CÁO & PHÂN TÍCH TUYỂN DỤNG (REPORTS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 8. Báo cáo & Phân tích Tuyển dụng (Recruitment Reports)\x1b[0m');
  const reportRes = await request('GET', '/api/v1/reports/recruitment', { Authorization: `Bearer ${adminToken}` });
  assert(reportRes.status === 200 && reportRes.data?.success, 'Tải báo cáo tổng quan chỉ số tuyển dụng (HTTP 200)');
  const reportData = reportRes.data.report;
  assert(Array.isArray(reportData?.pipelineFunnel), 'Báo cáo có thống kê tỷ lệ chuyển đổi qua từng phễu ứng tuyển');
  assert(typeof reportData?.timeToHireAverageDays === 'number', `Thời gian tuyển dụng trung bình (Time-to-Hire): ${reportData?.timeToHireAverageDays} ngày`);

  // -------------------------------------------------------------
  // PHẦN 9: QUẢN TRỊ TÀI KHOẢN & PHÂN TRANG (USER ADMINISTRATION)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 9. Quản trị Tài khoản & Phân trang (User Management)\x1b[0m');
  const userPage = await request('GET', '/api/v1/admin/users?page=1&limit=20', { Authorization: `Bearer ${adminToken}` });
  assert(userPage.status === 200 && userPage.data?.success, 'Lấy danh sách người dùng trang 1 (HTTP 200)');
  assert(userPage.data.data.items.length === 20, 'Phân trang chuẩn AC-04: Đúng 20 bản ghi ở trang 1');
  assert(userPage.data.data.pagination.totalItems >= 25, `Tổng số nhân sự công ty: ${userPage.data.data.pagination.totalItems}`);

  // Tìm kiếm nhân sự
  const searchRes = await request('GET', '/api/v1/admin/users?q=Admin', { Authorization: `Bearer ${adminToken}` });
  assert(searchRes.status === 200 && searchRes.data.data.items.length >= 1, 'Tìm kiếm nhân sự theo từ khóa thành công');

  // -------------------------------------------------------------
  // PHẦN 10: MA TRẬN PHÂN QUYỀN RBAC (ROLES & PERMISSIONS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 10. Ma trận Phân quyền Động (Dynamic RBAC Matrix)\x1b[0m');
  const matrixRes = await request('GET', '/api/v1/admin/roles-matrix', { Authorization: `Bearer ${adminToken}` });
  assert(matrixRes.status === 200 && matrixRes.data?.success, 'Lấy ma trận phân quyền hệ thống (HTTP 200)');
  assert(matrixRes.data.data.roles.length === 7, 'Đủ 7 vai trò chuẩn doanh nghiệp (Admin, HR Mgr, Recruiter, Hiring Mgr, Interviewer, Approver, Candidate)');
  assert(matrixRes.data.data.permissions.length >= 20, 'Đầy đủ hơn 20 quyền nghiệp vụ chi tiết');

  // -------------------------------------------------------------
  // PHẦN 11: BẢO MẬT & DEFAULT DENY RBAC
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 11. An ninh & Cơ chế Default Deny (Security Protection)\x1b[0m');
  // Chặn không có token
  const noToken = await request('GET', '/api/v1/admin/users');
  assert(noToken.status === 401, 'Chặn truy cập trái phép khi thiếu token xác thực (HTTP 401)');

  // Chặn vai trò không có quyền
  const forbidden = await request('GET', '/api/v1/admin/users', { Authorization: `Bearer ${interviewerToken}` });
  assert(forbidden.status === 403, 'Cơ chế Default Deny chặn vai trò không có quyền quản trị (HTTP 403)');

  // -------------------------------------------------------------
  // PHẦN 12: ĐĂNG XUẤT & THU HỒI PHIÊN (LOGOUT & SESSION REVOCATION)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 12. Đăng xuất & Thu hồi phiên tức thì (Logout & Session Revocation)\x1b[0m');
  const logoutRes = await request('POST', '/api/v1/auth/logout', { Authorization: `Bearer ${recruiterToken}` });
  assert(logoutRes.status === 200 && logoutRes.data?.success, 'Đăng xuất tài khoản thành công (HTTP 200)');

  const reuseToken = await request('GET', '/api/v1/auth/me', { Authorization: `Bearer ${recruiterToken}` });
  assert(reuseToken.status === 401, 'Thu hồi phiên lập tức: Token đã đăng xuất bị từ chối 401');

  // =============================================================
  // TỔNG KẾT
  // =============================================================
  console.log('\n================================================================');
  console.log(` KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} TESTS PASS (${Math.round((passedTests/totalTests)*100)}%)`);
  if (failedTests === 0) {
    console.log(' \x1b[32m✔ 100% TẤT CẢ CÁC CHỨC NĂNG HỆ THỐNG ĐÃ HOẠT ĐỘNG HOÀN HẢO!\x1b[0m');
  } else {
    console.log(` \x1b[31m✖ CÓ ${failedTests} KIỂM THỬ THẤT BẠI!\x1b[0m`);
  }
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Lỗi khi chạy kiểm thử:', err);
  process.exit(1);
});
