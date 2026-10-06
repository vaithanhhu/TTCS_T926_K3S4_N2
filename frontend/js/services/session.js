  // ==============================================================================
  // 4. SESSION LIFECYCLE & LOGOUT
  // ==============================================================================

  let currentAuthenticatedHome = null;

  function getAuthenticatedHome() {
    if (window.ATS_ROUTER?.resolveInternal(currentAuthenticatedHome)?.auth) return currentAuthenticatedHome;
    return currentAuthenticatedUser?.roles?.includes('CANDIDATE') ? '/candidate' : '/dashboard';
  }

  async function setupAuthenticatedSession(user, defaultHome = user.defaultHome) {
    window.ATS_MOBILE_NAVIGATION.close();
    clearJobTitleSalaryState();
    clearRequisitionSalaryState();
    currentAuthenticatedUser = user;
    currentAuthenticatedHome = window.ATS_ROUTER?.resolveInternal(defaultHome)?.auth ? defaultHome : null;
    window.ATS_MOBILE_NAVIGATION.updateActions();

    // Hide Login, Show App Shell
    if (loginView) loginView.classList.add('hidden');

    // Update User Display in Topbar & Sidebar
    const fullName = user.fullName || 'Người dùng';
    const email = user.email || '';
    const initial = fullName.charAt(0).toUpperCase();
    const primaryRole = (user.roles && user.roles.length > 0) ? user.roles[0] : 'USER';
    const friendlyRole = ROLE_LABELS[primaryRole] || primaryRole;

    if (topbarUserName) topbarUserName.textContent = fullName;
    renderUserAvatar(topbarUserAvatar, user, fullName);
    if (popoverUserName) popoverUserName.textContent = fullName;
    if (popoverUserEmail) popoverUserEmail.textContent = email;

    if (sidebarUserName) sidebarUserName.textContent = fullName;
    if (sidebarUserRole) sidebarUserRole.textContent = friendlyRole;
    renderUserAvatar(sidebarUserAvatar, user, fullName);

    const userDisplayName = document.getElementById('user-display-name');
    if (userDisplayName) userDisplayName.textContent = fullName;

    // Filter Navigation Menu by Real Roles & Permissions (S1-06 AC-01 & AC-02)
    const token = sessionStorage.getItem('ats_token');
    currentAllowedPaths = new Set();
    if (token) await filterNavigationMenu(token);
    if (token !== sessionStorage.getItem('ats_token') || currentAuthenticatedUser !== user) return;

    // Start Session Heartbeat Auto-Renew
    startSessionHeartbeat();

    // The router honors the backend home while retaining a pending authenticated deep link.
    if (window.ATS_ROUTER) {
      window.ATS_ROUTER.refresh();
    } else if (user.roles && user.roles.includes('CANDIDATE')) {
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
        if (token !== sessionStorage.getItem('ats_token')) return;
        const allowedPaths = res.data.menuItems.map(m => m.path);
        currentAllowedPaths = new Set(allowedPaths);
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
        if (token !== sessionStorage.getItem('ats_token')) return;
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
    window.ATS_MOBILE_NAVIGATION.close();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    sessionStorage.removeItem('ats_token');
    sessionStorage.removeItem('ats_user');
    sessionStorage.removeItem('ats_expires_at');
    currentAuthenticatedUser = null;
    currentAuthenticatedHome = null;
    window.ATS_MOBILE_NAVIGATION.updateActions();
    currentAllowedPaths = new Set();
    if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/login', { replace: true });

    if (appShell) appShell.classList.add('hidden');
    if (loginView) loginView.classList.remove('hidden');

    showAlert('warning', 'Phiên làm việc hết hạn', 'Phiên đăng nhập của bạn đã hết hạn do không hoạt động. Vui lòng đăng nhập lại để tiếp tục công việc.');
  }

  // Logout Implementation (Required by S1-07 tests: performLogout)
  async function performLogout(showToastMsg = true) {
    window.ATS_MOBILE_NAVIGATION.close();
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
    currentAuthenticatedHome = null;
    window.ATS_MOBILE_NAVIGATION.updateActions();
    currentAllowedPaths = new Set();
    if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/login', { replace: true });

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
      if (token !== sessionStorage.getItem('ats_token')) return;
      if (res.ok && res.data && res.data.success) {
        await setupAuthenticatedSession(res.data.data.user);
      } else {
        sessionStorage.clear();
      }
    } catch {
      sessionStorage.clear();
    }
  }
