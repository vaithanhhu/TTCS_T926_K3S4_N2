  // S2. DEPARTMENTS & ORGANIZATION MANAGEMENT
  // ==============================================================================

  const departmentsTreeContainer = document.getElementById('departments-tree-container');
  const departmentsTotalBadge = document.getElementById('departments-total-badge');
  const departmentForm = document.getElementById('department-form');
  const departmentFormTitle = document.getElementById('department-form-title');
  const departmentIdInput = document.getElementById('department-id-input');
  const departmentCodeInput = document.getElementById('department-code-input');
  const departmentNameInput = document.getElementById('department-name-input');
  const departmentParentSelect = document.getElementById('department-parent-select');
  const departmentManagerSelect = document.getElementById('department-manager-select');
  const departmentFormAlert = document.getElementById('department-form-alert');
  const departmentFormAlertMsg = document.getElementById('department-form-alert-msg');
  const departmentNewBtn = document.getElementById('department-new-btn');
  const departmentResetBtn = document.getElementById('department-reset-btn');
  const departmentSaveBtn = document.getElementById('department-save-btn');

  let currentDepartments = [];
  let currentDepartmentTree = [];
  let currentDepartmentUsers = [];
  let departmentActionPermissions = new Set();
  let departmentsLoadVersion = 0;
  const departmentPendingActions = new Set();

  function getDepartmentNodeActions(department) {
    if (!departmentActionPermissions.has('department.manage')) return [];
    return [
      { code: 'edit', label: 'Sửa', icon: '✎' },
      ...(department.status === 'ACTIVE'
        ? [{ code: 'deactivate', label: 'Ngừng áp dụng', icon: '⊖', tone: 'warning' }]
        : []),
      { code: 'delete', label: 'Xóa', icon: '×', tone: 'danger' }
    ];
  }

  function toggleDepartmentActionMenu(trigger) {
    const department = currentDepartments.find(item => item.id === trigger.getAttribute('data-department-id'));
    const token = sessionStorage.getItem('ats_token');
    if (!department || !token) return;
    window.ATS_ACTION_MENU.toggle({
      owner: 'departments', trigger, label: 'Thao tác phòng ban',
      items: getDepartmentNodeActions(department), itemAttribute: 'data-department-action',
      valid: () => token === sessionStorage.getItem('ats_token') && currentActiveView === 'departments',
      onSelect: async code => {
        if (!getDepartmentNodeActions(department).some(action => action.code === code)) return;
        if (code === 'edit') { editDepartment(department.id); return; }
        const key = code + ':' + department.id;
        if (departmentPendingActions.has(key)) return;
        departmentPendingActions.add(key);
        try {
          if (code === 'deactivate') await deactivateDepartment(department.id);
          else if (code === 'delete') await deleteDepartment(department.id);
        } finally { departmentPendingActions.delete(key); }
      }
    });
  }

  function escapeDepartmentHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function flattenDepartmentTree(nodes, depth = 0, result = []) {
    nodes.forEach(node => {
      result.push({ department: node, depth });
      flattenDepartmentTree(node.children || [], depth + 1, result);
    });

    return result;
  }

  function hideDepartmentFormError() {
    if (departmentFormAlert) departmentFormAlert.classList.add('hidden');
    if (departmentFormAlertMsg) departmentFormAlertMsg.textContent = '';
  }

  function showDepartmentFormError(message) {
    if (departmentFormAlertMsg) {
      departmentFormAlertMsg.textContent =
        message || 'Không thể xử lý phòng ban.';
    }

    if (departmentFormAlert) {
      departmentFormAlert.classList.remove('hidden');
    }
  }

  function populateDepartmentFormOptions(editingId = null) {
    if (departmentParentSelect) {
      const options = flattenDepartmentTree(currentDepartmentTree)
        .filter(item => item.department.id !== editingId)
        .map(item => {
          const department = item.department;
          const prefix = item.depth > 0 ? '— '.repeat(item.depth) : '';
          const inactiveLabel =
            department.status === 'INACTIVE'
              ? ' (Ngừng áp dụng)'
              : '';

          return `
            <option value="${escapeDepartmentHtml(department.id)}">${escapeDepartmentHtml(prefix + department.name + inactiveLabel)}</option>
          `;
        })
        .join('');

      departmentParentSelect.innerHTML =
        '<option value="">-- Cấp cao nhất --</option>' + options;
    }

    if (departmentManagerSelect) {
      const managerOptions = currentDepartmentUsers
        .map(user => {
          const label =
            user.fullName ||
            user.full_name ||
            user.email ||
            user.id;

          const email =
            user.email && user.email !== label
              ? ` (${escapeDepartmentHtml(user.email)})`
              : '';

          return `
            <option value="${escapeDepartmentHtml(user.id)}">${escapeDepartmentHtml(label)}${email}</option>
          `;
        })
        .join('');

      departmentManagerSelect.innerHTML =
        '<option value="">-- Chọn người phụ trách --</option>' +
        managerOptions;
    }
  }

  function resetDepartmentForm() {
    if (departmentForm) departmentForm.reset();
    if (departmentIdInput) departmentIdInput.value = '';

    if (departmentFormTitle) {
      departmentFormTitle.textContent = 'Thêm phòng ban';
    }

    if (departmentSaveBtn) {
      departmentSaveBtn.textContent = 'Lưu phòng ban';
    }

    hideDepartmentFormError();
    populateDepartmentFormOptions();
  }

  function editDepartment(departmentId) {
    const department = currentDepartments.find(
      item => item.id === departmentId
    );

    if (!department) return;

    populateDepartmentFormOptions(department.id);

    if (departmentIdInput) {
      departmentIdInput.value = department.id;
    }

    if (departmentCodeInput) {
      departmentCodeInput.value = department.code || '';
    }

    if (departmentNameInput) {
      departmentNameInput.value = department.name || '';
    }

    if (departmentParentSelect) {
      departmentParentSelect.value = department.parentId || '';
    }

    if (departmentManagerSelect) {
      departmentManagerSelect.value =
        department.manager && department.manager.id
          ? department.manager.id
          : '';
    }

    if (departmentFormTitle) {
      departmentFormTitle.textContent = 'Cập nhật phòng ban';
    }

    if (departmentSaveBtn) {
      departmentSaveBtn.textContent = 'Cập nhật';
    }

    hideDepartmentFormError();

    if (departmentCodeInput) {
      departmentCodeInput.focus();
    }
  }

  function renderDepartmentTree() {
    window.ATS_ACTION_MENU.close(false, 'departments');
    if (!departmentsTreeContainer) return;

    if (currentDepartmentTree.length === 0) {
      departmentsTreeContainer.innerHTML = `
        <div style="text-align: center; color: var(--color-text-muted); padding: 24px;">
          Chưa có phòng ban nào.
        </div>
      `;
      return;
    }

    const renderNodes = (nodes, depth = 0) =>
      nodes.map(department => {
        const managerName =
          department.manager
            ? (
                department.manager.fullName ||
                department.manager.email ||
                'Chưa xác định'
              )
            : 'Chưa xác định';

        const isActive = department.status === 'ACTIVE';
        const openCount = Number(
          department.openRequisitionCount || 0
        );

        return `
          <div style="
            margin-left: ${depth * 22}px;
            margin-bottom: 10px;
            padding: 12px;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            ${depth > 0
              ? 'border-left: 3px solid var(--color-primary);'
              : ''}
          ">
            <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;">
              <div style="min-width: 0;">
                <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                  <strong>${escapeDepartmentHtml(department.name)}</strong>

                  <span class="badge badge-primary font-mono">
                    ${escapeDepartmentHtml(department.code)}
                  </span>

                  <span class="badge ${isActive
                    ? 'badge-success'
                    : 'badge-warning'}">
                    ${isActive
                      ? 'Đang áp dụng'
                      : 'Ngừng áp dụng'}
                  </span>
                </div>

                <div style="font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 6px;">
                  Người phụ trách:
                  <strong>${escapeDepartmentHtml(managerName)}</strong>
                </div>

                <div style="font-size: 0.775rem; color: var(--color-text-muted); margin-top: 4px;">
                  Yêu cầu tuyển dụng đang mở: ${openCount}
                </div>
              </div>

              <button type="button" class="btn btn-outline btn-xs action-menu-trigger department-action-trigger"
                data-department-id="${escapeDepartmentHtml(department.id)}"
                title="Thao tác" aria-label="Thao tác" aria-haspopup="menu"
                aria-controls="users-action-menu" aria-expanded="false"
                ${getDepartmentNodeActions(department).length ? '' : 'disabled'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16"></path>
                </svg>
              </button>
            </div>
          </div>

          ${renderNodes(department.children || [], depth + 1)}
        `;
      }).join('');

    departmentsTreeContainer.innerHTML =
      renderNodes(currentDepartmentTree);
  }

  async function loadDepartments() {
    window.ATS_ACTION_MENU.close(false, 'departments');
    departmentActionPermissions.clear();
    const version = ++departmentsLoadVersion;
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (departmentsTreeContainer) {
      departmentsTreeContainer.innerHTML = `
        <div style="text-align: center; color: var(--color-text-muted); padding: 24px;">
          Đang tải phòng ban...
        </div>
      `;
    }

    try {
      const [departmentsRes, usersRes, permissionsRes] = await Promise.all([
        window.ATS_API.getDepartmentsApi(token),
        window.ATS_API.getUsersApi(token, {
          page: 1,
          limit: 100,
          status: 'ACTIVE'
        }),
        window.ATS_API.getPermissionsApi(token)
      ]);
      if (version !== departmentsLoadVersion || token !== sessionStorage.getItem('ats_token')) return;
      departmentActionPermissions = new Set(permissionsRes.ok && Array.isArray(permissionsRes.data?.permissions) ? permissionsRes.data.permissions : []);

      if (
        !departmentsRes.ok ||
        !departmentsRes.data ||
        !departmentsRes.data.success
      ) {
        throw new Error(
          departmentsRes.data &&
          departmentsRes.data.message
            ? departmentsRes.data.message
            : 'Không thể tải danh sách phòng ban.'
        );
      }

      currentDepartments =
        departmentsRes.data.departments || [];

      currentDepartmentTree =
        departmentsRes.data.tree || [];

      if (
        usersRes.ok &&
        usersRes.data &&
        usersRes.data.success
      ) {
        const userData = usersRes.data.data || {};

        currentDepartmentUsers =
          userData.items ||
          userData.users ||
          [];
      } else {
        currentDepartmentUsers = [];
      }

      if (departmentsTotalBadge) {
        departmentsTotalBadge.textContent =
          `${departmentsRes.data.total || currentDepartments.length} phòng ban`;
      }

      renderDepartmentTree();

      const editingId =
        departmentIdInput
          ? departmentIdInput.value
          : '';

      populateDepartmentFormOptions(
        editingId || null
      );
    } catch (error) {
      console.error(
        'Failed to load departments:',
        error
      );

      if (departmentsTreeContainer) {
        departmentsTreeContainer.innerHTML = `
          <div style="text-align: center; color: var(--color-danger); padding: 24px;">
            ${escapeDepartmentHtml(
              error.message ||
              'Không thể tải phòng ban.'
            )}
          </div>
        `;
      }
    }
  }

  async function deactivateDepartment(
    departmentId,
    skipConfirm = false
  ) {
    const token =
      sessionStorage.getItem('ats_token');

    if (!token || !departmentId) return;

    if (
      !skipConfirm &&
      !window.confirm(
        'Ngừng áp dụng phòng ban này?'
      )
    ) {
      return;
    }

    try {
      const res =
        await window.ATS_API.deactivateDepartmentApi(
          token,
          departmentId
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        showToast(
          'success',
          'Đã ngừng áp dụng',
          res.data.message ||
            'Phòng ban đã được ngừng áp dụng.'
        );

        resetDepartmentForm();
        await loadDepartments();
      } else {
        showToast(
          'error',
          'Không thể ngừng áp dụng',
          (res.data && res.data.message) ||
            'Không thể cập nhật phòng ban.'
        );
      }
    } catch (error) {
      showToast(
        'error',
        'Lỗi',
        error.message
      );
    }
  }

  async function deleteDepartment(departmentId) {
    const token =
      sessionStorage.getItem('ats_token');

    if (!token || !departmentId) return;

    if (
      !window.confirm(
        'Bạn có chắc muốn xóa phòng ban này?'
      )
    ) {
      return;
    }

    try {
      const res =
        await window.ATS_API.deleteDepartmentApi(
          token,
          departmentId
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        showToast(
          'success',
          'Đã xóa phòng ban',
          res.data.message ||
            'Xóa phòng ban thành công.'
        );

        resetDepartmentForm();
        await loadDepartments();
        return;
      }

      if (
        res.data &&
        res.data.code ===
          'DEPARTMENT_HAS_OPEN_REQUISITIONS' &&
        res.data.canDeactivate === true
      ) {
        const shouldDeactivate =
          window.confirm(
            `${res.data.message}\n\nBạn có muốn ngừng áp dụng phòng ban này thay thế không?`
          );

        if (shouldDeactivate) {
          await deactivateDepartment(
            departmentId,
            true
          );
        }

        return;
      }

      showToast(
        'error',
        'Không thể xóa phòng ban',
        (res.data && res.data.message) ||
          'Không thể xóa phòng ban.'
      );
    } catch (error) {
      showToast(
        'error',
        'Lỗi',
        error.message
      );
    }
  }

  if (departmentForm) {
    departmentForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token =
          sessionStorage.getItem('ats_token');

        if (!token) return;

        hideDepartmentFormError();

        const departmentId =
          departmentIdInput
            ? departmentIdInput.value.trim()
            : '';

        const payload = {
          code: departmentCodeInput
            ? departmentCodeInput.value.trim()
            : '',

          name: departmentNameInput
            ? departmentNameInput.value.trim()
            : '',

          parentId: departmentParentSelect
            ? departmentParentSelect.value || null
            : null,

          managerId: departmentManagerSelect
            ? departmentManagerSelect.value
            : ''
        };

        if (
          !payload.code ||
          !payload.name ||
          !payload.managerId
        ) {
          showDepartmentFormError(
            'Vui lòng nhập mã, tên phòng ban và chọn người phụ trách.'
          );
          return;
        }

        if (departmentSaveBtn) {
          departmentSaveBtn.disabled = true;
        }

        try {
          const res = departmentId
            ? await window.ATS_API.updateDepartmentApi(
                token,
                departmentId,
                payload
              )
            : await window.ATS_API.createDepartmentApi(
                token,
                payload
              );

          if (
            res.ok &&
            res.data &&
            res.data.success
          ) {
            showToast(
              'success',
              departmentId
                ? 'Cập nhật thành công'
                : 'Tạo thành công',
              res.data.message ||
                'Đã lưu phòng ban.'
            );

            resetDepartmentForm();
            await loadDepartments();
          } else {
            showDepartmentFormError(
              (res.data && res.data.message) ||
                'Không thể lưu phòng ban.'
            );
          }
        } catch (error) {
          showDepartmentFormError(
            error.message
          );
        } finally {
          if (departmentSaveBtn) {
            departmentSaveBtn.disabled = false;
          }
        }
      }
    );
  }

  departmentsTreeContainer?.addEventListener('click', event => {
    const trigger = event.target.closest('.department-action-trigger');
    if (trigger && departmentsTreeContainer.contains(trigger)) toggleDepartmentActionMenu(trigger);
  });

  if (departmentNewBtn) {
    departmentNewBtn.addEventListener(
      'click',
      () => {
        resetDepartmentForm();

        if (departmentCodeInput) {
          departmentCodeInput.focus();
        }
      }
    );
  }

  if (departmentResetBtn) {
    departmentResetBtn.addEventListener(
      'click',
      resetDepartmentForm
    );
  }
