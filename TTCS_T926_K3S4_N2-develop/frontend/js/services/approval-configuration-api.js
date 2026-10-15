(function () {
  async function request(path = '', method = 'GET', body) {
    const token = sessionStorage.getItem('ats_token');
    try {
      const response = await fetch('/api/v1/approval-configurations' + path, { method,
        headers: { Authorization: token ? 'Bearer ' + token : '', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { ok: response.ok, status: response.status, data: await response.json() };
    } catch { return { ok: false, status: 0, data: { message: 'Không thể kết nối để tải cấu hình phê duyệt.' } }; }
  }
  window.ATS_APPROVAL_CONFIGURATION_API = { request };
})();
