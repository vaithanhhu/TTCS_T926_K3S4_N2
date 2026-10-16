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


  let candidateSearchPage = 1, candidateSearchSequence = 0, candidateSavedFilters = [],candidateSearchReady=false,candidateAppliedFilters={};
  const candidateFilterInputs = {search:'candidates-search-input',stage:'candidates-stage-filter',requisitionId:'candidates-req-filter',sourceId:'candidate-source-filter',tag:'candidate-tag-filter',submittedFrom:'candidate-date-from',submittedTo:'candidate-date-to',ratingMin:'candidate-rating-min',ratingMax:'candidate-rating-max'};
  function readCandidateFilters() { return Object.fromEntries(Object.entries(candidateFilterInputs).map(([key,id]) => [key,document.getElementById(id)?.value || ''])); }
  function resetCandidateSearch() { candidateSearchPage=1;return loadCandidates(); }
  function setCandidateSearchMessage(message) { const node=document.getElementById('candidate-search-message');if(node)node.textContent=message; }
  function setCandidateFilterValue(node,value) {
    if (node.tagName === 'SELECT' && value && ![...node.options].some(option=>option.value===value)) {
      const option=document.createElement('option');option.value=value;option.textContent='Điều kiện đã lưu (không còn trong lựa chọn hiện tại)';node.appendChild(option);
    }
    node.value=value;
  }
  async function loadCandidateFilterChoices(token,request) {
    if (!window.ATS_API.candidateSearchOptionsApi || !window.ATS_API.candidateFiltersApi) return;
    const [choices,saved] = await Promise.all([window.ATS_API.candidateSearchOptionsApi(token),window.ATS_API.candidateFiltersApi(token)]);
    if(request !== candidateSearchSequence || token !== sessionStorage.getItem('ats_token'))return;
    if(choices.ok) {
      for(const [id,rows,label] of [['candidates-req-filter',choices.data.requisitions,'title'],['candidate-source-filter',choices.data.sources,'name']]) {
        const node=document.getElementById(id);if(!node)continue;const value=node.value;
        node.innerHTML='<option value="ALL">Tất cả</option>'+(rows || []).map(row=>'<option value="'+escapeHtml(row.id)+'">'+escapeHtml(row[label])+'</option>').join('');setCandidateFilterValue(node,value || 'ALL');
      }
      const tags=document.getElementById('candidate-tag-options');if(tags)tags.innerHTML=(choices.data.tags || []).map(row=>'<option value="'+escapeHtml(row.name)+'"></option>').join('');
    } else setCandidateSearchMessage(choices.data?.message || 'Không thể tải lựa chọn bộ lọc.');
    candidateSavedFilters=saved.ok ? saved.data.filters || [] : [];
    const select=document.getElementById('candidate-filter-saved');if(select){const value=select.value;select.innerHTML='<option value="">Chọn bộ lọc</option>'+candidateSavedFilters.map(row=>'<option value="'+escapeHtml(row.id)+'">'+escapeHtml(row.name)+'</option>').join('');select.value=value;}
    if(!saved.ok)setCandidateSearchMessage(saved.data?.message || 'Không thể tải bộ lọc đã lưu.');
  }
  document.getElementById('candidate-prev-page')?.addEventListener('click',()=>{candidateSearchPage=Math.max(1,candidateSearchPage-1);loadCandidates();});
  document.getElementById('candidate-next-page')?.addEventListener('click',()=>{candidateSearchPage++;loadCandidates();});
  for(const id of ['candidate-source-filter','candidate-tag-filter','candidate-date-from','candidate-date-to','candidate-rating-min','candidate-rating-max'])document.getElementById(id)?.addEventListener('change',resetCandidateSearch);
  document.getElementById('candidate-filter-reset')?.addEventListener('click',()=>{for(const [key,id]of Object.entries(candidateFilterInputs)){const node=document.getElementById(id);if(node)node.value=['stage','sourceId','requisitionId'].includes(key)?'ALL':'';}resetCandidateSearch();});
  document.getElementById('candidate-filter-apply')?.addEventListener('click',()=>{const saved=candidateSavedFilters.find(row=>row.id===document.getElementById('candidate-filter-saved').value);if(!saved)return;for(const [key,id]of Object.entries(candidateFilterInputs)){const node=document.getElementById(id);if(node)setCandidateFilterValue(node,saved.filters[key] || (['stage','sourceId','requisitionId'].includes(key)?'ALL':''));}resetCandidateSearch();});
  async function mutateCandidateFilter(method) {
    const token=sessionStorage.getItem('ats_token');if(!token)return;
    const id=document.getElementById('candidate-filter-saved')?.value;
    if(method==='DELETE'&&!id)return;
    const result=await window.ATS_API.candidateFiltersApi(token,method,method==='POST'?{name:document.getElementById('candidate-filter-name').value,filters:readCandidateFilters()}:undefined,id && method==='DELETE'?id:undefined);
    if(token!==sessionStorage.getItem('ats_token'))return;
    if(!result.ok){setCandidateSearchMessage(result.data?.message || 'Không thể cập nhật bộ lọc.');return;}
    loadCandidateFilterChoices(token,candidateSearchSequence);
  }
  document.getElementById('candidate-filter-save')?.addEventListener('click',()=>mutateCandidateFilter('POST'));
  document.getElementById('candidate-filter-delete')?.addEventListener('click',()=>mutateCandidateFilter('DELETE'));

  async function loadCandidates() {
    const request = ++candidateSearchSequence;
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    // Populate requisition filter dropdown if empty
    if (candidatesReqFilter && candidatesReqFilter.children.length <= 1 && currentRequisitionsList.length > 0) {
      candidatesReqFilter.innerHTML = `<option value="ALL">Tất cả vị trí ứng tuyển</option>` +
        currentRequisitionsList.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.code)} - ${escapeHtml(r.title)}</option>`).join('');
    }

    const search = candidatesSearchInput ? candidatesSearchInput.value.trim().toLowerCase() : '';
    const stage = candidatesStageFilter ? candidatesStageFilter.value : 'ALL';
    const reqFilter = candidatesReqFilter ? candidatesReqFilter.value : 'ALL';

    if (candidatesTableBody) {
      candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách ứng viên...</td></tr>`;
    }

    try {
      const res = await window.ATS_API.getCandidatesApi(token, { ...readCandidateFilters(), search, stage, requisitionId:reqFilter, advanced:true, page:candidateSearchPage, pageSize:50 });
      if (request !== candidateSearchSequence || token !== sessionStorage.getItem('ats_token')) return;
      if (!res.ok || !res.data?.success) throw new Error(res.data?.message || 'Không thể tìm kiếm ứng viên.');
      if (res.ok && res.data && res.data.success) {
        let list = res.data.candidates || res.data.data || [];

        currentCandidatesList = list;
        if (candidatesTotalBadge) {
          candidatesTotalBadge.textContent = `${res.data.total ?? list.length} ứng viên`;
        }

        const total = res.data.total ?? list.length;
        document.getElementById('candidate-page-label')?.replaceChildren(document.createTextNode('Trang '+candidateSearchPage));
        if (document.getElementById('candidate-prev-page')) document.getElementById('candidate-prev-page').disabled = candidateSearchPage === 1;
        if (document.getElementById('candidate-next-page')) document.getElementById('candidate-next-page').disabled = candidateSearchPage * 50 >= total;
        setCandidateSearchMessage('');
        const enabled=res.data.features?.candidateSearch===true;
        candidateSearchReady=enabled;candidateAppliedFilters={...readCandidateFilters(),search,stage,requisitionId:reqFilter};
        document.getElementById('candidate-advanced-filters')?.classList.toggle('hidden',!enabled);
        if(enabled)loadCandidateFilterChoices(token,request);
        else setCandidateSearchMessage('Tìm kiếm nâng cao và bộ lọc đã lưu cần migration S5-05 được phê duyệt. Danh sách hiện hữu vẫn hoạt động.');
        if (list.length === 0) {
          candidatesTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy hồ sơ ứng viên phù hợp.</td></tr>`;
          return;
        }

        candidatesTableBody.innerHTML = list.map(c => {
          const badgeClass = STAGE_BADGES[c.stage] || 'badge-neutral';
          const stageName = c.statusLabel || STAGE_LABELS[c.stage] || c.stage || '—';
          const stars = c.interviewAverage == null ? '—' : escapeHtml(Number(c.interviewAverage).toFixed(2));
          const name = c.fullName || c.full_name || 'Ứng viên';
          const phone = c.phoneNumber || c.phone || '';
          const reqTitle = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
          const code = formatCandCode(c);
          const appliedDate = c.createdAt || c.created_at || c.applied_at;

          return `
            <tr>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${escapeHtml(code)}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${escapeHtml(name)}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted); font-family: monospace;">Mã: ${escapeHtml(code)}</div>
              </td>
              <td>${escapeHtml(reqTitle)}</td>
              <td>
                <div style="font-size: 0.8rem; color: var(--color-text);">${escapeHtml(c.email)}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(phone)}</div>
              </td>
              <td><span class="badge ${badgeClass}">${escapeHtml(stageName)}</span></td>
              <td>${appliedDate ? new Date(appliedDate).toLocaleDateString('vi-VN') : '—'}</td>
              <td style="color: #f59e0b; font-size: 0.85rem;">${stars}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs" onclick="window.ATS_APP_HELPERS.viewCandidateDetails(${escapeHtml(JSON.stringify(c.id))})">
                  Chi tiết
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      if (request !== candidateSearchSequence || token !== sessionStorage.getItem('ats_token')) return;
      currentCandidatesList = [];
      if (candidatesTotalBadge) candidatesTotalBadge.textContent = '—';
      setCandidateSearchMessage(e.message);
      if (candidatesTableBody) candidatesTableBody.innerHTML = '<tr><td colspan="8">Không thể tải dữ liệu. Vui lòng thử lại.</td></tr>';
    }
  }

  if (candidatesExportBtn) {
    candidatesExportBtn.addEventListener('click', async () => {
      if (!currentCandidatesList || currentCandidatesList.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Không có dữ liệu ứng viên để xuất.');
        return;
      }
      let exportList=currentCandidatesList;
      if(candidateSearchReady){
        const token=sessionStorage.getItem('ats_token'),sequence=candidateSearchSequence,filters={...candidateAppliedFilters};
        candidatesExportBtn.disabled=true;
        try{
          const all=new Map();let total=null;
          for(let page=1;total===null||page<=Math.ceil(total/100);page++){
            const result=await window.ATS_API.getCandidatesApi(token,{...filters,advanced:true,page,pageSize:100});
            if(token!==sessionStorage.getItem('ats_token')||sequence!==candidateSearchSequence)return;
            if(!result.ok||!result.data?.success||result.data.features?.candidateSearch!==true)throw new Error(result.data?.message || 'Không thể tải dữ liệu xuất.');
            if(total===null)total=result.data.total;
            else if(total!==result.data.total)throw new Error('Dữ liệu đã thay đổi. Vui lòng làm mới và xuất lại.');
            for(const candidate of result.data.candidates || [])all.set(candidate.id,candidate);
          }
          if(all.size!==total)throw new Error('Dữ liệu đã thay đổi. Vui lòng làm mới và xuất lại.');
          exportList=[...all.values()];
        }catch(error){showToast('danger','Xuất dữ liệu',error.message);return;}
        finally{candidatesExportBtn.disabled=false;}
      }
      const headers = ['Mã UV', 'Họ và tên', 'Vị trí ứng tuyển', 'Email', 'Điện thoại', 'Giai đoạn', 'Ngày nộp', 'Điểm PV trung bình'];
      const rows = exportList.map(c => [
        formatCandCode(c),
        c.fullName || c.full_name || '',
        (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || ''),
        c.email || '',
        c.phoneNumber || c.phone || '',
        c.statusLabel || STAGE_LABELS[c.stage] || c.stage || '—',
        (c.createdAt || c.created_at) ? new Date(c.createdAt || c.created_at).toLocaleDateString('vi-VN') : '',
        c.interviewAverage == null ? '—' : Number(c.interviewAverage).toFixed(2)
      ]);
      exportTableToCsv('danh_sach_ung_vien.csv', headers, rows);
    });
  }

  if (candidatesRefreshBtn) candidatesRefreshBtn.addEventListener('click', resetCandidateSearch);
  if (candidatesStageFilter) candidatesStageFilter.addEventListener('change', resetCandidateSearch);
  if (candidatesReqFilter) candidatesReqFilter.addEventListener('change', resetCandidateSearch);
  if (candidatesSearchInput) {
    candidatesSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') resetCandidateSearch();
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
