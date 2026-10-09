  // ==============================================================================
  // 7. REQUISITIONS MANAGEMENT (REAL BACKEND API)
  // ==============================================================================

  const reqSearchInput = document.getElementById('req-search-input');
  const reqStatusFilter = document.getElementById('req-status-filter');
  const reqHandoverOnly = document.getElementById('req-handover-only');
  const reqRefreshBtn = document.getElementById('req-refresh-btn');
  const requisitionsTableBody = document.getElementById('requisitions-table-body');
  const requisitionsTotalBadge = document.getElementById('requisitions-total-badge');

  let requisitionPage=1,requisitionTrackingEnabled=false,requisitionLoadGeneration=0;
  async function loadRequisitions() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;
    const generation=++requisitionLoadGeneration,view=currentActiveView,isCurrent=()=>generation===requisitionLoadGeneration&&token===sessionStorage.getItem('ats_token')&&view===currentActiveView;

    const search = reqSearchInput ? reqSearchInput.value.trim() : '';
    const status = reqStatusFilter ? reqStatusFilter.value : 'ALL';
    const handoverOnly = reqHandoverOnly ? reqHandoverOnly.checked : false;

    if (requisitionsTableBody) {
      requisitionsTableBody.innerHTML = `<tr><td colspan="${requisitionTrackingEnabled?8:7}" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải danh sách vị trí...</td></tr>`;
    }

    try {
      const filters={search,status,handoverOnly};if(requisitionTrackingEnabled){for(const [key,id]of [['departmentId','req-department-filter'],['recruiterId','req-recruiter-filter'],['createdFrom','req-created-from'],['createdTo','req-created-to']])filters[key]=document.getElementById(id).value;filters.page=requisitionPage;filters.limit=20;}const res = await window.ATS_API.getRequisitions(token,filters);
      if(!isCurrent())return;
      if (res.ok && res.data && res.data.success) {
        if(res.data.features?.requisitionLifecycle&&reqStatusFilter&&!reqStatusFilter.querySelector('[value="PAUSED"]')){for(const [value,text] of [['PAUSED','Tạm dừng'],['CANCELLED','Huỷ']]){const option=document.createElement('option');option.value=value;option.textContent=text;reqStatusFilter.appendChild(option);}}
        requisitionTrackingEnabled=Boolean(res.data.features?.requisitionTracking);document.getElementById('s308-filters')?.classList.toggle('hidden',!requisitionTrackingEnabled);document.getElementById('s308-age-head')?.classList.toggle('hidden',!requisitionTrackingEnabled);document.getElementById('s308-pagination')?.classList.toggle('hidden',!requisitionTrackingEnabled);
        if(requisitionTrackingEnabled&&!res.data.pagination){return loadRequisitions();}
        if(requisitionTrackingEnabled){const p=res.data.pagination;if(p.currentPage>Math.max(1,p.totalPages)){requisitionPage=Math.max(1,p.totalPages);return loadRequisitions();}document.getElementById('req-page-info').textContent=p.totalItems===0?'0 yêu cầu':p.currentPage+' / '+p.totalPages+' — '+p.totalItems+' yêu cầu';document.getElementById('req-prev-page').disabled=p.currentPage<=1;document.getElementById('req-next-page').disabled=p.currentPage>=p.totalPages;window.ATS_API.requisitionTrackingOptionsApi(token).then(result=>{if(!isCurrent())return;document.getElementById('req-tracking-options-message').textContent=result.ok?'':result.data?.message||'Không tải được bộ lọc.';if(!result.ok)return;for(const [key,id,title] of [['departments','req-department-filter','Tất cả phòng ban'],['recruiters','req-recruiter-filter','Recruiter chính hoặc hỗ trợ']]){const select=document.getElementById(id),selected=select.value;select.textContent='';const empty=document.createElement('option');empty.value='';empty.textContent=title;select.appendChild(empty);for(const item of result.data.data[key]){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.appendChild(option);}select.value=selected;}});}
        const list = res.data.requisitions || res.data.data || [];
        currentRequisitionsList = list;
        if (requisitionsTotalBadge) {
          requisitionsTotalBadge.textContent = `${res.data.total??list.length} vị trí`;
        }

        if (list.length === 0) {
          requisitionsTableBody.innerHTML = `<tr><td colspan="${requisitionTrackingEnabled?8:7}" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy vị trí tuyển dụng phù hợp.</td></tr>`;
          return;
        }

        requisitionsTableBody.innerHTML = list.map(req => {
          const statusBadge = req.status === 'OPEN' ? 'badge-primary' : (req.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-neutral');
          const statusText = req.status === 'PAUSED' ? 'Tạm dừng' : req.status === 'CANCELLED' ? 'Huỷ' : req.status === 'DRAFT' ? 'Nháp' : (req.status === 'OPEN' ? 'Đang mở' : (req.status === 'IN_PROGRESS' ? 'Đang tuyển' : 'Đã đóng'));
          const isHandover = req.handover_required || req.handoverRequired;
          const handoverAlert = isHandover ? `<span class="badge badge-warning" style="margin-left: 6px;">Cần bàn giao</span>` : '';
          const dept = req.department || req.department_name || req.departmentName || '';
          const recName = req.recruiter_name || req.recruiterName || (req.recruiter ? req.recruiter.fullName : '');

          return `
            <tr ${req.overdue?'style="background:var(--color-danger-light, #fff1f0);"':''}>
              <td><code class="font-mono" style="font-weight: 600; color: var(--color-primary);">${req.code}</code></td>
              <td>
                <div style="font-weight: 600; color: var(--color-text);">${req.formVersion === 'S2-10' ? escapeDepartmentHtml(req.title || 'Yêu cầu chưa đặt tên') : req.title}</div>
                ${handoverAlert}
              </td>
              <td>${req.formVersion === 'S2-10' ? escapeDepartmentHtml(dept) : dept}</td>
              <td style="text-align: center; font-weight: 600;">${req.headcount ?? '—'}</td>
              <td>${recName ? escapeDepartmentHtml(recName) : '<span style="color: var(--color-text-muted); font-style: italic;">Chưa phân công</span>'}${req.supportRecruiters?.length?'<div>Hỗ trợ: '+req.supportRecruiters.map(user=>escapeDepartmentHtml(user.name)).join(', ')+'</div>':''}</td>
              <td><span class="badge ${statusBadge}">${statusText}</span></td>
              ${requisitionTrackingEnabled?`<td><div>${req.daysOpen==null?'Chưa mở':(req.daysOpenEstimated?'~':'')+req.daysOpen+' ngày mở'}</div><div>${req.daysRemaining==null?'Chưa có ngày cần người':req.daysRemaining>=0?'Còn '+req.daysRemaining+' ngày':'Qua ngày cần người '+Math.abs(req.daysRemaining)+' ngày'}</div>${req.overdue?'<span class="badge badge-danger">Trễ hạn</span>':''}${req.paused?'<span class="badge badge-neutral">Đang tạm dừng</span>':''}</td>`:''}
              <td style="text-align: center;">
                <div style="display: flex; gap: 6px; justify-content: center;">
                  <button type="button" class="btn btn-outline btn-xs btn-detail-req" data-id="${req.id}">
                    Chi tiết
                  </button>
                  ${res.data.features?.requisitionOperations&&currentAuthenticatedUser?.roles?.some(role=>['ADMIN','HR_MANAGER','HIRING_MGR'].includes(role))?`<button type="button" class="btn btn-outline btn-xs btn-copy-req" data-id="${escapeDepartmentHtml(req.id)}">Sao chép</button>`:''}
                  <button type="button" class="btn btn-outline btn-xs btn-edit-req" data-id="${req.id}">
                    Sửa
                  </button>
                  ${isHandover ? `
                    <button type="button" class="btn btn-outline btn-xs btn-reassign-req" data-id="${req.id}" data-code="${req.code}" data-title="${req.title}" style="color: var(--color-warning); border-color: var(--color-warning);">
                      Bàn giao
                    </button>
                  ` : ''}
                  <button type="button" class="btn btn-outline btn-xs btn-view-candidates-req" data-title="${req.title}">
                    Ứng viên
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        // Wire Action Buttons
        document.querySelectorAll('.btn-edit-req').forEach(btn => {
          btn.addEventListener('click', () => {
            const reqId = btn.getAttribute('data-id');
            return openRequisitionDetails(reqId,true);
          });
        });
        document.querySelectorAll('.btn-copy-req').forEach(btn=>btn.addEventListener('click',()=>window.ATS_REQUISITION_OPERATIONS_UI.openCopy(btn.getAttribute('data-id'))));
        document.querySelectorAll('.btn-detail-req').forEach(btn=>btn.addEventListener('click',()=>openRequisitionDetails(btn.getAttribute('data-id'),false)));

        document.querySelectorAll('.btn-reassign-req').forEach(btn => {
          btn.addEventListener('click', () => {
            const reqId = btn.getAttribute('data-id');
            const reqCode = btn.getAttribute('data-code');
            const reqTitle = btn.getAttribute('data-title');
            openReassignHandoverModal(reqId, reqCode, reqTitle);
          });
        });

        document.querySelectorAll('.btn-view-candidates-req').forEach(btn => {
          btn.addEventListener('click', () => {
            const reqTitle = btn.getAttribute('data-title');
            if (candidatesSearchInput) candidatesSearchInput.value = reqTitle;
            switchView('candidates');
            showToast('info', 'Ứng viên theo vị trí', `Đang lọc danh sách ứng viên cho vị trí: "${reqTitle}"`);
          });
        });
      } else {
        currentRequisitionsList = [];
        document.getElementById('s308-pagination')?.classList.add('hidden');
        if (requisitionsTotalBadge) requisitionsTotalBadge.textContent = '0 vị trí';
        if (requisitionsTableBody) requisitionsTableBody.innerHTML = `<tr><td colspan="${requisitionTrackingEnabled?8:7}" style="text-align: center; padding: 24px;">${escapeDepartmentHtml(res.data?.message || 'Không thể tải danh sách yêu cầu tuyển dụng. Vui lòng thử lại.')}</td></tr>`;
      }
    } catch (e) {
      if(!isCurrent())return;
      currentRequisitionsList = [];
      document.getElementById('s308-pagination')?.classList.add('hidden');
      if (requisitionsTotalBadge) requisitionsTotalBadge.textContent = '0 vị trí';
      if (requisitionsTableBody) requisitionsTableBody.innerHTML = `<tr><td colspan="${requisitionTrackingEnabled?8:7}" style="text-align: center; padding: 24px;">Không thể kết nối để tải danh sách yêu cầu tuyển dụng. Vui lòng thử lại.</td></tr>`;
    }
  }

  const reqExportBtn = document.getElementById('req-export-btn');
  if (reqExportBtn) {
    reqExportBtn.addEventListener('click', async () => {
      if (!currentRequisitionsList || currentRequisitionsList.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Không có dữ liệu vị trí tuyển dụng để xuất.');
        return;
      }
      let exportList=currentRequisitionsList;if(requisitionTrackingEnabled){const token=sessionStorage.getItem('ats_token'),view=currentActiveView,filters={search:reqSearchInput?.value.trim()||'',status:reqStatusFilter?.value||'ALL',handoverOnly:reqHandoverOnly?.checked||false};for(const [key,id]of [['departmentId','req-department-filter'],['recruiterId','req-recruiter-filter'],['createdFrom','req-created-from'],['createdTo','req-created-to']])filters[key]=document.getElementById(id).value;if(reqExportBtn.disabled)return;reqExportBtn.disabled=true;try{const result=await window.ATS_API.getRequisitions(token,filters);if(token!==sessionStorage.getItem('ats_token')||view!==currentActiveView)return;if(!result.ok){showToast('danger','Xuất dữ liệu',result.data?.message||'Không thể tải dữ liệu xuất.');return;}exportList=result.data.requisitions||[];}finally{reqExportBtn.disabled=false;}}
      const headers = ['Mã vị trí', 'Tiêu đề tuyển dụng', 'Phòng ban', 'Chỉ tiêu', 'Recruiter phụ trách', 'Trạng thái'];
      const rows = exportList.map(r => [
        r.code,
        r.title,
        r.departmentName || r.department || '',
        r.headcount,
        r.recruiter_name || r.recruiterName || (r.recruiter ? r.recruiter.fullName : 'Chưa phân công'),
        r.status
      ]);
      exportTableToCsv('danh_sach_vi_tri_tuyen_dung.csv', headers, rows);
    });
  }

  const resetRequisitionPage=()=>{requisitionPage=1;return loadRequisitions();};
  for(const id of ['req-department-filter','req-recruiter-filter','req-created-from','req-created-to'])document.getElementById(id)?.addEventListener('change',resetRequisitionPage);
  document.getElementById('req-prev-page')?.addEventListener('click',()=>{requisitionPage=Math.max(1,requisitionPage-1);loadRequisitions();});
  document.getElementById('req-next-page')?.addEventListener('click',()=>{requisitionPage++;loadRequisitions();});
  if (reqRefreshBtn) reqRefreshBtn.addEventListener('click',resetRequisitionPage);
  if (reqStatusFilter) reqStatusFilter.addEventListener('change',resetRequisitionPage);
  if (reqHandoverOnly) reqHandoverOnly.addEventListener('change',resetRequisitionPage);
  if (reqSearchInput) {
    reqSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') resetRequisitionPage();
    });
  }
