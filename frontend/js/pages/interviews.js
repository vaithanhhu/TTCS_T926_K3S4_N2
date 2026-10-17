  const interviewsSearchInput = document.getElementById('interviews-search-input');
  const interviewsStatusFilter = document.getElementById('interviews-status-filter');
  const interviewsTimeframeFilter = document.getElementById('interviews-timeframe-filter');
  const interviewsEvalFilter = document.getElementById('interviews-eval-filter');
  const interviewsRefreshBtn = document.getElementById('interviews-refresh-btn');
  const interviewsTableBody = document.getElementById('interviews-table-body');
  const interviewsTotalBadge = document.getElementById('interviews-total-badge');
  const tabScopeMine = document.getElementById('tab-scope-mine');
  const tabScopeAll = document.getElementById('tab-scope-all');
  let currentScope = 'mine';

  function setScope(scope) {
    currentScope = scope;
    if (tabScopeMine && tabScopeAll) {
      if (scope === 'mine') {
        tabScopeMine.classList.add('active');
        tabScopeMine.style.background = 'var(--color-primary)';
        tabScopeMine.style.color = '#fff';
        tabScopeAll.classList.remove('active');
        tabScopeAll.style.background = 'transparent';
        tabScopeAll.style.color = 'var(--color-text-muted)';
      } else {
        tabScopeAll.classList.add('active');
        tabScopeAll.style.background = 'var(--color-primary)';
        tabScopeAll.style.color = '#fff';
        tabScopeMine.classList.remove('active');
        tabScopeMine.style.background = 'transparent';
        tabScopeMine.style.color = 'var(--color-text-muted)';
      }
    }
    loadInterviews();
  }

  async function downloadCv(docId, candName) {
    const token = sessionStorage.getItem('ats_token');
    if (!token || !docId) return;
    try {
      const res = await window.ATS_API.downloadCandidateCvApi(token, docId);
      if (!res.ok) {
        const msg = res.data?.message || 'Không thể tải CV ứng viên.';
        if (typeof showToast === 'function') showToast('danger', 'Lỗi tải CV', msg);
        else alert(msg);
        return;
      }
      const url = URL.createObjectURL(res.blob);
      const safeName = (candName || 'candidate').replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
      const filename = res.fileName || `${safeName}_CV.pdf`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      if (typeof showToast === 'function') showToast('danger', 'Lỗi tải CV', 'Không thể kết nối máy chủ.');
      else alert('Không thể tải CV.');
    }
  }

  async function loadInterviews() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = interviewsSearchInput ? interviewsSearchInput.value.trim() : '';
    const status = interviewsStatusFilter ? interviewsStatusFilter.value : 'ALL';
    const timeframe = interviewsTimeframeFilter ? interviewsTimeframeFilter.value : 'ALL';
    const evaluationStatus = interviewsEvalFilter ? interviewsEvalFilter.value : 'ALL';

    if (interviewsTableBody) {
      interviewsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải lịch phỏng vấn...</td></tr>`;
    }

    try {
      const params = {
        scope: currentScope,
        search,
        status,
        timeframe,
        evaluationStatus
      };
      const res = await window.ATS_API.getInterviewsApi(token, params);
      if (res.ok && res.data && res.data.success) {
        const list = res.data.interviews || res.data.data || [];
        currentInterviewsList = list;
        if (interviewsTotalBadge) {
          interviewsTotalBadge.textContent = `${list.length} phiên`;
        }

        if (list.length === 0) {
          interviewsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không có lịch phỏng vấn nào.</td></tr>`;
          return;
        }

        interviewsTableBody.innerHTML = list.map((iv, index) => {
          const statusBadge = iv.status === 'SCHEDULED' ? 'badge-warning' : (iv.status === 'COMPLETED' ? 'badge-success' : 'badge-danger');
          const statusText = iv.status === 'SCHEDULED' ? 'Sắp diễn ra' : (iv.status === 'COMPLETED' ? 'Đã hoàn thành' : 'Đã hủy');
          const candName = (iv.candidate && iv.candidate.fullName) ? iv.candidate.fullName : (iv.candidate_name || 'Ứng viên');
          const reqTitle = (iv.requisition && iv.requisition.title) ? iv.requisition.title : (iv.requisition_title || 'Vị trí');
          const interviewer = (iv.interviewer && iv.interviewer.fullName) ? iv.interviewer.fullName : (iv.interviewer_name || 'Hội đồng tuyển dụng');
          let interviewerDisplay = interviewer;
          if (Array.isArray(iv.interviewers) && iv.interviewers.length > 1) {
            interviewerDisplay = `${interviewer} (+${iv.interviewers.length - 1})`;
          }
          const schedTime = iv.scheduledTime || iv.scheduled_time || iv.scheduled_at;
          const location = iv.locationOrLink || iv.location || 'Online Google Meet';
          const code = iv.code || (iv.id ? iv.id.toUpperCase() : 'PV');
          const isOnline = (iv.interviewFormat || iv.interview_format) !== 'IN_PERSON';
          const formatBadge = (iv.interviewFormat || iv.interview_format)
            ? `<span class="badge" style="background: ${isOnline ? '#f3e8ff' : '#e0f2fe'}; color: ${isOnline ? '#6b21a8' : '#0369a1'}; margin-right: 4px; font-size: 0.7rem;">${isOnline ? '💻 Online' : '🏢 Trực tiếp'}</span>`
            : '';
          const durationMins = iv.durationMinutes || iv.duration_minutes;
          const durationBadge = durationMins ? `<span style="font-size: 0.75rem; color: var(--color-text-muted);">(${durationMins}p)</span>` : '';

          const cvDocId = iv.cvDocumentId || iv.candidate?.cvDocumentId;
          const cvHtml = cvDocId ? `
            <div style="margin-top: 4px;">
              <button type="button" class="btn btn-outline btn-xs btn-view-cv" data-cv-doc-id="${escapeHtml(cvDocId)}" data-candidate-name="${escapeHtml(candName)}" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 0.725rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                <span>Xem CV</span>
              </button>
            </div>
          ` : `
            <div style="margin-top: 4px; font-size: 0.72rem; color: var(--color-text-muted);">(Chưa có CV)</div>
          `;

          let evalHtml = '';
          if (iv.hasSubmittedEvaluation || iv.evaluationStatus === 'SUBMITTED') {
            evalHtml = `<div style="margin-top: 4px;"><span class="badge badge-success" style="font-size: 0.7rem;">✓ Đã nộp đánh giá</span></div>`;
          } else if (iv.evaluationStatus === 'REOPENED') {
            evalHtml = `<div style="margin-top: 4px;"><span class="badge badge-warning" style="font-size: 0.7rem;">⚠️ Cần đánh giá lại</span></div>`;
          } else if (iv.evaluationStatus === 'DRAFT') {
            evalHtml = `<div style="margin-top: 4px;"><span class="badge badge-warning" style="font-size: 0.7rem;">📝 Đang soạn đánh giá</span></div>`;
          } else {
            evalHtml = `<div style="margin-top: 4px;"><span class="badge" style="background: #fee2e2; color: #b91c1c; font-size: 0.7rem;">⚠️ Chưa nộp đánh giá</span></div>`;
          }

          const rescheduledHtml = iv.isRescheduled || iv.rescheduledAt ? `
            <div style="margin-top: 4px;"><span class="badge" style="background: #fef3c7; color: #b45309; font-size: 0.7rem;">⏳ Đã dời lịch</span></div>
          ` : '';

          const resp = iv.candidateResponseStatus || iv.candidate_response_status;
          let respHtml = '';
          if (resp === 'CONFIRMED') respHtml = '<div style="margin-top: 4px;"><span class="badge" style="background: #dcfce7; color: #15803d; font-size: 0.7rem;">✓ Đã xác nhận</span></div>';
          else if (resp === 'RESCHEDULE_REQUESTED') respHtml = '<div style="margin-top: 4px;"><span class="badge" style="background: #fef3c7; color: #b45309; font-size: 0.7rem;">⏳ Đề nghị đổi lịch</span></div>';

          const cancellationHtml = iv.cancellationReason ? `
            <div style="margin-top: 2px; font-size: 0.7rem; color: #dc2626;">Lý do hủy: ${escapeHtml(iv.cancellationReason)}</div>
          ` : '';

          const evalActionBtn = iv.status !== 'CANCELLED' ? `
            <button type="button" class="btn btn-primary btn-xs btn-open-eval" data-interview-id="${escapeHtml(iv.id)}" style="margin-left: 4px;">
              Đánh giá
            </button>
          ` : '';

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${escapeHtml(code)}</code></td>
              <td>
                <strong>${escapeHtml(candName)}</strong>
                ${cvHtml}
              </td>
              <td>${escapeHtml(reqTitle)}</td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div
                    class="user-avatar-circle interview-interviewer-avatar"
                    data-interview-index="${index}"
                    style="width: 32px; height: 32px; font-size: 0.75rem;"
                  >${escapeHtml(interviewer.charAt(0).toUpperCase())}</div>
                  <span>${escapeHtml(interviewerDisplay)}</span>
                </div>
              </td>
              <td>
                <div style="font-weight: 600;">${new Date(schedTime).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</div>
                <div style="font-size: 0.775rem; color: var(--color-text-muted);">${new Date(schedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}</div>
              </td>
              <td>
                <div>${formatBadge}${durationBadge}</div>
                <div style="font-size: 0.8rem; margin-top: 2px;">${escapeHtml(location)}</div>
              </td>
              <td>
                <span class="badge ${statusBadge}">${statusText}</span>
                ${rescheduledHtml}
                ${cancellationHtml}
                ${respHtml}
                ${evalHtml}
              </td>
              <td style="text-align: center; white-space: nowrap;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewInterviewDetails(${escapeHtml(JSON.stringify(iv.id))})">
                  Chi tiết
                </button>
                ${evalActionBtn}
              </td>
            </tr>
          `;
        }).join('');

        interviewsTableBody
          .querySelectorAll('.interview-interviewer-avatar')
          .forEach(avatarEl => {
            const interviewIndex = Number(avatarEl.dataset.interviewIndex);
            const interview = list[interviewIndex];
            const interviewerUser = interview && interview.interviewer;

            const fallbackText =
              interviewerUser && interviewerUser.fullName
                ? interviewerUser.fullName
                : ((interview && interview.interviewer_name) || 'Hội đồng tuyển dụng');

            renderUserAvatar(
              avatarEl,
              interviewerUser,
              fallbackText
            );
          });
      }
    } catch (e) {
      console.error('Failed to load interviews:', e);
    }
  }

  if (interviewsTableBody) {
    interviewsTableBody.addEventListener('click', (e) => {
      const cvBtn = e.target.closest('.btn-view-cv');
      if (cvBtn) {
        const docId = cvBtn.dataset.cvDocId;
        const candName = cvBtn.dataset.candidateName;
        if (docId) downloadCv(docId, candName);
        return;
      }
      const evalBtn = e.target.closest('.btn-open-eval');
      if (evalBtn) {
        const ivId = evalBtn.dataset.interviewId;
        if (ivId && typeof window.openInterviewEvaluationModal === 'function') {
          window.openInterviewEvaluationModal(ivId);
        }
        return;
      }
    });
  }

  if (tabScopeMine) tabScopeMine.addEventListener('click', () => setScope('mine'));
  if (tabScopeAll) tabScopeAll.addEventListener('click', () => setScope('all'));
  if (interviewsRefreshBtn) interviewsRefreshBtn.addEventListener('click', loadInterviews);
  if (interviewsStatusFilter) interviewsStatusFilter.addEventListener('change', loadInterviews);
  if (interviewsTimeframeFilter) interviewsTimeframeFilter.addEventListener('change', loadInterviews);
  if (interviewsEvalFilter) interviewsEvalFilter.addEventListener('change', loadInterviews);
  if (interviewsSearchInput) {
    interviewsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadInterviews();
    });
  }

  window.loadInterviews = loadInterviews;
