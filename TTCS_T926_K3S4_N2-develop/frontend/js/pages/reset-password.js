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
    if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/reset-password');
  }

  if (closeResetModal && resetModal) {
    closeResetModal.addEventListener('click', () => {
      resetModal.classList.add('hidden');
      if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/login');
    });
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
          if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/login', { replace: true });
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
