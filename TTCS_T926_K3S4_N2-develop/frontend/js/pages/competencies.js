  // Competency Framework & Job Title Elements
  const competencyFrameworkList = document.getElementById('competency-framework-list');
  const competencyFrameworksTotalBadge = document.getElementById('competency-frameworks-total-badge');
  const competencyFrameworkForm = document.getElementById('competency-framework-form');
  const competencyFrameworkFormTitle = document.getElementById('competency-framework-form-title');
  const competencyFrameworkIdInput = document.getElementById('competency-framework-id-input');
  const competencyFrameworkCodeInput = document.getElementById('competency-framework-code-input');
  const competencyFrameworkNameInput = document.getElementById('competency-framework-name-input');
  const competencyFrameworkDescriptionInput = document.getElementById('competency-framework-description-input');
  const competencyAddCriterionBtn = document.getElementById('competency-add-criterion-btn');
  const competencyCriteriaContainer = document.getElementById('competency-criteria-container');
  const competencyTotalWeight = document.getElementById('competency-total-weight');
  const competencyFrameworkFormAlert = document.getElementById('competency-framework-form-alert');
  const competencyFrameworkFormAlertMsg = document.getElementById('competency-framework-form-alert-msg');
  const competencyFrameworkResetBtn = document.getElementById('competency-framework-reset-btn');
  const competencyFrameworkSaveBtn = document.getElementById('competency-framework-save-btn');

  const jobTitleList = document.getElementById('job-title-list');
  const jobTitlesTotalBadge = document.getElementById('job-titles-total-badge');
  const jobTitleForm = document.getElementById('job-title-form');
  const jobTitleFormTitle = document.getElementById('job-title-form-title');
  const jobTitleIdInput = document.getElementById('job-title-id-input');
  const jobTitleCodeInput = document.getElementById('job-title-code-input');
  const jobTitleNameInput = document.getElementById('job-title-name-input');
  const jobTitleLevelInput = document.getElementById('job-title-level-input');
  const jobTitleMinSalaryInput = document.getElementById('job-title-min-salary-input');
  const jobTitleMaxSalaryInput = document.getElementById('job-title-max-salary-input');
  const jobTitleSalaryFields = document.getElementById('job-title-salary-fields');
  const jobTitleSalaryAccessNote = document.getElementById('job-title-salary-access-note');
  let canViewJobTitleSalary = false;
  const jobTitleFrameworkSelect = document.getElementById('job-title-framework-select');
  const jobTitleFormAlert = document.getElementById('job-title-form-alert');
  const jobTitleFormAlertMsg = document.getElementById('job-title-form-alert-msg');
  const jobTitleResetBtn = document.getElementById('job-title-reset-btn');
  const jobTitleSaveBtn = document.getElementById('job-title-save-btn');

  // ==============================================================================  // 12. USERS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  // ==============================================================================
  // S2. COMPETENCY FRAMEWORK & JOB TITLE MANAGEMENT
  // ==============================================================================

  let currentCompetencyFrameworks = [];
  let currentJobTitles = [];
  let canManageCompetencies = true;

  function clearJobTitleSalaryState() {
    canViewJobTitleSalary = false;
    currentJobTitles = currentJobTitles.map(({ minSalary, maxSalary, ...item }) => item);
    if (jobTitleMinSalaryInput) jobTitleMinSalaryInput.value = '';
    if (jobTitleMaxSalaryInput) jobTitleMaxSalaryInput.value = '';
    if (jobTitleSalaryFields) {
      jobTitleSalaryFields.disabled = true;
      jobTitleSalaryFields.classList.add('hidden');
    }
    if (jobTitleSaveBtn) jobTitleSaveBtn.disabled = true;
    renderJobTitles();
  }

  function escapeCompetencyHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function updateCompetencyTotalWeight() {
    if (!competencyCriteriaContainer || !competencyTotalWeight) return;

    const inputs = competencyCriteriaContainer.querySelectorAll(
      '[data-criterion-weight]'
    );

    let total = 0;

    inputs.forEach(input => {
      total += Number(input.value) || 0;
    });

    competencyTotalWeight.textContent = String(total);
  }

  function addCompetencyCriterionRow(criterion = {}) {
    if (!competencyCriteriaContainer) return;

    const row = document.createElement('div');
    row.className = 'competency-criterion-row';
    row.style.cssText =
      'display:grid;grid-template-columns:minmax(180px,1fr) 100px auto;gap:8px;align-items:end;margin-bottom:8px;';

    row.dataset.criterionId = criterion.id || '';

    row.innerHTML = `
      <div>
        <label class="form-label">Tên tiêu chí</label>
        <input
          type="text"
          class="form-input"
          data-criterion-name
          value="${escapeCompetencyHtml(criterion.name || '')}"
          placeholder="Ví dụ: Kiến thức chuyên môn"
          required
        />
      </div>

      <div>
        <label class="form-label">Trọng số (%)</label>
        <input
          type="number"
          class="form-input"
          data-criterion-weight
          min="1"
          max="100"
          value="${Number(criterion.weight) || ''}"
          required
        />
      </div>

      <button
        type="button"
        class="btn btn-outline btn-sm"
        data-remove-criterion
        style="margin-bottom:1px;"
      >
        Xóa
      </button>
    `;

    competencyCriteriaContainer.appendChild(row);
    updateCompetencyTotalWeight();
  }

  function renderCompetencyFrameworks() {
    if (!competencyFrameworkList) return;

    if (competencyFrameworksTotalBadge) {
      competencyFrameworksTotalBadge.textContent =
        `${currentCompetencyFrameworks.length} khung`;
    }

    if (currentCompetencyFrameworks.length === 0) {
      competencyFrameworkList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Chưa có khung năng lực nào.
        </div>
      `;
      return;
    }

    competencyFrameworkList.innerHTML = currentCompetencyFrameworks
      .map(framework => {
        const criteria = Array.isArray(framework.criteria)
          ? framework.criteria
          : [];

        const criteriaHtml = criteria
          .map(criterion => `
            <div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;">
              <span>${escapeCompetencyHtml(criterion.name)}</span>
              <strong>${Number(criterion.weight) || 0}%</strong>
            </div>
          `)
          .join('');

        return `
          <div
            style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:10px;"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
              <div>
                <strong>${escapeCompetencyHtml(framework.name)}</strong>
                <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px;">
                  ${escapeCompetencyHtml(framework.code)}
                </div>
              </div>

              <button
                type="button"
                class="btn btn-outline btn-sm ${canManageCompetencies ? '' : 'hidden'}"
                data-competency-edit="${escapeCompetencyHtml(framework.id)}"
              >
                Sửa
              </button>
            </div>

            <div style="margin-top:10px;">
              ${criteriaHtml}
            </div>

            <div style="margin-top:8px;font-size:12px;color:var(--color-text-muted);">
              Tổng trọng số:
              <strong>${Number(framework.totalWeight) || 0}%</strong>
              · ${Array.isArray(framework.jobTitles) ? framework.jobTitles.length : 0} chức danh
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderJobTitles() {
    if (!jobTitleList) return;

    if (jobTitlesTotalBadge) {
      jobTitlesTotalBadge.textContent =
        `${currentJobTitles.length} chức danh`;
    }

    if (currentJobTitles.length === 0) {
      jobTitleList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Chưa có chức danh nào.
        </div>
      `;
      return;
    }

    jobTitleList.innerHTML = currentJobTitles
      .map(jobTitle => `
        <div
          style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:10px;"
        >
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div>
              <strong>${escapeCompetencyHtml(jobTitle.name)}</strong>

              <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px;">
                ${escapeCompetencyHtml(jobTitle.code)}
                · Cấp bậc: ${escapeCompetencyHtml(jobTitle.level || 'Chưa khai báo')}
              </div>

              ${canViewJobTitleSalary ? `<div style="margin-top:6px;">Dải lương: ${jobTitle.minSalary == null || jobTitle.maxSalary == null ? 'Chưa khai báo' : `${Number(jobTitle.minSalary).toLocaleString('vi-VN')} – ${Number(jobTitle.maxSalary).toLocaleString('vi-VN')} VNĐ`}</div>` : ''}

              <div style="margin-top:6px;font-size:13px;">
                Khung:
                <strong>
                  ${
                    jobTitle.framework
                      ? escapeCompetencyHtml(jobTitle.framework.name)
                      : 'Chưa gán'
                  }
                </strong>
              </div>
            </div>

            <button
              type="button"
              class="btn btn-outline btn-sm ${canManageCompetencies ? '' : 'hidden'}"
              data-job-title-edit="${escapeCompetencyHtml(jobTitle.id)}"
            >
              Sửa
            </button>
          </div>
        </div>
      `)
      .join('');
  }

  function populateJobTitleFrameworkOptions() {
    if (!jobTitleFrameworkSelect) return;

    const selectedValue = jobTitleFrameworkSelect.value;

    jobTitleFrameworkSelect.innerHTML =
      '<option value="">-- Chọn khung năng lực --</option>' +
      currentCompetencyFrameworks
        .filter(framework => framework.status === 'ACTIVE')
        .map(framework => `
          <option value="${escapeCompetencyHtml(framework.id)}">
            ${escapeCompetencyHtml(framework.name)} (${escapeCompetencyHtml(framework.code)})
          </option>
        `)
        .join('');

    if (
      selectedValue &&
      currentCompetencyFrameworks.some(
        framework => framework.id === selectedValue
      )
    ) {
      jobTitleFrameworkSelect.value = selectedValue;
    }
  }

  async function loadCompetencies() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (competencyFrameworkList) {
      competencyFrameworkList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Đang tải khung năng lực...
        </div>
      `;
    }

    if (jobTitleList) {
      jobTitleList.innerHTML = `
        <div style="text-align:center;color:var(--color-text-muted);padding:24px;">
          Đang tải chức danh...
        </div>
      `;
    }

    try {
      const [frameworkRes, jobTitleRes] = await Promise.all([
        window.ATS_API.getCompetencyFrameworksApi(token),
        window.ATS_API.getJobTitlesApi(token)
      ]);

      if (!frameworkRes.ok) {
        throw new Error(
          frameworkRes.data?.message ||
          'Không thể tải danh sách khung năng lực.'
        );
      }

      if (!jobTitleRes.ok) {
        throw new Error(
          jobTitleRes.data?.message ||
          'Không thể tải danh sách chức danh.'
        );
      }

      currentCompetencyFrameworks =
        frameworkRes.data.frameworks || [];

      currentJobTitles =
        jobTitleRes.data.jobTitles || [];
      canManageCompetencies=jobTitleRes.data.canManage!==false;
      for(const form of [competencyFrameworkForm,jobTitleForm])form?.querySelectorAll('input,select,textarea,button').forEach(node=>{node.disabled=!canManageCompetencies;});
      canViewJobTitleSalary = jobTitleRes.data.canViewSalary === true;
      if (jobTitleSalaryFields) {
        jobTitleSalaryFields.disabled = !canViewJobTitleSalary;
        jobTitleSalaryFields.classList.toggle('hidden', !canViewJobTitleSalary);
      }
      if (jobTitleSalaryAccessNote) jobTitleSalaryAccessNote.classList.toggle('hidden', canViewJobTitleSalary);
      if (jobTitleSaveBtn) jobTitleSaveBtn.disabled = !canViewJobTitleSalary && !jobTitleIdInput?.value;

      renderCompetencyFrameworks();
      renderJobTitles();
      populateJobTitleFrameworkOptions();

      if (
        competencyCriteriaContainer &&
        competencyCriteriaContainer.children.length === 0
      ) {
        addCompetencyCriterionRow();
      }
    } catch (error) {
      console.error('Failed to load competencies:', error);

      if (competencyFrameworkList) {
        competencyFrameworkList.innerHTML = `
          <div style="text-align:center;color:var(--color-danger);padding:24px;">
            ${escapeCompetencyHtml(error.message)}
          </div>
        `;
      }

      if (jobTitleList) {
        jobTitleList.innerHTML = `
          <div style="text-align:center;color:var(--color-danger);padding:24px;">
            ${escapeCompetencyHtml(error.message)}
          </div>
        `;
      }
    }
  }

  function hideCompetencyFrameworkError() {
    if (competencyFrameworkFormAlert) {
      competencyFrameworkFormAlert.classList.add('hidden');
    }

    if (competencyFrameworkFormAlertMsg) {
      competencyFrameworkFormAlertMsg.textContent = '';
    }
  }

  function showCompetencyFrameworkError(message) {
    if (competencyFrameworkFormAlertMsg) {
      competencyFrameworkFormAlertMsg.textContent =
        message || 'Không thể lưu khung năng lực.';
    }

    if (competencyFrameworkFormAlert) {
      competencyFrameworkFormAlert.classList.remove('hidden');
    }
  }

  function resetCompetencyFrameworkForm() {
    if (competencyFrameworkForm) {
      competencyFrameworkForm.reset();
    }

    if (competencyFrameworkIdInput) {
      competencyFrameworkIdInput.value = '';
    }

    if (competencyFrameworkFormTitle) {
      competencyFrameworkFormTitle.textContent = 'Thêm khung năng lực';
    }

    if (competencyFrameworkSaveBtn) {
      competencyFrameworkSaveBtn.textContent = 'Lưu khung năng lực';
    }

    if (competencyCriteriaContainer) {
      competencyCriteriaContainer.innerHTML = '';
      addCompetencyCriterionRow();
    }

    hideCompetencyFrameworkError();
    updateCompetencyTotalWeight();
  }

  function editCompetencyFramework(frameworkId) {
    const framework = currentCompetencyFrameworks.find(
      item => item.id === frameworkId
    );

    if (!framework) return;

    if (competencyFrameworkIdInput) {
      competencyFrameworkIdInput.value = framework.id;
    }

    if (competencyFrameworkCodeInput) {
      competencyFrameworkCodeInput.value = framework.code || '';
    }

    if (competencyFrameworkNameInput) {
      competencyFrameworkNameInput.value = framework.name || '';
    }

    if (competencyFrameworkDescriptionInput) {
      competencyFrameworkDescriptionInput.value =
        framework.description || '';
    }

    if (competencyCriteriaContainer) {
      competencyCriteriaContainer.innerHTML = '';

      const criteria = Array.isArray(framework.criteria)
        ? framework.criteria
        : [];

      criteria.forEach(criterion => {
        addCompetencyCriterionRow(criterion);
      });

      if (criteria.length === 0) {
        addCompetencyCriterionRow();
      }
    }

    if (competencyFrameworkFormTitle) {
      competencyFrameworkFormTitle.textContent =
        'Cập nhật khung năng lực';
    }

    if (competencyFrameworkSaveBtn) {
      competencyFrameworkSaveBtn.textContent = 'Cập nhật';
    }

    hideCompetencyFrameworkError();
    updateCompetencyTotalWeight();

    if (competencyFrameworkCodeInput) {
      competencyFrameworkCodeInput.focus();
    }
  }

  if (competencyAddCriterionBtn) {
    competencyAddCriterionBtn.addEventListener('click', () => {
      addCompetencyCriterionRow();
    });
  }

  if (competencyCriteriaContainer) {
    competencyCriteriaContainer.addEventListener('input', event => {
      if (event.target.matches('[data-criterion-weight]')) {
        updateCompetencyTotalWeight();
      }
    });

    competencyCriteriaContainer.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-remove-criterion]');
      if (!removeBtn) return;

      const row = removeBtn.closest('.competency-criterion-row');
      if (row) row.remove();

      if (competencyCriteriaContainer.children.length === 0) {
        addCompetencyCriterionRow();
      }

      updateCompetencyTotalWeight();
    });
  }

  if (competencyFrameworkList) {
    competencyFrameworkList.addEventListener('click', event => {
      const button = event.target.closest('[data-competency-edit]');
      if (!button) return;

      editCompetencyFramework(button.dataset.competencyEdit);
    });
  }

  if (competencyFrameworkResetBtn) {
    competencyFrameworkResetBtn.addEventListener(
      'click',
      resetCompetencyFrameworkForm
    );
  }

  if (competencyFrameworkForm) {
    competencyFrameworkForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token = sessionStorage.getItem('ats_token');
        if (!token) return;

        hideCompetencyFrameworkError();

        const frameworkId = competencyFrameworkIdInput
          ? competencyFrameworkIdInput.value.trim()
          : '';

        const criteria = competencyCriteriaContainer
          ? Array.from(
              competencyCriteriaContainer.querySelectorAll(
                '.competency-criterion-row'
              )
            ).map(row => ({
              id: row.dataset.criterionId || null,
              name:
                row.querySelector('[data-criterion-name]')?.value.trim() || '',
              weight: Number(
                row.querySelector('[data-criterion-weight]')?.value
              ) || 0
            }))
          : [];

        const payload = {
          code: competencyFrameworkCodeInput
            ? competencyFrameworkCodeInput.value.trim()
            : '',
          name: competencyFrameworkNameInput
            ? competencyFrameworkNameInput.value.trim()
            : '',
          description: competencyFrameworkDescriptionInput
            ? competencyFrameworkDescriptionInput.value.trim()
            : '',
          criteria
        };

        if (!payload.code || !payload.name) {
          showCompetencyFrameworkError(
            'Vui lòng nhập mã và tên khung năng lực.'
          );
          return;
        }

        if (
          criteria.length === 0 ||
          criteria.some(
            criterion =>
              !criterion.name ||
              !Number.isInteger(criterion.weight) ||
              criterion.weight <= 0 ||
              criterion.weight > 100
          )
        ) {
          showCompetencyFrameworkError(
            'Mỗi tiêu chí phải có tên và trọng số từ 1 đến 100%.'
          );
          return;
        }

        const totalWeight = criteria.reduce(
          (sum, criterion) => sum + criterion.weight,
          0
        );

        if (totalWeight !== 100) {
          showCompetencyFrameworkError(
            `Tổng trọng số phải bằng 100%. Hiện tại là ${totalWeight}%.`
          );
          return;
        }

        if (competencyFrameworkSaveBtn) {
          competencyFrameworkSaveBtn.disabled = true;
        }

        try {
          const res = frameworkId
            ? await window.ATS_API.updateCompetencyFrameworkApi(
                token,
                frameworkId,
                payload
              )
            : await window.ATS_API.createCompetencyFrameworkApi(
                token,
                payload
              );

          if (res.ok && res.data?.success) {
            showToast(
              'success',
              'Thành công',
              frameworkId
                ? 'Đã cập nhật khung năng lực.'
                : 'Đã tạo khung năng lực.'
            );

            resetCompetencyFrameworkForm();
            await loadCompetencies();
          } else {
            showCompetencyFrameworkError(
              res.data?.message ||
              'Không thể lưu khung năng lực.'
            );
          }
        } catch (error) {
          showCompetencyFrameworkError(error.message);
        } finally {
          if (competencyFrameworkSaveBtn) {
            competencyFrameworkSaveBtn.disabled = false;
          }
        }
      }
    );
  }

  function hideJobTitleError() {
    if (jobTitleFormAlert) {
      jobTitleFormAlert.classList.add('hidden');
    }

    if (jobTitleFormAlertMsg) {
      jobTitleFormAlertMsg.textContent = '';
    }
  }

  function showJobTitleError(message) {
    if (jobTitleFormAlertMsg) {
      jobTitleFormAlertMsg.textContent =
        message || 'Không thể lưu chức danh.';
    }

    if (jobTitleFormAlert) {
      jobTitleFormAlert.classList.remove('hidden');
    }
  }

  function resetJobTitleForm() {
    if (jobTitleForm) {
      jobTitleForm.reset();
    }

    if (jobTitleIdInput) {
      jobTitleIdInput.value = '';
    }

    if (jobTitleFormTitle) {
      jobTitleFormTitle.textContent = 'Thêm chức danh';
    }

    if (jobTitleSaveBtn) {
      jobTitleSaveBtn.textContent = 'Lưu chức danh';
      jobTitleSaveBtn.disabled = !canViewJobTitleSalary;
    }

    hideJobTitleError();
    populateJobTitleFrameworkOptions();
  }

  function editJobTitle(jobTitleId) {
    const jobTitle = currentJobTitles.find(
      item => item.id === jobTitleId
    );

    if (!jobTitle) return;

    if (jobTitleIdInput) {
      jobTitleIdInput.value = jobTitle.id;
    }

    if (jobTitleCodeInput) {
      jobTitleCodeInput.value = jobTitle.code || '';
    }

    if (jobTitleNameInput) {
      jobTitleNameInput.value = jobTitle.name || '';
    }
    if (jobTitleLevelInput) jobTitleLevelInput.value = jobTitle.level || '';
    if (jobTitleMinSalaryInput) jobTitleMinSalaryInput.value = canViewJobTitleSalary ? jobTitle.minSalary ?? '' : '';
    if (jobTitleMaxSalaryInput) jobTitleMaxSalaryInput.value = canViewJobTitleSalary ? jobTitle.maxSalary ?? '' : '';

    if (jobTitleFrameworkSelect) {
      jobTitleFrameworkSelect.value =
        jobTitle.framework?.id || '';
    }

    if (jobTitleFormTitle) {
      jobTitleFormTitle.textContent = 'Cập nhật chức danh';
    }

    if (jobTitleSaveBtn) {
      jobTitleSaveBtn.textContent = 'Cập nhật';
      jobTitleSaveBtn.disabled = false;
    }

    hideJobTitleError();

    if (jobTitleCodeInput) {
      jobTitleCodeInput.focus();
    }
  }

  if (jobTitleList) {
    jobTitleList.addEventListener('click', event => {
      const button = event.target.closest('[data-job-title-edit]');
      if (!button) return;

      editJobTitle(button.dataset.jobTitleEdit);
    });
  }

  if (jobTitleResetBtn) {
    jobTitleResetBtn.addEventListener(
      'click',
      resetJobTitleForm
    );
  }

  if (jobTitleForm) {
    jobTitleForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const token = sessionStorage.getItem('ats_token');
        if (!token) return;

        hideJobTitleError();

        const jobTitleId = jobTitleIdInput
          ? jobTitleIdInput.value.trim()
          : '';

        const payload = {
          code: jobTitleCodeInput
            ? jobTitleCodeInput.value.trim()
            : '',
          name: jobTitleNameInput
            ? jobTitleNameInput.value.trim()
            : '',
          level: jobTitleLevelInput ? jobTitleLevelInput.value.trim() : '',
          frameworkId: jobTitleFrameworkSelect
            ? jobTitleFrameworkSelect.value
            : ''
        };

        if (
          !payload.code ||
          !payload.name ||
          !payload.level
        ) {
          showJobTitleError(
            'Vui lòng nhập mã, tên và cấp bậc chức danh.'
          );
          return;
        }

        const framework = currentCompetencyFrameworks.find(
          item => item.id === payload.frameworkId
        );

        if (payload.frameworkId && !framework) {
          showJobTitleError(
            'Khung năng lực được chọn không tồn tại.'
          );
          return;
        }

        if (framework && Number(framework.totalWeight) !== 100) {
          showJobTitleError(
            'Khung năng lực phải có tổng trọng số bằng 100%.'
          );
          return;
        }

        if (canViewJobTitleSalary) {
          const minimum = jobTitleMinSalaryInput?.value.trim();
          const maximum = jobTitleMaxSalaryInput?.value.trim();
          if (!minimum || !maximum || !Number.isSafeInteger(Number(minimum)) || !Number.isSafeInteger(Number(maximum)) || Number(minimum) < 0 || Number(minimum) > Number(maximum)) {
            showJobTitleError('Dải lương phải gồm hai số nguyên không âm; tối thiểu không vượt tối đa.');
            return;
          }
          payload.minSalary = Number(minimum);
          payload.maxSalary = Number(maximum);
        }
        if (jobTitleSaveBtn) jobTitleSaveBtn.disabled = true;

        try {
          const res = jobTitleId
            ? await window.ATS_API.updateJobTitleApi(
                token,
                jobTitleId,
                payload
              )
            : await window.ATS_API.createJobTitleApi(
                token,
                payload
              );

          if (res.ok && res.data?.success) {
            showToast(
              'success',
              'Thành công',
              jobTitleId
                ? 'Đã cập nhật chức danh.'
                : 'Đã tạo chức danh.'
            );

            resetJobTitleForm();
            await loadCompetencies();
          } else {
            showJobTitleError(
              res.data?.message ||
              'Không thể lưu chức danh.'
            );
          }
        } catch (error) {
          showJobTitleError(error.message);
        } finally {
          if (jobTitleSaveBtn) {
            jobTitleSaveBtn.disabled = !canViewJobTitleSalary && !jobTitleIdInput?.value;
          }
        }
      }
    );
  }
