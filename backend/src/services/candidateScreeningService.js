const crypto = require('node:crypto');
const RequisitionService = require('./requisitionService');

/**
 * ==============================================================================
 * USER STORY S5-09 (SCRUM-119) - CANDIDATE SCREENING & SCORING SERVICE
 * ==============================================================================
 *
 * Là Nhân viên tuyển dụng, tôi muốn có hồ sơ mới được chấm điểm sàng lọc theo
 * tiêu chí bắt buộc của vị trí, để ưu tiên đọc trước những hồ sơ có khả năng
 * phù hợp nhất.
 *
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Khai báo tiêu chí bắt buộc cho vị trí: số năm kinh nghiệm, bằng cấp, kỹ năng
 *   • AC-02: Hồ sơ mới được gắn điểm phù hợp và cờ Đạt hoặc Không đạt tiêu chí bắt buộc
 *   • AC-03: Điểm chỉ để gợi ý sắp xếp, không tự động loại ứng viên
 * ==============================================================================
 */

// Phân cấp trình độ bằng cấp từ thấp đến cao
const EDUCATION_LEVELS = Object.freeze({
  NONE: { rank: 0, label: 'Không yêu cầu' },
  HIGH_SCHOOL: { rank: 1, label: 'Trung học phổ thông / Trung cấp' },
  ASSOCIATE: { rank: 2, label: 'Cao đẳng' },
  BACHELOR: { rank: 3, label: 'Đại học / Cử nhân / Kỹ sư' },
  MASTER: { rank: 4, label: 'Thạc sĩ' },
  DOCTORATE: { rank: 5, label: 'Tiến sĩ / PhD' }
});

class CandidateScreeningService {
  constructor(db) {
    this.db = db;
    this.requisitions = new RequisitionService(db);
    this.ensureTables();
  }

  /**
   * Khởi tạo bảng dữ liệu tiêu chí sàng lọc và kết quả chấm điểm nếu chưa có
   */
  ensureTables() {
    const isPostgres = this.db.provider === 'postgres';

    const criteriaTableSql = isPostgres
      ? `CREATE TABLE IF NOT EXISTS requisition_screening_criteria (
           id TEXT PRIMARY KEY,
           requisition_id TEXT UNIQUE NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
           min_experience_years INTEGER NOT NULL DEFAULT 0,
           required_education TEXT NOT NULL DEFAULT 'NONE',
           required_skills_json TEXT NOT NULL DEFAULT '[]',
           weight_experience INTEGER NOT NULL DEFAULT 40,
           weight_education INTEGER NOT NULL DEFAULT 20,
           weight_skills INTEGER NOT NULL DEFAULT 40,
           created_by TEXT,
           updated_by TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
      : `CREATE TABLE IF NOT EXISTS requisition_screening_criteria (
           id TEXT PRIMARY KEY,
           requisition_id TEXT UNIQUE NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
           min_experience_years INTEGER NOT NULL DEFAULT 0,
           required_education TEXT NOT NULL DEFAULT 'NONE',
           required_skills_json TEXT NOT NULL DEFAULT '[]',
           weight_experience INTEGER NOT NULL DEFAULT 40,
           weight_education INTEGER NOT NULL DEFAULT 20,
           weight_skills INTEGER NOT NULL DEFAULT 40,
           created_by TEXT,
           updated_by TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`;

    const resultsTableSql = isPostgres
      ? `CREATE TABLE IF NOT EXISTS candidate_screening_results (
           id TEXT PRIMARY KEY,
           candidate_id TEXT UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
           requisition_id TEXT NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
           fit_score REAL NOT NULL DEFAULT 0,
           mandatory_pass BOOLEAN NOT NULL DEFAULT FALSE,
           experience_passed BOOLEAN NOT NULL DEFAULT FALSE,
           education_passed BOOLEAN NOT NULL DEFAULT FALSE,
           skills_passed BOOLEAN NOT NULL DEFAULT FALSE,
           evaluation_details TEXT NOT NULL,
           evaluated_by TEXT,
           evaluated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
      : `CREATE TABLE IF NOT EXISTS candidate_screening_results (
           id TEXT PRIMARY KEY,
           candidate_id TEXT UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
           requisition_id TEXT NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
           fit_score REAL NOT NULL DEFAULT 0,
           mandatory_pass INTEGER NOT NULL DEFAULT 0,
           experience_passed INTEGER NOT NULL DEFAULT 0,
           education_passed INTEGER NOT NULL DEFAULT 0,
           skills_passed INTEGER NOT NULL DEFAULT 0,
           evaluation_details TEXT NOT NULL,
           evaluated_by TEXT,
           evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`;

    try {
      this.db.exec(criteriaTableSql);
      this.db.exec(resultsTableSql);
    } catch (err) {
      // Bảng có thể đã tồn tại
    }
  }

  /**
   * Kiểm tra phân quyền truy cập vị trí tuyển dụng (RBAC & IDOR)
   */
  async checkRecruiterAccess(requisitionId, currentUser) {
    if (!currentUser || !currentUser.id) {
      return { hasAccess: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.' };
    }

    const roles = currentUser.roles || [];
    if (roles.some(r => ['ADMIN', 'HR_MANAGER'].includes(r))) {
      return { hasAccess: true, role: 'ADMIN_OR_HR' };
    }

    if (roles.includes('RECRUITER')) {
      let isAssigned = false;
      try {
        isAssigned = await this.requisitions.recruiterAssigned(requisitionId, currentUser.id);
      } catch {}

      if (!isAssigned) {
        try {
          const reqRow = await this.db.prepare('SELECT recruiter_id FROM requisitions WHERE id = ?').get(requisitionId);
          if (reqRow && reqRow.recruiter_id === currentUser.id) isAssigned = true;
        } catch {}
      }

      if (!isAssigned) {
        try {
          const supRow = await this.db.prepare(
            'SELECT 1 FROM requisition_recruiter_supports WHERE requisition_id = ? AND user_id = ? LIMIT 1'
          ).get(requisitionId, currentUser.id);
          if (supRow) isAssigned = true;
        } catch {}
      }

      if (!isAssigned) {
        return {
          hasAccess: false,
          statusCode: 403,
          code: 'CANDIDATE_OUT_OF_SCOPE',
          message: 'Vị trí tuyển dụng không thuộc phạm vi bạn được phân công.'
        };
      }

      return { hasAccess: true, role: 'RECRUITER' };
    }

    return {
      hasAccess: false,
      statusCode: 403,
      code: 'CANDIDATE_FORBIDDEN',
      message: 'Bạn không có quyền quản lý tiêu chí sàng lọc hồ sơ.'
    };
  }

  /**
   * AC-01: Khai báo / Cập nhật bộ tiêu chí bắt buộc cho vị trí tuyển dụng
   *
   * @param {string} requisitionId Mã vị trí tuyển dụng
   * @param {object} criteria Thông tin tiêu chí
   * @param {number} criteria.minExperienceYears Số năm kinh nghiệm tối thiểu bắt buộc
   * @param {string} criteria.requiredEducation Trình độ bằng cấp tối thiểu
   * @param {Array<string>} criteria.requiredSkills Danh sách kỹ năng bắt buộc
   * @param {number} [criteria.weightExperience=40] Trọng số kinh nghiệm
   * @param {number} [criteria.weightEducation=20] Trọng số bằng cấp
   * @param {number} [criteria.weightSkills=40] Trọng số kỹ năng
   * @param {object} currentUser Người dùng thực hiện
   */
  async setRequisitionCriteria(requisitionId, criteria = {}, currentUser = null) {
    if (!requisitionId || typeof requisitionId !== 'string') {
      return { success: false, statusCode: 400, code: 'REQUISITION_REQUIRED', message: 'Mã vị trí tuyển dụng là bắt buộc.' };
    }

    // 1. Kiểm tra vị trí tuyển dụng tồn tại
    let req = null;
    try {
      req = await this.db.prepare('SELECT id, title, status FROM requisitions WHERE id = ?').get(requisitionId);
    } catch {}

    if (!req) {
      return { success: false, statusCode: 404, code: 'REQUISITION_NOT_FOUND', message: 'Không tìm thấy vị trí tuyển dụng.' };
    }

    // 2. Kiểm tra phân quyền IDOR & RBAC
    const access = await this.checkRecruiterAccess(requisitionId, currentUser);
    if (!access.hasAccess) {
      return { success: false, statusCode: access.statusCode, code: access.code, message: access.message };
    }

    // 3. Chuẩn hoá và validate dữ liệu tiêu chí
    const minExperienceYears = Math.max(0, parseInt(criteria.minExperienceYears, 10) || 0);

    let requiredEducation = String(criteria.requiredEducation || 'NONE').toUpperCase().trim();
    if (!EDUCATION_LEVELS[requiredEducation]) {
      requiredEducation = 'NONE';
    }

    let requiredSkills = [];
    if (Array.isArray(criteria.requiredSkills)) {
      requiredSkills = criteria.requiredSkills
        .map(s => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);
    } else if (typeof criteria.requiredSkills === 'string') {
      requiredSkills = criteria.requiredSkills
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }

    // Trọng số tính điểm (Mặc định 40 - 20 - 40, tổng = 100)
    let weightExp = parseInt(criteria.weightExperience, 10);
    let weightEdu = parseInt(criteria.weightEducation, 10);
    let weightSkills = parseInt(criteria.weightSkills, 10);

    if (isNaN(weightExp) || isNaN(weightEdu) || isNaN(weightSkills)) {
      weightExp = 40;
      weightEdu = 20;
      weightSkills = 40;
    } else if (weightExp + weightEdu + weightSkills !== 100) {
      // Chuẩn hoá tỉ lệ nếu người dùng truyền tổng khác 100
      const total = weightExp + weightEdu + weightSkills;
      if (total > 0) {
        weightExp = Math.round((weightExp / total) * 100);
        weightEdu = Math.round((weightEdu / total) * 100);
        weightSkills = 100 - weightExp - weightEdu;
      } else {
        weightExp = 40; weightEdu = 20; weightSkills = 40;
      }
    }

    const skillsJson = JSON.stringify(requiredSkills);
    const criteriaId = 'crit-' + requisitionId;
    const isPostgres = this.db.provider === 'postgres';

    // Upsert bảng requisition_screening_criteria
    const upsertSql = isPostgres
      ? `INSERT INTO requisition_screening_criteria (
           id, requisition_id, min_experience_years, required_education, required_skills_json,
           weight_experience, weight_education, weight_skills, created_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (requisition_id) DO UPDATE SET
           min_experience_years = EXCLUDED.min_experience_years,
           required_education = EXCLUDED.required_education,
           required_skills_json = EXCLUDED.required_skills_json,
           weight_experience = EXCLUDED.weight_experience,
           weight_education = EXCLUDED.weight_education,
           weight_skills = EXCLUDED.weight_skills,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`
      : `INSERT INTO requisition_screening_criteria (
           id, requisition_id, min_experience_years, required_education, required_skills_json,
           weight_experience, weight_education, weight_skills, created_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT (requisition_id) DO UPDATE SET
           min_experience_years = excluded.min_experience_years,
           required_education = excluded.required_education,
           required_skills_json = excluded.required_skills_json,
           weight_experience = excluded.weight_experience,
           weight_education = excluded.weight_education,
           weight_skills = excluded.weight_skills,
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`;

    await this.db.prepare(upsertSql).run(
      criteriaId,
      requisitionId,
      minExperienceYears,
      requiredEducation,
      skillsJson,
      weightExp,
      weightEdu,
      weightSkills,
      currentUser.id,
      currentUser.id
    );

    const savedCriteria = {
      id: criteriaId,
      requisitionId,
      minExperienceYears,
      requiredEducation,
      requiredEducationLabel: EDUCATION_LEVELS[requiredEducation].label,
      requiredSkills,
      weightExperience: weightExp,
      weightEducation: weightEdu,
      weightSkills: weightSkills
    };

    // Nếu có cờ tự động chấm điểm lại toàn bộ hồ sơ hiện tại
    let rescreenStats = null;
    if (criteria.autoRescreen === true) {
      rescreenStats = await this.screenRequisitionCandidates(requisitionId, currentUser);
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Khai báo tiêu chí bắt buộc cho vị trí thành công.',
      data: savedCriteria,
      rescreenStats: rescreenStats ? rescreenStats.data : null
    };
  }

  /**
   * Lấy bộ tiêu chí bắt buộc hiện tại của vị trí tuyển dụng
   */
  async getRequisitionCriteria(requisitionId, currentUser = null) {
    if (!requisitionId) {
      return { success: false, statusCode: 400, code: 'REQUISITION_REQUIRED', message: 'Mã vị trí tuyển dụng là bắt buộc.' };
    }

    let req = null;
    try {
      req = await this.db.prepare('SELECT id, title, status FROM requisitions WHERE id = ?').get(requisitionId);
    } catch {}

    if (!req) {
      return { success: false, statusCode: 404, code: 'REQUISITION_NOT_FOUND', message: 'Không tìm thấy vị trí tuyển dụng.' };
    }

    const row = await this.db.prepare(
      'SELECT * FROM requisition_screening_criteria WHERE requisition_id = ?'
    ).get(requisitionId);

    if (!row) {
      // Trả về tiêu chí mặc định nếu chưa cấu hình
      return {
        success: true,
        statusCode: 200,
        isConfigured: false,
        data: {
          requisitionId,
          requisitionTitle: req.title,
          minExperienceYears: 0,
          requiredEducation: 'NONE',
          requiredEducationLabel: EDUCATION_LEVELS.NONE.label,
          requiredSkills: [],
          weightExperience: 40,
          weightEducation: 20,
          weightSkills: 40
        }
      };
    }

    let skills = [];
    try {
      skills = JSON.parse(row.required_skills_json || '[]');
    } catch {}

    const eduLevel = row.required_education || 'NONE';

    return {
      success: true,
      statusCode: 200,
      isConfigured: true,
      data: {
        id: row.id,
        requisitionId: row.requisition_id,
        requisitionTitle: req.title,
        minExperienceYears: row.min_experience_years,
        requiredEducation: eduLevel,
        requiredEducationLabel: EDUCATION_LEVELS[eduLevel]?.label || eduLevel,
        requiredSkills: skills,
        weightExperience: row.weight_experience,
        weightEducation: row.weight_education,
        weightSkills: row.weight_skills,
        updatedAt: row.updated_at
      }
    };
  }

  /**
   * Trích xuất trình độ bằng cấp từ hồ sơ và văn bản CV
   */
  detectEducationLevel(candidate, cvText = '') {
    if (candidate.education_level && EDUCATION_LEVELS[candidate.education_level]) {
      return candidate.education_level;
    }

    const textToScan = `${candidate.notes || ''} ${candidate.cover_letter || ''} ${cvText}`.toLowerCase();

    if (/tiến\s*sĩ|phd|doctorate/i.test(textToScan)) return 'DOCTORATE';
    if (/thạc\s*sĩ|master|cao\s*học/i.test(textToScan)) return 'MASTER';
    if (/đại\s*học|cử\s*nhân|kỹ\s*sư|bachelor|university/i.test(textToScan)) return 'BACHELOR';
    if (/cao\s*đẳng|associate|college/i.test(textToScan)) return 'ASSOCIATE';
    if (/trung\s*cấp|trung\s*học|thpt|high\s*school/i.test(textToScan)) return 'HIGH_SCHOOL';

    return 'NONE';
  }

  /**
   * Trích xuất và so khớp danh sách kỹ năng của ứng viên
   */
  matchSkills(candidate, requiredSkills = [], cvText = '', candidateTags = []) {
    if (!requiredSkills || requiredSkills.length === 0) {
      return { matchedSkills: [], missingSkills: [], isSkillsPassed: true, matchRatio: 1.0 };
    }

    // Tập hợp toàn bộ nguồn văn bản kỹ năng của ứng viên
    const fullText = `
      ${candidate.skills || ''}
      ${candidate.notes || ''}
      ${candidate.cover_letter || ''}
      ${candidateTags.join(' ')}
      ${cvText}
    `.toLowerCase();

    const matchedSkills = [];
    const missingSkills = [];

    for (const skill of requiredSkills) {
      const cleanSkill = skill.trim().toLowerCase();
      if (!cleanSkill) continue;

      // Kiểm tra trong tags trước
      const hasInTags = candidateTags.some(t => t.toLowerCase() === cleanSkill || t.toLowerCase().includes(cleanSkill));

      // Kiểm tra chuỗi con trong CV / văn bản hồ sơ
      let hasInText = false;
      if (hasInTags) {
        hasInText = true;
      } else if (cleanSkill.length <= 3) {
        // Kỹ năng ngắn như C, R, GO, SQL -> dùng regex ranh giới từ để tránh match nhầm
        const regex = new RegExp(`(?:^|[^a-zA-Z0-9_#+])${cleanSkill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-zA-Z0-9_#+])`, 'i');
        hasInText = regex.test(fullText);
      } else {
        hasInText = fullText.includes(cleanSkill);
      }

      if (hasInText) {
        matchedSkills.push(skill);
      } else {
        missingSkills.push(skill);
      }
    }

    const isSkillsPassed = missingSkills.length === 0;
    const matchRatio = requiredSkills.length > 0 ? (matchedSkills.length / requiredSkills.length) : 1.0;

    return {
      matchedSkills,
      missingSkills,
      isSkillsPassed,
      matchRatio
    };
  }

  /**
   * AC-02: Hàm tính toán điểm phù hợp và cờ Đạt/Không đạt tiêu chí bắt buộc
   * (Độc lập, không thay đổi stage của ứng viên)
   *
   * @param {object} candidate Hồ sơ ứng viên
   * @param {object} criteria Bộ tiêu chí của vị trí
   * @param {object} [extra] Dữ liệu bổ sung ({ cvText, tags })
   * @returns {object} Chi tiết đánh giá
   */
  calculateScreeningScore(candidate, criteria, extra = {}) {
    const minExpYears = criteria.minExperienceYears || 0;
    const candidateExpYears = typeof candidate.experience_years === 'number'
      ? candidate.experience_years
      : parseInt(candidate.experience_years, 10) || 0;

    const reqEduCode = criteria.requiredEducation || 'NONE';
    const reqEduRank = EDUCATION_LEVELS[reqEduCode]?.rank || 0;

    const candidateEduCode = this.detectEducationLevel(candidate, extra.cvText || '');
    const candidateEduRank = EDUCATION_LEVELS[candidateEduCode]?.rank || 0;

    const requiredSkills = criteria.requiredSkills || [];
    const skillResult = this.matchSkills(candidate, requiredSkills, extra.cvText || '', extra.tags || []);

    const weightExp = criteria.weightExperience ?? 40;
    const weightEdu = criteria.weightEducation ?? 20;
    const weightSkills = criteria.weightSkills ?? 40;

    // 1. Đánh giá Tiêu chí Kinh nghiệm
    let expPassed = true;
    let expScore = 0;
    if (minExpYears === 0) {
      expPassed = true;
      expScore = weightExp;
    } else {
      if (candidateExpYears >= minExpYears) {
        expPassed = true;
        expScore = weightExp;
      } else {
        expPassed = false;
        expScore = Math.round(((candidateExpYears / minExpYears) * weightExp) * 10) / 10;
      }
    }

    // 2. Đánh giá Tiêu chí Bằng cấp
    let eduPassed = true;
    let eduScore = 0;
    if (reqEduRank === 0) {
      eduPassed = true;
      eduScore = weightEdu;
    } else {
      if (candidateEduRank >= reqEduRank) {
        eduPassed = true;
        eduScore = weightEdu;
      } else {
        eduPassed = false;
        eduScore = Math.round(((candidateEduRank / reqEduRank) * weightEdu) * 10) / 10;
      }
    }

    // 3. Đánh giá Tiêu chí Kỹ năng
    let skillsPassed = true;
    let skillsScore = 0;
    if (requiredSkills.length === 0) {
      skillsPassed = true;
      skillsScore = weightSkills;
    } else {
      skillsPassed = skillResult.isSkillsPassed;
      skillsScore = Math.round((skillResult.matchRatio * weightSkills) * 10) / 10;
    }

    // 4. Tổng hợp: Điểm phù hợp (Fit Score) và Cờ Đạt tiêu chí bắt buộc (Mandatory Pass)
    const totalScore = Math.min(100, Math.round((expScore + eduScore + skillsScore) * 10) / 10);
    const mandatoryPass = expPassed && eduPassed && skillsPassed;

    // Chi tiết đánh giá từng tiêu chí
    const breakdown = {
      experience: {
        required: minExpYears,
        actual: candidateExpYears,
        passed: expPassed,
        score: expScore,
        maxScore: weightExp,
        summary: expPassed
          ? `Đạt: ${candidateExpYears} năm (Yêu cầu: ${minExpYears} năm)`
          : `Không đạt: ${candidateExpYears} năm (Thiếu ${minExpYears - candidateExpYears} năm)`
      },
      education: {
        required: reqEduCode,
        requiredLabel: EDUCATION_LEVELS[reqEduCode]?.label || reqEduCode,
        actual: candidateEduCode,
        actualLabel: EDUCATION_LEVELS[candidateEduCode]?.label || candidateEduCode,
        passed: eduPassed,
        score: eduScore,
        maxScore: weightEdu,
        summary: eduPassed
          ? `Đạt: ${EDUCATION_LEVELS[candidateEduCode]?.label || candidateEduCode}`
          : `Không đạt: ${EDUCATION_LEVELS[candidateEduCode]?.label || candidateEduCode} (Yêu cầu tối thiểu: ${EDUCATION_LEVELS[reqEduCode]?.label || reqEduCode})`
      },
      skills: {
        required: requiredSkills,
        matched: skillResult.matchedSkills,
        missing: skillResult.missingSkills,
        passed: skillsPassed,
        score: skillsScore,
        maxScore: weightSkills,
        matchCount: `${skillResult.matchedSkills.length}/${requiredSkills.length}`,
        summary: skillsPassed
          ? `Đạt: Đủ ${requiredSkills.length} kỹ năng bắt buộc`
          : `Không đạt: Thiếu ${skillResult.missingSkills.length} kỹ năng (${skillResult.missingSkills.join(', ')})`
      }
    };

    return {
      fitScore: totalScore,
      mandatoryPass,
      experiencePassed: expPassed,
      educationPassed: eduPassed,
      skillsPassed,
      breakdown
    };
  }

  /**
   * AC-02 & AC-03: Thực hiện chấm điểm sàng lọc cho một ứng viên
   * - Lưu kết quả điểm số và cờ Đạt/Không đạt vào bảng candidate_screening_results
   * - KHÔNG TỰ ĐỘNG LOẠI ỨNG VIÊN (Stage vẫn được giữ nguyên)
   *
   * @param {string} candidateId Mã ứng viên
   * @param {object} currentUser Người dùng thực hiện
   */
  async screenCandidate(candidateId, currentUser = null) {
    if (!candidateId) {
      return { success: false, statusCode: 400, code: 'CANDIDATE_REQUIRED', message: 'Mã ứng viên là bắt buộc.' };
    }

    // 1. Tìm hồ sơ ứng viên
    const candidate = await this.db.prepare(
      `SELECT c.*, r.title AS requisition_title
       FROM candidates c
       LEFT JOIN requisitions r ON r.id = c.requisition_id
       WHERE c.id = ?`
    ).get(candidateId);

    if (!candidate) {
      return { success: false, statusCode: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' };
    }

    if (!candidate.requisition_id) {
      return { success: false, statusCode: 400, code: 'CANDIDATE_NO_REQUISITION', message: 'Ứng viên chưa được gán vào vị trí tuyển dụng cụ thể.' };
    }

    // 2. Kiểm tra phân quyền truy cập
    const access = await this.checkRecruiterAccess(candidate.requisition_id, currentUser);
    if (!access.hasAccess) {
      return { success: false, statusCode: access.statusCode, code: access.code, message: access.message };
    }

    // 3. Lấy tiêu chí bắt buộc của vị trí
    const criteriaRes = await this.getRequisitionCriteria(candidate.requisition_id, currentUser);
    const criteria = criteriaRes.data;

    // 4. Lấy dữ liệu bổ sung: tags và CV parsed text
    let cvText = '';
    try {
      const doc = await this.db.prepare(
        `SELECT parsed_text FROM candidate_documents WHERE candidate_id = ? AND document_type = 'CV' ORDER BY created_at DESC LIMIT 1`
      ).get(candidateId);
      if (doc && doc.parsed_text) cvText = doc.parsed_text;
    } catch {}

    let tags = [];
    try {
      const tagRows = await this.db.prepare(
        `SELECT tag_name FROM candidate_tags WHERE candidate_id = ?`
      ).all(candidateId);
      tags = tagRows.map(t => t.tag_name);
    } catch {}

    // 5. Chấm điểm sàng lọc (AC-02)
    const result = this.calculateScreeningScore(candidate, criteria, { cvText, tags });

    // 6. Lưu kết quả vào cơ sở dữ liệu
    const resultId = 'scr-' + candidateId;
    const isPostgres = this.db.provider === 'postgres';
    const breakdownJson = JSON.stringify(result.breakdown);
    const actorId = currentUser ? currentUser.id : null;

    const upsertSql = isPostgres
      ? `INSERT INTO candidate_screening_results (
           id, candidate_id, requisition_id, fit_score, mandatory_pass,
           experience_passed, education_passed, skills_passed, evaluation_details,
           evaluated_by, evaluated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (candidate_id) DO UPDATE SET
           requisition_id = EXCLUDED.requisition_id,
           fit_score = EXCLUDED.fit_score,
           mandatory_pass = EXCLUDED.mandatory_pass,
           experience_passed = EXCLUDED.experience_passed,
           education_passed = EXCLUDED.education_passed,
           skills_passed = EXCLUDED.skills_passed,
           evaluation_details = EXCLUDED.evaluation_details,
           evaluated_by = EXCLUDED.evaluated_by,
           evaluated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`
      : `INSERT INTO candidate_screening_results (
           id, candidate_id, requisition_id, fit_score, mandatory_pass,
           experience_passed, education_passed, skills_passed, evaluation_details,
           evaluated_by, evaluated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT (candidate_id) DO UPDATE SET
           requisition_id = excluded.requisition_id,
           fit_score = excluded.fit_score,
           mandatory_pass = excluded.mandatory_pass,
           experience_passed = excluded.experience_passed,
           education_passed = excluded.education_passed,
           skills_passed = excluded.skills_passed,
           evaluation_details = excluded.evaluation_details,
           evaluated_by = excluded.evaluated_by,
           evaluated_at = datetime('now'),
           updated_at = datetime('now')`;

    await this.db.prepare(upsertSql).run(
      resultId,
      candidateId,
      candidate.requisition_id,
      result.fitScore,
      isPostgres ? result.mandatoryPass : (result.mandatoryPass ? 1 : 0),
      isPostgres ? result.experiencePassed : (result.experiencePassed ? 1 : 0),
      isPostgres ? result.educationPassed : (result.educationPassed ? 1 : 0),
      isPostgres ? result.skillsPassed : (result.skillsPassed ? 1 : 0),
      breakdownJson,
      actorId
    );

    // AC-03: TUYỆT ĐỐI KHÔNG TỰ ĐỘNG THAY ĐỔI STAGE CỦA ỨNG VIÊN
    // Ứng viên giữ nguyên stage hiện tại (ví dụ 'NEW') bất kể cờ đạt hay không đạt.

    return {
      success: true,
      statusCode: 200,
      message: 'Chấm điểm sàng lọc hồ sơ thành công.',
      data: {
        candidateId,
        fullName: candidate.full_name,
        email: candidate.email,
        requisitionId: candidate.requisition_id,
        requisitionTitle: candidate.requisition_title,
        stage: candidate.stage, // Giữ nguyên stage
        fitScore: result.fitScore,
        mandatoryPass: result.mandatoryPass,
        experiencePassed: result.experiencePassed,
        educationPassed: result.educationPassed,
        skillsPassed: result.skillsPassed,
        breakdown: result.breakdown
      }
    };
  }

  /**
   * Chấm điểm hàng loạt toàn bộ hồ sơ trong một vị trí tuyển dụng
   */
  async screenRequisitionCandidates(requisitionId, currentUser = null) {
    if (!requisitionId) {
      return { success: false, statusCode: 400, code: 'REQUISITION_REQUIRED', message: 'Mã vị trí tuyển dụng là bắt buộc.' };
    }

    const access = await this.checkRecruiterAccess(requisitionId, currentUser);
    if (!access.hasAccess) {
      return { success: false, statusCode: access.statusCode, code: access.code, message: access.message };
    }

    const candidates = await this.db.prepare(
      `SELECT id FROM candidates WHERE requisition_id = ? AND (stage IS NULL OR stage <> 'WITHDRAWN')`
    ).all(requisitionId);

    let passedCount = 0;
    let failedCount = 0;
    const results = [];

    for (const cand of candidates) {
      const res = await this.screenCandidate(cand.id, currentUser);
      if (res.success && res.data) {
        if (res.data.mandatoryPass) passedCount++;
        else failedCount++;
        results.push(res.data);
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: `Đã chấm điểm sàng lọc cho ${candidates.length} hồ sơ trong vị trí.`,
      data: {
        requisitionId,
        totalScreened: candidates.length,
        passedCount,
        failedCount,
        candidates: results
      }
    };
  }

  /**
   * AC-03: Lấy danh sách hồ sơ ứng viên được sắp xếp theo điểm phù hợp (Fit score cao nhất lên đầu)
   * Giúp Nhân viên tuyển dụng ưu tiên đọc trước các hồ sơ có khả năng phù hợp nhất.
   *
   * @param {string} requisitionId Mã vị trí tuyển dụng
   * @param {object} currentUser Người dùng hiện tại
   * @param {object} [options] Bộ lọc và phân trang
   * @param {string} [options.filter='all'] 'all' | 'passed_only' | 'failed_only'
   * @param {string} [options.stage] Lọc theo stage ('NEW', 'SCREENING'...)
   * @param {string} [options.sortBy='fit_score_desc'] 'fit_score_desc' | 'created_at_desc'
   */
  async getCandidatesRankedByScreening(requisitionId, currentUser = null, options = {}) {
    if (!requisitionId) {
      return { success: false, statusCode: 400, code: 'REQUISITION_REQUIRED', message: 'Mã vị trí tuyển dụng là bắt buộc.' };
    }

    const access = await this.checkRecruiterAccess(requisitionId, currentUser);
    if (!access.hasAccess) {
      return { success: false, statusCode: access.statusCode, code: access.code, message: access.message };
    }

    const conditions = ['c.requisition_id = ?', "(c.stage IS NULL OR c.stage <> 'WITHDRAWN')"];
    const params = [requisitionId];

    if (options.stage && options.stage !== 'ALL') {
      conditions.push('c.stage = ?');
      params.push(options.stage);
    }

    if (options.filter === 'passed_only') {
      conditions.push(this.db.provider === 'postgres' ? 'sr.mandatory_pass = TRUE' : 'sr.mandatory_pass = 1');
    } else if (options.filter === 'failed_only') {
      conditions.push(this.db.provider === 'postgres' ? '(sr.mandatory_pass = FALSE OR sr.mandatory_pass IS NULL)' : '(sr.mandatory_pass = 0 OR sr.mandatory_pass IS NULL)');
    }

    let orderBy = this.db.provider === 'postgres' ? 'COALESCE(sr.fit_score, 0) DESC, COALESCE(sr.mandatory_pass, FALSE) DESC, c.created_at DESC' : 'COALESCE(sr.fit_score, 0) DESC, COALESCE(sr.mandatory_pass, 0) DESC, c.created_at DESC';
    if (options.sortBy === 'created_at_desc') {
      orderBy = 'c.created_at DESC';
    }

    const sql = `
      SELECT
        c.id, c.full_name, c.email, c.phone_number, c.requisition_id, c.stage,
        c.experience_years, c.current_company, c.expected_salary, c.source_id, c.created_at,
        sr.fit_score, sr.mandatory_pass, sr.experience_passed, sr.education_passed, sr.skills_passed,
        sr.evaluation_details, sr.evaluated_at
      FROM candidates c
      LEFT JOIN candidate_screening_results sr ON sr.candidate_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
    `;

    const rows = await this.db.prepare(sql).all(...params);

    const candidates = rows.map(r => {
      let breakdown = null;
      if (r.evaluation_details) {
        try { breakdown = JSON.parse(r.evaluation_details); } catch {}
      }

      return {
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        phoneNumber: r.phone_number,
        requisitionId: r.requisition_id,
        stage: r.stage,
        experienceYears: r.experience_years,
        currentCompany: r.current_company,
        expectedSalary: r.expected_salary,
        sourceId: r.source_id,
        createdAt: r.created_at,
        screening: r.evaluated_at ? {
          fitScore: r.fit_score,
          mandatoryPass: Boolean(r.mandatory_pass),
          experiencePassed: Boolean(r.experience_passed),
          educationPassed: Boolean(r.education_passed),
          skillsPassed: Boolean(r.skills_passed),
          evaluatedAt: r.evaluated_at,
          breakdown
        } : null
      };
    });

    return {
      success: true,
      statusCode: 200,
      total: candidates.length,
      passedCount: candidates.filter(c => c.screening && c.screening.mandatoryPass).length,
      unscreenedCount: candidates.filter(c => !c.screening).length,
      candidates
    };
  }
}

module.exports = CandidateScreeningService;
