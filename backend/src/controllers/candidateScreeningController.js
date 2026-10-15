/**
 * ==============================================================================
 * USER STORY S5-09 (SCRUM-119) - CANDIDATE SCREENING CONTROLLER
 * ==============================================================================
 * 
 * Endpoints:
 *   • GET  /api/v1/requisitions/:id/screening-criteria : Xem tiêu chí bắt buộc
 *   • PUT  /api/v1/requisitions/:id/screening-criteria : Khai báo tiêu chí bắt buộc
 *   • POST /api/v1/candidates/:id/screen               : Chấm điểm 1 hồ sơ
 *   • POST /api/v1/requisitions/:id/screen-all         : Chấm điểm toàn bộ hồ sơ
 *   • GET  /api/v1/requisitions/:id/screening-candidates : Danh sách hồ sơ xếp theo điểm
 * ==============================================================================
 */
class CandidateScreeningController {
  constructor(screeningService, rbacMiddleware, authService) {
    this.service = screeningService;
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

    try {
      // 1. GET /api/v1/requisitions/:id/screening-criteria
      const matchGetCriteria = pathname.match(/^\/api\/v1\/requisitions\/([^/]+)\/screening-criteria$/);
      if (matchGetCriteria && method === 'GET') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'requisition.read');
        if (!user) return;

        const requisitionId = decodeURIComponent(matchGetCriteria[1]);
        const result = await this.service.getRequisitionCriteria(requisitionId, user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 2. PUT hoặc POST /api/v1/requisitions/:id/screening-criteria
      const matchSetCriteria = pathname.match(/^\/api\/v1\/requisitions\/([^/]+)\/screening-criteria$/);
      if (matchSetCriteria && (method === 'PUT' || method === 'POST')) {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'requisition.edit');
        if (!user) return;

        const requisitionId = decodeURIComponent(matchSetCriteria[1]);
        let body = {};
        if (typeof parseBody === 'function') {
          body = await parseBody(req);
        }
        const result = await this.service.setRequisitionCriteria(requisitionId, body, user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 3. POST /api/v1/candidates/:id/screen (Chấm điểm 1 hồ sơ cụ thể)
      const matchScreenOne = pathname.match(/^\/api\/v1\/candidates\/([^/]+)\/screen$/);
      if (matchScreenOne && method === 'POST') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.update');
        if (!user) return;

        const candidateId = decodeURIComponent(matchScreenOne[1]);
        const result = await this.service.screenCandidate(candidateId, user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 4. POST /api/v1/requisitions/:id/screen-all (Chấm điểm toàn bộ hồ sơ trong vị trí)
      const matchScreenAll = pathname.match(/^\/api\/v1\/requisitions\/([^/]+)\/screen-all$/);
      if (matchScreenAll && method === 'POST') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.update');
        if (!user) return;

        const requisitionId = decodeURIComponent(matchScreenAll[1]);
        const result = await this.service.screenRequisitionCandidates(requisitionId, user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 5. GET /api/v1/requisitions/:id/screening-candidates (Danh sách ứng viên ưu tiên theo điểm)
      const matchRanked = pathname.match(/^\/api\/v1\/requisitions\/([^/]+)\/screening-candidates$/);
      if (matchRanked && method === 'GET') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const requisitionId = decodeURIComponent(matchRanked[1]);
        const options = {
          filter: parsedUrl.searchParams.get('filter') || 'all',
          stage: parsedUrl.searchParams.get('stage') || 'ALL',
          sortBy: parsedUrl.searchParams.get('sortBy') || 'fit_score_desc'
        };

        const result = await this.service.getCandidatesRankedByScreening(requisitionId, user, options);
        return this.send(res, result.statusCode || 200, result);
      }

      // Endpoint không khớp
      return this.send(res, 404, {
        success: false,
        code: 'NOT_FOUND',
        message: 'Endpoint không tồn tại.'
      });
    } catch (err) {
      console.error('[CandidateScreeningController Error]', err);
      return this.send(res, 500, {
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Lỗi máy chủ khi xử lý sàng lọc hồ sơ ứng viên.'
      });
    }
  }
}

module.exports = CandidateScreeningController;

