  // ==============================================================================
  // 14. AUDIT LOGS (REAL BACKEND API)
  // ==============================================================================
  // 14. SYSTEM AUDIT LOGS (REAL BACKEND API & FULL DETAIL INSPECTION)
  // ==============================================================================

  let currentAuditLogs = [];
  let currentEnrichedAuditLog = null;
  const auditSearchInput = document.getElementById('audit-search-input');
  const auditStatusFilter = document.getElementById('audit-status-filter');
  const auditRefreshBtn = document.getElementById('audit-refresh-btn');
  const auditTotalBadge = document.getElementById('audit-total-badge');
  const auditDetailModal = document.getElementById('audit-detail-modal');

  async function loadAuditLogs() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    const auditTableBody = document.getElementById('audit-table-body');
    if (auditTableBody) {
      auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Đang tải nhật ký kiểm toán hệ thống...</td></tr>`;
    }

    const search = auditSearchInput ? auditSearchInput.value.trim() : '';
    const status = auditStatusFilter ? auditStatusFilter.value : 'ALL';

    try {
      const res = await window.ATS_API.getAuditLogsApi(token, { search, status, limit: 100 });
      if (res.ok && res.data && res.data.success) {
        const logs = res.data.logs || (res.data.data && res.data.data.logs) || [];
        currentAuditLogs = logs;

        if (auditTotalBadge) {
          auditTotalBadge.textContent = `${logs.length} sự kiện`;
        }

        if (logs.length === 0) {
          auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 24px;">Không tìm thấy bản ghi nhật ký phù hợp với bộ lọc.</td></tr>`;
          return;
        }

        auditTableBody.innerHTML = logs.map(l => {
          const isSuccess = l.status === 'SUCCESS';
          const isLocked = l.status === 'LOCKED' || l.status === 'ACCOUNT_LOCKED';
          let badgeClass = 'badge-success';
          let statusText = l.status;
          if (isLocked) {
            badgeClass = 'badge-warning';
            statusText = l.status === 'ACCOUNT_LOCKED' ? 'KHÓA THỦ CÔNG' : 'BỊ KHÓA';
          } else if (l.status === 'FAILURE') {
            badgeClass = 'badge-danger';
            statusText = 'THẤT BẠI';
          } else if (l.status === 'LOGOUT') {
            badgeClass = 'badge-secondary';
            statusText = 'ĐĂNG XUẤT';
          } else if (l.status === 'ACCOUNT_UNLOCKED') {
            badgeClass = 'badge-info';
            statusText = 'MỞ KHÓA';
          } else if (isSuccess) {
            statusText = 'THÀNH CÔNG';
          }

          let actionLabel = 'Đăng nhập';
          if (l.status === 'LOGOUT') actionLabel = 'Đăng xuất';
          else if (l.status === 'ACCOUNT_LOCKED') actionLabel = 'Khóa tài khoản';
          else if (l.status === 'ACCOUNT_UNLOCKED') actionLabel = 'Mở khóa';
          else if (l.status === 'LOCKED') actionLabel = 'Tự khóa bảo vệ';
          else if (l.action) actionLabel = l.action;

          return `
            <tr>
              <td class="font-mono" style="font-size: 0.775rem;">${window.ATS_DATETIME.formatUtcTimestamp(l.attempted_at)}</td>
              <td><strong>${l.email || '—'}</strong></td>
              <td>${actionLabel}</td>
              <td><span class="badge ${badgeClass} font-mono" style="font-size: 0.7rem;">${statusText}</span></td>
              <td style="color: var(--color-text-secondary); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.reason || ''}">${l.reason || '—'}</td>
              <td class="font-mono" style="font-size: 0.775rem; color: var(--color-text-muted);">${l.ip_address || '127.0.0.1'}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-outline btn-xs btn-view-audit-detail" data-id="${l.id}" title="Xem toàn bộ thông số chi tiết của bản ghi này">
                  <span>Chi tiết</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');

        // Attach click listeners to view detail buttons
        document.querySelectorAll('.btn-view-audit-detail').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const logId = btn.getAttribute('data-id');
            const foundLog = currentAuditLogs.find(item => item.id === logId);
            openAuditDetailModal(logId, foundLog);
          });
        });
      } else {
        if (auditTableBody) {
          auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-danger); padding: 24px;">Không thể tải nhật ký: ${res.data?.message || 'Lỗi phân quyền hoặc kết nối.'}</td></tr>`;
        }
      }
    } catch (e) {
      console.error('Failed to load audit logs:', e);
      if (auditTableBody) {
        auditTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-danger); padding: 24px;">Lỗi kết nối khi tải nhật ký kiểm toán.</td></tr>`;
      }
    }
  }

  // Open & Render Audit Detail Modal
  async function openAuditDetailModal(logId, initialLog = null) {
    if (!auditDetailModal) return;

    // Reset fields
    const modalIdBadge = document.getElementById('audit-modal-id-badge');
    const modalAction = document.getElementById('audit-modal-action');
    const modalStatusBadge = document.getElementById('audit-modal-status-badge');
    const modalRiskBadge = document.getElementById('audit-modal-risk-badge');
    const modalTime = document.getElementById('audit-modal-time');
    const modalEmail = document.getElementById('audit-modal-email');
    const modalUserName = document.getElementById('audit-modal-user-name');
    const modalUserDept = document.getElementById('audit-modal-user-dept');
    const modalUserRoles = document.getElementById('audit-modal-user-roles');
    const modalUserStatus = document.getElementById('audit-modal-user-status');
    const modalUserAttempts = document.getElementById('audit-modal-user-attempts');
    const modalIp = document.getElementById('audit-modal-ip');
    const modalReasonBox = document.getElementById('audit-modal-reason-box');
    const modalAdviceText = document.getElementById('audit-modal-advice-text');
    const modalRawJson = document.getElementById('audit-modal-raw-json');

    const log = initialLog || { id: logId, email: '—', ip_address: '127.0.0.1', status: 'UNKNOWN', attempted_at: null };
    currentEnrichedAuditLog = log;

    if (modalIdBadge) modalIdBadge.textContent = log.id || logId;
    if (modalTime) modalTime.textContent = window.ATS_DATETIME.formatUtcTimestamp(log.attempted_at);
    if (modalEmail) modalEmail.textContent = log.email || '—';
    if (modalIp) modalIp.textContent = log.ip_address || '127.0.0.1';
    if (modalReasonBox) modalReasonBox.textContent = log.reason || 'Không có ghi chú thêm.';
    if (modalUserName) modalUserName.textContent = 'Đang tra cứu hồ sơ...';
    if (modalUserDept) modalUserDept.textContent = 'Đang đồng bộ...';
    if (modalUserRoles) modalUserRoles.textContent = 'Đang kiểm tra...';
    if (modalUserStatus) modalUserStatus.textContent = 'Đang kiểm tra...';
    if (modalUserAttempts) modalUserAttempts.textContent = '—';

    // Status & Risk Styling
    const isSuccess = log.status === 'SUCCESS';
    const isLocked = log.status === 'LOCKED' || log.status === 'ACCOUNT_LOCKED';
    let statusClass = 'badge-success';
    let statusLabel = 'THÀNH CÔNG';
    if (isLocked) {
      statusClass = 'badge-warning';
      statusLabel = log.status === 'ACCOUNT_LOCKED' ? 'KHÓA THỦ CÔNG' : 'BỊ KHÓA';
    } else if (log.status === 'FAILURE') {
      statusClass = 'badge-danger';
      statusLabel = 'THẤT BẠI';
    } else if (log.status === 'LOGOUT') {
      statusClass = 'badge-secondary';
      statusLabel = 'ĐĂNG XUẤT';
    } else if (log.status === 'ACCOUNT_UNLOCKED') {
      statusClass = 'badge-info';
      statusLabel = 'MỞ KHÓA';
    }

    if (modalStatusBadge) {
      modalStatusBadge.innerHTML = `<span class="badge ${statusClass} font-mono">${statusLabel}</span>`;
    }

    let riskBadgeHtml = `<span class="badge badge-success font-mono">Thấp (An toàn)</span>`;
    let advice = 'Sự kiện xác thực hợp lệ. Không phát hiện dấu hiệu bất thường.';
    if (isLocked) {
      riskBadgeHtml = `<span class="badge badge-danger font-mono">Cao (Tài khoản bị hạn chế)</span>`;
      advice = 'Cảnh báo an ninh: Tài khoản hiện đã bị khóa. Vui lòng kiểm tra các vị trí tuyển dụng phụ trách để bàn giao cho nhân sự khác.';
    } else if (log.status === 'FAILURE') {
      riskBadgeHtml = `<span class="badge badge-warning font-mono">Trung bình (Thử sai)</span>`;
      advice = 'Khuyến nghị an ninh: Theo dõi số lần nhập sai liên tiếp từ địa chỉ IP này để đề phòng tấn công dò mật khẩu.';
    } else if (log.status === 'ACCOUNT_UNLOCKED') {
      riskBadgeHtml = `<span class="badge badge-info font-mono">Thấp (Quản trị can thiệp)</span>`;
      advice = 'Thao tác mở khóa tài khoản được thực hiện bởi Quản trị viên hệ thống.';
    }

    if (modalRiskBadge) modalRiskBadge.innerHTML = riskBadgeHtml;
    if (modalAdviceText) modalAdviceText.textContent = advice;

    let actionLabel = 'Xác thực / Đăng nhập';
    if (log.status === 'LOGOUT') actionLabel = 'Đăng xuất khỏi hệ thống';
    else if (log.status === 'ACCOUNT_LOCKED') actionLabel = 'Khóa tài khoản quản trị';
    else if (log.status === 'ACCOUNT_UNLOCKED') actionLabel = 'Mở khóa tài khoản';
    else if (log.status === 'LOCKED') actionLabel = 'Khóa bảo mật tự động';
    if (modalAction) modalAction.textContent = actionLabel;

    if (modalRawJson) {
      modalRawJson.textContent = JSON.stringify(log, null, 2);
    }

    // Display modal
    auditDetailModal.classList.remove('hidden');

    // Async Fetch Enriched Details from Backend
    const token = sessionStorage.getItem('ats_token');
    if (token && logId) {
      try {
        const detailRes = await window.ATS_API.getAuditLogDetailApi(token, logId);
        if (detailRes.ok && detailRes.data && detailRes.data.success && detailRes.data.log) {
          const enriched = detailRes.data.log;
          currentEnrichedAuditLog = enriched;
          if (modalTime) modalTime.textContent = window.ATS_DATETIME.formatUtcTimestamp(enriched.attempted_at);

          if (modalRawJson) {
            modalRawJson.textContent = JSON.stringify(enriched, null, 2);
          }

          if (enriched.user) {
            if (modalUserName) modalUserName.textContent = enriched.user.fullName || 'Chưa cập nhật';
            if (modalUserDept) modalUserDept.textContent = enriched.user.department || 'Không xác định';
            if (modalUserRoles) {
              modalUserRoles.textContent = (enriched.user.roles && enriched.user.roles.length > 0)
                ? enriched.user.roles.join(', ')
                : 'Chưa gán vai trò';
            }
            if (modalUserStatus) {
              const uStatus = enriched.user.accountStatus || 'ACTIVE';
              const uClass = uStatus === 'ACTIVE' ? 'badge-success' : 'badge-danger';
              modalUserStatus.innerHTML = `<span class="badge ${uClass} font-mono" style="font-size: 0.7rem;">${uStatus}</span>`;
            }
            if (modalUserAttempts) {
              modalUserAttempts.textContent = `${enriched.user.failedAttempts || 0} / 5 lần thử`;
            }
          } else {
            if (modalUserName) modalUserName.textContent = 'Tài khoản không còn trên hệ thống';
            if (modalUserDept) modalUserDept.textContent = '—';
            if (modalUserRoles) modalUserRoles.textContent = '—';
            if (modalUserStatus) modalUserStatus.textContent = '—';
            if (modalUserAttempts) modalUserAttempts.textContent = '—';
          }
        }
      } catch (err) {
        console.warn('Error fetching enriched audit detail:', err);
      }
    }
  }

  // Setup Audit Filter & Modal Event Listeners
  if (auditSearchInput) {
    // Timer belongs to the page lifecycle, so navigation can cancel it.
    auditSearchInput.addEventListener('input', () => {
      clearTimeout(auditDebounceTimer);
      auditDebounceTimer = setTimeout(() => {
        loadAuditLogs();
      }, 350);
    });
    auditSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        loadAuditLogs();
      }
    });
  }

  if (auditStatusFilter) {
    auditStatusFilter.addEventListener('change', () => {
      loadAuditLogs();
    });
  }

  if (auditRefreshBtn) {
    auditRefreshBtn.addEventListener('click', () => {
      loadAuditLogs();
      showToast('info', 'Làm mới', 'Đã tải lại danh sách nhật ký kiểm toán mới nhất.');
    });
  }

  // Modal Close & Copy JSON Handlers
  const closeAuditDetailModalBtn = document.getElementById('close-audit-detail-modal');
  const closeAuditDetailBtn = document.getElementById('close-audit-detail-btn');
  const copyAuditJsonBtn = document.getElementById('copy-audit-json-btn');

  function closeAuditDetailModal() {
    if (auditDetailModal) {
      auditDetailModal.classList.add('hidden');
    }
  }

  if (closeAuditDetailModalBtn) closeAuditDetailModalBtn.addEventListener('click', closeAuditDetailModal);
  if (closeAuditDetailBtn) closeAuditDetailBtn.addEventListener('click', closeAuditDetailModal);

  if (auditDetailModal) {
    auditDetailModal.addEventListener('click', (e) => {
      if (e.target === auditDetailModal) {
        closeAuditDetailModal();
      }
    });
  }

  if (copyAuditJsonBtn) {
    copyAuditJsonBtn.addEventListener('click', async () => {
      try {
        const jsonText = JSON.stringify(currentEnrichedAuditLog || {}, null, 2);
        await navigator.clipboard.writeText(jsonText);
        showToast('success', 'Đã sao chép', 'Cấu trúc dữ liệu JSON nhật ký đã được lưu vào bộ nhớ tạm.');
      } catch (err) {
        showToast('error', 'Lỗi sao chép', 'Không thể truy cập bộ nhớ tạm của trình duyệt.');
      }
    });
  }

  const auditExportBtn = document.getElementById('audit-export-btn');
  if (auditExportBtn) {
    auditExportBtn.addEventListener('click', () => {
      const rows = [];
      const trs = document.querySelectorAll('#audit-table-body tr');
      trs.forEach(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        if (tds.length >= 6) rows.push(tds.slice(0, 6));
      });
      if (rows.length === 0) {
        showToast('warning', 'Xuất dữ liệu', 'Chưa có nhật ký kiểm toán để xuất.');
        return;
      }
      exportTableToCsv('nhat_ky_kiem_toan.csv', ['Thời gian', 'Tài khoản', 'Hành động', 'Kết quả', 'Chi tiết', 'IP'], rows);
    });
  }
