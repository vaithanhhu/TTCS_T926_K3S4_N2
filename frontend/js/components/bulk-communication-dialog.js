(function () {
  let candidateRows = [];
  let selectedCandidateIds = new Set();
  let templatesCache = null;
  let previewsList = [];
  let currentPreviewIndex = 0;
  let isBusy = false;

  const getEl = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '(': '&#40;', ')': '&#41;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function getAuthenticatedUser() {
    return typeof currentAuthenticatedUser !== 'undefined' ? currentAuthenticatedUser : null;
  }

  function isAllowed() {
    const user = getAuthenticatedUser();
    return Boolean(user?.roles?.some(role => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role)));
  }

  function getSelectedCandidates() {
    return candidateRows.filter(c => selectedCandidateIds.has(c.id));
  }

  function updateToolbarState() {
    const toolbar = getEl('bulk-communication-toolbar');
    if (!toolbar) return;

    if (!isAllowed()) {
      toolbar.hidden = true;
      toolbar.style.display = 'none';
      return;
    }

    toolbar.hidden = false;
    toolbar.style.display = 'flex';

    const selected = getSelectedCandidates();
    const countBadge = getEl('bulk-comm-selected-count');
    const stageBadge = getEl('bulk-comm-stage-badge');
    const warningText = getEl('bulk-comm-warning');
    const thankYouBtn = getEl('bulk-comm-thankyou-btn');
    const rejectionBtn = getEl('bulk-comm-rejection-btn');

    if (countBadge) countBadge.textContent = selected.length + ' đã chọn';

    if (selected.length === 0) {
      if (stageBadge) stageBadge.style.display = 'none';
      if (warningText) warningText.style.display = 'none';
      if (thankYouBtn) thankYouBtn.disabled = true;
      if (rejectionBtn) rejectionBtn.disabled = true;
      const selectAll = getEl('bulk-comm-select-all');
      if (selectAll) selectAll.checked = false;
      return;
    }

    const stages = new Set(selected.map(c => c.stage));
    if (stages.size > 1) {
      if (stageBadge) stageBadge.style.display = 'none';
      if (warningText) {
        warningText.textContent = 'Các ứng viên đã chọn có giai đoạn khác nhau. Vui lòng chỉ chọn các ứng viên cùng giai đoạn!';
        warningText.style.display = 'inline';
      }
      if (thankYouBtn) thankYouBtn.disabled = true;
      if (rejectionBtn) rejectionBtn.disabled = true;
    } else {
      const commonStage = selected[0].stage;
      const stageLabel = (typeof STAGE_LABELS !== 'undefined' && STAGE_LABELS[commonStage]) ? STAGE_LABELS[commonStage] : commonStage;
      if (warningText) warningText.style.display = 'none';
      if (stageBadge) {
        stageBadge.textContent = 'Giai đoạn: ' + stageLabel;
        stageBadge.style.display = 'inline';
      }
      if (thankYouBtn) thankYouBtn.disabled = false;
      if (rejectionBtn) {
        if (commonStage === 'HIRED' || commonStage === 'ONBOARDED') {
          rejectionBtn.disabled = true;
          rejectionBtn.title = 'Không thể gửi thư từ chối cho ứng viên đã được tuyển dụng hoặc onboard.';
        } else {
          rejectionBtn.disabled = false;
          rejectionBtn.title = '';
        }
      }
    }
  }

  function bindRowCheckboxes() {
    const tableBody = getEl('candidates-table-body');
    if (!tableBody) return;

    for (const row of candidateRows) {
      const tr = tableBody.querySelector(`tr[data-id="${row.id}"]`);
      if (!tr) continue;

      let box = tr.querySelector('.bulk-candidate-select');
      if (!box) {
        box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'bulk-candidate-select';
        box.setAttribute('aria-label', 'Chọn ' + (row.fullName || row.full_name || row.id));
        tr.cells[0].prepend(box);
      }

      box.checked = selectedCandidateIds.has(row.id);
      box.onchange = () => {
        if (box.checked) {
          selectedCandidateIds.add(row.id);
        } else {
          selectedCandidateIds.delete(row.id);
        }
        updateToolbarState();
      };
    }
  }

  function refresh(list) {
    candidateRows = Array.isArray(list) ? list : [];
    selectedCandidateIds.clear();
    bindRowCheckboxes();
    updateToolbarState();
  }

  async function loadTemplates() {
    if (templatesCache) return templatesCache;
    const token = sessionStorage.getItem('ats_token');
    if (!token) return [];
    try {
      const res = await window.ATS_API.getCommunicationTemplatesApi(token);
      if (res.ok && Array.isArray(res.data?.data)) {
        templatesCache = res.data.data;
        return templatesCache;
      }
    } catch {}
    return [];
  }

  async function openDialog(type) {
    if (!isAllowed()) return;
    const selected = getSelectedCandidates();
    if (selected.length === 0) {
      if (typeof showToast === 'function') showToast('warning', 'Chưa chọn ứng viên', 'Vui lòng chọn ít nhất một ứng viên để gửi thư.');
      return;
    }

    const stages = new Set(selected.map(c => c.stage));
    if (stages.size > 1) {
      if (typeof showToast === 'function') showToast('danger', 'Trạng thái không đồng nhất', 'Tất cả ứng viên được chọn phải có cùng giai đoạn tuyển dụng.');
      return;
    }

    const commonStage = selected[0].stage;
    if (type === 'REJECTION' && (commonStage === 'HIRED' || commonStage === 'ONBOARDED')) {
      if (typeof showToast === 'function') showToast('danger', 'Không hợp lệ', 'Không thể gửi thư từ chối cho ứng viên đã được tuyển dụng hoặc hoàn tất onboarding.');
      return;
    }

    const modal = getEl('bulk-communication-modal');
    if (!modal) return;

    const templates = await loadTemplates();
    const matchedTmpl = templates.find(t => t.type === type && t.isDefault) || templates.find(t => t.type === type);

    getEl('bulk-comm-type').value = type;
    getEl('bulk-comm-stage-display').value = (typeof STAGE_LABELS !== 'undefined' && STAGE_LABELS[commonStage]) ? STAGE_LABELS[commonStage] : commonStage;
    getEl('bulk-comm-subject').value = matchedTmpl?.subject || (type === 'THANK_YOU' ? '[ATS] Thư cảm ơn ứng tuyển vị trí {{jobTitle}} - {{candidateName}}' : '[ATS] Thông báo kết quả ứng tuyển vị trí {{jobTitle}} - {{candidateName}}');
    getEl('bulk-comm-body').value = matchedTmpl?.bodyHtml || '';
    getEl('bulk-comm-message').textContent = `${selected.length} ứng viên đã được chọn. Xem trước nội dung trước khi gửi.`;

    getEl('bulk-comm-warning-banner').style.display = 'none';
    getEl('bulk-comm-form').style.display = 'block';
    getEl('bulk-comm-preview-section').style.display = 'none';
    getEl('bulk-comm-results-section').style.display = 'none';

    modal.classList.remove('hidden');
  }

  function renderPreviewCard(index) {
    if (!previewsList.length) return;
    if (index < 0) index = 0;
    if (index >= previewsList.length) index = previewsList.length - 1;
    currentPreviewIndex = index;

    const p = previewsList[currentPreviewIndex];
    getEl('bulk-comm-preview-select').value = String(currentPreviewIndex);
    getEl('bulk-comm-preview-counter').textContent = `${currentPreviewIndex + 1} / ${previewsList.length}`;

    getEl('bulk-comm-card-recipient').textContent = `${p.candidateName} <${p.candidateEmail}>`;
    getEl('bulk-comm-card-subject').textContent = p.subject;
    getEl('bulk-comm-card-body').innerHTML = p.bodyHtml;

    const badge = getEl('bulk-comm-card-status-badge');
    if (badge) {
      if (p.alreadyReceivedRejection) {
        badge.className = 'badge badge-danger';
        badge.textContent = 'Đã nhận thư từ chối trước đó (Sẽ tự động bỏ qua)';
      } else {
        badge.className = 'badge badge-success';
        badge.textContent = 'Sẵn sàng gửi';
      }
    }

    getEl('bulk-comm-prev-preview-btn').disabled = (currentPreviewIndex === 0);
    getEl('bulk-comm-next-preview-btn').disabled = (currentPreviewIndex === previewsList.length - 1);
  }

  async function handlePreviewSubmit(e) {
    e.preventDefault();
    if (isBusy) return;

    const token = sessionStorage.getItem('ats_token');
    const selected = getSelectedCandidates();
    const type = getEl('bulk-comm-type').value;
    const customSubject = getEl('bulk-comm-subject').value.trim();
    const customBody = getEl('bulk-comm-body').value.trim();

    isBusy = true;
    getEl('bulk-comm-preview-btn').disabled = true;
    getEl('bulk-comm-message').textContent = 'Đang tạo bản xem trước cho từng ứng viên...';

    try {
      const res = await window.ATS_API.previewBulkCommunicationsApi(token, {
        candidateIds: selected.map(c => c.id),
        type,
        customSubject,
        customBody
      });

      if (!res.ok) {
        getEl('bulk-comm-message').textContent = res.data?.message || 'Không thể xem trước thư gửi.';
        return;
      }

      previewsList = res.data.previews || [];
      const hasDuplicateRejections = previewsList.some(p => p.alreadyReceivedRejection);
      const warningBanner = getEl('bulk-comm-warning-banner');
      if (warningBanner) {
        if (hasDuplicateRejections) {
          const dupCount = previewsList.filter(p => p.alreadyReceivedRejection).length;
          warningBanner.innerHTML = `⚠️ <strong>Cảnh báo ngăn gửi trùng:</strong> Có <strong>${dupCount}</strong> ứng viên đã nhận thư từ chối trước đó. Hệ thống sẽ tự động bỏ qua các ứng viên này khi gửi.`;
          warningBanner.style.display = 'block';
        } else {
          warningBanner.style.display = 'none';
        }
      }

      const select = getEl('bulk-comm-preview-select');
      select.innerHTML = previewsList.map((p, idx) => `<option value="${idx}">${idx + 1}. ${escapeHtml(p.candidateName)} (${escapeHtml(p.candidateEmail)})</option>`).join('');
      select.onchange = () => renderPreviewCard(Number(select.value));

      getEl('bulk-comm-form').style.display = 'none';
      getEl('bulk-comm-preview-section').style.display = 'block';
      getEl('bulk-comm-message').textContent = `Xem trước thư cho ${previewsList.length} ứng viên. Kiểm tra kỹ nội dung trước khi xác nhận.`;
      renderPreviewCard(0);
    } catch (err) {
      getEl('bulk-comm-message').textContent = err.message || 'Lỗi xử lý xem trước.';
    } finally {
      isBusy = false;
      getEl('bulk-comm-preview-btn').disabled = false;
    }
  }

  async function handleConfirmSend() {
    if (isBusy) return;

    const token = sessionStorage.getItem('ats_token');
    const selected = getSelectedCandidates();
    const type = getEl('bulk-comm-type').value;
    const customSubject = getEl('bulk-comm-subject').value.trim();
    const customBody = getEl('bulk-comm-body').value.trim();

    isBusy = true;
    getEl('bulk-comm-confirm-send-btn').disabled = true;
    getEl('bulk-comm-back-to-edit-btn').disabled = true;
    getEl('bulk-comm-message').textContent = 'Đang tiến hành gửi thư hàng loạt...';

    try {
      const res = await window.ATS_API.sendBulkCommunicationsApi(token, {
        candidateIds: selected.map(c => c.id),
        type,
        customSubject,
        customBody
      });

      if (!res.ok) {
        getEl('bulk-comm-message').textContent = res.data?.message || 'Không thể hoàn thành gửi thư hàng loạt.';
        return;
      }

      const data = res.data;
      getEl('bulk-comm-preview-section').style.display = 'none';
      getEl('bulk-comm-results-section').style.display = 'block';
      getEl('bulk-comm-message').textContent = 'Quá trình gửi thư hàng loạt đã hoàn tất!';

      const summaryDiv = getEl('bulk-comm-results-summary');
      if (summaryDiv) {
        summaryDiv.innerHTML = `
          <div style="font-weight: 700; font-size: 1rem; color: #166534; margin-bottom: 8px;">Kết quả gửi thư hàng loạt</div>
          <div style="display: flex; gap: 16px; font-size: 0.9rem;">
            <span>Tổng số: <strong>${data.total}</strong></span>
            <span style="color: #16a34a;">Thành công: <strong>${data.sentCount}</strong></span>
            <span style="color: #d97706;">Bỏ qua (Trùng lặp): <strong>${data.skippedCount}</strong></span>
            <span style="color: #dc2626;">Thất bại: <strong>${data.failedCount}</strong></span>
          </div>
        `;
      }

      const tbody = getEl('bulk-comm-results-table-body');
      if (tbody) {
        tbody.innerHTML = (data.results || []).map(r => {
          let badgeHtml = '';
          let detail = '—';
          if (r.status === 'DELIVERED' || r.status === 'SENT_LOCAL') {
            badgeHtml = '<span class="badge badge-success">Thành công</span>';
            detail = r.status === 'SENT_LOCAL' ? 'Mô phỏng (SENT_LOCAL)' : 'Đã gửi qua SMTP';
          } else if (r.status === 'SKIPPED_DUPLICATE') {
            badgeHtml = '<span class="badge badge-warning">Đã bỏ qua</span>';
            detail = 'Đã nhận thư từ chối trước đó';
          } else {
            badgeHtml = '<span class="badge badge-danger">Thất bại</span>';
            detail = escapeHtml(r.error || 'Lỗi gửi thư');
          }
          return `
            <tr>
              <td><strong>${escapeHtml(r.candidateName)}</strong></td>
              <td>${escapeHtml(r.email)}</td>
              <td>${badgeHtml}</td>
              <td style="font-size: 0.8rem; color: #64748b;">${detail}</td>
            </tr>
          `;
        }).join('');
      }

      if (typeof showToast === 'function') {
        showToast('success', 'Gửi thư thành công', `Đã gửi thành công ${data.sentCount}/${data.total} thư.`);
      }
    } catch (err) {
      getEl('bulk-comm-message').textContent = err.message || 'Lỗi khi gửi thư hàng loạt.';
    } finally {
      isBusy = false;
      getEl('bulk-comm-confirm-send-btn').disabled = false;
      getEl('bulk-comm-back-to-edit-btn').disabled = false;
    }
  }

  function closeModal() {
    const modal = getEl('bulk-communication-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    previewsList = [];
    currentPreviewIndex = 0;
    isBusy = false;
  }

  function initListeners() {
    const thankYouBtn = getEl('bulk-comm-thankyou-btn');
    if (thankYouBtn) thankYouBtn.onclick = () => openDialog('THANK_YOU');

    const rejectionBtn = getEl('bulk-comm-rejection-btn');
    if (rejectionBtn) rejectionBtn.onclick = () => openDialog('REJECTION');

    const selectAll = getEl('bulk-comm-select-all');
    if (selectAll) {
      selectAll.onchange = () => {
        if (selectAll.checked) {
          if (!candidateRows.length) return;
          const targetStage = candidateRows[0].stage;
          for (const row of candidateRows) {
            if (row.stage === targetStage) {
              selectedCandidateIds.add(row.id);
            }
          }
        } else {
          selectedCandidateIds.clear();
        }
        bindRowCheckboxes();
        updateToolbarState();
      };
    }

    const typeSelect = getEl('bulk-comm-type');
    if (typeSelect) {
      typeSelect.onchange = async () => {
        const type = typeSelect.value;
        const templates = await loadTemplates();
        const matchedTmpl = templates.find(t => t.type === type && t.isDefault) || templates.find(t => t.type === type);
        getEl('bulk-comm-subject').value = matchedTmpl?.subject || (type === 'THANK_YOU' ? '[ATS] Thư cảm ơn ứng tuyển vị trí {{jobTitle}} - {{candidateName}}' : '[ATS] Thông báo kết quả ứng tuyển vị trí {{jobTitle}} - {{candidateName}}');
        getEl('bulk-comm-body').value = matchedTmpl?.bodyHtml || '';
      };
    }

    const form = getEl('bulk-comm-form');
    if (form) form.onsubmit = handlePreviewSubmit;

    const closeBtn = getEl('bulk-comm-close-btn');
    if (closeBtn) closeBtn.onclick = closeModal;

    const cancelBtn = getEl('bulk-comm-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = closeModal;

    const prevBtn = getEl('bulk-comm-prev-preview-btn');
    if (prevBtn) prevBtn.onclick = () => renderPreviewCard(currentPreviewIndex - 1);

    const nextBtn = getEl('bulk-comm-next-preview-btn');
    if (nextBtn) nextBtn.onclick = () => renderPreviewCard(currentPreviewIndex + 1);

    const backBtn = getEl('bulk-comm-back-to-edit-btn');
    if (backBtn) {
      backBtn.onclick = () => {
        getEl('bulk-comm-preview-section').style.display = 'none';
        getEl('bulk-comm-form').style.display = 'block';
      };
    }

    const confirmBtn = getEl('bulk-comm-confirm-send-btn');
    if (confirmBtn) confirmBtn.onclick = handleConfirmSend;

    const finishBtn = getEl('bulk-comm-finish-btn');
    if (finishBtn) {
      finishBtn.onclick = () => {
        closeModal();
        selectedCandidateIds.clear();
        updateToolbarState();
        bindRowCheckboxes();
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initListeners);
  } else {
    initListeners();
  }

  window.ATS_BULK_COMMUNICATIONS = {
    refresh,
    openDialog
  };
})();
