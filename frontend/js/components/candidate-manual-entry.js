/**
 * ==============================================================================
 * USER STORY S5-08 (SCRUM-118) - FRONTEND CANDIDATE MANUAL ENTRY & DUPLICATE DETECTION
 * ==============================================================================
 *
 * Là Nhân viên tuyển dụng, tôi muốn thêm ứng viên thủ công vào một vị trí,
 * để đưa được ứng viên tìm từ LinkedIn vào cùng một pipeline.
 *
 * Tiêu chí chấp nhận (AC):
 *   • AC-01: Nhập tay thông tin và tải CV cho ứng viên tìm được từ nguồn khác (LinkedIn, Headhunter...)
 *   • AC-02: Ứng viên thêm tay vẫn đi qua đúng luồng phát hiện trùng (Realtime duplicate check & warning)
 * ==============================================================================
 */

(function () {
  'use strict';

  // Quản lý trạng thái phát hiện trùng lặp
  const state = {
    debounceTimer: null,
    isCheckingDuplicate: false,
    lastCheckedKey: '',
    duplicateResult: null,
    cvFile: null
  };

  /**
   * API Helper: Kiểm tra trùng lặp thời gian thực
   */
  async function checkDuplicateApi(token, { email, phoneNumber, requisitionId }) {
    try {
      const response = await fetch('/api/v1/candidates/check-duplicate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email, phoneNumber, requisitionId })
      });
      return await response.json();
    } catch (err) {
      console.warn('[ManualEntry] Duplicate check failed:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * API Helper: Thêm ứng viên thủ công kèm CV
   */
  async function submitManualCandidateApi(token, formData) {
    try {
      const response = await fetch('/api/v1/candidates/manual', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
          // Trình duyệt tự động đặt Content-Type kèm boundary cho FormData
        },
        body: formData
      });
      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    } catch (err) {
      console.error('[ManualEntry] Submit manual candidate failed:', err);
      return { ok: false, status: 500, data: { success: false, message: 'Lỗi kết nối khi gửi dữ liệu.' } };
    }
  }

  /**
   * Tạo phần hiển thị cảnh báo phát hiện trùng lặp trong Modal
   */
  function ensureDuplicateWarningContainer(form) {
    let container = document.getElementById('cand-manual-duplicate-alert');
    if (!container && form) {
      container = document.createElement('div');
      container.id = 'cand-manual-duplicate-alert';
      container.className = 'hidden mb-4 p-3 rounded-lg border text-sm';
      // Chèn lên đầu form trước các trường nhập
      form.insertBefore(container, form.firstChild);
    }
    return container;
  }

  /**
   * Tạo trường tải tệp CV đính kèm nếu chưa có trong Modal
   */
  function ensureCvUploadField(form) {
    let cvGroup = document.getElementById('cand-manual-cv-group');
    if (!cvGroup && form) {
      cvGroup = document.createElement('div');
      cvGroup.id = 'cand-manual-cv-group';
      cvGroup.className = 'mb-4';
      cvGroup.innerHTML = `
        <label class="block text-xs font-semibold uppercase text-gray-700 mb-1">
          Tệp CV đính kèm (PDF, DOCX &le; 10MB)
        </label>
        <div class="relative flex items-center border border-dashed border-gray-300 rounded-lg p-3 hover:border-blue-500 transition-colors bg-gray-50/50">
          <input type="file" id="create-cand-cv-file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                 class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
          <div class="flex items-center space-x-2 text-sm text-gray-600 pointer-events-none w-full">
            <span class="text-blue-600 text-lg">📄</span>
            <span id="create-cand-cv-filename" class="truncate flex-1 font-medium text-gray-700">Chọn hoặc kéo thả tệp CV vào đây...</span>
            <span id="create-cand-cv-status" class="text-xs text-gray-400">Tối đa 10MB</span>
          </div>
        </div>
        <p id="create-cand-cv-error" class="hidden text-xs text-red-600 mt-1"></p>
      `;

      // Chèn trước nút thao tác
      const actionsDiv = form.querySelector('.flex.justify-end') || form.lastElementChild;
      if (actionsDiv) {
        form.insertBefore(cvGroup, actionsDiv);
      } else {
        form.appendChild(cvGroup);
      }

      // Xử lý sự kiện chọn tệp
      const fileInput = document.getElementById('create-cand-cv-file');
      const filenameSpan = document.getElementById('create-cand-cv-filename');
      const statusSpan = document.getElementById('create-cand-cv-status');
      const errorMsg = document.getElementById('create-cand-cv-error');

      if (fileInput) {
        fileInput.addEventListener('change', () => {
          errorMsg.classList.add('hidden');
          errorMsg.textContent = '';

          if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const ext = file.name.split('.').pop().toLowerCase();

            if (!['pdf', 'docx'].includes(ext)) {
              errorMsg.textContent = 'Chỉ chấp nhận tệp định dạng PDF hoặc DOCX.';
              errorMsg.classList.remove('hidden');
              fileInput.value = '';
              state.cvFile = null;
              filenameSpan.textContent = 'Chọn hoặc kéo thả tệp CV vào đây...';
              return;
            }

            if (file.size > 10 * 1024 * 1024) {
              errorMsg.textContent = 'Tệp CV vượt quá dung lượng tối đa 10MB.';
              errorMsg.classList.remove('hidden');
              fileInput.value = '';
              state.cvFile = null;
              filenameSpan.textContent = 'Chọn hoặc kéo thả tệp CV vào đây...';
              return;
            }

            state.cvFile = file;
            filenameSpan.textContent = file.name;
            statusSpan.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
            filenameSpan.classList.add('text-blue-700');
          } else {
            state.cvFile = null;
            filenameSpan.textContent = 'Chọn hoặc kéo thả tệp CV vào đây...';
            statusSpan.textContent = 'Tối đa 10MB';
            filenameSpan.classList.remove('text-blue-700');
          }
        });
      }
    }
    return cvGroup;
  }

  /**
   * Cập nhật giao diện cảnh báo trùng lặp
   */
  function renderDuplicateAlert(alertDiv, duplicateResult) {
    if (!alertDiv) return;

    if (!duplicateResult || !duplicateResult.isDuplicate) {
      alertDiv.className = 'hidden';
      alertDiv.innerHTML = '';
      return;
    }

    const { hasSamePositionDuplicate, hasCrossPositionDuplicate, samePositionMatches, crossPositionMatches } = duplicateResult;

    if (hasSamePositionDuplicate) {
      const match = samePositionMatches[0];
      const matchText = match.matchField === 'BOTH' ? 'Email & SĐT' : match.matchField;
      alertDiv.className = 'mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm animate-pulse';
      alertDiv.innerHTML = `
        <div class="flex items-start space-x-2">
          <span class="text-base text-red-600 font-bold">⛔</span>
          <div>
            <p class="font-semibold">Phát hiện trùng lặp hồ sơ!</p>
            <p class="mt-0.5 text-xs text-red-700">
              Ứng viên <strong>${escapeHtml(match.fullName)}</strong> (${escapeHtml(match.email)}) đã có hồ sơ trong vị trí này (Trạng thái: <strong>${match.stage}</strong>).
            </p>
            <p class="mt-1 text-xs text-red-600 italic">Trùng theo: ${matchText}. Hệ thống không cho phép tạo trùng ứng viên trong cùng một pipeline.</p>
          </div>
        </div>
      `;
      // Vô hiệu hoá nút submit nếu trùng cùng vị trí
      const submitBtn = document.querySelector('#create-candidate-form button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    // Kích hoạt lại nút submit nếu không trùng cùng vị trí
    const submitBtn = document.querySelector('#create-candidate-form button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;

    if (hasCrossPositionDuplicate) {
      const positions = crossPositionMatches.map(m => `"${escapeHtml(m.requisitionTitle)}"`).join(', ');
      alertDiv.className = 'mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm';
      alertDiv.innerHTML = `
        <div class="flex items-start space-x-2">
          <span class="text-base text-amber-600 font-bold">⚠️</span>
          <div class="w-full">
            <p class="font-semibold text-amber-800">Cảnh báo hồ sơ đã tồn tại ở vị trí khác</p>
            <p class="mt-0.5 text-xs text-amber-700">
              Ứng viên đã từng ứng tuyển ở các vị trí: <strong>${positions}</strong>.
            </p>
            <label class="mt-2 flex items-center space-x-2 text-xs text-amber-800 font-medium cursor-pointer">
              <input type="checkbox" id="cand-manual-confirm-dup" class="rounded border-amber-400 text-amber-600 focus:ring-amber-500" />
              <span>Tôi xác nhận đưa ứng viên này vào pipeline của vị trí tuyển dụng hiện tại</span>
            </label>
          </div>
        </div>
      `;
    }
  }

  /**
   * Thực hiện debounce kiểm tra trùng khi người dùng nhập Email hoặc Phone
   */
  function triggerDuplicateCheck() {
    const emailInput = document.getElementById('create-cand-email');
    const phoneInput = document.getElementById('create-cand-phone');
    const reqSelect = document.getElementById('create-cand-req-select');
    const form = document.getElementById('create-candidate-form');

    if (!emailInput || !form) return;

    const email = emailInput.value.trim();
    const phoneNumber = phoneInput ? phoneInput.value.trim() : '';
    const requisitionId = reqSelect ? reqSelect.value : '';

    if (!email && !phoneNumber) {
      const alertDiv = document.getElementById('cand-manual-duplicate-alert');
      if (alertDiv) alertDiv.className = 'hidden';
      state.duplicateResult = null;
      return;
    }

    const checkKey = `${email}|${phoneNumber}|${requisitionId}`;
    if (checkKey === state.lastCheckedKey) return;

    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(async () => {
      state.lastCheckedKey = checkKey;
      const token = sessionStorage.getItem('ats_token');
      if (!token) return;

      const alertDiv = ensureDuplicateWarningContainer(form);
      const res = await checkDuplicateApi(token, { email, phoneNumber, requisitionId });

      if (res && res.success && res.data) {
        state.duplicateResult = res.data;
        renderDuplicateAlert(alertDiv, res.data);
      }
    }, 400); // 400ms debounce
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  /**
   * Khởi tạo tính năng thêm ứng viên thủ công trên giao diện
   */
  function initManualEntryEnhancement() {
    const form = document.getElementById('create-candidate-form');
    if (!form) return;

    // 1. Thêm trường tải CV
    ensureCvUploadField(form);

    // 2. Thêm vùng hiển thị cảnh báo phát hiện trùng
    ensureDuplicateWarningContainer(form);

    // 3. Gắn lắng nghe sự kiện phát hiện trùng trên email, phone, requisition
    const emailInput = document.getElementById('create-cand-email');
    const phoneInput = document.getElementById('create-cand-phone');
    const reqSelect = document.getElementById('create-cand-req-select');

    if (emailInput) {
      emailInput.addEventListener('input', triggerDuplicateCheck);
      emailInput.addEventListener('blur', triggerDuplicateCheck);
    }
    if (phoneInput) {
      phoneInput.addEventListener('input', triggerDuplicateCheck);
      phoneInput.addEventListener('blur', triggerDuplicateCheck);
    }
    if (reqSelect) {
      reqSelect.addEventListener('change', triggerDuplicateCheck);
    }

    // 4. Reset trạng thái khi mở modal
    const openBtn = document.getElementById('open-create-candidate-modal-btn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        state.duplicateResult = null;
        state.cvFile = null;
        state.lastCheckedKey = '';
        const alertDiv = document.getElementById('cand-manual-duplicate-alert');
        if (alertDiv) alertDiv.className = 'hidden';
        const cvFilename = document.getElementById('create-cand-cv-filename');
        if (cvFilename) cvFilename.textContent = 'Chọn hoặc kéo thả tệp CV vào đây...';
        const fileInput = document.getElementById('create-cand-cv-file');
        if (fileInput) fileInput.value = '';
      });
    }

    console.log('[ManualCandidateEntry] Frontend module initialized successfully (S5-08).');
  }

  // Tự động khởi chạy khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initManualEntryEnhancement);
  } else {
    initManualEntryEnhancement();
  }

  // Xuất ra global scope để tích hợp hoặc kiểm thử
  window.CandidateManualEntry = {
    checkDuplicateApi,
    submitManualCandidateApi,
    init: initManualEntryEnhancement
  };
})();
