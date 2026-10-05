  // Quick jump buttons from Dashboard
  const btnGotoRequisitions = document.getElementById('btn-goto-requisitions');
  if (btnGotoRequisitions) {
    btnGotoRequisitions.addEventListener('click', () => switchView('requisitions'));
  }

  const btnGotoInterviews = document.getElementById('btn-goto-interviews');
  if (btnGotoInterviews) {
    btnGotoInterviews.addEventListener('click', () => switchView('interviews'));
  }

  const dashboardRefreshBtn = document.getElementById('dashboard-refresh-btn');
  if (dashboardRefreshBtn) {
    dashboardRefreshBtn.addEventListener('click', () => {
      loadDashboardData();
      showToast('info', 'Dữ liệu', 'Đã cập nhật số liệu tổng quan mới nhất.');
    });
  }

  // ==============================================================================
  // 6. DASHBOARD DATA LOADING (REAL BACKEND API)
  // ==============================================================================

  async function loadDashboardData() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getDashboardStats(token);
      if (res.ok && res.data && res.data.success) {
        const stats = res.data.stats || res.data.data || {};

        // KPI Counts
        const openReqs = stats.openRequisitions || (stats.requisitions ? stats.requisitions.open : 0) || 0;
        const totalCandidates = stats.totalCandidates || (stats.candidates ? stats.candidates.total : 0) || 0;
        const upcomingInterviews = stats.upcomingInterviewsCount || (typeof stats.upcomingInterviews === 'number' ? stats.upcomingInterviews : (Array.isArray(stats.upcomingInterviews) ? stats.upcomingInterviews.length : 0)) || 0;
        const handoverAlerts = stats.handoverAlertsCount || (stats.requisitions ? stats.requisitions.handoverAlerts : 0) || 0;
        const totalHeadcount = stats.totalHeadcount || (stats.requisitions ? stats.requisitions.totalHeadcount : 0) || 0;

        const openReqsEl = document.getElementById('kpi-open-reqs');
        const totalCandidatesEl = document.getElementById('kpi-total-candidates');
        const upcomingInterviewsEl = document.getElementById('kpi-upcoming-interviews');
        const handoverAlertsEl = document.getElementById('kpi-handover-alerts');
        const headcountEl = document.getElementById('kpi-headcount-display');

        if (openReqsEl) openReqsEl.textContent = openReqs;
        if (totalCandidatesEl) totalCandidatesEl.textContent = totalCandidates;
        if (upcomingInterviewsEl) upcomingInterviewsEl.textContent = upcomingInterviews;
        if (handoverAlertsEl) handoverAlertsEl.textContent = handoverAlerts;
        if (headcountEl) headcountEl.textContent = totalHeadcount;

        // Sidebar Badges
        const sidebarReqsBadge = document.getElementById('sidebar-badge-reqs');
        const sidebarCandidatesBadge = document.getElementById('sidebar-badge-candidates');
        const sidebarInterviewsBadge = document.getElementById('sidebar-badge-interviews');

        if (sidebarReqsBadge) sidebarReqsBadge.textContent = openReqs;
        if (sidebarCandidatesBadge) sidebarCandidatesBadge.textContent = totalCandidates;
        if (sidebarInterviewsBadge) sidebarInterviewsBadge.textContent = upcomingInterviews;

        // Funnel Numbers
        const funnel = stats.candidateFunnel || stats.candidates || {};
        const fApplied = document.getElementById('funnel-applied');
        const fScreening = document.getElementById('funnel-screening');
        const fInterview = document.getElementById('funnel-interview');
        const fOffer = document.getElementById('funnel-offer');
        const fHired = document.getElementById('funnel-hired');

        if (fApplied) fApplied.textContent = funnel.APPLIED || funnel.new || 0;
        if (fScreening) fScreening.textContent = funnel.SCREENING || funnel.screening || 0;
        if (fInterview) fInterview.textContent = funnel.INTERVIEW || funnel.interview || 0;
        if (fOffer) fOffer.textContent = funnel.OFFER || funnel.offer || 0;
        if (fHired) fHired.textContent = funnel.HIRED || funnel.hired || 0;

        // Recent Requisitions Table
        const recentReqsBody = document.getElementById('dashboard-recent-reqs-body');
        if (recentReqsBody) {
          const reqs = stats.recentRequisitions || [];
          if (reqs.length === 0) {
            recentReqsBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 20px;">Chưa có vị trí tuyển dụng nào.</td></tr>`;
          } else {
            recentReqsBody.innerHTML = reqs.map(r => {
              const statusBadge = r.status === 'OPEN' ? 'badge-primary' : (r.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral');
              const statusText = r.status === 'OPEN' ? 'Đang mở' : (r.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng');
              const deptName = r.department || r.department_name || r.departmentName || '';
              return `
                <tr>
                  <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${r.code}</code></td>
                  <td><strong>${r.title}</strong></td>
                  <td>${deptName}</td>
                  <td style="text-align: center; font-weight: 600;">${r.headcount}</td>
                  <td><span class="badge ${statusBadge}">${statusText}</span></td>
                </tr>
              `;
            }).join('');
          }
        }

        // Upcoming Interviews List / Recent Activities
        const interviewsList = document.getElementById('dashboard-upcoming-interviews-list');
        if (interviewsList) {
          const interviews = Array.isArray(stats.upcomingInterviews) ? stats.upcomingInterviews : (stats.recentActivities || []);
          if (interviews.length === 0) {
            interviewsList.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không có lịch phỏng vấn nào sắp tới.</div>`;
          } else {
            interviewsList.innerHTML = interviews.map(item => {
              const candName = item.candidate_name || item.candidateName || item.title || 'Ứng viên';
              const reqTitle = item.requisition_title || item.meta || '';
              const interviewer = item.interviewer_name || '';
              const schedTime = item.scheduled_at || item.timestamp || new Date().toISOString();

              return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-border-subtle);">
                  <div>
                    <div style="font-weight: 600; color: var(--color-text); font-size: 0.85rem;">${candName}</div>
                    <div style="font-size: 0.775rem; color: var(--color-text-muted);">${reqTitle} ${interviewer ? '· PV: ' + interviewer : ''}</div>
                  </div>
                  <div style="text-align: right;">
                    <span class="badge badge-warning font-mono" style="font-size: 0.725rem;">${new Date(schedTime).toLocaleDateString('vi-VN')}</span>
                    <div style="font-size: 0.725rem; color: var(--color-text-muted); margin-top: 2px;">${new Date(schedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              `;
            }).join('');
          }
        }

        // Department Breakdown
        const deptBreakdownContainer = document.getElementById('dashboard-dept-breakdown-container');
        if (deptBreakdownContainer) {
          const depts = stats.departmentBreakdown || [];
          if (depts.length === 0) {
            deptBreakdownContainer.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); padding: 20px;">Chưa có dữ liệu phòng ban.</div>`;
          } else {
            deptBreakdownContainer.innerHTML = `
              <div style="display: flex; flex-direction: column; gap: 12px;">
                ${depts.map(d => {
                  const dName = d.department || d.department_name || d.departmentName || '';
                  const reqCount = d.req_count || d.count || 0;
                  const totalHc = d.total_headcount || d.totalHeadcount || reqCount;
                  return `
                    <div>
                      <div style="display: flex; justify-content: space-between; font-size: 0.825rem; margin-bottom: 4px;">
                        <strong>${dName}</strong>
                        <span style="color: var(--color-text-secondary);">${reqCount} vị trí · ${totalHc} chỉ tiêu</span>
                      </div>
                      <div style="height: 6px; background: var(--color-bg-subtle); border-radius: var(--radius-full); overflow: hidden;">
                        <div style="height: 100%; width: ${Math.min(100, totalHc * 15)}%; background: var(--color-primary); border-radius: var(--radius-full);"></div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }
        }

      }
    } catch (e) {
      console.warn('Dashboard data fetch error:', e);
    }
  }
