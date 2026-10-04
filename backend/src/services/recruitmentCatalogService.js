const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

const VALID_TYPES = [
  'CANDIDATE_SOURCE',
  'REJECTION_REASON',
  'WORK_LOCATION',
  'WORK_MODE'
];

class RecruitmentCatalogService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  getItems(type = null, options = {}) {
    if (type && !VALID_TYPES.includes(type)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CATALOG_TYPE',
        message: 'Loại danh mục không hợp lệ.'
      };
    }

    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = this.db.prepare(`
      SELECT
        id,
        type,
        code,
        name,
        display_order,
        status,
        created_at,
        updated_at
      FROM recruitment_catalog_items
      ${where}
      ORDER BY type ASC, display_order ASC, name ASC
    `).all(...params);

    return {
      success: true,
      total: rows.length,
      items: rows.map(row => this.mapItem(row))
    };
  }

  getItemById(id) {
    if (!id) return null;

    const row = this.db.prepare(`
      SELECT
        id,
        type,
        code,
        name,
        display_order,
        status,
        created_at,
        updated_at
      FROM recruitment_catalog_items
      WHERE id = ?
    `).get(id);

    return row ? this.mapItem(row) : null;
  }

  createItem(data = {}) {
    const type = typeof data.type === 'string'
      ? data.type.trim().toUpperCase()
      : '';

    const code = typeof data.code === 'string'
      ? data.code.trim().toUpperCase()
      : '';

    const name = typeof data.name === 'string'
      ? data.name.trim()
      : '';

    const displayOrder = Object.hasOwn(data, 'displayOrder') ? Number(data.displayOrder) : 0;

    const validation = this.validateInput({
      type,
      code,
      name,
      displayOrder
    });

    if (!validation.success) return validation;

    const duplicate = this.db.prepare(`
      SELECT id
      FROM recruitment_catalog_items
      WHERE type = ? AND code = ?
    `).get(type, code);

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'CATALOG_CODE_EXISTS',
        message: 'Mã danh mục đã tồn tại trong loại này.'
      };
    }

    const id = `catalog-${crypto.randomUUID()}`;

    this.db.prepare(`
      INSERT INTO recruitment_catalog_items (
        id,
        type,
        code,
        name,
        display_order,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(id, type, code, name, displayOrder);

    return {
      success: true,
      statusCode: 201,
      message: 'Tạo giá trị danh mục thành công.',
      data: this.getItemById(id)
    };
  }

  updateItem(id, data = {}) {
    if (['code', 'name'].some(key => Object.hasOwn(data, key) && (typeof data[key] !== 'string' || !data[key].trim()))) {
      return { success: false, statusCode: 400, code: 'INVALID_CATALOG_INPUT', message: 'Mã và tên danh mục không hợp lệ.' };
    }
    const current = this.getItemById(id);

    if (!current) {
      return {
        success: false,
        statusCode: 404,
        code: 'CATALOG_ITEM_NOT_FOUND',
        message: 'Không tìm thấy giá trị danh mục.'
      };
    }

    const code = typeof data.code === 'string'
      ? data.code.trim().toUpperCase()
      : current.code;

    const name = typeof data.name === 'string'
      ? data.name.trim()
      : current.name;

    const displayOrder = Object.prototype.hasOwnProperty.call(data, 'displayOrder')
      ? Number(data.displayOrder)
      : current.displayOrder;

    const status = Object.prototype.hasOwnProperty.call(data, 'status')
      ? String(data.status).trim().toUpperCase()
      : current.status;

    const validation = this.validateInput({
      type: current.type,
      code,
      name,
      displayOrder
    });

    if (!validation.success) return validation;

    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CATALOG_STATUS',
        message: 'Trạng thái danh mục không hợp lệ.'
      };
    }

    const duplicate = this.db.prepare(`
      SELECT id
      FROM recruitment_catalog_items
      WHERE type = ?
        AND code = ?
        AND id <> ?
    `).get(current.type, code, id);

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'CATALOG_CODE_EXISTS',
        message: 'Mã danh mục đã tồn tại trong loại này.'
      };
    }

    this.db.prepare(`
      UPDATE recruitment_catalog_items
      SET
        code = ?,
        name = ?,
        display_order = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(code, name, displayOrder, status, id);

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật giá trị danh mục thành công.',
      data: this.getItemById(id)
    };
  }

  reorderItems(type, orderedIds = []) {
    if (!VALID_TYPES.includes(type)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CATALOG_TYPE',
        message: 'Loại danh mục không hợp lệ.'
      };
    }

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'CATALOG_ORDER_REQUIRED',
        message: 'Danh sách sắp xếp không hợp lệ.'
      };
    }

    if (new Set(orderedIds).size !== orderedIds.length) {
      return {
        success: false,
        statusCode: 400,
        code: 'CATALOG_ORDER_DUPLICATE',
        message: 'Danh sách sắp xếp có giá trị bị trùng.'
      };
    }

    const placeholders = orderedIds.map(() => '?').join(', ');

    const rows = this.db.prepare(`
      SELECT id
      FROM recruitment_catalog_items
      WHERE type = ?
        AND id IN (${placeholders})
    `).all(type, ...orderedIds);

    if (rows.length !== orderedIds.length) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CATALOG_ORDER',
        message: 'Danh sách sắp xếp chứa giá trị không thuộc danh mục.'
      };
    }

    const update = this.db.prepare(`
      UPDATE recruitment_catalog_items
      SET display_order = ?, updated_at = datetime('now')
      WHERE id = ? AND type = ?
    `);

    this.db.exec('BEGIN');

    try {
      orderedIds.forEach((id, index) => {
        update.run(index + 1, id, type);
      });

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Sắp xếp thứ tự hiển thị thành công.',
      items: this.getItems(type).items
    };
  }

  deleteItem(id) {
    const item = this.getItemById(id);

    if (!item) {
      return {
        success: false,
        statusCode: 404,
        code: 'CATALOG_ITEM_NOT_FOUND',
        message: 'Không tìm thấy giá trị danh mục.'
      };
    }

    const references = this.getReferenceCounts(id);

    const totalReferences =
      references.candidateSource +
      references.rejectionReason +
      references.workLocation +
      references.workMode;

    if (totalReferences > 0) {
      return {
        success: false,
        statusCode: 409,
        code: 'CATALOG_ITEM_IN_USE',
        message: 'Giá trị danh mục đang được tham chiếu nên không thể xóa.',
        references
      };
    }

    this.db.prepare(`
      DELETE FROM recruitment_catalog_items
      WHERE id = ?
    `).run(id);

    return {
      success: true,
      statusCode: 200,
      message: 'Xóa giá trị danh mục thành công.'
    };
  }

  getReferenceCounts(id) {
    const row = this.db.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM candidates
          WHERE source_id = ?
        ) AS candidate_source_count,

        (
          SELECT COUNT(*)
          FROM candidates
          WHERE rejection_reason_id = ?
        ) AS rejection_reason_count,

        (
          SELECT COUNT(*)
          FROM requisitions
          WHERE work_location_id = ?
        ) AS work_location_count,

        (
          SELECT COUNT(*)
          FROM requisitions
          WHERE work_mode_id = ?
        ) AS work_mode_count
    `).get(id, id, id, id);

    return {
      candidateSource: Number(row.candidate_source_count || 0),
      rejectionReason: Number(row.rejection_reason_count || 0),
      workLocation: Number(row.work_location_count || 0),
      workMode: Number(row.work_mode_count || 0)
    };
  }

  validateInput({ type, code, name, displayOrder }) {
    if (!VALID_TYPES.includes(type)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_CATALOG_TYPE',
        message: 'Loại danh mục không hợp lệ.'
      };
    }

    if (!code) {
      return {
        success: false,
        statusCode: 400,
        code: 'CATALOG_CODE_REQUIRED',
        message: 'Mã danh mục là bắt buộc.'
      };
    }

    if (!name) {
      return {
        success: false,
        statusCode: 400,
        code: 'CATALOG_NAME_REQUIRED',
        message: 'Tên danh mục là bắt buộc.'
      };
    }

    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_DISPLAY_ORDER',
        message: 'Thứ tự hiển thị phải là số nguyên không âm.'
      };
    }

    return { success: true };
  }

  mapItem(row) {
    return {
      id: row.id,
      type: row.type,
      code: row.code,
      name: row.name,
      displayOrder: Number(row.display_order || 0),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = RecruitmentCatalogService;
