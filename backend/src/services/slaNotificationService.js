const crypto = require('node:crypto');
const RequisitionService = require('./requisitionService');

/**
 * ==============================================================================
 * USER STORY S5-10 (SCRUM-120) - CANDIDATE SLA NOTIFICATION & MONITORING SERVICE
 * ==============================================================================
 *
 * Là Nhân viên tuyển dụng, tôi muốn được nhắc khi công việc quá hạn SLA,
 * để không để hồ sơ nằm im ba ngày mà chưa ai đọc.
 *
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Cấu hình ngưỡng SLA cho từng giai đoạn, ví dụ hồ sơ mới phải sàng lọc trong 3 ngày
 *   • AC-02: Quá hạn thì hồ sơ được gắn cờ và recruiter nhận nhắc việc
 *   • AC-03: Tác vụ định kỳ chạy mỗi ngày một lần, không nhắc trùng trong cùng ngày
 * ==============================================================================
 */

// Danh sách các giai đoạn tuyển dụng mặc định và ngưỡng SLA mặc định (tính theo ngày)
const DEFAULT_SLA_THRESHOLDS = Object.freeze({
  NEW: {
    stage: 'NEW',
    stageName: 'Mới ứng tuyển',
    thresholdDays: 3, // Hồ sơ mới phải sàng lọc trong 3 ngày
    warningDays: 2,
    description: 'Hồ sơ mới phải được sàng lọc và phản hồi ban đầu trong vòng 3 ngày.'
  },
  SCREENING: {
    stage: 'SCREENING',
    stageName: 'Sàng lọc',
    thresholdDays: 5,
    warningDays: 3,
    description: 'Đánh giá chi tiết CV và sàng lọc chuyên sâu trong vòng 5 ngày.'
  },
  INTERVIEW: {
    stage: 'INTERVIEW',
    stageName: 'Phỏng vấn',
    thresholdDays: 7,
    warningDays: 5,
    description: 'Điều phối và hoàn thành các vòng phỏng vấn trong vòng 7 ngày.'
  },
  OFFER: {
    stage: 'OFFER',
    stageName: 'Đề nghị việc làm',
    thresholdDays: 5,
    warningDays: 3,
    description: 'Gửi và theo dõi phản hồi đề nghị việc làm trong vòng 5 ngày.'
  }
});

class SlaNotificationService {
  constructor(db) {
    this.db = db;
    this.requisitions = new RequisitionService(db);
    this.ensureTables();
  }

  /**
   * Tự động khởi tạo bảng dữ liệu cấu hình SLA, nhật ký vi phạm và nhắc việc
   */
  ensureTables() {
    if (this.db && this.db.__slaTablesInitialized) return;
    const isPostgres = this.db.provider === 'postgres';

    // 1. Bảng cấu hình SLA theo giai đoạn (Stage SLA Configuration)
    const slaConfigTableSql = isPostgres
      ? `CREATE TABLE IF NOT EXISTS sla_configurations (
           id TEXT PRIMARY KEY,
           stage TEXT NOT NULL,
           requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
           threshold_days INTEGER NOT NULL DEFAULT 3,
           warning_days INTEGER NOT NULL DEFAULT 2,
           description TEXT,
           is_active INTEGER NOT NULL DEFAULT 1,
           created_by TEXT,
           updated_by TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE (stage, requisition_id)
         )`
      : `CREATE TABLE IF NOT EXISTS sla_configurations (
           id TEXT PRIMARY KEY,
           stage TEXT NOT NULL,
           requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
           threshold_days INTEGER NOT NULL DEFAULT 3,
           warning_days INTEGER NOT NULL DEFAULT 2,
           description TEXT,
           is_active INTEGER NOT NULL DEFAULT 1,
           created_by TEXT,
           updated_by TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')),
           UNIQUE (stage, requisition_id)
         )`;

    // 2. Bảng cờ vi phạm SLA của hồ sơ (Candidate SLA Breaches)
    const slaBreachesTableSql = isPostgres
      ? `CREATE TABLE IF NOT EXISTS candidate_sla_breaches (
           id TEXT PRIMARY KEY,
           candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
           requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
           stage TEXT NOT NULL,
           threshold_days INTEGER NOT NULL,
           days_in_stage INTEGER NOT NULL,
           is_overdue INTEGER NOT NULL DEFAULT 1,
           flag_level TEXT NOT NULL DEFAULT 'BREACHED',
           flagged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           resolved_at TIMESTAMPTZ,
           status TEXT NOT NULL DEFAULT 'ACTIVE'
         )`
      : `CREATE TABLE IF NOT EXISTS candidate_sla_breaches (
           id TEXT PRIMARY KEY,
           candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
           requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
           stage TEXT NOT NULL,
           threshold_days INTEGER NOT NULL,
           days_in_stage INTEGER NOT NULL,
           is_overdue INTEGER NOT NULL DEFAULT 1,
           flag_level TEXT NOT NULL DEFAULT 'BREACHED',
           flagged_at TEXT NOT NULL DEFAULT (datetime('now')),
           resolved_at TEXT,
           status TEXT NOT NULL DEFAULT 'ACTIVE'
         )`;

    // 3. Bảng nhắc việc gửi tới Recruiter (Recruiter SLA Reminders)
    // Ràng buộc chống nhắc trùng trong cùng ngày: UNIQUE(candidate_id, stage, reminder_date, recruiter_id)
    const slaRemindersTableSql = isPostgres
      ? `CREATE TABLE IF NOT EXISTS sla_reminders (
           id TEXT PRIMARY KEY,
           candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
           requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
           recruiter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           stage TEXT NOT NULL,
           threshold_days INTEGER NOT NULL,
           days_in_stage INTEGER NOT NULL,
           reminder_date TEXT NOT NULL,
           reminder_title TEXT NOT NULL,
           reminder_message TEXT NOT NULL,
           is_read INTEGER NOT NULL DEFAULT 0,
           read_at TIMESTAMPTZ,
           created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE (candidate_id, stage, reminder_date, recruiter_id)
         )`
      : `CREATE TABLE IF NOT EXISTS sla_reminders (
           id TEXT PRIMARY KEY,
           candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
           requisition_id TEXT REFERENCES requisitions(id) ON DELETE CASCADE,
           recruiter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           stage TEXT NOT NULL,
           threshold_days INTEGER NOT NULL,
           days_in_stage INTEGER NOT NULL,
           reminder_date TEXT NOT NULL,
           reminder_title TEXT NOT NULL,
           reminder_message TEXT NOT NULL,
           is_read INTEGER NOT NULL DEFAULT 0,
           read_at TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           UNIQUE (candidate_id, stage, reminder_date, recruiter_id)
         )`;

    // 4. Bảng nhật ký chạy tác vụ định kỳ mỗi ngày (Daily SLA Job Executions)
    const slaJobExecutionsTableSql = isPostgres
      ? `CREATE TABLE IF NOT EXISTS sla_job_executions (
           id TEXT PRIMARY KEY,
           execution_date TEXT NOT NULL,
           executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           candidates_scanned INTEGER NOT NULL DEFAULT 0,
           breaches_found INTEGER NOT NULL DEFAULT 0,
           reminders_created INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'SUCCESS',
           summary_json TEXT
         )`
      : `CREATE TABLE IF NOT EXISTS sla_job_executions (
           id TEXT PRIMARY KEY,
           execution_date TEXT NOT NULL,
           executed_at TEXT NOT NULL DEFAULT (datetime('now')),
           candidates_scanned INTEGER NOT NULL DEFAULT 0,
           breaches_found INTEGER NOT NULL DEFAULT 0,
           reminders_created INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'SUCCESS',
           summary_json TEXT
         )`;

    try {
      this.db.exec(slaConfigTableSql);
      this.db.exec(slaBreachesTableSql);
      this.db.exec(slaRemindersTableSql);
      this.db.exec(slaJobExecutionsTableSql);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sla_conf_stage ON sla_configurations(stage);
        CREATE INDEX IF NOT EXISTS idx_sla_breaches_cand ON candidate_sla_breaches(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_sla_breaches_status ON candidate_sla_breaches(status);
        CREATE INDEX IF NOT EXISTS idx_sla_reminders_recruiter ON sla_reminders(recruiter_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_sla_reminders_date ON sla_reminders(reminder_date);
      `);

      this.seedDefaultConfigurationsSync();
      if (this.db) this.db.__slaTablesInitialized = true;
    } catch (err) {
      console.warn('[SlaNotificationService] Table initialization note:', err.message);
    }
  }

  /**
   * Nạp cấu hình SLA mặc định nếu chưa tồn tại
   */
  seedDefaultConfigurationsSync() {
    try {
      for (const key of Object.keys(DEFAULT_SLA_THRESHOLDS)) {
        const item = DEFAULT_SLA_THRESHOLDS[key];
        const existing = this.db.prepare(
          `SELECT id FROM sla_configurations WHERE stage = ? AND requisition_id IS NULL`
        ).get(item.stage);

        if (!existing) {
          const id = `sla-cfg-${item.stage.toLowerCase()}`;
          this.db.prepare(
            `INSERT INTO sla_configurations (
               id, stage, requisition_id, threshold_days, warning_days, description, is_active
             ) VALUES (?, ?, NULL, ?, ?, ?, 1)`
          ).run(id, item.stage, item.thresholdDays, item.warningDays, item.description);
        }
      }
    } catch (err) {
      console.warn('[SlaNotificationService] Seed default configs note:', err.message);
    }
  }

  // ============================================================================
  // AC-01: CẤU HÌNH NGƯỠNG SLA CHO TỪNG GIAI ĐOẠN (GET / PUT)
  // ============================================================================

  /**
   * Lấy danh sách cấu hình ngưỡng SLA (hệ thống hoặc theo vị trí tuyển dụng)
   */
  async getSlaConfigurations(requisitionId = null) {
    try {
      let configs = [];
      if (requisitionId) {
        configs = await this.db.prepare(
          `SELECT * FROM sla_configurations WHERE requisition_id = ? ORDER BY stage ASC`
        ).all(requisitionId);
      }

      if (!configs || configs.length === 0) {
        configs = await this.db.prepare(
          `SELECT * FROM sla_configurations WHERE requisition_id IS NULL ORDER BY stage ASC`
        ).all();
      }

      // Đảm bảo đầy đủ các stage từ DEFAULT_SLA_THRESHOLDS
      const result = [];
      for (const key of ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER']) {
        const found = (configs || []).find(c => c.stage === key);
        const fallback = DEFAULT_SLA_THRESHOLDS[key];
        result.push({
          id: found ? found.id : `sla-cfg-${key.toLowerCase()}`,
          stage: key,
          stageName: fallback.stageName,
          thresholdDays: found ? Number(found.threshold_days) : fallback.thresholdDays,
          warningDays: found ? Number(found.warning_days) : fallback.warningDays,
          description: found ? (found.description || fallback.description) : fallback.description,
          isActive: found ? Boolean(found.is_active) : true,
          requisitionId: found ? found.requisition_id : null
        });
      }

      return {
        success: true,
        statusCode: 200,
        data: result
      };
    } catch (err) {
      return {
        success: false,
        statusCode: 500,
        code: 'SLA_CONFIG_READ_ERROR',
        message: 'Lỗi khi đọc cấu hình SLA: ' + err.message
      };
    }
  }

  async getSlaConfigs(requisitionId = null) {
    const res = await this.getSlaConfigurations(requisitionId);
    return res && Array.isArray(res.data) ? res.data : [];
  }

  /**
   * Cập nhật ngưỡng SLA cho từng giai đoạn (AC-01)
   * @param {Array} configs Danh sách cấu hình [{ stage, thresholdDays, warningDays, description }]
   * @param {object} currentUser Người dùng thực hiện
   * @param {string|null} requisitionId ID vị trí nếu cấu hình riêng
   */
  async updateSlaConfigurations(configs, currentUser, requisitionId = null) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const roles = currentUser.roles || [];
    const isAuthorized = roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r));
    if (!isAuthorized) {
      return {
        success: false,
        statusCode: 403,
        code: 'SLA_CONFIG_FORBIDDEN',
        message: 'Bạn không có quyền thay đổi cấu hình ngưỡng SLA.'
      };
    }

    if (!Array.isArray(configs) || configs.length === 0) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_SLA_CONFIG',
        message: 'Dữ liệu cấu hình SLA phải là một danh sách hợp lệ.'
      };
    }

    const isPostgres = this.db.provider === 'postgres';
    const updated = [];

    for (const item of configs) {
      const stage = (item.stage || '').trim().toUpperCase();
      if (!['NEW', 'SCREENING', 'INTERVIEW', 'OFFER'].includes(stage)) {
        continue;
      }

      const thresholdDays = Math.max(1, parseInt(item.thresholdDays, 10) || DEFAULT_SLA_THRESHOLDS[stage].thresholdDays);
      const warningDays = Math.max(0, parseInt(item.warningDays, 10) || Math.max(1, thresholdDays - 1));
      const description = typeof item.description === 'string' ? item.description.trim() : (DEFAULT_SLA_THRESHOLDS[stage]?.description || '');

      let existing;
      if (requisitionId) {
        existing = await this.db.prepare(
          `SELECT id FROM sla_configurations WHERE stage = ? AND requisition_id = ?`
        ).get(stage, requisitionId);
      } else {
        existing = await this.db.prepare(
          `SELECT id FROM sla_configurations WHERE stage = ? AND requisition_id IS NULL`
        ).get(stage);
      }

      if (existing) {
        const updateSql = isPostgres
          ? `UPDATE sla_configurations
             SET threshold_days = ?, warning_days = ?, description = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          : `UPDATE sla_configurations
             SET threshold_days = ?, warning_days = ?, description = ?, updated_by = ?, updated_at = datetime('now')
             WHERE id = ?`;
        await this.db.prepare(updateSql).run(thresholdDays, warningDays, description, currentUser.id, existing.id);
        updated.push({ stage, thresholdDays, warningDays, id: existing.id });
      } else {
        const newId = `sla-cfg-${stage.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
        const insertSql = `
          INSERT INTO sla_configurations (
            id, stage, requisition_id, threshold_days, warning_days, description, is_active, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `;
        await this.db.prepare(insertSql).run(newId, stage, requisitionId || null, thresholdDays, warningDays, description, currentUser.id, currentUser.id);
        updated.push({ stage, thresholdDays, warningDays, id: newId });
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật cấu hình ngưỡng SLA thành công.',
      data: updated
    };
  }

  // ============================================================================
  // TÍNH TOÁN SLA CHO MỘT HỒ SƠ ỨNG VIÊN (CALCULATE CANDIDATE SLA)
  // ============================================================================

  /**
   * Tính số ngày hồ sơ đã ở giai đoạn hiện tại và đối chiếu với ngưỡng SLA
   * @param {object} candidate Thông tin hồ sơ ứng viên
   * @param {object} configMap Map cấu hình SLA theo stage
   * @param {Date|string} referenceDate Ngày mốc để tính toán (mặc định là hiện tại)
   */
  async calculateCandidateSla(candidate, configMap = null, referenceDate = null) {
    if (!candidate || !candidate.id) {
      return null;
    }

    const stage = (candidate.stage || 'NEW').toUpperCase();

    // Các giai đoạn kết thúc / đã tuyển / từ chối / rút lui thì không áp dụng SLA
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(stage)) {
      return {
        candidateId: candidate.id,
        stage,
        isOverdue: false,
        daysInStage: 0,
        thresholdDays: 0,
        overdueDays: 0,
        flag: 'RESOLVED',
        label: 'Đã hoàn tất / Không áp dụng SLA'
      };
    }

    // 1. Lấy ngưỡng SLA cho stage hiện tại
    let thresholdDays = DEFAULT_SLA_THRESHOLDS[stage]?.thresholdDays || 3;
    let warningDays = DEFAULT_SLA_THRESHOLDS[stage]?.warningDays || 2;

    if (configMap && configMap[stage]) {
      thresholdDays = configMap[stage].thresholdDays;
      warningDays = configMap[stage].warningDays;
    } else {
      try {
        const reqId = candidate.requisition_id || candidate.requisitionId || (candidate.requisition && candidate.requisition.id) || null;
        const found = await this.db.prepare(
          `SELECT threshold_days, warning_days FROM sla_configurations
           WHERE stage = ? AND (requisition_id = ? OR requisition_id IS NULL)
           ORDER BY requisition_id DESC LIMIT 1`
        ).get(stage, reqId);
        if (found) {
          thresholdDays = Number(found.threshold_days);
          warningDays = Number(found.warning_days);
        }
      } catch {
        // Fallback default
      }
    }

    // 2. Xác định thời điểm ứng viên bắt đầu ở giai đoạn hiện tại (stageEntryTime)
    // Ưu tiên tìm trong candidate_status_history, nếu không có lấy candidate.created_at
    let stageEntryTime = null;
    try {
      const historyEntry = await this.db.prepare(
        `SELECT created_at FROM candidate_status_history
         WHERE candidate_id = ? AND after_stage = ?
         ORDER BY created_at DESC LIMIT 1`
      ).get(candidate.id, stage);
      if (historyEntry && historyEntry.created_at) {
        stageEntryTime = new Date(historyEntry.created_at);
      }
    } catch {
      // Bảng candidate_status_history chưa tồn tại hoặc lỗi
    }

    if (!stageEntryTime || isNaN(stageEntryTime.getTime())) {
      const createdRaw = candidate.created_at || candidate.createdAt;
      stageEntryTime = createdRaw ? new Date(createdRaw) : new Date();
    }

    // 3. Tính số ngày đã trôi qua
    const now = referenceDate ? new Date(referenceDate) : new Date();
    const diffMs = now.getTime() - stageEntryTime.getTime();
    // Số ngày nguyên trôi qua (làm tròn xuống hoặc tối thiểu 0)
    const daysInStage = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));

    const isOverdue = daysInStage >= thresholdDays;
    const overdueDays = isOverdue ? (daysInStage - thresholdDays) : 0;
    const isWarning = !isOverdue && daysInStage >= warningDays;

    let flag = 'ON_TRACK';
    let label = `Đang đúng hạn (${daysInStage}/${thresholdDays} ngày)`;

    if (isOverdue) {
      flag = 'BREACHED';
      label = `Quá hạn SLA ${overdueDays > 0 ? `+${overdueDays}` : ''} ngày (${daysInStage}/${thresholdDays} ngày)`;
    } else if (isWarning) {
      flag = 'WARNING';
      label = `Sắp chạm ngưỡng (${daysInStage}/${thresholdDays} ngày)`;
    }

    return {
      candidateId: candidate.id,
      stage,
      stageEntryDate: stageEntryTime.toISOString(),
      daysInStage,
      thresholdDays,
      warningDays,
      isOverdue,
      overdueDays,
      flag,
      label
    };
  }

  // ============================================================================
  // AC-02: GẮN CỜ HỒ SƠ QUÁ HẠN & DANH SÁCH HỒ SƠ QUÁ HẠN
  // ============================================================================

  /**
   * Lấy danh sách các hồ sơ ứng viên đang bị quá hạn SLA
   * @param {object} currentUser Người dùng đang thực hiện yêu cầu
   * @param {object} options Bộ lọc (requisitionId, stage, search, limit, offset)
   */
  async getOverdueCandidates(currentUser, options = {}) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const roles = currentUser.roles || [];
    const isAdminOrHr = roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r));
    const isRecruiter = roles.includes('RECRUITER');

    if (!isAdminOrHr && !isRecruiter) {
      return {
        success: false,
        statusCode: 403,
        code: 'CANDIDATE_FORBIDDEN',
        message: 'Bạn không có quyền truy cập báo cáo SLA ứng viên.'
      };
    }

    // Nạp cấu hình SLA
    const cfgResult = await this.getSlaConfigurations();
    const configMap = {};
    for (const c of (cfgResult.data || [])) {
      configMap[c.stage] = c;
    }

    // Lấy danh sách ứng viên đang trong quy trình
    let sql = `
      SELECT c.*, r.title AS requisition_title, r.code AS requisition_code,
             r.recruiter_id, r.department_name
      FROM candidates c
      LEFT JOIN requisitions r ON r.id = c.requisition_id
      WHERE (c.stage IS NULL OR c.stage NOT IN ('HIRED', 'REJECTED', 'WITHDRAWN'))
    `;
    const params = [];

    // Phân quyền phạm vi dữ liệu IDOR: Recruiter chỉ thấy hồ sơ thuộc vị trí mình phụ trách
    if (!isAdminOrHr && isRecruiter) {
      sql += ` AND (
        r.recruiter_id = ?
        OR EXISTS (SELECT 1 FROM requisition_recruiter_supports WHERE requisition_id = r.id AND user_id = ?)
      )`;
      params.push(currentUser.id, currentUser.id);
    }

    if (options.requisitionId && options.requisitionId !== 'ALL') {
      sql += ` AND c.requisition_id = ?`;
      params.push(options.requisitionId);
    }

    if (options.stage && options.stage !== 'ALL') {
      sql += ` AND c.stage = ?`;
      params.push(options.stage);
    }

    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim()}%`;
      sql += ` AND (c.full_name LIKE ? OR c.email LIKE ? OR c.phone_number LIKE ?)`;
      params.push(q, q, q);
    }

    sql += ` ORDER BY c.created_at ASC`;

    const candidates = await this.db.prepare(sql).all(...params);

    const overdueList = [];
    const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();

    for (const cand of (candidates || [])) {
      const sla = await this.calculateCandidateSla(cand, configMap, referenceDate);
      if (sla && (sla.isOverdue || options.includeAll === true)) {
        overdueList.push({
          id: cand.id,
          fullName: cand.full_name,
          email: cand.email,
          phoneNumber: cand.phone_number,
          requisitionId: cand.requisition_id,
          requisitionTitle: cand.requisition_title,
          requisitionCode: cand.requisition_code,
          departmentName: cand.department_name,
          stage: cand.stage,
          experienceYears: cand.experience_years,
          createdAt: cand.created_at,
          sla
        });
      }
    }

    // Sắp xếp: Hồ sơ quá hạn nhiều ngày nhất lên trên cùng
    overdueList.sort((a, b) => (b.sla.overdueDays - a.sla.overdueDays) || (b.sla.daysInStage - a.sla.daysInStage));

    return {
      success: true,
      statusCode: 200,
      data: {
        totalOverdue: overdueList.filter(item => item.sla.isOverdue).length,
        candidates: overdueList
      }
    };
  }

  // ============================================================================
  // AC-03: TÁC VỤ ĐỊNH KỲ CHẠY MỖI NGÀY 1 LẦN, KHÔNG NHẮC TRÙNG TRONG CÙNG NGÀY
  // ============================================================================

  /**
   * Thực hiện tác vụ kiểm tra SLA định kỳ hàng ngày (AC-03)
   * Quét toàn bộ hồ sơ, gắn cờ quá hạn và gửi nhắc việc tới Recruiter
   * ĐẢM BẢO: Không nhắc trùng trong cùng ngày (Deduplication per calendar day)
   *
   * @param {string|null} targetDate Ngày chạy tác vụ định dạng YYYY-MM-DD (mặc định là hôm nay)
   * @param {object|null} currentUser Người chạy tác vụ thủ công (nếu có)
   */
  async runDailySlaCheck(targetDate = null, currentUser = null) {
    const isPostgres = this.db.provider === 'postgres';
    const now = targetDate ? new Date(targetDate) : new Date();
    const todayStr = targetDate || now.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    // 1. Nạp cấu hình SLA
    const cfgResult = await this.getSlaConfigurations();
    const configMap = {};
    for (const c of (cfgResult.data || [])) {
      configMap[c.stage] = c;
    }

    // 2. Lấy tất cả hồ sơ đang mở trong hệ thống
    const candidates = await this.db.prepare(`
      SELECT c.*, r.title AS requisition_title, r.code AS requisition_code,
             r.recruiter_id
      FROM candidates c
      LEFT JOIN requisitions r ON r.id = c.requisition_id
      WHERE (c.stage IS NULL OR c.stage NOT IN ('HIRED', 'REJECTED', 'WITHDRAWN'))
    `).all();

    let scannedCount = 0;
    let breachesFound = 0;
    let remindersCreated = 0;
    const breachedCandidates = [];

    for (const cand of (candidates || [])) {
      scannedCount++;
      const sla = await this.calculateCandidateSla(cand, configMap, now);

      if (sla && sla.isOverdue) {
        breachesFound++;
        breachedCandidates.push({ candidate: cand, sla });

        // 2.1 Cập nhật hoặc ghi nhận cờ vi phạm vào candidate_sla_breaches
        try {
          const breachId = `sla-brk-${cand.id}-${sla.stage.toLowerCase()}`;
          const existingBreach = await this.db.prepare(
            `SELECT id FROM candidate_sla_breaches WHERE candidate_id = ? AND stage = ? AND status = 'ACTIVE'`
          ).get(cand.id, sla.stage);

          if (existingBreach) {
            await this.db.prepare(
              `UPDATE candidate_sla_breaches
               SET days_in_stage = ?, threshold_days = ?, is_overdue = 1, flagged_at = ${isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
               WHERE id = ?`
            ).run(sla.daysInStage, sla.thresholdDays, existingBreach.id);
          } else {
            const insertBreachSql = isPostgres
              ? `INSERT INTO candidate_sla_breaches (
                   id, candidate_id, requisition_id, stage, threshold_days, days_in_stage, is_overdue, flag_level, flagged_at, status
                 ) VALUES (?, ?, ?, ?, ?, ?, 1, 'BREACHED', CURRENT_TIMESTAMP, 'ACTIVE')`
              : `INSERT INTO candidate_sla_breaches (
                   id, candidate_id, requisition_id, stage, threshold_days, days_in_stage, is_overdue, flag_level, flagged_at, status
                 ) VALUES (?, ?, ?, ?, ?, ?, 1, 'BREACHED', datetime('now'), 'ACTIVE')`;
            await this.db.prepare(insertBreachSql).run(
              breachId, cand.id, cand.requisition_id || null, sla.stage, sla.thresholdDays, sla.daysInStage
            );
          }
        } catch (bErr) {
          console.warn('[runDailySlaCheck] Breach record note:', bErr.message);
        }

        // 2.2 Xác định Recruiter cần nhận nhắc việc
        const recruiterIds = new Set();
        if (cand.recruiter_id) {
          recruiterIds.add(cand.recruiter_id);
        }

        // Tìm thêm recruiter hỗ trợ cho vị trí này
        if (cand.requisition_id) {
          try {
            const supports = await this.db.prepare(
              `SELECT user_id FROM requisition_recruiter_supports WHERE requisition_id = ?`
            ).all(cand.requisition_id);
            for (const s of (supports || [])) {
              if (s.user_id) recruiterIds.add(s.user_id);
            }
          } catch {
            // Bảng hỗ trợ không tồn tại
          }
        }

        // Nếu vị trí chưa có recruiter nào, gán cho admin hoặc fallback
        if (recruiterIds.size === 0) {
          try {
            const defaultRecruiter = await this.db.prepare(
              `SELECT u.id FROM users u
               JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles r ON r.id = ur.role_id
               WHERE r.code IN ('RECRUITER', 'ADMIN') AND u.status = 'ACTIVE'
               LIMIT 1`
            ).get();
            if (defaultRecruiter && defaultRecruiter.id) {
              recruiterIds.add(defaultRecruiter.id);
            }
          } catch {
            // Không tìm thấy user
          }
        }

        // 2.3 Gửi nhắc việc (sla_reminders) - ĐẢM BẢO KHÔNG NHẮC TRÙNG TRONG CÙNG NGÀY (AC-03)
        const stageLabel = DEFAULT_SLA_THRESHOLDS[sla.stage]?.stageName || sla.stage;
        const reqTitle = cand.requisition_title ? ` (${cand.requisition_title})` : '';
        const reminderTitle = `[Nhắc việc SLA] Hồ sơ ${cand.full_name} quá hạn giai đoạn ${stageLabel}`;
        const reminderMessage = `Hồ sơ ứng viên "${cand.full_name}"${reqTitle} đã ở giai đoạn "${stageLabel}" ${sla.daysInStage} ngày, vượt quá ngưỡng SLA quy định (${sla.thresholdDays} ngày). Vui lòng kiểm tra và xử lý để tránh để hồ sơ nằm im.`;

        for (const recruiterId of recruiterIds) {
          // KIỂM TRA CHỐNG NHẮC TRÙNG: Trong cùng 1 ngày (todayStr), nếu đã nhắc rồi thì BỎ QUA
          const existingReminder = await this.db.prepare(
            `SELECT id FROM sla_reminders
             WHERE candidate_id = ? AND stage = ? AND reminder_date = ? AND recruiter_id = ?`
          ).get(cand.id, sla.stage, todayStr, recruiterId);

          if (!existingReminder) {
            const reminderId = `sla-rem-${cand.id}-${recruiterId}-${todayStr}`;
            try {
              const insertRemSql = isPostgres
                ? `INSERT INTO sla_reminders (
                     id, candidate_id, requisition_id, recruiter_id, stage, threshold_days, days_in_stage,
                     reminder_date, reminder_title, reminder_message, is_read, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
                : `INSERT INTO sla_reminders (
                     id, candidate_id, requisition_id, recruiter_id, stage, threshold_days, days_in_stage,
                     reminder_date, reminder_title, reminder_message, is_read, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`;

              await this.db.prepare(insertRemSql).run(
                reminderId, cand.id, cand.requisition_id || null, recruiterId, sla.stage,
                sla.thresholdDays, sla.daysInStage, todayStr, reminderTitle, reminderMessage
              );
              remindersCreated++;

              // Gửi email thông báo nhắc việc (notification / email) tới Recruiter
              try {
                const recruiterUser = await this.db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(recruiterId);
                if (recruiterUser && recruiterUser.email) {
                  const EmailService = require('./emailService');
                  const emailService = new EmailService(this.db);
                  emailService.sendMail({
                    to: recruiterUser.email,
                    subject: reminderTitle,
                    text: reminderMessage,
                    templateName: 'SLA_REMINDER'
                  }).catch(() => {});
                }
              } catch {
                // Không làm gián đoạn tác vụ nếu cấu hình SMTP ngoại tuyến
              }
            } catch (rErr) {
              // Bỏ qua lỗi duplicate nếu đồng thời chèn
              console.warn('[runDailySlaCheck] Duplicate reminder avoided:', rErr.message);
            }
          }
        }
      } else {
        // Nếu hồ sơ không còn quá hạn (đã chuyển stage hoặc bình thường), đánh dấu resolve cờ cũ
        try {
          await this.db.prepare(
            `UPDATE candidate_sla_breaches
             SET status = 'RESOLVED', resolved_at = ${isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
             WHERE candidate_id = ? AND status = 'ACTIVE' AND stage <> ?`
          ).run(cand.id, cand.stage);
        } catch {
          // Bỏ qua
        }
      }
    }

    // 3. Ghi nhật ký chạy tác vụ định kỳ
    const executionId = `sla-exec-${todayStr}-${crypto.randomBytes(3).toString('hex')}`;
    try {
      const summaryJson = JSON.stringify({
        date: todayStr,
        scannedCount,
        breachesFound,
        remindersCreated,
        executedBy: currentUser ? currentUser.id : 'SYSTEM_SCHEDULER'
      });

      const insertExecSql = isPostgres
        ? `INSERT INTO sla_job_executions (id, execution_date, executed_at, candidates_scanned, breaches_found, reminders_created, status, summary_json)
           VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'SUCCESS', ?)`
        : `INSERT INTO sla_job_executions (id, execution_date, executed_at, candidates_scanned, breaches_found, reminders_created, status, summary_json)
           VALUES (?, ?, datetime('now'), ?, ?, ?, 'SUCCESS', ?)`;

      await this.db.prepare(insertExecSql).run(
        executionId, todayStr, scannedCount, breachesFound, remindersCreated, summaryJson
      );
    } catch (eErr) {
      console.warn('[runDailySlaCheck] Job log note:', eErr.message);
    }

    return {
      success: true,
      statusCode: 200,
      message: `Tác vụ kiểm tra SLA ngày ${todayStr} hoàn tất: Quét ${scannedCount} hồ sơ, phát hiện ${breachesFound} hồ sơ quá hạn, tạo ${remindersCreated} thông báo nhắc việc mới.`,
      data: {
        date: todayStr,
        scannedCount,
        breachesFound,
        remindersCreated,
        breachedCandidatesCount: breachedCandidates.length
      }
    };
  }

  // ============================================================================
  // QUẢN LÝ NHẮC VIỆC CỦA RECRUITER (RECRUITER REMINDERS)
  // ============================================================================

  /**
   * Lấy danh sách nhắc việc quá hạn của Recruiter hiện tại
   */
  async getRecruiterReminders(currentUser, options = {}) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const unreadOnly = options.unreadOnly === true || options.unreadOnly === 'true';
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));

    let sql = `
      SELECT r.*, c.full_name AS candidate_name, c.email AS candidate_email,
             c.phone_number AS candidate_phone, req.title AS requisition_title,
             req.code AS requisition_code
      FROM sla_reminders r
      LEFT JOIN candidates c ON c.id = r.candidate_id
      LEFT JOIN requisitions req ON req.id = r.requisition_id
      WHERE r.recruiter_id = ?
    `;
    const params = [currentUser.id];

    if (unreadOnly) {
      sql += ` AND r.is_read = 0`;
    }

    sql += ` ORDER BY r.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.prepare(sql).all(...params);

    // Đếm tổng số chưa đọc
    const unreadCountRow = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM sla_reminders WHERE recruiter_id = ? AND is_read = 0`
    ).get(currentUser.id);
    const unreadCount = unreadCountRow ? Number(unreadCountRow.total) : 0;

    return {
      success: true,
      statusCode: 200,
      data: {
        unreadCount,
        reminders: (rows || []).map(r => ({
          id: r.id,
          candidateId: r.candidate_id,
          candidateName: r.candidate_name,
          candidateEmail: r.candidate_email,
          requisitionId: r.requisition_id,
          requisitionTitle: r.requisition_title,
          stage: r.stage,
          thresholdDays: r.threshold_days,
          daysInStage: r.days_in_stage,
          reminderDate: r.reminder_date,
          title: r.reminder_title,
          message: r.reminder_message,
          isRead: Boolean(r.is_read),
          createdAt: r.created_at
        }))
      }
    };
  }

  /**
   * Đánh dấu nhắc việc là đã đọc
   */
  async markReminderAsRead(reminderId, currentUser) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const isPostgres = this.db.provider === 'postgres';
    const updateSql = isPostgres
      ? `UPDATE sla_reminders SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ? AND recruiter_id = ?`
      : `UPDATE sla_reminders SET is_read = 1, read_at = datetime('now') WHERE id = ? AND recruiter_id = ?`;

    const res = await this.db.prepare(updateSql).run(reminderId, currentUser.id);

    if (res.changes === 0) {
      return { success: false, statusCode: 404, message: 'Không tìm thấy nhắc việc hoặc không có quyền.' };
    }

    return { success: true, statusCode: 200, message: 'Đã đánh dấu nhắc việc là đã đọc.' };
  }

  /**
   * Đánh dấu toàn bộ nhắc việc của recruiter là đã đọc
   */
  async markAllRemindersAsRead(currentUser) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const isPostgres = this.db.provider === 'postgres';
    const updateSql = isPostgres
      ? `UPDATE sla_reminders SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE recruiter_id = ? AND is_read = 0`
      : `UPDATE sla_reminders SET is_read = 1, read_at = datetime('now') WHERE recruiter_id = ? AND is_read = 0`;

    await this.db.prepare(updateSql).run(currentUser.id);
    return { success: true, statusCode: 200, message: 'Đã đánh dấu tất cả nhắc việc là đã đọc.' };
  }

  // ============================================================================
  // THỐNG KÊ TỔNG QUAN SLA (SLA KPI & COMPLIANCE SUMMARY)
  // ============================================================================

  async getSlaSummary(currentUser) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const overdueResult = await this.getOverdueCandidates(currentUser, { includeAll: true });
    const all = overdueResult.data?.candidates || [];
    const totalActive = all.length;
    const totalOverdue = all.filter(c => c.sla.isOverdue).length;
    const totalWarning = all.filter(c => c.sla.flag === 'WARNING').length;
    const totalOnTrack = all.filter(c => c.sla.flag === 'ON_TRACK').length;
    const complianceRate = totalActive > 0 ? Math.round(((totalActive - totalOverdue) / totalActive) * 100) : 100;

    return {
      success: true,
      statusCode: 200,
      data: {
        totalActive,
        totalOverdue,
        totalWarning,
        totalOnTrack,
        complianceRate
      }
    };
  }
}

module.exports = SlaNotificationService;
