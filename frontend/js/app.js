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
    questionBank: document.getElementById('question-bank-view'),
    offers: document.getElementById('offers-view'),
    approvals: document.getElementById('approvals-view'),
    reports: document.getElementById('reports-view'),
    departments: document.getElementById('departments-view'),
    recruitmentCatalogs: document.getElementById('recruitment-catalogs-view'),
    careerPage: document.getElementById('career-page-view'),
    competencies: document.getElementById('competencies-view'),
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
  let currentQuestionBankList = [];
  let questionBankFilterOptions = { jobTitles: [], criteria: [] };
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
    clearJobTitleSalaryState();
    clearRequisitionSalaryState();
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
    renderUserAvatar(topbarUserAvatar, user.id, fullName);
    if (popoverUserName) popoverUserName.textContent = fullName;
    if (popoverUserEmail) popoverUserEmail.textContent = email;

    if (sidebarUserName) sidebarUserName.textContent = fullName;
    if (sidebarUserRole) sidebarUserRole.textContent = friendlyRole;
    renderUserAvatar(sidebarUserAvatar, user.id, fullName);

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
          { path: '/question-bank', id: 'nav-item-question-bank' },
          { path: '/offers', id: 'nav-item-offers' },
          { path: '/approvals', id: 'nav-item-approvals' },
          { path: '/reports', id: 'nav-item-reports' },
          { path: '/admin/departments', id: 'nav-item-departments' },
          { path: '/admin/recruitment-catalogs', id: 'nav-item-recruitment-catalogs' },
          { path: '/admin/career-page', id: 'nav-item-career-page' },
          { path: '/admin/competencies', id: 'nav-item-competencies' },
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
    clearJobTitleSalaryState();
    clearRequisitionSalaryState();
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
    questionBank: 'Ngân hàng câu hỏi phỏng vấn',
    offers: 'Quản lý Thư Mời Nhận Việc (Offer)',
    approvals: 'Trung tâm Phê duyệt Tuyển dụng',
    reports: 'Báo cáo & Phân tích Tuyển dụng',
    departments: 'Phòng ban & Sơ đồ tổ chức',
    recruitmentCatalogs: 'Danh mục dùng chung tuyển dụng',
    careerPage: 'Trang giới thiệu công ty',
    competencies: 'Khung năng lực & Chức danh',
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
    } else if (viewName === 'questionBank') {
      loadQuestionBank();
    } else if (viewName === 'offers') {
      loadOffers();
    } else if (viewName === 'approvals') {
      loadApprovals();
    } else if (viewName === 'reports') {
      loadReports();
    } else if (viewName === 'recruitmentCatalogs') {
      loadRecruitmentCatalogs();
    } else if (viewName === 'careerPage') {
      loadCareerPage();
    } else if (viewName === 'departments') {
      loadDepartments();
    } else if (viewName === 'competencies') {
      loadCompetencies();
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
          const statusText = req.status === 'DRAFT' ? 'Nháp' : (req.status === 'OPEN' ? 'Đang mở' : (req.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng'));
          const isHandover = req.handover_required || req.handoverRequired;
          const handoverAlert = isHandover ? `<span class="badge badge-warning" style="margin-left: 6px;">Cần bàn giao</span>` : '';
          const dept = req.department || req.department_name || req.departmentName || '';
          const recName = req.recruiter_name || req.recruiterName || (req.recruiter ? req.recruiter.fullName : '');

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${req.code}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${req.formVersion === 'S2-10' ? escapeDepartmentHtml(req.title || 'Yêu cầu chưa đặt tên') : req.title}</div>
                ${handoverAlert}
              </td>
              <td>${req.formVersion === 'S2-10' ? escapeDepartmentHtml(dept) : dept}</td>
              <td style="text-align: center; font-weight: 600;">${req.headcount ?? '—'}</td>
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

  function formatCandCode(c) {
    if (!c) return 'CAND-001';
    if (c.code) return c.code;
    if (c.id) {
      if (c.id.startsWith('cand-0')) return 'CAND-' + c.id.replace('cand-', '');
      const raw = c.id.replace(/^cand-/, '');
      return 'CAND-' + (raw.length <= 4 ? raw.toUpperCase() : raw.substring(0, 4).toUpperCase());
    }
    return 'CAND-001';
  }

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
          const code = formatCandCode(c);
          const appliedDate = c.createdAt || c.created_at || c.applied_at;

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${name}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); font-family: monospace;">Mã: ${code}</div>
              </td>
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
        formatCandCode(c),
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

        interviewsTableBody.innerHTML = list.map((iv, index) => {
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
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div
                    class="user-avatar-circle interview-interviewer-avatar"
                    data-interview-index="${index}"
                    style="width: 32px; height: 32px; font-size: 0.75rem;"
                  >${interviewer.charAt(0).toUpperCase()}</div>
                  <span>${interviewer}</span>
                </div>
              </td>
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

        interviewsTableBody
          .querySelectorAll('.interview-interviewer-avatar')
          .forEach(avatarEl => {
            const interviewIndex = Number(avatarEl.dataset.interviewIndex);
            const interview = list[interviewIndex];
            const interviewerUser = interview && interview.interviewer;

            const fallbackText =
              interviewerUser && interviewerUser.fullName
                ? interviewerUser.fullName
                : ((interview && interview.interviewer_name) || 'Hội đồng tuyển dụng');

            renderUserAvatar(
              avatarEl,
              interviewerUser ? interviewerUser.id : '',
              fallbackText
            );
          });
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
  // ==============================================================================
  // INTERVIEW QUESTION BANK
  // ==============================================================================

  const questionBankSearchInput =
    document.getElementById('question-bank-search-input');
  const questionBankJobTitleFilter =
    document.getElementById('question-bank-job-title-filter');
  const questionBankCriterionFilter =
    document.getElementById('question-bank-criterion-filter');
  const questionBankRefreshBtn =
    document.getElementById('question-bank-refresh-btn');
  const questionBankTableBody =
    document.getElementById('question-bank-table-body');
  const questionBankTotalBadge =
    document.getElementById('question-bank-total-badge');

  function escapeQuestionBankHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderQuestionBankCriterionFilter() {
    if (!questionBankCriterionFilter) return;

    const selectedJobTitleId =
      questionBankJobTitleFilter
        ? questionBankJobTitleFilter.value
        : '';

    const selectedJobTitle =
      questionBankFilterOptions.jobTitles.find(
        item => item.id === selectedJobTitleId
      );

    const currentValue = questionBankCriterionFilter.value;

    const criteria = selectedJobTitle
      ? questionBankFilterOptions.criteria.filter(
          criterion =>
            criterion.frameworkId === selectedJobTitle.frameworkId
        )
      : questionBankFilterOptions.criteria;

    questionBankCriterionFilter.innerHTML =
      '<option value="">Tất cả tiêu chí</option>' +
      criteria.map(criterion => `
        <option value="${escapeQuestionBankHtml(criterion.id)}">
          ${escapeQuestionBankHtml(criterion.name)}
        </option>
      `).join('');

    if (criteria.some(item => item.id === currentValue)) {
      questionBankCriterionFilter.value = currentValue;
    }
  }

  async function loadQuestionBankFilterOptions(token) {
    const res =
      await window.ATS_API.getInterviewQuestionFiltersApi(token);

    if (!res.ok || !res.data || !res.data.success) {
      throw new Error(
        res.data?.message ||
        'Không thể tải bộ lọc ngân hàng câu hỏi.'
      );
    }

    questionBankFilterOptions = {
      jobTitles: Array.isArray(res.data.jobTitles)
        ? res.data.jobTitles
        : [],
      criteria: Array.isArray(res.data.criteria)
        ? res.data.criteria
        : []
    };

    if (questionBankJobTitleFilter) {
      const currentValue = questionBankJobTitleFilter.value;

      questionBankJobTitleFilter.innerHTML =
        '<option value="">Tất cả chức danh</option>' +
        questionBankFilterOptions.jobTitles.map(jobTitle => `
          <option value="${escapeQuestionBankHtml(jobTitle.id)}">
            ${escapeQuestionBankHtml(jobTitle.name)}
          </option>
        `).join('');

      if (
        questionBankFilterOptions.jobTitles.some(
          item => item.id === currentValue
        )
      ) {
        questionBankJobTitleFilter.value = currentValue;
      }
    }

    renderQuestionBankCriterionFilter();
  }

  function renderQuestionBankTable(list) {
    if (!questionBankTableBody) return;

    if (!Array.isArray(list) || list.length === 0) {
      questionBankTableBody.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;color:var(--color-text-muted);padding:24px;">
            Không có câu hỏi phỏng vấn phù hợp.
          </td>
        </tr>
      `;
      return;
    }

    const difficultyLabels = {
      EASY: 'Dễ',
      MEDIUM: 'Trung bình',
      HARD: 'Khó'
    };

    questionBankTableBody.innerHTML = list.map(question => `
      <tr>
        <td style="min-width:260px;">
          <strong>${escapeQuestionBankHtml(question.questionText)}</strong>
        </td>
        <td>${escapeQuestionBankHtml(question.criterion?.name || '')}</td>
        <td>${escapeQuestionBankHtml(question.framework?.name || '')}</td>
        <td>
          <span class="badge badge-primary">
            ${escapeQuestionBankHtml(
              difficultyLabels[question.difficulty] ||
              question.difficulty
            )}
          </span>
        </td>
        <td style="min-width:280px;">
          ${escapeQuestionBankHtml(question.goodAnswerHint)}
        </td>
        <td>
          <span class="badge ${
            question.status === 'ACTIVE'
              ? 'badge-success'
              : 'badge-secondary'
          }">
            ${
              question.status === 'ACTIVE'
                ? 'Đang áp dụng'
                : 'Ngừng áp dụng'
            }
          </span>
        </td>
        <td style="text-align:center;">
          ${
            canManageQuestionBank()
              ? `
                <button
                  type="button"
                  class="btn btn-outline btn-sm question-bank-edit-btn"
                  data-question-id="${escapeQuestionBankHtml(question.id)}"
                >
                  Sửa
                </button>
              `
              : '<span style="color:var(--color-text-muted);">—</span>'
          }
        </td>
      </tr>
    `).join('');
  }

  const questionBankCreateBtn =
    document.getElementById('question-bank-create-btn');
  const questionBankModal =
    document.getElementById('question-bank-modal');
  const questionBankModalTitle =
    document.getElementById('question-bank-modal-title');
  const questionBankModalClose =
    document.getElementById('question-bank-modal-close');
  const questionBankFormCancel =
    document.getElementById('question-bank-form-cancel');
  const questionBankForm =
    document.getElementById('question-bank-form');
  const questionBankEditId =
    document.getElementById('question-bank-edit-id');
  const questionBankFormCriterion =
    document.getElementById('question-bank-form-criterion');
  const questionBankFormText =
    document.getElementById('question-bank-form-text');
  const questionBankFormDifficulty =
    document.getElementById('question-bank-form-difficulty');
  const questionBankFormStatus =
    document.getElementById('question-bank-form-status');
  const questionBankFormHint =
    document.getElementById('question-bank-form-hint');
  const questionBankFormAlert =
    document.getElementById('question-bank-form-alert');
  const questionBankFormAlertMsg =
    document.getElementById('question-bank-form-alert-msg');
  const questionBankFormSave =
    document.getElementById('question-bank-form-save');

  function canManageQuestionBank() {
    const roles =
      currentAuthenticatedUser &&
      Array.isArray(currentAuthenticatedUser.roles)
        ? currentAuthenticatedUser.roles
        : [];

    return (
      roles.includes('ADMIN') ||
      roles.includes('HR_MANAGER')
    );
  }

  function populateQuestionBankCriterionForm() {
    if (!questionBankFormCriterion) return;

    questionBankFormCriterion.innerHTML =
      '<option value="">-- Chọn tiêu chí năng lực --</option>' +
      questionBankFilterOptions.criteria.map(criterion => `
        <option value="${escapeQuestionBankHtml(criterion.id)}">
          ${escapeQuestionBankHtml(criterion.frameworkName)}
          — ${escapeQuestionBankHtml(criterion.name)}
        </option>
      `).join('');
  }

  function closeQuestionBankModal() {
    if (questionBankModal) {
      questionBankModal.classList.add('hidden');
    }
  }

  function openQuestionBankModal(question = null) {
    if (!canManageQuestionBank() || !questionBankModal) return;

    if (questionBankForm) {
      questionBankForm.reset();
    }

    if (questionBankFormAlert) {
      questionBankFormAlert.classList.add('hidden');
    }

    populateQuestionBankCriterionForm();

    const isEdit = Boolean(question);

    if (questionBankModalTitle) {
      questionBankModalTitle.textContent =
        isEdit
          ? 'Sửa câu hỏi phỏng vấn'
          : 'Thêm câu hỏi phỏng vấn';
    }

    if (questionBankEditId) {
      questionBankEditId.value =
        isEdit ? question.id : '';
    }

    if (questionBankFormCriterion) {
      questionBankFormCriterion.value =
        isEdit && question.criterion
          ? question.criterion.id
          : '';
    }

    if (questionBankFormText) {
      questionBankFormText.value =
        isEdit ? question.questionText : '';
    }

    if (questionBankFormDifficulty) {
      questionBankFormDifficulty.value =
        isEdit ? question.difficulty : 'MEDIUM';
    }

    if (questionBankFormStatus) {
      questionBankFormStatus.value =
        isEdit ? question.status : 'ACTIVE';

      questionBankFormStatus.disabled = !isEdit;
    }

    if (questionBankFormHint) {
      questionBankFormHint.value =
        isEdit ? question.goodAnswerHint : '';
    }

    questionBankModal.classList.remove('hidden');
  }

  if (questionBankCreateBtn) {
    questionBankCreateBtn.addEventListener(
      'click',
      () => {
        if (canManageQuestionBank()) {
          openQuestionBankModal();
        }
      }
    );
  }

  if (questionBankModalClose) {
    questionBankModalClose.addEventListener(
      'click',
      closeQuestionBankModal
    );
  }

  if (questionBankFormCancel) {
    questionBankFormCancel.addEventListener(
      'click',
      closeQuestionBankModal
    );
  }

  if (questionBankTableBody) {
    questionBankTableBody.addEventListener(
      'click',
      event => {
        const button =
          event.target.closest('.question-bank-edit-btn');

        if (!button || !canManageQuestionBank()) return;

        const questionId =
          button.getAttribute('data-question-id');

        const question =
          currentQuestionBankList.find(
            item => item.id === questionId
          );

        if (question) {
          openQuestionBankModal(question);
        }
      }
    );
  }

  if (questionBankForm) {
    questionBankForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        if (!canManageQuestionBank()) return;

        const token =
          sessionStorage.getItem('ats_token');

        if (!token) return;

        const id =
          questionBankEditId
            ? questionBankEditId.value
            : '';

        const payload = {
          criterionId:
            questionBankFormCriterion.value,
          questionText:
            questionBankFormText.value.trim(),
          difficulty:
            questionBankFormDifficulty.value,
          goodAnswerHint:
            questionBankFormHint.value.trim()
        };

        if (id) {
          payload.status =
            questionBankFormStatus.value;
        }

        if (
          !payload.criterionId ||
          !payload.questionText ||
          !payload.goodAnswerHint
        ) {
          if (
            questionBankFormAlert &&
            questionBankFormAlertMsg
          ) {
            questionBankFormAlertMsg.textContent =
              'Vui lòng nhập đầy đủ tiêu chí, câu hỏi và gợi ý trả lời.';
            questionBankFormAlert.classList.remove('hidden');
          }
          return;
        }

        if (questionBankFormSave) {
          questionBankFormSave.disabled = true;
        }

        try {
          const res = id
            ? await window.ATS_API.updateInterviewQuestionApi(
                token,
                id,
                payload
              )
            : await window.ATS_API.createInterviewQuestionApi(
                token,
                payload
              );

          if (res.ok && res.data && res.data.success) {
            closeQuestionBankModal();

            showToast(
              'success',
              id ? 'Đã cập nhật câu hỏi' : 'Đã thêm câu hỏi',
              res.data.message ||
                'Dữ liệu ngân hàng câu hỏi đã được lưu.'
            );

            await loadQuestionBank();
          } else if (
            questionBankFormAlert &&
            questionBankFormAlertMsg
          ) {
            questionBankFormAlertMsg.textContent =
              res.data?.message ||
              'Không thể lưu câu hỏi phỏng vấn.';
            questionBankFormAlert.classList.remove('hidden');
          }
        } catch (error) {
          if (
            questionBankFormAlert &&
            questionBankFormAlertMsg
          ) {
            questionBankFormAlertMsg.textContent =
              error.message ||
              'Lỗi kết nối khi lưu câu hỏi.';
            questionBankFormAlert.classList.remove('hidden');
          }
        } finally {
          if (questionBankFormSave) {
            questionBankFormSave.disabled = false;
          }
        }
      }
    );
  }

  async function loadQuestionBank() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (questionBankCreateBtn) {
      if (canManageQuestionBank()) {
        questionBankCreateBtn.classList.remove('hidden');
        questionBankCreateBtn.style.display = '';
      } else {
        questionBankCreateBtn.classList.add('hidden');
        questionBankCreateBtn.style.display = 'none';
      }
    }

    if (questionBankTableBody) {
      questionBankTableBody.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;color:var(--color-text-muted);padding:24px;">
            Đang tải ngân hàng câu hỏi...
          </td>
        </tr>
      `;
    }

    try {
      if (
        questionBankFilterOptions.jobTitles.length === 0 &&
        questionBankFilterOptions.criteria.length === 0
      ) {
        await loadQuestionBankFilterOptions(token);
      }

      const options = {
        search: questionBankSearchInput
          ? questionBankSearchInput.value.trim()
          : '',
        jobTitleId: questionBankJobTitleFilter
          ? questionBankJobTitleFilter.value
          : '',
        criterionId: questionBankCriterionFilter
          ? questionBankCriterionFilter.value
          : ''
      };

      const res =
        await window.ATS_API.getInterviewQuestionsApi(
          token,
          options
        );

      if (!res.ok || !res.data || !res.data.success) {
        throw new Error(
          res.data?.message ||
          'Không thể tải ngân hàng câu hỏi.'
        );
      }

      currentQuestionBankList =
        Array.isArray(res.data.questions)
          ? res.data.questions
          : [];

      if (questionBankTotalBadge) {
        questionBankTotalBadge.textContent =
          `${currentQuestionBankList.length} câu hỏi`;
      }

      renderQuestionBankTable(currentQuestionBankList);
    } catch (error) {
      console.error(
        'Failed to load interview question bank:',
        error
      );

      if (questionBankTableBody) {
        questionBankTableBody.innerHTML = `
          <tr>
            <td colspan="7"
                style="text-align:center;color:var(--color-danger);padding:24px;">
              ${escapeQuestionBankHtml(error.message)}
            </td>
          </tr>
        `;
      }
    }
  }

  if (questionBankRefreshBtn) {
    questionBankRefreshBtn.addEventListener(
      'click',
      loadQuestionBank
    );
  }

  if (questionBankSearchInput) {
    questionBankSearchInput.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Enter') {
          loadQuestionBank();
        }
      }
    );
  }

  if (questionBankJobTitleFilter) {
    questionBankJobTitleFilter.addEventListener(
      'change',
      () => {
        renderQuestionBankCriterionFilter();
        loadQuestionBank();
      }
    );
  }

  if (questionBankCriterionFilter) {
    questionBankCriterionFilter.addEventListener(
      'change',
      loadQuestionBank
    );
  }

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
  // S2. RECRUITMENT SHARED CATALOGS
  // ==============================================================================

  const recruitmentCatalogTypeFilter =
    document.getElementById('recruitment-catalog-type-filter');

  const recruitmentCatalogTableBody =
    document.getElementById('recruitment-catalog-table-body');

  const recruitmentCatalogTotalBadge =
    document.getElementById('recruitment-catalog-total-badge');

  const recruitmentCatalogRefreshBtn =
    document.getElementById('recruitment-catalog-refresh-btn');

  const recruitmentCatalogNewBtn =
    document.getElementById('recruitment-catalog-new-btn');

  const recruitmentCatalogForm =
    document.getElementById('recruitment-catalog-form');

  const recruitmentCatalogFormTitle =
    document.getElementById('recruitment-catalog-form-title');

  const recruitmentCatalogIdInput =
    document.getElementById('recruitment-catalog-id-input');

  const recruitmentCatalogTypeInput =
    document.getElementById('recruitment-catalog-type-input');

  const recruitmentCatalogCodeInput =
    document.getElementById('recruitment-catalog-code-input');

  const recruitmentCatalogNameInput =
    document.getElementById('recruitment-catalog-name-input');

  const recruitmentCatalogOrderInput =
    document.getElementById('recruitment-catalog-order-input');

  const recruitmentCatalogStatusInput =
    document.getElementById('recruitment-catalog-status-input');

  const recruitmentCatalogFormAlert =
    document.getElementById('recruitment-catalog-form-alert');

  const recruitmentCatalogFormAlertMsg =
    document.getElementById('recruitment-catalog-form-alert-msg');

  const recruitmentCatalogResetBtn =
    document.getElementById('recruitment-catalog-reset-btn');

  const recruitmentCatalogSaveBtn =
    document.getElementById('recruitment-catalog-save-btn');

  let currentRecruitmentCatalogItems = [];

  function escapeRecruitmentCatalogHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getRecruitmentCatalogTypeLabel(type) {
    const labels = {
      CANDIDATE_SOURCE: 'Nguồn ứng viên',
      REJECTION_REASON: 'Lý do loại hồ sơ',
      WORK_LOCATION: 'Địa điểm làm việc',
      WORK_MODE: 'Hình thức làm việc'
    };

    return labels[type] || type;
  }

  function hideRecruitmentCatalogError() {
    if (recruitmentCatalogFormAlert) {
      recruitmentCatalogFormAlert.classList.add('hidden');
    }

    if (recruitmentCatalogFormAlertMsg) {
      recruitmentCatalogFormAlertMsg.textContent = '';
    }
  }

  function showRecruitmentCatalogError(message) {
    if (recruitmentCatalogFormAlertMsg) {
      recruitmentCatalogFormAlertMsg.textContent =
        message || 'Không thể xử lý danh mục tuyển dụng.';
    }

    if (recruitmentCatalogFormAlert) {
      recruitmentCatalogFormAlert.classList.remove('hidden');
    }
  }

  function resetRecruitmentCatalogForm() {
    if (recruitmentCatalogForm) {
      recruitmentCatalogForm.reset();
    }

    if (recruitmentCatalogIdInput) {
      recruitmentCatalogIdInput.value = '';
    }

    if (recruitmentCatalogTypeInput) {
      recruitmentCatalogTypeInput.value =
        recruitmentCatalogTypeFilter
          ? recruitmentCatalogTypeFilter.value
          : 'CANDIDATE_SOURCE';

      recruitmentCatalogTypeInput.disabled = false;
    }

    if (recruitmentCatalogOrderInput) {
      recruitmentCatalogOrderInput.value = '0';
    }

    if (recruitmentCatalogStatusInput) {
      recruitmentCatalogStatusInput.value = 'ACTIVE';
      recruitmentCatalogStatusInput.disabled = true;
    }

    if (recruitmentCatalogFormTitle) {
      recruitmentCatalogFormTitle.textContent =
        'Thêm giá trị danh mục';
    }

    if (recruitmentCatalogSaveBtn) {
      recruitmentCatalogSaveBtn.textContent =
        'Lưu danh mục';
    }

    hideRecruitmentCatalogError();
  }

  function editRecruitmentCatalog(id) {
    const item = currentRecruitmentCatalogItems.find(
      catalog => catalog.id === id
    );

    if (!item) return;

    if (recruitmentCatalogIdInput) {
      recruitmentCatalogIdInput.value = item.id;
    }

    if (recruitmentCatalogTypeInput) {
      recruitmentCatalogTypeInput.value = item.type;
      recruitmentCatalogTypeInput.disabled = true;
    }

    if (recruitmentCatalogCodeInput) {
      recruitmentCatalogCodeInput.value = item.code || '';
    }

    if (recruitmentCatalogNameInput) {
      recruitmentCatalogNameInput.value = item.name || '';
    }

    if (recruitmentCatalogOrderInput) {
      recruitmentCatalogOrderInput.value =
        String(item.displayOrder ?? 0);
    }

    if (recruitmentCatalogStatusInput) {
      recruitmentCatalogStatusInput.value =
        item.status || 'ACTIVE';

      recruitmentCatalogStatusInput.disabled = false;
    }

    if (recruitmentCatalogFormTitle) {
      recruitmentCatalogFormTitle.textContent =
        'Cập nhật giá trị danh mục';
    }

    if (recruitmentCatalogSaveBtn) {
      recruitmentCatalogSaveBtn.textContent = 'Cập nhật';
    }

    hideRecruitmentCatalogError();

    if (recruitmentCatalogCodeInput) {
      recruitmentCatalogCodeInput.focus();
    }
  }

  function renderRecruitmentCatalogTable() {
    if (!recruitmentCatalogTableBody) return;

    if (currentRecruitmentCatalogItems.length === 0) {
      recruitmentCatalogTableBody.innerHTML = `
        <tr>
          <td colspan="5"
              style="text-align: center; padding: 24px; color: var(--color-text-muted);">
            Chưa có giá trị trong danh mục này.
          </td>
        </tr>
      `;
      return;
    }

    recruitmentCatalogTableBody.innerHTML =
      currentRecruitmentCatalogItems.map((item, index) => {
        const active = item.status === 'ACTIVE';

        return `
          <tr>
            <td style="text-align: center;">
              <strong>${escapeRecruitmentCatalogHtml(item.displayOrder)}</strong>
            </td>

            <td>
              <code class="font-mono">
                ${escapeRecruitmentCatalogHtml(item.code)}
              </code>
            </td>

            <td>
              <strong>${escapeRecruitmentCatalogHtml(item.name)}</strong>
            </td>

            <td>
              <span class="badge ${active ? 'badge-success' : 'badge-neutral'}">
                ${active ? 'Đang áp dụng' : 'Ngừng áp dụng'}
              </span>
            </td>

            <td>
              <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="up"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}"
                  ${index === 0 ? 'disabled' : ''}
                  title="Di chuyển lên">
                  ↑
                </button>

                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="down"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}"
                  ${index === currentRecruitmentCatalogItems.length - 1 ? 'disabled' : ''}
                  title="Di chuyển xuống">
                  ↓
                </button>

                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="edit"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}">
                  Sửa
                </button>

                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="delete"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}">
                  Xóa
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
  }

  async function loadRecruitmentCatalogs() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const type = recruitmentCatalogTypeFilter
      ? recruitmentCatalogTypeFilter.value
      : 'CANDIDATE_SOURCE';

    if (recruitmentCatalogTableBody) {
      recruitmentCatalogTableBody.innerHTML = `
        <tr>
          <td colspan="5"
              style="text-align: center; padding: 24px; color: var(--color-text-muted);">
            Đang tải danh mục...
          </td>
        </tr>
      `;
    }

    try {
      const res =
        await window.ATS_API.getRecruitmentCatalogsApi(
          token,
          { type }
        );

      if (
        !res.ok ||
        !res.data ||
        !res.data.success
      ) {
        throw new Error(
          res.data && res.data.message
            ? res.data.message
            : 'Không thể tải danh mục tuyển dụng.'
        );
      }

      currentRecruitmentCatalogItems =
        res.data.items || [];

      if (recruitmentCatalogTotalBadge) {
        recruitmentCatalogTotalBadge.textContent =
          `${currentRecruitmentCatalogItems.length} giá trị`;
      }

      renderRecruitmentCatalogTable();

      if (
        recruitmentCatalogIdInput &&
        !recruitmentCatalogIdInput.value
      ) {
        resetRecruitmentCatalogForm();
      }
    } catch (error) {
      console.error(
        'Failed to load recruitment catalogs:',
        error
      );

      currentRecruitmentCatalogItems = [];

      if (recruitmentCatalogTableBody) {
        recruitmentCatalogTableBody.innerHTML = `
          <tr>
            <td colspan="5"
                style="text-align: center; padding: 24px; color: var(--color-danger);">
              ${escapeRecruitmentCatalogHtml(error.message)}
            </td>
          </tr>
        `;
      }
    }
  }

  async function reorderRecruitmentCatalog(
    catalogId,
    direction
  ) {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const index = currentRecruitmentCatalogItems.findIndex(
      item => item.id === catalogId
    );

    if (index < 0) return;

    const targetIndex =
      direction === 'up'
        ? index - 1
        : index + 1;

    if (
      targetIndex < 0 ||
      targetIndex >= currentRecruitmentCatalogItems.length
    ) {
      return;
    }

    const ordered = [...currentRecruitmentCatalogItems];

    const temp = ordered[index];
    ordered[index] = ordered[targetIndex];
    ordered[targetIndex] = temp;

    const type = recruitmentCatalogTypeFilter
      ? recruitmentCatalogTypeFilter.value
      : ordered[0].type;

    try {
      const res =
        await window.ATS_API.reorderRecruitmentCatalogsApi(
          token,
          type,
          ordered.map(item => item.id)
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        currentRecruitmentCatalogItems =
          res.data.items || ordered;

        renderRecruitmentCatalogTable();

        showToast(
          'success',
          'Danh mục tuyển dụng',
          'Đã cập nhật thứ tự hiển thị.'
        );
      } else {
        showToast(
          'error',
          'Danh mục tuyển dụng',
          res.data && res.data.message
            ? res.data.message
            : 'Không thể sắp xếp danh mục.'
        );
      }
    } catch (error) {
      showToast(
        'error',
        'Danh mục tuyển dụng',
        'Lỗi kết nối khi sắp xếp danh mục.'
      );
    }
  }

  async function deleteRecruitmentCatalog(id) {
    const token = sessionStorage.getItem('ats_token');
    if (!token || !id) return;

    const item = currentRecruitmentCatalogItems.find(
      catalog => catalog.id === id
    );

    if (!item) return;

    const confirmed = window.confirm(
      `Xóa "${item.name}" khỏi ${getRecruitmentCatalogTypeLabel(item.type)}?`
    );

    if (!confirmed) return;

    try {
      const res =
        await window.ATS_API.deleteRecruitmentCatalogApi(
          token,
          id
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        showToast(
          'success',
          'Danh mục tuyển dụng',
          res.data.message ||
            'Đã xóa giá trị danh mục.'
        );

        resetRecruitmentCatalogForm();
        await loadRecruitmentCatalogs();
      } else {
        showToast(
          'error',
          'Không thể xóa',
          res.data && res.data.message
            ? res.data.message
            : 'Giá trị danh mục không thể xóa.'
        );
      }
    } catch (error) {
      showToast(
        'error',
        'Không thể xóa',
        'Lỗi kết nối khi xóa giá trị danh mục.'
      );
    }
  }

  if (recruitmentCatalogForm) {
    recruitmentCatalogForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token =
          sessionStorage.getItem('ats_token');

        if (!token) return;

        hideRecruitmentCatalogError();

        const id = recruitmentCatalogIdInput
          ? recruitmentCatalogIdInput.value.trim()
          : '';

        const payload = {
          type: recruitmentCatalogTypeInput
            ? recruitmentCatalogTypeInput.value
            : 'CANDIDATE_SOURCE',

          code: recruitmentCatalogCodeInput
            ? recruitmentCatalogCodeInput.value.trim()
            : '',

          name: recruitmentCatalogNameInput
            ? recruitmentCatalogNameInput.value.trim()
            : '',

          displayOrder: recruitmentCatalogOrderInput
            ? Number(recruitmentCatalogOrderInput.value || 0)
            : 0
        };

        if (id) {
          payload.status =
            recruitmentCatalogStatusInput
              ? recruitmentCatalogStatusInput.value
              : 'ACTIVE';
        }

        if (!payload.code || !payload.name) {
          showRecruitmentCatalogError(
            'Vui lòng nhập đầy đủ mã và tên hiển thị.'
          );
          return;
        }

        if (recruitmentCatalogSaveBtn) {
          recruitmentCatalogSaveBtn.disabled = true;
        }

        try {
          const res = id
            ? await window.ATS_API.updateRecruitmentCatalogApi(
                token,
                id,
                payload
              )
            : await window.ATS_API.createRecruitmentCatalogApi(
                token,
                payload
              );

          if (
            res.ok &&
            res.data &&
            res.data.success
          ) {
            showToast(
              'success',
              'Danh mục tuyển dụng',
              res.data.message ||
                'Đã lưu giá trị danh mục.'
            );

            if (
              recruitmentCatalogTypeFilter &&
              !id
            ) {
              recruitmentCatalogTypeFilter.value =
                payload.type;
            }

            resetRecruitmentCatalogForm();
            await loadRecruitmentCatalogs();
          } else {
            showRecruitmentCatalogError(
              res.data && res.data.message
                ? res.data.message
                : 'Không thể lưu giá trị danh mục.'
            );
          }
        } catch (error) {
          showRecruitmentCatalogError(
            'Lỗi kết nối khi lưu danh mục.'
          );
        } finally {
          if (recruitmentCatalogSaveBtn) {
            recruitmentCatalogSaveBtn.disabled = false;
          }
        }
      }
    );
  }

  if (recruitmentCatalogTableBody) {
    recruitmentCatalogTableBody.addEventListener(
      'click',
      async event => {
        const button =
          event.target.closest('[data-catalog-action]');

        if (!button) return;

        const id = button.dataset.catalogId;
        const action = button.dataset.catalogAction;

        if (action === 'edit') {
          editRecruitmentCatalog(id);
        } else if (
          action === 'up' ||
          action === 'down'
        ) {
          await reorderRecruitmentCatalog(
            id,
            action
          );
        } else if (action === 'delete') {
          await deleteRecruitmentCatalog(id);
        }
      }
    );
  }

  if (recruitmentCatalogTypeFilter) {
    recruitmentCatalogTypeFilter.addEventListener(
      'change',
      async () => {
        resetRecruitmentCatalogForm();
        await loadRecruitmentCatalogs();
      }
    );
  }

  if (recruitmentCatalogNewBtn) {
    recruitmentCatalogNewBtn.addEventListener(
      'click',
      () => {
        resetRecruitmentCatalogForm();

        if (recruitmentCatalogCodeInput) {
          recruitmentCatalogCodeInput.focus();
        }
      }
    );
  }

  if (recruitmentCatalogResetBtn) {
    recruitmentCatalogResetBtn.addEventListener(
      'click',
      resetRecruitmentCatalogForm
    );
  }

  if (recruitmentCatalogRefreshBtn) {
    recruitmentCatalogRefreshBtn.addEventListener(
      'click',
      loadRecruitmentCatalogs
    );
  }
  // ==============================================================================
  // ==============================================================================
  // S2. COMPANY CAREER PAGE
  // ==============================================================================

  const careerPageIntroductionInput = document.getElementById('career-page-introduction-input');
  const careerPageLogoInput = document.getElementById('career-page-logo-input');
  const careerPageHeroInput = document.getElementById('career-page-hero-input');
  const careerPageLogoStatus = document.getElementById('career-page-logo-status');
  const careerPageHeroStatus = document.getElementById('career-page-hero-status');
  const careerPagePreviewContainer = document.getElementById('career-page-preview-container');
  const careerPagePreviewBtn = document.getElementById('career-page-preview-btn');
  const careerPageSaveBtn = document.getElementById('career-page-save-btn');
  const careerPageFormAlert = document.getElementById('career-page-form-alert');
  const careerPageFormAlertMsg = document.getElementById('career-page-form-alert-msg');

  let currentCareerPageSettings = {
    introduction: '',
    logoUrl: null,
    heroImageUrl: null,
    updatedAt: null
  };

  async function loadCareerPage() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (careerPageFormAlert) {
      careerPageFormAlert.classList.add('hidden');
    }

    try {
      const res = await window.ATS_API.getCareerPageApi(token);

      if (!res.ok || !res.data || !res.data.success) {
        showToast(
          'error',
          'Không thể tải cấu hình',
          (res.data && res.data.message) || 'Không thể tải trang giới thiệu công ty.'
        );
        return;
      }

      const data = res.data.data || {};

      currentCareerPageSettings = {
        introduction: data.introduction || '',
        logoUrl: data.logoUrl || null,
        heroImageUrl: data.heroImageUrl || null,
        updatedAt: data.updatedAt || null
      };

      if (careerPageIntroductionInput) {
        careerPageIntroductionInput.value = currentCareerPageSettings.introduction;
      }

      if (careerPageLogoInput) {
        careerPageLogoInput.value = '';
      }

      if (careerPageHeroInput) {
        careerPageHeroInput.value = '';
      }

      if (careerPageLogoStatus) {
        careerPageLogoStatus.textContent = currentCareerPageSettings.logoUrl
          ? 'Đang sử dụng logo đã lưu. Chọn tệp mới nếu muốn thay thế.'
          : 'JPG hoặc PNG, tối đa 2MB.';
      }

      if (careerPageHeroStatus) {
        careerPageHeroStatus.textContent = currentCareerPageSettings.heroImageUrl
          ? 'Đang sử dụng ảnh giới thiệu đã lưu. Chọn tệp mới nếu muốn thay thế.'
          : 'JPG hoặc PNG, tối đa 2MB.';
      }

      if (careerPagePreviewContainer) {
        careerPagePreviewContainer.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; color: var(--color-text-muted);">
            Bấm “Xem trước” để xem giao diện trước khi lưu.
          </div>
        `;
      }
    } catch (error) {
      showToast(
        'error',
        'Không thể tải cấu hình',
        'Lỗi kết nối khi tải trang giới thiệu công ty.'
      );
    }
  }
  let careerPagePreviewObjectUrls = [];

  function clearCareerPagePreviewObjectUrls() {
    careerPagePreviewObjectUrls.forEach(url => URL.revokeObjectURL(url));
    careerPagePreviewObjectUrls = [];
  }

  function validateCareerPageImage(file, label) {
    if (!file) return true;

    const allowedTypes = ['image/jpeg', 'image/png'];
    const maxFileSize = 2 * 1024 * 1024;

    if (!allowedTypes.includes(file.type)) {
      showToast(
        'warning',
        'Ảnh không hợp lệ',
        `${label} chỉ chấp nhận ảnh JPG hoặc PNG.`
      );
      return false;
    }

    if (file.size > maxFileSize) {
      showToast(
        'warning',
        'Ảnh quá lớn',
        `${label} không được vượt quá 2MB.`
      );
      return false;
    }

    return true;
  }

  function renderCareerPagePublicContent(container, settings = {}) {
    if (!container) return;

    const introduction = String(settings.introduction || '').trim();
    const logoUrl = settings.logoUrl || null;
    const heroImageUrl = settings.heroImageUrl || null;

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.border = '1px solid var(--color-border)';
    wrapper.style.borderRadius = 'var(--radius-sm)';
    wrapper.style.overflow = 'hidden';
    wrapper.style.background = '#ffffff';

    if (heroImageUrl) {
      const hero = document.createElement('img');
      hero.src = heroImageUrl;
      hero.alt = 'Ảnh giới thiệu công ty';
      hero.style.display = 'block';
      hero.style.width = '100%';
      hero.style.maxHeight = '320px';
      hero.style.objectFit = 'cover';
      wrapper.appendChild(hero);
    }

    const body = document.createElement('div');
    body.style.padding = '28px';

    if (logoUrl) {
      const logo = document.createElement('img');
      logo.src = logoUrl;
      logo.alt = 'Logo công ty';
      logo.style.display = 'block';
      logo.style.maxWidth = '220px';
      logo.style.maxHeight = '90px';
      logo.style.objectFit = 'contain';
      logo.style.marginBottom = '20px';
      body.appendChild(logo);
    }

    const heading = document.createElement('h2');
    heading.textContent = 'Giới thiệu về công ty';
    heading.style.margin = '0 0 14px';
    heading.style.fontSize = '1.4rem';
    heading.style.color = 'var(--color-text)';
    body.appendChild(heading);

    const description = document.createElement('div');
    description.textContent =
      introduction || 'Thông tin giới thiệu công ty đang được cập nhật.';
    description.style.whiteSpace = 'pre-line';
    description.style.lineHeight = '1.7';
    description.style.color = 'var(--color-text-secondary)';
    description.style.fontSize = '0.95rem';
    body.appendChild(description);

    wrapper.appendChild(body);
    container.appendChild(wrapper);
  }

  if (careerPageLogoInput) {
    careerPageLogoInput.addEventListener('change', () => {
      const file =
        careerPageLogoInput.files && careerPageLogoInput.files[0];

      if (!file) return;

      if (!validateCareerPageImage(file, 'Logo công ty')) {
        careerPageLogoInput.value = '';
        return;
      }

      if (careerPageLogoStatus) {
        careerPageLogoStatus.textContent = `Đã chọn: ${file.name}`;
      }
    });
  }

  if (careerPageHeroInput) {
    careerPageHeroInput.addEventListener('change', () => {
      const file =
        careerPageHeroInput.files && careerPageHeroInput.files[0];

      if (!file) return;

      if (!validateCareerPageImage(file, 'Ảnh giới thiệu')) {
        careerPageHeroInput.value = '';
        return;
      }

      if (careerPageHeroStatus) {
        careerPageHeroStatus.textContent = `Đã chọn: ${file.name}`;
      }
    });
  }

  if (careerPagePreviewBtn) {
    careerPagePreviewBtn.addEventListener('click', () => {
      const logoFile =
        careerPageLogoInput &&
        careerPageLogoInput.files &&
        careerPageLogoInput.files[0];

      const heroFile =
        careerPageHeroInput &&
        careerPageHeroInput.files &&
        careerPageHeroInput.files[0];

      if (
        !validateCareerPageImage(logoFile, 'Logo công ty') ||
        !validateCareerPageImage(heroFile, 'Ảnh giới thiệu')
      ) {
        return;
      }

      clearCareerPagePreviewObjectUrls();

      let logoUrl = currentCareerPageSettings.logoUrl;
      let heroImageUrl = currentCareerPageSettings.heroImageUrl;

      if (logoFile) {
        logoUrl = URL.createObjectURL(logoFile);
        careerPagePreviewObjectUrls.push(logoUrl);
      }

      if (heroFile) {
        heroImageUrl = URL.createObjectURL(heroFile);
        careerPagePreviewObjectUrls.push(heroImageUrl);
      }

      renderCareerPagePublicContent(
        careerPagePreviewContainer,
        {
          introduction: careerPageIntroductionInput
            ? careerPageIntroductionInput.value
            : '',
          logoUrl,
          heroImageUrl
        }
      );
    });
  }
  if (careerPageSaveBtn) {
    careerPageSaveBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const logoFile =
        careerPageLogoInput &&
        careerPageLogoInput.files &&
        careerPageLogoInput.files[0];

      const heroFile =
        careerPageHeroInput &&
        careerPageHeroInput.files &&
        careerPageHeroInput.files[0];

      if (
        !validateCareerPageImage(logoFile, 'Logo công ty') ||
        !validateCareerPageImage(heroFile, 'Ảnh giới thiệu')
      ) {
        return;
      }

      const originalButtonText = careerPageSaveBtn.textContent;
      careerPageSaveBtn.disabled = true;
      careerPageSaveBtn.textContent = 'Đang lưu...';

      try {
        let logoUrl = currentCareerPageSettings.logoUrl;
        let heroImageUrl = currentCareerPageSettings.heroImageUrl;

        if (logoFile) {
          const logoRes = await window.ATS_API.uploadCareerPageMediaApi(
            token,
            'logo',
            logoFile
          );

          if (
            !logoRes.ok ||
            !logoRes.data ||
            !logoRes.data.success ||
            !logoRes.data.data ||
            !logoRes.data.data.url
          ) {
            throw new Error(
              (logoRes.data && logoRes.data.message) ||
              'Không thể tải logo công ty.'
            );
          }

          logoUrl = logoRes.data.data.url;
        }

        if (heroFile) {
          const heroRes = await window.ATS_API.uploadCareerPageMediaApi(
            token,
            'hero',
            heroFile
          );

          if (
            !heroRes.ok ||
            !heroRes.data ||
            !heroRes.data.success ||
            !heroRes.data.data ||
            !heroRes.data.data.url
          ) {
            throw new Error(
              (heroRes.data && heroRes.data.message) ||
              'Không thể tải ảnh giới thiệu.'
            );
          }

          heroImageUrl = heroRes.data.data.url;
        }

        const saveRes = await window.ATS_API.updateCareerPageApi(
          token,
          {
            introduction: careerPageIntroductionInput
              ? careerPageIntroductionInput.value
              : '',
            logoUrl,
            heroImageUrl
          }
        );

        if (!saveRes.ok || !saveRes.data || !saveRes.data.success) {
          throw new Error(
            (saveRes.data && saveRes.data.message) ||
            'Không thể lưu cấu hình trang tuyển dụng.'
          );
        }

        const saved = saveRes.data.data || {};

        currentCareerPageSettings = {
          introduction: saved.introduction || '',
          logoUrl: saved.logoUrl || null,
          heroImageUrl: saved.heroImageUrl || null,
          updatedAt: saved.updatedAt || null
        };

        if (careerPageIntroductionInput) {
          careerPageIntroductionInput.value =
            currentCareerPageSettings.introduction;
        }

        if (careerPageLogoInput) {
          careerPageLogoInput.value = '';
        }

        if (careerPageHeroInput) {
          careerPageHeroInput.value = '';
        }

        if (careerPageLogoStatus) {
          careerPageLogoStatus.textContent =
            currentCareerPageSettings.logoUrl
              ? 'Đang sử dụng logo đã lưu. Chọn tệp mới nếu muốn thay thế.'
              : 'JPG hoặc PNG, tối đa 2MB.';
        }

        if (careerPageHeroStatus) {
          careerPageHeroStatus.textContent =
            currentCareerPageSettings.heroImageUrl
              ? 'Đang sử dụng ảnh giới thiệu đã lưu. Chọn tệp mới nếu muốn thay thế.'
              : 'JPG hoặc PNG, tối đa 2MB.';
        }

        clearCareerPagePreviewObjectUrls();

        renderCareerPagePublicContent(
          careerPagePreviewContainer,
          currentCareerPageSettings
        );

        showToast(
          'success',
          'Đã lưu trang giới thiệu',
          'Nội dung trang giới thiệu công ty đã được cập nhật.'
        );
      } catch (error) {
        showToast(
          'error',
          'Không thể lưu',
          error.message || 'Không thể lưu cấu hình trang tuyển dụng.'
        );
      } finally {
        careerPageSaveBtn.disabled = false;
        careerPageSaveBtn.textContent = originalButtonText;
      }
    });
  }
  // S2. DEPARTMENTS & ORGANIZATION MANAGEMENT
  // ==============================================================================

  const departmentsTreeContainer = document.getElementById('departments-tree-container');
  const departmentsTotalBadge = document.getElementById('departments-total-badge');
  const departmentForm = document.getElementById('department-form');
  const departmentFormTitle = document.getElementById('department-form-title');
  const departmentIdInput = document.getElementById('department-id-input');
  const departmentCodeInput = document.getElementById('department-code-input');
  const departmentNameInput = document.getElementById('department-name-input');
  const departmentParentSelect = document.getElementById('department-parent-select');
  const departmentManagerSelect = document.getElementById('department-manager-select');
  const departmentFormAlert = document.getElementById('department-form-alert');
  const departmentFormAlertMsg = document.getElementById('department-form-alert-msg');
  const departmentNewBtn = document.getElementById('department-new-btn');
  const departmentResetBtn = document.getElementById('department-reset-btn');
  const departmentSaveBtn = document.getElementById('department-save-btn');
  // Competency Framework & Job Title Elements
  const competencyFrameworkList = document.getElementById('competency-framework-list');
  const competencyFrameworksTotalBadge = document.getElementById('competency-frameworks-total-badge');
  const competencyFrameworkForm = document.getElementById('competency-framework-form');
  const competencyFrameworkFormTitle = document.getElementById('competency-framework-form-title');
  const competencyFrameworkIdInput = document.getElementById('competency-framework-id-input');
  const competencyFrameworkCodeInput = document.getElementById('competency-framework-code-input');
  const competencyFrameworkNameInput = document.getElementById('competency-framework-name-input');
  const competencyFrameworkDescriptionInput = document.getElementById('competency-framework-description-input');
  const competencyAddCriterionBtn = document.getElementById('competency-add-criterion-btn');
  const competencyCriteriaContainer = document.getElementById('competency-criteria-container');
  const competencyTotalWeight = document.getElementById('competency-total-weight');
  const competencyFrameworkFormAlert = document.getElementById('competency-framework-form-alert');
  const competencyFrameworkFormAlertMsg = document.getElementById('competency-framework-form-alert-msg');
  const competencyFrameworkResetBtn = document.getElementById('competency-framework-reset-btn');
  const competencyFrameworkSaveBtn = document.getElementById('competency-framework-save-btn');

  const jobTitleList = document.getElementById('job-title-list');
  const jobTitlesTotalBadge = document.getElementById('job-titles-total-badge');
  const jobTitleForm = document.getElementById('job-title-form');
  const jobTitleFormTitle = document.getElementById('job-title-form-title');
  const jobTitleIdInput = document.getElementById('job-title-id-input');
  const jobTitleCodeInput = document.getElementById('job-title-code-input');
  const jobTitleNameInput = document.getElementById('job-title-name-input');
  const jobTitleLevelInput = document.getElementById('job-title-level-input');
  const jobTitleMinSalaryInput = document.getElementById('job-title-min-salary-input');
  const jobTitleMaxSalaryInput = document.getElementById('job-title-max-salary-input');
  const jobTitleSalaryFields = document.getElementById('job-title-salary-fields');
  const jobTitleSalaryAccessNote = document.getElementById('job-title-salary-access-note');
  let canViewJobTitleSalary = false;
  const jobTitleFrameworkSelect = document.getElementById('job-title-framework-select');
  const jobTitleFormAlert = document.getElementById('job-title-form-alert');
  const jobTitleFormAlertMsg = document.getElementById('job-title-form-alert-msg');
  const jobTitleResetBtn = document.getElementById('job-title-reset-btn');
  const jobTitleSaveBtn = document.getElementById('job-title-save-btn');

  let currentDepartments = [];
  let currentDepartmentTree = [];
  let currentDepartmentUsers = [];

  function escapeDepartmentHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function flattenDepartmentTree(nodes, depth = 0, result = []) {
    nodes.forEach(node => {
      result.push({ department: node, depth });
      flattenDepartmentTree(node.children || [], depth + 1, result);
    });

    return result;
  }

  function hideDepartmentFormError() {
    if (departmentFormAlert) departmentFormAlert.classList.add('hidden');
    if (departmentFormAlertMsg) departmentFormAlertMsg.textContent = '';
  }

  function showDepartmentFormError(message) {
    if (departmentFormAlertMsg) {
      departmentFormAlertMsg.textContent =
        message || 'Không thể xử lý phòng ban.';
    }

    if (departmentFormAlert) {
      departmentFormAlert.classList.remove('hidden');
    }
  }

  function populateDepartmentFormOptions(editingId = null) {
    if (departmentParentSelect) {
      const options = flattenDepartmentTree(currentDepartmentTree)
        .filter(item => item.department.id !== editingId)
        .map(item => {
          const department = item.department;
          const prefix = item.depth > 0 ? '— '.repeat(item.depth) : '';
          const inactiveLabel =
            department.status === 'INACTIVE'
              ? ' (Ngừng áp dụng)'
              : '';

          return `
            <option value="${escapeDepartmentHtml(department.id)}">${escapeDepartmentHtml(prefix + department.name + inactiveLabel)}</option>
          `;
        })
        .join('');

      departmentParentSelect.innerHTML =
        '<option value="">-- Cấp cao nhất --</option>' + options;
    }

    if (departmentManagerSelect) {
      const managerOptions = currentDepartmentUsers
        .map(user => {
          const label =
            user.fullName ||
            user.full_name ||
            user.email ||
            user.id;

          const email =
            user.email && user.email !== label
              ? ` (${escapeDepartmentHtml(user.email)})`
              : '';

          return `
            <option value="${escapeDepartmentHtml(user.id)}">${escapeDepartmentHtml(label)}${email}</option>
          `;
        })
        .join('');

      departmentManagerSelect.innerHTML =
        '<option value="">-- Chọn người phụ trách --</option>' +
        managerOptions;
    }
  }

  function resetDepartmentForm() {
    if (departmentForm) departmentForm.reset();
    if (departmentIdInput) departmentIdInput.value = '';

    if (departmentFormTitle) {
      departmentFormTitle.textContent = 'Thêm phòng ban';
    }

    if (departmentSaveBtn) {
      departmentSaveBtn.textContent = 'Lưu phòng ban';
    }

    hideDepartmentFormError();
    populateDepartmentFormOptions();
  }

  function editDepartment(departmentId) {
    const department = currentDepartments.find(
      item => item.id === departmentId
    );

    if (!department) return;

    populateDepartmentFormOptions(department.id);

    if (departmentIdInput) {
      departmentIdInput.value = department.id;
    }

    if (departmentCodeInput) {
      departmentCodeInput.value = department.code || '';
    }

    if (departmentNameInput) {
      departmentNameInput.value = department.name || '';
    }

    if (departmentParentSelect) {
      departmentParentSelect.value = department.parentId || '';
    }

    if (departmentManagerSelect) {
      departmentManagerSelect.value =
        department.manager && department.manager.id
          ? department.manager.id
          : '';
    }

    if (departmentFormTitle) {
      departmentFormTitle.textContent = 'Cập nhật phòng ban';
    }

    if (departmentSaveBtn) {
      departmentSaveBtn.textContent = 'Cập nhật';
    }

    hideDepartmentFormError();

    if (departmentCodeInput) {
      departmentCodeInput.focus();
    }
  }

  function renderDepartmentTree() {
    if (!departmentsTreeContainer) return;

    if (currentDepartmentTree.length === 0) {
      departmentsTreeContainer.innerHTML = `
        <div style="text-align: center; color: var(--color-text-muted); padding: 24px;">
          Chưa có phòng ban nào.
        </div>
      `;
      return;
    }

    const renderNodes = (nodes, depth = 0) =>
      nodes.map(department => {
        const managerName =
          department.manager
            ? (
                department.manager.fullName ||
                department.manager.email ||
                'Chưa xác định'
              )
            : 'Chưa xác định';

        const isActive = department.status === 'ACTIVE';
        const openCount = Number(
          department.openRequisitionCount || 0
        );

        return `
          <div style="
            margin-left: ${depth * 22}px;
            margin-bottom: 10px;
            padding: 12px;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            ${depth > 0
              ? 'border-left: 3px solid var(--color-primary);'
              : ''}
          ">
            <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;">
              <div style="min-width: 0;">
                <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                  <strong>${escapeDepartmentHtml(department.name)}</strong>

                  <span class="badge badge-primary font-mono">
                    ${escapeDepartmentHtml(department.code)}
                  </span>

                  <span class="badge ${isActive
                    ? 'badge-success'
                    : 'badge-warning'}">
                    ${isActive
                      ? 'Đang áp dụng'
                      : 'Ngừng áp dụng'}
                  </span>
                </div>

                <div style="font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 6px;">
                  Người phụ trách:
                  <strong>${escapeDepartmentHtml(managerName)}</strong>
                </div>

                <div style="font-size: 0.775rem; color: var(--color-text-muted); margin-top: 4px;">
                  Yêu cầu tuyển dụng đang mở: ${openCount}
                </div>
              </div>

              <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  data-department-action="edit"
                  data-department-id="${escapeDepartmentHtml(department.id)}"
                >
                  Sửa
                </button>

                ${isActive ? `
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    data-department-action="deactivate"
                    data-department-id="${escapeDepartmentHtml(department.id)}"
                  >
                    Ngừng áp dụng
                  </button>
                ` : ''}

                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  data-department-action="delete"
                  data-department-id="${escapeDepartmentHtml(department.id)}"
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>

          ${renderNodes(department.children || [], depth + 1)}
        `;
      }).join('');

    departmentsTreeContainer.innerHTML =
      renderNodes(currentDepartmentTree);
  }

  async function loadDepartments() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (departmentsTreeContainer) {
      departmentsTreeContainer.innerHTML = `
        <div style="text-align: center; color: var(--color-text-muted); padding: 24px;">
          Đang tải phòng ban...
        </div>
      `;
    }

    try {
      const [departmentsRes, usersRes] = await Promise.all([
        window.ATS_API.getDepartmentsApi(token),
        window.ATS_API.getUsersApi(token, {
          page: 1,
          limit: 100,
          status: 'ACTIVE'
        })
      ]);

      if (
        !departmentsRes.ok ||
        !departmentsRes.data ||
        !departmentsRes.data.success
      ) {
        throw new Error(
          departmentsRes.data &&
          departmentsRes.data.message
            ? departmentsRes.data.message
            : 'Không thể tải danh sách phòng ban.'
        );
      }

      currentDepartments =
        departmentsRes.data.departments || [];

      currentDepartmentTree =
        departmentsRes.data.tree || [];

      if (
        usersRes.ok &&
        usersRes.data &&
        usersRes.data.success
      ) {
        const userData = usersRes.data.data || {};

        currentDepartmentUsers =
          userData.items ||
          userData.users ||
          [];
      } else {
        currentDepartmentUsers = [];
      }

      if (departmentsTotalBadge) {
        departmentsTotalBadge.textContent =
          `${departmentsRes.data.total || currentDepartments.length} phòng ban`;
      }

      renderDepartmentTree();

      const editingId =
        departmentIdInput
          ? departmentIdInput.value
          : '';

      populateDepartmentFormOptions(
        editingId || null
      );
    } catch (error) {
      console.error(
        'Failed to load departments:',
        error
      );

      if (departmentsTreeContainer) {
        departmentsTreeContainer.innerHTML = `
          <div style="text-align: center; color: var(--color-danger); padding: 24px;">
            ${escapeDepartmentHtml(
              error.message ||
              'Không thể tải phòng ban.'
            )}
          </div>
        `;
      }
    }
  }

  async function deactivateDepartment(
    departmentId,
    skipConfirm = false
  ) {
    const token =
      sessionStorage.getItem('ats_token');

    if (!token || !departmentId) return;

    if (
      !skipConfirm &&
      !window.confirm(
        'Ngừng áp dụng phòng ban này?'
      )
    ) {
      return;
    }

    try {
      const res =
        await window.ATS_API.deactivateDepartmentApi(
          token,
          departmentId
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        showToast(
          'success',
          'Đã ngừng áp dụng',
          res.data.message ||
            'Phòng ban đã được ngừng áp dụng.'
        );

        resetDepartmentForm();
        await loadDepartments();
      } else {
        showToast(
          'error',
          'Không thể ngừng áp dụng',
          (res.data && res.data.message) ||
            'Không thể cập nhật phòng ban.'
        );
      }
    } catch (error) {
      showToast(
        'error',
        'Lỗi',
        error.message
      );
    }
  }

  async function deleteDepartment(departmentId) {
    const token =
      sessionStorage.getItem('ats_token');

    if (!token || !departmentId) return;

    if (
      !window.confirm(
        'Bạn có chắc muốn xóa phòng ban này?'
      )
    ) {
      return;
    }

    try {
      const res =
        await window.ATS_API.deleteDepartmentApi(
          token,
          departmentId
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        showToast(
          'success',
          'Đã xóa phòng ban',
          res.data.message ||
            'Xóa phòng ban thành công.'
        );

        resetDepartmentForm();
        await loadDepartments();
        return;
      }

      if (
        res.data &&
        res.data.code ===
          'DEPARTMENT_HAS_OPEN_REQUISITIONS' &&
        res.data.canDeactivate === true
      ) {
        const shouldDeactivate =
          window.confirm(
            `${res.data.message}\n\nBạn có muốn ngừng áp dụng phòng ban này thay thế không?`
          );

        if (shouldDeactivate) {
          await deactivateDepartment(
            departmentId,
            true
          );
        }

        return;
      }

      showToast(
        'error',
        'Không thể xóa phòng ban',
        (res.data && res.data.message) ||
          'Không thể xóa phòng ban.'
      );
    } catch (error) {
      showToast(
        'error',
        'Lỗi',
        error.message
      );
    }
  }

  if (departmentForm) {
    departmentForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token =
          sessionStorage.getItem('ats_token');

        if (!token) return;

        hideDepartmentFormError();

        const departmentId =
          departmentIdInput
            ? departmentIdInput.value.trim()
            : '';

        const payload = {
          code: departmentCodeInput
            ? departmentCodeInput.value.trim()
            : '',

          name: departmentNameInput
            ? departmentNameInput.value.trim()
            : '',

          parentId: departmentParentSelect
            ? departmentParentSelect.value || null
            : null,

          managerId: departmentManagerSelect
            ? departmentManagerSelect.value
            : ''
        };

        if (
          !payload.code ||
          !payload.name ||
          !payload.managerId
        ) {
          showDepartmentFormError(
            'Vui lòng nhập mã, tên phòng ban và chọn người phụ trách.'
          );
          return;
        }

        if (departmentSaveBtn) {
          departmentSaveBtn.disabled = true;
        }

        try {
          const res = departmentId
            ? await window.ATS_API.updateDepartmentApi(
                token,
                departmentId,
                payload
              )
            : await window.ATS_API.createDepartmentApi(
                token,
                payload
              );

          if (
            res.ok &&
            res.data &&
            res.data.success
          ) {
            showToast(
              'success',
              departmentId
                ? 'Cập nhật thành công'
                : 'Tạo thành công',
              res.data.message ||
                'Đã lưu phòng ban.'
            );

            resetDepartmentForm();
            await loadDepartments();
          } else {
            showDepartmentFormError(
              (res.data && res.data.message) ||
                'Không thể lưu phòng ban.'
            );
          }
        } catch (error) {
          showDepartmentFormError(
            error.message
          );
        } finally {
          if (departmentSaveBtn) {
            departmentSaveBtn.disabled = false;
          }
        }
      }
    );
  }

  if (departmentsTreeContainer) {
    departmentsTreeContainer.addEventListener(
      'click',
      async event => {
        const button =
          event.target.closest(
            '[data-department-action]'
          );

        if (!button) return;

        const departmentId =
          button.dataset.departmentId;

        const action =
          button.dataset.departmentAction;

        if (action === 'edit') {
          editDepartment(departmentId);
        } else if (action === 'deactivate') {
          await deactivateDepartment(
            departmentId
          );
        } else if (action === 'delete') {
          await deleteDepartment(
            departmentId
          );
        }
      }
    );
  }

  if (departmentNewBtn) {
    departmentNewBtn.addEventListener(
      'click',
      () => {
        resetDepartmentForm();

        if (departmentCodeInput) {
          departmentCodeInput.focus();
        }
      }
    );
  }

  if (departmentResetBtn) {
    departmentResetBtn.addEventListener(
      'click',
      resetDepartmentForm
    );
  }


  // ==============================================================================  // 12. USERS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  // ==============================================================================
  // S2. COMPETENCY FRAMEWORK & JOB TITLE MANAGEMENT
  // ==============================================================================

  let currentCompetencyFrameworks = [];
  let currentJobTitles = [];

  function clearJobTitleSalaryState() {
    canViewJobTitleSalary = false;
    currentJobTitles = currentJobTitles.map(({ minSalary, maxSalary, ...item }) => item);
    if (jobTitleMinSalaryInput) jobTitleMinSalaryInput.value = '';
    if (jobTitleMaxSalaryInput) jobTitleMaxSalaryInput.value = '';
    if (jobTitleSalaryFields) {
      jobTitleSalaryFields.disabled = true;
      jobTitleSalaryFields.classList.add('hidden');
    }
    if (jobTitleSaveBtn) jobTitleSaveBtn.disabled = true;
    renderJobTitles();
  }

  function escapeCompetencyHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function updateCompetencyTotalWeight() {
    if (!competencyCriteriaContainer || !competencyTotalWeight) return;

    const inputs = competencyCriteriaContainer.querySelectorAll(
      '[data-criterion-weight]'
    );

    let total = 0;

    inputs.forEach(input => {
      total += Number(input.value) || 0;
    });

    competencyTotalWeight.textContent = String(total);
  }

  function addCompetencyCriterionRow(criterion = {}) {
    if (!competencyCriteriaContainer) return;

    const row = document.createElement('div');
    row.className = 'competency-criterion-row';
    row.style.cssText =
      'display:grid;grid-template-columns:minmax(180px,1fr) 100px auto;gap:8px;align-items:end;margin-bottom:8px;';

    row.dataset.criterionId = criterion.id || '';

    row.innerHTML = `
      <div>
        <label class="form-label">Tên tiêu chí</label>
        <input
          type="text"
          class="form-input"
          data-criterion-name
          value="${escapeCompetencyHtml(criterion.name || '')}"
          placeholder="Ví dụ: Kiến thức chuyên môn"
          required
        />
      </div>

      <div>
        <label class="form-label">Trọng số (%)</label>
        <input
          type="number"
          class="form-input"
          data-criterion-weight
          min="1"
          max="100"
          value="${Number(criterion.weight) || ''}"
          required
        />
      </div>

      <button
        type="button"
        class="btn btn-outline btn-sm"
        data-remove-criterion
        style="margin-bottom:1px;"
      >
        Xóa
      </button>
    `;

    competencyCriteriaContainer.appendChild(row);
    updateCompetencyTotalWeight();
  }

  function renderCompetencyFrameworks() {
    if (!competencyFrameworkList) return;

    if (competencyFrameworksTotalBadge) {
      competencyFrameworksTotalBadge.textContent =
        `${currentCompetencyFrameworks.length} khung`;
    }

    if (currentCompetencyFrameworks.length === 0) {
      competencyFrameworkList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Chưa có khung năng lực nào.
        </div>
      `;
      return;
    }

    competencyFrameworkList.innerHTML = currentCompetencyFrameworks
      .map(framework => {
        const criteria = Array.isArray(framework.criteria)
          ? framework.criteria
          : [];

        const criteriaHtml = criteria
          .map(criterion => `
            <div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;">
              <span>${escapeCompetencyHtml(criterion.name)}</span>
              <strong>${Number(criterion.weight) || 0}%</strong>
            </div>
          `)
          .join('');

        return `
          <div
            style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:10px;"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
              <div>
                <strong>${escapeCompetencyHtml(framework.name)}</strong>
                <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px;">
                  ${escapeCompetencyHtml(framework.code)}
                </div>
              </div>

              <button
                type="button"
                class="btn btn-outline btn-sm"
                data-competency-edit="${escapeCompetencyHtml(framework.id)}"
              >
                Sửa
              </button>
            </div>

            <div style="margin-top:10px;">
              ${criteriaHtml}
            </div>

            <div style="margin-top:8px;font-size:12px;color:var(--color-text-muted);">
              Tổng trọng số:
              <strong>${Number(framework.totalWeight) || 0}%</strong>
              · ${Array.isArray(framework.jobTitles) ? framework.jobTitles.length : 0} chức danh
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderJobTitles() {
    if (!jobTitleList) return;

    if (jobTitlesTotalBadge) {
      jobTitlesTotalBadge.textContent =
        `${currentJobTitles.length} chức danh`;
    }

    if (currentJobTitles.length === 0) {
      jobTitleList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Chưa có chức danh nào.
        </div>
      `;
      return;
    }

    jobTitleList.innerHTML = currentJobTitles
      .map(jobTitle => `
        <div
          style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:10px;"
        >
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div>
              <strong>${escapeCompetencyHtml(jobTitle.name)}</strong>

              <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px;">
                ${escapeCompetencyHtml(jobTitle.code)}
                · Cấp bậc: ${escapeCompetencyHtml(jobTitle.level || 'Chưa khai báo')}
              </div>

              ${canViewJobTitleSalary ? `<div style="margin-top:6px;">Dải lương: ${jobTitle.minSalary == null || jobTitle.maxSalary == null ? 'Chưa khai báo' : `${Number(jobTitle.minSalary).toLocaleString('vi-VN')} – ${Number(jobTitle.maxSalary).toLocaleString('vi-VN')} VNĐ`}</div>` : ''}

              <div style="margin-top:6px;font-size:13px;">
                Khung:
                <strong>
                  ${
                    jobTitle.framework
                      ? escapeCompetencyHtml(jobTitle.framework.name)
                      : 'Chưa gán'
                  }
                </strong>
              </div>
            </div>

            <button
              type="button"
              class="btn btn-outline btn-sm"
              data-job-title-edit="${escapeCompetencyHtml(jobTitle.id)}"
            >
              Sửa
            </button>
          </div>
        </div>
      `)
      .join('');
  }

  function populateJobTitleFrameworkOptions() {
    if (!jobTitleFrameworkSelect) return;

    const selectedValue = jobTitleFrameworkSelect.value;

    jobTitleFrameworkSelect.innerHTML =
      '<option value="">-- Chọn khung năng lực --</option>' +
      currentCompetencyFrameworks
        .filter(framework => framework.status === 'ACTIVE')
        .map(framework => `
          <option value="${escapeCompetencyHtml(framework.id)}">
            ${escapeCompetencyHtml(framework.name)} (${escapeCompetencyHtml(framework.code)})
          </option>
        `)
        .join('');

    if (
      selectedValue &&
      currentCompetencyFrameworks.some(
        framework => framework.id === selectedValue
      )
    ) {
      jobTitleFrameworkSelect.value = selectedValue;
    }
  }

  async function loadCompetencies() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (competencyFrameworkList) {
      competencyFrameworkList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Đang tải khung năng lực...
        </div>
      `;
    }

    if (jobTitleList) {
      jobTitleList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Đang tải chức danh...
        </div>
      `;
    }

    try {
      const [frameworkRes, jobTitleRes] = await Promise.all([
        window.ATS_API.getCompetencyFrameworksApi(token),
        window.ATS_API.getJobTitlesApi(token)
      ]);

      if (!frameworkRes.ok) {
        throw new Error(
          frameworkRes.data?.message ||
          'Không thể tải danh sách khung năng lực.'
        );
      }

      if (!jobTitleRes.ok) {
        throw new Error(
          jobTitleRes.data?.message ||
          'Không thể tải danh sách chức danh.'
        );
      }

      currentCompetencyFrameworks =
        frameworkRes.data.frameworks || [];

      currentJobTitles =
        jobTitleRes.data.jobTitles || [];
      canViewJobTitleSalary = jobTitleRes.data.canViewSalary === true;
      if (jobTitleSalaryFields) {
        jobTitleSalaryFields.disabled = !canViewJobTitleSalary;
        jobTitleSalaryFields.classList.toggle('hidden', !canViewJobTitleSalary);
      }
      if (jobTitleSalaryAccessNote) jobTitleSalaryAccessNote.classList.toggle('hidden', canViewJobTitleSalary);
      if (jobTitleSaveBtn) jobTitleSaveBtn.disabled = !canViewJobTitleSalary && !jobTitleIdInput?.value;

      renderCompetencyFrameworks();
      renderJobTitles();
      populateJobTitleFrameworkOptions();

      if (
        competencyCriteriaContainer &&
        competencyCriteriaContainer.children.length === 0
      ) {
        addCompetencyCriterionRow();
      }
    } catch (error) {
      console.error('Failed to load competencies:', error);

      if (competencyFrameworkList) {
        competencyFrameworkList.innerHTML = `
          <div style="text-align:center;color:var(--color-danger);padding:24px;">
            ${escapeCompetencyHtml(error.message)}
          </div>
        `;
      }

      if (jobTitleList) {
        jobTitleList.innerHTML = `
          <div style="text-align:center;color:var(--color-danger);padding:24px;">
            ${escapeCompetencyHtml(error.message)}
          </div>
        `;
      }
    }
  }

  function hideCompetencyFrameworkError() {
    if (competencyFrameworkFormAlert) {
      competencyFrameworkFormAlert.classList.add('hidden');
    }

    if (competencyFrameworkFormAlertMsg) {
      competencyFrameworkFormAlertMsg.textContent = '';
    }
  }

  function showCompetencyFrameworkError(message) {
    if (competencyFrameworkFormAlertMsg) {
      competencyFrameworkFormAlertMsg.textContent =
        message || 'Không thể lưu khung năng lực.';
    }

    if (competencyFrameworkFormAlert) {
      competencyFrameworkFormAlert.classList.remove('hidden');
    }
  }

  function resetCompetencyFrameworkForm() {
    if (competencyFrameworkForm) {
      competencyFrameworkForm.reset();
    }

    if (competencyFrameworkIdInput) {
      competencyFrameworkIdInput.value = '';
    }

    if (competencyFrameworkFormTitle) {
      competencyFrameworkFormTitle.textContent = 'Thêm khung năng lực';
    }

    if (competencyFrameworkSaveBtn) {
      competencyFrameworkSaveBtn.textContent = 'Lưu khung năng lực';
    }

    if (competencyCriteriaContainer) {
      competencyCriteriaContainer.innerHTML = '';
      addCompetencyCriterionRow();
    }

    hideCompetencyFrameworkError();
    updateCompetencyTotalWeight();
  }

  function editCompetencyFramework(frameworkId) {
    const framework = currentCompetencyFrameworks.find(
      item => item.id === frameworkId
    );

    if (!framework) return;

    if (competencyFrameworkIdInput) {
      competencyFrameworkIdInput.value = framework.id;
    }

    if (competencyFrameworkCodeInput) {
      competencyFrameworkCodeInput.value = framework.code || '';
    }

    if (competencyFrameworkNameInput) {
      competencyFrameworkNameInput.value = framework.name || '';
    }

    if (competencyFrameworkDescriptionInput) {
      competencyFrameworkDescriptionInput.value =
        framework.description || '';
    }

    if (competencyCriteriaContainer) {
      competencyCriteriaContainer.innerHTML = '';

      const criteria = Array.isArray(framework.criteria)
        ? framework.criteria
        : [];

      criteria.forEach(criterion => {
        addCompetencyCriterionRow(criterion);
      });

      if (criteria.length === 0) {
        addCompetencyCriterionRow();
      }
    }

    if (competencyFrameworkFormTitle) {
      competencyFrameworkFormTitle.textContent =
        'Cập nhật khung năng lực';
    }

    if (competencyFrameworkSaveBtn) {
      competencyFrameworkSaveBtn.textContent = 'Cập nhật';
    }

    hideCompetencyFrameworkError();
    updateCompetencyTotalWeight();

    if (competencyFrameworkCodeInput) {
      competencyFrameworkCodeInput.focus();
    }
  }

  if (competencyAddCriterionBtn) {
    competencyAddCriterionBtn.addEventListener('click', () => {
      addCompetencyCriterionRow();
    });
  }

  if (competencyCriteriaContainer) {
    competencyCriteriaContainer.addEventListener('input', event => {
      if (event.target.matches('[data-criterion-weight]')) {
        updateCompetencyTotalWeight();
      }
    });

    competencyCriteriaContainer.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-criterion]');
      if (!removeBtn) return;

      const row = removeBtn.closest('.competency-criterion-row');
      if (row) row.remove();

      if (competencyCriteriaContainer.children.length === 0) {
        addCompetencyCriterionRow();
      }

      updateCompetencyTotalWeight();
    });
  }

  if (competencyFrameworkList) {
    competencyFrameworkList.addEventListener('click', event => {
      const button = event.target.closest('[data-competency-edit]');
      if (!button) return;

      editCompetencyFramework(button.dataset.competencyEdit);
    });
  }

  if (competencyFrameworkResetBtn) {
    competencyFrameworkResetBtn.addEventListener(
      'click',
      resetCompetencyFrameworkForm
    );
  }

  if (competencyFrameworkForm) {
    competencyFrameworkForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token = sessionStorage.getItem('ats_token');
        if (!token) return;

        hideCompetencyFrameworkError();

        const frameworkId = competencyFrameworkIdInput
          ? competencyFrameworkIdInput.value.trim()
          : '';

        const criteria = competencyCriteriaContainer
          ? Array.from(
              competencyCriteriaContainer.querySelectorAll(
                '.competency-criterion-row'
              )
            ).map(row => ({
              id: row.dataset.criterionId || null,
              name:
                row.querySelector('[data-criterion-name]')?.value.trim() || '',
              weight: Number(
                row.querySelector('[data-criterion-weight]')?.value
              ) || 0
            }))
          : [];

        const payload = {
          code: competencyFrameworkCodeInput
            ? competencyFrameworkCodeInput.value.trim()
            : '',
          name: competencyFrameworkNameInput
            ? competencyFrameworkNameInput.value.trim()
            : '',
          description: competencyFrameworkDescriptionInput
            ? competencyFrameworkDescriptionInput.value.trim()
            : '',
          criteria
        };

        if (!payload.code || !payload.name) {
          showCompetencyFrameworkError(
            'Vui lòng nhập mã và tên khung năng lực.'
          );
          return;
        }

        if (
          criteria.length === 0 ||
          criteria.some(
            criterion =>
              !criterion.name ||
              !Number.isInteger(criterion.weight) ||
              criterion.weight <= 0 ||
              criterion.weight > 100
          )
        ) {
          showCompetencyFrameworkError(
            'Mỗi tiêu chí phải có tên và trọng số từ 1 đến 100%.'
          );
          return;
        }

        const totalWeight = criteria.reduce(
          (sum, criterion) => sum + criterion.weight,
          0
        );

        if (totalWeight !== 100) {
          showCompetencyFrameworkError(
            `Tổng trọng số phải bằng 100%. Hiện tại là ${totalWeight}%.`
          );
          return;
        }

        if (competencyFrameworkSaveBtn) {
          competencyFrameworkSaveBtn.disabled = true;
        }

        try {
          const res = frameworkId
            ? await window.ATS_API.updateCompetencyFrameworkApi(
                token,
                frameworkId,
                payload
              )
            : await window.ATS_API.createCompetencyFrameworkApi(
                token,
                payload
              );

          if (res.ok && res.data?.success) {
            showToast(
              'success',
              'Thành công',
              frameworkId
                ? 'Đã cập nhật khung năng lực.'
                : 'Đã tạo khung năng lực.'
            );

            resetCompetencyFrameworkForm();
            await loadCompetencies();
          } else {
            showCompetencyFrameworkError(
              res.data?.message ||
              'Không thể lưu khung năng lực.'
            );
          }
        } catch (error) {
          showCompetencyFrameworkError(error.message);
        } finally {
          if (competencyFrameworkSaveBtn) {
            competencyFrameworkSaveBtn.disabled = false;
          }
        }
      }
    );
  }

  function hideJobTitleError() {
    if (jobTitleFormAlert) {
      jobTitleFormAlert.classList.add('hidden');
    }

    if (jobTitleFormAlertMsg) {
      jobTitleFormAlertMsg.textContent = '';
    }
  }

  function showJobTitleError(message) {
    if (jobTitleFormAlertMsg) {
      jobTitleFormAlertMsg.textContent =
        message || 'Không thể lưu chức danh.';
    }

    if (jobTitleFormAlert) {
      jobTitleFormAlert.classList.remove('hidden');
    }
  }

  function resetJobTitleForm() {
    if (jobTitleForm) {
      jobTitleForm.reset();
    }

    if (jobTitleIdInput) {
      jobTitleIdInput.value = '';
    }

    if (jobTitleFormTitle) {
      jobTitleFormTitle.textContent = 'Thêm chức danh';
    }

    if (jobTitleSaveBtn) {
      jobTitleSaveBtn.textContent = 'Lưu chức danh';
      jobTitleSaveBtn.disabled = !canViewJobTitleSalary;
    }

    hideJobTitleError();
    populateJobTitleFrameworkOptions();
  }

  function editJobTitle(jobTitleId) {
    const jobTitle = currentJobTitles.find(
      item => item.id === jobTitleId
    );

    if (!jobTitle) return;

    if (jobTitleIdInput) {
      jobTitleIdInput.value = jobTitle.id;
    }

    if (jobTitleCodeInput) {
      jobTitleCodeInput.value = jobTitle.code || '';
    }

    if (jobTitleNameInput) {
      jobTitleNameInput.value = jobTitle.name || '';
    }
    if (jobTitleLevelInput) jobTitleLevelInput.value = jobTitle.level || '';
    if (jobTitleMinSalaryInput) jobTitleMinSalaryInput.value = canViewJobTitleSalary ? jobTitle.minSalary ?? '' : '';
    if (jobTitleMaxSalaryInput) jobTitleMaxSalaryInput.value = canViewJobTitleSalary ? jobTitle.maxSalary ?? '' : '';

    if (jobTitleFrameworkSelect) {
      jobTitleFrameworkSelect.value =
        jobTitle.framework?.id || '';
    }

    if (jobTitleFormTitle) {
      jobTitleFormTitle.textContent = 'Cập nhật chức danh';
    }

    if (jobTitleSaveBtn) {
      jobTitleSaveBtn.textContent = 'Cập nhật';
      jobTitleSaveBtn.disabled = false;
    }

    hideJobTitleError();

    if (jobTitleCodeInput) {
      jobTitleCodeInput.focus();
    }
  }

  if (jobTitleList) {
    jobTitleList.addEventListener('click', event => {
      const button = event.target.closest('[data-job-title-edit]');
      if (!button) return;

      editJobTitle(button.dataset.jobTitleEdit);
    });
  }

  if (jobTitleResetBtn) {
    jobTitleResetBtn.addEventListener(
      'click',
      resetJobTitleForm
    );
  }

  if (jobTitleForm) {
    jobTitleForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token = sessionStorage.getItem('ats_token');
        if (!token) return;

        hideJobTitleError();

        const jobTitleId = jobTitleIdInput
          ? jobTitleIdInput.value.trim()
          : '';

        const payload = {
          code: jobTitleCodeInput
            ? jobTitleCodeInput.value.trim()
            : '',
          name: jobTitleNameInput
            ? jobTitleNameInput.value.trim()
            : '',
          level: jobTitleLevelInput ? jobTitleLevelInput.value.trim() : '',
          frameworkId: jobTitleFrameworkSelect
            ? jobTitleFrameworkSelect.value
            : ''
        };

        if (
          !payload.code ||
          !payload.name ||
          !payload.level
        ) {
          showJobTitleError(
            'Vui lòng nhập mã, tên và cấp bậc chức danh.'
          );
          return;
        }

        const framework = currentCompetencyFrameworks.find(
          item => item.id === payload.frameworkId
        );

        if (payload.frameworkId && !framework) {
          showJobTitleError(
            'Khung năng lực được chọn không tồn tại.'
          );
          return;
        }

        if (framework && Number(framework.totalWeight) !== 100) {
          showJobTitleError(
            'Khung năng lực phải có tổng trọng số bằng 100%.'
          );
          return;
        }

        if (canViewJobTitleSalary) {
          const minimum = jobTitleMinSalaryInput?.value.trim();
          const maximum = jobTitleMaxSalaryInput?.value.trim();
          if (!minimum || !maximum || !Number.isSafeInteger(Number(minimum)) || !Number.isSafeInteger(Number(maximum)) || Number(minimum) < 0 || Number(minimum) > Number(maximum)) {
            showJobTitleError('Dải lương phải gồm hai số nguyên không âm; tối thiểu không vượt tối đa.');
            return;
          }
          payload.minSalary = Number(minimum);
          payload.maxSalary = Number(maximum);
        }
        if (jobTitleSaveBtn) jobTitleSaveBtn.disabled = true;

        try {
          const res = jobTitleId
            ? await window.ATS_API.updateJobTitleApi(
                token,
                jobTitleId,
                payload
              )
            : await window.ATS_API.createJobTitleApi(
                token,
                payload
              );

          if (res.ok && res.data?.success) {
            showToast(
              'success',
              'Thành công',
              jobTitleId
                ? 'Đã cập nhật chức danh.'
                : 'Đã tạo chức danh.'
            );

            resetJobTitleForm();
            await loadCompetencies();
          } else {
            showJobTitleError(
              res.data?.message ||
              'Không thể lưu chức danh.'
            );
          }
        } catch (error) {
          showJobTitleError(error.message);
        } finally {
          if (jobTitleSaveBtn) {
            jobTitleSaveBtn.disabled = !canViewJobTitleSalary && !jobTitleIdInput?.value;
          }
        }
      }
    );
  }

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

  function renderUserAvatar(element, userId, fallbackText, cacheBust = '') {
    if (!element) return;

    const initial = String(fallbackText || 'U').charAt(0).toUpperCase();
    element.textContent = initial;

    if (!userId) return;

    const image = document.createElement('img');
    const version = cacheBust ? `?v=${cacheBust}` : '';

    image.src = `/public/avatars/avatar-${encodeURIComponent(userId)}-thumb.png${version}`;
    image.alt = 'Ảnh đại diện';
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'cover';
    image.style.borderRadius = 'inherit';
    image.style.display = 'block';

    image.addEventListener('load', () => {
      element.textContent = '';
      element.style.overflow = 'hidden';
      element.appendChild(image);
    }, { once: true });

    image.addEventListener('error', () => {
      element.textContent = initial;
    }, { once: true });
  }
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

    renderUserAvatar(avatar, u.id, u.fullName || u.email);
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

  const profileAvatarUploadBtn = document.getElementById('profile-avatar-upload-btn');
  const profileAvatarInput = document.getElementById('profile-avatar-input');

  if (profileAvatarUploadBtn && profileAvatarInput) {
    profileAvatarUploadBtn.addEventListener('click', () => {
      profileAvatarInput.click();
    });

    profileAvatarInput.addEventListener('change', async () => {
      const file = profileAvatarInput.files && profileAvatarInput.files[0];

      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png'];
      const maxFileSize = 2 * 1024 * 1024;

      if (!allowedTypes.includes(file.type)) {
        showToast(
          'warning',
          'Ảnh không hợp lệ',
          'Chỉ chấp nhận ảnh JPG hoặc PNG.'
        );
        profileAvatarInput.value = '';
        return;
      }

      if (file.size > maxFileSize) {
        showToast(
          'warning',
          'Ảnh quá lớn',
          'Ảnh đại diện không được vượt quá 2MB.'
        );
        profileAvatarInput.value = '';
        return;
      }

      const token = sessionStorage.getItem('ats_token');

      if (!token || !currentAuthenticatedUser) {
        profileAvatarInput.value = '';
        return;
      }

      const originalButtonText = profileAvatarUploadBtn.textContent;
      profileAvatarUploadBtn.disabled = true;
      profileAvatarUploadBtn.textContent = 'Đang tải...';

      try {
        const res = await window.ATS_API.uploadAvatarApi(token, file);

        if (res.ok && res.data && res.data.success) {
          const cacheBust = Date.now();
          const fallbackText =
            currentAuthenticatedUser.fullName ||
            currentAuthenticatedUser.email ||
            'U';

          renderUserAvatar(
            document.getElementById('profile-card-avatar'),
            currentAuthenticatedUser.id,
            fallbackText,
            cacheBust
          );

          renderUserAvatar(
            topbarUserAvatar,
            currentAuthenticatedUser.id,
            fallbackText,
            cacheBust
          );

          renderUserAvatar(
            sidebarUserAvatar,
            currentAuthenticatedUser.id,
            fallbackText,
            cacheBust
          );

          showToast(
            'success',
            'Đã cập nhật ảnh đại diện',
            'Ảnh đại diện đã được tải lên thành công.'
          );
        } else {
          showToast(
            'error',
            'Không thể cập nhật ảnh',
            (res.data && res.data.message) || 'Không thể tải ảnh đại diện.'
          );
        }
      } catch (err) {
        showToast(
          'error',
          'Lỗi tải ảnh',
          err.message || 'Không thể tải ảnh đại diện.'
        );
      } finally {
        profileAvatarUploadBtn.disabled = false;
        profileAvatarUploadBtn.textContent = originalButtonText;
        profileAvatarInput.value = '';
      }
    });
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
      const phoneNumber = editProfilePhoneInput.value
        .trim()
        .replace(/[\s.-]/g, '');

      const vietnamPhoneRegex =
        /^(?:0|\+84)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;

      if (phoneNumber && !vietnamPhoneRegex.test(phoneNumber)) {
        if (editProfileAlert && editProfileAlertMsg) {
          editProfileAlertMsg.textContent =
            'Số điện thoại Việt Nam không đúng định dạng.';
          editProfileAlert.classList.remove('hidden');
        }
        return;
      }

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
          initialRole,
          departmentName: department,
          phoneNumber: phone,
          roleCode: initialRole
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

  // Modal: Bulk Import Users from Excel
  const openBulkImportModalBtn = document.getElementById('open-bulk-import-modal-btn');
  const bulkImportUserModal = document.getElementById('bulk-import-user-modal');
  const closeBulkImportUserModal = document.getElementById('close-bulk-import-user-modal');
  const cancelBulkImportBtn = document.getElementById('cancel-bulk-import-btn');
  const downloadBulkTemplateBtn = document.getElementById('download-bulk-template-btn');
  const bulkImportAlert = document.getElementById('bulk-import-alert');
  const bulkImportAlertMsg = document.getElementById('bulk-import-alert-msg');
  const bulkImportFileInput = document.getElementById('bulk-import-file-input');
  const previewBulkImportBtn = document.getElementById('preview-bulk-import-btn');
  const confirmBulkImportBtn = document.getElementById('confirm-bulk-import-btn');
  const bulkImportSelectedFile = document.getElementById('bulk-import-selected-file');
  const bulkImportPreviewSummary = document.getElementById('bulk-import-preview-summary');
  const bulkImportPreviewContainer = document.getElementById('bulk-import-preview-container');
  const bulkImportPreviewBody = document.getElementById('bulk-import-preview-body');
  const bulkImportTotalRows = document.getElementById('bulk-import-total-rows');
  const bulkImportValidRows = document.getElementById('bulk-import-valid-rows');
  const bulkImportInvalidRows = document.getElementById('bulk-import-invalid-rows');
  const bulkImportReport = document.getElementById('bulk-import-report');
  const bulkImportReportTotal = document.getElementById('bulk-import-report-total');
  const bulkImportReportImported = document.getElementById('bulk-import-report-imported');
  const bulkImportReportSkipped = document.getElementById('bulk-import-report-skipped');
  const bulkImportReportMessage = document.getElementById('bulk-import-report-message');

  if (openBulkImportModalBtn) {
    openBulkImportModalBtn.addEventListener('click', () => {
      if (bulkImportUserModal) {
        bulkImportUserModal.classList.remove('hidden');
      }
    });
  }

  if (closeBulkImportUserModal) {
    closeBulkImportUserModal.addEventListener('click', () => {
      if (bulkImportUserModal) {
        bulkImportUserModal.classList.add('hidden');
      }
    });
  }

  if (cancelBulkImportBtn) {
    cancelBulkImportBtn.addEventListener('click', () => {
      if (bulkImportUserModal) {
        bulkImportUserModal.classList.add('hidden');
      }
    });
  }
  if (bulkImportFileInput) {
    bulkImportFileInput.addEventListener('change', () => {
      const file = bulkImportFileInput.files
        ? bulkImportFileInput.files[0]
        : null;

      if (confirmBulkImportBtn) {
        confirmBulkImportBtn.disabled = true;
      }

      if (bulkImportPreviewSummary) {
        bulkImportPreviewSummary.classList.add('hidden');
      }

      if (bulkImportPreviewContainer) {
        bulkImportPreviewContainer.classList.add('hidden');
      }

      if (bulkImportPreviewBody) {
        bulkImportPreviewBody.textContent = '';
      }

      if (bulkImportReport) {
        bulkImportReport.classList.add('hidden');
      }

      if (!file) {
        if (previewBulkImportBtn) {
          previewBulkImportBtn.disabled = true;
        }

        if (bulkImportSelectedFile) {
          bulkImportSelectedFile.textContent = '';
          bulkImportSelectedFile.classList.add('hidden');
        }

        return;
      }

      if (previewBulkImportBtn) {
        previewBulkImportBtn.disabled = false;
      }

      if (bulkImportSelectedFile) {
        bulkImportSelectedFile.textContent =
          `Đã chọn: ${file.name}`;
        bulkImportSelectedFile.classList.remove('hidden');
      }

      if (bulkImportAlert) {
        bulkImportAlert.classList.add('hidden');
      }
    });
  }
  if (previewBulkImportBtn) {
    previewBulkImportBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const file = bulkImportFileInput && bulkImportFileInput.files
        ? bulkImportFileInput.files[0]
        : null;

      if (!token) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Phiên đăng nhập không hợp lệ.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      if (!file) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Vui lòng chọn tệp Excel trước khi xem trước.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      previewBulkImportBtn.disabled = true;

      if (confirmBulkImportBtn) {
        confirmBulkImportBtn.disabled = true;
      }

      if (bulkImportAlert) {
        bulkImportAlert.classList.add('hidden');
      }

      if (bulkImportPreviewSummary) {
        bulkImportPreviewSummary.classList.add('hidden');
      }

      if (bulkImportPreviewContainer) {
        bulkImportPreviewContainer.classList.add('hidden');
      }

      if (bulkImportReport) {
        bulkImportReport.classList.add('hidden');
      }

      if (bulkImportPreviewBody) {
        bulkImportPreviewBody.textContent = '';
      }

      try {
        const res = await window.ATS_API.previewBulkUserImportApi(
          token,
          file
        );

        if (!(res.ok && res.data && res.data.success)) {
          if (bulkImportAlert && bulkImportAlertMsg) {
            bulkImportAlertMsg.textContent =
              res.data?.message || 'Không thể xem trước dữ liệu Excel.';
            bulkImportAlert.classList.remove('hidden');
          }

          return;
        }

        const data = res.data.data || {};
        const summary = data.summary || {};
        const rows = Array.isArray(data.rows)
          ? data.rows
          : [];

        if (bulkImportTotalRows) {
          bulkImportTotalRows.textContent =
            String(summary.totalRows || 0);
        }

        if (bulkImportValidRows) {
          bulkImportValidRows.textContent =
            String(summary.validRows || 0);
        }

        if (bulkImportInvalidRows) {
          bulkImportInvalidRows.textContent =
            String(summary.invalidRows || 0);
        }

        if (bulkImportPreviewBody) {
          rows.forEach(row => {
            const tr = document.createElement('tr');

            const values = [
              row.rowNumber ?? '',
              row.fullName || '',
              row.email || '',
              row.jobTitle || '',
              row.departmentName || '',
              row.roleCode || ''
            ];

            values.forEach(value => {
              const td = document.createElement('td');
              td.textContent = String(value);
              tr.appendChild(td);
            });

            const resultCell = document.createElement('td');

            if (row.valid) {
              const status = document.createElement('span');
              status.className = 'badge';
              status.textContent = 'Hợp lệ';
              resultCell.appendChild(status);
            } else {
              const errors = Array.isArray(row.errors)
                ? row.errors
                : [];

              if (errors.length === 0) {
                resultCell.textContent = 'Dữ liệu không hợp lệ.';
              } else {
                errors.forEach((error, index) => {
                  const line = document.createElement('div');

                  line.textContent =
                    error.message ||
                    error.code ||
                    'Dữ liệu không hợp lệ.';

                  if (index > 0) {
                    line.style.marginTop = '4px';
                  }

                  resultCell.appendChild(line);
                });
              }
            }

            tr.appendChild(resultCell);
            bulkImportPreviewBody.appendChild(tr);
          });
        }

        if (bulkImportPreviewSummary) {
          bulkImportPreviewSummary.classList.remove('hidden');
        }

        if (bulkImportPreviewContainer) {
          bulkImportPreviewContainer.classList.remove('hidden');
        }

        if (confirmBulkImportBtn) {
          confirmBulkImportBtn.disabled =
            Number(summary.validRows || 0) <= 0;
        }

        showToast(
          'success',
          'Đã kiểm tra tệp Excel',
          `${summary.validRows || 0} dòng hợp lệ, ${summary.invalidRows || 0} dòng có lỗi.`
        );
      } catch (err) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            err.message || 'Không thể xem trước dữ liệu Excel.';
          bulkImportAlert.classList.remove('hidden');
        }
      } finally {
        previewBulkImportBtn.disabled = false;
      }
    });
  }
  if (confirmBulkImportBtn) {
    confirmBulkImportBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const file = bulkImportFileInput && bulkImportFileInput.files
        ? bulkImportFileInput.files[0]
        : null;

      if (!token) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Phiên đăng nhập không hợp lệ.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      if (!file) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            'Vui lòng chọn và xem trước tệp Excel trước khi nhập.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      confirmBulkImportBtn.disabled = true;

      if (previewBulkImportBtn) {
        previewBulkImportBtn.disabled = true;
      }

      if (bulkImportAlert) {
        bulkImportAlert.classList.add('hidden');
      }

      try {
        const res = await window.ATS_API.importBulkUsersApi(
          token,
          file
        );

        if (!(res.ok && res.data && res.data.success)) {
          if (bulkImportAlert && bulkImportAlertMsg) {
            bulkImportAlertMsg.textContent =
              res.data?.message || 'Không thể nhập danh sách nhân sự.';
            bulkImportAlert.classList.remove('hidden');
          }

          return;
        }

        const data = res.data.data || {};
        const summary = data.summary || {};

        if (bulkImportReportTotal) {
          bulkImportReportTotal.textContent =
            String(summary.totalRows || 0);
        }

        if (bulkImportReportImported) {
          bulkImportReportImported.textContent =
            String(summary.importedRows || 0);
        }

        if (bulkImportReportSkipped) {
          bulkImportReportSkipped.textContent =
            String(summary.skippedRows || 0);
        }

        if (bulkImportReportMessage) {
          bulkImportReportMessage.textContent =
            res.data.message || 'Hoàn tất nhập danh sách nhân sự.';
        }

        if (bulkImportReport) {
          bulkImportReport.classList.remove('hidden');
        }

        showToast(
          'success',
          'Hoàn tất nhập nhân sự',
          `${summary.importedRows || 0} dòng đã nhập, ${summary.skippedRows || 0} dòng bị bỏ qua.`
        );

        usersCurrentPage = 1;
        loadUsers();
        loadDashboardData();
      } catch (err) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            err.message || 'Không thể nhập danh sách nhân sự.';
          bulkImportAlert.classList.remove('hidden');
        }
      } finally {
        if (previewBulkImportBtn) {
          previewBulkImportBtn.disabled = false;
        }
      }
    });
  }
  if (downloadBulkTemplateBtn) {
    downloadBulkTemplateBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');

      if (!token) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Phiên đăng nhập không hợp lệ.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      downloadBulkTemplateBtn.disabled = true;

      try {
        const res = await window.ATS_API.downloadBulkUserTemplateApi(token);

        if (res.ok && res.data && res.data.blob) {
          const url = URL.createObjectURL(res.data.blob);
          const link = document.createElement('a');

          link.href = url;
          link.download = res.data.filename || 'mau_nhap_nhan_su.xlsx';

          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          URL.revokeObjectURL(url);

          if (bulkImportAlert) {
            bulkImportAlert.classList.add('hidden');
          }

          showToast(
            'success',
            'Tải tệp mẫu thành công',
            'Tệp mẫu Excel nhập nhân sự đã được tải xuống.'
          );
        } else {
          if (bulkImportAlert && bulkImportAlertMsg) {
            bulkImportAlertMsg.textContent =
              res.data?.message || 'Không thể tải tệp mẫu Excel.';
            bulkImportAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            err.message || 'Không thể tải tệp mẫu Excel.';
          bulkImportAlert.classList.remove('hidden');
        }
      } finally {
        downloadBulkTemplateBtn.disabled = false;
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
  const createReqDepartmentSelect = document.getElementById('create-req-dept-input');
  const createReqWorkLocationSelect = document.getElementById('create-req-work-location-select');
  const createReqWorkModeSelect = document.getElementById('create-req-work-mode-select');
  const createReqJobTitleSelect = document.getElementById('create-req-job-title-input');
  const saveCreateReqDraftBtn = document.getElementById('save-create-req-draft-btn');
  let requisitionJobTitles = [];
  let editingS210Requisition = null;
  let requisitionSalaryCheck = { key: null, status: null, message: '' };
  let requisitionSalaryCheckRevision = 0;
  let requisitionOptionsRevision = 0;

  function requisitionSalaryCheckKey() {
    return JSON.stringify([createReqJobTitleSelect?.value || '',
      document.getElementById('create-req-salary-min-input').value,
      document.getElementById('create-req-salary-max-input').value]);
  }

  function requisitionBusinessDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function clearRequisitionSalaryState() {
    requisitionJobTitles = [];
    editingS210Requisition = null;
    requisitionSalaryCheck = { key: null, status: null, message: '' };
    requisitionSalaryCheckRevision++;
    requisitionOptionsRevision++;
    for (const id of ['create-req-salary-min-input', 'create-req-salary-max-input', 'create-req-justification-input']) {
      const node = document.getElementById(id); if (node) node.value = '';
    }
    for (const id of ['create-req-standard-salary', 'create-req-salary-warning']) {
      const node = document.getElementById(id); if (node) node.textContent = '';
    }
    if (createReqModal) createReqModal.classList.add('hidden');
  }

  function updateRequisitionSalaryHint() {
    const job = requisitionJobTitles.find(item => item.id === createReqJobTitleSelect?.value);
    const min = document.getElementById('create-req-salary-min-input').value;
    const max = document.getElementById('create-req-salary-max-input').value;
    const known = job && job.minSalary !== null && job.maxSalary !== null && job.minSalary !== undefined && job.maxSalary !== undefined;
    const checked = requisitionSalaryCheck.key === requisitionSalaryCheckKey() ? requisitionSalaryCheck : null;
    const outside = checked?.status ? checked.status === 'OUTSIDE_STANDARD_RANGE'
      : known && ((min !== '' && Number(min) < job.minSalary) || (max !== '' && Number(max) > job.maxSalary));
    document.getElementById('create-req-standard-salary').textContent = known
      ? `Dải lương chuẩn: ${Number(job.minSalary).toLocaleString('vi-VN')} – ${Number(job.maxSalary).toLocaleString('vi-VN')} VND`
      : checked?.status === 'WITHIN_STANDARD_RANGE' ? 'Dải lương đề xuất nằm trong chuẩn chức danh.'
        : checked?.status === 'OUTSIDE_STANDARD_RANGE' ? 'Dải lương đề xuất nằm ngoài chuẩn chức danh.'
          : 'Dải lương sẽ được kiểm tra ở máy chủ khi lưu.';
    document.getElementById('create-req-salary-warning').textContent = outside ? 'Dải lương đề xuất ngoài chuẩn. Bắt buộc nhập giải trình, kể cả khi lưu nháp.' : checked?.message || '';
    document.getElementById('create-req-justification-input').required = Boolean(outside);
    return outside;
  }

  async function refreshRequisitionSalaryCheck() {
    const revision = ++requisitionSalaryCheckRevision;
    const token = sessionStorage.getItem('ats_token');
    const key = requisitionSalaryCheckKey();
    const jobTitleId = createReqJobTitleSelect?.value || '';
    const min = document.getElementById('create-req-salary-min-input').value;
    const max = document.getElementById('create-req-salary-max-input').value;
    requisitionSalaryCheck = { key: null, status: null, message: '' };
    updateRequisitionSalaryHint();
    if (!token || !jobTitleId || min === '' || max === '' || !Number.isFinite(Number(min)) || !Number.isFinite(Number(max)) || Number(min) < 0 || Number(max) < Number(min)) return null;
    try {
      const result = await window.ATS_API.getRequisitionOptionsApi(token, { jobTitleId, proposedSalaryMin: min, proposedSalaryMax: max });
      // Ignore responses from an older input or a previous session/modal.
      if (revision !== requisitionSalaryCheckRevision || key !== requisitionSalaryCheckKey() || token !== sessionStorage.getItem('ats_token')) return null;
      const status = result.ok && ['WITHIN_STANDARD_RANGE', 'OUTSIDE_STANDARD_RANGE'].includes(result.data?.salaryRangeStatus) ? result.data.salaryRangeStatus : null;
      requisitionSalaryCheck = { key, status, message: !result.ok ? result.data?.message || 'Chưa kiểm tra được dải lương. Máy chủ sẽ kiểm tra khi lưu.' : '' };
      updateRequisitionSalaryHint();
      return status;
    } catch {
      return null; // Save still goes through authoritative backend validation.
    }
  }
  for (const id of ['create-req-job-title-input', 'create-req-salary-min-input', 'create-req-salary-max-input']) {
    const node = document.getElementById(id); if (node) node.addEventListener('input', refreshRequisitionSalaryCheck);
  }

  async function openCreateReqModal(request = null) {
    if (!createReqModal) return;
    const optionsRevision = ++requisitionOptionsRevision;
    editingS210Requisition = request?.formVersion === 'S2-10' ? request : null;
    requisitionJobTitles = [];
    requisitionSalaryCheck = { key: null, status: null, message: '' };
    requisitionSalaryCheckRevision++;
    if (createReqForm) createReqForm.reset();
    document.getElementById('create-req-needed-date-input').min = requisitionBusinessDate();
    document.getElementById('create-req-state').textContent = editingS210Requisition ? `${editingS210Requisition.code} — ${editingS210Requisition.status === 'DRAFT' ? 'Nháp' : editingS210Requisition.status}` : 'Yêu cầu mới';
    if (createReqAlert) createReqAlert.classList.add('hidden');

    // Populate Recruiters list
    const token = sessionStorage.getItem('ats_token');
    const isCurrentSession = () => optionsRevision === requisitionOptionsRevision && token === sessionStorage.getItem('ats_token');
    if (token && createReqDepartmentSelect) {
      try {
        const departmentsRes = await window.ATS_API.getRequisitionOptionsApi(token);
        if (!isCurrentSession()) return;

        if (departmentsRes.ok && departmentsRes.data && departmentsRes.data.success) {
          const tree = departmentsRes.data.tree || [];
          requisitionJobTitles = departmentsRes.data.jobTitles || [];
          if (createReqJobTitleSelect) createReqJobTitleSelect.innerHTML = '<option value="">-- Chọn chức danh --</option>' + requisitionJobTitles.map(job => `<option value="${escapeDepartmentHtml(job.id)}">${escapeDepartmentHtml(job.code)} — ${escapeDepartmentHtml(job.name)}${job.level ? ' (' + escapeDepartmentHtml(job.level) + ')' : ''}</option>`).join('');

          const renderDepartmentOptions = (nodes, depth = 0) =>
            nodes.map(department => {
              const prefix = depth > 0 ? '— '.repeat(depth) : '';
              const option = department.status === 'ACTIVE'
                ? `<option value="${escapeDepartmentHtml(department.id)}">${prefix}${escapeDepartmentHtml(department.name)}</option>`
                : '';

              return option +
                renderDepartmentOptions(department.children || [], depth + 1);
            }).join('');

          createReqDepartmentSelect.innerHTML =
            `<option value="">-- Chọn phòng ban --</option>` +
            renderDepartmentOptions(departmentsRes.data.s210Departments || tree);
        }
      } catch {
        if (!isCurrentSession()) return;
        createReqDepartmentSelect.innerHTML =
          `<option value="">-- Không tải được phòng ban --</option>`;
      }
    }
    if (token && createReqRecruiterSelect) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (!isCurrentSession()) return;
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          createReqRecruiterSelect.innerHTML = `<option value="">-- Chưa chỉ định --</option>` +
            recruiters.map(r => `<option value="${r.id}">${r.fullName || r.email} (${r.email})</option>`).join('');
        }
      } catch {
        // Fallback
      }
    }

    if (token && createReqWorkLocationSelect && createReqWorkModeSelect) {
      try {
        const [locationRes, modeRes] = await Promise.all([
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_LOCATION',
            status: 'ACTIVE'
          }),
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_MODE',
            status: 'ACTIVE'
          })
        ]);
        if (!isCurrentSession()) return;

        const locations =
          locationRes.ok && locationRes.data && locationRes.data.success
            ? locationRes.data.items || []
            : [];

        const modes =
          modeRes.ok && modeRes.data && modeRes.data.success
            ? modeRes.data.items || []
            : [];

        createReqWorkLocationSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          locations.map(item =>
            `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
          ).join('');

        createReqWorkModeSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          modes.map(item =>
            `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
          ).join('');
      } catch {
        if (!isCurrentSession()) return;
        createReqWorkLocationSelect.innerHTML =
          '<option value="">-- Không tải được địa điểm --</option>';

        createReqWorkModeSelect.innerHTML =
          '<option value="">-- Không tải được hình thức --</option>';
      }
    }

    if (editingS210Requisition) {
      const req = editingS210Requisition;
      const mapping = { 'create-req-title-input': 'title', 'create-req-job-title-input': 'jobTitleId', 'create-req-dept-input': 'departmentId',
        'create-req-headcount-input': 'headcount', 'create-req-reason-input': 'recruitmentReason', 'create-req-needed-date-input': 'neededDate',
        'create-req-salary-min-input': 'proposedSalaryMin', 'create-req-salary-max-input': 'proposedSalaryMax', 'create-req-justification-input': 'salaryJustification',
        'create-req-description-input': 'jobDescription', 'create-req-requirements-input': 'candidateRequirements',
        'create-req-work-location-select': 'workLocationId', 'create-req-work-mode-select': 'workModeId', 'create-req-recruiter-select': 'recruiterId' };
      const savedLabels = { jobTitleId: 'Chức danh đã lưu', departmentId: req.departmentName,
        recruiterId: req.recruiterName || 'Nhân sự đã lưu', workLocationId: 'Địa điểm đã lưu', workModeId: 'Hình thức đã lưu' };
      for (const [id, key] of Object.entries(mapping)) {
        const node = document.getElementById(id);
        const value = req[key] ?? '';
        // A read-only or inactive reference may be absent from the current choices.
        // Keep the stored selection rather than silently clearing it on a draft save.
        if (node.tagName === 'SELECT' && value && Object.hasOwn(savedLabels, key) && !Array.from(node.options).some(option => option.value === value)) {
          node.innerHTML += `<option value="${escapeDepartmentHtml(value)}">${escapeDepartmentHtml(savedLabels[key] || value)}</option>`;
        }
        node.value = value;
      }
    }
    let editable = !editingS210Requisition;
    if (editingS210Requisition?.status === 'DRAFT') {
      const permissions = await window.ATS_API.getPermissionsApi(token);
      if (!isCurrentSession()) return;
      editable = permissions.ok && (permissions.data?.permissions || []).includes('requisition.draft.edit');
    }
    if (!isCurrentSession()) return;
    createReqForm.querySelectorAll('input, select, textarea').forEach(node => { node.disabled = !editable; });
    document.getElementById('create-req-legacy-dept-input').disabled = true;
    if (saveCreateReqDraftBtn) saveCreateReqDraftBtn.classList.toggle('hidden', !editable);
    document.getElementById('submit-create-req-btn').classList.toggle('hidden', !editable);
    updateRequisitionSalaryHint();
    createReqModal.classList.remove('hidden');
    await refreshRequisitionSalaryCheck();
  }

  if (openCreateReqModalBtn) openCreateReqModalBtn.addEventListener('click', openCreateReqModal);
  if (closeCreateReqModal) closeCreateReqModal.addEventListener('click', () => createReqModal.classList.add('hidden'));
  if (cancelCreateReqBtn) cancelCreateReqBtn.addEventListener('click', () => createReqModal.classList.add('hidden'));

  async function saveRequisitionForm(status) {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const title = document.getElementById('create-req-title-input').value.trim();
      const departmentId = createReqDepartmentSelect
        ? createReqDepartmentSelect.value
        : '';
      const headcountInput = document.getElementById('create-req-headcount-input').value;
      const headcount = headcountInput === '' ? null : Number(headcountInput);
      const recruiterId = createReqRecruiterSelect ? createReqRecruiterSelect.value : null;
      const workLocationId = createReqWorkLocationSelect
        ? createReqWorkLocationSelect.value
        : null;
      const workModeId = createReqWorkModeSelect
        ? createReqWorkModeSelect.value
        : null;

      try {
        const read = id => document.getElementById(id).value;
        const min = read('create-req-salary-min-input'), max = read('create-req-salary-max-input');
        const payload = {
          formVersion: 'S2-10', status,
          title,
          departmentId,
          jobTitleId: createReqJobTitleSelect?.value || null,
          headcount,
          recruitmentReason: read('create-req-reason-input') || null,
          proposedSalaryMin: min === '' ? null : Number(min), proposedSalaryMax: max === '' ? null : Number(max),
          neededDate: read('create-req-needed-date-input') || null,
          jobDescription: read('create-req-description-input'), candidateRequirements: read('create-req-requirements-input'),
          salaryJustification: read('create-req-justification-input'),
          recruiterId: recruiterId || null,
          workLocationId: workLocationId || null,
          workModeId: workModeId || null
        };
        if (headcount !== null && (!Number.isSafeInteger(headcount) || headcount <= 0)) throw new Error('Số lượng cần tuyển phải là số nguyên lớn hơn 0.');
        for (const salary of [payload.proposedSalaryMin, payload.proposedSalaryMax]) {
          if (salary !== null && (!Number.isFinite(salary) || salary < 0)) throw new Error('Lương đề xuất phải là số hợp lệ, không âm.');
        }
        if (min !== '' && max !== '' && payload.proposedSalaryMin > payload.proposedSalaryMax) throw new Error('Lương tối thiểu không được lớn hơn lương tối đa.');
        if (payload.neededDate && payload.neededDate < requisitionBusinessDate()) throw new Error('Ngày cần người không được ở quá khứ.');
        await refreshRequisitionSalaryCheck();
        if (updateRequisitionSalaryHint() && !payload.salaryJustification.trim()) throw new Error('Dải lương ngoài chuẩn bắt buộc nhập giải trình.');
        if (status !== 'DRAFT' && ['jobTitleId', 'departmentId', 'headcount', 'recruitmentReason', 'proposedSalaryMin', 'proposedSalaryMax', 'neededDate', 'jobDescription', 'candidateRequirements'].some(key => payload[key] === null || payload[key] === '' || (typeof payload[key] === 'string' && !payload[key].trim()))) throw new Error('Vui lòng nhập đầy đủ thông tin bắt buộc trước khi hoàn tất.');
        const res = editingS210Requisition
          ? await window.ATS_API.updateRequisitionApi(token, editingS210Requisition.id, payload)
          : await window.ATS_API.createRequisition(token, payload);

        if (res.ok && res.data && res.data.success) {
          createReqModal.classList.add('hidden');
          showToast('success', status === 'DRAFT' ? 'Đã lưu nháp' : 'Đã hoàn tất', status === 'DRAFT' ? 'Có thể mở nháp từ danh sách để tiếp tục chỉnh sửa.' : 'Yêu cầu đã chuyển sang trạng thái mở tuyển dụng.');
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
  }
  if (createReqForm) {
    createReqForm.addEventListener('submit', e => { e.preventDefault(); return saveRequisitionForm('OPEN'); });
  }
  if (saveCreateReqDraftBtn) saveCreateReqDraftBtn.addEventListener('click', () => saveRequisitionForm('DRAFT'));

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
  const createCandidateSourceSelect = document.getElementById('create-cand-source-select');

  if (openCreateCandidateModalBtn) {
    openCreateCandidateModalBtn.addEventListener('click', async () => {
      if (createCandidateModal) createCandidateModal.classList.remove('hidden');
      if (createCandidateForm) createCandidateForm.reset();
      if (createCandidateAlert) createCandidateAlert.classList.add('hidden');

      const reqSelect = document.getElementById('create-cand-req-select');
      if (reqSelect) {
        reqSelect.innerHTML = `<option value="">-- Chọn vị trí tuyển dụng --</option>` +
          currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
      }

      const token = sessionStorage.getItem('ats_token');

      if (token && createCandidateSourceSelect) {
        try {
          const sourceRes = await window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'CANDIDATE_SOURCE',
            status: 'ACTIVE'
          });

          const sources =
            sourceRes.ok && sourceRes.data && sourceRes.data.success
              ? sourceRes.data.items || []
              : [];

          createCandidateSourceSelect.innerHTML =
            '<option value="">-- Chưa xác định --</option>' +
            sources.map(item =>
              `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
            ).join('');
        } catch {
          createCandidateSourceSelect.innerHTML =
            '<option value="">-- Không tải được nguồn ứng viên --</option>';
        }
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
      const sourceId = createCandidateSourceSelect ? createCandidateSourceSelect.value : null;

      try {
        const res = await window.ATS_API.createCandidateApi(token, {
          fullName, email, phoneNumber, requisitionId, stage, rating, experienceYears, expectedSalary, notes, sourceId: sourceId || null
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
  const candDetailSource = document.getElementById('cand-detail-source');
  const candDetailRejectionReasonGroup = document.getElementById('cand-detail-rejection-reason-group');
  const candDetailRejectionReasonSelect = document.getElementById('cand-detail-rejection-reason-select');
  let canEditCandidateRejectionReason = false;

  async function openCandidateDetails(id) {
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
    if (codeEl) codeEl.textContent = formatCandCode(c);
    if (reqTitleEl) reqTitleEl.textContent = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
    if (emailEl) emailEl.textContent = c.email || '—';
    if (phoneEl) phoneEl.textContent = c.phoneNumber || c.phone || 'Chưa cập nhật';
    if (candDetailSource) {
      candDetailSource.textContent =
        c.sourceName || c.source_name || 'Chưa xác định';
    }
    if (stageBadge) {
      stageBadge.className = `badge ${STAGE_BADGES[c.stage] || 'badge-neutral'}`;
      stageBadge.textContent = STAGE_LABELS[c.stage] || c.stage;
    }
    if (idInput) idInput.value = c.id;
    if (stageSelect) stageSelect.value = c.stage;
    if (ratingEl) ratingEl.textContent = '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));

    canEditCandidateRejectionReason = false;
    if (candDetailRejectionReasonSelect) candDetailRejectionReasonSelect.disabled = true;
    if (candDetailRejectionReasonGroup) {
      candDetailRejectionReasonGroup.classList.toggle(
        'hidden',
        true
      );
    }

    if (candDetailRejectionReasonSelect) {
      const token = sessionStorage.getItem('ats_token');

      candDetailRejectionReasonSelect.innerHTML =
        '<option value="">-- Chưa xác định --</option>';

      if (token) {
        try {
          const [permissionsRes, reasonRes] = await Promise.all([
            window.ATS_API.getPermissionsApi(token),
            window.ATS_API.getRecruitmentCatalogsApi(token, { type: 'REJECTION_REASON' })
          ]);
          canEditCandidateRejectionReason = permissionsRes.ok && Array.isArray(permissionsRes.data?.permissions) && permissionsRes.data.permissions.includes('candidate.update');
          candDetailRejectionReasonSelect.disabled = !canEditCandidateRejectionReason;
          if (candDetailRejectionReasonGroup) candDetailRejectionReasonGroup.classList.toggle('hidden', !canEditCandidateRejectionReason || c.stage !== 'REJECTED');

          const reasons =
            reasonRes.ok &&
            reasonRes.data &&
            reasonRes.data.success
              ? reasonRes.data.items || []
              : [];

          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Chưa xác định --</option>' +
            reasons.map(item => {
              const selected =
                item.id === c.rejectionReasonId
                  ? 'selected'
                  : '';

              const disabled =
                item.status !== 'ACTIVE' &&
                item.id !== c.rejectionReasonId
                  ? 'disabled'
                  : '';

              const suffix =
                item.status === 'ACTIVE'
                  ? ''
                  : ' (Ngừng áp dụng)';

              return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
            }).join('');
        } catch {
          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Không tải được lý do loại --</option>';
        }
      }
    }
    if (candidateDetailModal) candidateDetailModal.classList.remove('hidden');
  }

  const candDetailStageSelect =
    document.getElementById('cand-detail-change-stage-select');

  if (candDetailStageSelect) {
    candDetailStageSelect.addEventListener('change', () => {
      if (candDetailRejectionReasonGroup) {
        candDetailRejectionReasonGroup.classList.toggle(
          'hidden',
          !canEditCandidateRejectionReason || candDetailStageSelect.value !== 'REJECTED'
        );
      }

      if (
        candDetailStageSelect.value !== 'REJECTED' &&
        candDetailRejectionReasonSelect
      ) {
        candDetailRejectionReasonSelect.value = '';
      }
    });
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
      const rejectionReasonId =
        canEditCandidateRejectionReason && stage === 'REJECTED' && candDetailRejectionReasonSelect
          ? candDetailRejectionReasonSelect.value || null
          : null;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateCandidateStageApi(
          token,
          id,
          stage,
          undefined,
          rejectionReasonId || undefined
        );
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
            ${c.fullName || c.full_name} (${formatCandCode(c)}) - ${c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí'}
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
            ${c.fullName || c.full_name} (${formatCandCode(c)}) - ${c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí'}
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
  const reqDetailWorkLocationSelect = document.getElementById('req-detail-work-location-select');
  const reqDetailWorkModeSelect = document.getElementById('req-detail-work-mode-select');

  async function openRequisitionDetails(id) {
    if (!reqDetailModal) return;
    const req = currentRequisitionsList.find(r => r.id === id);
    if (!req) return;
    if (req.formVersion === 'S2-10') {
      const result = await window.ATS_API.getRequisitionByIdApi(sessionStorage.getItem('ats_token'), id);
      if (result.ok && result.data?.success) await openCreateReqModal(result.data.data);
      else showToast('error', 'Không thể đọc yêu cầu', result.data?.message || 'Không thể tải yêu cầu tuyển dụng.');
      return;
    }

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

    if (token && reqDetailWorkLocationSelect && reqDetailWorkModeSelect) {
      try {
        const [locationRes, modeRes] = await Promise.all([
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_LOCATION'
          }),
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_MODE'
          })
        ]);

        const locations =
          locationRes.ok && locationRes.data && locationRes.data.success
            ? locationRes.data.items || []
            : [];

        const modes =
          modeRes.ok && modeRes.data && modeRes.data.success
            ? modeRes.data.items || []
            : [];

        reqDetailWorkLocationSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          locations.map(item => {
            const selected =
              item.id === req.workLocationId ? 'selected' : '';

            const disabled =
              item.status !== 'ACTIVE' &&
              item.id !== req.workLocationId
                ? 'disabled'
                : '';

            const suffix =
              item.status === 'ACTIVE'
                ? ''
                : ' (Ngừng áp dụng)';

            return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
          }).join('');

        reqDetailWorkModeSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          modes.map(item => {
            const selected =
              item.id === req.workModeId ? 'selected' : '';

            const disabled =
              item.status !== 'ACTIVE' &&
              item.id !== req.workModeId
                ? 'disabled'
                : '';

            const suffix =
              item.status === 'ACTIVE'
                ? ''
                : ' (Ngừng áp dụng)';

            return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
          }).join('');
      } catch {
        reqDetailWorkLocationSelect.innerHTML =
          '<option value="">-- Không tải được địa điểm --</option>';

        reqDetailWorkModeSelect.innerHTML =
          '<option value="">-- Không tải được hình thức --</option>';
      }
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
      const workLocationId = reqDetailWorkLocationSelect
        ? reqDetailWorkLocationSelect.value
        : null;
      const workModeId = reqDetailWorkModeSelect
        ? reqDetailWorkModeSelect.value
        : null;

      try {
        const res = await window.ATS_API.updateRequisitionApi(token, id, {
          title,
          departmentName,
          headcount,
          status,
          recruiterId,
          workLocationId: workLocationId || null,
          workModeId: workModeId || null
        });
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

  async function loadPublicCareerPage() {
    const container = document.getElementById('public-career-page-content');
    if (!container) return;

    try {
      const res = await window.ATS_API.getPublicCareerPageApi();

      if (!res.ok || !res.data || !res.data.success) {
        container.innerHTML = '';
        return;
      }

      const data = res.data.data || {};

      renderCareerPagePublicContent(container, {
        introduction: data.introduction || '',
        logoUrl: data.logoUrl || null,
        heroImageUrl: data.heroImageUrl || null
      });
    } catch {
      container.innerHTML = '';
    }
  }

  loadPublicCareerPage();
  checkExistingSession();
});

