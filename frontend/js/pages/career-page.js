  // ==============================================================================
  // ==============================================================================
  // S2. COMPANY CAREER PAGE
  // ==============================================================================

  const careerPageIntroductionInput = document.getElementById('career-page-introduction-input');
  const careerPageLogoInput = document.getElementById('career-page-logo-input');
  const careerPageHeroInput = document.getElementById('career-page-hero-input');
  const careerPageLogoStatus = document.getElementById('career-page-logo-status');
  const careerPageHeroStatus = document.getElementById('career-page-hero-status');
  const careerPagePreviewContainer = document.getElementById('career-page-preview-container');
  const careerPagePreviewBtn = document.getElementById('career-page-preview-btn');
  const careerPageSaveBtn = document.getElementById('career-page-save-btn');
  const careerPageFormAlert = document.getElementById('career-page-form-alert');
  const careerPageFormAlertMsg = document.getElementById('career-page-form-alert-msg');

  let currentCareerPageSettings = {
    introduction: '',
    logoUrl: null,
    heroImageUrl: null,
    updatedAt: null
  };

  async function loadCareerPage() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (careerPageFormAlert) {
      careerPageFormAlert.classList.add('hidden');
    }

    try {
      const res = await window.ATS_API.getCareerPageApi(token);

      if (!res.ok || !res.data || !res.data.success) {
        showToast(
          'error',
          'Không thể tải cấu hình',
          (res.data && res.data.message) || 'Không thể tải trang giới thiệu công ty.'
        );
        return;
      }

      const data = res.data.data || {};

      currentCareerPageSettings = {
        introduction: data.introduction || '',
        logoUrl: data.logoUrl || null,
        heroImageUrl: data.heroImageUrl || null,
        updatedAt: data.updatedAt || null
      };

      if (careerPageIntroductionInput) {
        careerPageIntroductionInput.value = currentCareerPageSettings.introduction;
      }

      if (careerPageLogoInput) {
        careerPageLogoInput.value = '';
      }

      if (careerPageHeroInput) {
        careerPageHeroInput.value = '';
      }

      if (careerPageLogoStatus) {
        careerPageLogoStatus.textContent = currentCareerPageSettings.logoUrl
          ? 'Đang sử dụng logo đã lưu. Chọn tệp mới nếu muốn thay thế.'
          : 'JPG hoặc PNG, tối đa 5 MB.';
      }

      if (careerPageHeroStatus) {
        careerPageHeroStatus.textContent = currentCareerPageSettings.heroImageUrl
          ? 'Đang sử dụng ảnh giới thiệu đã lưu. Chọn tệp mới nếu muốn thay thế.'
          : 'JPG hoặc PNG, tối đa 5 MB.';
      }

      if (careerPagePreviewContainer) {
        careerPagePreviewContainer.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; color: var(--color-text-muted);">
            Bấm “Xem trước” để xem giao diện trước khi lưu.
          </div>
        `;
      }
    } catch (error) {
      showToast(
        'error',
        'Không thể tải cấu hình',
        'Lỗi kết nối khi tải trang giới thiệu công ty.'
      );
    }
  }
  let careerPagePreviewObjectUrls = [];

  function clearCareerPagePreviewObjectUrls() {
    careerPagePreviewObjectUrls.forEach(url => URL.revokeObjectURL(url));
    careerPagePreviewObjectUrls = [];
  }

  function validateCareerPageImage(file, label) {
    if (!file) return true;

    const allowedTypes = ['image/jpeg', 'image/png'];
    const maxFileSize = 5 * 1024 * 1024;

    if (!allowedTypes.includes(file.type)) {
      showToast(
        'warning',
        'Ảnh không hợp lệ',
        `${label} chỉ chấp nhận ảnh JPG hoặc PNG.`
      );
      return false;
    }

    if (file.size > maxFileSize) {
      showToast(
        'warning',
        'Ảnh quá lớn',
        `${label} không được vượt quá 5 MB.`
      );
      return false;
    }

    return true;
  }

  function renderCareerPagePublicContent(container, settings = {}) {
    if (!container) return;
    if (container.id === 'public-career-page-content') {
      renderLoginBranding(settings);
      return;
    }

    const introduction = String(settings.introduction || '').trim();
    const logoUrl = settings.logoUrl || null;
    const heroImageUrl = settings.heroImageUrl || null;

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.border = '1px solid var(--color-border)';
    wrapper.style.borderRadius = 'var(--radius-sm)';
    wrapper.style.overflow = 'hidden';
    wrapper.className = 'company-brand-preview';
    wrapper.style.background = 'var(--company-public-background)';
    wrapper.style.color = '#fff';
    wrapper.style.position = 'relative';
    wrapper.style.isolation = 'isolate';
    wrapper.style.minHeight = '360px';

    if (heroImageUrl) {
      const hero = document.createElement('img');
      hero.src = heroImageUrl;
      hero.alt = 'Ảnh giới thiệu công ty';
      hero.className = 'login-background';
      hero.style.display = 'block';
      hero.style.width = '100%';
      hero.style.height = '100%';
      hero.style.filter = 'brightness(0.64)';
      hero.style.objectFit = 'cover';
      wrapper.appendChild(hero);
    }

    const body = document.createElement('div');
    body.className = 'login-introduction';
    body.style.maxWidth = 'none';
    body.style.position = 'relative';
    body.style.padding = '28px';

    if (logoUrl) {
      const logo = document.createElement('img');
      logo.src = logoUrl;
      logo.alt = 'Logo công ty';
      logo.style.display = 'block';
      logo.style.maxWidth = '220px';
      logo.style.height = 'clamp(38px, 3.2vw, 46px)';
      logo.style.maxHeight = '46px';
      logo.style.objectFit = 'contain';
      logo.style.marginBottom = '20px';
      body.appendChild(logo);
    }

    const heading = document.createElement('h1');
    heading.textContent = 'HỆ THỐNG TUYỂN DỤNG NỘI BỘ';
    heading.style.margin = '0 0 14px';
    heading.style.color = '#fff';
    body.appendChild(heading);

    const description = document.createElement('div');
    description.className = 'login-company-introduction';
    description.textContent = introduction;
    description.classList.toggle('hidden', !introduction);
    description.style.whiteSpace = 'pre-wrap';
    description.style.lineHeight = '1.7';
    description.style.color = 'rgba(255, 255, 255, .9)';
    description.style.fontSize = '14px';
    body.appendChild(description);

    wrapper.appendChild(body);
    container.appendChild(wrapper);
  }

  if (careerPageLogoInput) {
    careerPageLogoInput.addEventListener('change', () => {
      const file =
        careerPageLogoInput.files && careerPageLogoInput.files[0];

      if (!file) return;

      if (!validateCareerPageImage(file, 'Logo công ty')) {
        careerPageLogoInput.value = '';
        return;
      }

      if (careerPageLogoStatus) {
        careerPageLogoStatus.textContent = `Đã chọn: ${file.name}`;
      }
    });
  }

  if (careerPageHeroInput) {
    careerPageHeroInput.addEventListener('change', () => {
      const file =
        careerPageHeroInput.files && careerPageHeroInput.files[0];

      if (!file) return;

      if (!validateCareerPageImage(file, 'Ảnh giới thiệu')) {
        careerPageHeroInput.value = '';
        return;
      }

      if (careerPageHeroStatus) {
        careerPageHeroStatus.textContent = `Đã chọn: ${file.name}`;
      }
    });
  }

  if (careerPagePreviewBtn) {
    careerPagePreviewBtn.addEventListener('click', () => {
      const logoFile =
        careerPageLogoInput &&
        careerPageLogoInput.files &&
        careerPageLogoInput.files[0];

      const heroFile =
        careerPageHeroInput &&
        careerPageHeroInput.files &&
        careerPageHeroInput.files[0];

      if (
        !validateCareerPageImage(logoFile, 'Logo công ty') ||
        !validateCareerPageImage(heroFile, 'Ảnh giới thiệu')
      ) {
        return;
      }

      clearCareerPagePreviewObjectUrls();

      let logoUrl = currentCareerPageSettings.logoUrl;
      let heroImageUrl = currentCareerPageSettings.heroImageUrl;

      if (logoFile) {
        logoUrl = URL.createObjectURL(logoFile);
        careerPagePreviewObjectUrls.push(logoUrl);
      }

      if (heroFile) {
        heroImageUrl = URL.createObjectURL(heroFile);
        careerPagePreviewObjectUrls.push(heroImageUrl);
      }

      renderCareerPagePublicContent(
        careerPagePreviewContainer,
        {
          introduction: careerPageIntroductionInput
            ? careerPageIntroductionInput.value
            : '',
          logoUrl,
          heroImageUrl
        }
      );
    });
  }
  if (careerPageSaveBtn) {
    careerPageSaveBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const logoFile =
        careerPageLogoInput &&
        careerPageLogoInput.files &&
        careerPageLogoInput.files[0];

      const heroFile =
        careerPageHeroInput &&
        careerPageHeroInput.files &&
        careerPageHeroInput.files[0];

      if (
        !validateCareerPageImage(logoFile, 'Logo công ty') ||
        !validateCareerPageImage(heroFile, 'Ảnh giới thiệu')
      ) {
        return;
      }

      const originalButtonText = careerPageSaveBtn.textContent;
      careerPageSaveBtn.disabled = true;
      careerPageSaveBtn.textContent = 'Đang lưu...';

      try {
        let logoUrl = currentCareerPageSettings.logoUrl;
        let heroImageUrl = currentCareerPageSettings.heroImageUrl;

        if (logoFile) {
          const logoRes = await window.ATS_API.uploadCareerPageMediaApi(
            token,
            'logo',
            logoFile
          );

          if (
            !logoRes.ok ||
            !logoRes.data ||
            !logoRes.data.success ||
            !logoRes.data.data ||
            !logoRes.data.data.url
          ) {
            throw new Error(
              (logoRes.data && logoRes.data.message) ||
              'Không thể tải logo công ty.'
            );
          }

          logoUrl = logoRes.data.data.url;
        }

        if (heroFile) {
          const heroRes = await window.ATS_API.uploadCareerPageMediaApi(
            token,
            'hero',
            heroFile
          );

          if (
            !heroRes.ok ||
            !heroRes.data ||
            !heroRes.data.success ||
            !heroRes.data.data ||
            !heroRes.data.data.url
          ) {
            throw new Error(
              (heroRes.data && heroRes.data.message) ||
              'Không thể tải ảnh giới thiệu.'
            );
          }

          heroImageUrl = heroRes.data.data.url;
        }

        const saveRes = await window.ATS_API.updateCareerPageApi(
          token,
          {
            introduction: careerPageIntroductionInput
              ? careerPageIntroductionInput.value
              : '',
            logoUrl,
            heroImageUrl
          }
        );

        if (!saveRes.ok || !saveRes.data || !saveRes.data.success) {
          throw new Error(
            (saveRes.data && saveRes.data.message) ||
            'Không thể lưu cấu hình trang tuyển dụng.'
          );
        }

        const saved = saveRes.data.data || {};

        currentCareerPageSettings = {
          introduction: saved.introduction || '',
          logoUrl: saved.logoUrl || null,
          heroImageUrl: saved.heroImageUrl || null,
          updatedAt: saved.updatedAt || null
        };

        if (careerPageIntroductionInput) {
          careerPageIntroductionInput.value =
            currentCareerPageSettings.introduction;
        }

        if (careerPageLogoInput) {
          careerPageLogoInput.value = '';
        }

        if (careerPageHeroInput) {
          careerPageHeroInput.value = '';
        }

        if (careerPageLogoStatus) {
          careerPageLogoStatus.textContent =
            currentCareerPageSettings.logoUrl
              ? 'Đang sử dụng logo đã lưu. Chọn tệp mới nếu muốn thay thế.'
              : 'JPG hoặc PNG, tối đa 5 MB.';
        }

        if (careerPageHeroStatus) {
          careerPageHeroStatus.textContent =
            currentCareerPageSettings.heroImageUrl
              ? 'Đang sử dụng ảnh giới thiệu đã lưu. Chọn tệp mới nếu muốn thay thế.'
              : 'JPG hoặc PNG, tối đa 5 MB.';
        }

        clearCareerPagePreviewObjectUrls();

        renderCareerPagePublicContent(
          careerPagePreviewContainer,
          currentCareerPageSettings
        );

        showToast(
          'success',
          'Đã lưu trang giới thiệu',
          'Nội dung trang giới thiệu công ty đã được cập nhật.'
        );
      } catch (error) {
        showToast(
          'error',
          'Không thể lưu',
          error.message || 'Không thể lưu cấu hình trang tuyển dụng.'
        );
      } finally {
        careerPageSaveBtn.disabled = false;
        careerPageSaveBtn.textContent = originalButtonText;
      }
    });
  }

  async function loadPublicCareerPage() {
    const container = document.getElementById('public-career-page-content');
    if (!container) return;

    try {
      const res = await window.ATS_API.getPublicCareerPageApi();

      if (!res.ok || !res.data || !res.data.success) {
        container.innerHTML = '';
        return;
      }

      const data = res.data.data || {};

      renderCareerPagePublicContent(container, {
        introduction: data.introduction || '',
        logoUrl: data.logoUrl || null,
        heroImageUrl: data.heroImageUrl || null
      });
    } catch {
      container.innerHTML = '';
    }
  }
