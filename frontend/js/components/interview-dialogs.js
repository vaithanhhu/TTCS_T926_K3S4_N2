  // --- INTERVIEW MODALS ---
  const openCreateInterviewModalBtn = document.getElementById('open-create-interview-modal-btn');
  const scheduleInterviewModal = document.getElementById('schedule-interview-modal');
  const closeScheduleInterviewModal = document.getElementById('close-schedule-interview-modal');
  const cancelScheduleInterviewBtn = document.getElementById('cancel-schedule-interview-btn');
  const scheduleInterviewForm = document.getElementById('schedule-interview-form');
  const scheduleInterviewAlert = document.getElementById('schedule-interview-alert');
  const scheduleInterviewAlertMsg = document.getElementById('schedule-interview-alert-msg');
  const conflictPanel=document.getElementById('schedule-interview-conflicts');
  const conflictList=document.getElementById('schedule-interview-conflict-list');
  const overrideControls=document.getElementById('schedule-interview-override-controls');
  let pendingConflictPayload=null;
  const displayConflicts=rows=>{
    if(!conflictPanel||!conflictList)return;
    const proposed=pendingConflictPayload;
    const own=proposed?`<article style="padding:8px 0"><strong>Lịch đang tạo</strong> · ${escapeHtml(new Date(proposed.scheduledTime).toLocaleString())} – ${escapeHtml(new Date(new Date(proposed.scheduledTime).getTime()+(Number(proposed.durationMinutes)||60)*60000).toLocaleString())}<div>Người phỏng vấn: ${escapeHtml((proposed.interviewerIds||[]).join(', '))}</div><div>Phòng: ${escapeHtml(proposed.meetingRoom||'—')}</div></article>`:'';
    conflictList.innerHTML=own+(rows||[]).map(row=>`<article style="border-top:1px solid var(--color-border);padding:8px 0"><strong>${escapeHtml(row.candidateName||row.candidateEmail||row.candidateId||'Ứng viên')}</strong> · ${escapeHtml(new Date(row.scheduledTime).toLocaleString())} – ${escapeHtml(new Date(row.endTime).toLocaleString())}<div>Người phỏng vấn: ${escapeHtml((row.interviewers||[]).map(person=>person.fullName||person.id).join(', ')||'—')}</div><div>Phòng: ${escapeHtml(row.meetingRoom||'—')}</div><div>Lý do: ${escapeHtml((row.resourceConflicts||[]).map(item=>item.type==='ROOM'?'Trùng phòng '+item.meetingRoom:item.type==='CANDIDATE'?'Trùng ứng viên': 'Trùng người '+(item.interviewers||[]).map(person=>person.fullName||person.id).join(', ')).join('; '))}</div></article>`).join('');
    conflictPanel.classList.remove('hidden');
    const authenticatedUser=typeof currentAuthenticatedUser==='undefined'?null:currentAuthenticatedUser;
    if(overrideControls)overrideControls.classList.toggle('hidden',!(authenticatedUser?.permissions||[]).includes('interview.conflict.override'));
  };
  document.getElementById('schedule-interview-override-btn')?.addEventListener('click',async()=>{
    if(!pendingConflictPayload)return;
    const reason=document.getElementById('schedule-interview-override-reason')?.value.trim()||'';
    if(reason.length<3){if(scheduleInterviewAlertMsg)scheduleInterviewAlertMsg.textContent='Vui lòng nhập lý do ghi đè (ít nhất 3 ký tự).';scheduleInterviewAlert?.classList.remove('hidden');return;}
    pendingConflictPayload.conflictOverrideConfirmed=true;pendingConflictPayload.conflictOverrideReason=reason;
    const res=await window.ATS_API.createInterviewApi(sessionStorage.getItem('ats_token'),pendingConflictPayload);
    if(res.ok&&res.data?.success){closeScheduleInterview();showToast('success','Đã ghi đè xung đột','Lịch đã lưu và thao tác được ghi nhận.');loadInterviews();loadCandidates();loadDashboardData();}
    else if(res.data?.conflicts){displayConflicts(res.data.conflicts);showToast('warning','Xung đột lịch đã thay đổi','Hãy rà soát lại danh sách trước khi xác nhận.');}
    else{if(scheduleInterviewAlertMsg)scheduleInterviewAlertMsg.textContent=res.data?.message||res.data?.code||'Không thể ghi đè lịch.';scheduleInterviewAlert?.classList.remove('hidden');}
  });

  const formatSelectEl = document.getElementById('schedule-format-select');
  if (formatSelectEl) {
    formatSelectEl.addEventListener('change', () => {
      const isOnline = formatSelectEl.value === 'ONLINE';
      const onlineGroup = document.getElementById('schedule-online-group');
      const inpersonGroup = document.getElementById('schedule-inperson-group');
      if (onlineGroup) onlineGroup.classList.toggle('hidden', !isOnline);
      if (inpersonGroup) inpersonGroup.classList.toggle('hidden', isOnline);
      const link = document.getElementById('schedule-meeting-link');
      const room = document.getElementById('schedule-meeting-room');
      if (link) { link.required = isOnline; link.disabled = !isOnline; }
      if (room) { room.required = !isOnline; room.disabled = isOnline; }
    });
  }

  const roundSelectEl = document.getElementById('schedule-round-select');
  if (roundSelectEl) {
    roundSelectEl.addEventListener('change', () => {
      const roundInput = document.getElementById('schedule-round-name');
      if (!roundInput) return;
      if (roundSelectEl.value === 'CUSTOM') {
        roundInput.value = '';
        roundInput.focus();
      } else {
        roundInput.value = roundSelectEl.value;
      }
    });
  }

  async function openScheduleInterviewForCandidate(preselectedCandidateId = '') {
    if (scheduleInterviewModal) scheduleInterviewModal.classList.remove('hidden');
    if (scheduleInterviewForm) scheduleInterviewForm.reset();
    if (scheduleInterviewAlert) scheduleInterviewAlert.classList.add('hidden');
    conflictPanel?.classList.add('hidden');pendingConflictPayload=null;

    const formatSelect = document.getElementById('schedule-format-select');
    const onlineGroup = document.getElementById('schedule-online-group');
    const inpersonGroup = document.getElementById('schedule-inperson-group');
    const durationSelect = document.getElementById('schedule-duration-select');
    const roundSelect = document.getElementById('schedule-round-select');
    const roundNameInput = document.getElementById('schedule-round-name');
    const meetingLinkInput = document.getElementById('schedule-meeting-link');
    const meetingRoomInput = document.getElementById('schedule-meeting-room');
    const additionalContainer = document.getElementById('schedule-additional-interviewers');

    if (formatSelect) formatSelect.value = 'ONLINE';
    if (onlineGroup) onlineGroup.classList.remove('hidden');
    if (inpersonGroup) inpersonGroup.classList.add('hidden');
    if (meetingLinkInput) { meetingLinkInput.value = ''; meetingLinkInput.required = true; meetingLinkInput.disabled = false; }
    if (meetingRoomInput) { meetingRoomInput.value = ''; meetingRoomInput.required = false; meetingRoomInput.disabled = true; }
    if (durationSelect) durationSelect.value = '60';
    if (roundSelect) roundSelect.value = 'Vòng 1 - Kỹ thuật chuyên môn';
    if (roundNameInput) roundNameInput.value = 'Vòng 1 - Kỹ thuật chuyên môn';

    const candSelect = document.getElementById('schedule-candidate-select');
    if (candSelect) {
      candSelect.innerHTML = `<option value="">-- Chọn ứng viên trong danh sách --</option>` +
        currentCandidatesList.map(c => `
          <option value="${escapeHtml(c.id)}" ${c.id === preselectedCandidateId ? 'selected' : ''}>
            ${escapeHtml(c.fullName || c.full_name)} (${escapeHtml(formatCandCode(c))}) - ${escapeHtml(c.requisition_title || (c.requisition && c.requisition.title) || 'Vị trí')}
          </option>
        `).join('');
    }

    const reqSelect = document.getElementById('schedule-req-select');
    if (reqSelect) {
      reqSelect.innerHTML = `<option value="">-- Theo vị trí tuyển dụng --</option>` +
        currentRequisitionsList.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.code)} - ${escapeHtml(r.title)}</option>`).join('');
    }

    if (preselectedCandidateId && candSelect) {
      const selectedCand = currentCandidatesList.find(c => c.id === preselectedCandidateId);
      if (selectedCand) {
        const reqId = selectedCand.requisition_id || (selectedCand.requisition && selectedCand.requisition.id);
        if (reqId && reqSelect) reqSelect.value = reqId;
      }
    }

    const interviewerSelect = document.getElementById('schedule-interviewer-select');
    if (interviewerSelect) {
      const token = sessionStorage.getItem('ats_token');
      const options = await window.ATS_API.getInterviewOptionsApi(token);
      if (token !== sessionStorage.getItem('ats_token')) return;
      const interviewersList = options.data?.interviewers || [];
      interviewerSelect.innerHTML = '<option value="">-- Chọn cán bộ phỏng vấn --</option>' +
        interviewersList.map(user => `<option value="${escapeDepartmentHtml(user.id)}">${escapeDepartmentHtml(user.fullName)}</option>`).join('');
      if (!options.ok) showToast('danger', 'Người phỏng vấn', options.data?.message || 'Không thể tải người phỏng vấn.');

      const renderAdditionalInterviewers = () => {
        if (!additionalContainer) return;
        const primaryId = interviewerSelect.value;
        const available = interviewersList.filter(u => u.id !== primaryId);
        if (available.length === 0) {
          additionalContainer.innerHTML = '<span style="font-size: 0.8rem; color: var(--color-text-muted);">Không có cán bộ phỏng vấn phối hợp bổ sung</span>';
          return;
        }
        additionalContainer.innerHTML = available.map(u => `
          <label style="display: flex; align-items: center; gap: 6px; font-size: 0.825rem; cursor: pointer; margin: 0;">
            <input type="checkbox" class="schedule-co-interviewer-chk" value="${escapeHtml(u.id)}" />
            <span>${escapeHtml(u.fullName || u.email)}</span>
          </label>
        `).join('');
      };

      renderAdditionalInterviewers();
      interviewerSelect.onchange = renderAdditionalInterviewers;
    }

    const timeInput = document.getElementById('schedule-time');
    if (timeInput) {
      const vietnamToday = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const tomorrow = new Date(vietnamToday + 'T09:00:00+07:00');
      tomorrow.setTime(tomorrow.getTime() + 86400000);
      timeInput.value = new Date(tomorrow.getTime() + 7 * 3600000).toISOString().slice(0,16);
    }
  }

  if (openCreateInterviewModalBtn) {
    openCreateInterviewModalBtn.addEventListener('click', () => {
      return openScheduleInterviewForCandidate();
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
      const durationSelect = document.getElementById('schedule-duration-select');
      const durationMinutes = durationSelect ? (parseInt(durationSelect.value, 10) || 60) : 60;
      const formatSelect = document.getElementById('schedule-format-select');
      const interviewFormat = formatSelect ? formatSelect.value : 'ONLINE';
      const meetingLink = (document.getElementById('schedule-meeting-link')?.value || '').trim();
      const meetingRoom = (document.getElementById('schedule-meeting-room')?.value || '').trim();
      const locationOrLink = interviewFormat === 'IN_PERSON' ? meetingRoom : meetingLink;

      const checkedCoInterviewers = Array.from(document.querySelectorAll('.schedule-co-interviewer-chk:checked')).map(cb => cb.value);
      const interviewerIds = Array.from(new Set([interviewerId, ...checkedCoInterviewers].filter(Boolean)));

      try {
        const payload = {
          candidateId,
          requisitionId,
          interviewerId,
          interviewerIds,
          roundName,
          scheduledTime,
          durationMinutes,
          interviewFormat,
          meetingRoom: interviewFormat === 'IN_PERSON' ? meetingRoom : null,
          meetingLink: interviewFormat === 'ONLINE' ? meetingLink : null,
          locationOrLink
        };
        const res = await window.ATS_API.createInterviewApi(token, payload);

        if (res.ok && res.data && res.data.success) {
          closeScheduleInterview();
          showToast('success', 'Lên lịch phỏng vấn thành công', 'Lịch phỏng vấn đã được lưu.');
          loadInterviews();
          loadCandidates();
          loadDashboardData();
        } else {
          if(res.data?.conflicts){pendingConflictPayload=payload;displayConflicts(res.data.conflicts);}
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
    const interviewer = (Array.isArray(iv.interviewers) && iv.interviewers.length > 0)
      ? iv.interviewers.map(u => u.fullName || u.full_name || u.name || u.email).filter(Boolean).join(', ')
      : ((iv.interviewer && iv.interviewer.fullName) ? iv.interviewer.fullName : (iv.interviewer_name || 'Hội đồng tuyển dụng'));
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
    if (timeEl) timeEl.textContent = new Date(schedTime).toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'});
    if (locationEl) locationEl.textContent = location;
    if (interviewerEl) interviewerEl.textContent = interviewer;
    const respBadgeEl = document.getElementById('int-detail-response-status');
    if (respBadgeEl) {
      const respStatus = iv.candidateResponseStatus || iv.candidate_response_status || 'PENDING';
      const respNote = iv.candidateResponseNote || iv.candidate_response_note;
      if (respStatus === 'CONFIRMED') {
        respBadgeEl.innerHTML = '<span class="badge" style="background:#dcfce7;color:#15803d;padding:2px 6px;border-radius:4px;">✓ Đã xác nhận tham dự</span>';
      } else if (respStatus === 'RESCHEDULE_REQUESTED') {
        respBadgeEl.innerHTML = `<span class="badge" style="background:#fef3c7;color:#b45309;padding:2px 6px;border-radius:4px;">⏳ Đề nghị đổi lịch${respNote ? ` (${escapeHtml(respNote)})` : ''}</span>`;
      } else {
        respBadgeEl.innerHTML = '<span class="badge" style="background:#f1f5f9;color:#64748b;padding:2px 6px;border-radius:4px;">Chờ phản hồi</span>';
      }
    }
    if (idInput) idInput.value = iv.id;
    if (statusSelect) statusSelect.value = iv.status || 'SCHEDULED';
    if (scoreSelect) {
      const score = String(iv.score ?? 4);
      if (!Array.from(scoreSelect.options || []).some(option => option.value === score)) {
        const option = document.createElement('option');
        option.value = score;
        option.textContent = 'Điểm hiện tại: ' + score;
        scoreSelect.appendChild(option);
      }
      scoreSelect.value = score;
    }
    if (feedbackInput) feedbackInput.value = iv.feedback || '';
    const permissions = currentAuthenticatedUser?.permissions || [];
    const isAssigned = iv.interviewer?.id === currentAuthenticatedUser?.id;
    const evaluate = permissions.includes('interview.evaluate') &&
      (currentAuthenticatedUser?.roles?.some(role => ['ADMIN', 'HR_MANAGER'].includes(role)) || isAssigned);
    const operate = permissions.includes('interview.update');
    if (scoreSelect) scoreSelect.disabled = !evaluate;
    if (feedbackInput) feedbackInput.disabled = !evaluate;
    if (statusSelect) statusSelect.disabled = !evaluate && !operate;
    const submit = document.getElementById('submit-interview-eval-btn');
    if (submit) {
      submit.classList.toggle('hidden', !evaluate && !operate);
      submit.textContent = evaluate ? 'Lưu đánh giá' : 'Cập nhật trạng thái';
    }

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
        const canEvaluate=!document.getElementById('int-eval-feedback').disabled;
        const res = await window.ATS_API.updateInterviewStatusApi(token, id, status, canEvaluate?feedback:undefined, canEvaluate?score:undefined);
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
