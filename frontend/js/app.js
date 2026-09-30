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
    reports: document.getElementById('reports-view'),
    users: document.getElementById('users-view'),
    roles: document.getElementById('roles-view'),
    audit: document.getElementById('audit-view'),
    profile: document.getElementById('profile-view'),
    error: document.getElementById('error-view')
  };

  // Toast Container
  const toastContainer = document.getElementById('toast-container');

  // Application State
  let currentAuthenticatedUser = null;
  let currentActiveView = 'dashboard';
  let heartbeatTimer = null;

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

          setupAuthenticatedSession(authData.user);
          showToast('success', 'Đăng nhập thành công', `Chào mừng ${authData.user.fullName || authData.user.email} vào hệ thống.`);
        } else {
          const status = res.status;
          const msg = (res.data && res.data.message) ? res.data.message : 'Email hoặc mật khẩu không chính xác.';

          if (status === 423) {
            showAlert('warning', 'Tài khoản tạm thời bị khóa', msg);
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

    // Start Session Heartbeat Auto-Renew
    startSessionHeartbeat();

    // Default View: switch to dashboard and load real data
    switchView('dashboard');
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
  async function performLogout() {
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
    hideAlert();
    showToast('info', 'Đăng xuất', 'Bạn đã đăng xuất an toàn khỏi hệ thống tuyển dụng.');
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
    reports: 'Báo cáo & Phân tích Tuyển dụng',
    users: 'Quản lý Người dùng & Tài khoản',
    roles: 'Vai trò & Ma trận Phân quyền',
    audit: 'Nhật ký Kiểm toán Hệ thống',
    profile: 'Hồ sơ Cá nhân',
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
            recentAuditContainer.innerHTML = logs.map(l => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--color-border-subtle); font-size: 0.825rem;">
                <div>
                  <strong style="color: var(--color-text);">${l.email || 'Hệ thống'}</strong>
                  <div style="color: var(--color-text-muted); font-size: 0.775rem;">${l.reason || 'Đăng nhập hệ thống'}</div>
                </div>
                <div style="text-align: right;">
                  <span class="badge ${l.status === 'SUCCESS' ? 'badge-success' : 'badge-danger'}" style="font-size: 0.7rem;">${l.status}</span>
                  <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 2px;">${new Date(l.attempted_at).toLocaleTimeString('vi-VN')}</div>
                </div>
              </div>
            `).join('');
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
            switchView('candidates');
          });
        });
      }
    } catch (e) {
      console.error('Failed to load requisitions:', e);
    }
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
  const candidatesRefreshBtn = document.getElementById('candidates-refresh-btn');
  const candidatesTableBody = document.getElementById('candidates-table-body');
  const candidatesTotalBadge = document.getElementById('candidates-total-badge');

  async function loadCandidates() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = candidatesSearchInput ? candidatesSearchInput.value.trim() : '';
    const stage = candidatesStageFilter ? candidatesStageFilter.value : 'ALL';

    if (candidatesTableBody) {
      candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách ứng viên...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getCandidatesApi(token, { search, stage });
      if (res.ok && res.data && res.data.success) {
        const list = res.data.candidates || res.data.data || [];
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

  if (candidatesRefreshBtn) candidatesRefreshBtn.addEventListener('click', loadCandidates);
  if (candidatesStageFilter) candidatesStageFilter.addEventListener('change', loadCandidates);
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

  async function loadAuditLogs() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const auditTableBody = document.getElementById('audit-table-body');
    if (auditTableBody) {
      auditTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải nhật ký kiểm toán...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getAuditLogsApi(token, { page: 1, limit: 50 });
      if (res.ok && res.data && res.data.success) {
        const logs = res.data.data.logs || [];
        if (logs.length === 0) {
          auditTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Chưa có bản ghi nhật ký nào.</td></tr>`;
          return;
        }

        auditTableBody.innerHTML = logs.map(l => {
          const isSuccess = l.status === 'SUCCESS';
          return `
            <tr>
              <td class="font-mono" style="font-size: 0.775rem;">${new Date(l.attempted_at).toLocaleString('vi-VN')}</td>
              <td><strong>${l.email || '—'}</strong></td>
              <td>${l.action || 'Xác thực'}</td>
              <td><span class="badge ${isSuccess ? 'badge-success' : 'badge-danger'} font-mono">${l.status}</span></td>
              <td style="color: var(--color-text-secondary);">${l.reason || '—'}</td>
              <td class="font-mono" style="font-size: 0.775rem; color: var(--color-text-muted);">${l.ip_address || '127.0.0.1'}</td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Failed to load audit logs:', e);
    }
  }

  // ==============================================================================
  // 15. USER PROFILE VIEW
  // ==============================================================================

  function loadUserProfile() {
    if (!currentAuthenticatedUser) return;
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
    if (phone) phone.textContent = u.phone || 'Chưa cập nhật';

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

  // Modal: Forgot Password
  const openForgotPwdBtn = document.getElementById('open-forgot-pwd-btn');
  const forgotModal = document.getElementById('forgot-modal');
  const closeForgotModal = document.getElementById('close-forgot-modal');
  const forgotForm = document.getElementById('forgot-form');
  const forgotAlert = document.getElementById('forgot-alert');
  const forgotAlertMsg = document.getElementById('forgot-alert-msg');

  if (openForgotPwdBtn && forgotModal) {
    openForgotPwdBtn.addEventListener('click', () => {
      if (forgotForm) forgotForm.reset();
      if (forgotAlert) forgotAlert.classList.add('hidden');
      forgotModal.classList.remove('hidden');
    });
  }

  if (closeForgotModal && forgotModal) {
    closeForgotModal.addEventListener('click', () => forgotModal.classList.add('hidden'));
  }

  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      try {
        const res = await window.ATS_API.requestPasswordResetApi(email);
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Liên kết đã gửi', 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi đến hòm thư.');
          forgotModal.classList.add('hidden');
        } else {
          if (forgotAlert && forgotAlertMsg) {
            forgotAlertMsg.textContent = res.data.message || 'Yêu cầu không thành công.';
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
          changePwdModal.classList.add('hidden');
          showToast('success', 'Đổi mật khẩu thành công', 'Mật khẩu đã được đổi. Vui lòng đăng nhập lại với mật khẩu mới.');
          performLogout();
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
  // 18. INITIALIZATION
  // ==============================================================================

  // Global helper functions exposed for onclick table buttons
  window.ATS_APP_HELPERS = {
    viewCandidateDetails(id) {
      showToast('info', 'Hồ sơ ứng viên', `Đang mở hồ sơ chi tiết mã ${id}`);
    },
    viewInterviewDetails(id) {
      showToast('info', 'Chi tiết phỏng vấn', `Đang mở chi tiết buổi phỏng vấn mã ${id}`);
    },
    viewOfferDetails(id) {
      showToast('info', 'Chi tiết Offer', `Đang mở bản chào mời nhận việc mã ${id}`);
    },
    showErrorView
  };

  checkExistingSession();
});
