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

  let usersCurrentPage = 1;
  let usersCurrentLimit = 20;

  let usersRows = new Map();
  let usersActionPermissions = new Set();
  let usersLoadVersion = 0;
  const usersPendingActions = new Set();
  const USER_ROW_ACTIONS = [
    { code: 'edit', label: 'Sửa', permission: 'user.update', icon: '✎' },
    { code: 'roles', label: 'Phân quyền', permission: 'role.assign', icon: '♙' },
    { code: 'reset', label: 'Reset MK', permission: 'user.create', icon: '↻', tone: 'warning' },
    { code: 'lock', label: 'Khóa', permission: 'account.lock', icon: '⊖', tone: 'danger' },
    { code: 'unlock', label: 'Mở khóa', permission: 'account.unlock', icon: '↻', tone: 'success' },
    // Match the existing DELETE endpoint guard; do not change backend RBAC here.
    { code: 'delete', label: 'Xóa', permission: 'user.create', icon: '×', tone: 'danger' }
  ];

  function escapeUserHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function getUserRowActions(user) {
    return USER_ROW_ACTIONS.filter(action => usersActionPermissions.has(action.permission) &&
      (action.code !== 'lock' || user.status !== 'LOCKED') &&
      (action.code !== 'unlock' || user.status === 'LOCKED'));
  }

  function closeUsersActionMenu(restoreFocus = false) {
    window.ATS_ACTION_MENU.close(restoreFocus, 'users');
  }

  function toggleUsersActionMenu(trigger) {
    const user = usersRows.get(trigger.getAttribute('data-user-id'));
    const token = sessionStorage.getItem('ats_token');
    if (!user || !token) return;
    window.ATS_ACTION_MENU.toggle({
      owner: 'users', trigger, label: 'Thao tác tài khoản',
      items: getUserRowActions(user), itemAttribute: 'data-user-action',
      valid: () => token === sessionStorage.getItem('ats_token') && currentActiveView === 'users',
      onSelect: code => runUsersRowAction(code, user, token)
    });
  }

  async function runUsersRowAction(code, user, token) {
    if (!user || !token || token !== sessionStorage.getItem('ats_token') ||
        currentActiveView !== 'users' || !getUserRowActions(user).some(action => action.code === code)) {
      closeUsersActionMenu(); return;
    }
    const name = user.fullName || user.email;
    if (code === 'edit') { openEditUserModal(user); document.getElementById('edit-user-fullname')?.focus(); return; }
    if (code === 'roles') { openAssignRolesModal(user); document.getElementById('assign-roles-submit-btn')?.focus(); return; }
    if (code === 'lock') { openLockUserModal(user.id, name, user.email); document.getElementById('lock-reason-input')?.focus(); return; }
    if (code === 'reset') { openAdminResetPwdModal(user.id, name, user.email); document.getElementById('confirm-admin-reset-pwd-btn')?.focus(); return; }
    const key = code + ':' + user.id;
    if (usersPendingActions.has(key)) return;
    const confirmation = code === 'delete'
      ? `Bạn có chắc chắn muốn xóa tài khoản nhân sự ${name}? Hành động này không thể hoàn tác.`
      : `Bạn có chắc muốn mở khóa cho tài khoản ${name}?`;
    if (!confirm(confirmation)) return;
    usersPendingActions.add(key);
    try {
      const res = code === 'delete'
        ? await window.ATS_API.deleteUserApi(token, user.id)
        : await window.ATS_API.unlockUserApi(token, user.id);
      if (token !== sessionStorage.getItem('ats_token')) return;
      if (res.ok && res.data?.success) {
        if (code === 'delete') showToast('success', 'Đã xóa tài khoản', `Tài khoản ${name} đã được xóa thành công.`);
        else showToast('success', 'Mở khóa thành công', `Tài khoản ${name} đã được mở khóa và có thể đăng nhập bình thường.`);
        await loadUsers();
        if (code === 'delete') loadDashboardData();
      } else {
        showToast('danger', code === 'delete' ? 'Lỗi xóa' : 'Lỗi mở khóa',
          res.data?.message || (code === 'delete' ? 'Không thể xóa tài khoản.' : 'Không thể mở khóa tài khoản.'));
      }
    } catch (error) {
      showToast('danger', 'Lỗi kết nối', error.message);
    } finally {
      usersPendingActions.delete(key);
    }
  }

  usersTableBody?.addEventListener('click', event => {
    const trigger = event.target.closest('.users-action-trigger');
    if (trigger && usersTableBody.contains(trigger)) toggleUsersActionMenu(trigger);
  });

  function updateUsersPagination(pagination = {}, itemCount = 0) {
    const integer = (value, fallback, minimum) => Number.isSafeInteger(Number(value)) && Number(value) >= minimum ? Number(value) : fallback;
    // Prefer the current API contract; retain compatibility with older list fixtures/consumers.
    const totalItems = integer(pagination.totalItems ?? pagination.total, itemCount, 0);
    const limit = integer(pagination.limit, usersCurrentLimit, 1);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const currentPage = Math.min(totalPages, integer(pagination.currentPage ?? pagination.page, usersCurrentPage, 1));
    usersCurrentPage = currentPage;
    if (usersTotalBadge) usersTotalBadge.textContent = `${totalItems} tài khoản`;
    const from = totalItems === 0 ? 0 : (currentPage - 1) * limit + 1;
    const to = Math.min(currentPage * limit, totalItems);
    if (usersPageInfo) usersPageInfo.textContent = `Hiển thị ${from} - ${to} trên ${totalItems} tài khoản`;
    if (usersCurrentPageBadge) usersCurrentPageBadge.textContent = `${currentPage} / ${totalPages}`;
    if (usersPrevBtn) usersPrevBtn.disabled = currentPage <= 1;
    if (usersNextBtn) usersNextBtn.disabled = currentPage >= totalPages;
  }

  function showUsersLoadFailure(message) {
    updateUsersPagination({ totalItems: 0, currentPage: 1 });
    if (usersTableBody) usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px;">${escapeUserHtml(message)}</td></tr>`;
    showToast('danger', 'Không thể tải danh sách tài khoản', escapeUserHtml(message));
  }

  async function loadUsers() {
    closeUsersActionMenu();
    usersRows.clear();
    usersActionPermissions.clear();
    const version = ++usersLoadVersion;
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = usersSearchInput ? usersSearchInput.value.trim() : '';
    const role = usersRoleFilter ? usersRoleFilter.value : 'ALL';
    const status = usersStatusFilter ? usersStatusFilter.value : 'ALL';

    if (usersTableBody) {
      usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách nhân viên...</td></tr>`;
    }

    try {
      const [res, permissionRes] = await Promise.all([window.ATS_API.getUsersApi(token, {
        page: usersCurrentPage,
        limit: usersCurrentLimit,
        search,
        role,
        status
      }), window.ATS_API.getPermissionsApi(token)]);
      if (version !== usersLoadVersion || token !== sessionStorage.getItem('ats_token')) return false;
      usersActionPermissions = new Set(permissionRes.ok && Array.isArray(permissionRes.data?.permissions) ? permissionRes.data.permissions : []);

      if (res.ok && res.data && res.data.success) {
        const users = res.data.data.items || res.data.data.users || [];
        usersRows = new Map(users.map(user => [user.id, user]));
        updateUsersPagination(res.data.data.pagination || {}, users.length);

        if (users.length === 0) {
          usersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy tài khoản nhân viên nào.</td></tr>`;
          return true;
        }

        usersTableBody.innerHTML = users.map(u => {
          const avatarLetter = (u.fullName || u.email).charAt(0).toUpperCase();
          const rolesHtml = (u.roles || []).map(r => `
            <span class="badge badge-primary font-mono" style="font-size: 0.725rem;">${escapeUserHtml(ROLE_LABELS[r] || r)}</span>
          `).join(' ');

          const isLocked = u.status === 'LOCKED';
          const statusBadge = isLocked ? `<span class="badge badge-danger">Đã khóa</span>` : `<span class="badge badge-success">Hoạt động</span>`;

          return `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div class="user-avatar-circle" data-user-avatar-id="${escapeUserHtml(u.id)}" style="width: 32px; height: 32px; font-size: 0.8rem;">${escapeUserHtml(avatarLetter)}</div>
                  <div>
                    <div style="font-weight: 600; color: var(--color-text);">${escapeUserHtml(u.fullName || '—')}</div>
                    <div style="font-size: 0.75rem; color: var(--color-text-muted);">Mã: ${escapeUserHtml(u.id.substring(0, 8))}...</div>
                  </div>
                </div>
              </td>
              <td><span class="font-mono" style="font-size: 0.825rem;">${escapeUserHtml(u.email)}</span></td>
              <td>
                <div>${escapeUserHtml(u.jobTitle || '—')}</div>
                <div style="font-size: 0.775rem; color: var(--color-text-muted);">${escapeUserHtml(u.department || '—')}</div>
              </td>
              <td><div style="display: flex; gap: 4px; flex-wrap: wrap;">${rolesHtml}</div></td>
              <td>${statusBadge}</td>
              <td class="users-actions-cell">
                <button type="button" class="btn btn-outline btn-xs action-menu-trigger users-action-trigger"
                  data-user-id="${escapeUserHtml(u.id)}" title="Thao tác" aria-label="Thao tác"
                  aria-haspopup="menu" aria-controls="users-action-menu" aria-expanded="false"
                  ${getUserRowActions(u).length ? '' : 'disabled'}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <path d="M4 6h16M4 12h16M4 18h16"></path>
                  </svg>
                </button>
              </td>
            </tr>
          `;
        }).join('');

        usersTableBody.querySelectorAll('[data-user-avatar-id]').forEach(element => {
          const user = usersRows.get(element.getAttribute('data-user-avatar-id'));
          if (user) renderUserAvatar(element, user, user.fullName || user.email, user.avatarVersion || '');
        });

        return true;
      }
      showUsersLoadFailure(res.status >= 500
        ? 'Không thể tải danh sách tài khoản. Vui lòng thử lại sau.'
        : res.data?.message || 'Không thể tải danh sách tài khoản. Vui lòng thử lại.');
      if (res.data?.code === 'SESSION_EXPIRED') handleSessionExpired();
      else if (res.status === 401) showErrorView({ ...res.data, statusCode: 401 });
    } catch (e) {
      if (version !== usersLoadVersion || token !== sessionStorage.getItem('ats_token')) return false;
      showUsersLoadFailure('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.');
    }
    return false;
  }

  if (usersSearchBtn) usersSearchBtn.addEventListener('click', () => { usersCurrentPage = 1; loadUsers(); });
  if (usersRoleFilter) usersRoleFilter.addEventListener('change', () => { usersCurrentPage = 1; loadUsers(); });
  if (usersStatusFilter) usersStatusFilter.addEventListener('change', () => { usersCurrentPage = 1; loadUsers(); });
  if (usersLimitSelect) {
    usersLimitSelect.addEventListener('change', () => {
      usersCurrentLimit = parseInt(usersLimitSelect.value, 10);
      usersCurrentPage = 1;
      loadUsers();
    });
  }
  if (usersPrevBtn) {
    usersPrevBtn.addEventListener('click', () => {
      if (usersCurrentPage > 1) {
        usersCurrentPage--;
        loadUsers();
      }
    });
  }
  if (usersNextBtn) {
    usersNextBtn.addEventListener('click', () => {
      usersCurrentPage++;
      loadUsers();
    });
  }
