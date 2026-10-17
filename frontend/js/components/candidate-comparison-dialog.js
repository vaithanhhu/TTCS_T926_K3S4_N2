(function () {
  let activeRequisitionId = null;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function openComparisonModal(requisitionId) {
    activeRequisitionId = requisitionId;
    const modal = document.getElementById('candidate-comparison-modal');
    if (!modal) return;

    const roundInput = document.getElementById('comparison-round-filter');
    if (roundInput) roundInput.value = '';

    const sortSelect = document.getElementById('comparison-sort-order');
    if (sortSelect) sortSelect.value = 'DESC';

    modal.classList.remove('hidden');
    await loadComparisonData();
  }

  async function loadComparisonData() {
    if (!activeRequisitionId) return;
    const token = sessionStorage.getItem('ats_token');
    const tableBody = document.getElementById('comparison-table-body');
    const tableHead = document.getElementById('comparison-table-head');
    const subtitleEl = document.getElementById('comparison-modal-subtitle');
    const totalBadge = document.getElementById('comparison-total-badge');

    const roundVal = document.getElementById('comparison-round-filter')?.value?.trim() || '';
    const orderVal = document.getElementById('comparison-sort-order')?.value || 'DESC';

    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--color-text-secondary);">Đang tải dữ liệu so sánh...</td></tr>';
    }

    const params = { order: orderVal };
    if (roundVal) params.roundName = roundVal;

    const res = await window.ATS_API.getCandidateEvaluationsComparisonApi(token, activeRequisitionId, params);
    if (!res.ok || !res.data || !res.data.success) {
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--color-danger);">${escapeHtml(res.data?.message || 'Không thể tải bảng so sánh ứng viên.')}</td></tr>`;
      }
      return;
    }

    const comparisonData = res.data.data;
    const reqInfo = comparisonData.requisition || {};
    const criteriaHeaders = comparisonData.criteriaHeaders || [];
    const candidates = comparisonData.candidates || [];

    if (subtitleEl) {
      subtitleEl.textContent = `${reqInfo.title || 'Vị trí'} (${reqInfo.code || ''}) | Vòng: ${reqInfo.finalRoundName || 'Vòng cuối'}`;
    }

    if (totalBadge) {
      totalBadge.textContent = `${candidates.length} ứng viên`;
    }

    if (tableHead) {
      let headHtml = `
        <tr>
          <th style="width: 50px; text-align: center;">Hạng</th>
          <th style="min-width: 180px;">Ứng viên</th>
          <th style="width: 100px; text-align: center;">Điểm tổng</th>
          <th style="width: 130px; text-align: center;">Kết luận</th>
          <th style="width: 80px; text-align: center;">Số phiếu</th>
      `;
      for (const crit of criteriaHeaders) {
        headHtml += `<th style="text-align: center; min-width: 110px;">${escapeHtml(crit.name)}<br><small style="color:var(--color-text-secondary);font-weight:normal;">(Trọng số ${crit.weight})</small></th>`;
      }
      headHtml += '</tr>';
      tableHead.innerHTML = headHtml;
    }

    if (tableBody) {
      if (candidates.length === 0) {
        const colCount = 5 + criteriaHeaders.length;
        tableBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; padding: 24px; color: var(--color-text-secondary);">Không có ứng viên nào ở vòng cuối có phiếu đánh giá đã nộp.</td></tr>`;
        return;
      }

      tableBody.innerHTML = candidates.map(cand => {
        const scoreClass = cand.totalScore >= 4.0 ? 'badge-success' : (cand.totalScore >= 3.0 ? 'badge-primary' : 'badge-danger');
        const rec = cand.recommendationSummary || {};
        let recPills = [];
        if (rec.RECOMMENDED) recPills.push(`<span class="badge badge-success" title="Nên tuyển">${rec.RECOMMENDED} Nên tuyển</span>`);
        if (rec.CONSIDER) recPills.push(`<span class="badge badge-warning" title="Cân nhắc">${rec.CONSIDER} Cân nhắc</span>`);
        if (rec.NOT_RECOMMENDED) recPills.push(`<span class="badge badge-danger" title="Không nên tuyển">${rec.NOT_RECOMMENDED} Không tuyển</span>`);
        if (recPills.length === 0) recPills.push('<span style="color:var(--color-text-muted);">—</span>');

        let critCols = '';
        for (const crit of criteriaHeaders) {
          const score = cand.criteriaScores[crit.id];
          const scoreDisplay = (score !== null && score !== undefined) ? `<strong>${Number(score).toFixed(2)}</strong>` : '<span style="color:var(--color-text-muted);">—</span>';
          critCols += `<td style="text-align: center;">${scoreDisplay}</td>`;
        }

        return `
          <tr>
            <td style="text-align: center; font-weight: bold;">
              <span class="badge ${cand.rank === 1 ? 'badge-warning' : 'badge-outline'}">#${cand.rank}</span>
            </td>
            <td>
              <div style="font-weight: 600; color: var(--color-text);">${escapeHtml(cand.candidateName)}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-secondary);">${escapeHtml(cand.candidateEmail || '')}</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(cand.candidateStage || '')}</div>
            </td>
            <td style="text-align: center;">
              <span class="badge ${scoreClass}" style="font-size: 0.95rem; font-weight: 700; padding: 4px 8px;">
                ${Number(cand.totalScore).toFixed(2)} / 5
              </span>
            </td>
            <td style="text-align: center;">
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: center;">
                ${recPills.join('')}
              </div>
            </td>
            <td style="text-align: center; font-weight: 600;">
              ${cand.evaluationCount}
            </td>
            ${critCols}
          </tr>
        `;
      }).join('');
    }
  }

  function setupEvents() {
    const modal = document.getElementById('candidate-comparison-modal');
    const closeBtn = document.getElementById('close-comparison-modal');
    const bottomCloseBtn = document.getElementById('comparison-modal-close-btn');
    const applyBtn = document.getElementById('comparison-apply-filter-btn');

    function closeModal() {
      if (modal) modal.classList.add('hidden');
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (bottomCloseBtn) bottomCloseBtn.addEventListener('click', closeModal);
    if (applyBtn) applyBtn.addEventListener('click', loadComparisonData);

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEvents);
  } else {
    setupEvents();
  }

  window.ATS_CANDIDATE_COMPARISON_UI = {
    open: openComparisonModal,
    reload: loadComparisonData
  };
})();
