const ExcelJS = require('exceljs');

class CandidateExportService {
  constructor(db, requisitionService, candidateSearchService) {
    this.db = db;
    this.requisitionService = requisitionService;
    this.candidateSearchService = candidateSearchService;
  }

  /**
   * Tạo tên file Excel chuẩn theo format: danh_sach_ung_vien_[REQ_CODE]_[YYYY-MM-DD].xlsx
   * hoặc danh_sach_ung_vien_ALL_[YYYY-MM-DD].xlsx
   */
  generateFilename(requisitionCode = null, date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const cleanCode = requisitionCode ? String(requisitionCode).replace(/[^a-zA-Z0-9_-]/g, '_') : 'ALL';
    return `danh_sach_ung_vien_${cleanCode}_${dateStr}.xlsx`;
  }

  /**
   * Xuất danh sách ứng viên ra Buffer Excel (.xlsx)
   * TUYỆT ĐỐI KHÔNG chứa ghi chú nội bộ (notes, internal comments) nhạy cảm.
   */
  async buildCandidateExcelWorkbook(candidates = [], requisitionInfo = null) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Internal Recruitment ATS';
    workbook.lastModifiedBy = 'Internal Recruitment ATS';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Danh Sách Ứng Viên', {
      views: [{ showGridLines: true }]
    });

    // Cấu hình các cột (Header & Data mapping)
    // Lưu ý: Tuyệt đối KHÔNG có cột 'Ghi chú nội bộ' (notes)
    sheet.columns = [
      { header: 'STT', key: 'stt', width: 8, style: { alignment: { horizontal: 'center' } } },
      { header: 'Mã Ứng Viên', key: 'code', width: 16, style: { alignment: { horizontal: 'center' } } },
      { header: 'Họ và Tên', key: 'fullName', width: 26 },
      { header: 'Vị Trí Tuyển Dụng', key: 'requisitionTitle', width: 32 },
      { header: 'Mã Vị Trí', key: 'requisitionCode', width: 16, style: { alignment: { horizontal: 'center' } } },
      { header: 'Email Liên Hệ', key: 'email', width: 28 },
      { header: 'Số Điện Thoại', key: 'phoneNumber', width: 16, style: { alignment: { horizontal: 'center' } } },
      { header: 'Giai Đoạn Tuyển Dụng', key: 'stageLabel', width: 22, style: { alignment: { horizontal: 'center' } } },
      { header: 'Ngày Nộp Hồ Sơ', key: 'appliedDate', width: 18, style: { alignment: { horizontal: 'center' } } },
      { header: 'Số Năm KN', key: 'experienceYears', width: 14, style: { alignment: { horizontal: 'center' } } },
      { header: 'Điểm Phỏng Vấn TB', key: 'interviewAverage', width: 20, style: { alignment: { horizontal: 'center' } } }
    ];

    // Định dạng dòng Header
    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' } // Màu xanh Navy chuẩn Enterprise
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // Mapping nhãn giai đoạn chuẩn tiếng Việt
    const STAGE_LABELS = {
      NEW: 'Mới ứng tuyển',
      APPLIED: 'Đã nộp đơn',
      SCREENING: 'Sơ loại hồ sơ',
      INTERVIEW: 'Phỏng vấn',
      OFFER: 'Đề nghị (Offer)',
      HIRED: 'Đã tuyển dụng',
      REJECTED: 'Đã từ chối',
      WITHDRAWN: 'Ứng viên rút đơn'
    };

    // Điền dữ liệu các dòng
    candidates.forEach((cand, idx) => {
      const code = cand.code || (cand.id && cand.id.startsWith('cand-') ? 'CAND-' + cand.id.replace('cand-', '') : cand.id) || 'CAND-001';
      const appliedDate = (cand.createdAt || cand.created_at)
        ? new Date(cand.createdAt || cand.created_at).toLocaleDateString('vi-VN')
        : '—';
      const stageKey = cand.stage || 'NEW';
      const stageLabel = cand.statusLabel || STAGE_LABELS[stageKey] || stageKey;
      const avgScore = cand.interviewAverage != null
        ? Number(cand.interviewAverage).toFixed(2)
        : '—';
      const reqTitle = (cand.requisition && cand.requisition.title) ? cand.requisition.title : (cand.requisition_title || '—');
      const reqCode = (cand.requisition && cand.requisition.code) ? cand.requisition.code : (cand.requisition_code || (requisitionInfo?.code || '—'));

      const row = sheet.addRow({
        stt: idx + 1,
        code,
        fullName: cand.fullName || cand.full_name || 'Ứng viên',
        requisitionTitle: reqTitle,
        requisitionCode: reqCode,
        email: cand.email || '—',
        phoneNumber: cand.phoneNumber || cand.phone || '—',
        stageLabel,
        appliedDate,
        experienceYears: cand.experienceYears ?? cand.experience_years ?? 0,
        interviewAverage: avgScore
      });

      row.font = { name: 'Arial', size: 10 };
      row.alignment = { vertical: 'middle' };
      row.height = 22;

      // Viền mỏng cho các ô dữ liệu
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Lấy danh sách ứng viên theo bộ lọc và xuất file Excel
   */
  async exportCandidatesToExcel(options = {}, viewer) {
    let candidates = [];
    let requisitionCode = 'ALL';

    // 1. Nếu có tìm kiếm nâng cao (candidateSearchService)
    if (this.candidateSearchService && options.advanced === '1') {
      const searchRes = await this.candidateSearchService.searchRows(options, viewer);
      candidates = searchRes.candidates || [];
    } else {
      // 2. Mặc định dùng requisitionService.getCandidates
      const result = await this.requisitionService.getCandidates({
        ...options,
        viewer
      });
      candidates = result.candidates || [];
    }

    // 3. Xác định mã vị trí nếu có lọc theo requisitionId
    if (options.requisitionId && options.requisitionId !== 'ALL') {
      try {
        const reqRow = await this.db.prepare('SELECT code FROM requisitions WHERE id = ?').get(options.requisitionId);
        if (reqRow && reqRow.code) {
          requisitionCode = reqRow.code;
        }
      } catch (err) {}
    }

    const filename = this.generateFilename(requisitionCode, new Date());
    const buffer = await this.buildCandidateExcelWorkbook(candidates, { code: requisitionCode });

    return {
      filename,
      buffer,
      count: candidates.length,
      requisitionCode
    };
  }
}

module.exports = CandidateExportService;
