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
    'approval-configurations': document.getElementById('approval-configurations-view'),
    'headcount-budgets':document.getElementById('headcount-budgets-view'),
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
    error: document.getElementById('error-view'),
    'change-password': document.getElementById('change-password-view')
  };

  // Toast Container
  const toastContainer = document.getElementById('toast-container');

  // Application State
  let currentAuthenticatedUser = null;
  let currentAllowedPaths = new Set();
  let currentActiveView = 'dashboard';
  let heartbeatTimer = null;
  let auditDebounceTimer = null;
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
