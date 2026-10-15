/**
 * SCRUM-117 (S5-07): Candidate Interaction Timeline Component
 *
 * Hiển thị nhật ký toàn bộ tương tác với ứng viên:
 * - Nộp hồ sơ (Application)
 * - Chuyển giai đoạn (Stage transition)
 * - Email đã gửi (Sent emails)
 * - Lịch phỏng vấn (Interview schedule)
 * - Đánh giá & Ghi chú (Evaluations & Notes)
 * Sắp xếp mới nhất trước.
 */

(function () {
  'use strict';

  const EVENT_CONFIG = {
    APPLICATION_SUBMITTED: {
      icon: '📄',
      badgeClass: 'badge-success',
      badgeLabel: 'Nộp hồ sơ',
      color: '#10b981'
    },
    APPLICATION_WITHDRAWN: {
      icon: '↩️',
      badgeClass: 'badge-danger',
      badgeLabel: 'Rút hồ sơ',
      color: '#ef4444'
    },
    STAGE_CHANGED: {
      icon: '🔄',
      badgeClass: 'badge-primary',
      badgeLabel: 'Chuyển vòng',
      color: '#3b82f6'
    },
    EMAIL_SENT: {
      icon: '✉️',
      badgeClass: 'badge-info',
      badgeLabel: 'Email gửi',
      color: '#8b5cf6'
    },
    INTERVIEW_SCHEDULED: {
      icon: '📅',
      badgeClass: 'badge-warning',
      badgeLabel: 'Lịch phỏng vấn',
      color: '#f59e0b'
    },
    EVALUATION_SUBMITTED: {
      icon: '🌟',
      badgeClass: 'badge-warning',
      badgeLabel: 'Đánh giá PV',
      color: '#eab308'
    },
    NOTE_ADDED: {
      icon: '📝',
      badgeClass: 'badge-neutral',
      badgeLabel: 'Ghi chú',
      color: '#6b7280'
    }
  };

  function formatVietnamTime(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return isoString;
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Render dòng thời gian tương tác vào container được chỉ định
   */
  async function renderCandidateTimeline(candidateId, containerEl) {
    if (!containerEl || !candidateId) return;

    containerEl.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">
        <span class="spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px;"></span>
        Đang tải nhật ký tương tác...
      </div>
    `;

    const token = sessionStorage.getItem('ats_token');
    if (!token) {
      containerEl.innerHTML = `
        <div style="padding: 12px; background: #fee2e2; color: #991b1b; border-radius: 4px; font-size: 0.85rem;">
          Vui lòng đăng nhập để xem nhật ký tương tác.
        </div>
      `;
      return;
    }

    try {
      const res = await fetch(`/api/v1/candidates/${encodeURIComponent(candidateId)}/timeline`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        containerEl.innerHTML = `
          <div style="padding: 10px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 6px; font-size: 0.85rem;">
            ${escapeHtml(json.message || 'Không thể tải nhật ký tương tác ứng viên.')}
          </div>
        `;
        return;
      }

      const events = json.data?.timeline || [];
      if (events.length === 0) {
        containerEl.innerHTML = `
          <div style="padding: 16px; text-align: center; color: var(--color-text-muted); font-size: 0.85rem; background: var(--color-bg-page); border-radius: 6px;">
            Chưa có tương tác nào được ghi nhận cho ứng viên này.
          </div>
        `;
        return;
      }

      // Render danh sách dòng thời gian (mới nhất trước)
      const html = `
        <div class="candidate-timeline-feed" style="position: relative; padding-left: 24px; display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
          <!-- Vertical line indicator -->
          <div style="position: absolute; left: 10px; top: 8px; bottom: 8px; width: 2px; background: var(--color-border); z-index: 1;"></div>

          ${events.map(item => {
            const cfg = EVENT_CONFIG[item.eventType] || {
              icon: '📌',
              badgeClass: 'badge-neutral',
              badgeLabel: item.eventType,
              color: '#64748b'
            };
            const timeStr = formatVietnamTime(item.timestamp);

            return `
              <div class="timeline-item" style="position: relative; z-index: 2;">
                <!-- Node Icon -->
                <div style="position: absolute; left: -24px; top: 4px; width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 2px solid ${cfg.color}; display: flex; align-items: center; justify-content: center; font-size: 11px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  ${cfg.icon}
                </div>

                <!-- Event Card -->
                <div style="background: var(--color-bg-page); border: 1px solid var(--color-border); border-radius: 6px; padding: 10px 12px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span class="badge ${cfg.badgeClass}" style="font-size: 0.7rem; padding: 2px 6px;">${cfg.badgeLabel}</span>
                      <strong style="font-size: 0.85rem; color: var(--color-text);">${escapeHtml(item.title)}</strong>
                    </div>
                    <span style="font-size: 0.75rem; color: var(--color-text-muted); font-family: monospace;">
                      🕒 ${timeStr}
                    </span>
                  </div>

                  <div style="font-size: 0.82rem; color: var(--color-text); line-height: 1.45; margin-bottom: 4px;">
                    ${escapeHtml(item.summary)}
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--color-text-muted); border-top: 1px dashed var(--color-border); padding-top: 4px; margin-top: 4px;">
                    <span>Thực hiện bởi: <strong style="color: var(--color-text);">${escapeHtml(item.actorName || 'Hệ thống')}</strong></span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      containerEl.innerHTML = html;
    } catch (err) {
      console.error('[Timeline Fetch Error]', err);
      containerEl.innerHTML = `
        <div style="padding: 10px; background: #fef2f2; color: #b91c1c; border-radius: 4px; font-size: 0.85rem;">
          Lỗi kết nối khi tải nhật ký tương tác.
        </div>
      `;
    }
  }

  // Tự động hook vào Candidate Detail Modal khi mở mà không cần sửa file HTML cũ
  function autoMountTimelineSection() {
    const modal = document.getElementById('candidate-detail-modal');
    if (!modal) return;

    const observer = new MutationObserver(() => {
      if (!modal.classList.contains('hidden')) {
        const candidateIdInput = document.getElementById('cand-detail-id');
        const candidateId = candidateIdInput ? candidateIdInput.value : null;
        if (!candidateId) return;

        let section = document.getElementById('cand-detail-timeline-section');
        if (!section) {
          section = document.createElement('div');
          section.id = 'cand-detail-timeline-section';
          section.style.marginTop = '18px';
          section.style.borderTop = '1px solid var(--color-border)';
          section.style.paddingTop = '14px';

          section.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h5 style="margin: 0; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span>⏱️ Nhật ký Tương tác (SCRUM-117 / S5-07)</span>
              </h5>
              <button type="button" id="refresh-timeline-btn" class="btn btn-outline btn-xs" style="padding: 2px 8px; font-size: 0.75rem;">
                Làm mới
              </button>
            </div>
            <div id="cand-detail-timeline-container" style="max-height: 260px; overflow-y: auto; padding-right: 4px;">
              <!-- Timeline items rendered here -->
            </div>
          `;

          // Gắn vào trước hàng nút thao tác cuối cùng của modal
          const modalBody = modal.querySelector('.modal-body') || modal;
          const footerActions = document.getElementById('cand-detail-schedule-btn')?.parentElement;
          if (footerActions && footerActions.parentElement === modalBody) {
            modalBody.insertBefore(section, footerActions);
          } else {
            modalBody.appendChild(section);
          }

          document.getElementById('refresh-timeline-btn')?.addEventListener('click', () => {
            const cId = document.getElementById('cand-detail-id')?.value;
            const container = document.getElementById('cand-detail-timeline-container');
            if (cId && container) renderCandidateTimeline(cId, container);
          });
        }

        const container = document.getElementById('cand-detail-timeline-container');
        if (container && section.dataset.loadedCandidateId !== candidateId) {
          section.dataset.loadedCandidateId = candidateId;
          renderCandidateTimeline(candidateId, container);
        }
      }
    });

    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  // Khởi chạy khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMountTimelineSection);
  } else {
    autoMountTimelineSection();
  }

  // Xuất helper ra global scope
  window.ATS_CANDIDATE_TIMELINE = {
    render: renderCandidateTimeline
  };
})();
