const { ApprovalConfigurationError } = require('../services/approvalConfigurationService');

class ApprovalConfigurationController {
  constructor(service, rbac, auth) { this.service = service; this.rbac = rbac; this.auth = auth; }

  async handle(req, res, url, readBody) {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const user = await this.rbac.authorize(req, res, this.auth, 'approval_configuration.manage');
    if (!user) return;
    const parts = url.pathname.slice('/api/v1/approval-configurations'.length).split('/').filter(Boolean);
    try {
      let data, status = 200;
      if (req.method === 'GET' && !parts.length) data = await this.service.list();
      else if (req.method === 'GET' && parts.length === 1 && parts[0] === 'options') data = { departments: await this.service.departments(), approvers: await this.service.eligibleApprovers() };
      else if (req.method === 'POST' && parts.length === 1 && parts[0] === 'resolve') {
        const body = await readBody(req);
        if (!body || typeof body !== 'object') throw new ApprovalConfigurationError('INVALID_APPROVAL_CONFIGURATION', 'Dữ liệu kiểm tra phải là một đối tượng hợp lệ.');
        data = await this.service.resolve(body.departmentId, body.proposedSalaryMax);
      } else if (req.method === 'GET' && parts.length === 1) data = await this.service.get(parts[0]);
      else if (req.method === 'POST' && !parts.length) { data = await this.service.create(await readBody(req), user.id); status = 201; }
      else if (req.method === 'POST' && parts.length === 2 && parts[1] === 'versions') { data = await this.service.newVersion(parts[0], await readBody(req), user.id); status = 201; }
      else if (req.method === 'POST' && parts.length === 4 && parts[1] === 'versions' && parts[3] === 'publish') data = await this.service.publish(parts[0], parts[2], user.id);
      else { send(404, { success: false, code: 'APPROVAL_ENDPOINT_NOT_FOUND', message: 'Không tìm thấy chức năng cấu hình phê duyệt.' }); return; }
      send(status, { success: true, data });
    } catch (error) {
      if (error instanceof ApprovalConfigurationError) send(error.statusCode, { success: false, code: error.code, message: error.message });
      else if (error instanceof SyntaxError || error.message === 'Invalid JSON') send(400, { success: false, code: 'BAD_REQUEST', message: 'Dữ liệu yêu cầu không hợp lệ.' });
      else send(500, { success: false, code: 'APPROVAL_CONFIGURATION_ERROR', message: 'Không thể xử lý cấu hình phê duyệt. Vui lòng thử lại.' });
    }
  }
}

module.exports = ApprovalConfigurationController;
