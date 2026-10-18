const crypto = require('node:crypto');

class OfferService {
  constructor(db, requisitionService, rbacMiddleware) {
    this.db = db;
    this.requisitionService = requisitionService;
    this.rbacMiddleware = rbacMiddleware || new (require('../middlewares/rbacMiddleware'))(db);
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
        scopes.push('(LOWER(c.email) = LOWER(?) AND o.status IN (\'SENT\', \'ACCEPTED\', \'APPROVED\'))');
        params.push(viewer.email);
      }
      conditions.push(scopes.length ? '(' + scopes.join(' OR ')+ ')' : '1=0');
    }

    const recruiterScopeParams = viewer?.roles.includes('RECRUITER')
      ? this.requisitionService.recruiterScope('r', viewer.id).params
      : [];

    const stmt = this.db.prepare(`
      SELECT
        o.id,
        o.candidate_id,
        o.requisition_id,
        o.job_title_id,
        o.salary_monthly,
        o.allowances,
        o.start_date,
        o.expiration_date,
        o.salary_justification,
        o.offer_letter,
        o.notes,
        o.status,
        o.approver_id,
        o.created_by,
        o.created_at,
        o.updated_at,
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
        cb.full_name AS creator_name
      FROM offers o
      LEFT JOIN candidates c ON o.candidate_id = c.id
      LEFT JOIN requisitions r ON COALESCE(o.requisition_id, c.requisition_id) = r.id
      LEFT JOIN job_titles jt ON COALESCE(o.job_title_id, r.job_title_id) = jt.id
      LEFT JOIN users u ON o.approver_id = u.id
      LEFT JOIN users cb ON o.created_by = cb.id
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY o.created_at DESC
    `);

    const rows = await stmt.all(...recruiterScopeParams, ...params);

    const offers = rows.map(r => {
      const minSal = r.job_min_salary !== null && r.job_min_salary !== undefined ? Number(r.job_min_salary) : null;
      const maxSal = r.job_max_salary !== null && r.job_max_salary !== undefined ? Number(r.job_max_salary) : null;
      const sal = Number(r.salary_monthly) || 0;
      const isOutOfBand = (minSal !== null && sal < minSal) || (maxSal !== null && sal > maxSal);

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
        capabilities: viewer ? {
          canApprove: viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('APPROVER') && r.approver_id === viewer.id),
          canSend: viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1),
          canAccept: r.status === 'SENT' && viewer.roles.every(role => role === 'CANDIDATE') && r.candidate_email.toLowerCase() === viewer.email.toLowerCase(),
          canEdit: (r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL') && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1)),
          canCancel: (r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL') && (viewer.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || (viewer.roles.includes('RECRUITER') && r.in_recruiter_scope === 1))
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
    return {
      success: true,
      statusCode: 200,
      data: found
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

    try {
      return await this.db.transaction(async () => {
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

      if (newStatus === 'PENDING_APPROVAL' && existing.status === 'DRAFT') {
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

    const stmt = this.db.prepare(`UPDATE offers SET status = ?, updated_at = ${this.db.provider === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"} WHERE id = ? AND (? <> 'ACCEPTED' OR status = 'SENT')`);
    const res = await stmt.run(status, id, status);
    if (res.changes === 0) {
      if (status === 'ACCEPTED' && await this.db.prepare('SELECT id FROM offers WHERE id=?').get(id)) {
        return { success: false, statusCode: 409, code: 'OFFER_NOT_SENT', message: 'Chỉ được chấp nhận Offer đã gửi.' };
      }
      return { success: false, statusCode: 404, message: 'Không tìm thấy offer.' };
    }

    if (status === 'APPROVED') {
      const off = await this.db.prepare('SELECT candidate_id FROM offers WHERE id = ?').get(id);
      if (off && off.candidate_id) {
        await this.db.prepare("UPDATE candidates SET stage = 'HIRED' WHERE id = ?").run(off.candidate_id);
      }
    }
    return { success: true, statusCode: 200, message: 'Cập nhật trạng thái offer thành công.' };
  }
}

module.exports = OfferService;
