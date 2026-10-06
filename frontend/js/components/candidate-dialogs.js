  // ==============================================================================
  // 17. CANDIDATE, INTERVIEW & OFFER MODALS & ACTIONS
  // ==============================================================================

  // --- CANDIDATE MODALS ---
  const openCreateCandidateModalBtn = document.getElementById('open-create-candidate-modal-btn');
  const createCandidateModal = document.getElementById('create-candidate-modal');
  const closeCreateCandidateModal = document.getElementById('close-create-candidate-modal');
  const cancelCreateCandidateBtn = document.getElementById('cancel-create-candidate-btn');
  const createCandidateForm = document.getElementById('create-candidate-form');
  const createCandidateAlert = document.getElementById('create-candidate-alert');
  const createCandidateAlertMsg = document.getElementById('create-candidate-alert-msg');
  const createCandidateSourceSelect = document.getElementById('create-cand-source-select');

  if (openCreateCandidateModalBtn) {
    openCreateCandidateModalBtn.addEventListener('click', async () => {
      if (createCandidateModal) createCandidateModal.classList.remove('hidden');
      if (createCandidateForm) createCandidateForm.reset();
      if (createCandidateAlert) createCandidateAlert.classList.add('hidden');

      const reqSelect = document.getElementById('create-cand-req-select');
      if (reqSelect) {
        reqSelect.innerHTML = `<option value="">-- Chọn vị trí tuyển dụng --</option>` +
          currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
      }

      const token = sessionStorage.getItem('ats_token');

      if (token && createCandidateSourceSelect) {
        try {
          const sourceRes = await window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'CANDIDATE_SOURCE',
            status: 'ACTIVE'
          });

          const sources =
            sourceRes.ok && sourceRes.data && sourceRes.data.success
              ? sourceRes.data.items || []
              : [];

          createCandidateSourceSelect.innerHTML =
            '<option value="">-- Chưa xác định --</option>' +
            sources.map(item =>
              `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
            ).join('');
        } catch {
          createCandidateSourceSelect.innerHTML =
            '<option value="">-- Không tải được nguồn ứng viên --</option>';
        }
      }
    });
  }

  function closeCreateCandidate() {
    if (createCandidateModal) createCandidateModal.classList.add('hidden');
  }
  if (closeCreateCandidateModal) closeCreateCandidateModal.addEventListener('click', closeCreateCandidate);
  if (cancelCreateCandidateBtn) cancelCreateCandidateBtn.addEventListener('click', closeCreateCandidate);

  if (createCandidateForm) {
    createCandidateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const fullName = document.getElementById('create-cand-fullname').value.trim();
      const email = document.getElementById('create-cand-email').value.trim();
      const phoneNumber = document.getElementById('create-cand-phone').value.trim();
      const requisitionId = document.getElementById('create-cand-req-select').value;
      const stage = document.getElementById('create-cand-stage-select').value;
      const rating = parseInt(document.getElementById('create-cand-rating').value, 10);
      const experienceYears = parseInt(document.getElementById('create-cand-exp').value, 10) || 0;
      const expectedSalary = document.getElementById('create-cand-salary').value.trim();
      const notes = document.getElementById('create-cand-notes').value.trim();
      const sourceId = createCandidateSourceSelect ? createCandidateSourceSelect.value : null;

      try {
        const res = await window.ATS_API.createCandidateApi(token, {
          fullName, email, phoneNumber, requisitionId, stage, rating, experienceYears, expectedSalary, notes, sourceId: sourceId || null
        });

        if (res.ok && res.data && res.data.success) {
          closeCreateCandidate();
          showToast('success', 'Thêm ứng viên thành công', `Hồ sơ ứng viên ${fullName} đã được lưu vào hệ thống.`);
          loadCandidates();
          loadDashboardData();
        } else {
          if (createCandidateAlert && createCandidateAlertMsg) {
            createCandidateAlertMsg.textContent = res.data.message || 'Không thể tạo hồ sơ ứng viên.';
            createCandidateAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createCandidateAlert && createCandidateAlertMsg) {
          createCandidateAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          createCandidateAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Candidate Details Modal
  const candidateDetailModal = document.getElementById('candidate-detail-modal');
  const closeCandidateDetailModal = document.getElementById('close-candidate-detail-modal');
  const candDetailSaveStageBtn = document.getElementById('cand-detail-save-stage-btn');
  const candDetailScheduleBtn = document.getElementById('cand-detail-schedule-btn');
  const candDetailOfferBtn = document.getElementById('cand-detail-offer-btn');
  const candDetailSource = document.getElementById('cand-detail-source');
  const candDetailRejectionReasonGroup = document.getElementById('cand-detail-rejection-reason-group');
  const candDetailRejectionReasonSelect = document.getElementById('cand-detail-rejection-reason-select');
  let canEditCandidateRejectionReason = false;

  async function openCandidateDetails(id) {
    let c = currentCandidatesList.find(x => x.id === id);
    if (!c) {
      showToast('warning', 'Hồ sơ', `Đang tải chi tiết hồ sơ ứng viên...`);
      return;
    }

    const name = c.fullName || c.full_name || 'Ứng viên';
    const avatar = document.getElementById('cand-detail-avatar');
    const nameEl = document.getElementById('cand-detail-name');
    const codeEl = document.getElementById('cand-detail-code');
    const reqTitleEl = document.getElementById('cand-detail-req-title');
    const emailEl = document.getElementById('cand-detail-email');
    const phoneEl = document.getElementById('cand-detail-phone');
    const stageBadge = document.getElementById('cand-detail-stage-badge');
    const idInput = document.getElementById('cand-detail-id');
    const stageSelect = document.getElementById('cand-detail-change-stage-select');
    const ratingEl = document.getElementById('cand-detail-rating');

    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = name;
    if (codeEl) codeEl.textContent = formatCandCode(c);
    if (reqTitleEl) reqTitleEl.textContent = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
    if (emailEl) emailEl.textContent = c.email || '—';
    if (phoneEl) phoneEl.textContent = c.phoneNumber || c.phone || 'Chưa cập nhật';
    if (candDetailSource) {
      candDetailSource.textContent =
        c.sourceName || c.source_name || 'Chưa xác định';
    }
    if (stageBadge) {
      stageBadge.className = `badge ${STAGE_BADGES[c.stage] || 'badge-neutral'}`;
      stageBadge.textContent = STAGE_LABELS[c.stage] || c.stage;
    }
    if (idInput) idInput.value = c.id;
    if (stageSelect) stageSelect.value = c.stage;
    if (ratingEl) ratingEl.textContent = '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));

    canEditCandidateRejectionReason = false;
    if (candDetailRejectionReasonSelect) candDetailRejectionReasonSelect.disabled = true;
    if (candDetailRejectionReasonGroup) {
      candDetailRejectionReasonGroup.classList.toggle(
        'hidden',
        true
      );
    }

    if (candDetailRejectionReasonSelect) {
      const token = sessionStorage.getItem('ats_token');

      candDetailRejectionReasonSelect.innerHTML =
        '<option value="">-- Chưa xác định --</option>';

      if (token) {
        try {
          const [permissionsRes, reasonRes] = await Promise.all([
            window.ATS_API.getPermissionsApi(token),
            window.ATS_API.getRecruitmentCatalogsApi(token, { type: 'REJECTION_REASON' })
          ]);
          canEditCandidateRejectionReason = permissionsRes.ok && Array.isArray(permissionsRes.data?.permissions) && permissionsRes.data.permissions.includes('candidate.update');
          candDetailRejectionReasonSelect.disabled = !canEditCandidateRejectionReason;
          if (candDetailRejectionReasonGroup) candDetailRejectionReasonGroup.classList.toggle('hidden', !canEditCandidateRejectionReason || c.stage !== 'REJECTED');

          const reasons =
            reasonRes.ok &&
            reasonRes.data &&
            reasonRes.data.success
              ? reasonRes.data.items || []
              : [];

          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Chưa xác định --</option>' +
            reasons.map(item => {
              const selected =
                item.id === c.rejectionReasonId
                  ? 'selected'
                  : '';

              const disabled =
                item.status !== 'ACTIVE' &&
                item.id !== c.rejectionReasonId
                  ? 'disabled'
                  : '';

              const suffix =
                item.status === 'ACTIVE'
                  ? ''
                  : ' (Ngừng áp dụng)';

              return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
            }).join('');
        } catch {
          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Không tải được lý do loại --</option>';
        }
      }
    }
    if (candidateDetailModal) candidateDetailModal.classList.remove('hidden');
  }

  const candDetailStageSelect =
    document.getElementById('cand-detail-change-stage-select');

  if (candDetailStageSelect) {
    candDetailStageSelect.addEventListener('change', () => {
      if (candDetailRejectionReasonGroup) {
        candDetailRejectionReasonGroup.classList.toggle(
          'hidden',
          !canEditCandidateRejectionReason || candDetailStageSelect.value !== 'REJECTED'
        );
      }

      if (
        candDetailStageSelect.value !== 'REJECTED' &&
        candDetailRejectionReasonSelect
      ) {
        candDetailRejectionReasonSelect.value = '';
      }
    });
  }
  if (closeCandidateDetailModal) {
    closeCandidateDetailModal.addEventListener('click', () => {
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
    });
  }

  if (candDetailSaveStageBtn) {
    candDetailSaveStageBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id').value;
      const stage = document.getElementById('cand-detail-change-stage-select').value;
      const rejectionReasonId =
        canEditCandidateRejectionReason && stage === 'REJECTED' && candDetailRejectionReasonSelect
          ? candDetailRejectionReasonSelect.value || null
          : null;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateCandidateStageApi(
          token,
          id,
          stage,
          undefined,
          rejectionReasonId || undefined
        );
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Chuyển vòng thành công', `Đã cập nhật trạng thái ứng viên sang "${STAGE_LABELS[stage] || stage}".`);
          if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
          loadCandidates();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi cập nhật', res.data.message || 'Không thể chuyển vòng.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (candDetailScheduleBtn) {
    candDetailScheduleBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id').value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      openScheduleInterviewForCandidate(id);
    });
  }

  if (candDetailOfferBtn) {
    candDetailOfferBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id').value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      openCreateOfferForCandidate(id);
    });
  }
