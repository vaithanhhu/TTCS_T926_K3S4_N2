  // Modal: Reassign Handover
  const reassignHandoverModal = document.getElementById('reassign-handover-modal');
  const closeReassignHandoverModal = document.getElementById('close-reassign-handover-modal');
  const cancelReassignHandoverBtn = document.getElementById('cancel-reassign-handover-btn');
  const reassignHandoverForm = document.getElementById('reassign-handover-form');
  const reassignHandoverAlert = document.getElementById('reassign-handover-alert');
  const reassignHandoverAlertMsg = document.getElementById('reassign-handover-alert-msg');
  const handoverNewRecruiterSelect = document.getElementById('handover-new-recruiter-select');

  async function openReassignHandoverModal(reqId, reqCode, reqTitle) {
    if (!reassignHandoverModal) return;
    document.getElementById('handover-req-id').value = reqId;
    document.getElementById('handover-req-code').textContent = reqCode;
    document.getElementById('handover-req-title').textContent = reqTitle;
    document.getElementById('handover-notes-input').value = '';

    const token = sessionStorage.getItem('ats_token');
    if (token && handoverNewRecruiterSelect) {
      try {
        const usersRes = await window.ATS_API.getUsersApi(token, { role: 'RECRUITER', status: 'ACTIVE' });
        if (usersRes.ok && usersRes.data && usersRes.data.success) {
          const recruiters = usersRes.data.data.users || [];
          handoverNewRecruiterSelect.innerHTML = `<option value="">-- Chọn nhân sự tiếp quản --</option>` +
            recruiters.map(r => `<option value="${r.id}">${r.fullName || r.email} (${r.email})</option>`).join('');
        }
      } catch {
        // Fallback
      }
    }

    if (reassignHandoverAlert) reassignHandoverAlert.classList.add('hidden');
    reassignHandoverModal.classList.remove('hidden');
  }

  if (closeReassignHandoverModal) closeReassignHandoverModal.addEventListener('click', () => reassignHandoverModal.classList.add('hidden'));
  if (cancelReassignHandoverBtn) cancelReassignHandoverBtn.addEventListener('click', () => reassignHandoverModal.classList.add('hidden'));

  if (reassignHandoverForm) {
    reassignHandoverForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const reqId = document.getElementById('handover-req-id').value;
      const newRecruiterId = handoverNewRecruiterSelect.value;
      const notes = document.getElementById('handover-notes-input').value.trim();

      if (!newRecruiterId) {
        if (reassignHandoverAlert && reassignHandoverAlertMsg) {
          reassignHandoverAlertMsg.textContent = 'Vui lòng chọn chuyên viên tuyển dụng mới tiếp nhận.';
          reassignHandoverAlert.classList.remove('hidden');
        }
        return;
      }

      try {
        const res = await window.ATS_API.handoverRequisition(token, reqId, { newRecruiterId, notes });
        if (res.ok && res.data && res.data.success) {
          reassignHandoverModal.classList.add('hidden');
          showToast('success', 'Bàn giao hoàn tất', 'Vị trí đã được bàn giao và gỡ bỏ cảnh báo.');
          loadRequisitions();
          loadDashboardData();
        } else {
          if (reassignHandoverAlert && reassignHandoverAlertMsg) {
            reassignHandoverAlertMsg.textContent = res.data.message || 'Không thể bàn giao vị trí.';
            reassignHandoverAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (reassignHandoverAlert && reassignHandoverAlertMsg) {
          reassignHandoverAlertMsg.textContent = err.message;
          reassignHandoverAlert.classList.remove('hidden');
        }
      }
    });
  }
