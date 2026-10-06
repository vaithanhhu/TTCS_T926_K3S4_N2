  // ==============================================================================
  // 3. AUTHENTICATION & LOGIN FLOW
  // ==============================================================================

  // Presentation only: reuse the existing public company media, never an external image.
  function renderLoginBranding(settings = {}) {
    const background = document.getElementById('login-background');
    const logo = document.getElementById('login-company-logo');
    const fallback = document.getElementById('login-logo-fallback');
    const introduction = document.getElementById('public-career-page-content');
    const companyMedia = url => typeof url === 'string' && /^\/public\/company\/[\w.-]+\.(png|jpe?g)$/i.test(url);
    if (background) {
      background.classList.add('hidden');
      background.onload = () => background.classList.remove('hidden');
      background.onerror = () => { background.classList.add('hidden'); background.removeAttribute('src'); };
      if (companyMedia(settings.heroImageUrl)) background.src = settings.heroImageUrl;
      else background.removeAttribute('src');
    }
    if (logo) {
      logo.classList.add('hidden');
      fallback?.classList.remove('hidden');
      logo.onload = () => { logo.classList.remove('hidden'); fallback?.classList.add('hidden'); };
      logo.onerror = () => { logo.classList.add('hidden'); logo.removeAttribute('src'); fallback?.classList.remove('hidden'); };
      if (companyMedia(settings.logoUrl)) logo.src = settings.logoUrl;
      else logo.removeAttribute('src');
    }
    if (introduction) {
      introduction.textContent = String(settings.introduction || '').trim();
      introduction.classList.toggle('hidden', !introduction.textContent);
    }
  }

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

          await setupAuthenticatedSession(authData.user, authData.user.defaultHome);
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
