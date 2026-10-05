  // --- CANDIDATE PORTAL ---
  async function loadCandidatePortal() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const candNameEl = document.getElementById('cand-portal-name');
    const candEmailEl = document.getElementById('cand-portal-email');
    const candAvatarEl = document.getElementById('cand-portal-avatar');
    const candStageBadge = document.getElementById('cand-portal-stage-badge');

    if (currentAuthenticatedUser) {
      if (candNameEl) candNameEl.textContent = currentAuthenticatedUser.fullName || 'Ứng viên';
      if (candEmailEl) candEmailEl.textContent = currentAuthenticatedUser.email;
      if (candAvatarEl) candAvatarEl.textContent = (currentAuthenticatedUser.fullName || 'U').charAt(0).toUpperCase();
    }

    try {
      const [candRes, ivRes, offRes] = await Promise.all([
        window.ATS_API.getCandidatesApi(token),
        window.ATS_API.getInterviewsApi(token),
        window.ATS_API.getOffersApi(token)
      ]);

      const candidates = (candRes.ok && candRes.data && candRes.data.candidates) ? candRes.data.candidates : [];
      const userEmail = currentAuthenticatedUser ? currentAuthenticatedUser.email.toLowerCase() : '';
      let myCand = candidates.find(c => c.email && c.email.toLowerCase() === userEmail) || candidates[0];

      if (myCand) {
        if (candNameEl) candNameEl.textContent = myCand.fullName;
        if (candStageBadge) {
          candStageBadge.className = `badge ${STAGE_BADGES[myCand.stage] || 'badge-primary'}`;
          candStageBadge.textContent = STAGE_LABELS[myCand.stage] || myCand.stage;
        }

        // Update Tracker Steps
        const stagesOrder = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
        const currentIdx = stagesOrder.indexOf(myCand.stage) !== -1 ? stagesOrder.indexOf(myCand.stage) : 0;

        const stepIds = ['portal-step-applied', 'portal-step-screening', 'portal-step-interview', 'portal-step-offer', 'portal-step-hired'];
        stepIds.forEach((sid, idx) => {
          const el = document.getElementById(sid);
          if (el) {
            if (idx <= currentIdx) {
              el.style.borderColor = 'var(--color-primary)';
              el.style.background = 'rgba(37,99,235,0.08)';
              const countEl = el.querySelector('.funnel-step-count');
              if (countEl) countEl.style.color = 'var(--color-primary)';
            }
          }
        });
      }

      // Check upcoming interview
      const interviews = (ivRes.ok && ivRes.data && ivRes.data.interviews) ? ivRes.data.interviews : [];
      const myIv = interviews.find(i => i.candidate && (i.candidate.email === userEmail || (myCand && i.candidate.id === myCand.id)));
      if (myIv) {
        const timeEl = document.getElementById('cand-portal-interview-time');
        const locEl = document.getElementById('cand-portal-interview-location');
        if (timeEl) timeEl.textContent = new Date(myIv.scheduledTime).toLocaleString('vi-VN');
        if (locEl) locEl.textContent = myIv.locationOrLink || 'Google Meet';
      }

      // Check offer
      const offers = (offRes.ok && offRes.data && offRes.data.offers) ? offRes.data.offers : [];
      const myOff = offers.find(o => o.candidate && (o.candidate.email === userEmail || (myCand && o.candidate.id === myCand.id)));
      const offerContainer = document.getElementById('cand-portal-offer-container');
      if (myOff && offerContainer) {
        offerContainer.innerHTML = `
          <div style="background: var(--color-success-bg); border: 1px solid var(--color-success-border); border-radius: var(--radius-sm); padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="color: var(--color-success-text); font-size: 1.05rem;">Chúc mừng! Bạn đã nhận được Thư Mời Nhận Việc (Offer)</strong>
              <span class="badge ${myOff.status === 'APPROVED' ? 'badge-success' : 'badge-primary'}">${myOff.status}</span>
            </div>
            <div style="margin-top: 10px; font-size: 1.15rem; font-weight: 700; color: var(--color-success);">
              Mức lương: ${Number(myOff.salaryMonthly).toLocaleString('vi-VN')} đ/tháng
            </div>
            <div style="color: var(--color-text-secondary); margin-top: 4px; font-size: 0.85rem;">
              Ngày bắt đầu dự kiến: <strong>${myOff.startDate ? new Date(myOff.startDate).toLocaleDateString('vi-VN') : 'Thỏa thuận'}</strong>
            </div>
          </div>
        `;
      }
    } catch (e) {
      console.error('Failed to load candidate portal:', e);
    }
  }
