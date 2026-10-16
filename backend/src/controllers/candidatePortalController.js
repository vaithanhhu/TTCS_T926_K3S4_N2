const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream');
const { parseMultipartOrJson } = require('../utils/formParser');

class CandidatePortalController {
  constructor(service, rbac, auth) {
    this.service = service;
    this.rbac = rbac;
    this.auth = auth;
  }

  send(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
  }

  getClientIp(req) {
    return req.socket?.remoteAddress || '127.0.0.1';
  }

  async handle(req, res, parsedUrl, parseBody) {
    const pathname = parsedUrl.pathname;
    const method = req.method;

    try {
      // 1. S4-01 & S4-02: Public Job Postings List, Options & Detail
      if (pathname === '/api/v1/public/job-postings/options' && method === 'GET') {
        const publicationService = new (require('../services/jobPostingPublicationService'))(this.service.db);
        const options = await publicationService.publicOptions();
        return this.send(res, 200, { success: true, data: options });
      }

      if (pathname === '/api/v1/public/job-postings' && method === 'GET') {
        const query = {
          search: parsedUrl.searchParams.get('search') || '',
          department: parsedUrl.searchParams.get('department') || '',
          workLocation: parsedUrl.searchParams.get('workLocation') || parsedUrl.searchParams.get('location') || '',
          workMode: parsedUrl.searchParams.get('workMode') || parsedUrl.searchParams.get('mode') || ''
        };
        const publicationService = new (require('../services/jobPostingPublicationService'))(this.service.db);
        const all = await publicationService.publicList(query);
        const requestedPage = Number(parsedUrl.searchParams.get('page') || '1');
        const requestedSize = Number(parsedUrl.searchParams.get('pageSize') || '10');
        const page = Number.isSafeInteger(requestedPage) ? Math.max(1,requestedPage) : 1;
        const pageSize = Number.isSafeInteger(requestedSize) ? Math.max(1,Math.min(50,requestedSize)) : 10;
        const total = all.length;
        const items = all.slice((page - 1) * pageSize, page * pageSize);
        return this.send(res, 200, {
          success: true,
          data: items,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize) || 1
          }
        });
      }

      if (pathname.startsWith('/api/v1/public/job-postings/') && method === 'GET') {
        const id = decodeURIComponent(pathname.slice('/api/v1/public/job-postings/'.length));
        const publicationService = new (require('../services/jobPostingPublicationService'))(this.service.db);
        const items = await publicationService.publicList(id);
        if (!items || !items.length) {
          return this.send(res, 404, {
            success: false,
            code: 'JOB_POSTING_NOT_FOUND_OR_EXPIRED',
            message: 'Tin tuyển dụng không tồn tại, đã hết hạn hoặc đã bị gỡ.'
          });
        }
        return this.send(res, 200, { success: true, data: items[0] });
      }

      // 2. S4-03: Apply Job (Upload CV, Honeypot, Rate Limit, Tracking Code, Email)
      if (pathname === '/api/v1/public/applications' && method === 'POST') {
        const ipAddress = this.getClientIp(req);
        const { fields, file } = await parseMultipartOrJson(req);
        const result = await this.service.submitApplication(fields, file, ipAddress);
        return this.send(res, result.statusCode || (result.success ? 201 : 400), result);
      }

      // 3. S4-05: Lookup Application Status (Tracking Code + Email, Rate Limited, 4 mapped stages)
      if (pathname === '/api/v1/public/applications/status' && method === 'POST') {
        const ipAddress = this.getClientIp(req);
        const body = await parseBody(req);
        const result = await this.service.lookupStatus(body, ipAddress);
        return this.send(res, result.statusCode || (result.success ? 200 : 400), result);
      }

      // 4. S4-06: Withdraw Application (Secure Token)
      if (pathname === '/api/v1/public/applications/withdraw' && method === 'POST') {
        const body = await parseBody(req);
        const result = await this.service.withdrawApplication(body);
        return this.send(res, result.statusCode || (result.success ? 200 : 400), result);
      }

      // 5. S4-07: Internal Candidate Referral (Employee actor)
      if (pathname === '/api/v1/candidates/refer' && method === 'POST') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.refer');
        if (!user) return;
        const { fields, file } = await parseMultipartOrJson(req);
        const result = await this.service.referCandidate(fields, file, user);
        return this.send(res, result.statusCode || (result.success ? 201 : 400), result);
      }

      if (pathname === '/api/v1/candidates/my-referrals' && method === 'GET') {
        const user = await this.rbac.authorize(req, res, this.auth);
        if (!user) return;
        const result = await this.service.getMyReferrals(user);
        return this.send(res, 200, { success: true, data: result });
      }

      // 6. S4-04: Parse CV PDF (Recruiter only, non-destructive preview)
      if (/^\/api\/v1\/candidates\/[^/]+\/parse-cv$/.test(pathname) && method === 'POST') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.cv.parse');
        if (!user) return;
        const candidateId = decodeURIComponent(pathname.split('/')[4]);
        const body = await parseBody(req).catch(() => ({}));
        const result = await this.service.parseCvPdf(candidateId, body?.documentId, user);
        return this.send(res, result.statusCode || (result.success ? 200 : 400), result);
      }

      // 7. S4-08: Expire Overdue Jobs (Admin/Cron background task)
      if (pathname === '/api/v1/admin/expire-overdue-jobs' && method === 'POST') {
        try {
          const user = await this.rbac.authorize(req, res, this.auth, 'job_posting.manage');
          if (!user) return;
          const actor = await this.rbac.getAuthorizedActor(user.id, 'job_posting.manage');
          if (!actor || !actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) {
            return this.send(res, 403, { success: false, statusCode: 403, code: 'GLOBAL_JOB_EXPIRY_FORBIDDEN', message: 'Bạn không có quyền thực hiện tác vụ hết hạn tin toàn hệ thống.' });
          }
          const result = await this.service.expireOverdueJobs(actor);
          if (result.success === false) return this.send(res, result.statusCode || 403, result);
          return this.send(res, 200, { success: true, data: result });
        } catch {
          return this.send(res, 500, { success: false, code: 'GLOBAL_JOB_EXPIRY_FAILED', message: 'Không thể hoàn tất tác vụ hết hạn tin. Vui lòng thử lại.' });
        }
      }

      // 8. S4-09: Unified Candidate Profile & Details (IDOR checked)
      if (/^\/api\/v1\/candidates\/unified\/[^/]+$/.test(pathname) && method === 'GET') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.read');
        if (!user) return;
        const candidateId = decodeURIComponent(pathname.split('/')[5]);
        const result = await this.service.getUnifiedProfile(candidateId, user);
        return this.send(res, result.statusCode || (result.success ? 200 : 403), result);
      }

      // 9. Notes & Tags on Candidate
      if (/^\/api\/v1\/candidates\/[^/]+\/notes$/.test(pathname) && method === 'POST') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.update');
        if (!user) return;
        const candidateId = decodeURIComponent(pathname.split('/')[4]);
        const body = await parseBody(req);
        const result = await this.service.addNote(candidateId, body?.noteText || body?.text, user);
        return this.send(res, result.statusCode || (result.success ? 201 : 400), result);
      }

      if (/^\/api\/v1\/candidates\/[^/]+\/tags$/.test(pathname) && method === 'POST') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.update');
        if (!user) return;
        const candidateId = decodeURIComponent(pathname.split('/')[4]);
        const body = await parseBody(req);
        const result = await this.service.addTag(candidateId, body?.tagName || body?.tag, user);
        return this.send(res, result.statusCode || (result.success ? 200 : 400), result);
      }

      if (/^\/api\/v1\/candidates\/[^/]+\/tags\/[^/]+$/.test(pathname) && method === 'DELETE') {
        const user = await this.rbac.authorize(req, res, this.auth, 'candidate.update');
        if (!user) return;
        const parts = pathname.split('/');
        const candidateId = decodeURIComponent(parts[4]);
        const tag = decodeURIComponent(parts[6]);
        const result = await this.service.removeTag(candidateId, tag, user);
        return this.send(res, result.statusCode || (result.success ? 200 : 400), result);
      }

      // 10. Document Download / Preview
      if (/^\/api\/v1\/candidates\/documents\/[^/]+\/download$/.test(pathname) && method === 'GET') {
        let user;
        try { user = await this.rbac.authorize(req, res, this.auth, 'candidate.read'); }
        catch {
          if (!res.headersSent && !res.destroyed) return this.send(res, 503, { success: false, message: 'Không thể tải tài liệu.' });
          return;
        }
        if (!user) return;
        let docId;
        try { docId = decodeURIComponent(pathname.split('/')[5]); }
        catch { return this.send(res, 400, { success: false, message: 'Mã tài liệu không hợp lệ.' }); }
        let docInfo;
        try {
          docInfo = await this.service.getCvDocument(docId, user);
          if (!docInfo.success) return this.send(res, docInfo.statusCode || 404, docInfo);
          if (req.aborted || res.destroyed) { await docInfo.close(); return; }
          const prepared = await docInfo.openStream();
          if (!prepared.success) return this.send(res, prepared.statusCode || 404, prepared);
          const stream = prepared.stream;
          const cleanup = () => { stream.destroy(); void docInfo.close(); };
          req.once('aborted', cleanup);
          res.once('close', cleanup);
          stream.once('error', () => { cleanup(); res.destroy(); });
          if (req.aborted || res.destroyed) { cleanup(); return; }
          const filename = String(docInfo.fileName || 'cv').toWellFormed().replace(/[\x00-\x1f\x7f/\\]/g, '_');
          const ascii = filename.replace(/[^a-zA-Z0-9._ -]/g, '_');
          const utf8 = encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
          res.writeHead(200, {
            'Content-Type': docInfo.mimeType,
            'Content-Length': docInfo.fileSize,
            'Content-Disposition': `${docInfo.mimeType === 'application/pdf' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`,
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Expose-Headers': 'Content-Disposition',
            'Cache-Control': 'no-store'
          });
          pipeline(stream, res, () => { req.removeListener('aborted', cleanup); void docInfo.close(); });
          return;
        } catch {
          await docInfo?.close?.();
          if (!res.headersSent && !res.destroyed) return this.send(res, 404, { success: false, message: 'Không tìm thấy tài liệu.' });
          res.destroy();
          return;
        }
      }

      return this.send(res, 404, { success: false, code: 'NOT_FOUND', message: 'Tài nguyên không tồn tại.' });
    } catch (err) {
      const status = err instanceof URIError ? 400 : Number.isInteger(err.statusCode) && err.statusCode>=400 && err.statusCode<600 ? err.statusCode : 500;
      console.error('[CandidatePortalController Error]',status>=500?'SERVER_ERROR':err.code||'BAD_REQUEST');
      return this.send(res, status, {
        success: false,
        code: status>=500?'SERVER_ERROR':err.code||'BAD_REQUEST',
        message: status>=500?'Đã có lỗi xảy ra. Vui lòng thử lại sau.':err instanceof URIError?'Mã tài nguyên không hợp lệ.':err.message||'Dữ liệu yêu cầu không hợp lệ.'
      });
    }
  }
}

module.exports = CandidatePortalController;
