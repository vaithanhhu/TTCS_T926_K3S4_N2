const { getDatabase } = require('./database');
const { hashPassword } = require('../utils/password');

async function seedDatabase(db, options = {}) {
  const database = db || getDatabase();
  const preservePasswords = options.preservePasswords === true;

  // 1. Seed Roles (AC-01 7 standard roles)
  const roles = [
    { id: 'role-admin', code: 'ADMIN', name: 'Quản trị hệ thống', description: 'Quản lý tài khoản, vai trò, danh mục và giám sát hệ thống', defaultPath: '/admin' },
    { id: 'role-hr-mgr', code: 'HR_MANAGER', name: 'Trưởng phòng Nhân sự', description: 'Chủ sở hữu hoạt động tuyển dụng, phân công recruiter, giám sát ngân sách', defaultPath: '/dashboard' },
    { id: 'role-recruiter', code: 'RECRUITER', name: 'Nhân viên tuyển dụng', description: 'Vận hành tuyển dụng, điều phối pipeline, đặt lịch phỏng vấn, soạn offer', defaultPath: '/recruitment' },
    { id: 'role-hiring-mgr', code: 'HIRING_MGR', name: 'Trưởng bộ phận', description: 'Sở hữu vị trí tuyển dụng, tạo yêu cầu, đánh giá ứng viên', defaultPath: '/hiring' },
    { id: 'role-interviewer', code: 'INTERVIEWER', name: 'Người phỏng vấn', description: 'Xem lịch, đọc CV, nộp phiếu đánh giá năng lực', defaultPath: '/interviews' },
    { id: 'role-approver', code: 'APPROVER', name: 'Người duyệt', description: 'Ban giám đốc hoặc cấp duyệt theo hạn mức phê duyệt yêu cầu & offer', defaultPath: '/approvals' },
    { id: 'role-candidate', code: 'CANDIDATE', name: 'Ứng viên', description: 'Ứng viên nộp hồ sơ, theo dõi trạng thái, xác nhận lịch & phản hồi offer', defaultPath: '/candidate' }
  ];

  const insertRole = database.prepare(`
    INSERT INTO roles (id, code, name, description, default_path)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      default_path = excluded.default_path
  `);

  for (const r of roles) {
    (await insertRole.run(r.id, r.code, r.name, r.description, r.defaultPath));
  }

  // 2. Seed Permissions (S1-05 RBAC Matrix)
  const permissions = [
    // Users & Roles Management
    { id: 'perm-user-read', code: 'user.read', name: 'Xem danh sách người dùng', module: 'USERS', description: 'Xem danh sách và chi tiết thông tin người dùng nội bộ' },
    { id: 'perm-user-create', code: 'user.create', name: 'Tạo người dùng mới', module: 'USERS', description: 'Tạo tài khoản người dùng nội bộ và gửi thông tin xác thực' },
    { id: 'perm-user-update', code: 'user.update', name: 'Cập nhật người dùng', module: 'USERS', description: 'Sửa thông tin hồ sơ, phòng ban, chức danh người dùng' },
    { id: 'perm-user-delete', code: 'user.delete', name: 'Xóa người dùng', module: 'USERS', description: 'Xóa tài khoản người dùng khỏi hệ thống' },
    { id: 'perm-role-read', code: 'role.read', name: 'Xem danh sách vai trò', module: 'ROLES', description: 'Xem ma trận vai trò và quyền hạn tương ứng' },
    { id: 'perm-role-assign', code: 'role.assign', name: 'Gán vai trò cho người dùng', module: 'ROLES', description: 'Phân quyền và gán các vai trò nghiệp vụ' },
    { id: 'perm-account-lock', code: 'account.lock', name: 'Khóa tài khoản', module: 'ACCOUNTS', description: 'Khóa tài khoản người dùng kèm lý do bắt buộc' },
    { id: 'perm-account-unlock', code: 'account.unlock', name: 'Mở khóa tài khoản', module: 'ACCOUNTS', description: 'Mở khóa tài khoản người dùng đã bị khóa' },

    // Requisitions Management
    { id: 'perm-req-read', code: 'requisition.read', name: 'Xem yêu cầu tuyển dụng', module: 'REQUISITIONS', description: 'Xem danh sách và chi tiết phiếu yêu cầu tuyển dụng' },
    { id: 'perm-req-create', code: 'requisition.create', name: 'Tạo yêu cầu tuyển dụng', module: 'REQUISITIONS', description: 'Khởi tạo phiếu yêu cầu tuyển dụng nhân sự mới' },
    { id: 'perm-req-approve', code: 'requisition.approve', name: 'Phê duyệt yêu cầu tuyển dụng', module: 'REQUISITIONS', description: 'Ký duyệt hoặc từ chối phiếu yêu cầu tuyển dụng' },

    // Department & Organization Management
    { id: 'perm-dept-read', code: 'department.read', name: 'Xem phòng ban', module: 'DEPARTMENTS', description: 'Xem cây phòng ban và sơ đồ tổ chức' },
    { id: 'perm-dept-manage', code: 'department.manage', name: 'Quản lý phòng ban', module: 'DEPARTMENTS', description: 'Tạo, sửa, ngừng áp dụng và quản lý cấu trúc phòng ban' },

    // Competency Framework Management
    { id: 'perm-competency-read', code: 'competency.read', name: 'Xem khung năng lực', module: 'COMPETENCIES', description: 'Xem khung năng lực, tiêu chí đánh giá và chức danh áp dụng' },
    { id: 'perm-competency-manage', code: 'competency.manage', name: 'Quản lý khung năng lực', module: 'COMPETENCIES', description: 'Tạo, sửa và gán khung năng lực cho chức danh' },

    // Recruitment Shared Catalog
    { id: 'perm-recruitment-catalog-read', code: 'recruitment_catalog.read', name: 'Xem danh mục tuyển dụng', module: 'RECRUITMENT_CATALOG', description: 'Xem các danh mục dùng chung trong tuyển dụng' },
    { id: 'perm-recruitment-catalog-manage', code: 'recruitment_catalog.manage', name: 'Quản lý danh mục tuyển dụng', module: 'RECRUITMENT_CATALOG', description: 'Tạo, sửa, sắp xếp và xóa các danh mục dùng chung trong tuyển dụng' },

    // Company Career Page
    { id: 'perm-career-page-read', code: 'career_page.read', name: 'Xem cấu hình trang tuyển dụng', module: 'CAREER_PAGE', description: 'Xem nội dung cấu hình trang giới thiệu công ty trên cổng tuyển dụng' },
    { id: 'perm-career-page-manage', code: 'career_page.manage', name: 'Quản lý trang tuyển dụng', module: 'CAREER_PAGE', description: 'Soạn nội dung, tải logo và ảnh cho trang giới thiệu công ty' },
    // Interview Question Bank
    { id: 'perm-question-bank-read', code: 'question_bank.read', name: 'Xem ngân hàng câu hỏi', module: 'QUESTION_BANK', description: 'Xem và tìm kiếm câu hỏi phỏng vấn theo chức danh và tiêu chí năng lực' },
    { id: 'perm-question-bank-manage', code: 'question_bank.manage', name: 'Quản lý ngân hàng câu hỏi', module: 'QUESTION_BANK', description: 'Tạo và cập nhật câu hỏi phỏng vấn theo tiêu chí năng lực' },
    // Candidate Pipeline Management
    { id: 'perm-cand-read', code: 'candidate.read', name: 'Xem hồ sơ ứng viên', module: 'CANDIDATES', description: 'Xem danh sách hồ sơ ứng viên và CV trong pipeline tuyển dụng' },
    { id: 'perm-cand-create', code: 'candidate.create', name: 'Tạo/nộp hồ sơ ứng viên', module: 'CANDIDATES', description: 'Thêm mới hoặc ứng viên nộp hồ sơ ứng tuyển' },
    { id: 'perm-cand-update', code: 'candidate.update', name: 'Cập nhật hồ sơ ứng viên', module: 'CANDIDATES', description: 'Cập nhật trạng thái ứng viên theo các vòng tuyển dụng' },

    // Interviews & Evaluations
    { id: 'perm-int-read', code: 'interview.read', name: 'Xem lịch phỏng vấn', module: 'INTERVIEWS', description: 'Xem danh sách lịch phỏng vấn và thông tin ứng viên' },
    { id: 'perm-int-eval', code: 'interview.evaluate', name: 'Đánh giá phỏng vấn', module: 'INTERVIEWS', description: 'Gửi kết quả nhận xét và phiếu đánh giá năng lực ứng viên' },

    // Offers & Approvals
    { id: 'perm-off-read', code: 'offer.read', name: 'Xem thông tin offer', module: 'OFFERS', description: 'Xem thư mời nhận việc và chế độ đãi ngộ' },
    { id: 'perm-off-create', code: 'offer.create', name: 'Soạn thảo offer', module: 'OFFERS', description: 'Lập phiếu đề xuất offer lương và chế độ đãi ngộ' },
    { id: 'perm-off-approve', code: 'offer.approve', name: 'Phê duyệt offer', module: 'OFFERS', description: 'Phê duyệt phiếu offer theo hạn mức ngân sách' },
    { id: 'perm-salary-range-read', code: 'salary_range.read', name: 'Xem dải lương', module: 'OFFERS', description: 'Xem dải lương tối thiểu và tối đa của chức danh' },

    // System Security Audit
    { id: 'perm-audit-read', code: 'audit.read', name: 'Xem nhật ký bảo mật', module: 'AUDIT', description: 'Xem nhật ký đăng nhập, đăng xuất, khóa tài khoản và kiểm toán' }
  ];

  const insertPerm = database.prepare(`
    INSERT INTO permissions (id, code, name, module, description)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      module = excluded.module,
      description = excluded.description
  `);

  for (const p of permissions) {
    (await insertPerm.run(p.id, p.code, p.name, p.module, p.description));
  }

  // 3. Seed Role_Permissions (AC-01 RBAC Matrix for 7 roles)
  const rolePermissionsMatrix = {
    ADMIN: [
      'user.read', 'user.create', 'user.update', 'user.delete',
      'role.read', 'role.assign',
      'account.lock', 'account.unlock',
      'requisition.read',
      'department.read', 'department.manage',
      'competency.read', 'competency.manage',
      'question_bank.read', 'question_bank.manage',
      'recruitment_catalog.read', 'recruitment_catalog.manage',
      'career_page.read', 'career_page.manage',
      'candidate.read', 'candidate.create', 'candidate.update',
      'interview.read',
      'offer.read',
      'audit.read'
    ],
    HR_MANAGER: [
      'user.read',
      'role.read',
      'requisition.read', 'requisition.create', 'requisition.approve',
      'department.read', 'department.manage',
      'competency.read', 'competency.manage',
      'question_bank.read', 'question_bank.manage',
      'recruitment_catalog.read', 'recruitment_catalog.manage',
      'career_page.read', 'career_page.manage',
      'candidate.read', 'candidate.update',
      'interview.read',
      'offer.read', 'offer.create', 'offer.approve', 'salary_range.read'
    ],
    RECRUITER: [
      'requisition.read',
      'recruitment_catalog.read',
      'candidate.read', 'candidate.create', 'candidate.update',
      'interview.read',
      'offer.read', 'offer.create'
    ],
    HIRING_MGR: [
      'requisition.read', 'requisition.create',
      'recruitment_catalog.read',
      'candidate.read',
      'interview.read', 'interview.evaluate'
    ],
    INTERVIEWER: [
      'interview.read', 'interview.evaluate',
      'question_bank.read'
    ],
    APPROVER: [
      'requisition.read', 'requisition.approve',
      'offer.read', 'offer.approve'
    ],
    CANDIDATE: [
      'candidate.create', 'offer.read'
    ]
  };

  const deleteRolePerms = database.prepare('DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = ?)');
  const insertRolePerm = database.prepare(`
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (
      (SELECT id FROM roles WHERE code = ?),
      (SELECT id FROM permissions WHERE code = ?)
    )
  `);

  let totalRolePerms = 0;
  for (const [roleCode, permCodes] of Object.entries(rolePermissionsMatrix)) {
    (await deleteRolePerms.run(roleCode));
    for (const permCode of permCodes) {
      (await insertRolePerm.run(roleCode, permCode));
      totalRolePerms++;
    }
  }

  // Default hashed password for seed accounts: "Ats@123456"
  const defaultPasswordHash = hashPassword('Ats@123456');

  // 4. Seed Users
  const users = [
    {
      id: 'usr-admin',
      email: 'admin@company.com',
      fullName: 'Nguyễn Quản Trị',
      jobTitle: 'System Administrator & IT Lead',
      departmentId: 'dept-3',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      phoneNumber: '0901234567',
      status: 'ACTIVE',
      roles: ['ADMIN']
    },
    {
      id: 'usr-hr-mgr',
      email: 'hrmanager@company.com',
      fullName: 'Trần Thị Mai',
      jobTitle: 'Trưởng Phòng Nhân Sự',
      departmentId: 'dept-2',
      departmentName: 'Phòng Nhân Sự',
      phoneNumber: '0912345678',
      status: 'ACTIVE',
      roles: ['HR_MANAGER']
    },
    {
      id: 'usr-recruiter',
      email: 'recruiter@company.com',
      fullName: 'Hoàng Thu Thảo',
      jobTitle: 'Senior Recruiter',
      departmentId: 'dept-2',
      departmentName: 'Phòng Nhân Sự',
      phoneNumber: '0923456789',
      status: 'ACTIVE',
      roles: ['RECRUITER']
    },
    {
      id: 'usr-recruiter-2',
      email: 'recruiter2@company.com',
      fullName: 'Vũ Văn Thắng',
      jobTitle: 'Talent Acquisition Partner',
      departmentId: 'dept-2',
      departmentName: 'Phòng Nhân Sự',
      phoneNumber: '0934567890',
      status: 'ACTIVE',
      roles: ['RECRUITER']
    },
    {
      id: 'usr-hiring-mgr',
      email: 'hiringmgr@company.com',
      fullName: 'Lê Hoàng Nam',
      jobTitle: 'Giám Đốc Khối Công Nghệ',
      departmentId: 'dept-3',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      phoneNumber: '0945678901',
      status: 'ACTIVE',
      roles: ['HIRING_MGR']
    },
    {
      id: 'usr-interviewer',
      email: 'interviewer@company.com',
      fullName: 'Đặng Tuấn Anh',
      jobTitle: 'Tech Lead / Thành viên Hội đồng Phỏng vấn',
      departmentId: 'dept-5',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      phoneNumber: '0956789012',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-approver',
      email: 'approver@company.com',
      fullName: 'Vũ Minh Đức (CEO)',
      jobTitle: 'Tổng Giám Đốc Điều Hành',
      departmentId: 'dept-1',
      departmentName: 'Ban Giám Đốc',
      phoneNumber: '0967890123',
      status: 'ACTIVE',
      roles: ['APPROVER']
    },
    {
      id: 'usr-dual-role',
      email: 'dualrole@company.com',
      fullName: 'Vũ Hồng Hạnh',
      jobTitle: 'QA Lead & Trưởng Ban Phỏng Vấn Kỹ Thuật',
      departmentId: 'dept-6',
      departmentName: 'Phòng Đảm Bảo Chất Lượng (QA/QC)',
      phoneNumber: '0967890123',
      status: 'ACTIVE',
      roles: ['HIRING_MGR', 'INTERVIEWER']
    },
    {
      id: 'usr-admin-02',
      email: 'security.admin@company.com',
      fullName: 'Phan Bảo An',
      jobTitle: 'Security Administrator',
      departmentId: 'dept-3',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      phoneNumber: '0926777999',
      status: 'ACTIVE',
      roles: ['ADMIN']
    },
    {
      id: 'usr-candidate',
      email: 'candidate@example.com',
      fullName: 'Nguyễn Ứng Viên',
      jobTitle: 'Ứng viên tự do',
      departmentId: null,
      departmentName: 'Cổng Tuyển Dụng Công Khai',
      phoneNumber: '0978901234',
      status: 'ACTIVE',
      roles: ['CANDIDATE']
    },
    {
      id: 'usr-locked',
      email: 'cuunhanvien@company.com',
      fullName: 'Đỗ Hữu Nghĩa',
      jobTitle: 'Cựu Recruiter',
      departmentId: 'dept-2',
      departmentName: 'Phòng Nhân Sự',
      phoneNumber: '0919998887',
      status: 'LOCKED',
      lockReason: 'Nhân sự đã nghỉ việc theo quyết định số 142/QĐ-NS ngày 15/09/2026. Đã thu hồi toàn bộ quyền truy cập dữ liệu ứng viên.',
      roles: ['RECRUITER']
    },
    {
      id: 'usr-dev-01',
      email: 'dev1@company.com',
      fullName: 'Phạm Đức Huy',
      jobTitle: 'Backend Senior Engineer',
      departmentId: 'dept-5',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      phoneNumber: '0981112233',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-dev-02',
      email: 'dev2@company.com',
      fullName: 'Lê Quỳnh Nga',
      jobTitle: 'Frontend Lead / Senior UI Engineer',
      departmentId: 'dept-5',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      phoneNumber: '0982223344',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-dev-03',
      email: 'devops@company.com',
      fullName: 'Bùi Minh Quân',
      jobTitle: 'Cloud & DevOps Specialist',
      departmentId: 'dept-3',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      phoneNumber: '0983334455',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-hr-03',
      email: 'recruiter3@company.com',
      fullName: 'Dương Thảo Linh',
      jobTitle: 'Technical Recruiter',
      departmentId: 'dept-2',
      departmentName: 'Phòng Nhân Sự',
      phoneNumber: '0984445566',
      status: 'ACTIVE',
      roles: ['RECRUITER']
    },
    {
      id: 'usr-hr-04',
      email: 'hr.officer@company.com',
      fullName: 'Trịnh Thu Hà',
      jobTitle: 'HR Operation Officer',
      departmentId: 'dept-2',
      departmentName: 'Phòng Nhân Sự',
      phoneNumber: '0985556677',
      status: 'ACTIVE',
      roles: ['RECRUITER']
    },
    {
      id: 'usr-finance-01',
      email: 'cfo@company.com',
      fullName: 'Lâm Đình Bảo (CFO)',
      jobTitle: 'Giám Đốc Tài Chính',
      departmentId: 'dept-4',
      departmentName: 'Phòng Tài Chính - Kế Toán',
      phoneNumber: '0986667788',
      status: 'ACTIVE',
      roles: ['APPROVER']
    },
    {
      id: 'usr-finance-02',
      email: 'finance.mgr@company.com',
      fullName: 'Ngô Bích Thủy',
      jobTitle: 'Trưởng Ban Kế Hoạch Ngân Sách',
      departmentId: 'dept-4',
      departmentName: 'Phòng Tài Chính - Kế Toán',
      phoneNumber: '0987778899',
      status: 'ACTIVE',
      roles: ['HIRING_MGR']
    },
    {
      id: 'usr-mkt-01',
      email: 'cmo@company.com',
      fullName: 'Hồ Trọng Đạt',
      jobTitle: 'Giám Đốc Tiếp Thị & Thương Hiệu',
      departmentId: 'dept-7',
      departmentName: 'Phòng Marketing & Truyền Thông',
      phoneNumber: '0988889900',
      status: 'ACTIVE',
      roles: ['HIRING_MGR']
    },
    {
      id: 'usr-mkt-02',
      email: 'content.lead@company.com',
      fullName: 'Đỗ Phương Uyên',
      jobTitle: 'Employer Branding Specialist',
      departmentId: 'dept-7',
      departmentName: 'Phòng Marketing & Truyền Thông',
      phoneNumber: '0989990011',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-product-01',
      email: 'cpo@company.com',
      fullName: 'Cao Văn Kiên',
      jobTitle: 'Giám Đốc Sản Phẩm',
      departmentId: 'dept-8',
      departmentName: 'Khối Quản Trị Sản Phẩm',
      phoneNumber: '0971112233',
      status: 'ACTIVE',
      roles: ['HIRING_MGR']
    },
    {
      id: 'usr-product-02',
      email: 'po@company.com',
      fullName: 'Mai Tuấn Lộc',
      jobTitle: 'Senior Product Owner',
      departmentId: 'dept-8',
      departmentName: 'Khối Quản Trị Sản Phẩm',
      phoneNumber: '0972223344',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-data-01',
      email: 'ai.lead@company.com',
      fullName: 'Lý Gia Huy',
      jobTitle: 'AI Research & Data Lead',
      departmentId: 'dept-3',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      phoneNumber: '0973334455',
      status: 'ACTIVE',
      roles: ['INTERVIEWER']
    },
    {
      id: 'usr-legal-01',
      email: 'legal@company.com',
      fullName: 'Võ Hoàng Trâm',
      jobTitle: 'Trưởng Ban Pháp Chế & Tuân Thủ',
      departmentId: 'dept-9',
      departmentName: 'Ban Pháp Chế',
      phoneNumber: '0974445566',
      status: 'ACTIVE',
      roles: ['APPROVER']
    },
    {
      id: 'usr-locked-02',
      email: 'locked.dev@company.com',
      fullName: 'Trương Vĩnh Phát',
      jobTitle: 'Cựu Kỹ sư Phần mềm',
      departmentId: 'dept-5',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      phoneNumber: '0975556677',
      status: 'LOCKED',
      lockReason: 'Tài khoản bị khóa do đình chỉ công tác phục vụ thanh tra an ninh.',
      roles: ['INTERVIEWER']
    }
  ];

  const insertUser = database.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, job_title, department_id, department_name, phone_number, status, lock_reason, failed_attempts, locked_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = CASE WHEN ? = 1 THEN users.password_hash ELSE excluded.password_hash END,
      full_name = excluded.full_name,
      job_title = excluded.job_title,
      department_name = excluded.department_name,
      phone_number = excluded.phone_number,
      status = excluded.status,
      lock_reason = excluded.lock_reason,
      failed_attempts = 0,
      locked_until = NULL
  `);

  const deleteUserRoles = database.prepare('DELETE FROM user_roles WHERE user_id = ?');
  const insertUserRole = database.prepare(`
    INSERT INTO user_roles (user_id, role_id)
    VALUES (?, (SELECT id FROM roles WHERE code = ?))
  `);

  for (const u of users) {
    (await insertUser.run(
      u.id,
      u.email,
      defaultPasswordHash,
      u.fullName,
      u.jobTitle,
      u.departmentId,
      u.departmentName,
      u.phoneNumber,
      u.status,
      u.lockReason || null,
      preservePasswords ? 1 : 0
    ));

    (await deleteUserRoles.run(u.id));
    for (const rCode of u.roles) {
      (await insertUserRole.run(u.id, rCode));
    }
  }

  // 5. Seed Requisitions (S1-10 AC-03 Handover tracking)
  const requisitions = [
    {
      id: 'req-001',
      code: 'REQ-2026-001',
      title: 'Senior Backend Engineer (NodeJS/Go)',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      hiringManagerId: 'usr-hiring-mgr',
      recruiterId: 'usr-recruiter',
      status: 'OPEN',
      headcount: 2
    },
    {
      id: 'req-002',
      code: 'REQ-2026-002',
      title: 'Senior Frontend Engineer (React/TypeScript)',
      departmentName: 'Phòng Phát Triển Phần Mềm',
      hiringManagerId: 'usr-hiring-mgr',
      recruiterId: 'usr-recruiter-2',
      status: 'OPEN',
      headcount: 2
    },
    {
      id: 'req-003',
      code: 'REQ-2026-003',
      title: 'DevOps / SRE Specialist',
      departmentName: 'Khối Công Nghệ & Kỹ Thuật',
      hiringManagerId: 'usr-hiring-mgr',
      recruiterId: 'usr-recruiter',
      status: 'IN_PROGRESS',
      headcount: 1
    },
    {
      id: 'req-004',
      code: 'REQ-2026-004',
      title: 'Talent Acquisition Partner',
      departmentName: 'Phòng Nhân Sự',
      hiringManagerId: 'usr-hr-mgr',
      recruiterId: 'usr-recruiter-2',
      status: 'OPEN',
      headcount: 1
    }
  ];

  const insertReq = database.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, hiring_manager_id, recruiter_id, status, headcount, handover_required, handover_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(code) DO UPDATE SET
      title = excluded.title,
      department_name = excluded.department_name,
      hiring_manager_id = excluded.hiring_manager_id,
      recruiter_id = excluded.recruiter_id,
      status = excluded.status,
      headcount = excluded.headcount,
      handover_required = FALSE,
      handover_notes = NULL
  `);

  for (const r of requisitions) {
    (await insertReq.run(r.id, r.code, r.title, r.departmentName, r.hiringManagerId, r.recruiterId, r.status, r.headcount));
  }

  // 6. Seed Candidates
  const candidates = [
    { id: 'cand-001', fullName: 'Đặng Minh Tuấn', email: 'tuan.dang@gmail.com', phone: '0912345678', reqId: 'req-001', stage: 'INTERVIEW', exp: 4, company: 'VNG Corp', salary: '35.000.000 đ', notes: 'Kỹ năng Node.js, Go và kiến trúc Microservices rất tốt.' },
    { id: 'cand-002', fullName: 'Trần Bảo Trâm', email: 'tram.tran@outlook.com', phone: '0987654321', reqId: 'req-001', stage: 'SCREENING', exp: 3, company: 'FPT Software', salary: '30.000.000 đ', notes: 'Kinh nghiệm RESTful API, PostgreSQL và Docker.' },
    { id: 'cand-003', fullName: 'Vũ Quốc Hùng', email: 'hung.vu@gmail.com', phone: '0903112233', reqId: 'req-002', stage: 'OFFER', exp: 5, company: 'Tiki Corporation', salary: '42.000.000 đ', notes: 'Frontend Lead, React, TypeScript và Design System xuất sắc.' },
    { id: 'cand-004', fullName: 'Nguyễn Thùy Chi', email: 'chi.nguyen@yahoo.com', phone: '0934556677', reqId: 'req-002', stage: 'NEW', exp: 2, company: 'Viettel Telecom', salary: '25.000.000 đ', notes: 'Hồ sơ mới tiếp nhận qua cổng thông tin tuyển dụng.' },
    { id: 'cand-005', fullName: 'Phạm Hoàng Long', email: 'long.pham@gmail.com', phone: '0978998877', reqId: 'req-003', stage: 'INTERVIEW', exp: 4, company: 'MoMo Wallet', salary: '38.000.000 đ', notes: 'Thành thạo Kubernetes, CI/CD pipeline và AWS Cloud.' },
    { id: 'cand-006', fullName: 'Đỗ Mai Phương', email: 'phuong.do@gmail.com', phone: '0918776655', reqId: 'req-004', stage: 'HIRED', exp: 3, company: 'Shopee Vietnam', salary: '28.000.000 đ', notes: 'Đã hoàn tất thủ tục ký hợp đồng lao động.' }
  ];

  const insertCand = database.prepare(`
    INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage, experience_years, current_company, expected_salary, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name,
      stage = excluded.stage,
      expected_salary = excluded.expected_salary
  `);

  for (const c of candidates) {
    (await insertCand.run(c.id, c.fullName, c.email, c.phone, c.reqId, c.stage, c.exp, c.company, c.salary, c.notes));
  }

  // Clean up any test artifact names if present
  (await database.prepare("UPDATE candidates SET full_name = 'Lê Hoàng Long', email = 'hoanglong.le@gmail.com' WHERE full_name LIKE '%Kiểm Thử%'").run());
  (await database.prepare("UPDATE candidates SET full_name = 'Nguyễn Thị Phương Thảo', email = 'phuongthao.nguyen@gmail.com' WHERE full_name LIKE '%Test%'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Kỹ sư Trí tuệ Nhân tạo (AI Engineer)' WHERE id = 'req-29161419-e5a7-4fba-bda6-7bae6ea84d2f'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Chuyên viên Phân tích Dữ liệu (Data Analyst)' WHERE id = 'req-2ef45985-6d1b-4d0d-99b3-448eee28d9be'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Kỹ sư Giải pháp Đám mây (Cloud Architect)' WHERE id = 'req-0787270f-c4fe-4bf6-8c31-4110a6e96178'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Kỹ sư Kiểm thử Phần mềm (QA/QC Engineer)' WHERE id = 'req-d390af88-1d16-4cbc-afc2-2ece62a2bb12'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Trưởng nhóm Kỹ thuật (Engineering Manager)' WHERE id = 'req-d80ec776-4751-47a3-ba73-76e4c1158a0d'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Chuyên viên Tuyển dụng Cao cấp (Senior IT Recruiter)' WHERE id = 'req-9751ed0c-bb30-470b-9f39-3d05169a794a'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Thiết kế Sản phẩm (Product Designer UI/UX)' WHERE id = 'req-8d814b53-15c6-454f-b200-4b9f8abd6108'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Kỹ sư An toàn Thông tin (Security Engineer)' WHERE id = 'req-b947a1c0-1494-42b5-9b3f-c71d793e6cfa'").run());
  (await database.prepare("UPDATE requisitions SET title = 'Chuyên viên Quản trị Hệ thống (System Admin)' WHERE id = 'req-3001d0f8-421c-42bd-8fc6-3b0133e34011'").run());

  // 7. Seed Interviews
  const interviews = [
    { id: 'int-001', candId: 'cand-001', reqId: 'req-001', interviewerId: 'usr-interviewer', round: 'Phỏng vấn Kỹ thuật Backend', time: '2026-10-02 14:00', location: 'Google Meet: meet.google.com/ats-backend-01', status: 'SCHEDULED', score: 8, feedback: 'Nắm vững concurrency và database indexing.' },
    { id: 'int-002', candId: 'cand-005', reqId: 'req-003', interviewerId: 'usr-interviewer', round: 'Phỏng vấn SRE / Hạ tầng', time: '2026-10-03 10:00', location: 'Phòng họp Kỹ thuật P.402', status: 'SCHEDULED', score: null, feedback: null },
    { id: 'int-003', candId: 'cand-003', reqId: 'req-002', interviewerId: 'usr-hiring-mgr', round: 'Phỏng vấn Văn hóa & Định hướng', time: '2026-09-29 15:30', location: 'Phòng họp Hội đồng Quản trị', status: 'COMPLETED', score: 9, feedback: 'Tư duy sản phẩm và tinh thần trách nhiệm cao.' }
  ];

  const insertInt = database.prepare(`
    INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, feedback, score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      scheduled_time = excluded.scheduled_time
  `);

  for (const i of interviews) {
    (await insertInt.run(i.id, i.candId, i.reqId, i.interviewerId, i.round, i.time, i.location, i.status, i.feedback, i.score));
  }

  // 8. Seed Offers
  const offers = [
    { id: 'off-001', candId: 'cand-003', reqId: 'req-002', salary: 42000000, startDate: '2026-11-01', status: 'APPROVED', approverId: 'usr-approver' },
    { id: 'off-002', candId: 'cand-006', reqId: 'req-004', salary: 28000000, startDate: '2026-10-15', status: 'ACCEPTED', approverId: 'usr-approver' }
  ];

  const insertOff = database.prepare(`
    INSERT INTO offers (id, candidate_id, requisition_id, salary_monthly, start_date, status, approver_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      salary_monthly = excluded.salary_monthly
  `);

  for (const o of offers) {
    (await insertOff.run(o.id, o.candId, o.reqId, o.salary, o.startDate, o.status, o.approverId));
  }

  (await ensureDepartmentFeature(database));
  (await ensureCompetencyFeature(database));
  (await ensureRequisitionDraftFeature(database));

  console.log(`[Seed] Seeded ${roles.length} roles, ${permissions.length} permissions, ${totalRolePerms} role-permissions mappings, ${users.length} users, ${requisitions.length} requisitions, ${candidates.length} candidates, ${interviews.length} interviews, and ${offers.length} offers successfully with secure password hashing.`);
}

async function ensureRequisitionDraftFeature(db) {
  const database = db || getDatabase();
  (await database.exec(`
    INSERT OR IGNORE INTO permissions (id, code, name, module, description)
    VALUES ('perm-req-draft-edit', 'requisition.draft.edit', 'Sửa nháp yêu cầu tuyển dụng của mình', 'REQUISITIONS', 'Cập nhật và hoàn tất yêu cầu S2-10 ở trạng thái nháp do mình tạo');
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r, permissions p
    WHERE r.code IN ('HIRING_MGR', 'HR_MANAGER') AND p.code = 'requisition.draft.edit';
  `));
}

async function ensureDepartmentFeature(db) {
  const database = db || getDatabase();

  const permissions = [
    ['perm-dept-read', 'department.read', 'Xem phòng ban', 'Xem cây phòng ban và sơ đồ tổ chức'],
    ['perm-dept-manage', 'department.manage', 'Quản lý phòng ban', 'Tạo, sửa, ngừng áp dụng và quản lý cấu trúc phòng ban']
  ];

  const upsertPermission = database.prepare(`
    INSERT INTO permissions (id, code, name, module, description)
    VALUES (?, ?, ?, 'DEPARTMENTS', ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      module = excluded.module,
      description = excluded.description
  `);

  for (const permission of permissions) {
    (await upsertPermission.run(...permission));
  }

  const assignPermission = database.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.code = ? AND p.code = ?
  `);

  for (const roleCode of ['ADMIN', 'HR_MANAGER']) {
    (await assignPermission.run(roleCode, 'department.read'));
    (await assignPermission.run(roleCode, 'department.manage'));
  }

  const departments = [
    ['dept-1', 'EXEC', 'Ban Giám Đốc', null, 'usr-approver'],
    ['dept-2', 'HR', 'Phòng Nhân Sự', 'dept-1', 'usr-hr-mgr'],
    ['dept-3', 'TECH', 'Khối Công Nghệ & Kỹ Thuật', 'dept-1', 'usr-hiring-mgr'],
    ['dept-4', 'FIN', 'Phòng Tài Chính - Kế Toán', 'dept-1', 'usr-finance-01'],
    ['dept-7', 'MKT', 'Phòng Marketing & Truyền Thông', 'dept-1', 'usr-mkt-01'],
    ['dept-8', 'PRODUCT', 'Khối Quản Trị Sản Phẩm', 'dept-1', 'usr-product-01'],
    ['dept-9', 'LEGAL', 'Ban Pháp Chế', 'dept-1', 'usr-legal-01'],
    ['dept-5', 'DEV', 'Phòng Phát Triển Phần Mềm', 'dept-3', 'usr-interviewer'],
    ['dept-6', 'QA', 'Phòng Đảm Bảo Chất Lượng (QA/QC)', 'dept-3', 'usr-dual-role']
  ];

  const insertDepartment = database.prepare(`
    INSERT OR IGNORE INTO departments (
      id, code, name, parent_id, manager_id, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
  `);

  for (const department of departments) {
    const managerExists = (await database.prepare(
      'SELECT id FROM users WHERE id = ?'
    ).get(department[4]));

    if (managerExists) {
      (await insertDepartment.run(...department));
    }
  }

  (await database.exec(`
    UPDATE requisitions
    SET department_id = (
      SELECT d.id
      FROM departments d
      WHERE d.name = requisitions.department_name
      LIMIT 1
    )
    WHERE department_id IS NULL;
  `));
}
async function ensureCompetencyFeature(db) {
  const database = db || getDatabase();

  (await database.prepare(`
    INSERT OR IGNORE INTO permissions (id, code, name, module, description)
    VALUES ('perm-salary-range-read', 'salary_range.read', 'Xem dải lương', 'OFFERS', 'Xem dải lương tối thiểu và tối đa của chức danh')
  `).run());
  (await database.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r, permissions p
    WHERE r.code = 'HR_MANAGER' AND p.code = 'salary_range.read'
  `).run());

  const permissions = [
    [
      'perm-competency-read',
      'competency.read',
      'Xem khung năng lực',
      'Xem khung năng lực, tiêu chí đánh giá và chức danh áp dụng'
    ],
    [
      'perm-competency-manage',
      'competency.manage',
      'Quản lý khung năng lực',
      'Tạo, sửa và gán khung năng lực cho chức danh'
    ]
  ];

  const upsertPermission = database.prepare(`
    INSERT INTO permissions (id, code, name, module, description)
    VALUES (?, ?, ?, 'COMPETENCIES', ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      module = excluded.module,
      description = excluded.description
  `);

  for (const permission of permissions) {
    (await upsertPermission.run(...permission));
  }

  const assignPermission = database.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.code = ? AND p.code = ?
  `);

  for (const roleCode of ['ADMIN', 'HR_MANAGER']) {
    (await assignPermission.run(roleCode, 'competency.read'));
    (await assignPermission.run(roleCode, 'competency.manage'));
  }
}
async function ensureQuestionBankFeature(db) {
  const database = db || getDatabase();

  const permissions = [
    [
      'perm-question-bank-read',
      'question_bank.read',
      'Xem ngân hàng câu hỏi',
      'Xem và tìm kiếm câu hỏi phỏng vấn theo chức danh và tiêu chí năng lực'
    ],
    [
      'perm-question-bank-manage',
      'question_bank.manage',
      'Quản lý ngân hàng câu hỏi',
      'Tạo và cập nhật câu hỏi phỏng vấn theo tiêu chí năng lực'
    ]
  ];

  const upsertPermission = database.prepare(`
    INSERT INTO permissions (id, code, name, module, description)
    VALUES (?, ?, ?, 'QUESTION_BANK', ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      module = excluded.module,
      description = excluded.description
  `);

  for (const permission of permissions) {
    (await upsertPermission.run(...permission));
  }

  const assignPermission = database.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.code = ? AND p.code = ?
  `);

  for (const roleCode of ['ADMIN', 'HR_MANAGER', 'INTERVIEWER']) {
    (await assignPermission.run(roleCode, 'question_bank.read'));
  }

  for (const roleCode of ['ADMIN', 'HR_MANAGER']) {
    (await assignPermission.run(roleCode, 'question_bank.manage'));
  }
}

async function ensureRecruitmentCatalogFeature(db) {
  const database = db || getDatabase();

  const permissions = [
    [
      'perm-recruitment-catalog-read',
      'recruitment_catalog.read',
      'Xem danh mục tuyển dụng',
      'Xem các danh mục dùng chung trong tuyển dụng'
    ],
    [
      'perm-recruitment-catalog-manage',
      'recruitment_catalog.manage',
      'Quản lý danh mục tuyển dụng',
      'Tạo, sửa, sắp xếp và xóa các danh mục dùng chung trong tuyển dụng'
    ]
  ];

  const upsertPermission = database.prepare(`
    INSERT INTO permissions (id, code, name, module, description)
    VALUES (?, ?, ?, 'RECRUITMENT_CATALOG', ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      module = excluded.module,
      description = excluded.description
  `);

  for (const permission of permissions) {
    (await upsertPermission.run(...permission));
  }

  const assignPermission = database.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.code = ? AND p.code = ?
  `);

  for (const roleCode of ['ADMIN', 'HR_MANAGER']) {
    (await assignPermission.run(roleCode, 'recruitment_catalog.read'));
    (await assignPermission.run(roleCode, 'recruitment_catalog.manage'));
  }

  (await assignPermission.run('RECRUITER', 'recruitment_catalog.read'));
  (await assignPermission.run('HIRING_MGR', 'recruitment_catalog.read'));
}
async function ensureCareerPageFeature(db) {
  const database = db || getDatabase();

  const permissions = [
    [
      'perm-career-page-read',
      'career_page.read',
      'Xem cấu hình trang tuyển dụng',
      'Xem nội dung cấu hình trang giới thiệu công ty trên cổng tuyển dụng'
    ],
    [
      'perm-career-page-manage',
      'career_page.manage',
      'Quản lý trang tuyển dụng',
      'Soạn nội dung, tải logo và ảnh cho trang giới thiệu công ty'
    ]
  ];

  const upsertPermission = database.prepare(`
    INSERT INTO permissions (id, code, name, module, description)
    VALUES (?, ?, ?, 'CAREER_PAGE', ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      module = excluded.module,
      description = excluded.description
  `);

  for (const permission of permissions) {
    (await upsertPermission.run(...permission));
  }

  const assignPermission = database.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.code = ? AND p.code = ?
  `);

  for (const roleCode of ['ADMIN', 'HR_MANAGER']) {
    (await assignPermission.run(roleCode, 'career_page.read'));
    (await assignPermission.run(roleCode, 'career_page.manage'));
  }
}
if (require.main === module) {
  const db = getDatabase();
  db.transaction(() => seedDatabase(db)).catch(() => { console.error('[Seed] FAILED'); process.exitCode = 1; }).finally(() => db.close());
}

module.exports = {
  seedDatabase,
  ensureDepartmentFeature,
  ensureCompetencyFeature,
  ensureQuestionBankFeature,
  ensureRecruitmentCatalogFeature,
  ensureCareerPageFeature,
  ensureRequisitionDraftFeature
};
