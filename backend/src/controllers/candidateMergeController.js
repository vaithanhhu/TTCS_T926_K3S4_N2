const CandidateMergeService = require('../services/candidateMergeService');

class CandidateMergeController {
  constructor(db, rbac, auth) { this.service = new CandidateMergeService(db); this.rbac = rbac; this.auth = auth; }
  send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  async handle(req, res, url, parseBody) {
    try {
      const path = url.pathname.replace(/^\/api\/v1/, '');
      if (req.method === 'GET' && path === '/candidates/merge/recent') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.merge.undo'); if (!user) return;
        return this.send(res, 200, { success: true, data: await this.service.recent(user) });
      }
      if (req.method === 'POST' && path === '/candidates/merge/compare') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.read'); if (!user) return;
        const body = await parseBody(req);
        return this.send(res, 200, { success: true, data: await this.service.compare(body.firstId, body.secondId, user) });
      }
      if (req.method === 'POST' && path === '/candidates/merge') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.merge'); if (!user) return;
        return this.send(res, 200, await this.service.merge(await parseBody(req), user));
      }
      const undo = path.match(/^\/candidates\/merge\/([^/]+)\/undo$/);
      if (req.method === 'POST' && undo) {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.merge.undo'); if (!user) return;
        return this.send(res, 200, await this.service.undo(decodeURIComponent(undo[1]), user));
      }
      return this.send(res, 404, { success: false, code: 'NOT_FOUND', message: 'Không tìm thấy thao tác gộp hồ sơ.' });
    } catch (error) {
      if (error instanceof CandidateMergeService.CandidateMergeError) return this.send(res, error.statusCode, { success: false, code: error.code, message: error.message });
      if (error instanceof URIError || error.message === 'Invalid JSON') return this.send(res, 400, { success: false, code: 'BAD_REQUEST', message: 'Dữ liệu gửi lên không hợp lệ.' });
      console.error('[CandidateMergeController]', error.code || error.message);
      return this.send(res, 500, { success: false, code: 'CANDIDATE_MERGE_FAILED', message: 'Không thể xử lý gộp hồ sơ. Vui lòng tải lại và thử lại.' });
    }
  }
}
module.exports = CandidateMergeController;
