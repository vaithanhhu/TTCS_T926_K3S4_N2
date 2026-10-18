const crypto = require('node:crypto');

class OfferService {
  constructor(db, requisitionService, rbacMiddleware) {
    this.db = db;
    this.requisitionService = requisitionService || new (require('./requisitionService'))(db);
    this.rbacMiddleware = rbacMiddleware || new (require('../middlewares/rbacMiddleware'))(db);
  }

  async hasProposalCols() {
    if (this._hasProposalCols !== undefined) return this._hasProposalCols;
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='offers' AND column_name='job_title_id'").get();
        this._hasProposalCols = Boolean(row);
      } else {
        const cols = (await this.db.prepare("PRAGMA table_info(offers)").all()).map(c => c.name);
        this._hasProposalCols = cols.includes('job_title_id');
      }
    } catch {
      this._hasProposalCols = false;
    }
    return this._hasProposalCols;
  }

  async hasUpdatedAtCol() {
    if (this._hasUpdatedAtCol !== undefined) return this._hasUpdatedAtCol;
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='offers' AND column_name='updated_at'").get();
        this._hasUpdatedAtCol = Boolean(row);
      } else {
        const cols = (await this.db.prepare("PRAGMA table_info(offers)").all()).map(c => c.name);
        this._hasUpdatedAtCol = cols.includes('updated_at');
      }
    } catch {
      this._hasUpdatedAtCol = false;
    }
    return this._hasUpdatedAtCol;
  }

  async hasApprovalCols() {
    if (this._hasApprovalCols !== undefined) return this._hasApprovalCols;
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='offers' AND column_name='current_approval_level'").get();
        this._hasApprovalCols = Boolean(row);
      } else {
        const cols = (await this.db.prepare("PRAGMA table_info(offers)").all()).map(c => c.name);
        this._hasApprovalCols = cols.includes('current_approval_level');
      }
    } catch {
      this._hasApprovalCols = false;
    }
    return this._hasApprovalCols;
  }

  async hasApprovalsTable() {
    if (this._hasApprovalsTable !== undefined) return this._hasApprovalsTable;
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='offer_approvals'").get();
        this._hasApprovalsTable = Boolean(row);
      } else {
        const row = await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='offer_approvals'").get();
        this._hasApprovalsTable = Boolean(row);
      }
    } catch {
      this._hasApprovalsTable = false;
    }
    return this._hasApprovalsTable;
  }

  async hasDeliveryCols() {
    if (this._hasDeliveryCols !== undefined) return this._hasDeliveryCols;
    try {
      if (this.db.provider === 'postgres') {
        const row = await this.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='offers' AND column_name='response_token'").get();
        this._hasDeliveryCols = Boolean(row);
      } else {
        const cols = (await this.db.prepare("PRAGMA table_info(offers)").all()).map(c => c.name);
        this._hasDeliveryCols = cols.includes('response_token');
      }
    } catch {
      this._hasDeliveryCols = false;
    }
    return this._hasDeliveryCols;
  }

  formatCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return 'Thỏa thuận';
    return Number(amount).toLocaleString('vi-VN');
  }

  formatDate(dateStr) {
    if (!dateStr) return 'Thỏa thuận';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('vi-VN');
    } catch {
      return dateStr;
    }
  }

  generateOfferLetter(details) {
    const candName = details.candidateName || 'Ứng viên';
    const candEmail = details.candidateEmail || '';
    const candPhone = details.candidatePhone || '';
    const jobTitle = details.jobTitleName || details.requisitionTitle || 'Vị trí chuyên môn';
    const deptName = details.departmentName || 'Công ty';
    const salary = this.formatCurrency(details.salaryMonthly);
    const allowances = details.allowances ? this.formatCurrency(details.allowances) + ' VNĐ / tháng' : 'Không có';
    const startDate = this.formatDate(details.startDate);
    const expirationDate = this.formatDate(details.expirationDate);

    const text = [
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      'Độc lập - Tự do - Hạnh phúc',
      '----------------------------------------',
      'THƯ MỜI NHẬN VIỆC (JOB OFFER LETTER)',
      '',
      `Kính gửi: Ông/Bà ${candName}`,
      `Email: ${candEmail}`,
      `Số điện thoại: ${candPhone}`,
      '',
      `Chúng tôi vui mừng thông báo Ông/Bà đã trúng tuyển vào vị trí tại ${deptName}.`,
      'Dưới đây là các điều khoản và chế độ đãi ngộ đề xuất:',
      '',
      `1. Chức danh công việc: ${jobTitle}`,
      `2. Bộ phận / Phòng ban: ${deptName}`,
      `3. Mức lương cơ bản hàng tháng: ${salary} VNĐ / tháng`,
      `4. Các khoản phụ cấp: ${allowances}`,
      `5. Ngày dự kiến bắt đầu làm việc: ${startDate}`,
      `6. Thời hạn phản hồi đề nghị: ${expirationDate}`,
      '',
      'Vui lòng xác nhận sự đồng ý của Ông/Bà bằng cách phản hồi trước thời hạn quy định trên.',
      'Chúng tôi rất hy vọng được chào đón Ông/Bà gia nhập đội ngũ phát triển của công ty.',
      '',
      'Trân trọng,',
      'Phòng Nhân sự'
    ].join('\n');

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a202c; max-width: 680px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
        <div style="text-align: center; border-bottom: 2px solid #3182ce; padding-bottom: 16px; margin-bottom: 20px;">
          <h3 style="margin: 0; text-transform: uppercase; letter-spacing: 1px; color: #2d3748;">Cộng Hòa Xã Hội Chủ Nghĩa Việt Nam</h3>
          <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #718096;">Độc lập - Tự do - Hạnh phúc</p>
          <h2 style="margin: 16px 0 0 0; color: #2b6cb0; font-size: 1.4rem;">THƯ MỜI NHẬN VIỆC</h2>
        </div>
        <p>Kính gửi: <strong>${candName}</strong></p>
        <p>Email: ${candEmail} | SĐT: ${candPhone}</p>
        <p>Chúng tôi trân trọng gửi tới Ông/Bà lời mời làm việc tại <strong>${deptName}</strong> với các thông tin chi tiết sau:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tbody>
            <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568; width: 40%;">Vị trí / Chức danh:</td><td style="padding: 8px 0; font-weight: 600;">${jobTitle}</td></tr>
            <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Bộ phận / Phòng ban:</td><td style="padding: 8px 0; font-weight: 600;">${deptName}</td></tr>
            <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Mức lương hàng tháng:</td><td style="padding: 8px 0; font-weight: 600; color: #2b6cb0;">${salary} VNĐ</td></tr>
            <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Phụ cấp:</td><td style="padding: 8px 0;">${allowances}</td></tr>
            <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Ngày dự kiến nhận việc:</td><td style="padding: 8px 0; font-weight: 600;">${startDate}</td></tr>
            <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Thời hạn phản hồi:</td><td style="padding: 8px 0; font-weight: 600; color: #c53030;">${expirationDate}</td></tr>
          </tbody>
        </table>
        <p style="margin-top: 20px;">Vui lòng phản hồi thư mời trước thời hạn nêu trên. Rất mong được đồng hành cùng Ông/Bà.</p>
        <div style="margin-top: 32px; text-align: right;">
          <p style="margin: 0; font-weight: 600;">Đại diện Tuyển dụng</p>
          <p style="margin: 4px 0 0 0; color: #718096; font-size: 0.9rem;">Phòng Nhân sự</p>
        </div>
      </div>
    `.trim();

    return { text, html };
  }

  async validateSalaryBand(jobTitleId, salaryMonthly) {
    if (!jobTitleId) {
      return { isOutOfBand: false, minSalary: null, maxSalary: null, jobTitleName: null };
    }
    const row = await this.db.prepare('SELECT id, name, min_salary, max_salary FROM job_titles WHERE id = ?').get(jobTitleId);
    if (!row) {
      return { isOutOfBand: false, minSalary: null, maxSalary: null, jobTitleName: null };
    }
    const minSalary = row.min_salary !== null && row.min_salary !== undefined ? Number(row.min_salary) : null;
    const maxSalary = row.max_salary !== null && row.max_salary !== undefined ? Number(row.max_salary) : null;
    const salary = Number(salaryMonthly) || 0;

    let isOutOfBand = false;
    if (minSalary !== null && salary < minSalary) {
      isOutOfBand = true;
    }
    if (maxSalary !== null && salary > maxSalary) {
      isOutOfBand = true;
    }

    return {
      isOutOfBand,
      minSalary,
      maxSalary,
      jobTitleName: row.name
    };
  }

  async getOffers(options = {}) {
    await this.expireOverdueOffers();
    let viewer = options.viewer;
    if (viewer) {
      const fresh = await this.rbacMiddleware.getAuthorizedActor(viewer.id, 'offer.read');
      if (!fresh) {
        return { success: false, statusCode: 403, code: 'OFFER_FORBIDDEN', message: 'Bạn không có quyền xem Offer.', offers: [] };
      }
      viewer = { ...viewer, ...fresh };
      options = { ...options, viewer };
    }

    const conditions = [];
    const params = [];

    if (options.candidateEmail) {
      conditions.push('LOWER(c.email) = LOWER(?)');
      params.push(options.candidateEmail);
    }
    if (options.candidateId) {
      conditions.push('o.candidate_id = ?');
      params.push(options.candidateId);
    }
    if (options.status && options.status !== 'ALL') {
      conditions.push('o.status = ?');
      params.push(options.status);
    }
    if (options.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      conditions.push('(c.full_name LIKE ? OR r.title LIKE ? OR jt.name LIKE ?)');
      params.push(term, term, term);
    }

    if (viewer && !viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
      const scopes = [];
      if (viewer.roles.includes('HIRING_MGR')) {
        scopes.push(this.requisitionService.hiringRequisitionScope());
        params.push(viewer.id, viewer.id, viewer.id);
      }
      if (viewer.roles.includes('RECRUITER')) {
        const scope = this.requisitionService.recruiterScope('r', viewer.id);
        const candidateScope = this.requisitionService.recruiterScope('candidate_position', viewer.id);
        scopes.push('(' + scope.condition + ' AND EXISTS(SELECT 1 FROM requisitions candidate_position WHERE candidate_position.id = c.requisition_id AND ' + candidateScope.condition + '))');
        params.push(...scope.params, ...candidateScope.params);
      }
      if (viewer.roles.includes('APPROVER')) {
        scopes.push('o.approver_id = ?');
        params.push(viewer.id);
      }
      if (viewer.roles.includes('CANDIDATE')) {
        scopes.push('LOWER(c.email) = LOWER(?)');
        params.push(viewer.email);
      }
      conditions.push(scopes.length ? '(' + scopes.join(' OR ')+ ')' : '1=0');
    }

    const recruiterScopeParams = viewer?.roles.includes('RECRUITER')
      ? this.requisitionService.recruiterScope('r', viewer.id).params
      : [];

    const hasCols = await this.hasProposalCols();
    const hasApprovalCols = await this.hasApprovalCols();
    const hasDeliveryCols = await this.hasDeliveryCols();

    const stmt = this.db.prepare(`
      SELECT
        o.id,
        o.candidate_id,
        o.requisition_id,
        ${hasCols ? 'o.job_title_id, o.allowances, o.expiration_date, o.salary_justification, o.offer_letter, o.notes, o.created_by, o.updated_at,' : 'NULL AS job_title_id, 0 AS allowances, NULL AS expiration_date, NULL AS salary_justification, NULL AS offer_letter, NULL AS notes, NULL AS created_by, o.created_at AS updated_at,'}
        ${hasApprovalCols ? 'o.current_approval_level, o.required_approval_levels,' : '1 AS current_approval_level, 1 AS required_approval_levels,'}
        ${hasDeliveryCols ? 'o.sent_at, o.sent_by, o.response_token, o.token_expires_at, o.responded_at, o.candidate_response, o.candidate_comment, o.rejection_reason_category, o.predecessor_offer_id, o.superseded_by_offer_id,' : 'NULL AS sent_at, NULL AS sent_by, NULL AS response_token, NULL AS token_expires_at, NULL AS responded_at, NULL AS candidate_response, NULL AS candidate_comment, NULL AS rejection_reason_category, NULL AS predecessor_offer_id, NULL AS superseded_by_offer_id,'}
        o.salary_monthly,
        o.start_date,
        o.status,
        o.approver_id,
        o.created_at,
        r.recruiter_id AS responsible_recruiter_id,
        CASE WHEN ${viewer?.roles.includes('RECRUITER') ? this.requisitionService.recruiterScope('r', viewer.id).condition : '1=0'} THEN 1 ELSE 0 END AS in_recruiter_scope,
        c.id AS candidate_id_alias,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        c.phone_number AS candidate_phone,
        c.stage AS candidate_stage,
        r.id AS requisition_id_alias,
        r.title AS requisition_title,
        r.code AS requisition_code,
        r.department_id,
        r.department_name,
        jt.name AS job_title_name,
        jt.min_salary AS job_min_salary,
        jt.max_salary AS job_max_salary,
        u.id AS approver_id_alias,
        u.full_name AS approver_name,
        ${hasCols ? 'cb.full_name AS creator_name' : 'NULL AS creator_name'}
      FROM offers o
      LEFT JOIN candidates c ON o.candidate_id = c.id
      LEFT JOIN requisitions r ON COALESCE(o.requisition_id, c.requisition_id) = r.id
      LEFT JOIN job_titles jt ON COALESCE(${hasCols ? 'o.job_title_id' : 'NULL'}, r.job_title_id) = jt.id
      LEFT JOIN users u ON o.approver_id = u.id
      ${hasCols ? 'LEFT JOIN users cb ON o.created_by = cb.id' : ''}
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY o.created_at DESC
    `);

    const rows = await stmt.all(...recruiterScopeParams, ...params);

    const offers = rows.map(r => {
      const minSal = r.job_min_salary !== null && r.job_min_salary !== undefined ? Number(r.job_min_salary) : null;
      const maxSal = r.job_max_salary !== null && r.job_max_salary !== undefined ? Number(r.job_max_salary) : null;
      const sal = Number(r.salary_monthly) || 0;
      const isOutOfBand = (minSal !== null && sal < minSal) || (maxSal !== null && sal > maxSal);
      const curLevel = r.current_approval_level ? Number(r.current_approval_level) : 1;
      const reqLevels = r.required_approval_levels ? Number(r.required_approval_levels) : (isOutOfBand ? 2 : 1);

      return {
        id: r.id,
        code: r.id ? r.id.toUpperCase() : 'OFF',
        candidateId: r.candidate_id,
        candidate_id: r.candidate_id,
        candidateName: r.candidate_name,
        candidate_name: r.candidate_name,
        candidateEmail: r.candidate_email,
        candidate_email: r.candidate_email,
        candidatePhone: r.candidate_phone,
        candidateStage: r.candidate_stage,
        candidate: {
          id: r.candidate_id,
          fullName: r.candidate_name,
          full_name: r.candidate_name,
          email: r.candidate_email
        },
        requisitionId: r.requisition_id,
        requisition_id: r.requisition_id,
        requisitionTitle: r.requisition_title,
        requisition_title: r.requisition_title,
        requisitionCode: r.requisition_code,
        departmentId: r.department_id,
        departmentName: r.department_name,
        department_name: r.department_name,
        requisition: {
          id: r.requisition_id,
          title: r.requisition_title
        },
        jobTitleId: r.job_title_id,
        job_title_id: r.job_title_id,
        jobTitleName: r.job_title_name,
        job_title_name: r.job_title_name,
        minSalary: minSal,
        maxSalary: maxSal,
        isOutOfBand,
        currentApprovalLevel: curLevel,
        current_approval_level: curLevel,
        requiredApprovalLevels: reqLevels,
        required_approval_levels: reqLevels,
        salaryMonthly: r.salary_monthly,
        salary_monthly: r.salary_monthly,
        salary: r.salary_monthly,
        allowances: r.allowances || 0,
        startDate: r.start_date,
        start_date: r.start_date,
        expirationDate: r.expiration_date,
        expiration_date: r.expiration_date,
        salaryJustification: r.salary_justification,
        salary_justification: r.salary_justification,
        offerLetter: r.offer_letter,
        notes: r.notes,
        status: r.status,
        approverId: r.approver_id,
        approver_id: r.approver_id,
        approverName: r.approver_name,
        approver_name: r.approver_name,
        approver: {
          id: r.approver_id,
          fullName: r.approver_name
        },
        createdBy: r.created_by,
        creatorName: r.creator_name,
        createdAt: r.created_at,
        created_at: r.created_at,
        updatedAt: r.updated_at,
        updated_at: r.updated_at,
        sentAt: r.sent_at,
        sent_at: r.sent_at,
        sentBy: r.sent_by,
        sent_by: r.sent_by,
        responseToken: r.response_token,
        response_token: r.response_token,
        tokenExpiresAt: r.token_expires_at,
        token_expires_at: r.token_expires_at,
        respondedAt: r.responded_at,
        responded_at: r.responded_at,
        candidateResponse: r.candidate_response,
        candidate_response: r.candidate_response,
        candidateComment: r.candidate_comment,
        candidate_comment: r.candidate_comment,
        rejectionReasonCategory: r.rejection_reason_category,
        rejection_reason_category: r.rejection_reason_category,
        predecessorOfferId: r.predecessor_offer_id,
        predecessor_offer_id: r.predecessor_offer_id,
        supersededByOfferId: r.superseded_by_offer_id,
        superseded_by_offer_id: r.superseded_by_offer_id,
        capabilities: viewer ? {
          canApprove: (r.status === 'PENDING_APPROVAL' || (!hasCols && !hasApprovalCols)) && (
            (curLevel === 2)
              ? viewer.roles.includes('ADMIN')
              : (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('APPROVER') && r.approver_id === viewer.id))
          ),
          canSend: r.status === 'APPROVED' && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1)),
          canAccept: r.status === 'SENT' && viewer.roles.every(role => role === 'CANDIDATE') && r.candidate_email.toLowerCase() === viewer.email.toLowerCase(),
          canEdit: ['DRAFT', 'PENDING_APPROVAL', 'REVISION_REQUESTED'].includes(r.status) && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1)),
          canCancel: ['DRAFT', 'PENDING_APPROVAL', 'REVISION_REQUESTED'].includes(r.status) && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1)),
          canRevise: ['REJECTED', 'EXPIRED', 'SENT', 'APPROVED'].includes(r.status) && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1)),
          canRecordRejection: ['SENT', 'APPROVED', 'REJECTED'].includes(r.status) && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1)),
          canRecommendTalentPool: (['REJECTED'].includes(r.status) || r.candidate_response === 'REJECTED') && viewer.roles.some(role => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role))
        } : {}
      };
    });

    return {
      success: true,
      total: offers.length,
      offers,
      data: offers
    };
  }

  async getOfferById(id, actor = null) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    const res = await this.getOffers({ viewer: actor });
    if (!res.success) return res;
    const found = res.offers.find(o => o.id === id);
    if (!found) {
      return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer hoặc không có quyền truy cập.' };
    }
    const approvalsRes = await this.getOfferApprovals(id, actor);

    let predecessorOffer = null;
    if (found.predecessorOfferId) {
      const pRow = await this.db.prepare('SELECT id, salary_monthly, status, rejection_reason_category, created_at FROM offers WHERE id = ?').get(found.predecessorOfferId);
      if (pRow) {
        predecessorOffer = {
          id: pRow.id,
          salaryMonthly: Number(pRow.salary_monthly),
          status: pRow.status,
          rejectionReasonCategory: pRow.rejection_reason_category,
          createdAt: pRow.created_at
        };
      }
    }

    let supersededByOffer = null;
    if (found.supersededByOfferId) {
      const sRow = await this.db.prepare('SELECT id, salary_monthly, status, created_at FROM offers WHERE id = ?').get(found.supersededByOfferId);
      if (sRow) {
        supersededByOffer = {
          id: sRow.id,
          salaryMonthly: Number(sRow.salary_monthly),
          status: sRow.status,
          createdAt: sRow.created_at
        };
      }
    }

    const talentPoolRecommendation = (['REJECTED'].includes(found.status) || found.candidateResponse === 'REJECTED') ? {
      recommended: true,
      candidateId: found.candidateId,
      candidateName: found.candidateName,
      interestedTitle: found.jobTitleName || found.requisitionTitle,
      defaultReason: `Ứng viên từ chối offer (${found.rejectionReasonCategory || 'Khác'}${found.candidateComment ? ': ' + found.candidateComment : ''}) - Lưu hồ sơ tiềm năng.`
    } : null;

    return {
      success: true,
      statusCode: 200,
      data: {
        ...found,
        approvals: approvalsRes.data || [],
        predecessorOffer,
        supersededByOffer,
        talentPoolRecommendation
      }
    };
  }

  async previewOffer(data = {}, actor = null) {
    if (actor) {
      const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.read');
      if (!fresh) {
        return { success: false, statusCode: 403, code: 'OFFER_FORBIDDEN', message: 'Bạn không có quyền xem thư mời.' };
      }
    }

    if (data.offerId) {
      const existing = await this.getOfferById(data.offerId, actor);
      if (!existing.success) return existing;
      const off = existing.data;
      const letter = this.generateOfferLetter({
        candidateName: off.candidateName,
        candidateEmail: off.candidateEmail,
        candidatePhone: off.candidatePhone,
        jobTitleName: off.jobTitleName,
        requisitionTitle: off.requisitionTitle,
        departmentName: off.departmentName,
        salaryMonthly: off.salaryMonthly,
        allowances: off.allowances,
        startDate: off.startDate,
        expirationDate: off.expirationDate
      });
      return {
        success: true,
        statusCode: 200,
        data: {
          offerId: off.id,
          ...letter,
          details: off
        }
      };
    }

    let cand = null;
    if (data.candidateId) {
      cand = await this.db.prepare('SELECT id, full_name, email, phone_number, requisition_id FROM candidates WHERE id = ?').get(data.candidateId);
    }
    let req = null;
    const reqId = data.requisitionId || cand?.requisition_id;
    if (reqId) {
      req = await this.db.prepare('SELECT id, title, department_name, job_title_id FROM requisitions WHERE id = ?').get(reqId);
    }
    let jt = null;
    const jtId = data.jobTitleId || req?.job_title_id;
    if (jtId) {
      jt = await this.db.prepare('SELECT id, name, min_salary, max_salary FROM job_titles WHERE id = ?').get(jtId);
    }

    const letter = this.generateOfferLetter({
      candidateName: cand?.full_name || data.candidateName || 'Ứng viên',
      candidateEmail: cand?.email || data.candidateEmail || '',
      candidatePhone: cand?.phone_number || data.candidatePhone || '',
      jobTitleName: jt?.name || req?.title || data.jobTitleName || 'Vị trí chuyên môn',
      requisitionTitle: req?.title || data.requisitionTitle || '',
      departmentName: req?.department_name || data.departmentName || 'Công ty',
      salaryMonthly: data.salaryMonthly,
      allowances: data.allowances,
      startDate: data.startDate,
      expirationDate: data.expirationDate
    });

    return {
      success: true,
      statusCode: 200,
      data: {
        ...letter,
        details: {
          candidateName: cand?.full_name,
          jobTitleName: jt?.name,
          salaryMonthly: data.salaryMonthly,
          allowances: data.allowances,
          startDate: data.startDate,
          expirationDate: data.expirationDate
        }
      }
    };
  }

  async createOffer(data = {}, actor = null) {
    if (actor) {
      const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.create');
      if (!fresh) {
        return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền soạn thảo Offer.' };
      }
      actor = { ...actor, ...fresh };
    }

    const candidateId = data.candidateId;
    if (!candidateId) {
      return { success: false, statusCode: 400, code: 'INVALID_CANDIDATE', message: 'Vui lòng chọn ứng viên.' };
    }

    const candidate = await this.db.prepare('SELECT id, full_name, email, phone_number, requisition_id, stage FROM candidates WHERE id = ?').get(candidateId);
    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy ứng viên.' };
    }

    if (candidate.stage === 'REJECTED') {
      return { success: false, statusCode: 400, code: 'CANDIDATE_NOT_ELIGIBLE', message: 'Ứng viên đã bị loại, không thể lập Offer.' };
    }
    if (candidate.stage === 'HIRED') {
      return { success: false, statusCode: 400, code: 'CANDIDATE_NOT_ELIGIBLE', message: 'Ứng viên đã được tuyển dụng chính thức, không thể lập thêm Offer.' };
    }

    if (candidate.requisition_id && data.requisitionId && candidate.requisition_id !== data.requisitionId) {
      return { success: false, statusCode: 400, code: 'OFFER_REQUISITION_MISMATCH', message: 'Vị trí của Offer không khớp hồ sơ ứng viên.' };
    }

    const requisitionId = data.requisitionId || candidate.requisition_id || null;

    if (actor && !actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
      const access = await this.requisitionService.candidateAccess(candidateId, actor);
      if (!access.success) return access;
      if (!await this.requisitionService.recruiterAssigned(requisitionId, actor.id)) {
        return { success: false, statusCode: 403, code: 'OFFER_OUT_OF_SCOPE', message: 'Offer không thuộc vị trí được giao cho bạn.' };
      }
    }

    if (requisitionId && this.requisitionService.openPolicy) {
      await this.requisitionService.openPolicy.notDraft(requisitionId);
    }

    const activeOffer = await this.db.prepare(`
      SELECT id, status FROM offers
      WHERE candidate_id = ? AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT')
    `).get(candidateId);

    if (activeOffer) {
      return {
        success: false,
        statusCode: 409,
        code: 'ACTIVE_OFFER_ALREADY_EXISTS',
        message: 'Ứng viên hiện đã có một đề xuất Offer đang hiệu lực.'
      };
    }

    const salaryMonthly = parseInt(data.salaryMonthly, 10);
    if (!salaryMonthly || isNaN(salaryMonthly) || salaryMonthly <= 0) {
      return { success: false, statusCode: 400, code: 'INVALID_SALARY', message: 'Vui lòng nhập mức lương đề xuất hợp lệ.' };
    }

    let jobTitleId = data.jobTitleId || null;
    if (!jobTitleId && requisitionId) {
      const req = await this.db.prepare('SELECT job_title_id FROM requisitions WHERE id = ?').get(requisitionId);
      jobTitleId = req?.job_title_id || null;
    }

    let isOutOfBand = false;
    let minSalary = null;
    let maxSalary = null;
    if (jobTitleId) {
      const band = await this.validateSalaryBand(jobTitleId, salaryMonthly);
      isOutOfBand = band.isOutOfBand;
      minSalary = band.minSalary;
      maxSalary = band.maxSalary;
      if (isOutOfBand && (!data.salaryJustification || !data.salaryJustification.trim())) {
        return {
          success: false,
          statusCode: 400,
          code: 'SALARY_JUSTIFICATION_REQUIRED',
          message: 'Mức lương ngoài dải chuẩn của chức danh bắt buộc nhập giải trình.',
          details: { minSalary, maxSalary, salaryMonthly }
        };
      }
    }

    const isDraft = data.status === 'DRAFT' || data.isDraft === true || data.saveAsDraft === true;
    const initialStatus = isDraft ? 'DRAFT' : 'PENDING_APPROVAL';

    const allowances = data.allowances !== undefined && data.allowances !== null ? Number(data.allowances) : (data.allowance ? Number(data.allowance) : 0);
    const startDate = data.startDate || null;
    const expirationDate = data.expirationDate || null;
    const salaryJustification = data.salaryJustification ? data.salaryJustification.trim() : null;
    const notes = data.notes ? data.notes.trim() : null;
    const approverId = data.approverId || null;
    const offerId = 'off-' + crypto.randomUUID();

    const letterPreview = this.generateOfferLetter({
      candidateName: candidate.full_name,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone_number,
      jobTitleName: data.jobTitleName,
      requisitionTitle: data.requisitionTitle,
      salaryMonthly,
      allowances,
      startDate,
      expirationDate
    });

    const offerLetter = data.offerLetter || letterPreview.text;
    const hasCols = await this.hasProposalCols();
    const hasApprovalCols = await this.hasApprovalCols();
    const requiredApprovalLevels = isOutOfBand ? 2 : 1;
    const currentApprovalLevel = 1;

    try {
      return await this.db.transaction(async () => {
        if (hasCols) {
          if (hasApprovalCols) {
            const stmt = this.db.prepare(`
              INSERT INTO offers (
                id, candidate_id, requisition_id, job_title_id, salary_monthly, allowances,
                start_date, expiration_date, salary_justification, offer_letter, notes,
                status, approver_id, created_by, current_approval_level, required_approval_levels, created_at, updated_at
              ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
              )
            `);
            await stmt.run(
              offerId, candidateId, requisitionId, jobTitleId, salaryMonthly, allowances,
              startDate, expirationDate, salaryJustification, offerLetter, notes,
              initialStatus, approverId, actor?.id || null, currentApprovalLevel, requiredApprovalLevels
            );
          } else {
            const stmt = this.db.prepare(`
              INSERT INTO offers (
                id, candidate_id, requisition_id, job_title_id, salary_monthly, allowances,
                start_date, expiration_date, salary_justification, offer_letter, notes,
                status, approver_id, created_by, created_at, updated_at
              ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
              )
            `);
            await stmt.run(
              offerId, candidateId, requisitionId, jobTitleId, salaryMonthly, allowances,
              startDate, expirationDate, salaryJustification, offerLetter, notes,
              initialStatus, approverId, actor?.id || null
            );
          }
        } else {
          const stmt = this.db.prepare(`
            INSERT INTO offers (
              id, candidate_id, requisition_id, salary_monthly,
              start_date, status, approver_id, created_at
            ) VALUES (
              ?, ?, ?, ?,
              ?, ?, ?, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
            )
          `);
          await stmt.run(
            offerId, candidateId, requisitionId, salaryMonthly,
            startDate, initialStatus, approverId
          );
        }

        if (initialStatus === 'PENDING_APPROVAL') {
          await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(candidateId);
        }

        return {
          success: true,
          statusCode: 201,
          message: initialStatus === 'DRAFT' ? 'Đã lưu nháp đề xuất Offer thành công.' : 'Khởi tạo đề xuất việc làm (Offer) thành công.',
          data: {
            id: offerId,
            candidateId,
            requisitionId,
            jobTitleId,
            salaryMonthly,
            allowances,
            startDate,
            expirationDate,
            salaryJustification,
            isOutOfBand,
            currentApprovalLevel,
            requiredApprovalLevels,
            status: initialStatus
          }
        };
      });
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('unique constraint') || err.message.includes('idx_offers_active_candidate') || err.code === '23505')) {
        return {
          success: false,
          statusCode: 409,
          code: 'ACTIVE_OFFER_ALREADY_EXISTS',
          message: 'Ứng viên hiện đã có một đề xuất Offer đang hiệu lực.'
        };
      }
      throw err;
    }
  }

  async updateOffer(id, data = {}, actor = null) {
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    if (actor) {
      const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.create');
      if (!fresh) {
        return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền chỉnh sửa Offer.' };
      }
      actor = { ...actor, ...fresh };
    }

    return this.db.transaction(async () => {
      const existing = await this.db.prepare('SELECT o.*, c.email AS candidate_email, c.requisition_id AS cand_req_id, r.recruiter_id FROM offers o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requisitions r ON r.id=COALESCE(o.requisition_id, c.requisition_id) WHERE o.id = ?').get(id);
      if (!existing) {
        return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
      }

      if (['APPROVED', 'SENT', 'ACCEPTED'].includes(existing.status)) {
        return {
          success: false,
          statusCode: 400,
          code: 'OFFER_CANNOT_BE_MODIFIED',
          message: 'Không thể sửa Offer đã được phê duyệt hoặc đã gửi cho ứng viên.'
        };
      }

      const reqId = existing.requisition_id || existing.cand_req_id;
      if (actor && !actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
        const access = await this.requisitionService.candidateAccess(existing.candidate_id, actor);
        if (!access.success) return access;
        if (!await this.requisitionService.recruiterAssigned(reqId, actor.id)) {
          return { success: false, statusCode: 403, code: 'OFFER_OUT_OF_SCOPE', message: 'Offer không thuộc vị trí được giao cho bạn.' };
        }
      }

      const salaryMonthly = data.salaryMonthly !== undefined ? parseInt(data.salaryMonthly, 10) : existing.salary_monthly;
      if (!salaryMonthly || isNaN(salaryMonthly) || salaryMonthly <= 0) {
        return { success: false, statusCode: 400, code: 'INVALID_SALARY', message: 'Mức lương không hợp lệ.' };
      }

      const jobTitleId = data.jobTitleId !== undefined ? data.jobTitleId : existing.job_title_id;
      let salaryJustification = data.salaryJustification !== undefined ? (data.salaryJustification ? data.salaryJustification.trim() : null) : existing.salary_justification;

      if (jobTitleId) {
        const band = await this.validateSalaryBand(jobTitleId, salaryMonthly);
        if (band.isOutOfBand && (!salaryJustification || !salaryJustification.trim())) {
          return {
            success: false,
            statusCode: 400,
            code: 'SALARY_JUSTIFICATION_REQUIRED',
            message: 'Mức lương ngoài dải chuẩn của chức danh bắt buộc nhập giải trình.',
            details: { minSalary: band.minSalary, maxSalary: band.maxSalary, salaryMonthly }
          };
        }
      }

      let newStatus = existing.status;
      if (data.status === 'DRAFT') {
        newStatus = 'DRAFT';
      } else if (data.status === 'PENDING_APPROVAL' || data.submitForApproval === true) {
        newStatus = 'PENDING_APPROVAL';
      }

      const allowances = data.allowances !== undefined ? Number(data.allowances) : existing.allowances;
      const startDate = data.startDate !== undefined ? data.startDate : existing.start_date;
      const expirationDate = data.expirationDate !== undefined ? data.expirationDate : existing.expiration_date;
      const notes = data.notes !== undefined ? (data.notes ? data.notes.trim() : null) : existing.notes;
      const approverId = data.approverId !== undefined ? data.approverId : existing.approver_id;
      const offerLetter = data.offerLetter !== undefined ? data.offerLetter : existing.offer_letter;

      const hasCols = await this.hasProposalCols();
      const hasApprovalCols = await this.hasApprovalCols();
      const hasUpdatedAt = await this.hasUpdatedAtCol();

      let isOutOfBand = false;
      if (jobTitleId) {
        const band = await this.validateSalaryBand(jobTitleId, salaryMonthly);
        isOutOfBand = band.isOutOfBand;
      }
      const reqLevels = isOutOfBand ? 2 : 1;
      const curLevel = 1;

      if (hasCols) {
        if (hasApprovalCols && newStatus === 'PENDING_APPROVAL') {
          await this.db.prepare(`
            UPDATE offers SET
              job_title_id = ?,
              salary_monthly = ?,
              allowances = ?,
              start_date = ?,
              expiration_date = ?,
              salary_justification = ?,
              offer_letter = ?,
              notes = ?,
              status = ?,
              approver_id = ?,
              current_approval_level = ?,
              required_approval_levels = ?,
              updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
            WHERE id = ?
          `).run(
            jobTitleId, salaryMonthly, allowances, startDate, expirationDate,
            salaryJustification, offerLetter, notes, newStatus, approverId, curLevel, reqLevels, id
          );
        } else {
          await this.db.prepare(`
            UPDATE offers SET
              job_title_id = ?,
              salary_monthly = ?,
              allowances = ?,
              start_date = ?,
              expiration_date = ?,
              salary_justification = ?,
              offer_letter = ?,
              notes = ?,
              status = ?,
              approver_id = ?,
              updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
            WHERE id = ?
          `).run(
            jobTitleId, salaryMonthly, allowances, startDate, expirationDate,
            salaryJustification, offerLetter, notes, newStatus, approverId, id
          );
        }
      } else {
        await this.db.prepare(`
          UPDATE offers SET
            salary_monthly = ?,
            start_date = ?,
            status = ?,
            approver_id = ?
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ?
        `).run(salaryMonthly, startDate, newStatus, approverId, id);
      }

      if (newStatus === 'PENDING_APPROVAL' && ['DRAFT', 'REVISION_REQUESTED'].includes(existing.status)) {
        await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(existing.candidate_id);
      }

      return {
        success: true,
        statusCode: 200,
        message: newStatus === 'PENDING_APPROVAL' ? 'Đã gửi đề xuất Offer sang quy trình phê duyệt.' : 'Cập nhật đề xuất Offer thành công.',
        data: {
          id,
          status: newStatus,
          salaryMonthly,
          allowances,
          startDate,
          expirationDate
        }
      };
    });
  }

  async updateOfferStatus(id, status, actor = null) {
    if (actor) {
      return this.db.transaction(async () => {
        const reader = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.read');
        if (!reader) {
          return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật Offer.' };
        }
        const candidateResponse = reader.roles.length > 0 && reader.roles.every(role => role === 'CANDIDATE') && status === 'ACCEPTED';
        const permission = candidateResponse ? 'offer.read' : ['APPROVED', 'REJECTED'].includes(status) ? 'offer.approve' : 'offer.create';
        const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, permission);
        if (!fresh) {
          return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật Offer.' };
        }
        actor = { ...actor, ...fresh };
        const row = await this.db.prepare('SELECT o.id, o.status, o.approver_id, o.candidate_id, c.email, r.recruiter_id, r.id AS requisition_id FROM offers o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requisitions r ON r.id=COALESCE(o.requisition_id, c.requisition_id) WHERE o.id=?' + (this.db.provider === 'postgres' ? ' FOR UPDATE OF o' : '')).get(id);
        if (!row) {
          return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
        }
        if (!actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
          if (!candidateResponse && !['APPROVED', 'REJECTED'].includes(status)) {
            const access = await this.requisitionService.candidateAccess(row.candidate_id, actor);
            if (!access.success) return access;
          }
          const allowed = candidateResponse
            ? row.email.toLowerCase() === actor.email.toLowerCase()
            : ['APPROVED', 'REJECTED'].includes(status)
            ? row.approver_id === actor.id
            : await this.requisitionService.recruiterAssigned(row.requisition_id, actor.id);
          if (!allowed) {
            return { success: false, statusCode: 403, code: 'OFFER_OUT_OF_SCOPE', message: 'Offer không thuộc phạm vi xử lý của bạn.' };
          }
        }
        if (status === 'ACCEPTED' && row.status !== 'SENT') {
          return { success: false, statusCode: 409, code: 'OFFER_NOT_SENT', message: 'Chỉ được chấp nhận Offer đã gửi.' };
        }
        return this.updateOfferStatus(id, status, null);
      });
    }

    if (this.requisitionService.openPolicy) {
      await this.requisitionService.openPolicy.notDraft((await this.db.prepare('SELECT COALESCE(x.requisition_id, c.requisition_id) AS requisition_id FROM offers x LEFT JOIN candidates c ON c.id=x.candidate_id WHERE x.id=?').get(id))?.requisition_id);
    }
    if (!id) return { success: false, statusCode: 400, message: 'Thiếu mã offer.' };

    const hasUpdatedAt = await this.hasUpdatedAtCol();
    const stmt = this.db.prepare(`UPDATE offers SET status = ? ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''} WHERE id = ? AND (? <> 'ACCEPTED' OR status = 'SENT')`);
    const res = await stmt.run(status, id, status);
    if (res.changes === 0) {
      if (status === 'ACCEPTED' && await this.db.prepare('SELECT id FROM offers WHERE id=?').get(id)) {
        return { success: false, statusCode: 409, code: 'OFFER_NOT_SENT', message: 'Chỉ được chấp nhận Offer đã gửi.' };
      }
      return { success: false, statusCode: 404, message: 'Không tìm thấy offer.' };
    }

    if (status === 'ACCEPTED') {
      const off = await this.db.prepare('SELECT candidate_id FROM offers WHERE id = ?').get(id);
      if (off && off.candidate_id) {
        await this.db.prepare("UPDATE candidates SET stage = 'HIRED' WHERE id = ?").run(off.candidate_id);
      }
    } else if (status === 'APPROVED') {
      const off = await this.db.prepare('SELECT candidate_id FROM offers WHERE id = ?').get(id);
      if (off && off.candidate_id) {
        await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(off.candidate_id);
      }
    }
    return { success: true, statusCode: 200, message: 'Cập nhật trạng thái offer thành công.' };
  }

  async decideOffer(params = {}, actor = null) {
    const offerId = params.offerId || params.id;
    if (!offerId) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };

    if (!actor) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' };
    }

    const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.approve');
    if (!fresh) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền phê duyệt Offer.' };
    }
    actor = { ...actor, ...fresh };

    let action = (params.action || '').toUpperCase().trim();
    if (action === 'APPROVED') action = 'APPROVE';
    if (action === 'REJECTED') action = 'REJECT';
    if (action === 'REVISION_REQUESTED') action = 'REQUEST_REVISION';

    if (!['APPROVE', 'REJECT', 'REQUEST_REVISION'].includes(action)) {
      return { success: false, statusCode: 400, code: 'INVALID_ACTION', message: 'Hành động không hợp lệ. Chỉ chấp nhận APPROVE, REJECT hoặc REQUEST_REVISION.' };
    }

    const comment = params.comment !== undefined && params.comment !== null ? String(params.comment).trim() : '';
    if (['REJECT', 'REQUEST_REVISION'].includes(action) && !comment) {
      return {
        success: false,
        statusCode: 400,
        code: 'COMMENT_REQUIRED',
        message: action === 'REJECT'
          ? 'Ý kiến giải trình là bắt buộc khi từ chối Offer.'
          : 'Ý kiến yêu cầu chỉnh sửa là bắt buộc khi yêu cầu sửa Offer.'
      };
    }

    return this.db.transaction(async () => {
      const lockSql = this.db.provider === 'postgres' ? ' FOR UPDATE OF o' : '';
      const row = await this.db.prepare(`
        SELECT
          o.*,
          c.full_name AS candidate_name,
          c.email AS candidate_email,
          r.title AS requisition_title,
          jt.name AS job_title_name,
          jt.min_salary AS job_min_salary,
          jt.max_salary AS job_max_salary
        FROM offers o
        LEFT JOIN candidates c ON o.candidate_id = c.id
        LEFT JOIN requisitions r ON COALESCE(o.requisition_id, c.requisition_id) = r.id
        LEFT JOIN job_titles jt ON COALESCE(o.job_title_id, r.job_title_id) = jt.id
        WHERE o.id = ?${lockSql}
      `).get(offerId);

      if (!row) {
        return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
      }

      if (row.status === 'APPROVED') {
        return { success: false, statusCode: 400, code: 'OFFER_ALREADY_APPROVED', message: 'Offer đã được phê duyệt, không thể thao tác lại.' };
      }
      if (row.status === 'REJECTED') {
        return { success: false, statusCode: 400, code: 'OFFER_ALREADY_REJECTED', message: 'Offer đã bị từ chối.' };
      }
      if (row.status === 'REVISION_REQUESTED') {
        return { success: false, statusCode: 400, code: 'OFFER_AWAITING_REVISION', message: 'Offer đang chờ người lập chỉnh sửa lại.' };
      }
      if (row.status === 'DRAFT') {
        return { success: false, statusCode: 400, code: 'OFFER_NOT_SUBMITTED', message: 'Offer đang ở trạng thái nháp, chưa gửi phê duyệt.' };
      }
      if (row.status !== 'PENDING_APPROVAL') {
        return { success: false, statusCode: 400, code: 'OFFER_NOT_PENDING_APPROVAL', message: 'Offer không ở trạng thái chờ phê duyệt.' };
      }

      const minSal = row.job_min_salary !== null && row.job_min_salary !== undefined ? Number(row.job_min_salary) : null;
      const maxSal = row.job_max_salary !== null && row.job_max_salary !== undefined ? Number(row.job_max_salary) : null;
      const sal = Number(row.salary_monthly) || 0;
      const isOutOfBand = (minSal !== null && sal < minSal) || (maxSal !== null && sal > maxSal);

      const hasApprovalCols = await this.hasApprovalCols();
      const currentLevel = hasApprovalCols && row.current_approval_level ? Number(row.current_approval_level) : 1;
      const requiredLevels = hasApprovalCols && row.required_approval_levels ? Number(row.required_approval_levels) : (isOutOfBand ? 2 : 1);

      if (params.level && Number(params.level) !== currentLevel) {
        return { success: false, statusCode: 400, code: 'INVALID_APPROVAL_LEVEL_SEQUENCE', message: 'Không thể bỏ qua cấp duyệt bắt buộc.' };
      }

      const isAdmin = actor.roles.includes('ADMIN');
      const isHrMgr = actor.roles.includes('HR_MANAGER');
      const isAssignedApprover = actor.roles.includes('APPROVER') && row.approver_id === actor.id;

      if (currentLevel === 1) {
        if (!isAdmin && !isHrMgr && !isAssignedApprover) {
          return { success: false, statusCode: 403, code: 'FORBIDDEN_APPROVER_ROLE', message: 'Bạn không có thẩm quyền phê duyệt cấp 1 cho Offer này.' };
        }
      } else if (currentLevel === 2) {
        if (!isAdmin) {
          return { success: false, statusCode: 403, code: 'FORBIDDEN_HIGHER_APPROVAL_REQUIRED', message: 'Chỉ cấp quản lý cao hơn (ADMIN) mới có thẩm quyền phê duyệt cấp 2 cho offer vượt khung lương.' };
        }
      }

      const hasApprovalsTable = await this.hasApprovalsTable();
      if (hasApprovalsTable) {
        const approvalId = 'appr-' + crypto.randomUUID();
        const approverName = actor.fullName || actor.full_name || actor.email;
        const approverRole = isAdmin ? 'ADMIN' : (isHrMgr ? 'HR_MANAGER' : (actor.roles[0] || 'APPROVER'));
        await this.db.prepare(`
          INSERT INTO offer_approvals (
            id, offer_id, level, action, approver_id, approver_name, approver_role, comment, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
          )
        `).run(approvalId, offerId, currentLevel, action, actor.id, approverName, approverRole, comment || null);
      }

      const hasUpdatedAt = await this.hasUpdatedAtCol();

      if (action === 'REJECT') {
        await this.db.prepare(`
          UPDATE offers SET
            status = 'REJECTED'
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ?
        `).run(offerId);

        return {
          success: true,
          statusCode: 200,
          code: 'OFFER_REJECTED',
          message: 'Đã từ chối đề xuất Offer.',
          data: { id: offerId, status: 'REJECTED', action: 'REJECT', level: currentLevel }
        };
      }

      if (action === 'REQUEST_REVISION') {
        await this.db.prepare(`
          UPDATE offers SET
            status = 'REVISION_REQUESTED'
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ?
        `).run(offerId);

        return {
          success: true,
          statusCode: 200,
          code: 'OFFER_REVISION_REQUESTED',
          message: 'Đã yêu cầu chỉnh sửa đề xuất Offer.',
          data: { id: offerId, status: 'REVISION_REQUESTED', action: 'REQUEST_REVISION', level: currentLevel }
        };
      }

      if (currentLevel < requiredLevels) {
        const nextLevel = currentLevel + 1;
        if (hasApprovalCols) {
          await this.db.prepare(`
            UPDATE offers SET
              current_approval_level = ?
              ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
            WHERE id = ?
          `).run(nextLevel, offerId);
        }

        return {
          success: true,
          statusCode: 200,
          code: 'OFFER_LEVEL_APPROVED',
          message: `Đã phê duyệt Cấp ${currentLevel} thành công. Offer được chuyển tiếp lên Cấp ${nextLevel} phê duyệt.`,
          data: { id: offerId, status: 'PENDING_APPROVAL', currentApprovalLevel: nextLevel, requiredApprovalLevels: requiredLevels }
        };
      }

      await this.db.prepare(`
        UPDATE offers SET
          status = 'APPROVED',
          approver_id = ?
          ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
        WHERE id = ?
      `).run(actor.id, offerId);

      if (row.candidate_id) {
        await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(row.candidate_id);
      }

      return {
        success: true,
        statusCode: 200,
        code: 'OFFER_APPROVED',
        message: 'Đã hoàn tất phê duyệt Offer thành công.',
        data: { id: offerId, status: 'APPROVED', action: 'APPROVE', level: currentLevel }
      };
    });
  }

  async getOfferApprovals(offerId, actor = null) {
    if (!offerId) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    if (actor) {
      const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.read');
      if (!fresh) {
        return { success: false, statusCode: 403, code: 'OFFER_FORBIDDEN', message: 'Bạn không có quyền xem thông tin phê duyệt.' };
      }
    }

    const hasApprovalsTable = await this.hasApprovalsTable();
    if (!hasApprovalsTable) {
      return { success: true, statusCode: 200, data: [] };
    }

    const rows = await this.db.prepare(`
      SELECT
        id,
        offer_id,
        level,
        action,
        approver_id,
        approver_name,
        approver_role,
        comment,
        created_at
      FROM offer_approvals
      WHERE offer_id = ?
      ORDER BY created_at ASC, level ASC
    `).all(offerId);

    return {
      success: true,
      statusCode: 200,
      data: rows.map(r => ({
        id: r.id,
        offerId: r.offer_id,
        level: r.level,
        action: r.action,
        approverId: r.approver_id,
        approverName: r.approver_name,
        approverRole: r.approver_role,
        comment: r.comment,
        createdAt: r.created_at
      }))
    };
  }

  async expireOverdueOffers() {
    try {
      const hasDelivery = await this.hasDeliveryCols();
      const hasUpdatedAt = await this.hasUpdatedAtCol();
      if (hasDelivery) {
        const query = this.db.provider === 'postgres'
          ? `UPDATE offers SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE status = 'SENT' AND ((token_expires_at IS NOT NULL AND token_expires_at < CURRENT_TIMESTAMP) OR (expiration_date IS NOT NULL AND expiration_date < CURRENT_DATE))`
          : `UPDATE offers SET status = 'EXPIRED' ${hasUpdatedAt ? ", updated_at = datetime('now')" : ""} WHERE status = 'SENT' AND ((token_expires_at IS NOT NULL AND token_expires_at < datetime('now')) OR (expiration_date IS NOT NULL AND date(expiration_date) < date('now')))`;
        const res = await this.db.prepare(query).run();
        return res.changes || 0;
      }
    } catch {
      return 0;
    }
  }

  async sendOffer(offerId, actor = null) {
    if (!offerId) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    if (!actor) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' };
    }

    const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.create');
    if (!fresh) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền gửi Offer.' };
    }
    actor = { ...actor, ...fresh };

    await this.expireOverdueOffers();

    const txResult = await this.db.transaction(async () => {
      const lockSql = this.db.provider === 'postgres' ? ' FOR UPDATE OF o' : '';
      const row = await this.db.prepare(`
        SELECT
          o.*,
          c.full_name AS candidate_name,
          c.email AS candidate_email,
          c.phone_number AS candidate_phone,
          c.requisition_id AS candidate_req_id,
          r.title AS requisition_title,
          r.department_name,
          jt.name AS job_title_name
        FROM offers o
        JOIN candidates c ON o.candidate_id = c.id
        LEFT JOIN requisitions r ON COALESCE(o.requisition_id, c.requisition_id) = r.id
        LEFT JOIN job_titles jt ON COALESCE(o.job_title_id, r.job_title_id) = jt.id
        WHERE o.id = ?${lockSql}
      `).get(offerId);

      if (!row) {
        return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
      }

      if (row.status === 'SENT') {
        return { success: false, statusCode: 400, code: 'OFFER_ALREADY_SENT', message: 'Offer đã được gửi đến ứng viên trước đó.' };
      }

      if (row.status !== 'APPROVED') {
        return {
          success: false,
          statusCode: 400,
          code: 'OFFER_NOT_APPROVED',
          message: 'Chỉ được gửi thư mời nhận việc cho Offer đã hoàn tất phê duyệt.'
        };
      }

      const reqId = row.requisition_id || row.candidate_req_id;
      if (!actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
        const access = await this.requisitionService.candidateAccess(row.candidate_id, actor);
        if (!access.success) return access;
        if (!await this.requisitionService.recruiterAssigned(reqId, actor.id)) {
          return { success: false, statusCode: 403, code: 'OFFER_OUT_OF_SCOPE', message: 'Offer không thuộc vị trí được giao cho bạn.' };
        }
      }

      const responseToken = crypto.randomBytes(32).toString('hex');
      let tokenExpiresAt = null;
      if (row.expiration_date) {
        if (row.expiration_date instanceof Date) {
          tokenExpiresAt = row.expiration_date.toISOString();
        } else {
          const expStr = String(row.expiration_date).trim();
          tokenExpiresAt = expStr.includes('T') ? expStr : `${expStr}T23:59:59.999Z`;
        }
      } else {
        tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      const hasDelivery = await this.hasDeliveryCols();
      const hasUpdatedAt = await this.hasUpdatedAtCol();

      if (hasDelivery) {
        await this.db.prepare(`
          UPDATE offers SET
            status = 'SENT',
            sent_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"},
            sent_by = ?,
            response_token = ?,
            token_expires_at = ?
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ? AND status = 'APPROVED'
        `).run(actor.id, responseToken, tokenExpiresAt, offerId);
      } else {
        await this.db.prepare(`
          UPDATE offers SET
            status = 'SENT'
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ? AND status = 'APPROVED'
        `).run(offerId);
      }

      await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(row.candidate_id);

      return {
        success: true,
        row,
        responseToken,
        tokenExpiresAt
      };
    });

    if (!txResult || !txResult.success) {
      return txResult;
    }

    const { row, responseToken, tokenExpiresAt } = txResult;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const responseUrl = `${appUrl}/candidate-offer.html?token=${responseToken}`;

    let emailSent = false;
    try {
      const emailService = require('./emailService').getEmailService(this.db);
      const candName = row.candidate_name || 'Ứng viên';
      const jobTitle = row.job_title_name || row.requisition_title || 'Vị trí tuyển dụng';
      const deptName = row.department_name || 'Công ty';
      const salaryFormatted = this.formatCurrency(row.salary_monthly);
      const allowancesFormatted = row.allowances ? this.formatCurrency(row.allowances) + ' VNĐ / tháng' : 'Không có';
      const startDateFormatted = this.formatDate(row.start_date);
      const expDateFormatted = this.formatDate(row.expiration_date || tokenExpiresAt);

      const emailSubject = `[ATS] Thư mời nhận việc (Job Offer Letter) - ${jobTitle}`;
      const emailHtml = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a202c; max-width: 680px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
            <div style="text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px;">
              <h3 style="margin: 0; text-transform: uppercase; letter-spacing: 1px; color: #1e3a8a;">HỆ THỐNG TUYỂN DỤNG ATS</h3>
              <h2 style="margin: 12px 0 0 0; color: #2563eb; font-size: 1.4rem;">THƯ MỜI NHẬN VIỆC (JOB OFFER LETTER)</h2>
            </div>
            <p>Kính gửi: <strong>${candName}</strong>,</p>
            <p>Chúng tôi rất vui mừng thông báo Ông/Bà đã trúng tuyển vị trí <strong>${jobTitle}</strong> tại <strong>${deptName}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tbody>
                <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568; width: 40%;">Vị trí / Chức danh:</td><td style="padding: 8px 0; font-weight: 600;">${jobTitle}</td></tr>
                <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Bộ phận / Phòng ban:</td><td style="padding: 8px 0; font-weight: 600;">${deptName}</td></tr>
                <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Mức lương hàng tháng:</td><td style="padding: 8px 0; font-weight: 600; color: #2563eb;">${salaryFormatted} VNĐ</td></tr>
                <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Phụ cấp:</td><td style="padding: 8px 0;">${allowancesFormatted}</td></tr>
                <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Ngày dự kiến nhận việc:</td><td style="padding: 8px 0; font-weight: 600;">${startDateFormatted}</td></tr>
                <tr style="border-bottom: 1px solid #edf2f7;"><td style="padding: 8px 0; color: #4a5568;">Thời hạn phản hồi:</td><td style="padding: 8px 0; font-weight: 600; color: #dc2626;">${expDateFormatted}</td></tr>
              </tbody>
            </table>
            <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-weight: 600; color: #1e293b;">Nội dung thư mời:</p>
              <div style="white-space: pre-wrap; font-size: 0.9rem; color: #475569; margin-top: 8px;">${row.offer_letter || ''}</div>
            </div>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${responseUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 1rem; display: inline-block;">
                👉 Xem và Phản hồi Thư Mời Nhận Việc
              </a>
            </div>
            <p style="font-size: 0.85rem; color: #64748b; text-align: center;">
              Nếu nút trên không mở được, vui lòng truy cập đường dẫn sau:<br/>
              <span style="color: #2563eb; word-break: break-all;">${responseUrl}</span>
            </p>
            <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center;">
              Liên kết này dành riêng cho bạn và sẽ hết hiệu lực sau ngày ${expDateFormatted}.
            </p>
          </div>
        `;
      const emailText = `Kính gửi ${candName},\n\nChúng tôi trân trọng gửi tới bạn Thư mời nhận việc cho vị trí ${jobTitle} tại ${deptName}.\nMức lương: ${salaryFormatted} VNĐ\nNgày dự kiến nhận việc: ${startDateFormatted}\nThời hạn phản hồi: ${expDateFormatted}\n\nVui lòng truy cập đường dẫn sau để phản hồi thư mời:\n${responseUrl}\n\nTrân trọng,\nPhòng Tuyển dụng`;

      const mailRes = await emailService.sendMail({
        to: row.candidate_email,
        subject: emailSubject,
        html: emailHtml,
        text: emailText,
        templateName: 'OFFER_DELIVERY'
      });
      emailSent = Boolean(mailRes.success);
    } catch {
      emailSent = false;
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Đã gửi thư mời nhận việc đến ứng viên thành công.',
      data: {
        id: offerId,
        status: 'SENT',
        responseToken,
        tokenExpiresAt,
        responseUrl,
        sentAt: new Date().toISOString(),
        emailSent
      }
    };
  }

  async getOfferByToken(token) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { success: false, statusCode: 400, code: 'INVALID_TOKEN', message: 'Mã phản hồi không hợp lệ.' };
    }
    const cleanToken = token.trim();
    const hasDelivery = await this.hasDeliveryCols();
    if (!hasDelivery) {
      return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
    }

    const row = await this.db.prepare(`
      SELECT
        o.*,
        c.full_name AS candidate_name,
        c.email AS candidate_email,
        r.title AS requisition_title,
        r.department_name,
        jt.name AS job_title_name
      FROM offers o
      JOIN candidates c ON o.candidate_id = c.id
      LEFT JOIN requisitions r ON COALESCE(o.requisition_id, c.requisition_id) = r.id
      LEFT JOIN job_titles jt ON COALESCE(o.job_title_id, r.job_title_id) = jt.id
      WHERE o.response_token = ?
    `).get(cleanToken);

    if (!row) {
      return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Liên kết không tồn tại hoặc không hợp lệ.' };
    }

    let isExpired = row.status === 'EXPIRED';
    if (!isExpired && row.status === 'SENT') {
      const now = new Date();
      if (row.token_expires_at && new Date(row.token_expires_at) < now) {
        isExpired = true;
      } else if (row.expiration_date) {
        const expDate = row.expiration_date instanceof Date
          ? row.expiration_date
          : new Date(String(row.expiration_date).includes('T') ? row.expiration_date : `${row.expiration_date}T23:59:59.999Z`);
        if (expDate < now) isExpired = true;
      }
      if (isExpired) {
        const hasUpdatedAt = await this.hasUpdatedAtCol();
        await this.db.prepare(`
          UPDATE offers SET
            status = 'EXPIRED'
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ?
        `).run(row.id);
        row.status = 'EXPIRED';
      }
    }

    const isResponded = ['ACCEPTED', 'REJECTED'].includes(row.status) || Boolean(row.responded_at);

    return {
      success: true,
      statusCode: 200,
      data: {
        id: row.id,
        candidateName: row.candidate_name,
        candidateEmail: row.candidate_email,
        jobTitleName: row.job_title_name || row.requisition_title,
        departmentName: row.department_name,
        salaryMonthly: Number(row.salary_monthly),
        allowances: Number(row.allowances || 0),
        startDate: row.start_date,
        expirationDate: row.expiration_date,
        tokenExpiresAt: row.token_expires_at,
        offerLetter: row.offer_letter,
        status: row.status,
        isExpired,
        isResponded,
        candidateResponse: row.candidate_response,
        candidateComment: row.candidate_comment,
        respondedAt: row.responded_at
      }
    };
  }

  async respondOffer(token, data = {}) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { success: false, statusCode: 400, code: 'INVALID_TOKEN', message: 'Mã phản hồi không hợp lệ.' };
    }
    const cleanToken = token.trim();
    let decision = (data.decision || '').toUpperCase().trim();
    if (decision === 'ACCEPT') decision = 'ACCEPTED';
    if (decision === 'REJECT' || decision === 'DECLINE') decision = 'REJECTED';

    if (!['ACCEPTED', 'REJECTED'].includes(decision)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_DECISION',
        message: 'Quyết định không hợp lệ. Chỉ chấp nhận ACCEPTED hoặc REJECTED.'
      };
    }

    const comment = data.comment !== undefined && data.comment !== null ? String(data.comment).trim() : null;
    const rejectionReasonCategory = data.rejectionReasonCategory || null;

    const hasDelivery = await this.hasDeliveryCols();
    if (!hasDelivery) {
      return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
    }

    return this.db.transaction(async () => {
      const lockSql = this.db.provider === 'postgres' ? ' FOR UPDATE OF o' : '';
      const row = await this.db.prepare(`
        SELECT o.*, c.id AS cand_id, c.stage AS candidate_stage
        FROM offers o
        JOIN candidates c ON o.candidate_id = c.id
        WHERE o.response_token = ?${lockSql}
      `).get(cleanToken);

      if (!row) {
        return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Liên kết không tồn tại hoặc không hợp lệ.' };
      }

      if (['ACCEPTED', 'REJECTED'].includes(row.status) || row.responded_at) {
        return {
          success: false,
          statusCode: 409,
          code: 'OFFER_ALREADY_RESPONDED',
          message: 'Offer đã được phản hồi trước đó, không thể thay đổi quyết định.'
        };
      }

      const now = new Date();
      let isExpired = row.status === 'EXPIRED';
      if (!isExpired) {
        if (row.token_expires_at && new Date(row.token_expires_at) < now) {
          isExpired = true;
        } else if (row.expiration_date) {
          const expDate = row.expiration_date instanceof Date
            ? row.expiration_date
            : new Date(String(row.expiration_date).includes('T') ? row.expiration_date : `${row.expiration_date}T23:59:59.999Z`);
          if (expDate < now) isExpired = true;
        }
      }

      if (isExpired) {
        const hasUpdatedAt = await this.hasUpdatedAtCol();
        await this.db.prepare(`
          UPDATE offers SET
            status = 'EXPIRED'
            ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
          WHERE id = ?
        `).run(row.id);

        return {
          success: false,
          statusCode: 410,
          code: 'OFFER_EXPIRED',
          message: 'Thời hạn phản hồi Offer đã kết thúc, không thể gửi phản hồi.'
        };
      }

      if (row.status !== 'SENT') {
        return {
          success: false,
          statusCode: 400,
          code: 'OFFER_NOT_OPEN_FOR_RESPONSE',
          message: 'Offer không ở trạng thái chờ ứng viên phản hồi.'
        };
      }

      const hasUpdatedAt = await this.hasUpdatedAtCol();
      await this.db.prepare(`
        UPDATE offers SET
          status = ?,
          candidate_response = ?,
          candidate_comment = ?,
          rejection_reason_category = ?,
          responded_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}
          ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
        WHERE id = ? AND status = 'SENT'
      `).run(decision, decision, comment, rejectionReasonCategory, row.id);

      if (decision === 'ACCEPTED') {
        await this.db.prepare("UPDATE candidates SET stage = 'HIRED' WHERE id = ?").run(row.candidate_id);
      } else if (decision === 'REJECTED') {
        await this.db.prepare("UPDATE candidates SET stage = 'REJECTED' WHERE id = ?").run(row.candidate_id);
      }

      return {
        success: true,
        statusCode: 200,
        message: decision === 'ACCEPTED'
          ? 'Chúc mừng bạn đã đồng ý nhận việc! Chúng tôi sẽ liên hệ để chuẩn bị thủ tục nhận việc.'
          : 'Cảm ơn bạn đã phản hồi. Bộ phận Tuyển dụng đã ghi nhận ý kiến của bạn.',
        data: {
          offerId: row.id,
          candidateId: row.candidate_id,
          status: decision,
          candidateResponse: decision,
          candidateComment: comment,
          respondedAt: new Date().toISOString()
        }
      };
    });
  }

  async recordRejectionReason(offerId, data = {}, actor = null) {
    if (!offerId) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    if (!actor) return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' };

    const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.create');
    if (!fresh) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật Offer.' };
    }
    actor = { ...actor, ...fresh };

    const catRaw = (data.rejectionReasonCategory || data.category || '').trim();
    if (!catRaw) {
      return { success: false, statusCode: 400, code: 'CATEGORY_REQUIRED', message: 'Vui lòng chọn danh mục lý do từ chối.' };
    }
    const catMap = {
      'lương': 'SALARY', 'salary': 'SALARY',
      'địa điểm': 'LOCATION', 'location': 'LOCATION',
      'nhận việc nơi khác': 'COMPETITOR', 'nơi khác': 'COMPETITOR', 'competitor': 'COMPETITOR', 'another_offer': 'COMPETITOR',
      'lý do cá nhân': 'PERSONAL', 'cá nhân': 'PERSONAL', 'personal': 'PERSONAL',
      'khác': 'OTHER', 'lý do khác': 'OTHER', 'other': 'OTHER'
    };
    const category = catMap[catRaw.toLowerCase()] || catRaw.toUpperCase();
    const VALID_CATEGORIES = ['SALARY', 'LOCATION', 'COMPETITOR', 'PERSONAL', 'OTHER'];
    if (!VALID_CATEGORIES.includes(category)) {
      return {
        success: false,
        statusCode: 400,
        code: 'INVALID_REJECTION_CATEGORY',
        message: 'Danh mục lý do từ chối không hợp lệ. Chỉ chấp nhận SALARY, LOCATION, COMPETITOR, PERSONAL hoặc OTHER.'
      };
    }

    const row = await this.db.prepare(`
      SELECT o.*, c.stage AS candidate_stage, c.full_name AS candidate_name, c.requisition_id AS cand_req_id
      FROM offers o
      JOIN candidates c ON o.candidate_id = c.id
      WHERE o.id = ?
    `).get(offerId);

    if (!row) {
      return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
    }

    const reqId = row.requisition_id || row.cand_req_id;
    if (!actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
      const access = await this.requisitionService.candidateAccess(row.candidate_id, actor);
      if (!access.success) return access;
      if (!await this.requisitionService.recruiterAssigned(reqId, actor.id)) {
        return { success: false, statusCode: 403, code: 'OFFER_OUT_OF_SCOPE', message: 'Offer không thuộc vị trí được giao cho bạn.' };
      }
    }

    const comment = data.notes !== undefined ? String(data.notes).trim() : (data.candidateComment !== undefined ? String(data.candidateComment).trim() : (row.candidate_comment || null));

    const hasUpdatedAt = await this.hasUpdatedAtCol();
    await this.db.prepare(`
      UPDATE offers SET
        rejection_reason_category = ?,
        candidate_comment = ?,
        candidate_response = COALESCE(candidate_response, 'REJECTED'),
        responded_at = COALESCE(responded_at, ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}),
        status = CASE WHEN status IN ('SENT', 'APPROVED', 'DRAFT') THEN 'REJECTED' ELSE status END
        ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
      WHERE id = ?
    `).run(category, comment, offerId);

    if (['SENT', 'APPROVED', 'DRAFT'].includes(row.status)) {
      await this.db.prepare("UPDATE candidates SET stage = 'REJECTED' WHERE id = ?").run(row.candidate_id);
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Đã ghi nhận lý do từ chối offer thành công.',
      data: {
        id: offerId,
        rejectionReasonCategory: category,
        candidateComment: comment,
        status: row.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'REJECTED',
        talentPoolRecommendation: {
          recommended: true,
          candidateId: row.candidate_id,
          candidateName: row.candidate_name,
          defaultReason: `Ứng viên từ chối offer (${category}${comment ? ': ' + comment : ''}) - Lưu hồ sơ tiềm năng.`
        }
      }
    };
  }

  async reviseOffer(offerId, data = {}, actor = null) {
    if (!offerId) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    if (!actor) return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' };

    const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'offer.create');
    if (!fresh) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Bạn không có quyền soạn thảo Offer.' };
    }
    actor = { ...actor, ...fresh };

    return this.db.transaction(async () => {
      const lockSql = this.db.provider === 'postgres' ? ' FOR UPDATE OF o' : '';
      const row = await this.db.prepare(`
        SELECT
          o.*,
          c.full_name AS candidate_name,
          c.email AS candidate_email,
          c.phone_number AS candidate_phone,
          c.requisition_id AS candidate_req_id,
          c.stage AS candidate_stage,
          r.title AS requisition_title,
          r.department_name,
          r.proposed_salary_max,
          r.proposed_salary_min,
          r.job_title_id AS req_jt_id,
          r.status AS req_status,
          jt.name AS job_title_name,
          jt.min_salary,
          jt.max_salary
        FROM offers o
        JOIN candidates c ON o.candidate_id = c.id
        LEFT JOIN requisitions r ON COALESCE(o.requisition_id, c.requisition_id) = r.id
        LEFT JOIN job_titles jt ON COALESCE(o.job_title_id, r.job_title_id) = jt.id
        WHERE o.id = ?${lockSql}
      `).get(offerId);

      if (!row) {
        return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
      }

      if (row.status === 'SUPERSEDED') {
        return {
          success: false,
          statusCode: 400,
          code: 'OFFER_ALREADY_SUPERSEDED',
          message: 'Offer này đã được thay thế bởi một offer khác, không thể sửa đổi tiếp.'
        };
      }

      if (row.status === 'ACCEPTED') {
        return {
          success: false,
          statusCode: 400,
          code: 'OFFER_ALREADY_ACCEPTED',
          message: 'Offer này đã được ứng viên chấp nhận, không thể sửa đổi.'
        };
      }

      const reqId = row.requisition_id || row.candidate_req_id;
      if (!actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
        const access = await this.requisitionService.candidateAccess(row.candidate_id, actor);
        if (!access.success) return access;
        if (!await this.requisitionService.recruiterAssigned(reqId, actor.id)) {
          return { success: false, statusCode: 403, code: 'OFFER_OUT_OF_SCOPE', message: 'Offer không thuộc vị trí được giao cho bạn.' };
        }
      }

      if (row.req_status && ['CANCELLED', 'CLOSED'].includes(row.req_status)) {
        return {
          success: false,
          statusCode: 400,
          code: 'REQUISITION_NOT_ACTIVE',
          message: 'Vị trí tuyển dụng đã đóng hoặc bị hủy, không thể lập offer sửa đổi.'
        };
      }

      const otherActive = await this.db.prepare(`
        SELECT id FROM offers
        WHERE candidate_id = ? AND id != ? AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT')
      `).get(row.candidate_id, offerId);

      if (otherActive) {
        return {
          success: false,
          statusCode: 409,
          code: 'ACTIVE_OFFER_ALREADY_EXISTS',
          message: 'Ứng viên hiện đã có một đề xuất Offer khác đang hiệu lực.'
        };
      }

      const salaryMonthly = data.salaryMonthly !== undefined ? parseInt(data.salaryMonthly, 10) : Number(row.salary_monthly);
      if (!salaryMonthly || isNaN(salaryMonthly) || salaryMonthly <= 0) {
        return { success: false, statusCode: 400, code: 'INVALID_SALARY', message: 'Mức lương cơ bản không hợp lệ.' };
      }

      const allowances = data.allowances !== undefined ? parseInt(data.allowances, 10) : Number(row.allowances || 0);
      const startDate = data.startDate || row.start_date;
      if (!startDate) {
        return { success: false, statusCode: 400, code: 'INVALID_START_DATE', message: 'Vui lòng chọn ngày dự kiến nhận việc.' };
      }
      const expirationDate = data.expirationDate !== undefined ? data.expirationDate : row.expiration_date;
      const salaryJustification = data.salaryJustification !== undefined ? data.salaryJustification : row.salary_justification;
      const notes = data.notes !== undefined ? data.notes : row.notes;
      const jobTitleId = data.jobTitleId || row.job_title_id || row.req_jt_id || null;

      const minSalary = row.min_salary || row.proposed_salary_min || 0;
      const maxSalary = row.max_salary || row.proposed_salary_max || 0;
      const isOutOfBand = (minSalary > 0 && salaryMonthly < minSalary) || (maxSalary > 0 && salaryMonthly > maxSalary);
      const requiredApprovalLevels = isOutOfBand ? 2 : 1;

      if (isOutOfBand && (!salaryJustification || !salaryJustification.trim())) {
        return {
          success: false,
          statusCode: 400,
          code: 'JUSTIFICATION_REQUIRED',
          message: 'Mức lương vượt dải chuẩn yêu cầu phải có giải trình lý do.'
        };
      }

      let offerLetter = data.offerLetter;
      if (!offerLetter || !offerLetter.trim()) {
        const letter = this.generateOfferLetter({
          candidateName: row.candidate_name,
          candidateEmail: row.candidate_email,
          candidatePhone: row.candidate_phone,
          jobTitleName: row.job_title_name || row.requisition_title,
          requisitionTitle: row.requisition_title,
          departmentName: row.department_name,
          salaryMonthly,
          allowances,
          startDate,
          expirationDate
        });
        offerLetter = letter.html;
      }

      const newOfferId = crypto.randomUUID();
      const submitForApproval = Boolean(data.submitForApproval);
      const initialStatus = submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT';

      const hasUpdatedAt = await this.hasUpdatedAtCol();
      await this.db.prepare(`
        UPDATE offers SET
          status = 'SUPERSEDED'
          ${hasUpdatedAt ? `, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"}` : ''}
        WHERE id = ?
      `).run(offerId);

      const nowSql = this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')";
      await this.db.prepare(`
        INSERT INTO offers (
          id, candidate_id, requisition_id, job_title_id, salary_monthly, allowances,
          start_date, expiration_date, salary_justification, offer_letter, notes,
          status, current_approval_level, required_approval_levels, created_by,
          predecessor_offer_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ${nowSql}, ${nowSql})
      `).run(
        newOfferId,
        row.candidate_id,
        reqId,
        jobTitleId,
        salaryMonthly,
        allowances,
        startDate,
        expirationDate,
        salaryJustification,
        offerLetter,
        notes,
        initialStatus,
        requiredApprovalLevels,
        actor.id,
        offerId
      );

      await this.db.prepare(`
        UPDATE offers SET
          superseded_by_offer_id = ?
        WHERE id = ?
      `).run(newOfferId, offerId);

      await this.db.prepare("UPDATE candidates SET stage = 'OFFER' WHERE id = ?").run(row.candidate_id);

      return {
        success: true,
        statusCode: 201,
        message: 'Đã tạo đề xuất Offer sửa đổi thành công.',
        data: {
          id: newOfferId,
          predecessorOfferId: offerId,
          candidateId: row.candidate_id,
          requisitionId: reqId,
          jobTitleId,
          salaryMonthly,
          allowances,
          startDate,
          expirationDate,
          salaryJustification,
          isOutOfBand,
          currentApprovalLevel: 1,
          requiredApprovalLevels,
          status: initialStatus,
          predecessorOffer: {
            id: row.id,
            salaryMonthly: Number(row.salary_monthly),
            status: 'SUPERSEDED',
            rejectionReasonCategory: row.rejection_reason_category
          }
        }
      };
    });
  }

  async addToTalentPoolFromOffer(offerId, data = {}, actor = null) {
    if (!offerId) return { success: false, statusCode: 400, message: 'Thiếu mã Offer.' };
    if (!actor) return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' };

    const fresh = await this.rbacMiddleware.getAuthorizedActor(actor.id, 'candidate.update');
    if (!fresh || !actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN_PERMISSION_DENIED', message: 'Chỉ HR hoặc Quản trị viên có quyền đưa ứng viên vào kho tiềm năng.' };
    }
    actor = { ...actor, ...fresh };

    const row = await this.db.prepare(`
      SELECT
        o.*,
        c.stage AS candidate_stage,
        c.full_name AS candidate_name,
        r.title AS requisition_title,
        jt.name AS job_title_name
      FROM offers o
      JOIN candidates c ON o.candidate_id = c.id
      LEFT JOIN requisitions r ON o.requisition_id = r.id
      LEFT JOIN job_titles jt ON o.job_title_id = jt.id
      WHERE o.id = ?
    `).get(offerId);

    if (!row) {
      return { success: false, statusCode: 404, code: 'OFFER_NOT_FOUND', message: 'Không tìm thấy Offer.' };
    }

    if (row.status !== 'REJECTED' && row.candidate_response !== 'REJECTED' && row.candidate_stage !== 'REJECTED') {
      return {
        success: false,
        statusCode: 400,
        code: 'CANDIDATE_NOT_REJECTED',
        message: 'Chỉ có thể đưa ứng viên đã từ chối hoặc bị loại vào kho tiềm năng.'
      };
    }

    if (row.candidate_stage !== 'REJECTED') {
      await this.db.prepare("UPDATE candidates SET stage = 'REJECTED' WHERE id = ?").run(row.candidate_id);
    }

    const TalentPoolService = require('./talentPoolService');
    const talentPoolService = new TalentPoolService(this.db);
    const interestedTitle = (data.interestedTitle || row.job_title_name || row.requisition_title || 'Ứng viên tiềm năng').trim();
    const reason = (data.reason || `Ứng viên từ chối offer (${row.rejection_reason_category || 'Khác'}${row.candidate_comment ? ': ' + row.candidate_comment : ''}) - Lưu hồ sơ tiềm năng.`).trim();

    try {
      const res = await talentPoolService.add({
        candidateId: row.candidate_id,
        interestedTitle,
        reason,
        finalRoundConfirmed: true
      }, actor);

      return {
        success: true,
        statusCode: res.statusCode || 200,
        message: 'Đã lưu ứng viên vào kho tiềm năng thành công.',
        data: {
          offerId,
          candidateId: row.candidate_id,
          talentPoolId: res.id,
          alreadyInPool: Boolean(res.alreadyInPool)
        }
      };
    } catch (err) {
      return {
        success: false,
        statusCode: err.statusCode || 400,
        code: err.code || 'TALENT_POOL_ERROR',
        message: err.message || 'Không thể đưa ứng viên vào kho tiềm năng.'
      };
    }
  }
}

module.exports = OfferService;
