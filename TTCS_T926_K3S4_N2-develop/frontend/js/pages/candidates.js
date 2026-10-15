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
