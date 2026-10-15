  // Modal: Change Password in Session
  const changePwdModal = document.getElementById('change-pwd-modal');
  const closeChangePwdModal = document.getElementById('close-change-pwd-modal');
  const changePwdForm = document.getElementById('change-pwd-form');
  const changePwdAlert = document.getElementById('change-pwd-alert');
  const changePwdAlertMsg = document.getElementById('change-pwd-alert-msg');
  let changingPassword = false;

  function openChangePwdModal() {
    if (!changePwdModal) return;
    if (currentActiveView === 'change-password') {
      document.getElementById('change-password-view').classList.remove('hidden');
      document.getElementById('change-password-form-host').appendChild(changePwdModal);
      changePwdModal.classList.add('password-page-form');
    } else {
      document.body.appendChild(changePwdModal);
      changePwdModal.classList.remove('password-page-form');
    }
    const forced = Boolean(currentAuthenticatedUser?.mustChangePassword);
    closeChangePwdModal?.classList.toggle('hidden', forced);
    document.getElementById('forced-password-logout-btn')?.classList.toggle('hidden', currentActiveView !== 'change-password');
    document.getElementById('change-pwd-title').textContent = forced ? 'Đổi mật khẩu tạm thời' : 'Đổi mật khẩu tài khoản';
    if (changePwdForm) changePwdForm.reset();
    if (changePwdAlert) changePwdAlert.classList.add('hidden');
    changePwdModal.classList.remove('hidden');
  }

  if (closeChangePwdModal) {
    closeChangePwdModal.addEventListener('click', () => {
      if (currentAuthenticatedUser?.mustChangePassword) return;
      changePwdModal.classList.add('hidden');
      if (currentActiveView === 'change-password') window.ATS_ROUTER.navigate(getAuthenticatedHome());
    });
  }
  document.getElementById('forced-password-logout-btn')?.addEventListener('click', () => performLogout());

  if (changePwdForm) {
    changePwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (changingPassword) return;
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
        changingPassword = true;
        document.getElementById('change-pwd-submit-btn').disabled = true;
        const res = await window.ATS_API.changePasswordApi(token, currentPassword, newPassword);
        if (token !== sessionStorage.getItem('ats_token')) return;
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
          changePwdAlertMsg.textContent = 'Không thể kết nối đến máy chủ. Vui lòng thử lại.';
          changePwdAlert.classList.remove('hidden');
        }
      } finally {
        changingPassword = false;
        document.getElementById('change-pwd-submit-btn').disabled = false;
      }
    });
  }
