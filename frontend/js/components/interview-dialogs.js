  // --- INTERVIEW MODALS ---
  const openCreateInterviewModalBtn = document.getElementById('open-create-interview-modal-btn');
  const scheduleInterviewModal = document.getElementById('schedule-interview-modal');
  const closeScheduleInterviewModal = document.getElementById('close-schedule-interview-modal');
  const cancelScheduleInterviewBtn = document.getElementById('cancel-schedule-interview-btn');
  const scheduleInterviewForm = document.getElementById('schedule-interview-form');
  const scheduleInterviewAlert = document.getElementById('schedule-interview-alert');
  const scheduleInterviewAlertMsg = document.getElementById('schedule-interview-alert-msg');

  function openScheduleInterviewForCandidate(preselectedCandidateId = '') {
    if (scheduleInterviewModal) scheduleInterviewModal.classList.remove('hidden');
    if (scheduleInterviewForm) scheduleInterviewForm.reset();
    if (scheduleInterviewAlert) scheduleInterviewAlert.classList.add('hidden');

    // Populate candidate dropdown
    const candSelect = document.getElementById('schedule-candidate-select');
    if (candSelect) {
      candSelect.innerHTML = `<option value="">-- Chọn ứng viên trong danh sách --</option>` +
        currentCandidatesList.map(c => `
          <option value="${c.id}" ${c.id === preselectedCandidateId ? 'selected' : ''}>
            ${c.fullName || c.full_name} (${formatCandCode(c)}) - ${c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí'}
          </option>
        `).join('');
    }

    // Populate requisitions
    const reqSelect = document.getElementById('schedule-req-select');
    if (reqSelect) {
      reqSelect.innerHTML = `<option value="">-- Theo vị trí tuyển dụng --</option>` +
        currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
    }

    // Populate interviewers
    const interviewerSelect = document.getElementById('schedule-interviewer-select');
    if (interviewerSelect) {
      interviewerSelect.innerHTML = `
        <option value="">-- Chọn cán bộ phỏng vấn --</option>
        <option value="usr-interviewer">Nguyễn Văn D - Interviewer (Kỹ thuật)</option>
        <option value="usr-hiring-mgr">Lê Thị C - Hiring Manager (Trưởng bộ phận)</option>
        <option value="usr-recruiter">Trần Thị B - Recruiter (Tuyển dụng)</option>
        <option value="usr-admin">Administrator - Quản trị viên</option>
      `;
    }

    // Pre-fill time with tomorrow 09:00 AM
    const timeInput = document.getElementById('schedule-time');
    if (timeInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const tzOffset = tomorrow.getTimezoneOffset() * 60000;
      const localISOTime = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);
      timeInput.value = localISOTime;
    }
  }

  if (openCreateInterviewModalBtn) {
    openCreateInterviewModalBtn.addEventListener('click', () => {
      openScheduleInterviewForCandidate();
    });
  }

  function closeScheduleInterview() {
    if (scheduleInterviewModal) scheduleInterviewModal.classList.add('hidden');
  }
  if (closeScheduleInterviewModal) closeScheduleInterviewModal.addEventListener('click', closeScheduleInterview);
  if (cancelScheduleInterviewBtn) cancelScheduleInterviewBtn.addEventListener('click', closeScheduleInterview);

  if (scheduleInterviewForm) {
    scheduleInterviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const candidateId = document.getElementById('schedule-candidate-select').value;
      const requisitionId = document.getElementById('schedule-req-select').value;
      const interviewerId = document.getElementById('schedule-interviewer-select').value;
      const roundName = document.getElementById('schedule-round-name').value.trim();
      const scheduledTime = document.getElementById('schedule-time').value;
      const locationOrLink = document.getElementById('schedule-location').value.trim();

      try {
        const res = await window.ATS_API.createInterviewApi(token, {
          candidateId, requisitionId, interviewerId, roundName, scheduledTime, locationOrLink
        });

        if (res.ok && res.data && res.data.success) {
          closeScheduleInterview();
          showToast('success', 'Lên lịch phỏng vấn thành công', 'Phiên phỏng vấn đã được ghi nhận và gửi lời mời.');
          loadInterviews();
          loadCandidates();
          loadDashboardData();
        } else {
          if (scheduleInterviewAlert && scheduleInterviewAlertMsg) {
            scheduleInterviewAlertMsg.textContent = res.data.message || 'Không thể tạo lịch phỏng vấn.';
            scheduleInterviewAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (scheduleInterviewAlert && scheduleInterviewAlertMsg) {
          scheduleInterviewAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          scheduleInterviewAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Interview Evaluation Details Modal
  const interviewDetailModal = document.getElementById('interview-detail-modal');
  const closeInterviewDetailModal = document.getElementById('close-interview-detail-modal');
  const cancelInterviewEvalBtn = document.getElementById('cancel-interview-eval-btn');
  const interviewEvalForm = document.getElementById('interview-eval-form');

  function openInterviewDetails(id) {
    const iv = currentInterviewsList.find(x => x.id === id);
    if (!iv) {
      showToast('warning', 'Lịch phỏng vấn', `Đang tải chi tiết buổi phỏng vấn...`);
      return;
    }

    const candName = (iv.candidate && iv.candidate.fullName) ? iv.candidate.fullName : (iv.candidate_name || 'Ứng viên');
    const reqTitle = (iv.requisition && iv.requisition.title) ? iv.requisition.title : (iv.requisition_title || 'Vị trí');
    const interviewer = (iv.interviewer && iv.interviewer.fullName) ? iv.interviewer.fullName : (iv.interviewer_name || 'Hội đồng tuyển dụng');
    const schedTime = iv.scheduledTime || iv.scheduled_time || iv.scheduled_at;
    const location = iv.locationOrLink || iv.location || 'Google Meet';

    const codeEl = document.getElementById('int-detail-code');
    const statusBadge = document.getElementById('int-detail-status-badge');
    const candNameEl = document.getElementById('int-detail-cand-name');
    const reqTitleEl = document.getElementById('int-detail-req-title');
    const roundEl = document.getElementById('int-detail-round');
    const timeEl = document.getElementById('int-detail-time');
    const locationEl = document.getElementById('int-detail-location');
    const interviewerEl = document.getElementById('int-detail-interviewer');
    const idInput = document.getElementById('int-detail-id');
    const statusSelect = document.getElementById('int-eval-status');
    const scoreSelect = document.getElementById('int-eval-score');
    const feedbackInput = document.getElementById('int-eval-feedback');

    if (codeEl) codeEl.textContent = iv.code || (iv.id ? iv.id.toUpperCase() : 'PV');
    if (statusBadge) {
      statusBadge.className = `badge ${iv.status === 'SCHEDULED' ? 'badge-warning' : (iv.status === 'COMPLETED' ? 'badge-success' : 'badge-danger')}`;
      statusBadge.textContent = iv.status === 'SCHEDULED' ? 'Sắp diễn ra' : (iv.status === 'COMPLETED' ? 'Đã hoàn thành' : 'Đã hủy');
    }
    if (candNameEl) candNameEl.textContent = candName;
    if (reqTitleEl) reqTitleEl.textContent = reqTitle;
    if (roundEl) roundEl.textContent = iv.roundName || iv.round_name || 'Vòng 1';
    if (timeEl) timeEl.textContent = new Date(schedTime).toLocaleString('vi-VN');
    if (locationEl) locationEl.textContent = location;
    if (interviewerEl) interviewerEl.textContent = interviewer;
    if (idInput) idInput.value = iv.id;
    if (statusSelect) statusSelect.value = iv.status || 'SCHEDULED';
    if (scoreSelect) scoreSelect.value = iv.score || 4;
    if (feedbackInput) feedbackInput.value = iv.feedback || '';

    if (interviewDetailModal) interviewDetailModal.classList.remove('hidden');
  }

  function closeInterviewDetail() {
    if (interviewDetailModal) interviewDetailModal.classList.add('hidden');
  }
  if (closeInterviewDetailModal) closeInterviewDetailModal.addEventListener('click', closeInterviewDetail);
  if (cancelInterviewEvalBtn) cancelInterviewEvalBtn.addEventListener('click', closeInterviewDetail);

  if (interviewEvalForm) {
    interviewEvalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('int-detail-id').value;
      const status = document.getElementById('int-eval-status').value;
      const score = document.getElementById('int-eval-score').value;
      const feedback = document.getElementById('int-eval-feedback').value.trim();
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateInterviewStatusApi(token, id, status, feedback, score);
        if (res.ok && res.data && res.data.success) {
          closeInterviewDetail();
          showToast('success', 'Đánh giá hoàn tất', 'Đã lưu biên bản và cập nhật kết quả phỏng vấn.');
          loadInterviews();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi đánh giá', res.data.message || 'Không thể lưu đánh giá.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }
