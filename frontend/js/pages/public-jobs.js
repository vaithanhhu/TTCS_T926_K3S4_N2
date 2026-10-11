(function() {
  let generation = 0;
  let cachedOptions = null;
  let currentWithdrawToken = null;

  const get = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  async function loadOptions() {
    if (cachedOptions) return;
    try {
      const res = await window.ATS_API.publicJobsOptionsApi();
      if (res.ok && res.data?.data) {
        cachedOptions = res.data.data;
        const depSelect = get('filter-department');
        const locSelect = get('filter-location');
        const modeSelect = get('filter-mode');

        if (depSelect) {
          depSelect.innerHTML = '<option value="">Tất cả phòng ban</option>';
          (cachedOptions.departments || []).forEach(d => {
            const opt = node('option', d);
            opt.value = d;
            depSelect.appendChild(opt);
          });
        }
        if (locSelect) {
          locSelect.innerHTML = '<option value="">Tất cả địa điểm</option>';
          (cachedOptions.locations || []).forEach(l => {
            const opt = node('option', l);
            opt.value = l;
            locSelect.appendChild(opt);
          });
        }
        if (modeSelect) {
          modeSelect.innerHTML = '<option value="">Tất cả hình thức</option>';
          (cachedOptions.modes || []).forEach(m => {
            const opt = node('option', m);
            opt.value = m;
            modeSelect.appendChild(opt);
          });
        }
      }
    } catch (err) {
      console.warn('[Public Jobs] Không thể tải danh mục lọc:', err);
    }
  }

  function getFilterQuery() {
    return {
      search: get('filter-search')?.value.trim() || '',
      department: get('filter-department')?.value || '',
      workLocation: get('filter-location')?.value || '',
      workMode: get('filter-mode')?.value || ''
    };
  }

  async function load(page = 1) {
    const root = get('public-jobs-content');
    const filterSection = get('public-jobs-filter-section');
    const backBtn = get('public-jobs-back');
    const pagination = get('public-jobs-pagination');
    const current = ++generation;

    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get('id');
    const action = urlParams.get('action');
    const token = urlParams.get('token');

    // Handle direct withdraw link
    if (action === 'withdraw' && token) {
      currentWithdrawToken = token;
      openWithdrawModal();
    }

    if (jobId) {
      // Single Job Detail View
      if (filterSection) filterSection.classList.add('hidden');
      if (backBtn) backBtn.classList.remove('hidden');
      if (pagination) pagination.classList.add('hidden');
      root.innerHTML = '<div style="text-align:center;padding:48px 0;color:var(--text-muted,#6b7280);">Đang tải chi tiết tin tuyển dụng...</div>';

      const result = await window.ATS_API.publicJobsApi(jobId);
      if (current !== generation || typeof currentActiveView !== 'undefined' && currentActiveView !== 'public-jobs') return;

      root.innerHTML = '';
      if (!result.ok || !result.data?.data) {
        const errorCard = node('div', null, 'panel-card');
        errorCard.style.padding = '32px';
        errorCard.style.textAlign = 'center';
        errorCard.appendChild(node('h3', 'Không tìm thấy tin tuyển dụng'));
        errorCard.appendChild(node('p', result.data?.message || 'Tin tuyển dụng không tồn tại, đã hết hạn nhận hồ sơ hoặc đã bị gỡ.'));
        const back = node('button', '← Quay lại danh sách việc làm', 'btn btn-primary btn-sm');
        back.addEventListener('click', () => window.ATS_ROUTER.navigate('/careers/jobs'));
        errorCard.appendChild(back);
        root.appendChild(errorCard);
        return;
      }

      const job = result.data.data;
      renderJobDetail(root, job);
      return;
    }

    // List Jobs View
    if (filterSection) filterSection.classList.remove('hidden');
    if (backBtn) backBtn.classList.add('hidden');
    await loadOptions();

    root.innerHTML = '<div style="text-align:center;padding:48px 0;color:var(--text-muted,#6b7280);">Đang tải danh sách việc làm...</div>';
    const query = { ...getFilterQuery(), page, pageSize: 10 };
    const result = await window.ATS_API.publicJobsSearchApi(query);

    if (current !== generation || typeof currentActiveView !== 'undefined' && currentActiveView !== 'public-jobs') return;
    root.innerHTML = '';

    if (!result.ok) {
      const errBox = node('div', null, 'panel-card');
      errBox.style.padding = '24px';
      errBox.style.textAlign = 'center';
      errBox.appendChild(node('p', result.data?.message || 'Không thể tải danh sách việc làm. Vui lòng thử lại.'));
      const retry = node('button', 'Thử lại', 'btn btn-outline btn-sm');
      retry.addEventListener('click', () => load(page));
      errBox.appendChild(retry);
      root.appendChild(errBox);
      return;
    }

    const jobs = result.data.data || [];
    if (!jobs.length) {
      const emptyCard = node('div', null, 'panel-card');
      emptyCard.style.padding = '48px 24px';
      emptyCard.style.textAlign = 'center';
      emptyCard.appendChild(node('div', '🔍', ''));
      emptyCard.firstElementChild.style.fontSize = '2.5rem';
      emptyCard.appendChild(node('h3', 'Không tìm thấy việc làm phù hợp'));
      emptyCard.appendChild(node('p', 'Hãy thử tìm kiếm với từ khóa khác hoặc bỏ bớt các điều kiện lọc.'));
      root.appendChild(emptyCard);
      if (pagination) pagination.classList.add('hidden');
      return;
    }

    // Render Cards
    jobs.forEach(job => {
      const card = node('article', null, 'panel-card');
      card.style.padding = '20px 24px';
      card.style.marginBottom = '16px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '8px';

      const titleRow = node('div', null, '');
      titleRow.style.display = 'flex';
      titleRow.style.justifyContent = 'space-between';
      titleRow.style.alignItems = 'flex-start';
      titleRow.style.gap = '12px';
      titleRow.style.flexWrap = 'wrap';

      const title = node('h2', job.title);
      title.style.margin = '0';
      title.style.fontSize = '1.25rem';
      title.style.fontWeight = '700';
      title.style.color = 'var(--text-color,#111827)';
      titleRow.appendChild(title);

      if (job.showSalary) {
        const salaryBadge = node('span', `${Number(job.salaryMin).toLocaleString('vi-VN')} – ${Number(job.salaryMax).toLocaleString('vi-VN')} VNĐ`, 'badge');
        salaryBadge.style.background = '#dbeafe';
        salaryBadge.style.color = '#1e40af';
        salaryBadge.style.padding = '4px 10px';
        salaryBadge.style.borderRadius = '9999px';
        salaryBadge.style.fontSize = '0.85rem';
        salaryBadge.style.fontWeight = '600';
        titleRow.appendChild(salaryBadge);
      }
      card.appendChild(titleRow);

      const meta = node('div', [job.departmentName, job.workLocation, job.workMode].filter(Boolean).join(' • '));
      meta.style.fontSize = '0.9rem';
      meta.style.color = 'var(--text-muted,#4b5563)';
      card.appendChild(meta);

      if (job.jobDescription) {
        const descPreview = node('p', job.jobDescription.length > 200 ? job.jobDescription.slice(0, 200) + '...' : job.jobDescription);
        descPreview.style.margin = '4px 0 8px 0';
        descPreview.style.fontSize = '0.9rem';
        descPreview.style.color = 'var(--text-muted,#6b7280)';
        card.appendChild(descPreview);
      }

      const footer = node('div', null, '');
      footer.style.display = 'flex';
      footer.style.justifyContent = 'space-between';
      footer.style.alignItems = 'center';
      footer.style.flexWrap = 'wrap';
      footer.style.gap = '12px';
      footer.style.marginTop = '8px';

      const deadline = node('span', job.applicationDeadline ? `Hạn nộp: ${job.applicationDeadline.split('-').reverse().join('/')}` : '');
      deadline.style.fontSize = '0.85rem';
      deadline.style.color = '#b45309';
      footer.appendChild(deadline);

      const btnGroup = node('div', null, '');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '8px';

      const detailBtn = node('button', 'Xem chi tiết', 'btn btn-outline btn-sm');
      detailBtn.type = 'button';
      detailBtn.addEventListener('click', () => window.ATS_ROUTER.navigate('/careers/jobs?id=' + encodeURIComponent(job.id)));
      btnGroup.appendChild(detailBtn);

      const applyBtn = node('button', 'Ứng tuyển ngay', 'btn btn-primary btn-sm');
      applyBtn.type = 'button';
      applyBtn.addEventListener('click', () => openApplyModal(job));
      btnGroup.appendChild(applyBtn);

      footer.appendChild(btnGroup);
      card.appendChild(footer);
      root.appendChild(card);
    });

    // Render Pagination
    if (pagination && result.data.pagination) {
      const p = result.data.pagination;
      if (p.totalPages > 1) {
        pagination.classList.remove('hidden');
        pagination.innerHTML = '';
        for (let i = 1; i <= p.totalPages; i++) {
          const btn = node('button', String(i), `btn btn-sm ${i === p.page ? 'btn-primary' : 'btn-outline'}`);
          btn.addEventListener('click', () => load(i));
          pagination.appendChild(btn);
        }
      } else {
        pagination.classList.add('hidden');
      }
    }
  }

  function renderJobDetail(root, job) {
    const card = node('article', null, 'panel-card');
    card.style.padding = '32px';

    const header = node('div', null, '');
    header.style.borderBottom = '1px solid var(--border-color,#e5e7eb)';
    header.style.paddingBottom = '20px';
    header.style.marginBottom = '24px';

    const title = node('h1', job.title);
    title.style.margin = '0 0 8px 0';
    title.style.fontSize = '1.75rem';
    title.style.fontWeight = '700';
    header.appendChild(title);

    const meta = node('div', [job.departmentName, job.workLocation, job.workMode].filter(Boolean).join(' • '));
    meta.style.fontSize = '1rem';
    meta.style.color = 'var(--text-muted,#4b5563)';
    meta.style.marginBottom = '12px';
    header.appendChild(meta);

    if (job.showSalary) {
      const sal = node('div', `💰 Mức lương: ${Number(job.salaryMin).toLocaleString('vi-VN')} – ${Number(job.salaryMax).toLocaleString('vi-VN')} VNĐ/tháng`);
      sal.style.fontWeight = '600';
      sal.style.color = '#047857';
      sal.style.marginBottom = '8px';
      header.appendChild(sal);
    }

    if (job.applicationDeadline) {
      const dl = node('div', `⏳ Hạn nộp hồ sơ: ${job.applicationDeadline.split('-').reverse().join('/')}`);
      dl.style.fontSize = '0.9rem';
      dl.style.color = '#b45309';
      dl.style.marginBottom = '16px';
      header.appendChild(dl);
    }

    const applyActionBtn = node('button', '🚀 Ứng tuyển ngay bây giờ', 'btn btn-primary');
    applyActionBtn.style.padding = '10px 24px';
    applyActionBtn.style.fontSize = '1rem';
    applyActionBtn.style.fontWeight = '600';
    applyActionBtn.addEventListener('click', () => openApplyModal(job));
    header.appendChild(applyActionBtn);

    card.appendChild(header);

    // Job Description
    if (job.jobDescription) {
      card.appendChild(node('h2', 'Mô tả công việc', ''));
      card.lastElementChild.style.fontSize = '1.25rem';
      card.lastElementChild.style.margin = '16px 0 8px 0';
      const desc = node('div', job.jobDescription);
      desc.style.whiteSpace = 'pre-wrap';
      desc.style.lineHeight = '1.6';
      desc.style.color = 'var(--text-color,#374151)';
      desc.style.marginBottom = '24px';
      card.appendChild(desc);
    }

    // Candidate Requirements
    if (job.candidateRequirements) {
      card.appendChild(node('h2', 'Yêu cầu ứng viên', ''));
      card.lastElementChild.style.fontSize = '1.25rem';
      card.lastElementChild.style.margin = '16px 0 8px 0';
      const req = node('div', job.candidateRequirements);
      req.style.whiteSpace = 'pre-wrap';
      req.style.lineHeight = '1.6';
      req.style.color = 'var(--text-color,#374151)';
      req.style.marginBottom = '24px';
      card.appendChild(req);
    }

    // Bottom Action Bar
    const btmBar = node('div', null, '');
    btmBar.style.display = 'flex';
    btmBar.style.justifyContent = 'space-between';
    btmBar.style.alignItems = 'center';
    btmBar.style.paddingTop = '20px';
    btmBar.style.borderTop = '1px solid var(--border-color,#e5e7eb)';

    const btmBack = node('button', '← Quay lại', 'btn btn-outline btn-sm');
    btmBack.addEventListener('click', () => window.ATS_ROUTER.navigate('/careers/jobs'));
    btmBar.appendChild(btmBack);

    const btmApply = node('button', 'Ứng tuyển vị trí này', 'btn btn-primary');
    btmApply.addEventListener('click', () => openApplyModal(job));
    btmBar.appendChild(btmApply);

    card.appendChild(btmBar);
    root.appendChild(card);
  }

  // --- Modal: Apply Job Logic ---
  function openApplyModal(job) {
    const modal = get('modal-apply-job');
    const form = get('form-apply-job');
    const successScreen = get('apply-success-screen');
    const alert = get('apply-form-alert');

    if (!modal) return;
    get('apply-job-id').value = job.id;
    get('apply-job-title').textContent = `Ứng tuyển: ${job.title}`;
    get('apply-job-subtitle').textContent = [job.departmentName, job.workLocation].filter(Boolean).join(' • ');

    // Reset Form
    form.reset();
    form.classList.remove('hidden');
    if (successScreen) successScreen.classList.add('hidden');
    if (alert) alert.classList.add('hidden');
    clearFormErrors();

    modal.classList.remove('hidden');
  }

  function closeApplyModal() {
    get('modal-apply-job')?.classList.add('hidden');
  }

  function clearFormErrors() {
    ['fullname', 'email', 'phone', 'cvfile'].forEach(k => {
      const el = get(`err-apply-${k}`);
      if (el) el.classList.add('hidden');
    });
  }

  async function handleApplySubmit(e) {
    e.preventDefault();
    clearFormErrors();
    const alert = get('apply-form-alert');
    alert.classList.add('hidden');

    const fullName = get('apply-fullname').value.trim();
    const email = get('apply-email').value.trim();
    const phone = get('apply-phone').value.trim();
    const fileInput = get('apply-cvfile');
    const honeypot = get('apply-honeypot').value.trim();

    let hasError = false;
    if (!fullName) {
      showError('apply-fullname', 'Vui lòng nhập họ và tên.');
      hasError = true;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('apply-email', 'Vui lòng nhập email hợp lệ.');
      hasError = true;
    }
    if (!phone || phone.length < 8) {
      showError('apply-phone', 'Vui lòng nhập số điện thoại hợp lệ.');
      hasError = true;
    }
    if (!fileInput.files || !fileInput.files.length) {
      showError('apply-cvfile', 'Vui lòng chọn tệp CV (.pdf hoặc .docx).');
      hasError = true;
    } else {
      const file = fileInput.files[0];
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.pdf', '.docx'].includes(ext)) {
        showError('apply-cvfile', 'Chỉ chấp nhận tệp định dạng PDF hoặc DOCX.');
        hasError = true;
      } else if (file.size > 10 * 1024 * 1024) {
        showError('apply-cvfile', 'Dung lượng tệp CV không được vượt quá 10MB.');
        hasError = true;
      }
    }

    if (hasError) return;

    const submitBtn = get('btn-submit-apply');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Đang gửi hồ sơ...</span>';

    try {
      const formData = new FormData();
      formData.append('jobPostingId', get('apply-job-id').value);
      formData.append('fullName', fullName);
      formData.append('email', email);
      formData.append('phoneNumber', phone);
      formData.append('source', get('apply-source').value);
      formData.append('coverLetter', get('apply-coverletter').value);
      formData.append('cvFile', fileInput.files[0]);
      if (honeypot) formData.append('website', honeypot);

      const res = await window.ATS_API.applyJobApi(formData);
      if (res.ok && res.data?.data) {
        // Show Success Screen
        get('form-apply-job').classList.add('hidden');
        get('apply-success-screen').classList.remove('hidden');
        get('success-tracking-code').textContent = res.data.data.trackingCode;
      } else {
        alert.textContent = res.data?.message || 'Không thể gửi hồ sơ. Vui lòng kiểm tra lại thông tin.';
        alert.className = 'alert alert-danger';
        alert.style.background = '#fee2e2';
        alert.style.color = '#991b1b';
        alert.classList.remove('hidden');
      }
    } catch (err) {
      alert.textContent = 'Lỗi kết nối khi gửi hồ sơ. Vui lòng thử lại sau.';
      alert.className = 'alert alert-danger';
      alert.style.background = '#fee2e2';
      alert.style.color = '#991b1b';
      alert.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Gửi hồ sơ ứng tuyển</span>';
    }
  }

  function showError(fieldId, msg) {
    const el = get(`err-${fieldId}`);
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  }

  // --- Modal: Status Lookup Logic ---

  function openLookupModal() {}
  function closeLookupModal() {}
  function handleLookupSubmit() {}
  function openWithdrawModal() {}
  function closeWithdrawModal() {}
  function handleConfirmWithdraw() {}

  function initEvents() {
    get('public-jobs-back')?.addEventListener('click', () => window.ATS_ROUTER.navigate('/careers/jobs'));
    get('public-jobs-filter-form')?.addEventListener('submit', e => {
      e.preventDefault();
      load(1);
    });
    get('btn-filter-reset')?.addEventListener('click', () => {
      get('filter-search').value = '';
      get('filter-department').value = '';
      get('filter-location').value = '';
      get('filter-mode').value = '';
      load(1);
    });

    // Lookup Modal events
    get('btn-public-lookup')?.addEventListener('click', openLookupModal);
    get('btn-close-lookup-modal')?.addEventListener('click', closeLookupModal);
    get('btn-cancel-lookup')?.addEventListener('click', closeLookupModal);
    get('form-status-lookup')?.addEventListener('submit', handleLookupSubmit);

    // Apply Modal events
    get('btn-close-apply-modal')?.addEventListener('click', closeApplyModal);
    get('btn-cancel-apply')?.addEventListener('click', closeApplyModal);
    get('btn-finish-apply')?.addEventListener('click', () => {
      closeApplyModal();
      load(1);
    });
    get('form-apply-job')?.addEventListener('submit', handleApplySubmit);

    // Withdraw Modal events
    get('btn-cancel-withdraw')?.addEventListener('click', closeWithdrawModal);
    get('btn-confirm-withdraw')?.addEventListener('click', handleConfirmWithdraw);
  }

  initEvents();

  window.ATS_PUBLIC_JOBS_PAGE = {
    load,
    leave() {
      generation++;
      closeApplyModal();
      closeLookupModal();
      closeWithdrawModal();
    }
  };
})();
