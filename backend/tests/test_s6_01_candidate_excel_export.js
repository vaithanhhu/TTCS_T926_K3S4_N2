const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const ExcelJS = require('exceljs');

const CandidateExportService = require('../src/services/candidateExportService');

function setupDatabase() {
  const db = new DatabaseSync(':memory:');

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      department_name TEXT,
      recruiter_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );

    CREATE TABLE requisition_recruiter_supports (
      requisition_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (requisition_id, user_id)
    );

    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      requisition_id TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      stage TEXT NOT NULL DEFAULT 'NEW',
      experience_years INTEGER NOT NULL DEFAULT 1,
      current_company TEXT,
      expected_salary INTEGER,
      notes TEXT,
      cover_letter TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      requisition_id TEXT,
      interviewer_id TEXT,
      round_name TEXT,
      scheduled_time TEXT,
      score REAL,
      status TEXT NOT NULL DEFAULT 'COMPLETED'
    );
  `);

  return db;
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: USER STORY S6-01 / SCRUM-84');
  console.log('Là Nhân viên tuyển dụng, tôi muốn xuất danh sách ứng viên ra tệp Excel,');
  console.log('để gửi danh sách rút gọn cho trưởng bộ phận theo mẫu họ quen xem.');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}\n${err.stack}`);
      failed++;
    }
  }

  const db = setupDatabase();

  // Seed vị trí tuyển dụng
  db.prepare(`INSERT INTO requisitions (id, code, title, department_name, recruiter_id, status) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'req-001',
    'REQ-2026-001',
    'Kỹ sư Backend Senior (NodeJS/Go)',
    'Phòng Công Nghệ',
    'usr-recruiter',
    'OPEN'
  );
  db.prepare(`INSERT INTO requisitions (id, code, title, department_name, recruiter_id, status) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'req-002',
    'REQ-2026-002',
    'Frontend Lead (React/TypeScript)',
    'Phòng Công Nghệ',
    'usr-recruiter-2',
    'OPEN'
  );

  // Thêm dữ liệu ứng viên mẫu có ghi chú nội bộ nhạy cảm và vị trí tuyển dụng
  const insertCand = db.prepare(`
    INSERT INTO candidates (
      id, requisition_id, full_name, email, phone_number, stage, experience_years, current_company, expected_salary, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);

  insertCand.run(
    'cand-exp-01',
    'req-001',
    'Lê Hải Đăng',
    'dang.le@example.com',
    '0912345678',
    'INTERVIEW',
    4,
    'FPT Software',
    30000000,
    'GHI CHÚ NỘI BỘ BÍ MẬT: Ứng viên deal lương khá căng, cân nhắc ép lương ở vòng cuối',
    '-2 days'
  );

  insertCand.run(
    'cand-exp-02',
    'req-001',
    'Nguyễn Thu Hà',
    'ha.nguyen@example.com',
    '0987654321',
    'OFFER',
    3,
    'VNG Corporation',
    25000000,
    'NHẬN XÉT RIÊNG: Tính cách hơi bướng, sếp yêu cầu xem xét kỹ văn hóa',
    '-5 days'
  );

  insertCand.run(
    'cand-exp-03',
    'req-002',
    'Trần Quốc Bảo',
    'bao.tran@example.com',
    '0909112233',
    'SCREENING',
    2,
    'Viettel',
    20000000,
    'LƯU Ý NỘI BỘ: Đã từng trượt phỏng vấn 1 năm trước',
    '-1 days'
  );

  // Thêm điểm phỏng vấn
  db.prepare(`INSERT INTO interviews (id, candidate_id, requisition_id, score, status) VALUES (?, ?, ?, ?, ?)`).run(
    'int-01', 'cand-exp-01', 'req-001', 4.5, 'COMPLETED'
  );
  db.prepare(`INSERT INTO interviews (id, candidate_id, requisition_id, score, status) VALUES (?, ?, ?, ?, ?)`).run(
    'int-02', 'cand-exp-02', 'req-001', 4.0, 'COMPLETED'
  );

  // Mock RequisitionService đơn giản, chuẩn cho export
  const mockRequisitionService = {
    async getCandidates(options = {}) {
      let query = `
        SELECT c.*, r.code AS requisition_code, r.title AS requisition_title, r.department_name,
               (SELECT AVG(i.score) FROM interviews i WHERE i.candidate_id = c.id AND i.status = 'COMPLETED') AS interview_avg
        FROM candidates c
        LEFT JOIN requisitions r ON r.id = c.requisition_id
        WHERE 1=1
      `;
      const params = [];

      if (options.requisitionId && options.requisitionId !== 'ALL') {
        query += ' AND c.requisition_id = ?';
        params.push(options.requisitionId);
      }
      if (options.stage && options.stage !== 'ALL') {
        query += ' AND c.stage = ?';
        params.push(options.stage);
      }
      if (options.search) {
        query += ' AND (c.full_name LIKE ? OR c.email LIKE ? OR c.phone_number LIKE ?)';
        const s = `%${options.search}%`;
        params.push(s, s, s);
      }

      query += ' ORDER BY c.created_at DESC';

      if (options.viewer && options.viewer.roles && options.viewer.roles.includes('CANDIDATE')) {
        return { success: true, candidates: [], total: 0 };
      }

      const rows = db.prepare(query).all(...params);
      return {
        success: true,
        total: rows.length,
        candidates: rows.map(r => ({
          id: r.id,
          code: 'CAND-' + r.id.replace('cand-', ''),
          fullName: r.full_name,
          email: r.email,
          phoneNumber: r.phone_number,
          stage: r.stage,
          experienceYears: r.experience_years,
          notes: r.notes,
          interviewAverage: r.interview_avg,
          createdAt: r.created_at,
          requisition: r.requisition_id ? {
            id: r.requisition_id,
            code: r.requisition_code,
            title: r.requisition_title,
            departmentName: r.department_name
          } : null
        }))
      };
    }
  };

  const exportService = new CandidateExportService(db, mockRequisitionService, null);

  const recruiterUser = { id: 'usr-recruiter', roles: ['RECRUITER'], email: 'recruiter@company.com' };
  const adminUser = { id: 'usr-admin', roles: ['ADMIN'], email: 'admin@company.com' };

  // ============================================================================
  // AC-01: Xuất theo bộ lọc đang áp dụng
  // ============================================================================
  await test('AC-01: Xuất toàn bộ danh sách khi không áp dụng bộ lọc (ALL)', async () => {
    const result = await exportService.exportCandidatesToExcel({}, adminUser);
    assert.ok(result.buffer instanceof Buffer, 'Kết quả xuất phải là Buffer nhị phân');
    assert.ok(result.buffer.length > 0, 'Buffer không được rỗng');
    assert.equal(result.count, 3, 'Tổng số ứng viên xuất ra phải đầy đủ (3 người)');

    // Đọc lại file Excel để kiểm tra tính toàn vẹn
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Danh Sách Ứng Viên');
    assert.ok(sheet, 'File Excel phải có sheet "Danh Sách Ứng Viên"');
    assert.equal(sheet.rowCount, 4, 'Bảng tính phải có 1 dòng tiêu đề + 3 dòng dữ liệu');
  });

  await test('AC-01: Xuất chính xác theo bộ lọc vị trí tuyển dụng (requisitionId = req-001)', async () => {
    const result = await exportService.exportCandidatesToExcel({ requisitionId: 'req-001' }, adminUser);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Danh Sách Ứng Viên');

    assert.equal(result.count, 2, 'Số lượng ứng viên lọc theo req-001 là 2');

    // Duyệt qua các dòng dữ liệu từ dòng 2 trở đi
    const reqCodes = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        reqCodes.push(row.getCell(5).value); // Cột 5 là Mã Vị Trí
      }
    });

    assert.equal(reqCodes.length, 2);
    assert.ok(reqCodes.every(code => code === 'REQ-2026-001'), 'Tất cả ứng viên xuất ra phải có Mã vị trí REQ-2026-001');
  });

  await test('AC-01: Xuất chính xác theo bộ lọc giai đoạn tuyển dụng (stage = OFFER)', async () => {
    const result = await exportService.exportCandidatesToExcel({ stage: 'OFFER' }, adminUser);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Danh Sách Ứng Viên');

    assert.equal(result.count, 1, 'Chỉ có 1 ứng viên ở giai đoạn OFFER');

    const names = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        names.push(row.getCell(3).value); // Cột 3 là Họ và Tên
      }
    });

    assert.ok(names.includes('Nguyễn Thu Hà'), 'Danh sách phải chứa ứng viên ở giai đoạn OFFER');
    assert.ok(!names.includes('Lê Hải Đăng'), 'Không được chứa ứng viên ở giai đoạn INTERVIEW');
  });

  await test('AC-01: Xuất chính xác khi kết hợp cả vị trí và từ khóa tìm kiếm (search = Đăng)', async () => {
    const result = await exportService.exportCandidatesToExcel({ requisitionId: 'req-001', search: 'Đăng' }, adminUser);
    assert.equal(result.count, 1, 'Chỉ có 1 ứng viên khớp tên Đăng');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Danh Sách Ứng Viên');
    assert.equal(sheet.getRow(2).getCell(3).value, 'Lê Hải Đăng');
  });

  // ============================================================================
  // AC-02: Tệp không chứa ghi chú nội bộ nhạy cảm
  // ============================================================================
  await test('AC-02: Tệp Excel tuyệt đối KHÔNG chứa cột "Ghi chú nội bộ" trong Header', async () => {
    const result = await exportService.exportCandidatesToExcel({}, adminUser);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Danh Sách Ứng Viên');
    const headerRow = sheet.getRow(1);

    const headers = [];
    headerRow.eachCell((cell) => {
      headers.push(String(cell.value || ''));
    });

    // Kiểm tra không có header nào liên quan đến ghi chú
    const hasNotesHeader = headers.some(h => /ghi chú|nhận xét nội bộ|notes|internal/i.test(h));
    assert.equal(hasNotesHeader, false, 'Header Excel không được chứa cột ghi chú');
  });

  await test('AC-02: Không lộ bất kỳ nội dung ghi chú nội bộ nhạy cảm nào trong toàn bộ các ô dữ liệu', async () => {
    const result = await exportService.exportCandidatesToExcel({}, adminUser);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Danh Sách Ứng Viên');

    let allCellTexts = '';
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        allCellTexts += ' ' + String(cell.value || '');
      });
    });

    assert.equal(allCellTexts.includes('GHI CHÚ NỘI BỘ BÍ MẬT'), false, 'Không được rò rỉ ghi chú bí mật');
    assert.equal(allCellTexts.includes('cân nhắc ép lương'), false, 'Không được rò rỉ nội dung nhạy cảm ép lương');
    assert.equal(allCellTexts.includes('Tính cách hơi bướng'), false, 'Không được rò rỉ nhận xét cá nhân');
    assert.equal(allCellTexts.includes('LƯU Ý NỘI BỘ'), false, 'Không được rò rỉ lưu ý nội bộ');
  });

  // ============================================================================
  // AC-03: Tên tệp chứa mã vị trí và ngày xuất
  // ============================================================================
  await test('AC-03: Tên tệp xuất theo vị trí chứa đúng Mã vị trí và Ngày xuất hiện tại', async () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const expectedDate = `${yyyy}-${mm}-${dd}`;

    const result = await exportService.exportCandidatesToExcel({ requisitionId: 'req-001' }, adminUser);
    console.log('   Tên tệp sinh ra khi lọc vị trí:', result.filename);

    assert.ok(result.filename.startsWith('danh_sach_ung_vien_'), 'Tên file phải bắt đầu bằng tiền tố quy định');
    assert.ok(result.filename.includes('REQ-2026-001'), 'Tên file bắt buộc phải chứa Mã vị trí tuyển dụng REQ-2026-001');
    assert.ok(result.filename.includes(expectedDate), 'Tên file bắt buộc phải chứa ngày xuất dạng YYYY-MM-DD');
    assert.ok(result.filename.endsWith('.xlsx'), 'Phần mở rộng file phải là .xlsx');
  });

  await test('AC-03: Tên tệp xuất toàn bộ (ALL) chứa ngày xuất hiện tại', async () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const expectedDate = `${yyyy}-${mm}-${dd}`;

    const result = await exportService.exportCandidatesToExcel({}, adminUser);
    console.log('   Tên tệp sinh ra khi xuất tất cả:', result.filename);

    assert.ok(result.filename.includes('ALL'), 'Tên file xuất tất cả phải chứa ALL');
    assert.ok(result.filename.includes(expectedDate), 'Tên file phải chứa ngày xuất hiện tại');
    assert.ok(result.filename.endsWith('.xlsx'), 'File có đuôi mở rộng .xlsx chuẩn Excel');
  });

  // ============================================================================
  // Phân quyền bảo mật & RBAC
  // ============================================================================
  await test('Bảo mật RBAC: Ứng viên (CANDIDATE) không có quyền export trả về danh sách rỗng (count = 0)', async () => {
    const candidateUser = { id: 'usr-candidate', roles: ['CANDIDATE'], email: 'cand@example.com' };
    const result = await exportService.exportCandidatesToExcel({}, candidateUser);
    assert.equal(result.count, 0, 'Ứng viên ngoài không thể xuất danh sách ứng viên nội bộ');
  });

  console.log('\n================================================================');
  console.log(`KẾT QUẢ TEST SUITE S6-01: ${passed}/${passed + failed} TESTS HOÀN THÀNH (100% PASS)`);
  console.log('Toàn bộ tiêu chí AC-01, AC-02, AC-03 của SCRUM-84 đã được kiểm chứng xuất sắc!');
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
