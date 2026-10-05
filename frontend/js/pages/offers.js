  // 10. OFFERS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const offersSearchInput = document.getElementById('offers-search-input');
  const offersStatusFilter = document.getElementById('offers-status-filter');
  const offersRefreshBtn = document.getElementById('offers-refresh-btn');
  const offersTableBody = document.getElementById('offers-table-body');
  const offersTotalBadge = document.getElementById('offers-total-badge');

  async function loadOffers() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const search = offersSearchInput ? offersSearchInput.value.trim() : '';
    const status = offersStatusFilter ? offersStatusFilter.value : 'ALL';

    if (offersTableBody) {
      offersTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách offer...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getOffersApi(token, { search, status });
      if (res.ok && res.data && res.data.success) {
        const list = res.data.offers || res.data.data || [];
        currentOffersList = list;
        if (offersTotalBadge) {
          offersTotalBadge.textContent = `${list.length} thư mời`;
        }

        if (list.length === 0) {
          offersTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Chưa có thư mời nhận việc nào.</td></tr>`;
          return;
        }

        offersTableBody.innerHTML = list.map(o => {
          const statusBadge = o.status === 'APPROVED' ? 'badge-success' : (o.status === 'PENDING' ? 'badge-warning' : (o.status === 'SENT' ? 'badge-primary' : 'badge-neutral'));
          const statusText = o.status === 'APPROVED' ? 'Đã phê duyệt' : (o.status === 'PENDING' ? 'Chờ duyệt' : (o.status === 'SENT' ? 'Đã gửi' : o.status));
          const candName = (o.candidate && o.candidate.fullName) ? o.candidate.fullName : (o.candidate_name || 'Ứng viên');
          const reqTitle = (o.requisition && o.requisition.title) ? o.requisition.title : (o.requisition_title || 'Vị trí');
          const salaryVal = o.salaryMonthly || o.salary_monthly || o.salary;
          const startDateVal = o.startDate || o.start_date;
          const code = o.code || (o.id ? o.id.toUpperCase() : 'OFF');

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td><strong>${candName}</strong></td>
              <td>${reqTitle}</td>
              <td style="font-weight: 600; color: var(--color-primary);">${salaryVal ? Number(salaryVal).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận'}</td>
              <td>${startDateVal ? new Date(startDateVal).toLocaleDateString('vi-VN') : 'Thỏa thuận'}</td>
              <td><span class="badge ${statusBadge}">${statusText}</span></td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewOfferDetails('${o.id}')">
                  Hồ sơ
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Failed to load offers:', e);
    }
  }

  if (offersRefreshBtn) offersRefreshBtn.addEventListener('click', loadOffers);
  if (offersStatusFilter) offersStatusFilter.addEventListener('change', loadOffers);
  if (offersSearchInput) {
    offersSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadOffers();
    });
  }
