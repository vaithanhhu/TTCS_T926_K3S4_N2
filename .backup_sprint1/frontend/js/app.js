document.addEventListener('DOMContentLoaded', () => {
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

  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const userDisplayName = document.getElementById('user-display-name');
  const userDisplayEmail = document.getElementById('user-display-email');
  const userDisplayTitle = document.getElementById('user-display-title');
  const userDisplayDept = document.getElementById('user-display-dept');
  const userDisplayRoles = document.getElementById('user-display-roles');
  const userDisplayHome = document.getElementById('user-display-home');
  const roleWorkspacePreview = document.getElementById('role-workspace-preview');
  const logoutBtn = document.getElementById('logout-btn');
  let currentAuthenticatedUser = null;

  const ROLE_DESCRIPTIONS = {
    'ADMIN': 'Toàn quyền quản trị hệ thống, quản lý tài khoản, danh mục phân quyền và giám sát audit logs.',
    'HR_MANAGER': 'Chủ sở hữu hoạt động tuyển dụng toàn diện, giám sát các vị trí, phân công recruiter và ngân sách.',
    'RECRUITER': 'Vận hành tuyển dụng hằng ngày, quản lý pipeline ứng viên, đặt lịch phỏng vấn và soạn thảo offer.',
    'HIRING_MGR': 'Trưởng bộ phận cần tuyển, tạo yêu cầu tuyển dụng, theo dõi ứng viên của vị trí phụ trách.',
    'INTERVIEWER': 'Thành viên hội đồng phỏng vấn, xem lịch phỏng vấn, hồ sơ ứng viên và chấm phiếu đánh giá năng lực.',
    'APPROVER': 'Ban Giám Đốc hoặc cấp duyệt phê duyệt yêu cầu tuyển dụng và offer vượt khung ngân sách.',
    'CANDIDATE': 'Cổng ứng viên bên ngoài: nộp hồ sơ, theo dõi tiến độ xét duyệt, xác nhận lịch phỏng vấn.'
  };

  // 1. Toggle Password Visibility
  togglePwdBtn.addEventListener('click', () => {
    const isPassword = passwordInput.getAttribute('type') === 'password';
    passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
    eyeIcon.innerHTML = isPassword
      ? `<path d="m9.88 9.88-6.84 6.84M2 12s3-7 10-7a9.7 9.7 0 0 1 5.09 1.45M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.46-1.68M15 15a3 3 0 1 1-4.24-4.24M2 2l20 20"/>`
      : `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>`;
  });

  // 2. Alert helpers
  function showAlert(type, title, message) {
    alertBox.className = `alert-box alert-${type}`;
    alertIcon.textContent = type === 'danger' ? '⛔' : type === 'warning' ? '🔒' : '✓';
    alertTitle.textContent = title;
    alertMessage.textContent = message;
    alertBox.classList.remove('hidden');
  }

  function hideAlert() {
    alertBox.classList.add('hidden');
  }

  // Check if opened via file:// protocol
  if (window.location.protocol === 'file:') {
    showAlert(
      'warning',
      '⚠️ Mở qua file:// cục bộ',
      'Bạn đang mở file trực tiếp trong máy tính thay vì qua web server. Trình duyệt sẽ chặn kết nối API từ file://. Vui lòng mở trình duyệt và truy cập đúng địa chỉ: http://localhost:5050'
    );
  }

  // 3. Clear errors on input
  emailInput.addEventListener('input', () => {
    emailInput.classList.remove('is-invalid');
    emailError.textContent = '';
    hideAlert();
  });

  passwordInput.addEventListener('input', () => {
    passwordInput.classList.remove('is-invalid');
    passwordError.textContent = '';
    hideAlert();
  });

  // 4. Role Quick Fill Chips (S1-01 Test Helper)
  document.querySelectorAll('.role-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const email = chip.getAttribute('data-email');
      emailInput.value = email;
      passwordInput.value = 'Ats@123456';
      emailInput.classList.remove('is-invalid');
      passwordInput.classList.remove('is-invalid');
      emailError.textContent = '';
      passwordError.textContent = '';
      hideAlert();
      submitBtn.focus();
    });
  });

  // 5. Test Trigger: Wrong Email (AC-02)
  document.getElementById('trigger-wrong-email-btn').addEventListener('click', () => {
    emailInput.value = 'user_khong_ton_tai_' + Math.floor(Math.random() * 1000) + '@company.com';
    passwordInput.value = 'Ats@123456';
    loginForm.dispatchEvent(new Event('submit'));
  });

  // 6. Test Trigger: Lock Account after 5 wrong attempts (AC-03)
  document.getElementById('trigger-lock-btn').addEventListener('click', async () => {
    const targetEmail = 'recruiter2@company.com';
    emailInput.value = targetEmail;
    passwordInput.value = 'SaiMatKhau123';

    showAlert('warning', 'Đang thực hiện kiểm thử', 'Gửi liên tiếp 5 lần đăng nhập sai để kiểm tra AC-03...');
    setLoading(true);

    for (let i = 1; i <= 5; i++) {
      const res = await window.ATS_API.loginApi(targetEmail, `SaiMatKhau_${i}`);
      if (res.status === 423) {
        setLoading(false);
        showAlert(
          'warning',
          'Tài khoản đã bị khóa tạm thời (AC-03)',
          res.data.message || 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.'
        );
        return;
      }
    }
    setLoading(false);
  });

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    if (isLoading) {
      btnText.textContent = 'Đang xác thực...';
      btnSpinner.classList.remove('hidden');
    } else {
      btnText.textContent = 'Đăng nhập';
      btnSpinner.classList.add('hidden');
    }
  }

  // 7. Form Submission Handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    let hasError = false;
    if (!email) {
      emailInput.classList.add('is-invalid');
      emailError.textContent = 'Vui lòng nhập email công ty.';
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.classList.add('is-invalid');
      emailError.textContent = 'Định dạng email không hợp lệ.';
      hasError = true;
    }

    if (!password) {
      passwordInput.classList.add('is-invalid');
      passwordError.textContent = 'Vui lòng nhập mật khẩu.';
      hasError = true;
    }

    if (hasError) return;

    setLoading(true);

    try {
      const res = await window.ATS_API.loginApi(email, password);
      setLoading(false);

      if (res.ok && res.data.success) {
        // Successful login (AC-01)
        const user = res.data.data.user;
        const token = res.data.data.token;

        sessionStorage.setItem('ats_token', token);
        sessionStorage.setItem('ats_user', JSON.stringify(user));
        if (res.data.data.expiresAt) {
          sessionStorage.setItem('ats_expires_at', res.data.data.expiresAt);
        }

        renderDashboard(user);
      } else if (res.status === 423) {
        // Locked temporarily (AC-03)
        showAlert(
          'warning',
          'Khóa tạm thời 15 phút (AC-03)',
          res.data.message || 'Tài khoản tạm thời bị khóa 15 phút do nhập sai 5 lần liên tiếp. Vui lòng thử lại sau.'
        );
      } else {
        // Generic failure (AC-02: generic message, no leak)
        showAlert(
          'danger',
          'Đăng nhập thất bại',
          res.data.message || 'Email hoặc mật khẩu không chính xác.'
        );
      }
    } catch (err) {
      setLoading(false);
      showAlert('danger', 'Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  });

  // 8. Render Post-Login Role Landing Page (AC-01)
  function renderDashboard(user) {
    currentAuthenticatedUser = user;
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');

    userDisplayName.textContent = user.fullName || 'Người dùng';
    userDisplayEmail.textContent = user.email;
    userDisplayTitle.textContent = user.jobTitle || 'Chuyên viên nghiệp vụ';
    userDisplayDept.textContent = user.departmentName || 'Hệ thống Nội bộ';
    userDisplayHome.textContent = user.defaultHome || '/dashboard';

    userDisplayRoles.innerHTML = '';
    (user.roles || []).forEach(r => {
      const badge = document.createElement('span');
      badge.className = 'badge badge-role';
      badge.textContent = r;
      userDisplayRoles.appendChild(badge);
    });

    const primaryRole = (user.roles && user.roles[0]) || 'DEFAULT';
    const roleDesc = ROLE_DESCRIPTIONS[primaryRole] || 'Quyền truy cập tiêu chuẩn hệ thống tuyển dụng.';

    // S1-05: Render permissions loaded dynamically from DB
    const userDisplayPerms = document.getElementById('user-display-perms');
    const userPermsCount = document.getElementById('user-perms-count');
    if (userDisplayPerms && userPermsCount) {
      userDisplayPerms.innerHTML = '';
      const perms = user.permissions || [];
      userPermsCount.textContent = `${perms.length} quyền nghiệp vụ`;
      perms.forEach(p => {
        const badge = document.createElement('span');
        badge.className = 'badge badge-primary';
        badge.style.fontSize = '11px';
        badge.textContent = p;
        userDisplayPerms.appendChild(badge);
      });
    }

    roleWorkspacePreview.innerHTML = `
      <p><strong>Không gian làm việc:</strong> Hệ thống đã điều hướng phiên làm việc của bạn vào <code>${user.defaultHome}</code>.</p>
      <p style="margin-top: 6px;"><strong>Mô tả nhiệm vụ vai trò:</strong> ${roleDesc}</p>
    `;

    // S1-06: Display Navbar & Setup User info in Navbar & Drawer
    const appNavbar = document.getElementById('app-navbar');
    const navUserAvatar = document.getElementById('nav-user-avatar');
    const navUserName = document.getElementById('nav-user-name');
    const navUserRole = document.getElementById('nav-user-role');
    const drawerUserName = document.getElementById('drawer-user-name');
    const drawerUserEmail = document.getElementById('drawer-user-email');
    const drawerUserRole = document.getElementById('drawer-user-role');

    if (appNavbar) appNavbar.classList.remove('hidden');
    if (navUserAvatar) navUserAvatar.textContent = (user.fullName || 'U').charAt(0).toUpperCase();
    if (navUserName) navUserName.textContent = user.fullName || user.email;
    if (navUserRole) navUserRole.textContent = primaryRole;
    if (drawerUserName) drawerUserName.textContent = user.fullName || 'Người dùng';
    if (drawerUserEmail) drawerUserEmail.textContent = user.email;
    if (drawerUserRole) drawerUserRole.textContent = primaryRole;

    const token = sessionStorage.getItem('ats_token');
    if (token) {
      loadRoleBasedNavigation(token);
    }

    // S1-02: Format expiry time
    const sessionExpiryEl = document.getElementById('session-expiry-time');
    const storedExpiry = sessionStorage.getItem('ats_expires_at');
    if (sessionExpiryEl && storedExpiry) {
      sessionExpiryEl.textContent = new Date(storedExpiry).toLocaleTimeString('vi-VN');
    }

    startSessionHeartbeat();
  }

  // S1-02 AC-01: Heartbeat to auto-renew session periodically while active
  let heartbeatTimer = null;
  function startSessionHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;
      const res = await window.ATS_API.getMeApi(token);
      if (res.ok && res.data.success) {
        sessionStorage.setItem('ats_expires_at', res.data.data.expiresAt);
        const sessionExpiryEl = document.getElementById('session-expiry-time');
        if (sessionExpiryEl) {
          sessionExpiryEl.textContent = new Date(res.data.data.expiresAt).toLocaleTimeString('vi-VN');
        }
      } else if (res.data.code === 'SESSION_EXPIRED') {
        handleExpiredSession();
      }
    }, 60000); // Check and auto-renew every 60 seconds
  }

  // S1-02 AC-03: Handle Expired Session - return to login with clear message
  function handleExpiredSession(customMsg) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    sessionStorage.removeItem('ats_token');
    sessionStorage.removeItem('ats_user');
    sessionStorage.removeItem('ats_expires_at');
    dashboardView.classList.add('hidden');
    loginView.classList.remove('hidden');

    const appNavbar = document.getElementById('app-navbar');
    const mobileDrawer = document.getElementById('mobile-nav-drawer');
    if (appNavbar) appNavbar.classList.add('hidden');
    if (mobileDrawer) mobileDrawer.classList.add('hidden');

    showAlert(
      'warning',
      'Phiên đăng nhập hết hạn (AC-03)',
      customMsg || 'Phiên đăng nhập của bạn đã hết hạn do không hoạt động. Vui lòng đăng nhập lại.'
    );
  }

  // S1-02 AC-01: Test Button for Auto-Renewal
  const renewBtn = document.getElementById('renew-session-btn');
  if (renewBtn) {
    renewBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;
      renewBtn.disabled = true;
      const res = await window.ATS_API.getMeApi(token);
      renewBtn.disabled = false;
      if (res.ok && res.data.success) {
        const newExpiry = res.data.data.expiresAt;
        sessionStorage.setItem('ats_expires_at', newExpiry);
        const sessionExpiryEl = document.getElementById('session-expiry-time');
        if (sessionExpiryEl) {
          sessionExpiryEl.textContent = new Date(newExpiry).toLocaleTimeString('vi-VN');
        }
        alert('Phiên đã được gia hạn tự động thành công (AC-01).\nThời hạn mới: ' + new Date(newExpiry).toLocaleTimeString('vi-VN'));
      }
    });
  }

  // S1-02 AC-03: Test Button to Simulate Session Expiration
  const simulateExpiredBtn = document.getElementById('simulate-expired-btn');
  if (simulateExpiredBtn) {
    simulateExpiredBtn.addEventListener('click', () => {
      handleExpiredSession('Mô phỏng phiên hết hạn: Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để tiếp tục (AC-03).');
    });
  }

  // S1-02 AC-02: Logout with Server-Side Session Revocation
  async function performLogout() {
    const token = sessionStorage.getItem('ats_token');
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    if (token) {
      await window.ATS_API.logoutApi(token);
    }

    sessionStorage.removeItem('ats_token');
    sessionStorage.removeItem('ats_user');
    sessionStorage.removeItem('ats_expires_at');
    passwordInput.value = '';
    dashboardView.classList.add('hidden');
    loginView.classList.remove('hidden');

    const appNavbar = document.getElementById('app-navbar');
    const mobileDrawer = document.getElementById('mobile-nav-drawer');
    if (appNavbar) appNavbar.classList.add('hidden');
    if (mobileDrawer) mobileDrawer.classList.add('hidden');

    showAlert('success', 'Đăng xuất thành công (AC-02)', 'Phiên làm việc đã bị thu hồi hoàn toàn phía server.');
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', performLogout);
  }

  const drawerLogoutBtn = document.getElementById('drawer-logout-btn');
  if (drawerLogoutBtn) {
    drawerLogoutBtn.addEventListener('click', performLogout);
  }

  // S1-06: Mobile Navigation Drawer Toggle Handlers (AC-03)
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const closeDrawerBtn = document.getElementById('close-drawer-btn');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const mobileNavDrawer = document.getElementById('mobile-nav-drawer');

  if (hamburgerBtn && mobileNavDrawer) {
    hamburgerBtn.addEventListener('click', () => {
      mobileNavDrawer.classList.remove('hidden');
    });
  }

  if (closeDrawerBtn && mobileNavDrawer) {
    closeDrawerBtn.addEventListener('click', () => {
      mobileNavDrawer.classList.add('hidden');
    });
  }

  if (drawerBackdrop && mobileNavDrawer) {
    drawerBackdrop.addEventListener('click', () => {
      mobileNavDrawer.classList.add('hidden');
    });
  }

  // S1-06: Load and Render Role-Based Navigation Items from Database (AC-01 & AC-02)
  async function loadRoleBasedNavigation(token) {
    const desktopNavMenu = document.getElementById('desktop-nav-menu');
    const mobileNavItems = document.getElementById('mobile-nav-items');
    if (!desktopNavMenu || !mobileNavItems) return;

    desktopNavMenu.innerHTML = '<span style="font-size: 11px; color: #64748b;">Đang nạp menu theo vai trò...</span>';
    mobileNavItems.innerHTML = '<span style="font-size: 11px; color: #64748b;">Đang nạp menu theo vai trò...</span>';

    const res = await window.ATS_API.getNavigationMenuApi(token);
    if (res.ok && res.data.success) {
      const items = res.data.menuItems || [];
      desktopNavMenu.innerHTML = '';
      mobileNavItems.innerHTML = '';

      items.forEach((item, idx) => {
        // Desktop item
        const deskBtn = document.createElement('a');
        deskBtn.className = 'nav-item-btn' + (idx === 0 ? ' active' : '');
        deskBtn.href = '#';
        deskBtn.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;
        deskBtn.addEventListener('click', (e) => {
          e.preventDefault();
          document.querySelectorAll('.nav-item-btn').forEach(b => b.classList.remove('active'));
          deskBtn.classList.add('active');
          if (item.id === 'nav-users') {
            openUsersManagementView();
          } else if (item.id === 'nav-dashboard') {
            if (usersView) usersView.classList.add('hidden');
            errorView.classList.add('hidden');
            dashboardView.classList.remove('hidden');
          } else {
            alert(`[Điều hướng theo vai trò (AC-01)]\nĐường dẫn: ${item.path}\nTên mục: ${item.label}\nTrạng thái: Cho phép theo quyền CSDL.`);
          }
        });
        desktopNavMenu.appendChild(deskBtn);

        // Mobile item
        const mobBtn = document.createElement('a');
        mobBtn.className = 'nav-item-btn' + (idx === 0 ? ' active' : '');
        mobBtn.href = '#';
        mobBtn.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;
        mobBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (mobileNavDrawer) mobileNavDrawer.classList.add('hidden');
          if (item.id === 'nav-users') {
            openUsersManagementView();
          } else if (item.id === 'nav-dashboard') {
            if (usersView) usersView.classList.add('hidden');
            errorView.classList.add('hidden');
            dashboardView.classList.remove('hidden');
          } else {
            alert(`[Điều hướng theo vai trò (AC-01)]\nĐường dẫn: ${item.path}\nTên mục: ${item.label}\nTrạng thái: Cho phép theo quyền CSDL.`);
          }
        });
        mobileNavItems.appendChild(mobBtn);
      });
    }
  }

  // ==============================================================================
  // S1-03: FORGOT PASSWORD & PASSWORD RESET FLOW (AC-01, AC-02, AC-03)
  // ==============================================================================
  const openForgotBtn = document.getElementById('open-forgot-pwd-btn');
  const forgotModal = document.getElementById('forgot-modal');
  const closeForgotModal = document.getElementById('close-forgot-modal');
  const forgotForm = document.getElementById('forgot-form');
  const forgotEmailInput = document.getElementById('forgot-email');
  const forgotAlert = document.getElementById('forgot-alert');
  const forgotAlertMsg = document.getElementById('forgot-alert-msg');

  const emailInboxDrawer = document.getElementById('email-inbox-drawer');
  const closeEmailDrawer = document.getElementById('close-email-drawer');
  const emailRecipient = document.getElementById('email-recipient');
  const emailResetLink = document.getElementById('email-reset-link');

  const resetModal = document.getElementById('reset-modal');
  const closeResetModal = document.getElementById('close-reset-modal');
  const resetForm = document.getElementById('reset-form');
  const resetTokenInput = document.getElementById('reset-token-input');
  const resetNewPassword = document.getElementById('reset-new-password');
  const resetConfirmPassword = document.getElementById('reset-confirm-password');
  const resetAlert = document.getElementById('reset-alert');
  const resetAlertMsg = document.getElementById('reset-alert-msg');

  // Open / Close Forgot Modal
  if (openForgotBtn) {
    openForgotBtn.addEventListener('click', () => {
      forgotModal.classList.remove('hidden');
      forgotAlert.classList.add('hidden');
      forgotEmailInput.value = emailInput.value || '';
      forgotEmailInput.focus();
    });
  }

  if (closeForgotModal) {
    closeForgotModal.addEventListener('click', () => {
      forgotModal.classList.add('hidden');
    });
  }

  // Submit Forgot Password Request (AC-01 & AC-03)
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = forgotEmailInput.value.trim();
      if (!email) return;

      const submitBtn = document.getElementById('forgot-submit-btn');
      submitBtn.disabled = true;

      const res = await window.ATS_API.forgotPasswordApi(email);
      submitBtn.disabled = false;

      // AC-03: Always display identical notification message
      forgotAlert.classList.remove('hidden');
      forgotAlertMsg.textContent = res.data.message || 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn.';

      // If in demo mode and token was generated (email existed):
      if (res.data.demoResetToken) {
        showSimulatedEmail(email, res.data.demoResetToken);
      }
    });
  }

  // Display simulated email inbox drawer for demo/testing
  function showSimulatedEmail(email, token) {
    emailRecipient.textContent = email;
    emailResetLink.setAttribute('data-token', token);
    emailInboxDrawer.classList.remove('hidden');
  }

  if (closeEmailDrawer) {
    closeEmailDrawer.addEventListener('click', () => {
      emailInboxDrawer.classList.add('hidden');
    });
  }

  // Click reset link from simulated email
  if (emailResetLink) {
    emailResetLink.addEventListener('click', (e) => {
      e.preventDefault();
      const token = emailResetLink.getAttribute('data-token');
      if (!token) return;

      emailInboxDrawer.classList.add('hidden');
      forgotModal.classList.add('hidden');

      resetTokenInput.value = token;
      resetNewPassword.value = '';
      resetConfirmPassword.value = '';
      resetAlert.classList.add('hidden');
      resetModal.classList.remove('hidden');
      resetNewPassword.focus();
    });
  }

  if (closeResetModal) {
    closeResetModal.addEventListener('click', () => {
      resetModal.classList.add('hidden');
    });
  }

  // Submit Reset Password (AC-01 & AC-02)
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      resetAlert.classList.add('hidden');

      const token = resetTokenInput.value;
      const newPwd = resetNewPassword.value;
      const confirmPwd = resetConfirmPassword.value;

      if (!newPwd || newPwd.length < 8) {
        resetAlert.classList.remove('hidden');
        resetAlertMsg.textContent = 'Mật khẩu phải có tối thiểu 8 ký tự.';
        return;
      }

      if (!/[A-Za-z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
        resetAlert.classList.remove('hidden');
        resetAlertMsg.textContent = 'Mật khẩu mới phải bao gồm cả chữ cái và chữ số.';
        return;
      }

      if (newPwd !== confirmPwd) {
        resetAlert.classList.remove('hidden');
        resetAlertMsg.textContent = 'Xác nhận mật khẩu không trùng khớp.';
        return;
      }

      const submitBtn = document.getElementById('reset-submit-btn');
      submitBtn.disabled = true;

      const res = await window.ATS_API.resetPasswordApi(token, newPwd);
      submitBtn.disabled = false;

      if (res.ok && res.data.success) {
        resetModal.classList.add('hidden');
        showAlert('success', 'Thành công (S1-03)', 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.');
        passwordInput.value = newPwd;
        emailInput.focus();
      } else {
        // Shows error if token was already used (AC-02) or expired (AC-01)
        resetAlert.classList.remove('hidden');
        resetAlertMsg.textContent = res.data.message || 'Không thể đặt lại mật khẩu.';
      }
    });
  }

  // S1-03 Demo Test Buttons on Login View
  const triggerForgotDemoBtn = document.getElementById('trigger-forgot-demo-btn');
  if (triggerForgotDemoBtn) {
    triggerForgotDemoBtn.addEventListener('click', async () => {
      forgotEmailInput.value = 'admin@company.com';
      forgotModal.classList.remove('hidden');
      forgotForm.dispatchEvent(new Event('submit'));
    });
  }

  const triggerForgotNonExistentBtn = document.getElementById('trigger-forgot-nonexistent-btn');
  if (triggerForgotNonExistentBtn) {
    triggerForgotNonExistentBtn.addEventListener('click', async () => {
      forgotEmailInput.value = 'user_khong_ton_tai_' + Math.floor(Math.random() * 1000) + '@company.com';
      forgotModal.classList.remove('hidden');
      forgotForm.dispatchEvent(new Event('submit'));
    });
  }

  // ==============================================================================
  // S1-04: CHANGE PASSWORD WHILE LOGGED IN (AC-01, AC-02, AC-03)
  // ==============================================================================
  const openChangePwdBtn = document.getElementById('open-change-pwd-btn');
  const changePwdModal = document.getElementById('change-pwd-modal');
  const closeChangePwdModal = document.getElementById('close-change-pwd-modal');
  const changePwdForm = document.getElementById('change-pwd-form');
  const changeCurrentPwd = document.getElementById('change-current-pwd');
  const changeNewPwd = document.getElementById('change-new-pwd');
  const changeConfirmPwd = document.getElementById('change-confirm-pwd');
  const changePwdAlert = document.getElementById('change-pwd-alert');
  const changePwdAlertMsg = document.getElementById('change-pwd-alert-msg');

  if (openChangePwdBtn) {
    openChangePwdBtn.addEventListener('click', () => {
      changePwdModal.classList.remove('hidden');
      changePwdAlert.classList.add('hidden');
      changeCurrentPwd.value = '';
      changeNewPwd.value = '';
      changeConfirmPwd.value = '';
      changeCurrentPwd.focus();
    });
  }

  if (closeChangePwdModal) {
    closeChangePwdModal.addEventListener('click', () => {
      changePwdModal.classList.add('hidden');
    });
  }

  if (changePwdForm) {
    changePwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      changePwdAlert.classList.add('hidden');

      const token = sessionStorage.getItem('ats_token');
      if (!token) {
        handleExpiredSession('Vui lòng đăng nhập lại để đổi mật khẩu.');
        return;
      }

      const currentPassword = changeCurrentPwd.value;
      const newPassword = changeNewPwd.value;
      const confirmPassword = changeConfirmPwd.value;

      // AC-01 validation
      if (!currentPassword) {
        changePwdAlert.classList.remove('hidden');
        changePwdAlertMsg.textContent = 'Bắt buộc nhập mật khẩu hiện tại.';
        return;
      }

      // AC-02 validation
      if (!newPassword || newPassword.length < 8) {
        changePwdAlert.classList.remove('hidden');
        changePwdAlertMsg.textContent = 'Mật khẩu mới phải có tối thiểu 8 ký tự.';
        return;
      }

      if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        changePwdAlert.classList.remove('hidden');
        changePwdAlertMsg.textContent = 'Mật khẩu mới phải bao gồm cả chữ cái và chữ số.';
        return;
      }

      if (currentPassword === newPassword) {
        changePwdAlert.classList.remove('hidden');
        changePwdAlertMsg.textContent = 'Mật khẩu mới không được trùng với mật khẩu hiện tại.';
        return;
      }

      if (newPassword !== confirmPassword) {
        changePwdAlert.classList.remove('hidden');
        changePwdAlertMsg.textContent = 'Xác nhận mật khẩu mới không trùng khớp.';
        return;
      }

      const submitBtn = document.getElementById('change-pwd-submit-btn');
      submitBtn.disabled = true;

      const res = await window.ATS_API.changePasswordApi(token, currentPassword, newPassword);
      submitBtn.disabled = false;

      if (res.ok && res.data.success) {
        changePwdModal.classList.add('hidden');
        alert('Đổi mật khẩu thành công (S1-04)!\n' + (res.data.message || 'Các phiên đăng nhập khác đã được thu hồi. Phiên hiện tại vẫn hoạt động.'));
      } else {
        changePwdAlert.classList.remove('hidden');
        changePwdAlertMsg.textContent = res.data.message || 'Đổi mật khẩu thất bại.';
      }
    });
  }

  // ==============================================================================
  // S1-05: RBAC PERMISSION MATRIX & DEFAULT DENY TESTERS (AC-01, AC-02, AC-03)
  // ==============================================================================
  const testUserCreateBtn = document.getElementById('test-user-create-btn');
  const testCandidateListBtn = document.getElementById('test-candidate-list-btn');
  const testInterviewListBtn = document.getElementById('test-interview-list-btn');
  const viewRbacMatrixBtn = document.getElementById('view-rbac-matrix-btn');
  const rbacTestOutput = document.getElementById('rbac-test-output');
  const rbacMatrixModal = document.getElementById('rbac-matrix-modal');
  const closeRbacMatrixModal = document.getElementById('close-rbac-matrix-modal');
  const rbacMatrixTableContainer = document.getElementById('rbac-matrix-table-container');

  function showRbacOutput(status, message, details) {
    if (!rbacTestOutput) return;
    rbacTestOutput.classList.remove('hidden');
    const isSuccess = status >= 200 && status < 300;
    rbacTestOutput.style.background = isSuccess ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    rbacTestOutput.style.border = isSuccess ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)';
    rbacTestOutput.style.color = isSuccess ? '#4ade80' : '#f87171';
    rbacTestOutput.innerHTML = `
      <strong>[HTTP ${status}] ${isSuccess ? '✓ CHO PHÉP (AUTHORIZED)' : '⛔ TỪ CHỐI (DEFAULT DENY / 403)'}</strong><br/>
      ${message}<br/>
      ${details ? `<small style="color: #94a3b8;">Chi tiết: ${JSON.stringify(details)}</small>` : ''}
    `;
  }

  if (testUserCreateBtn) {
    testUserCreateBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      testUserCreateBtn.disabled = true;
      const res = await window.ATS_API.testCreateUserApi(token);
      testUserCreateBtn.disabled = false;
      showRbacOutput(res.status, res.data.message || 'Thực hiện thao tác', res.data);
    });
  }

  if (testCandidateListBtn) {
    testCandidateListBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      testCandidateListBtn.disabled = true;
      const res = await window.ATS_API.testCandidateListApi(token);
      testCandidateListBtn.disabled = false;
      showRbacOutput(res.status, res.data.message || 'Thực hiện thao tác', res.data);
    });
  }

  if (testInterviewListBtn) {
    testInterviewListBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      testInterviewListBtn.disabled = true;
      const res = await window.ATS_API.testInterviewListApi(token);
      testInterviewListBtn.disabled = false;
      showRbacOutput(res.status, res.data.message || 'Thực hiện thao tác', res.data);
    });
  }

  if (viewRbacMatrixBtn) {
    viewRbacMatrixBtn.addEventListener('click', async () => {
      viewRbacMatrixBtn.disabled = true;
      const res = await window.ATS_API.getRbacMatrixApi();
      viewRbacMatrixBtn.disabled = false;

      if (res.ok && res.data.success && rbacMatrixTableContainer) {
        const matrix = res.data.matrix;
        let html = '<table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">';
        html += '<thead style="background: rgba(255,255,255,0.08);"><tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">';
        html += '<th style="padding: 8px;">Vai trò (Role)</th><th style="padding: 8px;">Tên vai trò</th><th style="padding: 8px;">Số quyền</th><th style="padding: 8px;">Danh sách Permissions (CSDL)</th>';
        html += '</tr></thead><tbody>';

        for (const [code, info] of Object.entries(matrix)) {
          html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 8px;"><span class="badge badge-role font-mono">${code}</span></td>
            <td style="padding: 8px; font-weight: 500;">${info.roleName}</td>
            <td style="padding: 8px; color: #60a5fa;">${info.permissions.length}</td>
            <td style="padding: 8px; font-size: 11px; font-family: monospace; color: #cbd5e1;">${info.permissions.join(', ')}</td>
          </tr>`;
        }
        html += '</tbody></table>';
        rbacMatrixTableContainer.innerHTML = html;
        rbacMatrixModal.classList.remove('hidden');
      }
    });
  }

  if (closeRbacMatrixModal) {
    closeRbacMatrixModal.addEventListener('click', () => {
      rbacMatrixModal.classList.add('hidden');
    });
  }

  // ==============================================================================
  // S1-07: ERROR VIEWS (401, 403, 404) & RECOVERY FLOWS (AC-01, AC-02, AC-03)
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

  const triggerErr401Btn = document.getElementById('trigger-err-401-btn');
  const triggerErr403Btn = document.getElementById('trigger-err-403-btn');
  const triggerErr404Btn = document.getElementById('trigger-err-404-btn');

  let errorState = {
    previousView: 'dashboard',
    action: 'NAVIGATE_HOME',
    suggestedPath: '/dashboard'
  };

  function showErrorView(options) {
    if (!errorView) return;

    const {
      statusCode = 404,
      code = 'NOT_FOUND',
      heading,
      message,
      requiredPermission,
      recovery = {}
    } = options;

    if (!dashboardView.classList.contains('hidden')) {
      errorState.previousView = 'dashboard';
      dashboardView.classList.add('hidden');
    } else if (!loginView.classList.contains('hidden')) {
      errorState.previousView = 'login';
      loginView.classList.add('hidden');
    }

    errorState.action = recovery.action || (statusCode === 401 ? 'LOGIN' : 'NAVIGATE_HOME');
    errorState.suggestedPath = recovery.suggestedPath || (statusCode === 401 ? '/login' : '/dashboard');

    if (errorCodeDisplay) errorCodeDisplay.textContent = statusCode;
    if (errorCodeRaw) errorCodeRaw.textContent = code;

    // AC-01: Standardized error messages and codes
    if (statusCode === 401) {
      if (errorCodeDisplay) errorCodeDisplay.style.color = '#f59e0b';
      if (errorIconDisplay) errorIconDisplay.textContent = '🔒';
      if (errorHeadingDisplay) errorHeadingDisplay.textContent = heading || 'Phiên làm việc hết hạn hoặc chưa xác thực (401)';
      if (errorMessageDisplay) errorMessageDisplay.textContent = message || 'Yêu cầu của bạn không có phiên làm việc hợp lệ hoặc phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục công việc.';
      if (errorPrimaryBtnText) errorPrimaryBtnText.textContent = recovery.label || 'Đăng nhập lại (AC-03)';
      if (errorSecondaryBtnText) errorSecondaryBtnText.textContent = 'Quay lại màn hình trước';
    } else if (statusCode === 403) {
      if (errorCodeDisplay) errorCodeDisplay.style.color = '#ef4444';
      if (errorIconDisplay) errorIconDisplay.textContent = '⛔';
      if (errorHeadingDisplay) errorHeadingDisplay.textContent = heading || 'Truy cập bị từ chối (403)';
      let fullMsg = message || 'Bạn không có quyền truy cập vào chức năng hoặc tài nguyên này theo ma trận phân quyền hệ thống.';
      if (requiredPermission) {
        fullMsg += ` (Yêu cầu quyền: ${requiredPermission})`;
      }
      if (errorMessageDisplay) errorMessageDisplay.textContent = fullMsg;
      if (errorPrimaryBtnText) errorPrimaryBtnText.textContent = recovery.label || 'Về không gian làm việc của tôi (AC-03)';
      if (errorSecondaryBtnText) errorSecondaryBtnText.textContent = 'Quay lại trang trước';
    } else {
      // 404 Not Found
      if (errorCodeDisplay) errorCodeDisplay.style.color = '#3b82f6';
      if (errorIconDisplay) errorIconDisplay.textContent = '🔍';
      if (errorHeadingDisplay) errorHeadingDisplay.textContent = heading || 'Không tìm thấy trang hoặc tài nguyên (404)';
      if (errorMessageDisplay) errorMessageDisplay.textContent = message || 'Đường dẫn hoặc tài nguyên bạn yêu cầu không tồn tại trên hệ thống tuyển dụng nội bộ ATS.';
      if (errorPrimaryBtnText) errorPrimaryBtnText.textContent = recovery.label || 'Về trang chủ hệ thống (AC-03)';
      if (errorSecondaryBtnText) errorSecondaryBtnText.textContent = 'Quay lại trang trước';
    }

    // AC-02: Keeps top navigation / layout intact
    errorView.classList.remove('hidden');
  }

  // AC-03: Recovery Actions
  if (errorPrimaryBtn) {
    errorPrimaryBtn.addEventListener('click', () => {
      errorView.classList.add('hidden');
      if (errorState.action === 'LOGIN') {
        performLogout();
      } else {
        // NAVIGATE_HOME
        const token = sessionStorage.getItem('ats_token');
        if (token) {
          dashboardView.classList.remove('hidden');
        } else {
          loginView.classList.remove('hidden');
        }
      }
    });
  }

  if (errorSecondaryBtn) {
    errorSecondaryBtn.addEventListener('click', () => {
      errorView.classList.add('hidden');
      if (errorState.previousView === 'login' || !sessionStorage.getItem('ats_token')) {
        loginView.classList.remove('hidden');
      } else {
        dashboardView.classList.remove('hidden');
      }
    });
  }

  // S1-07 Test Triggers from Dashboard
  if (triggerErr401Btn) {
    triggerErr401Btn.addEventListener('click', async () => {
      // Real backend API call without valid token to get standardized 401
      const res = await fetch('/api/v1/auth/me', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_khong_hop_le_de_test_401' }
      });
      const data = await res.json();
      showErrorView({
        statusCode: res.status || 401,
        code: data.code || 'UNAUTHORIZED',
        heading: 'Phiên làm việc hết hạn hoặc không hợp lệ (401)',
        message: data.message || 'Yêu cầu không có phiên làm việc hợp lệ. Vui lòng đăng nhập.',
        recovery: data.recovery || { action: 'LOGIN', suggestedPath: '/login', label: 'Đăng nhập lại' }
      });
    });
  }

  if (triggerErr403Btn) {
    triggerErr403Btn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const res = await window.ATS_API.testCreateUserApi(token);
      if (res.status === 403) {
        showErrorView({
          statusCode: 403,
          code: res.data.code || 'FORBIDDEN_PERMISSION_DENIED',
          heading: 'Truy cập bị từ chối (403)',
          message: res.data.message || 'Bạn không có quyền thực hiện thao tác quản trị này.',
          requiredPermission: res.data.requiredPermission || 'user.create',
          recovery: res.data.recovery || { action: 'NAVIGATE_HOME', suggestedPath: '/dashboard', label: 'Về không gian làm việc của tôi' }
        });
      } else {
        showErrorView({
          statusCode: 403,
          code: 'FORBIDDEN_PERMISSION_DENIED',
          heading: 'Truy cập bị từ chối (403)',
          message: 'Tài khoản không có thẩm quyền truy cập tài nguyên bảo mật đặc biệt.',
          requiredPermission: 'system.superadmin',
          recovery: { action: 'NAVIGATE_HOME', suggestedPath: '/dashboard', label: 'Về không gian làm việc của tôi' }
        });
      }
    });
  }

  if (triggerErr404Btn) {
    triggerErr404Btn.addEventListener('click', async () => {
      const res = await window.ATS_API.testNotFoundApi();
      showErrorView({
        statusCode: res.status || 404,
        code: res.data.code || 'NOT_FOUND',
        heading: 'Không tìm thấy tài nguyên (404)',
        message: res.data.message || 'Đường dẫn hoặc tài nguyên bạn yêu cầu không tồn tại trên hệ thống.',
        recovery: res.data.recovery || { action: 'NAVIGATE_HOME', suggestedPath: '/dashboard', label: 'Về trang chủ hệ thống' }
      });
    });
  }

  // ==============================================================================
  // S1-08: USER MANAGEMENT (AC-01, AC-02, AC-03, AC-04)
  // ==============================================================================
  const usersView = document.getElementById('users-view');
  const openUsersManagementBtn = document.getElementById('open-users-management-btn');
  const usersBackDashboardBtn = document.getElementById('users-back-dashboard-btn');
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

  // Create User Modal Elements
  const openCreateUserModalBtn = document.getElementById('open-create-user-modal-btn');
  const createUserModal = document.getElementById('create-user-modal');
  const closeCreateUserModal = document.getElementById('close-create-user-modal');
  const createUserForm = document.getElementById('create-user-form');
  const createUserFullname = document.getElementById('create-user-fullname');
  const createUserEmail = document.getElementById('create-user-email');
  const createUserJobtitle = document.getElementById('create-user-jobtitle');
  const createUserDepartment = document.getElementById('create-user-department');
  const createUserPhone = document.getElementById('create-user-phone');
  const createUserRole = document.getElementById('create-user-role');
  const createUserAlert = document.getElementById('create-user-alert');
  const createUserAlertMsg = document.getElementById('create-user-alert-msg');
  const createUserSuccessBox = document.getElementById('create-user-success-box');
  const createdTempPwdDisplay = document.getElementById('created-temp-pwd-display');
  const viewCreatedActivationEmailBtn = document.getElementById('view-created-activation-email-btn');

  // Edit User Modal Elements
  const editUserModal = document.getElementById('edit-user-modal');
  const closeEditUserModal = document.getElementById('close-edit-user-modal');
  const editUserForm = document.getElementById('edit-user-form');
  const editUserId = document.getElementById('edit-user-id');
  const editUserEmail = document.getElementById('edit-user-email');
  const editUserFullname = document.getElementById('edit-user-fullname');
  const editUserJobtitle = document.getElementById('edit-user-jobtitle');
  const editUserDepartment = document.getElementById('edit-user-department');
  const editUserPhone = document.getElementById('edit-user-phone');
  const editUserAlert = document.getElementById('edit-user-alert');
  const editUserAlertMsg = document.getElementById('edit-user-alert-msg');

  let currentUsersPage = 1;
  let currentUsersLimit = 20;
  let lastCreatedActivationEmail = null;

  async function loadUsersTable(page = currentUsersPage) {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    currentUsersPage = page;
    const search = usersSearchInput ? usersSearchInput.value.trim() : '';
    const role = usersRoleFilter ? usersRoleFilter.value : 'ALL';
    const status = usersStatusFilter ? usersStatusFilter.value : 'ALL';

    if (usersTableBody) {
      usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">Đang tải dữ liệu từ CSDL...</td></tr>`;
    }

    const res = await window.ATS_API.getUsersApi(token, {
      page: currentUsersPage,
      limit: currentUsersLimit,
      search,
      role,
      status
    });

    if (res.ok && res.data.success) {
      const items = res.data.data.items || [];
      const pagination = res.data.data.pagination || {};

      if (usersTotalBadge) {
        usersTotalBadge.textContent = `${pagination.totalItems || 0} tài khoản`;
      }

      if (usersTableBody) {
        if (items.length === 0) {
          usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">Không tìm thấy tài khoản nào phù hợp với bộ lọc.</td></tr>`;
        } else {
          usersTableBody.innerHTML = items.map(u => {
            const statusBadge = u.status === 'ACTIVE'
              ? `<span class="badge badge-success" style="font-size: 11px;">Hoạt động</span>`
              : `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 11px;" title="${u.lockReason || ''}">Đã khóa</span>`;

            const roleBadges = (u.roles || []).map(r =>
              `<span class="badge badge-role font-mono" style="font-size: 10px; margin-right: 4px;">${r}</span>`
            ).join('');

            const lockOrUnlockBtn = u.status === 'ACTIVE'
              ? `<button type="button" class="btn btn-outline btn-xs lock-user-row-btn" data-id="${u.id}" style="padding: 4px 8px; font-size: 11px; border-color: rgba(239, 68, 68, 0.4); color: #f87171;">🔒 Khóa</button>`
              : `<button type="button" class="btn btn-outline btn-xs unlock-user-row-btn" data-id="${u.id}" style="padding: 4px 8px; font-size: 11px; border-color: rgba(34, 197, 94, 0.4); color: #4ade80;">🔓 Mở khóa</button>`;

            return `
              <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                <td style="padding: 10px 12px; font-weight: 600; color: #f8fafc;">${u.fullName}</td>
                <td style="padding: 10px 12px; color: #60a5fa; font-family: monospace;">${u.email}</td>
                <td style="padding: 10px 12px; color: #cbd5e1;">
                  <div>${u.jobTitle || '—'}</div>
                  <small style="color: #64748b;">${u.departmentName || '—'}</small>
                </td>
                <td style="padding: 10px 12px;">${roleBadges}</td>
                <td style="padding: 10px 12px;">${statusBadge}</td>
                <td style="padding: 10px 12px; text-align: center; white-space: nowrap;">
                  <button type="button" class="btn btn-outline btn-xs edit-user-row-btn" data-id="${u.id}" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;">
                    ✏️ Sửa
                  </button>
                  <button type="button" class="btn btn-outline btn-xs assign-roles-row-btn" data-id="${u.id}" style="padding: 4px 8px; font-size: 11px; border-color: rgba(96, 165, 250, 0.4); color: #93c5fd; margin-right: 4px;">
                    🛡️ Phân vai trò
                  </button>
                  ${lockOrUnlockBtn}
                </td>
              </tr>
            `;
          }).join('');

          // Bind edit buttons
          document.querySelectorAll('.edit-user-row-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const uId = btn.getAttribute('data-id');
              const targetUser = items.find(x => x.id === uId);
              if (targetUser) {
                openEditUserModal(targetUser);
              }
            });
          });

          // Bind assign roles buttons (S1-09)
          document.querySelectorAll('.assign-roles-row-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const uId = btn.getAttribute('data-id');
              const targetUser = items.find(x => x.id === uId);
              if (targetUser) {
                openAssignRolesModal(targetUser);
              }
            });
          });

          // Bind lock buttons (S1-10)
          document.querySelectorAll('.lock-user-row-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const uId = btn.getAttribute('data-id');
              const targetUser = items.find(x => x.id === uId);
              if (targetUser) {
                openLockUserModal(targetUser);
              }
            });
          });

          // Bind unlock buttons (S1-10)
          document.querySelectorAll('.unlock-user-row-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const uId = btn.getAttribute('data-id');
              const targetUser = items.find(x => x.id === uId);
              if (targetUser) {
                const confirmed = confirm(`Bạn có chắc chắn muốn mở khóa cho tài khoản '${targetUser.fullName}' (${targetUser.email}) không?`);
                if (confirmed) {
                  const token = sessionStorage.getItem('ats_token');
                  const res = await window.ATS_API.unlockUserApi(token, targetUser.id);
                  if (res.ok && res.data.success) {
                    alert('Mở khóa tài khoản thành công!\n' + (res.data.message || 'Người dùng đã có thể đăng nhập lại.'));
                    loadUsersTable(currentUsersPage);
                  } else {
                    alert('Không thể mở khóa: ' + (res.data.message || 'Lỗi không xác định.'));
                  }
                }
              }
            });
          });
        }
      }

      // Update Pagination info
      const startItem = pagination.totalItems > 0 ? (pagination.currentPage - 1) * pagination.limit + 1 : 0;
      const endItem = Math.min(pagination.currentPage * pagination.limit, pagination.totalItems);
      if (usersPageInfo) {
        usersPageInfo.textContent = `Hiển thị ${startItem} - ${endItem} trên tổng số ${pagination.totalItems} tài khoản (Trang ${pagination.currentPage} / ${pagination.totalPages})`;
      }

      if (usersCurrentPageBadge) {
        usersCurrentPageBadge.textContent = `${pagination.currentPage} / ${pagination.totalPages}`;
      }

      if (usersPrevBtn) {
        usersPrevBtn.disabled = !pagination.hasPrevPage;
      }

      if (usersNextBtn) {
        usersNextBtn.disabled = !pagination.hasNextPage;
      }
    } else {
      if (usersTableBody) {
        usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #ef4444;">Không thể tải dữ liệu: ${res.data.message || 'Lỗi phân quyền'}</td></tr>`;
      }
    }
  }

  function openUsersManagementView() {
    dashboardView.classList.add('hidden');
    errorView.classList.add('hidden');
    loginView.classList.add('hidden');
    if (usersView) usersView.classList.remove('hidden');
    loadUsersTable(1);
  }

  if (openUsersManagementBtn) {
    openUsersManagementBtn.addEventListener('click', openUsersManagementView);
  }

  if (usersBackDashboardBtn) {
    usersBackDashboardBtn.addEventListener('click', () => {
      if (usersView) usersView.classList.add('hidden');
      dashboardView.classList.remove('hidden');
    });
  }

  // Search & Filter event handlers
  if (usersSearchBtn) {
    usersSearchBtn.addEventListener('click', () => loadUsersTable(1));
  }

  if (usersSearchInput) {
    usersSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadUsersTable(1);
      }
    });
  }

  if (usersRoleFilter) {
    usersRoleFilter.addEventListener('change', () => loadUsersTable(1));
  }

  if (usersStatusFilter) {
    usersStatusFilter.addEventListener('change', () => loadUsersTable(1));
  }

  if (usersLimitSelect) {
    usersLimitSelect.addEventListener('change', () => {
      currentUsersLimit = parseInt(usersLimitSelect.value, 10) || 20;
      loadUsersTable(1);
    });
  }

  if (usersPrevBtn) {
    usersPrevBtn.addEventListener('click', () => {
      if (currentUsersPage > 1) {
        loadUsersTable(currentUsersPage - 1);
      }
    });
  }

  if (usersNextBtn) {
    usersNextBtn.addEventListener('click', () => {
      loadUsersTable(currentUsersPage + 1);
    });
  }

  // Open / Close Create User Modal (AC-01)
  if (openCreateUserModalBtn) {
    openCreateUserModalBtn.addEventListener('click', () => {
      if (createUserModal) createUserModal.classList.remove('hidden');
      if (createUserAlert) createUserAlert.classList.add('hidden');
      if (createUserSuccessBox) createUserSuccessBox.classList.add('hidden');
      if (createUserForm) createUserForm.reset();
      if (createUserFullname) createUserFullname.focus();
    });
  }

  if (closeCreateUserModal) {
    closeCreateUserModal.addEventListener('click', () => {
      if (createUserModal) createUserModal.classList.add('hidden');
    });
  }

  // Submit Create User (AC-01 & AC-02)
  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (createUserAlert) createUserAlert.classList.add('hidden');
      if (createUserSuccessBox) createUserSuccessBox.classList.add('hidden');

      const token = sessionStorage.getItem('ats_token');
      if (!token) {
        handleExpiredSession();
        return;
      }

      const fullName = createUserFullname.value.trim();
      const email = createUserEmail.value.trim();
      const jobTitle = createUserJobtitle.value.trim();
      const departmentName = createUserDepartment.value.trim();
      const phoneNumber = createUserPhone.value.trim();
      const roleCode = createUserRole.value;

      const submitBtn = document.getElementById('create-user-submit-btn');
      submitBtn.disabled = true;

      const res = await window.ATS_API.createUserApi(token, {
        fullName,
        email,
        jobTitle,
        departmentName,
        phoneNumber,
        roleCode
      });

      submitBtn.disabled = false;

      if (res.ok && res.data.success) {
        // AC-01: Show generated temporary password
        const tempPassword = res.data.data.temporaryPassword;
        lastCreatedActivationEmail = res.data.data.activationEmail;

        if (createdTempPwdDisplay) {
          createdTempPwdDisplay.textContent = tempPassword;
        }
        if (createUserSuccessBox) {
          createUserSuccessBox.classList.remove('hidden');
        }

        // Refresh users table
        loadUsersTable(1);
      } else {
        // AC-02: Show duplicate email error message or other error
        if (createUserAlert && createUserAlertMsg) {
          createUserAlert.classList.remove('hidden');
          createUserAlertMsg.textContent = res.data.message || 'Không thể tạo tài khoản.';
        }
      }
    });
  }

  // View Activation Email Button (simulated drawer)
  if (viewCreatedActivationEmailBtn) {
    viewCreatedActivationEmailBtn.addEventListener('click', () => {
      if (lastCreatedActivationEmail) {
        emailRecipient.textContent = lastCreatedActivationEmail.recipient;
        const emailSubject = document.getElementById('email-subject');
        if (emailSubject) emailSubject.textContent = lastCreatedActivationEmail.subject;
        const emailBodySnippet = document.getElementById('email-body-snippet');
        if (emailBodySnippet) {
          emailBodySnippet.innerHTML = `
            <pre style="white-space: pre-wrap; font-family: sans-serif; font-size: 13px; line-height: 1.5; color: #cbd5e1;">${lastCreatedActivationEmail.body}</pre>
          `;
        }
        emailInboxDrawer.classList.remove('hidden');
      }
    });
  }

  // Edit User Modal (AC-03)
  function openEditUserModal(user) {
    if (!editUserModal) return;
    if (editUserAlert) editUserAlert.classList.add('hidden');
    editUserId.value = user.id;
    editUserEmail.value = user.email;
    editUserFullname.value = user.fullName;
    editUserJobtitle.value = user.jobTitle;
    editUserDepartment.value = user.departmentName;
    editUserPhone.value = user.phoneNumber;
    editUserModal.classList.remove('hidden');
    editUserFullname.focus();
  }

  if (closeEditUserModal) {
    closeEditUserModal.addEventListener('click', () => {
      if (editUserModal) editUserModal.classList.add('hidden');
    });
  }

  if (editUserForm) {
    editUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (editUserAlert) editUserAlert.classList.add('hidden');

      const token = sessionStorage.getItem('ats_token');
      if (!token) {
        handleExpiredSession();
        return;
      }

      const id = editUserId.value;
      const fullName = editUserFullname.value.trim();
      const jobTitle = editUserJobtitle.value.trim();
      const departmentName = editUserDepartment.value.trim();
      const phoneNumber = editUserPhone.value.trim();

      const submitBtn = document.getElementById('edit-user-submit-btn');
      submitBtn.disabled = true;

      const res = await window.ATS_API.updateUserApi(token, id, {
        fullName,
        jobTitle,
        departmentName,
        phoneNumber
      });

      submitBtn.disabled = false;

      if (res.ok && res.data.success) {
        editUserModal.classList.add('hidden');
        loadUsersTable(currentUsersPage);
      } else {
        if (editUserAlert && editUserAlertMsg) {
          editUserAlert.classList.remove('hidden');
          editUserAlertMsg.textContent = res.data.message || 'Không thể cập nhật thông tin người dùng.';
        }
      }
    });
  }

  // ==============================================================================
  // S1-09: ASSIGN & REVOKE USER ROLES (AC-01, AC-02, AC-03)
  // ==============================================================================
  const assignRolesModal = document.getElementById('assign-roles-modal');
  const closeAssignRolesModal = document.getElementById('close-assign-roles-modal');
  const cancelAssignRolesBtn = document.getElementById('cancel-assign-roles-btn');
  const assignRolesForm = document.getElementById('assign-roles-form');
  const assignRolesUserId = document.getElementById('assign-roles-user-id');
  const assignRolesUserName = document.getElementById('assign-roles-user-name');
  const assignRolesUserEmail = document.getElementById('assign-roles-user-email');
  const assignRolesAlert = document.getElementById('assign-roles-alert');
  const assignRolesAlertMsg = document.getElementById('assign-roles-alert-msg');
  const assignRolesSelfWarning = document.getElementById('assign-roles-self-warning');
  const assignRolesCheckboxContainer = document.getElementById('assign-roles-checkbox-container');
  const assignRolesSubmitBtn = document.getElementById('assign-roles-submit-btn');

  async function openAssignRolesModal(targetUser) {
    if (!assignRolesModal) return;
    if (assignRolesAlert) assignRolesAlert.classList.add('hidden');

    assignRolesUserId.value = targetUser.id;
    assignRolesUserName.textContent = targetUser.fullName || '';
    assignRolesUserEmail.textContent = targetUser.email || '';

    // AC-03: Detect self-edit for logged-in user
    const isSelf = currentAuthenticatedUser && (
      currentAuthenticatedUser.id === targetUser.id ||
      currentAuthenticatedUser.email.toLowerCase() === (targetUser.email || '').toLowerCase()
    );

    if (assignRolesSelfWarning) {
      if (isSelf) {
        assignRolesSelfWarning.classList.remove('hidden');
      } else {
        assignRolesSelfWarning.classList.add('hidden');
      }
    }

    if (assignRolesCheckboxContainer) {
      assignRolesCheckboxContainer.innerHTML = '<div style="color: #94a3b8; font-size: 12px; padding: 12px; text-align: center;">Đang nạp danh mục vai trò từ CSDL...</div>';
    }

    assignRolesModal.classList.remove('hidden');

    const token = sessionStorage.getItem('ats_token');
    const res = await window.ATS_API.getUserRolesApi(token, targetUser.id);

    if (res.ok && res.data.success) {
      const { currentRoles, availableRoles } = res.data.data;
      if (assignRolesCheckboxContainer) {
        assignRolesCheckboxContainer.innerHTML = (availableRoles || []).map(r => {
          const isChecked = (currentRoles || []).includes(r.code);
          return `
            <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 4px;">
              <input type="checkbox" class="role-checkbox-item" value="${r.code}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; transform: scale(1.15);" />
              <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <strong style="color: #f8fafc; font-size: 13px;">${r.name}</strong>
                  <span class="badge badge-role font-mono" style="font-size: 10px;">${r.code}</span>
                </div>
                <div style="color: #94a3b8; font-size: 11px; margin-top: 2px; line-height: 1.4;">${r.description || ''}</div>
              </div>
            </label>
          `;
        }).join('');
      }
    } else {
      if (assignRolesAlert && assignRolesAlertMsg) {
        assignRolesAlert.classList.remove('hidden');
        assignRolesAlertMsg.textContent = res.data.message || 'Không thể tải danh sách vai trò của người dùng.';
      }
    }
  }

  if (closeAssignRolesModal) {
    closeAssignRolesModal.addEventListener('click', () => {
      if (assignRolesModal) assignRolesModal.classList.add('hidden');
    });
  }

  if (cancelAssignRolesBtn) {
    cancelAssignRolesBtn.addEventListener('click', () => {
      if (assignRolesModal) assignRolesModal.classList.add('hidden');
    });
  }

  if (assignRolesForm) {
    assignRolesForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (assignRolesAlert) assignRolesAlert.classList.add('hidden');

      const token = sessionStorage.getItem('ats_token');
      if (!token) {
        handleExpiredSession();
        return;
      }

      const targetUserId = assignRolesUserId.value;
      const checkedBoxes = Array.from(assignRolesCheckboxContainer.querySelectorAll('.role-checkbox-item:checked'));
      const selectedRoleCodes = checkedBoxes.map(cb => cb.value);

      if (selectedRoleCodes.length === 0) {
        if (assignRolesAlert && assignRolesAlertMsg) {
          assignRolesAlert.classList.remove('hidden');
          assignRolesAlertMsg.textContent = 'Người dùng phải có ít nhất một vai trò hợp lệ.';
        }
        return;
      }

      if (assignRolesSubmitBtn) assignRolesSubmitBtn.disabled = true;

      const res = await window.ATS_API.assignUserRolesApi(token, targetUserId, selectedRoleCodes);

      if (assignRolesSubmitBtn) assignRolesSubmitBtn.disabled = false;

      if (res.ok && res.data.success) {
        if (assignRolesModal) assignRolesModal.classList.add('hidden');
        alert('Phân quyền vai trò thành công (S1-09)!\n' + (res.data.message || 'Quyền mới có hiệu lực ngay ở thao tác tiếp theo (AC-02).'));
        loadUsersTable(currentUsersPage);

        // If self-edited, dynamically refresh current user permissions and navigation menu (AC-02)
        if (currentAuthenticatedUser && currentAuthenticatedUser.id === targetUserId) {
          loadRoleBasedNavigation(token);
          const meRes = await window.ATS_API.getMeApi(token);
          if (meRes.ok && meRes.data.success) {
            renderDashboard(meRes.data.user);
          }
        }
      } else {
        // AC-03 Violation (CANNOT_REVOKE_OWN_ADMIN_ROLE) or other error
        if (assignRolesAlert && assignRolesAlertMsg) {
          assignRolesAlert.classList.remove('hidden');
          assignRolesAlertMsg.textContent = res.data.message || 'Không thể phân quyền vai trò.';
        }
      }
    });
  }

  // ==============================================================================
  // S1-10: LOCK & UNLOCK USER ACCOUNTS (AC-01, AC-02, AC-03)
  // ==============================================================================
  const lockUserModal = document.getElementById('lock-user-modal');
  const closeLockUserModal = document.getElementById('close-lock-user-modal');
  const cancelLockUserBtn = document.getElementById('cancel-lock-user-btn');
  const lockUserForm = document.getElementById('lock-user-form');
  const lockUserId = document.getElementById('lock-user-id');
  const lockUserName = document.getElementById('lock-user-name');
  const lockUserEmail = document.getElementById('lock-user-email');
  const lockReasonInput = document.getElementById('lock-reason-input');
  const lockUserAlert = document.getElementById('lock-user-alert');
  const lockUserAlertMsg = document.getElementById('lock-user-alert-msg');
  const lockSelfWarning = document.getElementById('lock-self-warning');
  const lockUserSubmitBtn = document.getElementById('lock-user-submit-btn');

  // Handover warning modal
  const handoverWarningModal = document.getElementById('handover-warning-modal');
  const closeHandoverModal = document.getElementById('close-handover-modal');
  const acknowledgeHandoverBtn = document.getElementById('acknowledge-handover-btn');
  const handoverRequisitionsContainer = document.getElementById('handover-requisitions-container');

  function openLockUserModal(targetUser) {
    if (!lockUserModal) return;
    if (lockUserAlert) lockUserAlert.classList.add('hidden');

    lockUserId.value = targetUser.id;
    lockUserName.textContent = targetUser.fullName || '';
    lockUserEmail.textContent = targetUser.email || '';
    if (lockReasonInput) lockReasonInput.value = '';

    const isSelf = currentAuthenticatedUser && (
      currentAuthenticatedUser.id === targetUser.id ||
      currentAuthenticatedUser.email.toLowerCase() === (targetUser.email || '').toLowerCase()
    );

    if (lockSelfWarning) {
      if (isSelf) {
        lockSelfWarning.classList.remove('hidden');
        if (lockUserSubmitBtn) lockUserSubmitBtn.disabled = true;
      } else {
        lockSelfWarning.classList.add('hidden');
        if (lockUserSubmitBtn) lockUserSubmitBtn.disabled = false;
      }
    }

    lockUserModal.classList.remove('hidden');
    if (!isSelf && lockReasonInput) {
      lockReasonInput.focus();
    }
  }

  if (closeLockUserModal) {
    closeLockUserModal.addEventListener('click', () => {
      if (lockUserModal) lockUserModal.classList.add('hidden');
    });
  }

  if (cancelLockUserBtn) {
    cancelLockUserBtn.addEventListener('click', () => {
      if (lockUserModal) lockUserModal.classList.add('hidden');
    });
  }

  if (closeHandoverModal) {
    closeHandoverModal.addEventListener('click', () => {
      if (handoverWarningModal) handoverWarningModal.classList.add('hidden');
    });
  }

  if (acknowledgeHandoverBtn) {
    acknowledgeHandoverBtn.addEventListener('click', () => {
      if (handoverWarningModal) handoverWarningModal.classList.add('hidden');
    });
  }

  if (lockUserForm) {
    lockUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (lockUserAlert) lockUserAlert.classList.add('hidden');

      const token = sessionStorage.getItem('ats_token');
      if (!token) {
        handleExpiredSession();
        return;
      }

      const targetUserId = lockUserId.value;
      const reason = lockReasonInput ? lockReasonInput.value.trim() : '';

      // AC-02 Validation
      if (!reason || reason.length < 5) {
        if (lockUserAlert && lockUserAlertMsg) {
          lockUserAlert.classList.remove('hidden');
          lockUserAlertMsg.textContent = 'Lý do khóa tài khoản là trường bắt buộc (AC-02), tối thiểu 5 ký tự.';
        }
        return;
      }

      if (lockUserSubmitBtn) lockUserSubmitBtn.disabled = true;

      const res = await window.ATS_API.lockUserApi(token, targetUserId, reason);

      if (lockUserSubmitBtn) lockUserSubmitBtn.disabled = false;

      if (res.ok && res.data.success) {
        if (lockUserModal) lockUserModal.classList.add('hidden');
        loadUsersTable(currentUsersPage);

        // AC-03: Check if handover warning is needed
        if (res.data.data && res.data.data.handoverRequired) {
          const reqs = res.data.data.handoverRequisitions || [];
          if (handoverRequisitionsContainer) {
            let html = '<table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">';
            html += '<thead style="background: rgba(255, 255, 255, 0.08); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">';
            html += '<tr><th style="padding: 8px 10px;">Mã vị trí</th><th style="padding: 8px 10px;">Chức danh tuyển dụng</th><th style="padding: 8px 10px;">Phòng ban</th><th style="padding: 8px 10px;">Vai trò phụ trách</th></tr>';
            html += '</thead><tbody>';
            reqs.forEach(r => {
              const roleLabel = r.assigned_role === 'RECRUITER' ? 'Recruiter' : r.assigned_role === 'HIRING_MGR' ? 'Hiring Manager' : 'Recruiter & Hiring Mgr';
              html += `<tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                <td style="padding: 8px 10px; font-family: monospace; color: #60a5fa; font-weight: 600;">${r.code}</td>
                <td style="padding: 8px 10px; color: #f8fafc; font-weight: 500;">${r.title}</td>
                <td style="padding: 8px 10px; color: #cbd5e1;">${r.department_name}</td>
                <td style="padding: 8px 10px;"><span class="badge badge-role font-mono" style="font-size: 10px;">${roleLabel}</span></td>
              </tr>`;
            });
            html += '</tbody></table>';
            handoverRequisitionsContainer.innerHTML = html;
          }
          if (handoverWarningModal) handoverWarningModal.classList.remove('hidden');
        } else {
          alert('Khóa tài khoản thành công (S1-10)!\n' + (res.data.message || 'Tài khoản đã bị khóa và mọi phiên đăng nhập bị thu hồi.'));
        }
      } else {
        if (lockUserAlert && lockUserAlertMsg) {
          lockUserAlert.classList.remove('hidden');
          lockUserAlertMsg.textContent = res.data.message || 'Không thể khóa tài khoản.';
        }
      }
    });
  }
});
