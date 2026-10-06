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
    window.ATS_MOBILE_NAVIGATION.close();
    window.ATS_MOBILE_NAVIGATION.updateTitle(VIEW_TITLES.error);

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
          const router = window.ATS_ROUTER;
          if (router?.resolveInternal(errorRecoveryState.suggestedPath)?.auth) {
            router.navigate(errorRecoveryState.suggestedPath);
          } else {
            switchView('dashboard');
          }
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
