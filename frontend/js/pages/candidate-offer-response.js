(function () {
  function initCandidateOfferResponsePage() {
    const loadingEl = document.getElementById('offer-loading');
    const errorEl = document.getElementById('offer-error');
    const errorMsgEl = document.getElementById('offer-error-msg');
    const successEl = document.getElementById('offer-success');
    const successTitleEl = document.getElementById('offer-success-title');
    const successMsgEl = document.getElementById('offer-success-msg');
    const contentEl = document.getElementById('offer-content');
    const statusBannerEl = document.getElementById('offer-status-banner');
    const actionsPanelEl = document.getElementById('offer-actions-panel');
    const commentInput = document.getElementById('cand-offer-comment-input');
    const btnAccept = document.getElementById('btn-accept-offer');
    const btnReject = document.getElementById('btn-reject-offer');

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (errorEl) {
        errorEl.classList.remove('hidden');
        if (errorMsgEl) errorMsgEl.textContent = 'Liên kết không hợp lệ hoặc thiếu mã token xác thực.';
      }
      return;
    }

    async function loadOffer() {
      try {
        const getFn = window.ATS_API?.getPublicOfferApi;
        if (!getFn) {
          throw new Error('API client chưa sẵn sàng.');
        }

        const res = await getFn(token);
        if (loadingEl) loadingEl.classList.add('hidden');

        if (!res.ok || !res.data || !res.data.success) {
          if (errorEl) {
            errorEl.classList.remove('hidden');
            if (errorMsgEl) errorMsgEl.textContent = res.data?.message || 'Không tìm thấy thông tin thư mời nhận việc hoặc liên kết đã hết hạn.';
          }
          return;
        }

        const off = res.data.data;
        if (contentEl) contentEl.classList.remove('hidden');

        const greetingEl = document.getElementById('cand-offer-greeting');
        const jobTitleEl = document.getElementById('cand-offer-job-title');
        const deptEl = document.getElementById('cand-offer-dept');
        const salaryEl = document.getElementById('cand-offer-salary');
        const allowancesEl = document.getElementById('cand-offer-allowances');
        const startDateEl = document.getElementById('cand-offer-start-date');
        const expDateEl = document.getElementById('cand-offer-expiration-date');
        const statusBadgeEl = document.getElementById('cand-offer-status-badge');
        const letterEl = document.getElementById('cand-offer-letter-content');

        if (greetingEl) greetingEl.textContent = `Kính gửi ${off.candidateName || 'Ứng viên'},`;
        if (jobTitleEl) jobTitleEl.textContent = off.jobTitleName || 'Vị trí công việc';
        if (deptEl) deptEl.textContent = off.departmentName || 'Công ty';
        if (salaryEl) salaryEl.textContent = off.salaryMonthly ? Number(off.salaryMonthly).toLocaleString('vi-VN') + ' đ / tháng' : 'Thỏa thuận';
        if (allowancesEl) allowancesEl.textContent = off.allowances ? Number(off.allowances).toLocaleString('vi-VN') + ' đ / tháng' : 'Không có';
        if (startDateEl) startDateEl.textContent = off.startDate ? new Date(off.startDate).toLocaleDateString('vi-VN') : 'Thỏa thuận';
        if (expDateEl) expDateEl.textContent = off.expirationDate ? new Date(off.expirationDate).toLocaleDateString('vi-VN') : 'Không quy định';
        if (letterEl) letterEl.textContent = off.offerLetter || 'Nội dung thư mời việc làm đang được cập nhật.';

        if (statusBadgeEl) {
          if (off.status === 'ACCEPTED') {
            statusBadgeEl.className = 'badge badge-success';
            statusBadgeEl.textContent = 'Đã chấp nhận';
          } else if (off.status === 'REJECTED') {
            statusBadgeEl.className = 'badge badge-danger';
            statusBadgeEl.textContent = 'Đã từ chối';
          } else if (off.status === 'EXPIRED' || off.isExpired) {
            statusBadgeEl.className = 'badge badge-neutral';
            statusBadgeEl.textContent = 'Đã hết hạn';
          } else {
            statusBadgeEl.className = 'badge badge-primary';
            statusBadgeEl.textContent = 'Chờ phản hồi';
          }
        }

        if (off.isExpired || off.status === 'EXPIRED') {
          if (actionsPanelEl) actionsPanelEl.classList.add('hidden');
          if (statusBannerEl) {
            statusBannerEl.classList.remove('hidden');
            statusBannerEl.style.background = '#fef2f2';
            statusBannerEl.style.border = '1px solid #fecaca';
            statusBannerEl.style.color = '#991b1b';
            statusBannerEl.textContent = 'Thời hạn phản hồi thư mời nhận việc này đã kết thúc.';
          }
        } else if (off.isResponded || ['ACCEPTED', 'REJECTED'].includes(off.status)) {
          if (actionsPanelEl) actionsPanelEl.classList.add('hidden');
          if (statusBannerEl) {
            statusBannerEl.classList.remove('hidden');
            const isAccepted = off.status === 'ACCEPTED' || off.candidateResponse === 'ACCEPTED';
            statusBannerEl.style.background = isAccepted ? '#f0fdf4' : '#fef2f2';
            statusBannerEl.style.border = isAccepted ? '1px solid #bbf7d0' : '1px solid #fecaca';
            statusBannerEl.style.color = isAccepted ? '#166534' : '#991b1b';
            const actionText = isAccepted ? 'chấp nhận' : 'từ chối';
            const timeText = off.respondedAt ? ` vào lúc ${new Date(off.respondedAt).toLocaleString('vi-VN')}` : '';
            statusBannerEl.textContent = `Bạn đã ${actionText} đề nghị này${timeText}.`;
          }
        }
      } catch (err) {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (errorEl) {
          errorEl.classList.remove('hidden');
          if (errorMsgEl) errorMsgEl.textContent = err.message || 'Lỗi khi tải thông tin thư mời.';
        }
      }
    }

    async function submitResponse(decision) {
      const comment = commentInput ? commentInput.value.trim() : '';
      if (btnAccept) btnAccept.disabled = true;
      if (btnReject) btnReject.disabled = true;

      try {
        const respondFn = window.ATS_API?.respondPublicOfferApi;
        if (!respondFn) throw new Error('API client chưa sẵn sàng.');

        const res = await respondFn(token, { decision, comment });
        if (!res.ok || !res.data || !res.data.success) {
          alert(res.data?.message || 'Không thể gửi phản hồi. Vui lòng thử lại sau.');
          if (btnAccept) btnAccept.disabled = false;
          if (btnReject) btnReject.disabled = false;
          return;
        }

        if (actionsPanelEl) actionsPanelEl.classList.add('hidden');
        if (successEl) {
          successEl.classList.remove('hidden');
          if (successTitleEl) {
            successTitleEl.textContent = decision === 'ACCEPTED'
              ? '✓ Bạn đã chấp nhận Thư mời nhận việc!'
              : '✓ Đã ghi nhận phản hồi từ chối Thư mời nhận việc';
          }
          if (successMsgEl) {
            successMsgEl.textContent = res.data.message || 'Cảm ơn bạn đã phản hồi. Bộ phận Tuyển dụng sẽ sớm liên hệ với bạn.';
          }
        }

        const statusBadgeEl = document.getElementById('cand-offer-status-badge');
        if (statusBadgeEl) {
          statusBadgeEl.className = decision === 'ACCEPTED' ? 'badge badge-success' : 'badge badge-danger';
          statusBadgeEl.textContent = decision === 'ACCEPTED' ? 'Đã chấp nhận' : 'Đã từ chối';
        }
      } catch (err) {
        alert(err.message || 'Lỗi khi gửi phản hồi.');
        if (btnAccept) btnAccept.disabled = false;
        if (btnReject) btnReject.disabled = false;
      }
    }

    if (btnAccept) {
      btnAccept.addEventListener('click', () => {
        if (confirm('Bạn có chắc chắn muốn CHẤP NHẬN thư mời nhận việc này?')) {
          submitResponse('ACCEPTED');
        }
      });
    }

    if (btnReject) {
      btnReject.addEventListener('click', () => {
        if (confirm('Bạn có chắc chắn muốn TỪ CHỐI thư mời nhận việc này?')) {
          submitResponse('REJECTED');
        }
      });
    }

    loadOffer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCandidateOfferResponsePage);
  } else {
    initCandidateOfferResponsePage();
  }
})();
