(function () {
  let activeEvaluation = null;
  let activeInterviewId = null;

  async function openEvaluationModal(interviewId, interviewerId = null) {
    activeInterviewId = interviewId;
    const token = sessionStorage.getItem('ats_token');
    const modal = document.getElementById('interview-evaluation-modal');
    if (!modal) return;

    const res = await window.ATS_API.getInterviewEvaluationFormApi(token, interviewId, interviewerId);
    if (!res.ok || !res.data || !res.data.success) {
      if (typeof showToast === 'function') {
        showToast('danger', 'Lỗi tải phiếu đánh giá', res.data?.message || 'Không thể tải phiếu đánh giá.');
      }
      return;
    }

    activeEvaluation = res.data.evaluation;
    renderEvaluationForm(activeEvaluation);
    modal.classList.remove('hidden');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderEvaluationForm(evalData) {
    document.getElementById('eval-interview-id').value = activeInterviewId || '';
    document.getElementById('eval-form-id').value = evalData.id || '';
    document.getElementById('eval-interviewer-id').value = evalData.interviewerId || '';

    const candidateEl = document.getElementById('eval-candidate-info');
    if (candidateEl) candidateEl.textContent = `Phiếu đánh giá: ${evalData.interviewerName || evalData.interviewerId || 'Người phỏng vấn'}`;

    const jobTitleEl = document.getElementById('eval-job-title');
    if (jobTitleEl) jobTitleEl.textContent = evalData.jobTitleName || 'Chưa gắn chức danh';

    switchTab('criteria');
    const critSelect = document.getElementById('eval-questions-criterion-filter');
    if (critSelect && evalData.criteria) {
      critSelect.innerHTML = '<option value="">Tất cả tiêu chí</option>' +
        evalData.criteria.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    }

    const templateEl = document.getElementById('eval-template-name');
    if (templateEl) templateEl.textContent = evalData.templateName || 'Tiêu chuẩn';

    const statusBadge = document.getElementById('eval-status-badge');
    if (statusBadge) {
      statusBadge.textContent = evalData.status;
      statusBadge.className = `badge badge-${evalData.status === 'SUBMITTED' ? 'success' : evalData.status === 'REOPENED' ? 'warning' : 'secondary'}`;
    }

    const isSubmitted = evalData.status === 'SUBMITTED';
    const isLocked = isSubmitted;

    const reopenNotice = document.getElementById('eval-reopen-notice');
    if (reopenNotice) {
      if (evalData.reopenedAt) {
        reopenNotice.textContent = `Phiếu đã được mở lại vào ${new Date(evalData.reopenedAt).toLocaleString()}: ${evalData.reopenReason || ''}`;
        reopenNotice.classList.remove('hidden');
      } else {
        reopenNotice.classList.add('hidden');
      }
    }

    const container = document.getElementById('eval-criteria-container');
    if (container) {
      container.innerHTML = '';
      (evalData.criteria || []).forEach((crit, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.style.border = '1px solid var(--color-border)';
        itemDiv.style.borderRadius = 'var(--radius-sm)';
        itemDiv.style.padding = '12px 14px';
        itemDiv.style.background = 'var(--color-bg-card, #fff)';

        itemDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div>
              <strong style="font-size: 0.95rem;">${index + 1}. ${escapeHtml(crit.name)}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 2px;">${escapeHtml(crit.description || '')}</div>
            </div>
            <span class="badge badge-outline" style="white-space: nowrap; margin-left: 8px;">Trọng số: ${crit.weight}</span>
          </div>
          <div style="display: grid; grid-template-columns: 160px 1fr; gap: 10px; margin-top: 10px; align-items: start;">
            <div>
              <label class="form-label" style="font-size: 0.8rem;">Điểm (1 - 5) <span style="color:var(--color-danger)">*</span></label>
              <select class="form-input eval-criterion-score" data-crit-id="${crit.id}" ${isLocked ? 'disabled' : ''}>
                <option value="">-- Chưa chấm --</option>
                <option value="5" ${crit.score === 5 ? 'selected' : ''}>5 - Xuất sắc</option>
                <option value="4" ${crit.score === 4 ? 'selected' : ''}>4 - Tốt</option>
                <option value="3" ${crit.score === 3 ? 'selected' : ''}>3 - Đạt</option>
                <option value="2" ${crit.score === 2 ? 'selected' : ''}>2 - Cần cải thiện</option>
                <option value="1" ${crit.score === 1 ? 'selected' : ''}>1 - Không đạt</option>
              </select>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.8rem;">Nhận xét tiêu chí</label>
              <input type="text" class="form-input eval-criterion-comment" data-crit-id="${crit.id}" value="${escapeHtml(crit.comment || '')}" placeholder="Nhận xét cụ thể cho tiêu chí này..." ${isLocked ? 'disabled' : ''} />
            </div>
          </div>
        `;
        container.appendChild(itemDiv);
      });

      container.querySelectorAll('.eval-criterion-score').forEach(el => {
        el.addEventListener('change', updateScorePreview);
      });
    }

    const recSelect = document.getElementById('eval-recommendation-select');
    if (recSelect) {
      recSelect.value = evalData.recommendation || '';
      recSelect.disabled = isLocked;
    }

    const notesEl = document.getElementById('eval-general-notes');
    if (notesEl) {
      notesEl.value = evalData.generalNotes || '';
      notesEl.disabled = isLocked;
    }

    const scoreDisplay = document.getElementById('eval-total-score-display');
    if (scoreDisplay) {
      scoreDisplay.textContent = evalData.totalScore !== null ? `${evalData.totalScore.toFixed(2)} / 5.00` : '-- / 5.00';
    }

    const saveDraftBtn = document.getElementById('eval-save-draft-btn');
    if (saveDraftBtn) saveDraftBtn.classList.toggle('hidden', isLocked);

    const submitBtn = document.getElementById('eval-submit-btn');
    if (submitBtn) submitBtn.classList.toggle('hidden', isLocked);

    const reopenToggleBtn = document.getElementById('eval-reopen-toggle-btn');
    const reopenSec = document.getElementById('eval-reopen-section');
    if (reopenSec) reopenSec.classList.add('hidden');

    const authenticatedUser = typeof currentAuthenticatedUser === 'undefined' ? null : currentAuthenticatedUser;
    const canReopen = isSubmitted && authenticatedUser && authenticatedUser.roles && authenticatedUser.roles.some(r => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(r));
    if (reopenToggleBtn) reopenToggleBtn.classList.toggle('hidden', !canReopen);

    updateScorePreview();
  }

  function updateScorePreview() {
    if (!activeEvaluation) return;
    const criteria = activeEvaluation.criteria || [];
    let sumScore = 0;
    let sumWeight = 0;
    let filled = 0;

    const container = document.getElementById('eval-criteria-container');
    if (!container) return;

    container.querySelectorAll('.eval-criterion-score').forEach(select => {
      const critId = select.getAttribute('data-crit-id');
      const crit = criteria.find(c => c.id === critId);
      const val = select.value;
      if (crit && val !== '') {
        const score = Number(val);
        const weight = Number(crit.weight);
        sumScore += score * weight;
        sumWeight += weight;
        filled++;
      }
    });

    const display = document.getElementById('eval-total-score-display');
    if (!display) return;

    if (filled > 0 && sumWeight > 0) {
      const avg = (sumScore / sumWeight).toFixed(2);
      display.textContent = `${avg} / 5.00`;
    } else {
      display.textContent = '-- / 5.00';
    }
  }

  function collectCriteriaData() {
    const container = document.getElementById('eval-criteria-container');
    if (!container) return [];
    const list = [];
    container.querySelectorAll('.eval-criterion-score').forEach(select => {
      const critId = select.getAttribute('data-crit-id');
      const commentInput = container.querySelector(`.eval-criterion-comment[data-crit-id="${critId}"]`);
      list.push({
        id: critId,
        score: select.value !== '' ? Number(select.value) : null,
        comment: commentInput ? commentInput.value.trim() : ''
      });
    });
    return list;
  }

  async function handleSave(status) {
    if (!activeInterviewId || !activeEvaluation) return;
    const token = sessionStorage.getItem('ats_token');
    const criteria = collectCriteriaData();
    const recommendation = document.getElementById('eval-recommendation-select')?.value || null;
    const generalNotes = document.getElementById('eval-general-notes')?.value || '';

    if (status === 'SUBMITTED') {
      if (!recommendation) {
        if (typeof showToast === 'function') showToast('warning', 'Yêu cầu kết luận', 'Vui lòng chọn kết luận phỏng vấn trước khi nộp.');
        return;
      }
      const unrated = criteria.some(c => c.score === null || c.score === undefined);
      if (unrated) {
        if (typeof showToast === 'function') showToast('warning', 'Chưa hoàn thành chấm điểm', 'Tất cả các tiêu chí phải được chấm điểm từ 1 đến 5 khi nộp phiếu.');
        return;
      }
    }

    const body = {
      interviewerId: activeEvaluation.interviewerId,
      status,
      recommendation,
      generalNotes,
      criteria
    };

    const res = await window.ATS_API.saveInterviewEvaluationApi(token, activeInterviewId, body);
    if (res.ok && res.data && res.data.success) {
      activeEvaluation = res.data.evaluation;
      renderEvaluationForm(activeEvaluation);
      if (typeof showToast === 'function') {
        showToast('success', status === 'SUBMITTED' ? 'Đã nộp phiếu đánh giá' : 'Đã lưu bản nháp', status === 'SUBMITTED' ? 'Phiếu đánh giá đã được khóa và ghi nhận kết quả.' : 'Bản nháp đánh giá đã được lưu.');
      }
      if (typeof loadInterviews === 'function') loadInterviews();
      if (typeof loadDashboardData === 'function') loadDashboardData();
    } else {
      if (typeof showToast === 'function') {
        showToast('danger', 'Lỗi lưu phiếu', res.data?.message || 'Không thể lưu phiếu đánh giá.');
      }
    }
  }

  function switchTab(tab) {
    const critBtn = document.getElementById('eval-tab-criteria-btn');
    const qBtn = document.getElementById('eval-tab-questions-btn');
    const critPane = document.getElementById('eval-tab-criteria-pane');
    const qPane = document.getElementById('eval-tab-questions-pane');
    if (!critBtn || !qBtn || !critPane || !qPane) return;

    if (tab === 'criteria') {
      critBtn.className = 'btn btn-sm btn-primary active';
      qBtn.className = 'btn btn-sm btn-outline';
      critPane.classList.remove('hidden');
      qPane.classList.add('hidden');
    } else {
      qBtn.className = 'btn btn-sm btn-primary active';
      critBtn.className = 'btn btn-sm btn-outline';
      qPane.classList.remove('hidden');
      critPane.classList.add('hidden');
      loadSuggestedQuestions();
    }
  }

  async function loadSuggestedQuestions() {
    if (!activeInterviewId) return;
    const token = sessionStorage.getItem('ats_token');
    const container = document.getElementById('eval-suggested-questions-container');
    const countBadge = document.getElementById('eval-questions-count-badge');
    const critFilter = document.getElementById('eval-questions-criterion-filter')?.value || '';
    const diffFilter = document.getElementById('eval-questions-difficulty-filter')?.value || 'ALL';

    if (container) {
      container.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: 20px;">Đang tải câu hỏi gợi ý...</div>';
    }

    const res = await window.ATS_API.getInterviewSuggestedQuestionsApi(token, activeInterviewId, {
      criterionId: critFilter,
      difficulty: diffFilter
    });

    if (!res.ok || !res.data || !res.data.success) {
      if (container) {
        container.innerHTML = `<div style="text-align: center; color: var(--color-danger); padding: 20px;">${escapeHtml(res.data?.message || 'Không thể tải câu hỏi gợi ý.')}</div>`;
      }
      return;
    }

    const questions = res.data.questions || res.data.data || [];
    if (countBadge) {
      countBadge.textContent = `${questions.length} câu hỏi`;
    }

    if (questions.length === 0) {
      if (container) {
        container.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: 24px;">Không có câu hỏi gợi ý phù hợp với tiêu chí lọc.</div>';
      }
      return;
    }

    if (container) {
      container.innerHTML = questions.map(q => {
        const diffBadge = q.difficultyLevel === 'EASY'
          ? '<span class="badge" style="background: #dcfce7; color: #15803d; font-size: 0.7rem;">Dễ</span>'
          : (q.difficultyLevel === 'HARD'
            ? '<span class="badge" style="background: #fee2e2; color: #b91c1c; font-size: 0.7rem;">Khó</span>'
            : '<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 0.7rem;">Trung bình</span>');

        const prevBadge = q.isAskedInPreviousRound
          ? `<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 0.7rem;">⚠️ Đã hỏi ở: ${escapeHtml(q.previousRoundName || 'Vòng trước')}</span>`
          : '';

        const hintHtml = q.goodAnswerHint
          ? `<div style="margin-top: 6px; font-size: 0.8rem; color: var(--color-text-secondary); background: var(--color-bg-page); padding: 6px 10px; border-radius: var(--radius-sm); border-left: 3px solid var(--color-primary);"><strong>Gợi ý câu trả lời tốt:</strong> ${escapeHtml(q.goodAnswerHint)}</div>`
          : '';

        const askedBtnClass = q.isAskedInCurrentRound ? 'btn-success' : 'btn-outline';
        const askedBtnText = q.isAskedInCurrentRound ? '✓ Đã hỏi' : 'Đánh dấu đã hỏi';

        return `
          <div class="suggested-question-card" style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 12px; background: var(--color-bg-card, #fff);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div style="flex: 1;">
                <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px; flex-wrap: wrap;">
                  <span class="badge badge-outline" style="font-size: 0.7rem; font-weight: 600;">${escapeHtml(q.criterionName || q.category || 'Tiêu chí')}</span>
                  ${diffBadge}
                  ${prevBadge}
                </div>
                <div style="font-weight: 600; font-size: 0.95rem; margin-top: 6px; line-height: 1.4;">${escapeHtml(q.questionText)}</div>
                ${hintHtml}
              </div>
              <button type="button" class="btn btn-sm ${askedBtnClass} btn-toggle-question" data-question-id="${escapeHtml(q.id)}" style="white-space: nowrap; margin-left: 8px; align-self: flex-start;">
                ${askedBtnText}
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function init() {
    const modal = document.getElementById('interview-evaluation-modal');
    if (!modal) return;

    document.getElementById('close-interview-evaluation-modal')?.addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('close-eval-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));

    document.getElementById('eval-tab-criteria-btn')?.addEventListener('click', () => switchTab('criteria'));
    document.getElementById('eval-tab-questions-btn')?.addEventListener('click', () => switchTab('questions'));
    document.getElementById('eval-questions-criterion-filter')?.addEventListener('change', loadSuggestedQuestions);
    document.getElementById('eval-questions-difficulty-filter')?.addEventListener('change', loadSuggestedQuestions);

    const questionsContainer = document.getElementById('eval-suggested-questions-container');
    if (questionsContainer) {
      questionsContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-toggle-question');
        if (!btn) return;
        const qId = btn.dataset.questionId;
        if (!qId || !activeInterviewId) return;
        btn.disabled = true;
        const token = sessionStorage.getItem('ats_token');
        const res = await window.ATS_API.toggleInterviewQuestionAskedApi(token, activeInterviewId, qId);
        btn.disabled = false;
        if (res.ok && res.data && res.data.success) {
          const isAsked = res.data.asked ?? res.data.isAskedInCurrentRound;
          btn.className = `btn btn-sm ${isAsked ? 'btn-success' : 'btn-outline'} btn-toggle-question`;
          btn.textContent = isAsked ? '✓ Đã hỏi' : 'Đánh dấu đã hỏi';
          if (typeof showToast === 'function') {
            showToast('success', isAsked ? 'Đã đánh dấu' : 'Đã bỏ đánh dấu', isAsked ? 'Đã ghi nhận câu hỏi đã hỏi.' : 'Đã bỏ đánh dấu câu hỏi.');
          }
        } else {
          if (typeof showToast === 'function') {
            showToast('danger', 'Lỗi', res.data?.message || 'Không thể thay đổi trạng thái.');
          }
        }
      });
    }

    document.getElementById('eval-save-draft-btn')?.addEventListener('click', () => handleSave('DRAFT'));
    document.getElementById('eval-submit-btn')?.addEventListener('click', () => handleSave('SUBMITTED'));

    const reopenToggleBtn = document.getElementById('eval-reopen-toggle-btn');
    const reopenSec = document.getElementById('eval-reopen-section');
    reopenToggleBtn?.addEventListener('click', () => {
      if (reopenSec) reopenSec.classList.toggle('hidden');
    });

    document.getElementById('eval-reopen-submit-btn')?.addEventListener('click', async () => {
      const reason = document.getElementById('eval-reopen-reason-input')?.value.trim() || '';
      if (reason.length < 3) {
        if (typeof showToast === 'function') showToast('warning', 'Yêu cầu lý do', 'Vui lòng nhập lý do mở lại phiếu (tối thiểu 3 ký tự).');
        return;
      }
      const token = sessionStorage.getItem('ats_token');
      const res = await window.ATS_API.reopenInterviewEvaluationApi(token, activeInterviewId, {
        interviewerId: activeEvaluation?.interviewerId,
        reason
      });
      if (res.ok && res.data && res.data.success) {
        activeEvaluation = res.data.evaluation;
        renderEvaluationForm(activeEvaluation);
        if (typeof showToast === 'function') showToast('success', 'Đã mở lại phiếu', 'Phiếu đánh giá đã được mở lại để chỉnh sửa.');
      } else {
        if (typeof showToast === 'function') showToast('danger', 'Không thể mở lại', res.data?.message || 'Lỗi khi mở lại phiếu.');
      }
    });

    document.getElementById('open-competency-eval-btn')?.addEventListener('click', () => {
      const intId = document.getElementById('int-detail-id')?.value;
      if (intId) openEvaluationModal(intId);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.openInterviewEvaluationModal = openEvaluationModal;
})();
