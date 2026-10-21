const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const RequisitionService = require('./requisitionService');

/**
 * ==============================================================================
 * USER STORY S5-08 (SCRUM-118) - MANUAL CANDIDATE ENTRY SERVICE
 * ==============================================================================
 *
 * Là Nhân viên tuyển dụng, tôi muốn thêm ứng viên thủ công vào một vị trí,
 * để đưa được ứng viên tìm từ LinkedIn vào cùng một pipeline.
 *
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Nhập tay thông tin và tải CV cho ứng viên tìm được từ nguồn khác
 *             (Họ tên, email, phone, requisition_id, source_id như LinkedIn/Headhunter,
 *              kinh nghiệm, lương kỳ vọng, ghi chú và tệp CV đính kèm PDF/DOCX <= 10MB)
 *   • AC-02: Ứng viên thêm tay vẫn đi qua đúng luồng phát hiện trùng
 *             (Kiểm tra trùng lặp theo Email hoặc Số điện thoại trên cùng vị trí và
 *              cảnh báo trùng lặp chéo trên toàn hệ thống)
 * ==============================================================================
 */

const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads/cv');

class CandidateManualEntryService {
  constructor(db) {
    this.db = db;
    this.requisitions = new RequisitionService(db);
  }

  /**
   * Chuẩn hoá chuỗi số điện thoại (chỉ giữ lại các chữ số, chuẩn hoá tiền tố quốc tế Việt Nam)
   */
  normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    let digits = phone.replace(/\D/g, '').trim();
    if (digits.startsWith('84') && digits.length === 11) {
      digits = '0' + digits.slice(2);
    }
    return digits;
  }

  /**
   * Chuẩn hoá địa chỉ email
   */
  normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
  }

  async supportsMergeColumn() {
    try { if (this.db.provider === 'postgres') { const row = await this.db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='candidates' AND column_name='merged_into_id'").get(); return Boolean(row); } await this.db.prepare('SELECT merged_into_id FROM candidates LIMIT 0').all(); return true; }
    catch { return false; }
  }

  /**
   * AC-02: Kiểm tra phát hiện trùng lặp hồ sơ ứng viên
   * - Trùng trên cùng vị trí tuyển dụng (Same position)
   * - Trùng ở các vị trí tuyển dụng khác (Cross position)
   *
   * @param {object} params
   * @param {string} params.email Email ứng viên
   * @param {string} [params.phoneNumber] Số điện thoại
   * @param {string} params.requisitionId Mã vị trí tuyển dụng
   * @returns {object} Kết quả kiểm tra trùng lặp
   */
  async checkDuplicateCandidate({ email, phoneNumber, requisitionId }) {
    const normEmail = this.normalizeEmail(email);
    const normPhone = this.normalizePhoneNumber(phoneNumber);

    if (!normEmail && !normPhone) {
      return {
        isDuplicate: false,
        hasSamePositionDuplicate: false,
        hasCrossPositionDuplicate: false,
        samePositionMatches: [],
        crossPositionMatches: []
      };
    }

    // Lấy danh sách ứng viên có email hoặc SĐT trùng và chưa rút đơn (stage <> 'WITHDRAWN')
    const conditions = [];
    const params = [];

    if (normEmail) {
      conditions.push('LOWER(TRIM(c.email)) = ?');
      params.push(normEmail);
    }

    if (normPhone && normPhone.length >= 7) {
      const suffix = normPhone.slice(-7);
      conditions.push(
        `(c.phone_number IS NOT NULL AND c.phone_number <> '' AND ` +
        `(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '.', ''), '+', ''), '(', ''), ')', '') = ? ` +
        `OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '.', ''), '+', ''), '(', ''), ')', '') LIKE ? ` +
        `OR c.phone_number LIKE ?))`
      );
      params.push(normPhone, '%' + suffix, '%' + suffix);
    }

    let rows = [];
    if (conditions.length > 0) {
    const mergeFilter = await this.supportsMergeColumn() ? ' AND c.merged_into_id IS NULL' : '';
    const sql = `
        SELECT c.id, c.full_name, c.email, c.phone_number, c.stage, c.requisition_id,
               c.source_id, c.created_at,
               r.title AS requisition_title, r.code AS requisition_code, r.status AS requisition_status
        FROM candidates c
        LEFT JOIN requisitions r ON r.id = c.requisition_id
        WHERE (${conditions.join(' OR ')})
          AND (c.stage IS NULL OR c.stage <> 'WITHDRAWN')${mergeFilter}
      `;

      try {
        rows = await this.db.prepare(sql).all(...params);
      } catch (err) {
        // Fallback đơn giản nếu không có bảng requisitions
        const fallbackSql = `
          SELECT c.id, c.full_name, c.email, c.phone_number, c.stage, c.requisition_id,
                 c.source_id, c.created_at
          FROM candidates c
          WHERE (${conditions.join(' OR ')})
            AND (c.stage IS NULL OR c.stage <> 'WITHDRAWN')${mergeFilter}
        `;
        rows = await this.db.prepare(fallbackSql).all(...params);
      }
    }

    const samePositionMatches = [];
    const crossPositionMatches = [];

    for (const row of rows) {
      const dbNormEmail = this.normalizeEmail(row.email);
      const dbNormPhone = this.normalizePhoneNumber(row.phone_number);

      const isEmailMatch = Boolean(normEmail && dbNormEmail && normEmail === dbNormEmail);
      const isPhoneMatch = Boolean(normPhone && dbNormPhone && (
        normPhone === dbNormPhone ||
        (normPhone.length >= 7 && dbNormPhone.length >= 7 && normPhone.slice(-7) === dbNormPhone.slice(-7))
      ));

      if (!isEmailMatch && !isPhoneMatch) {
        continue;
      }

      const matchDetail = {
        candidateId: row.id,
        fullName: row.full_name,
        email: row.email,
        phoneNumber: row.phone_number,
        stage: row.stage,
        requisitionId: row.requisition_id,
        requisitionTitle: row.requisition_title || 'N/A',
        requisitionCode: row.requisition_code || 'N/A',
        createdAt: row.created_at,
        matchField: isEmailMatch && isPhoneMatch ? 'BOTH' : isEmailMatch ? 'EMAIL' : 'PHONE'
      };

      const isSamePosition = Boolean(
        requisitionId &&
        row.requisition_id &&
        String(row.requisition_id).trim().toLowerCase() === String(requisitionId).trim().toLowerCase()
      );

      if (isSamePosition) {
        samePositionMatches.push(matchDetail);
      } else {
        crossPositionMatches.push(matchDetail);
      }
    }

    const hasSamePositionDuplicate = samePositionMatches.length > 0;
    const hasCrossPositionDuplicate = crossPositionMatches.length > 0;

    return {
      isDuplicate: hasSamePositionDuplicate || hasCrossPositionDuplicate,
      hasSamePositionDuplicate,
      hasCrossPositionDuplicate,
      samePositionMatches,
      crossPositionMatches,
      summary: {
        totalMatches: samePositionMatches.length + crossPositionMatches.length,
        samePositionCount: samePositionMatches.length,
        crossPositionCount: crossPositionMatches.length
      }
    };
  }

  /**
   * AC-01: Kiểm tra tệp CV đính kèm (PDF, DOCX <= 10MB)
   * @param {object} file Tệp tải lên ({ filename, buffer, mimeType })
   * @returns {object} Kết quả kiểm tra
   */
  validateCvFile(file) {
    if (!file) return { success: true, file: null };

    if (!file.buffer || !file.filename) {
      return {
        success: false,
        statusCode: 400,
        code: 'CV_FILE_INVALID',
        message: 'Tệp CV không hợp lệ hoặc thiếu dữ liệu.'
      };
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.buffer.length > MAX_SIZE) {
      return {
        success: false,
        statusCode: 413,
        code: 'CV_FILE_TOO_LARGE',
        message: 'Tệp CV vượt quá dung lượng tối đa 10MB.'
      };
    }

    const ext = path.extname(file.filename).toLowerCase();
    if (!['.pdf', '.docx'].includes(ext)) {
      return {
        success: false,
        statusCode: 400,
        code: 'CV_FILE_INVALID_EXTENSION',
        message: 'Chỉ chấp nhận tệp CV định dạng PDF hoặc DOCX.'
      };
    }

    const buf = file.buffer;
    let mimeType = file.mimeType || '';

    // Kiểm tra magic bytes
    if (ext === '.pdf') {
      const isPdfMagic = buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
      if (!isPdfMagic) {
        return {
          success: false,
          statusCode: 400,
          code: 'CV_FILE_INVALID_SIGNATURE',
          message: 'Tệp PDF không hợp lệ hoặc bị hỏng nội dung.'
        };
      }
      mimeType = 'application/pdf';
    } else if (ext === '.docx') {
      const isZipMagic = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04; // PK\x03\x04
      if (!isZipMagic) {
        return {
          success: false,
          statusCode: 400,
          code: 'CV_FILE_INVALID_SIGNATURE',
          message: 'Tệp DOCX không hợp lệ hoặc bị hỏng nội dung.'
        };
      }
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    return {
      success: true,
      ext,
      mimeType,
      fileHash,
      filename: file.filename,
      size: file.buffer.length,
      buffer: file.buffer
    };
  }

  /**
   * Kiểm tra tính hợp lệ của dữ liệu đầu vào ứng viên
   */
  validateCandidateData(data = {}) {
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';
    const requisitionId = typeof data.requisitionId === 'string' ? data.requisitionId.trim() : '';

    if (!fullName || fullName.length < 2) {
      return {
        success: false,
        statusCode: 400,
        code: 'FULL_NAME_REQUIRED',
        message: 'Họ và tên ứng viên là bắt buộc (tối thiểu 2 ký tự).'
      };
    }

    if (!email) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMAIL_REQUIRED',
        message: 'Email ứng viên là bắt buộc.'
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        success: false,
        statusCode: 400,
        code: 'EMAIL_INVALID_FORMAT',
        message: 'Định dạng email không hợp lệ.'
      };
    }

    if (!requisitionId) {
      return {
        success: false,
        statusCode: 400,
        code: 'REQUISITION_REQUIRED',
        message: 'Vị trí tuyển dụng là bắt buộc.'
      };
    }

    const experienceYears = parseInt(data.experienceYears, 10);
    const validExpYears = !isNaN(experienceYears) && experienceYears >= 0 ? experienceYears : 0;

    return {
      success: true,
      cleanData: {
        fullName,
        email: email.toLowerCase(),
        phoneNumber,
        requisitionId,
        sourceId: data.sourceId || 'LINKEDIN',
        experienceYears: validExpYears,
        currentCompany: typeof data.currentCompany === 'string' ? data.currentCompany.trim() : '',
        expectedSalary: typeof data.expectedSalary === 'string' ? data.expectedSalary.trim() : '',
        notes: typeof data.notes === 'string' ? data.notes.trim() : '',
        stage: data.stage || 'NEW'
      }
    };
  }

  /**
   * Kiểm tra quyền truy cập của người dùng trên vị trí tuyển dụng (RBAC & IDOR)
   */
  async checkRecruiterAccess(requisitionId, currentUser) {
    if (!currentUser || !currentUser.id) {
      return {
        hasAccess: false,
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Yêu cầu đăng nhập.'
      };
    }

    const roles = currentUser.roles || [];

    // Admin và HR Manager có toàn quyền truy cập
    if (roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r))) {
      return { hasAccess: true, role: 'ADMIN_OR_HR' };
    }

    // Recruiter chỉ được thao tác trên vị trí được phân công
    if (roles.includes('RECRUITER')) {
      let isAssigned = false;

      // 1. Kiểm tra qua RequisitionService nếu khả dụng
      try {
        isAssigned = await this.requisitions.recruiterAssigned(requisitionId, currentUser.id);
      } catch {
        isAssigned = false;
      }

      // 2. Kiểm tra trực tiếp bảng requisitions (recruiter chính)
      if (!isAssigned) {
        try {
          const reqRow = await this.db.prepare(
            `SELECT recruiter_id FROM requisitions WHERE id = ?`
          ).get(requisitionId);
          if (reqRow && reqRow.recruiter_id === currentUser.id) {
            isAssigned = true;
          }
        } catch {}
      }

      // 3. Kiểm tra bảng requisition_recruiter_supports (recruiter hỗ trợ)
      if (!isAssigned) {
        try {
          const supRow = await this.db.prepare(
            `SELECT 1 FROM requisition_recruiter_supports WHERE requisition_id = ? AND user_id = ? LIMIT 1`
          ).get(requisitionId, currentUser.id);
          if (supRow) {
            isAssigned = true;
          }
        } catch {}
      }

      if (!isAssigned) {
        return {
          hasAccess: false,
          statusCode: 403,
          code: 'CANDIDATE_OUT_OF_SCOPE',
          message: 'Chỉ được thêm ứng viên cho vị trí tuyển dụng bạn đang được phân công.'
        };
      }

      return { hasAccess: true, role: 'RECRUITER' };
    }

    // Các vai trò khác không có quyền tạo hồ sơ ứng viên
    return {
      hasAccess: false,
      statusCode: 403,
      code: 'CANDIDATE_FORBIDDEN',
      message: 'Bạn không có quyền thêm hồ sơ ứng viên vào hệ thống.'
    };
  }

  /**
   * AC-01 & AC-02: Tạo mới ứng viên thủ công kèm CV và phát hiện trùng
   *
   * @param {object} data Thông tin ứng viên nhập tay
   * @param {object} [cvFile] Tệp CV đính kèm ({ filename, buffer, mimeType })
   * @param {object} currentUser Người dùng hiện tại
   * @returns {object} Kết quả tạo ứng viên
   */
  async lockDuplicateIdentities(email, phoneNumber) {
    if (this.db.provider !== 'postgres') return;
    const phone = this.normalizePhoneNumber(phoneNumber);
    const keys = [this.normalizeEmail(email) && `email:${this.normalizeEmail(email)}`, phone.length >= 7 && `phone:${phone.slice(-7)}`].filter(Boolean).sort();
    for (const key of keys) await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(key);
  }

  async createManualCandidate(data = {}, cvFile = null, currentUser = null) {
    const work = async () => {
      await this.lockDuplicateIdentities(data.email, data.phoneNumber || data.phone);
      return this.createManualCandidateWithinTransaction(data, cvFile, currentUser);
    };
    return typeof this.db.transaction === 'function' ? this.db.transaction(work) : work();
  }

  async createManualCandidateWithinTransaction(data = {}, cvFile = null, currentUser = null) {
    // 1. Kiểm tra tính hợp lệ của dữ liệu đầu vào
    const valResult = this.validateCandidateData(data);
    if (!valResult.success) return valResult;
    const { cleanData } = valResult;

    // 2. Kiểm tra sự tồn tại và trạng thái của vị trí tuyển dụng
    let requisition = null;
    try {
      requisition = await this.db.prepare(
        `SELECT id, code, title, status, recruiter_id FROM requisitions WHERE id = ?`
      ).get(cleanData.requisitionId);
    } catch {}

    if (!requisition) {
      return {
        success: false,
        statusCode: 404,
        code: 'REQUISITION_NOT_FOUND',
        message: 'Không tìm thấy vị trí tuyển dụng được chỉ định.'
      };
    }

    if (['PAUSED', 'CANCELLED'].includes(requisition.status)) {
      return {
        success: false,
        statusCode: 409,
        code: 'REQUISITION_NOT_ACCEPTING_APPLICATIONS',
        message: 'Vị trí tuyển dụng hiện đang tạm dừng hoặc đã bị huỷ, không nhận thêm ứng viên mới.'
      };
    }

    // 3. Kiểm tra phân quyền RBAC & IDOR (Phạm vi công việc của Recruiter)
    const access = await this.checkRecruiterAccess(cleanData.requisitionId, currentUser);
    if (!access.hasAccess) {
      return {
        success: false,
        statusCode: access.statusCode,
        code: access.code,
        message: access.message
      };
    }

    // 4. AC-02: Kiểm tra phát hiện trùng lặp
    const dupResult = await this.checkDuplicateCandidate({
      email: cleanData.email,
      phoneNumber: cleanData.phoneNumber,
      requisitionId: cleanData.requisitionId
    });

    // 4.1 Trùng trên CÙNG vị trí -> Chặn tạo (HTTP 409 Conflict)
    if (dupResult.hasSamePositionDuplicate) {
      const match = dupResult.samePositionMatches[0];
      const matchFieldText = match.matchField === 'BOTH'
        ? 'email và số điện thoại'
        : match.matchField === 'EMAIL' ? 'email' : 'số điện thoại';

      return {
        success: false,
        statusCode: 409,
        code: 'DUPLICATE_CANDIDATE_IN_POSITION',
        message: `Ứng viên với ${matchFieldText} này đã có hồ sơ đang xử lý tại vị trí "${requisition.title}".`,
        data: {
          duplicateType: 'SAME_POSITION',
          matchField: match.matchField,
          existingCandidate: match
        }
      };
    }

    // 4.2 Trùng ở vị trí KHÁC (Cross-requisition) -> Yêu cầu xác nhận (nếu chưa confirm)
    if (dupResult.hasCrossPositionDuplicate && !data.confirmDuplicate && !data.forceCreate) {
      return {
        success: false,
        statusCode: 409,
        code: 'POTENTIAL_DUPLICATE_CROSS_REQUISITION',
        message: `Phát hiện ứng viên với thông tin tương tự đã từng nộp hồ sơ ở ${dupResult.crossPositionMatches.length} vị trí khác. Vui lòng xác nhận để tiếp tục đưa vào pipeline này.`,
        data: {
          duplicateType: 'CROSS_POSITION',
          matches: dupResult.crossPositionMatches
        }
      };
    }

    // 5. AC-01: Kiểm tra tệp CV đính kèm (nếu có)
    let cvValidation = null;
    if (cvFile) {
      cvValidation = this.validateCvFile(cvFile);
      if (!cvValidation.success) return cvValidation;
    }

    // 6. Xử lý nguồn ứng viên (Source)
    let sourceId = cleanData.sourceId; let dbSourceId = sourceId;
    let sourceName = 'LinkedIn';

    try {
      const catItem = await this.db.prepare(
        `SELECT id, name, code FROM recruitment_catalog_items
         WHERE type = 'CANDIDATE_SOURCE'
           AND (id = ? OR UPPER(code) = UPPER(?) OR LOWER(name) = LOWER(?))
           AND status = 'ACTIVE' LIMIT 1`
      ).get(sourceId, sourceId, sourceId);

      if (catItem) {
        sourceId = catItem.id;
        sourceName = catItem.name; dbSourceId = catItem.id; } else if (this.db.provider === 'postgres') { dbSourceId = null;
      }
    } catch {
      // Bảng catalog chưa có hoặc không áp dụng
    }

    // 7. Tạo mới hồ sơ ứng viên và lưu trữ
    const candidateId = 'cand-' + crypto.randomUUID();
    const trackingCode = 'TRK-MAN-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    // 7.1 Lưu tệp CV nếu có
    let documentRecord = null;
    if (cvValidation && cvValidation.success && cvValidation.buffer) {
      const docId = 'doc-' + crypto.randomUUID();
      const storageFileName = `cv-${candidateId}${cvValidation.ext}`;

      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const storagePath = path.join(UPLOADS_DIR, storageFileName);
        fs.writeFileSync(storagePath, cvValidation.buffer);
        const portalDir = path.resolve(__dirname, '..', '..', 'data', 'cv_uploads');
        if (!fs.existsSync(portalDir)) fs.mkdirSync(portalDir, { recursive: true });
        fs.writeFileSync(path.join(portalDir, storageFileName), cvValidation.buffer);
      } catch (err) {
        // Fallback ghi log nếu môi trường không cho phép ghi đĩa (ví dụ test memory)
      }

      documentRecord = {
        id: docId,
        candidateId,
        fileName: cvValidation.filename,
        storagePath: storageFileName,
        mimeType: cvValidation.mimeType,
        fileSize: cvValidation.size,
        fileHash: cvValidation.fileHash,
        documentType: 'CV'
      };
    }

    // 7.2 Lưu vào cơ sở dữ liệu
    const nowIso = new Date().toISOString();
    const isPostgres = this.db.provider === 'postgres';

    // Thêm bản ghi candidates
    const insertCandidateSql = isPostgres
      ? `INSERT INTO candidates (
           id, full_name, email, phone_number, requisition_id, stage,
           experience_years, current_company, expected_salary, notes,
           source_id, tracking_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      : `INSERT INTO candidates (
           id, full_name, email, phone_number, requisition_id, stage,
           experience_years, current_company, expected_salary, notes,
           source_id, tracking_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;

    try {
      await this.db.prepare(insertCandidateSql).run(
        candidateId,
        cleanData.fullName,
        cleanData.email,
        cleanData.phoneNumber || null,
        cleanData.requisitionId,
        cleanData.stage,
        cleanData.experienceYears,
        cleanData.currentCompany || null,
        cleanData.expectedSalary || null,
        cleanData.notes || null,
        dbSourceId || null,
        trackingCode
      );
    } catch (err) {
      // Fallback cho schema rút gọn
      const fallbackSql = `
        INSERT INTO candidates (
          id, full_name, email, phone_number, requisition_id, stage,
          source_id, tracking_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await this.db.prepare(fallbackSql).run(
        candidateId,
        cleanData.fullName,
        cleanData.email,
        cleanData.phoneNumber || null,
        cleanData.requisitionId,
        cleanData.stage,
        dbSourceId || null,
        trackingCode,
        nowIso
      );
    }

    // Thêm tài liệu CV vào candidate_documents
    if (documentRecord) {
      try {
        const insertDocSql = isPostgres
          ? `INSERT INTO candidate_documents (
               id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, document_type, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CV', CURRENT_TIMESTAMP)`
          : `INSERT INTO candidate_documents (
               id, candidate_id, file_name, storage_path, mime_type, file_size, file_hash, document_type, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CV', datetime('now'))`;

        await this.db.prepare(insertDocSql).run(
          documentRecord.id,
          documentRecord.candidateId,
          documentRecord.fileName,
          documentRecord.storagePath,
          documentRecord.mimeType,
          documentRecord.fileSize,
          documentRecord.fileHash
        );
      } catch (err) {
        // Bảng candidate_documents chưa được cấu hình
      }
    }

    // Ghi nhận lịch sử trạng thái ban đầu trong candidate_status_history
    try {
      const histId = 'hist-' + crypto.randomUUID();
      const actorName = currentUser.fullName || currentUser.email || 'Nhân viên tuyển dụng';
      const histNote = `Thêm thủ công từ nguồn ${sourceName}.` +
        (dupResult.hasCrossPositionDuplicate ? ` (Lưu ý: Có ${dupResult.crossPositionMatches.length} hồ sơ trùng ở vị trí khác)` : '');

      const insertHistSql = isPostgres
        ? `INSERT INTO candidate_status_history (
             id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at
           ) VALUES (?, ?, NULL, ?, ?, ?, 'MANUAL_ENTRY', ?, CURRENT_TIMESTAMP)`
        : `INSERT INTO candidate_status_history (
             id, candidate_id, before_stage, after_stage, actor_id, actor_name, action, notes, created_at
           ) VALUES (?, ?, NULL, ?, ?, ?, 'MANUAL_ENTRY', ?, datetime('now'))`;

      await this.db.prepare(insertHistSql).run(
        histId,
        candidateId,
        cleanData.stage,
        currentUser.id,
        actorName,
        histNote
      );
    } catch (err) {
      // Bảng candidate_status_history chưa tồn tại
    }

    // Nếu trùng lặp chéo được xác nhận, ghi thêm vào candidate_notes để đội tuyển dụng theo dõi
    if (dupResult.hasCrossPositionDuplicate) {
      try {
        const noteId = 'note-' + crypto.randomUUID();
        const positionsList = dupResult.crossPositionMatches
          .map(m => `"${m.requisitionTitle}" (${m.stage})`)
          .join(', ');
        const noteContent = `[Phát hiện trùng lặp hệ thống] Ứng viên này từng có hồ sơ ứng tuyển tại: ${positionsList}.`;

        const insertNoteSql = isPostgres
          ? `INSERT INTO candidate_notes (
               id, candidate_id, author_id, author_name, note_text, is_private, created_at
             ) VALUES (?, ?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP)`
          : `INSERT INTO candidate_notes (
               id, candidate_id, author_id, author_name, note_text, is_private, created_at
             ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`;

        await this.db.prepare(insertNoteSql).run(
          noteId,
          candidateId,
          currentUser.id,
          currentUser.fullName || 'Recruiter',
          noteContent
        );
      } catch (err) {
        // Bảng candidate_notes chưa tồn tại
      }
    }

    return {
      success: true,
      statusCode: 201,
      message: 'Thêm ứng viên thủ công thành công.',
      data: {
        id: candidateId,
        code: 'CAND-' + candidateId.replace(/^cand-/, '').substring(0, 4).toUpperCase(),
        fullName: cleanData.fullName,
        email: cleanData.email,
        phoneNumber: cleanData.phoneNumber,
        requisitionId: cleanData.requisitionId,
        requisitionTitle: requisition.title,
        sourceId,
        sourceName,
        stage: cleanData.stage,
        trackingCode,
        document: documentRecord ? {
          id: documentRecord.id,
          fileName: documentRecord.fileName,
          fileSize: documentRecord.fileSize,
          fileHash: documentRecord.fileHash,
          mimeType: documentRecord.mimeType
        } : null,
        crossPositionMatches: dupResult.hasCrossPositionDuplicate ? dupResult.crossPositionMatches : []
      }
    };
  }
}

module.exports = CandidateManualEntryService;
