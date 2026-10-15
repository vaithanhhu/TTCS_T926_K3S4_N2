/**
 * ==============================================================================
 * USER STORY S5-09 (SCRUM-119) - CANDIDATE SCREENING & SCORING COMPONENT
 * ==============================================================================
 * 
 * Là Nhân viên tuyển dụng, tôi muốn có hồ sơ mới được chấm điểm sàng lọc theo
 * tiêu chí bắt buộc của vị trí, để ưu tiên đọc trước những hồ sơ có khả năng
 * phù hợp nhất.
 * 
 * Tiêu chí chấp nhận (Acceptance Criteria):
 *   • AC-01: Khai báo tiêu chí bắt buộc cho vị trí: số năm kinh nghiệm, bằng cấp, kỹ năng
 *   • AC-02: Hồ sơ mới được gắn điểm phù hợp và cờ Đạt hoặc Không đạt tiêu chí bắt buộc
 *   • AC-03: Điểm chỉ để gợi ý sắp xếp, không tự động loại ứng viên
 * 
 * NGUYÊN TẮC: KHÔNG CHỈNH SỬA BẤT KỲ FILE HTML CŨ HOẶC FILE GIAO DIỆN CŨ NÀO.
 * Toàn bộ UI được tự động gắn (self-mounting) thông qua DOM MutationObserver.
 * ==============================================================================
 */

(function () {
  'use strict';

  const EDUCATION_NAMES = {
    NONE: 'Không yêu cầu',
    HIGH_SCHOOL: 'THPT / Trung cấp',
    ASSOCIATE: 'Cao đẳng',
    BACHELOR: 'Đại học / Cử nhân / Kỹ sư',
    MASTER: 'Thạc sĩ',
    DOCTORATE: 'Tiến sĩ'
  };

  // Helper gọi API có kèm token xác thực
  async function apiRequest(endpoint, options = {}) {
    const token = sessionStorage.getItem('ats_token');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };

    const res = await fetch(endpoint, { ...options, headers });
    return await res.json();
  }

  /**
   * Lấy tiêu chí bắt buộc của vị trí tuyển dụng
   */
  async function fetchScreeningCriteria(requisitionId) {
    if (!requisitionId) return null;
    return await apiRequest(`/api/v1/requisitions/${encodeURIComponent(requisitionId)}/screening-criteria`);
  }

  /**
   * Lưu cấu hình tiêu chí bắt buộc cho vị trí tuyển dụng
   */
  async function saveScreeningCriteria(requisitionId, criteria) {
    if (!requisitionId) return null;
    return await apiRequest(`/api/v1/requisitions/${encodeURIComponent(requisitionId)}/screening-criteria`, {
      method: 'PUT',
      body: JSON.stringify(criteria)
    });
  }

  /**
   * Chấm điểm sàng lọc cho 1 ứng viên cụ thể
   */
  async function screenCandidateApi(candidateId) {
    if (!candidateId) return null;
    return await apiRequest(`/api/v1/candidates/${encodeURIComponent(candidateId)}/screen`, {
      method: 'POST'
    });
  }

  /**
   * Chấm điểm hàng loạt toàn bộ hồ sơ trong vị trí tuyển dụng
   */
  async function screenAllRequisitionCandidatesApi(requisitionId) {
    if (!requisitionId) return null;
    return await apiRequest(`/api/v1/requisitions/${encodeURIComponent(requisitionId)}/screen-all`, {
      method: 'POST'
    });
  }

  /**
   * Lấy danh sách hồ sơ được xếp hạng theo điểm sàng lọc
   */
  async function fetchRankedCandidates(requisitionId, { filter = 'all', sortBy = 'fit_score_desc' } = {}) {
    if (!requisitionId) return null;
    return await apiRequest(`/api/v1/requisitions/${encodeURIComponent(requisitionId)}/screening-candidates?filter=${filter}&sortBy=${sortBy}`);
  }

  /**
   * Render Badge điểm số và cờ Đạt / Không đạt tiêu chí bắt buộc
   */
  function renderScreeningBadge(screening) {
    if (!screening || screening.fitScore === undefined) {
      return `
        <span class="badge badge-neutral" style="font-size: 0.72rem; padding: 2px 6px;" title="Chưa được chấm điểm sàng lọc">
          ⏳ Chưa chấm điểm
        </span>
      `;
    }

    const { fitScore, mandatoryPass, breakdown } = screening;
    const roundedScore = Math.round(fitScore);

    if (mandatoryPass) {
      return `
        <span class="badge badge-success" style="font-size: 0.75rem; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #10b981;"
              title="Đạt toàn bộ tiêu chí bắt buộc của vị trí | Điểm phù hợp: ${roundedScore}/100">
          <span>✓ Đạt tiêu chí</span>
          <strong style="background: rgba(0,0,0,0.1); padding: 1px 4px; border-radius: 3px;">${roundedScore}đ</strong>
        </span>
      `;
    }

    let missing = [];
    if (breakdown) {
      if (breakdown.experience && !breakdown.experience.passed) missing.push(`Kinh nghiệm (< ${breakdown.experience.required} năm)`);
      if (breakdown.education && !breakdown.education.passed) missing.push(`Bằng cấp (< ${EDUCATION_NAMES[breakdown.education.required] || breakdown.education.required})`);
      if (breakdown.skills && !breakdown.skills.passed && breakdown.skills.missingSkills?.length > 0) {
        missing.push(`Thiếu: ${breakdown.skills.missingSkills.join(', ')}`);
      }
    }

    const missingTitle = missing.length > 0 ? ` (Chưa đạt: ${missing.join('; ')})` : '';

    return `
      <span class="badge badge-warning" style="font-size: 0.75rem; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #f59e0b;"
            title="Chưa đạt tiêu chí bắt buộc${missingTitle} | Điểm phù hợp: ${roundedScore}/100 [Gợi ý ưu tiên, không tự động loại]">
        <span>⚠️ Chưa đạt</span>
        <strong style="background: rgba(0,0,0,0.1); padding: 1px 4px; border-radius: 3px;">${roundedScore}đ</strong>
      </span>
    `;
  }

  /**
   * Tạo Modal cấu hình tiêu chí bắt buộc (Screening Criteria Modal)
   * Tự tạo và chèn vào body mà không sửa file HTML cũ
   */
  function ensureCriteriaModal() {
    let modal = document.getElementById('requisition-criteria-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'requisition-criteria-modal';
      modal.className = 'modal-overlay hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="modal-card" style="max-width: 560px;">
          <div class="modal-header">
            <div>
              <h3 class="modal-title" style="display: flex; align-items: center; gap: 6px;">
                <span>🎯 Cấu hình Tiêu chí Bắt buộc (SCRUM-119 / S5-09)</span>
              </h3>
              <p class="modal-desc" style="margin: 4px 0 0 0;">
                Khai báo tiêu chí bắt buộc cho vị trí để hệ thống tự động chấm điểm và xếp thứ tự ưu tiên đọc trước.
              </p>
            </div>
            <button type="button" id="close-criteria-modal-btn" class="modal-close" aria-label="Đóng">&times;</button>
          </div>
          
          <form id="requisition-criteria-form" style="padding: 16px 20px;">
            <input type="hidden" id="criteria-requisition-id" />
            
            <!-- Tiêu chí 1: Số năm kinh nghiệm -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="criteria-min-exp" class="form-label" style="font-weight: 600;">
                1. Số năm kinh nghiệm tối thiểu bắt buộc
              </label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="number" id="criteria-min-exp" min="0" max="40" value="1" class="form-input" style="flex: 1;" />
                <span style="font-size: 0.85rem; color: var(--color-text-muted); white-space: nowrap;">năm kinh nghiệm</span>
              </div>
            </div>

            <!-- Tiêu chí 2: Trình độ bằng cấp tối thiểu -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="criteria-req-education" class="form-label" style="font-weight: 600;">
                2. Trình độ bằng cấp / học vấn tối thiểu bắt buộc
              </label>
              <select id="criteria-req-education" class="form-input">
                <option value="NONE">Không yêu cầu</option>
                <option value="HIGH_SCHOOL">Trung học phổ thông / Trung cấp</option>
                <option value="ASSOCIATE">Cao đẳng</option>
                <option value="BACHELOR" selected>Đại học / Cử nhân / Kỹ sư</option>
                <option value="MASTER">Thạc sĩ</option>
                <option value="DOCTORATE">Tiến sĩ / PhD</option>
              </select>
            </div>

            <!-- Tiêu chí 3: Kỹ năng bắt buộc -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="criteria-req-skills" class="form-label" style="font-weight: 600;">
                3. Danh sách kỹ năng bắt buộc (Cách nhau bằng dấu phẩy)
              </label>
              <input type="text" id="criteria-req-skills" placeholder="Ví dụ: React, Node.js, SQL, TypeScript" class="form-input" />
              <div style="font-size: 0.775rem; color: var(--color-text-muted); margin-top: 4px;">
                Hệ thống tự động so khớp với kỹ năng và nội dung văn bản CV của ứng viên.
              </div>
            </div>

            <!-- Phân bổ trọng số tính điểm phù hợp -->
            <div class="panel-card" style="padding: 12px; margin-bottom: 14px; background: var(--color-bg-page); border: 1px solid var(--color-border);">
              <div style="font-size: 0.825rem; font-weight: 600; margin-bottom: 8px; color: var(--color-text);">
                ⚖️ Phân bổ trọng số tính Điểm phù hợp (Tổng = 100%)
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center; font-size: 0.8rem;">
                <div>
                  <span style="display: block; color: var(--color-text-muted); margin-bottom: 2px;">Kinh nghiệm</span>
                  <input type="number" id="criteria-w-exp" value="40" min="0" max="100" class="form-input" style="text-align: center; padding: 4px;" />
                </div>
                <div>
                  <span style="display: block; color: var(--color-text-muted); margin-bottom: 2px;">Bằng cấp</span>
                  <input type="number" id="criteria-w-edu" value="20" min="0" max="100" class="form-input" style="text-align: center; padding: 4px;" />
                </div>
                <div>
                  <span style="display: block; color: var(--color-text-muted); margin-bottom: 2px;">Kỹ năng</span>
                  <input type="number" id="criteria-w-skills" value="40" min="0" max="100" class="form-input" style="text-align: center; padding: 4px;" />
                </div>
              </div>
            </div>

            <!-- Lưu ý quan trọng AC-03 -->
            <div style="padding: 10px 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 0.8rem; color: #92400e; margin-bottom: 14px; display: flex; gap: 8px; align-items: flex-start;">
              <span style="font-size: 1rem;">ℹ️</span>
              <div>
                <strong>Lưu ý:</strong> Điểm số và cờ Đạt/Không đạt chỉ để gợi ý sắp xếp ưu tiên đọc trước, <strong>tuyệt đối không tự động loại</strong> ứng viên khỏi quy trình tuyển dụng.
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
              <input type="checkbox" id="criteria-rescreen-all" checked style="cursor: pointer;" />
              <label for="criteria-rescreen-all" style="font-size: 0.825rem; color: var(--color-text); cursor: pointer;">
                Tự động chấm điểm lại toàn bộ hồ sơ hiện có theo tiêu chí mới
              </label>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--color-border); padding-top: 12px;">
              <button type="button" id="cancel-criteria-modal-btn" class="btn btn-outline btn-sm">
                Đóng
              </button>
              <button type="submit" id="save-criteria-modal-btn" class="btn btn-primary btn-sm">
                Lưu tiêu chí & Chấm điểm
              </button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('close-criteria-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
      document.getElementById('cancel-criteria-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));

      document.getElementById('requisition-criteria-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reqId = document.getElementById('criteria-requisition-id').value;
        const minExp = parseInt(document.getElementById('criteria-min-exp').value, 10) || 0;
        const reqEdu = document.getElementById('criteria-req-education').value;
        const skills = document.getElementById('criteria-req-skills').value.split(',').map(s => s.trim()).filter(Boolean);
        const wExp = parseInt(document.getElementById('criteria-w-exp').value, 10) || 40;
        const wEdu = parseInt(document.getElementById('criteria-w-edu').value, 10) || 20;
        const wSkills = parseInt(document.getElementById('criteria-w-skills').value, 10) || 40;
        const autoRescreen = document.getElementById('criteria-rescreen-all').checked;

        const submitBtn = document.getElementById('save-criteria-modal-btn');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Đang lưu...';
        }

        try {
          const res = await saveScreeningCriteria(reqId, {
            minExperienceYears: minExp,
            requiredEducation: reqEdu,
            requiredSkills: skills,
            weightExperience: wExp,
            weightEducation: wEdu,
            weightSkills: wSkills,
            autoRescreen
          });

          if (res && res.success) {
            modal.classList.add('hidden');
            if (window.showToast) {
              window.showToast('success', 'Lưu tiêu chí thành công', 'Hệ thống đã cập nhật tiêu chí sàng lọc và chấm điểm hồ sơ.');
            }
            // Làm mới giao diện nếu có hàm loadCandidates
            if (typeof window.loadCandidates === 'function') window.loadCandidates();
          } else {
            alert(res?.message || 'Không thể lưu tiêu chí sàng lọc.');
          }
        } catch (err) {
          console.error('[SaveCriteria Error]', err);
          alert('Lỗi kết nối khi lưu tiêu chí sàng lọc.');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Lưu tiêu chí & Chấm điểm';
          }
        }
      });
    }
    return modal;
  }

  /**
   * Mở modal cấu hình tiêu chí cho một vị trí tuyển dụng
   */
  async function openCriteriaModal(requisitionId) {
    if (!requisitionId) return;
    const modal = ensureCriteriaModal();
    document.getElementById('criteria-requisition-id').value = requisitionId;

    try {
      const res = await fetchScreeningCriteria(requisitionId);
      if (res && res.data) {
        const c = res.data;
        document.getElementById('criteria-min-exp').value = c.minExperienceYears ?? 1;
        document.getElementById('criteria-req-education').value = c.requiredEducation || 'BACHELOR';
        document.getElementById('criteria-req-skills').value = (c.requiredSkills || []).join(', ');
        document.getElementById('criteria-w-exp').value = c.weightExperience ?? 40;
        document.getElementById('criteria-w-edu').value = c.weightEducation ?? 20;
        document.getElementById('criteria-w-skills').value = c.weightSkills ?? 40;
      }
    } catch (err) {
      console.warn('[FetchCriteria Warning]', err);
    }

    modal.classList.remove('hidden');
  }

  /**
   * Tự động hook vào Requisition Detail Modal
   * Thêm nút "Cấu hình Tiêu chí Bắt buộc" mà không cần sửa file HTML cũ
   */
  function autoMountRequisitionDetailSection() {
    const modal = document.getElementById('requisition-detail-modal');
    if (!modal) return;

    const observer = new MutationObserver(() => {
      if (!modal.classList.contains('hidden')) {
        const reqIdInput = document.getElementById('req-detail-id');
        const reqId = reqIdInput ? reqIdInput.value : null;
        if (!reqId) return;

        let section = document.getElementById('req-screening-criteria-section');
        if (!section) {
          section = document.createElement('div');
          section.id = 'req-screening-criteria-section';
          section.className = 'panel-card';
          section.style.padding = '12px 14px';
          section.style.marginBottom = '14px';
          section.style.background = 'var(--color-bg-page)';
          section.style.border = '1px solid var(--color-border)';

          section.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div>
                <strong style="font-size: 0.875rem; color: var(--color-text); display: flex; align-items: center; gap: 6px;">
                  <span>🎯 Tiêu chí Sàng lọc Bắt buộc (SCRUM-119 / S5-09)</span>
                </strong>
                <p id="req-screening-summary-text" style="font-size: 0.775rem; color: var(--color-text-muted); margin: 2px 0 0 0;">
                  Đang tải tiêu chí...
                </p>
              </div>
              <div style="display: flex; gap: 6px;">
                <button type="button" id="open-criteria-config-btn" class="btn btn-outline btn-xs" style="font-size: 0.75rem;">
                  ⚙️ Cấu hình tiêu chí
                </button>
                <button type="button" id="rescreen-all-req-btn" class="btn btn-primary btn-xs" style="font-size: 0.75rem;">
                  ⚡ Chấm điểm toàn bộ
                </button>
              </div>
            </div>
          `;

          const form = document.getElementById('req-detail-form');
          if (form) {
            form.insertBefore(section, form.firstChild);
          } else {
            modal.querySelector('.modal-body')?.appendChild(section);
          }

          document.getElementById('open-criteria-config-btn')?.addEventListener('click', () => {
            const currentReqId = document.getElementById('req-detail-id')?.value;
            if (currentReqId) openCriteriaModal(currentReqId);
          });

          document.getElementById('rescreen-all-req-btn')?.addEventListener('click', async () => {
            const currentReqId = document.getElementById('req-detail-id')?.value;
            if (!currentReqId) return;
            const btn = document.getElementById('rescreen-all-req-btn');
            btn.disabled = true;
            btn.textContent = 'Đang xử lý...';
            try {
              const res = await screenAllRequisitionCandidatesApi(currentReqId);
              if (res && res.success) {
                if (window.showToast) {
                  window.showToast('success', 'Chấm điểm hoàn tất', res.message || 'Đã chấm điểm lại toàn bộ hồ sơ trong vị trí.');
                }
                if (typeof window.loadCandidates === 'function') window.loadCandidates();
              } else {
                alert(res?.message || 'Không thể chấm điểm hồ sơ.');
              }
            } catch {
              alert('Lỗi kết nối khi chấm điểm toàn bộ hồ sơ.');
            } finally {
              btn.disabled = false;
              btn.textContent = '⚡ Chấm điểm toàn bộ';
            }
          });
        }

        // Tải tóm tắt tiêu chí
        fetchScreeningCriteria(reqId).then(res => {
          const summaryEl = document.getElementById('req-screening-summary-text');
          if (summaryEl && res && res.data) {
            const c = res.data;
            const skillsStr = (c.requiredSkills || []).length > 0 ? c.requiredSkills.join(', ') : 'Không bắt buộc';
            summaryEl.textContent = `KN: ≥ ${c.minExperienceYears || 0} năm | Bằng cấp: ≥ ${EDUCATION_NAMES[c.requiredEducation] || 'Không yêu cầu'} | Kỹ năng: ${skillsStr}`;
          }
        }).catch(() => {});
      }
    });

    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  /**
   * Tự động hook vào Candidate Detail Modal
   * Hiển thị điểm số phù hợp và cờ Đạt/Không đạt tiêu chí bắt buộc mà không sửa HTML cũ
   */
  function autoMountCandidateDetailSection() {
    const modal = document.getElementById('candidate-detail-modal');
    if (!modal) return;

    const observer = new MutationObserver(() => {
      if (!modal.classList.contains('hidden')) {
        const candidateIdInput = document.getElementById('cand-detail-id');
        const candidateId = candidateIdInput ? candidateIdInput.value : null;
        if (!candidateId) return;

        let section = document.getElementById('cand-screening-detail-card');
        if (!section) {
          section = document.createElement('div');
          section.id = 'cand-screening-detail-card';
          section.className = 'panel-card';
          section.style.padding = '12px 14px';
          section.style.marginBottom = '14px';
          section.style.border = '1px solid var(--color-border)';
          section.style.borderRadius = 'var(--radius-sm)';

          section.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="font-size: 0.875rem; color: var(--color-text); display: flex; align-items: center; gap: 6px;">
                <span>🎯 Sàng lọc Tiêu chí Bắt buộc (SCRUM-119 / S5-09)</span>
              </strong>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span id="cand-screening-badge-slot"></span>
                <button type="button" id="cand-rescreen-btn" class="btn btn-outline btn-xs" style="font-size: 0.75rem;">
                  🔄 Chấm điểm lại
                </button>
              </div>
            </div>
            <div id="cand-screening-breakdown-details" style="font-size: 0.8rem; color: var(--color-text-secondary); line-height: 1.5;">
              Đang tải dữ liệu sàng lọc...
            </div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 6px; border-top: 1px dashed var(--color-border); padding-top: 4px;">
              ℹ️ Điểm số chỉ để gợi ý sắp xếp ưu tiên đọc trước, không tự động loại ứng viên.
            </div>
          `;

          const modalBody = modal.querySelector('.modal-body') || modal;
          const stagePanel = modalBody.querySelector('.panel-card');
          if (stagePanel) {
            modalBody.insertBefore(section, stagePanel);
          } else {
            modalBody.prepend(section);
          }

          document.getElementById('cand-rescreen-btn')?.addEventListener('click', async () => {
            const cId = document.getElementById('cand-detail-id')?.value;
            if (!cId) return;
            const btn = document.getElementById('cand-rescreen-btn');
            btn.disabled = true;
            btn.textContent = 'Đang chấm...';
            try {
              const res = await screenCandidateApi(cId);
              if (res && res.success && res.data) {
                renderCandidateScreeningCard(res.data);
                if (window.showToast) {
                  window.showToast('success', 'Chấm điểm thành công', `Điểm phù hợp: ${Math.round(res.data.fitScore)}/100 | ${res.data.mandatoryPass ? 'Đạt tiêu chí' : 'Chưa đạt'}`);
                }
              } else {
                alert(res?.message || 'Không thể chấm điểm hồ sơ này.');
              }
            } catch {
              alert('Lỗi kết nối khi chấm điểm hồ sơ.');
            } finally {
              btn.disabled = false;
              btn.textContent = '🔄 Chấm điểm lại';
            }
          });
        }

        // Tải hoặc chấm điểm cho ứng viên này
        screenCandidateApi(candidateId).then(res => {
          if (res && res.success && res.data) {
            renderCandidateScreeningCard(res.data);
          }
        }).catch(() => {});
      }
    });

    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function renderCandidateScreeningCard(data) {
    const badgeSlot = document.getElementById('cand-screening-badge-slot');
    const breakdownEl = document.getElementById('cand-screening-breakdown-details');
    if (!badgeSlot || !breakdownEl) return;

    badgeSlot.innerHTML = renderScreeningBadge(data);

    const b = data.breakdown;
    if (!b) {
      breakdownEl.textContent = 'Chưa có phân tích chi tiết tiêu chí.';
      return;
    }

    const expText = b.experience
      ? `• Kinh nghiệm: <strong style="color: ${b.experience.passed ? '#10b981' : '#f59e0b'};">${b.experience.actual} năm</strong> (Yêu cầu: ≥ ${b.experience.required} năm) - ${b.experience.passed ? '✓ Đạt' : '⚠️ Chưa đủ'}`
      : '';
    const eduText = b.education
      ? `• Bằng cấp: <strong style="color: ${b.education.passed ? '#10b981' : '#f59e0b'};">${EDUCATION_NAMES[b.education.actual] || b.education.actual || 'Không rõ'}</strong> (Yêu cầu: ≥ ${EDUCATION_NAMES[b.education.required] || b.education.required}) - ${b.education.passed ? '✓ Đạt' : '⚠️ Chưa đạt'}`
      : '';
    const skillList = b.skills?.matchedSkills?.length > 0 ? b.skills.matchedSkills.join(', ') : 'Chưa ghi nhận';
    const missingSkillList = b.skills?.missingSkills?.length > 0 ? `<span style="color: #ef4444;"> (Thiếu: ${b.skills.missingSkills.join(', ')})</span>` : '';
    const skillsText = b.skills
      ? `• Kỹ năng bắt buộc: <strong style="color: ${b.skills.passed ? '#10b981' : '#f59e0b'};">Khớp ${b.skills.matchedCount}/${b.skills.requiredCount}</strong> [${skillList}]${missingSkillList} - ${b.skills.passed ? '✓ Đạt' : '⚠️ Chưa đủ'}`
      : '';

    breakdownEl.innerHTML = `
      <div>${expText}</div>
      <div>${eduText}</div>
      <div>${skillsText}</div>
    `;
  }

  // Khởi động các hook khi DOM sẵn sàng
  function init() {
    autoMountRequisitionDetailSection();
    autoMountCandidateDetailSection();
    ensureCriteriaModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Xuất API toàn cục
  window.CandidateScreening = {
    fetchScreeningCriteria,
    saveScreeningCriteria,
    screenCandidateApi,
    screenAllRequisitionCandidatesApi,
    fetchRankedCandidates,
    renderScreeningBadge,
    openCriteriaModal
  };

  console.log('[CandidateScreening] Frontend module initialized successfully (S5-09).');
})();

