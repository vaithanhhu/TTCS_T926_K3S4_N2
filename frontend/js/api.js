/**
 * ATS API Client
 */
const API_BASE = (function() {
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port;
    // If opened directly from file system (file://) or from another local dev server (e.g. Live Server on port 5500)
    if (proto === 'file:' || ((host === 'localhost' || host === '127.0.0.1') && port && port !== '5050')) {
      return 'http://localhost:5050/api/v1';
    }
  }
  return '/api/v1';
})();

async function loginApi(email, password) {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    return {
      status: response.status,
      ok: response.ok,
      data
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      data: {
        success: false,
        message: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng hoặc backend service.',
        code: 'NETWORK_ERROR'
      }
    };
  }
}

async function logoutApi(token) {
  try {
    const response = await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });

    const data = await response.json();
    return {
      status: response.status,
      ok: response.ok,
      data
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      data: {
        success: false,
        message: 'Lỗi mạng khi đăng xuất.',
        code: 'NETWORK_ERROR'
      }
    };
  }
}

async function getMeApi(token) {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });

    const data = await response.json();
    return {
      status: response.status,
      ok: response.ok,
      data
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      data: {
        success: false,
        message: 'Lỗi mạng khi kiểm tra phiên.',
        code: 'NETWORK_ERROR'
      }
    };
  }
}

async function forgotPasswordApi(email) {
  try {
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gửi yêu cầu quên mật khẩu.' } };
  }
}

async function verifyOtpApi(email, otp) {
  try {
    const response = await fetch(`${API_BASE}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi xác thực OTP.' } };
  }
}

async function resendOtpApi(email) {
  try {
    const response = await fetch(`${API_BASE}/auth/resend-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gửi lại OTP.' } };
  }
}

async function resetPasswordApi(token, newPassword, email, otp) {
  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword, email, otp })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi đặt lại mật khẩu.' } };
  }
}

async function changePasswordApi(token, currentPassword, newPassword) {
  try {
    const response = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi đổi mật khẩu.' } };
  }
}

async function getPermissionsApi(token) {
  try {
    const response = await fetch(`${API_BASE}/auth/permissions`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy danh sách quyền.' } };
  }
}

async function getRbacMatrixApi() {
  try {
    const response = await fetch(`${API_BASE}/rbac/matrix`, { method: 'GET' });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy ma trận RBAC.' } };
  }
}

async function testCreateUserApi(token) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/test-create`, {
      method: 'POST',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gọi test create user.' } };
  }
}

async function testCandidateListApi(token) {
  try {
    const response = await fetch(`${API_BASE}/recruitment/candidates/test-list`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gọi test candidate list.' } };
  }
}

async function testInterviewListApi(token) {
  try {
    const response = await fetch(`${API_BASE}/interviews/test-list`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gọi test interview list.' } };
  }
}

async function getNavigationMenuApi(token) {
  try {
    const response = await fetch(`${API_BASE}/navigation/menu`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy menu điều hướng.' } };
  }
}

async function testNotFoundApi() {
  try {
    const response = await fetch(`${API_BASE}/routes/not-found-endpoint-demo`, {
      method: 'GET'
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gọi route không tồn tại.' } };
  }
}

async function getUsersApi(token, params = {}) {
  try {
    const qs = new URLSearchParams();
    if (params.page) qs.append('page', params.page);
    if (params.limit) qs.append('limit', params.limit);
    if (params.search) qs.append('search', params.search);
    if (params.role) qs.append('role', params.role);
    if (params.status) qs.append('status', params.status);

    const response = await fetch(`${API_BASE}/admin/users?${qs.toString()}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy danh sách người dùng.' } };
  }
}

async function getUserByIdApi(token, id) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${id}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy thông tin người dùng.' } };
  }
}

async function createUserApi(token, userData) {
  try {
    const response = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(userData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi tạo tài khoản người dùng.' } };
  }
}

async function updateUserApi(token, id, userData) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(userData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi cập nhật thông tin người dùng.' } };
  }
}

async function getAdminRolesApi(token) {
  try {
    const response = await fetch(`${API_BASE}/admin/roles/list`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy danh mục vai trò.' } };
  }
}

async function getUserRolesApi(token, userId) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy vai trò người dùng.' } };
  }
}

async function assignUserRolesApi(token, userId, roles) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ roles })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi gán vai trò người dùng.' } };
  }
}

async function lockUserApi(token, userId, reason) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${userId}/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ reason })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi khóa tài khoản.' } };
  }
}

async function unlockUserApi(token, userId) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${userId}/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi mở khóa tài khoản.' } };
  }
}

async function getDashboardStatsApi(token) {
  try {
    const response = await fetch(`${API_BASE}/dashboard/stats`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy số liệu thống kê.' } };
  }
}

async function getRequisitionsApi(token, params = {}) {
  try {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.status && params.status !== 'ALL') query.append('status', params.status);
    if (params.handoverOnly) query.append('handoverOnly', 'true');
    const qs = query.toString() ? `?${query.toString()}` : '';

    const response = await fetch(`${API_BASE}/requisitions${qs}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy danh sách vị trí tuyển dụng.' } };
  }
}

async function createRequisitionApi(token, reqData) {
  try {
    const response = await fetch(`${API_BASE}/requisitions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(reqData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi khởi tạo vị trí tuyển dụng.' } };
  }
}

async function reassignHandoverApi(token, reqId, newRecruiterId, notes) {
  try {
    const response = await fetch(`${API_BASE}/requisitions/${reqId}/handover`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ newRecruiterId, notes })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi bàn giao vị trí tuyển dụng.' } };
  }
}

async function getEmailLogsApi(token) {
  try {
    const response = await fetch(`${API_BASE}/admin/email-logs`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy nhật ký email.' } };
  }
}

async function getAuditLogsApi(token, params = {}) {
  try {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.status && params.status !== 'ALL') qs.append('status', params.status);
    if (params.limit) qs.append('limit', params.limit);
    const queryString = qs.toString() ? `?${qs.toString()}` : '';

    const response = await fetch(`${API_BASE}/admin/audit-logs${queryString}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy nhật ký bảo mật.' } };
  }
}

async function getAuditLogDetailApi(token, logId) {
  try {
    const response = await fetch(`${API_BASE}/admin/audit-logs/${encodeURIComponent(logId)}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy chi tiết nhật ký.' } };
  }
}

async function getCandidatesApi(token, params = {}) {
  try {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.stage && params.stage !== 'ALL') qs.append('stage', params.stage);
    if (params.requisitionId && params.requisitionId !== 'ALL') qs.append('requisitionId', params.requisitionId);
    const queryString = qs.toString() ? `?${qs.toString()}` : '';

    const response = await fetch(`${API_BASE}/candidates${queryString}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy danh sách ứng viên.' } };
  }
}

async function getInterviewsApi(token) {
  try {
    const response = await fetch(`${API_BASE}/interviews`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy lịch phỏng vấn.' } };
  }
}

async function getOffersApi(token) {
  try {
    const response = await fetch(`${API_BASE}/offers`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy danh sách offer.' } };
  }
}

async function getRecruitmentReportsApi(token) {
  try {
    const response = await fetch(`${API_BASE}/reports/recruitment`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy báo cáo tuyển dụng.' } };
  }
}

async function createCandidateApi(token, candidateData) {
  try {
    const response = await fetch(`${API_BASE}/candidates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(candidateData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi tạo hồ sơ ứng viên.' } };
  }
}

async function updateCandidateStageApi(token, id, stage) {
  try {
    const response = await fetch(`${API_BASE}/candidates/${id}/stage`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ stage })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi cập nhật vòng tuyển dụng.' } };
  }
}

async function createInterviewApi(token, interviewData) {
  try {
    const response = await fetch(`${API_BASE}/interviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(interviewData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lên lịch phỏng vấn.' } };
  }
}

async function updateInterviewStatusApi(token, id, status, feedback, score) {
  try {
    const response = await fetch(`${API_BASE}/interviews/${id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ status, feedback, score })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi cập nhật buổi phỏng vấn.' } };
  }
}

async function createOfferApi(token, offerData) {
  try {
    const response = await fetch(`${API_BASE}/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(offerData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi tạo bản đề xuất offer.' } };
  }
}

async function updateOfferStatusApi(token, id, status) {
  try {
    const response = await fetch(`${API_BASE}/offers/${id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ status })
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi cập nhật trạng thái offer.' } };
  }
}

async function getRequisitionByIdApi(token, id) {
  try {
    const response = await fetch(`${API_BASE}/requisitions/${id}`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi lấy chi tiết vị trí tuyển dụng.' } };
  }
}

async function updateRequisitionApi(token, id, reqData) {
  try {
    const response = await fetch(`${API_BASE}/requisitions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(reqData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi cập nhật vị trí tuyển dụng.' } };
  }
}

async function resetUserPasswordApi(token, userId) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi đặt lại mật khẩu.' } };
  }
}

async function deleteUserApi(token, userId) {
  try {
    const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi xóa tài khoản.' } };
  }
}

async function getProfileApi(token) {
  try {
    const response = await fetch(`${API_BASE}/profile`, {
      method: 'GET',
      headers: { 'Authorization': token ? `Bearer ${token}` : '' }
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi tải hồ sơ.' } };
  }
}

async function updateProfileApi(token, profileData) {
  try {
    const response = await fetch(`${API_BASE}/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(profileData)
    });
    const data = await response.json();
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: { success: false, message: 'Lỗi kết nối khi cập nhật hồ sơ.' } };
  }
}

window.ATS_API = {
  loginApi,
  logoutApi,
  getMeApi,
  forgotPasswordApi,
  requestPasswordResetApi: forgotPasswordApi,
  verifyOtpApi,
  resendOtpApi,
  resetPasswordApi,
  confirmPasswordResetApi: resetPasswordApi,
  changePasswordApi,
  getPermissionsApi,
  getRbacMatrixApi,
  getRolesMatrixApi: getRbacMatrixApi,
  testCreateUserApi,
  testCandidateListApi,
  testInterviewListApi,
  getNavigationMenuApi,
  testNotFoundApi,
  getUsersApi,
  getUserByIdApi,
  createUserApi,
  updateUserApi,
  resetUserPasswordApi,
  deleteUserApi,
  getAdminRolesApi,
  getUserRolesApi,
  assignUserRolesApi,
  lockUserApi,
  unlockUserApi,
  getDashboardStatsApi,
  getDashboardStats: getDashboardStatsApi,
  getRequisitionsApi,
  getRequisitions: getRequisitionsApi,
  getRequisitionByIdApi,
  updateRequisitionApi,
  createRequisitionApi,
  createRequisition: createRequisitionApi,
  reassignHandoverApi,
  handoverRequisition: reassignHandoverApi,
  getEmailLogsApi,
  getAuditLogsApi,
  getAuditLogDetailApi,
  getCandidatesApi,
  createCandidateApi,
  updateCandidateStageApi,
  getInterviewsApi,
  createInterviewApi,
  updateInterviewStatusApi,
  getOffersApi,
  createOfferApi,
  updateOfferStatusApi,
  getRecruitmentReportsApi,
  getProfileApi,
  updateProfileApi
};


