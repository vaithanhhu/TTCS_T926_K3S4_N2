const { getDatabase } = require('../db/database');

/**
 * RBAC Authorization Service & Middleware (S1-05 AC-01, AC-02, AC-03)
 * Enforces strict Default Deny principle based on real database tables.
 */
class RbacMiddleware {
  constructor(db) {
    this.db = db || getDatabase();
  }

  /**
   * Get all distinct permissions for a user from real database (AC-01)
   * Flow: User -> user_roles -> roles -> role_permissions -> permissions
   * @param {string} userId
   * @returns {Array<string>} Array of permission codes
   */
  async getUserPermissions(userId) {
    if (!userId) return [];

    const stmt = this.db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY p.code ASC
    `);

    const rows = (await stmt.all(userId));
    return rows.map(r => r.code);
  }

  /**
   * Get all distinct permissions with full metadata for current user
   * @param {string} userId
   * @returns {Array<object>} Array of permission objects
   */
  async getUserPermissionDetails(userId) {
    if (!userId) return [];

    const stmt = this.db.prepare(`
      SELECT DISTINCT p.id, p.code, p.name, p.module, p.description
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY p.module ASC, p.code ASC
    `);

    return (await stmt.all(userId));
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

    const stmt = this.db.prepare(`
      SELECT 1
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ? AND p.code = ?
      LIMIT 1
    `);

    const result = (await stmt.get(userId, requiredPermission));
    return Boolean(result);
  }

  /**
   * Get entire RBAC matrix for system inspection (AC-01)
   * @returns {object} Map of role code to array of permission codes
   */
  async getRbacMatrix() {
    const rolesStmt = this.db.prepare('SELECT id, code, name, default_path FROM roles ORDER BY code ASC');
    const roles = (await rolesStmt.all());

    const permStmt = this.db.prepare(`
      SELECT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.code ASC
    `);

    const matrix = {};
    for (const role of roles) {
      matrix[role.code] = {
        roleId: role.id,
        roleName: role.name,
        defaultPath: role.default_path,
        permissions: (await permStmt.all(role.id)).map(r => r.code)
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
  async authorize(req, res, authService, requiredPermission) {
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
