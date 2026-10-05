  // ==============================================================================
  // ==============================================================================
  // INTERVIEW QUESTION BANK
  // ==============================================================================

  const questionBankSearchInput =
    document.getElementById('question-bank-search-input');
  const questionBankJobTitleFilter =
    document.getElementById('question-bank-job-title-filter');
  const questionBankCriterionFilter =
    document.getElementById('question-bank-criterion-filter');
  const questionBankRefreshBtn =
    document.getElementById('question-bank-refresh-btn');
  const questionBankTableBody =
    document.getElementById('question-bank-table-body');
  const questionBankTotalBadge =
    document.getElementById('question-bank-total-badge');

  function escapeQuestionBankHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderQuestionBankCriterionFilter() {
    if (!questionBankCriterionFilter) return;

    const selectedJobTitleId =
      questionBankJobTitleFilter
        ? questionBankJobTitleFilter.value
        : '';

    const selectedJobTitle =
      questionBankFilterOptions.jobTitles.find(
        item => item.id === selectedJobTitleId
      );

    const currentValue = questionBankCriterionFilter.value;

    const criteria = selectedJobTitle
      ? questionBankFilterOptions.criteria.filter(
          criterion =>
            criterion.frameworkId === selectedJobTitle.frameworkId
        )
      : questionBankFilterOptions.criteria;

    questionBankCriterionFilter.innerHTML =
      '<option value="">Tất cả tiêu chí</option>' +
      criteria.map(criterion => `
        <option value="${escapeQuestionBankHtml(criterion.id)}">
          ${escapeQuestionBankHtml(criterion.name)}
        </option>
      `).join('');

    if (criteria.some(item => item.id === currentValue)) {
      questionBankCriterionFilter.value = currentValue;
    }
  }

  async function loadQuestionBankFilterOptions(token) {
    const res =
      await window.ATS_API.getInterviewQuestionFiltersApi(token);

    if (!res.ok || !res.data || !res.data.success) {
      throw new Error(
        res.data?.message ||
        'Không thể tải bộ lọc ngân hàng câu hỏi.'
      );
    }

    questionBankFilterOptions = {
      jobTitles: Array.isArray(res.data.jobTitles)
        ? res.data.jobTitles
        : [],
      criteria: Array.isArray(res.data.criteria)
        ? res.data.criteria
        : []
    };

    if (questionBankJobTitleFilter) {
      const currentValue = questionBankJobTitleFilter.value;

      questionBankJobTitleFilter.innerHTML =
        '<option value="">Tất cả chức danh</option>' +
        questionBankFilterOptions.jobTitles.map(jobTitle => `
          <option value="${escapeQuestionBankHtml(jobTitle.id)}">
            ${escapeQuestionBankHtml(jobTitle.name)}
          </option>
        `).join('');

      if (
        questionBankFilterOptions.jobTitles.some(
          item => item.id === currentValue
        )
      ) {
        questionBankJobTitleFilter.value = currentValue;
      }
    }

    renderQuestionBankCriterionFilter();
  }

  function renderQuestionBankTable(list) {
    if (!questionBankTableBody) return;

    if (!Array.isArray(list) || list.length === 0) {
      questionBankTableBody.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;color:var(--color-text-muted);padding:24px;">
            Không có câu hỏi phỏng vấn phù hợp.
          </td>
        </tr>
      `;
      return;
    }

    const difficultyLabels = {
      EASY: 'Dễ',
      MEDIUM: 'Trung bình',
      HARD: 'Khó'
    };

    questionBankTableBody.innerHTML = list.map(question => `
      <tr>
        <td style="min-width:260px;">
          <strong>${escapeQuestionBankHtml(question.questionText)}</strong>
        </td>
        <td>${escapeQuestionBankHtml(question.criterion?.name || '')}</td>
        <td>${escapeQuestionBankHtml(question.framework?.name || '')}</td>
        <td>
          <span class="badge badge-primary">
            ${escapeQuestionBankHtml(
              difficultyLabels[question.difficulty] ||
              question.difficulty
            )}
          </span>
        </td>
        <td style="min-width:280px;">
          ${escapeQuestionBankHtml(question.goodAnswerHint)}
        </td>
        <td>
          <span class="badge ${
            question.status === 'ACTIVE'
              ? 'badge-success'
              : 'badge-secondary'
          }">
            ${
              question.status === 'ACTIVE'
                ? 'Đang áp dụng'
                : 'Ngừng áp dụng'
            }
          </span>
        </td>
        <td style="text-align:center;">
          ${
            canManageQuestionBank()
              ? `
                <button
                  type="button"
                  class="btn btn-outline btn-sm question-bank-edit-btn"
                  data-question-id="${escapeQuestionBankHtml(question.id)}"
                >
                  Sửa
                </button>
              `
              : '<span style="color:var(--color-text-muted);">—</span>'
          }
        </td>
      </tr>
    `).join('');
  }

  const questionBankCreateBtn =
    document.getElementById('question-bank-create-btn');
  const questionBankModal =
    document.getElementById('question-bank-modal');
  const questionBankModalTitle =
    document.getElementById('question-bank-modal-title');
  const questionBankModalClose =
    document.getElementById('question-bank-modal-close');
  const questionBankFormCancel =
    document.getElementById('question-bank-form-cancel');
  const questionBankForm =
    document.getElementById('question-bank-form');
  const questionBankEditId =
    document.getElementById('question-bank-edit-id');
  const questionBankFormCriterion =
    document.getElementById('question-bank-form-criterion');
  const questionBankFormText =
    document.getElementById('question-bank-form-text');
  const questionBankFormDifficulty =
    document.getElementById('question-bank-form-difficulty');
  const questionBankFormStatus =
    document.getElementById('question-bank-form-status');
  const questionBankFormHint =
    document.getElementById('question-bank-form-hint');
  const questionBankFormAlert =
    document.getElementById('question-bank-form-alert');
  const questionBankFormAlertMsg =
    document.getElementById('question-bank-form-alert-msg');
  const questionBankFormSave =
    document.getElementById('question-bank-form-save');

  function canManageQuestionBank() {
    const roles =
      currentAuthenticatedUser &&
      Array.isArray(currentAuthenticatedUser.roles)
        ? currentAuthenticatedUser.roles
        : [];

    return (
      roles.includes('ADMIN') ||
      roles.includes('HR_MANAGER')
    );
  }

  function populateQuestionBankCriterionForm() {
    if (!questionBankFormCriterion) return;

    questionBankFormCriterion.innerHTML =
      '<option value="">-- Chọn tiêu chí năng lực --</option>' +
      questionBankFilterOptions.criteria.map(criterion => `
        <option value="${escapeQuestionBankHtml(criterion.id)}">
          ${escapeQuestionBankHtml(criterion.frameworkName)}
          — ${escapeQuestionBankHtml(criterion.name)}
        </option>
      `).join('');
  }

  function closeQuestionBankModal() {
    if (questionBankModal) {
      questionBankModal.classList.add('hidden');
    }
  }

  function openQuestionBankModal(question = null) {
    if (!canManageQuestionBank() || !questionBankModal) return;

    if (questionBankForm) {
      questionBankForm.reset();
    }

    if (questionBankFormAlert) {
      questionBankFormAlert.classList.add('hidden');
    }

    populateQuestionBankCriterionForm();

    const isEdit = Boolean(question);

    if (questionBankModalTitle) {
      questionBankModalTitle.textContent =
        isEdit
          ? 'Sửa câu hỏi phỏng vấn'
          : 'Thêm câu hỏi phỏng vấn';
    }

    if (questionBankEditId) {
      questionBankEditId.value =
        isEdit ? question.id : '';
    }

    if (questionBankFormCriterion) {
      questionBankFormCriterion.value =
        isEdit && question.criterion
          ? question.criterion.id
          : '';
    }

    if (questionBankFormText) {
      questionBankFormText.value =
        isEdit ? question.questionText : '';
    }

    if (questionBankFormDifficulty) {
      questionBankFormDifficulty.value =
        isEdit ? question.difficulty : 'MEDIUM';
    }

    if (questionBankFormStatus) {
      questionBankFormStatus.value =
        isEdit ? question.status : 'ACTIVE';

      questionBankFormStatus.disabled = !isEdit;
    }

    if (questionBankFormHint) {
      questionBankFormHint.value =
        isEdit ? question.goodAnswerHint : '';
    }

    questionBankModal.classList.remove('hidden');
  }

  if (questionBankCreateBtn) {
    questionBankCreateBtn.addEventListener(
      'click',
      () => {
        if (canManageQuestionBank()) {
          openQuestionBankModal();
        }
      }
    );
  }

  if (questionBankModalClose) {
    questionBankModalClose.addEventListener(
      'click',
      closeQuestionBankModal
    );
  }

  if (questionBankFormCancel) {
    questionBankFormCancel.addEventListener(
      'click',
      closeQuestionBankModal
    );
  }

  if (questionBankTableBody) {
    questionBankTableBody.addEventListener(
      'click',
      event => {
        const button =
          event.target.closest('.question-bank-edit-btn');

        if (!button || !canManageQuestionBank()) return;

        const questionId =
          button.getAttribute('data-question-id');

        const question =
          currentQuestionBankList.find(
            item => item.id === questionId
          );

        if (question) {
          openQuestionBankModal(question);
        }
      }
    );
  }

  if (questionBankForm) {
    questionBankForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        if (!canManageQuestionBank()) return;

        const token =
          sessionStorage.getItem('ats_token');

        if (!token) return;

        const id =
          questionBankEditId
            ? questionBankEditId.value
            : '';

        const payload = {
          criterionId:
            questionBankFormCriterion.value,
          questionText:
            questionBankFormText.value.trim(),
          difficulty:
            questionBankFormDifficulty.value,
          goodAnswerHint:
            questionBankFormHint.value.trim()
        };

        if (id) {
          payload.status =
            questionBankFormStatus.value;
        }

        if (
          !payload.criterionId ||
          !payload.questionText ||
          !payload.goodAnswerHint
        ) {
          if (
            questionBankFormAlert &&
            questionBankFormAlertMsg
          ) {
            questionBankFormAlertMsg.textContent =
              'Vui lòng nhập đầy đủ tiêu chí, câu hỏi và gợi ý trả lời.';
            questionBankFormAlert.classList.remove('hidden');
          }
          return;
        }

        if (questionBankFormSave) {
          questionBankFormSave.disabled = true;
        }

        try {
          const res = id
            ? await window.ATS_API.updateInterviewQuestionApi(
                token,
                id,
                payload
              )
            : await window.ATS_API.createInterviewQuestionApi(
                token,
                payload
              );

          if (res.ok && res.data && res.data.success) {
            closeQuestionBankModal();

            showToast(
              'success',
              id ? 'Đã cập nhật câu hỏi' : 'Đã thêm câu hỏi',
              res.data.message ||
                'Dữ liệu ngân hàng câu hỏi đã được lưu.'
            );

            await loadQuestionBank();
          } else if (
            questionBankFormAlert &&
            questionBankFormAlertMsg
          ) {
            questionBankFormAlertMsg.textContent =
              res.data?.message ||
              'Không thể lưu câu hỏi phỏng vấn.';
            questionBankFormAlert.classList.remove('hidden');
          }
        } catch (error) {
          if (
            questionBankFormAlert &&
            questionBankFormAlertMsg
          ) {
            questionBankFormAlertMsg.textContent =
              error.message ||
              'Lỗi kết nối khi lưu câu hỏi.';
            questionBankFormAlert.classList.remove('hidden');
          }
        } finally {
          if (questionBankFormSave) {
            questionBankFormSave.disabled = false;
          }
        }
      }
    );
  }

  async function loadQuestionBank() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (questionBankCreateBtn) {
      if (canManageQuestionBank()) {
        questionBankCreateBtn.classList.remove('hidden');
        questionBankCreateBtn.style.display = '';
      } else {
        questionBankCreateBtn.classList.add('hidden');
        questionBankCreateBtn.style.display = 'none';
      }
    }

    if (questionBankTableBody) {
      questionBankTableBody.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;color:var(--color-text-muted);padding:24px;">
            Đang tải ngân hàng câu hỏi...
          </td>
        </tr>
      `;
    }

    try {
      if (
        questionBankFilterOptions.jobTitles.length === 0 &&
        questionBankFilterOptions.criteria.length === 0
      ) {
        await loadQuestionBankFilterOptions(token);
      }

      const options = {
        search: questionBankSearchInput
          ? questionBankSearchInput.value.trim()
          : '',
        jobTitleId: questionBankJobTitleFilter
          ? questionBankJobTitleFilter.value
          : '',
        criterionId: questionBankCriterionFilter
          ? questionBankCriterionFilter.value
          : ''
      };

      const res =
        await window.ATS_API.getInterviewQuestionsApi(
          token,
          options
        );

      if (!res.ok || !res.data || !res.data.success) {
        throw new Error(
          res.data?.message ||
          'Không thể tải ngân hàng câu hỏi.'
        );
      }

      currentQuestionBankList =
        Array.isArray(res.data.questions)
          ? res.data.questions
          : [];

      if (questionBankTotalBadge) {
        questionBankTotalBadge.textContent =
          `${currentQuestionBankList.length} câu hỏi`;
      }

      renderQuestionBankTable(currentQuestionBankList);
    } catch (error) {
      console.error(
        'Failed to load interview question bank:',
        error
      );

      if (questionBankTableBody) {
        questionBankTableBody.innerHTML = `
          <tr>
            <td colspan="7"
                style="text-align:center;color:var(--color-danger);padding:24px;">
              ${escapeQuestionBankHtml(error.message)}
            </td>
          </tr>
        `;
      }
    }
  }

  if (questionBankRefreshBtn) {
    questionBankRefreshBtn.addEventListener(
      'click',
      loadQuestionBank
    );
  }

  if (questionBankSearchInput) {
    questionBankSearchInput.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Enter') {
          loadQuestionBank();
        }
      }
    );
  }

  if (questionBankJobTitleFilter) {
    questionBankJobTitleFilter.addEventListener(
      'change',
      () => {
        renderQuestionBankCriterionFilter();
        loadQuestionBank();
      }
    );
  }

  if (questionBankCriterionFilter) {
    questionBankCriterionFilter.addEventListener(
      'change',
      loadQuestionBank
    );
  }
