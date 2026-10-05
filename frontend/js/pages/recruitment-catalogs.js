  // ==============================================================================
  // S2. RECRUITMENT SHARED CATALOGS
  // ==============================================================================

  const recruitmentCatalogTypeFilter =
    document.getElementById('recruitment-catalog-type-filter');

  const recruitmentCatalogTableBody =
    document.getElementById('recruitment-catalog-table-body');

  const recruitmentCatalogTotalBadge =
    document.getElementById('recruitment-catalog-total-badge');

  const recruitmentCatalogRefreshBtn =
    document.getElementById('recruitment-catalog-refresh-btn');

  const recruitmentCatalogNewBtn =
    document.getElementById('recruitment-catalog-new-btn');

  const recruitmentCatalogForm =
    document.getElementById('recruitment-catalog-form');

  const recruitmentCatalogFormTitle =
    document.getElementById('recruitment-catalog-form-title');

  const recruitmentCatalogIdInput =
    document.getElementById('recruitment-catalog-id-input');

  const recruitmentCatalogTypeInput =
    document.getElementById('recruitment-catalog-type-input');

  const recruitmentCatalogCodeInput =
    document.getElementById('recruitment-catalog-code-input');

  const recruitmentCatalogNameInput =
    document.getElementById('recruitment-catalog-name-input');

  const recruitmentCatalogOrderInput =
    document.getElementById('recruitment-catalog-order-input');

  const recruitmentCatalogStatusInput =
    document.getElementById('recruitment-catalog-status-input');

  const recruitmentCatalogFormAlert =
    document.getElementById('recruitment-catalog-form-alert');

  const recruitmentCatalogFormAlertMsg =
    document.getElementById('recruitment-catalog-form-alert-msg');

  const recruitmentCatalogResetBtn =
    document.getElementById('recruitment-catalog-reset-btn');

  const recruitmentCatalogSaveBtn =
    document.getElementById('recruitment-catalog-save-btn');

  let currentRecruitmentCatalogItems = [];

  function escapeRecruitmentCatalogHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getRecruitmentCatalogTypeLabel(type) {
    const labels = {
      CANDIDATE_SOURCE: 'Nguồn ứng viên',
      REJECTION_REASON: 'Lý do loại hồ sơ',
      WORK_LOCATION: 'Địa điểm làm việc',
      WORK_MODE: 'Hình thức làm việc'
    };

    return labels[type] || type;
  }

  function hideRecruitmentCatalogError() {
    if (recruitmentCatalogFormAlert) {
      recruitmentCatalogFormAlert.classList.add('hidden');
    }

    if (recruitmentCatalogFormAlertMsg) {
      recruitmentCatalogFormAlertMsg.textContent = '';
    }
  }

  function showRecruitmentCatalogError(message) {
    if (recruitmentCatalogFormAlertMsg) {
      recruitmentCatalogFormAlertMsg.textContent =
        message || 'Không thể xử lý danh mục tuyển dụng.';
    }

    if (recruitmentCatalogFormAlert) {
      recruitmentCatalogFormAlert.classList.remove('hidden');
    }
  }

  function resetRecruitmentCatalogForm() {
    if (recruitmentCatalogForm) {
      recruitmentCatalogForm.reset();
    }

    if (recruitmentCatalogIdInput) {
      recruitmentCatalogIdInput.value = '';
    }

    if (recruitmentCatalogTypeInput) {
      recruitmentCatalogTypeInput.value =
        recruitmentCatalogTypeFilter
          ? recruitmentCatalogTypeFilter.value
          : 'CANDIDATE_SOURCE';

      recruitmentCatalogTypeInput.disabled = false;
    }

    if (recruitmentCatalogOrderInput) {
      recruitmentCatalogOrderInput.value = '0';
    }

    if (recruitmentCatalogStatusInput) {
      recruitmentCatalogStatusInput.value = 'ACTIVE';
      recruitmentCatalogStatusInput.disabled = true;
    }

    if (recruitmentCatalogFormTitle) {
      recruitmentCatalogFormTitle.textContent =
        'Thêm giá trị danh mục';
    }

    if (recruitmentCatalogSaveBtn) {
      recruitmentCatalogSaveBtn.textContent =
        'Lưu danh mục';
    }

    hideRecruitmentCatalogError();
  }

  function editRecruitmentCatalog(id) {
    const item = currentRecruitmentCatalogItems.find(
      catalog => catalog.id === id
    );

    if (!item) return;

    if (recruitmentCatalogIdInput) {
      recruitmentCatalogIdInput.value = item.id;
    }

    if (recruitmentCatalogTypeInput) {
      recruitmentCatalogTypeInput.value = item.type;
      recruitmentCatalogTypeInput.disabled = true;
    }

    if (recruitmentCatalogCodeInput) {
      recruitmentCatalogCodeInput.value = item.code || '';
    }

    if (recruitmentCatalogNameInput) {
      recruitmentCatalogNameInput.value = item.name || '';
    }

    if (recruitmentCatalogOrderInput) {
      recruitmentCatalogOrderInput.value =
        String(item.displayOrder ?? 0);
    }

    if (recruitmentCatalogStatusInput) {
      recruitmentCatalogStatusInput.value =
        item.status || 'ACTIVE';

      recruitmentCatalogStatusInput.disabled = false;
    }

    if (recruitmentCatalogFormTitle) {
      recruitmentCatalogFormTitle.textContent =
        'Cập nhật giá trị danh mục';
    }

    if (recruitmentCatalogSaveBtn) {
      recruitmentCatalogSaveBtn.textContent = 'Cập nhật';
    }

    hideRecruitmentCatalogError();

    if (recruitmentCatalogCodeInput) {
      recruitmentCatalogCodeInput.focus();
    }
  }

  function renderRecruitmentCatalogTable() {
    if (!recruitmentCatalogTableBody) return;

    if (currentRecruitmentCatalogItems.length === 0) {
      recruitmentCatalogTableBody.innerHTML = `
        <tr>
          <td colspan="5"
              style="text-align: center; padding: 24px; color: var(--color-text-muted);">
            Chưa có giá trị trong danh mục này.
          </td>
        </tr>
      `;
      return;
    }

    recruitmentCatalogTableBody.innerHTML =
      currentRecruitmentCatalogItems.map((item, index) => {
        const active = item.status === 'ACTIVE';

        return `
          <tr>
            <td style="text-align: center;">
              <strong>${escapeRecruitmentCatalogHtml(item.displayOrder)}</strong>
            </td>

            <td>
              <code class="font-mono">
                ${escapeRecruitmentCatalogHtml(item.code)}
              </code>
            </td>

            <td>
              <strong>${escapeRecruitmentCatalogHtml(item.name)}</strong>
            </td>

            <td>
              <span class="badge ${active ? 'badge-success' : 'badge-neutral'}">
                ${active ? 'Đang áp dụng' : 'Ngừng áp dụng'}
              </span>
            </td>

            <td>
              <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="up"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}"
                  ${index === 0 ? 'disabled' : ''}
                  title="Di chuyển lên">
                  ↑
                </button>

                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="down"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}"
                  ${index === currentRecruitmentCatalogItems.length - 1 ? 'disabled' : ''}
                  title="Di chuyển xuống">
                  ↓
                </button>

                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="edit"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}">
                  Sửa
                </button>

                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-catalog-action="delete"
                  data-catalog-id="${escapeRecruitmentCatalogHtml(item.id)}">
                  Xóa
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
  }

  async function loadRecruitmentCatalogs() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const type = recruitmentCatalogTypeFilter
      ? recruitmentCatalogTypeFilter.value
      : 'CANDIDATE_SOURCE';

    if (recruitmentCatalogTableBody) {
      recruitmentCatalogTableBody.innerHTML = `
        <tr>
          <td colspan="5"
              style="text-align: center; padding: 24px; color: var(--color-text-muted);">
            Đang tải danh mục...
          </td>
        </tr>
      `;
    }

    try {
      const res =
        await window.ATS_API.getRecruitmentCatalogsApi(
          token,
          { type }
        );

      if (
        !res.ok ||
        !res.data ||
        !res.data.success
      ) {
        throw new Error(
          res.data && res.data.message
            ? res.data.message
            : 'Không thể tải danh mục tuyển dụng.'
        );
      }

      currentRecruitmentCatalogItems =
        res.data.items || [];

      if (recruitmentCatalogTotalBadge) {
        recruitmentCatalogTotalBadge.textContent =
          `${currentRecruitmentCatalogItems.length} giá trị`;
      }

      renderRecruitmentCatalogTable();

      if (
        recruitmentCatalogIdInput &&
        !recruitmentCatalogIdInput.value
      ) {
        resetRecruitmentCatalogForm();
      }
    } catch (error) {
      console.error(
        'Failed to load recruitment catalogs:',
        error
      );

      currentRecruitmentCatalogItems = [];

      if (recruitmentCatalogTableBody) {
        recruitmentCatalogTableBody.innerHTML = `
          <tr>
            <td colspan="5"
                style="text-align: center; padding: 24px; color: var(--color-danger);">
              ${escapeRecruitmentCatalogHtml(error.message)}
            </td>
          </tr>
        `;
      }
    }
  }

  async function reorderRecruitmentCatalog(
    catalogId,
    direction
  ) {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const index = currentRecruitmentCatalogItems.findIndex(
      item => item.id === catalogId
    );

    if (index < 0) return;

    const targetIndex =
      direction === 'up'
        ? index - 1
        : index + 1;

    if (
      targetIndex < 0 ||
      targetIndex >= currentRecruitmentCatalogItems.length
    ) {
      return;
    }

    const ordered = [...currentRecruitmentCatalogItems];

    const temp = ordered[index];
    ordered[index] = ordered[targetIndex];
    ordered[targetIndex] = temp;

    const type = recruitmentCatalogTypeFilter
      ? recruitmentCatalogTypeFilter.value
      : ordered[0].type;

    try {
      const res =
        await window.ATS_API.reorderRecruitmentCatalogsApi(
          token,
          type,
          ordered.map(item => item.id)
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        currentRecruitmentCatalogItems =
          res.data.items || ordered;

        renderRecruitmentCatalogTable();

        showToast(
          'success',
          'Danh mục tuyển dụng',
          'Đã cập nhật thứ tự hiển thị.'
        );
      } else {
        showToast(
          'error',
          'Danh mục tuyển dụng',
          res.data && res.data.message
            ? res.data.message
            : 'Không thể sắp xếp danh mục.'
        );
      }
    } catch (error) {
      showToast(
        'error',
        'Danh mục tuyển dụng',
        'Lỗi kết nối khi sắp xếp danh mục.'
      );
    }
  }

  async function deleteRecruitmentCatalog(id) {
    const token = sessionStorage.getItem('ats_token');
    if (!token || !id) return;

    const item = currentRecruitmentCatalogItems.find(
      catalog => catalog.id === id
    );

    if (!item) return;

    const confirmed = window.confirm(
      `Xóa "${item.name}" khỏi ${getRecruitmentCatalogTypeLabel(item.type)}?`
    );

    if (!confirmed) return;

    try {
      const res =
        await window.ATS_API.deleteRecruitmentCatalogApi(
          token,
          id
        );

      if (
        res.ok &&
        res.data &&
        res.data.success
      ) {
        showToast(
          'success',
          'Danh mục tuyển dụng',
          res.data.message ||
            'Đã xóa giá trị danh mục.'
        );

        resetRecruitmentCatalogForm();
        await loadRecruitmentCatalogs();
      } else {
        showToast(
          'error',
          'Không thể xóa',
          res.data && res.data.message
            ? res.data.message
            : 'Giá trị danh mục không thể xóa.'
        );
      }
    } catch (error) {
      showToast(
        'error',
        'Không thể xóa',
        'Lỗi kết nối khi xóa giá trị danh mục.'
      );
    }
  }

  if (recruitmentCatalogForm) {
    recruitmentCatalogForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token =
          sessionStorage.getItem('ats_token');

        if (!token) return;

        hideRecruitmentCatalogError();

        const id = recruitmentCatalogIdInput
          ? recruitmentCatalogIdInput.value.trim()
          : '';

        const payload = {
          type: recruitmentCatalogTypeInput
            ? recruitmentCatalogTypeInput.value
            : 'CANDIDATE_SOURCE',

          code: recruitmentCatalogCodeInput
            ? recruitmentCatalogCodeInput.value.trim()
            : '',

          name: recruitmentCatalogNameInput
            ? recruitmentCatalogNameInput.value.trim()
            : '',

          displayOrder: recruitmentCatalogOrderInput
            ? Number(recruitmentCatalogOrderInput.value || 0)
            : 0
        };

        if (id) {
          payload.status =
            recruitmentCatalogStatusInput
              ? recruitmentCatalogStatusInput.value
              : 'ACTIVE';
        }

        if (!payload.code || !payload.name) {
          showRecruitmentCatalogError(
            'Vui lòng nhập đầy đủ mã và tên hiển thị.'
          );
          return;
        }

        if (recruitmentCatalogSaveBtn) {
          recruitmentCatalogSaveBtn.disabled = true;
        }

        try {
          const res = id
            ? await window.ATS_API.updateRecruitmentCatalogApi(
                token,
                id,
                payload
              )
            : await window.ATS_API.createRecruitmentCatalogApi(
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
              'Danh mục tuyển dụng',
              res.data.message ||
                'Đã lưu giá trị danh mục.'
            );

            if (
              recruitmentCatalogTypeFilter &&
              !id
            ) {
              recruitmentCatalogTypeFilter.value =
                payload.type;
            }

            resetRecruitmentCatalogForm();
            await loadRecruitmentCatalogs();
          } else {
            showRecruitmentCatalogError(
              res.data && res.data.message
                ? res.data.message
                : 'Không thể lưu giá trị danh mục.'
            );
          }
        } catch (error) {
          showRecruitmentCatalogError(
            'Lỗi kết nối khi lưu danh mục.'
          );
        } finally {
          if (recruitmentCatalogSaveBtn) {
            recruitmentCatalogSaveBtn.disabled = false;
          }
        }
      }
    );
  }

  if (recruitmentCatalogTableBody) {
    recruitmentCatalogTableBody.addEventListener(
      'click',
      async event => {
        const button =
          event.target.closest('[data-catalog-action]');

        if (!button) return;

        const id = button.dataset.catalogId;
        const action = button.dataset.catalogAction;

        if (action === 'edit') {
          editRecruitmentCatalog(id);
        } else if (
          action === 'up' ||
          action === 'down'
        ) {
          await reorderRecruitmentCatalog(
            id,
            action
          );
        } else if (action === 'delete') {
          await deleteRecruitmentCatalog(id);
        }
      }
    );
  }

  if (recruitmentCatalogTypeFilter) {
    recruitmentCatalogTypeFilter.addEventListener(
      'change',
      async () => {
        resetRecruitmentCatalogForm();
        await loadRecruitmentCatalogs();
      }
    );
  }

  if (recruitmentCatalogNewBtn) {
    recruitmentCatalogNewBtn.addEventListener(
      'click',
      () => {
        resetRecruitmentCatalogForm();

        if (recruitmentCatalogCodeInput) {
          recruitmentCatalogCodeInput.focus();
        }
      }
    );
  }

  if (recruitmentCatalogResetBtn) {
    recruitmentCatalogResetBtn.addEventListener(
      'click',
      resetRecruitmentCatalogForm
    );
  }

  if (recruitmentCatalogRefreshBtn) {
    recruitmentCatalogRefreshBtn.addEventListener(
      'click',
      loadRecruitmentCatalogs
    );
  }
