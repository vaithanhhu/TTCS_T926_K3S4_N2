  // ==============================================================================
  // 9. INTERVIEWS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const interviewsSearchInput = document.getElementById('interviews-search-input');
  const interviewsStatusFilter = document.getElementById('interviews-status-filter');
  const interviewsRefreshBtn = document.getElementById('interviews-refresh-btn');
  const interviewsTableBody = document.getElementById('interviews-table-body');
  const interviewsTotalBadge = document.getElementById('interviews-total-badge');

  async function loadInterviews() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = interviewsSearchInput ? interviewsSearchInput.value.trim() : '';
    const status = interviewsStatusFilter ? interviewsStatusFilter.value : 'ALL';

    if (interviewsTableBody) {
      interviewsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải lịch phỏng vấn...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getInterviewsApi(token, { search, status });
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

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${escapeHtml(code)}</code></td>
              <td><strong>${escapeHtml(candName)}</strong></td>
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
                ${(() => {
                  const resp = iv.candidateResponseStatus || iv.candidate_response_status;
                  if (resp === 'CONFIRMED') return '<div style="margin-top: 4px;"><span class="badge" style="background: #dcfce7; color: #15803d; font-size: 0.7rem;">✓ Đã xác nhận</span></div>';
                  if (resp === 'RESCHEDULE_REQUESTED') return '<div style="margin-top: 4px;"><span class="badge" style="background: #fef3c7; color: #b45309; font-size: 0.7rem;">⏳ Đề nghị đổi lịch</span></div>';
                  return '';
                })()}
              </td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewInterviewDetails(${escapeHtml(JSON.stringify(iv.id))})">
                  Chi tiết
                </button>
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

  if (interviewsRefreshBtn) interviewsRefreshBtn.addEventListener('click', loadInterviews);
  if (interviewsStatusFilter) interviewsStatusFilter.addEventListener('change', loadInterviews);
  if (interviewsSearchInput) {
    interviewsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadInterviews();
    });
  }
