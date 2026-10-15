const { parseMultipartOrJson } = require('../utils/formParser');

/**
 * ==============================================================================
 * USER STORY S5-08 (SCRUM-118) - CANDIDATE MANUAL ENTRY CONTROLLER
 * ==============================================================================
 * 
 * Endpoints:
 *   • POST /api/v1/candidates/manual: Thêm ứng viên thủ công kèm tệp CV
 *   • POST /api/v1/candidates/check-duplicate: Kiểm tra trùng lặp thời gian thực
 * 
 * Phân quyền: Yêu cầu quyền 'candidate.create' kết hợp kiểm tra IDOR trong Service.
 * ==============================================================================
 */
class CandidateManualEntryController {
  constructor(manualEntryService, rbacMiddleware, authService) {
    this.service = manualEntryService;
    this.rbacMiddleware = rbacMiddleware;
    this.authService = authService;
  }

  send(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
  }

  async handle(req, res, parsedUrl, parseBody) {
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // 1. Endpoint kiểm tra trùng lặp trước khi gửi form (Realtime debounce check)
    if (pathname === '/api/v1/candidates/check-duplicate' || pathname === '/candidates/check-duplicate') {
      if (method !== 'POST') {
        return this.send(res, 405, {
          success: false,
          code: 'METHOD_NOT_ALLOWED',
          message: 'Chỉ chấp nhận phương thức POST.'
        });
      }

      // Xác thực người dùng có quyền tạo/đọc ứng viên
      const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.create');
      if (!user) return; // rbacMiddleware đã tự gửi response lỗi

      try {
        let body = {};
        if (typeof parseBody === 'function') {
          body = await parseBody(req);
        } else {
          const parsed = await parseMultipartOrJson(req);
          body = parsed.fields || {};
        }

        const email = body.email || '';
        const phoneNumber = body.phoneNumber || body.phone || '';
        const requisitionId = body.requisitionId || '';

        const result = await this.service.checkDuplicateCandidate({
          email,
          phoneNumber,
          requisitionId
        });

        return this.send(res, 200, {
          success: true,
          data: result
        });
      } catch (err) {
        console.error('[CandidateManualEntryController checkDuplicate Error]', err);
        return this.send(res, 500, {
          success: false,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Lỗi máy chủ khi kiểm tra trùng lặp ứng viên.'
        });
      }
    }

    // 2. Endpoint thêm mới ứng viên thủ công kèm CV (AC-01 & AC-02)
    if (pathname === '/api/v1/candidates/manual' || pathname === '/candidates/manual') {
      if (method !== 'POST') {
        return this.send(res, 405, {
          success: false,
          code: 'METHOD_NOT_ALLOWED',
          message: 'Chỉ chấp nhận phương thức POST.'
        });
      }

      // Xác thực người dùng có quyền tạo ứng viên
      const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.create');
      if (!user) return;

      try {
        let fields = {};
        let file = null;

        if (typeof req.on === 'function') {
          const parsed = await parseMultipartOrJson(req);
          fields = parsed.fields || {};
          file = parsed.file;
        } else if (typeof parseBody === 'function') {
          fields = await parseBody(req);
          if (fields.cvFile && typeof fields.cvFile === 'object') {
            const rawBase64 = fields.cvFile.data || fields.cvFile.base64 || '';
            const fileBuf = Buffer.from(rawBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
            file = {
              filename: fields.cvFile.filename || fields.cvFile.name || 'cv.pdf',
              mimeType: fields.cvFile.mimeType || fields.cvFile.type || 'application/pdf',
              buffer: fileBuf
            };
            delete fields.cvFile;
          }
        }

        // Chuyển đổi cờ xác nhận sang boolean
        const confirmDuplicate = fields.confirmDuplicate === true || 
                                fields.confirmDuplicate === 'true' || 
                                fields.confirmDuplicate === 1 || 
                                fields.confirmDuplicate === '1';

        const payload = {
          ...fields,
          confirmDuplicate
        };

        const result = await this.service.createManualCandidate(payload, file, user);
        return this.send(res, result.statusCode || (result.success ? 201 : 400), result);
      } catch (err) {
        if (err.statusCode === 413 || err.message === 'PAYLOAD_TOO_LARGE') {
          return this.send(res, 413, {
            success: false,
            code: 'CV_FILE_TOO_LARGE',
            message: 'Tệp CV vượt quá dung lượng tối đa cho phép (10MB).'
          });
        }
        if (err.statusCode === 400 || err.message === 'INVALID_JSON') {
          return this.send(res, 400, {
            success: false,
            code: 'INVALID_REQUEST',
            message: 'Dữ liệu gửi lên không đúng định dạng.'
          });
        }

        console.error('[CandidateManualEntryController createManual Error]', err);
        return this.send(res, 500, {
          success: false,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Lỗi máy chủ khi thêm ứng viên thủ công.'
        });
      }
    }

    // Nếu không khớp đường dẫn
    return this.send(res, 404, {
      success: false,
      code: 'NOT_FOUND',
      message: 'Endpoint không tồn tại.'
    });
  }
}

module.exports = CandidateManualEntryController;
