const { getDatabase } = require('../db/database');

/**
 * RBAC Authorization Service & Middleware (S1-05 AC-01, AC-02, AC-03)
 * Enforces strict Default Deny principle based on real database tables.
 */
class RbacMiddleware {
  constructor(db) {
    this.db = db || getDatabase();
  }

  permissionPredicate(userColumn,permissionColumn) {
    return `(EXISTS (SELECT 1 FROM user_roles admin_ur JOIN roles admin_r ON admin_r.id=admin_ur.role_id WHERE admin_ur.user_id=${userColumn} AND admin_r.code='ADMIN')
      OR EXISTS (SELECT 1 FROM user_roles grant_ur JOIN role_permissions grant_rp ON grant_rp.role_id=grant_ur.role_id JOIN permissions grant_p ON grant_p.id=grant_rp.permission_id WHERE grant_ur.user_id=${userColumn} AND grant_p.code=${permissionColumn}))`;
  }

  async isAdministrator(userId) {
    if (!userId) return false;
    return Boolean(await this.db.prepare("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.code='ADMIN' LIMIT 1").get(userId));
  }

  async getAuthorizedActor(userId,permission) {
    if (!userId || !permission) return null;
    const user=await this.db.prepare("SELECT id,email,full_name,locked_until FROM users WHERE id=? AND status='ACTIVE' AND must_change_password=FALSE"+(this.db.provider==='postgres'?' FOR SHARE':'')).get(userId);
    if (!user || (user.locked_until && new Date(user.locked_until).getTime()>Date.now())) return null;
    const roles=await this.db.prepare('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?'+(this.db.provider==='postgres'?' FOR SHARE OF ur,r':'')).all(userId);
    if (!roles.some(role=>role.code==='ADMIN')) {
      const grant=await this.db.prepare('SELECT p.id FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND p.code=? LIMIT 1'+(this.db.provider==='postgres'?' FOR SHARE OF ur,rp,p':'')).get(userId,permission);
      if (!grant) return null;
    }
    return {id:user.id,email:user.email,fullName:user.full_name,roles:roles.map(role=>role.code)};
  }

  /**
   * Get all distinct permissions for a user from real database (AC-01)
   * Flow: User -> user_roles -> roles -> role_permissions -> permissions
   * @param {string} userId
   * @returns {Array<string>} Array of permission codes
   */
  async getUserPermissions(userId) {
    if (!userId) return [];

    const rows = await this.db.prepare(`SELECT DISTINCT p.code FROM users u CROSS JOIN permissions p WHERE u.id=? AND ${this.permissionPredicate('u.id','p.code')} ORDER BY p.code`).all(userId);
    return rows.map(row => row.code);
  }

  /**
   * Get all distinct permissions with full metadata for current user
   * @param {string} userId
   * @returns {Array<object>} Array of permission objects
   */
  async getUserPermissionDetails(userId) {
    if (!userId) return [];

    return this.db.prepare(`SELECT DISTINCT p.id,p.code,p.name,p.module,p.description FROM users u CROSS JOIN permissions p WHERE u.id=? AND ${this.permissionPredicate('u.id','p.code')} ORDER BY p.module,p.code`).all(userId);
  }

  /**
   * Check if a user possesses a specific permission code in the database (AC-02)
   * Default Deny: returns false if not explicitly granted.
   * @param {string} userId
   * @param {string} requiredPermission
   * @returns {boolean}
   */
  async hasPermission(userId, requiredPermission) {
    if (!userId || !requiredPermission) return false;

    return Boolean(await this.db.prepare(`SELECT 1 FROM users u WHERE u.id=? AND ${this.permissionPredicate('u.id','?')} LIMIT 1`).get(userId,requiredPermission));
  }

  /**
   * Get entire RBAC matrix for system inspection (AC-01)
   * @returns {object} Map of role code to array of permission codes
   */
  async getRbacMatrix() {
    const rolesStmt = this.db.prepare('SELECT id, code, name, default_path FROM roles ORDER BY code ASC');
    const roles = (await rolesStmt.all());

    const permStmt = this.db.prepare(`SELECT p.code FROM permissions p WHERE ?='ADMIN' OR EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id=p.id AND rp.role_id=?) ORDER BY p.code`);

    const matrix = {};
    for (const role of roles) {
      matrix[role.code] = {
        roleId: role.id,
        roleName: role.name,
        defaultPath: role.default_path,
        permissions: (await permStmt.all(role.code,role.id)).map(r => r.code)
      };
    }

    return matrix;
  }

  /**
   * Enforce permission check on HTTP request (AC-02: Default Deny)
   * @param {object} req Incoming HTTP request
   * @param {object} res Outgoing HTTP response
   * @param {object} authService Instance of AuthService
   * @param {string} requiredPermission Expected permission code
   * @returns {object|null} Returns user object if authorized, or null if denied/handled
   */
  async authorize(req, res, authService, requiredPermission, candidatePermission = null) {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 401,
        message: 'Yêu cầu không có phiên làm việc hợp lệ. Vui lòng đăng nhập.',
        code: 'UNAUTHORIZED',
        recovery: {
          action: 'LOGIN',
          suggestedPath: '/login',
          label: 'Đăng nhập lại'
        }
      }));
      return null;
    }

    const token = authHeader.substring(7).trim();
    const sessionResult = (await authService.validateSession(token, true));

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
      return null;
    }

    const user = sessionResult.user;
    if (candidatePermission && user.roles.length && user.roles.every(role => role === 'CANDIDATE')) requiredPermission = candidatePermission;

    // AC-02: Default Deny enforcement
    const isAllowed = (await this.hasPermission(user.id, requiredPermission));
    if (!isAllowed) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        statusCode: 403,
        message: `Bạn không có quyền thực hiện thao tác này (yêu cầu quyền: ${requiredPermission}).`,
        code: 'FORBIDDEN_PERMISSION_DENIED',
        requiredPermission,
        userRoles: user.roles,
        recovery: {
          action: 'NAVIGATE_HOME',
          suggestedPath: user.defaultHome || '/dashboard',
          label: 'Về không gian làm việc của bạn'
        }
      }));
      return null;
    }

    return user;
  }
}

module.exports = RbacMiddleware;
