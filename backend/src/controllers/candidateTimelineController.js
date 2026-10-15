/**
 * SCRUM-117 (S5-07): Candidate Timeline Controller
 * 
 * Endpoint: GET /api/v1/candidates/:id/timeline
 * Phân quyền: Yêu cầu 'candidate.read' kết hợp kiểm tra IDOR trong Service.
 */
class CandidateTimelineController {
  constructor(candidateTimelineService, rbacMiddleware, authService) {
    this.timelineService = candidateTimelineService;
    this.rbacMiddleware = rbacMiddleware;
    this.authService = authService;
  }

  async handle(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname;

    // Pattern: /api/v1/candidates/:candidateId/timeline
    const match = pathname.match(/^\/api\/v1\/candidates\/([^/]+)\/timeline$/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        code: 'NOT_FOUND',
        message: 'Endpoint không tồn tại.'
      }));
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Phương thức không được hỗ trợ.'
      }));
      return;
    }

    // 1. Kiểm tra xác thực và quyền candidate.read
    const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
    if (!user) return; // rbacMiddleware đã tự writeHead 401 hoặc 403

    // 2. Lấy candidateId từ URL
    let candidateId;
    try {
      candidateId = decodeURIComponent(match[1]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        code: 'BAD_REQUEST',
        message: 'Mã ứng viên không hợp lệ.'
      }));
      return;
    }

    // 3. Thực thi lấy nhật ký tương tác
    try {
      const result = await this.timelineService.getCandidateTimeline(candidateId, user);
      res.writeHead(result.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[CandidateTimelineController Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Lỗi máy chủ khi lấy nhật ký tương tác ứng viên.'
      }));
    }
  }
}

module.exports = CandidateTimelineController;

