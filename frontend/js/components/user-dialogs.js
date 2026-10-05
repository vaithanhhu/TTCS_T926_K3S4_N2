  // ==============================================================================
  // 16. MODALS LOGIC
  // ==============================================================================

  // Modal: Create User
  const openCreateUserModalBtn = document.getElementById('open-create-user-modal-btn');
  const createUserModal = document.getElementById('create-user-modal');
  const closeCreateUserModal = document.getElementById('close-create-user-modal');
  const createUserForm = document.getElementById('create-user-form');
  const createUserAlert = document.getElementById('create-user-alert');
  const createUserAlertMsg = document.getElementById('create-user-alert-msg');
  const createUserSubmitBtn = document.getElementById('create-user-submit-btn');
  let createUserPending = false;
  const createUserJobTitle = document.getElementById('create-user-jobtitle');
  const createUserDepartment = document.getElementById('create-user-department');
  let createUserCatalogVersion = 0;
  let createUserCatalogReady = false;
  let createUserJobTitles = new Map();
  let createUserDepartments = new Map();

  function populateCreateUserCatalog(select, items, placeholder) {
    const names = new Map();
    select.textContent = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.appendChild(empty);
    for (const item of items) {
      if (item.status !== 'ACTIVE' || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      names.set(item.id, item.name);
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    }
    if (names.size === 0) empty.textContent = 'Chưa có dữ liệu trong danh mục';
    select.value = '';
    return names;
  }

  async function loadCreateUserCatalogs() {
    const version = ++createUserCatalogVersion;
    const token = sessionStorage.getItem('ats_token');
    const openedPath = window.location.pathname;
    createUserCatalogReady = false;
    createUserJobTitles.clear();
    createUserDepartments.clear();
    for (const select of [createUserJobTitle, createUserDepartment]) {
      populateCreateUserCatalog(select, [], 'Đang tải danh mục…');
      select.children[0].textContent = 'Đang tải danh mục…';
      select.disabled = true;
    }
    createUserSubmitBtn.disabled = true;
    try {
      const [titles, departments] = await Promise.all([
        window.ATS_API.getJobTitlesApi(token), window.ATS_API.getDepartmentsApi(token)
      ]);
      if (version !== createUserCatalogVersion || token !== sessionStorage.getItem('ats_token') ||
          openedPath !== window.location.pathname || createUserModal.classList.contains('hidden')) return;
      if (!titles.ok || !titles.data?.success || !Array.isArray(titles.data.jobTitles) ||
          !departments.ok || !departments.data?.success || !Array.isArray(departments.data.departments)) {
        throw new Error('Không thể tải danh mục chức danh hoặc phòng ban. Vui lòng kiểm tra quyền truy cập và mở lại form để thử lại.');
      }
      createUserJobTitles = populateCreateUserCatalog(createUserJobTitle, titles.data.jobTitles, 'Chọn chức danh');
      createUserDepartments = populateCreateUserCatalog(createUserDepartment, departments.data.departments, 'Chọn phòng ban / đơn vị');
      createUserJobTitle.disabled = false;
      createUserDepartment.disabled = false;
      createUserCatalogReady = true;
      createUserSubmitBtn.disabled = createUserPending;
    } catch {
      if (version !== createUserCatalogVersion || token !== sessionStorage.getItem('ats_token') ||
          openedPath !== window.location.pathname || createUserModal.classList.contains('hidden')) return;
      populateCreateUserCatalog(createUserJobTitle, [], 'Chọn chức danh');
      populateCreateUserCatalog(createUserDepartment, [], 'Chọn phòng ban / đơn vị');
      createUserAlertMsg.textContent = 'Không thể tải danh mục chức danh hoặc phòng ban. Vui lòng kiểm tra quyền truy cập và mở lại form để thử lại.';
      createUserAlert.classList.remove('hidden');
    }
  }
  const createUserResultModal = document.getElementById('create-user-result-modal');
  const createUserResultPassword = document.getElementById('create-user-result-password');
  const createUserResultCopy = document.getElementById('create-user-result-copy');
  const createUserResultClose = document.getElementById('create-user-result-close');
  const createUserResultCopyStatus = document.getElementById('create-user-result-copy-status');

  function closeCreateUserResultDialog(restoreFocus = false) {
    const wasOpen = createUserResultModal && !createUserResultModal.classList.contains('hidden');
    createUserResultModal?.classList.add('hidden');
    if (createUserResultPassword) createUserResultPassword.textContent = '';
    if (createUserResultCopyStatus) createUserResultCopyStatus.textContent = '';
    if (createUserResultCopy) createUserResultCopy.disabled = true;
    if (wasOpen && restoreFocus) openCreateUserModalBtn?.focus();
  }

  function showCreateUserResultDialog(temporaryPassword) {
    if (!createUserResultModal) return;
    const hasPassword = typeof temporaryPassword === 'string' && temporaryPassword.length > 0;
    createUserResultPassword.textContent = hasPassword ? temporaryPassword : '';
    document.getElementById('create-user-result-credential').classList.toggle('hidden', !hasPassword);
    document.getElementById('create-user-result-message').textContent = hasPassword
      ? 'Tài khoản đã được tạo thành công.'
      : 'Tài khoản đã được tạo thành công. Backend không trả về mật khẩu tạm. Vui lòng sử dụng chức năng đặt lại mật khẩu.';
    createUserResultCopy.disabled = !hasPassword;
    createUserResultCopyStatus.textContent = '';
    createUserResultModal.classList.remove('hidden');
    (hasPassword ? createUserResultCopy : createUserResultClose).focus();
  }

  createUserResultClose?.addEventListener('click', () => closeCreateUserResultDialog(true));
  createUserResultCopy?.addEventListener('click', async () => {
    if (createUserResultModal.classList.contains('hidden') || !createUserResultPassword.textContent) return;
    const password = createUserResultPassword.textContent;
    try {
      await navigator.clipboard.writeText(password);
      if (!createUserResultModal.classList.contains('hidden') && createUserResultPassword.textContent === password) {
        createUserResultCopyStatus.textContent = 'Đã sao chép mật khẩu.';
      }
    } catch {
      if (!createUserResultModal.classList.contains('hidden') && createUserResultPassword.textContent === password) {
        createUserResultCopyStatus.textContent = 'Hãy chọn và sao chép mật khẩu trong ô phía trên.';
      }
    }
  });
  createUserResultModal?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeCreateUserResultDialog(true); }
    if (event.key === 'Tab') {
      const first = createUserResultCopy.disabled ? createUserResultClose : createUserResultPassword;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); createUserResultClose.focus(); }
      else if (!event.shiftKey && document.activeElement === createUserResultClose) { event.preventDefault(); first.focus(); }
    }
  });

  async function refreshUsersAfterAccountChange(token) {
    let refreshed = false;
    try { refreshed = await loadUsers(); } catch { /* Account mutation already succeeded. */ }
    if (refreshed === false && token === sessionStorage.getItem('ats_token')) {
      showToast('warning', 'Chưa tải lại được danh sách', 'Thao tác đã thành công nhưng danh sách tài khoản chưa được làm mới. Vui lòng tải lại danh sách.');
    }
  }

  if (openCreateUserModalBtn) {
    openCreateUserModalBtn.addEventListener('click', async () => {
      if (createUserPending) return;
      closeCreateUserResultDialog();
      if (createUserModal) createUserModal.classList.remove('hidden');
      if (createUserForm) createUserForm.reset();
      if (createUserAlert) createUserAlert.classList.add('hidden');
      if (createUserAlertMsg) createUserAlertMsg.textContent = '';
      await loadCreateUserCatalogs();
    });
  }

  if (closeCreateUserModal) {
    closeCreateUserModal.addEventListener('click', () => {
      createUserCatalogVersion++;
      if (createUserModal) createUserModal.classList.add('hidden');
    });
  }

  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (createUserPending || !createUserCatalogReady) return;
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;
      const submittedPath = window.location.pathname;

      const fullName = document.getElementById('create-user-fullname').value.trim();
      const email = document.getElementById('create-user-email').value.trim();
      const jobTitleId = createUserJobTitle.value;
      const departmentId = createUserDepartment.value;
      if ((jobTitleId && !createUserJobTitles.has(jobTitleId)) ||
          (departmentId && !createUserDepartments.has(departmentId))) {
        createUserAlertMsg.textContent = 'Vui lòng chọn chức danh và phòng ban từ danh mục hiện có.';
        createUserAlert.classList.remove('hidden');
        return;
      }
      // Existing create-user API stores names, not job-title catalog IDs.
      const jobTitle = createUserJobTitles.get(jobTitleId) || '';
      const department = createUserDepartments.get(departmentId) || '';
      const phone = document.getElementById('create-user-phone').value.trim();
      const initialRole = document.getElementById('create-user-role').value;

      createUserPending = true;
      if (createUserSubmitBtn) createUserSubmitBtn.disabled = true;
      try {
        const res = await window.ATS_API.createUserApi(token, {
          fullName,
          email,
          jobTitle,
          department,
          phone,
          initialRole,
          departmentName: department,
          phoneNumber: phone,
          roleCode: initialRole
        });

        if (token !== sessionStorage.getItem('ats_token')) return;
        if (res.ok && res.data && res.data.success) {
          const temporaryPassword = res.data.data?.temporaryPassword;
          createUserForm.reset();
          if (createUserAlert) createUserAlert.classList.add('hidden');
          if (createUserAlertMsg) createUserAlertMsg.textContent = '';
          if (createUserModal) createUserModal.classList.add('hidden');
          await refreshUsersAfterAccountChange(token);
          if (token !== sessionStorage.getItem('ats_token') || window.location.pathname !== submittedPath) return;
          showCreateUserResultDialog(temporaryPassword);
        } else {
          if (createUserAlert && createUserAlertMsg) {
            createUserAlertMsg.textContent = res.data?.message || 'Không thể tạo tài khoản.';
            createUserAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (token !== sessionStorage.getItem('ats_token')) return;
        if (createUserAlert && createUserAlertMsg) {
          createUserAlertMsg.textContent = err.message;
          createUserAlert.classList.remove('hidden');
        }
      } finally {
        createUserPending = false;
        if (createUserSubmitBtn) createUserSubmitBtn.disabled = false;
      }
    });
  }

  // Modal: Bulk Import Users from Excel
  const openBulkImportModalBtn = document.getElementById('open-bulk-import-modal-btn');
  const bulkImportUserModal = document.getElementById('bulk-import-user-modal');
  const closeBulkImportUserModal = document.getElementById('close-bulk-import-user-modal');
  const cancelBulkImportBtn = document.getElementById('cancel-bulk-import-btn');
  const downloadBulkTemplateBtn = document.getElementById('download-bulk-template-btn');
  const bulkImportAlert = document.getElementById('bulk-import-alert');
  const bulkImportAlertMsg = document.getElementById('bulk-import-alert-msg');
  const bulkImportFileInput = document.getElementById('bulk-import-file-input');
  const previewBulkImportBtn = document.getElementById('preview-bulk-import-btn');
  const confirmBulkImportBtn = document.getElementById('confirm-bulk-import-btn');
  const bulkImportSelectedFile = document.getElementById('bulk-import-selected-file');
  const bulkImportPreviewSummary = document.getElementById('bulk-import-preview-summary');
  const bulkImportPreviewContainer = document.getElementById('bulk-import-preview-container');
  const bulkImportPreviewBody = document.getElementById('bulk-import-preview-body');
  const bulkImportTotalRows = document.getElementById('bulk-import-total-rows');
  const bulkImportValidRows = document.getElementById('bulk-import-valid-rows');
  const bulkImportInvalidRows = document.getElementById('bulk-import-invalid-rows');
  const bulkImportReport = document.getElementById('bulk-import-report');
  const bulkImportReportTotal = document.getElementById('bulk-import-report-total');
  const bulkImportReportImported = document.getElementById('bulk-import-report-imported');
  const bulkImportReportSkipped = document.getElementById('bulk-import-report-skipped');
  const bulkImportReportMessage = document.getElementById('bulk-import-report-message');

  if (openBulkImportModalBtn) {
    openBulkImportModalBtn.addEventListener('click', () => {
      if (bulkImportUserModal) {
        bulkImportUserModal.classList.remove('hidden');
      }
    });
  }

  if (closeBulkImportUserModal) {
    closeBulkImportUserModal.addEventListener('click', () => {
      if (bulkImportUserModal) {
        bulkImportUserModal.classList.add('hidden');
      }
    });
  }

  if (cancelBulkImportBtn) {
    cancelBulkImportBtn.addEventListener('click', () => {
      if (bulkImportUserModal) {
        bulkImportUserModal.classList.add('hidden');
      }
    });
  }
  if (bulkImportFileInput) {
    bulkImportFileInput.addEventListener('change', () => {
      const file = bulkImportFileInput.files
        ? bulkImportFileInput.files[0]
        : null;

      if (confirmBulkImportBtn) {
        confirmBulkImportBtn.disabled = true;
      }

      if (bulkImportPreviewSummary) {
        bulkImportPreviewSummary.classList.add('hidden');
      }

      if (bulkImportPreviewContainer) {
        bulkImportPreviewContainer.classList.add('hidden');
      }

      if (bulkImportPreviewBody) {
        bulkImportPreviewBody.textContent = '';
      }

      if (bulkImportReport) {
        bulkImportReport.classList.add('hidden');
      }

      if (!file) {
        if (previewBulkImportBtn) {
          previewBulkImportBtn.disabled = true;
        }

        if (bulkImportSelectedFile) {
          bulkImportSelectedFile.textContent = '';
          bulkImportSelectedFile.classList.add('hidden');
        }

        return;
      }

      if (previewBulkImportBtn) {
        previewBulkImportBtn.disabled = false;
      }

      if (bulkImportSelectedFile) {
        bulkImportSelectedFile.textContent =
          `Đã chọn: ${file.name}`;
        bulkImportSelectedFile.classList.remove('hidden');
      }

      if (bulkImportAlert) {
        bulkImportAlert.classList.add('hidden');
      }
    });
  }
  if (previewBulkImportBtn) {
    previewBulkImportBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const file = bulkImportFileInput && bulkImportFileInput.files
        ? bulkImportFileInput.files[0]
        : null;

      if (!token) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Phiên đăng nhập không hợp lệ.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      if (!file) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Vui lòng chọn tệp Excel trước khi xem trước.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      previewBulkImportBtn.disabled = true;

      if (confirmBulkImportBtn) {
        confirmBulkImportBtn.disabled = true;
      }

      if (bulkImportAlert) {
        bulkImportAlert.classList.add('hidden');
      }

      if (bulkImportPreviewSummary) {
        bulkImportPreviewSummary.classList.add('hidden');
      }

      if (bulkImportPreviewContainer) {
        bulkImportPreviewContainer.classList.add('hidden');
      }

      if (bulkImportReport) {
        bulkImportReport.classList.add('hidden');
      }

      if (bulkImportPreviewBody) {
        bulkImportPreviewBody.textContent = '';
      }

      try {
        const res = await window.ATS_API.previewBulkUserImportApi(
          token,
          file
        );

        if (!(res.ok && res.data && res.data.success)) {
          if (bulkImportAlert && bulkImportAlertMsg) {
            bulkImportAlertMsg.textContent =
              res.data?.message || 'Không thể xem trước dữ liệu Excel.';
            bulkImportAlert.classList.remove('hidden');
          }

          return;
        }

        const data = res.data.data || {};
        const summary = data.summary || {};
        const rows = Array.isArray(data.rows)
          ? data.rows
          : [];

        if (bulkImportTotalRows) {
          bulkImportTotalRows.textContent =
            String(summary.totalRows || 0);
        }

        if (bulkImportValidRows) {
          bulkImportValidRows.textContent =
            String(summary.validRows || 0);
        }

        if (bulkImportInvalidRows) {
          bulkImportInvalidRows.textContent =
            String(summary.invalidRows || 0);
        }

        if (bulkImportPreviewBody) {
          rows.forEach(row => {
            const tr = document.createElement('tr');

            const values = [
              row.rowNumber ?? '',
              row.fullName || '',
              row.email || '',
              row.jobTitle || '',
              row.departmentName || '',
              row.roleCode || ''
            ];

            values.forEach(value => {
              const td = document.createElement('td');
              td.textContent = String(value);
              tr.appendChild(td);
            });

            const resultCell = document.createElement('td');

            if (row.valid) {
              const status = document.createElement('span');
              status.className = 'badge';
              status.textContent = 'Hợp lệ';
              resultCell.appendChild(status);
            } else {
              const errors = Array.isArray(row.errors)
                ? row.errors
                : [];

              if (errors.length === 0) {
                resultCell.textContent = 'Dữ liệu không hợp lệ.';
              } else {
                errors.forEach((error, index) => {
                  const line = document.createElement('div');

                  line.textContent =
                    error.message ||
                    error.code ||
                    'Dữ liệu không hợp lệ.';

                  if (index > 0) {
                    line.style.marginTop = '4px';
                  }

                  resultCell.appendChild(line);
                });
              }
            }

            tr.appendChild(resultCell);
            bulkImportPreviewBody.appendChild(tr);
          });
        }

        if (bulkImportPreviewSummary) {
          bulkImportPreviewSummary.classList.remove('hidden');
        }

        if (bulkImportPreviewContainer) {
          bulkImportPreviewContainer.classList.remove('hidden');
        }

        if (confirmBulkImportBtn) {
          confirmBulkImportBtn.disabled =
            Number(summary.validRows || 0) <= 0;
        }

        showToast(
          'success',
          'Đã kiểm tra tệp Excel',
          `${summary.validRows || 0} dòng hợp lệ, ${summary.invalidRows || 0} dòng có lỗi.`
        );
      } catch (err) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            err.message || 'Không thể xem trước dữ liệu Excel.';
          bulkImportAlert.classList.remove('hidden');
        }
      } finally {
        previewBulkImportBtn.disabled = false;
      }
    });
  }
  if (confirmBulkImportBtn) {
    confirmBulkImportBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const file = bulkImportFileInput && bulkImportFileInput.files
        ? bulkImportFileInput.files[0]
        : null;

      if (!token) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Phiên đăng nhập không hợp lệ.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      if (!file) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            'Vui lòng chọn và xem trước tệp Excel trước khi nhập.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      confirmBulkImportBtn.disabled = true;

      if (previewBulkImportBtn) {
        previewBulkImportBtn.disabled = true;
      }

      if (bulkImportAlert) {
        bulkImportAlert.classList.add('hidden');
      }

      try {
        const res = await window.ATS_API.importBulkUsersApi(
          token,
          file
        );

        if (!(res.ok && res.data && res.data.success)) {
          if (bulkImportAlert && bulkImportAlertMsg) {
            bulkImportAlertMsg.textContent =
              res.data?.message || 'Không thể nhập danh sách nhân sự.';
            bulkImportAlert.classList.remove('hidden');
          }

          return;
        }

        const data = res.data.data || {};
        const summary = data.summary || {};

        if (bulkImportReportTotal) {
          bulkImportReportTotal.textContent =
            String(summary.totalRows || 0);
        }

        if (bulkImportReportImported) {
          bulkImportReportImported.textContent =
            String(summary.importedRows || 0);
        }

        if (bulkImportReportSkipped) {
          bulkImportReportSkipped.textContent =
            String(summary.skippedRows || 0);
        }

        if (bulkImportReportMessage) {
          bulkImportReportMessage.textContent =
            res.data.message || 'Hoàn tất nhập danh sách nhân sự.';
        }

        if (bulkImportReport) {
          bulkImportReport.classList.remove('hidden');
        }

        showToast(
          'success',
          'Hoàn tất nhập nhân sự',
          `${summary.importedRows || 0} dòng đã nhập, ${summary.skippedRows || 0} dòng bị bỏ qua.`
        );

        usersCurrentPage = 1;
        loadUsers();
        loadDashboardData();
      } catch (err) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            err.message || 'Không thể nhập danh sách nhân sự.';
          bulkImportAlert.classList.remove('hidden');
        }
      } finally {
        if (previewBulkImportBtn) {
          previewBulkImportBtn.disabled = false;
        }
      }
    });
  }
  if (downloadBulkTemplateBtn) {
    downloadBulkTemplateBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');

      if (!token) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent = 'Phiên đăng nhập không hợp lệ.';
          bulkImportAlert.classList.remove('hidden');
        }
        return;
      }

      downloadBulkTemplateBtn.disabled = true;

      try {
        const res = await window.ATS_API.downloadBulkUserTemplateApi(token);

        if (res.ok && res.data && res.data.blob) {
          const url = URL.createObjectURL(res.data.blob);
          const link = document.createElement('a');

          link.href = url;
          link.download = res.data.filename || 'mau_nhap_nhan_su.xlsx';

          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          URL.revokeObjectURL(url);

          if (bulkImportAlert) {
            bulkImportAlert.classList.add('hidden');
          }

          showToast(
            'success',
            'Tải tệp mẫu thành công',
            'Tệp mẫu Excel nhập nhân sự đã được tải xuống.'
          );
        } else {
          if (bulkImportAlert && bulkImportAlertMsg) {
            bulkImportAlertMsg.textContent =
              res.data?.message || 'Không thể tải tệp mẫu Excel.';
            bulkImportAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (bulkImportAlert && bulkImportAlertMsg) {
          bulkImportAlertMsg.textContent =
            err.message || 'Không thể tải tệp mẫu Excel.';
          bulkImportAlert.classList.remove('hidden');
        }
      } finally {
        downloadBulkTemplateBtn.disabled = false;
      }
    });
  }
  // Modal: Edit User
  const editUserModal = document.getElementById('edit-user-modal');
  const closeEditUserModal = document.getElementById('close-edit-user-modal');
  const editUserForm = document.getElementById('edit-user-form');
  const editUserAlert = document.getElementById('edit-user-alert');
  const editUserAlertMsg = document.getElementById('edit-user-alert-msg');

  function openEditUserModal(user) {
    if (!editUserModal) return;
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-fullname').value = user.fullName || '';
    document.getElementById('edit-user-jobtitle').value = user.jobTitle || '';
    document.getElementById('edit-user-department').value = user.department || '';
    document.getElementById('edit-user-phone').value = user.phone || '';

    if (editUserAlert) editUserAlert.classList.add('hidden');
    editUserModal.classList.remove('hidden');
  }

  if (closeEditUserModal) {
    closeEditUserModal.addEventListener('click', () => {
      if (editUserModal) editUserModal.classList.add('hidden');
    });
  }

  if (editUserForm) {
    editUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const id = document.getElementById('edit-user-id').value;
      const fullName = document.getElementById('edit-user-fullname').value.trim();
      const jobTitle = document.getElementById('edit-user-jobtitle').value.trim();
      const department = document.getElementById('edit-user-department').value.trim();
      const phone = document.getElementById('edit-user-phone').value.trim();

      try {
        const res = await window.ATS_API.updateUserApi(token, id, { fullName, jobTitle, department, phone });
        if (res.ok && res.data && res.data.success) {
          editUserModal.classList.add('hidden');
          showToast('success', 'Cập nhật thành công', `Hồ sơ ${fullName} đã được cập nhật.`);
          loadUsers();
        } else {
          if (editUserAlert && editUserAlertMsg) {
            editUserAlertMsg.textContent = res.data.message || 'Không thể cập nhật tài khoản.';
            editUserAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (editUserAlert && editUserAlertMsg) {
          editUserAlertMsg.textContent = err.message;
          editUserAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Modal: Assign Roles
  const assignRolesModal = document.getElementById('assign-roles-modal');
  const closeAssignRolesModal = document.getElementById('close-assign-roles-modal');
  const cancelAssignRolesBtn = document.getElementById('cancel-assign-roles-btn');
  const assignRolesForm = document.getElementById('assign-roles-form');
  const assignRolesAlert = document.getElementById('assign-roles-alert');
  const assignRolesAlertMsg = document.getElementById('assign-roles-alert-msg');
  const assignRolesSelfWarning = document.getElementById('assign-roles-self-warning');
  const assignRolesCheckboxContainer = document.getElementById('assign-roles-checkbox-container');
  const assignRolesSubmitBtn = document.getElementById('assign-roles-submit-btn');
  let assignRolesPending = false;

  function openAssignRolesModal(user) {
    if (!assignRolesModal || assignRolesPending) return;
    document.getElementById('assign-roles-user-id').value = user.id;
    document.getElementById('assign-roles-user-name').textContent = user.fullName || user.email;
    document.getElementById('assign-roles-user-email').textContent = user.email;

    const isSelf = currentAuthenticatedUser && (currentAuthenticatedUser.id === user.id || currentAuthenticatedUser.email === user.email);
    if (assignRolesSelfWarning) {
      if (isSelf) assignRolesSelfWarning.classList.remove('hidden');
      else assignRolesSelfWarning.classList.add('hidden');
    }

    if (assignRolesCheckboxContainer) {
      const allRoles = ['ADMIN', 'HR_MANAGER', 'RECRUITER', 'HIRING_MGR', 'INTERVIEWER', 'APPROVER', 'CANDIDATE'];
      const userRoles = user.roles || [];

      assignRolesCheckboxContainer.innerHTML = allRoles.map(role => {
        const checked = userRoles.includes(role) ? 'checked' : '';
        return `
          <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer; padding: 4px 6px; border-radius: 4px;">
            <input type="checkbox" name="assign-roles" value="${role}" ${checked} style="accent-color: var(--color-primary); cursor: pointer;" />
            <span style="font-weight: 600; color: var(--color-text);">${ROLE_LABELS[role] || role}</span>
            <span class="badge badge-neutral font-mono" style="font-size: 0.7rem; margin-left: auto;">${role}</span>
          </label>
        `;
      }).join('');
    }

    if (assignRolesAlert) assignRolesAlert.classList.add('hidden');
    assignRolesModal.classList.remove('hidden');
  }

  if (closeAssignRolesModal) closeAssignRolesModal.addEventListener('click', () => assignRolesModal.classList.add('hidden'));
  if (cancelAssignRolesBtn) cancelAssignRolesBtn.addEventListener('click', () => assignRolesModal.classList.add('hidden'));

  if (assignRolesForm) {
    assignRolesForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (assignRolesPending) return;
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const userId = document.getElementById('assign-roles-user-id').value;
      const checkedBoxes = document.querySelectorAll('input[name="assign-roles"]:checked');
      const selectedRoles = Array.from(checkedBoxes).map(cb => cb.value);

      if (selectedRoles.length === 0) {
        if (assignRolesAlert && assignRolesAlertMsg) {
          assignRolesAlertMsg.textContent = 'Mỗi tài khoản bắt buộc phải có ít nhất 1 vai trò hệ thống.';
          assignRolesAlert.classList.remove('hidden');
        }
        return;
      }

      assignRolesPending = true;
      if (assignRolesSubmitBtn) assignRolesSubmitBtn.disabled = true;
      try {
        const res = await window.ATS_API.assignUserRolesApi(token, userId, selectedRoles);
        if (token !== sessionStorage.getItem('ats_token')) return;
        if (res.ok && res.data && res.data.success) {
          assignRolesModal.classList.add('hidden');
          await refreshUsersAfterAccountChange(token);
          if (token === sessionStorage.getItem('ats_token')) {
            showToast('success', 'Phân quyền thành công', 'Cập nhật phân quyền thành công.');
          }
        } else {
          if (assignRolesAlert && assignRolesAlertMsg) {
            assignRolesAlertMsg.textContent = res.data?.message || 'Không thể cập nhật vai trò.';
            assignRolesAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (token !== sessionStorage.getItem('ats_token')) return;
        if (assignRolesAlert && assignRolesAlertMsg) {
          assignRolesAlertMsg.textContent = err.message;
          assignRolesAlert.classList.remove('hidden');
        }
      } finally {
        assignRolesPending = false;
        if (assignRolesSubmitBtn) assignRolesSubmitBtn.disabled = false;
      }
    });
  }

  // Modal: Lock User & Handover Warning Flow
  const lockUserModal = document.getElementById('lock-user-modal');
  const closeLockUserModal = document.getElementById('close-lock-user-modal');
  const cancelLockUserBtn = document.getElementById('cancel-lock-user-btn');
  const lockUserForm = document.getElementById('lock-user-form');
  const lockUserAlert = document.getElementById('lock-user-alert');
  const lockUserAlertMsg = document.getElementById('lock-user-alert-msg');
  const lockSelfWarning = document.getElementById('lock-self-warning');
  const handoverWarningModal = document.getElementById('handover-warning-modal');
  const closeHandoverModal = document.getElementById('close-handover-modal');
  const acknowledgeHandoverBtn = document.getElementById('acknowledge-handover-btn');
  const handoverReqsContainer = document.getElementById('handover-requisitions-container');

  function openLockUserModal(id, name, email) {
    if (!lockUserModal) return;
    document.getElementById('lock-user-id').value = id;
    document.getElementById('lock-user-name').textContent = name;
    document.getElementById('lock-user-email').textContent = email;
    document.getElementById('lock-reason-input').value = '';

    const isSelf = currentAuthenticatedUser && (currentAuthenticatedUser.id === id || currentAuthenticatedUser.email === email);
    if (lockSelfWarning) {
      if (isSelf) lockSelfWarning.classList.remove('hidden');
      else lockSelfWarning.classList.add('hidden');
    }

    if (lockUserAlert) lockUserAlert.classList.add('hidden');
    lockUserModal.classList.remove('hidden');
  }

  if (closeLockUserModal) closeLockUserModal.addEventListener('click', () => lockUserModal.classList.add('hidden'));
  if (cancelLockUserBtn) cancelLockUserBtn.addEventListener('click', () => lockUserModal.classList.add('hidden'));

  if (lockUserForm) {
    lockUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const userId = document.getElementById('lock-user-id').value;
      const reason = document.getElementById('lock-reason-input').value.trim();

      if (!reason) {
        if (lockUserAlert && lockUserAlertMsg) {
          lockUserAlertMsg.textContent = 'Vui lòng nhập lý do khóa tài khoản.';
          lockUserAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.lockUserApi(token, userId, reason);
        if (res.ok && res.data && res.data.success) {
          lockUserModal.classList.add('hidden');
          showToast('success', 'Đã khóa tài khoản', 'Tài khoản nhân sự đã bị khóa và chấm dứt các phiên làm việc.');
          loadUsers();

          // Check if this user had active requisitions requiring handover
          const handoverReqs = res.data.data.handoverRequisitions || [];
          if (handoverReqs.length > 0 && handoverWarningModal) {
            if (handoverReqsContainer) {
              handoverReqsContainer.innerHTML = `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Vị trí</th>
                      <th>Phòng ban</th>
                      <th>Chỉ tiêu</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${handoverReqs.map(r => `
                      <tr>
                        <td><code class="font-mono" style="color: var(--color-primary);">${r.code}</code></td>
                        <td><strong>${r.title}</strong></td>
                        <td>${r.department}</td>
                        <td>${r.headcount}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `;
            }
            handoverWarningModal.classList.remove('hidden');
          }
        } else {
          if (lockUserAlert && lockUserAlertMsg) {
            lockUserAlertMsg.textContent = res.data.message || 'Không thể khóa tài khoản.';
            lockUserAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (lockUserAlert && lockUserAlertMsg) {
          lockUserAlertMsg.textContent = err.message;
          lockUserAlert.classList.remove('hidden');
        }
      }
    });
  }

  if (closeHandoverModal) closeHandoverModal.addEventListener('click', () => handoverWarningModal.classList.add('hidden'));
  if (acknowledgeHandoverBtn) {
    acknowledgeHandoverBtn.addEventListener('click', () => {
      handoverWarningModal.classList.add('hidden');
      switchView('requisitions');
    });
  }


  // --- ADMIN RESET PASSWORD MODAL ---
  const adminResetPwdModal = document.getElementById('admin-reset-pwd-modal');
  const closeAdminResetPwdModal = document.getElementById('close-admin-reset-pwd-modal');
  const cancelAdminResetPwdBtn = document.getElementById('cancel-admin-reset-pwd-btn');
  const confirmAdminResetPwdBtn = document.getElementById('confirm-admin-reset-pwd-btn');
  const adminResetResultBox = document.getElementById('admin-reset-result-box');
  const adminResetNewPwdDisplay = document.getElementById('admin-reset-new-pwd-display');
  const adminResetCopyPwdBtn = document.getElementById('admin-reset-copy-pwd-btn');

  function openAdminResetPwdModal(id, name, email) {
    if (!adminResetPwdModal) return;
    document.getElementById('admin-reset-user-id').value = id;
    document.getElementById('admin-reset-user-name').textContent = name;
    document.getElementById('admin-reset-user-email').textContent = email;
    if (adminResetResultBox) adminResetResultBox.classList.add('hidden');
    if (confirmAdminResetPwdBtn) confirmAdminResetPwdBtn.classList.remove('hidden');
    adminResetPwdModal.classList.remove('hidden');
  }

  if (closeAdminResetPwdModal) closeAdminResetPwdModal.addEventListener('click', () => adminResetPwdModal.classList.add('hidden'));
  if (cancelAdminResetPwdBtn) cancelAdminResetPwdBtn.addEventListener('click', () => adminResetPwdModal.classList.add('hidden'));

  if (confirmAdminResetPwdBtn) {
    confirmAdminResetPwdBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const userId = document.getElementById('admin-reset-user-id').value;
      if (!token || !userId) return;

      try {
        const res = await window.ATS_API.resetUserPasswordApi(token, userId);
        if (res.ok && res.data && res.data.success) {
          confirmAdminResetPwdBtn.classList.add('hidden');
          if (adminResetResultBox) {
            adminResetResultBox.classList.remove('hidden');
            if (adminResetNewPwdDisplay) adminResetNewPwdDisplay.textContent = res.data.data.temporaryPassword;
          }
          showToast('success', 'Đặt lại mật khẩu thành công', 'Mật khẩu tạm mới đã được tạo và gửi qua email.');
        } else {
          showToast('danger', 'Lỗi', res.data.message || 'Không thể đặt lại mật khẩu.');
        }
      } catch (e) {
        showToast('danger', 'Lỗi kết nối', e.message);
      }
    });
  }

  if (adminResetCopyPwdBtn) {
    adminResetCopyPwdBtn.addEventListener('click', () => {
      const pwd = adminResetNewPwdDisplay.textContent;
      navigator.clipboard.writeText(pwd).then(() => {
        showToast('info', 'Đã sao chép', 'Đã sao chép mật khẩu tạm vào bộ nhớ tạm.');
      });
    });
  }
