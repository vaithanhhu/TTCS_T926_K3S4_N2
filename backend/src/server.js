const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config/config');
const { getDatabase } = require('./db/database');
const { seedDatabase, ensureDepartmentFeature, ensureCompetencyFeature, ensureQuestionBankFeature, ensureRecruitmentCatalogFeature, ensureCareerPageFeature, ensureRequisitionDraftFeature } = require('./db/seed');
const AuthController = require('./controllers/authController');
const RbacMiddleware = require('./middlewares/rbacMiddleware');
const UserService = require('./services/userService');
const UserController = require('./controllers/userController');
const RequisitionService = require('./services/requisitionService');
const AvatarService = require('./services/avatarService');
const DepartmentService = require('./services/departmentService');
const CompetencyService = require('./services/competencyService');
const QuestionBankService = require('./services/questionBankService');
const RecruitmentCatalogService = require('./services/recruitmentCatalogService');
const CareerPageService = require('./services/careerPageService');

// Ensure DB is initialized and seeded
const db = getDatabase();
const isTestEnv = process.env.NODE_ENV === 'test' || (process.argv[1] && (process.argv[1].includes('tests') || process.argv[1].includes('test_s1_')));
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (isTestEnv || userCount === 0) {
  seedDatabase(db);
} else {
  ensureDepartmentFeature(db);
  ensureCompetencyFeature(db);
  ensureQuestionBankFeature(db);
  ensureRecruitmentCatalogFeature(db);
  ensureCareerPageFeature(db);
  ensureRequisitionDraftFeature(db);
}

const authController = new AuthController();
const rbacMiddleware = new RbacMiddleware(db);
const userService = new UserService(db);
const userController = new UserController(userService, rbacMiddleware, authController.authService);
const requisitionService = new RequisitionService(db);
const avatarService = new AvatarService();
const departmentService = new DepartmentService(db);
const competencyService = new CompetencyService(db);
const questionBankService = new QuestionBankService(db);
const recruitmentCatalogService = new RecruitmentCatalogService(db);
const careerPageService = new CareerPageService(db);

function canReadJobTitleSalary(user) {
  return user.roles.includes('HR_MANAGER') && rbacMiddleware.hasPermission(user.id, 'salary_range.read');
}

function denyJobTitleSalary(res) {
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Chỉ Trưởng phòng Nhân sự được khai báo và xem dải lương.' }));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    const maxBytes = 5 * 1024 * 1024; // 5MB

    req.on('data', chunk => {
      if (rejected) return;
      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        rejected = true;
        chunks.length = 0;
        reject(new Error('Payload too large'));
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}
function parseCareerImageBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    const maxBytes = 2 * 1024 * 1024;

    req.on('data', chunk => {
      if (rejected) return;

      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        rejected = true;
        chunks.length = 0;
        reject(new Error('Career image too large'));
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks));
      }
    });

    req.on('error', err => {
      if (!rejected) {
        reject(err);
      }
    });
  });
}
function parseAvatarBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    const maxBytes = 2 * 1024 * 1024; // 2MB

    req.on('data', chunk => {
      if (rejected) return;

      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        rejected = true;
        chunks.length = 0;
        reject(new Error('Avatar too large'));
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks));
      }
    });

    req.on('error', err => {
      if (!rejected) {
        reject(err);
      }
    });
  });
}
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. API: Health Check
  if (req.method === 'GET' && pathname === '/api/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'ats-backend', sprint: 1 }));
    return;
  }

  // 2. API: S1-01 Login
  if (req.method === 'POST' && (pathname === '/api/v1/auth/login' || pathname === '/auth/login')) {
    try {
      const body = await parseBody(req);
      await authController.handleLogin(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 3. API: S1-02 Logout (AC-02)
  if (req.method === 'POST' && (pathname === '/api/v1/auth/logout' || pathname === '/auth/logout')) {
    try {
      const body = await parseBody(req);
      await authController.handleLogout(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 4. API: S1-02 Validate Session & Get Current User (AC-01 & AC-03)
  if (req.method === 'GET' && (pathname === '/api/v1/auth/me' || pathname === '/auth/me')) {
    await authController.handleGetMe(req, res);
    return;
  }

  // 5. API: S1-03 Request Forgot Password (AC-01 & AC-03)
  if (req.method === 'POST' && (pathname === '/api/v1/auth/forgot-password' || pathname === '/auth/forgot-password')) {
    try {
      const body = await parseBody(req);
      await authController.handleForgotPassword(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 6. API: S1-03 Verify Reset Token (AC-01 & AC-02)
  if (req.method === 'GET' && (pathname === '/api/v1/auth/verify-reset-token' || pathname === '/auth/verify-reset-token')) {
    const token = parsedUrl.searchParams.get('token') || '';
    await authController.handleVerifyResetToken(req, res, token);
    return;
  }

  // 6b. API: Verify OTP (6-digit code)
  if (req.method === 'POST' && (pathname === '/api/v1/auth/verify-otp' || pathname === '/auth/verify-otp')) {
    try {
      const body = await parseBody(req);
      await authController.handleVerifyOtp(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 6c. API: Resend / Send OTP
  if (req.method === 'POST' && (pathname === '/api/v1/auth/resend-otp' || pathname === '/auth/resend-otp' || pathname === '/api/v1/auth/send-otp' || pathname === '/auth/send-otp')) {
    try {
      const body = await parseBody(req);
      await authController.handleResendOtp(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 7. API: S1-03 Reset Password (AC-01 & AC-02)
  if (req.method === 'POST' && (pathname === '/api/v1/auth/reset-password' || pathname === '/auth/reset-password')) {
    try {
      const body = await parseBody(req);
      await authController.handleResetPassword(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 8. API: S1-04 Change Password (AC-01, AC-02, AC-03)
  if (req.method === 'POST' && (pathname === '/api/v1/auth/change-password' || pathname === '/auth/change-password')) {
    try {
      const body = await parseBody(req);
      await authController.handleChangePassword(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 9. API: S1-05 Get Current User Permissions (AC-01)
  if (req.method === 'GET' && (pathname === '/api/v1/auth/permissions' || pathname === '/auth/permissions')) {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 401,
        message: 'Yêu cầu thiếu token xác thực.',
        code: 'UNAUTHORIZED',
        recovery: {
          action: 'LOGIN',
          suggestedPath: '/login',
          label: 'Đăng nhập lại'
        }
      }));
      return;
    }
    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: sessionResult.statusCode || 401,
        message: sessionResult.message,
        code: sessionResult.code,
        recovery: {
          action: 'LOGIN',
          suggestedPath: '/login',
          label: 'Đăng nhập lại'
        }
      }));
      return;
    }
    const permissions = rbacMiddleware.getUserPermissions(sessionResult.user.id);
    const details = rbacMiddleware.getUserPermissionDetails(sessionResult.user.id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, permissions, details, roles: sessionResult.user.roles }));
    return;
  }

  // 9.1 API: Get Current User Profile
  if (req.method === 'GET' && (pathname === '/api/v1/profile' || pathname === '/profile')) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 401, message: 'Yêu cầu thiếu token xác thực.', code: 'UNAUTHORIZED' }));
      return;
    }
    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: sessionResult.statusCode || 401, message: sessionResult.message, code: sessionResult.code }));
      return;
    }
    const userProfile = userService.getUserById(sessionResult.user.id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: userProfile }));
    return;
  }

  // 9.2 API: Update Current User Profile
  if (req.method === 'PUT' && ['/api/v1/profile', '/profile', '/api/v1/profile/personal', '/profile/personal'].includes(pathname)) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 401, message: 'Yêu cầu thiếu token xác thực.', code: 'UNAUTHORIZED' }));
      return;
    }
    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: sessionResult.statusCode || 401, message: sessionResult.message, code: sessionResult.code }));
      return;
    }
    try {
      const body = await parseBody(req);
      const updateResult = userService.updateProfile(sessionResult.user.id, {
        fullName: body.fullName,
        jobTitle: body.jobTitle,
        phoneNumber: body.phoneNumber
      }, { validatePhone: pathname.endsWith('/personal') });
      res.writeHead(updateResult.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(updateResult));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // S2: Upload current user's avatar
  if (req.method === 'POST' && (
      pathname === '/api/v1/profile/avatar' ||
      pathname === '/profile/avatar'
    )) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 401,
        message: 'Yêu cầu thiếu token xác thực.',
        code: 'UNAUTHORIZED'
      }));
      return;
    }

    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);

    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: sessionResult.statusCode || 401,
        message: sessionResult.message,
        code: sessionResult.code
      }));
      return;
    }

    try {
      const imageBuffer = await parseAvatarBody(req);

      const result = await avatarService.saveAvatar(
        sessionResult.user.id,
        imageBuffer,
        req.headers['content-type']
      );

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      const tooLarge = err.message === 'Avatar too large';

      res.writeHead(tooLarge ? 413 : 400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: tooLarge ? 413 : 400,
        code: tooLarge ? 'AVATAR_TOO_LARGE' : 'INVALID_AVATAR_UPLOAD',
        message: tooLarge
          ? 'Ảnh đại diện vượt quá giới hạn 2MB.'
          : 'Không thể đọc dữ liệu ảnh đại diện.'
      }));
    }

    return;
  }
  // 10. API: S1-05 Get Full RBAC Matrix (AC-01)
  if (req.method === 'GET' && (pathname === '/api/v1/rbac/matrix' || pathname === '/rbac/matrix' || pathname === '/api/v1/admin/roles-matrix' || pathname === '/admin/roles-matrix')) {
    const rawMatrix = rbacMiddleware.getRbacMatrix();
    const roles = db.prepare('SELECT id, code AS name, name AS description FROM roles ORDER BY code ASC').all();
    const permissions = db.prepare('SELECT id, code AS name, name AS description, module FROM permissions ORDER BY module, code ASC').all();
    const simpleMatrix = {};
    for (const [code, info] of Object.entries(rawMatrix)) {
      simpleMatrix[code] = info.permissions;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      matrix: rawMatrix,
      data: {
        roles,
        permissions,
        matrix: simpleMatrix
      }
    }));
    return;
  }


  // 11. API: S1-05 Protected Action Demo 1 - User Create (requires user.create) (AC-02 & AC-03)
  if (req.method === 'POST' && (pathname === '/api/v1/admin/users/test-create' || pathname === '/admin/users/test-create')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'user.create');
    if (!user) return; // Handled by authorize with 401 or 403
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      message: 'Thao tác tạo người dùng thành công (quyền user.create hợp lệ).',
      code: 'USER_CREATED_SUCCESS',
      authorizedUser: user.email
    }));
    return;
  }

  // 11.1 S1-08: Get Roles List for Dropdown / Filter (AC-03)
  if (req.method === 'GET' && (pathname === '/api/v1/admin/roles/list' || pathname === '/admin/roles/list')) {
    await userController.handleGetRoles(req, res);
    return;
  }

  // 11.2 S1-08: Get Users with Pagination, Search & Filter (AC-03 & AC-04)
  if (req.method === 'GET' && (pathname === '/api/v1/admin/users' || pathname === '/admin/users')) {
    await userController.handleGetUsers(req, res, parsedUrl);
    return;
  }

  // S2: Import valid users from Excel and skip invalid rows
  if (req.method === 'POST' && (
      pathname === '/api/v1/admin/users/import' ||
      pathname === '/admin/users/import'
    )) {
    if (!rbacMiddleware.authorize(req, res, authController.authService, 'user.create')) return;
    try {
      const fileBuffer = await parseBinaryBody(req);

      await userController.handleImportBulkUsers(
        req,
        res,
        fileBuffer
      );
    } catch (err) {
      res.writeHead(err.message === 'Payload too large' ? 413 : 400, {
        'Content-Type': 'application/json; charset=utf-8'
      });

      res.end(JSON.stringify({
        success: false,
        statusCode: err.message === 'Payload too large' ? 413 : 400,
        message: err.message === 'Payload too large'
          ? 'Tệp Excel vượt quá giới hạn 5MB.'
          : 'Không thể đọc dữ liệu tệp Excel.',
        code: err.message === 'Payload too large'
          ? 'EXCEL_FILE_TOO_LARGE'
          : 'INVALID_EXCEL_UPLOAD'
      }));
    }

    return;
  }
  // S2: Preview Excel file before bulk user import
  if (req.method === 'POST' && (
      pathname === '/api/v1/admin/users/import/preview' ||
      pathname === '/admin/users/import/preview'
    )) {
    if (!rbacMiddleware.authorize(req, res, authController.authService, 'user.create')) return;
    try {
      const fileBuffer = await parseBinaryBody(req);
      await userController.handlePreviewBulkUserImport(
        req,
        res,
        fileBuffer
      );
    } catch (err) {
      res.writeHead(err.message === 'Payload too large' ? 413 : 400, {
        'Content-Type': 'application/json; charset=utf-8'
      });

      res.end(JSON.stringify({
        success: false,
        statusCode: err.message === 'Payload too large' ? 413 : 400,
        message: err.message === 'Payload too large'
          ? 'Tệp Excel vượt quá giới hạn 5MB.'
          : 'Không thể đọc dữ liệu tệp Excel.',
        code: err.message === 'Payload too large'
          ? 'EXCEL_FILE_TOO_LARGE'
          : 'INVALID_EXCEL_UPLOAD'
      }));
    }

    return;
  }
  // S2: Download Excel template for bulk user import
  if (req.method === 'GET' && (
      pathname === '/api/v1/admin/users/import/template' ||
      pathname === '/admin/users/import/template'
    )) {
    await userController.handleDownloadBulkUserTemplate(req, res);
    return;
  }
  // 11.3 S1-08: Create User with Temporary Password & Duplicate Email Check (AC-01 & AC-02)
  if (req.method === 'POST' && (pathname === '/api/v1/admin/users' || pathname === '/admin/users')) {
    try {
      const body = await parseBody(req);
      await userController.handleCreateUser(req, res, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 11.4 S1-09: Get User Roles (AC-01)
  if (req.method === 'GET' && ((pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/roles')) || (pathname.startsWith('/admin/users/') && pathname.endsWith('/roles')))) {
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '').replace(/\/roles$/, '');
    await userController.handleGetUserRoles(req, res, userId);
    return;
  }

  // 11.5 S1-09: Assign User Roles (AC-01, AC-02, AC-03)
  if (req.method === 'PUT' && ((pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/roles')) || (pathname.startsWith('/admin/users/') && pathname.endsWith('/roles')))) {
    try {
      const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '').replace(/\/roles$/, '');
      const body = await parseBody(req);
      await userController.handleAssignUserRoles(req, res, userId, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 11.6 S1-10: Lock User Account (AC-01, AC-02, AC-03)
  if (req.method === 'POST' && ((pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/lock')) || (pathname.startsWith('/admin/users/') && pathname.endsWith('/lock')))) {
    try {
      const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '').replace(/\/lock$/, '');
      const body = await parseBody(req);
      await userController.handleLockUser(req, res, userId, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 11.7 S1-10: Unlock User Account (S1-10)
  if (req.method === 'POST' && ((pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/unlock')) || (pathname.startsWith('/admin/users/') && pathname.endsWith('/unlock')))) {
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '').replace(/\/unlock$/, '');
    await userController.handleUnlockUser(req, res, userId);
    return;
  }

  // 11.8 S1-08: Get Single User Details (AC-03)
  if (req.method === 'GET' && (pathname.startsWith('/api/v1/admin/users/') || pathname.startsWith('/admin/users/')) && !pathname.endsWith('/test-create') && !pathname.endsWith('/roles') && !pathname.endsWith('/lock') && !pathname.endsWith('/unlock')) {
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '');
    await userController.handleGetUserById(req, res, userId);
    return;
  }

  // 11.9 S1-08: Update User Information (AC-03)
  if (req.method === 'PUT' && (pathname.startsWith('/api/v1/admin/users/') || pathname.startsWith('/admin/users/')) && !pathname.endsWith('/roles') && !pathname.endsWith('/lock') && !pathname.endsWith('/unlock') && !pathname.endsWith('/reset-password')) {
    try {
      const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '');
      const body = await parseBody(req);
      await userController.handleUpdateUser(req, res, userId, body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu yêu cầu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 11.10 Reset User Password (Admin)
  if (req.method === 'POST' && ((pathname.startsWith('/api/v1/admin/users/') && pathname.endsWith('/reset-password')) || (pathname.startsWith('/admin/users/') && pathname.endsWith('/reset-password')))) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'user.create');
    if (!user) return;
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '').replace(/\/reset-password$/, '');
    const result = userService.resetUserPassword(userId, user);
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 11.11 Delete User Account (Admin)
  if (req.method === 'DELETE' && (pathname.startsWith('/api/v1/admin/users/') || pathname.startsWith('/admin/users/')) && !pathname.endsWith('/roles') && !pathname.endsWith('/lock') && !pathname.endsWith('/unlock') && !pathname.endsWith('/reset-password')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'user.create');
    if (!user) return;
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '');
    const result = userService.deleteUser(userId, user);
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 12. API: S1-05 Protected Action Demo 2 - Candidate List (requires candidate.read) (AC-02 & AC-03)
  if (req.method === 'GET' && (pathname === '/api/v1/recruitment/candidates/test-list' || pathname === '/recruitment/candidates/test-list')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'candidate.read');
    if (!user) return;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      message: 'Truy cập danh sách ứng viên thành công (quyền candidate.read hợp lệ).',
      code: 'CANDIDATE_LIST_SUCCESS',
      authorizedUser: user.email
    }));
    return;
  }

  // 13. API: S1-05 Protected Action Demo 3 - Interview List (requires interview.read) (AC-02 & AC-03)
  if (req.method === 'GET' && (pathname === '/api/v1/interviews/test-list' || pathname === '/interviews/test-list')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'interview.read');
    if (!user) return;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      message: 'Truy cập lịch phỏng vấn thành công (quyền interview.read hợp lệ).',
      code: 'INTERVIEW_LIST_SUCCESS',
      authorizedUser: user.email
    }));
    return;
  }

  // 13.1 API: Real Enterprise Dashboard Statistics
  if (req.method === 'GET' && (pathname === '/api/v1/dashboard/stats' || pathname === '/dashboard/stats' || pathname === '/api/v1/requisitions/dashboard-stats' || pathname === '/requisitions/dashboard-stats')) {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 401,
        message: 'Yêu cầu thiếu token xác thực.',
        code: 'UNAUTHORIZED'
      }));
      return;
    }
    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: sessionResult.statusCode || 401,
        message: sessionResult.message,
        code: sessionResult.code
      }));
      return;
    }

    const stats = requisitionService.getDashboardStats();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(stats));
    return;
  }

  // S2: Recruitment Shared Catalog
  if (req.method === 'GET' && (
    pathname === '/api/v1/recruitment-catalogs' ||
    pathname === '/recruitment-catalogs'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.read'
    );
    if (!user) return;

    const type = parsedUrl.searchParams.get('type');
    const status = parsedUrl.searchParams.get('status');

    const result = recruitmentCatalogService.getItems(type, { status });
    res.writeHead(result.statusCode || 200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && (
    pathname === '/api/v1/recruitment-catalogs' ||
    pathname === '/recruitment-catalogs'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    );
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = recruitmentCatalogService.createItem(body);

      res.writeHead(result.statusCode || 201, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu không hợp lệ.'
      }));
    }
    return;
  }

  if (req.method === 'PUT' && (
    pathname.startsWith('/api/v1/recruitment-catalogs/') ||
    pathname.startsWith('/recruitment-catalogs/')
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    );
    if (!user) return;

    const itemId = pathname
      .replace(/^\/api\/v1\/recruitment-catalogs\//, '')
      .replace(/^\/recruitment-catalogs\//, '');

    if (itemId === 'reorder') {
      res.writeHead(405, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 405,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Phương thức không được hỗ trợ.'
      }));
      return;
    }

    try {
      const body = await parseBody(req);
      const result = recruitmentCatalogService.updateItem(itemId, body);

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu không hợp lệ.'
      }));
    }
    return;
  }

  if (req.method === 'PATCH' && (
    pathname === '/api/v1/recruitment-catalogs/reorder' ||
    pathname === '/recruitment-catalogs/reorder'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    );
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = recruitmentCatalogService.reorderItems(
        body.type,
        body.orderedIds
      );

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu không hợp lệ.'
      }));
    }
    return;
  }

  if (req.method === 'DELETE' && (
    pathname.startsWith('/api/v1/recruitment-catalogs/') ||
    pathname.startsWith('/recruitment-catalogs/')
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    );
    if (!user) return;

    const itemId = pathname
      .replace(/^\/api\/v1\/recruitment-catalogs\//, '')
      .replace(/^\/recruitment-catalogs\//, '');

    const result = recruitmentCatalogService.deleteItem(itemId);

    res.writeHead(result.statusCode || 200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }
  // S2: CAREER PAGE CONFIGURATION

  // Public Career Page configuration
  if (req.method === 'GET' && (
    pathname === '/api/v1/public/career-page' ||
    pathname === '/public/career-page'
  )) {
    const result = careerPageService.getSettings();

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  // HR/Admin: Get Career Page configuration
  if (req.method === 'GET' && (
    pathname === '/api/v1/career-page' ||
    pathname === '/career-page'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'career_page.read'
    );
    if (!user) return;

    const result = careerPageService.getSettings();

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  // HR/Admin: Save Career Page configuration
  if (req.method === 'PUT' && (
    pathname === '/api/v1/career-page' ||
    pathname === '/career-page'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'career_page.manage'
    );
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = careerPageService.saveSettings(body);

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu cấu hình trang tuyển dụng không hợp lệ.'
      }));
    }

    return;
  }

  // HR/Admin: Upload Career Page logo / hero image
  if (req.method === 'POST' && (
    pathname === '/api/v1/career-page/media' ||
    pathname === '/career-page/media'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'career_page.manage'
    );
    if (!user) return;

    try {
      const kind = parsedUrl.searchParams.get('kind');
      const imageBuffer = await parseCareerImageBody(req);

      const result = await careerPageService.saveMedia(
        kind,
        imageBuffer,
        req.headers['content-type']
      );

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      const tooLarge = err.message === 'Career image too large';

      res.writeHead(tooLarge ? 413 : 400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: tooLarge ? 413 : 400,
        code: tooLarge
          ? 'CAREER_IMAGE_TOO_LARGE'
          : 'INVALID_CAREER_IMAGE_UPLOAD',
        message: tooLarge
          ? 'Ảnh không được vượt quá 2MB.'
          : 'Không thể đọc dữ liệu ảnh trang tuyển dụng.'
      }));
    }

    return;
  }
  // Minimal read-only choices for the existing requisition.create permission.
  // This grants no access to the department administration API or manager details.
  if (req.method === 'GET' && pathname === '/api/v1/requisitions/options') {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'requisition.create');
    if (!user) return;
    if (['jobTitleId', 'proposedSalaryMin', 'proposedSalaryMax'].some(key => parsedUrl.searchParams.has(key))) {
      const result = requisitionService.checkS210SalaryRange({
        jobTitleId: parsedUrl.searchParams.get('jobTitleId'),
        proposedSalaryMin: parsedUrl.searchParams.get('proposedSalaryMin'),
        proposedSalaryMax: parsedUrl.searchParams.get('proposedSalaryMax')
      });
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      return;
    }
    const departments = db.prepare("SELECT id, name, parent_id AS parentId, status FROM departments WHERE status = 'ACTIVE' ORDER BY name").all();
    const s210Departments = db.prepare(`SELECT id, name, parent_id AS parentId, status FROM departments
      WHERE status='ACTIVE' AND (?=1 OR manager_id=?) ORDER BY name`).all(user.roles.includes('HR_MANAGER') ? 1 : 0, user.id);
    const salaryColumns = canReadJobTitleSalary(user) ? ', min_salary AS minSalary, max_salary AS maxSalary' : '';
    const jobTitles = db.prepare(`SELECT id, code, name, level${salaryColumns} FROM job_titles WHERE status='ACTIVE' ORDER BY name`).all();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, tree: departmentService.buildTree(departments), s210Departments, jobTitles }));
    return;
  }

  // S2: Department & Organization Management
  if (req.method === 'GET' && (pathname === '/api/v1/departments' || pathname === '/departments')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'department.read');
    if (!user) return;

    const result = departmentService.getDepartments();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/v1/departments' || pathname === '/departments')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'department.manage');
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = departmentService.createDepartment(body);
      res.writeHead(result.statusCode || 201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu không hợp lệ.'
      }));
    }
    return;
  }

  if (req.method === 'PUT' && (
    pathname.startsWith('/api/v1/departments/') ||
    pathname.startsWith('/departments/')
  )) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'department.manage');
    if (!user) return;

    const departmentId = pathname
      .replace(/^\/api\/v1\/departments\//, '')
      .replace(/^\/departments\//, '');

    try {
      const body = await parseBody(req);
      const result = departmentService.updateDepartment(departmentId, body);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu không hợp lệ.'
      }));
    }
    return;
  }

  if (req.method === 'PATCH' && (
    pathname.endsWith('/deactivate') &&
    (pathname.startsWith('/api/v1/departments/') || pathname.startsWith('/departments/'))
  )) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'department.manage');
    if (!user) return;

    const departmentId = pathname
      .replace(/^\/api\/v1\/departments\//, '')
      .replace(/^\/departments\//, '')
      .replace(/\/deactivate$/, '');

    const result = departmentService.deactivateDepartment(departmentId);
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'DELETE' && (
    pathname.startsWith('/api/v1/departments/') ||
    pathname.startsWith('/departments/')
  )) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'department.manage');
    if (!user) return;

    const departmentId = pathname
      .replace(/^\/api\/v1\/departments\//, '')
      .replace(/^\/departments\//, '');

    const result = departmentService.deleteDepartment(departmentId);
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }
  // S2: Competency Framework & Job Title Management
  if (req.method === 'GET' && (
    pathname === '/api/v1/competency-frameworks' ||
    pathname === '/competency-frameworks'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.read'
    );
    if (!user) return;

    const result = competencyService.getFrameworks();

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && (
    pathname === '/api/v1/competency-frameworks' ||
    pathname === '/competency-frameworks'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    );
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = competencyService.createFramework(body);

      res.writeHead(result.statusCode || 201, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu khung năng lực không hợp lệ.'
      }));
    }

    return;
  }

  if (req.method === 'PUT' && (
    pathname.startsWith('/api/v1/competency-frameworks/') ||
    pathname.startsWith('/competency-frameworks/')
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    );
    if (!user) return;

    const frameworkId = pathname
      .replace(/^\/api\/v1\/competency-frameworks\//, '')
      .replace(/^\/competency-frameworks\//, '');

    try {
      const body = await parseBody(req);
      const result = competencyService.updateFramework(
        frameworkId,
        body
      );

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu khung năng lực không hợp lệ.'
      }));
    }

    return;
  }

  if (req.method === 'GET' && (
    pathname === '/api/v1/job-titles' ||
    pathname === '/job-titles'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.read'
    );
    if (!user) return;

    const result = competencyService.getJobTitles({ includeSalary: canReadJobTitleSalary(user) });

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && (
    pathname === '/api/v1/job-titles' ||
    pathname === '/job-titles'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    );
    if (!user) return;

    try {
      const body = await parseBody(req);
      if (!canReadJobTitleSalary(user)) { denyJobTitleSalary(res); return; }
      const result = competencyService.createJobTitle(body, { includeSalary: true });

      res.writeHead(result.statusCode || 201, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu chức danh không hợp lệ.'
      }));
    }

    return;
  }

  if (req.method === 'PUT' && (
    pathname.startsWith('/api/v1/job-titles/') ||
    pathname.startsWith('/job-titles/')
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    );
    if (!user) return;

    const jobTitleId = pathname
      .replace(/^\/api\/v1\/job-titles\//, '')
      .replace(/^\/job-titles\//, '');

    try {
      const body = await parseBody(req);
      if ((Object.hasOwn(body, 'minSalary') || Object.hasOwn(body, 'maxSalary')) && !canReadJobTitleSalary(user)) {
        denyJobTitleSalary(res); return;
      }
      const result = competencyService.updateJobTitle(
        jobTitleId,
        body,
        { includeSalary: canReadJobTitleSalary(user) }
      );

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu chức danh không hợp lệ.'
      }));
    }

    return;
  }

  if (req.method === 'GET' && (
    (
      pathname.startsWith('/api/v1/job-titles/') &&
      pathname.endsWith('/framework')
    ) ||
    (
      pathname.startsWith('/job-titles/') &&
      pathname.endsWith('/framework')
    )
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.read'
    );
    if (!user) return;

    const jobTitleId = pathname
      .replace(/^\/api\/v1\/job-titles\//, '')
      .replace(/^\/job-titles\//, '')
      .replace(/\/framework$/, '');

    const result =
      competencyService.getFrameworkForJobTitle(jobTitleId);

    res.writeHead(result.statusCode || 200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }
  // S2: Interview Question Bank Filter Options
  if (req.method === 'GET' && (
    pathname === '/api/v1/interview-question-filters' ||
    pathname === '/interview-question-filters'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.read'
    );
    if (!user) return;

    const result = questionBankService.getFilterOptions();

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  // S2: Interview Question Bank
  if (req.method === 'GET' && (
    pathname === '/api/v1/interview-questions' ||
    pathname === '/interview-questions'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.read'
    );
    if (!user) return;

    const options = {
      search: parsedUrl.searchParams.get('search') || '',
      jobTitleId: parsedUrl.searchParams.get('jobTitleId') || '',
      criterionId: parsedUrl.searchParams.get('criterionId') || '',
      difficulty: parsedUrl.searchParams.get('difficulty') || 'ALL',
      status: parsedUrl.searchParams.get('status') || 'ALL'
    };

    const result = questionBankService.getQuestions(options);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && (
    pathname === '/api/v1/interview-questions' ||
    pathname === '/interview-questions'
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.manage'
    );
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = questionBankService.createQuestion(body);

      res.writeHead(result.statusCode || 201, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu câu hỏi phỏng vấn không hợp lệ.'
      }));
    }

    return;
  }

  if (req.method === 'PUT' && (
    pathname.startsWith('/api/v1/interview-questions/') ||
    pathname.startsWith('/interview-questions/')
  )) {
    const user = rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.manage'
    );
    if (!user) return;

    const questionId = pathname
      .replace(/^\/api\/v1\/interview-questions\//, '')
      .replace(/^\/interview-questions\//, '');

    try {
      const body = await parseBody(req);

      const result = questionBankService.updateQuestion(
        questionId,
        body
      );

      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Dữ liệu câu hỏi phỏng vấn không hợp lệ.'
      }));
    }

    return;
  }

  // 13.2 API: Real Recruitment Requisitions List
  if (req.method === 'GET' && (pathname === '/api/v1/requisitions' || pathname === '/requisitions')) {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 401,
        message: 'Yêu cầu thiếu token xác thực.',
        code: 'UNAUTHORIZED'
      }));
      return;
    }
    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: sessionResult.statusCode || 401,
        message: sessionResult.message,
        code: sessionResult.code
      }));
      return;
    }

    const options = {
      search: parsedUrl.searchParams.get('search') || '',
      status: parsedUrl.searchParams.get('status') || '',
      handoverOnly: parsedUrl.searchParams.get('handoverOnly') === 'true',
      viewerId: sessionResult.user.id,
      canReadS210: rbacMiddleware.hasPermission(sessionResult.user.id, 'requisition.read')
    };
    const result = requisitionService.getRequisitions(options);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.3 API: Create Requisition
  if (req.method === 'POST' && (pathname === '/api/v1/requisitions' || pathname === '/requisitions')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'requisition.create');
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = requisitionService.createRequisition(body, user);
      res.writeHead(result.statusCode || 201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.4 API: Reassign Handover Requisition
  if (req.method === 'PUT' && ((pathname.startsWith('/api/v1/requisitions/') && pathname.endsWith('/handover')) || (pathname.startsWith('/requisitions/') && pathname.endsWith('/handover')))) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'requisition.edit');
    if (!user) return;
    try {
      const reqId = pathname.replace(/^\/api\/v1\/requisitions\//, '').replace(/^\/requisitions\//, '').replace(/\/handover$/, '');
      const body = await parseBody(req);
      const result = requisitionService.reassignHandover(reqId, body.newRecruiterId, body.notes);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.4.1 API: Get Single Requisition Details
  if (req.method === 'GET' && (pathname.startsWith('/api/v1/requisitions/') || pathname.startsWith('/requisitions/')) && !pathname.endsWith('/handover') && !pathname.endsWith('/dashboard-stats')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'requisition.read');
    if (!user) return;
    const reqId = pathname.replace(/^\/api\/v1\/requisitions\//, '').replace(/^\/requisitions\//, '');
    const item = requisitionService.getRequisitionById(reqId);
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 404, message: 'Không tìm thấy vị trí tuyển dụng.' }));
      return;
    }
    if (item.formVersion === 'S2-10' && item.status === 'DRAFT' && item.createdBy !== user.id) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, code: 'REQUISITION_DRAFT_FORBIDDEN', message: 'Bạn chỉ được đọc nháp do mình tạo.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: item }));
    return;
  }

  // 13.4.2 API: Update Requisition Details
  if (req.method === 'PUT' && (pathname.startsWith('/api/v1/requisitions/') || pathname.startsWith('/requisitions/')) && !pathname.endsWith('/handover')) {
    const reqId = pathname.replace(/^\/api\/v1\/requisitions\//, '').replace(/^\/requisitions\//, '');
    const current = requisitionService.getRequisitionById(reqId);
    const isS210Draft = current?.formVersion === 'S2-10' && current.status === 'DRAFT';
    const user = rbacMiddleware.authorize(req, res, authController.authService, isS210Draft ? 'requisition.draft.edit' : 'requisition.edit');
    if (!user) return;
    if (isS210Draft && current.createdBy !== user.id) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, code: 'REQUISITION_DRAFT_FORBIDDEN', message: 'Bạn chỉ được sửa nháp do mình tạo.' }));
      return;
    }
    try {
      const body = await parseBody(req);
      const result = requisitionService.updateRequisition(reqId, body, user);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.5 API: Get Email Logs (Admin)
  if (req.method === 'GET' && (pathname === '/api/v1/admin/email-logs' || pathname === '/admin/email-logs')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'audit.read');
    if (!user) return;
    const logs = db.prepare('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 50').all();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, total: logs.length, logs }));
    return;
  }

  // 13.6 API: Get Audit Logs (Admin)
  if (req.method === 'GET' && (pathname === '/api/v1/admin/audit-logs' || pathname === '/admin/audit-logs')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'audit.read');
    if (!user) return;
    const search = (parsedUrl.searchParams.get('search') || '').trim();
    const status = (parsedUrl.searchParams.get('status') || '').trim();
    const limit = Math.min(Math.max(parseInt(parsedUrl.searchParams.get('limit')) || 50, 1), 200);

    let query = 'SELECT * FROM login_audit_logs';
    const conditions = [];
    const params = [];

    if (status && status !== 'ALL') {
      conditions.push('status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(email LIKE ? OR reason LIKE ? OR ip_address LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY attempted_at DESC LIMIT ?';
    params.push(limit);

    const logs = db.prepare(query).all(...params);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, total: logs.length, logs, data: { logs } }));
    return;
  }

  // 13.6.1 API: Get Single Audit Log Detail (Admin)
  if (req.method === 'GET' && (pathname.startsWith('/api/v1/admin/audit-logs/') || pathname.startsWith('/admin/audit-logs/'))) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'audit.read');
    if (!user) return;
    const logId = pathname.split('/').pop();
    const log = db.prepare('SELECT * FROM login_audit_logs WHERE id = ?').get(logId);
    if (!log) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 404, message: 'Không tìm thấy bản ghi nhật ký.' }));
      return;
    }

    // Enrich with associated user details if available
    const userInfo = db.prepare('SELECT id, full_name, email, department_name, status, failed_attempts, locked_until FROM users WHERE email = ?').get(log.email);
    let roles = [];
    if (userInfo) {
      roles = db.prepare(`
        SELECT r.code, r.name 
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `).all(userInfo.id);
    }

    // Determine security risk and event classification
    let riskLevel = 'LOW';
    let riskLabel = 'Thấp (An toàn)';
    let eventType = 'AUTH_LOGIN';

    if (log.status === 'LOCKED' || log.status === 'ACCOUNT_LOCKED') {
      riskLevel = 'HIGH';
      riskLabel = 'Cao (Bảo mật / Giới hạn truy cập)';
      eventType = 'ACCOUNT_LOCKOUT';
    } else if (log.status === 'FAILURE') {
      riskLevel = 'MEDIUM';
      riskLabel = 'Trung bình (Cảnh báo sai thông tin)';
      eventType = 'AUTH_FAILED';
    } else if (log.status === 'ACCOUNT_UNLOCKED') {
      riskLevel = 'LOW';
      riskLabel = 'Thấp (Thao tác quản trị)';
      eventType = 'ACCOUNT_UNLOCKED';
    } else if (log.status === 'LOGOUT') {
      riskLevel = 'LOW';
      riskLabel = 'Thấp (Kết thúc phiên)';
      eventType = 'AUTH_LOGOUT';
    } else if (log.status === 'SUCCESS') {
      riskLevel = 'LOW';
      riskLabel = 'Thấp (Bình thường)';
      eventType = 'AUTH_SUCCESS';
    }

    const enrichedLog = {
      ...log,
      eventType,
      riskLevel,
      riskLabel,
      user: userInfo ? {
        id: userInfo.id,
        fullName: userInfo.full_name,
        email: userInfo.email,
        department: userInfo.department_name,
        accountStatus: userInfo.status,
        failedAttempts: userInfo.failed_attempts,
        lockedUntil: userInfo.locked_until,
        roles: roles.map(r => r.name || r.code)
      } : null
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, log: enrichedLog, data: { log: enrichedLog } }));
    return;
  }

  // 13.7 API: Candidates List (Real SQLite Data)
  if (req.method === 'GET' && (pathname === '/api/v1/candidates' || pathname === '/candidates')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'candidate.read');
    if (!user) return;
    const options = {
      search: parsedUrl.searchParams.get('search') || '',
      stage: parsedUrl.searchParams.get('stage') || 'ALL',
      requisitionId: parsedUrl.searchParams.get('requisitionId') || 'ALL'
    };
    const result = requisitionService.getCandidates(options);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.7.1 API: Create Candidate
  if (req.method === 'POST' && (pathname === '/api/v1/candidates' || pathname === '/candidates')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'candidate.read');
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = requisitionService.createCandidate(body);
      res.writeHead(result.statusCode || 201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.7.2 API: Update Candidate Stage
  if (req.method === 'PUT' && ((pathname.startsWith('/api/v1/candidates/') && pathname.endsWith('/stage')) || (pathname.startsWith('/candidates/') && pathname.endsWith('/stage')))) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'candidate.read');
    if (!user) return;
    try {
      const candId = pathname.replace(/^\/api\/v1\/candidates\//, '').replace(/^\/candidates\//, '').replace(/\/stage$/, '');
      const body = await parseBody(req);
      const isCatalogUpdate = Object.hasOwn(body, 'rejectionReasonId');
      if (isCatalogUpdate && !rbacMiddleware.authorize(req, res, authController.authService, 'candidate.update')) return;
      const result = requisitionService.updateCandidateStage(candId, body.stage, isCatalogUpdate ? body.notes : undefined, isCatalogUpdate ? body.rejectionReasonId : undefined);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.8 API: Interviews List (Real SQLite Data)
  if (req.method === 'GET' && (pathname === '/api/v1/interviews' || pathname === '/interviews')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'interview.read');
    if (!user) return;
    const result = requisitionService.getInterviews();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.8.1 API: Create Interview
  if (req.method === 'POST' && (pathname === '/api/v1/interviews' || pathname === '/interviews')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'interview.read');
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = requisitionService.createInterview(body);
      res.writeHead(result.statusCode || 201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.8.2 API: Update Interview Status / Feedback / Score
  if (req.method === 'PUT' && ((pathname.startsWith('/api/v1/interviews/') && pathname.endsWith('/status')) || (pathname.startsWith('/interviews/') && pathname.endsWith('/status')))) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'interview.read');
    if (!user) return;
    try {
      const intId = pathname.replace(/^\/api\/v1\/interviews\//, '').replace(/^\/interviews\//, '').replace(/\/status$/, '');
      const body = await parseBody(req);
      const result = requisitionService.updateInterviewStatus(intId, body.status, body.feedback, body.score);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.9 API: Offers List (Real SQLite Data)
  if (req.method === 'GET' && (pathname === '/api/v1/offers' || pathname === '/offers')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'offer.read');
    if (!user) return;
    const result = requisitionService.getOffers();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.9.1 API: Create Offer
  if (req.method === 'POST' && (pathname === '/api/v1/offers' || pathname === '/offers')) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'offer.read');
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = requisitionService.createOffer(body);
      res.writeHead(result.statusCode || 201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.9.2 API: Update Offer Status
  if (req.method === 'PUT' && ((pathname.startsWith('/api/v1/offers/') && pathname.endsWith('/status')) || (pathname.startsWith('/offers/') && pathname.endsWith('/status')))) {
    const user = rbacMiddleware.authorize(req, res, authController.authService, 'offer.read');
    if (!user) return;
    try {
      const offId = pathname.replace(/^\/api\/v1\/offers\//, '').replace(/^\/offers\//, '').replace(/\/status$/, '');
      const body = await parseBody(req);
      const result = requisitionService.updateOfferStatus(offId, body.status);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.10 API: Recruitment Reports (Real SQLite Analytics)
  if (req.method === 'GET' && (pathname === '/api/v1/reports/recruitment' || pathname === '/reports/recruitment')) {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 401, message: 'Yêu cầu thiếu token xác thực.', code: 'UNAUTHORIZED' }));
      return;
    }
    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: sessionResult.statusCode || 401, message: sessionResult.message, code: sessionResult.code }));
      return;
    }
    const result = requisitionService.getReports();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }


  // 14. API: S1-06 Role-Based Navigation Menu (AC-01, AC-02, AC-03)
  if (req.method === 'GET' && (pathname === '/api/v1/navigation/menu' || pathname === '/navigation/menu')) {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 401,
        message: 'Yêu cầu thiếu token xác thực.',
        code: 'UNAUTHORIZED',
        recovery: {
          action: 'LOGIN',
          suggestedPath: '/login',
          label: 'Đăng nhập lại'
        }
      }));
      return;
    }

    const token = authHeader.substring(7).trim();
    const sessionResult = authController.authService.validateSession(token, true);
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: sessionResult.statusCode || 401,
        message: sessionResult.message,
        code: sessionResult.code,
        recovery: {
          action: 'LOGIN',
          suggestedPath: '/login',
          label: 'Đăng nhập lại'
        }
      }));
      return;
    }

    const user = sessionResult.user;
    const userPerms = rbacMiddleware.getUserPermissions(user.id);
    const isCandidate = user.roles.includes('CANDIDATE');

    // All possible ATS menu items with required permissions
    const ALL_NAVIGATION_ITEMS = [
      { id: 'nav-dashboard', label: 'Bảng điều khiển', path: '/dashboard', icon: '📊', requiredPermission: null, internalOnly: true },
      { id: 'nav-departments', label: 'Phòng ban & Sơ đồ tổ chức', path: '/admin/departments', icon: '🏢', requiredPermission: 'department.read', internalOnly: true },
      { id: 'nav-recruitment-catalogs', label: 'Danh mục tuyển dụng', path: '/admin/recruitment-catalogs', icon: '📋', requiredPermission: 'recruitment_catalog.manage', internalOnly: true },
      { id: 'nav-career-page', label: 'Trang giới thiệu công ty', path: '/admin/career-page', icon: '🏢', requiredPermission: 'career_page.manage', internalOnly: true },
      { id: 'nav-competencies', label: 'Khung năng lực & Chức danh', path: '/admin/competencies', icon: '🎯', requiredPermission: 'competency.read', internalOnly: true },
      { id: 'nav-users', label: 'Quản trị Người dùng', path: '/admin/users', icon: '👥', requiredPermission: 'user.read', internalOnly: true },
      { id: 'nav-roles', label: 'Phân quyền & Vai trò', path: '/admin/roles', icon: '🛡️', requiredPermission: 'role.read', internalOnly: true },
      { id: 'nav-audit', label: 'Nhật ký Hệ thống', path: '/admin/audit', icon: '📜', requiredPermission: 'audit.read', internalOnly: true },
      { id: 'nav-requisitions', label: 'Yêu cầu Tuyển dụng', path: '/requisitions', icon: '📝', requiredPermission: 'requisition.read', internalOnly: true },
      { id: 'nav-candidates', label: 'Hồ sơ Ứng viên', path: '/candidates', icon: '💼', requiredPermission: 'candidate.read', internalOnly: true },
      { id: 'nav-interviews', label: 'Lịch Phỏng vấn', path: '/interviews', icon: '🗓️', requiredPermission: 'interview.read', internalOnly: true },
      { id: 'nav-question-bank', label: 'Ngân hàng câu hỏi phỏng vấn', path: '/question-bank', icon: '📚', requiredPermission: 'question_bank.read', internalOnly: true },
      { id: 'nav-offers', label: 'Quản lý Offer', path: '/offers', icon: '✉️', requiredPermission: 'offer.read', internalOnly: true },
      { id: 'nav-approvals', label: 'Cần phê duyệt', path: '/approvals', icon: '✅', requiredPermission: 'requisition.approve', internalOnly: true },
      { id: 'nav-candidate-portal', label: 'Hồ sơ của tôi', path: '/candidate', icon: '👤', requiredPermission: 'candidate.create', candidateOnly: true }
    ];

    // AC-01 & AC-02: Strictly filter menu items based on real database permissions
    // Items user has no permission for are COMPLETELY REMOVED from the payload (AC-02)
    const allowedMenuItems = ALL_NAVIGATION_ITEMS.filter(item => {
      if (isCandidate) {
        return item.candidateOnly === true;
      }
      if (item.candidateOnly) {
        return false;
      }
      if (!item.requiredPermission) {
        return true;
      }
      return userPerms.includes(item.requiredPermission);
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roles: user.roles,
        defaultHome: user.defaultHome
      },
      menuItems: allowedMenuItems
    }));
    return;
  }

  // 9. Static Files Serving (Frontend)
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    let filePath = path.join(config.STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(config.STATIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Default to index.html for SPA if file doesn't exist
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(config.STATIC_DIR, 'index.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // 15. Default 404 Handler (AC-01, AC-02, AC-03)
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    success: false,
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Đường dẫn hoặc tài nguyên bạn yêu cầu không tồn tại trên hệ thống.',
    requestedPath: pathname,
    recovery: {
      action: 'NAVIGATE_HOME',
      suggestedPath: '/dashboard',
      label: 'Về trang chủ hệ thống'
    }
  }));
});

function startServer(port = config.PORT) {
  return new Promise(resolve => {
    server.listen(port, () => {
      console.log(`[ATS Server] Server listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer
};
