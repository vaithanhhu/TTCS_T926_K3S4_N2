const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config/config');
const { EmailService } = require('./emailService');
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
  }

  // Validate CV file buffer, magic numbers, MIME type, size <= 10MB
  validateCvFile(file) {
    if (!file || !file.buffer || !file.filename) {
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
      const isPdfMagic = buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
      if (!isPdfMagic) {
        return { success: false, statusCode: 400, code: 'CV_FILE_INVALID_SIGNATURE', message: 'Tệp PDF không hợp lệ hoặc bị hỏng.' };
      }
      mimeType = 'application/pdf';
    } else if (ext === '.docx') {
      const isZipMagic = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04; // PK\x03\x04
      if (!isZipMagic) {
        return { success: false, statusCode: 400, code: 'CV_FILE_INVALID_SIGNATURE', message: 'Tệp DOCX không hợp lệ hoặc bị hỏng.' };
      }
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
    const fileValidation = this.validateCvFile(data.cvFile);
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
    fs.writeFileSync(storagePath, data.cvFile.buffer);

    const fileHash = crypto.createHash('sha256').update(data.cvFile.buffer).digest('hex');
    const docId = 'doc-' + crypto.randomUUID();

    // 8. Transactional persistence
    await this.db.transaction(async () => {
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

    // 9. Send Confirmation Email (Safe with Fallback)
    const trackingUrl = `${config.APP_URL}/careers/jobs?trackingCode=${encodeURIComponent(trackingCode)}&email=${encodeURIComponent(email)}`;
    const withdrawUrl = `${config.APP_URL}/careers/jobs?action=withdraw&token=${encodeURIComponent(withdrawToken)}`;

    try {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2563eb;">Xác nhận nộp hồ sơ ứng tuyển thành công</h2>
          <p>Chào <strong>${fullName}</strong>,</p>
          <p>Cảm ơn bạn đã ứng tuyển vị trí <strong>${posting.title}</strong> tại phòng ban <strong>${posting.department_name}</strong>.</p>
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

    const hasPerm = await this.rbac.hasPermission(user.id, 'candidate.cv.parse');
    if (!hasPerm && !user.roles?.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r))) {
      return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền trích xuất CV.' };
    }

    const doc = documentId
      ? await this.db.prepare(
          `SELECT id, file_name, storage_path, mime_type, parsed_text, parsed_data_json
           FROM candidate_documents
           WHERE id = ? AND candidate_id = ? AND document_type = 'CV'`
        ).get(documentId, candidateId)
      : await this.db.prepare(
          `SELECT id, file_name, storage_path, mime_type, parsed_text, parsed_data_json
           FROM candidate_documents
           WHERE candidate_id = ? AND document_type = 'CV'
           ORDER BY created_at DESC LIMIT 1`
        ).get(candidateId);

    if (!doc) {
      return { success: false, statusCode: 404, code: 'CV_NOT_FOUND', message: 'Không tìm thấy tệp CV của ứng viên này.' };
    }

    const filePath = path.join(UPLOADS_DIR, doc.storage_path);
    if (!fs.existsSync(filePath)) {
      return { success: false, statusCode: 404, code: 'CV_FILE_NOT_FOUND', message: 'Tệp CV không tồn tại trên hệ thống lưu trữ.' };
    }

    const buffer = fs.readFileSync(filePath);
    let extractedText = '';

    try {
      if (doc.mime_type === 'application/pdf' || filePath.endsWith('.pdf')) {
        try {
          if (typeof pdfParse === 'function') {
            const parsed = await pdfParse(buffer);
            extractedText = parsed.text || '';
          } else if (pdfParse?.PDFParse) {
            const parser = new pdfParse.PDFParse({ data: buffer });
            const result = await parser.getText();
            extractedText = result?.text || '';
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
      console.warn('[CandidatePortalService] PDF parse error:', parseErr.message);
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
    await this.db.prepare(
      `UPDATE candidate_documents SET parsed_text = ?, parsed_data_json = ? WHERE id = ?`
    ).run(extractedText.slice(0, 5000), JSON.stringify(parsedData), doc.id);

    return {
      success: true,
      statusCode: 200,
      message: 'Trích xuất thông tin CV thành công.',
      data: parsedData,
      parsedData
    };
  }

}

module.exports = CandidatePortalService;
