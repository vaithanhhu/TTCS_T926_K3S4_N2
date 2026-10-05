  // ==============================================================================
  // 15. USER PROFILE VIEW
  // ==============================================================================

  const avatarRenderVersions = new WeakMap();
  function renderUserAvatar(element, user, fallbackText, cacheBust = '') {
    if (!element) return;

    const initial = String(fallbackText || 'U').charAt(0).toUpperCase();
    element.textContent = initial;
    const renderVersion = {};
    avatarRenderVersions.set(element, renderVersion);

    const avatarUrl = user?.thumbnailUrl || user?.avatarUrl;
    if (typeof avatarUrl !== 'string' || !/^\/public\/avatars\/avatar-[a-zA-Z0-9_-]+\.png$/.test(avatarUrl)) return;

    const image = document.createElement('img');
    const version = cacheBust ? `?v=${cacheBust}` : '';

    image.src = avatarUrl + version;
    image.alt = 'Ảnh đại diện';
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'cover';
    image.style.borderRadius = 'inherit';
    image.style.display = 'block';

    image.addEventListener('load', () => {
      if (avatarRenderVersions.get(element) !== renderVersion) return;
      element.textContent = '';
      element.style.overflow = 'hidden';
      element.appendChild(image);
    }, { once: true });

    image.addEventListener('error', () => {
      if (avatarRenderVersions.get(element) !== renderVersion) return;
      element.textContent = initial;
    }, { once: true });
  }
  async function loadUserProfile() {
    if (!currentAuthenticatedUser) return;
    const profileUser = currentAuthenticatedUser;
    const token = sessionStorage.getItem('ats_token');

    // Attempt live profile sync from backend
    if (token) {
      try {
        const res = await window.ATS_API.getProfileApi(token);
        if (token !== sessionStorage.getItem('ats_token') || profileUser !== currentAuthenticatedUser) return;
        if (res.ok && res.data && res.data.success && res.data.data) {
          const freshUser = res.data.data;
          currentAuthenticatedUser.fullName = freshUser.fullName || freshUser.full_name;
          currentAuthenticatedUser.jobTitle = freshUser.jobTitle || freshUser.job_title;
          currentAuthenticatedUser.phoneNumber = freshUser.phoneNumber || freshUser.phone_number;
          currentAuthenticatedUser.department = freshUser.departmentName || freshUser.department_name;
          currentAuthenticatedUser.avatarUrl = freshUser.avatarUrl || null;
          currentAuthenticatedUser.thumbnailUrl = freshUser.thumbnailUrl || null;
          sessionStorage.setItem('ats_user', JSON.stringify(currentAuthenticatedUser));
        }
      } catch {}
    }

    if (profileUser !== currentAuthenticatedUser || token !== sessionStorage.getItem('ats_token')) return;
    const u = currentAuthenticatedUser;
    const avatar = document.getElementById('profile-card-avatar');
    const name = document.getElementById('profile-card-name');
    const email = document.getElementById('profile-card-email');
    const title = document.getElementById('profile-card-title');
    const dept = document.getElementById('profile-card-dept');
    const phone = document.getElementById('profile-card-phone');
    const rolesContainer = document.getElementById('profile-card-roles');

    renderUserAvatar(avatar, u, u.fullName || u.email);
    renderUserAvatar(topbarUserAvatar, u, u.fullName || u.email);
    renderUserAvatar(sidebarUserAvatar, u, u.fullName || u.email);
    if (name) name.textContent = u.fullName || 'Người dùng';
    if (email) email.textContent = u.email;
    if (title) title.textContent = u.jobTitle || 'Chưa cập nhật';
    if (dept) dept.textContent = u.department || 'Chưa cập nhật';
    if (phone) phone.textContent = u.phoneNumber || u.phone || 'Chưa cập nhật';

    if (rolesContainer) {
      rolesContainer.innerHTML = (u.roles || []).map(r => `
        <span class="badge badge-primary font-mono">${ROLE_LABELS[r] || r}</span>
      `).join(' ');
    }
  }

  const profileOpenChangePwdBtn = document.getElementById('profile-open-change-pwd-btn');
  if (profileOpenChangePwdBtn) {
    profileOpenChangePwdBtn.addEventListener('click', () => openChangePwdModal());
  }

  const profileAvatarUploadBtn = document.getElementById('profile-avatar-upload-btn');
  const profileAvatarInput = document.getElementById('profile-avatar-input');

  if (profileAvatarUploadBtn && profileAvatarInput) {
    profileAvatarUploadBtn.addEventListener('click', () => {
      profileAvatarInput.click();
    });

    profileAvatarInput.addEventListener('change', async () => {
      const file = profileAvatarInput.files && profileAvatarInput.files[0];

      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png'];
      const maxFileSize = 2 * 1024 * 1024;

      if (!allowedTypes.includes(file.type)) {
        showToast(
          'warning',
          'Ảnh không hợp lệ',
          'Chỉ chấp nhận ảnh JPG hoặc PNG.'
        );
        profileAvatarInput.value = '';
        return;
      }

      if (file.size > maxFileSize) {
        showToast(
          'warning',
          'Ảnh quá lớn',
          'Ảnh đại diện không được vượt quá 2MB.'
        );
        profileAvatarInput.value = '';
        return;
      }

      const token = sessionStorage.getItem('ats_token');

      if (!token || !currentAuthenticatedUser) {
        profileAvatarInput.value = '';
        return;
      }

      const originalButtonText = profileAvatarUploadBtn.textContent;
      const uploadUser = currentAuthenticatedUser;
      profileAvatarUploadBtn.disabled = true;
      profileAvatarUploadBtn.textContent = 'Đang tải...';

      try {
        const res = await window.ATS_API.uploadAvatarApi(token, file);
        if (token !== sessionStorage.getItem('ats_token') || uploadUser !== currentAuthenticatedUser) return;

        if (res.ok && res.data && res.data.success) {
          currentAuthenticatedUser.avatarUrl = res.data.data?.avatarUrl || null;
          currentAuthenticatedUser.thumbnailUrl = res.data.data?.thumbnailUrl || null;
          sessionStorage.setItem('ats_user', JSON.stringify(currentAuthenticatedUser));
          const cacheBust = Date.now();
          const fallbackText =
            currentAuthenticatedUser.fullName ||
            currentAuthenticatedUser.email ||
            'U';

          renderUserAvatar(
            document.getElementById('profile-card-avatar'),
            currentAuthenticatedUser,
            fallbackText,
            cacheBust
          );

          renderUserAvatar(
            topbarUserAvatar,
            currentAuthenticatedUser,
            fallbackText,
            cacheBust
          );

          renderUserAvatar(
            sidebarUserAvatar,
            currentAuthenticatedUser,
            fallbackText,
            cacheBust
          );

          showToast(
            'success',
            'Đã cập nhật ảnh đại diện',
            'Ảnh đại diện đã được tải lên thành công.'
          );
        } else {
          showToast(
            'error',
            'Không thể cập nhật ảnh',
            (res.data && res.data.message) || 'Không thể tải ảnh đại diện.'
          );
        }
      } catch (err) {
        showToast(
          'error',
          'Lỗi tải ảnh',
          err.message || 'Không thể tải ảnh đại diện.'
        );
      } finally {
        profileAvatarUploadBtn.disabled = false;
        profileAvatarUploadBtn.textContent = originalButtonText;
        profileAvatarInput.value = '';
      }
    });
  }
  // Edit Profile Modal Wiring
  const profileEditBtn = document.getElementById('profile-edit-btn');
  const editProfileModal = document.getElementById('edit-profile-modal');
  const closeEditProfileModal = document.getElementById('close-edit-profile-modal');
  const cancelEditProfileBtn = document.getElementById('cancel-edit-profile-btn');
  const editProfileForm = document.getElementById('edit-profile-form');
  const editProfileAlert = document.getElementById('edit-profile-alert');
  const editProfileAlertMsg = document.getElementById('edit-profile-alert-msg');
  const editProfileNameInput = document.getElementById('edit-profile-name-input');
  const editProfileTitleInput = document.getElementById('edit-profile-title-input');
  const editProfilePhoneInput = document.getElementById('edit-profile-phone-input');

  function openEditProfileModal() {
    if (!editProfileModal || !currentAuthenticatedUser) return;
    if (editProfileAlert) editProfileAlert.classList.add('hidden');
    editProfileNameInput.value = currentAuthenticatedUser.fullName || '';
    editProfileTitleInput.value = currentAuthenticatedUser.jobTitle || '';
    editProfilePhoneInput.value = currentAuthenticatedUser.phoneNumber || currentAuthenticatedUser.phone || '';
    editProfileModal.classList.remove('hidden');
  }

  if (profileEditBtn) profileEditBtn.addEventListener('click', openEditProfileModal);
  if (closeEditProfileModal) closeEditProfileModal.addEventListener('click', () => editProfileModal.classList.add('hidden'));
  if (cancelEditProfileBtn) cancelEditProfileBtn.addEventListener('click', () => editProfileModal.classList.add('hidden'));

  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const fullName = editProfileNameInput.value.trim();
      const jobTitle = editProfileTitleInput.value.trim();
      const phoneNumber = editProfilePhoneInput.value
        .trim()
        .replace(/[\s.-]/g, '');

      const vietnamPhoneRegex =
        /^(?:0|\+84)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;

      if (phoneNumber && !vietnamPhoneRegex.test(phoneNumber)) {
        if (editProfileAlert && editProfileAlertMsg) {
          editProfileAlertMsg.textContent =
            'Số điện thoại Việt Nam không đúng định dạng.';
          editProfileAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.updateProfileApi(token, { fullName, jobTitle, phoneNumber });
        if (res.ok && res.data && res.data.success) {
          editProfileModal.classList.add('hidden');
          showToast('success', 'Đã lưu hồ sơ', 'Thông tin cá nhân của bạn đã được cập nhật thành công.');
          currentAuthenticatedUser.fullName = fullName;
          currentAuthenticatedUser.jobTitle = jobTitle;
          currentAuthenticatedUser.phoneNumber = phoneNumber;
          currentAuthenticatedUser.phone = phoneNumber;
          sessionStorage.setItem('ats_user', JSON.stringify(currentAuthenticatedUser));
          loadUserProfile();
          const topbarName = document.getElementById('topbar-user-name');
          const sidebarName = document.getElementById('sidebar-user-name');
          const userDisplay = document.getElementById('user-display-name');
          if (topbarName) topbarName.textContent = fullName;
          if (sidebarName) sidebarName.textContent = fullName;
          if (userDisplay) userDisplay.textContent = fullName;
        } else {
          if (editProfileAlert && editProfileAlertMsg) {
            editProfileAlertMsg.textContent = res.data.message || 'Không thể cập nhật hồ sơ.';
            editProfileAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (editProfileAlert && editProfileAlertMsg) {
          editProfileAlertMsg.textContent = err.message;
          editProfileAlert.classList.remove('hidden');
        }
      }
    });
  }
