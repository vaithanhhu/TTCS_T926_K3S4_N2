const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class DepartmentService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  async getDepartments() {
    const rows = (await this.db.prepare(`
      SELECT
        d.id,
        d.code,
        d.name,
        d.parent_id,
        d.manager_id,
        d.status,
        d.created_at,
        d.updated_at,
        u.full_name AS manager_name,
        u.email AS manager_email,
        (
          SELECT COUNT(*)
          FROM requisitions r
          WHERE (
            r.department_id = d.id
            OR (r.department_id IS NULL AND r.department_name = d.name)
          )
          AND r.status IN ('OPEN', 'IN_PROGRESS')
        ) AS open_requisition_count
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      ORDER BY d.name ASC
    `).all());

    const mapped = rows.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parent_id || null,
      status: row.status,
      manager: {
        id: row.manager_id,
        fullName: row.manager_name,
        email: row.manager_email
      },
      openRequisitionCount: Number(row.open_requisition_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return {
      success: true,
      total: mapped.length,
      departments: mapped,
      tree: this.buildTree(mapped)
    };
  }

  async getDepartmentById(id) {
    if (!id) return null;

    const row = (await this.db.prepare(`
      SELECT
        d.id,
        d.code,
        d.name,
        d.parent_id,
        d.manager_id,
        d.status,
        d.created_at,
        d.updated_at,
        u.full_name AS manager_name,
        u.email AS manager_email
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      WHERE d.id = ?
    `).get(id));

    if (!row) return null;

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parent_id || null,
      status: row.status,
      manager: {
        id: row.manager_id,
        fullName: row.manager_name,
        email: row.manager_email
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async createDepartment(data = {}) {
    const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const parentId = data.parentId || null;
    const managerId = data.managerId || null;

    const validation = (await this.validateDepartmentInput({
      code,
      name,
      parentId,
      managerId
    }));

    if (!validation.success) return validation;

    const duplicate = (await this.db.prepare(`
      SELECT id
      FROM departments
      WHERE code = ?
    `).get(code));

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'DEPARTMENT_CODE_EXISTS',
        message: 'Mã phòng ban đã tồn tại.'
      };
    }

    const id = `dept-${crypto.randomUUID()}`;

    (await this.db.prepare(`
      INSERT INTO departments (
        id, code, name, parent_id, manager_id, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(id, code, name, parentId, managerId));

    return {
      success: true,
      statusCode: 201,
      message: 'Tạo phòng ban thành công.',
      data: (await this.getDepartmentById(id))
    };
  }

  async updateDepartment(id, data = {}) {
    if (['code', 'name'].some(key => Object.hasOwn(data, key) && (typeof data[key] !== 'string' || !data[key].trim()))) {
      return { success: false, statusCode: 400, code: 'INVALID_DEPARTMENT_INPUT', message: 'Mã và tên phòng ban không hợp lệ.' };
    }
    const current = (await this.getDepartmentById(id));

    if (!current) {
      return {
        success: false,
        statusCode: 404,
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'Không tìm thấy phòng ban.'
      };
    }

    const code = typeof data.code === 'string'
      ? data.code.trim().toUpperCase()
      : current.code;

    const name = typeof data.name === 'string'
      ? data.name.trim()
      : current.name;

    const parentId = Object.prototype.hasOwnProperty.call(data, 'parentId')
      ? (data.parentId || null)
      : current.parentId;

    const managerId = Object.hasOwn(data, 'managerId') ? data.managerId : current.manager.id;

    if (parentId === id) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_DEPARTMENT_PARENT',
        message: 'Phòng ban không thể là cấp cha của chính nó.'
      };
    }

    if (parentId && (await this.wouldCreateCycle(id, parentId))) {
      return {
        success: false,
        statusCode: 400,
        code: 'DEPARTMENT_TREE_CYCLE',
        message: 'Cấu trúc phòng ban tạo vòng lặp không hợp lệ.'
      };
    }

    const validation = (await this.validateDepartmentInput({
      code,
      name,
      parentId,
      managerId
    }));

    if (!validation.success) return validation;

    const duplicate = (await this.db.prepare(`
      SELECT id
      FROM departments
      WHERE code = ? AND id <> ?
    `).get(code, id));

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'DEPARTMENT_CODE_EXISTS',
        message: 'Mã phòng ban đã tồn tại.'
      };
    }

    (await this.db.prepare(`
      UPDATE departments
      SET
        code = ?,
        name = ?,
        parent_id = ?,
        manager_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(code, name, parentId, managerId, id));

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật phòng ban thành công.',
      data: (await this.getDepartmentById(id))
    };
  }

  async deactivateDepartment(id) {
    const department = (await this.getDepartmentById(id));

    if (!department) {
      return {
        success: false,
        statusCode: 404,
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'Không tìm thấy phòng ban.'
      };
    }

    (await this.db.prepare(`
      UPDATE departments
      SET status = 'INACTIVE', updated_at = datetime('now')
      WHERE id = ?
    `).run(id));

    return {
      success: true,
      statusCode: 200,
      code: 'DEPARTMENT_DEACTIVATED',
      message: 'Phòng ban đã được ngừng áp dụng.',
      data: (await this.getDepartmentById(id))
    };
  }

  async deleteDepartment(id) {
    const department = (await this.getDepartmentById(id));

    if (!department) {
      return {
        success: false,
        statusCode: 404,
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'Không tìm thấy phòng ban.'
      };
    }

    const openRequisitions = (await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM requisitions
      WHERE (
        department_id = ?
        OR (department_id IS NULL AND department_name = ?)
      )
      AND status IN ('OPEN', 'IN_PROGRESS')
    `).get(id, department.name));

    if (Number(openRequisitions.count || 0) > 0) {
      return {
        success: false,
        statusCode: 409,
        code: 'DEPARTMENT_HAS_OPEN_REQUISITIONS',
        message: 'Phòng ban đang có yêu cầu tuyển dụng mở nên không thể xóa. Hãy ngừng áp dụng phòng ban.',
        canDeactivate: true
      };
    }

    const childCount = (await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM departments
      WHERE parent_id = ?
    `).get(id));

    if (Number(childCount.count || 0) > 0) {
      return {
        success: false,
        statusCode: 409,
        code: 'DEPARTMENT_HAS_CHILDREN',
        message: 'Phòng ban đang có đơn vị trực thuộc nên không thể xóa.'
      };
    }

    const userCount = (await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE department_id = ?
    `).get(id));

    if (Number(userCount.count || 0) > 0) {
      return {
        success: false,
        statusCode: 409,
        code: 'DEPARTMENT_HAS_USERS',
        message: 'Phòng ban đang có nhân sự nên không thể xóa. Hãy ngừng áp dụng phòng ban.'
      };
    }

    const requisitionCount = (await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM requisitions
      WHERE department_id = ?
    `).get(id));

    if (Number(requisitionCount.count || 0) > 0) {
      return {
        success: false,
        statusCode: 409,
        code: 'DEPARTMENT_HAS_HISTORY',
        message: 'Phòng ban đã phát sinh dữ liệu tuyển dụng nên không thể xóa. Hãy ngừng áp dụng phòng ban.'
      };
    }

    (await this.db.prepare('DELETE FROM departments WHERE id = ?').run(id));

    return {
      success: true,
      statusCode: 200,
      message: 'Xóa phòng ban thành công.'
    };
  }

  async validateDepartmentInput({ code, name, parentId, managerId }) {
    if (!code) {
      return {
        success: false,
        statusCode: 400,
        code: 'DEPARTMENT_CODE_REQUIRED',
        message: 'Mã phòng ban là bắt buộc.'
      };
    }

    if (!name) {
      return {
        success: false,
        statusCode: 400,
        code: 'DEPARTMENT_NAME_REQUIRED',
        message: 'Tên phòng ban là bắt buộc.'
      };
    }

    if (!managerId) {
      return {
        success: false,
        statusCode: 400,
        code: 'DEPARTMENT_MANAGER_REQUIRED',
        message: 'Mỗi phòng ban phải có một người phụ trách.'
      };
    }

    const manager = (await this.db.prepare(`
      SELECT id, status
      FROM users
      WHERE id = ?
    `).get(managerId));

    if (!manager || manager.status !== 'ACTIVE') {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_DEPARTMENT_MANAGER',
        message: 'Người phụ trách phòng ban không hợp lệ hoặc đang bị khóa.'
      };
    }

    if (parentId) {
      const parent = (await this.db.prepare(`
        SELECT id
        FROM departments
        WHERE id = ?
      `).get(parentId));

      if (!parent) {
        return {
          success: false,
          statusCode: 400,
          code: 'INVALID_PARENT_DEPARTMENT',
          message: 'Phòng ban cấp trên không tồn tại.'
        };
      }
    }

    return { success: true };
  }

  async wouldCreateCycle(departmentId, parentId) {
    let currentId = parentId;
    const visited = new Set();

    while (currentId) {
      if (currentId === departmentId) return true;
      if (visited.has(currentId)) return true;

      visited.add(currentId);

      const row = (await this.db.prepare(`
        SELECT parent_id
        FROM departments
        WHERE id = ?
      `).get(currentId));

      currentId = row ? row.parent_id : null;
    }

    return false;
  }

  buildTree(departments) {
    const map = new Map();
    const roots = [];

    for (const department of departments) {
      map.set(department.id, {
        ...department,
        children: []
      });
    }

    for (const department of map.values()) {
      if (department.parentId && map.has(department.parentId)) {
        map.get(department.parentId).children.push(department);
      } else {
        roots.push(department);
      }
    }

    return roots;
  }
}

module.exports = DepartmentService;
