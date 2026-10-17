(function () {
  function initCandidateInterviewResponse() {
    const view = document.getElementById('candidate-interview-response-view');
    if (!view) return;

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    const loadingEl = document.getElementById('invitation-loading');
    const errorEl = document.getElementById('invitation-error');
    const errorMsgEl = document.getElementById('invitation-error-msg');
    const successEl = document.getElementById('invitation-success');
    const successMsgEl = document.getElementById('invitation-success-msg');
    const contentEl = document.getElementById('invitation-content');

    const posEl = document.getElementById('inv-position');
    const roundEl = document.getElementById('inv-round');
    const timeEl = document.getElementById('inv-time');
    const durationEl = document.getElementById('inv-duration');
    const formatEl = document.getElementById('inv-format');
    const locationEl = document.getElementById('inv-location');
    const instructionsEl = document.getElementById('inv-instructions');
    const greetingEl = document.getElementById('cand-greeting');
    const statusDisplayEl = document.getElementById('invitation-status-display');
    const actionsContainer = document.getElementById('invitation-actions');

    const btnConfirm = document.getElementById('btn-confirm-interview');
    const btnToggleReschedule = document.getElementById('btn-toggle-reschedule');
    const rescheduleContainer = document.getElementById('reschedule-form-container');
    const rescheduleNote = document.getElementById('reschedule-note');
    const btnCancelReschedule = document.getElementById('btn-cancel-reschedule');
    const btnSubmitReschedule = document.getElementById('btn-submit-reschedule');

    if (!token) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (errorEl) {
        errorEl.classList.remove('hidden');
        if (errorMsgEl) errorMsgEl.textContent = 'Thiếu mã token xác thực lời mời phỏng vấn.';
      }
      return;
    }

    function formatDateTime(dateStr) {
      return new Date(dateStr).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function showError(message) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.classList.add('hidden');
      if (errorEl) {
        errorEl.classList.remove('hidden');
        if (errorMsgEl) errorMsgEl.textContent = message;
      }
    }

    function showStatus(status, note) {
      if (!statusDisplayEl) return;
      statusDisplayEl.classList.remove('hidden');
      if (status === 'CONFIRMED') {
        statusDisplayEl.style.background = '#dcfce7';
        statusDisplayEl.style.color = '#15803d';
        statusDisplayEl.style.border = '1px solid #bbf7d0';
        statusDisplayEl.innerHTML = '✓ Bạn đã xác nhận tham dự buổi phỏng vấn này.';
      } else if (status === 'RESCHEDULE_REQUESTED') {
        statusDisplayEl.style.background = '#fef3c7';
        statusDisplayEl.style.color = '#b45309';
        statusDisplayEl.style.border = '1px solid #fde68a';
        statusDisplayEl.innerHTML = `⏳ Bạn đã gửi đề nghị đổi lịch phỏng vấn.${note ? `<br><small style="font-weight: normal; margin-top: 4px; display: block;">Ghi chú: ${escapeHtml(note)}</small>` : ''}`;
      }
      if (actionsContainer) actionsContainer.classList.add('hidden');
    }

    fetch(`/api/v1/interviews/public/invitation?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(res => {
        if (!res.success) {
          showError(res.message || 'Liên kết không hợp lệ hoặc đã hết hạn.');
          return;
        }

        const data = res.interview;
        if (loadingEl) loadingEl.classList.add('hidden');
        if (contentEl) contentEl.classList.remove('hidden');

        if (greetingEl) greetingEl.textContent = `Xin chào ${data.candidateName || 'Ứng viên'},`;
        if (posEl) posEl.textContent = data.requisitionTitle || 'Vị trí tuyển dụng';
        if (roundEl) roundEl.textContent = data.roundName || 'Phỏng vấn chuyên môn';
        if (timeEl) timeEl.textContent = formatDateTime(data.scheduledTime);
        if (durationEl) durationEl.textContent = `${data.durationMinutes || 60} phút`;
        if (formatEl) formatEl.textContent = data.interviewFormat === 'ONLINE' ? '💻 Phỏng vấn trực tuyến' : '🏢 Phỏng vấn trực tiếp';

        if (locationEl) {
          if (data.interviewFormat === 'ONLINE' && data.meetingLink) {
            locationEl.innerHTML = `<a href="${escapeHtml(data.meetingLink)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">${escapeHtml(data.meetingLink)}</a>`;
          } else {
            locationEl.textContent = data.meetingRoom || data.locationOrLink || 'Văn phòng tuyển dụng';
          }
        }

        if (instructionsEl) instructionsEl.textContent = data.instructions;

        if (data.responseStatus && data.responseStatus !== 'PENDING') {
          showStatus(data.responseStatus, data.responseNote);
        }
      })
      .catch(() => {
        showError('Không thể kết nối đến máy chủ. Vui lòng thử lại sau.');
      });

    if (btnToggleReschedule) {
      btnToggleReschedule.addEventListener('click', () => {
        if (rescheduleContainer) rescheduleContainer.classList.remove('hidden');
      });
    }

    if (btnCancelReschedule) {
      btnCancelReschedule.addEventListener('click', () => {
        if (rescheduleContainer) rescheduleContainer.classList.add('hidden');
      });
    }

    function sendResponse(action, note) {
      if (actionsContainer) actionsContainer.style.opacity = '0.5';
      if (btnConfirm) btnConfirm.disabled = true;
      if (btnSubmitReschedule) btnSubmitReschedule.disabled = true;

      fetch('/api/v1/interviews/public/invitation/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action, note })
      })
        .then(res => res.json())
        .then(res => {
          if (!res.success) {
            alert(res.message || 'Không thể gửi phản hồi. Vui lòng thử lại.');
            if (actionsContainer) actionsContainer.style.opacity = '1';
            if (btnConfirm) btnConfirm.disabled = false;
            if (btnSubmitReschedule) btnSubmitReschedule.disabled = false;
            return;
          }

          if (successEl) successEl.classList.remove('hidden');
          if (successMsgEl) {
            successMsgEl.textContent = action === 'CONFIRM'
              ? 'Bạn đã xác nhận tham dự buổi phỏng vấn. Vui lòng chuẩn bị và có mặt đúng giờ.'
              : 'Yêu cầu đề nghị đổi lịch đã được gửi đến Bộ phận Tuyển dụng.';
          }
          showStatus(res.responseStatus, note);
        })
        .catch(() => {
          alert('Lỗi kết nối khi gửi phản hồi. Vui lòng thử lại.');
          if (actionsContainer) actionsContainer.style.opacity = '1';
          if (btnConfirm) btnConfirm.disabled = false;
          if (btnSubmitReschedule) btnSubmitReschedule.disabled = false;
        });
    }

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        sendResponse('CONFIRM', null);
      });
    }

    if (btnSubmitReschedule) {
      btnSubmitReschedule.addEventListener('click', () => {
        const note = rescheduleNote ? rescheduleNote.value.trim() : '';
        sendResponse('REQUEST_RESCHEDULE', note);
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCandidateInterviewResponse);
  } else {
    initCandidateInterviewResponse();
  }
})();
