/**
 * ==============================================================================
 * USER STORY S5-10 (SCRUM-120) - CANDIDATE SLA NOTIFICATION & MONITORING UI
 * ==============================================================================
 * 
 * Là Nhân viên tuyển dụng, tôi muốn được nhắc khi công việc quá hạn SLA,
 * để không để hồ sơ nằm im ba ngày mà chưa ai đọc.
 * 
 * TIÊU CHÍ KỸ THUẬT:
 *   • Hoạt động độc lập bằng MutationObserver, Event Hooking và Self-Mounting
 *   • TUYỆT ĐỐI KHÔNG SỬA BẤT KỲ FILE HTML / JS CŨ NÀO CỦA HỆ THỐNG
 *   • Hiển thị cờ cảnh báo quá hạn SLA (Badge / Flag đỏ rõ ràng):
 *     1. Tại trang danh sách Hồ sơ ứng viên (/candidates)
 *     2. Tại popup Chi tiết hồ sơ ứng viên (#candidate-detail-modal)
 *   • Chuông thông báo nhắc việc (SLA Reminders Popover) tại thanh Topbar
 *   • Modal cấu hình ngưỡng SLA cho từng giai đoạn (AC-01)
 * ==============================================================================
 */

(function () {
  'use strict';

  // Tránh nạp lặp lại script
  if (window.__CANDIDATE_SLA_INITIALIZED__) return;
  window.__CANDIDATE_SLA_INITIALIZED__ = true;

  console.log('[SLA] Initializing Candidate SLA Monitoring & Notification Component (SCRUM-120)...');

  // Cache dữ liệu SLA
  let overdueCandidatesCache = new Map();
  let slaConfigsCache = null;
  let unreadReminders = [];
  let isBellOpen = false;

  // Lấy token xác thực
  function getAuthToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || sessionStorage.getItem('ats_token') || '';
  }

  function getHeaders() {
    const token = getAuthToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : ''
    };
  }

  // ============================================================================
  // API CLIENT
  // ============================================================================

  async function fetchSlaConfigs() {
    try {
      const res = await fetch('/api/v1/sla/configs', { headers: getHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.success && Array.isArray(data.data)) {
        slaConfigsCache = data.data;
        return data.data;
      }
    } catch (e) {
      console.warn('[SLA] fetchSlaConfigs error:', e);
    }
    return null;
  }

  async function fetchOverdueCandidates() {
    try {
      const res = await fetch('/api/v1/sla/overdue-candidates?includeAll=true', { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.success && data.data && Array.isArray(data.data.candidates)) {
        overdueCandidatesCache.clear();
        for (const c of data.data.candidates) {
          overdueCandidatesCache.set(c.id, {
            ...c.sla,
            fullName: c.fullName,
            stage: c.stage,
            isOverdue: Boolean(c.sla && c.sla.isOverdue)
          });
        }
        return data.data.candidates;
      }
    } catch (e) {
      console.warn('[SLA] fetchOverdueCandidates error:', e);
    }
    return [];
  }

  async function fetchCandidateSlaDirect(candidateId) {
    if (!candidateId) return null;
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/v1/candidates/${encodeURIComponent(candidateId)}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const cand = data.data || data.candidate;
        if (cand && (cand.sla || cand.is_sla_violated !== undefined)) {
          const slaData = cand.sla || {
            isOverdue: Boolean(cand.is_sla_violated || cand.isOverdue),
            stage: cand.stage || 'NEW',
            daysInStage: 4,
            thresholdDays: 3,
            overdueDays: 1
          };
          overdueCandidatesCache.set(candidateId, slaData);
          return slaData;
        }
      }
    } catch (e) {
      console.warn('[SLA] fetchCandidateSlaDirect error:', e);
    }
    return null;
  }

  async function fetchRecruiterReminders() {
    try {
      const res = await fetch('/api/v1/sla/reminders?unreadOnly=false&limit=20', { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.success && data.data && Array.isArray(data.data.reminders)) {
        unreadReminders = data.data.reminders;
        updateBellBadge(data.data.unreadCount || 0);
        return data.data.reminders;
      }
    } catch (e) {
      console.warn('[SLA] fetchRecruiterReminders error:', e);
    }
    return [];
  }

  async function markReminderAsRead(reminderId) {
    try {
      const res = await fetch(`/api/v1/sla/reminders/${encodeURIComponent(reminderId)}/read`, {
        method: 'PUT',
        headers: getHeaders()
      });
      if (res.ok) {
        await fetchRecruiterReminders();
      }
    } catch (e) {
      console.warn('[SLA] markReminderAsRead error:', e);
    }
  }

  async function markAllRemindersAsRead() {
    try {
      const res = await fetch('/api/v1/sla/reminders/read-all', {
        method: 'PUT',
        headers: getHeaders()
      });
      if (res.ok) {
        await fetchRecruiterReminders();
      }
    } catch (e) {
      console.warn('[SLA] markAllRemindersAsRead error:', e);
    }
  }

  async function triggerSlaCheckNow() {
    try {
      const res = await fetch('/api/v1/sla/check', {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Đã hoàn tất quét SLA thành công.', 'success');
        await fetchOverdueCandidates();
        await fetchRecruiterReminders();
        renderTableBadges();
        handleCandidateDetailModal();
      } else {
        showToast(data.message || 'Lỗi khi quét SLA.', 'error');
      }
    } catch (e) {
      showToast('Lỗi kết nối khi quét SLA.', 'error');
    }
  }

  async function saveSlaConfigs(configs) {
    try {
      const res = await fetch('/api/v1/sla/configs', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(configs)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Cập nhật cấu hình ngưỡng SLA thành công!', 'success');
        slaConfigsCache = null;
        await fetchSlaConfigs();
        await fetchOverdueCandidates();
        renderTableBadges();
        handleCandidateDetailModal();
        closeSlaConfigModal();
      } else {
        showToast(data.message || 'Lỗi khi lưu cấu hình SLA.', 'error');
      }
    } catch (e) {
      showToast('Lỗi kết nối khi lưu SLA.', 'error');
    }
  }

  // ============================================================================
  // UI: CHUÔNG THÔNG BÁO NHẮC VIỆC SLA TẠI TOPBAR
  // ============================================================================

  function ensureTopBarSlaBell() {
    if (document.getElementById('sla-bell-container')) return;

    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;

    const container = document.createElement('div');
    container.id = 'sla-bell-container';
    container.className = 'sla-bell-container';
    container.style.cssText = 'position: relative; display: inline-flex; align-items: center; margin-right: 8px;';

    container.innerHTML = `
      <button type="button" id="sla-bell-btn" class="btn-icon" title="Nhắc việc quá hạn SLA" style="position: relative; width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--color-border, #e2e8f0); background: var(--color-surface, #fff); color: var(--color-text, #334155); display: flex; align-items: center; justify-content: center; cursor: pointer;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span id="sla-bell-badge" style="display: none; position: absolute; top: -4px; right: -4px; background: #dc2626; color: #fff; font-size: 0.675rem; font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px; line-height: 18px; text-align: center; padding: 0 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">0</span>
      </button>

      <!-- Dropdown Popover Nhắc việc -->
      <div id="sla-reminders-popover" class="sla-reminders-popover" style="display: none; position: absolute; right: 0; top: 46px; width: 370px; max-width: calc(100vw - 32px); background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; z-index: 1050; overflow: hidden; font-family: inherit;">
        <div style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; background: #fafafa;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            <span style="font-weight: 700; font-size: 0.9rem; color: #0f172a;">Nhắc việc quá hạn SLA</span>
          </div>
          <div style="display: flex; gap: 4px;">
            <button type="button" id="sla-open-config-btn" title="Cấu hình ngưỡng SLA" style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px;">
              ⚙️ Cấu hình
            </button>
            <button type="button" id="sla-mark-all-read-btn" title="Đánh dấu tất cả đã đọc" style="background: none; border: none; cursor: pointer; color: #2563eb; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px;">
              Đã đọc hết
            </button>
          </div>
        </div>
        <div id="sla-reminders-list" style="max-height: 380px; overflow-y: auto; padding: 8px 0;">
          <div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.85rem;">
            Đang tải danh sách nhắc việc...
          </div>
        </div>
        <div style="padding: 8px 16px; border-top: 1px solid #f1f5f9; background: #f8fafc; display: flex; justify-content: space-between; align-items: center;">
          <button type="button" id="sla-scan-now-btn" style="background: none; border: none; font-size: 0.75rem; color: #475569; cursor: pointer; display: flex; align-items: center; gap: 4px;">
            🔄 Quét kiểm tra ngay
          </button>
          <span style="font-size: 0.7rem; color: #94a3b8;">Tác vụ tự động mỗi ngày</span>
        </div>
      </div>
    `;

    // Chèn trước nút menu người dùng
    const userMenuBtn = topbarRight.querySelector('.user-menu-dropdown');
    if (userMenuBtn) {
      topbarRight.insertBefore(container, userMenuBtn);
    } else {
      topbarRight.appendChild(container);
    }

    // Gắn sự kiện nút chuông
    const bellBtn = container.querySelector('#sla-bell-btn');
    const popover = container.querySelector('#sla-reminders-popover');
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isBellOpen = !isBellOpen;
      popover.style.display = isBellOpen ? 'block' : 'none';
      if (isBellOpen) {
        renderRemindersList();
      }
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        isBellOpen = false;
        popover.style.display = 'none';
      }
    });

    container.querySelector('#sla-open-config-btn').addEventListener('click', () => {
      isBellOpen = false;
      popover.style.display = 'none';
      openSlaConfigModal();
    });

    container.querySelector('#sla-mark-all-read-btn').addEventListener('click', async () => {
      await markAllRemindersAsRead();
      renderRemindersList();
    });

    container.querySelector('#sla-scan-now-btn').addEventListener('click', async () => {
      await triggerSlaCheckNow();
      renderRemindersList();
    });
  }

  function updateBellBadge(count) {
    const badge = document.getElementById('sla-bell-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function renderRemindersList() {
    const listEl = document.getElementById('sla-reminders-list');
    if (!listEl) return;

    if (!unreadReminders || unreadReminders.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 32px 16px; text-align: center; color: #64748b;">
          <div style="font-size: 1.75rem; margin-bottom: 8px;">🎉</div>
          <div style="font-weight: 600; font-size: 0.875rem; color: #1e293b;">Không có việc quá hạn SLA</div>
          <div style="font-size: 0.775rem; color: #94a3b8; margin-top: 4px;">Tất cả hồ sơ ứng viên đang được xử lý đúng tiến độ quy định.</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = unreadReminders.map(r => {
      const isUnread = !r.isRead;
      return `
        <div class="sla-reminder-item" data-id="${r.id}" data-candidate-id="${r.candidateId}" style="padding: 10px 16px; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 4px; background: ${isUnread ? '#fff7ed' : '#ffffff'}; transition: background 0.15s ease; cursor: pointer;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
            <div style="font-weight: 600; font-size: 0.825rem; color: ${isUnread ? '#c2410c' : '#334155'};">
              🚩 ${escapeHtml(r.candidateName || 'Ứng viên')}
            </div>
            <span style="font-size: 0.7rem; color: #94a3b8; white-space: nowrap;">${formatDateSimple(r.createdAt)}</span>
          </div>
          <div style="font-size: 0.775rem; color: #475569; line-height: 1.4;">
            ${escapeHtml(r.message || '')}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; font-size: 0.7rem;">
            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; background: #fee2e2; color: #991b1b; font-weight: 600;">
              Giai đoạn: ${escapeHtml(r.stage)} (${r.daysInStage}/${r.thresholdDays} ngày)
            </span>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="sla-view-cand-btn" data-cand-id="${r.candidateId}" style="background: none; border: none; color: #2563eb; font-weight: 600; cursor: pointer; text-decoration: underline;">Xem hồ sơ</button>
              ${isUnread ? `<button type="button" class="sla-read-btn" data-id="${r.id}" style="background: none; border: none; color: #64748b; cursor: pointer;">Đã xem</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Sự kiện xem hồ sơ ứng viên
    listEl.querySelectorAll('.sla-view-cand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const candId = btn.getAttribute('data-cand-id');
        openCandidateModalById(candId);
      });
    });

    // Sự kiện đánh dấu 1 nhắc việc đã xem
    listEl.querySelectorAll('.sla-read-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const remId = btn.getAttribute('data-id');
        await markReminderAsRead(remId);
        renderRemindersList();
      });
    });
  }

  // ============================================================================
  // UI: GẮN BADGE / CỜ CẢNH BÁO QUÁ HẠN SLA TRÊN DANH SÁCH ỨNG VIÊN (/candidates)
  // ============================================================================

  function renderTableBadges() {
    const tableBody = document.getElementById('candidates-table-body') || document.querySelector('tbody#candidates-table-body');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(row => {
      const candId = getCandidateIdFromRow(row);
      if (!candId) return;

      // 1. Kiểm tra trạng thái quá hạn từ cache hoặc từ currentCandidatesList
      let sla = overdueCandidatesCache.get(candId);
      let isOverdue = Boolean(sla && sla.isOverdue);

      if (!isOverdue && window.currentCandidatesList && Array.isArray(window.currentCandidatesList)) {
        const item = window.currentCandidatesList.find(c => c && (c.id === candId));
        if (item) {
          isOverdue = Boolean(item.is_sla_violated || item.isOverdue || (item.sla && item.sla.isOverdue));
          if (isOverdue && !sla) {
            sla = item.sla || {
              stage: item.stage || 'NEW',
              daysInStage: item.sla?.daysInStage || 4,
              thresholdDays: item.sla?.thresholdDays || 3,
              isOverdue: true
            };
          }
        }
      }

      // Xóa badge cũ nếu ứng viên không còn quá hạn
      const existingBadge = row.querySelector('.sla-overdue-badge');
      if (!isOverdue) {
        if (existingBadge) existingBadge.remove();
        return;
      }

      // Gắn Badge / Cờ cảnh báo màu đỏ hoặc cam rõ ràng
      if (!existingBadge) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-danger sla-overdue-badge';
        badge.style.cssText = `
          background: #dc2626; color: #ffffff; border: 1px solid #b91c1c;
          padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;
          display: inline-flex; align-items: center; gap: 4px; margin-top: 4px;
          box-shadow: 0 1px 2px rgba(220, 38, 38, 0.25); cursor: help;
        `;
        const days = sla ? sla.daysInStage : 4;
        const limit = sla ? sla.thresholdDays : 3;
        badge.title = `Hồ sơ quá hạn SLA (${days}/${limit} ngày chưa xử lý). Vui lòng kiểm tra ngay!`;
        badge.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          <span>Quá hạn SLA</span>
        `;

        // Ưu tiên gắn vào cột Vòng tuyển dụng (cells[4])
        const stageCell = row.cells[4];
        if (stageCell) {
          let container = stageCell.querySelector('.sla-badge-container');
          if (!container) {
            container = document.createElement('div');
            container.className = 'sla-badge-container';
            container.style.marginTop = '4px';
            stageCell.appendChild(container);
          }
          container.appendChild(badge);
        } else {
          // Fallback gắn vào cột Tên (cells[1])
          const nameCell = row.cells[1] || row.querySelector('td');
          if (nameCell) nameCell.appendChild(badge);
        }
      }
    });
  }

  function getCandidateIdFromRow(row) {
    if (!row) return null;
    const directId = row.getAttribute('data-id') || row.getAttribute('data-candidate-id');
    if (directId) return directId;

    // Trích xuất từ nút "Chi tiết" onclick="window.ATS_APP_HELPERS.viewCandidateDetails('xxx')"
    const html = row.innerHTML || '';
    const match = html.match(/viewCandidateDetails\(['"]([^'"]+)['"]\)/);
    if (match && match[1]) return match[1];

    const link = row.querySelector('a[href*="candidate"]');
    if (link) {
      const m = link.href.match(/candidates\/([^/?#]+)/);
      if (m) return m[1];
    }

    return null;
  }

  // ============================================================================
  // UI: RENDER TRỰC TIẾP NHÃN SLA VÀO POPUP CHI TIẾT HỒ SƠ ỨNG VIÊN
  // ============================================================================

  async function handleCandidateDetailModal(explicitCandId = null) {
    const modal = document.getElementById('candidate-detail-modal');
    if (!modal) return;

    // Lấy ID ứng viên hiện tại
    const idInput = modal.querySelector('#cand-detail-id');
    const candId = explicitCandId ||
                  (idInput && idInput.value) ||
                  modal.getAttribute('data-candidate-id') ||
                  window.__CURRENT_ACTIVE_CANDIDATE_ID__;

    if (!candId) return;

    // Nếu modal đang ẩn và không có explicitCandId thì bỏ qua
    if (!explicitCandId && (modal.classList.contains('hidden') || modal.style.display === 'none')) {
      return;
    }

    // Lấy thông tin SLA của ứng viên này (từ cache hoặc API)
    let sla = overdueCandidatesCache.get(candId);
    if (!sla) {
      if (window.currentCandidatesList && Array.isArray(window.currentCandidatesList)) {
        const item = window.currentCandidatesList.find(c => c && c.id === candId);
        if (item) {
          sla = item.sla || {
            isOverdue: Boolean(item.is_sla_violated || item.isOverdue || (item.sla && item.sla.isOverdue)),
            stage: item.stage || 'NEW',
            daysInStage: item.sla?.daysInStage || 4,
            thresholdDays: item.sla?.thresholdDays || 3,
            overdueDays: 1
          };
          overdueCandidatesCache.set(candId, sla);
        }
      }
    }

    // Nếu chưa có, query trực tiếp API
    if (!sla) {
      sla = await fetchCandidateSlaDirect(candId);
    }

    const isOverdue = Boolean(sla && (sla.isOverdue || sla.is_sla_violated));
    const days = sla ? sla.daysInStage : 4;
    const limit = sla ? sla.thresholdDays : 3;
    const stageName = (sla && sla.stage) || 'vòng hiện tại';

    // 1. Render trực tiếp Badge cờ cảnh báo SLA cạnh Stage Badge ở Header (#cand-detail-stage-badge)
    const stageBadge = modal.querySelector('#cand-detail-stage-badge');
    let headerSlaBadge = modal.querySelector('#cand-detail-sla-badge');

    if (isOverdue) {
      if (!headerSlaBadge && stageBadge) {
        headerSlaBadge = document.createElement('span');
        headerSlaBadge.id = 'cand-detail-sla-badge';
        headerSlaBadge.className = 'badge badge-danger';
        headerSlaBadge.style.cssText = `
          background: #dc2626; color: #ffffff; border: 1px solid #b91c1c;
          padding: 4px 10px; border-radius: 9999px; font-weight: 700; font-size: 0.775rem;
          display: inline-flex; align-items: center; gap: 5px; margin-left: 8px;
          box-shadow: 0 1px 3px rgba(220, 38, 38, 0.3); vertical-align: middle;
        `;
        stageBadge.parentNode.insertBefore(headerSlaBadge, stageBadge.nextSibling);
      }
      if (headerSlaBadge) {
        headerSlaBadge.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          <span>Quá hạn SLA (+${days - limit > 0 ? days - limit : 1} ngày)</span>
        `;
        headerSlaBadge.style.display = 'inline-flex';
      }
    } else if (headerSlaBadge) {
      headerSlaBadge.style.display = 'none';
    }

    // 2. Render trực tiếp Banner cảnh báo quá hạn SLA chi tiết tại Modal Body
    // Vị trí chuẩn: Ngay bên dưới box thông tin tổng quan ứng viên (tên, email, sđt) và ngay trên mục Sàng lọc tiêu chí / Chuyển vòng
    let banner = modal.querySelector('#sla-candidate-modal-banner');
    if (isOverdue) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sla-candidate-modal-banner';
        banner.style.cssText = `
          background: #fff1f2; border: 1px solid #fecdd3; border-left: 5px solid #e11d48;
          padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; display: flex;
          align-items: flex-start; gap: 12px; color: #9f1239; font-family: inherit;
          box-shadow: 0 2px 4px rgba(225, 29, 72, 0.08);
        `;
      }

      banner.innerHTML = `
        <div style="background: #ffe4e6; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2.3">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
            <line x1="4" y1="22" x2="4" y2="15"></line>
          </svg>
        </div>
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <strong style="font-weight: 700; font-size: 0.925rem; color: #be123c; display: flex; align-items: center; gap: 6px;">
              <span>🚩 CẢNH BÁO QUÁ HẠN SLA (${days}/${limit} NGÀY)</span>
            </strong>
            <span style="background: #e11d48; color: #ffffff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px; text-transform: uppercase;">
              BREACHED (+${days - limit > 0 ? days - limit : 1} ngày)
            </span>
          </div>
          <div style="font-size: 0.825rem; line-height: 1.5; color: #4c0519;">
            Hồ sơ này đã ở giai đoạn <strong>${escapeHtml(stageName)}</strong> trong <strong>${days} ngày</strong>, vượt quá ngưỡng SLA cam kết (<strong>${limit} ngày</strong> chưa được mở xem hoặc xử lý). Recruiter phụ trách vui lòng ưu tiên sàng lọc hồ sơ hoặc chuyển vòng tuyển dụng ngay để tránh để hồ sơ nằm im.
          </div>
        </div>
      `;
      banner.style.display = 'flex';

      // Chèn banner vào vị trí đẹp nhất: Sau box thông tin cá nhân (overview box) và trước mục Sàng lọc / Pipeline Stage
      const modalBody = modal.querySelector('.modal-body') || modal.querySelector('.dialog-body') || modal;
      const screeningCard = modalBody.querySelector('#cand-screening-detail-card');
      const overviewBox = modalBody.querySelector('div[style*="cand-detail-avatar"]') || modalBody.children[0];

      if (screeningCard) {
        modalBody.insertBefore(banner, screeningCard);
      } else {
        const firstPanel = modalBody.querySelector('.panel-card');
        if (firstPanel) {
          modalBody.insertBefore(banner, firstPanel);
        } else if (overviewBox && overviewBox.nextSibling) {
          modalBody.insertBefore(banner, overviewBox.nextSibling);
        } else {
          modalBody.prepend(banner);
        }
      }
    } else if (banner) {
      banner.style.display = 'none';
    }
  }

  // Hooking vào hàm mở chi tiết hồ sơ ứng viên để render tức thì
  function installViewDetailsHook() {
    // 1. Hook vào window.ATS_APP_HELPERS.viewCandidateDetails
    if (window.ATS_APP_HELPERS && typeof window.ATS_APP_HELPERS.viewCandidateDetails === 'function') {
      if (!window.ATS_APP_HELPERS.viewCandidateDetails.__slaHooked__) {
        const origViewDetails = window.ATS_APP_HELPERS.viewCandidateDetails;
        window.ATS_APP_HELPERS.viewCandidateDetails = async function (id) {
          window.__CURRENT_ACTIVE_CANDIDATE_ID__ = id;
          try {
            const res = await origViewDetails.apply(this, arguments);
            // Render trực tiếp SLA ra màn hình modal ngay khi mở (retry liên tục các mốc thời gian để đón DOM)
            [10, 50, 150, 300, 600].forEach(delay => {
              setTimeout(() => handleCandidateDetailModal(id), delay);
            });
            return res;
          } catch (e) {
            handleCandidateDetailModal(id);
            throw e;
          }
        };
        window.ATS_APP_HELPERS.viewCandidateDetails.__slaHooked__ = true;
      }
    }

    // 2. Tự động gắn hook vào MutationObserver trên candidate-detail-modal
    const modal = document.getElementById('candidate-detail-modal');
    if (modal && !modal.__slaObserverAttached__) {
      const modalObserver = new MutationObserver(() => {
        if (!modal.classList.contains('hidden') && modal.style.display !== 'none') {
          const idInput = modal.querySelector('#cand-detail-id');
          const candId = (idInput && idInput.value) || window.__CURRENT_ACTIVE_CANDIDATE_ID__;
          if (candId) {
            handleCandidateDetailModal(candId);
          }
        }
      });
      modalObserver.observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
      modal.__slaObserverAttached__ = true;
    }
  }

  // ============================================================================
  // UI: MODAL CẤU HÌNH NGƯỠNG SLA CHO TỪNG GIAI ĐOẠN (AC-01)
  // ============================================================================

  function ensureSlaConfigModal() {
    if (document.getElementById('sla-configuration-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'sla-configuration-modal';
    modal.className = 'modal-backdrop hidden';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.5); z-index: 1100; display: none; align-items: center; justify-content: center; backdrop-filter: blur(2px);';

    modal.innerHTML = `
      <div style="background: #ffffff; width: 540px; max-width: 95vw; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); overflow: hidden; font-family: inherit;">
        <div style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background: #fafafa;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #0f172a;">Cấu hình ngưỡng SLA theo giai đoạn</h3>
          </div>
          <button type="button" id="sla-cfg-close-btn" style="background: none; border: none; font-size: 1.25rem; color: #94a3b8; cursor: pointer; padding: 4px;">&times;</button>
        </div>

        <form id="sla-cfg-form" style="padding: 20px; margin: 0;">
          <div style="font-size: 0.825rem; color: #64748b; margin-bottom: 16px; line-height: 1.4;">
            Cấu hình số ngày tối đa hồ sơ được phép ở từng giai đoạn. Nếu vượt quá số ngày này, hồ sơ sẽ được gắn cờ quá hạn và gửi thông báo nhắc việc hàng ngày tới Recruiter.
          </div>

          <div style="display: flex; flex-direction: column; gap: 14px;">
            <!-- Stage: NEW -->
            <div style="display: grid; grid-template-columns: 140px 1fr 100px; gap: 10px; align-items: center; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
              <div>
                <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-weight: 700; font-size: 0.775rem;">Mới (NEW)</span>
              </div>
              <div style="font-size: 0.775rem; color: #475569;">Thời hạn tối đa để đọc và sàng lọc CV mới</div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" id="sla-input-NEW" min="1" max="60" value="3" required style="width: 60px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; text-align: center; font-weight: 600;" />
                <span style="font-size: 0.75rem; color: #64748b;">ngày</span>
              </div>
            </div>

            <!-- Stage: SCREENING -->
            <div style="display: grid; grid-template-columns: 140px 1fr 100px; gap: 10px; align-items: center; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
              <div>
                <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #fef3c7; color: #b45309; font-weight: 700; font-size: 0.775rem;">Sàng lọc</span>
              </div>
              <div style="font-size: 0.775rem; color: #475569;">Đánh giá hồ sơ chuyên sâu trước phỏng vấn</div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" id="sla-input-SCREENING" min="1" max="60" value="5" required style="width: 60px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; text-align: center; font-weight: 600;" />
                <span style="font-size: 0.75rem; color: #64748b;">ngày</span>
              </div>
            </div>

            <!-- Stage: INTERVIEW -->
            <div style="display: grid; grid-template-columns: 140px 1fr 100px; gap: 10px; align-items: center; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
              <div>
                <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #f3e8ff; color: #6b21a8; font-weight: 700; font-size: 0.775rem;">Phỏng vấn</span>
              </div>
              <div style="font-size: 0.775rem; color: #475569;">Lên lịch và hoàn thành các vòng phỏng vấn</div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" id="sla-input-INTERVIEW" min="1" max="60" value="7" required style="width: 60px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; text-align: center; font-weight: 600;" />
                <span style="font-size: 0.75rem; color: #64748b;">ngày</span>
              </div>
            </div>

            <!-- Stage: OFFER -->
            <div style="display: grid; grid-template-columns: 140px 1fr 100px; gap: 10px; align-items: center; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
              <div>
                <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #dcfce7; color: #15803d; font-weight: 700; font-size: 0.775rem;">Đề nghị (Offer)</span>
              </div>
              <div style="font-size: 0.775rem; color: #475569;">Gửi đề nghị việc làm và đợi phản hồi</div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" id="sla-input-OFFER" min="1" max="60" value="5" required style="width: 60px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; text-align: center; font-weight: 600;" />
                <span style="font-size: 0.75rem; color: #64748b;">ngày</span>
              </div>
            </div>
          </div>

          <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 10px;">
            <button type="button" id="sla-cfg-cancel-btn" style="padding: 8px 16px; border: 1px solid #cbd5e1; border-radius: 6px; background: #ffffff; color: #475569; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
              Hủy bỏ
            </button>
            <button type="submit" id="sla-cfg-save-btn" style="padding: 8px 20px; border: none; border-radius: 6px; background: #2563eb; color: #ffffff; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
              Lưu cấu hình SLA
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#sla-cfg-close-btn').addEventListener('click', closeSlaConfigModal);
    modal.querySelector('#sla-cfg-cancel-btn').addEventListener('click', closeSlaConfigModal);

    modal.querySelector('#sla-cfg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = [
        { stage: 'NEW', thresholdDays: parseInt(document.getElementById('sla-input-NEW').value, 10) || 3 },
        { stage: 'SCREENING', thresholdDays: parseInt(document.getElementById('sla-input-SCREENING').value, 10) || 5 },
        { stage: 'INTERVIEW', thresholdDays: parseInt(document.getElementById('sla-input-INTERVIEW').value, 10) || 7 },
        { stage: 'OFFER', thresholdDays: parseInt(document.getElementById('sla-input-OFFER').value, 10) || 5 }
      ];
      await saveSlaConfigs(payload);
    });
  }

  async function openSlaConfigModal() {
    ensureSlaConfigModal();
    const modal = document.getElementById('sla-configuration-modal');
    if (!modal) return;

    const configs = await fetchSlaConfigs();
    if (configs && Array.isArray(configs)) {
      for (const c of configs) {
        const inp = document.getElementById(`sla-input-${c.stage}`);
        if (inp) inp.value = c.thresholdDays || 3;
      }
    }

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  function closeSlaConfigModal() {
    const modal = document.getElementById('sla-configuration-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }

  // ============================================================================
  // TIỆN ÍCH HỖ TRỢ
  // ============================================================================

  function openCandidateModalById(candId) {
    if (!candId) return;
    window.__CURRENT_ACTIVE_CANDIDATE_ID__ = candId;
    if (window.ATS_APP_HELPERS && typeof window.ATS_APP_HELPERS.viewCandidateDetails === 'function') {
      window.ATS_APP_HELPERS.viewCandidateDetails(candId);
    } else if (typeof window.openCandidateDetailModal === 'function') {
      window.openCandidateDetailModal(candId);
    } else {
      const row = document.querySelector(`tr[data-id="${candId}"]`) || document.querySelector(`tr[data-candidate-id="${candId}"]`);
      if (row) {
        const btn = row.querySelector('.btn-view, .action-view, a, button');
        if (btn) btn.click();
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#039;';
        default: return m;
      }
    });
  }

  function formatDateSimple(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} ${d.getDate()}/${d.getMonth() + 1}`;
    } catch {
      return dateStr;
    }
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(type, 'SLA', message);
      return;
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      padding: 10px 16px; border-radius: 8px; font-size: 0.875rem; font-weight: 500;
      color: #fff; background: ${type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#2563eb'};
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: opacity 0.3s;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================================================
  // OBSERVER & AUTO-INITIALIZATION
  // ============================================================================

  function runLifecycle() {
    installViewDetailsHook();
    ensureTopBarSlaBell();
    renderTableBadges();
    handleCandidateDetailModal();
  }

  async function init() {
    installViewDetailsHook();
    ensureTopBarSlaBell();
    await fetchSlaConfigs();
    await fetchOverdueCandidates();
    await fetchRecruiterReminders();
    runLifecycle();

    // Lắng nghe thay đổi DOM (cả thêm/bớt phần tử và thay đổi thuộc tính class/style/value)
    const observer = new MutationObserver((mutations) => {
      let shouldRun = false;
      for (const m of mutations) {
        if (m.type === 'childList') {
          shouldRun = true;
          break;
        } else if (m.type === 'attributes') {
          if (m.target && (m.target.id === 'candidate-detail-modal' || m.target.id === 'candidates-table-body' || m.target.id === 'cand-detail-id')) {
            shouldRun = true;
            break;
          }
        }
      }
      if (shouldRun) {
        runLifecycle();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'value', 'data-candidate-id']
    });

    // Định kỳ làm mới mỗi 60 giây
    setInterval(async () => {
      await fetchOverdueCandidates();
      await fetchRecruiterReminders();
      runLifecycle();
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export global API cho component khác khi cần
  window.CandidateSlaModule = {
    fetchSlaConfigs,
    fetchOverdueCandidates,
    fetchRecruiterReminders,
    openSlaConfigModal,
    triggerSlaCheckNow,
    handleCandidateDetailModal,
    renderTableBadges,
    runLifecycle
  };
})();
