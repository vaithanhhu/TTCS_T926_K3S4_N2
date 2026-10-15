  // ==============================================================================
  // 17.1 APPROVALS CENTER & CANDIDATE PORTAL & REQUISITION EDIT
  // ==============================================================================

  // --- APPROVALS CENTER ---
  async function loadApprovals() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const offersTableBody = document.getElementById('approvals-offers-table-body');
    const reqsTableBody = document.getElementById('approvals-reqs-table-body');
    const totalBadge = document.getElementById('approvals-total-badge');
    const pendingBadge = document.getElementById('pending-offers-badge');
    const sidebarBadge = document.getElementById('sidebar-badge-approvals');

    try {
      const [offersRes, reqsRes] = await Promise.all([
        window.ATS_API.getOffersApi(token),
        window.ATS_API.getRequisitionsApi(token)
      ]);

      const offers = (offersRes.ok && offersRes.data && offersRes.data.offers) ? offersRes.data.offers : [];
      const pendingOffers = offers.filter(o => o.status === 'PENDING_APPROVAL');

      if (totalBadge) totalBadge.textContent = `${pendingOffers.length} yêu cầu chờ duyệt`;
      if (pendingBadge) pendingBadge.textContent = `${pendingOffers.length} offer`;
      if (sidebarBadge) sidebarBadge.textContent = String(pendingOffers.length);

      if (offersTableBody) {
        if (pendingOffers.length === 0) {
          offersTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Hiện không có đề xuất Offer nào đang chờ phê duyệt.</td></tr>`;
        } else {
          offersTableBody.innerHTML = pendingOffers.map(o => {
            const candName = o.candidate ? o.candidate.fullName : 'Ứng viên';
            const reqTitle = o.requisition ? o.requisition.title : 'Vị trí';
            const salary = o.salaryMonthly ? Number(o.salaryMonthly).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận';
            const startDate = o.startDate ? new Date(o.startDate).toLocaleDateString('vi-VN') : '—';
            return `
              <tr>
                <td><code class="font-mono" style="color: var(--color-primary); font-weight: 600;">${o.id.substring(0, 8).toUpperCase()}</code></td>
                <td><strong>${candName}</strong></td>
                <td>${reqTitle}</td>
                <td style="color: var(--color-primary); font-weight: 600;">${salary}</td>
                <td>${startDate}</td>
                <td><span class="badge badge-warning">Chờ phê duyệt</span></td>
                <td style="text-align: center;">
                  <div style="display: flex; gap: 6px; justify-content: center;">
                    <button type="button" class="btn btn-outline btn-xs btn-quick-approve-offer" data-id="${o.id}" style="color: var(--color-success); border-color: var(--color-success);">
                      Phê duyệt (Hired)
                    </button>
                    <button type="button" class="btn btn-outline btn-xs btn-quick-reject-offer" data-id="${o.id}" style="color: var(--color-danger); border-color: var(--color-danger);">
                      Từ chối
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          document.querySelectorAll('.btn-quick-approve-offer').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-id');
              try {
                const res = await window.ATS_API.updateOfferStatusApi(token, id, 'APPROVED');
                if (res.ok && res.data && res.data.success) {
                  showToast('success', 'Đã phê duyệt!', 'Offer đã được duyệt. Ứng viên chính thức được tuyển dụng (Hired).');
                  loadApprovals();
                  loadDashboardData();
                } else {
                  showToast('danger', 'Lỗi phê duyệt', res.data.message || 'Không thể duyệt offer.');
                }
              } catch (e) {
                showToast('danger', 'Lỗi kết nối', e.message);
              }
            });
          });

          document.querySelectorAll('.btn-quick-reject-offer').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-id');
              try {
                const res = await window.ATS_API.updateOfferStatusApi(token, id, 'REJECTED');
                if (res.ok && res.data && res.data.success) {
                  showToast('warning', 'Đã từ chối', 'Đã từ chối đề xuất offer.');
                  loadApprovals();
                } else {
                  showToast('danger', 'Lỗi', res.data.message || 'Không thể từ chối.');
                }
              } catch (e) {
                showToast('danger', 'Lỗi kết nối', e.message);
              }
            });
          });
        }
      }

      if (reqsTableBody) {
        const reqs = (reqsRes.ok && reqsRes.data && reqsRes.data.requisitions) ? reqsRes.data.requisitions : [];
        if (reqs.length === 0) {
          reqsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không có vị trí tuyển dụng nào.</td></tr>`;
        } else {
          reqsTableBody.innerHTML = reqs.slice(0, 5).map(r => `
            <tr>
              <td><code class="font-mono" style="color: var(--color-primary);">${r.code}</code></td>
              <td><strong>${r.title}</strong></td>
              <td>${r.departmentName}</td>
              <td style="text-align: center; font-weight: 600;">${r.headcount}</td>
              <td><span class="badge ${r.status === 'OPEN' ? 'badge-primary' : 'badge-neutral'}">${r.status}</span></td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs btn-view-candidates-req" data-title="${r.title}">
                  Xem ứng viên
                </button>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error('Failed to load approvals:', e);
    }
  }
