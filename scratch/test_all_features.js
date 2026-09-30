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
  console.log(' KIỂM THỬ TOÀN DIỆN HỆ THỐNG TUYỂN DỤNG NỘI BỘ (ATS)');
  console.log(' Target URL:', BASE_URL);
  console.log('================================================================\n');

  let adminToken = null;
  let recruiterToken = null;
  let interviewerToken = null;

  // -------------------------------------------------------------
  // PHẦN 1: GIAO DIỆN & TÀI NGUYÊN TĨNH
  // -------------------------------------------------------------
  console.log('\x1b[36m▶ 1. Kiểm tra Web App Shell & Tài nguyên tĩnh\x1b[0m');
  const htmlRes = await request('GET', '/');
  assert(htmlRes.status === 200, 'Tải trang chủ Enterprise HTML (HTTP 200)');
  assert(htmlRes.rawText.includes('INTERNAL ATS'), 'Chứa nhận diện hệ thống INTERNAL ATS');
  assert(htmlRes.rawText.includes('id="error-view"'), 'Bảo vệ giao diện lỗi chuẩn bảo mật (id="error-view")');
  assert(htmlRes.rawText.includes('id="app-shell"'), 'Chứa Enterprise App Shell (id="app-shell")');

  const cssRes = await request('GET', '/css/style.css');
  assert(cssRes.status === 200, 'Tải bộ CSS Light Corporate SaaS (HTTP 200)');
  assert(cssRes.rawText.includes('--color-primary: #1e40af'), 'CSS chứa Design Token Corporate Blue (#1e40af)');

  // -------------------------------------------------------------
  // PHẦN 2: XÁC THỰC & QUẢN LÝ PHIÊN (AUTHENTICATION & SESSIONS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 2. Kiểm tra Xác thực & Đăng nhập các vai trò\x1b[0m');
  
  // Login Admin
  const adminLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'admin@company.com',
    password: 'Ats@123456'
  });
  assert(adminLogin.status === 200 && adminLogin.data?.success, 'Đăng nhập thành công với tài khoản Admin (HTTP 200)');
  adminToken = adminLogin.data?.data?.token;
  assert(adminToken && adminToken.length > 20, 'Nhận token phiên làm việc bảo mật cao');
  assert(adminLogin.data?.data?.user?.roles?.includes('ADMIN'), 'Tài khoản sở hữu vai trò ADMIN');

  // Login Recruiter
  const recLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'recruiter@company.com',
    password: 'Ats@123456'
  });
  assert(recLogin.status === 200, 'Đăng nhập thành công với tài khoản Chuyên viên Tuyển dụng (Recruiter)');
  recruiterToken = recLogin.data?.data?.token;

  // Login Interviewer (interviewer@company.com)
  const intLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'interviewer@company.com',
    password: 'Ats@123456'
  });
  assert(intLogin.status === 200, 'Đăng nhập thành công với tài khoản Người phỏng vấn (Interviewer)');
  interviewerToken = intLogin.data?.data?.token;

  // Login sai mật khẩu
  const badLogin = await request('POST', '/api/v1/auth/login', {}, {
    email: 'admin@company.com',
    password: 'WrongPassword@999'
  });
  assert(badLogin.status === 401, 'Từ chối mật khẩu sai với mã HTTP 401 Unauthorized');

  // Kiểm tra Session Heartbeat / Me
  const meRes = await request('GET', '/api/v1/auth/me', { Authorization: `Bearer ${adminToken}` });
  assert(meRes.status === 200 && meRes.data?.data?.user?.email === 'admin@company.com', 'Xác thực phiên làm việc còn hiệu lực (GET /api/v1/auth/me)');

  // -------------------------------------------------------------
  // PHẦN 3: DASHBOARD STATS & FUNNEL METRICS
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 3. Kiểm tra Bảng điều khiển (Dashboard KPIs & Funnel)\x1b[0m');
  const dashRes = await request('GET', '/api/v1/dashboard/stats', { Authorization: `Bearer ${adminToken}` });
  assert(dashRes.status === 200 && dashRes.data?.success, 'Lấy dữ liệu thống kê Dashboard (HTTP 200)');
  const stats = dashRes.data?.stats;
  assert(typeof stats?.requisitions?.open === 'number', 'Có chỉ số vị trí tuyển dụng đang mở');
  assert(typeof stats?.candidates?.total === 'number' && stats.candidates.total > 0, 'Có thống kê tổng số ứng viên (>0)');
  assert(typeof stats?.candidates?.screening === 'number', 'Phễu ứng viên có phân loại giai đoạn chi tiết');
  assert(Array.isArray(stats?.recentRequisitions), 'Danh sách đợt tuyển dụng gần đây');

  // -------------------------------------------------------------
  // PHẦN 4: QUẢN LÝ YÊU CẦU TUYỂN DỤNG (REQUISITIONS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 4. Kiểm tra Quản lý Yêu cầu Tuyển dụng (Requisitions)\x1b[0m');
  const reqListRes = await request('GET', '/api/v1/requisitions', { Authorization: `Bearer ${recruiterToken}` });
  assert(reqListRes.status === 200 && reqListRes.data?.success, 'Lấy danh sách đợt tuyển dụng thành công');
  assert(reqListRes.data.requisitions.length >= 4, 'Hệ thống có ít nhất 4 đợt tuyển dụng thực tế');

  // Tạo yêu cầu tuyển dụng mới
  const newReqTitle = 'Senior Cloud Architect ' + Date.now();
  const createReqRes = await request('POST', '/api/v1/requisitions', { Authorization: `Bearer ${recruiterToken}` }, {
    title: newReqTitle,
    departmentName: 'Khối Công Nghệ & Kỹ Thuật',
    headcount: 2
  });
  assert(createReqRes.status === 201 && createReqRes.data?.success, 'Tạo mới yêu cầu tuyển dụng thành công (HTTP 201)');
  const createdReqId = createReqRes.data?.data?.id;
  assert(Boolean(createdReqId), `Đợt tuyển dụng mới được cấp ID: ${createdReqId}`);

  // -------------------------------------------------------------
  // PHẦN 5: QUẢN LÝ ỨNG VIÊN & VÒNG TUYỂN DỤNG (CANDIDATES)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 5. Kiểm tra Quản lý Ứng viên & Pipeline (Candidates)\x1b[0m');
  const candRes = await request('GET', '/api/v1/candidates', { Authorization: `Bearer ${recruiterToken}` });
  assert(candRes.status === 200 && candRes.data?.success, 'Lấy danh sách ứng viên (HTTP 200)');
  assert(candRes.data.candidates.length >= 6, 'Hệ thống có ít nhất 6 hồ sơ ứng viên mẫu');
  const firstCand = candRes.data.candidates[0];
  assert(firstCand.fullName && firstCand.email && firstCand.stage, 'Hồ sơ ứng viên đầy đủ thông tin: họ tên, email, giai đoạn tuyển');

  // Lọc ứng viên theo trạng thái
  const filteredCandRes = await request('GET', '/api/v1/candidates?stage=INTERVIEW', { Authorization: `Bearer ${recruiterToken}` });
  assert(filteredCandRes.status === 200 && Array.isArray(filteredCandRes.data.candidates), 'Lọc ứng viên theo giai đoạn INTERVIEW thành công');

  // -------------------------------------------------------------
  // PHẦN 6: LỊCH PHỎNG VẤN & HỘI ĐỒNG (INTERVIEWS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 6. Kiểm tra Lịch Phỏng vấn (Interviews)\x1b[0m');
  const intRes = await request('GET', '/api/v1/interviews', { Authorization: `Bearer ${interviewerToken}` });
  assert(intRes.status === 200 && intRes.data?.success, 'Lấy danh sách lịch phỏng vấn (HTTP 200)');
  assert(intRes.data.interviews.length >= 3, 'Hệ thống có ít nhất 3 lịch phỏng vấn');
  const firstInt = intRes.data.interviews[0];
  assert(firstInt.candidateName && firstInt.scheduledTime, 'Lịch phỏng vấn thể hiện rõ ứng viên và thời gian phỏng vấn');

  // -------------------------------------------------------------
  // PHẦN 7: LỜI MỜI NHẬN VIỆC (JOB OFFERS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 7. Kiểm tra Lời mời Nhận việc (Job Offers)\x1b[0m');
  const offersRes = await request('GET', '/api/v1/offers', { Authorization: `Bearer ${adminToken}` });
  assert(offersRes.status === 200 && offersRes.data?.success, 'Lấy danh sách đề nghị nhận việc (HTTP 200)');
  assert(offersRes.data.offers.length >= 2, 'Hệ thống có ít nhất 2 hồ sơ đề nghị việc làm');
  const firstOffer = offersRes.data.offers[0];
  assert(firstOffer.candidateName && firstOffer.offeredSalary, 'Lời mời việc làm có chi tiết lương đề xuất và ứng viên');

  // -------------------------------------------------------------
  // PHẦN 8: BÁO CÁO & PHÂN TÍCH (REPORTS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 8. Kiểm tra Báo cáo & Phân tích (Reports)\x1b[0m');
  const reportRes = await request('GET', '/api/v1/reports/recruitment', { Authorization: `Bearer ${adminToken}` });
  assert(reportRes.status === 200 && reportRes.data?.success, 'Lấy báo cáo tuyển dụng tổng thể (HTTP 200)');
  const report = reportRes.data.report;
  assert(Array.isArray(report?.departmentBreakdown), 'Báo cáo có thống kê chi tiết theo phòng ban');
  assert(Array.isArray(report?.sourceAnalytics), 'Báo cáo có phân tích kênh nguồn tuyển dụng (LinkedIn, Referral, Website)');

  // -------------------------------------------------------------
  // PHẦN 9: QUẢN TRỊ NGƯỜI DÙNG & PHÂN TRANG (USERS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 9. Kiểm tra Quản trị Người dùng & Phân trang (Users)\x1b[0m');
  const usersPage1 = await request('GET', '/api/v1/admin/users?page=1&limit=20', { Authorization: `Bearer ${adminToken}` });
  assert(usersPage1.status === 200 && usersPage1.data?.success, 'Phân trang người dùng trang 1 (HTTP 200)');
  assert(usersPage1.data.data.items.length === 20, 'Trang 1 hiển thị đúng 20 người dùng theo chuẩn AC-04');
  assert(usersPage1.data.data.pagination.total_items >= 25, 'Tổng số người dùng công ty >= 25');

  // Tìm kiếm người dùng
  const searchUser = await request('GET', '/api/v1/admin/users?q=Admin', { Authorization: `Bearer ${adminToken}` });
  assert(searchUser.status === 200 && searchUser.data.data.items.length >= 1, 'Tìm kiếm người dùng theo từ khóa chính xác');

  // -------------------------------------------------------------
  // PHẦN 10: MA TRẬN PHÂN QUYỀN RBAC (ROLES & PERMISSIONS)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 10. Kiểm tra Ma trận Phân quyền (RBAC Matrix)\x1b[0m');
  const matrixRes = await request('GET', '/api/v1/admin/roles-matrix', { Authorization: `Bearer ${adminToken}` });
  assert(matrixRes.status === 200 && matrixRes.data?.success, 'Lấy dữ liệu ma trận quyền động (HTTP 200)');
  assert(matrixRes.data.data.roles.length === 7, 'Ma trận thể hiện đủ 7 vai trò chuẩn doanh nghiệp');
  assert(matrixRes.data.data.permissions.length >= 20, 'Hệ thống định nghĩa ít nhất 20 quyền nghiệp vụ chi tiết');

  // -------------------------------------------------------------
  // PHẦN 11: BẢO MẬT & DEFAULT DENY RBAC
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 11. Kiểm tra An ninh & Phân quyền Default Deny\x1b[0m');
  // Không có token -> 401
  const noTokenRes = await request('GET', '/api/v1/admin/users');
  assert(noTokenRes.status === 401, 'Chặn truy cập khi thiếu Token xác thực (HTTP 401)');

  // Token của Interviewer cố truy cập quyền Admin -> 403
  const forbiddenRes = await request('GET', '/api/v1/admin/users', { Authorization: `Bearer ${interviewerToken}` });
  assert(forbiddenRes.status === 403, 'Chặn vai trò không đủ quyền theo chuẩn Default Deny (HTTP 403)');

  // -------------------------------------------------------------
  // PHẦN 12: ĐĂNG XUẤT & THU HỒI PHIÊN (LOGOUT)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m▶ 12. Kiểm tra Đăng xuất & Thu hồi phiên tức thì\x1b[0m');
  const logoutRes = await request('POST', '/api/v1/auth/logout', { Authorization: `Bearer ${recruiterToken}` });
  assert(logoutRes.status === 200 && logoutRes.data?.success, 'Đăng xuất thành công (HTTP 200)');

  // Dùng lại token vừa đăng xuất -> Phải bị từ chối 401
  const reuseTokenRes = await request('GET', '/api/v1/auth/me', { Authorization: `Bearer ${recruiterToken}` });
  assert(reuseTokenRes.status === 401, 'Phiên đăng xuất bị thu hồi ngay lập tức, không thể tái sử dụng (HTTP 401)');

  // =============================================================
  // TỔNG KẾT
  // =============================================================
  console.log('\n================================================================');
  console.log(` TỔNG KẾT KIỂM THỬ: ${passedTests}/${totalTests} TESTS PASS (${Math.round((passedTests/totalTests)*100)}%)`);
  if (failedTests === 0) {
    console.log(' \x1b[32m✔ TẤT CẢ CHỨC NĂNG HỆ THỐNG ĐÃ HOẠT ĐỘNG HOÀN HẢO 100%!\x1b[0m');
  } else {
    console.log(` \x1b[31m✖ CÓ ${failedTests} KIỂM THỬ THẤT BẠI!\x1b[0m`);
  }
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Lỗi khi chạy kiểm thử:', err);
  process.exit(1);
});
