const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config/config');
const { EmailService, escapeEmailHtml } = require('./emailService');
const Rbac = require('../middlewares/rbacMiddleware');
const Requisitions = require('./requisitionService');
const pdfParse = require('pdf-parse');

const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'data', 'cv_uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

class CandidatePortalService {
  constructor(db) {
    this.db = db;
    this.emailService = new EmailService(db);
    this.requisitions = new Requisitions(db);
    this.rbac = new Rbac(db);
    ensureUploadsDir();
  }

  // S4-05: Map internal stages to exactly 4 generic public statuses
  static mapPublicStatus(internalStage) {
    switch (internalStage) {
      case 'NEW':
      case 'APPLIED':
        return { code: 'RECEIVED', label: 'Đã nhận hồ sơ' };
      case 'SCREENING':
        return { code: 'IN_REVIEW', label: 'Đang xem xét' };
      case 'INTERVIEW':
        return { code: 'INTERVIEWING', label: 'Mời phỏng vấn' };
      case 'WITHDRAWN':
        return { code: 'WITHDRAWN', label: 'Ứng viên đã rút hồ sơ' };
      case 'OFFER':
      case 'HIRED':
      case 'REJECTED':
      default:
        return { code: 'CLOSED', label: 'Kết thúc quá trình xét duyệt' };
    }
  }

  // Anti-spam IP rate limiting: max 5 requests per hour per action
  async checkRateLimit(ipAddress, action = 'APPLY', maxAttempts = 5) {
    if (!ipAddress) return { allowed: true };
    return this.db.transaction(async () => {
    if (this.db.provider === 'postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('application-rate:'+action+':'+ipAddress);
    const cutoff = this.db.provider === 'postgres'
      ? "NOW() - INTERVAL '1 hour'"
      : "datetime('now', '-1 hour')";

    const sql = `SELECT COUNT(*) AS count FROM application_rate_limits WHERE ip_address = ? AND action = ? AND attempt_time >= ${cutoff}`;
    const row = await this.db.prepare(sql).get(ipAddress, action);
    const count = Number(row?.count || 0);

    if (count >= maxAttempts) {
      return {
        allowed: false,
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Bạn đã thực hiện quá số lần cho phép trong 1 giờ. Vui lòng thử lại sau.'
      };
    }

    const id = 'arl-' + crypto.randomUUID();
    const insertSql = this.db.provider === 'postgres'
      ? 'INSERT INTO application_rate_limits(id, ip_address, action, attempt_time) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      : "INSERT INTO application_rate_limits(id, ip_address, action, attempt_time) VALUES (?, ?, ?, datetime('now'))";
    await this.db.prepare(insertSql).run(id, ipAddress, action);

    return { allowed: true };
    });
  }

  // Validate CV file buffer, magic numbers, MIME type, size <= 10MB
  async validateCvFile(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || typeof file.filename !== 'string' || !file.filename) {
      return { success: false, statusCode: 400, code: 'CV_FILE_REQUIRED', message: 'Tệp CV là bắt buộc.' };
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.buffer.length > MAX_SIZE) {
      return { success: false, statusCode: 413, code: 'CV_FILE_TOO_LARGE', message: 'Tệp CV vượt quá dung lượng tối đa 10MB.' };
    }

    const ext = path.extname(file.filename).toLowerCase();
    if (!['.pdf', '.docx'].includes(ext)) {
      return { success: false, statusCode: 400, code: 'CV_FILE_INVALID_EXTENSION', message: 'Chỉ chấp nhận tệp CV định dạng PDF hoặc DOCX.' };
    }

    const buf = file.buffer;
    let mimeType = file.mimeType || '';

    // Validate magic numbers
    if (ext === '.pdf') {
      const isPdfMagic = buf.subarray(0, 5).toString('ascii') === '%PDF-';
      if (!isPdfMagic) {
        return { success: false, statusCode: 400, code: 'CV_FILE_INVALID_SIGNATURE', message: 'Tệp PDF không hợp lệ hoặc bị hỏng.' };
      }
      mimeType = 'application/pdf';
    } else if (ext === '.docx') {
      const isZipMagic = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04; // PK\x03\x04
      if (!isZipMagic) {
        return { success: false, statusCode: 400, code: 'CV_FILE_INVALID_SIGNATURE', message: 'Tệp DOCX không hợp lệ hoặc bị hỏng.' };
      }
      try {
        const JSZip = require(require.resolve('jszip', {paths:[path.dirname(require.resolve('exceljs'))]}));
        const zip = await JSZip.loadAsync(buf);
        if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) return {success:false,statusCode:400,code:'CV_FILE_INVALID_SIGNATURE',message:'Tệp DOCX không hợp lệ hoặc bị hỏng.'};
      } catch { return {success:false,statusCode:400,code:'CV_FILE_INVALID_SIGNATURE',message:'Tệp DOCX không hợp lệ hoặc bị hỏng.'}; }
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }

    return { success: true, ext, mimeType };
  }

  // S4-03: Submit public job application with CV
  async submitApplication(data, cvFileOrIp = null, ipAddress = null) {
    let cvFile = null;
    let clientIp = null;
    if (cvFileOrIp && typeof cvFileOrIp === 'object' && (cvFileOrIp.buffer || cvFileOrIp.filename)) {
      cvFile = cvFileOrIp;
      clientIp = typeof ipAddress === 'string' ? ipAddress : null;
    } else if (typeof cvFileOrIp === 'string') {
      clientIp = cvFileOrIp;
      cvFile = data?.cvFile || null;
    } else {
      clientIp = ipAddress;
      cvFile = data?.cvFile || null;
    }
    data.cvFile = cvFile;

    // 1. Anti-spam honeypot
    if (data.website || data.hp_field || data.honeypot) {
      return { success: false, statusCode: 400, code: 'SPAM_DETECTED', message: 'Yêu cầu không hợp lệ.' };
    }

    // 2. IP Rate limit
    const rateCheck = await this.checkRateLimit(clientIp, 'APPLY', 5);
    if (!rateCheck.allowed) return rateCheck;

    // 3. Validation
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    const jobPostingId = typeof data.jobPostingId === 'string' ? data.jobPostingId.trim() : '';
    const coverLetter = typeof data.coverLetter === 'string' ? data.coverLetter.trim() : '';

    if (!fullName || fullName.length < 2 || fullName.length > 100) {
      return { success: false, statusCode: 400, code: 'INVALID_FULL_NAME', message: 'Họ và tên bắt buộc từ 2 đến 100 ký tự.' };
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, statusCode: 400, code: 'INVALID_EMAIL', message: 'Email không đúng định dạng.' };
    }
    if (!phoneNumber || !/^(?:0|\+84)(?:3|5|7|8|9)\d{8}$/.test(phoneNumber)) {
      return { success: false, statusCode: 400, code: 'INVALID_PHONE_NUMBER', message: 'Số điện thoại Việt Nam không hợp lệ.' };
    }
    if (!jobPostingId) {
      return { success: false, statusCode: 400, code: 'JOB_POSTING_REQUIRED', message: 'Mã tin tuyển dụng là bắt buộc.' };
    }

    // 4. Validate CV file
    const fileValidation = await this.validateCvFile(data.cvFile);
    if (!fileValidation.success) return fileValidation;

    // 5. Check Job Posting & Requisition State
    const today = this.requisitions.businessDate();
    const posting = await this.db.prepare(
      `SELECT p.id, p.title, p.requisition_id, p.status, p.application_deadline, r.status AS req_status, r.department_name, r.recruiter_id
       FROM job_postings p
       JOIN requisitions r ON r.id = p.requisition_id
       WHERE p.id = ?`
    ).get(jobPostingId);

    if (!posting || posting.status !== 'PUBLISHED' || !['OPEN', 'IN_PROGRESS'].includes(posting.req_status)) {
      return { success: false, statusCode: 409, code: 'JOB_POSTING_CLOSED', message: 'Tin tuyển dụng hiện không công khai hoặc đã đóng.' };
    }
    if (posting.application_deadline && posting.application_deadline < today) {
      return { success: false, statusCode: 409, code: 'JOB_POSTING_EXPIRED', message: 'Tin tuyển dụng đã quá hạn nộp hồ sơ.' };
    }

    const requisitionId = posting.requisition_id;

    // 6. Check duplicate application for same position + email
    const duplicate = await this.db.prepare(
      `SELECT id, stage FROM candidates WHERE requisition_id = ? AND LOWER(email) = ? AND stage <> 'WITHDRAWN'`
    ).get(requisitionId, email);

    if (duplicate) {
      return {
        success: false,
        statusCode: 409,
        code: 'APPLICATION_DUPLICATE_JOB',
        message: 'Email này đã nộp hồ sơ ứng tuyển vào vị trí này. Vui lòng tra cứu trạng thái hoặc sử dụng email khác.'
      };
    }

    // 7. Generate secure tokens & paths
    const candidateId = 'cand-' + crypto.randomUUID();
    const trackingCode = 'TRK-' + new Date().getFullYear() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const withdrawToken = crypto.randomBytes(32).toString('hex');
    const withdrawTokenHash = crypto.createHash('sha256').update(withdrawToken).digest('hex');

    const storageFileName = 'cv-' + candidateId + fileValidation.ext;
    const storagePath = path.join(UPLOADS_DIR, storageFileName);
    fs.writeFileSync(storagePath, data.cvFile.buffer, {flag:'wx'});

    const fileHash = crypto.createHash('sha256').update(data.cvFile.buffer).digest('hex');
    const docId = 'doc-' + crypto.randomUUID();

    // 8. Transactional persistence
    try {
    await this.db.transaction(async () => {
      if (this.db.provider === 'postgres') {
        await this.db.prepare('SELECT id FROM requisitions WHERE id=? FOR SHARE').get(requisitionId);
        await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('application:'+requisitionId+':'+email);
      }
      const latest = await this.db.prepare('SELECT p.status,p.application_deadline,r.status AS req_status FROM job_postings p JOIN requisitions r ON r.id=p.requisition_id WHERE p.id=?'+(this.db.provider==='postgres'?' FOR SHARE OF p':'')).get(jobPostingId);
      if (!latest || latest.status!=='PUBLISHED' || !['OPEN','IN_PROGRESS'].includes(latest.req_status) || latest.application_deadline && latest.application_deadline<this.requisitions.businessDate()) throw Object.assign(new Error('Tin tuyển dụng hiện không nhận hồ sơ.'),{statusCode:409,code:'JOB_POSTING_CLOSED'});
      const duplicate = await this.db.prepare("SELECT id FROM candidates WHERE requisition_id=? AND LOWER(email)=? AND stage<>'WITHDRAWN'").get(requisitionId,email);
      if (duplicate) throw Object.assign(new Error('Email này đã nộp hồ sơ ứng tuyển vào vị trí này.'),{statusCode:409,code:'APPLICATION_DUPLICATE_JOB'});
      // Insert Candidate
      const candidateSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidates (
             id, full_name, email, phone_number, requisition_id, job_posting_id,
             stage, cover_letter, tracking_code, withdraw_token_hash, source_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidates (
             id, full_name, email, phone_number, requisition_id, job_posting_id,
             stage, cover_letter, tracking_code, withdraw_token_hash, source_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, datetime('now'))`;

      await this.db.prepare(candidateSql).run(
        candidateId, fullName, email, phoneNumber, requisitionId, jobPostingId,
        coverLetter, trackingCode, withdrawTokenHash, data.sourceId || null
      );

      // Insert Document metadata
      const docSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidate_documents (
             id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, document_type, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CV', CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_documents (
             id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, document_type, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CV', datetime('now'))`;

      await this.db.prepare(docSql).run(
        docId, candidateId, data.cvFile.filename, storageFileName, fileValidation.mimeType,
        data.cvFile.buffer.length, fileHash
      );

      // Insert Status History
      const histSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidate_status_history (
             id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at
           ) VALUES (?, ?, NULL, 'NEW', NULL, 'Ứng viên', 'APPLY', 'Ứng tuyển qua cổng công khai', CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_status_history (
             id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at
           ) VALUES (?, ?, NULL, 'NEW', NULL, 'Ứng viên', 'APPLY', 'Ứng tuyển qua cổng công khai', datetime('now'))`;

      await this.db.prepare(histSql).run('csh-' + crypto.randomUUID(), candidateId);

      // Insert tracking token record
      const attSql = this.db.provider === 'postgres'
        ? `INSERT INTO application_tracking_tokens (id, candidate_id, token_hash, token_type, created_at)
           VALUES (?, ?, ?, 'WITHDRAW', CURRENT_TIMESTAMP)`
        : `INSERT INTO application_tracking_tokens (id, candidate_id, token_hash, token_type, created_at)
           VALUES (?, ?, ?, 'WITHDRAW', datetime('now'))`;
      await this.db.prepare(attSql).run('att-' + crypto.randomUUID(), candidateId, withdrawTokenHash);
    });
    } catch (error) {
      fs.unlinkSync(storagePath);
      if (['APPLICATION_DUPLICATE_JOB','JOB_POSTING_CLOSED'].includes(error.code)) return {success:false,statusCode:409,code:error.code,message:error.message};
      throw error;
    }

    // 9. Send Confirmation Email (Safe with Fallback)
    const trackingUrl = `${config.APP_URL}/careers/jobs?trackingCode=${encodeURIComponent(trackingCode)}&email=${encodeURIComponent(email)}`;
    const withdrawUrl = `${config.APP_URL}/careers/jobs?action=withdraw&token=${encodeURIComponent(withdrawToken)}`;

    try {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2563eb;">Xác nhận nộp hồ sơ ứng tuyển thành công</h2>
          <p>Chào <strong>${escapeEmailHtml(fullName)}</strong>,</p>
          <p>Cảm ơn bạn đã ứng tuyển vị trí <strong>${escapeEmailHtml(posting.title)}</strong> tại phòng ban <strong>${escapeEmailHtml(posting.department_name)}</strong>.</p>
          <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0 0 8px 0;">Mã tra cứu hồ sơ của bạn:</p>
            <p style="font-size: 20px; font-weight: bold; color: #0f172a; letter-spacing: 2px; margin: 0;">${trackingCode}</p>
          </div>
          <p>Bạn có thể theo dõi tiến độ hồ sơ tại: <a href="${trackingUrl}">${trackingUrl}</a></p>
          <p style="margin-top: 24px; font-size: 13px; color: #64748b;">Nếu có nhu cầu rút hồ sơ, bạn có thể thực hiện tại: <a href="${withdrawUrl}">Rút hồ sơ ứng tuyển</a></p>
        </div>
      `;

      await this.emailService.sendMail({
        to: email,
        subject: `[ATS] Xác nhận hồ sơ ứng tuyển vị trí ${posting.title} (${trackingCode})`,
        html: emailHtml,
        text: `Chào ${fullName}, bạn đã ứng tuyển thành công vị trí ${posting.title}. Mã tra cứu: ${trackingCode}. Tra cứu tại: ${trackingUrl}`,
        templateName: 'APPLICATION_CONFIRMATION'
      });
    } catch (emailErr) {
      console.warn('[CandidatePortalService] Email confirmation failed, continuing:', emailErr.message);
    }

    return {
      success: true,
      statusCode: 201,
      message: 'Nộp hồ sơ ứng tuyển thành công.',
      data: {
        candidateId,
        trackingCode,
        withdrawToken,
        fullName,
        email,
        jobTitle: posting.title,
        departmentName: posting.department_name
      }
    };
  }

  // S4-05: Lookup application status (generic 4 states, secure against probing)
  async lookupStatus(trackingCodeOrData, emailOrIp = null, ipAddress = null) {
    let trackingCode = null;
    let email = null;
    let clientIp = null;
    if (trackingCodeOrData && typeof trackingCodeOrData === 'object') {
      trackingCode = trackingCodeOrData.trackingCode;
      email = trackingCodeOrData.email;
      clientIp = emailOrIp;
    } else {
      trackingCode = trackingCodeOrData;
      email = emailOrIp;
      clientIp = ipAddress;
    }

    const rateCheck = await this.checkRateLimit(clientIp, 'LOOKUP', 10);
    if (!rateCheck.allowed) return rateCheck;

    if (!trackingCode || typeof trackingCode !== 'string' || !email || typeof email !== 'string') {
      return { success: false, statusCode: 400, code: 'INVALID_CREDENTIALS', message: 'Vui lòng nhập đầy đủ mã tra cứu và email.' };
    }

    const row = await this.db.prepare(
      `SELECT c.id, c.full_name, c.email, c.stage, c.created_at, c.withdrawn_at, r.title AS job_title, r.department_name
       FROM candidates c
       LEFT JOIN requisitions r ON r.id = c.requisition_id
       WHERE c.tracking_code = ? AND LOWER(c.email) = ?`
    ).get(trackingCode.trim().toUpperCase(), email.trim().toLowerCase());

    if (!row) {
      return {
        success: false,
        statusCode: 404,
        code: 'LOOKUP_INVALID_CREDENTIALS',
        message: 'Mã tra cứu hoặc email không khớp. Vui lòng kiểm tra lại.'
      };
    }

    const publicStatus = CandidatePortalService.mapPublicStatus(row.stage);

    return {
      success: true,
      statusCode: 200,
      data: {
        trackingCode: trackingCode.trim().toUpperCase(),
        candidateName: row.full_name,
        jobTitle: row.job_title || 'Vị trí tuyển dụng',
        departmentName: row.department_name || '',
        appliedAt: row.created_at,
        withdrawnAt: row.withdrawn_at || null,
        status: publicStatus.code,
        statusCode: publicStatus.code,
        statusLabel: publicStatus.label
      }
    };
  }

  // S4-06: Candidate withdraws application via secure token
  async withdrawApplication(tokenOrData, reason = '') {
    let token = null;
    let withdrawReason = reason;
    if (tokenOrData && typeof tokenOrData === 'object') {
      token = tokenOrData.withdrawToken || tokenOrData.token;
      withdrawReason = tokenOrData.reason || reason;
    } else {
      token = tokenOrData;
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      return { success: false, statusCode: 400, code: 'TOKEN_REQUIRED', message: 'Mã xác thực rút hồ sơ là bắt buộc.' };
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const candidate = await this.db.prepare(
      `SELECT c.id, c.full_name, c.email, c.stage, c.requisition_id, r.title AS job_title, r.recruiter_id, u.email AS recruiter_email
       FROM candidates c
       LEFT JOIN requisitions r ON r.id = c.requisition_id
       LEFT JOIN users u ON u.id = r.recruiter_id
       WHERE c.withdraw_token_hash = ?
          OR c.id IN (SELECT candidate_id FROM application_tracking_tokens WHERE token_hash = ?)`
    ).get(tokenHash, tokenHash);

    if (!candidate) {
      return {
        success: false,
        statusCode: 404,
        code: 'INVALID_WITHDRAW_TOKEN',
        message: 'Liên kết rút hồ sơ không hợp lệ hoặc đã được sử dụng.'
      };
    }

    if (candidate.stage === 'WITHDRAWN') {
      return { success: false, statusCode: 409, code: 'ALREADY_WITHDRAWN', message: 'Hồ sơ này đã được rút trước đó.' };
    }

    const beforeStage = candidate.stage;

    await this.db.transaction(async () => {
      const updateSql = this.db.provider === 'postgres'
        ? `UPDATE candidates
           SET stage = 'WITHDRAWN', withdrawn_at = CURRENT_TIMESTAMP, withdrawn_reason = ?, withdraw_token_hash = NULL
           WHERE id = ?`
        : `UPDATE candidates
           SET stage = 'WITHDRAWN', withdrawn_at = datetime('now'), withdrawn_reason = ?, withdraw_token_hash = NULL
           WHERE id = ?`;

      await this.db.prepare(updateSql).run(withdrawReason || 'Ứng viên chủ động rút qua email', candidate.id);
      await this.db.prepare("DELETE FROM application_tracking_tokens WHERE candidate_id = ?").run(candidate.id);

      const histSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidate_status_history (
             id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, reason, created_at
           ) VALUES (?, ?, ?, 'WITHDRAWN', NULL, 'Ứng viên', 'WITHDRAW', ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_status_history (
             id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, reason, created_at
           ) VALUES (?, ?, ?, 'WITHDRAWN', NULL, 'Ứng viên', 'WITHDRAW', ?, datetime('now'))`;

      await this.db.prepare(histSql).run('csh-' + crypto.randomUUID(), candidate.id, beforeStage, withdrawReason || null);
    });

    // Notify recruiter if assigned
    if (candidate.recruiter_email) {
      try {
        await this.emailService.sendMail({
          to: candidate.recruiter_email,
          subject: `[ATS Thông báo] Ứng viên ${candidate.full_name} đã rút hồ sơ vị trí ${candidate.job_title}`,
          html: `<p>Ứng viên <strong>${escapeEmailHtml(candidate.full_name)}</strong> (${escapeEmailHtml(candidate.email)}) đã rút hồ sơ vị trí <strong>${escapeEmailHtml(candidate.job_title)}</strong>.</p><p>Lý do: ${escapeEmailHtml(withdrawReason || 'Không cung cấp')}</p>`,
          text: `Ứng viên ${candidate.full_name} đã rút hồ sơ vị trí ${candidate.job_title}.`,
          templateName: 'CANDIDATE_WITHDRAW_NOTIFICATION'
        });
      } catch (err) {
        console.warn('[CandidatePortalService] Notify recruiter failed:', err.message);
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Đã rút hồ sơ ứng tuyển thành công.',
      data: { candidateId: candidate.id, fullName: candidate.full_name, stage: 'WITHDRAWN' }
    };
  }

  // S4-07: Internal employee referral
  async referCandidate(data, cvFileOrUser = null, currentUser = null) {
    let cvFile = null;
    let user = null;
    if (currentUser) {
      cvFile = cvFileOrUser;
      user = currentUser;
    } else if (cvFileOrUser && typeof cvFileOrUser === 'object' && cvFileOrUser.id) {
      user = cvFileOrUser;
      cvFile = data?.cvFile || null;
    } else {
      user = currentUser;
      cvFile = data?.cvFile || null;
    }
    if (!user || !user.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    user = typeof user.id === 'string'
      ? await this.rbac.getAuthorizedActor(user.id, 'candidate.refer') : null;
    if (!user) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền giới thiệu ứng viên.' };
    }
    data = { ...(data || {}), cvFile };

    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    const requisitionId = typeof data.requisitionId === 'string' ? data.requisitionId.trim() : '';
    const referralNotes = typeof data.referralNotes === 'string' ? data.referralNotes.trim() : (typeof data.notes === 'string' ? data.notes.trim() : '');

    if (!fullName || !email || !phoneNumber || !requisitionId) {
      return { success: false, statusCode: 400, code: 'INVALID_FIELDS', message: 'Vui lòng điền đầy đủ họ tên, email, số điện thoại và chọn vị trí tuyển dụng.' };
    }

    // Verify requisition is accepting
    const req = await this.db.prepare(
      `SELECT id, title, department_name, status FROM requisitions WHERE id = ?`
    ).get(requisitionId);

    if (!req || !['OPEN', 'IN_PROGRESS'].includes(req.status)) {
      return { success: false, statusCode: 409, code: 'REQUISITION_NOT_OPEN', message: 'Vị trí này hiện không mở nhận ứng viên.' };
    }

    // Check duplicate
    const duplicate = await this.db.prepare(
      `SELECT id FROM candidates WHERE requisition_id = ? AND LOWER(email) = ? AND stage <> 'WITHDRAWN'`
    ).get(requisitionId, email);

    if (duplicate) {
      return { success: false, statusCode: 409, code: 'DUPLICATE_CANDIDATE', message: 'Ứng viên với email này đã có trong danh sách tuyển dụng của vị trí.' };
    }

    // Handle CV file if attached
    let docId = null;
    let storageFileName = null;
    if (data.cvFile) {
      const fileVal = await this.validateCvFile(data.cvFile);
      if (!fileVal.success) return fileVal;
      storageFileName = 'cv-ref-' + crypto.randomUUID() + fileVal.ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, storageFileName), data.cvFile.buffer, {flag:'wx'});
      docId = 'doc-' + crypto.randomUUID();
    }

    const candidateId = 'cand-' + crypto.randomUUID();
    const trackingCode = 'TRK-REF-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    try {
    await this.db.transaction(async () => {
      const fresh = await this.rbac.getAuthorizedActor(user.id,'candidate.refer');
      if (!fresh) throw Object.assign(new Error('Bạn không có quyền giới thiệu ứng viên.'),{statusCode:403,code:'FORBIDDEN'});
      user = fresh;
      const latest = await this.db.prepare('SELECT status FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(requisitionId);
      if (!latest || !['OPEN','IN_PROGRESS'].includes(latest.status)) throw Object.assign(new Error('Vị trí này hiện không mở nhận ứng viên.'),{statusCode:409,code:'REQUISITION_NOT_OPEN'});
      if (this.db.provider==='postgres') await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('application:'+requisitionId+':'+email);
      if (await this.db.prepare("SELECT id FROM candidates WHERE requisition_id=? AND LOWER(email)=? AND stage<>'WITHDRAWN'").get(requisitionId,email)) throw Object.assign(new Error('Ứng viên với email này đã có trong danh sách tuyển dụng của vị trí.'),{statusCode:409,code:'DUPLICATE_CANDIDATE'});
      const insertSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidates (
             id, full_name, email, phone_number, requisition_id, stage,
             tracking_code, referrer_id, referrer_name, referral_notes, is_internal_referral, created_at
           ) VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidates (
             id, full_name, email, phone_number, requisition_id, stage,
             tracking_code, referrer_id, referrer_name, referral_notes, is_internal_referral, created_at
           ) VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, 1, datetime('now'))`;

      await this.db.prepare(insertSql).run(
        candidateId, fullName, email, phoneNumber, requisitionId,
        trackingCode, user.id, user.fullName || user.email, referralNotes
      );

      if (docId && data.cvFile) {
        const fileHash = crypto.createHash('sha256').update(data.cvFile.buffer).digest('hex');
        const docSql = this.db.provider === 'postgres'
          ? `INSERT INTO candidate_documents (id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, document_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'CV', CURRENT_TIMESTAMP)`
          : `INSERT INTO candidate_documents (id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, document_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'CV', datetime('now'))`;

        await this.db.prepare(docSql).run(
          docId, candidateId, data.cvFile.filename, storageFileName,
          data.cvFile.mimeType || 'application/pdf', data.cvFile.buffer.length, fileHash
        );
      }

      const histSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at)
           VALUES (?, ?, NULL, 'NEW', ?, ?, 'INTERNAL_REFERRAL', ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_status_history (id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at)
           VALUES (?, ?, NULL, 'NEW', ?, ?, 'INTERNAL_REFERRAL', ?, datetime('now'))`;

      await this.db.prepare(histSql).run(
        'csh-' + crypto.randomUUID(), candidateId, user.id,
        user.fullName || user.id, referralNotes
      );
    });
    } catch (error) {
      if (storageFileName) fs.unlinkSync(path.join(UPLOADS_DIR,storageFileName));
      if (['FORBIDDEN','REQUISITION_NOT_OPEN','DUPLICATE_CANDIDATE'].includes(error.code)) return {success:false,statusCode:error.statusCode,code:error.code,message:error.message};
      throw error;
    }

    return {
      success: true,
      statusCode: 201,
      message: 'Giới thiệu ứng viên thành công.',
      data: {
        candidateId,
        trackingCode,
        fullName,
        email,
        jobTitle: req.title,
        isInternalReferral: true,
        referrerId: user.id,
        referrerName: user.fullName || user.email
      }
    };
  }

  // Get referrals submitted by currentUser (high-level view only)
  async getMyReferrals(currentUser) {
    if (!currentUser || !currentUser.id) return [];

    const rows = await this.db.prepare(
      `SELECT c.id, c.full_name, c.email, c.stage, c.created_at, r.title AS job_title, r.department_name
       FROM candidates c
       JOIN requisitions r ON r.id = c.requisition_id
       WHERE c.referrer_id = ?
       ORDER BY c.created_at DESC`
    ).all(currentUser.id);

    return rows.map(row => ({
      id: row.id,
      fullName: row.full_name,
      candidateName: row.full_name,
      email: row.email,
      candidateEmail: row.email,
      jobTitle: row.job_title,
      departmentName: row.department_name,
      createdAt: row.created_at,
      status: CandidatePortalService.mapPublicStatus(row.stage).label
    }));
  }

  // S4-04: Parse CV PDF text for Recruiter (non-destructive)
  async parseCvPdf(candidateId, documentIdOrUser = null, currentUser = null) {
    let documentId = null;
    let user = null;
    if (currentUser) {
      documentId = documentIdOrUser;
      user = currentUser;
    } else if (documentIdOrUser && typeof documentIdOrUser === 'object' && documentIdOrUser.id) {
      user = documentIdOrUser;
      documentId = null;
    } else {
      user = currentUser;
    }

    if (!user) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const authorize = async (lock = false) => {
      const actor = await this.rbac.getAuthorizedActor(user.id, 'candidate.cv.parse');
      if (!actor || !actor.roles.some(role => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role))) {
        return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền trích xuất CV.' };
      }
      const candidate = await this.db.prepare('SELECT id,requisition_id FROM candidates WHERE id=?' + (lock && this.db.provider === 'postgres' ? ' FOR SHARE' : '')).get(candidateId);
      if (!candidate) return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' };
      if (!actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) && !await this.requisitions.recruiterAssigned(candidate.requisition_id, actor.id)) {
        return { success: false, statusCode: 403, code: 'CANDIDATE_OUT_OF_SCOPE', message: 'Hồ sơ ứng viên không thuộc vị trí bạn được phân công.' };
      }
      return { success: true, candidate };
    };
    const access = await authorize();
    if (!access.success) return access;

    const doc = documentId
      ? await this.db.prepare(
          `SELECT id, candidate_id, file_name, storage_path, file_hash, mime_type, parsed_text, parsed_data_json
           FROM candidate_documents
           WHERE id = ? AND candidate_id = ? AND document_type = 'CV'`
        ).get(documentId, candidateId)
      : await this.db.prepare(
          `SELECT id, candidate_id, file_name, storage_path, file_hash, mime_type, parsed_text, parsed_data_json
           FROM candidate_documents
           WHERE candidate_id = ? AND document_type = 'CV'
           ORDER BY created_at DESC LIMIT 1`
        ).get(candidateId);

    if (!doc) {
      return { success: false, statusCode: 404, code: 'CV_NOT_FOUND', message: 'Không tìm thấy tệp CV của ứng viên này.' };
    }

    let filePath;
    try {
      if (typeof doc.storage_path !== 'string' || !doc.storage_path || path.isAbsolute(doc.storage_path)) throw new Error('INVALID_CV_PATH');
      const root = fs.realpathSync(UPLOADS_DIR);
      const requested = path.resolve(UPLOADS_DIR, doc.storage_path);
      const relative = path.relative(UPLOADS_DIR, requested);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('INVALID_CV_PATH');
      filePath = fs.realpathSync(requested);
      const canonicalRelative = path.relative(root, filePath);
      if (!canonicalRelative || canonicalRelative === '..' || canonicalRelative.startsWith('..' + path.sep) || path.isAbsolute(canonicalRelative)) throw new Error('INVALID_CV_PATH');
    } catch {
      return { success: false, statusCode: 404, code: 'CV_FILE_NOT_FOUND', message: 'Tệp CV không tồn tại trên hệ thống lưu trữ.' };
    }

    let buffer;
    try { buffer = fs.readFileSync(filePath); } catch {
      return { success: false, statusCode: 404, code: 'CV_FILE_NOT_FOUND', message: 'Tệp CV không tồn tại trên hệ thống lưu trữ.' };
    }
    if (doc.file_hash && crypto.createHash('sha256').update(buffer).digest('hex') !== doc.file_hash) {
      return { success: false, statusCode: 409, code: 'CV_DOCUMENT_CHANGED', message: 'Tệp CV đã thay đổi. Vui lòng tải lại hồ sơ.' };
    }
    let extractedText = '';

    try {
      if (doc.mime_type === 'application/pdf' || filePath.endsWith('.pdf')) {
        try {
          if (typeof pdfParse === 'function') {
            const parsed = await pdfParse(buffer);
            extractedText = parsed.text || '';
          } else if (pdfParse?.PDFParse) {
            const parser = new pdfParse.PDFParse({ data: buffer });
            try {
              const result = await parser.getText();
              extractedText = result?.text || '';
            } finally { if (typeof parser.destroy === 'function') await parser.destroy(); }
          }
        } catch {
          // Library may throw on minimal/handcrafted or unusual PDFs
        }

        if (!extractedText || !extractedText.trim()) {
          const rawStr = buffer.toString('utf8');
          const streams = [...rawStr.matchAll(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g)].map(x => x[1]).join('\n');
          if (streams.trim()) {
            extractedText = streams;
          } else {
            const textBlocks = [...rawStr.matchAll(/\(([^()]+)\)/g)].map(x => x[1]).join(' ');
            if (textBlocks.trim()) extractedText = textBlocks;
          }
        }
      }
    } catch (parseErr) {
      return {
        success: false,
        statusCode: 422,
        code: 'PDF_PARSE_FAILED',
        message: 'Không thể đọc văn bản từ tệp PDF (có thể là dạng scan hoặc được mã hóa). Bạn có thể xem CV và nhập thủ công.'
      };
    }

    if (!extractedText.trim()) {
      return {
        success: false,
        statusCode: 422,
        code: 'NO_TEXT_FOUND',
        message: 'Không tìm thấy văn bản trong tệp CV này (CV có thể là ảnh scan). Bạn có thể xem CV và nhập thủ công.'
      };
    }

    // Regex extraction
    const emailMatch = extractedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = extractedText.match(/(?:(?:\+?84|0)[3|5|7|8|9]\d{8})/);

    // Heuristic for name: Look at non-empty lines near top
    const lines = extractedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let candidateName = '';
    for (const line of lines.slice(0, 10)) {
      if (line.length >= 3 && line.length <= 40 && !line.includes('@') && !/\d{4}/.test(line) && !/^(curriculum|vitae|resume|cv|hồ sơ|thông tin)/i.test(line)) {
        candidateName = line;
        break;
      }
    }

    const parsedData = {
      fullName: candidateName || null,
      email: emailMatch ? emailMatch[0] : null,
      phoneNumber: phoneMatch ? phoneMatch[0] : null
    };

    // Update document record with parsed data (never auto-overwriting candidate table!)
    const saved = await this.db.transaction(async () => {
      const currentAccess = await authorize(true);
      if (!currentAccess.success) return currentAccess;
      const current = await this.db.prepare("SELECT id,candidate_id,storage_path,file_hash FROM candidate_documents WHERE id=? AND candidate_id=? AND document_type='CV'" + (this.db.provider === 'postgres' ? ' FOR UPDATE' : '')).get(doc.id, candidateId);
      if (!current || current.candidate_id !== doc.candidate_id || current.storage_path !== doc.storage_path || current.file_hash !== doc.file_hash || currentAccess.candidate.requisition_id !== access.candidate.requisition_id) {
        return { success: false, statusCode: 409, code: 'CV_DOCUMENT_CHANGED', message: 'Tệp CV hoặc hồ sơ đã thay đổi. Vui lòng tải lại hồ sơ.' };
      }
      const result = await this.db.prepare(
        `UPDATE candidate_documents SET parsed_text = ?, parsed_data_json = ? WHERE id = ? AND candidate_id = ?`
      ).run(extractedText.slice(0, 5000), JSON.stringify(parsedData), doc.id, candidateId);
      if (result.changes !== 1) throw new Error('CV_PARSE_SAVE_FAILED');
      return { success: true };
    });
    if (!saved.success) return saved;

    return {
      success: true,
      statusCode: 200,
      message: 'Trích xuất thông tin CV thành công.',
      data: parsedData,
      parsedData
    };
  }

  // S4-08: Expire overdue jobs daily task
  async expireOverdueJobs(currentUser) {
    const denied = { success: false, statusCode: 403, code: 'GLOBAL_JOB_EXPIRY_FORBIDDEN', message: 'Bạn không có quyền thực hiện tác vụ hết hạn tin toàn hệ thống.' };
    if (!currentUser || typeof currentUser.id !== 'string' || !currentUser.id) return denied;
    const actorId = currentUser.id;
    return this.db.transaction(async () => {
      const actor = await this.rbac.getAuthorizedActor(actorId, 'job_posting.manage');
      if (!actor || !actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) return denied;
      const today = this.requisitions.businessDate();
      const rows = await this.db.prepare(
        `SELECT id, title, version, content_version, application_deadline
         FROM job_postings
         WHERE status = 'PUBLISHED' AND application_deadline < ?
         ORDER BY id${this.db.provider === 'postgres' ? ' FOR UPDATE' : ''}`
      ).all(today);
      const expiredJobs = [];
      for (const job of rows) {
        const changed = await this.db.prepare(
          `UPDATE job_postings SET status = 'UNPUBLISHED', version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND status = 'PUBLISHED' AND version = ? AND application_deadline < ?`
        ).run(job.id, job.version, today);
        if (changed.changes !== 1) continue;
        await this.db.prepare(
          `INSERT INTO job_posting_publication_events (
            id, posting_id, event_version, content_version, action, before_status, after_status,
            actor_id, actor_name, reason, response_json, created_at
          ) VALUES (?, ?, ?, ?, 'AUTO_EXPIRE', 'PUBLISHED', 'UNPUBLISHED', ?, ?, ?, ?, datetime('now'))`
        ).run(
          'jpe-' + crypto.randomUUID(), job.id, job.version + 1, job.content_version,
          actor.id, actor.fullName || actor.id, 'Quá hạn nhận hồ sơ',
          JSON.stringify({ id: job.id, status: 'UNPUBLISHED', reason: 'Quá hạn nhận hồ sơ' })
        );
        expiredJobs.push({ id: job.id, title: job.title });
      }
      return { expiredCount: expiredJobs.length, expiredJobs };
    });
  }

  // S4-09: Unified Candidate Profile with strict IDOR RBAC
  async getUnifiedProfile(candidateId, currentUser) {
    if (!currentUser || !currentUser.id) {
      return { success: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const actor = await this.rbac.getAuthorizedActor(currentUser.id, 'candidate.read');
    if (!actor || !actor.roles.some(role => ['ADMIN', 'HR_MANAGER', 'APPROVER', 'RECRUITER', 'HIRING_MGR'].includes(role))) {
      return { success: false, statusCode: 403, code: 'CANDIDATE_OUT_OF_SCOPE', message: 'Bạn không có quyền xem hồ sơ hợp nhất này.' };
    }
    const visibility = this.requisitions.candidateVisibility({ ...actor, roles: actor.roles.filter(role => ['ADMIN', 'HR_MANAGER', 'APPROVER', 'RECRUITER', 'HIRING_MGR'].includes(role)) });
    const scopeSql = visibility ? ' AND ' + visibility.condition : '';
    const scopeParams = visibility ? visibility.params : [];

    const candidate = await this.db.prepare(
      `SELECT c.*, r.title AS requisition_title, r.department_name, r.recruiter_id, r.hiring_manager_id
       FROM candidates c
       LEFT JOIN requisitions r ON r.id = c.requisition_id
       WHERE c.id = ?${scopeSql}`
    ).get(candidateId, ...scopeParams);

    if (!candidate) {
      return { success: false, statusCode: 403, code: 'CANDIDATE_OUT_OF_SCOPE', message: 'Hồ sơ ứng viên không thuộc phạm vi truy cập của bạn.' };
    }

    // RBAC IDOR check: Recruiter must be assigned or Hiring Manager must manage requisition
    // Aggregate all applications by normalized email
    const allApplications = await this.db.prepare(
      `SELECT c.id, c.requisition_id, c.job_posting_id, c.stage, c.cover_letter, c.tracking_code,
              c.created_at, c.withdrawn_at, c.withdrawn_reason, c.is_internal_referral, c.referrer_name,
              r.code AS requisition_code, r.title AS requisition_title, r.department_name
       FROM candidates c
       LEFT JOIN requisitions r ON r.id = c.requisition_id
       WHERE LOWER(c.email) = ?${scopeSql}
       ORDER BY c.created_at DESC`
    ).all(candidate.email.toLowerCase(), ...scopeParams);

    const appIds = allApplications.map(a => a.id);
    if (!appIds.length) {
      return { success: false, statusCode: 403, code: 'CANDIDATE_OUT_OF_SCOPE', message: 'Hồ sơ ứng viên không thuộc phạm vi truy cập của bạn.' };
    }

    // Fetch documents
    const docs = await this.db.prepare(
      `SELECT id, candidate_id, file_name, storage_path, mime_type, file_size, document_type, parsed_data_json, created_at
       FROM candidate_documents
       WHERE candidate_id IN (${appIds.map(() => '?').join(',')})
       ORDER BY created_at DESC`
    ).all(...appIds);

    // Fetch tags
    const tags = await this.db.prepare(
      `SELECT id, candidate_id, tag_name, created_by, created_at
       FROM candidate_tags
       WHERE candidate_id IN (${appIds.map(() => '?').join(',')})
       ORDER BY created_at ASC`
    ).all(...appIds);

    // Fetch notes
    const notes = await this.db.prepare(
      `SELECT id, candidate_id, author_id, author_name, note_text, is_private, created_at
       FROM candidate_notes
       WHERE candidate_id IN (${appIds.map(() => '?').join(',')})
         AND (is_private = ${this.db.provider === 'postgres' ? 'FALSE' : '0'} OR author_id = ? OR ? = 1)
       ORDER BY created_at DESC`
    ).all(...appIds, actor.id, actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) ? 1 : 0);

    // Fetch status history
    const history = await this.db.prepare(
      `SELECT id, candidate_id, before_stage, after_stage, actor_name, action, reason, notes, created_at
       FROM candidate_status_history
       WHERE candidate_id IN (${appIds.map(() => '?').join(',')})
       ORDER BY created_at DESC`
    ).all(...appIds);

    return {
      success: true,
      statusCode: 200,
      data: {
        candidate: {
          id: candidate.id,
          fullName: candidate.full_name,
          email: candidate.email,
          phoneNumber: candidate.phone_number,
          currentCompany: candidate.current_company,
          experienceYears: candidate.experience_years,
          expectedSalary: candidate.expected_salary,
          sourceName: candidate.source_id,
          createdAt: candidate.created_at
        },
        applications: allApplications.map(app => ({
          id: app.id,
          requisitionId: app.requisition_id,
          requisitionCode: app.requisition_code,
          requisitionTitle: app.requisition_title,
          departmentName: app.department_name,
          stage: app.stage,
          trackingCode: app.tracking_code,
          coverLetter: app.cover_letter,
          isInternalReferral: Boolean(app.is_internal_referral),
          referrerName: app.referrer_name,
          withdrawnAt: app.withdrawn_at,
          withdrawnReason: app.withdrawn_reason,
          createdAt: app.created_at
        })),
        documents: docs.map(d => ({
          id: d.id,
          candidateId: d.candidate_id,
          fileName: d.file_name,
          mimeType: d.mime_type,
          fileSize: d.file_size,
          parsedData: d.parsed_data_json ? JSON.parse(d.parsed_data_json) : null,
          createdAt: d.created_at
        })),
        tags: tags.map(t => ({ id: t.id, candidateId: t.candidate_id, tagName: t.tag_name })),
        notes: notes.map(n => ({ id: n.id, candidateId: n.candidate_id, authorName: n.author_name, text: n.note_text, createdAt: n.created_at })),
        history: history.map(h => ({
          id: h.id,
          candidateId: h.candidate_id,
          beforeStage: h.before_stage,
          afterStage: h.after_stage,
          actorName: h.actor_name,
          action: h.action,
          reason: h.reason,
          createdAt: h.created_at
        }))
      }
    };
  }

  // Add internal note to candidate profile
  async candidateWriteAccess(candidateId, currentUser) {
    const actor = await this.rbac.getAuthorizedActor(currentUser?.id, 'candidate.update');
    if (!actor || !actor.roles.some(role => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role))) return { success: false, statusCode: 403, code: 'CANDIDATE_FORBIDDEN', message: 'Bạn không có quyền thao tác hồ sơ ứng viên.' };
    const row = await this.db.prepare('SELECT id FROM candidates WHERE id=?' + (this.db.provider === 'postgres' ? ' FOR SHARE' : '')).get(candidateId);
    if (!row) return { success: false, statusCode: 403, code: 'CANDIDATE_OUT_OF_SCOPE', message: 'Hồ sơ ứng viên không thuộc phạm vi thao tác của bạn.' };
    const access = await this.requisitions.candidateAccess(candidateId, actor, 'candidate.update');
    if (!access.success) return access;
    if (this.db.provider === 'postgres' && !access.actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) && config.REQUISITION_OPERATIONS_ENABLED === true) {
      await this.db.prepare('SELECT user_id FROM requisition_recruiter_supports WHERE requisition_id=? AND user_id=? FOR SHARE').get(access.row.requisition_id, access.actor.id);
      if (!await this.requisitions.recruiterAssigned(access.row.requisition_id, access.actor.id)) return { success: false, statusCode: 403, code: 'CANDIDATE_OUT_OF_SCOPE', message: 'Hồ sơ ứng viên không thuộc phạm vi thao tác của bạn.' };
    }
    return access;
  }

  async addNote(candidateId, noteText, currentUser) {
    if (!currentUser || !currentUser.id) return { success: false, statusCode: 401, message: 'Yêu cầu đăng nhập.' };
    if (!noteText || typeof noteText !== 'string' || !noteText.trim()) {
      return { success: false, statusCode: 400, message: 'Nội dung ghi chú không được để trống.' };
    }

    return this.db.transaction(async () => {
      const access = await this.candidateWriteAccess(candidateId, currentUser);
      if (!access.success) return access;
      const actor = access.actor;
      const noteId = 'cn-' + crypto.randomUUID();
      const insertSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidate_notes (id, candidate_id, author_id, author_name, note_text, created_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_notes (id, candidate_id, author_id, author_name, note_text, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`;

      await this.db.prepare(insertSql).run(
        noteId, candidateId, actor.id,
        actor.fullName || actor.id, noteText.trim()
      );

      return { success: true, statusCode: 201, message: 'Đã thêm ghi chú.', data: { id: noteId, noteText: noteText.trim() } };
    });
  }

  // Add tag to candidate profile
  async addTag(candidateId, tagName, currentUser) {
    if (!currentUser || !currentUser.id) return { success: false, statusCode: 401, message: 'Yêu cầu đăng nhập.' };
    if (!tagName || typeof tagName !== 'string' || !tagName.trim()) {
      return { success: false, statusCode: 400, message: 'Tên nhãn không được để trống.' };
    }

    return this.db.transaction(async () => {
      const access = await this.candidateWriteAccess(candidateId, currentUser);
      if (!access.success) return access;
      const tagId = 'ct-' + crypto.randomUUID();
      const insertSql = this.db.provider === 'postgres'
        ? `INSERT INTO candidate_tags (id, candidate_id, tag_name, created_by, created_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_tags (id, candidate_id, tag_name, created_by, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`;

      await this.db.prepare(insertSql).run(tagId, candidateId, tagName.trim(), access.actor.id);

      return { success: true, statusCode: 201, message: 'Đã thêm nhãn.', data: { id: tagId, tagName: tagName.trim() } };
    });
  }

  // Download CV document
  async getCvDocument(documentId, currentUser) {
    const denied = (statusCode = 404) => ({ success: false, statusCode, message: statusCode === 403 ? 'Bạn không có quyền tải tài liệu.' : 'Không tìm thấy tài liệu.' });
    if (!currentUser?.id) return denied(403);
    if (typeof documentId !== 'string' || !documentId || /[\x00-\x1f\x7f]/.test(documentId)) return { success: false, statusCode: 400, message: 'Mã tài liệu không hợp lệ.' };
    const actorId = currentUser.id;
    const lookup = async () => this.db.transaction(async () => {
      const actor = await this.rbac.getAuthorizedActor(actorId, 'candidate.read');
      if (!actor) return { failure: denied(403) };
      const scope = this.requisitions.candidateVisibility(actor);
      let document = await this.db.prepare(`SELECT d.*, c.requisition_id FROM candidate_documents d
        JOIN candidates c ON c.id=d.candidate_id LEFT JOIN requisitions r ON r.id=c.requisition_id
        WHERE d.id=? AND d.document_type='CV'${scope ? ' AND ' + scope.condition : ''}`).get(documentId, ...(scope?.params || []));
      if (!document && actor.roles?.includes('INTERVIEWER')) {
        let hasII = false;
        try {
          if (this.db.provider === 'postgres') {
            const row = await this.db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_interviewers'").get();
            hasII = Boolean(row);
          } else {
            const row = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_interviewers'").get();
            hasII = Boolean(row);
          }
        } catch { hasII = false; }
        if (hasII) {
          document = await this.db.prepare(`SELECT d.*, c.requisition_id FROM candidate_documents d
            JOIN candidates c ON c.id=d.candidate_id
            WHERE d.id=? AND d.document_type='CV'
              AND EXISTS (
                SELECT 1 FROM interviews i
                JOIN interview_interviewers ii ON ii.interview_id = i.id
                WHERE i.candidate_id = c.id AND ii.user_id = ?
              )`).get(documentId, actor.id);
        }
      }
      return document ? { document } : { failure: denied() };
    });
    const initial = await lookup();
    if (initial.failure) return initial.failure;
    const doc = initial.document;
    let handle;
    let closed = false;
    let started = false;
    let activeStream;
    const close = async () => {
      if (closed) return;
      closed = true;
      activeStream?.destroy();
      if (handle) await handle.close().catch(() => {});
    };
    try {
      if (typeof doc.storage_path !== 'string' || !doc.storage_path || path.isAbsolute(doc.storage_path) || path.win32.isAbsolute(doc.storage_path) || doc.storage_path.includes('\0')) return denied();
      const inside = (root, target) => { const relative = path.relative(root, target); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
      const root = await fs.promises.realpath(UPLOADS_DIR);
      const requested = path.resolve(root, doc.storage_path);
      if (!inside(root, requested)) return denied();
      const canonical = await fs.promises.realpath(requested);
      if (!inside(root, canonical)) return denied();
      const before = await fs.promises.stat(canonical);
      if (!before.isFile() || before.size < 5 || before.size > 10 * 1024 * 1024) return denied();
      handle = await fs.promises.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = await handle.stat();
      const afterPath = await fs.promises.realpath(requested);
      if (afterPath !== canonical || !inside(root, afterPath) || !opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) { await close(); return denied(); }
      const bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) { await close(); return denied(); }
        offset += read.bytesRead;
      }
      const extension = path.extname(doc.file_name || '').toLowerCase();
      let mimeType;
      if (extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') mimeType = 'application/pdf';
      else if (extension === '.docx' && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
        const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('exceljs'))] }));
        const zip = await JSZip.loadAsync(bytes);
        if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) { await close(); return denied(); }
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else { await close(); return denied(); }
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (doc.file_hash && doc.file_hash !== hash) { await close(); return denied(); }
      const recheck = async () => {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.dev !== opened.dev || stat.ino !== opened.ino || stat.size !== opened.size || stat.mtimeMs !== opened.mtimeMs || stat.ctimeMs !== opened.ctimeMs) return denied();
        const latest = await lookup();
        if (latest.failure) return latest.failure;
        const identity = ['id', 'candidate_id', 'requisition_id', 'storage_path', 'file_hash', 'file_name', 'file_size'];
        if (identity.some(key => latest.document[key] !== doc[key])) return denied();
        return { success: true };
      };
      const checked = await recheck();
      if (!checked.success) { await close(); return checked; }
      return {
        success: true, statusCode: 200, fileName: doc.file_name, mimeType, fileSize: opened.size,
        close,
        openStream: async () => {
          if (closed || started) return denied();
          try {
            const checked = await recheck();
            if (!checked.success) { await close(); return checked; }
            started = true;
            const stream = handle.createReadStream({ start: 0, autoClose: false });
            activeStream = stream;
            stream.once('close', () => { void close(); });
            return { success: true, stream };
          } catch { await close(); return denied(); }
        }
      };
    } catch { await close(); return denied(); }
  }

  async removeTag(candidateId, tagName, currentUser) {
    if (!currentUser || !currentUser.id) return { success: false, statusCode: 401, message: 'Yêu cầu đăng nhập.' };
    return this.db.transaction(async () => {
      const access = await this.candidateWriteAccess(candidateId, currentUser);
      if (!access.success) return access;
      await this.db.prepare('DELETE FROM candidate_tags WHERE candidate_id = ? AND tag_name = ?').run(candidateId, tagName);
      return { success: true, statusCode: 200, message: 'Đã xóa nhãn.' };
    });
  }
}

module.exports = CandidatePortalService;
