const path = require('node:path');
const fs = require('node:fs');
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
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
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
        const page = Math.max(1, parseInt(parsedUrl.searchParams.get('page') || '1', 10));
        const pageSize = Math.max(1, Math.min(50, parseInt(parsedUrl.searchParams.get('pageSize') || '10', 10)));
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


      return this.send(res, 404, { success: false, code: 'NOT_FOUND', message: 'Tài nguyên không tồn tại.' });
    } catch (err) {
      console.error('[CandidatePortalController Error]', err);
      return this.send(res, err.statusCode || 500, {
        success: false,
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Đã có lỗi xảy ra.'
      });
    }
  }
}

module.exports = CandidatePortalController;
