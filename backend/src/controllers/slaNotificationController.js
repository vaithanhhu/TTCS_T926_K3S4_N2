/**
 * ==============================================================================
 * USER STORY S5-10 (SCRUM-120) - CANDIDATE SLA NOTIFICATION CONTROLLER
 * ==============================================================================
 * 
 * Endpoints:
 *   • GET  /api/v1/sla/configs             : Xem danh sách cấu hình ngưỡng SLA
 *   • PUT  /api/v1/sla/configs             : Cập nhật cấu hình ngưỡng SLA theo stage
 *   • GET  /api/v1/sla/overdue-candidates  : Lấy danh sách hồ sơ quá hạn SLA
 *   • GET  /api/v1/sla/reminders           : Lấy danh sách nhắc việc của Recruiter
 *   • PUT  /api/v1/sla/reminders/:id/read  : Đánh dấu nhắc việc là đã đọc
 *   • PUT  /api/v1/sla/reminders/read-all  : Đánh dấu tất cả nhắc việc là đã đọc
 *   • POST /api/v1/sla/check               : Chạy tác vụ quét định kỳ kiểm tra quá hạn
 *   • GET  /api/v1/sla/summary             : Thống kê tổng quan tình trạng SLA
 * ==============================================================================
 */

class SlaNotificationController {
  constructor(slaService, rbacMiddleware, authService) {
    this.service = slaService;
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
      // 1. GET /api/v1/sla/configs (Lấy cấu hình ngưỡng SLA)
      if (pathname === '/api/v1/sla/configs' && method === 'GET') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const reqId = parsedUrl.searchParams.get('requisitionId') || null;
        const result = await this.service.getSlaConfigurations(reqId);
        return this.send(res, result.statusCode || 200, result);
      }

      // 2. PUT /api/v1/sla/configs (Cập nhật cấu hình ngưỡng SLA)
      if (pathname === '/api/v1/sla/configs' && (method === 'PUT' || method === 'POST')) {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'requisition.edit');
        if (!user) return;

        let body = {};
        if (typeof parseBody === 'function') {
          body = await parseBody(req);
        }
        const configs = Array.isArray(body) ? body : (body.configs || []);
        const reqId = body.requisitionId || parsedUrl.searchParams.get('requisitionId') || null;

        const result = await this.service.updateSlaConfigurations(configs, user, reqId);
        return this.send(res, result.statusCode || 200, result);
      }

      // 3. GET /api/v1/sla/overdue-candidates (Lấy danh sách hồ sơ quá hạn SLA)
      if (pathname === '/api/v1/sla/overdue-candidates' && method === 'GET') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const options = {
          requisitionId: parsedUrl.searchParams.get('requisitionId') || 'ALL',
          stage: parsedUrl.searchParams.get('stage') || 'ALL',
          search: parsedUrl.searchParams.get('search') || '',
          referenceDate: parsedUrl.searchParams.get('referenceDate') || null,
          includeAll: parsedUrl.searchParams.get('includeAll') === 'true'
        };

        const result = await this.service.getOverdueCandidates(user, options);
        return this.send(res, result.statusCode || 200, result);
      }

      // 4. GET /api/v1/sla/reminders (Lấy danh sách nhắc việc của recruiter)
      if (pathname === '/api/v1/sla/reminders' && method === 'GET') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const options = {
          unreadOnly: parsedUrl.searchParams.get('unreadOnly') === 'true',
          limit: parsedUrl.searchParams.get('limit') || 50
        };

        const result = await this.service.getRecruiterReminders(user, options);
        return this.send(res, result.statusCode || 200, result);
      }

      // 5. PUT /api/v1/sla/reminders/read-all (Đánh dấu tất cả nhắc việc là đã đọc)
      if (pathname === '/api/v1/sla/reminders/read-all' && (method === 'PUT' || method === 'POST')) {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const result = await this.service.markAllRemindersAsRead(user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 6. PUT /api/v1/sla/reminders/:id/read (Đánh dấu 1 nhắc việc là đã đọc)
      const matchReminderRead = pathname.match(/^\/api\/v1\/sla\/reminders\/([^/]+)\/read$/);
      if (matchReminderRead && (method === 'PUT' || method === 'POST')) {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const reminderId = decodeURIComponent(matchReminderRead[1]);
        const result = await this.service.markReminderAsRead(reminderId, user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 7. POST /api/v1/sla/check (Chạy tác vụ quét định kỳ hàng ngày, không nhắc trùng trong cùng ngày)
      if (pathname === '/api/v1/sla/check' && method === 'POST') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        let body = {};
        if (typeof parseBody === 'function') {
          try { body = await parseBody(req); } catch { body = {}; }
        }

        const targetDate = body.date || parsedUrl.searchParams.get('date') || null;
        const result = await this.service.runDailySlaCheck(targetDate, user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 8. GET /api/v1/sla/summary (Thống kê tổng quan SLA)
      if (pathname === '/api/v1/sla/summary' && method === 'GET') {
        const user = await this.rbacMiddleware.authorize(req, res, this.authService, 'candidate.read');
        if (!user) return;

        const result = await this.service.getSlaSummary(user);
        return this.send(res, result.statusCode || 200, result);
      }

      // 404 cho SLA router
      return this.send(res, 404, {
        success: false,
        statusCode: 404,
        code: 'SLA_ENDPOINT_NOT_FOUND',
        message: 'Endpoint SLA không tồn tại.'
      });
    } catch (err) {
      console.error('[SlaNotificationController] Error:', err);
      return this.send(res, 500, {
        success: false,
        statusCode: 500,
        code: 'SLA_INTERNAL_ERROR',
        message: 'Lỗi máy chủ nội bộ trong xử lý SLA: ' + err.message
      });
    }
  }
}

module.exports = SlaNotificationController;
