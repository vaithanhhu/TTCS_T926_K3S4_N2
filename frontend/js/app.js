/**
 * INTERNAL RECRUITMENT SYSTEM (ATS) — CLIENT APPLICATION LOGIC
 * Architecture: Clean Vanilla JS, Reactive Events, Token-based Corporate Authentication
 * Design: Enterprise Light SaaS (Workday / Greenhouse standard)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ==============================================================================
  // 1. DOM REFERENCES & APPLICATION STATE
  // ==============================================================================

  // Auth & Login Elements
  const loginView = document.getElementById('login-view');
  const appShell = document.getElementById('app-shell');
  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');
  const alertBox = document.getElementById('alert-box');
  const alertIcon = document.getElementById('alert-icon');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const togglePwdBtn = document.getElementById('toggle-pwd-btn');
  const eyeIcon = document.getElementById('eye-icon');

  // Topbar & Navigation Elements
  const sidebar = document.getElementById('app-sidebar');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const breadcrumbCurrentView = document.getElementById('breadcrumb-current-view');
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuPopover = document.getElementById('user-menu-popover');
  const topbarUserName = document.getElementById('topbar-user-name');
  const topbarUserAvatar = document.getElementById('topbar-user-avatar');
  const popoverUserName = document.getElementById('popover-user-name');
  const popoverUserEmail = document.getElementById('popover-user-email');
  const sidebarUserName = document.getElementById('sidebar-user-name');
  const sidebarUserRole = document.getElementById('sidebar-user-role');
  const sidebarUserAvatar = document.getElementById('sidebar-user-avatar');
  const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const topbarCreateReqBtn = document.getElementById('topbar-create-req-btn');

  // View Containers
  const views = {
    dashboard: document.getElementById('dashboard-view'),
    requisitions: document.getElementById('requisitions-view'),
    candidates: document.getElementById('candidates-view'),
    interviews: document.getElementById('interviews-view'),
    offers: document.getElementById('offers-view'),
    approvals: document.getElementById('approvals-view'),
    reports: document.getElementById('reports-view'),
    users: document.getElementById('users-view'),
    roles: document.getElementById('roles-view'),
    audit: document.getElementById('audit-view'),
    profile: document.getElementById('profile-view'),
    candidatePortal: document.getElementById('candidate-portal-view'),
    error: document.getElementById('error-view')
  };

  // Toast Container
  const toastContainer = document.getElementById('toast-container');

  // Application State
  let currentAuthenticatedUser = null;
  let currentActiveView = 'dashboard';
  let heartbeatTimer = null;
  let currentRequisitionsList = [];
  let currentCandidatesList = [];
  let currentInterviewsList = [];
  let currentOffersList = [];

  // Role Mappings (Friendly Vietnamese Names)
  const ROLE_LABELS = {
    'ADMIN': 'Quản trị viên',
    'HR_MANAGER': 'Trưởng phòng Nhân sự',
    'RECRUITER': 'Chuyên viên Tuyển dụng',
    'HIRING_MGR': 'Trưởng bộ phận',
    'INTERVIEWER': 'Người phỏng vấn',
    'APPROVER': 'Cấp phê duyệt',
    'CANDIDATE': 'Ứng viên'
  };

  const STAGE_LABELS = {
    'APPLIED': 'Ứng tuyển',
    'SCREENING': 'Sơ loại',
    'INTERVIEW': 'Phỏng vấn',
    'OFFER': 'Đề nghị (Offer)',
    'HIRED': 'Đã nhận việc',
    'REJECTED': 'Từ chối'
  };

  const STAGE_BADGES = {
    'APPLIED': 'badge-neutral',
    'SCREENING': 'badge-primary',
    'INTERVIEW': 'badge-warning',
    'OFFER': 'badge-primary',
    'HIRED': 'badge-success',
    'REJECTED': 'badge-danger'
  };

  // ==============================================================================
  // 2. TOAST NOTIFICATIONS & ALERT HELPERS
  // ==============================================================================

  function showToast(type, title, message) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else if (type === 'danger') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
    `;

    toast.addEventListener('click', () => toast.remove());
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function showAlert(type, title, message) {
    if (!alertBox) return;
    alertBox.className = `alert-box alert-${type}`;
    if (alertTitle) alertTitle.textContent = title;
    if (alertMessage) alertMessage.textContent = message;
    alertBox.classList.remove('hidden');
  }

  function hideAlert() {
    if (alertBox) alertBox.classList.add('hidden');
  }

  // ==============================================================================
  // 3. AUTHENTICATION & LOGIN FLOW
  // ==============================================================================

  // Toggle Password Visibility
  if (togglePwdBtn && passwordInput && eyeIcon) {
    togglePwdBtn.addEventListener('click', () => {
      const isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      eyeIcon.innerHTML = isPassword
        ? `<path d="m9.88 9.88-6.84 6.84M2 12s3-7 10-7a9.7 9.7 0 0 1 5.09 1.45M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.46-1.68M15 15a3 3 0 1 1-4.24-4.24M2 2l20 20"/>`
        : `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>`;
    });
  }

  // Clear errors on typing
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      emailInput.classList.remove('is-invalid');
      if (emailError) emailError.textContent = '';
      hideAlert();
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener('input', () => {
      passwordInput.classList.remove('is-invalid');
      if (passwordError) passwordError.textContent = '';
      hideAlert();
    });
  }

  // Pre-fill remembered email
  const rememberMeCheckbox = document.getElementById('remember-me');
  try {
    const savedEmail = localStorage.getItem('ats_remember_email');
    if (savedEmail && emailInput) {
      emailInput.value = savedEmail;
      if (rememberMeCheckbox) rememberMeCheckbox.checked = true;
    }
  } catch {}

  function setLoginLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = isLoading;
    if (isLoading) {
      if (btnText) btnText.textContent = 'Đang xác thực...';
      if (btnSpinner) btnSpinner.classList.remove('hidden');
    } else {
      if (btnText) btnText.textContent = 'Đăng nhập';
      if (btnSpinner) btnSpinner.classList.add('hidden');
    }
  }

  // Login Submit Handler
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      let hasError = false;
      if (!email) {
        if (emailInput) emailInput.classList.add('is-invalid');
        if (emailError) emailError.textContent = 'Vui lòng nhập email công ty';
        hasError = true;
      }
      if (!password) {
        if (passwordInput) passwordInput.classList.add('is-invalid');
        if (passwordError) passwordError.textContent = 'Vui lòng nhập mật khẩu';
        hasError = true;
      }
      if (hasError) return;

      setLoginLoading(true);
      hideAlert();

      try {
        const res = await window.ATS_API.loginApi(email, password);
        setLoginLoading(false);

        if (res.ok && res.data && res.data.success) {
          const authData = res.data.data;
          sessionStorage.setItem('ats_token', authData.token);
          sessionStorage.setItem('ats_user', JSON.stringify(authData.user));
          sessionStorage.setItem('ats_expires_at', authData.expiresAt);

          try {
            if (rememberMeCheckbox && rememberMeCheckbox.checked) {
              localStorage.setItem('ats_remember_email', email);
            } else {
              localStorage.removeItem('ats_remember_email');
            }
          } catch {}

          setupAuthenticatedSession(authData.user);
          showToast('success', 'Đăng nhập thành công', `Chào mừng ${authData.user.fullName || authData.user.email} vào hệ thống.`);
        } else {
          const status = res.status;
          const msg = (res.data && res.data.message) ? res.data.message : 'Email hoặc mật khẩu không chính xác.';

          if (status === 423) {
            showAlert('warning', 'Tài khoản tạm thời bị khóa', msg);
            // Disable login button as requested: khi nhập sai mật khẩu quá 5 lần nút đăng nhập sẽ không ấn được nữa và chuyển sang disable
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.classList.add('btn-disabled');
              const remainingMin = (res.data && res.data.remainingMinutes) ? res.data.remainingMinutes : 15;
              let timeLeft = remainingMin * 60;
              if (btnText) btnText.textContent = `Tạm khóa (${Math.ceil(timeLeft / 60)} phút)`;
              if (window._lockoutTimer) clearInterval(window._lockoutTimer);
              window._lockoutTimer = setInterval(() => {
                timeLeft -= 1;
                if (timeLeft <= 0) {
                  clearInterval(window._lockoutTimer);
                  submitBtn.disabled = false;
                  submitBtn.classList.remove('btn-disabled');
                  if (btnText) btnText.textContent = 'Đăng nhập';
                } else {
                  const m = Math.floor(timeLeft / 60);
                  const s = timeLeft % 60;
                  if (btnText) btnText.textContent = `Tạm khóa (${m}:${s < 10 ? '0' : ''}${s})`;
                }
              }, 1000);
            }
          } else if (status === 403) {
            showAlert('danger', 'Tài khoản đã bị vô hiệu hóa', msg);
          } else {
            showAlert('danger', 'Đăng nhập không thành công', msg);
          }
        }
      } catch (err) {
        setLoginLoading(false);
        showAlert('danger', 'Lỗi kết nối', 'Không thể kết nối đến máy chủ tuyển dụng. Vui lòng kiểm tra lại mạng hoặc dịch vụ.');
      }
    });
  }

  // ==============================================================================
  // 4. SESSION LIFECYCLE & LOGOUT
  // ==============================================================================

  function setupAuthenticatedSession(user) {
    currentAuthenticatedUser = user;

    // Hide Login, Show App Shell
    if (loginView) loginView.classList.add('hidden');
    if (appShell) appShell.classList.remove('hidden');

    // Update User Display in Topbar & Sidebar
    const fullName = user.fullName || 'Người dùng';
    const email = user.email || '';
    const initial = fullName.charAt(0).toUpperCase();
    const primaryRole = (user.roles && user.roles.length > 0) ? user.roles[0] : 'USER';
    const friendlyRole = ROLE_LABELS[primaryRole] || primaryRole;

    if (topbarUserName) topbarUserName.textContent = fullName;
    if (topbarUserAvatar) topbarUserAvatar.textContent = initial;
    if (popoverUserName) popoverUserName.textContent = fullName;
    if (popoverUserEmail) popoverUserEmail.textContent = email;

    if (sidebarUserName) sidebarUserName.textContent = fullName;
    if (sidebarUserRole) sidebarUserRole.textContent = friendlyRole;
    if (sidebarUserAvatar) sidebarUserAvatar.textContent = initial;

    const userDisplayName = document.getElementById('user-display-name');
    if (userDisplayName) userDisplayName.textContent = fullName;

    // Filter Navigation Menu by Real Roles & Permissions (S1-06 AC-01 & AC-02)
    const token = sessionStorage.getItem('ats_token');
    if (token) filterNavigationMenu(token);

    // Start Session Heartbeat Auto-Renew
    startSessionHeartbeat();

    // Default View: Candidate goes to candidatePortal, internal staff to dashboard
    if (user.roles && user.roles.includes('CANDIDATE')) {
      switchView('candidatePortal');
    } else {
      switchView('dashboard');
    }
  }

  async function filterNavigationMenu(token) {
    if (!token) return;
    try {
      const res = await window.ATS_API.getNavigationMenuApi(token);
      if (res.ok && res.data && res.data.menuItems) {
        const allowedPaths = res.data.menuItems.map(m => m.path);
        const navItemMap = [
          { path: '/dashboard', id: 'nav-item-dashboard' },
          { path: '/requisitions', id: 'nav-item-requisitions' },
          { path: '/candidates', id: 'nav-item-candidates' },
          { path: '/interviews', id: 'nav-item-interviews' },
          { path: '/offers', id: 'nav-item-offers' },
          { path: '/approvals', id: 'nav-item-approvals' },
          { path: '/reports', id: 'nav-item-reports' },
          { path: '/admin/users', id: 'nav-item-users' },
          { path: '/admin/roles', id: 'nav-item-roles' },
          { path: '/admin/audit', id: 'nav-item-audit' },
          { path: '/candidate', id: 'nav-item-candidate-portal' }
        ];

        navItemMap.forEach(item => {
          const el = document.getElementById(item.id);
          if (el) {
            if (allowedPaths.includes(item.path)) {
              el.classList.remove('hidden');
              el.style.display = '';
            } else {
              el.classList.add('hidden');
              el.style.display = 'none';
            }
          }
        });
      }
    } catch (e) {
      console.error('Failed to filter navigation menu:', e);
    }
  }

  function startSessionHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;
      try {
        const res = await window.ATS_API.getMeApi(token);
        if (res.ok && res.data && res.data.success) {
          sessionStorage.setItem('ats_expires_at', res.data.data.expiresAt);
        } else if (res.data && res.data.code === 'SESSION_EXPIRED') {
          handleSessionExpired();
        }
      } catch {
        // network silent retry
      }
    }, 60000);
  }

  function handleSessionExpired() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    sessionStorage.removeItem('ats_token');
    sessionStorage.removeItem('ats_user');
    sessionStorage.removeItem('ats_expires_at');

    if (appShell) appShell.classList.add('hidden');
    if (loginView) loginView.classList.remove('hidden');

    showAlert('warning', 'Phiên làm việc hết hạn', 'Phiên đăng nhập của bạn đã hết hạn do không hoạt động. Vui lòng đăng nhập lại để tiếp tục công việc.');
  }

  // Logout Implementation (Required by S1-07 tests: performLogout)
  async function performLogout(showToastMsg = true) {
    const token = sessionStorage.getItem('ats_token');
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    if (token) {
      try {
        await window.ATS_API.logoutApi(token);
      } catch {
        // Continue clearing local storage even if network fails
      }
    }

    sessionStorage.removeItem('ats_token');
    sessionStorage.removeItem('ats_user');
    sessionStorage.removeItem('ats_expires_at');
    currentAuthenticatedUser = null;

    if (userMenuPopover) userMenuPopover.classList.remove('show');
    if (appShell) appShell.classList.add('hidden');
    if (loginView) loginView.classList.remove('hidden');

    if (views.error) views.error.classList.add('hidden');

    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (showToastMsg) {
      hideAlert();
      showToast('info', 'Đăng xuất', 'Bạn đã đăng xuất an toàn khỏi hệ thống tuyển dụng.');
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', performLogout);
  }
  if (sidebarLogoutBtn) {
    sidebarLogoutBtn.addEventListener('click', performLogout);
  }

  // Check Existing Session on Page Load
  async function checkExistingSession() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getMeApi(token);
      if (res.ok && res.data && res.data.success) {
        setupAuthenticatedSession(res.data.data.user);
      } else {
        sessionStorage.clear();
      }
    } catch {
      sessionStorage.clear();
    }
  }

  // ==============================================================================
  // 5. VIEW ROUTING & SIDEBAR NAVIGATION
  // ==============================================================================

  const VIEW_TITLES = {
    dashboard: 'Tổng quan Tuyển dụng',
    requisitions: 'Yêu cầu & Vị trí Tuyển dụng',
    candidates: 'Hồ sơ Ứng viên',
    interviews: 'Lịch Phỏng vấn',
    offers: 'Quản lý Thư Mời Nhận Việc (Offer)',
    approvals: 'Trung tâm Phê duyệt Tuyển dụng',
    reports: 'Báo cáo & Phân tích Tuyển dụng',
    users: 'Quản lý Người dùng & Tài khoản',
    roles: 'Vai trò & Ma trận Phân quyền',
    audit: 'Nhật ký Kiểm toán Hệ thống',
    profile: 'Hồ sơ Cá nhân',
    candidatePortal: 'Cổng Thông Tin Ứng Viên',
    error: 'Thông báo Lỗi'
  };

  function switchView(viewName) {
    if (!views[viewName]) return;
    currentActiveView = viewName;

    // Hide all view panels
    Object.keys(views).forEach(key => {
      if (views[key]) views[key].classList.add('hidden');
    });

    // Show target view
    views[viewName].classList.remove('hidden');

    // Update active nav-link in sidebar
    document.querySelectorAll('.app-sidebar .nav-link').forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update Breadcrumbs
    if (breadcrumbCurrentView) {
      breadcrumbCurrentView.textContent = VIEW_TITLES[viewName] || 'Trang chủ';
    }

    // Close user popover if open
    if (userMenuPopover) userMenuPopover.classList.remove('show');

    // On mobile, close sidebar on navigation
    if (window.innerWidth <= 1024 && sidebar) {
      sidebar.classList.remove('open');
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Load data for active view
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (viewName === 'dashboard') {
      loadDashboardData();
    } else if (viewName === 'requisitions') {
      loadRequisitions();
    } else if (viewName === 'candidates') {
      loadCandidates();
    } else if (viewName === 'interviews') {
      loadInterviews();
    } else if (viewName === 'offers') {
      loadOffers();
    } else if (viewName === 'approvals') {
      loadApprovals();
    } else if (viewName === 'reports') {
      loadReports();
    } else if (viewName === 'users') {
      loadUsers();
    } else if (viewName === 'roles') {
      loadRolesMatrix();
    } else if (viewName === 'audit') {
      loadAuditLogs();
    } else if (viewName === 'profile') {
      loadUserProfile();
    } else if (viewName === 'candidatePortal') {
      loadCandidatePortal();
    }
  }

  // Sidebar navigation click handlers
  document.querySelectorAll('.app-sidebar .nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const targetView = link.getAttribute('data-view');
      if (targetView) switchView(targetView);
    });
  });

  // Topbar quick action: Create Requisition
  if (topbarCreateReqBtn) {
    topbarCreateReqBtn.addEventListener('click', () => {
      openCreateReqModal();
    });
  }

  // Profile menu dropdown handlers
  if (userMenuBtn && userMenuPopover) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuPopover.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!userMenuPopover.contains(e.target) && e.target !== userMenuBtn) {
        userMenuPopover.classList.remove('show');
      }
    });
  }

  const menuItemProfile = document.getElementById('menu-item-profile');
  if (menuItemProfile) {
    menuItemProfile.addEventListener('click', () => switchView('profile'));
  }

  const menuItemChangePwd = document.getElementById('menu-item-change-pwd');
  if (menuItemChangePwd) {
    menuItemChangePwd.addEventListener('click', () => {
      if (userMenuPopover) userMenuPopover.classList.remove('show');
      openChangePwdModal();
    });
  }

  // Mobile sidebar toggle
  if (sidebarToggleBtn && sidebar) {
    sidebarToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // Global Search in Topbar
  const globalSearchInput = document.getElementById('global-search-input');
  if (globalSearchInput) {
    globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = globalSearchInput.value.trim();
        if (!query) return;
        if (currentView === 'requisitions') {
          if (reqSearchInput) reqSearchInput.value = query;
          loadRequisitions();
        } else if (currentView === 'users') {
          if (usersSearchInput) usersSearchInput.value = query;
          usersCurrentPage = 1;
          loadUsers();
        } else if (currentView === 'interviews') {
          if (interviewsSearchInput) interviewsSearchInput.value = query;
          loadInterviews();
        } else if (currentView === 'offers') {
          if (offersSearchInput) offersSearchInput.value = query;
          loadOffers();
        } else {
          switchView('candidates');
          if (candidatesSearchInput) candidatesSearchInput.value = query;
          loadCandidates();
          showToast('info', 'Tìm kiếm', `Đang tìm ứng viên theo từ khóa: "${query}"`);
        }
      }
    });
  }

  // Enterprise CSV Export Utility
  function exportTableToCsv(filename, headers, rows) {
    const csvContent = '\uFEFF' + [
      headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','),
      ...rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('info', 'Xuất dữ liệu', `Đã xuất tệp ${filename} thành công.`);
  }

  // Quick jump buttons from Dashboard
  const btnGotoRequisitions = document.getElementById('btn-goto-requisitions');
  if (btnGotoRequisitions) {
    btnGotoRequisitions.addEventListener('click', () => switchView('requisitions'));
  }

  const btnGotoInterviews = document.getElementById('btn-goto-interviews');
  if (btnGotoInterviews) {
    btnGotoInterviews.addEventListener('click', () => switchView('interviews'));
  }

  const btnGotoAudit = document.getElementById('btn-goto-audit');
  if (btnGotoAudit) {
    btnGotoAudit.addEventListener('click', () => switchView('audit'));
  }

  const dashboardRefreshBtn = document.getElementById('dashboard-refresh-btn');
  if (dashboardRefreshBtn) {
    dashboardRefreshBtn.addEventListener('click', () => {
      loadDashboardData();
      showToast('info', 'Dữ liệu', 'Đã cập nhật số liệu tổng quan mới nhất.');
    });
  }

  // ==============================================================================
  // 6. DASHBOARD DATA LOADING (REAL BACKEND API)
  // ==============================================================================

  async function loadDashboardData() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getDashboardStats(token);
      if (res.ok && res.data && res.data.success) {
        const stats = res.data.stats || res.data.data || {};

        // KPI Counts
        const openReqs = stats.openRequisitions || (stats.requisitions ? stats.requisitions.open : 0) || 0;
        const totalCandidates = stats.totalCandidates || (stats.candidates ? stats.candidates.total : 0) || 0;
        const upcomingInterviews = stats.upcomingInterviewsCount || (typeof stats.upcomingInterviews === 'number' ? stats.upcomingInterviews : (Array.isArray(stats.upcomingInterviews) ? stats.upcomingInterviews.length : 0)) || 0;
        const handoverAlerts = stats.handoverAlertsCount || (stats.requisitions ? stats.requisitions.handoverAlerts : 0) || 0;
        const totalHeadcount = stats.totalHeadcount || (stats.requisitions ? stats.requisitions.totalHeadcount : 0) || 0;

        const openReqsEl = document.getElementById('kpi-open-reqs');
        const totalCandidatesEl = document.getElementById('kpi-total-candidates');
        const upcomingInterviewsEl = document.getElementById('kpi-upcoming-interviews');
        const handoverAlertsEl = document.getElementById('kpi-handover-alerts');
        const headcountEl = document.getElementById('kpi-headcount-display');

        if (openReqsEl) openReqsEl.textContent = openReqs;
        if (totalCandidatesEl) totalCandidatesEl.textContent = totalCandidates;
        if (upcomingInterviewsEl) upcomingInterviewsEl.textContent = upcomingInterviews;
        if (handoverAlertsEl) handoverAlertsEl.textContent = handoverAlerts;
        if (headcountEl) headcountEl.textContent = totalHeadcount;

        // Sidebar Badges
        const sidebarReqsBadge = document.getElementById('sidebar-badge-reqs');
        const sidebarCandidatesBadge = document.getElementById('sidebar-badge-candidates');
        const sidebarInterviewsBadge = document.getElementById('sidebar-badge-interviews');

        if (sidebarReqsBadge) sidebarReqsBadge.textContent = openReqs;
        if (sidebarCandidatesBadge) sidebarCandidatesBadge.textContent = totalCandidates;
        if (sidebarInterviewsBadge) sidebarInterviewsBadge.textContent = upcomingInterviews;

        // Funnel Numbers
        const funnel = stats.candidateFunnel || stats.candidates || {};
        const fApplied = document.getElementById('funnel-applied');
        const fScreening = document.getElementById('funnel-screening');
        const fInterview = document.getElementById('funnel-interview');
        const fOffer = document.getElementById('funnel-offer');
        const fHired = document.getElementById('funnel-hired');

        if (fApplied) fApplied.textContent = funnel.APPLIED || funnel.new || 0;
        if (fScreening) fScreening.textContent = funnel.SCREENING || funnel.screening || 0;
        if (fInterview) fInterview.textContent = funnel.INTERVIEW || funnel.interview || 0;
        if (fOffer) fOffer.textContent = funnel.OFFER || funnel.offer || 0;
        if (fHired) fHired.textContent = funnel.HIRED || funnel.hired || 0;

        // Recent Requisitions Table
        const recentReqsBody = document.getElementById('dashboard-recent-reqs-body');
        if (recentReqsBody) {
          const reqs = stats.recentRequisitions || [];
          if (reqs.length === 0) {
            recentReqsBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 20px;">Chưa có vị trí tuyển dụng nào.</td></tr>`;
          } else {
            recentReqsBody.innerHTML = reqs.map(r => {
              const statusBadge = r.status === 'OPEN' ? 'badge-primary' : (r.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral');
              const statusText = r.status === 'OPEN' ? 'Đang mở' : (r.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng');
              const deptName = r.department || r.department_name || r.departmentName || '';
              return `
                <tr>
                  <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${r.code}</code></td>
                  <td><strong>${r.title}</strong></td>
                  <td>${deptName}</td>
                  <td style="text-align: center; font-weight: 600;">${r.headcount}</td>
                  <td><span class="badge ${statusBadge}">${statusText}</span></td>
                </tr>
              `;
            }).join('');
          }
        }

        // Upcoming Interviews List / Recent Activities
        const interviewsList = document.getElementById('dashboard-upcoming-interviews-list');
        if (interviewsList) {
          const interviews = Array.isArray(stats.upcomingInterviews) ? stats.upcomingInterviews : (stats.recentActivities || []);
          if (interviews.length === 0) {
            interviewsList.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không có lịch phỏng vấn nào sắp tới.</div>`;
          } else {
            interviewsList.innerHTML = interviews.map(item => {
              const candName = item.candidate_name || item.candidateName || item.title || 'Ứng viên';
              const reqTitle = item.requisition_title || item.meta || '';
              const interviewer = item.interviewer_name || '';
              const schedTime = item.scheduled_at || item.timestamp || new Date().toISOString();

              return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-border-subtle);">
                  <div>
                    <div style="font-weight: 600; color: var(--color-text); font-size: 0.85rem;">${candName}</div>
                    <div style="font-size: 0.775rem; color: var(--color-text-muted);">${reqTitle} ${interviewer ? '· PV: ' + interviewer : ''}</div>
                  </div>
                  <div style="text-align: right;">
                    <span class="badge badge-warning font-mono" style="font-size: 0.725rem;">${new Date(schedTime).toLocaleDateString('vi-VN')}</span>
                    <div style="font-size: 0.725rem; color: var(--color-text-muted); margin-top: 2px;">${new Date(schedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              `;
            }).join('');
          }
        }

        // Department Breakdown
        const deptBreakdownContainer = document.getElementById('dashboard-dept-breakdown-container');
        if (deptBreakdownContainer) {
          const depts = stats.departmentBreakdown || [];
          if (depts.length === 0) {
            deptBreakdownContainer.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); padding: 20px;">Chưa có dữ liệu phòng ban.</div>`;
          } else {
            deptBreakdownContainer.innerHTML = `
              <div style="display: flex; flex-direction: column; gap: 12px;">
                ${depts.map(d => {
                  const dName = d.department || d.department_name || d.departmentName || '';
                  const reqCount = d.req_count || d.count || 0;
                  const totalHc = d.total_headcount || d.totalHeadcount || reqCount;
                  return `
                    <div>
                      <div style="display: flex; justify-content: space-between; font-size: 0.825rem; margin-bottom: 4px;">
                        <strong>${dName}</strong>
                        <span style="color: var(--color-text-secondary);">${reqCount} vị trí · ${totalHc} chỉ tiêu</span>
                      </div>
                      <div style="height: 6px; background: var(--color-bg-subtle); border-radius: var(--radius-full); overflow: hidden;">
                        <div style="height: 100%; width: ${Math.min(100, totalHc * 15)}%; background: var(--color-primary); border-radius: var(--radius-full);"></div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }
        }

        // Recent Audit Logs
        const recentAuditContainer = document.getElementById('dashboard-recent-audit-logs');
        if (recentAuditContainer) {
          const logs = stats.recentAudit || [];
          if (logs.length === 0) {
            recentAuditContainer.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); padding: 20px;">Chưa có bản ghi hoạt động nào.</div>`;
          } else {
            recentAuditContainer.innerHTML = logs.map(l => {
              const isSuccess = l.status === 'SUCCESS';
              const isLocked = l.status === 'LOCKED' || l.status === 'ACCOUNT_LOCKED';
              let badgeClass = 'badge-success';
              if (isLocked) badgeClass = 'badge-warning';
              else if (l.status === 'FAILURE') badgeClass = 'badge-danger';
              else if (l.status === 'LOGOUT') badgeClass = 'badge-secondary';
              return `
                <div class="dashboard-recent-audit-item" data-id="${l.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 8px; border-bottom: 1px solid var(--color-border-subtle); font-size: 0.825rem; cursor: pointer; border-radius: 4px; transition: background 0.15s ease;" title="Bấm để xem chi tiết bản ghi nhật ký này">
                  <div style="flex: 1; min-width: 0; padding-right: 8px;">
                    <strong style="color: var(--color-text); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${l.email || 'Hệ thống'}</strong>
                    <div style="color: var(--color-text-muted); font-size: 0.775rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${l.reason || 'Đăng nhập hệ thống'}</div>
                  </div>
                  <div style="text-align: right; flex-shrink: 0;">
                    <span class="badge ${badgeClass}" style="font-size: 0.7rem;">${l.status}</span>
                    <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 2px;">${new Date(l.attempted_at).toLocaleTimeString('vi-VN')}</div>
                  </div>
                </div>
              `;
            }).join('');

            // Attach click listeners to dashboard recent items
            recentAuditContainer.querySelectorAll('.dashboard-recent-audit-item').forEach(el => {
              el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg-subtle, #f8fafc)'; });
              el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
              el.addEventListener('click', () => {
                const id = el.getAttribute('data-id');
                const log = logs.find(item => item.id === id);
                if (typeof openAuditDetailModal === 'function') {
                  openAuditDetailModal(id, log);
                }
              });
            });
          }
        }
      }
    } catch (e) {
      console.warn('Dashboard data fetch error:', e);
    }
  }

  // ==============================================================================
  // 7. REQUISITIONS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const reqSearchInput = document.getElementById('req-search-input');
  const reqStatusFilter = document.getElementById('req-status-filter');
  const reqHandoverOnly = document.getElementById('req-handover-only');
  const reqRefreshBtn = document.getElementById('req-refresh-btn');
  const requisitionsTableBody = document.getElementById('requisitions-table-body');
  const requisitionsTotalBadge = document.getElementById('requisitions-total-badge');

  async function loadRequisitions() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = reqSearchInput ? reqSearchInput.value.trim() : '';
    const status = reqStatusFilter ? reqStatusFilter.value : 'ALL';
    const handoverOnly = reqHandoverOnly ? reqHandoverOnly.checked : false;

    if (requisitionsTableBody) {
      requisitionsTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách vị trí...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getRequisitions(token, { search, status, handoverOnly });
      if (res.ok && res.data && res.data.success) {
        const list = res.data.requisitions || res.data.data || [];
        currentRequisitionsList = list;
        if (requisitionsTotalBadge) {
          requisitionsTotalBadge.textContent = `${list.length} vị trí`;
        }

        if (list.length === 0) {
          requisitionsTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy vị trí tuyển dụng phù hợp.</td></tr>`;
          return;
        }

        requisitionsTableBody.innerHTML = list.map(req => {
          const statusBadge = req.status === 'OPEN' ? 'badge-primary' : (req.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral');
          const statusText = req.status === 'OPEN' ? 'Đang mở' : (req.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng');
          const isHandover = req.handover_required || req.handoverRequired;
          const handoverAlert = isHandover ? `<span class="badge badge-warning" style="margin-left: 6px;">Cần bàn giao</span>` : '';
          const dept = req.department || req.department_name || req.departmentName || '';
          const recName = req.recruiter_name || req.recruiterName || (req.recruiter ? req.recruiter.fullName : '');

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${req.code}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${req.title}</div>
                ${handoverAlert}
              </td>
              <td>${dept}</td>
              <td style="text-align: center; font-weight: 600;">${req.headcount}</td>
              <td>${recName ? recName : '<span style="color: var(--color-text-muted); font-style: italic;">Chưa phân công</span>'}</td>
              <td><span class="badge ${statusBadge}">${statusText}</span></td>
              <td style="text-align: center;">
                <div style="display: flex; gap: 6px; justify-content: center;">
                  <button type="button" class="btn btn-outline btn-xs btn-edit-req" data-id="${req.id}">
                    Chi tiết / Sửa
                  </button>
                  ${isHandover ? `
                    <button type="button" class="btn btn-outline btn-xs btn-reassign-req" data-id="${req.id}" data-code="${req.code}" data-title="${req.title}" style="color: var(--color-warning); border-color: var(--color-warning);">
                      Bàn giao
                    </button>
                  ` : ''}
                  <button type="button" class="btn btn-outline btn-xs btn-view-candidates-req" data-title="${req.title}">
                    Ứng viên
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        // Wire Action Buttons
        document.querySelectorAll('.btn-edit-req').forEach(btn => {
          btn.addEventListener('click', () => {
            const reqId = btn.getAttribute('data-id');
            openRequisitionDetails(reqId);
          });
        });

        document.querySelectorAll('.btn-reassign-req').forEach(btn => {
          btn.addEventListener('click', () => {
            const reqId = btn.getAttribute('data-id');
            const reqCode = btn.getAttribute('data-code');
            const reqTitle = btn.getAttribute('data-title');
            openReassignHandoverModal(reqId, reqCode, reqTitle);
          });
        });

        document.querySelectorAll('.btn-view-candidates-req').forEach(btn => {
          btn.addEventListener('click', () => {
            const reqTitle = btn.getAttribute('data-title');
            switchView('candidates');
            if (candidatesSearchInput) candidatesSearchInput.value = reqTitle;
            loadCandidates();
            showToast('info', 'Ứng viên theo vị trí', `Đang lọc danh sách ứng viên cho vị trí: "${reqTitle}"`);
          });
        });
      }
    } catch (e) {
      console.error('Failed to load requisitions:', e);
    }
  }

  const reqExportBtn = document.getElementById('req-export-btn');
  if (reqExportBtn) {
    reqExportBtn.addEventListener('click', () => {
      if (!currentRequisitionsList || currentRequisitionsList.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Không có dữ liệu vị trí tuyển dụng để xuất.');
        return;
      }
      const headers = ['Mã vị trí', 'Tiêu đề tuyển dụng', 'Phòng ban', 'Chỉ tiêu', 'Recruiter phụ trách', 'Trạng thái'];
      const rows = currentRequisitionsList.map(r => [
        r.code,
        r.title,
        r.departmentName || r.department || '',
        r.headcount,
        r.recruiter_name || r.recruiterName || (r.recruiter ? r.recruiter.fullName : 'Chưa phân công'),
        r.status
      ]);
      exportTableToCsv('danh_sach_vi_tri_tuyen_dung.csv', headers, rows);
    });
  }

  if (reqRefreshBtn) reqRefreshBtn.addEventListener('click', loadRequisitions);
  if (reqStatusFilter) reqStatusFilter.addEventListener('change', loadRequisitions);
  if (reqHandoverOnly) reqHandoverOnly.addEventListener('change', loadRequisitions);
  if (reqSearchInput) {
    reqSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadRequisitions();
    });
  }

  // ==============================================================================
  // 8. CANDIDATES MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const candidatesSearchInput = document.getElementById('candidates-search-input');
  const candidatesStageFilter = document.getElementById('candidates-stage-filter');
  const candidatesReqFilter = document.getElementById('candidates-req-filter');
  const candidatesExportBtn = document.getElementById('candidates-export-btn');
  const candidatesRefreshBtn = document.getElementById('candidates-refresh-btn');
  const candidatesTableBody = document.getElementById('candidates-table-body');
  const candidatesTotalBadge = document.getElementById('candidates-total-badge');

  async function loadCandidates() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    // Populate requisition filter dropdown if empty
    if (candidatesReqFilter && candidatesReqFilter.children.length <= 1 && currentRequisitionsList.length > 0) {
      candidatesReqFilter.innerHTML = `<option value="ALL">Tất cả vị trí ứng tuyển</option>` +
        currentRequisitionsList.map(r => `<option value="${r.title}">${r.code} - ${r.title}</option>`).join('');
    }

    const search = candidatesSearchInput ? candidatesSearchInput.value.trim().toLowerCase() : '';
    const stage = candidatesStageFilter ? candidatesStageFilter.value : 'ALL';
    const reqFilter = candidatesReqFilter ? candidatesReqFilter.value : 'ALL';

    if (candidatesTableBody) {
      candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách ứng viên...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getCandidatesApi(token, { search, stage });
      if (res.ok && res.data && res.data.success) {
        let list = res.data.candidates || res.data.data || [];

        // Apply requisition filter if selected
        if (reqFilter && reqFilter !== 'ALL') {
          list = list.filter(c => {
            const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || '');
            return reqTitle.toLowerCase().includes(reqFilter.toLowerCase());
          });
        }

        currentCandidatesList = list;
        if (candidatesTotalBadge) {
          candidatesTotalBadge.textContent = `${list.length} ứng viên`;
        }

        if (list.length === 0) {
          candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy hồ sơ ứng viên phù hợp.</td></tr>`;
          return;
        }

        candidatesTableBody.innerHTML = list.map(c => {
          const badgeClass = STAGE_BADGES[c.stage] || 'badge-neutral';
          const stageName = STAGE_LABELS[c.stage] || c.stage;
          const stars = '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));
          const name = c.fullName || c.full_name || 'Ứng viên';
          const phone = c.phoneNumber || c.phone || '';
          const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
          const code = c.code || (c.id ? c.id.toUpperCase() : 'UV');
          const appliedDate = c.createdAt || c.created_at || c.applied_at;

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td><strong>${name}</strong></td>
              <td>${reqTitle}</td>
              <td>
                <div style="font-size: 0.8rem; color: var(--color-text);">${c.email}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">${phone}</div>
              </td>
              <td><span class="badge ${badgeClass}">${stageName}</span></td>
              <td>${appliedDate ? new Date(appliedDate).toLocaleDateString('vi-VN') : '—'}</td>
              <td style="color: #f59e0b; font-size: 0.85rem;">${stars}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewCandidateDetails('${c.id}')">
                  Chi tiết
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Failed to load candidates:', e);
    }
  }

  if (candidatesExportBtn) {
    candidatesExportBtn.addEventListener('click', () => {
      if (!currentCandidatesList || currentCandidatesList.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Không có dữ liệu ứng viên để xuất.');
        return;
      }
      const headers = ['Mã UV', 'Họ và tên', 'Vị trí ứng tuyển', 'Email', 'Điện thoại', 'Giai đoạn', 'Ngày nộp', 'Đánh giá'];
      const rows = currentCandidatesList.map(c => [
        c.code || (c.id ? c.id.toUpperCase() : 'UV'),
        c.fullName || c.full_name || '',
        (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || ''),
        c.email || '',
        c.phoneNumber || c.phone || '',
        STAGE_LABELS[c.stage] || c.stage,
        (c.createdAt || c.created_at) ? new Date(c.createdAt || c.created_at).toLocaleDateString('vi-VN') : '',
        (c.rating || 4) + ' sao'
      ]);
      exportTableToCsv('danh_sach_ung_vien.csv', headers, rows);
    });
  }

  if (candidatesRefreshBtn) candidatesRefreshBtn.addEventListener('click', loadCandidates);
  if (candidatesStageFilter) candidatesStageFilter.addEventListener('change', loadCandidates);
  if (candidatesReqFilter) candidatesReqFilter.addEventListener('change', loadCandidates);
  if (candidatesSearchInput) {
    candidatesSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadCandidates();
    });
  }

  // ==============================================================================
  // 9. INTERVIEWS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const interviewsSearchInput = document.getElementById('interviews-search-input');
  const interviewsStatusFilter = document.getElementById('interviews-status-filter');
  const interviewsRefreshBtn = document.getElementById('interviews-refresh-btn');
  const interviewsTableBody = document.getElementById('interviews-table-body');
  const interviewsTotalBadge = document.getElementById('interviews-total-badge');

  async function loadInterviews() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = interviewsSearchInput ? interviewsSearchInput.value.trim() : '';
    const status = interviewsStatusFilter ? interviewsStatusFilter.value : 'ALL';

    if (interviewsTableBody) {
      interviewsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải lịch phỏng vấn...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getInterviewsApi(token, { search, status });
      if (res.ok && res.data && res.data.success) {
        const list = res.data.interviews || res.data.data || [];
        currentInterviewsList = list;
        if (interviewsTotalBadge) {
          interviewsTotalBadge.textContent = `${list.length} phiên`;
        }

        if (list.length === 0) {
          interviewsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không có lịch phỏng vấn nào.</td></tr>`;
          return;
        }

        interviewsTableBody.innerHTML = list.map(iv => {
          const statusBadge = iv.status === 'SCHEDULED' ? 'badge-warning' : (iv.status === 'COMPLETED' ? 'badge-success' : 'badge-danger');
          const statusText = iv.status === 'SCHEDULED' ? 'Sắp diễn ra' : (iv.status === 'COMPLETED' ? 'Đã hoàn thành' : 'Đã hủy');
          const candName = (iv.candidate && iv.candidate.fullName) ? iv.candidate.fullName : (iv.candidate_name || 'Ứng viên');
          const reqTitle = (iv.requisition && iv.requisition.title) ? iv.requisition.title : (iv.requisition_title || 'Vị trí');
          const interviewer = (iv.interviewer && iv.interviewer.fullName) ? iv.interviewer.fullName : (iv.interviewer_name || 'Hội đồng tuyển dụng');
          const schedTime = iv.scheduledTime || iv.scheduled_time || iv.scheduled_at;
          const location = iv.locationOrLink || iv.location || 'Online Google Meet';
          const code = iv.code || (iv.id ? iv.id.toUpperCase() : 'PV');

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td><strong>${candName}</strong></td>
              <td>${reqTitle}</td>
              <td>${interviewer}</td>
              <td>
                <div style="font-weight: 600;">${new Date(schedTime).toLocaleDateString('vi-VN')}</div>
                <div style="font-size: 0.775rem; color: var(--color-text-muted);">${new Date(schedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
              </td>
              <td>${location}</td>
              <td><span class="badge ${statusBadge}">${statusText}</span></td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewInterviewDetails('${iv.id}')">
                  Chi tiết
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Failed to load interviews:', e);
    }
  }

  if (interviewsRefreshBtn) interviewsRefreshBtn.addEventListener('click', loadInterviews);
  if (interviewsStatusFilter) interviewsStatusFilter.addEventListener('change', loadInterviews);
  if (interviewsSearchInput) {
    interviewsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadInterviews();
    });
  }

  // ==============================================================================
  // 10. OFFERS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const offersSearchInput = document.getElementById('offers-search-input');
  const offersStatusFilter = document.getElementById('offers-status-filter');
  const offersRefreshBtn = document.getElementById('offers-refresh-btn');
  const offersTableBody = document.getElementById('offers-table-body');
  const offersTotalBadge = document.getElementById('offers-total-badge');

  async function loadOffers() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = offersSearchInput ? offersSearchInput.value.trim() : '';
    const status = offersStatusFilter ? offersStatusFilter.value : 'ALL';

    if (offersTableBody) {
      offersTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách offer...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getOffersApi(token, { search, status });
      if (res.ok && res.data && res.data.success) {
        const list = res.data.offers || res.data.data || [];
        currentOffersList = list;
        if (offersTotalBadge) {
          offersTotalBadge.textContent = `${list.length} thư mời`;
        }

        if (list.length === 0) {
          offersTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Chưa có thư mời nhận việc nào.</td></tr>`;
          return;
        }

        offersTableBody.innerHTML = list.map(o => {
          const statusBadge = o.status === 'APPROVED' ? 'badge-success' : (o.status === 'PENDING' ? 'badge-warning' : (o.status === 'SENT' ? 'badge-primary' : 'badge-neutral'));
          const statusText = o.status === 'APPROVED' ? 'Đã phê duyệt' : (o.status === 'PENDING' ? 'Chờ duyệt' : (o.status === 'SENT' ? 'Đã gửi' : o.status));
          const candName = (o.candidate && o.candidate.fullName) ? o.candidate.fullName : (o.candidate_name || 'Ứng viên');
          const reqTitle = (o.requisition && o.requisition.title) ? o.requisition.title : (o.requisition_title || 'Vị trí');
          const salaryVal = o.salaryMonthly || o.salary_monthly || o.salary;
          const startDateVal = o.startDate || o.start_date;
          const code = o.code || (o.id ? o.id.toUpperCase() : 'OFF');

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td><strong>${candName}</strong></td>
              <td>${reqTitle}</td>
              <td style="font-weight: 600; color: var(--color-primary);">${salaryVal ? Number(salaryVal).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận'}</td>
              <td>${startDateVal ? new Date(startDateVal).toLocaleDateString('vi-VN') : 'Thỏa thuận'}</td>
              <td><span class="badge ${statusBadge}">${statusText}</span></td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewOfferDetails('${o.id}')">
                  Hồ sơ
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Failed to load offers:', e);
    }
  }

  if (offersRefreshBtn) offersRefreshBtn.addEventListener('click', loadOffers);
  if (offersStatusFilter) offersStatusFilter.addEventListener('change', loadOffers);
  if (offersSearchInput) {
    offersSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadOffers();
    });
  }

  // ==============================================================================
  // 11. REPORTS & ANALYTICS (REAL BACKEND API)
  // ==============================================================================

  async function loadReports() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getRecruitmentReportsApi(token);
      if (res.ok && res.data && res.data.success) {
        const report = res.data.report || res.data.data || {};
        const kpis = report.kpis || {};

        const timeToHireEl = document.getElementById('report-time-to-hire');
        const offerAcceptanceEl = document.getElementById('report-offer-acceptance');
        const fillRateEl = document.getElementById('report-fill-rate');
        const newCandidatesEl = document.getElementById('report-new-candidates');

        if (timeToHireEl) timeToHireEl.textContent = `${kpis.avgTimeToHireDays || 21} ngày`;
        if (offerAcceptanceEl) offerAcceptanceEl.textContent = `${kpis.offerAcceptanceRate || 88.5}%`;
        if (fillRateEl) fillRateEl.textContent = `${kpis.fillRatePercent || 76}%`;
        if (newCandidatesEl) newCandidatesEl.textContent = `${kpis.newCandidatesThisMonth || 6}`;

        // Department Table
        const deptTableBody = document.getElementById('report-dept-table-body');
        if (deptTableBody) {
          const depts = report.departmentPerformance || report.department_performance || [];
          deptTableBody.innerHTML = depts.map(d => {
            const dName = d.department || d.department_name || d.departmentName || '';
            const totalPos = d.total_positions || d.totalPositions || 0;
            const totalHc = d.total_headcount || d.totalHeadcount || 0;
            const totalCands = d.total_candidates || d.totalCandidates || 0;
            const hiredCount = d.hired_count || d.hiredCount || 0;
            const completionRate = d.completion_rate || d.completionRate || 0;

            return `
              <tr>
                <td><strong>${dName}</strong></td>
                <td style="text-align: center;">${totalPos}</td>
                <td style="text-align: center; font-weight: 600;">${totalHc}</td>
                <td style="text-align: center;">${totalCands}</td>
                <td style="text-align: center; color: var(--color-success); font-weight: 600;">${hiredCount}</td>
                <td style="text-align: center;">
                  <span class="badge ${completionRate >= 80 ? 'badge-success' : 'badge-warning'} font-mono">${completionRate}%</span>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    }
  }

  const reportsExportBtn = document.getElementById('reports-export-btn');
  if (reportsExportBtn) {
    reportsExportBtn.addEventListener('click', () => {
      const rows = [];
      const trs = document.querySelectorAll('#report-dept-table-body tr');
      trs.forEach(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        if (tds.length >= 6) rows.push(tds);
      });
      if (rows.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Chưa có dữ liệu báo cáo để xuất.');
        return;
      }
      exportTableToCsv('bao_cao_hieu_qua_tuyen_dung.csv', ['Phòng ban', 'Vị trí', 'Chỉ tiêu', 'Hồ sơ', 'Hoàn thành', 'Tỷ lệ đạt'], rows);
    });
  }


  // ==============================================================================
  // 12. USERS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const usersSearchInput = document.getElementById('users-search-input');
  const usersRoleFilter = document.getElementById('users-role-filter');
  const usersStatusFilter = document.getElementById('users-status-filter');
  const usersSearchBtn = document.getElementById('users-search-btn');
  const usersTableBody = document.getElementById('users-table-body');
  const usersPageInfo = document.getElementById('users-page-info');
  const usersLimitSelect = document.getElementById('users-limit-select');
  const usersPrevBtn = document.getElementById('users-prev-btn');
  const usersNextBtn = document.getElementById('users-next-btn');
  const usersCurrentPageBadge = document.getElementById('users-current-page-badge');
  const usersTotalBadge = document.getElementById('users-total-badge');

  let usersCurrentPage = 1;
  let usersCurrentLimit = 20;

  async function loadUsers() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = usersSearchInput ? usersSearchInput.value.trim() : '';
    const role = usersRoleFilter ? usersRoleFilter.value : 'ALL';
    const status = usersStatusFilter ? usersStatusFilter.value : 'ALL';

    if (usersTableBody) {
      usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách nhân viên...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getUsersApi(token, {
        page: usersCurrentPage,
        limit: usersCurrentLimit,
        search,
        role,
        status
      });

      if (res.ok && res.data && res.data.success) {
        const users = res.data.data.items || res.data.data.users || [];
        const pagination = res.data.data.pagination || { total: users.length, page: 1, limit: usersCurrentLimit, totalPages: 1 };

        if (usersTotalBadge) usersTotalBadge.textContent = `${pagination.total} tài khoản`;

        if (usersPageInfo) {
          const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
          const to = Math.min(pagination.page * pagination.limit, pagination.total);
          usersPageInfo.textContent = `Hiển thị ${from} - ${to} trên ${pagination.total} tài khoản`;
        }

        if (usersCurrentPageBadge) {
          usersCurrentPageBadge.textContent = `${pagination.page} / ${pagination.totalPages || 1}`;
        }

        if (usersPrevBtn) usersPrevBtn.disabled = pagination.page <= 1;
        if (usersNextBtn) usersNextBtn.disabled = pagination.page >= pagination.totalPages;

        if (users.length === 0) {
          usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy tài khoản nhân viên nào.</td></tr>`;
          return;
        }

        usersTableBody.innerHTML = users.map(u => {
          const avatarLetter = (u.fullName || u.email).charAt(0).toUpperCase();
          const rolesHtml = (u.roles || []).map(r => `
            <span class="badge badge-primary font-mono" style="font-size: 0.725rem;">${ROLE_LABELS[r] || r}</span>
          `).join(' ');

          const isLocked = u.status === 'LOCKED';
          const statusBadge = isLocked ? `<span class="badge badge-danger">Đã khóa</span>` : `<span class="badge badge-success">Hoạt động</span>`;

          return `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div class="user-avatar-circle" style="width: 32px; height: 32px; font-size: 0.8rem;">${avatarLetter}</div>
                  <div>
                    <div style="font-weight: 600; color: var(--color-text);">${u.fullName || '—'}</div>
                    <div style="font-size: 0.75rem; color: var(--color-text-muted);">Mã: ${u.id.substring(0, 8)}...</div>
                  </div>
                </div>
              </td>
              <td><span class="font-mono" style="font-size: 0.825rem;">${u.email}</span></td>
              <td>
                <div>${u.jobTitle || '—'}</div>
                <div style="font-size: 0.775rem; color: var(--color-text-muted);">${u.department || '—'}</div>
              </td>
              <td><div style="display: flex; gap: 4px; flex-wrap: wrap;">${rolesHtml}</div></td>
              <td>${statusBadge}</td>
              <td style="text-align: center;">
                <div style="display: flex; gap: 6px; justify-content: center;">
                  <button type="button" class="btn btn-outline btn-xs btn-edit-user" data-user='${JSON.stringify(u)}'>
                    Sửa
                  </button>
                  <button type="button" class="btn btn-outline btn-xs btn-assign-roles" data-user='${JSON.stringify(u)}'>
                    Phân quyền
                  </button>
                  ${isLocked ? `
                    <button type="button" class="btn btn-outline btn-xs btn-unlock-user" data-id="${u.id}" data-name="${u.fullName || u.email}" style="color: var(--color-success); border-color: var(--color-success);">
                      Mở khóa
                    </button>
                  ` : `
                    <button type="button" class="btn btn-outline btn-xs btn-lock-user" data-id="${u.id}" data-name="${u.fullName || u.email}" data-email="${u.email}" style="color: var(--color-danger); border-color: var(--color-danger);">
                      Khóa
                    </button>
                  `}
                  <button type="button" class="btn btn-outline btn-xs btn-reset-user-pwd" data-id="${u.id}" data-name="${u.fullName || u.email}" data-email="${u.email}">
                    Reset MK
                  </button>
                  <button type="button" class="btn btn-outline btn-xs btn-delete-user" data-id="${u.id}" data-name="${u.fullName || u.email}" style="color: var(--color-danger); border-color: var(--color-danger);">
                    Xóa
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        // Wire Action Buttons
        document.querySelectorAll('.btn-edit-user').forEach(btn => {
          btn.addEventListener('click', () => {
            const user = JSON.parse(btn.getAttribute('data-user'));
            openEditUserModal(user);
          });
        });

        document.querySelectorAll('.btn-assign-roles').forEach(btn => {
          btn.addEventListener('click', () => {
            const user = JSON.parse(btn.getAttribute('data-user'));
            openAssignRolesModal(user);
          });
        });

        document.querySelectorAll('.btn-lock-user').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            const email = btn.getAttribute('data-email');
            openLockUserModal(id, name, email);
          });
        });

        document.querySelectorAll('.btn-reset-user-pwd').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            const email = btn.getAttribute('data-email');
            openAdminResetPwdModal(id, name, email);
          });
        });

        document.querySelectorAll('.btn-delete-user').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            if (confirm(`Bạn có chắc chắn muốn xóa tài khoản nhân sự ${name}? Hành động này không thể hoàn tác.`)) {
              try {
                const delRes = await window.ATS_API.deleteUserApi(token, id);
                if (delRes.ok && delRes.data && delRes.data.success) {
                  showToast('success', 'Đã xóa tài khoản', `Tài khoản ${name} đã được xóa thành công.`);
                  loadUsers();
                  loadDashboardData();
                } else {
                  showToast('danger', 'Lỗi xóa', delRes.data.message || 'Không thể xóa tài khoản.');
                }
              } catch (e) {
                showToast('danger', 'Lỗi kết nối', e.message);
              }
            }
          });
        });

        document.querySelectorAll('.btn-unlock-user').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            if (confirm(`Bạn có chắc muốn mở khóa cho tài khoản ${name}?`)) {
              try {
                const unlockRes = await window.ATS_API.unlockUserApi(token, id);
                if (unlockRes.ok && unlockRes.data && unlockRes.data.success) {
                  showToast('success', 'Mở khóa thành công', `Tài khoản ${name} đã được mở khóa và có thể đăng nhập bình thường.`);
                  loadUsers();
                } else {
                  showToast('danger', 'Lỗi mở khóa', unlockRes.data.message || 'Không thể mở khóa tài khoản.');
                }
              } catch (err) {
                showToast('danger', 'Lỗi hệ thống', err.message);
              }
            }
          });
        });
      }
    } catch (e) {
      console.error('Failed to load users:', e);
    }
  }

  if (usersSearchBtn) usersSearchBtn.addEventListener('click', () => { usersCurrentPage = 1; loadUsers(); });
  if (usersRoleFilter) usersRoleFilter.addEventListener('change', () => { usersCurrentPage = 1; loadUsers(); });
  if (usersStatusFilter) usersStatusFilter.addEventListener('change', () => { usersCurrentPage = 1; loadUsers(); });
  if (usersLimitSelect) {
    usersLimitSelect.addEventListener('change', () => {
      usersCurrentLimit = parseInt(usersLimitSelect.value, 10);
      usersCurrentPage = 1;
      loadUsers();
    });
  }
  if (usersPrevBtn) {
    usersPrevBtn.addEventListener('click', () => {
      if (usersCurrentPage > 1) {
        usersCurrentPage--;
        loadUsers();
      }
    });
  }
  if (usersNextBtn) {
    usersNextBtn.addEventListener('click', () => {
      usersCurrentPage++;
      loadUsers();
    });
  }

  // ==============================================================================
  // 13. ROLES & PERMISSIONS MATRIX (REAL BACKEND API)
  // ==============================================================================

  async function loadRolesMatrix() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getRolesMatrixApi(token);
      if (res.ok && res.data && res.data.success) {
        const { roles, permissions, matrix } = res.data.data;

        // Render Role Cards
        const cardsContainer = document.getElementById('roles-cards-container');
        if (cardsContainer) {
          cardsContainer.innerHTML = roles.map(r => `
            <div class="panel-card" style="padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong style="color: var(--color-primary); font-size: 1rem;">${ROLE_LABELS[r.name] || r.name}</strong>
                <span class="badge badge-primary font-mono">${r.name}</span>
              </div>
              <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 12px; line-height: 1.4;">
                ${r.description || 'Vai trò người dùng trong hệ thống'}
              </p>
              <div style="font-size: 0.775rem; color: var(--color-text-muted);">
                Số quyền sở hữu: <strong style="color: var(--color-text);">${matrix[r.name] ? matrix[r.name].length : 0} quyền</strong>
              </div>
            </div>
          `).join('');
        }

        // Render Matrix Table
        const matrixContainer = document.getElementById('rbac-matrix-table-container');
        if (matrixContainer) {
          matrixContainer.innerHTML = `
            <table class="data-table">
              <thead>
                <tr>
                  <th style="min-width: 220px;">Quyền hạn hệ thống</th>
                  <th style="min-width: 140px;">Phân hệ</th>
                  ${roles.map(r => `<th style="text-align: center; font-size: 0.725rem;">${r.name}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${permissions.map(p => {
                  const roleChecks = roles.map(r => {
                    const hasPerm = matrix[r.name] && matrix[r.name].includes(p.name);
                    return `
                      <td style="text-align: center;">
                        ${hasPerm 
                          ? `<span style="color: var(--color-success); font-weight: 700; font-size: 1.1rem;">✓</span>` 
                          : `<span style="color: var(--color-text-muted); opacity: 0.3;">—</span>`}
                      </td>
                    `;
                  }).join('');

                  return `
                    <tr>
                      <td>
                        <div style="font-weight: 600; color: var(--color-text);">${p.description || p.name}</div>
                        <code class="font-mono" style="font-size: 0.75rem; color: var(--color-text-muted);">${p.name}</code>
                      </td>
                      <td><span class="badge badge-neutral" style="font-size: 0.725rem;">${p.module || 'Hệ thống'}</span></td>
                      ${roleChecks}
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
        }
      }
    } catch (e) {
      console.error('Failed to load roles matrix:', e);
    }
  }

  // ==============================================================================
  // 14. AUDIT LOGS (REAL BACKEND API)
  // ==============================================================================
  // 14. SYSTEM AUDIT LOGS (REAL BACKEND API & FULL DETAIL INSPECTION)
  // ==============================================================================

  let currentAuditLogs = [];
  let currentEnrichedAuditLog = null;
  const auditSearchInput = document.getElementById('audit-search-input');
  const auditStatusFilter = document.getElementById('audit-status-filter');
  const auditRefreshBtn = document.getElementById('audit-refresh-btn');
  const auditTotalBadge = document.getElementById('audit-total-badge');
  const auditDetailModal = document.getElementById('audit-detail-modal');

  async function loadAuditLogs() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const auditTableBody = document.getElementById('audit-table-body');
    if (auditTableBody) {
      auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải nhật ký kiểm toán hệ thống...</td></tr>`;
    }

    const search = auditSearchInput ? auditSearchInput.value.trim() : '';
    const status = auditStatusFilter ? auditStatusFilter.value : 'ALL';

    try {
      const res = await window.ATS_API.getAuditLogsApi(token, { search, status, limit: 100 });
      if (res.ok && res.data && res.data.success) {
        const logs = res.data.logs || (res.data.data && res.data.data.logs) || [];
        currentAuditLogs = logs;

        if (auditTotalBadge) {
          auditTotalBadge.textContent = `${logs.length} sự kiện`;
        }

        if (logs.length === 0) {
          auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy bản ghi nhật ký phù hợp với bộ lọc.</td></tr>`;
          return;
        }

        auditTableBody.innerHTML = logs.map(l => {
          const isSuccess = l.status === 'SUCCESS';
          const isLocked = l.status === 'LOCKED' || l.status === 'ACCOUNT_LOCKED';
          let badgeClass = 'badge-success';
          let statusText = l.status;
          if (isLocked) {
            badgeClass = 'badge-warning';
            statusText = l.status === 'ACCOUNT_LOCKED' ? 'KHÓA THỦ CÔNG' : 'BỊ KHÓA';
          } else if (l.status === 'FAILURE') {
            badgeClass = 'badge-danger';
            statusText = 'THẤT BẠI';
          } else if (l.status === 'LOGOUT') {
            badgeClass = 'badge-secondary';
            statusText = 'ĐĂNG XUẤT';
          } else if (l.status === 'ACCOUNT_UNLOCKED') {
            badgeClass = 'badge-info';
            statusText = 'MỞ KHÓA';
          } else if (isSuccess) {
            statusText = 'THÀNH CÔNG';
          }

          let actionLabel = 'Đăng nhập';
          if (l.status === 'LOGOUT') actionLabel = 'Đăng xuất';
          else if (l.status === 'ACCOUNT_LOCKED') actionLabel = 'Khóa tài khoản';
          else if (l.status === 'ACCOUNT_UNLOCKED') actionLabel = 'Mở khóa';
          else if (l.status === 'LOCKED') actionLabel = 'Tự khóa bảo vệ';
          else if (l.action) actionLabel = l.action;

          return `
            <tr>
              <td class="font-mono" style="font-size: 0.775rem;">${new Date(l.attempted_at).toLocaleString('vi-VN')}</td>
              <td><strong>${l.email || '—'}</strong></td>
              <td>${actionLabel}</td>
              <td><span class="badge ${badgeClass} font-mono" style="font-size: 0.7rem;">${statusText}</span></td>
              <td style="color: var(--color-text-secondary); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.reason || ''}">${l.reason || '—'}</td>
              <td class="font-mono" style="font-size: 0.775rem; color: var(--color-text-muted);">${l.ip_address || '127.0.0.1'}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs btn-view-audit-detail" data-id="${l.id}" title="Xem toàn bộ thông số chi tiết của bản ghi này">
                  <span>Chi tiết</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');

        // Attach click listeners to view detail buttons
        document.querySelectorAll('.btn-view-audit-detail').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const logId = btn.getAttribute('data-id');
            const foundLog = currentAuditLogs.find(item => item.id === logId);
            openAuditDetailModal(logId, foundLog);
          });
        });
      } else {
        if (auditTableBody) {
          auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-danger); padding: 24px;">Không thể tải nhật ký: ${res.data?.message || 'Lỗi phân quyền hoặc kết nối.'}</td></tr>`;
        }
      }
    } catch (e) {
      console.error('Failed to load audit logs:', e);
      if (auditTableBody) {
        auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-danger); padding: 24px;">Lỗi kết nối khi tải nhật ký kiểm toán.</td></tr>`;
      }
    }
  }

  // Open & Render Audit Detail Modal
  async function openAuditDetailModal(logId, initialLog = null) {
    if (!auditDetailModal) return;

    // Reset fields
    const modalIdBadge = document.getElementById('audit-modal-id-badge');
    const modalAction = document.getElementById('audit-modal-action');
    const modalStatusBadge = document.getElementById('audit-modal-status-badge');
    const modalRiskBadge = document.getElementById('audit-modal-risk-badge');
    const modalTime = document.getElementById('audit-modal-time');
    const modalEmail = document.getElementById('audit-modal-email');
    const modalUserName = document.getElementById('audit-modal-user-name');
    const modalUserDept = document.getElementById('audit-modal-user-dept');
    const modalUserRoles = document.getElementById('audit-modal-user-roles');
    const modalUserStatus = document.getElementById('audit-modal-user-status');
    const modalUserAttempts = document.getElementById('audit-modal-user-attempts');
    const modalIp = document.getElementById('audit-modal-ip');
    const modalReasonBox = document.getElementById('audit-modal-reason-box');
    const modalAdviceText = document.getElementById('audit-modal-advice-text');
    const modalRawJson = document.getElementById('audit-modal-raw-json');

    const log = initialLog || { id: logId, email: '—', ip_address: '127.0.0.1', status: 'UNKNOWN', attempted_at: new Date().toISOString() };
    currentEnrichedAuditLog = log;

    if (modalIdBadge) modalIdBadge.textContent = log.id || logId;
    if (modalTime) modalTime.textContent = log.attempted_at ? new Date(log.attempted_at).toLocaleString('vi-VN') : '—';
    if (modalEmail) modalEmail.textContent = log.email || '—';
    if (modalIp) modalIp.textContent = log.ip_address || '127.0.0.1';
    if (modalReasonBox) modalReasonBox.textContent = log.reason || 'Không có ghi chú thêm.';
    if (modalUserName) modalUserName.textContent = 'Đang tra cứu hồ sơ...';
    if (modalUserDept) modalUserDept.textContent = 'Đang đồng bộ...';
    if (modalUserRoles) modalUserRoles.textContent = 'Đang kiểm tra...';
    if (modalUserStatus) modalUserStatus.textContent = 'Đang kiểm tra...';
    if (modalUserAttempts) modalUserAttempts.textContent = '—';

    // Status & Risk Styling
    const isSuccess = log.status === 'SUCCESS';
    const isLocked = log.status === 'LOCKED' || log.status === 'ACCOUNT_LOCKED';
    let statusClass = 'badge-success';
    let statusLabel = 'THÀNH CÔNG';
    if (isLocked) {
      statusClass = 'badge-warning';
      statusLabel = log.status === 'ACCOUNT_LOCKED' ? 'KHÓA THỦ CÔNG' : 'BỊ KHÓA';
    } else if (log.status === 'FAILURE') {
      statusClass = 'badge-danger';
      statusLabel = 'THẤT BẠI';
    } else if (log.status === 'LOGOUT') {
      statusClass = 'badge-secondary';
      statusLabel = 'ĐĂNG XUẤT';
    } else if (log.status === 'ACCOUNT_UNLOCKED') {
      statusClass = 'badge-info';
      statusLabel = 'MỞ KHÓA';
    }

    if (modalStatusBadge) {
      modalStatusBadge.innerHTML = `<span class="badge ${statusClass} font-mono">${statusLabel}</span>`;
    }

    let riskBadgeHtml = `<span class="badge badge-success font-mono">Thấp (An toàn)</span>`;
    let advice = 'Sự kiện xác thực hợp lệ. Không phát hiện dấu hiệu bất thường.';
    if (isLocked) {
      riskBadgeHtml = `<span class="badge badge-danger font-mono">Cao (Tài khoản bị hạn chế)</span>`;
      advice = 'Cảnh báo an ninh: Tài khoản hiện đã bị khóa. Vui lòng kiểm tra các vị trí tuyển dụng phụ trách để bàn giao cho nhân sự khác.';
    } else if (log.status === 'FAILURE') {
      riskBadgeHtml = `<span class="badge badge-warning font-mono">Trung bình (Thử sai)</span>`;
      advice = 'Khuyến nghị an ninh: Theo dõi số lần nhập sai liên tiếp từ địa chỉ IP này để đề phòng tấn công dò mật khẩu.';
    } else if (log.status === 'ACCOUNT_UNLOCKED') {
      riskBadgeHtml = `<span class="badge badge-info font-mono">Thấp (Quản trị can thiệp)</span>`;
      advice = 'Thao tác mở khóa tài khoản được thực hiện bởi Quản trị viên hệ thống.';
    }

    if (modalRiskBadge) modalRiskBadge.innerHTML = riskBadgeHtml;
    if (modalAdviceText) modalAdviceText.textContent = advice;

    let actionLabel = 'Xác thực / Đăng nhập';
    if (log.status === 'LOGOUT') actionLabel = 'Đăng xuất khỏi hệ thống';
    else if (log.status === 'ACCOUNT_LOCKED') actionLabel = 'Khóa tài khoản quản trị';
    else if (log.status === 'ACCOUNT_UNLOCKED') actionLabel = 'Mở khóa tài khoản';
    else if (log.status === 'LOCKED') actionLabel = 'Khóa bảo mật tự động';
    if (modalAction) modalAction.textContent = actionLabel;

    if (modalRawJson) {
      modalRawJson.textContent = JSON.stringify(log, null, 2);
    }

    // Display modal
    auditDetailModal.classList.remove('hidden');

    // Async Fetch Enriched Details from Backend
    const token = sessionStorage.getItem('ats_token');
    if (token && logId) {
      try {
        const detailRes = await window.ATS_API.getAuditLogDetailApi(token, logId);
        if (detailRes.ok && detailRes.data && detailRes.data.success && detailRes.data.log) {
          const enriched = detailRes.data.log;
          currentEnrichedAuditLog = enriched;

          if (modalRawJson) {
            modalRawJson.textContent = JSON.stringify(enriched, null, 2);
          }

          if (enriched.user) {
            if (modalUserName) modalUserName.textContent = enriched.user.fullName || 'Chưa cập nhật';
            if (modalUserDept) modalUserDept.textContent = enriched.user.department || 'Không xác định';
            if (modalUserRoles) {
              modalUserRoles.textContent = (enriched.user.roles && enriched.user.roles.length > 0) 
                ? enriched.user.roles.join(', ') 
                : 'Chưa gán vai trò';
            }
            if (modalUserStatus) {
              const uStatus = enriched.user.accountStatus || 'ACTIVE';
              const uClass = uStatus === 'ACTIVE' ? 'badge-success' : 'badge-danger';
              modalUserStatus.innerHTML = `<span class="badge ${uClass} font-mono" style="font-size: 0.7rem;">${uStatus}</span>`;
            }
            if (modalUserAttempts) {
              modalUserAttempts.textContent = `${enriched.user.failedAttempts || 0} / 5 lần thử`;
            }
          } else {
            if (modalUserName) modalUserName.textContent = 'Tài khoản không còn trên hệ thống';
            if (modalUserDept) modalUserDept.textContent = '—';
            if (modalUserRoles) modalUserRoles.textContent = '—';
            if (modalUserStatus) modalUserStatus.textContent = '—';
            if (modalUserAttempts) modalUserAttempts.textContent = '—';
          }
        }
      } catch (err) {
        console.warn('Error fetching enriched audit detail:', err);
      }
    }
  }

  // Setup Audit Filter & Modal Event Listeners
  if (auditSearchInput) {
    let debounceTimer;
    auditSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadAuditLogs();
      }, 350);
    });
    auditSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        loadAuditLogs();
      }
    });
  }

  if (auditStatusFilter) {
    auditStatusFilter.addEventListener('change', () => {
      loadAuditLogs();
    });
  }

  if (auditRefreshBtn) {
    auditRefreshBtn.addEventListener('click', () => {
      loadAuditLogs();
      showToast('info', 'Làm mới', 'Đã tải lại danh sách nhật ký kiểm toán mới nhất.');
    });
  }

  // Modal Close & Copy JSON Handlers
  const closeAuditDetailModalBtn = document.getElementById('close-audit-detail-modal');
  const closeAuditDetailBtn = document.getElementById('close-audit-detail-btn');
  const copyAuditJsonBtn = document.getElementById('copy-audit-json-btn');

  function closeAuditDetailModal() {
    if (auditDetailModal) {
      auditDetailModal.classList.add('hidden');
    }
  }

  if (closeAuditDetailModalBtn) closeAuditDetailModalBtn.addEventListener('click', closeAuditDetailModal);
  if (closeAuditDetailBtn) closeAuditDetailBtn.addEventListener('click', closeAuditDetailModal);

  if (auditDetailModal) {
    auditDetailModal.addEventListener('click', (e) => {
      if (e.target === auditDetailModal) {
        closeAuditDetailModal();
      }
    });
  }

  if (copyAuditJsonBtn) {
    copyAuditJsonBtn.addEventListener('click', async () => {
      try {
        const jsonText = JSON.stringify(currentEnrichedAuditLog || {}, null, 2);
        await navigator.clipboard.writeText(jsonText);
        showToast('success', 'Đã sao chép', 'Cấu trúc dữ liệu JSON nhật ký đã được lưu vào bộ nhớ tạm.');
      } catch (err) {
        showToast('error', 'Lỗi sao chép', 'Không thể truy cập bộ nhớ tạm của trình duyệt.');
      }
    });
  }

  const auditExportBtn = document.getElementById('audit-export-btn');
  if (auditExportBtn) {
    auditExportBtn.addEventListener('click', () => {
      const rows = [];
      const trs = document.querySelectorAll('#audit-table-body tr');
      trs.forEach(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        if (tds.length >= 6) rows.push(tds.slice(0, 6));
      });
      if (rows.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Chưa có nhật ký kiểm toán để xuất.');
        return;
      }
      exportTableToCsv('nhat_ky_kiem_toan.csv', ['Thời gian', 'Tài khoản', 'Hành động', 'Kết quả', 'Chi tiết', 'IP'], rows);
    });
  }

  // ==============================================================================
  // 15. USER PROFILE VIEW
  // ==============================================================================

  async function loadUserProfile() {
    if (!currentAuthenticatedUser) return;
    const token = sessionStorage.getItem('ats_token');

    // Attempt live profile sync from backend
    if (token) {
      try {
        const res = await window.ATS_API.getProfileApi(token);
        if (res.ok && res.data && res.data.success && res.data.data) {
          const freshUser = res.data.data;
          currentAuthenticatedUser.fullName = freshUser.fullName || freshUser.full_name;
          currentAuthenticatedUser.jobTitle = freshUser.jobTitle || freshUser.job_title;
          currentAuthenticatedUser.phoneNumber = freshUser.phoneNumber || freshUser.phone_number;
          currentAuthenticatedUser.department = freshUser.departmentName || freshUser.department_name;
          sessionStorage.setItem('ats_user', JSON.stringify(currentAuthenticatedUser));
        }
      } catch {}
    }

    const u = currentAuthenticatedUser;
    const avatar = document.getElementById('profile-card-avatar');
    const name = document.getElementById('profile-card-name');
    const email = document.getElementById('profile-card-email');
    const title = document.getElementById('profile-card-title');
    const dept = document.getElementById('profile-card-dept');
    const phone = document.getElementById('profile-card-phone');
    const rolesContainer = document.getElementById('profile-card-roles');

    if (avatar) avatar.textContent = (u.fullName || u.email).charAt(0).toUpperCase();
    if (name) name.textContent = u.fullName || 'Người dùng';
    if (email) email.textContent = u.email;
    if (title) title.textContent = u.jobTitle || 'Chưa cập nhật';
    if (dept) dept.textContent = u.department || 'Chưa cập nhật';
    if (phone) phone.textContent = u.phoneNumber || u.phone || 'Chưa cập nhật';

    if (rolesContainer) {
      rolesContainer.innerHTML = (u.roles || []).map(r => `
        <span class="badge badge-primary font-mono">${ROLE_LABELS[r] || r}</span>
      `).join(' ');
    }
  }

  const profileOpenChangePwdBtn = document.getElementById('profile-open-change-pwd-btn');
  if (profileOpenChangePwdBtn) {
    profileOpenChangePwdBtn.addEventListener('click', openChangePwdModal);
  }

  // Edit Profile Modal Wiring
  const profileEditBtn = document.getElementById('profile-edit-btn');
  const editProfileModal = document.getElementById('edit-profile-modal');
  const closeEditProfileModal = document.getElementById('close-edit-profile-modal');
  const cancelEditProfileBtn = document.getElementById('cancel-edit-profile-btn');
  const editProfileForm = document.getElementById('edit-profile-form');
  const editProfileAlert = document.getElementById('edit-profile-alert');
  const editProfileAlertMsg = document.getElementById('edit-profile-alert-msg');
  const editProfileNameInput = document.getElementById('edit-profile-name-input');
  const editProfileTitleInput = document.getElementById('edit-profile-title-input');
  const editProfilePhoneInput = document.getElementById('edit-profile-phone-input');

  function openEditProfileModal() {
    if (!editProfileModal || !currentAuthenticatedUser) return;
    if (editProfileAlert) editProfileAlert.classList.add('hidden');
    editProfileNameInput.value = currentAuthenticatedUser.fullName || '';
    editProfileTitleInput.value = currentAuthenticatedUser.jobTitle || '';
    editProfilePhoneInput.value = currentAuthenticatedUser.phoneNumber || currentAuthenticatedUser.phone || '';
    editProfileModal.classList.remove('hidden');
  }

  if (profileEditBtn) profileEditBtn.addEventListener('click', openEditProfileModal);
  if (closeEditProfileModal) closeEditProfileModal.addEventListener('click', () => editProfileModal.classList.add('hidden'));
  if (cancelEditProfileBtn) cancelEditProfileBtn.addEventListener('click', () => editProfileModal.classList.add('hidden'));

  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const fullName = editProfileNameInput.value.trim();
      const jobTitle = editProfileTitleInput.value.trim();
      const phoneNumber = editProfilePhoneInput.value.trim();

      try {
        const res = await window.ATS_API.updateProfileApi(token, { fullName, jobTitle, phoneNumber });
        if (res.ok && res.data && res.data.success) {
          editProfileModal.classList.add('hidden');
          showToast('success', 'Đã lưu hồ sơ', 'Thông tin cá nhân của bạn đã được cập nhật thành công.');
          currentAuthenticatedUser.fullName = fullName;
          currentAuthenticatedUser.jobTitle = jobTitle;
          currentAuthenticatedUser.phoneNumber = phoneNumber;
          currentAuthenticatedUser.phone = phoneNumber;
          sessionStorage.setItem('ats_user', JSON.stringify(currentAuthenticatedUser));
          loadUserProfile();
          const topbarName = document.getElementById('topbar-user-name');
          const sidebarName = document.getElementById('sidebar-user-name');
          const userDisplay = document.getElementById('user-display-name');
          if (topbarName) topbarName.textContent = fullName;
          if (sidebarName) sidebarName.textContent = fullName;
          if (userDisplay) userDisplay.textContent = fullName;
        } else {
          if (editProfileAlert && editProfileAlertMsg) {
            editProfileAlertMsg.textContent = res.data.message || 'Không thể cập nhật hồ sơ.';
            editProfileAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (editProfileAlert && editProfileAlertMsg) {
          editProfileAlertMsg.textContent = err.message;
          editProfileAlert.classList.remove('hidden');
        }
      }
    });
  }

  // ==============================================================================
  // 16. MODALS LOGIC
  // ==============================================================================

  // Modal: Create User
  const openCreateUserModalBtn = document.getElementById('open-create-user-modal-btn');
  const createUserModal = document.getElementById('create-user-modal');
  const closeCreateUserModal = document.getElementById('close-create-user-modal');
  const createUserForm = document.getElementById('create-user-form');
  const createUserAlert = document.getElementById('create-user-alert');
  const createUserAlertMsg = document.getElementById('create-user-alert-msg');
  const createUserSuccessBox = document.getElementById('create-user-success-box');
  const createdTempPwdDisplay = document.getElementById('created-temp-pwd-display');

  if (openCreateUserModalBtn) {
    openCreateUserModalBtn.addEventListener('click', () => {
      if (createUserModal) createUserModal.classList.remove('hidden');
      if (createUserForm) createUserForm.reset();
      if (createUserAlert) createUserAlert.classList.add('hidden');
      if (createUserSuccessBox) createUserSuccessBox.classList.add('hidden');
    });
  }

  if (closeCreateUserModal) {
    closeCreateUserModal.addEventListener('click', () => {
      if (createUserModal) createUserModal.classList.add('hidden');
    });
  }

  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const fullName = document.getElementById('create-user-fullname').value.trim();
      const email = document.getElementById('create-user-email').value.trim();
      const jobTitle = document.getElementById('create-user-jobtitle').value.trim();
      const department = document.getElementById('create-user-department').value.trim();
      const phone = document.getElementById('create-user-phone').value.trim();
      const initialRole = document.getElementById('create-user-role').value;

      try {
        const res = await window.ATS_API.createUserApi(token, {
          fullName,
          email,
          jobTitle,
          department,
          phone,
          initialRole
        });

        if (res.ok && res.data && res.data.success) {
          if (createUserAlert) createUserAlert.classList.add('hidden');
          if (createUserSuccessBox) {
            createUserSuccessBox.classList.remove('hidden');
            if (createdTempPwdDisplay) {
              createdTempPwdDisplay.textContent = res.data.data.temporaryPassword || 'Ats@Temp1234';
            }
          }
          showToast('success', 'Thành công', `Tài khoản ${fullName} đã được tạo.`);
          loadUsers();
        } else {
          if (createUserAlert && createUserAlertMsg) {
            createUserAlertMsg.textContent = res.data.message || 'Không thể tạo tài khoản.';
            createUserAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createUserAlert && createUserAlertMsg) {
          createUserAlertMsg.textContent = err.message;
          createUserAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Modal: Edit User
  const editUserModal = document.getElementById('edit-user-modal');
  const closeEditUserModal = document.getElementById('close-edit-user-modal');
  const editUserForm = document.getElementById('edit-user-form');
  const editUserAlert = document.getElementById('edit-user-alert');
  const editUserAlertMsg = document.getElementById('edit-user-alert-msg');

  function openEditUserModal(user) {
    if (!editUserModal) return;
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-fullname').value = user.fullName || '';
    document.getElementById('edit-user-jobtitle').value = user.jobTitle || '';
    document.getElementById('edit-user-department').value = user.department || '';
    document.getElementById('edit-user-phone').value = user.phone || '';

    if (editUserAlert) editUserAlert.classList.add('hidden');
    editUserModal.classList.remove('hidden');
  }

  if (closeEditUserModal) {
    closeEditUserModal.addEventListener('click', () => {
      if (editUserModal) editUserModal.classList.add('hidden');
    });
  }

  if (editUserForm) {
    editUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const id = document.getElementById('edit-user-id').value;
      const fullName = document.getElementById('edit-user-fullname').value.trim();
      const jobTitle = document.getElementById('edit-user-jobtitle').value.trim();
      const department = document.getElementById('edit-user-department').value.trim();
      const phone = document.getElementById('edit-user-phone').value.trim();

      try {
        const res = await window.ATS_API.updateUserApi(token, id, { fullName, jobTitle, department, phone });
        if (res.ok && res.data && res.data.success) {
          editUserModal.classList.add('hidden');
          showToast('success', 'Cập nhật thành công', `Hồ sơ ${fullName} đã được cập nhật.`);
          loadUsers();
        } else {
          if (editUserAlert && editUserAlertMsg) {
            editUserAlertMsg.textContent = res.data.message || 'Không thể cập nhật tài khoản.';
            editUserAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (editUserAlert && editUserAlertMsg) {
          editUserAlertMsg.textContent = err.message;
          editUserAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Modal: Assign Roles
  const assignRolesModal = document.getElementById('assign-roles-modal');
  const closeAssignRolesModal = document.getElementById('close-assign-roles-modal');
  const cancelAssignRolesBtn = document.getElementById('cancel-assign-roles-btn');
  const assignRolesForm = document.getElementById('assign-roles-form');
  const assignRolesAlert = document.getElementById('assign-roles-alert');
  const assignRolesAlertMsg = document.getElementById('assign-roles-alert-msg');
  const assignRolesSelfWarning = document.getElementById('assign-roles-self-warning');
  const assignRolesCheckboxContainer = document.getElementById('assign-roles-checkbox-container');

  function openAssignRolesModal(user) {
    if (!assignRolesModal) return;
    document.getElementById('assign-roles-user-id').value = user.id;
    document.getElementById('assign-roles-user-name').textContent = user.fullName || user.email;
    document.getElementById('assign-roles-user-email').textContent = user.email;

    const isSelf = currentAuthenticatedUser && (currentAuthenticatedUser.id === user.id || currentAuthenticatedUser.email === user.email);
    if (assignRolesSelfWarning) {
      if (isSelf) assignRolesSelfWarning.classList.remove('hidden');
      else assignRolesSelfWarning.classList.add('hidden');
    }

    if (assignRolesCheckboxContainer) {
      const allRoles = ['ADMIN', 'HR_MANAGER', 'RECRUITER', 'HIRING_MGR', 'INTERVIEWER', 'APPROVER', 'CANDIDATE'];
      const userRoles = user.roles || [];

      assignRolesCheckboxContainer.innerHTML = allRoles.map(role => {
        const checked = userRoles.includes(role) ? 'checked' : '';
        return `
          <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer; padding: 4px 6px; border-radius: 4px;">
            <input type="checkbox" name="assign-roles" value="${role}" ${checked} style="accent-color: var(--color-primary); cursor: pointer;" />
            <span style="font-weight: 600; color: var(--color-text);">${ROLE_LABELS[role] || role}</span>
            <span class="badge badge-neutral font-mono" style="font-size: 0.7rem; margin-left: auto;">${role}</span>
          </label>
        `;
      }).join('');
    }

    if (assignRolesAlert) assignRolesAlert.classList.add('hidden');
    assignRolesModal.classList.remove('hidden');
  }

  if (closeAssignRolesModal) closeAssignRolesModal.addEventListener('click', () => assignRolesModal.classList.add('hidden'));
  if (cancelAssignRolesBtn) cancelAssignRolesBtn.addEventListener('click', () => assignRolesModal.classList.add('hidden'));

  if (assignRolesForm) {
    assignRolesForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const userId = document.getElementById('assign-roles-user-id').value;
      const checkedBoxes = document.querySelectorAll('input[name="assign-roles"]:checked');
      const selectedRoles = Array.from(checkedBoxes).map(cb => cb.value);

      if (selectedRoles.length === 0) {
        if (assignRolesAlert && assignRolesAlertMsg) {
          assignRolesAlertMsg.textContent = 'Mỗi tài khoản bắt buộc phải có ít nhất 1 vai trò hệ thống.';
          assignRolesAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.assignRolesApi(token, userId, selectedRoles);
        if (res.ok && res.data && res.data.success) {
          assignRolesModal.classList.add('hidden');
          showToast('success', 'Phân quyền thành công', 'Vai trò đã được gán và có hiệu lực ngay lập tức.');
          loadUsers();
        } else {
          if (assignRolesAlert && assignRolesAlertMsg) {
            assignRolesAlertMsg.textContent = res.data.message || 'Không thể cập nhật vai trò.';
            assignRolesAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (assignRolesAlert && assignRolesAlertMsg) {
          assignRolesAlertMsg.textContent = err.message;
          assignRolesAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Modal: Lock User & Handover Warning Flow
  const lockUserModal = document.getElementById('lock-user-modal');
  const closeLockUserModal = document.getElementById('close-lock-user-modal');
  const cancelLockUserBtn = document.getElementById('cancel-lock-user-btn');
  const lockUserForm = document.getElementById('lock-user-form');
  const lockUserAlert = document.getElementById('lock-user-alert');
  const lockUserAlertMsg = document.getElementById('lock-user-alert-msg');
  const lockSelfWarning = document.getElementById('lock-self-warning');
  const handoverWarningModal = document.getElementById('handover-warning-modal');
  const closeHandoverModal = document.getElementById('close-handover-modal');
  const acknowledgeHandoverBtn = document.getElementById('acknowledge-handover-btn');
  const handoverReqsContainer = document.getElementById('handover-requisitions-container');

  function openLockUserModal(id, name, email) {
    if (!lockUserModal) return;
    document.getElementById('lock-user-id').value = id;
    document.getElementById('lock-user-name').textContent = name;
    document.getElementById('lock-user-email').textContent = email;
    document.getElementById('lock-reason-input').value = '';

    const isSelf = currentAuthenticatedUser && (currentAuthenticatedUser.id === id || currentAuthenticatedUser.email === email);
    if (lockSelfWarning) {
      if (isSelf) lockSelfWarning.classList.remove('hidden');
      else lockSelfWarning.classList.add('hidden');
    }

    if (lockUserAlert) lockUserAlert.classList.add('hidden');
    lockUserModal.classList.remove('hidden');
  }

  if (closeLockUserModal) closeLockUserModal.addEventListener('click', () => lockUserModal.classList.add('hidden'));
  if (cancelLockUserBtn) cancelLockUserBtn.addEventListener('click', () => lockUserModal.classList.add('hidden'));

  if (lockUserForm) {
    lockUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const userId = document.getElementById('lock-user-id').value;
      const reason = document.getElementById('lock-reason-input').value.trim();

      if (!reason) {
        if (lockUserAlert && lockUserAlertMsg) {
          lockUserAlertMsg.textContent = 'Vui lòng nhập lý do khóa tài khoản.';
          lockUserAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.lockUserApi(token, userId, reason);
        if (res.ok && res.data && res.data.success) {
          lockUserModal.classList.add('hidden');
          showToast('success', 'Đã khóa tài khoản', 'Tài khoản nhân sự đã bị khóa và chấm dứt các phiên làm việc.');
          loadUsers();

          // Check if this user had active requisitions requiring handover
          const handoverReqs = res.data.data.handoverRequisitions || [];
          if (handoverReqs.length > 0 && handoverWarningModal) {
            if (handoverReqsContainer) {
              handoverReqsContainer.innerHTML = `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Vị trí</th>
                      <th>Phòng ban</th>
                      <th>Chỉ tiêu</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${handoverReqs.map(r => `
                      <tr>
                        <td><code class="font-mono" style="color: var(--color-primary);">${r.code}</code></td>
                        <td><strong>${r.title}</strong></td>
                        <td>${r.department}</td>
                        <td>${r.headcount}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `;
            }
            handoverWarningModal.classList.remove('hidden');
          }
        } else {
          if (lockUserAlert && lockUserAlertMsg) {
            lockUserAlertMsg.textContent = res.data.message || 'Không thể khóa tài khoản.';
            lockUserAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (lockUserAlert && lockUserAlertMsg) {
          lockUserAlertMsg.textContent = err.message;
          lockUserAlert.classList.remove('hidden');
        }
      }
    });
  }

  if (closeHandoverModal) closeHandoverModal.addEventListener('click', () => handoverWarningModal.classList.add('hidden'));
  if (acknowledgeHandoverBtn) {
    acknowledgeHandoverBtn.addEventListener('click', () => {
      handoverWarningModal.classList.add('hidden');
      switchView('requisitions');
    });
  }

  // Modal: Create Requisition
  const openCreateReqModalBtn = document.getElementById('open-create-req-modal-btn');
  const createReqModal = document.getElementById('create-req-modal');
  const closeCreateReqModal = document.getElementById('close-create-req-modal');
  const cancelCreateReqBtn = document.getElementById('cancel-create-req-btn');
  const createReqForm = document.getElementById('create-req-form');
  const createReqAlert = document.getElementById('create-req-alert');
  const createReqAlertMsg = document.getElementById('create-req-alert-msg');
  const createReqRecruiterSelect = document.getElementById('create-req-recruiter-select');

  async function openCreateReqModal() {
    if (!createReqModal) return;
    if (createReqForm) createReqForm.reset();
    if (createReqAlert) createReqAlert.classList.add('hidden');

    // Populate Recruiters list
    const token = sessionStorage.getItem('ats_token');
    if (token && createReqRecruiterSelect) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          createReqRecruiterSelect.innerHTML = `<option value="">-- Chưa chỉ định --</option>` +
            recruiters.map(r => `<option value="${r.id}">${r.fullName || r.email} (${r.email})</option>`).join('');
        }
      } catch {
        // Fallback
      }
    }

    createReqModal.classList.remove('hidden');
  }

  if (openCreateReqModalBtn) openCreateReqModalBtn.addEventListener('click', openCreateReqModal);
  if (closeCreateReqModal) closeCreateReqModal.addEventListener('click', () => createReqModal.classList.add('hidden'));
  if (cancelCreateReqBtn) cancelCreateReqBtn.addEventListener('click', () => createReqModal.classList.add('hidden'));

  if (createReqForm) {
    createReqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const title = document.getElementById('create-req-title-input').value.trim();
      const department = document.getElementById('create-req-dept-input').value.trim();
      const headcount = parseInt(document.getElementById('create-req-headcount-input').value, 10) || 1;
      const recruiterId = createReqRecruiterSelect ? createReqRecruiterSelect.value : null;

      try {
        const res = await window.ATS_API.createRequisition(token, {
          title,
          department,
          headcount,
          assignedRecruiterId: recruiterId || null
        });

        if (res.ok && res.data && res.data.success) {
          createReqModal.classList.add('hidden');
          showToast('success', 'Khởi tạo thành công', `Vị trí "${title}" đã được mở tuyển dụng.`);
          loadRequisitions();
          loadDashboardData();
        } else {
          if (createReqAlert && createReqAlertMsg) {
            createReqAlertMsg.textContent = res.data.message || 'Không thể tạo vị trí tuyển dụng.';
            createReqAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createReqAlert && createReqAlertMsg) {
          createReqAlertMsg.textContent = err.message;
          createReqAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Modal: Reassign Handover
  const reassignHandoverModal = document.getElementById('reassign-handover-modal');
  const closeReassignHandoverModal = document.getElementById('close-reassign-handover-modal');
  const cancelReassignHandoverBtn = document.getElementById('cancel-reassign-handover-btn');
  const reassignHandoverForm = document.getElementById('reassign-handover-form');
  const reassignHandoverAlert = document.getElementById('reassign-handover-alert');
  const reassignHandoverAlertMsg = document.getElementById('reassign-handover-alert-msg');
  const handoverNewRecruiterSelect = document.getElementById('handover-new-recruiter-select');

  async function openReassignHandoverModal(reqId, reqCode, reqTitle) {
    if (!reassignHandoverModal) return;
    document.getElementById('handover-req-id').value = reqId;
    document.getElementById('handover-req-code').textContent = reqCode;
    document.getElementById('handover-req-title').textContent = reqTitle;
    document.getElementById('handover-notes-input').value = '';

    const token = sessionStorage.getItem('ats_token');
    if (token && handoverNewRecruiterSelect) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          handoverNewRecruiterSelect.innerHTML = `<option value="">-- Chọn nhân sự tiếp quản --</option>` +
            recruiters.map(r => `<option value="${r.id}">${r.fullName || r.email} (${r.email})</option>`).join('');
        }
      } catch {
        // Fallback
      }
    }

    if (reassignHandoverAlert) reassignHandoverAlert.classList.add('hidden');
    reassignHandoverModal.classList.remove('hidden');
  }

  if (closeReassignHandoverModal) closeReassignHandoverModal.addEventListener('click', () => reassignHandoverModal.classList.add('hidden'));
  if (cancelReassignHandoverBtn) cancelReassignHandoverBtn.addEventListener('click', () => reassignHandoverModal.classList.add('hidden'));

  if (reassignHandoverForm) {
    reassignHandoverForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const reqId = document.getElementById('handover-req-id').value;
      const newRecruiterId = handoverNewRecruiterSelect.value;
      const notes = document.getElementById('handover-notes-input').value.trim();

      if (!newRecruiterId) {
        if (reassignHandoverAlert && reassignHandoverAlertMsg) {
          reassignHandoverAlertMsg.textContent = 'Vui lòng chọn chuyên viên tuyển dụng mới tiếp nhận.';
          reassignHandoverAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.handoverRequisition(token, reqId, { newRecruiterId, notes });
        if (res.ok && res.data && res.data.success) {
          reassignHandoverModal.classList.add('hidden');
          showToast('success', 'Bàn giao hoàn tất', 'Vị trí đã được bàn giao và gỡ bỏ cảnh báo.');
          loadRequisitions();
          loadDashboardData();
        } else {
          if (reassignHandoverAlert && reassignHandoverAlertMsg) {
            reassignHandoverAlertMsg.textContent = res.data.message || 'Không thể bàn giao vị trí.';
            reassignHandoverAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (reassignHandoverAlert && reassignHandoverAlertMsg) {
          reassignHandoverAlertMsg.textContent = err.message;
          reassignHandoverAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Modal: Forgot Password & OTP Flow
  const openForgotPwdBtn = document.getElementById('open-forgot-pwd-btn');
  const forgotModal = document.getElementById('forgot-modal');
  const closeForgotModal = document.getElementById('close-forgot-modal');
  const forgotForm = document.getElementById('forgot-form');
  const forgotAlert = document.getElementById('forgot-alert');
  const forgotAlertMsg = document.getElementById('forgot-alert-msg');
  const otpForm = document.getElementById('otp-form');
  const forgotOtpInput = document.getElementById('forgot-otp-input');
  const verifyOtpBtn = document.getElementById('verify-otp-btn');
  const resendOtpBtn = document.getElementById('resend-otp-btn');
  const backToForgotStep1Btn = document.getElementById('back-to-forgot-step1-btn');
  const otpNotice = document.getElementById('otp-notice');

  let currentForgotEmail = '';
  let resendCooldownTimer = null;

  function startResendCooldown(seconds = 60) {
    if (!resendOtpBtn) return;
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    let remaining = seconds;
    resendOtpBtn.disabled = true;
    resendOtpBtn.style.pointerEvents = 'none';
    resendOtpBtn.textContent = `Gửi lại mã (${remaining}s)`;

    resendCooldownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendCooldownTimer);
        resendOtpBtn.disabled = false;
        resendOtpBtn.style.pointerEvents = '';
        resendOtpBtn.textContent = 'Gửi lại mã OTP';
      } else {
        resendOtpBtn.textContent = `Gửi lại mã (${remaining}s)`;
      }
    }, 1000);
  }

  function resetForgotModalState() {
    if (forgotForm) {
      forgotForm.reset();
      forgotForm.classList.remove('hidden');
    }
    if (otpForm) {
      otpForm.reset();
      otpForm.classList.add('hidden');
    }
    if (forgotAlert) forgotAlert.classList.add('hidden');
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    if (resendOtpBtn) {
      resendOtpBtn.disabled = false;
      resendOtpBtn.style.pointerEvents = '';
      resendOtpBtn.textContent = 'Gửi lại mã OTP';
    }
  }

  if (openForgotPwdBtn && forgotModal) {
    openForgotPwdBtn.addEventListener('click', () => {
      resetForgotModalState();
      forgotModal.classList.remove('hidden');
    });
  }

  if (closeForgotModal && forgotModal) {
    closeForgotModal.addEventListener('click', () => {
      resetForgotModalState();
      forgotModal.classList.add('hidden');
    });
  }

  // Step 1: Request Password Reset OTP
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) return;

      const submitBtn = document.getElementById('forgot-submit-btn');
      if (submitBtn) submitBtn.disabled = true;
      if (forgotAlert) forgotAlert.classList.add('hidden');

      try {
        const res = await window.ATS_API.requestPasswordResetApi(email);
        if (submitBtn) submitBtn.disabled = false;

        if (res.ok && res.data && res.data.success) {
          currentForgotEmail = email;
          showToast('success', 'Mã OTP đã gửi', `Mã xác thực gồm 6 chữ số đã được gửi tới ${email}.`);

          if (otpForm) {
            forgotForm.classList.add('hidden');
            otpForm.classList.remove('hidden');
            if (otpNotice) {
              otpNotice.innerHTML = `Mã xác thực OTP gồm 6 chữ số đã được gửi đến email <strong>${email}</strong>. Mã có hiệu lực trong vòng <strong>10 phút</strong>.`;
            }
            if (forgotOtpInput) {
              forgotOtpInput.value = '';
              forgotOtpInput.focus();
            }
            startResendCooldown(60);
          } else {
            forgotModal.classList.add('hidden');
          }
        } else {
          if (forgotAlert && forgotAlertMsg) {
            forgotAlertMsg.textContent = res.data.message || 'Yêu cầu không thành công.';
            forgotAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (forgotAlert && forgotAlertMsg) {
          forgotAlertMsg.textContent = err.message;
          forgotAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Step 2: Verify 6-digit OTP
  if (otpForm) {
    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = forgotOtpInput ? forgotOtpInput.value.trim() : '';

      if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        if (forgotAlert && forgotAlertMsg) {
          forgotAlertMsg.textContent = 'Vui lòng nhập chính xác mã OTP gồm 6 chữ số.';
          forgotAlert.classList.remove('hidden');
        }
        return;
      }

      if (verifyOtpBtn) verifyOtpBtn.disabled = true;
      if (forgotAlert) forgotAlert.classList.add('hidden');

      try {
        const res = await window.ATS_API.verifyOtpApi(currentForgotEmail, otp);
        if (verifyOtpBtn) verifyOtpBtn.disabled = false;

        if (res.ok && res.data && res.data.success) {
          forgotModal.classList.add('hidden');
          showToast('success', 'Xác thực OTP thành công', 'Mã OTP hợp lệ. Vui lòng thiết lập mật khẩu mới.');
          const resetToken = res.data.resetToken || '';
          openResetModal(resetToken);
        } else {
          if (forgotAlert && forgotAlertMsg) {
            forgotAlertMsg.textContent = res.data.message || 'Mã OTP không chính xác hoặc đã hết hạn.';
            forgotAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (verifyOtpBtn) verifyOtpBtn.disabled = false;
        if (forgotAlert && forgotAlertMsg) {
          forgotAlertMsg.textContent = err.message;
          forgotAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Resend OTP button
  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!currentForgotEmail) return;

      try {
        const res = await window.ATS_API.resendOtpApi(currentForgotEmail);
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Đã gửi lại mã OTP', `Mã OTP mới đã được gửi tới email ${currentForgotEmail}.`);
          startResendCooldown(60);
          if (forgotOtpInput) {
            forgotOtpInput.value = '';
            forgotOtpInput.focus();
          }
        } else {
          if (forgotAlert && forgotAlertMsg) {
            forgotAlertMsg.textContent = res.data.message || 'Không thể gửi lại mã OTP lúc này.';
            forgotAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (forgotAlert && forgotAlertMsg) {
          forgotAlertMsg.textContent = err.message;
          forgotAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Back to step 1 (change email)
  if (backToForgotStep1Btn) {
    backToForgotStep1Btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (otpForm) otpForm.classList.add('hidden');
      if (forgotForm) forgotForm.classList.remove('hidden');
      if (forgotAlert) forgotAlert.classList.add('hidden');
      if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    });
  }

  // Modal: Reset Password with Token
  const resetModal = document.getElementById('reset-modal');
  const closeResetModal = document.getElementById('close-reset-modal');
  const resetForm = document.getElementById('reset-form');
  const resetAlert = document.getElementById('reset-alert');
  const resetAlertMsg = document.getElementById('reset-alert-msg');
  const resetTokenInput = document.getElementById('reset-token-input');
  const resetNewPassword = document.getElementById('reset-new-password');
  const resetConfirmPassword = document.getElementById('reset-confirm-password');
  const linkOpenResetModal = document.getElementById('link-open-reset-modal');

  function openResetModal(token = '') {
    if (!resetModal) return;
    if (resetForm) resetForm.reset();
    if (resetTokenInput) resetTokenInput.value = token;
    if (resetAlert) resetAlert.classList.add('hidden');
    resetModal.classList.remove('hidden');
  }

  if (closeResetModal && resetModal) {
    closeResetModal.addEventListener('click', () => resetModal.classList.add('hidden'));
  }

  if (linkOpenResetModal) {
    linkOpenResetModal.addEventListener('click', (e) => {
      e.preventDefault();
      if (forgotModal) forgotModal.classList.add('hidden');
      const manualToken = prompt('Vui lòng dán mã token đặt lại mật khẩu nhận được từ email:') || '';
      if (manualToken.trim()) {
        openResetModal(manualToken.trim());
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = resetTokenInput ? resetTokenInput.value.trim() : '';
      const newPassword = resetNewPassword ? resetNewPassword.value : '';
      const confirmPassword = resetConfirmPassword ? resetConfirmPassword.value : '';

      if (!token) {
        if (resetAlert && resetAlertMsg) {
          resetAlertMsg.textContent = 'Mã token đặt lại mật khẩu không được để trống.';
          resetAlert.classList.remove('hidden');
        }
        return;
      }
      if (newPassword !== confirmPassword) {
        if (resetAlert && resetAlertMsg) {
          resetAlertMsg.textContent = 'Mật khẩu xác nhận không khớp.';
          resetAlert.classList.remove('hidden');
        }
        return;
      }
      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        if (resetAlert && resetAlertMsg) {
          resetAlertMsg.textContent = 'Mật khẩu phải tối thiểu 8 ký tự, bao gồm cả chữ và số.';
          resetAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.confirmPasswordResetApi(token, newPassword);
        if (res.ok && res.data && res.data.success) {
          resetModal.classList.add('hidden');
          showToast('success', 'Đổi mật khẩu thành công', 'Mật khẩu của bạn đã được đặt lại. Vui lòng đăng nhập bằng mật khẩu mới.');
          showAlert('success', 'Mật khẩu đã được cập nhật thành công. Vui lòng đăng nhập lại.');
        } else {
          if (resetAlert && resetAlertMsg) {
            resetAlertMsg.textContent = res.data.message || 'Mã token không hợp lệ hoặc đã hết hạn.';
            resetAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (resetAlert && resetAlertMsg) {
          resetAlertMsg.textContent = err.message;
          resetAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Check URL query parameters for ?token= or ?reset_token=
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const resetTokenFromUrl = urlParams.get('token') || urlParams.get('reset_token');
    if (resetTokenFromUrl) {
      openResetModal(resetTokenFromUrl);
    }
  } catch {}

  // Modal: Change Password in Session
  const changePwdModal = document.getElementById('change-pwd-modal');
  const closeChangePwdModal = document.getElementById('close-change-pwd-modal');
  const changePwdForm = document.getElementById('change-pwd-form');
  const changePwdAlert = document.getElementById('change-pwd-alert');
  const changePwdAlertMsg = document.getElementById('change-pwd-alert-msg');

  function openChangePwdModal() {
    if (!changePwdModal) return;
    if (changePwdForm) changePwdForm.reset();
    if (changePwdAlert) changePwdAlert.classList.add('hidden');
    changePwdModal.classList.remove('hidden');
  }

  if (closeChangePwdModal) {
    closeChangePwdModal.addEventListener('click', () => changePwdModal.classList.add('hidden'));
  }

  if (changePwdForm) {
    changePwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const currentPassword = document.getElementById('change-current-pwd').value;
      const newPassword = document.getElementById('change-new-pwd').value;
      const confirmPassword = document.getElementById('change-confirm-pwd').value;

      if (newPassword !== confirmPassword) {
        if (changePwdAlert && changePwdAlertMsg) {
          changePwdAlertMsg.textContent = 'Mật khẩu mới và xác nhận mật khẩu không khớp.';
          changePwdAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.changePasswordApi(token, currentPassword, newPassword);
        if (res.ok && res.data && res.data.success) {
          const userEmail = currentAuthenticatedUser ? currentAuthenticatedUser.email : '';
          changePwdModal.classList.add('hidden');
          await performLogout(false);
          if (emailInput && userEmail) {
            emailInput.value = userEmail;
          }
          if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
          }
          showAlert('success', 'Đổi mật khẩu thành công', 'Mật khẩu tài khoản đã được cập nhật. Vui lòng nhập mật khẩu mới để đăng nhập.');
          showToast('success', 'Đổi mật khẩu thành công', 'Mật khẩu đã được đổi. Vui lòng đăng nhập lại với mật khẩu mới.');
        } else {
          if (changePwdAlert && changePwdAlertMsg) {
            changePwdAlertMsg.textContent = res.data.message || 'Không thể đổi mật khẩu.';
            changePwdAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (changePwdAlert && changePwdAlertMsg) {
          changePwdAlertMsg.textContent = err.message;
          changePwdAlert.classList.remove('hidden');
        }
      }
    });
  }

  // ==============================================================================
  // 17. S1-07 ERROR VIEW & RECOVERY INTEGRATION
  // ==============================================================================

  const errorView = document.getElementById('error-view');
  const errorCodeDisplay = document.getElementById('error-code-display');
  const errorIconDisplay = document.getElementById('error-icon-display');
  const errorHeadingDisplay = document.getElementById('error-heading-display');
  const errorMessageDisplay = document.getElementById('error-message-display');
  const errorCodeRaw = document.getElementById('error-code-raw');
  const errorPrimaryBtn = document.getElementById('error-primary-btn');
  const errorPrimaryBtnText = document.getElementById('error-primary-btn-text');
  const errorSecondaryBtn = document.getElementById('error-secondary-btn');
  const errorSecondaryBtnText = document.getElementById('error-secondary-btn-text');

  let errorRecoveryState = {
    action: 'NAVIGATE_HOME',
    suggestedPath: '/dashboard',
    previousView: 'dashboard'
  };

  function showErrorView(options = {}) {
    if (!errorView) return;

    const {
      statusCode = 404,
      code = 'NOT_FOUND',
      heading,
      message,
      requiredPermission,
      recovery = {}
    } = options;

    errorRecoveryState.previousView = currentActiveView || 'dashboard';
    errorRecoveryState.action = recovery.action || (statusCode === 401 ? 'LOGIN' : 'NAVIGATE_HOME');
    errorRecoveryState.suggestedPath = recovery.suggestedPath || (statusCode === 401 ? '/login' : '/dashboard');

    // Hide active views
    Object.keys(views).forEach(k => {
      if (views[k]) views[k].classList.add('hidden');
    });

    if (errorCodeDisplay) errorCodeDisplay.textContent = statusCode;
    if (errorCodeRaw) errorCodeRaw.textContent = code;

    if (statusCode === 401) {
      if (errorCodeDisplay) errorCodeDisplay.style.color = 'var(--color-warning)';
      if (errorHeadingDisplay) errorHeadingDisplay.textContent = heading || 'Phiên làm việc hết hạn hoặc chưa xác thực (401)';
      if (errorMessageDisplay) errorMessageDisplay.textContent = message || 'Yêu cầu không có phiên làm việc hợp lệ. Vui lòng đăng nhập lại.';
      if (errorPrimaryBtnText) errorPrimaryBtnText.textContent = recovery.label || 'Đăng nhập lại';
      if (errorSecondaryBtnText) errorSecondaryBtnText.textContent = 'Quay lại màn hình trước';
    } else if (statusCode === 403) {
      if (errorCodeDisplay) errorCodeDisplay.style.color = 'var(--color-danger)';
      if (errorHeadingDisplay) errorHeadingDisplay.textContent = heading || 'Truy cập bị từ chối (403)';
      let fullMsg = message || 'Bạn không có quyền truy cập vào chức năng này theo phân quyền hệ thống.';
      if (requiredPermission) fullMsg += ` (Yêu cầu quyền: ${requiredPermission})`;
      if (errorMessageDisplay) errorMessageDisplay.textContent = fullMsg;
      if (errorPrimaryBtnText) errorPrimaryBtnText.textContent = recovery.label || 'Về không gian làm việc của tôi';
      if (errorSecondaryBtnText) errorSecondaryBtnText.textContent = 'Quay lại trang trước';
    } else {
      if (errorCodeDisplay) errorCodeDisplay.style.color = 'var(--color-primary)';
      if (errorHeadingDisplay) errorHeadingDisplay.textContent = heading || 'Không tìm thấy trang hoặc tài nguyên (404)';
      if (errorMessageDisplay) errorMessageDisplay.textContent = message || 'Tài nguyên bạn yêu cầu không tồn tại trên hệ thống.';
      if (errorPrimaryBtnText) errorPrimaryBtnText.textContent = recovery.label || 'Về trang chủ hệ thống';
      if (errorSecondaryBtnText) errorSecondaryBtnText.textContent = 'Quay lại trang trước';
    }

    errorView.classList.remove('hidden');
  }

  if (errorPrimaryBtn) {
    errorPrimaryBtn.addEventListener('click', () => {
      errorView.classList.add('hidden');
      if (errorRecoveryState.action === 'LOGIN') {
        performLogout();
      } else {
        const token = sessionStorage.getItem('ats_token');
        if (token) {
          switchView('dashboard');
        } else {
          performLogout();
        }
      }
    });
  }

  if (errorSecondaryBtn) {
    errorSecondaryBtn.addEventListener('click', () => {
      errorView.classList.add('hidden');
      const prev = errorRecoveryState.previousView || 'dashboard';
      if (prev !== 'error') {
        switchView(prev);
      } else {
        switchView('dashboard');
      }
    });
  }

  // ==============================================================================
  // 17. CANDIDATE, INTERVIEW & OFFER MODALS & ACTIONS
  // ==============================================================================

  // --- CANDIDATE MODALS ---
  const openCreateCandidateModalBtn = document.getElementById('open-create-candidate-modal-btn');
  const createCandidateModal = document.getElementById('create-candidate-modal');
  const closeCreateCandidateModal = document.getElementById('close-create-candidate-modal');
  const cancelCreateCandidateBtn = document.getElementById('cancel-create-candidate-btn');
  const createCandidateForm = document.getElementById('create-candidate-form');
  const createCandidateAlert = document.getElementById('create-candidate-alert');
  const createCandidateAlertMsg = document.getElementById('create-candidate-alert-msg');

  if (openCreateCandidateModalBtn) {
    openCreateCandidateModalBtn.addEventListener('click', () => {
      if (createCandidateModal) createCandidateModal.classList.remove('hidden');
      if (createCandidateForm) createCandidateForm.reset();
      if (createCandidateAlert) createCandidateAlert.classList.add('hidden');

      const reqSelect = document.getElementById('create-cand-req-select');
      if (reqSelect) {
        reqSelect.innerHTML = `<option value="">-- Chọn vị trí tuyển dụng --</option>` +
          currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
      }
    });
  }

  function closeCreateCandidate() {
    if (createCandidateModal) createCandidateModal.classList.add('hidden');
  }
  if (closeCreateCandidateModal) closeCreateCandidateModal.addEventListener('click', closeCreateCandidate);
  if (cancelCreateCandidateBtn) cancelCreateCandidateBtn.addEventListener('click', closeCreateCandidate);

  if (createCandidateForm) {
    createCandidateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const fullName = document.getElementById('create-cand-fullname').value.trim();
      const email = document.getElementById('create-cand-email').value.trim();
      const phoneNumber = document.getElementById('create-cand-phone').value.trim();
      const requisitionId = document.getElementById('create-cand-req-select').value;
      const stage = document.getElementById('create-cand-stage-select').value;
      const rating = parseInt(document.getElementById('create-cand-rating').value, 10);
      const experienceYears = parseInt(document.getElementById('create-cand-exp').value, 10) || 0;
      const expectedSalary = document.getElementById('create-cand-salary').value.trim();
      const notes = document.getElementById('create-cand-notes').value.trim();

      try {
        const res = await window.ATS_API.createCandidateApi(token, {
          fullName, email, phoneNumber, requisitionId, stage, rating, experienceYears, expectedSalary, notes
        });

        if (res.ok && res.data && res.data.success) {
          closeCreateCandidate();
          showToast('success', 'Thêm ứng viên thành công', `Hồ sơ ứng viên ${fullName} đã được lưu vào hệ thống.`);
          loadCandidates();
          loadDashboardData();
        } else {
          if (createCandidateAlert && createCandidateAlertMsg) {
            createCandidateAlertMsg.textContent = res.data.message || 'Không thể tạo hồ sơ ứng viên.';
            createCandidateAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createCandidateAlert && createCandidateAlertMsg) {
          createCandidateAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          createCandidateAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Candidate Details Modal
  const candidateDetailModal = document.getElementById('candidate-detail-modal');
  const closeCandidateDetailModal = document.getElementById('close-candidate-detail-modal');
  const candDetailSaveStageBtn = document.getElementById('cand-detail-save-stage-btn');
  const candDetailScheduleBtn = document.getElementById('cand-detail-schedule-btn');
  const candDetailOfferBtn = document.getElementById('cand-detail-offer-btn');

  function openCandidateDetails(id) {
    let c = currentCandidatesList.find(x => x.id === id);
    if (!c) {
      showToast('warning', 'Hồ sơ', `Đang tải chi tiết hồ sơ ứng viên...`);
      return;
    }

    const name = c.fullName || c.full_name || 'Ứng viên';
    const avatar = document.getElementById('cand-detail-avatar');
    const nameEl = document.getElementById('cand-detail-name');
    const codeEl = document.getElementById('cand-detail-code');
    const reqTitleEl = document.getElementById('cand-detail-req-title');
    const emailEl = document.getElementById('cand-detail-email');
    const phoneEl = document.getElementById('cand-detail-phone');
    const stageBadge = document.getElementById('cand-detail-stage-badge');
    const idInput = document.getElementById('cand-detail-id');
    const stageSelect = document.getElementById('cand-detail-change-stage-select');
    const ratingEl = document.getElementById('cand-detail-rating');

    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = name;
    if (codeEl) codeEl.textContent = c.code || (c.id ? c.id.toUpperCase() : 'UV');
    if (reqTitleEl) reqTitleEl.textContent = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
    if (emailEl) emailEl.textContent = c.email || '—';
    if (phoneEl) phoneEl.textContent = c.phoneNumber || c.phone || 'Chưa cập nhật';
    if (stageBadge) {
      stageBadge.className = `badge ${STAGE_BADGES[c.stage] || 'badge-neutral'}`;
      stageBadge.textContent = STAGE_LABELS[c.stage] || c.stage;
    }
    if (idInput) idInput.value = c.id;
    if (stageSelect) stageSelect.value = c.stage;
    if (ratingEl) ratingEl.textContent = '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));

    if (candidateDetailModal) candidateDetailModal.classList.remove('hidden');
  }

  if (closeCandidateDetailModal) {
    closeCandidateDetailModal.addEventListener('click', () => {
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
    });
  }

  if (candDetailSaveStageBtn) {
    candDetailSaveStageBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id').value;
      const stage = document.getElementById('cand-detail-change-stage-select').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateCandidateStageApi(token, id, stage);
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Chuyển vòng thành công', `Đã cập nhật trạng thái ứng viên sang "${STAGE_LABELS[stage] || stage}".`);
          if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
          loadCandidates();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi cập nhật', res.data.message || 'Không thể chuyển vòng.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (candDetailScheduleBtn) {
    candDetailScheduleBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id').value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      openScheduleInterviewForCandidate(id);
    });
  }

  if (candDetailOfferBtn) {
    candDetailOfferBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id').value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      openCreateOfferForCandidate(id);
    });
  }


  // --- INTERVIEW MODALS ---
  const openCreateInterviewModalBtn = document.getElementById('open-create-interview-modal-btn');
  const scheduleInterviewModal = document.getElementById('schedule-interview-modal');
  const closeScheduleInterviewModal = document.getElementById('close-schedule-interview-modal');
  const cancelScheduleInterviewBtn = document.getElementById('cancel-schedule-interview-btn');
  const scheduleInterviewForm = document.getElementById('schedule-interview-form');
  const scheduleInterviewAlert = document.getElementById('schedule-interview-alert');
  const scheduleInterviewAlertMsg = document.getElementById('schedule-interview-alert-msg');

  function openScheduleInterviewForCandidate(preselectedCandidateId = '') {
    if (scheduleInterviewModal) scheduleInterviewModal.classList.remove('hidden');
    if (scheduleInterviewForm) scheduleInterviewForm.reset();
    if (scheduleInterviewAlert) scheduleInterviewAlert.classList.add('hidden');

    // Populate candidate dropdown
    const candSelect = document.getElementById('schedule-candidate-select');
    if (candSelect) {
      candSelect.innerHTML = `<option value="">-- Chọn ứng viên trong danh sách --</option>` +
        currentCandidatesList.map(c => `
          <option value="${c.id}" ${c.id === preselectedCandidateId ? 'selected' : ''}>
            ${c.fullName || c.full_name} (${c.code || 'UV'}) - ${c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí'}
          </option>
        `).join('');
    }

    // Populate requisitions
    const reqSelect = document.getElementById('schedule-req-select');
    if (reqSelect) {
      reqSelect.innerHTML = `<option value="">-- Theo vị trí tuyển dụng --</option>` +
        currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
    }

    // Populate interviewers
    const interviewerSelect = document.getElementById('schedule-interviewer-select');
    if (interviewerSelect) {
      interviewerSelect.innerHTML = `
        <option value="">-- Chọn cán bộ phỏng vấn --</option>
        <option value="usr-interviewer">Nguyễn Văn D - Interviewer (Kỹ thuật)</option>
        <option value="usr-hiring-mgr">Lê Thị C - Hiring Manager (Trưởng bộ phận)</option>
        <option value="usr-recruiter">Trần Thị B - Recruiter (Tuyển dụng)</option>
        <option value="usr-admin">Administrator - Quản trị viên</option>
      `;
    }

    // Pre-fill time with tomorrow 09:00 AM
    const timeInput = document.getElementById('schedule-time');
    if (timeInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const tzOffset = tomorrow.getTimezoneOffset() * 60000;
      const localISOTime = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);
      timeInput.value = localISOTime;
    }
  }

  if (openCreateInterviewModalBtn) {
    openCreateInterviewModalBtn.addEventListener('click', () => {
      openScheduleInterviewForCandidate();
    });
  }

  function closeScheduleInterview() {
    if (scheduleInterviewModal) scheduleInterviewModal.classList.add('hidden');
  }
  if (closeScheduleInterviewModal) closeScheduleInterviewModal.addEventListener('click', closeScheduleInterview);
  if (cancelScheduleInterviewBtn) cancelScheduleInterviewBtn.addEventListener('click', closeScheduleInterview);

  if (scheduleInterviewForm) {
    scheduleInterviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const candidateId = document.getElementById('schedule-candidate-select').value;
      const requisitionId = document.getElementById('schedule-req-select').value;
      const interviewerId = document.getElementById('schedule-interviewer-select').value;
      const roundName = document.getElementById('schedule-round-name').value.trim();
      const scheduledTime = document.getElementById('schedule-time').value;
      const locationOrLink = document.getElementById('schedule-location').value.trim();

      try {
        const res = await window.ATS_API.createInterviewApi(token, {
          candidateId, requisitionId, interviewerId, roundName, scheduledTime, locationOrLink
        });

        if (res.ok && res.data && res.data.success) {
          closeScheduleInterview();
          showToast('success', 'Lên lịch phỏng vấn thành công', 'Phiên phỏng vấn đã được ghi nhận và gửi lời mời.');
          loadInterviews();
          loadCandidates();
          loadDashboardData();
        } else {
          if (scheduleInterviewAlert && scheduleInterviewAlertMsg) {
            scheduleInterviewAlertMsg.textContent = res.data.message || 'Không thể tạo lịch phỏng vấn.';
            scheduleInterviewAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (scheduleInterviewAlert && scheduleInterviewAlertMsg) {
          scheduleInterviewAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          scheduleInterviewAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Interview Evaluation Details Modal
  const interviewDetailModal = document.getElementById('interview-detail-modal');
  const closeInterviewDetailModal = document.getElementById('close-interview-detail-modal');
  const cancelInterviewEvalBtn = document.getElementById('cancel-interview-eval-btn');
  const interviewEvalForm = document.getElementById('interview-eval-form');

  function openInterviewDetails(id) {
    const iv = currentInterviewsList.find(x => x.id === id);
    if (!iv) {
      showToast('warning', 'Lịch phỏng vấn', `Đang tải chi tiết buổi phỏng vấn...`);
      return;
    }

    const candName = (iv.candidate && iv.candidate.fullName) ? iv.candidate.fullName : (iv.candidate_name || 'Ứng viên');
    const reqTitle = (iv.requisition && iv.requisition.title) ? iv.requisition.title : (iv.requisition_title || 'Vị trí');
    const interviewer = (iv.interviewer && iv.interviewer.fullName) ? iv.interviewer.fullName : (iv.interviewer_name || 'Hội đồng tuyển dụng');
    const schedTime = iv.scheduledTime || iv.scheduled_time || iv.scheduled_at;
    const location = iv.locationOrLink || iv.location || 'Google Meet';

    const codeEl = document.getElementById('int-detail-code');
    const statusBadge = document.getElementById('int-detail-status-badge');
    const candNameEl = document.getElementById('int-detail-cand-name');
    const reqTitleEl = document.getElementById('int-detail-req-title');
    const roundEl = document.getElementById('int-detail-round');
    const timeEl = document.getElementById('int-detail-time');
    const locationEl = document.getElementById('int-detail-location');
    const interviewerEl = document.getElementById('int-detail-interviewer');
    const idInput = document.getElementById('int-detail-id');
    const statusSelect = document.getElementById('int-eval-status');
    const scoreSelect = document.getElementById('int-eval-score');
    const feedbackInput = document.getElementById('int-eval-feedback');

    if (codeEl) codeEl.textContent = iv.code || (iv.id ? iv.id.toUpperCase() : 'PV');
    if (statusBadge) {
      statusBadge.className = `badge ${iv.status === 'SCHEDULED' ? 'badge-warning' : (iv.status === 'COMPLETED' ? 'badge-success' : 'badge-danger')}`;
      statusBadge.textContent = iv.status === 'SCHEDULED' ? 'Sắp diễn ra' : (iv.status === 'COMPLETED' ? 'Đã hoàn thành' : 'Đã hủy');
    }
    if (candNameEl) candNameEl.textContent = candName;
    if (reqTitleEl) reqTitleEl.textContent = reqTitle;
    if (roundEl) roundEl.textContent = iv.roundName || iv.round_name || 'Vòng 1';
    if (timeEl) timeEl.textContent = new Date(schedTime).toLocaleString('vi-VN');
    if (locationEl) locationEl.textContent = location;
    if (interviewerEl) interviewerEl.textContent = interviewer;
    if (idInput) idInput.value = iv.id;
    if (statusSelect) statusSelect.value = iv.status || 'SCHEDULED';
    if (scoreSelect) scoreSelect.value = iv.score || 4;
    if (feedbackInput) feedbackInput.value = iv.feedback || '';

    if (interviewDetailModal) interviewDetailModal.classList.remove('hidden');
  }

  function closeInterviewDetail() {
    if (interviewDetailModal) interviewDetailModal.classList.add('hidden');
  }
  if (closeInterviewDetailModal) closeInterviewDetailModal.addEventListener('click', closeInterviewDetail);
  if (cancelInterviewEvalBtn) cancelInterviewEvalBtn.addEventListener('click', closeInterviewDetail);

  if (interviewEvalForm) {
    interviewEvalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('int-detail-id').value;
      const status = document.getElementById('int-eval-status').value;
      const score = document.getElementById('int-eval-score').value;
      const feedback = document.getElementById('int-eval-feedback').value.trim();
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateInterviewStatusApi(token, id, status, feedback, score);
        if (res.ok && res.data && res.data.success) {
          closeInterviewDetail();
          showToast('success', 'Đánh giá hoàn tất', 'Đã lưu biên bản và cập nhật kết quả phỏng vấn.');
          loadInterviews();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi đánh giá', res.data.message || 'Không thể lưu đánh giá.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }


  // --- OFFER MODALS ---
  const openCreateOfferModalBtn = document.getElementById('open-create-offer-modal-btn');
  const createOfferModal = document.getElementById('create-offer-modal');
  const closeCreateOfferModal = document.getElementById('close-create-offer-modal');
  const cancelCreateOfferBtn = document.getElementById('cancel-create-offer-btn');
  const createOfferForm = document.getElementById('create-offer-form');
  const createOfferAlert = document.getElementById('create-offer-alert');
  const createOfferAlertMsg = document.getElementById('create-offer-alert-msg');

  function openCreateOfferForCandidate(preselectedCandidateId = '') {
    if (createOfferModal) createOfferModal.classList.remove('hidden');
    if (createOfferForm) createOfferForm.reset();
    if (createOfferAlert) createOfferAlert.classList.add('hidden');

    const candSelect = document.getElementById('create-offer-cand-select');
    if (candSelect) {
      candSelect.innerHTML = `<option value="">-- Chọn ứng viên --</option>` +
        currentCandidatesList.map(c => `
          <option value="${c.id}" ${c.id === preselectedCandidateId ? 'selected' : ''}>
            ${c.fullName || c.full_name} (${c.code || 'UV'}) - ${c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí'}
          </option>
        `).join('');
    }

    const reqSelect = document.getElementById('create-offer-req-select');
    if (reqSelect) {
      reqSelect.innerHTML = `<option value="">-- Theo vị trí tuyển dụng --</option>` +
        currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
    }

    const approverSelect = document.getElementById('create-offer-approver-select');
    if (approverSelect) {
      approverSelect.innerHTML = `
        <option value="">-- Chọn người phê duyệt --</option>
        <option value="usr-hr-mgr">Trần Thị B - HR Manager</option>
        <option value="usr-admin">Administrator - Quản trị viên</option>
      `;
    }

    const dateInput = document.getElementById('create-offer-start-date');
    if (dateInput) {
      const nextMonth = new Date();
      nextMonth.setDate(nextMonth.getDate() + 14);
      dateInput.value = nextMonth.toISOString().split('T')[0];
    }
  }

  if (openCreateOfferModalBtn) {
    openCreateOfferModalBtn.addEventListener('click', () => {
      openCreateOfferForCandidate();
    });
  }

  function closeCreateOffer() {
    if (createOfferModal) createOfferModal.classList.add('hidden');
  }
  if (closeCreateOfferModal) closeCreateOfferModal.addEventListener('click', closeCreateOffer);
  if (cancelCreateOfferBtn) cancelCreateOfferBtn.addEventListener('click', closeCreateOffer);

  if (createOfferForm) {
    createOfferForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const candidateId = document.getElementById('create-offer-cand-select').value;
      const requisitionId = document.getElementById('create-offer-req-select').value;
      const salaryMonthly = document.getElementById('create-offer-salary').value;
      const startDate = document.getElementById('create-offer-start-date').value;
      const approverId = document.getElementById('create-offer-approver-select').value;

      try {
        const res = await window.ATS_API.createOfferApi(token, {
          candidateId, requisitionId, salaryMonthly, startDate, approverId
        });

        if (res.ok && res.data && res.data.success) {
          closeCreateOffer();
          showToast('success', 'Lập Offer thành công', 'Bản chào mời nhận việc đã được tạo và gửi phê duyệt.');
          loadOffers();
          loadCandidates();
          loadDashboardData();
        } else {
          if (createOfferAlert && createOfferAlertMsg) {
            createOfferAlertMsg.textContent = res.data.message || 'Không thể tạo Offer.';
            createOfferAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createOfferAlert && createOfferAlertMsg) {
          createOfferAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          createOfferAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Offer Details & Approval Modal
  const offerDetailModal = document.getElementById('offer-detail-modal');
  const closeOfferDetailModal = document.getElementById('close-offer-detail-modal');
  const btnActionApproveOffer = document.getElementById('btn-action-approve-offer');
  const btnActionSendOffer = document.getElementById('btn-action-send-offer');
  const btnActionRejectOffer = document.getElementById('btn-action-reject-offer');

  function openOfferDetails(id) {
    const o = currentOffersList.find(x => x.id === id);
    if (!o) {
      showToast('warning', 'Offer', `Đang tải chi tiết offer...`);
      return;
    }

    const candName = (o.candidate && o.candidate.fullName) ? o.candidate.fullName : (o.candidate_name || 'Ứng viên');
    const reqTitle = (o.requisition && o.requisition.title) ? o.requisition.title : (o.requisition_title || 'Vị trí');
    const salaryVal = o.salaryMonthly || o.salary_monthly || o.salary;
    const startDateVal = o.startDate || o.start_date;
    const approverName = (o.approver && o.approver.fullName) ? o.approver.fullName : (o.approver_name || 'HR Manager');

    const codeEl = document.getElementById('off-detail-code');
    const statusBadge = document.getElementById('off-detail-status-badge');
    const candNameEl = document.getElementById('off-detail-cand-name');
    const reqTitleEl = document.getElementById('off-detail-req-title');
    const salaryEl = document.getElementById('off-detail-salary');
    const startDateEl = document.getElementById('off-detail-start-date');
    const approverEl = document.getElementById('off-detail-approver');
    const idInput = document.getElementById('off-detail-id');

    if (codeEl) codeEl.textContent = o.code || (o.id ? o.id.toUpperCase() : 'OFF');
    if (statusBadge) {
      statusBadge.className = `badge ${o.status === 'APPROVED' ? 'badge-success' : (o.status === 'PENDING' ? 'badge-warning' : 'badge-primary')}`;
      statusBadge.textContent = o.status === 'APPROVED' ? 'Đã phê duyệt' : (o.status === 'PENDING' ? 'Chờ duyệt' : o.status);
    }
    if (candNameEl) candNameEl.textContent = candName;
    if (reqTitleEl) reqTitleEl.textContent = reqTitle;
    if (salaryEl) salaryEl.textContent = salaryVal ? Number(salaryVal).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận';
    if (startDateEl) startDateEl.textContent = startDateVal ? new Date(startDateVal).toLocaleDateString('vi-VN') : 'Thỏa thuận';
    if (approverEl) approverEl.textContent = approverName;
    if (idInput) idInput.value = o.id;

    if (offerDetailModal) offerDetailModal.classList.remove('hidden');
  }

  if (closeOfferDetailModal) {
    closeOfferDetailModal.addEventListener('click', () => {
      if (offerDetailModal) offerDetailModal.classList.add('hidden');
    });
  }

  if (btnActionApproveOffer) {
    btnActionApproveOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateOfferStatusApi(token, id, 'APPROVED');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('success', 'Tuyển dụng thành công!', 'Offer đã được duyệt. Ứng viên chính thức chuyển sang giai đoạn Đã nhận việc (Hired).');
          loadOffers();
          loadCandidates();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi phê duyệt', res.data.message || 'Không thể phê duyệt offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionSendOffer) {
    btnActionSendOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateOfferStatusApi(token, id, 'SENT');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('info', 'Đã gửi Offer', 'Đã cập nhật trạng thái phát hành thư mời cho ứng viên.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi gửi Offer', res.data.message || 'Không thể gửi offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionRejectOffer) {
    btnActionRejectOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateOfferStatusApi(token, id, 'REJECTED');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('warning', 'Từ chối Offer', 'Đã từ chối bản đề xuất offer.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi', res.data.message || 'Không thể từ chối offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  // ==============================================================================
  // 17.1 APPROVALS CENTER & CANDIDATE PORTAL & REQUISITION EDIT
  // ==============================================================================

  // --- APPROVALS CENTER ---
  async function loadApprovals() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const offersTableBody = document.getElementById('approvals-offers-table-body');
    const reqsTableBody = document.getElementById('approvals-reqs-table-body');
    const totalBadge = document.getElementById('approvals-total-badge');
    const pendingBadge = document.getElementById('pending-offers-badge');
    const sidebarBadge = document.getElementById('sidebar-badge-approvals');

    try {
      const [offersRes, reqsRes] = await Promise.all([
        window.ATS_API.getOffersApi(token),
        window.ATS_API.getRequisitionsApi(token)
      ]);

      const offers = (offersRes.ok && offersRes.data && offersRes.data.offers) ? offersRes.data.offers : [];
      const pendingOffers = offers.filter(o => o.status === 'PENDING_APPROVAL');

      if (totalBadge) totalBadge.textContent = `${pendingOffers.length} yêu cầu chờ duyệt`;
      if (pendingBadge) pendingBadge.textContent = `${pendingOffers.length} offer`;
      if (sidebarBadge) sidebarBadge.textContent = String(pendingOffers.length);

      if (offersTableBody) {
        if (pendingOffers.length === 0) {
          offersTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Hiện không có đề xuất Offer nào đang chờ phê duyệt.</td></tr>`;
        } else {
          offersTableBody.innerHTML = pendingOffers.map(o => {
            const candName = o.candidate ? o.candidate.fullName : 'Ứng viên';
            const reqTitle = o.requisition ? o.requisition.title : 'Vị trí';
            const salary = o.salaryMonthly ? Number(o.salaryMonthly).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận';
            const startDate = o.startDate ? new Date(o.startDate).toLocaleDateString('vi-VN') : '—';
            return `
              <tr>
                <td><code class="font-mono" style="color: var(--color-primary); font-weight: 600;">${o.id.substring(0, 8).toUpperCase()}</code></td>
                <td><strong>${candName}</strong></td>
                <td>${reqTitle}</td>
                <td style="color: var(--color-primary); font-weight: 600;">${salary}</td>
                <td>${startDate}</td>
                <td><span class="badge badge-warning">Chờ phê duyệt</span></td>
                <td style="text-align: center;">
                  <div style="display: flex; gap: 6px; justify-content: center;">
                    <button type="button" class="btn btn-outline btn-xs btn-quick-approve-offer" data-id="${o.id}" style="color: var(--color-success); border-color: var(--color-success);">
                      Phê duyệt (Hired)
                    </button>
                    <button type="button" class="btn btn-outline btn-xs btn-quick-reject-offer" data-id="${o.id}" style="color: var(--color-danger); border-color: var(--color-danger);">
                      Từ chối
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          document.querySelectorAll('.btn-quick-approve-offer').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-id');
              try {
                const res = await window.ATS_API.updateOfferStatusApi(token, id, 'APPROVED');
                if (res.ok && res.data && res.data.success) {
                  showToast('success', 'Đã phê duyệt!', 'Offer đã được duyệt. Ứng viên chính thức được tuyển dụng (Hired).');
                  loadApprovals();
                  loadDashboardData();
                } else {
                  showToast('danger', 'Lỗi phê duyệt', res.data.message || 'Không thể duyệt offer.');
                }
              } catch (e) {
                showToast('danger', 'Lỗi kết nối', e.message);
              }
            });
          });

          document.querySelectorAll('.btn-quick-reject-offer').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-id');
              try {
                const res = await window.ATS_API.updateOfferStatusApi(token, id, 'REJECTED');
                if (res.ok && res.data && res.data.success) {
                  showToast('warning', 'Đã từ chối', 'Đã từ chối đề xuất offer.');
                  loadApprovals();
                } else {
                  showToast('danger', 'Lỗi', res.data.message || 'Không thể từ chối.');
                }
              } catch (e) {
                showToast('danger', 'Lỗi kết nối', e.message);
              }
            });
          });
        }
      }

      if (reqsTableBody) {
        const reqs = (reqsRes.ok && reqsRes.data && reqsRes.data.requisitions) ? reqsRes.data.requisitions : [];
        if (reqs.length === 0) {
          reqsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không có vị trí tuyển dụng nào.</td></tr>`;
        } else {
          reqsTableBody.innerHTML = reqs.slice(0, 5).map(r => `
            <tr>
              <td><code class="font-mono" style="color: var(--color-primary);">${r.code}</code></td>
              <td><strong>${r.title}</strong></td>
              <td>${r.departmentName}</td>
              <td style="text-align: center; font-weight: 600;">${r.headcount}</td>
              <td><span class="badge ${r.status === 'OPEN' ? 'badge-primary' : 'badge-neutral'}">${r.status}</span></td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs btn-view-candidates-req" data-title="${r.title}">
                  Xem ứng viên
                </button>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error('Failed to load approvals:', e);
    }
  }

  // --- CANDIDATE PORTAL ---
  async function loadCandidatePortal() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const candNameEl = document.getElementById('cand-portal-name');
    const candEmailEl = document.getElementById('cand-portal-email');
    const candAvatarEl = document.getElementById('cand-portal-avatar');
    const candStageBadge = document.getElementById('cand-portal-stage-badge');

    if (currentAuthenticatedUser) {
      if (candNameEl) candNameEl.textContent = currentAuthenticatedUser.fullName || 'Ứng viên';
      if (candEmailEl) candEmailEl.textContent = currentAuthenticatedUser.email;
      if (candAvatarEl) candAvatarEl.textContent = (currentAuthenticatedUser.fullName || 'U').charAt(0).toUpperCase();
    }

    try {
      const [candRes, ivRes, offRes] = await Promise.all([
        window.ATS_API.getCandidatesApi(token),
        window.ATS_API.getInterviewsApi(token),
        window.ATS_API.getOffersApi(token)
      ]);

      const candidates = (candRes.ok && candRes.data && candRes.data.candidates) ? candRes.data.candidates : [];
      const userEmail = currentAuthenticatedUser ? currentAuthenticatedUser.email.toLowerCase() : '';
      let myCand = candidates.find(c => c.email && c.email.toLowerCase() === userEmail) || candidates[0];

      if (myCand) {
        if (candNameEl) candNameEl.textContent = myCand.fullName;
        if (candStageBadge) {
          candStageBadge.className = `badge ${STAGE_BADGES[myCand.stage] || 'badge-primary'}`;
          candStageBadge.textContent = STAGE_LABELS[myCand.stage] || myCand.stage;
        }

        // Update Tracker Steps
        const stagesOrder = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
        const currentIdx = stagesOrder.indexOf(myCand.stage) !== -1 ? stagesOrder.indexOf(myCand.stage) : 0;

        const stepIds = ['portal-step-applied', 'portal-step-screening', 'portal-step-interview', 'portal-step-offer', 'portal-step-hired'];
        stepIds.forEach((sid, idx) => {
          const el = document.getElementById(sid);
          if (el) {
            if (idx <= currentIdx) {
              el.style.borderColor = 'var(--color-primary)';
              el.style.background = 'rgba(37,99,235,0.08)';
              const countEl = el.querySelector('.funnel-step-count');
              if (countEl) countEl.style.color = 'var(--color-primary)';
            }
          }
        });
      }

      // Check upcoming interview
      const interviews = (ivRes.ok && ivRes.data && ivRes.data.interviews) ? ivRes.data.interviews : [];
      const myIv = interviews.find(i => i.candidate && (i.candidate.email === userEmail || (myCand && i.candidate.id === myCand.id)));
      if (myIv) {
        const timeEl = document.getElementById('cand-portal-interview-time');
        const locEl = document.getElementById('cand-portal-interview-location');
        if (timeEl) timeEl.textContent = new Date(myIv.scheduledTime).toLocaleString('vi-VN');
        if (locEl) locEl.textContent = myIv.locationOrLink || 'Google Meet';
      }

      // Check offer
      const offers = (offRes.ok && offRes.data && offRes.data.offers) ? offRes.data.offers : [];
      const myOff = offers.find(o => o.candidate && (o.candidate.email === userEmail || (myCand && o.candidate.id === myCand.id)));
      const offerContainer = document.getElementById('cand-portal-offer-container');
      if (myOff && offerContainer) {
        offerContainer.innerHTML = `
          <div style="background: var(--color-success-bg); border: 1px solid var(--color-success-border); border-radius: var(--radius-sm); padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="color: var(--color-success-text); font-size: 1.05rem;">Chúc mừng! Bạn đã nhận được Thư Mời Nhận Việc (Offer)</strong>
              <span class="badge ${myOff.status === 'APPROVED' ? 'badge-success' : 'badge-primary'}">${myOff.status}</span>
            </div>
            <div style="margin-top: 10px; font-size: 1.15rem; font-weight: 700; color: var(--color-success);">
              Mức lương: ${Number(myOff.salaryMonthly).toLocaleString('vi-VN')} đ/tháng
            </div>
            <div style="color: var(--color-text-secondary); margin-top: 4px; font-size: 0.85rem;">
              Ngày bắt đầu dự kiến: <strong>${myOff.startDate ? new Date(myOff.startDate).toLocaleDateString('vi-VN') : 'Thỏa thuận'}</strong>
            </div>
          </div>
        `;
      }
    } catch (e) {
      console.error('Failed to load candidate portal:', e);
    }
  }

  // --- REQUISITION DETAILS & EDIT MODAL ---
  const reqDetailModal = document.getElementById('requisition-detail-modal');
  const closeReqDetailModal = document.getElementById('close-req-detail-modal');
  const cancelReqDetailBtn = document.getElementById('cancel-req-detail-btn');
  const reqDetailForm = document.getElementById('req-detail-form');
  const reqDetailAlert = document.getElementById('req-detail-alert');
  const reqDetailAlertMsg = document.getElementById('req-detail-alert-msg');
  const reqDetailRecruiterSelect = document.getElementById('req-detail-recruiter-select');

  async function openRequisitionDetails(id) {
    if (!reqDetailModal) return;
    const req = currentRequisitionsList.find(r => r.id === id);
    if (!req) return;

    document.getElementById('req-detail-id').value = req.id;
    document.getElementById('req-detail-code').textContent = req.code;
    document.getElementById('req-detail-title-input').value = req.title;
    document.getElementById('req-detail-dept-input').value = req.departmentName || req.department || '';
    document.getElementById('req-detail-headcount-input').value = req.headcount;
    document.getElementById('req-detail-status-select').value = req.status;

    const statusBadge = document.getElementById('req-detail-status-badge');
    if (statusBadge) {
      statusBadge.className = `badge ${req.status === 'OPEN' ? 'badge-primary' : (req.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral')}`;
      statusBadge.textContent = req.status === 'OPEN' ? 'Đang mở' : (req.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng');
    }

    const token = sessionStorage.getItem('ats_token');
    if (token && reqDetailRecruiterSelect) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          reqDetailRecruiterSelect.innerHTML = `<option value="">-- Chưa chỉ định --</option>` +
            recruiters.map(r => `<option value="${r.id}" ${r.id === req.recruiterId ? 'selected' : ''}>${r.fullName || r.email}</option>`).join('');
        }
      } catch {}
    }

    if (reqDetailAlert) reqDetailAlert.classList.add('hidden');
    reqDetailModal.classList.remove('hidden');
  }

  if (closeReqDetailModal) closeReqDetailModal.addEventListener('click', () => reqDetailModal.classList.add('hidden'));
  if (cancelReqDetailBtn) cancelReqDetailBtn.addEventListener('click', () => reqDetailModal.classList.add('hidden'));

  if (reqDetailForm) {
    reqDetailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const id = document.getElementById('req-detail-id').value;
      const title = document.getElementById('req-detail-title-input').value.trim();
      const departmentName = document.getElementById('req-detail-dept-input').value.trim();
      const headcount = parseInt(document.getElementById('req-detail-headcount-input').value, 10);
      const status = document.getElementById('req-detail-status-select').value;
      const recruiterId = reqDetailRecruiterSelect ? reqDetailRecruiterSelect.value : null;

      try {
        const res = await window.ATS_API.updateRequisitionApi(token, id, { title, departmentName, headcount, status, recruiterId });
        if (res.ok && res.data && res.data.success) {
          reqDetailModal.classList.add('hidden');
          showToast('success', 'Cập nhật thành công', `Vị trí "${title}" đã được lưu.`);
          loadRequisitions();
          loadDashboardData();
        } else {
          if (reqDetailAlert && reqDetailAlertMsg) {
            reqDetailAlertMsg.textContent = res.data.message || 'Không thể cập nhật.';
            reqDetailAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (reqDetailAlert && reqDetailAlertMsg) {
          reqDetailAlertMsg.textContent = err.message;
          reqDetailAlert.classList.remove('hidden');
        }
      }
    });
  }

  // --- ADMIN RESET PASSWORD MODAL ---
  const adminResetPwdModal = document.getElementById('admin-reset-pwd-modal');
  const closeAdminResetPwdModal = document.getElementById('close-admin-reset-pwd-modal');
  const cancelAdminResetPwdBtn = document.getElementById('cancel-admin-reset-pwd-btn');
  const confirmAdminResetPwdBtn = document.getElementById('confirm-admin-reset-pwd-btn');
  const adminResetResultBox = document.getElementById('admin-reset-result-box');
  const adminResetNewPwdDisplay = document.getElementById('admin-reset-new-pwd-display');
  const adminResetCopyPwdBtn = document.getElementById('admin-reset-copy-pwd-btn');

  function openAdminResetPwdModal(id, name, email) {
    if (!adminResetPwdModal) return;
    document.getElementById('admin-reset-user-id').value = id;
    document.getElementById('admin-reset-user-name').textContent = name;
    document.getElementById('admin-reset-user-email').textContent = email;
    if (adminResetResultBox) adminResetResultBox.classList.add('hidden');
    if (confirmAdminResetPwdBtn) confirmAdminResetPwdBtn.classList.remove('hidden');
    adminResetPwdModal.classList.remove('hidden');
  }

  if (closeAdminResetPwdModal) closeAdminResetPwdModal.addEventListener('click', () => adminResetPwdModal.classList.add('hidden'));
  if (cancelAdminResetPwdBtn) cancelAdminResetPwdBtn.addEventListener('click', () => adminResetPwdModal.classList.add('hidden'));

  if (confirmAdminResetPwdBtn) {
    confirmAdminResetPwdBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const userId = document.getElementById('admin-reset-user-id').value;
      if (!token || !userId) return;

      try {
        const res = await window.ATS_API.resetUserPasswordApi(token, userId);
        if (res.ok && res.data && res.data.success) {
          confirmAdminResetPwdBtn.classList.add('hidden');
          if (adminResetResultBox) {
            adminResetResultBox.classList.remove('hidden');
            if (adminResetNewPwdDisplay) adminResetNewPwdDisplay.textContent = res.data.data.temporaryPassword;
          }
          showToast('success', 'Đặt lại mật khẩu thành công', 'Mật khẩu tạm mới đã được tạo và gửi qua email.');
        } else {
          showToast('danger', 'Lỗi', res.data.message || 'Không thể đặt lại mật khẩu.');
        }
      } catch (e) {
        showToast('danger', 'Lỗi kết nối', e.message);
      }
    });
  }

  if (adminResetCopyPwdBtn) {
    adminResetCopyPwdBtn.addEventListener('click', () => {
      const pwd = adminResetNewPwdDisplay.textContent;
      navigator.clipboard.writeText(pwd).then(() => {
        showToast('info', 'Đã sao chép', 'Đã sao chép mật khẩu tạm vào bộ nhớ tạm.');
      });
    });
  }

  // ==============================================================================
  // 18. INITIALIZATION
  // ==============================================================================

  // Global helper functions exposed for onclick table buttons
  window.ATS_APP_HELPERS = {
    viewCandidateDetails(id) {
      openCandidateDetails(id);
    },
    viewInterviewDetails(id) {
      openInterviewDetails(id);
    },
    viewOfferDetails(id) {
      openOfferDetails(id);
    },
    showErrorView
  };

  checkExistingSession();
});

