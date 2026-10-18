(function() {
  const modal = document.getElementById('candidate-hiring-decision-modal');
  const closeBtn = document.getElementById('close-hiring-decision-modal');
  const cancelBtn = document.getElementById('cancel-hiring-decision-btn');
  const form = document.getElementById('hiring-decision-form');
  const candIdInput = document.getElementById('hiring-decision-candidate-id');
  const rejectionGroup = document.getElementById('hd-rejection-group');
  const rejectionSelect = document.getElementById('hd-rejection-reason-select');
  const notesInput = document.getElementById('hd-decision-notes-input');
  const notesRequiredMark = document.getElementById('hd-notes-required-mark');
  const submitBtn = document.getElementById('submit-hiring-decision-btn');

  function closeModal() {
    if (modal) modal.classList.add('hidden');
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  document.querySelectorAll('input[name="hd-decision-choice"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isReject = radio.value === 'REJECT';
      if (rejectionGroup) rejectionGroup.classList.toggle('hidden', !isReject);
      updateNotesRequirement();
    });
  });

  if (rejectionSelect) {
    rejectionSelect.addEventListener('change', updateNotesRequirement);
  }

  function updateNotesRequirement() {
    const selectedRadio = document.querySelector('input[name="hd-decision-choice"]:checked');
    const isReject = selectedRadio && selectedRadio.value === 'REJECT';
    if (!isReject) {
      if (notesRequiredMark) notesRequiredMark.classList.add('hidden');
      return;
    }
    const opt = rejectionSelect ? rejectionSelect.options[rejectionSelect.selectedIndex] : null;
    const isOther = opt && (opt.text.toLowerCase().includes('khác') || (opt.dataset && opt.dataset.code === 'REJ-OTHER'));
    if (notesRequiredMark) notesRequiredMark.classList.toggle('hidden', !isOther);
  }

  async function loadRejectionReasons(token) {
    if (!rejectionSelect || rejectionSelect.children.length > 1) return;
    try {
      const res = await window.ATS_API.getRecruitmentCatalogsApi(token, { type: 'REJECTION_REASON', status: 'ACTIVE' });
      const items = res.ok && res.data?.items ? res.data.items : [];
      rejectionSelect.innerHTML = '<option value="">-- Chọn lý do loại --</option>' +
        items.map(it => `<option value="${escapeHtml(it.id)}" data-code="${escapeHtml(it.code || '')}">${escapeHtml(it.name)}</option>`).join('');
    } catch {
      rejectionSelect.innerHTML = '<option value="">-- Không tải được lý do --</option>';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  async function openHiringDecisionModal(candidateId) {
    if (!modal || !candidateId) return;
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    if (candIdInput) candIdInput.value = candidateId;
    modal.classList.remove('hidden');

    const offerRadio = document.querySelector('input[name="hd-decision-choice"][value="OFFER"]');
    if (offerRadio) offerRadio.checked = true;
    if (rejectionGroup) rejectionGroup.classList.add('hidden');
    if (notesInput) notesInput.value = '';
    if (notesRequiredMark) notesRequiredMark.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = false;

    await loadRejectionReasons(token);

    const candName = document.getElementById('hd-cand-name');
    const candAvatar = document.getElementById('hd-cand-avatar');
    const candStageBadge = document.getElementById('hd-cand-stage-badge');
    const candReqTitle = document.getElementById('hd-cand-req-title');
    const candEmail = document.getElementById('hd-cand-email');
    const candPhone = document.getElementById('hd-cand-phone');

    const avgScoreEl = document.getElementById('hd-metric-avg-score');
    const roundsCountEl = document.getElementById('hd-metric-rounds-count');
    const evalsCountEl = document.getElementById('hd-metric-evals-count');
    const recsSummaryEl = document.getElementById('hd-metric-recs-summary');
    const criteriaTbody = document.getElementById('hd-criteria-tbody');
    const roundsListEl = document.getElementById('hd-rounds-list');
    const historyListEl = document.getElementById('hd-decisions-history-list');

    if (criteriaTbody) criteriaTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--color-text-muted); padding: 16px;">Đang tải dữ liệu đánh giá...</td></tr>';
    if (roundsListEl) roundsListEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--color-text-muted);">Đang tải thông tin các vòng...</div>';

    try {
      const res = await window.ATS_API.getCandidateInterviewSummaryApi(token, candidateId);
      if (!res.ok || !res.data?.success) {
        if (criteriaTbody) criteriaTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 16px;">${escapeHtml(res.data?.message || 'Không thể tải tổng hợp đánh giá.')}</td></tr>`;
        return;
      }

      const data = res.data.data;
      const c = data.candidate || {};
      const r = data.requisition || {};

      if (candName) candName.textContent = c.fullName || '—';
      if (candAvatar) {
        const parts = (c.fullName || 'UV').trim().split(/\s+/);
        candAvatar.textContent = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
      }
      if (candStageBadge) {
        candStageBadge.textContent = c.stage || '—';
        candStageBadge.className = `badge ${window.STAGE_BADGES?.[c.stage] || 'badge-primary'}`;
      }
      if (candReqTitle) candReqTitle.textContent = r.title ? `${r.code ? r.code + ' - ' : ''}${r.title}` : 'Chưa gắn vị trí';
      if (candEmail) candEmail.textContent = c.email || '—';
      if (candPhone) candPhone.textContent = c.phoneNumber || '—';

      if (avgScoreEl) avgScoreEl.textContent = data.overallAverageScore !== null ? `${data.overallAverageScore} / 5.0` : '—';
      if (roundsCountEl) roundsCountEl.textContent = String(data.interviewRoundsCount || 0);
      if (evalsCountEl) evalsCountEl.textContent = String(data.submittedEvaluationsCount || 0);

      if (recsSummaryEl) {
        const sm = data.recommendationsSummary || {};
        recsSummaryEl.innerHTML = `
          <span style="color: #10b981;">Nên tuyển: ${sm.RECOMMENDED || 0}</span> |
          <span style="color: #f59e0b;">Cân nhắc: ${sm.CONSIDER || 0}</span> |
          <span style="color: #ef4444;">Loại: ${sm.NOT_RECOMMENDED || 0}</span>
        `;
      }

      if (data.submittedEvaluationsCount === 0) {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.title = 'Chưa có phiếu đánh giá phỏng vấn nào được nộp.';
        }
      }

      if (criteriaTbody) {
        const crList = data.criteriaSummary || [];
        if (crList.length === 0) {
          criteriaTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--color-text-muted); padding: 16px;">Chưa có tiêu chí nào được đánh giá.</td></tr>';
        } else {
          criteriaTbody.innerHTML = crList.map(item => {
            const scoreDetails = (item.evaluatorScores || []).map(es => `
              <span style="display: inline-block; background: var(--color-bg-page); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 6px; font-size: 0.75rem; margin: 2px 4px 2px 0;">
                <strong>${escapeHtml(es.interviewerName || es.roundName || 'PV')}:</strong>
                <span style="color: #f59e0b; font-weight: 600;">${es.score}★</span>
                ${es.comment ? `<span style="color: var(--color-text-secondary); font-style: italic;">(${escapeHtml(es.comment)})</span>` : ''}
              </span>
            `).join('');

            return `
              <tr>
                <td style="font-weight: 500;">${escapeHtml(item.criterionName)}</td>
                <td style="text-align: center;">${item.weight}</td>
                <td style="text-align: center; font-weight: 700; color: #f59e0b;">${item.averageScore !== null ? item.averageScore : '—'}</td>
                <td>${scoreDetails || '<span style="color: var(--color-text-muted);">Chưa có điểm</span>'}</td>
              </tr>
            `;
          }).join('');
        }
      }

      if (roundsListEl) {
        const rounds = data.rounds || [];
        if (rounds.length === 0) {
          roundsListEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--color-text-muted); padding: 8px;">Chưa có buổi phỏng vấn nào.</div>';
        } else {
          roundsListEl.innerHTML = rounds.map((rd, idx) => {
            const evals = rd.evaluations || [];
            const evalsHtml = evals.length > 0 ? evals.map(ev => {
              let recBadge = 'badge-neutral';
              let recText = 'Chưa kết luận';
              if (ev.recommendation === 'RECOMMENDED') { recBadge = 'badge-success'; recText = 'Nên tuyển'; }
              else if (ev.recommendation === 'CONSIDER') { recBadge = 'badge-warning'; recText = 'Cân nhắc'; }
              else if (ev.recommendation === 'NOT_RECOMMENDED') { recBadge = 'badge-danger'; recText = 'Không nên tuyển'; }

              return `
                <div style="background: var(--color-bg-page); border: 1px solid var(--color-border); border-radius: 4px; padding: 10px; margin-top: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div>
                      <strong>${escapeHtml(ev.interviewerName || 'Người phỏng vấn')}</strong>
                      <span style="font-size: 0.75rem; color: var(--color-text-muted); margin-left: 6px;">(${ev.submittedAt ? new Date(ev.submittedAt).toLocaleString('vi-VN') : ''})</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      <span class="badge ${recBadge}">${recText}</span>
                      <span style="font-weight: 700; color: #f59e0b;">${ev.totalScore !== null ? ev.totalScore.toFixed(2) + '★' : '—'}</span>
                    </div>
                  </div>
                  ${ev.generalNotes ? `<div style="font-size: 0.825rem; color: var(--color-text-secondary); margin-top: 4px; font-style: italic;">"${escapeHtml(ev.generalNotes)}"</div>` : ''}
                </div>
              `;
            }).join('') : `<div style="font-size: 0.8rem; color: var(--color-text-muted); padding: 4px 0;">${rd.legacyFeedback ? 'Nhận xét: ' + escapeHtml(rd.legacyFeedback) : 'Chưa có phiếu đánh giá chính thức nộp cho vòng này.'}</div>`;

            return `
              <div style="border: 1px solid var(--color-border); border-radius: 6px; padding: 12px; background: #fff;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 8px;">
                  <div>
                    <strong style="color: var(--color-primary); font-size: 0.9rem;">Vòng ${idx + 1}: ${escapeHtml(rd.roundName || 'Phỏng vấn')}</strong>
                    <span style="font-size: 0.75rem; color: var(--color-text-muted); margin-left: 8px;">(${rd.scheduledTime ? new Date(rd.scheduledTime).toLocaleString('vi-VN') : '—'})</span>
                  </div>
                  <span class="badge badge-outline">${escapeHtml(rd.status || 'SCHEDULED')}</span>
                </div>
                <div style="margin-top: 8px;">
                  ${evalsHtml}
                </div>
              </div>
            `;
          }).join('');
        }
      }

      if (historyListEl) {
        const decisions = data.decisions || [];
        if (decisions.length === 0) {
          historyListEl.innerHTML = '<div style="font-size: 0.8rem; color: var(--color-text-muted);">Chưa có quyết định nào được ghi nhận.</div>';
        } else {
          historyListEl.innerHTML = decisions.map(d => {
            const isOffer = d.decision === 'OFFER';
            const badgeClass = isOffer ? 'badge-success' : 'badge-danger';
            const label = isOffer ? 'Đề xuất Offer' : 'Loại ứng viên';

            return `
              <div style="padding: 8px 12px; background: var(--color-bg-page); border-left: 3px solid ${isOffer ? '#10b981' : '#ef4444'}; border-radius: 3px; font-size: 0.825rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                  <div>
                    <span class="badge ${badgeClass}" style="margin-right: 6px;">${label}</span>
                    <strong>${escapeHtml(d.decidedByName || d.decidedBy || 'Hội đồng')}</strong>
                  </div>
                  <span style="font-size: 0.75rem; color: var(--color-text-muted);">${d.decidedAt ? new Date(d.decidedAt).toLocaleString('vi-VN') : ''}</span>
                </div>
                ${d.rejectionReasonName ? `<div style="color: #ef4444; margin-top: 2px;">Lý do loại: <strong>${escapeHtml(d.rejectionReasonName)}</strong></div>` : ''}
                ${d.notes ? `<div style="color: var(--color-text); margin-top: 2px;">Ghi chú: ${escapeHtml(d.notes)}</div>` : ''}
              </div>
            `;
          }).join('');
        }
      }
    } catch (err) {
      if (criteriaTbody) criteriaTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 16px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      const candidateId = candIdInput ? candIdInput.value : null;
      if (!token || !candidateId) return;

      const selectedRadio = document.querySelector('input[name="hd-decision-choice"]:checked');
      const decision = selectedRadio ? selectedRadio.value : 'OFFER';
      const rejectionReasonId = rejectionSelect ? rejectionSelect.value : null;
      const notes = notesInput ? notesInput.value.trim() : '';

      if (decision === 'REJECT' && !rejectionReasonId) {
        if (window.showToast) window.showToast('danger', 'Thiếu thông tin', 'Vui lòng chọn lý do loại ứng viên.');
        else alert('Vui lòng chọn lý do loại ứng viên.');
        return;
      }

      if (decision === 'REJECT') {
        const opt = rejectionSelect ? rejectionSelect.options[rejectionSelect.selectedIndex] : null;
        const isOther = opt && (opt.text.toLowerCase().includes('khác') || (opt.dataset && opt.dataset.code === 'REJ-OTHER'));
        if (isOther && !notes) {
          if (window.showToast) window.showToast('danger', 'Thiếu thông tin', 'Vui lòng nhập giải thích khi chọn lý do loại là "Khác".');
          else alert('Vui lòng nhập giải thích khi chọn lý do loại là "Khác".');
          return;
        }
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Đang lưu quyết định...';
      }

      try {
        const res = await window.ATS_API.recordCandidateHiringDecisionApi(token, candidateId, {
          decision,
          rejectionReasonId: decision === 'REJECT' ? rejectionReasonId : null,
          notes
        });

        if (res.ok && res.data?.success) {
          if (window.showToast) {
            window.showToast('success', 'Thành công', decision === 'OFFER' ? 'Đã chuyển ứng viên sang giai đoạn Đề xuất Offer.' : 'Đã ghi nhận loại ứng viên.');
          }
          closeModal();
          if (typeof window.loadCandidates === 'function') window.loadCandidates();
          if (typeof window.loadDashboardData === 'function') window.loadDashboardData();
        } else {
          if (window.showToast) {
            window.showToast('danger', 'Thao tác không thành công', res.data?.message || 'Không thể lưu quyết định.');
          } else {
            alert(res.data?.message || 'Không thể lưu quyết định.');
          }
        }
      } catch (err) {
        if (window.showToast) window.showToast('danger', 'Lỗi kết nối', err.message);
        else alert(err.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Lưu Quyết Định Tuyển Dụng';
        }
      }
    });
  }

  window.ATS_APP_HELPERS = window.ATS_APP_HELPERS || {};
  window.ATS_APP_HELPERS.openHiringDecisionModal = openHiringDecisionModal;
})();
