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
    if (window.ATS_ROUTER) {
      const route = window.ATS_ROUTE_MANIFEST.routes.find(item => item.view === viewName && item.path !== '/');
      if (route) window.ATS_ROUTER.navigate(route.path);
      return;
    }
    activateView(viewName);
  }

  function activateView(viewName) {
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
    window.ATS_MOBILE_NAVIGATION.updateTitle(VIEW_TITLES[viewName] || 'Trang chủ');
    window.ATS_MOBILE_NAVIGATION.updateActions();

    // Close user popover if open
    if (userMenuPopover) userMenuPopover.classList.remove('show');
    userMenuBtn?.setAttribute('aria-expanded', 'false');

    // On mobile, close sidebar on navigation
    window.ATS_MOBILE_NAVIGATION.close();

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
    link.setAttribute('role', 'link');
    link.setAttribute('tabindex', '0');
    link.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const targetView = link.getAttribute('data-view');
        if (targetView) switchView(targetView);
      }
    });
  });

  // Topbar quick action: Create Requisition
  if (topbarCreateReqBtn) {
    topbarCreateReqBtn.addEventListener('click', () => {
      if (window.ATS_MOBILE_NAVIGATION.canCreate()) {
        window.ATS_MOBILE_NAVIGATION.close();
        openCreateReqModal();
      }
    });
  }

  // Profile menu dropdown handlers
  if (userMenuBtn && userMenuPopover) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuPopover.classList.toggle('show');
      userMenuBtn.setAttribute('aria-expanded', String(userMenuPopover.classList.contains('show')));
    });

    document.addEventListener('click', (e) => {
      if (!userMenuPopover.contains(e.target) && e.target !== userMenuBtn) {
        userMenuPopover.classList.remove('show');
        userMenuBtn.setAttribute('aria-expanded', 'false');
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
      userMenuBtn?.setAttribute('aria-expanded', 'false');
      openChangePwdModal();
    });
  }

  // Global Search in Topbar
  const globalSearchInput = document.getElementById('global-search-input');
  if (globalSearchInput) {
    globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = globalSearchInput.value.trim();
        if (!query) return;
        if (currentActiveView === 'requisitions') {
          if (reqSearchInput) reqSearchInput.value = query;
          loadRequisitions();
        } else if (currentActiveView === 'users') {
          if (usersSearchInput) usersSearchInput.value = query;
          usersCurrentPage = 1;
          loadUsers();
        } else if (currentActiveView === 'interviews') {
          if (interviewsSearchInput) interviewsSearchInput.value = query;
          loadInterviews();
        } else if (currentActiveView === 'offers') {
          if (offersSearchInput) offersSearchInput.value = query;
          loadOffers();
        } else {
          if (candidatesSearchInput) candidatesSearchInput.value = query;
          switchView('candidates');
          showToast('info', 'Tìm kiếm', `Đang tìm ứng viên theo từ khóa: "${query}"`);
        }
      }
    });
  }
