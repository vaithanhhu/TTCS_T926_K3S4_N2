const CandidateStageService = require('../services/candidateStageService');

class CandidateStageController {
  constructor(db, rbacMiddleware, authService) {
    this.db = db;
    this.rbac = rbacMiddleware;
    this.authService = authService;
    this.stageService = new CandidateStageService(db);
  }

  async handle(req, res, parsedUrl, parseBody) {
    const { pathname } = parsedUrl;
    const method = req.method;

    // Helper to send JSON response
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    try {
      // 1. GET Rejection Reasons Catalog
      if (method === 'GET' && (
        pathname === '/api/v1/recruitment-catalogs/rejection-reasons' ||
        pathname === '/recruitment-catalogs/rejection-reasons'
      )) {
        const user = await this.rbac.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;
        const reasons = await this.stageService.getRejectionReasons();
        return sendJson(200, { success: true, items: reasons });
      }

      // 2. GET Candidate Stage History
      const historyMatch = pathname.match(/^\/(?:api\/v1\/)?candidates\/([^/]+)\/(?:history|stage-history)$/);
      if (method === 'GET' && historyMatch) {
        const user = await this.rbac.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;
        const candidateId = decodeURIComponent(historyMatch[1]);
        const result = await this.stageService.getCandidateHistory(candidateId, user);
        return sendJson(result.statusCode || 200, result);
      }

      // 3. POST Candidate Stage Exception Request (Recruiter requests interview skip)
      const requestExceptionMatch = pathname.match(/^\/(?:api\/v1\/)?candidates\/([^/]+)\/stage-exception-request$/);
      if (method === 'POST' && requestExceptionMatch) {
        const user = await this.rbac.authorize(req, res, this.authService, 'candidate.update');
        if (!user) return;
        const candidateId = decodeURIComponent(requestExceptionMatch[1]);
        const body = await parseBody(req);
        const result = await this.stageService.requestInterviewSkipException(candidateId, body?.reason, user);
        return sendJson(result.statusCode || 200, result);
      }

      // 4. GET Candidate Stage Exceptions list
      const exceptionsListMatch = pathname.match(/^\/(?:api\/v1\/)?candidates\/([^/]+)\/stage-exceptions$/);
      if (method === 'GET' && exceptionsListMatch) {
        const user = await this.rbac.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;
        const candidateId = decodeURIComponent(exceptionsListMatch[1]);
        const result = await this.stageService.getCandidateExceptions(candidateId, user);
        return sendJson(result.statusCode || 200, result);
      }

      // 5. POST Decide Stage Exception (HR Manager approves or rejects)
      const decideMatch = pathname.match(/^\/(?:api\/v1\/)?stage-exceptions\/([^/]+)\/decide$/);
      if (method === 'POST' && decideMatch) {
        const user = await this.rbac.authorize(req, res, this.authService, 'candidate.update');
        if (!user) return;
        const exceptionId = decodeURIComponent(decideMatch[1]);
        const body = await parseBody(req);
        const result = await this.stageService.decideInterviewSkipException(
          exceptionId,
          body?.action,
          body?.comment,
          user
        );
        return sendJson(result.statusCode || 200, result);
      }

      // Route not handled by this controller
      return false;
    } catch (err) {
      return sendJson(500, {
        success: false,
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Lỗi xử lý yêu cầu chuyển giai đoạn.'
      });
    }
  }
}

module.exports = CandidateStageController;
