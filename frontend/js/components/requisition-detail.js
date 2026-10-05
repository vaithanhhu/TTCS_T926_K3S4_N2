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

  async function openRequisitionDetails(id) {
    if (!reqDetailModal) return;
    const req = currentRequisitionsList.find(r => r.id === id);
    if (!req) return;
    if (req.formVersion === 'S2-10') {
      const result = await window.ATS_API.getRequisitionByIdApi(sessionStorage.getItem('ats_token'), id);
      if (result.ok && result.data?.success) await openCreateReqModal(result.data.data);
      else showToast('error', 'Không thể đọc yêu cầu', result.data?.message || 'Không thể tải yêu cầu tuyển dụng.');
      return;
    }

    document.getElementById('req-detail-id').value = req.id;
    document.getElementById('req-detail-code').textContent = req.code;
    document.getElementById('req-detail-title-input').value = req.title;
    document.getElementById('req-detail-dept-input').value = req.departmentName || req.department || '';
    document.getElementById('req-detail-headcount-input').value = req.headcount;
    document.getElementById('req-detail-status-select').value = req.status;

    const statusBadge = document.getElementById('req-detail-status-badge');
    if (statusBadge) {
      statusBadge.className = `badge ${req.status === 'OPEN' ? 'badge-primary' : (req.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral')}`;
      statusBadge.textContent = req.status === 'OPEN' ? 'Đang mở' : (req.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng');
    }

    const token = sessionStorage.getItem('ats_token');
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
    if (reqDetailAlert) reqDetailAlert.classList.add('hidden');
    reqDetailModal.classList.remove('hidden');
  }

  if (closeReqDetailModal) closeReqDetailModal.addEventListener('click', () => reqDetailModal.classList.add('hidden'));
  if (cancelReqDetailBtn) cancelReqDetailBtn.addEventListener('click', () => reqDetailModal.classList.add('hidden'));

  if (reqDetailForm) {
    reqDetailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

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
        const res = await window.ATS_API.updateRequisitionApi(token, id, {
          title,
          departmentName,
          headcount,
          status,
          recruiterId,
          workLocationId: workLocationId || null,
          workModeId: workModeId || null
        });
        if (res.ok && res.data && res.data.success) {
          reqDetailModal.classList.add('hidden');
          showToast('success', 'Cập nhật thành công', `Vị trí "${title}" đã được lưu.`);
          loadRequisitions();
          loadDashboardData();
        } else {
          if (reqDetailAlert && reqDetailAlertMsg) {
            reqDetailAlertMsg.textContent = res.data.message || 'Không thể cập nhật.';
            reqDetailAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (reqDetailAlert && reqDetailAlertMsg) {
          reqDetailAlertMsg.textContent = err.message;
          reqDetailAlert.classList.remove('hidden');
        }
      }
    });
  }
