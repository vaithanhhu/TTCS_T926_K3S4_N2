  const openCreateOfferModalBtn = document.getElementById('open-create-offer-modal-btn');
  const createOfferModal = document.getElementById('create-offer-modal');
  const closeCreateOfferModal = document.getElementById('close-create-offer-modal');
  const cancelCreateOfferBtn = document.getElementById('cancel-create-offer-btn');
  const createOfferForm = document.getElementById('create-offer-form');
  const createOfferAlert = document.getElementById('create-offer-alert');
  const createOfferAlertMsg = document.getElementById('create-offer-alert-msg');
  const createOfferIdInput = document.getElementById('create-offer-id');

  let isRevisionMode = false;
  let revisionPredecessorId = null;

  const createOfferCandSelect = document.getElementById('create-offer-cand-select');
  const createOfferReqSelect = document.getElementById('create-offer-req-select');
  const createOfferJobTitleSelect = document.getElementById('create-offer-job-title-select');
  const createOfferSalaryInput = document.getElementById('create-offer-salary');
  const createOfferSalaryBandInfo = document.getElementById('create-offer-salary-band-info');
  const createOfferAllowancesInput = document.getElementById('create-offer-allowances');
  const createOfferStartDateInput = document.getElementById('create-offer-start-date');
  const createOfferExpirationDateInput = document.getElementById('create-offer-expiration-date');
  const createOfferApproverSelect = document.getElementById('create-offer-approver-select');
  const createOfferJustificationGroup = document.getElementById('create-offer-justification-group');
  const createOfferJustificationInput = document.getElementById('create-offer-justification');
  const createOfferNotesInput = document.getElementById('create-offer-notes');

  const saveDraftOfferBtn = document.getElementById('save-draft-offer-btn');
  const previewOfferBtn = document.getElementById('preview-offer-btn');
  const submitCreateOfferBtn = document.getElementById('submit-create-offer-btn');

  const offerPreviewModal = document.getElementById('offer-preview-modal');
  const closeOfferPreviewModal = document.getElementById('close-offer-preview-modal');
  const btnCloseOfferPreview = document.getElementById('btn-close-offer-preview');
  const offerPreviewContent = document.getElementById('offer-preview-content');
  const btnCopyOfferLetter = document.getElementById('btn-copy-offer-letter');

  let cachedJobTitlesList = [];

  async function loadJobTitlesForOffer() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;
    try {
      const res = await fetch('/api/v1/job-titles', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        cachedJobTitlesList = data.jobTitles || data.data || [];
        if (createOfferJobTitleSelect) {
          const currentVal = createOfferJobTitleSelect.value;
          createOfferJobTitleSelect.innerHTML = `<option value="">-- Theo chức danh chuẩn --</option>` +
            cachedJobTitlesList.map(jt => `<option value="${escapeHtml(jt.id)}">${escapeHtml(jt.name)}</option>`).join('');
          if (currentVal) createOfferJobTitleSelect.value = currentVal;
        }
      }
    } catch {}
  }

  function checkSalaryBand() {
    if (!createOfferSalaryInput || !createOfferJobTitleSelect) return;
    const salaryVal = parseInt(createOfferSalaryInput.value, 10);
    const jtId = createOfferJobTitleSelect.value;
    const jt = cachedJobTitlesList.find(x => x.id === jtId);

    if (!jt || (!jt.minSalary && !jt.min_salary && !jt.maxSalary && !jt.max_salary)) {
      if (createOfferSalaryBandInfo) createOfferSalaryBandInfo.textContent = '';
      if (createOfferJustificationGroup) createOfferJustificationGroup.classList.add('hidden');
      if (createOfferJustificationInput) createOfferJustificationInput.required = false;
      return;
    }

    const minSal = Number(jt.minSalary ?? jt.min_salary ?? 0);
    const maxSal = Number(jt.maxSalary ?? jt.max_salary ?? 0);
    const hasMin = minSal > 0;
    const hasMax = maxSal > 0;

    let bandText = `Dải lương chuẩn: `;
    if (hasMin && hasMax) {
      bandText += `${minSal.toLocaleString('vi-VN')} đ - ${maxSal.toLocaleString('vi-VN')} đ`;
    } else if (hasMin) {
      bandText += `từ ${minSal.toLocaleString('vi-VN')} đ`;
    } else if (hasMax) {
      bandText += `tối đa ${maxSal.toLocaleString('vi-VN')} đ`;
    }

    let isOut = false;
    if (salaryVal && !isNaN(salaryVal)) {
      if (hasMin && salaryVal < minSal) isOut = true;
      if (hasMax && salaryVal > maxSal) isOut = true;
    }

    if (createOfferSalaryBandInfo) {
      createOfferSalaryBandInfo.textContent = bandText + (isOut ? ' (VƯỢT DẢI CHUẨN)' : '');
      createOfferSalaryBandInfo.style.color = isOut ? 'var(--color-danger)' : 'var(--color-text-muted)';
    }

    if (isOut) {
      if (createOfferJustificationGroup) createOfferJustificationGroup.classList.remove('hidden');
      if (createOfferJustificationInput) createOfferJustificationInput.required = true;
    } else {
      if (createOfferJustificationGroup) createOfferJustificationGroup.classList.add('hidden');
      if (createOfferJustificationInput) createOfferJustificationInput.required = false;
    }
  }

  if (createOfferSalaryInput) createOfferSalaryInput.addEventListener('input', checkSalaryBand);
  if (createOfferJobTitleSelect) createOfferJobTitleSelect.addEventListener('change', checkSalaryBand);

  function openCreateOfferForCandidate(preselectedCandidateId = '', existingOffer = null, isRevision = false) {
    isRevisionMode = Boolean(isRevision);
    revisionPredecessorId = isRevision ? (existingOffer?.id || null) : null;
    if (createOfferModal) createOfferModal.classList.remove('hidden');
    if (createOfferForm) createOfferForm.reset();
    if (createOfferAlert) createOfferAlert.classList.add('hidden');
    if (createOfferJustificationGroup) createOfferJustificationGroup.classList.add('hidden');
    if (createOfferJustificationInput) createOfferJustificationInput.required = false;

    loadJobTitlesForOffer();

    const titleEl = document.getElementById('create-off-title');
    if (titleEl) {
      if (isRevision) {
        titleEl.textContent = 'Lập Thư Mời Sửa Đổi (Thương Lượng)';
      } else if (existingOffer) {
        titleEl.textContent = 'Chỉnh Sửa Đề Xuất Offer';
      } else {
        titleEl.textContent = 'Lập Thư Mời Nhận Việc (Offer)';
      }
    }

    if (createOfferIdInput) {
      createOfferIdInput.value = isRevision ? '' : (existingOffer?.id || '');
    }

    if (createOfferCandSelect) {
      createOfferCandSelect.innerHTML = `<option value="">-- Chọn ứng viên --</option>` +
        currentCandidatesList.map(c => `
          <option value="${escapeHtml(c.id)}" ${c.id === (existingOffer?.candidateId || existingOffer?.candidate_id || preselectedCandidateId) ? 'selected' : ''}>
            ${escapeHtml(c.fullName || c.full_name)} (${escapeHtml(formatCandCode(c))}) - ${escapeHtml(c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí')}
          </option>
        `).join('');
    }

    if (createOfferReqSelect) {
      createOfferReqSelect.innerHTML = `<option value="">-- Theo vị trí tuyển dụng --</option>` +
        currentRequisitionsList.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === (existingOffer?.requisitionId || existingOffer?.requisition_id) ? 'selected' : ''}>${escapeHtml(r.code)} - ${escapeHtml(r.title)}</option>`).join('');
    }

    if (createOfferApproverSelect) {
      createOfferApproverSelect.innerHTML = `
        <option value="">-- Chọn người phê duyệt --</option>
        <option value="usr-hr-mgr">Trần Thị B - HR Manager</option>
        <option value="usr-admin">Administrator - Quản trị viên</option>
      `;
      if (existingOffer?.approverId || existingOffer?.approver_id) {
        createOfferApproverSelect.value = existingOffer.approverId || existingOffer.approver_id;
      }
    }

    if (existingOffer) {
      if (createOfferSalaryInput) createOfferSalaryInput.value = existingOffer.salaryMonthly || existingOffer.salary_monthly || '';
      if (createOfferAllowancesInput) createOfferAllowancesInput.value = existingOffer.allowances || '';
      if (createOfferStartDateInput) createOfferStartDateInput.value = (existingOffer.startDate || existingOffer.start_date || '').split('T')[0];
      if (createOfferExpirationDateInput) createOfferExpirationDateInput.value = (existingOffer.expirationDate || existingOffer.expiration_date || '').split('T')[0];
      if (createOfferJustificationInput) createOfferJustificationInput.value = existingOffer.salaryJustification || existingOffer.salary_justification || '';
      if (createOfferNotesInput) createOfferNotesInput.value = existingOffer.notes || '';
      if (createOfferJobTitleSelect && (existingOffer.jobTitleId || existingOffer.job_title_id)) {
        createOfferJobTitleSelect.value = existingOffer.jobTitleId || existingOffer.job_title_id;
      }
      setTimeout(checkSalaryBand, 200);
    } else {
      if (createOfferStartDateInput) {
        const nextMonth = new Date();
        nextMonth.setDate(nextMonth.getDate() + 14);
        createOfferStartDateInput.value = nextMonth.toISOString().split('T')[0];
      }
      if (createOfferExpirationDateInput) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7);
        createOfferExpirationDateInput.value = deadline.toISOString().split('T')[0];
      }
      if (preselectedCandidateId) {
        const cand = currentCandidatesList.find(c => c.id === preselectedCandidateId);
        if (cand && cand.requisition_id && createOfferReqSelect) {
          createOfferReqSelect.value = cand.requisition_id;
          const req = currentRequisitionsList.find(r => r.id === cand.requisition_id);
          if (req && req.job_title_id && createOfferJobTitleSelect) {
            createOfferJobTitleSelect.value = req.job_title_id;
          }
        }
      }
      setTimeout(checkSalaryBand, 200);
    }
  }

  if (createOfferCandSelect) {
    createOfferCandSelect.addEventListener('change', () => {
      const candId = createOfferCandSelect.value;
      const cand = currentCandidatesList.find(c => c.id === candId);
      if (cand && cand.requisition_id && createOfferReqSelect) {
        createOfferReqSelect.value = cand.requisition_id;
        const req = currentRequisitionsList.find(r => r.id === cand.requisition_id);
        if (req && req.job_title_id && createOfferJobTitleSelect) {
          createOfferJobTitleSelect.value = req.job_title_id;
          checkSalaryBand();
        }
      }
    });
  }

  if (createOfferReqSelect) {
    createOfferReqSelect.addEventListener('change', () => {
      const reqId = createOfferReqSelect.value;
      const req = currentRequisitionsList.find(r => r.id === reqId);
      if (req && req.job_title_id && createOfferJobTitleSelect) {
        createOfferJobTitleSelect.value = req.job_title_id;
        checkSalaryBand();
      }
    });
  }

  if (openCreateOfferModalBtn) {
    openCreateOfferModalBtn.addEventListener('click', () => {
      openCreateOfferForCandidate();
    });
  }

  function closeCreateOffer() {
    isRevisionMode = false;
    revisionPredecessorId = null;
    if (createOfferModal) createOfferModal.classList.add('hidden');
  }
  if (closeCreateOfferModal) closeCreateOfferModal.addEventListener('click', closeCreateOffer);
  if (cancelCreateOfferBtn) cancelCreateOfferBtn.addEventListener('click', closeCreateOffer);

  function getOfferFormData(isDraftMode = false) {
    const offerId = createOfferIdInput ? createOfferIdInput.value.trim() : '';
    const candidateId = createOfferCandSelect ? createOfferCandSelect.value : '';
    const requisitionId = createOfferReqSelect ? createOfferReqSelect.value : '';
    const jobTitleId = createOfferJobTitleSelect ? createOfferJobTitleSelect.value : '';
    const salaryMonthly = createOfferSalaryInput ? createOfferSalaryInput.value : '';
    const allowances = createOfferAllowancesInput ? createOfferAllowancesInput.value : 0;
    const startDate = createOfferStartDateInput ? createOfferStartDateInput.value : '';
    const expirationDate = createOfferExpirationDateInput ? createOfferExpirationDateInput.value : '';
    const approverId = createOfferApproverSelect ? createOfferApproverSelect.value : '';
    const salaryJustification = createOfferJustificationInput ? createOfferJustificationInput.value : '';
    const notes = createOfferNotesInput ? createOfferNotesInput.value : '';

    return {
      offerId,
      candidateId,
      requisitionId,
      jobTitleId,
      salaryMonthly,
      allowances,
      startDate,
      expirationDate,
      approverId,
      salaryJustification,
      notes,
      status: isDraftMode ? 'DRAFT' : 'PENDING_APPROVAL',
      isDraft: isDraftMode,
      submitForApproval: !isDraftMode
    };
  }

  async function handleSaveOffer(isDraftMode = false) {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const payload = getOfferFormData(isDraftMode);

    if (!payload.candidateId) {
      if (createOfferAlert && createOfferAlertMsg) {
        createOfferAlertMsg.textContent = 'Vui lòng chọn ứng viên tiếp nhận.';
        createOfferAlert.classList.remove('hidden');
      }
      return;
    }
    if (!payload.salaryMonthly) {
      if (createOfferAlert && createOfferAlertMsg) {
        createOfferAlertMsg.textContent = 'Vui lòng nhập mức lương cơ bản.';
        createOfferAlert.classList.remove('hidden');
      }
      return;
    }

    try {
      let res;
      if (isRevisionMode && revisionPredecessorId) {
        res = await window.ATS_API.reviseOfferApi(token, revisionPredecessorId, payload);
      } else if (payload.offerId) {
        res = await window.ATS_API.updateOfferApi(token, payload.offerId, payload);
      } else {
        res = await window.ATS_API.createOfferApi(token, payload);
      }

      if (res.ok && res.data && res.data.success) {
        closeCreateOffer();
        const msg = isRevisionMode
          ? 'Bản đề xuất offer sửa đổi đã được tạo. Offer trước đã chuyển sang trạng thái Đã thay thế (SUPERSEDED).'
          : isDraftMode
          ? 'Bản đề xuất offer đã được lưu vào danh sách nháp.'
          : 'Bản đề xuất offer đã được gửi tới cấp quản lý phê duyệt.';
        showToast('success', isRevisionMode ? 'Tạo Offer sửa đổi thành công' : isDraftMode ? 'Đã lưu nháp Offer' : 'Lập Offer thành công', msg);
        if (typeof loadOffers === 'function') loadOffers();
        if (typeof loadCandidates === 'function') loadCandidates();
        if (typeof loadDashboardData === 'function') loadDashboardData();
      } else {
        if (createOfferAlert && createOfferAlertMsg) {
          createOfferAlertMsg.textContent = res.data.message || 'Không thể lưu Offer.';
          createOfferAlert.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (createOfferAlert && createOfferAlertMsg) {
        createOfferAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
        createOfferAlert.classList.remove('hidden');
      }
    }
  }

  if (createOfferForm) {
    createOfferForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSaveOffer(false);
    });
  }

  if (saveDraftOfferBtn) {
    saveDraftOfferBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleSaveOffer(true);
    });
  }

  if (previewOfferBtn) {
    previewOfferBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const payload = getOfferFormData(false);
      try {
        const res = await window.ATS_API.previewOfferApi(token, payload);
        if (res.ok && res.data && res.data.success) {
          if (offerPreviewContent) {
            offerPreviewContent.innerHTML = res.data.data?.html || `<pre>${escapeHtml(res.data.data?.text || '')}</pre>`;
          }
          if (offerPreviewModal) offerPreviewModal.classList.remove('hidden');
        } else {
          showToast('warning', 'Xem trước thư', res.data.message || 'Chưa đủ thông tin để tạo thư mời.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi xem trước', err.message);
      }
    });
  }

  function closeOfferPreview() {
    if (offerPreviewModal) offerPreviewModal.classList.add('hidden');
  }
  if (closeOfferPreviewModal) closeOfferPreviewModal.addEventListener('click', closeOfferPreview);
  if (btnCloseOfferPreview) btnCloseOfferPreview.addEventListener('click', closeOfferPreview);

  if (btnCopyOfferLetter) {
    btnCopyOfferLetter.addEventListener('click', () => {
      if (offerPreviewContent) {
        navigator.clipboard.writeText(offerPreviewContent.innerText || offerPreviewContent.textContent || '')
          .then(() => showToast('info', 'Đã sao chép', 'Nội dung thư mời đã được sao chép vào bộ nhớ tạm.'))
          .catch(() => showToast('warning', 'Sao chép', 'Không thể sao chép tự động.'));
      }
    });
  }

  const offerDetailModal = document.getElementById('offer-detail-modal');
  const closeOfferDetailModal = document.getElementById('close-offer-detail-modal');
  const btnActionApproveOffer = document.getElementById('btn-action-approve-offer');
  const btnActionSendOffer = document.getElementById('btn-action-send-offer');
  const btnActionRejectOffer = document.getElementById('btn-action-reject-offer');
  const btnActionRevisionOffer = document.getElementById('btn-action-revision-offer');
  const btnActionViewLetter = document.getElementById('btn-action-view-letter');
  const btnActionEditDraft = document.getElementById('btn-action-edit-draft');
  const btnActionReviseOffer = document.getElementById('btn-action-revise-offer');
  const btnActionToggleRecordRejection = document.getElementById('btn-action-toggle-record-rejection');
  const offDetailRecordRejectionPanel = document.getElementById('off-detail-record-rejection-panel');
  const offRecordRejectionCategory = document.getElementById('off-record-rejection-category');
  const offRecordRejectionNotes = document.getElementById('off-record-rejection-notes');
  const btnSaveRejectionReason = document.getElementById('btn-save-rejection-reason');
  const offDetailTalentPoolBox = document.getElementById('off-detail-talent-pool-box');
  const offTalentPoolReason = document.getElementById('off-talent-pool-reason');
  const btnActionAddTalentPool = document.getElementById('btn-action-add-talent-pool');
  const offDetailLineageBox = document.getElementById('off-detail-lineage-box');
  const offDetailPredecessorInfo = document.getElementById('off-detail-predecessor-info');
  const offDetailPredecessorCode = document.getElementById('off-detail-predecessor-code');
  const offDetailSupersededInfo = document.getElementById('off-detail-superseded-info');
  const offDetailSupersededCode = document.getElementById('off-detail-superseded-code');
  const offDetailRejectionBox = document.getElementById('off-detail-rejection-box');
  const offDetailRejectionCat = document.getElementById('off-detail-rejection-cat');
  const offDetailRejectionComment = document.getElementById('off-detail-rejection-comment');

  async function openOfferDetails(id) {
    let o = currentOffersList.find(x => x.id === id);
    const token = sessionStorage.getItem('ats_token');
    if (token) {
      try {
        const fullRes = await window.ATS_API.getOfferByIdApi(token, id);
        if (fullRes.ok && fullRes.data && (fullRes.data.data || fullRes.data.offer)) {
          o = fullRes.data.data || fullRes.data.offer;
        }
      } catch {}
    }
    if (!o) {
      showToast('warning', 'Offer', `Đang tải chi tiết offer...`);
      return;
    }

    const candName = (o.candidate && (o.candidate.fullName || o.candidate.full_name)) ? (o.candidate.fullName || o.candidate.full_name) : (o.candidate_name || 'Ứng viên');
    const reqTitle = (o.requisition && o.requisition.title) ? o.requisition.title : (o.requisition_title || (o.jobTitleName || o.job_title_name) || 'Vị trí');
    const salaryVal = o.salaryMonthly || o.salary_monthly || o.salary;
    const allowancesVal = o.allowances;
    const startDateVal = o.startDate || o.start_date;
    const expirationDateVal = o.expirationDate || o.expiration_date;
    const approverName = (o.approver && o.approver.fullName) ? o.approver.fullName : (o.approver_name || 'HR Manager');
    const justification = o.salaryJustification || o.salary_justification;

    const codeEl = document.getElementById('off-detail-code');
    const statusBadge = document.getElementById('off-detail-status-badge');
    const candNameEl = document.getElementById('off-detail-cand-name');
    const reqTitleEl = document.getElementById('off-detail-req-title');
    const salaryEl = document.getElementById('off-detail-salary');
    const allowancesEl = document.getElementById('off-detail-allowances');
    const startDateEl = document.getElementById('off-detail-start-date');
    const expirationDateEl = document.getElementById('off-detail-expiration-date');
    const levelEl = document.getElementById('off-detail-approval-level');
    const approverEl = document.getElementById('off-detail-approver');
    const justificationBox = document.getElementById('off-detail-justification-box');
    const justificationEl = document.getElementById('off-detail-justification');
    const idInput = document.getElementById('off-detail-id');
    const decisionPanel = document.getElementById('off-detail-decision-panel');
    const commentInput = document.getElementById('off-detail-comment');
    const timelineEl = document.getElementById('off-detail-approval-timeline');

    if (codeEl) codeEl.textContent = o.code || (o.id ? o.id.toUpperCase() : 'OFF');
    if (statusBadge) {
      const isApproved = o.status === 'APPROVED';
      const isDraft = o.status === 'DRAFT';
      const isPending = o.status === 'PENDING' || o.status === 'PENDING_APPROVAL';
      const isSent = o.status === 'SENT';
      const isRevision = o.status === 'REVISION_REQUESTED';
      const isSuperseded = o.status === 'SUPERSEDED';
      const isExpired = o.status === 'EXPIRED';
      const isRejected = o.status === 'REJECTED';

      statusBadge.className = `badge ${isApproved ? 'badge-success' : (isDraft ? 'badge-neutral' : (isPending ? 'badge-warning' : (isSent ? 'badge-primary' : (isRevision ? 'badge-warning' : (isSuperseded ? 'badge-neutral' : (isExpired ? 'badge-danger' : 'badge-danger'))))))}`;
      statusBadge.textContent = isApproved ? 'Đã phê duyệt' : (isDraft ? 'Bản nháp' : (isPending ? 'Chờ duyệt' : (isSent ? 'Đã gửi' : (isRevision ? 'Yêu cầu sửa' : (isSuperseded ? 'Đã thay thế' : (isExpired ? 'Hết hạn' : (isRejected ? 'Từ chối' : o.status)))))));
    }
    if (candNameEl) candNameEl.textContent = candName;
    if (reqTitleEl) reqTitleEl.textContent = reqTitle;
    if (salaryEl) salaryEl.textContent = salaryVal ? Number(salaryVal).toLocaleString('vi-VN') + ' đ' : 'Thỏa thuận';
    if (allowancesEl) allowancesEl.textContent = allowancesVal ? Number(allowancesVal).toLocaleString('vi-VN') + ' đ/tháng' : 'Không có';
    if (startDateEl) startDateEl.textContent = startDateVal ? new Date(startDateVal).toLocaleDateString('vi-VN') : 'Thỏa thuận';
    if (expirationDateEl) expirationDateEl.textContent = expirationDateVal ? new Date(expirationDateVal).toLocaleDateString('vi-VN') : 'Không quy định';

    const curLvl = o.currentApprovalLevel || o.current_approval_level || 1;
    const reqLvls = o.requiredApprovalLevels || o.required_approval_levels || (o.isOutOfBand ? 2 : 1);
    if (levelEl) levelEl.textContent = `Cấp ${curLvl} / ${reqLvls}${o.isOutOfBand ? ' (Vượt dải chuẩn)' : ''}`;

    if (approverEl) approverEl.textContent = approverName;
    if (idInput) idInput.value = o.id;

    if (justificationBox && justificationEl) {
      if (justification) {
        justificationEl.textContent = justification;
        justificationBox.classList.remove('hidden');
      } else {
        justificationBox.classList.add('hidden');
      }
    }

    let hasLineage = false;
    if (offDetailLineageBox) {
      if (o.predecessorOffer || o.predecessorOfferId || o.predecessor_offer_id) {
        hasLineage = true;
        if (offDetailPredecessorInfo) offDetailPredecessorInfo.classList.remove('hidden');
        if (offDetailPredecessorCode) offDetailPredecessorCode.textContent = (o.predecessorOffer?.id || o.predecessorOfferId || o.predecessor_offer_id || '').toUpperCase();
      } else {
        if (offDetailPredecessorInfo) offDetailPredecessorInfo.classList.add('hidden');
      }

      if (o.supersededByOffer || o.supersededByOfferId || o.superseded_by_offer_id) {
        hasLineage = true;
        if (offDetailSupersededInfo) offDetailSupersededInfo.classList.remove('hidden');
        if (offDetailSupersededCode) offDetailSupersededCode.textContent = (o.supersededByOffer?.id || o.supersededByOfferId || o.superseded_by_offer_id || '').toUpperCase();
      } else {
        if (offDetailSupersededInfo) offDetailSupersededInfo.classList.add('hidden');
      }

      offDetailLineageBox.classList.toggle('hidden', !hasLineage);
    }

    const catLabels = {
      'SALARY': 'Lương (Chế độ đãi ngộ)',
      'LOCATION': 'Địa điểm làm việc',
      'COMPETITOR': 'Nhận việc nơi khác (Offer cạnh tranh)',
      'PERSONAL': 'Lý do cá nhân / Gia đình',
      'OTHER': 'Lý do khác'
    };
    const rejCat = o.rejectionReasonCategory || o.rejection_reason_category;
    const rejComment = o.candidateComment || o.candidate_comment;
    if (offDetailRejectionBox) {
      if (rejCat || o.candidateResponse === 'REJECTED' || o.status === 'REJECTED') {
        offDetailRejectionBox.classList.remove('hidden');
        if (offDetailRejectionCat) offDetailRejectionCat.textContent = catLabels[rejCat] || rejCat || 'Chưa phân loại';
        if (offDetailRejectionComment) offDetailRejectionComment.textContent = rejComment || '(Không có ghi chú thêm)';
      } else {
        offDetailRejectionBox.classList.add('hidden');
      }
    }

    if (offDetailRecordRejectionPanel) {
      offDetailRecordRejectionPanel.classList.add('hidden');
      if (offRecordRejectionNotes) offRecordRejectionNotes.value = rejComment || '';
      if (offRecordRejectionCategory && rejCat) offRecordRejectionCategory.value = rejCat;
    }

    if (offDetailTalentPoolBox) {
      const rec = o.talentPoolRecommendation;
      if (rec && rec.recommended && o.capabilities?.canRecommendTalentPool) {
        offDetailTalentPoolBox.classList.remove('hidden');
        if (offTalentPoolReason) {
          offTalentPoolReason.value = rec.defaultReason || `Ứng viên từ chối offer (${catLabels[rejCat] || 'Khác'}) - Lưu hồ sơ tiềm năng.`;
        }
      } else {
        offDetailTalentPoolBox.classList.add('hidden');
      }
    }

    if (btnActionReviseOffer) {
      btnActionReviseOffer.classList.toggle('hidden', !o.capabilities?.canRevise);
    }
    if (btnActionToggleRecordRejection) {
      btnActionToggleRecordRejection.classList.toggle('hidden', !o.capabilities?.canRecordRejection);
    }

    if (commentInput) commentInput.value = '';

    if (btnActionEditDraft) {
      btnActionEditDraft.classList.toggle('hidden', !['DRAFT', 'REVISION_REQUESTED'].includes(o.status));
    }

    if (decisionPanel) {
      decisionPanel.classList.toggle('hidden', !o.capabilities?.canApprove);
    }

    if (o.capabilities) {
      btnActionSendOffer?.classList.toggle('hidden', !o.capabilities.canSend);
    }

    if (timelineEl) {
      timelineEl.innerHTML = `<div style="color: var(--color-text-muted); font-size: 0.825rem;">Đang tải lịch sử...</div>`;
      try {
        const appRes = await window.ATS_API.getOfferApprovalsApi(token, o.id);
        const items = (appRes.ok && appRes.data && appRes.data.data) ? appRes.data.data : (o.approvals || []);
        if (items.length === 0) {
          timelineEl.innerHTML = `<div style="color: var(--color-text-muted); font-size: 0.825rem; font-style: italic;">Chưa có lượt phê duyệt nào.</div>`;
        } else {
          timelineEl.innerHTML = items.map(item => {
            const actionMap = {
              APPROVE: { text: 'Đã duyệt', cls: 'badge-success' },
              REJECT: { text: 'Từ chối', cls: 'badge-danger' },
              REQUEST_REVISION: { text: 'Yêu cầu sửa', cls: 'badge-warning' }
            };
            const act = actionMap[item.action] || { text: item.action, cls: 'badge-neutral' };
            const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleString('vi-VN') : '';
            return `
              <div style="background: var(--color-bg-page); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 0.85rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <div>
                    <strong>${escapeHtml(item.approverName || 'Người duyệt')}</strong>
                    <span style="color: var(--color-text-muted); font-size: 0.8rem; margin-left: 4px;">(Cấp ${item.level})</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="badge ${act.cls}">${act.text}</span>
                    <span style="color: var(--color-text-muted); font-size: 0.75rem;">${escapeHtml(timeStr)}</span>
                  </div>
                </div>
                ${item.comment ? `<div style="color: var(--color-text); margin-top: 4px; font-style: italic; background: rgba(0,0,0,0.02); padding: 4px 8px; border-radius: 4px;">"${escapeHtml(item.comment)}"</div>` : ''}
              </div>
            `;
          }).join('');
        }
      } catch {
        timelineEl.innerHTML = `<div style="color: var(--color-text-muted); font-size: 0.825rem; font-style: italic;">Chưa có lịch sử phê duyệt.</div>`;
      }
    }

    if (offerDetailModal) offerDetailModal.classList.remove('hidden');
  }

  if (closeOfferDetailModal) {
    closeOfferDetailModal.addEventListener('click', () => {
      if (offerDetailModal) offerDetailModal.classList.add('hidden');
    });
  }

  if (btnActionEditDraft) {
    btnActionEditDraft.addEventListener('click', () => {
      const id = document.getElementById('off-detail-id').value;
      const o = currentOffersList.find(x => x.id === id);
      if (offerDetailModal) offerDetailModal.classList.add('hidden');
      if (o) openCreateOfferForCandidate(o.candidateId || o.candidate_id, o);
    });
  }

  if (btnActionViewLetter) {
    btnActionViewLetter.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.previewOfferApi(token, { offerId: id });
        if (res.ok && res.data && res.data.success) {
          if (offerPreviewContent) {
            offerPreviewContent.innerHTML = res.data.data?.html || `<pre>${escapeHtml(res.data.data?.text || '')}</pre>`;
          }
          if (offerPreviewModal) offerPreviewModal.classList.remove('hidden');
        }
      } catch (err) {
        showToast('danger', 'Lỗi xem thư', err.message);
      }
    });
  }

  if (btnActionApproveOffer) {
    btnActionApproveOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      const comment = document.getElementById('off-detail-comment')?.value || '';
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.decideOfferApi(token, id, { action: 'APPROVE', comment });
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('success', 'Phê duyệt thành công', res.data.message || 'Đã phê duyệt đề xuất Offer.');
          loadOffers();
          if (typeof loadCandidates === 'function') loadCandidates();
          if (typeof loadDashboardData === 'function') loadDashboardData();
        } else {
          showToast('danger', 'Lỗi phê duyệt', res.data?.message || 'Không thể phê duyệt offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionRevisionOffer) {
    btnActionRevisionOffer.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      const commentInput = document.getElementById('off-detail-comment');
      const comment = commentInput ? commentInput.value.trim() : '';

      if (!comment) {
        showToast('warning', 'Yêu cầu ý kiến', 'Vui lòng nhập ý kiến yêu cầu chỉnh sửa.');
        if (commentInput) commentInput.focus();
        return;
      }
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.decideOfferApi(token, id, { action: 'REQUEST_REVISION', comment });
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('info', 'Yêu cầu chỉnh sửa', res.data.message || 'Đã chuyển Offer về trạng thái yêu cầu chỉnh sửa.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi', res.data?.message || 'Không thể yêu cầu chỉnh sửa.');
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
      const commentInput = document.getElementById('off-detail-comment');
      const comment = commentInput ? commentInput.value.trim() : '';

      if (!comment) {
        showToast('warning', 'Yêu cầu lý do', 'Vui lòng nhập lý do từ chối Offer.');
        if (commentInput) commentInput.focus();
        return;
      }
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.decideOfferApi(token, id, { action: 'REJECT', comment });
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('warning', 'Từ chối Offer', res.data.message || 'Đã từ chối bản đề xuất offer.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi', res.data?.message || 'Không thể từ chối offer.');
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
        const sendFn = window.ATS_API.sendOfferApi || window.ATS_API.updateOfferStatusApi;
        const res = await sendFn(token, id, 'SENT');
        if (res.ok && res.data && res.data.success) {
          if (offerDetailModal) offerDetailModal.classList.add('hidden');
          showToast('success', 'Đã gửi Offer', res.data.message || 'Đã gửi thư mời nhận việc và liên kết phản hồi đến ứng viên.');
          loadOffers();
        } else {
          showToast('danger', 'Lỗi gửi Offer', res.data?.message || 'Không thể gửi offer.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionReviseOffer) {
    btnActionReviseOffer.addEventListener('click', () => {
      const id = document.getElementById('off-detail-id').value;
      const o = currentOffersList.find(x => x.id === id);
      if (offerDetailModal) offerDetailModal.classList.add('hidden');
      if (o) openCreateOfferForCandidate(o.candidateId || o.candidate_id, o, true);
    });
  }

  if (btnActionToggleRecordRejection) {
    btnActionToggleRecordRejection.addEventListener('click', () => {
      if (offDetailRecordRejectionPanel) {
        offDetailRecordRejectionPanel.classList.toggle('hidden');
      }
    });
  }

  if (btnSaveRejectionReason) {
    btnSaveRejectionReason.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      const cat = offRecordRejectionCategory?.value || 'OTHER';
      const notes = offRecordRejectionNotes?.value || '';
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.recordOfferRejectionReasonApi(token, id, {
          rejectionReasonCategory: cat,
          notes
        });
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Đã ghi nhận lý do', 'Đã lưu lý do từ chối offer thành công.');
          if (offDetailRecordRejectionPanel) offDetailRecordRejectionPanel.classList.add('hidden');
          openOfferDetails(id);
          if (typeof loadOffers === 'function') loadOffers();
          if (typeof loadCandidates === 'function') loadCandidates();
        } else {
          showToast('danger', 'Lỗi ghi nhận', res.data?.message || 'Không thể lưu lý do từ chối.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (btnActionAddTalentPool) {
    btnActionAddTalentPool.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('off-detail-id').value;
      const reason = offTalentPoolReason?.value || '';
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.addOfferToTalentPoolApi(token, id, { reason });
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Đã lưu vào Kho tiềm năng', res.data.message || 'Hồ sơ ứng viên đã được lưu vào Kho tiềm năng.');
          if (offDetailTalentPoolBox) offDetailTalentPoolBox.classList.add('hidden');
          if (typeof loadOffers === 'function') loadOffers();
        } else {
          showToast('danger', 'Lỗi lưu kho tiềm năng', res.data?.message || 'Không thể đưa vào kho tiềm năng.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  window.ATS_APP_HELPERS = window.ATS_APP_HELPERS || {};
  window.ATS_APP_HELPERS.openCreateOfferForCandidate = openCreateOfferForCandidate;
  window.ATS_APP_HELPERS.viewOfferDetails = openOfferDetails;
