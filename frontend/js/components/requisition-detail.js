  // --- REQUISITION DETAILS & EDIT MODAL ---
  const reqDetailModal = document.getElementById('requisition-detail-modal');
  const closeReqDetailModal = document.getElementById('close-req-detail-modal');
  const cancelReqDetailBtn = document.getElementById('cancel-req-detail-btn');
  const reqDetailForm = document.getElementById('req-detail-form');
  const reqDetailAlert = document.getElementById('req-detail-alert');
  const reqDetailAlertMsg = document.getElementById('req-detail-alert-msg');
  const reqDetailRecruiterSelect = document.getElementById('req-detail-recruiter-select');
  const reqDetailWorkLocationSelect = document.getElementById('req-detail-work-location-select');
  const reqDetailWorkModeSelect = document.getElementById('req-detail-work-mode-select');
  let requisitionDetailLoadRevision = 0;
  let editingLegacyRequisition = null;
  let legacyRequisitionEditAccess = null;
  let pendingLegacyProposal=null;
  const reapproveDetailBtn=document.getElementById('req-detail-reapprove');
  if(reapproveDetailBtn)reapproveDetailBtn.addEventListener('click',()=>{if(!pendingLegacyProposal)return;reqDetailModal.classList.add('hidden');return window.ATS_REQUISITION_APPROVAL_UI.propose(editingLegacyRequisition.id,pendingLegacyProposal,legacyRequisitionEditAccess?.editVersion);});

  function requisitionFailureMessage(result, fallback) {
    const error = result?.data;
    if (error?.code === 'FORBIDDEN_PERMISSION_DENIED' && ['requisition.edit', 'requisition.draft.edit'].includes(error.requiredPermission)) return 'Bạn không có quyền chỉnh sửa yêu cầu tuyển dụng này.';
    return error?.message || fallback;
  }

  async function openRequisitionDetails(id, edit = false) {
    window.ATS_REQUISITION_TRACKING?.leave();
    pendingLegacyProposal=null;reapproveDetailBtn?.classList.add('hidden');
    const revision = ++requisitionDetailLoadRevision;
    const token = sessionStorage.getItem('ats_token');
    const view = typeof currentActiveView === 'string' ? currentActiveView : null;
    const isCurrentDetail = () => revision === requisitionDetailLoadRevision && token === sessionStorage.getItem('ats_token') && (view === null || currentActiveView === view);
    if (!token) {
      showToast('warning', 'Cần đăng nhập', 'Phiên làm việc không còn hợp lệ. Vui lòng đăng nhập lại.');
      return;
    }
    if (!reqDetailModal) {
      showToast('danger', 'Không thể mở chi tiết', 'Không thể tải biểu mẫu yêu cầu tuyển dụng. Vui lòng tải lại trang.');
      return;
    }
    reqDetailModal.classList.add('hidden');
    if (createReqModal) createReqModal.classList.add('hidden');
    let req;
    try {
      const result = await window.ATS_API.getRequisitionByIdApi(token, id, {edit});
      if (!isCurrentDetail()) return;
      if (!result.ok || !result.data?.success || !result.data.data) {
        showToast('danger', 'Không thể đọc yêu cầu', result.data?.message || 'Không thể tải yêu cầu tuyển dụng.');
        return;
      }
      req = result.data.data;
      legacyRequisitionEditAccess=edit?result.data.access:{canEdit:false};
    } catch {
      if (isCurrentDetail()) showToast('danger', 'Không thể đọc yêu cầu', 'Không thể kết nối để tải yêu cầu tuyển dụng. Vui lòng thử lại.');
      return;
    }
    if (req.formVersion === 'S2-10') {
      try {
        await openCreateReqModal(req,legacyRequisitionEditAccess);
      } catch {
        showToast('danger', 'Không thể mở biểu mẫu', 'Không thể tải biểu mẫu yêu cầu tuyển dụng. Vui lòng thử lại.');
      }
      return;
    }

    document.getElementById('req-detail-id').value = req.id;
    document.getElementById('req-detail-code').textContent = req.code;
    document.getElementById('req-detail-title-input').value = req.title;
    document.getElementById('req-detail-dept-input').value = req.departmentName || req.department || '';
    document.getElementById('req-detail-headcount-input').value = req.headcount;
    document.getElementById('req-detail-status-select').value = req.status;
    editingLegacyRequisition = req;
    document.getElementById('req-detail-handover-notes').value=req.handoverNotes||'';

    const statusBadge = document.getElementById('req-detail-status-badge');
    if (statusBadge) {
      statusBadge.className = `badge ${req.status === 'OPEN' ? 'badge-primary' : (req.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral')}`;
      statusBadge.textContent = req.status === 'OPEN' ? 'Đang mở' : (req.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng');
    }

    if (token && reqDetailRecruiterSelect) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          reqDetailRecruiterSelect.innerHTML = `<option value="">-- Chưa chỉ định --</option>` +
            recruiters.map(r => `<option value="${r.id}" ${r.id === req.recruiterId ? 'selected' : ''}>${r.fullName || r.email}</option>`).join('');
        }
      } catch {}
    }

    if (token && reqDetailWorkLocationSelect && reqDetailWorkModeSelect) {
      try {
        const [locationRes, modeRes] = await Promise.all([
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_LOCATION'
          }),
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_MODE'
          })
        ]);

        const locations =
          locationRes.ok && locationRes.data && locationRes.data.success
            ? locationRes.data.items || []
            : [];

        const modes =
          modeRes.ok && modeRes.data && modeRes.data.success
            ? modeRes.data.items || []
            : [];

        reqDetailWorkLocationSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          locations.map(item => {
            const selected =
              item.id === req.workLocationId ? 'selected' : '';

            const disabled =
              item.status !== 'ACTIVE' &&
              item.id !== req.workLocationId
                ? 'disabled'
                : '';

            const suffix =
              item.status === 'ACTIVE'
                ? ''
                : ' (Ngừng áp dụng)';

            return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
          }).join('');

        reqDetailWorkModeSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          modes.map(item => {
            const selected =
              item.id === req.workModeId ? 'selected' : '';

            const disabled =
              item.status !== 'ACTIVE' &&
              item.id !== req.workModeId
                ? 'disabled'
                : '';

            const suffix =
              item.status === 'ACTIVE'
                ? ''
                : ' (Ngừng áp dụng)';

            return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
          }).join('');
      } catch {
        reqDetailWorkLocationSelect.innerHTML =
          '<option value="">-- Không tải được địa điểm --</option>';

        reqDetailWorkModeSelect.innerHTML =
          '<option value="">-- Không tải được hình thức --</option>';
      }
    }
    if (!isCurrentDetail()) return;
    reqDetailForm.querySelectorAll('input,select,textarea').forEach(node=>{node.disabled=!edit;});
    const significant=Boolean(edit&&legacyRequisitionEditAccess?.canChangeSignificant);
    for(const id of ['req-detail-title-input','req-detail-dept-input','req-detail-headcount-input','req-detail-work-location-select','req-detail-work-mode-select'])document.getElementById(id).disabled=!significant;
    if(reqDetailRecruiterSelect)reqDetailRecruiterSelect.disabled=!legacyRequisitionEditAccess?.operationalFields?.includes('recruiterId');
    document.getElementById('req-detail-status-select').disabled=!legacyRequisitionEditAccess?.operationalFields?.includes('status');
    document.getElementById('submit-req-detail-btn').classList.toggle('hidden',!edit);
    if (reqDetailAlert) reqDetailAlert.classList.add('hidden');
    reqDetailModal.classList.remove('hidden');
    window.ATS_REQUISITION_TRACKING?.load('s303-legacy',req.id,()=>isCurrentDetail()&&!reqDetailModal.classList.contains('hidden'));
  }

  if (closeReqDetailModal) closeReqDetailModal.addEventListener('click', () => reqDetailModal.classList.add('hidden'));
  if (cancelReqDetailBtn) cancelReqDetailBtn.addEventListener('click', () => reqDetailModal.classList.add('hidden'));

  if (reqDetailForm) {
    reqDetailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const editorRevision=requisitionDetailLoadRevision;
      const isCurrentEditor=()=>token===sessionStorage.getItem('ats_token')&&editorRevision===requisitionDetailLoadRevision&&!reqDetailModal.classList.contains('hidden');
      const id = document.getElementById('req-detail-id').value;
      const title = document.getElementById('req-detail-title-input').value.trim();
      const departmentName = document.getElementById('req-detail-dept-input').value.trim();
      const headcount = parseInt(document.getElementById('req-detail-headcount-input').value, 10);
      const status = document.getElementById('req-detail-status-select').value;
      const recruiterId = reqDetailRecruiterSelect ? reqDetailRecruiterSelect.value : null;
      const workLocationId = reqDetailWorkLocationSelect
        ? reqDetailWorkLocationSelect.value
        : null;
      const workModeId = reqDetailWorkModeSelect
        ? reqDetailWorkModeSelect.value
        : null;

      try {
        const values = {
          title,
          departmentName,
          headcount,
          status,
          recruiterId,
          workLocationId: workLocationId || null,
          workModeId: workModeId || null,
          handoverNotes:document.getElementById('req-detail-handover-notes').value
        };
        const changes=Object.fromEntries(Object.entries(values).filter(([key,value])=>(value??'')!==(editingLegacyRequisition?.[key]??'')));
        const res = await window.ATS_API.updateRequisitionApi(token, id, {...changes,expectedOperationVersion:legacyRequisitionEditAccess?.operationVersion});
        if(!isCurrentEditor())return;
        if (res.ok && res.data && res.data.success) {
          reqDetailModal.classList.add('hidden');
          showToast('success', 'Cập nhật thành công', `Vị trí "${title}" đã được lưu.`);
          loadRequisitions();
          loadDashboardData();
        } else {
          if (reqDetailAlert && reqDetailAlertMsg) {
            reqDetailAlertMsg.textContent = requisitionFailureMessage(res, 'Không thể cập nhật yêu cầu tuyển dụng. Vui lòng thử lại.');
            reqDetailAlert.classList.remove('hidden');
            if(res.data?.code==='REQUISITION_REAPPROVAL_REQUIRED'&&res.data.approvalEnabled){pendingLegacyProposal=Object.fromEntries(Object.entries(changes).filter(([key])=>legacyRequisitionEditAccess?.significantFields?.includes(key)));reapproveDetailBtn?.classList.remove('hidden');}
          }
        }
      } catch (err) {
        if(!isCurrentEditor())return;
        if (reqDetailAlert && reqDetailAlertMsg) {
          reqDetailAlertMsg.textContent = 'Không thể kết nối để cập nhật yêu cầu tuyển dụng. Vui lòng thử lại.';
          reqDetailAlert.classList.remove('hidden');
        }
      }
    });
  }
