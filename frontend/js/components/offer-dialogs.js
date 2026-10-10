  // --- OFFER MODALS ---
  const openCreateOfferModalBtn = document.getElementById('open-create-offer-modal-btn');
  const createOfferModal = document.getElementById('create-offer-modal');
  const closeCreateOfferModal = document.getElementById('close-create-offer-modal');
  const cancelCreateOfferBtn = document.getElementById('cancel-create-offer-btn');
  const createOfferForm = document.getElementById('create-offer-form');
  const createOfferAlert = document.getElementById('create-offer-alert');
  const createOfferAlertMsg = document.getElementById('create-offer-alert-msg');

  function openCreateOfferForCandidate(preselectedCandidateId = '') {
    if (createOfferModal) createOfferModal.classList.remove('hidden');
    if (createOfferForm) createOfferForm.reset();
    if (createOfferAlert) createOfferAlert.classList.add('hidden');

    const candSelect = document.getElementById('create-offer-cand-select');
    if (candSelect) {
      candSelect.innerHTML = `<option value="">-- Chọn ứng viên --</option>` +
        currentCandidatesList.map(c => `
          <option value="${c.id}" ${c.id === preselectedCandidateId ? 'selected' : ''}>
            ${c.fullName || c.full_name} (${formatCandCode(c)}) - ${c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí'}
          </option>
        `).join('');
    }

    const reqSelect = document.getElementById('create-offer-req-select');
    if (reqSelect) {
      reqSelect.innerHTML = `<option value="">-- Theo vị trí tuyển dụng --</option>` +
        currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
    }

    const approverSelect = document.getElementById('create-offer-approver-select');
    if (approverSelect) {
      approverSelect.innerHTML = `
        <option value="">-- Chọn người phê duyệt --</option>
        <option value="usr-hr-mgr">Trần Thị B - HR Manager</option>
        <option value="usr-admin">Administrator - Quản trị viên</option>
      `;
    }

    const dateInput = document.getElementById('create-offer-start-date');
    if (dateInput) {
      const nextMonth = new Date();
      nextMonth.setDate(nextMonth.getDate() + 14);
      dateInput.value = nextMonth.toISOString().split('T')[0];
    }
  }

  if (openCreateOfferModalBtn) {
    openCreateOfferModalBtn.addEventListener('click', () => {
      openCreateOfferForCandidate();
    });
  }

  function closeCreateOffer() {
    if (createOfferModal) createOfferModal.classList.add('hidden');
  }
  if (closeCreateOfferModal) closeCreateOfferModal.addEventListener('click', closeCreateOffer);
  if (cancelCreateOfferBtn) cancelCreateOfferBtn.addEventListener('click', closeCreateOffer);

  if (createOfferForm) {
    createOfferForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const candidateId = document.getElementById('create-offer-cand-select').value;
      const requisitionId = document.getElementById('create-offer-req-select').value;
      const salaryMonthly = document.getElementById('create-offer-salary').value;
      const startDate = document.getElementById('create-offer-start-date').value;
      const approverId = document.getElementById('create-offer-approver-select').value;

      try {
        const res = await window.ATS_API.createOfferApi(token, {
          candidateId, requisitionId, salaryMonthly, startDate, approverId
        });

        if (res.ok && res.data && res.data.success) {
          closeCreateOffer();
          showToast('success', 'Lập Offer thành công', 'Bản chào mời nhận việc đã được tạo và gửi phê duyệt.');
          loadOffers();
          loadCandidates();
          loadDashboardData();
        } else {
          if (createOfferAlert && createOfferAlertMsg) {
            createOfferAlertMsg.textContent = res.data.message || 'Không thể tạo Offer.';
            createOfferAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createOfferAlert && createOfferAlertMsg) {
          createOfferAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          createOfferAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Offer Details & Approval Modal
  const offerDetailModal = document.getElementById('offer-detail-modal');
  const closeOfferDetailModal = document.getElementById('close-offer-detail-modal');
  const btnActionApproveOffer = document.getElementById('btn-action-approve-offer');
  const btnActionSendOffer = document.getElementById('btn-action-send-offer');
  const btnActionRejectOffer = document.getElementById('btn-action-reject-offer');

  function openOfferDetails(id) {
    const o = currentOffersList.find(x => x.id === id);
    if (!o) {
      showToast('warning', 'Offer', `Đang tải chi tiết offer...`);
      return;
    }

    const candName = (o.candidate && o.candidate.fullName) ? o.candidate.fullName : (o.candidate_name || 'Ứng viên');
    const reqTitle = (o.requisition && o.requisition.title) ? o.requisition.title : (o.requisition_title || 'Vị trí');
    const salaryVal = o.salaryMonthly || o.salary_monthly || o.salary;
    const startDateVal = o.startDate || o.start_date;
    const approverName = (o.approver && o.approver.fullName) ? o.approver.fullName : (o.approver_name || 'HR Manager');

    const codeEl = document.getElementById('off-detail-code');
    const statusBadge = document.getElementById('off-detail-status-badge');
    const candNameEl = document.getElementById('off-detail-cand-name');
    const reqTitleEl = document.getElementById('off-detail-req-title');
    const salaryEl = document.getElementById('off-detail-salary');
    const startDateEl = document.getElementById('off-detail-start-date');
    const approverEl = document.getElementById('off-detail-approver');
    const idInput = document.getElementById('off-detail-id');

    if (codeEl) codeEl.textContent = o.code || (o.id ? o.id.toUpperCase() : 'OFF');
    if (statusBadge) {
      statusBadge.className = `badge ${o.status === 'APPROVED' ? 'badge-success' : (o.status === 'PENDING' ? 'badge-warning' : 'badge-primary')}`;
      statusBadge.textContent = o.status === 'APPROVED' ? 'Đã phê duyệt' : (o.status === 'PENDING' ? 'Chờ duyệt' : o.status);
    }
    if (candNameEl) candNameEl.textContent = candName;
    if (reqTitleEl) reqTitleEl.textContent = reqTitle;
    if (salaryEl) salaryEl.textContent = salaryVal ? Number(salaryVal).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận';
    if (startDateEl) startDateEl.textContent = startDateVal ? new Date(startDateVal).toLocaleDateString('vi-VN') : 'Thỏa thuận';
    if (approverEl) approverEl.textContent = approverName;
    if (idInput) idInput.value = o.id;
    if(o.capabilities){btnActionApproveOffer?.classList.toggle('hidden',!o.capabilities.canApprove);btnActionRejectOffer?.classList.toggle('hidden',!o.capabilities.canApprove);btnActionSendOffer?.classList.toggle('hidden',!o.capabilities.canSend);}

    if (offerDetailModal) offerDetailModal.classList.remove('hidden');
  }

  if (closeOfferDetailModal) {
    closeOfferDetailModal.addEventListener('click', () => {
      if (offerDetailModal) offerDetailModal.classList.add('hidden');
    });
  }

  if (btnActionApproveOffer) {
    btnActionApproveOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateOfferStatusApi(token, id, 'APPROVED');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('success', 'Tuyển dụng thành công!', 'Offer đã được duyệt. Ứng viên chính thức chuyển sang giai đoạn Đã nhận việc (Hired).');
          loadOffers();
          loadCandidates();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi phê duyệt', res.data.message || 'Không thể phê duyệt offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionSendOffer) {
    btnActionSendOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateOfferStatusApi(token, id, 'SENT');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('info', 'Đã gửi Offer', 'Đã cập nhật trạng thái phát hành thư mời cho ứng viên.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi gửi Offer', res.data.message || 'Không thể gửi offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionRejectOffer) {
    btnActionRejectOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateOfferStatusApi(token, id, 'REJECTED');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('warning', 'Từ chối Offer', 'Đã từ chối bản đề xuất offer.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi', res.data.message || 'Không thể từ chối offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }
