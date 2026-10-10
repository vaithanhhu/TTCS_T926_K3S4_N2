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
const { ApprovalConfigurationService } = require('./services/approvalConfigurationService');
const ApprovalConfigurationController = require('./controllers/approvalConfigurationController');
const RequisitionApprovalService = require('./services/requisitionApprovalService');
const RequisitionApprovalController = require('./controllers/requisitionApprovalController');
const frontendRoutes = new Set(require('../../frontend/routes.json').routes.map(route => route.path));

function serveFrontendEntry(res, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Vary': 'Accept' });
  fs.createReadStream(path.join(config.STATIC_DIR, 'index.html')).pipe(res);
}

// Ensure DB is initialized and seeded
const db = getDatabase();
const isTestEnv = process.env.NODE_ENV === 'test' || (process.argv[1] && (process.argv[1].includes('tests') || process.argv[1].includes('test_s1_')));
let initialization;
async function initializeApplication() {
  if (db.provider === 'postgres') await require('./db/migrate-postgres').verifyMigration(db);
  const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
  if (db.provider === 'sqlite' && (isTestEnv || userCount === 0)) {
    await seedDatabase(db);
  } else if (db.provider === 'sqlite' && userCount > 0) {
    // PostgreSQL metadata is managed by explicit migration/import, never startup writes.
    await ensureDepartmentFeature(db); await ensureCompetencyFeature(db);
    await ensureQuestionBankFeature(db); await ensureRecruitmentCatalogFeature(db);
    await ensureCareerPageFeature(db); await ensureRequisitionDraftFeature(db);
  }
  if (config.APPROVAL_CONFIGURATION_ENABLED) await require('./db/migrate-approval-configurations').verify(db);
  if (config.REQUISITION_APPROVAL_ENABLED) await require('./db/migrate-requisition-approvals').verify(db);
  if (config.HEADCOUNT_BUDGET_ENABLED) await require('./db/migrate-headcount-budgets').verify(db);
  if (config.REQUISITION_OPERATIONS_ENABLED) await require('./db/migrate-requisition-operations').verify(db);
  if (config.REQUISITION_LIFECYCLE_ENABLED) await require('./db/migrate-requisition-lifecycle').verify(db);
  if (config.REQUISITION_TRACKING_ENABLED || config.JOB_POSTING_DRAFTS_ENABLED) await require('./db/migrate-requisition-tracking-job-drafts').verify(db);
  if(config.JOB_POSTING_PUBLICATION_ENABLED)await require('./db/migrate-job-publication').verify(db);
}

const avatarService = new AvatarService();
const authController = new AuthController(undefined, avatarService);
const rbacMiddleware = new RbacMiddleware(db);
const userService = new UserService(db);
const userController = new UserController(userService, rbacMiddleware, authController.authService, avatarService);
const requisitionService = new RequisitionService(db);
const departmentService = new DepartmentService(db);
const competencyService = new CompetencyService(db);
const questionBankService = new QuestionBankService(db);
const recruitmentCatalogService = new RecruitmentCatalogService(db);
const careerPageService = new CareerPageService(db);
const approvalConfigurationController = new ApprovalConfigurationController(new ApprovalConfigurationService(db), rbacMiddleware, authController.authService);
const requisitionApprovalService = new RequisitionApprovalService(db);
const requisitionApprovalController = new RequisitionApprovalController(requisitionApprovalService, rbacMiddleware, authController.authService);

async function canReadJobTitleSalary(user) {
  return user.roles.includes('HR_MANAGER') && (await rbacMiddleware.hasPermission(user.id, 'salary_range.read'));
}

function denyJobTitleSalary(res) {
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Chỉ Trưởng phòng Nhân sự được khai báo và xem dải lương.' }));
}

function isCandidateOnly(user) {
  return Boolean(user?.roles?.length && user.roles.every(role => role === 'CANDIDATE'));
}

function denyInternalCandidate(res, user) {
  if (!isCandidateOnly(user)) return false;
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Tài khoản ứng viên không có quyền truy cập chức năng nội bộ.', recovery: { action: 'NAVIGATE_HOME', suggestedPath: '/candidate', label: 'Về hồ sơ của tôi' } }));
  return true;
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
    const maxBytes = careerPageService.maxFileSize;

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
async function handleRequest(req, res) {
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
  const frontendPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (frontendRoutes.has(frontendPath)) res.setHeader('Vary', 'Accept');
  // A restricted session may only inspect itself, change its password or logout.
  // Guard here as well as in validateSession so direct/legacy endpoints cannot bypass it.
  const bearer = req.headers.authorization;
  if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
    const token = bearer.substring(7).trim();
    const restricted = (await db.prepare('SELECT u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token));
    const session = restricted?.must_change_password ? (await authController.authService.validateSession(token, false, true)) : null;
    const allowed = ['/api/v1/auth/me', '/auth/me', '/api/v1/auth/change-password', '/auth/change-password', '/api/v1/auth/logout', '/auth/logout'];
    if (session && !session.valid) {
      res.writeHead(session.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, code: session.code, message: session.message }));
      return;
    }
    if (session?.valid && session.user.mustChangePassword && !allowed.includes(pathname)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 403, code: 'MUST_CHANGE_PASSWORD',
        message: 'Bạn cần đổi mật khẩu tạm thời trước khi sử dụng hệ thống.',
        recovery: { action: 'CHANGE_PASSWORD', suggestedPath: '/change-password', label: 'Đổi mật khẩu' } }));
      return;
    }
  }
  if (pathname === '/api/v1/headcount-budgets' || pathname.startsWith('/api/v1/headcount-budgets/')) {
    if(!config.HEADCOUNT_BUDGET_ENABLED){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'S304_DISABLED',message:'Ngân sách headcount chưa được bật.'}));return;}
    const Budget=require('./services/headcountBudgetService').HeadcountBudgetService,Controller=require('./controllers/headcountBudgetController');await new Controller(new Budget(db),rbacMiddleware,authController.authService).handle(req,res,parsedUrl,parseBody);return;
  }
  if (pathname === '/api/v1/requisition-approvals' || pathname.startsWith('/api/v1/requisition-approvals/')) {
    if (!config.REQUISITION_APPROVAL_ENABLED) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, code: 'S302_DISABLED', message: 'Phê duyệt yêu cầu tuyển dụng chưa được bật.' }));
      return;
    }
    await requisitionApprovalController.handle(req, res, parsedUrl, parseBody);
    return;
  }
  if (pathname === '/api/v1/approval-configurations' || pathname.startsWith('/api/v1/approval-configurations/')) {
    if (!config.APPROVAL_CONFIGURATION_ENABLED) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, code: 'S301_DISABLED', message: 'Cấu hình phê duyệt chưa được bật. Quản trị viên cần áp dụng migration S3-01.' }));
      return;
    }
    await approvalConfigurationController.handle(req, res, parsedUrl, parseBody);
    return;
  }
  // Preserve unprefixed REST aliases: only browser document requests opt into HTML.
  if (req.method === 'GET' && frontendRoutes.has(frontendPath) && (req.headers.accept || '').includes('text/html')) {
    serveFrontendEntry(res);
    return;
  }

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
    const sessionResult = (await authController.authService.validateSession(token, true));
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
    const permissions = (await rbacMiddleware.getUserPermissions(sessionResult.user.id));
    const details = (await rbacMiddleware.getUserPermissionDetails(sessionResult.user.id));
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
    const sessionResult = (await authController.authService.validateSession(token, true));
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: sessionResult.statusCode || 401, message: sessionResult.message, code: sessionResult.code }));
      return;
    }
    const userProfile = (await userService.getUserById(sessionResult.user.id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: userProfile ? {
      ...userProfile, ...avatarService.getAvatarUrls(userProfile.id)
    } : userProfile }));
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
    const sessionResult = (await authController.authService.validateSession(token, true));
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: sessionResult.statusCode || 401, message: sessionResult.message, code: sessionResult.code }));
      return;
    }
    try {
      const body = await parseBody(req);
      const updateResult = (await userService.updateProfile(sessionResult.user.id, {
        fullName: body.fullName,
        jobTitle: body.jobTitle,
        phoneNumber: body.phoneNumber
      }, { validatePhone: pathname.endsWith('/personal') }));
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
    const sessionResult = (await authController.authService.validateSession(token, true));

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
    const rawMatrix = (await rbacMiddleware.getRbacMatrix());
    const roles = (await db.prepare('SELECT id, code AS name, name AS description FROM roles ORDER BY code ASC').all());
    const permissions = (await db.prepare('SELECT id, code AS name, name AS description, module FROM permissions ORDER BY module, code ASC').all());
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'user.create'));
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
    if (!(await rbacMiddleware.authorize(req, res, authController.authService, 'user.create'))) return;
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
    if (!(await rbacMiddleware.authorize(req, res, authController.authService, 'user.create'))) return;
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'user.create'));
    if (!user) return;
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '').replace(/\/reset-password$/, '');
    const result = (await userService.resetUserPassword(userId, user));
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 11.11 Delete User Account (Admin)
  if (req.method === 'DELETE' && (pathname.startsWith('/api/v1/admin/users/') || pathname.startsWith('/admin/users/')) && !pathname.endsWith('/roles') && !pathname.endsWith('/lock') && !pathname.endsWith('/unlock') && !pathname.endsWith('/reset-password')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'user.create'));
    if (!user) return;
    const userId = pathname.replace(/^\/api\/v1\/admin\/users\//, '').replace(/^\/admin\/users\//, '');
    const result = (await userService.deleteUser(userId, user));
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 12. API: S1-05 Protected Action Demo 2 - Candidate List (requires candidate.read) (AC-02 & AC-03)
  if (req.method === 'GET' && (pathname === '/api/v1/recruitment/candidates/test-list' || pathname === '/recruitment/candidates/test-list')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'candidate.read'));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'interview.read'));
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
    const sessionResult = (await authController.authService.validateSession(token, true));
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

    if (denyInternalCandidate(res, sessionResult.user)) return;
    const dashboardUser=await rbacMiddleware.authorize(req,res,authController.authService,'dashboard.read');if(!dashboardUser)return;
    const stats = (await requisitionService.getDashboardStats({viewer:dashboardUser,approvalEnabled:config.REQUISITION_APPROVAL_ENABLED}));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(stats));
    return;
  }

  // S2: Recruitment Shared Catalog
  if (req.method === 'GET' && (
    pathname === '/api/v1/recruitment-catalogs' ||
    pathname === '/recruitment-catalogs'
  )) {
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.read'
    ));
    if (!user) return;

    const type = parsedUrl.searchParams.get('type');
    const status = parsedUrl.searchParams.get('status');

    const result = (await recruitmentCatalogService.getItems(type, { status }));
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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    ));
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = (await recruitmentCatalogService.createItem(body));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    ));
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
      const result = (await recruitmentCatalogService.updateItem(itemId, body));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    ));
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = (await recruitmentCatalogService.reorderItems(
        body.type,
        body.orderedIds
      ));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'recruitment_catalog.manage'
    ));
    if (!user) return;

    const itemId = pathname
      .replace(/^\/api\/v1\/recruitment-catalogs\//, '')
      .replace(/^\/recruitment-catalogs\//, '');

    const result = (await recruitmentCatalogService.deleteItem(itemId));

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
    const result = (await careerPageService.getSettings());

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'career_page.read'
    ));
    if (!user) return;

    const result = (await careerPageService.getSettings());

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'career_page.manage'
    ));
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = (await careerPageService.saveSettings(body));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'career_page.manage'
    ));
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
          ? 'Ảnh không được vượt quá 5 MB.'
          : 'Không thể đọc dữ liệu ảnh trang tuyển dụng.'
      }));
    }

    return;
  }
  // Minimal read-only choices for the existing requisition.create permission.
  // This grants no access to the department administration API or manager details.
  if (req.method === 'GET' && pathname === '/api/v1/requisitions/options') {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'requisition.create'));
    if (!user) return;
    if (['jobTitleId', 'proposedSalaryMin', 'proposedSalaryMax'].some(key => parsedUrl.searchParams.has(key))) {
      const result = (await requisitionService.checkS210SalaryRange({
        jobTitleId: parsedUrl.searchParams.get('jobTitleId'),
        proposedSalaryMin: parsedUrl.searchParams.get('proposedSalaryMin'),
        proposedSalaryMax: parsedUrl.searchParams.get('proposedSalaryMax')
      }));
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      return;
    }
    const departments = (await db.prepare("SELECT id, name, parent_id AS parentId, status FROM departments WHERE status = 'ACTIVE' ORDER BY name").all());
    const s210Departments = (await db.prepare(`SELECT id, name, parent_id AS parentId, status FROM departments
      WHERE status='ACTIVE' AND (?=1 OR manager_id=?) ORDER BY name`).all(user.roles.some(role=>['HR_MANAGER','ADMIN'].includes(role)) ? 1 : 0, user.id));
    const salaryColumns = (await canReadJobTitleSalary(user)) ? ', min_salary AS minSalary, max_salary AS maxSalary' : '';
    const jobTitles = (await db.prepare(`SELECT id, code, name, level${salaryColumns} FROM job_titles WHERE status='ACTIVE' ORDER BY name`).all());
    const recruiters=await db.prepare("SELECT DISTINCT u.id,u.full_name AS fullName FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.status='ACTIVE' AND r.code='RECRUITER' ORDER BY u.full_name").all();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, tree: departmentService.buildTree(departments), s210Departments, jobTitles, recruiters }));
    return;
  }

  // S2: Department & Organization Management
  if (req.method === 'GET' && (pathname === '/api/v1/departments' || pathname === '/departments')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'department.read'));
    if (!user) return;

    const result = (await departmentService.getDepartments());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/v1/departments' || pathname === '/departments')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'department.manage'));
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = (await departmentService.createDepartment(body));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'department.manage'));
    if (!user) return;

    const departmentId = pathname
      .replace(/^\/api\/v1\/departments\//, '')
      .replace(/^\/departments\//, '');

    try {
      const body = await parseBody(req);
      const result = (await departmentService.updateDepartment(departmentId, body));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'department.manage'));
    if (!user) return;

    const departmentId = pathname
      .replace(/^\/api\/v1\/departments\//, '')
      .replace(/^\/departments\//, '')
      .replace(/\/deactivate$/, '');

    const result = (await departmentService.deactivateDepartment(departmentId));
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'DELETE' && (
    pathname.startsWith('/api/v1/departments/') ||
    pathname.startsWith('/departments/')
  )) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'department.manage'));
    if (!user) return;

    const departmentId = pathname
      .replace(/^\/api\/v1\/departments\//, '')
      .replace(/^\/departments\//, '');

    const result = (await departmentService.deleteDepartment(departmentId));
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }
  // S2: Competency Framework & Job Title Management
  if (req.method === 'GET' && (
    pathname === '/api/v1/competency-frameworks' ||
    pathname === '/competency-frameworks'
  )) {
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.read'
    ));
    if (!user) return;

    const result = (await competencyService.getFrameworks());
    result.canManage=await rbacMiddleware.hasPermission(user.id,'competency.manage');

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    ));
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = (await competencyService.createFramework(body));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    ));
    if (!user) return;

    const frameworkId = pathname
      .replace(/^\/api\/v1\/competency-frameworks\//, '')
      .replace(/^\/competency-frameworks\//, '');

    try {
      const body = await parseBody(req);
      const result = (await competencyService.updateFramework(
        frameworkId,
        body
      ));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.read'
    ));
    if (!user) return;

    const result = (await competencyService.getJobTitles({ includeSalary: (await canReadJobTitleSalary(user)) }));
    result.canManage=await rbacMiddleware.hasPermission(user.id,'competency.manage');

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    ));
    if (!user) return;

    try {
      const body = await parseBody(req);
      if (!(await canReadJobTitleSalary(user))) { denyJobTitleSalary(res); return; }
      const result = (await competencyService.createJobTitle(body, { includeSalary: true }));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.manage'
    ));
    if (!user) return;

    const jobTitleId = pathname
      .replace(/^\/api\/v1\/job-titles\//, '')
      .replace(/^\/job-titles\//, '');

    try {
      const body = await parseBody(req);
      if ((Object.hasOwn(body, 'minSalary') || Object.hasOwn(body, 'maxSalary')) && !(await canReadJobTitleSalary(user))) {
        denyJobTitleSalary(res); return;
      }
      const result = (await competencyService.updateJobTitle(
        jobTitleId,
        body,
        { includeSalary: (await canReadJobTitleSalary(user)) }
      ));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'competency.read'
    ));
    if (!user) return;

    const jobTitleId = pathname
      .replace(/^\/api\/v1\/job-titles\//, '')
      .replace(/^\/job-titles\//, '')
      .replace(/\/framework$/, '');

    const result =
      (await competencyService.getFrameworkForJobTitle(jobTitleId));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.read'
    ));
    if (!user) return;

    const result = (await questionBankService.getFilterOptions());

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.read'
    ));
    if (!user) return;

    const options = {
      search: parsedUrl.searchParams.get('search') || '',
      jobTitleId: parsedUrl.searchParams.get('jobTitleId') || '',
      criterionId: parsedUrl.searchParams.get('criterionId') || '',
      difficulty: parsedUrl.searchParams.get('difficulty') || 'ALL',
      status: parsedUrl.searchParams.get('status') || 'ALL'
    };

    const result = (await questionBankService.getQuestions(options));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.manage'
    ));
    if (!user) return;

    try {
      const body = await parseBody(req);
      const result = (await questionBankService.createQuestion(body));

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
    const user = (await rbacMiddleware.authorize(
      req,
      res,
      authController.authService,
      'question_bank.manage'
    ));
    if (!user) return;

    const questionId = pathname
      .replace(/^\/api\/v1\/interview-questions\//, '')
      .replace(/^\/interview-questions\//, '');

    try {
      const body = await parseBody(req);

      const result = (await questionBankService.updateQuestion(
        questionId,
        body
      ));

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
    const sessionResult = (await authController.authService.validateSession(token, true));
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

    const requisitionUser = await rbacMiddleware.authorize(req,res,authController.authService,'requisition.read');
    if (!requisitionUser) return;
    const options = {
      search: parsedUrl.searchParams.get('search') || '',
      status: parsedUrl.searchParams.get('status') || '',
      handoverOnly: parsedUrl.searchParams.get('handoverOnly') === 'true',
      viewerId: sessionResult.user.id,
      canReadS210: true,
      viewer: requisitionUser,
      approvalEnabled: config.REQUISITION_APPROVAL_ENABLED
    };
    if(config.REQUISITION_TRACKING_ENABLED)for(const key of ['departmentId','recruiterId','createdFrom','createdTo','page','limit'])if(parsedUrl.searchParams.has(key))options[key]=parsedUrl.searchParams.get(key);
    let result;try{result=await requisitionService.getRequisitions(options);}catch(error){if(error instanceof require('./services/approvalConfigurationService').ApprovalConfigurationError){res.writeHead(error.statusCode,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:error.code,message:error.message}));return;}throw error;}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.3 API: Create Requisition
  if (req.method === 'POST' && (pathname === '/api/v1/requisitions' || pathname === '/requisitions')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'requisition.create'));
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = (await requisitionService.createRequisition(body, user));
      res.writeHead(result.statusCode || 201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      if(err instanceof require('./services/headcountBudgetService').HeadcountBudgetError||err instanceof require('./services/requisitionOperationsService').RequisitionOperationsError){res.writeHead(err.statusCode,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,statusCode:err.statusCode,code:err.code,message:err.message}));return;}
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.4 API: Reassign Handover Requisition
  if (req.method === 'PUT' && ((pathname.startsWith('/api/v1/requisitions/') && pathname.endsWith('/handover')) || (pathname.startsWith('/requisitions/') && pathname.endsWith('/handover')))) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'requisition.edit'));
    if (!user) return;
    try {
      const reqId = pathname.replace(/^\/api\/v1\/requisitions\//, '').replace(/^\/requisitions\//, '').replace(/\/handover$/, '');
      const body = await parseBody(req);
      if (!user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))) {
        res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'REQUISITION_ASSIGN_FORBIDDEN',message:'Bạn không có quyền phân công người phụ trách.'}));return;
      }
      const result = (await requisitionService.reassignHandover(reqId, body.newRecruiterId, body.notes,user));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'requisition.read'));
    if (!user) return;
    const reqId = pathname.replace(/^\/api\/v1\/requisitions\//, '').replace(/^\/requisitions\//, '');
    const item = (await requisitionService.getRequisitionById(reqId));
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 404, message: 'Không tìm thấy vị trí tuyển dụng.' }));
      return;
    }
    const access = await requisitionService.requisitionAccess(item,user,parsedUrl.searchParams.get('intent')==='edit',config.REQUISITION_APPROVAL_ENABLED);
    if (!access.success) {
      res.writeHead(access.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(access));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: item, access }));
    return;
  }

  // 13.4.2 API: Update Requisition Details
  if (req.method === 'PUT' && (pathname.startsWith('/api/v1/requisitions/') || pathname.startsWith('/requisitions/')) && !pathname.endsWith('/handover')) {
    const reqId = pathname.replace(/^\/api\/v1\/requisitions\//, '').replace(/^\/requisitions\//, '');
    const current = (await requisitionService.getRequisitionById(reqId));
    const isS210Draft = current?.formVersion === 'S2-10' && current.status === 'DRAFT';
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, isS210Draft ? 'requisition.draft.edit' : 'requisition.edit'));
    if (!user) return;
    if (isS210Draft && current.createdBy !== user.id) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, code: 'REQUISITION_DRAFT_FORBIDDEN', message: 'Bạn chỉ được sửa nháp do mình tạo.' }));
      return;
    }
    try {
      const body = await parseBody(req);
      const result = (await requisitionService.updateRequisition(reqId, body, user, {approvalEnabled:config.REQUISITION_APPROVAL_ENABLED}));
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      if(err instanceof require('./services/headcountBudgetService').HeadcountBudgetError||err instanceof require('./services/requisitionOperationsService').RequisitionOperationsError){res.writeHead(err.statusCode,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,statusCode:err.statusCode,code:err.code,message:err.message}));return;}
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: 'Dữ liệu không hợp lệ.', code: 'BAD_REQUEST' }));
    }
    return;
  }

  // 13.5 API: Get Email Logs (Admin)
  if (req.method === 'GET' && (pathname === '/api/v1/admin/email-logs' || pathname === '/admin/email-logs')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'audit.read'));
    if (!user) return;
    const logs = (await db.prepare('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 50').all());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, total: logs.length, logs }));
    return;
  }

  // 13.6 API: Get Audit Logs (Admin)
  if (req.method === 'GET' && (pathname === '/api/v1/admin/audit-logs' || pathname === '/admin/audit-logs')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'audit.read'));
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

    const logs = (await db.prepare(query).all(...params));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, total: logs.length, logs, data: { logs } }));
    return;
  }

  // 13.6.1 API: Get Single Audit Log Detail (Admin)
  if (req.method === 'GET' && (pathname.startsWith('/api/v1/admin/audit-logs/') || pathname.startsWith('/admin/audit-logs/'))) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'audit.read'));
    if (!user) return;
    const logId = pathname.split('/').pop();
    const log = (await db.prepare('SELECT * FROM login_audit_logs WHERE id = ?').get(logId));
    if (!log) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 404, message: 'Không tìm thấy bản ghi nhật ký.' }));
      return;
    }

    // Enrich with associated user details if available
    const userInfo = (await db.prepare('SELECT id, full_name, email, department_name, status, failed_attempts, locked_until FROM users WHERE email = ?').get(log.email));
    let roles = [];
    if (userInfo) {
      roles = (await db.prepare(`
        SELECT r.code, r.name 
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `).all(userInfo.id));
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

  if(pathname==='/api/v1/requisition-tracking/options'&&req.method==='GET'){if(!config.REQUISITION_TRACKING_ENABLED){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'S308_DISABLED'}));return;}const actor=await rbacMiddleware.authorize(req,res,authController.authService,'requisition.read');if(!actor)return;const data=await new(require('./services/requisitionTrackingService'))(db).options(actor);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({success:true,data}));return;}
  if(pathname==='/api/v1/job-posting-publication'||pathname.startsWith('/api/v1/job-posting-publication/')){if(!config.JOB_POSTING_PUBLICATION_ENABLED){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'S310_DISABLED'}));return;}await new(require('./controllers/jobPostingPublicationController'))(new(require('./services/jobPostingPublicationService'))(db),rbacMiddleware,authController.authService).handle(req,res,parsedUrl,parseBody);return;}
  if(pathname.startsWith('/api/v1/job-posting-drafts/')){if(!config.JOB_POSTING_DRAFTS_ENABLED){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'S309_DISABLED'}));return;}await new(require('./controllers/jobPostingDraftController'))(new(require('./services/jobPostingService'))(db),rbacMiddleware,authController.authService).handle(req,res,parsedUrl,parseBody);return;}
  if(pathname.startsWith('/api/v1/requisition-lifecycles/')){if(!config.REQUISITION_LIFECYCLE_ENABLED){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'S307_DISABLED',message:'Chức năng vòng đời chưa được bật.'}));return;}const {RequisitionLifecycleService}=require('./services/requisitionLifecycleService');await new(require('./controllers/requisitionLifecycleController'))(new RequisitionLifecycleService(db),rbacMiddleware,authController.authService).handle(req,res,parsedUrl,parseBody);return;}
  if(pathname==='/api/v1/public/job-postings'||pathname.startsWith('/api/v1/public/job-postings/')){if(req.method!=='GET'||!(config.REQUISITION_LIFECYCLE_ENABLED||config.JOB_POSTING_PUBLICATION_ENABLED)){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'NOT_FOUND'}));return;}const tail=pathname.slice('/api/v1/public/job-postings'.length),items=await new(require('./services/jobPostingService'))(db).publicList(tail?decodeURIComponent(tail.slice(1)):null);res.writeHead(tail&&!items.length?404:200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(tail?{success:!!items.length,data:items[0]||null}:{success:true,data:items}));return;}
  if(pathname.startsWith('/api/v1/requisition-operations/')){if(!config.REQUISITION_OPERATIONS_ENABLED){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'S305_S306_DISABLED',message:'Chức năng sao chép/phân công chưa được bật.'}));return;}const {RequisitionOperationsService}=require('./services/requisitionOperationsService');await new(require('./controllers/requisitionOperationsController'))(new RequisitionOperationsService(db),rbacMiddleware,authController.authService).handle(req,res,parsedUrl,parseBody);return;}

  if(req.method==='GET'&&/^\/(?:api\/v1\/)?candidates\/[^/]+$/.test(pathname)){const user=await rbacMiddleware.authorize(req,res,authController.authService,'candidate.read');if(!user)return;let candidateId;try{candidateId=decodeURIComponent(pathname.split('/').at(-1));}catch{res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'BAD_REQUEST',message:'Mã hồ sơ không hợp lệ.'}));return;}const result=await requisitionService.getCandidateById(candidateId,user);res.writeHead(result.statusCode||200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;}

  // 13.7 API: Candidates List (Real SQLite Data)
  if (req.method === 'GET' && (pathname === '/api/v1/candidates' || pathname === '/candidates')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'candidate.read'));
    if (!user) return;
    const options = {
      search: parsedUrl.searchParams.get('search') || '',
      stage: parsedUrl.searchParams.get('stage') || 'ALL',
      requisitionId: parsedUrl.searchParams.get('requisitionId') || 'ALL',
      viewer: user
    };
    if (isCandidateOnly(user)) options.candidateEmail = user.email;
    const result = (await requisitionService.getCandidates(options));
    res.writeHead(result.statusCode||200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.7.1 API: Create Candidate
  if (req.method === 'POST' && (pathname === '/api/v1/candidates' || pathname === '/candidates')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'candidate.create'));
    if (!user) return;
    try {
      const body = await parseBody(req);
      if (isCandidateOnly(user)) Object.assign(body, { email: user.email, fullName: user.fullName, stage: 'NEW', notes: null, rejectionReasonId: null });
      const result = (await requisitionService.createCandidate(body,user));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'candidate.update'));
    if (!user) return;
    try {
      const candId = pathname.replace(/^\/api\/v1\/candidates\//, '').replace(/^\/candidates\//, '').replace(/\/stage$/, '');
      const body = await parseBody(req);
      const isCatalogUpdate = Object.hasOwn(body, 'rejectionReasonId');
      if (isCatalogUpdate && !(await rbacMiddleware.authorize(req, res, authController.authService, 'candidate.update'))) return;
      const result = (await requisitionService.updateCandidateStage(candId, body.stage, isCatalogUpdate ? body.notes : undefined, isCatalogUpdate ? body.rejectionReasonId : undefined,user));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'interview.read'));
    if (!user) return;
    const result = (await requisitionService.getInterviews({viewer:user,...(isCandidateOnly(user) ? { candidateEmail: user.email } : {})}));
    for (const interview of result.interviews) {
      if (interview.interviewer) {
        Object.assign(interview.interviewer, avatarService.getAvatarUrls(interview.interviewer.id));
      }
    }
    res.writeHead(result.statusCode||200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method==='GET' && pathname==='/api/v1/interview-options') {
    const user=await rbacMiddleware.authorize(req,res,authController.authService,'interview.create');if(!user)return;
    const interviewers=await db.prepare("SELECT u.id,u.full_name AS fullName FROM users u WHERE u.status='ACTIVE' AND u.must_change_password=FALSE AND "+rbacMiddleware.permissionPredicate('u.id',"'interview.evaluate'")+" ORDER BY u.full_name").all();
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:true,interviewers}));return;
  }

  if (req.method==='GET' && pathname==='/api/v1/interview-evaluations') {
    const user=await rbacMiddleware.authorize(req,res,authController.authService,'interview.evaluation.read');if(!user)return;
    const result=await requisitionService.getInterviews({viewer:user,evaluationsOnly:true});
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:true,evaluations:result.interviews.map(row=>({id:row.id,candidate:row.candidate,requisition:row.requisition,interviewer:row.interviewer,feedback:row.feedback,score:row.score}))}));return;
  }

  // 13.8.1 API: Create Interview
  if (req.method === 'POST' && (pathname === '/api/v1/interviews' || pathname === '/interviews')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'interview.create'));
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = (await requisitionService.createInterview(body,user));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'interview.read'));
    if (!user) return;
    try {
      const intId = pathname.replace(/^\/api\/v1\/interviews\//, '').replace(/^\/interviews\//, '').replace(/\/status$/, '');
      const body = await parseBody(req);
      const evaluating=Object.hasOwn(body,'feedback')||Object.hasOwn(body,'score')||(!user.permissions.includes('interview.update')&&user.roles.includes('INTERVIEWER'));
      if(!await rbacMiddleware.authorize(req,res,authController.authService,evaluating?'interview.evaluate':'interview.update'))return;
      if(evaluating&&!user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){
        const assigned=await db.prepare('SELECT id FROM interviews WHERE id=? AND interviewer_id=?').get(intId,user.id);
        if(!user.roles.includes('INTERVIEWER')||!assigned){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'INTERVIEW_ASSIGNEE_REQUIRED',message:'Bạn chỉ được đánh giá vòng phỏng vấn được phân công.'}));return;}
      }
      const result = (await requisitionService.updateInterviewStatus(intId, body.status, body.feedback, body.score,user,evaluating?'interview.evaluate':'interview.update'));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'offer.read'));
    if (!user) return;
    const result = (await requisitionService.getOffers({viewer:user,...(isCandidateOnly(user) ? { candidateEmail: user.email } : {})}));
    res.writeHead(result.statusCode||200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 13.9.1 API: Create Offer
  if (req.method === 'POST' && (pathname === '/api/v1/offers' || pathname === '/offers')) {
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'offer.create'));
    if (!user) return;
    try {
      const body = await parseBody(req);
      const result = (await requisitionService.createOffer(body,user));
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
    const user = (await rbacMiddleware.authorize(req, res, authController.authService, 'offer.read'));
    if (!user) return;
    try {
      const offId = pathname.replace(/^\/api\/v1\/offers\//, '').replace(/^\/offers\//, '').replace(/\/status$/, '');
      const body = await parseBody(req);
      if (isCandidateOnly(user) && body.status === 'ACCEPTED') {
        const own = await db.prepare('SELECT o.id FROM offers o JOIN candidates c ON c.id=o.candidate_id WHERE o.id=? AND LOWER(c.email)=LOWER(?)').get(offId, user.email);
        if (!own) { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ success: false, statusCode: 403, code: 'OFFER_OWNER_REQUIRED', message: 'Bạn chỉ được phản hồi Offer của mình.' })); return; }
      } else if (!await rbacMiddleware.authorize(req, res, authController.authService, ['APPROVED', 'REJECTED'].includes(body.status) ? 'offer.approve' : 'offer.create')) return;
      if(!user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))){
        const scoped=await requisitionService.getOffers({viewer:user});
        if(!scoped.offers.some(offer=>offer.id===offId)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:false,code:'OFFER_OUT_OF_SCOPE',message:'Offer không thuộc phạm vi xử lý của bạn.'}));return;}
      }
      const result = (await requisitionService.updateOfferStatus(offId, body.status,user));
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
    const sessionResult = (await authController.authService.validateSession(token, true));
    if (!sessionResult.valid) {
      res.writeHead(sessionResult.statusCode || 401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: sessionResult.statusCode || 401, message: sessionResult.message, code: sessionResult.code }));
      return;
    }
    if (denyInternalCandidate(res, sessionResult.user)) return;
    const reportUser=await rbacMiddleware.authorize(req,res,authController.authService,'report.read');if(!reportUser)return;
    const result = (await requisitionService.getReports({viewer:reportUser,approvalEnabled:config.REQUISITION_APPROVAL_ENABLED}));
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
    const sessionResult = (await authController.authService.validateSession(token, true));
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
    const userPerms = (await rbacMiddleware.getUserPermissions(user.id));
    const isAdministrator = await rbacMiddleware.isAdministrator(user.id);
    const isCandidate = isCandidateOnly(user);

    // All possible ATS menu items with required permissions
    const ALL_NAVIGATION_ITEMS = [
      { id: 'nav-dashboard', label: 'Bảng điều khiển', path: '/dashboard', icon: '📊', requiredPermission: 'dashboard.read', internalOnly: true },
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
    if(config.HEADCOUNT_BUDGET_ENABLED)ALL_NAVIGATION_ITEMS.push({id:'nav-headcount-budgets',label:'Chỉ tiêu và ngân sách',path:'/admin/headcount-budgets',requiredPermission:'headcount_budget.read',internalOnly:true});
    if (config.APPROVAL_CONFIGURATION_ENABLED) ALL_NAVIGATION_ITEMS.push({ id: 'nav-approval-configurations', label: 'Cấu hình phê duyệt', path: '/admin/approval-configurations', requiredPermission: 'approval_configuration.manage', internalOnly: true });
    ALL_NAVIGATION_ITEMS.push({ id: 'nav-reports', label: 'Báo cáo & Phân tích Tuyển dụng', path: '/reports', requiredPermission: 'report.read', internalOnly: true });
    const allowedMenuItems = ALL_NAVIGATION_ITEMS.filter(item => {
      if (item.candidateOnly) return user.roles.includes('CANDIDATE');
      if (isAdministrator) return true;
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
  if (req.method === 'GET' && pathname !== '/api' && !pathname.startsWith('/api/')) {
    if (frontendRoutes.has(frontendPath)) {
      serveFrontendEntry(res);
      return;
    }
    const filePath = path.resolve(config.STATIC_DIR, '.' + pathname);
    const relativePath = path.relative(config.STATIC_DIR, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Missing assets and unknown paths remain real 404s, never a disguised HTML response.
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // 15. Default 404 Handler (AC-01, AC-02, AC-03)
  // Only an actual browser document navigation receives the existing error-page shell.
  // API callers and missing assets retain their JSON 404 contract.
  if (req.method === 'GET' && req.headers['sec-fetch-dest'] === 'document' &&
      (req.headers.accept || '').includes('text/html') && pathname !== '/api' && !pathname.startsWith('/api/') && !path.extname(pathname)) {
    serveFrontendEntry(res, 404);
    return;
  }
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
}

const server = http.createServer((req, res) => {
  db.withConnection(async () => (await handleRequest(req, res))).catch(() => {
    console.error('[ATS Server] INTERNAL_SERVER_ERROR');
    if (res.headersSent) { res.end(); return; }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, statusCode: 500, code: 'INTERNAL_SERVER_ERROR',
      message: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.' }));
  });
});

async function startServer(port = config.PORT, host) {
  initialization ||= initializeApplication();
  await initialization;
  return new Promise(resolve => {
    server.listen(port, host, () => {
      console.log(`[ATS Server] Server listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch(async error => { console.error('[ATS Startup]', error.code || 'DATABASE_STARTUP_FAILED'); await db.close(); process.exitCode = 1; });
}

module.exports = {
  server,
  startServer
};
