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
