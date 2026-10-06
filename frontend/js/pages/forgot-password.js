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
  let resendCooldownEndsAt = 0;

  function startResendCooldown(seconds = 60) {
    if (!resendOtpBtn) return;
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    resendCooldownEndsAt = Date.now() + seconds * 1000;
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

  function resumeResendCooldown() {
    const seconds = Math.ceil((resendCooldownEndsAt - Date.now()) / 1000);
    if (seconds > 0) startResendCooldown(seconds);
    else if (resendOtpBtn) {
      resendOtpBtn.disabled = false;
      resendOtpBtn.style.pointerEvents = '';
      resendOtpBtn.textContent = 'Gửi lại mã OTP';
    }
  }

  function resetForgotModalState() {
    resendCooldownEndsAt = 0;
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
      if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/forgot-password');
      else forgotModal.classList.remove('hidden');
    });
  }

  if (closeForgotModal && forgotModal) {
    closeForgotModal.addEventListener('click', () => {
      resetForgotModalState();
      forgotModal.classList.add('hidden');
      if (window.ATS_ROUTER) window.ATS_ROUTER.navigate('/login');
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
          showToast('success', 'Đã nhận yêu cầu', res.data.message);

          if (otpForm) {
            forgotForm.classList.add('hidden');
            otpForm.classList.remove('hidden');
            if (otpNotice) {
              otpNotice.textContent = `Nếu email ${email} đã đăng ký và tài khoản đang hoạt động, bạn sẽ nhận được mã OTP gồm 6 chữ số. Mã có hiệu lực trong vòng 5 phút.`;
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
          showToast('success', 'Đã nhận yêu cầu gửi lại', res.data.message);
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
