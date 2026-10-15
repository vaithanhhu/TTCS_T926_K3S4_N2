  // ==============================================================================
  // 8. CANDIDATES MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const candidatesSearchInput = document.getElementById('candidates-search-input');
  const candidatesStageFilter = document.getElementById('candidates-stage-filter');
  const candidatesReqFilter = document.getElementById('candidates-req-filter');
  const candidatesExportBtn = document.getElementById('candidates-export-btn');
  const candidatesRefreshBtn = document.getElementById('candidates-refresh-btn');
  const candidatesTableBody = document.getElementById('candidates-table-body');
  const candidatesTotalBadge = document.getElementById('candidates-total-badge');

  const candidatesKanban = document.getElementById('candidates-kanban');
  const candidatesViewTableBtn = document.getElementById('candidates-view-table-btn');
  const candidatesViewKanbanBtn = document.getElementById('candidates-view-kanban-btn');

  const CANDIDATE_KANBAN_STAGES = [
    { key: 'NEW', label: 'Mới tiếp nhận' },
    { key: 'APPLIED', label: 'Ứng tuyển' },
    { key: 'SCREENING', label: 'Sơ loại' },
    { key: 'INTERVIEW', label: 'Phỏng vấn' },
    { key: 'OFFER', label: 'Đề nghị (Offer)' },
    { key: 'HIRED', label: 'Đã nhận việc' },
    { key: 'REJECTED', label: 'Từ chối' }
  ];

  function escapeKanbanHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function setCandidatesView(view) {
    const tableWrapper = document.querySelector('.table-wrapper');
    const showKanban = view === 'kanban';

    if (tableWrapper) tableWrapper.classList.toggle('hidden', showKanban);
    if (candidatesKanban) candidatesKanban.classList.toggle('hidden', !showKanban);

    if (candidatesViewTableBtn) {
      candidatesViewTableBtn.classList.toggle('btn-primary', !showKanban);
      candidatesViewTableBtn.classList.toggle('btn-outline', showKanban);
    }
    if (candidatesViewKanbanBtn) {
      candidatesViewKanbanBtn.classList.toggle('btn-primary', showKanban);
      candidatesViewKanbanBtn.classList.toggle('btn-outline', !showKanban);
    }
  }

  function renderCandidatesKanban(list) {
    if (!candidatesKanban) return;

    const grouped = {};
    CANDIDATE_KANBAN_STAGES.forEach(stage => grouped[stage.key] = []);

    (list || []).forEach(candidate => {
      const stage = String(candidate.stage || 'APPLIED').toUpperCase();
      if (grouped[stage]) grouped[stage].push(candidate);
    });

    candidatesKanban.style.cssText =
      'display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding:8px 2px 16px;';

    candidatesKanban.innerHTML = CANDIDATE_KANBAN_STAGES.map(stage => {
      const cards = grouped[stage.key].map(candidate => {
        const id = escapeKanbanHtml(candidate.id || '');
        const name = escapeKanbanHtml(candidate.fullName || candidate.full_name || 'Ứng viên');
        const email = escapeKanbanHtml(candidate.email || '');
        const phone = escapeKanbanHtml(candidate.phoneNumber || candidate.phone || '');
        const reqTitle = escapeKanbanHtml(
          candidate.requisition?.title || candidate.requisition_title || 'Chưa gắn vị trí'
        );
        const code = escapeKanbanHtml(formatCandCode(candidate));

        return `
          <article class="candidate-kanban-card"
            draggable="${id ? 'true' : 'false'}"
            data-candidate-id="${id}"
            style="background:var(--color-surface, #fff);border:1px solid var(--color-border, #ddd);border-radius:8px;padding:12px;margin-bottom:10px;cursor:${id ? 'grab' : 'default'};box-shadow:0 1px 3px #0000000d;">
            <div style="font-weight:600;margin-bottom:6px;">${name}</div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px;">${code}</div>
            <div style="font-size:13px;overflow-wrap:anywhere;">${email}</div>
            <div style="font-size:12px;margin-top:4px;">${phone}</div>
            <div style="font-size:12px;margin-top:8px;color:var(--color-text-muted);">${reqTitle}</div>
          </article>`;
      }).join('');

      return `
        <section class="candidate-kanban-column"
          data-kanban-stage="${stage.key}"
          style="flex:0 0 220px;min-width:220px;background:var(--color-bg-secondary, #f5f6f8);border:1px solid var(--color-border, #ddd);border-radius:10px;padding:10px;min-height:180px;">
          <div style="font-weight:700;margin-bottom:12px;">
            ${stage.label}
            <span style="font-weight:400;color:var(--color-text-muted);">(${grouped[stage.key].length})</span>
          </div>
          <div>${cards || '<div style="font-size:12px;color:var(--color-text-muted);padding:12px 4px;">Chưa có ứng viên</div>'}</div>
        </section>`;
    }).join('');
  }

  function formatCandCode(c) {
    if (c?.status && !c.stage) return '—';
    if (!c) return 'CAND-001';
    if (c.code) return c.code;
    if (c.id) {
      if (c.id.startsWith('cand-0')) return 'CAND-' + c.id.replace('cand-', '');
      const raw = c.id.replace(/^cand-/, '');
      return 'CAND-' + (raw.length <= 4 ? raw.toUpperCase() : raw.substring(0, 4).toUpperCase());
    }
    return 'CAND-001';
  }

  async function loadCandidates() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    // Populate requisition filter dropdown if empty
    if (candidatesReqFilter && candidatesReqFilter.children.length <= 1 && currentRequisitionsList.length > 0) {
      candidatesReqFilter.innerHTML = `<option value="ALL">Tất cả vị trí ứng tuyển</option>` +
        currentRequisitionsList.map(r => `<option value="${r.title}">${r.code} - ${r.title}</option>`).join('');
    }

    const search = candidatesSearchInput ? candidatesSearchInput.value.trim().toLowerCase() : '';
    const stage = candidatesStageFilter ? candidatesStageFilter.value : 'ALL';
    const reqFilter = candidatesReqFilter ? candidatesReqFilter.value : 'ALL';

    if (candidatesTableBody) {
      candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách ứng viên...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getCandidatesApi(token, { search, stage });
      if (res.ok && res.data && res.data.success) {
        let list = res.data.candidates || res.data.data || [];

        // Apply requisition filter if selected
        if (reqFilter && reqFilter !== 'ALL') {
          list = list.filter(c => {
            const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || '');
            return reqTitle.toLowerCase().includes(reqFilter.toLowerCase());
          });
        }

        currentCandidatesList = list;
        if (candidatesTotalBadge) {
          candidatesTotalBadge.textContent = `${list.length} ứng viên`;
        }

        if (list.length === 0) {
          renderCandidatesKanban(list);
          candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy hồ sơ ứng viên phù hợp.</td></tr>`;
          return;
        }

        candidatesTableBody.innerHTML = list.map(c => {
          const badgeClass = STAGE_BADGES[c.stage] || 'badge-neutral';
          const stageName = c.statusLabel || STAGE_LABELS[c.stage] || c.stage || '—';
          const stars = c.status && !c.stage ? '—' : '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));
          const name = c.fullName || c.full_name || 'Ứng viên';
          const phone = c.phoneNumber || c.phone || '';
          const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
          const code = formatCandCode(c);
          const appliedDate = c.createdAt || c.created_at || c.applied_at;

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${code}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${name}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); font-family: monospace;">Mã: ${code}</div>
              </td>
              <td>${reqTitle}</td>
              <td>
                <div style="font-size: 0.8rem; color: var(--color-text);">${c.email}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">${phone}</div>
              </td>
              <td><span class="badge ${badgeClass}">${stageName}</span></td>
              <td>${appliedDate ? new Date(appliedDate).toLocaleDateString('vi-VN') : '—'}</td>
              <td style="color: #f59e0b; font-size: 0.85rem;">${stars}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewCandidateDetails('${c.id}')">
                  Chi tiết
                </button>
              </td>
            </tr>
          `;
        }).join('');
        renderCandidatesKanban(list);
      }
    } catch (e) {
      console.error('Failed to load candidates:', e);
    }
  }

  if (candidatesExportBtn) {
    candidatesExportBtn.addEventListener('click', () => {
      if (!currentCandidatesList || currentCandidatesList.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Không có dữ liệu ứng viên để xuất.');
        return;
      }
      const headers = ['Mã UV', 'Họ và tên', 'Vị trí ứng tuyển', 'Email', 'Điện thoại', 'Giai đoạn', 'Ngày nộp', 'Đánh giá'];
      const rows = currentCandidatesList.map(c => [
        formatCandCode(c),
        c.fullName || c.full_name || '',
        (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || ''),
        c.email || '',
        c.phoneNumber || c.phone || '',
        c.statusLabel || STAGE_LABELS[c.stage] || c.stage || '—',
        (c.createdAt || c.created_at) ? new Date(c.createdAt || c.created_at).toLocaleDateString('vi-VN') : '',
        c.status && !c.stage ? '—' : (c.rating || 4) + ' sao'
      ]);
      exportTableToCsv('danh_sach_ung_vien.csv', headers, rows);
    });
  }

  if (candidatesRefreshBtn) candidatesRefreshBtn.addEventListener('click', loadCandidates);
  if (candidatesViewTableBtn) {
    candidatesViewTableBtn.addEventListener('click', () => setCandidatesView('table'));
  }
  if (candidatesViewKanbanBtn) {
    candidatesViewKanbanBtn.addEventListener('click', () => setCandidatesView('kanban'));
  }

  if (candidatesKanban) {
    candidatesKanban.addEventListener('dragstart', event => {
      const card = event.target.closest('[data-candidate-id]');
      if (!card || !card.dataset.candidateId) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData('text/plain', card.dataset.candidateId);
      event.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '0.5';
    });

    candidatesKanban.addEventListener('dragend', event => {
      const card = event.target.closest('[data-candidate-id]');
      if (card) card.style.opacity = '1';
    });

    candidatesKanban.addEventListener('dragover', event => {
      const column = event.target.closest('[data-kanban-stage]');
      if (column) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }
    });

    candidatesKanban.addEventListener('drop', async event => {
      const column = event.target.closest('[data-kanban-stage]');
      if (!column) return;

      event.preventDefault();
      const candidateId = event.dataTransfer.getData('text/plain');
      const newStage = column.dataset.kanbanStage;
      const candidate = currentCandidatesList.find(c => String(c.id) === candidateId);

      if (!candidate || !candidateId ||
          String(candidate.stage || 'APPLIED').toUpperCase() === newStage) return;

      const token = sessionStorage.getItem('ats_token');
      const oldStage = candidate.stage || 'APPLIED';

      try {
        const result = await window.ATS_API.updateCandidateStageApi(
          token, candidateId, newStage
        );

        if (result.ok && result.data && result.data.success) {
          showToast('success', 'Cập nhật thành công', 'Đã chuyển giai đoạn ứng viên.');
          await loadCandidates();
        } else {
          showToast(
            'error',
            'Không thể chuyển giai đoạn',
            (result.data && result.data.message) || 'Vui lòng kiểm tra quyền hoặc dữ liệu bắt buộc.'
          );
          await loadCandidates();
        }
      } catch (error) {
        console.error('Failed to update candidate stage:', error);
        showToast('error', 'Lỗi cập nhật', 'Không thể cập nhật giai đoạn ứng viên.');
        await loadCandidates();
      }
    });
  }

  setCandidatesView('table');
  if (candidatesStageFilter) candidatesStageFilter.addEventListener('change', loadCandidates);
  if (candidatesReqFilter) candidatesReqFilter.addEventListener('change', loadCandidates);
  if (candidatesSearchInput) {
    candidatesSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadCandidates();
    });
  }

  // S4-07: Internal Candidate Referral Handling
  const openReferralBtn = document.getElementById('open-referral-modal-btn');
  const referralModal = document.getElementById('referral-modal');
  const closeReferralBtn = document.getElementById('close-referral-modal');
  const cancelReferralBtn = document.getElementById('btn-cancel-referral');
  const referralForm = document.getElementById('referral-form');

  if (openReferralBtn && referralModal) {
    openReferralBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const reqSelect = document.getElementById('referral-req-select');
      const alert = document.getElementById('referral-alert');
      if (alert) alert.classList.add('hidden');
      if (referralForm) referralForm.reset();

      // Populate open requisitions
      if (reqSelect) {
        reqSelect.innerHTML = '<option value="">-- Chọn vị trí đang tuyển dụng --</option>';
        try {
          const res = await window.ATS_API.getRequisitionsApi(token, { status: 'OPEN' });
          const reqs = res.ok && res.data?.requisitions ? res.data.requisitions : (currentRequisitionsList || []);
          const activeReqs = reqs.filter(r => ['OPEN', 'IN_PROGRESS'].includes(r.status));
          activeReqs.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = `${r.code} - ${r.title} (${r.departmentName || r.department_name || ''})`;
            reqSelect.appendChild(opt);
          });
        } catch {
          // Fallback to currentRequisitionsList
          (currentRequisitionsList || []).forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = `${r.code} - ${r.title}`;
            reqSelect.appendChild(opt);
          });
        }
      }

      referralModal.classList.remove('hidden');
    });
  }

  function closeReferralModal() {
    if (referralModal) referralModal.classList.add('hidden');
  }

  if (closeReferralBtn) closeReferralBtn.addEventListener('click', closeReferralModal);
  if (cancelReferralBtn) cancelReferralBtn.addEventListener('click', closeReferralModal);

  if (referralForm) {
    referralForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      const alert = document.getElementById('referral-alert');
      if (alert) alert.classList.add('hidden');

      const reqId = document.getElementById('referral-req-select')?.value;
      const fullName = document.getElementById('referral-fullname')?.value.trim();
      const email = document.getElementById('referral-email')?.value.trim();
      const phone = document.getElementById('referral-phone')?.value.trim();
      const notes = document.getElementById('referral-notes')?.value.trim();
      const fileInput = document.getElementById('referral-cvfile');

      if (!reqId) {
        showToast('warning', 'Thiếu thông tin', 'Vui lòng chọn vị trí tuyển dụng.');
        return;
      }
      if (!fullName) {
        showToast('warning', 'Thiếu thông tin', 'Vui lòng nhập họ và tên ứng viên.');
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('warning', 'Email không hợp lệ', 'Vui lòng nhập email hợp lệ.');
        return;
      }
      if (!phone || phone.length < 8) {
        showToast('warning', 'SĐT không hợp lệ', 'Vui lòng nhập số điện thoại hợp lệ.');
        return;
      }
      if (!fileInput?.files?.length) {
        showToast('warning', 'Thiếu CV', 'Vui lòng tải lên tệp CV đính kèm.');
        return;
      }

      const file = fileInput.files[0];
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.pdf', '.docx'].includes(ext)) {
        showToast('danger', 'Định dạng CV sai', 'Chỉ chấp nhận tệp định dạng PDF hoặc DOCX.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('danger', 'CV quá lớn', 'Dung lượng tệp CV không được vượt quá 10MB.');
        return;
      }

      const submitBtn = document.getElementById('btn-submit-referral');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang gửi...';
      }

      try {
        const formData = new FormData();
        formData.append('requisitionId', reqId);
        formData.append('fullName', fullName);
        formData.append('email', email);
        formData.append('phoneNumber', phone);
        formData.append('notes', notes || '');
        formData.append('cvFile', file);

        const res = await window.ATS_API.referCandidateApi(token, formData);
        if (res.ok && res.data?.success) {
          showToast('success', 'Giới thiệu thành công', 'Đã lưu thông tin giới thiệu ứng viên nội bộ.');
          closeReferralModal();
          loadCandidates();
        } else {
          if (alert) {
            alert.textContent = res.data?.message || 'Không thể gửi giới thiệu ứng viên.';
            alert.className = 'alert alert-danger';
            alert.style.background = '#fee2e2';
            alert.style.color = '#991b1b';
            alert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (alert) {
          alert.textContent = 'Lỗi kết nối khi gửi giới thiệu.';
          alert.className = 'alert alert-danger';
          alert.style.background = '#fee2e2';
          alert.style.color = '#991b1b';
          alert.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Gửi giới thiệu';
        }
      }
    });
  }
