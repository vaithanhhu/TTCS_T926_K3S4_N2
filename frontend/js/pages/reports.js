  // ==============================================================================
  // 11. REPORTS & ANALYTICS (REAL BACKEND API)
  // ==============================================================================

  async function loadReports() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getRecruitmentReportsApi(token);
      if (res.ok && res.data && res.data.success) {
        const report = res.data.report || res.data.data || {};
        const kpis = report.kpis || {};

        const timeToHireEl = document.getElementById('report-time-to-hire');
        const offerAcceptanceEl = document.getElementById('report-offer-acceptance');
        const fillRateEl = document.getElementById('report-fill-rate');
        const newCandidatesEl = document.getElementById('report-new-candidates');

        if (timeToHireEl) timeToHireEl.textContent = kpis.avgTimeToHireDays == null ? '—' : `${kpis.avgTimeToHireDays} ngày`;
        if (offerAcceptanceEl) offerAcceptanceEl.textContent = kpis.offerAcceptanceRate == null ? '—' : `${kpis.offerAcceptanceRate}%`;
        if (fillRateEl) fillRateEl.textContent = kpis.fillRatePercent == null ? '—' : `${kpis.fillRatePercent}%`;
        if (newCandidatesEl) newCandidatesEl.textContent = `${kpis.newCandidatesThisMonth ?? 0}`;

        const funnelBody = document.getElementById('report-funnel-body');
        if (funnelBody) funnelBody.innerHTML = (report.pipelineFunnel || []).map(row => `<tr><td>${escapeHtml(row.stage)}</td><td>${Number(row.count) || 0}</td><td>${row.percent == null ? '—' : Number(row.percent) + '%'}</td><td>${row.conversionFromPrevious == null ? '—' : Number(row.conversionFromPrevious) + '%'}</td></tr>`).join('');
        const sourceBody = document.getElementById('report-source-body');
        if (sourceBody) sourceBody.innerHTML = (report.sourceEffectiveness || []).map(row => `<tr><td>${escapeHtml(row.source)}</td><td>${Number(row.applications) || 0}</td><td>${Number(row.hired) || 0}</td><td>${row.hiredPercent == null ? '—' : Number(row.hiredPercent) + '%'}</td></tr>`).join('');
        const rejectionBody = document.getElementById('report-rejection-body');
        if (rejectionBody) rejectionBody.innerHTML = (report.rejectionReasons || []).map(row => `<tr><td>${escapeHtml(row.reason)}</td><td>${Number(row.count) || 0}</td></tr>`).join('');

        // Department Table
        const deptTableBody = document.getElementById('report-dept-table-body');
        if (deptTableBody) {
          const depts = report.departmentPerformance || report.department_performance || [];
          deptTableBody.innerHTML = depts.map(d => {
            const dName = d.department || d.department_name || d.departmentName || '';
            const totalPos = d.total_positions || d.totalPositions || 0;
            const totalHc = d.total_headcount || d.totalHeadcount || 0;
            const totalCands = d.total_candidates || d.totalCandidates || 0;
            const hiredCount = d.hired_count || d.hiredCount || 0;
            const completionRate = d.completion_rate || d.completionRate || 0;

            return `
              <tr>
                <td><strong>${escapeHtml(dName)}</strong></td>
                <td style="text-align: center;">${totalPos}</td>
                <td style="text-align: center; font-weight: 600;">${totalHc}</td>
                <td style="text-align: center;">${totalCands}</td>
                <td style="text-align: center; color: var(--color-success); font-weight: 600;">${hiredCount}</td>
                <td style="text-align: center;">
                  <span class="badge ${completionRate >= 80 ? 'badge-success' : 'badge-warning'} font-mono">${completionRate}%</span>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    }
  }

  const reportsExportBtn = document.getElementById('reports-export-btn');
  if (reportsExportBtn) {
    reportsExportBtn.addEventListener('click', () => {
      const rows = [];
      const trs = document.querySelectorAll('#report-dept-table-body tr');
      trs.forEach(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        if (tds.length >= 6) rows.push(tds);
      });
      if (rows.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Chưa có dữ liệu báo cáo để xuất.');
        return;
      }
      exportTableToCsv('bao_cao_hieu_qua_tuyen_dung.csv', ['Phòng ban', 'Vị trí', 'Chỉ tiêu', 'Hồ sơ', 'Hoàn thành', 'Tỷ lệ đạt'], rows);
    });
  }
