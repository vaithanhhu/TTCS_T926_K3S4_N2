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
  let canEditCandidateRejectionReason = false;
  let candidateDetailsGeneration=0;
  window.ATS_CANDIDATE_DETAILS={leave(){candidateDetailsGeneration++;}};

  async function openCandidateDetails(id) {
    const generation=++candidateDetailsGeneration,token=sessionStorage.getItem('ats_token'),view=currentActiveView;candidateDetailModal?.classList.add('hidden');
    const result=await window.ATS_API.getCandidateByIdApi(token,id);
    if(generation!==candidateDetailsGeneration||token!==sessionStorage.getItem('ats_token')||view!==currentActiveView)return;
    if(!result.ok||!result.data?.success){showToast('danger','Không thể mở hồ sơ',result.data?.message||'Không thể tải hồ sơ ứng viên.');return;}
    const c=result.data.data;

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
      stageBadge.textContent = STAGE_LABELS[c.stage] || c.stage;
    }
    if (idInput) idInput.value = c.id;
    if (stageSelect) stageSelect.value = c.stage;
    if (ratingEl) ratingEl.textContent = '★'.repeat(c.rating || 4) + '☆'.repeat(5 - (c.rating || 4));

    canEditCandidateRejectionReason = false;
    if (candDetailRejectionReasonSelect) candDetailRejectionReasonSelect.disabled = true;
    if (candDetailRejectionReasonGroup) {
      candDetailRejectionReasonGroup.classList.toggle(
        'hidden',
        true
      );
    }

    if (candDetailRejectionReasonSelect) {
      const token = sessionStorage.getItem('ats_token');

      candDetailRejectionReasonSelect.innerHTML =
        '<option value="">-- Chưa xác định --</option>';

      if (token) {
        try {
          const [permissionsRes, reasonRes] = await Promise.all([
            window.ATS_API.getPermissionsApi(token),
            window.ATS_API.getRecruitmentCatalogsApi(token, { type: 'REJECTION_REASON' })
          ]);
          canEditCandidateRejectionReason = permissionsRes.ok && Array.isArray(permissionsRes.data?.permissions) && permissionsRes.data.permissions.includes('candidate.update');
          candDetailRejectionReasonSelect.disabled = !canEditCandidateRejectionReason;
          if (candDetailRejectionReasonGroup) candDetailRejectionReasonGroup.classList.toggle('hidden', !canEditCandidateRejectionReason || c.stage !== 'REJECTED');

          const reasons =
            reasonRes.ok &&
            reasonRes.data &&
            reasonRes.data.success
              ? reasonRes.data.items || []
              : [];

          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Chưa xác định --</option>' +
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

              return `<option value="${item.id}" ${selected} ${disabled}>${escapeRecruitmentCatalogHtml(item.name)}${suffix}</option>`;
            }).join('');
        } catch {
          candDetailRejectionReasonSelect.innerHTML =
            '<option value="">-- Không tải được lý do loại --</option>';
        }
      }
    }
    // S4-09: Load Unified Profile & Multi-Application History
    loadCandidateUnifiedProfile(id, token);

    if(generation!==candidateDetailsGeneration||token!==sessionStorage.getItem('ats_token')||view!==currentActiveView)return;
    if (candidateDetailModal) candidateDetailModal.classList.remove('hidden');
  }

  async function loadCandidateUnifiedProfile(id, token) {
    const docsList = document.getElementById('cand-detail-documents-list');
    const appsList = document.getElementById('cand-detail-unified-apps');
    const tagsList = document.getElementById('cand-detail-tags-list');
    const notesList = document.getElementById('cand-detail-notes-list');
    const parsedBox = document.getElementById('cand-detail-parsed-box');
    if (parsedBox) parsedBox.classList.add('hidden');

    if (!token || !id) return;

    try {
      const res = await window.ATS_API.getUnifiedProfileApi(token, id);
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
                <a href="/api/v1/candidates/documents/${encodeURIComponent(d.id)}/download" target="_blank" class="btn btn-outline btn-xs" style="text-decoration:none;">
                  ⬇️ Xem / Tải CV
                </a>
              </div>
            `).join('');
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

      if (
        candDetailStageSelect.value !== 'REJECTED' &&
        candDetailRejectionReasonSelect
      ) {
        candDetailRejectionReasonSelect.value = '';
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
      const rejectionReasonId =
        canEditCandidateRejectionReason && stage === 'REJECTED' && candDetailRejectionReasonSelect
          ? candDetailRejectionReasonSelect.value || null
          : null;
      if (!token || !id) return;

      try {
        const res = await window.ATS_API.updateCandidateStageApi(
          token,
          id,
          stage,
          undefined,
          rejectionReasonId || undefined
        );
        if (res.ok && res.data && res.data.success) {
          showToast('success', 'Chuyển vòng thành công', `Đã cập nhật trạng thái ứng viên sang "${STAGE_LABELS[stage] || stage}".`);
          if (candidateDetailModal) candidateDetailModal.classList.add('hidden');
          loadCandidates();
          loadDashboardData();
        } else {
          showToast('danger', 'Lỗi cập nhật', res.data.message || 'Không thể chuyển vòng.');
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
