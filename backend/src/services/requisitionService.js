const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

class RequisitionService {
  constructor(db) {
    this.db = db || getDatabase();
  }

  /**
   * Get all requisitions with recruiter and hiring manager details
   */
  getRequisitions(options = {}) {
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const status = typeof options.status === 'string' ? options.status.trim() : 'ALL';
    const handoverOnly = options.handoverOnly === true || options.handoverOnly === 'true';

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(r.title LIKE ? OR r.code LIKE ? OR r.department_name LIKE ?)');
      const p = `%${search}%`;
      params.push(p, p, p);
    }

    if (status && status !== 'ALL') {
      conditions.push('r.status = ?');
      params.push(status);
    }

    if (handoverOnly) {
      conditions.push('r.handover_required = 1');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = this.db.prepare(`
      SELECT 
        r.id,
        r.code,
        r.title,
        r.department_name,
        r.headcount,
        r.status,
        r.handover_required,
        r.handover_notes,
        r.created_at,
        r.updated_at,
        hm.id AS hiring_manager_id,
        hm.full_name AS hiring_manager_name,
        hm.email AS hiring_manager_email,
        rec.id AS recruiter_id,
        rec.full_name AS recruiter_name,
        rec.email AS recruiter_email
      FROM requisitions r
      LEFT JOIN users hm ON r.hiring_manager_id = hm.id
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      ${whereClause}
      ORDER BY r.handover_required DESC, r.created_at DESC
    `);

    const rows = stmt.all(...params);

    const mapped = rows.map(r => ({
      id: r.id,
      code: r.code,
      title: r.title,
      departmentName: r.department_name,
      headcount: r.headcount,
      status: r.status,
      handoverRequired: Boolean(r.handover_required),
      handoverNotes: r.handover_notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      recruiterName: r.recruiter_name,
      recruiterEmail: r.recruiter_email,
      hiringManager: r.hiring_manager_id ? {
        id: r.hiring_manager_id,
        fullName: r.hiring_manager_name,
        email: r.hiring_manager_email
      } : null,
      recruiter: r.recruiter_id ? {
        id: r.recruiter_id,
        fullName: r.recruiter_name,
        email: r.recruiter_email
      } : null
    }));

    return {
      success: true,
      total: rows.length,
      items: mapped,
      requisitions: mapped
    };
  }

  /**
   * Create new recruitment requisition in SQLite
   */
  createRequisition(data = {}) {
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const departmentName = typeof data.departmentName === 'string' ? data.departmentName.trim() : '';
    const headcount = parseInt(data.headcount, 10) || 1;
    const hiringManagerId = data.hiringManagerId || null;
    const recruiterId = data.recruiterId || null;

    if (!title) {
      return { success: false, statusCode: 400, message: 'Tiêu đề vị trí tuyển dụng là bắt buộc.' };
    }

    if (!departmentName) {
      return { success: false, statusCode: 400, message: 'Phòng ban tuyển dụng là bắt buộc.' };
    }

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM requisitions');
    const nextNum = (countStmt.get().count || 0) + 1;
    const code = `REQ-2026-${String(nextNum).padStart(3, '0')}`;
    const id = 'req-' + crypto.randomUUID();

    const insertStmt = this.db.prepare(`
      INSERT INTO requisitions (
        id, code, title, department_name, headcount, hiring_manager_id, recruiter_id, status, handover_required, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'OPEN', 0, datetime('now'), datetime('now')
      )
    `);

    insertStmt.run(id, code, title, departmentName, headcount, hiringManagerId, recruiterId);

    return {
      success: true,
      statusCode: 201,
      message: 'Khởi tạo vị trí tuyển dụng thành công.',
      data: {
        id,
        code,
        title,
        departmentName,
        headcount,
        status: 'OPEN'
      }
    };
  }

  /**
   * Reassign recruiter or resolve handover requirement (S1-10)
   */
  reassignHandover(requisitionId, newRecruiterId, notes = '') {
    if (!requisitionId) {
      return { success: false, statusCode: 400, message: 'Thiếu ID vị trí cần phân công.' };
    }

    const updateStmt = this.db.prepare(`
      UPDATE requisitions
      SET recruiter_id = ?, handover_required = 0, handover_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = updateStmt.run(newRecruiterId, notes || 'Đã bàn giao cho nhân sự mới', requisitionId);
    if (result.changes === 0) {
      return { success: false, statusCode: 404, message: 'Không tìm thấy vị trí tuyển dụng tương ứng.' };
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Phân công lại vị trí tuyển dụng và hoàn tất bàn giao thành công.'
    };
  }

  /**
   * Get single requisition by ID
   */
  getRequisitionById(id) {
    if (!id) return null;
    const stmt = this.db.prepare(`
      SELECT 
        r.id, r.code, r.title, r.department_name, r.headcount, r.status, r.handover_required, r.handover_notes,
        r.created_at, r.updated_at,
        r.recruiter_id, rec.full_name AS recruiter_name, rec.email AS recruiter_email,
        r.hiring_manager_id, hm.full_name AS hiring_manager_name, hm.email AS hiring_manager_email
      FROM requisitions r
      LEFT JOIN users hm ON r.hiring_manager_id = hm.id
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      WHERE r.id = ?
    `);
    const r = stmt.get(id);
    if (!r) return null;
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      departmentName: r.department_name,
      headcount: r.headcount,
      status: r.status,
      handoverRequired: Boolean(r.handover_required),
      handoverNotes: r.handover_notes,
      recruiterId: r.recruiter_id,
      recruiterName: r.recruiter_name,
      hiringManagerId: r.hiring_manager_id,
      hiringManagerName: r.hiring_manager_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  /**
   * Update requisition details and status
   */
  updateRequisition(id, data = {}) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã vị trí cần cập nhật.' };
    const current = this.getRequisitionById(id);
    if (!current) return { success: false, statusCode: 404, message: 'Không tìm thấy vị trí tuyển dụng.' };

    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : current.title;
    const departmentName = typeof data.departmentName === 'string' && data.departmentName.trim() ? data.departmentName.trim() : current.departmentName;
    const headcount = data.headcount !== undefined ? (parseInt(data.headcount, 10) || current.headcount) : current.headcount;
    const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim().toUpperCase() : current.status;
    const recruiterId = data.recruiterId !== undefined ? (data.recruiterId || null) : current.recruiterId;

    const stmt = this.db.prepare(`
      UPDATE requisitions
      SET title = ?, department_name = ?, headcount = ?, status = ?, recruiter_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(title, departmentName, headcount, status, recruiterId, id);

    return {
      success: true,
      statusCode: 200,
      message: 'Cập nhật vị trí tuyển dụng thành công.',
      data: this.getRequisitionById(id)
    };
  }

  /**
   * Get enterprise real-time dashboard statistics from SQLite
   */
  getDashboardStats() {
    // 1. User stats
    const userStats = this.db.prepare(`
      SELECT 
        COUNT(*) AS total_users,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_users,
        SUM(CASE WHEN status = 'LOCKED' THEN 1 ELSE 0 END) AS locked_users
      FROM users
    `).get();

    // 2. Active sessions count
    const sessionStats = this.db.prepare(`
      SELECT COUNT(*) AS active_sessions
      FROM sessions
      WHERE datetime(expires_at) > datetime('now')
    `).get();

    // 3. Requisition stats
    const reqStats = this.db.prepare(`
      SELECT 
        COUNT(*) AS total_requisitions,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_requisitions,
        SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_requisitions,
        SUM(CASE WHEN handover_required = 1 THEN 1 ELSE 0 END) AS handover_alerts,
        SUM(headcount) AS total_headcount
      FROM requisitions
    `).get();

    // 4. Candidate stats & Funnel
    let candStats = { total: 0, new: 0, screening: 0, interview: 0, offer: 0, hired: 0 };
    try {
      const cRow = this.db.prepare(`
        SELECT 
          COUNT(*) AS total_candidates,
          SUM(CASE WHEN stage = 'NEW' THEN 1 ELSE 0 END) AS stage_new,
          SUM(CASE WHEN stage = 'SCREENING' THEN 1 ELSE 0 END) AS stage_screening,
          SUM(CASE WHEN stage = 'INTERVIEW' THEN 1 ELSE 0 END) AS stage_interview,
          SUM(CASE WHEN stage = 'OFFER' THEN 1 ELSE 0 END) AS stage_offer,
          SUM(CASE WHEN stage = 'HIRED' THEN 1 ELSE 0 END) AS stage_hired
        FROM candidates
      `).get();
      if (cRow) {
        candStats = {
          total: cRow.total_candidates || 0,
          new: cRow.stage_new || 0,
          screening: cRow.stage_screening || 0,
          interview: cRow.stage_interview || 0,
          offer: cRow.stage_offer || 0,
          hired: cRow.stage_hired || 0
        };
      }
    } catch (e) {}

    // 5. Upcoming interviews
    let upcomingInterviewsCount = 0;
    try {
      const iRow = this.db.prepare(`
        SELECT COUNT(*) AS c FROM interviews WHERE status = 'SCHEDULED'
      `).get();
      if (iRow) upcomingInterviewsCount = iRow.c || 0;
    } catch (e) {}

    // 6. Department breakdown
    let departmentBreakdown = [];
    try {
      departmentBreakdown = this.db.prepare(`
        SELECT department_name, COUNT(*) AS req_count, SUM(headcount) AS total_headcount
        FROM requisitions
        GROUP BY department_name
        ORDER BY req_count DESC
      `).all();
    } catch (e) {}

    // 7. Recent recruitment activities (from real SQLite records)
    const recentActivities = [];
    try {
      const recentCands = this.db.prepare(`
        SELECT c.full_name, c.stage, c.created_at, r.title AS req_title
        FROM candidates c
        LEFT JOIN requisitions r ON c.requisition_id = r.id
        ORDER BY c.created_at DESC LIMIT 3
      `).all();
      recentCands.forEach(c => {
        recentActivities.push({
          type: 'CANDIDATE',
          title: `${c.full_name} ứng tuyển vào ${c.req_title || 'vị trí tuyển dụng'}`,
          meta: `Giai đoạn: ${c.stage}`,
          timestamp: c.created_at
        });
      });

      const recentInts = this.db.prepare(`
        SELECT i.round_name, i.scheduled_time, i.status, c.full_name AS cand_name, u.full_name AS interviewer_name
        FROM interviews i
        LEFT JOIN candidates c ON i.candidate_id = c.id
        LEFT JOIN users u ON i.interviewer_id = u.id
        ORDER BY i.created_at DESC LIMIT 2
      `).all();
      recentInts.forEach(it => {
        recentActivities.push({
          type: 'INTERVIEW',
          title: `${it.round_name} cho ứng viên ${it.cand_name}`,
          meta: `Người phỏng vấn: ${it.interviewer_name || 'Hội đồng chuyên môn'} | Thời gian: ${it.scheduled_time}`,
          timestamp: it.scheduled_time
        });
      });
    } catch (e) {}

    // 8. Recent requisitions
    const recentRequisitions = this.db.prepare(`
      SELECT r.id, r.code, r.title, r.department_name, r.headcount, r.status, r.handover_required, rec.full_name AS recruiter_name
      FROM requisitions r
      LEFT JOIN users rec ON r.recruiter_id = rec.id
      ORDER BY r.handover_required DESC, r.created_at DESC
      LIMIT 5
    `).all();

    // 9. Recent audit logs
    const recentAudit = this.db.prepare(`
      SELECT email, status, reason, attempted_at
      FROM login_audit_logs
      ORDER BY attempted_at DESC
      LIMIT 5
    `).all();

    // 10. Role distribution
    const roleDistribution = this.db.prepare(`
      SELECT r.code, r.name, COUNT(ur.user_id) AS user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.id
      ORDER BY user_count DESC
    `).all();

    return {
      success: true,
      stats: {
        users: {
          total: userStats.total_users || 0,
          active: userStats.active_users || 0,
          locked: userStats.locked_users || 0
        },
        sessions: {
          activeCount: sessionStats.active_sessions || 0
        },
        requisitions: {
          total: reqStats.total_requisitions || 0,
          open: reqStats.open_requisitions || 0,
          inProgress: reqStats.in_progress_requisitions || 0,
          handoverAlerts: reqStats.handover_alerts || 0,
          totalHeadcount: reqStats.total_headcount || 0
        },
        candidates: candStats,
        upcomingInterviews: upcomingInterviewsCount,
        departmentBreakdown,
        recentActivities,
        roleDistribution,
        recentRequisitions,
        recentAudit
      }
    };
  }

  /**
   * Get candidates list with search and filters
   */
  getCandidates(options = {}) {
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const stage = typeof options.stage === 'string' ? options.stage.trim() : 'ALL';
    const reqId = typeof options.requisitionId === 'string' ? options.requisitionId.trim() : 'ALL';

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(c.full_name LIKE ? OR c.email LIKE ? OR c.phone_number LIKE ? OR c.current_company LIKE ?)');
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    if (stage && stage !== 'ALL') {
      conditions.push('c.stage = ?');
      params.push(stage);
    }

    if (reqId && reqId !== 'ALL') {
      conditions.push('c.requisition_id = ?');
      params.push(reqId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = this.db.prepare(`
      SELECT 
        c.id,
        c.full_name,
        c.email,
        c.phone_number,
        c.stage,
        c.experience_years,
        c.current_company,
        c.expected_salary,
        c.notes,
        c.created_at,
        r.id AS requisition_id,
        r.code AS requisition_code,
        r.title AS requisition_title,
        r.department_name
      FROM candidates c
      LEFT JOIN requisitions r ON c.requisition_id = r.id
      ${whereClause}
      ORDER BY c.created_at DESC
    `);

    const rows = stmt.all(...params);
    return {
      success: true,
      total: rows.length,
      candidates: rows.map(r => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        phoneNumber: r.phone_number,
        stage: r.stage,
        experienceYears: r.experience_years,
        currentCompany: r.current_company,
        expectedSalary: r.expected_salary,
        notes: r.notes,
        createdAt: r.created_at,
        requisition: r.requisition_id ? {
          id: r.requisition_id,
          code: r.requisition_code,
          title: r.requisition_title,
          departmentName: r.department_name
        } : null
      }))
    };
  }

  /**
   * Get interviews list
   */
  getInterviews(options = {}) {
    const stmt = this.db.prepare(`
      SELECT 
        i.id,
        i.round_name,
        i.scheduled_time,
        i.location_or_link,
        i.status,
        i.feedback,
        i.score,
        i.created_at,
        c.id AS candidate_id,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone_number AS candidate_phone,
        r.id AS requisition_id,
        r.title AS requisition_title,
        r.department_name,
        u.id AS interviewer_id,
        u.full_name AS interviewer_name,
        u.email AS interviewer_email
      FROM interviews i
      LEFT JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN requisitions r ON i.requisition_id = r.id
      LEFT JOIN users u ON i.interviewer_id = u.id
      ORDER BY i.scheduled_time DESC
    `);

    const rows = stmt.all();
    return {
      success: true,
      total: rows.length,
      interviews: rows.map(r => ({
        id: r.id,
        roundName: r.round_name,
        scheduledTime: r.scheduled_time,
        locationOrLink: r.location_or_link,
        status: r.status,
        feedback: r.feedback,
        score: r.score,
        createdAt: r.created_at,
        candidate: {
          id: r.candidate_id,
          fullName: r.candidate_name,
          email: r.candidate_email,
          phone: r.candidate_phone
        },
        requisition: {
          id: r.requisition_id,
          title: r.requisition_title,
          departmentName: r.department_name
        },
        interviewer: r.interviewer_id ? {
          id: r.interviewer_id,
          fullName: r.interviewer_name,
          email: r.interviewer_email
        } : null
      }))
    };
  }

  /**
   * Get offers list
   */
  getOffers(options = {}) {
    const stmt = this.db.prepare(`
      SELECT 
        o.id,
        o.salary_monthly,
        o.start_date,
        o.status,
        o.created_at,
        c.id AS candidate_id,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        r.id AS requisition_id,
        r.title AS requisition_title,
        r.department_name,
        u.id AS approver_id,
        u.full_name AS approver_name
      FROM offers o
      LEFT JOIN candidates c ON o.candidate_id = c.id
      LEFT JOIN requisitions r ON o.requisition_id = r.id
      LEFT JOIN users u ON o.approver_id = u.id
      ORDER BY o.created_at DESC
    `);

    const rows = stmt.all();
    return {
      success: true,
      total: rows.length,
      offers: rows.map(r => ({
        id: r.id,
        salaryMonthly: r.salary_monthly,
        startDate: r.start_date,
        status: r.status,
        createdAt: r.created_at,
        candidate: {
          id: r.candidate_id,
          fullName: r.candidate_name,
          email: r.candidate_email
        },
        requisition: {
          id: r.requisition_id,
          title: r.requisition_title,
          departmentName: r.department_name
        },
        approver: r.approver_id ? {
          id: r.approver_id,
          fullName: r.approver_name
        } : null
      }))
    };
  }

  /**
   * Get recruitment reports
   */
  getReports() {
    const stats = this.getDashboardStats();
    return {
      success: true,
      report: {
        summary: stats.stats,
        pipelineFunnel: [
          { stage: 'Ứng tuyển mới', count: stats.stats.candidates.new || 0, percent: 100 },
          { stage: 'Sàng lọc hồ sơ', count: stats.stats.candidates.screening || 0, percent: 80 },
          { stage: 'Phỏng vấn', count: stats.stats.candidates.interview || 0, percent: 50 },
          { stage: 'Đề xuất Offer', count: stats.stats.candidates.offer || 0, percent: 30 },
          { stage: 'Tuyển dụng thành công', count: stats.stats.candidates.hired || 0, percent: 20 }
        ],
        timeToHireAverageDays: 18,
        costPerHireAverageVnd: '12.500.000 đ'
      }
    };
  }

  /**
   * Create candidate record
   */
  createCandidate(data = {}) {
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    const requisitionId = data.requisitionId || null;
    const stage = data.stage || 'NEW';
    const experienceYears = parseInt(data.experienceYears, 10) || 1;
    const currentCompany = data.currentCompany || '';
    const expectedSalary = data.expectedSalary || '';
    const notes = data.notes || '';

    if (!fullName) {
      return { success: false, statusCode: 400, message: 'Họ và tên ứng viên là bắt buộc.' };
    }
    if (!email) {
      return { success: false, statusCode: 400, message: 'Email ứng viên là bắt buộc.' };
    }

    const id = 'cand-' + crypto.randomUUID();
    const insertStmt = this.db.prepare(`
      INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage, experience_years, current_company, expected_salary, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    insertStmt.run(id, fullName, email, phoneNumber, requisitionId, stage, experienceYears, currentCompany, expectedSalary, notes);

    return {
      success: true,
      statusCode: 201,
      message: 'Thêm hồ sơ ứng viên thành công.',
      data: { id, fullName, email, stage }
    };
  }

  /**
   * Update candidate stage / pipeline status
   */
  updateCandidateStage(id, stage, notes) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã ứng viên.' };
    const validStages = ['NEW', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];
    if (!validStages.includes(stage)) {
      return { success: false, statusCode: 400, message: 'Giai đoạn không hợp lệ.' };
    }
    const updateStmt = this.db.prepare(`
      UPDATE candidates 
      SET stage = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `);
    const res = updateStmt.run(stage, notes || null, id);
    if (res.changes === 0) {
      return { success: false, statusCode: 404, message: 'Không tìm thấy hồ sơ ứng viên.' };
    }
    return { success: true, statusCode: 200, message: 'Cập nhật giai đoạn ứng viên thành công.' };
  }

  /**
   * Schedule new interview
   */
  createInterview(data = {}) {
    const candidateId = data.candidateId;
    const requisitionId = data.requisitionId || null;
    const interviewerId = data.interviewerId || null;
    const roundName = data.roundName || 'Phỏng vấn chuyên môn';
    const scheduledTime = data.scheduledTime;
    const locationOrLink = data.locationOrLink || 'Google Meet Online';

    if (!candidateId) return { success: false, statusCode: 400, message: 'Vui lòng chọn ứng viên.' };
    if (!scheduledTime) return { success: false, statusCode: 400, message: 'Vui lòng chọn thời gian phỏng vấn.' };

    const id = 'int-' + crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', datetime('now'))
    `);
    stmt.run(id, candidateId, requisitionId, interviewerId, roundName, scheduledTime, locationOrLink);

    // Update candidate stage to INTERVIEW
    this.db.prepare("UPDATE candidates SET stage = 'INTERVIEW' WHERE id = ?").run(candidateId);

    return { success: true, statusCode: 201, message: 'Lên lịch phỏng vấn thành công.', data: { id } };
  }

  /**
   * Update interview status / score / feedback
   */
  updateInterviewStatus(id, status, feedback, score) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã phỏng vấn.' };
    const stmt = this.db.prepare(`
      UPDATE interviews
      SET status = ?, feedback = COALESCE(?, feedback), score = COALESCE(?, score)
      WHERE id = ?
    `);
    const res = stmt.run(status, feedback || null, score ? parseInt(score, 10) : null, id);
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy lịch phỏng vấn.' };
    return { success: true, statusCode: 200, message: 'Cập nhật lịch phỏng vấn thành công.' };
  }

  /**
   * Create Job Offer
   */
  createOffer(data = {}) {
    const candidateId = data.candidateId;
    const requisitionId = data.requisitionId || null;
    const salaryMonthly = parseInt(data.salaryMonthly, 10) || 0;
    const startDate = data.startDate || null;
    const approverId = data.approverId || null;

    if (!candidateId) return { success: false, statusCode: 400, message: 'Vui lòng chọn ứng viên.' };
    if (!salaryMonthly) return { success: false, statusCode: 400, message: 'Vui lòng nhập mức lương đề xuất.' };

    const id = 'off-' + crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO offers (id, candidate_id, requisition_id, salary_monthly, start_date, status, approver_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, datetime('now'))
    `);
    stmt.run(id, candidateId, requisitionId, salaryMonthly, startDate, approverId);

    // Update candidate stage to OFFER
    this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(candidateId);

    return { success: true, statusCode: 201, message: 'Khởi tạo đề xuất việc làm (Offer) thành công.', data: { id } };
  }

  /**
   * Approve / Reject Offer
   */
  updateOfferStatus(id, status) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã offer.' };
    const stmt = this.db.prepare(`UPDATE offers SET status = ? WHERE id = ?`);
    const res = stmt.run(status, id);
    if (res.changes === 0) return { success: false, statusCode: 404, message: 'Không tìm thấy offer.' };

    if (status === 'APPROVED') {
      const off = this.db.prepare('SELECT candidate_id FROM offers WHERE id = ?').get(id);
      if (off && off.candidate_id) {
        this.db.prepare("UPDATE candidates SET stage = 'HIRED' WHERE id = ?").run(off.candidate_id);
      }
    }
    return { success: true, statusCode: 200, message: 'Cập nhật trạng thái offer thành công.' };
  }
}

module.exports = RequisitionService;
