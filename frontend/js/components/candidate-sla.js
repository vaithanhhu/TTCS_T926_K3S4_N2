/**
 * ==============================================================================
 * USER STORY S5-10 (SCRUM-120) - CANDIDATE SLA NOTIFICATION & MONITORING UI
 * ==============================================================================
 * 
 * Là Nhân viên tuyển dụng, tôi muốn được nhắc khi công việc quá hạn SLA,
 * để không để hồ sơ nằm im ba ngày mà chưa ai đọc.
 * 
 * TIÊU CHÍ KỸ THUẬT:
 *   • Hoạt động độc lập bằng MutationObserver và Self-Mounting
 *   • TUYỆT ĐỐI KHÔNG SỬA BẤT KỲ FILE HTML / JS CŨ NÀO CỦA HỆ THỐNG
 *   • Hiển thị cờ cảnh báo quá hạn SLA trên danh sách ứng viên và chi tiết ứng viên
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
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
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
      const res = await fetch('/api/v1/sla/overdue-candidates', { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.success && data.data && Array.isArray(data.data.candidates)) {
        overdueCandidatesCache.clear();
        for (const c of data.data.candidates) {
          overdueCandidatesCache.set(c.id, c.sla);
        }
        return data.data.candidates;
      }
    } catch (e) {
      console.warn('[SLA] fetchOverdueCandidates error:', e);
    }
    return [];
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
        <span id="sla-bell-badge" style="display: none; position: absolute; top: -4px; right: -4px; background: #ef4444; color: #fff; font-size: 0.675rem; font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px; line-height: 18px; text-align: center; padding: 0 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">0</span>
      </button>

      <!-- Dropdown Popover Nhắc việc -->
      <div id="sla-reminders-popover" class="sla-reminders-popover" style="display: none; position: absolute; right: 0; top: 46px; width: 360px; max-width: calc(100vw - 32px); background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; z-index: 1050; overflow: hidden; font-family: inherit;">
        <div style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; background: #fafafa;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
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
              ⚠️ ${escapeHtml(r.candidateName || 'Ứng viên')}
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
  // UI: GẮN CỜ QUÁ HẠN SLA TRÊN DANH SÁCH ỨNG VIÊN (CANDIDATES TABLE)
  // ============================================================================

  function renderTableBadges() {
    // Tìm các dòng trong bảng ứng viên
    const table = document.querySelector('#candidates-table') || document.querySelector('table[data-table="candidates"]') || document.querySelector('#view-candidates table');
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const candId = row.getAttribute('data-id') || row.getAttribute('data-candidate-id') || getCandidateIdFromRow(row);
      if (!candId) return;

      const sla = overdueCandidatesCache.get(candId);
      if (sla && sla.isOverdue) {
        // Gắn cờ vi phạm SLA nếu chưa có
        let badge = row.querySelector('.sla-overdue-flag');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'sla-overdue-flag';
          badge.style.cssText = 'background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; vertical-align: middle; cursor: help;';
          badge.title = sla.label || `Quá hạn SLA ${sla.daysInStage}/${sla.thresholdDays} ngày`;
          badge.innerHTML = `
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Quá hạn SLA ${sla.overdueDays > 0 ? `+${sla.overdueDays}d` : ''}
          `;

          // Gắn vào cột tên hoặc cột giai đoạn
          const nameCell = row.cells[0] || row.querySelector('.candidate-name') || row.querySelector('td');
          if (nameCell) {
            nameCell.appendChild(badge);
          }
        }
      }
    });
  }

  function getCandidateIdFromRow(row) {
    const link = row.querySelector('a[href*="candidate"]');
    if (link) {
      const m = link.href.match(/candidates\/([^/?#]+)/);
      if (m) return m[1];
    }
    const btn = row.querySelector('button[data-id]');
    if (btn) return btn.getAttribute('data-id');
    return null;
  }

  // ============================================================================
  // UI: CẢNH BÁO SLA TRONG MODAL CHI TIẾT ỨNG VIÊN (CANDIDATE DETAIL MODAL)
  // ============================================================================

  function handleCandidateDetailModal() {
    const modal = document.getElementById('candidate-detail-modal');
    if (!modal || modal.classList.contains('hidden') || modal.style.display === 'none') return;

    // Lấy ID ứng viên hiện tại trong modal
    const candId = modal.getAttribute('data-candidate-id') ||
                  modal.querySelector('[data-candidate-id]')?.getAttribute('data-candidate-id') ||
                  window.__CURRENT_ACTIVE_CANDIDATE_ID__;

    if (!candId) return;

    const sla = overdueCandidatesCache.get(candId);
    let banner = modal.querySelector('#sla-candidate-modal-banner');

    if (sla && sla.isOverdue) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sla-candidate-modal-banner';
        banner.style.cssText = 'background: #fff7ed; border-left: 4px solid #ea580c; padding: 10px 14px; border-radius: 6px; margin: 12px 16px; display: flex; align-items: flex-start; gap: 10px; font-size: 0.825rem; color: #9a3412;';
        
        const modalBody = modal.querySelector('.modal-body') || modal.querySelector('.dialog-body') || modal;
        if (modalBody) {
          modalBody.insertBefore(banner, modalBody.firstChild);
        }
      }

      banner.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2" style="flex-shrink: 0; margin-top: 1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>
          <div style="font-weight: 700; margin-bottom: 2px;">CẢNH BÁO QUÁ HẠN SLA (${sla.daysInStage}/${sla.thresholdDays} ngày)</div>
          <div>Hồ sơ này đã ở giai đoạn <strong>${escapeHtml(sla.stage)}</strong> trong <strong>${sla.daysInStage} ngày</strong>, vượt quá ngưỡng SLA quy định (<strong>${sla.thresholdDays} ngày</strong>). Recruiter phụ trách vui lòng sàng lọc hoặc cập nhật trạng thái ngay để tránh để hồ sơ nằm im.</div>
        </div>
      `;
    } else if (banner) {
      banner.remove();
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
              <div style="font-size: 0.775rem; color: #475569;">Thời gian tối đa để đọc và sàng lọc CV mới</div>
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
    if (typeof window.openCandidateDetailModal === 'function') {
      window.openCandidateDetailModal(candId);
    } else {
      // Tìm dòng trong bảng ứng viên và kích hoạt click
      const row = document.querySelector(`tr[data-id="${candId}"]`) || document.querySelector(`tr[data-candidate-id="${candId}"]`);
      if (row) {
        const btn = row.querySelector('.btn-view, .action-view, a');
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
      window.showToast(message, type);
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
    ensureTopBarSlaBell();
    renderTableBadges();
    handleCandidateDetailModal();
  }

  async function init() {
    ensureTopBarSlaBell();
    await fetchSlaConfigs();
    await fetchOverdueCandidates();
    await fetchRecruiterReminders();
    runLifecycle();

    // Lắng nghe thay đổi DOM
    const observer = new MutationObserver(() => {
      runLifecycle();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
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
    triggerSlaCheckNow
  };
})();
