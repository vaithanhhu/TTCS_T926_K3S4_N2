const UserService = require('../services/userService');

/**
 * UserController: Tiếp nhận và xử lý các yêu cầu HTTP quản trị người dùng (S1-08)
 */
class UserController {
  constructor(userService, rbacMiddleware, authService) {
    this.userService = userService || new UserService();
    this.rbacMiddleware = rbacMiddleware;
    this.authService = authService;
  }

  /**
   * GET /api/v1/admin/users
   * Yêu cầu quyền: user.read (Default Deny)
   */
  async handleGetUsers(req, res, parsedUrl) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'user.read');
      if (!authorizedUser) return; // Đã xử lý 401 hoặc 403

      const page = parsedUrl.searchParams.get('page') || 1;
      const limit = parsedUrl.searchParams.get('limit') || 20;
      const search = parsedUrl.searchParams.get('search') || parsedUrl.searchParams.get('q') || '';
      const role = parsedUrl.searchParams.get('role') || '';
      const status = parsedUrl.searchParams.get('status') || '';

      const result = this.userService.getUsers({ page, limit, search, role, status });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[UserController handleGetUsers Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi lấy danh sách người dùng.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * GET /api/v1/admin/users/:id
   * Yêu cầu quyền: user.read
   */
  async handleGetUserById(req, res, id) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'user.read');
      if (!authorizedUser) return;

      const user = this.userService.getUserById(id);
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, statusCode: 404, message: 'Không tìm thấy người dùng.', code: 'NOT_FOUND' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: user }));
    } catch (err) {
      console.error('[UserController handleGetUserById Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * POST /api/v1/admin/users
   * Yêu cầu quyền: user.create (AC-01 & AC-02)
   */
  async handleCreateUser(req, res, body) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'user.create');
      if (!authorizedUser) return;

      const result = this.userService.createUser(body, authorizedUser.id);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[UserController handleCreateUser Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi tạo tài khoản.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * PUT /api/v1/admin/users/:id
   * Yêu cầu quyền: user.update (AC-03)
   */
  async handleUpdateUser(req, res, id, body) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'user.update');
      if (!authorizedUser) return;

      const result = this.userService.updateUser(id, body, authorizedUser.id);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[UserController handleUpdateUser Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi cập nhật người dùng.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * GET /api/v1/admin/roles/list
   * Lấy danh sách 7 vai trò để nạp vào form / dropdown
   */
  async handleGetRoles(req, res) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'user.read');
      if (!authorizedUser) return;

      const roles = this.userService.getRolesList();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: roles }));
    } catch (err) {
      console.error('[UserController handleGetRoles Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi lấy danh sách vai trò.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * GET /api/v1/admin/users/:id/roles
   * Lấy danh sách vai trò hiện tại của 1 user và tất cả vai trò khả dụng (S1-09)
   * Yêu cầu quyền: role.read hoặc user.read
   */
  async handleGetUserRoles(req, res, targetUserId) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'role.read');
      if (!authorizedUser) return;

      const result = this.userService.getUserRoles(targetUserId);
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, statusCode: 404, message: 'Không tìm thấy người dùng.', code: 'NOT_FOUND' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      console.error('[UserController handleGetUserRoles Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * PUT /api/v1/admin/users/:id/roles
   * Gán và thu hồi vai trò cho một người dùng (S1-09 AC-01, AC-02, AC-03)
   * Yêu cầu quyền: role.assign (Default Deny - Chỉ ADMIN có quyền gán vai trò)
   */
  async handleAssignUserRoles(req, res, targetUserId, body) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'role.assign');
      if (!authorizedUser) return;

      const roleCodes = body.roles || body.roleCodes || [];
      const result = this.userService.assignUserRoles(targetUserId, roleCodes, authorizedUser);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[UserController handleAssignUserRoles Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi gán vai trò.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * POST /api/v1/admin/users/:id/lock
   * Khóa tài khoản người dùng (S1-10 AC-01, AC-02, AC-03)
   * Yêu cầu quyền: account.lock (Default Deny - Chỉ ADMIN có quyền)
   */
  async handleLockUser(req, res, targetUserId, body) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'account.lock');
      if (!authorizedUser) return;

      const reason = (body && body.reason) || '';
      const result = this.userService.lockUser(targetUserId, reason, authorizedUser);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[UserController handleLockUser Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi khóa tài khoản.', code: 'INTERNAL_ERROR' }));
    }
  }

  /**
   * POST /api/v1/admin/users/:id/unlock
   * Mở khóa tài khoản người dùng (S1-10)
   * Yêu cầu quyền: account.unlock (Default Deny - Chỉ ADMIN có quyền)
   */
  async handleUnlockUser(req, res, targetUserId) {
    try {
      const authorizedUser = this.rbacMiddleware.authorize(req, res, this.authService, 'account.unlock');
      if (!authorizedUser) return;

      const result = this.userService.unlockUser(targetUserId, authorizedUser);

      res.writeHead(result.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[UserController handleUnlockUser Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, statusCode: 500, message: 'Lỗi máy chủ nội bộ khi mở khóa tài khoản.', code: 'INTERNAL_ERROR' }));
    }
  }
}

module.exports = UserController;
