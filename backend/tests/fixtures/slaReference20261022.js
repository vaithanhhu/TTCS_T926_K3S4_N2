// Immutable pre-P0 reference: backend/src/services/slaNotificationService.js
// SHA256 of original complete service: 1164f0828ffc43773db2e45aaa4e8ec038c1d021887379a1ec1d83dee5854f5a
const SlaNotificationService = require('../../src/services/slaNotificationService');
function databaseDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const raw = String(value).trim().replace(' ', 'T');
  return new Date(raw + (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? 'Z' : ''));
}

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

module.exports = class SlaReference20261022 extends SlaNotificationService {
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

    const requisitionId = candidate.requisition_id || candidate.requisitionId || candidate.requisition?.id || null;
    const scopedConfig = requisitionId ? await this.db.prepare(
      'SELECT threshold_days,warning_days FROM sla_configurations WHERE stage=? AND requisition_id=?'
    ).get(stage,requisitionId) : null;
    if (scopedConfig) {
      thresholdDays = Number(scopedConfig.threshold_days);
      warningDays = Number(scopedConfig.warning_days);
    } else if (configMap && configMap[stage]) {
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
    const historyPresent = await this.db.prepare(this.db.provider === 'postgres'
      ? "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='candidate_status_history'"
      : "SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_status_history'").get();
    if (historyPresent) {
      const historyEntry = await this.db.prepare(
        'SELECT created_at FROM candidate_status_history WHERE candidate_id=? AND after_stage=? ORDER BY created_at DESC LIMIT 1'
      ).get(candidate.id, stage);
      if (historyEntry?.created_at) stageEntryTime = databaseDate(historyEntry.created_at);
    }

    if (!stageEntryTime || isNaN(stageEntryTime.getTime())) {
      const createdRaw = candidate.created_at || candidate.createdAt;
      stageEntryTime = createdRaw ? databaseDate(createdRaw) : new Date();
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

  async getOverdueCandidates(currentUser, options = {}) {
    if (currentUser?.id) currentUser = await new (require('../../src/middlewares/rbacMiddleware'))(this.db).getAuthorizedActor(currentUser.id, 'candidate.read') || { id: currentUser.id, roles: [] };
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
    if (!cfgResult.success) throw new Error('SLA_CONFIGURATION_UNAVAILABLE');
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
      const scope = this.requisitions.recruiterScope('r', currentUser.id);
      sql += ' AND ' + scope.condition;
      params.push(...scope.params);
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

};
