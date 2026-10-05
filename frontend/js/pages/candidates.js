  // ==============================================================================
  // 8. CANDIDATES MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const candidatesSearchInput = document.getElementById('candidates-search-input');
  const candidatesStageFilter = document.getElementById('candidates-stage-filter');
  const candidatesReqFilter = document.getElementById('candidates-req-filter');
  const candidatesExportBtn = document.getElementById('candidates-export-btn');
  const candidatesRefreshBtn = document.getElementById('candidates-refresh-btn');
  const candidatesTableBody = document.getElementById('candidates-table-body');
  const candidatesTotalBadge = document.getElementById('candidates-total-badge');

  function formatCandCode(c) {
    if (!c) return 'CAND-001';
    if (c.code) return c.code;
    if (c.id) {
      if (c.id.startsWith('cand-0')) return 'CAND-' + c.id.replace('cand-', '');
      const raw = c.id.replace(/^cand-/, '');
      return 'CAND-' + (raw.length <= 4 ? raw.toUpperCase() : raw.substring(0, 4).toUpperCase());
    }
    return 'CAND-001';
  }

  async function loadCandidates() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    // Populate requisition filter dropdown if empty
    if (candidatesReqFilter && candidatesReqFilter.children.length <= 1 && currentRequisitionsList.length > 0) {
      candidatesReqFilter.innerHTML = `<option value="ALL">Tất cả vị trí ứng tuyển</option>` +
        currentRequisitionsList.map(r => `<option value="${r.title}">${r.code} - ${r.title}</option>`).join('');
    }

    const search = candidatesSearchInput ? candidatesSearchInput.value.trim().toLowerCase() : '';
    const stage = candidatesStageFilter ? candidatesStageFilter.value : 'ALL';
    const reqFilter = candidatesReqFilter ? candidatesReqFilter.value : 'ALL';

    if (candidatesTableBody) {
      candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách ứng viên...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getCandidatesApi(token, { search, stage });
      if (res.ok && res.data && res.data.success) {
        let list = res.data.candidates || res.data.data || [];

        // Apply requisition filter if selected
        if (reqFilter && reqFilter !== 'ALL') {
          list = list.filter(c => {
            const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || '');
            return reqTitle.toLowerCase().includes(reqFilter.toLowerCase());
          });
        }

        currentCandidatesList = list;
        if (candidatesTotalBadge) {
          candidatesTotalBadge.textContent = `${list.length} ứng viên`;
        }

        if (list.length === 0) {
          candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy hồ sơ ứng viên phù hợp.</td></tr>`;
          return;
        }

        candidatesTableBody.innerHTML = list.map(c => {
          const badgeClass = STAGE_BADGES[c.stage] || 'badge-neutral';
          const stageName = STAGE_LABELS[c.stage] || c.stage;
          const stars = '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));
          const name = c.fullName || c.full_name || 'Ứng viên';
          const phone = c.phoneNumber || c.phone || '';
          const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
          const code = formatCandCode(c);
          const appliedDate = c.createdAt || c.created_at || c.applied_at;

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${name}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); font-family: monospace;">Mã: ${code}</div>
              </td>
              <td>${reqTitle}</td>
              <td>
                <div style="font-size: 0.8rem; color: var(--color-text);">${c.email}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">${phone}</div>
              </td>
              <td><span class="badge ${badgeClass}">${stageName}</span></td>
              <td>${appliedDate ? new Date(appliedDate).toLocaleDateString('vi-VN') : '—'}</td>
              <td style="color: #f59e0b; font-size: 0.85rem;">${stars}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewCandidateDetails('${c.id}')">
                  Chi tiết
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Failed to load candidates:', e);
    }
  }

  if (candidatesExportBtn) {
    candidatesExportBtn.addEventListener('click', () => {
      if (!currentCandidatesList || currentCandidatesList.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Không có dữ liệu ứng viên để xuất.');
        return;
      }
      const headers = ['Mã UV', 'Họ và tên', 'Vị trí ứng tuyển', 'Email', 'Điện thoại', 'Giai đoạn', 'Ngày nộp', 'Đánh giá'];
      const rows = currentCandidatesList.map(c => [
        formatCandCode(c),
        c.fullName || c.full_name || '',
        (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || ''),
        c.email || '',
        c.phoneNumber || c.phone || '',
        STAGE_LABELS[c.stage] || c.stage,
        (c.createdAt || c.created_at) ? new Date(c.createdAt || c.created_at).toLocaleDateString('vi-VN') : '',
        (c.rating || 4) + ' sao'
      ]);
      exportTableToCsv('danh_sach_ung_vien.csv', headers, rows);
    });
  }

  if (candidatesRefreshBtn) candidatesRefreshBtn.addEventListener('click', loadCandidates);
  if (candidatesStageFilter) candidatesStageFilter.addEventListener('change', loadCandidates);
  if (candidatesReqFilter) candidatesReqFilter.addEventListener('change', loadCandidates);
  if (candidatesSearchInput) {
    candidatesSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadCandidates();
    });
  }
