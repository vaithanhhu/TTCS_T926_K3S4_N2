  // ==============================================================================
  // 17. CANDIDATE, INTERVIEW & OFFER MODALS & ACTIONS
  // ==============================================================================

  // --- CANDIDATE MODALS ---
  const openCreateCandidateModalBtn = document.getElementById('open-create-candidate-modal-btn');
  const createCandidateModal = document.getElementById('create-candidate-modal');
  const closeCreateCandidateModal = document.getElementById('close-create-candidate-modal');
  const cancelCreateCandidateBtn = document.getElementById('cancel-create-candidate-btn');
  const createCandidateForm = document.getElementById('create-candidate-form');
  const createCandidateAlert = document.getElementById('create-candidate-alert');
  const createCandidateAlertMsg = document.getElementById('create-candidate-alert-msg');
  const createCandidateSourceSelect = document.getElementById('create-cand-source-select');

  if (openCreateCandidateModalBtn) {
    openCreateCandidateModalBtn.addEventListener('click', async () => {
      if (createCandidateModal) createCandidateModal.classList.remove('hidden');
      if (createCandidateForm) createCandidateForm.reset();
      if (createCandidateAlert) createCandidateAlert.classList.add('hidden');

      const reqSelect = document.getElementById('create-cand-req-select');
      if (reqSelect) {
        reqSelect.innerHTML = `<option value="">-- Chọn vị trí tuyển dụng --</option>` +
          currentRequisitionsList.map(r => `<option value="${r.id}">${r.code} - ${r.title}</option>`).join('');
      }

      const token = sessionStorage.getItem('ats_token');

      if (token && createCandidateSourceSelect) {
        try {
          const sourceRes = await window.ATS_API.getRecruitmentCatalogsApi(token, {
            type: 'CANDIDATE_SOURCE',
            status: 'ACTIVE'
          });

          const sources =
            sourceRes.ok && sourceRes.data && sourceRes.data.success
              ? sourceRes.data.items || []
              : [];

          createCandidateSourceSelect.innerHTML =
            '<option value="">-- Chưa xác định --</option>' +
            sources.map(item =>
              `<option value="${item.id}">${escapeRecruitmentCatalogHtml(item.name)}</option>`
            ).join('');
        } catch {
          createCandidateSourceSelect.innerHTML =
            '<option value="">-- Không tải được nguồn ứng viên --</option>';
        }
      }
    });
  }

  function closeCreateCandidate() {
    if (createCandidateModal) createCandidateModal.classList.add('hidden');
  }
  if (closeCreateCandidateModal) closeCreateCandidateModal.addEventListener('click', closeCreateCandidate);
  if (cancelCreateCandidateBtn) cancelCreateCandidateBtn.addEventListener('click', closeCreateCandidate);

  if (createCandidateForm) {
    createCandidateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const fullName = document.getElementById('create-cand-fullname').value.trim();
      const email = document.getElementById('create-cand-email').value.trim();
      const phoneNumber = document.getElementById('create-cand-phone').value.trim();
      const requisitionId = document.getElementById('create-cand-req-select').value;
      const stage = document.getElementById('create-cand-stage-select').value;
      const rating = parseInt(document.getElementById('create-cand-rating').value, 10);
      const experienceYears = parseInt(document.getElementById('create-cand-exp').value, 10) || 0;
      const expectedSalary = document.getElementById('create-cand-salary').value.trim();
      const notes = document.getElementById('create-cand-notes').value.trim();
      const sourceId = createCandidateSourceSelect ? createCandidateSourceSelect.value : null;

      try {
        const res = await window.ATS_API.createCandidateApi(token, {
          fullName, email, phoneNumber, requisitionId, stage, rating, experienceYears, expectedSalary, notes, sourceId: sourceId || null
        });

        if (res.ok && res.data && res.data.success) {
          closeCreateCandidate();
          showToast('success', 'Thêm ứng viên thành công', `Hồ sơ ứng viên ${fullName} đã được lưu vào hệ thống.`);
          loadCandidates();
          loadDashboardData();
        } else {
          if (createCandidateAlert && createCandidateAlertMsg) {
            createCandidateAlertMsg.textContent = res.data.message || 'Không thể tạo hồ sơ ứng viên.';
            createCandidateAlert.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (createCandidateAlert && createCandidateAlertMsg) {
          createCandidateAlertMsg.textContent = 'Lỗi kết nối khi gửi dữ liệu.';
          createCandidateAlert.classList.remove('hidden');
        }
      }
    });
  }

  // Candidate Details Modal
  const candidateDetailModal = document.getElementById('candidate-detail-modal');
  const closeCandidateDetailModal = document.getElementById('close-candidate-detail-modal');
  const candDetailSaveStageBtn = document.getElementById('cand-detail-save-stage-btn');
  const candDetailScheduleBtn = document.getElementById('cand-detail-schedule-btn');
  const candDetailOfferBtn = document.getElementById('cand-detail-offer-btn');
  const candDetailSource = document.getElementById('cand-detail-source');
  const candDetailRejectionReasonGroup = document.getElementById('cand-detail-rejection-reason-group');
  const candDetailRejectionReasonSelect = document.getElementById('cand-detail-rejection-reason-select');
  const candDetailRejectionNotesGroup = document.getElementById('cand-detail-rejection-notes-group');
  const candDetailRejectionNotesInput = document.getElementById('cand-detail-rejection-notes-input');
  const candDetailExceptionBanner = document.getElementById('cand-detail-exception-banner');
  const candDetailExceptionRecruiterBox = document.getElementById('cand-detail-exception-recruiter-box');
  const candDetailExceptionReasonInput = document.getElementById('cand-detail-exception-reason-input');
  const candDetailSendExceptionBtn = document.getElementById('cand-detail-send-exception-btn');
  const candDetailExceptionPendingBox = document.getElementById('cand-detail-exception-pending-box');
  const candDetailExceptionManagerBox = document.getElementById('cand-detail-exception-manager-box');
  const candDetailExceptionManagerInfo = document.getElementById('cand-detail-exception-manager-info');
  const candDetailExceptionCommentInput = document.getElementById('cand-detail-exception-comment-input');
  const candDetailApproveExceptionBtn = document.getElementById('cand-detail-approve-exception-btn');
  const candDetailRejectExceptionBtn = document.getElementById('cand-detail-reject-exception-btn');
  const candDetailHistoryList = document.getElementById('cand-detail-history-list');
  const candDetailHistoryCount = document.getElementById('cand-detail-history-count');
  let canEditCandidateRejectionReason = false;
  let candidateDetailsGeneration=0;
  window.ATS_CANDIDATE_DETAILS={leave(){candidateDetailsGeneration++;}};

  async function openCandidateDetails(id) {
    const generation=++candidateDetailsGeneration,token=sessionStorage.getItem('ats_token'),view=currentActiveView;candidateDetailModal?.classList.add('hidden');
    const result=await window.ATS_API.getCandidateByIdApi(token,id);
    if(generation!==candidateDetailsGeneration||token!==sessionStorage.getItem('ats_token')||view!==currentActiveView)return;
    if(!result.ok||!result.data?.success){showToast('danger','Không thể mở hồ sơ',result.data?.message||'Không thể tải hồ sơ ứng viên.');return;}
    const c=result.data.data;
    const publicProfile = Boolean(c.status && !c.stage);

    const name = c.fullName || c.full_name || 'Ứng viên';
    const avatar = document.getElementById('cand-detail-avatar');
    const nameEl = document.getElementById('cand-detail-name');
    const codeEl = document.getElementById('cand-detail-code');
    const reqTitleEl = document.getElementById('cand-detail-req-title');
    const emailEl = document.getElementById('cand-detail-email');
    const phoneEl = document.getElementById('cand-detail-phone');
    const stageBadge = document.getElementById('cand-detail-stage-badge');
    const idInput = document.getElementById('cand-detail-id');
    const stageSelect = document.getElementById('cand-detail-change-stage-select');
    const ratingEl = document.getElementById('cand-detail-rating');

    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = name;
    if (codeEl) codeEl.textContent = formatCandCode(c);
    if (reqTitleEl) reqTitleEl.textContent = (c.requisition && c.requisition.title) ? c.requisition.title : (c.requisition_title || 'Chưa gắn vị trí');
    if (emailEl) emailEl.textContent = c.email || '—';
    if (phoneEl) phoneEl.textContent = c.phoneNumber || c.phone || 'Chưa cập nhật';
    if (candDetailSource) {
      candDetailSource.textContent =
        c.sourceName || c.source_name || 'Chưa xác định';
    }
    if (stageBadge) {
      stageBadge.className = `badge ${STAGE_BADGES[c.stage] || 'badge-neutral'}`;
      stageBadge.textContent = c.statusLabel || STAGE_LABELS[c.stage] || c.stage || '—';
    }
    if (idInput) idInput.value = c.id;
    if (stageSelect) { stageSelect.value = c.stage || ''; stageSelect.disabled = publicProfile; }
    if (candDetailSaveStageBtn) candDetailSaveStageBtn.disabled = publicProfile;
    if (ratingEl) ratingEl.textContent = publicProfile ? '—' : '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));

    canEditCandidateRejectionReason = false;
    if (candDetailRejectionReasonSelect) candDetailRejectionReasonSelect.disabled = true;
    if (candDetailRejectionReasonGroup) {
      candDetailRejectionReasonGroup.classList.toggle('hidden', true);
    }
    if (candDetailRejectionNotesGroup) candDetailRejectionNotesGroup.classList.add('hidden');
    if (candDetailRejectionNotesInput) candDetailRejectionNotesInput.value = '';
    if (candDetailExceptionBanner) candDetailExceptionBanner.classList.add('hidden');
    if (candDetailExceptionReasonInput) candDetailExceptionReasonInput.value = '';
    if (candDetailExceptionCommentInput) candDetailExceptionCommentInput.value = '';

    if (candDetailRejectionReasonSelect && !publicProfile) {
      const token = sessionStorage.getItem('ats_token');

      candDetailRejectionReasonSelect.innerHTML =
        '<option value="">-- Chọn lý do loại --</option>';

      if (token) {
        try {
          const [permissionsRes, reasonRes] = await Promise.all([
            window.ATS_API.getPermissionsApi(token),
            window.ATS_API.getRejectionReasonsApi ? window.ATS_API.getRejectionReasonsApi(token) : window.ATS_API.getRecruitmentCatalogsApi(token, { type: 'REJECTION_REASON' })
          ]);
          canEditCandidateRejectionReason = permissionsRes.ok && Array.isArray(permissionsRes.data?.permissions) && permissionsRes.data.permissions.includes('candidate.update');
          candDetailRejectionReasonSelect.disabled = !canEditCandidateRejectionReason;
          if (candDetailRejectionReasonGroup) candDetailRejectionReasonGroup.classList.toggle('hidden', !canEditCandidateRejectionReason || c.stage !== 'REJECTED');

          const reasons =
            reasonRes.ok &&
            reasonRes.data &&
            reasonRes.data.success
              ? (reasonRes.data.items || [])
              : [];

          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Chọn lý do loại --</option>' +
            reasons.map(item => {
              const selected =
                item.id === c.rejectionReasonId
                  ? 'selected'
                  : '';

              const disabled =
                item.status !== 'ACTIVE' &&
                item.id !== c.rejectionReasonId
                  ? 'disabled'
                  : '';

              const suffix =
                item.status === 'ACTIVE'
                  ? ''
                  : ' (Ngừng áp dụng)';

              return `<option value="${item.id}" data-code="${escapeHtml(item.code || '')}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
            }).join('');

          // Show rejection note if current reason is Khác
          if (c.stage === 'REJECTED') {
            const selOpt = candDetailRejectionReasonSelect.options[candDetailRejectionReasonSelect.selectedIndex];
            const isOther = selOpt && (selOpt.text.toLowerCase().includes('khác') || selOpt.dataset.code === 'REJ-OTHER' || selOpt.value === 'cat-rej-other');
            if (candDetailRejectionNotesGroup) {
              candDetailRejectionNotesGroup.classList.toggle('hidden', !isOther);
              if (candDetailRejectionNotesInput && c.notes) {
                candDetailRejectionNotesInput.value = c.notes;
              }
            }
          }
        } catch {
          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Không tải được lý do loại --</option>';
        }
      }
    }

    // S5-03: Load stage transition history & exceptions
    if (!publicProfile && token) {
      loadCandidateStageHistory(id, token);
      loadCandidateExceptions(id, token, c.stage);
    }

    // S4-09: Load Unified Profile & Multi-Application History
    if (publicProfile) {
      for (const id of ['cand-detail-documents-list','cand-detail-unified-apps','cand-detail-tags-list','cand-detail-notes-list']) {
        const element = document.getElementById(id);
        if (element) element.textContent = '—';
      }
      document.getElementById('cand-detail-parsed-box')?.classList.add('hidden');
    } else loadCandidateUnifiedProfile(id, token);

    loadCandidateOnboarding(c, token);

    if(generation!==candidateDetailsGeneration||token!==sessionStorage.getItem('ats_token')||view!==currentActiveView)return;
    if (candidateDetailModal) candidateDetailModal.classList.remove('hidden');
  }

  async function downloadCandidateCv(button, token) {
    if (button.disabled || token !== sessionStorage.getItem('ats_token')) return;
    button.disabled = true;
    const preview = window.open('about:blank', '_blank');
    if (preview) preview.opener = null;
    let objectUrl;
    try {
      const result = await window.ATS_API.downloadCandidateCvApi(token, button.dataset.cvDownload);
      if (!result.ok || token !== sessionStorage.getItem('ats_token')) {
        preview?.close();
        if (token === sessionStorage.getItem('ats_token')) window.alert(result.data?.message || 'Không thể tải tài liệu.');
        return;
      }
      objectUrl = URL.createObjectURL(result.blob);
      if (result.mimeType === 'application/pdf' && preview && !preview.closed) {
        preview.location.replace(objectUrl);
        const url = objectUrl;
        objectUrl = null;
        const release = () => { clearInterval(timer); URL.revokeObjectURL(url); window.removeEventListener('pagehide', release); };
        const timer = setInterval(() => { if (preview.closed) release(); }, 500);
        window.addEventListener('pagehide', release, { once: true });
      } else {
        preview?.close();
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = result.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        const url = objectUrl;
        objectUrl = null;
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { preview?.close(); window.alert('Không thể tải tài liệu.'); }
    finally { if (objectUrl) URL.revokeObjectURL(objectUrl); button.disabled = false; }
  }

  async function loadCandidateUnifiedProfile(id, token) {
    const generation = candidateDetailsGeneration;
    const docsList = document.getElementById('cand-detail-documents-list');
    const appsList = document.getElementById('cand-detail-unified-apps');
    const tagsList = document.getElementById('cand-detail-tags-list');
    const notesList = document.getElementById('cand-detail-notes-list');
    const parsedBox = document.getElementById('cand-detail-parsed-box');
    if (parsedBox) parsedBox.classList.add('hidden');

    if (!token || !id) return;

    try {
      const res = await window.ATS_API.getUnifiedProfileApi(token, id);
      if (generation !== candidateDetailsGeneration || token !== sessionStorage.getItem('ats_token')) return;
      if (res.ok && res.data?.data) {
        const u = res.data.data;

        // 1. Documents
        if (docsList) {
          if (!u.documents || !u.documents.length) {
            docsList.innerHTML = '<span style="color:var(--color-text-muted);">Chưa có tệp CV nào được tải lên.</span>';
          } else {
            docsList.innerHTML = u.documents.map(d => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--color-bg-page);border-radius:4px;margin-bottom:4px;">
                <div>
                  <span style="font-weight:600;">📄 ${escapeHtml(d.fileName)}</span>
                  <span style="font-size:0.75rem;color:var(--color-text-muted);margin-left:6px;">(${Math.round(d.fileSize/1024)} KB)</span>
                </div>
                <button type="button" data-cv-download="${escapeHtml(d.id)}" class="btn btn-outline btn-xs">⬇️ Xem / Tải CV</button>
              </div>
            `).join('');
            docsList.querySelectorAll('[data-cv-download]').forEach(button => button.addEventListener('click', () => downloadCandidateCv(button, token)));
          }
        }

        // 2. Multi-application history
        if (appsList) {
          if (!u.applications || !u.applications.length) {
            appsList.innerHTML = '<span style="color:var(--color-text-muted);">Chưa có lịch sử ứng tuyển.</span>';
          } else {
            appsList.innerHTML = `
              <div style="display:flex;flex-direction:column;gap:6px;">
                ${u.applications.map(a => `
                  <div style="padding:8px 10px;background:var(--color-bg-page);border:1px solid var(--color-border);border-radius:4px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                      <div style="font-weight:600;">${escapeHtml(a.requisitionTitle || 'Vị trí tuyển dụng')} <span style="font-size:0.75rem;color:var(--color-text-muted);">(${escapeHtml(a.requisitionCode || '')})</span></div>
                      <div style="font-size:0.75rem;color:var(--color-text-muted);">
                        Phòng ban: ${escapeHtml(a.departmentName || '—')} | Mã tra cứu: <code>${escapeHtml(a.trackingCode || '—')}</code>
                        ${a.isInternalReferral ? ` | <span style="color:#2563eb;font-weight:600;">🤝 Giới thiệu bởi: ${escapeHtml(a.referrerName || 'Nội bộ')}</span>` : ''}
                      </div>
                    </div>
                    <div>
                      <span class="badge ${STAGE_BADGES[a.stage] || 'badge-neutral'}" style="font-size:0.75rem;">${STAGE_LABELS[a.stage] || a.stage}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            `;
          }
        }

        // 3. Tags
        renderCandidateTags(u.tags || [], id, token);

        // 4. Notes
        renderCandidateNotes(u.notes || []);
      }
    } catch (err) {
      console.warn('[Unified Profile Load Error]', err);
    }
  }

  function renderCandidateTags(tags, candidateId, token) {
    const tagsList = document.getElementById('cand-detail-tags-list');
    if (!tagsList) return;
    if (!tags.length) {
      tagsList.innerHTML = '<span style="font-size:0.8rem;color:var(--color-text-muted);">Chưa có nhãn nào.</span>';
      return;
    }
    tagsList.innerHTML = tags.map(t => `
      <span class="badge badge-outline" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:0.8rem;background:var(--color-bg-page);">
        ${escapeHtml(t.tagName)}
        <button type="button" class="btn-remove-tag" data-tag="${escapeHtml(t.tagName)}" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:0;font-size:0.85rem;line-height:1;">✕</button>
      </span>
    `).join('');

    tagsList.querySelectorAll('.btn-remove-tag').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tag = btn.getAttribute('data-tag');
        const res = await window.ATS_API.removeCandidateTagApi(token, candidateId, tag);
        if (res.ok) {
          loadCandidateUnifiedProfile(candidateId, token);
        }
      });
    });
  }

  function renderCandidateNotes(notes) {
    const notesList = document.getElementById('cand-detail-notes-list');
    if (!notesList) return;
    if (!notes.length) {
      notesList.innerHTML = '<span style="font-size:0.8rem;color:var(--color-text-muted);">Chưa có ghi chú nội bộ nào.</span>';
      return;
    }
    notesList.innerHTML = notes.map(n => `
      <div style="padding:6px 10px;background:var(--color-bg-page);border-left:3px solid var(--color-primary);border-radius:2px;font-size:0.825rem;">
        <div style="display:flex;justify-content:space-between;color:var(--color-text-muted);font-size:0.75rem;margin-bottom:2px;">
          <strong>${escapeHtml(n.authorName || 'Nhân sự')}</strong>
          <span>${n.createdAt ? new Date(n.createdAt).toLocaleString('vi-VN') : ''}</span>
        </div>
        <div style="color:var(--color-text);">${escapeHtml(n.text || '')}</div>
      </div>
    `).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // --- S4-04: Parse CV PDF Button ---
  const parseCvBtn = document.getElementById('cand-detail-parse-cv-btn');
  if (parseCvBtn) {
    parseCvBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id')?.value;
      if (!token || !id) return;

      parseCvBtn.disabled = true;
      parseCvBtn.textContent = '⏳ Đang bóc tách CV...';

      try {
        const res = await window.ATS_API.parseCvPdfApi(token, id);
        if (res.ok && res.data?.parsedData) {
          const p = res.data.parsedData;
          document.getElementById('parsed-cand-name').textContent = p.name || 'Không tìm thấy';
          document.getElementById('parsed-cand-email').textContent = p.email || 'Không tìm thấy';
          document.getElementById('parsed-cand-phone').textContent = p.phoneNumber || 'Không tìm thấy';
          document.getElementById('cand-detail-parsed-box')?.classList.remove('hidden');
          showToast('success', 'Bóc tách CV thành công', 'Đã trích xuất thông tin sơ bộ từ tệp CV để recruiter đối chiếu.');
        } else {
          showToast('warning', 'Không thể bóc tách CV', res.data?.message || 'Tệp CV không chứa văn bản đọc được hoặc không phải định dạng PDF hợp lệ.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      } finally {
        parseCvBtn.disabled = false;
        parseCvBtn.textContent = '🔍 Bóc tách thông tin từ CV (PDF)';
      }
    });
  }

  // --- Add Tag & Add Note Listeners ---
  const addTagBtn = document.getElementById('cand-detail-add-tag-btn');
  if (addTagBtn) {
    addTagBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id')?.value;
      const input = document.getElementById('cand-detail-new-tag-input');
      const val = input?.value.trim();
      if (!token || !id || !val) return;

      const res = await window.ATS_API.addCandidateTagApi(token, id, val);
      if (res.ok) {
        input.value = '';
        loadCandidateUnifiedProfile(id, token);
      } else {
        showToast('danger', 'Không thể thêm nhãn', res.data?.message || 'Lỗi thêm nhãn.');
      }
    });
  }

  const addNoteBtn = document.getElementById('cand-detail-add-note-btn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id')?.value;
      const input = document.getElementById('cand-detail-new-note-input');
      const val = input?.value.trim();
      if (!token || !id || !val) return;

      const res = await window.ATS_API.addCandidateNoteApi(token, id, val);
      if (res.ok) {
        input.value = '';
        loadCandidateUnifiedProfile(id, token);
      } else {
        showToast('danger', 'Không thể thêm ghi chú', res.data?.message || 'Lỗi thêm ghi chú.');
      }
    });
  }

  // S5-03: Stage Transition History Loader
  async function loadCandidateStageHistory(id, token) {
    if (!candDetailHistoryList || !token || !id) return;
    try {
      const res = await window.ATS_API.getCandidateStageHistoryApi(token, id);
      if (res.ok && res.data?.history) {
        const history = res.data.history;
        if (candDetailHistoryCount) candDetailHistoryCount.textContent = `${history.length} lần chuyển`;
        if (!history.length) {
          candDetailHistoryList.innerHTML = '<span style="font-size:0.8rem;color:var(--color-text-muted);">Chưa có nhật ký chuyển giai đoạn.</span>';
          return;
        }

        candDetailHistoryList.innerHTML = history.map(h => {
          const timeStr = h.createdAt ? new Date(h.createdAt).toLocaleString('vi-VN') : '—';
          const beforeBadge = `<span class="badge ${STAGE_BADGES[h.beforeStage] || 'badge-neutral'}" style="font-size:0.75rem;">${STAGE_LABELS[h.beforeStage] || h.beforeStage}</span>`;
          const afterBadge = `<span class="badge ${STAGE_BADGES[h.afterStage] || 'badge-neutral'}" style="font-size:0.75rem;">${STAGE_LABELS[h.afterStage] || h.afterStage}</span>`;

          let detailsHtml = '';
          if (h.rejectionReasonName) {
            detailsHtml += `<div style="color:#b91c1c;margin-top:2px;font-size:0.8rem;">❌ <strong>Lý do loại:</strong> ${escapeHtml(h.rejectionReasonName)}</div>`;
          }
          if (h.notes) {
            detailsHtml += `<div style="color:var(--color-text-secondary);margin-top:2px;font-size:0.8rem;">📝 <strong>Ghi chú:</strong> ${escapeHtml(h.notes)}</div>`;
          }
          if (h.skippedInterviewApprovedBy) {
            const approvedTime = h.skippedInterviewApprovedAt ? new Date(h.skippedInterviewApprovedAt).toLocaleString('vi-VN') : '';
            detailsHtml += `<div style="color:#047857;margin-top:2px;font-size:0.8rem;">🛡️ <strong>Xác nhận ngoại lệ bỏ qua phỏng vấn:</strong> ${escapeHtml(h.skippedInterviewApprovedName || h.skippedInterviewApprovedBy)} ${approvedTime ? `(${approvedTime})` : ''}</div>`;
          }

          return `
            <div style="padding:8px 10px;background:var(--color-bg-page);border:1px solid var(--color-border);border-left:3px solid var(--color-primary);border-radius:4px;font-size:0.825rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
                <div style="display:flex;align-items:center;gap:6px;">
                  ${beforeBadge} <span>➔</span> ${afterBadge}
                </div>
                <div style="font-size:0.75rem;color:var(--color-text-muted);">
                  ${timeStr}
                </div>
              </div>
              <div style="font-size:0.8rem;color:var(--color-text-muted);">
                Người thực hiện: <strong style="color:var(--color-text);">${escapeHtml(h.actorName || h.actorId || 'Hệ thống')}</strong>
              </div>
              ${detailsHtml}
            </div>
          `;
        }).join('');
      } else {
        candDetailHistoryList.innerHTML = '<span style="font-size:0.8rem;color:var(--color-text-muted);">Không thể tải lịch sử chuyển giai đoạn.</span>';
      }
    } catch {
      candDetailHistoryList.innerHTML = '<span style="font-size:0.8rem;color:var(--color-text-muted);">Lỗi kết nối khi tải lịch sử.</span>';
    }
  }

  // S5-03: Stage Exceptions Loader
  async function loadCandidateExceptions(id, token, currentCandidateStage) {
    if (!candDetailExceptionBanner || !token || !id) return;

    candDetailExceptionBanner.classList.add('hidden');
    candDetailExceptionRecruiterBox?.classList.add('hidden');
    candDetailExceptionPendingBox?.classList.add('hidden');
    candDetailExceptionManagerBox?.classList.add('hidden');

    try {
      const res = await window.ATS_API.getCandidateStageExceptionsApi(token, id);
      if (res.ok && Array.isArray(res.data?.items)) {
        const pending = res.data.items.find(e => e.status === 'PENDING' && e.from_stage === currentCandidateStage);
        if (pending) {
          candDetailExceptionBanner.classList.remove('hidden');
          const isManager = currentAuthenticatedUser?.roles?.some(r => ['HR_MANAGER', 'ADMIN'].includes(r));
          if (isManager) {
            candDetailExceptionManagerBox?.classList.remove('hidden');
            if (candDetailExceptionManagerInfo) {
              candDetailExceptionManagerInfo.textContent = `Yêu cầu từ: ${escapeHtml(pending.requester_name)} - Lý do: "${escapeHtml(pending.reason)}" (${new Date(pending.created_at).toLocaleString('vi-VN')})`;
            }
            if (candDetailExceptionManagerBox) {
              candDetailExceptionManagerBox.dataset.exceptionId = pending.id;
            }
          } else {
            candDetailExceptionPendingBox?.classList.remove('hidden');
            candDetailExceptionPendingBox.textContent = `⏳ Đã gửi yêu cầu bỏ qua phỏng vấn ngày ${new Date(pending.created_at).toLocaleString('vi-VN')} (Lý do: "${escapeHtml(pending.reason)}"). Đang chờ Trưởng phòng Nhân sự phê duyệt.`;
          }
        }
      }
    } catch (err) {
      console.warn('[Exceptions Load Error]', err);
    }
  }

  const candDetailStageSelect =
    document.getElementById('cand-detail-change-stage-select');

  if (candDetailStageSelect) {
    candDetailStageSelect.addEventListener('change', () => {
      if (candDetailRejectionReasonGroup) {
        candDetailRejectionReasonGroup.classList.toggle(
          'hidden',
          !canEditCandidateRejectionReason || candDetailStageSelect.value !== 'REJECTED'
        );
      }

      if (candDetailStageSelect.value !== 'REJECTED') {
        if (candDetailRejectionReasonSelect) candDetailRejectionReasonSelect.value = '';
        if (candDetailRejectionNotesGroup) candDetailRejectionNotesGroup.classList.add('hidden');
        if (candDetailRejectionNotesInput) candDetailRejectionNotesInput.value = '';
      }
    });
  }

  if (candDetailRejectionReasonSelect) {
    candDetailRejectionReasonSelect.addEventListener('change', () => {
      const selectedOpt = candDetailRejectionReasonSelect.options[candDetailRejectionReasonSelect.selectedIndex];
      const isOther = selectedOpt && (selectedOpt.text.toLowerCase().includes('khác') || selectedOpt.dataset.code === 'REJ-OTHER' || selectedOpt.value === 'cat-rej-other');
      if (candDetailRejectionNotesGroup) {
        candDetailRejectionNotesGroup.classList.toggle('hidden', !isOther);
        if (isOther && candDetailRejectionNotesInput) {
          candDetailRejectionNotesInput.focus();
        }
      }
    });
  }

  if (closeCandidateDetailModal) {
    closeCandidateDetailModal.addEventListener('click', () => {
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
    });
  }

  if (candDetailSaveStageBtn) {
    candDetailSaveStageBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id').value;
      const stage = document.getElementById('cand-detail-change-stage-select').value;
      let rejectionReasonId = null;
      let notes = '';

      if (stage === 'REJECTED') {
        rejectionReasonId = candDetailRejectionReasonSelect ? candDetailRejectionReasonSelect.value : null;
        if (!rejectionReasonId) {
          showToast('danger', 'Chưa chọn lý do loại', 'Chuyển sang "Loại" bắt buộc chọn lý do từ danh mục.');
          candDetailRejectionReasonSelect?.focus();
          return;
        }

        const selectedOpt = candDetailRejectionReasonSelect.options[candDetailRejectionReasonSelect.selectedIndex];
        const isOther = selectedOpt && (selectedOpt.text.toLowerCase().includes('khác') || selectedOpt.dataset.code === 'REJ-OTHER' || selectedOpt.value === 'cat-rej-other');
        notes = candDetailRejectionNotesInput?.value?.trim() || '';

        if (isOther && !notes) {
          showToast('danger', 'Thiếu giải thích lý do', 'Vui lòng nhập nội dung giải thích chi tiết khi chọn lý do loại là "Khác".');
          candDetailRejectionNotesInput?.focus();
          return;
        }
      }

      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateCandidateStageApi(
          token,
          id,
          stage,
          notes || undefined,
          rejectionReasonId || undefined
        );

        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Chuyển vòng thành công', `Đã cập nhật trạng thái ứng viên sang "${STAGE_LABELS[stage] || stage}".`);
          if (candDetailExceptionBanner) candDetailExceptionBanner.classList.add('hidden');
          const stageBadge = document.getElementById('cand-detail-stage-badge');
          if (stageBadge) {
            stageBadge.className = `badge ${STAGE_BADGES[stage] || 'badge-neutral'}`;
            stageBadge.textContent = STAGE_LABELS[stage] || stage;
          }
          loadCandidateStageHistory(id, token);
          loadCandidates();
          loadDashboardData();
        } else {
          if (res.data?.code === 'INTERVIEW_STAGE_REQUIRED') {
            if (candDetailExceptionBanner) candDetailExceptionBanner.classList.remove('hidden');
            const isManager = currentAuthenticatedUser?.roles?.some(r => ['HR_MANAGER', 'ADMIN'].includes(r));
            if (isManager) {
              candDetailExceptionManagerBox?.classList.remove('hidden');
              candDetailExceptionRecruiterBox?.classList.add('hidden');
              candDetailExceptionPendingBox?.classList.add('hidden');
              if (candDetailExceptionManagerInfo) {
                candDetailExceptionManagerInfo.textContent = 'Hồ sơ chưa qua phỏng vấn. Bạn có vai trò Trưởng phòng Nhân sự và có thể xác nhận ngoại lệ để chuyển tiếp.';
              }
            } else {
              candDetailExceptionRecruiterBox?.classList.remove('hidden');
              candDetailExceptionPendingBox?.classList.add('hidden');
              candDetailExceptionManagerBox?.classList.add('hidden');
            }
            showToast('warning', 'Yêu cầu xác nhận ngoại lệ', res.data?.message || 'Cần Trưởng phòng Nhân sự xác nhận ngoại lệ.');
          } else {
            showToast('danger', 'Lỗi cập nhật', res.data?.message || 'Không thể chuyển vòng.');
          }
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  // S5-03: Recruiter sends exception request
  if (candDetailSendExceptionBtn) {
    candDetailSendExceptionBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id').value;
      const reason = candDetailExceptionReasonInput?.value?.trim();
      if (!token || !id) return;
      if (!reason) {
        showToast('danger', 'Thiếu lý do', 'Vui lòng nhập lý do đề xuất bỏ qua vòng phỏng vấn.');
        candDetailExceptionReasonInput?.focus();
        return;
      }

      try {
        const res = await window.ATS_API.requestInterviewSkipExceptionApi(token, id, reason);
        if (res.ok && res.data?.success) {
          showToast('success', 'Đã gửi yêu cầu', 'Yêu cầu ngoại lệ đã được gửi tới Trưởng phòng Nhân sự.');
          candDetailExceptionRecruiterBox?.classList.add('hidden');
          candDetailExceptionPendingBox?.classList.remove('hidden');
          candDetailExceptionPendingBox.textContent = '⏳ Yêu cầu bỏ qua phỏng vấn đang chờ Trưởng phòng Nhân sự xem xét.';
          loadCandidateStageHistory(id, token);
        } else {
          showToast('danger', 'Lỗi gửi yêu cầu', res.data?.message || 'Không thể gửi yêu cầu.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  // S5-03: HR Manager approves exception
  if (candDetailApproveExceptionBtn) {
    candDetailApproveExceptionBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id').value;
      const exceptionId = candDetailExceptionManagerBox?.dataset?.exceptionId;
      const comment = candDetailExceptionCommentInput?.value?.trim() || '';
      if (!token || !id) return;

      try {
        if (exceptionId) {
          const decideRes = await window.ATS_API.decideInterviewSkipExceptionApi(token, exceptionId, 'APPROVE', comment);
          if (!decideRes.ok || !decideRes.data?.success) {
            showToast('danger', 'Lỗi phê duyệt', decideRes.data?.message || 'Không thể phê duyệt yêu cầu.');
            return;
          }
        }

        // Advance to OFFER
        const updateRes = await window.ATS_API.updateCandidateStageApi(token, id, 'OFFER', comment || undefined);
        if (updateRes.ok && updateRes.data?.success) {
          showToast('success', 'Xác nhận ngoại lệ thành công', 'Đã phê duyệt ngoại lệ và chuyển ứng viên sang Đề xuất offer.');
          if (candDetailExceptionBanner) candDetailExceptionBanner.classList.add('hidden');
          const stageBadge = document.getElementById('cand-detail-stage-badge');
          if (stageBadge) {
            stageBadge.className = `badge ${STAGE_BADGES['OFFER'] || 'badge-neutral'}`;
            stageBadge.textContent = STAGE_LABELS['OFFER'] || 'OFFER';
          }
          const stageSelect = document.getElementById('cand-detail-change-stage-select');
          if (stageSelect) stageSelect.value = 'OFFER';
          loadCandidateStageHistory(id, token);
          loadCandidates();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi chuyển giai đoạn', updateRes.data?.message || 'Không thể chuyển sang OFFER.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  // S5-03: HR Manager rejects exception
  if (candDetailRejectExceptionBtn) {
    candDetailRejectExceptionBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      const id = document.getElementById('cand-detail-id').value;
      const exceptionId = candDetailExceptionManagerBox?.dataset?.exceptionId;
      const comment = candDetailExceptionCommentInput?.value?.trim() || '';
      if (!token || !id || !exceptionId) return;

      try {
        const decideRes = await window.ATS_API.decideInterviewSkipExceptionApi(token, exceptionId, 'REJECT', comment);
        if (decideRes.ok && decideRes.data?.success) {
          showToast('info', 'Đã từ chối', 'Đã từ chối yêu cầu bỏ qua phỏng vấn.');
          if (candDetailExceptionBanner) candDetailExceptionBanner.classList.add('hidden');
          loadCandidateStageHistory(id, token);
        } else {
          showToast('danger', 'Lỗi từ chối', decideRes.data?.message || 'Không thể từ chối yêu cầu.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      }
    });
  }

  if (candDetailScheduleBtn) {
    candDetailScheduleBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id').value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      openScheduleInterviewForCandidate(id);
    });
  }

  if (candDetailOfferBtn) {
    candDetailOfferBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id').value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      openCreateOfferForCandidate(id);
    });
  }

  const candDetailHiringDecisionBtn = document.getElementById('cand-detail-hiring-decision-btn');
  if (candDetailHiringDecisionBtn) {
    candDetailHiringDecisionBtn.addEventListener('click', () => {
      const id = document.getElementById('cand-detail-id')?.value;
      if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
      if (id && window.ATS_APP_HELPERS?.openHiringDecisionModal) {
        window.ATS_APP_HELPERS.openHiringDecisionModal(id);
      }
    });
  }

  const candDetailOnboardingPanel = document.getElementById('cand-detail-onboarding-panel');
  const candOnboardStatusBadge = document.getElementById('cand-onboard-status-badge');
  const candOnboardProgressText = document.getElementById('cand-onboard-progress-text');
  const candOnboardProgressBar = document.getElementById('cand-onboard-progress-bar');
  const candOnboardInitBox = document.getElementById('cand-onboard-init-box');
  const candOnboardTemplateSelect = document.getElementById('cand-onboard-template-select');
  const candOnboardInitBtn = document.getElementById('cand-onboard-init-btn');
  const candOnboardItemsBox = document.getElementById('cand-onboard-items-box');
  const candOnboardTemplateName = document.getElementById('cand-onboard-template-name');
  const candOnboardStartDate = document.getElementById('cand-onboard-start-date');
  const candOnboardCategoriesContainer = document.getElementById('cand-onboard-categories-container');
  let currentOnboardingCandidate = null;

  async function loadCandidateOnboarding(c, token) {
    if (!candDetailOnboardingPanel) return;
    currentOnboardingCandidate = c;
    const isEligible = c.stage === 'HIRED' || c.stage === 'ONBOARDED';
    if (!isEligible) {
      candDetailOnboardingPanel.classList.add('hidden');
      return;
    }
    candDetailOnboardingPanel.classList.remove('hidden');

    try {
      const res = await window.ATS_API.getCandidateOnboardingApi(token, c.id);
      if (res.ok && res.data?.data) {
        const d = res.data.data;
        if (d.hasOnboarding) {
          if (candOnboardInitBox) candOnboardInitBox.classList.add('hidden');
          if (candOnboardItemsBox) candOnboardItemsBox.classList.remove('hidden');

          const pct = d.progressPercentage || 0;
          if (candOnboardProgressText) candOnboardProgressText.textContent = `${pct}% (${d.completedCount || 0}/${d.totalCount || 0} mục)`;
          if (candOnboardProgressBar) candOnboardProgressBar.style.width = `${pct}%`;

          if (candOnboardStatusBadge) {
            if (d.status === 'COMPLETED') {
              candOnboardStatusBadge.className = 'badge badge-success';
              candOnboardStatusBadge.textContent = 'Đã hoàn tất';
            } else {
              candOnboardStatusBadge.className = 'badge badge-primary';
              candOnboardStatusBadge.textContent = 'Đang thực hiện';
            }
          }

          if (candOnboardTemplateName) candOnboardTemplateName.textContent = d.templateName || d.templateId || 'Mẫu theo phòng ban';
          if (candOnboardStartDate) candOnboardStartDate.textContent = d.startDate || '—';

          if (candOnboardCategoriesContainer && d.categories) {
            candOnboardCategoriesContainer.innerHTML = Object.entries(d.categories).map(([catKey, cat]) => {
              const icon = catKey === 'ACCOUNT' ? '🔑' : catKey === 'EQUIPMENT' ? '💻' : catKey === 'WORKSPACE' ? '🏢' : '📄';
              const itemsHtml = (cat.items || []).map(it => {
                const checked = it.status === 'COMPLETED' ? 'checked' : '';
                const disabled = !it.canUpdate ? 'disabled' : '';
                return `
                  <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;background:var(--color-bg-page);border:1px solid var(--color-border);border-radius:4px;font-size:0.825rem;">
                    <input type="checkbox" class="onboard-item-checkbox" data-checklist-id="${d.id}" data-item-id="${it.id}" ${checked} ${disabled} style="margin-top:2px;cursor:${it.canUpdate ? 'pointer' : 'not-allowed'};" />
                    <div style="flex:1;">
                      <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-weight:600;color:var(--color-text);text-decoration:${it.status === 'COMPLETED' ? 'line-through' : 'none'};">${escapeHtml(it.title)}</span>
                        <span class="badge ${it.status === 'COMPLETED' ? 'badge-success' : 'badge-neutral'}" style="font-size:0.7rem;">${it.status === 'COMPLETED' ? 'Xong' : 'Chờ xử lý'}</span>
                      </div>
                      ${it.description ? `<div style="color:var(--color-text-secondary);font-size:0.775rem;margin-top:2px;">${escapeHtml(it.description)}</div>` : ''}
                      <div style="display:flex;gap:12px;color:var(--color-text-muted);font-size:0.75rem;margin-top:3px;">
                        <span>👤 ${escapeHtml(it.assigneeName || 'Chưa phân công')}</span>
                        <span>📅 Hạn: ${it.dueDate || 'Chưa định'}</span>
                        ${it.completedAt ? `<span>✓ Xong lúc: ${new Date(it.completedAt).toLocaleDateString('vi-VN')}</span>` : ''}
                      </div>
                    </div>
                  </div>
                `;
              }).join('');

              return `
                <div style="background:#fff;border:1px solid var(--color-border);border-radius:6px;padding:10px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.85rem;font-weight:600;color:var(--color-text);">
                    <span>${icon} ${escapeHtml(cat.name)}</span>
                    <span style="font-size:0.75rem;color:var(--color-text-muted);">${cat.completed}/${cat.total} mục (${cat.progressPercentage}%)</span>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${itemsHtml || '<span style="color:var(--color-text-muted);font-size:0.8rem;">Không có mục công việc nào.</span>'}
                  </div>
                </div>
              `;
            }).join('');

            candOnboardCategoriesContainer.querySelectorAll('.onboard-item-checkbox').forEach(cb => {
              cb.addEventListener('change', async () => {
                const ckId = cb.getAttribute('data-checklist-id');
                const itId = cb.getAttribute('data-item-id');
                const newStatus = cb.checked ? 'COMPLETED' : 'PENDING';
                try {
                  const upRes = await window.ATS_API.updateOnboardingChecklistItemApi(token, ckId, itId, { status: newStatus });
                  if (upRes.ok && upRes.data?.success) {
                    showToast('success', 'Đã cập nhật', 'Tiến độ onboarding đã được cập nhật.');
                    await loadCandidateOnboarding(c, token);
                    if (upRes.data.data?.status === 'COMPLETED') {
                      const badge = document.getElementById('cand-detail-stage-badge');
                      if (badge) {
                        badge.className = 'badge badge-success';
                        badge.textContent = 'Đã onboard';
                      }
                      const stageSelect = document.getElementById('cand-detail-change-stage-select');
                      if (stageSelect) stageSelect.value = 'ONBOARDED';
                    }
                    if (typeof loadCandidates === 'function') loadCandidates();
                    if (typeof loadDashboardData === 'function') loadDashboardData();
                  } else {
                    cb.checked = !cb.checked;
                    showToast('danger', 'Lỗi cập nhật', upRes.data?.message || 'Không thể cập nhật mục công việc.');
                  }
                } catch (err) {
                  cb.checked = !cb.checked;
                  showToast('danger', 'Lỗi kết nối', err.message);
                }
              });
            });
          }
        } else {
          if (candOnboardInitBox) candOnboardInitBox.classList.remove('hidden');
          if (candOnboardItemsBox) candOnboardItemsBox.classList.add('hidden');

          if (candOnboardTemplateSelect && candOnboardTemplateSelect.children.length <= 1) {
            const tmplRes = await window.ATS_API.getOnboardingTemplatesApi(token, { departmentId: c.requisition?.department_id });
            if (tmplRes.ok && Array.isArray(tmplRes.data?.data)) {
              candOnboardTemplateSelect.innerHTML = '<option value="">-- Chọn mẫu Onboarding --</option>' +
                tmplRes.data.data.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.items?.length || 0} mục)</option>`).join('');
            }
          }
        }
      }
    } catch {}
  }

  if (candOnboardInitBtn) {
    candOnboardInitBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem('ats_token');
      if (!currentOnboardingCandidate || !token) return;
      candOnboardInitBtn.disabled = true;
      try {
        const tmplId = candOnboardTemplateSelect?.value || null;
        const initRes = await window.ATS_API.initializeOnboardingApi(token, {
          candidateId: currentOnboardingCandidate.id,
          templateId: tmplId,
          departmentId: currentOnboardingCandidate.requisition?.department_id || null
        });
        if (initRes.ok && initRes.data?.success) {
          showToast('success', 'Đã khởi tạo Onboarding', 'Quy trình checklist onboarding đã được tạo thành công.');
          await loadCandidateOnboarding(currentOnboardingCandidate, token);
        } else {
          showToast('danger', 'Lỗi khởi tạo', initRes.data?.message || 'Không thể khởi tạo onboarding.');
        }
      } catch (err) {
        showToast('danger', 'Lỗi kết nối', err.message);
      } finally {
        candOnboardInitBtn.disabled = false;
      }
    });
  }
