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

async function resetPasswordApi(token, newPassword) {
  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
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

window.ATS_API = {
  loginApi,
  logoutApi,
  getMeApi,
  forgotPasswordApi,
  resetPasswordApi,
  changePasswordApi,
  getPermissionsApi,
  getRbacMatrixApi,
  testCreateUserApi,
  testCandidateListApi,
  testInterviewListApi,
  getNavigationMenuApi,
  testNotFoundApi,
  getUsersApi,
  getUserByIdApi,
  createUserApi,
  updateUserApi,
  getAdminRolesApi,
  getUserRolesApi,
  assignUserRolesApi,
  lockUserApi,
  unlockUserApi
};
