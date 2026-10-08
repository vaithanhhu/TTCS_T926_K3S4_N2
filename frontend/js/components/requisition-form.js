  // Modal: Create Requisition
  const openCreateReqModalBtn = document.getElementById('open-create-req-modal-btn');
  const createReqModal = document.getElementById('create-req-modal');
  const closeCreateReqModal = document.getElementById('close-create-req-modal');
  const cancelCreateReqBtn = document.getElementById('cancel-create-req-btn');
  const createReqForm = document.getElementById('create-req-form');
  const createReqAlert = document.getElementById('create-req-alert');
  const createReqAlertMsg = document.getElementById('create-req-alert-msg');
  const createReqRecruiterSelect = document.getElementById('create-req-recruiter-select');
  const createReqDepartmentSelect = document.getElementById('create-req-dept-input');
  const createReqWorkLocationSelect = document.getElementById('create-req-work-location-select');
  const createReqWorkModeSelect = document.getElementById('create-req-work-mode-select');
  const createReqJobTitleSelect = document.getElementById('create-req-job-title-input');
  const saveCreateReqDraftBtn = document.getElementById('save-create-req-draft-btn');
  let requisitionJobTitles = [];
  let editingS210Requisition = null;
  let requisitionEditAccess = null;
  let pendingOpenProposal=null;
  const reapproveCreateReqBtn=document.getElementById('create-req-reapprove');
  if(reapproveCreateReqBtn)reapproveCreateReqBtn.addEventListener('click',()=>{if(!pendingOpenProposal)return;createReqModal.classList.add('hidden');return window.ATS_REQUISITION_APPROVAL_UI.propose(editingS210Requisition.id,pendingOpenProposal,requisitionEditAccess?.editVersion);});
  let requisitionSalaryCheck = { key: null, status: null, message: '' };
  let requisitionSalaryCheckRevision = 0;
  let requisitionOptionsRevision = 0;

  function requisitionSalaryCheckKey() {
    return JSON.stringify([createReqJobTitleSelect?.value || '',
      document.getElementById('create-req-salary-min-input').value,
      document.getElementById('create-req-salary-max-input').value]);
  }

  function requisitionBusinessDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function clearRequisitionSalaryState() {
    requisitionJobTitles = [];
    editingS210Requisition = null;
    requisitionSalaryCheck = { key: null, status: null, message: '' };
    requisitionSalaryCheckRevision++;
    requisitionOptionsRevision++;
    for (const id of ['create-req-salary-min-input', 'create-req-salary-max-input', 'create-req-justification-input']) {
      const node = document.getElementById(id); if (node) node.value = '';
    }
    for (const id of ['create-req-standard-salary', 'create-req-salary-warning']) {
      const node = document.getElementById(id); if (node) node.textContent = '';
    }
    if (createReqModal) createReqModal.classList.add('hidden');
  }

  function updateRequisitionSalaryHint() {
    const job = requisitionJobTitles.find(item => item.id === createReqJobTitleSelect?.value);
    const min = document.getElementById('create-req-salary-min-input').value;
    const max = document.getElementById('create-req-salary-max-input').value;
    const known = job && job.minSalary !== null && job.maxSalary !== null && job.minSalary !== undefined && job.maxSalary !== undefined;
    const checked = requisitionSalaryCheck.key === requisitionSalaryCheckKey() ? requisitionSalaryCheck : null;
    const outside = checked?.status ? checked.status === 'OUTSIDE_STANDARD_RANGE'
      : known && ((min !== '' && Number(min) < job.minSalary) || (max !== '' && Number(max) > job.maxSalary));
    document.getElementById('create-req-standard-salary').textContent = known
      ? `Dải lương chuẩn: ${Number(job.minSalary).toLocaleString('vi-VN')} – ${Number(job.maxSalary).toLocaleString('vi-VN')} VND`
      : checked?.status === 'WITHIN_STANDARD_RANGE' ? 'Dải lương đề xuất nằm trong chuẩn chức danh.'
        : checked?.status === 'OUTSIDE_STANDARD_RANGE' ? 'Dải lương đề xuất nằm ngoài chuẩn chức danh.'
          : 'Dải lương sẽ được kiểm tra ở máy chủ khi lưu.';
    document.getElementById('create-req-salary-warning').textContent = outside ? 'Dải lương đề xuất ngoài chuẩn. Bắt buộc nhập giải trình, kể cả khi lưu nháp.' : checked?.message || '';
    document.getElementById('create-req-justification-input').required = Boolean(outside);
    return outside;
  }

  async function refreshRequisitionSalaryCheck() {
    const revision = ++requisitionSalaryCheckRevision;
    const token = sessionStorage.getItem('ats_token');
    const key = requisitionSalaryCheckKey();
    const jobTitleId = createReqJobTitleSelect?.value || '';
    const min = document.getElementById('create-req-salary-min-input').value;
    const max = document.getElementById('create-req-salary-max-input').value;
    requisitionSalaryCheck = { key: null, status: null, message: '' };
    updateRequisitionSalaryHint();
    if (!token || !jobTitleId || min === '' || max === '' || !Number.isFinite(Number(min)) || !Number.isFinite(Number(max)) || Number(min) < 0 || Number(max) < Number(min)) return null;
    try {
      const result = await window.ATS_API.getRequisitionOptionsApi(token, { jobTitleId, proposedSalaryMin: min, proposedSalaryMax: max });
      // Ignore responses from an older input or a previous session/modal.
      if (revision !== requisitionSalaryCheckRevision || key !== requisitionSalaryCheckKey() || token !== sessionStorage.getItem('ats_token')) return null;
      const status = result.ok && ['WITHIN_STANDARD_RANGE', 'OUTSIDE_STANDARD_RANGE'].includes(result.data?.salaryRangeStatus) ? result.data.salaryRangeStatus : null;
      requisitionSalaryCheck = { key, status, message: !result.ok ? result.data?.message || 'Chưa kiểm tra được dải lương. Máy chủ sẽ kiểm tra khi lưu.' : '' };
      updateRequisitionSalaryHint();
      return status;
    } catch {
      return null; // Save still goes through authoritative backend validation.
    }
  }
  for (const id of ['create-req-job-title-input', 'create-req-salary-min-input', 'create-req-salary-max-input']) {
    const node = document.getElementById(id); if (node) node.addEventListener('input', refreshRequisitionSalaryCheck);
  }

  async function openCreateReqModal(request = null, access = null) {
    if (!createReqModal) return;
    const optionsRevision = ++requisitionOptionsRevision;
    editingS210Requisition = request?.formVersion === 'S2-10' ? request : null;
    requisitionEditAccess = access;
    requisitionJobTitles = [];
    requisitionSalaryCheck = { key: null, status: null, message: '' };
    requisitionSalaryCheckRevision++;
    if (createReqForm) createReqForm.reset();
    if(editingS210Requisition?.status==='OPEN')document.getElementById('create-req-needed-date-input').removeAttribute('min');
    else document.getElementById('create-req-needed-date-input').min = requisitionBusinessDate();
    document.getElementById('create-req-state').textContent = editingS210Requisition ? `${editingS210Requisition.code} — ${editingS210Requisition.status === 'DRAFT' ? 'Nháp' : editingS210Requisition.status}` : 'Yêu cầu mới';
    if (createReqAlert) createReqAlert.classList.add('hidden');

    // Populate Recruiters list
    const token = sessionStorage.getItem('ats_token');
    const isCurrentSession = () => optionsRevision === requisitionOptionsRevision && token === sessionStorage.getItem('ats_token');
    if (token && createReqDepartmentSelect) {
      try {
        const departmentsRes = await window.ATS_API.getRequisitionOptionsApi(token);
        if (!isCurrentSession()) return;

        if (departmentsRes.ok && departmentsRes.data && departmentsRes.data.success) {
          const tree = departmentsRes.data.tree || [];
          requisitionJobTitles = departmentsRes.data.jobTitles || [];
          if(createReqRecruiterSelect)createReqRecruiterSelect.innerHTML='<option value="">-- Chưa chỉ định --</option>'+(departmentsRes.data.recruiters||[]).map(user=>`<option value="${escapeDepartmentHtml(user.id)}">${escapeDepartmentHtml(user.fullName)}</option>`).join('');
          if (createReqJobTitleSelect) createReqJobTitleSelect.innerHTML = '<option value="">-- Chọn chức danh --</option>' + requisitionJobTitles.map(job => `<option value="${escapeDepartmentHtml(job.id)}">${escapeDepartmentHtml(job.code)} — ${escapeDepartmentHtml(job.name)}${job.level ? ' (' + escapeDepartmentHtml(job.level) + ')' : ''}</option>`).join('');

          const renderDepartmentOptions = (nodes, depth = 0) =>
            nodes.map(department => {
              const prefix = depth > 0 ? '— '.repeat(depth) : '';
              const option = department.status === 'ACTIVE'
                ? `<option value="${escapeDepartmentHtml(department.id)}">${prefix}${escapeDepartmentHtml(department.name)}</option>`
                : '';

              return option +
                renderDepartmentOptions(department.children || [], depth + 1);
            }).join('');

          createReqDepartmentSelect.innerHTML =
            `<option value="">-- Chọn phòng ban --</option>` +
            renderDepartmentOptions(departmentsRes.data.s210Departments || tree);
        }
      } catch {
        if (!isCurrentSession()) return;
        createReqDepartmentSelect.innerHTML =
          `<option value="">-- Không tải được phòng ban --</option>`;
      }
    }
    if (token && createReqRecruiterSelect && currentAuthenticatedUser?.permissions?.includes('user.read')) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (!isCurrentSession()) return;
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          createReqRecruiterSelect.innerHTML = `<option value="">-- Chưa chỉ định --</option>` +
            recruiters.map(r => `<option value="${r.id}">${r.fullName || r.email} (${r.email})</option>`).join('');
        }
      } catch {
        // Fallback
      }
    }

    if (token && createReqWorkLocationSelect && createReqWorkModeSelect) {
      try {
        const [locationRes, modeRes] = await Promise.all([
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_LOCATION',
            status: 'ACTIVE'
          }),
          window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'WORK_MODE',
            status: 'ACTIVE'
          })
        ]);
        if (!isCurrentSession()) return;

        const locations =
          locationRes.ok && locationRes.data && locationRes.data.success
            ? locationRes.data.items || []
            : [];

        const modes =
          modeRes.ok && modeRes.data && modeRes.data.success
            ? modeRes.data.items || []
            : [];

        createReqWorkLocationSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          locations.map(item =>
            `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
          ).join('');

        createReqWorkModeSelect.innerHTML =
          '<option value="">-- Chưa xác định --</option>' +
          modes.map(item =>
            `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
          ).join('');
      } catch {
        if (!isCurrentSession()) return;
        createReqWorkLocationSelect.innerHTML =
          '<option value="">-- Không tải được địa điểm --</option>';

        createReqWorkModeSelect.innerHTML =
          '<option value="">-- Không tải được hình thức --</option>';
      }
    }

    if (editingS210Requisition) {
      const req = editingS210Requisition;
      const mapping = { 'create-req-title-input': 'title', 'create-req-job-title-input': 'jobTitleId', 'create-req-dept-input': 'departmentId',
        'create-req-headcount-input': 'headcount', 'create-req-reason-input': 'recruitmentReason', 'create-req-needed-date-input': 'neededDate',
        'create-req-salary-min-input': 'proposedSalaryMin', 'create-req-salary-max-input': 'proposedSalaryMax', 'create-req-justification-input': 'salaryJustification',
        'create-req-description-input': 'jobDescription', 'create-req-requirements-input': 'candidateRequirements',
        'create-req-work-location-select': 'workLocationId', 'create-req-work-mode-select': 'workModeId', 'create-req-recruiter-select': 'recruiterId' };
      const savedLabels = { jobTitleId: 'Chức danh đã lưu', departmentId: req.departmentName,
        recruiterId: req.recruiterName || 'Nhân sự đã lưu', workLocationId: 'Địa điểm đã lưu', workModeId: 'Hình thức đã lưu' };
      for (const [id, key] of Object.entries(mapping)) {
        const node = document.getElementById(id);
        const value = req[key] ?? '';
        // A read-only or inactive reference may be absent from the current choices.
        // Keep the stored selection rather than silently clearing it on a draft save.
        if (node.tagName === 'SELECT' && value && Object.hasOwn(savedLabels, key) && !Array.from(node.options).some(option => option.value === value)) {
          node.innerHTML += `<option value="${escapeDepartmentHtml(value)}">${escapeDepartmentHtml(savedLabels[key] || value)}</option>`;
        }
        node.value = value;
      }
    }
    let editable = !editingS210Requisition;
    if(editingS210Requisition && access)editable=access.canEdit===true;
    else if (editingS210Requisition?.status === 'DRAFT') {
      const permissions = await window.ATS_API.getPermissionsApi(token);
      if (!isCurrentSession()) return;
      editable = permissions.ok && (permissions.data?.permissions || []).includes('requisition.draft.edit');
    }
    if (!isCurrentSession()) return;
    createReqForm.querySelectorAll('input, select, textarea').forEach(node => { node.disabled = !editable; });
    document.getElementById('create-req-legacy-dept-input').disabled = true;
    pendingOpenProposal=null;if(reapproveCreateReqBtn)reapproveCreateReqBtn.classList.add('hidden');
    const editingOpen=editingS210Requisition?.status==='OPEN';
    const operational=document.getElementById('create-req-operational-fields');if(operational)operational.classList.toggle('hidden',!editingOpen);
    const notes=document.getElementById('create-req-handover-notes');if(notes){notes.value=editingS210Requisition?.handoverNotes||'';notes.disabled=!editable||!editingOpen;}
    if(editingOpen){
      const significant=editable&&access?.canChangeSignificant;
      for(const id of ['create-req-title-input','create-req-job-title-input','create-req-dept-input','create-req-headcount-input','create-req-reason-input','create-req-salary-min-input','create-req-salary-max-input','create-req-needed-date-input','create-req-description-input','create-req-requirements-input','create-req-justification-input','create-req-work-location-select','create-req-work-mode-select'])document.getElementById(id).disabled=!significant;
      if(createReqRecruiterSelect)createReqRecruiterSelect.disabled=!editable||!access?.operationalFields?.includes('recruiterId');
    }
    if (saveCreateReqDraftBtn) saveCreateReqDraftBtn.classList.toggle('hidden', !editable||editingOpen);
    document.getElementById('submit-create-req-btn').classList.toggle('hidden', !editable);
    updateRequisitionSalaryHint();
    createReqModal.classList.remove('hidden');
    await refreshRequisitionSalaryCheck();
  }

  if (openCreateReqModalBtn) openCreateReqModalBtn.addEventListener('click', openCreateReqModal);
  if (closeCreateReqModal) closeCreateReqModal.addEventListener('click', () => createReqModal.classList.add('hidden'));
  if (cancelCreateReqBtn) cancelCreateReqBtn.addEventListener('click', () => createReqModal.classList.add('hidden'));

  async function saveRequisitionForm(status) {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const title = document.getElementById('create-req-title-input').value.trim();
      const departmentId = createReqDepartmentSelect
        ? createReqDepartmentSelect.value
        : '';
      const headcountInput = document.getElementById('create-req-headcount-input').value;
      const headcount = headcountInput === '' ? null : Number(headcountInput);
      const recruiterId = createReqRecruiterSelect ? createReqRecruiterSelect.value : null;
      const workLocationId = createReqWorkLocationSelect
        ? createReqWorkLocationSelect.value
        : null;
      const workModeId = createReqWorkModeSelect
        ? createReqWorkModeSelect.value
        : null;

      try {
        const read = id => document.getElementById(id).value;
        const min = read('create-req-salary-min-input'), max = read('create-req-salary-max-input');
        const payload = {
          formVersion: 'S2-10', status,
          title,
          departmentId,
          jobTitleId: createReqJobTitleSelect?.value || null,
          headcount,
          recruitmentReason: read('create-req-reason-input') || null,
          proposedSalaryMin: min === '' ? null : Number(min), proposedSalaryMax: max === '' ? null : Number(max),
          neededDate: read('create-req-needed-date-input') || null,
          jobDescription: read('create-req-description-input'), candidateRequirements: read('create-req-requirements-input'),
          salaryJustification: read('create-req-justification-input'),
          recruiterId: recruiterId || null,
          workLocationId: workLocationId || null,
          workModeId: workModeId || null
        };
        if(editingS210Requisition?.status==='OPEN'){
          const editorId=editingS210Requisition.id,editorRevision=requisitionOptionsRevision;
          payload.handoverNotes=document.getElementById('create-req-handover-notes').value;
          const changes=Object.fromEntries(Object.entries(payload).filter(([key,value])=>!['status','formVersion'].includes(key)&&(value??'')!==(editingS210Requisition[key]??'')));
          const result=await window.ATS_API.updateRequisitionApi(token,editorId,{...changes,expectedOperationVersion:requisitionEditAccess?.operationVersion});
          if(token!==sessionStorage.getItem('ats_token')||editorRevision!==requisitionOptionsRevision||editorId!==editingS210Requisition?.id||createReqModal.classList.contains('hidden'))return;
          if(result.ok&&result.data?.success){createReqModal.classList.add('hidden');showToast('success','Đã cập nhật','Thông tin vận hành đã được lưu.');loadRequisitions();}
          else{createReqAlertMsg.textContent=requisitionFailureMessage(result,'Không thể cập nhật yêu cầu tuyển dụng.');createReqAlert.classList.remove('hidden');if(result.data?.code==='REQUISITION_REAPPROVAL_REQUIRED'&&result.data.approvalEnabled){pendingOpenProposal=Object.fromEntries(Object.entries(changes).filter(([key])=>requisitionEditAccess?.significantFields?.includes(key)));reapproveCreateReqBtn?.classList.remove('hidden');}}
          return;
        }
        if (headcount !== null && (!Number.isSafeInteger(headcount) || headcount <= 0)) throw new Error('Số lượng cần tuyển phải là số nguyên lớn hơn 0.');
        for (const salary of [payload.proposedSalaryMin, payload.proposedSalaryMax]) {
          if (salary !== null && (!Number.isFinite(salary) || salary < 0)) throw new Error('Lương đề xuất phải là số hợp lệ, không âm.');
        }
        if (min !== '' && max !== '' && payload.proposedSalaryMin > payload.proposedSalaryMax) throw new Error('Lương tối thiểu không được lớn hơn lương tối đa.');
        if (payload.neededDate && payload.neededDate < requisitionBusinessDate()) throw new Error('Ngày cần người không được ở quá khứ.');
        await refreshRequisitionSalaryCheck();
        if (updateRequisitionSalaryHint() && !payload.salaryJustification.trim()) throw new Error('Dải lương ngoài chuẩn bắt buộc nhập giải trình.');
        if (status !== 'DRAFT' && ['jobTitleId', 'departmentId', 'headcount', 'recruitmentReason', 'proposedSalaryMin', 'proposedSalaryMax', 'neededDate', 'jobDescription', 'candidateRequirements'].some(key => payload[key] === null || payload[key] === '' || (typeof payload[key] === 'string' && !payload[key].trim()))) throw new Error('Vui lòng nhập đầy đủ thông tin bắt buộc trước khi hoàn tất.');
        const res = editingS210Requisition
          ? await window.ATS_API.updateRequisitionApi(token, editingS210Requisition.id, payload)
          : await window.ATS_API.createRequisition(token, payload);

        if (res.ok && res.data && res.data.success) {
          createReqModal.classList.add('hidden');
          showToast('success', status === 'DRAFT' ? 'Đã lưu nháp' : 'Đã hoàn tất', status === 'DRAFT' ? 'Có thể mở nháp từ danh sách để tiếp tục chỉnh sửa.' : 'Yêu cầu đã chuyển sang trạng thái mở tuyển dụng.');
          loadRequisitions();
          loadDashboardData();
        } else {
          if (createReqAlert && createReqAlertMsg) {
            createReqAlertMsg.textContent = editingS210Requisition ? requisitionFailureMessage(res, 'Không thể cập nhật yêu cầu tuyển dụng. Vui lòng thử lại.') : res.data?.message || 'Không thể tạo vị trí tuyển dụng.';
            createReqAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createReqAlert && createReqAlertMsg) {
          createReqAlertMsg.textContent = err.message;
          createReqAlert.classList.remove('hidden');
        }
      }
  }
  if (createReqForm) {
    createReqForm.addEventListener('submit', e => { e.preventDefault(); return saveRequisitionForm('OPEN'); });
  }
  if (saveCreateReqDraftBtn) saveCreateReqDraftBtn.addEventListener('click', () => saveRequisitionForm('DRAFT'));
