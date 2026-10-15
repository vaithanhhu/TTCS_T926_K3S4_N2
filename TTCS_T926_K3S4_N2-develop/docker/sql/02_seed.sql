-- ==============================================================================
-- HỆ THỐNG TUYỂN DỤNG NỘI BỘ (ATS)
-- Seed Data Mẫu Sprint 1: 7 Vai trò, Phòng ban, Tài khoản nhân sự kiểm thử
-- ==============================================================================

-- 1. Khởi tạo 7 Vai trò nghiệp vụ
INSERT INTO roles (id, code, name, description) VALUES
('ADMIN', 'ADMIN', 'Quản trị hệ thống', 'Quản lý tài khoản, vai trò, danh mục dùng chung, xem nhật ký hệ thống'),
('HR_MANAGER', 'HR_MANAGER', 'Trưởng phòng Nhân sự', 'Chủ sở hữu toàn bộ hoạt động tuyển dụng, phân công recruiter, duyệt requisition & offer'),
('RECRUITER', 'RECRUITER', 'Nhân viên tuyển dụng', 'Vận hành tuyển dụng hằng ngày, sàng lọc CV, kanban pipeline, đặt lịch, soạn offer'),
('HIRING_MGR', 'HIRING_MGR', 'Trưởng bộ phận', 'Người sở hữu vị trí tuyển dụng, tạo yêu cầu tuyển dụng, xem ứng viên, ra quyết định tuyển'),
('INTERVIEWER', 'INTERVIEWER', 'Người phỏng vấn', 'Xem lịch, đọc CV, nộp phiếu đánh giá năng lực theo khung tiêu chí'),
('APPROVER', 'APPROVER', 'Người duyệt', 'Ban giám đốc hoặc cấp duyệt theo hạn mức duyệt yêu cầu tuyển dụng và offer lương cao'),
('CANDIDATE', 'CANDIDATE', 'Ứng viên', 'Người nộp hồ sơ từ bên ngoài, tra cứu mã trạng thái, xác nhận lịch phỏng vấn và offer')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- 2. Khởi tạo Phòng ban mẫu
INSERT INTO departments (id, code, name, parent_id, manager_name) VALUES
('dept-1', 'BOD', 'Ban Giám Đốc', NULL, 'Nguyễn Văn An'),
('dept-2', 'HR', 'Phòng Nhân Sự', 'dept-1', 'Trần Thị Mai'),
('dept-3', 'IT', 'Khối Công Nghệ & Kỹ Thuật', 'dept-1', 'Lê Hoàng Nam'),
('dept-4', 'SALES', 'Khối Kinh Doanh & Tiếp Thị', 'dept-1', 'Phạm Minh Tuấn'),
('dept-5', 'DEV', 'Phòng Phát Triển Phần Mềm', 'dept-3', 'Đặng Quốc Huy'),
('dept-6', 'QA', 'Phòng Đảm Bảo Chất Lượng (QA/QC)', 'dept-3', 'Vũ Hồng Hạnh')
ON CONFLICT (id) DO NOTHING;

-- 3. Khởi tạo Tài khoản mẫu (Mật khẩu mặc định: 'Ats@123456')
-- Hash bcrypt mẫu cho 'Ats@123456': $2a$12$e8YkYk4lI0U7jIqD6z3fUec7jG0aK4m7Wq4a7u6u7u7u7u7u7u7u7
INSERT INTO users (id, email, password_hash, full_name, phone_number, job_title, department_id, status, failed_login_attempts) VALUES
('usr-admin', 'admin@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Nguyễn Quản Trị', '0901234567', 'System Administrator', 'dept-3', 'ACTIVE', 0),
('usr-hr-mgr', 'hrmanager@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Trần Thị Mai', '0912345678', 'Trưởng Phòng Nhân Sự', 'dept-2', 'ACTIVE', 0),
('usr-recruiter', 'recruiter@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Hoàng Thu Thảo', '0923456789', 'Chuyên Viên Tuyển Dụng', 'dept-2', 'ACTIVE', 0),
('usr-hiring-mgr', 'hiringmgr@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Lê Hoàng Nam', '0934567890', 'Trưởng Khối Công Nghệ', 'dept-3', 'ACTIVE', 0),
('usr-interviewer', 'interviewer@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Đặng Quốc Huy', '0945678901', 'Tech Lead / Senior Developer', 'dept-5', 'ACTIVE', 0),
('usr-approver', 'approver@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Nguyễn Văn An', '0956789012', 'Giám Đốc Điều Hành (CEO)', 'dept-1', 'ACTIVE', 0),
('usr-dual-role', 'dualrole@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Vũ Hồng Hạnh', '0967890123', 'QA Lead & Interviewer', 'dept-6', 'ACTIVE', 0),
('usr-locked', 'locked.user@company.com', '$2a$12$W9x2w8n7m6l5k4j3h2g1f0e9d8c7b6a5Z4Y3X2W1V0U9T8S7R6Q5P', 'Phạm Nghỉ Việc', '0978901234', 'Cựu Nhân Viên', 'dept-4', 'LOCKED', 5)
ON CONFLICT (id) DO NOTHING;

-- Cập nhật lý do khóa cho usr-locked
UPDATE users SET lock_reason = 'Nhân sự đã nghỉ việc từ ngày 15/09/2026, khóa tài khoản để bảo mật hồ sơ ứng viên' WHERE id = 'usr-locked';

-- 4. Gán Vai trò cho từng User mẫu (Hỗ trợ 1 người nhiều vai trò)
INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES
('usr-admin', 'ADMIN', 'SYSTEM'),
('usr-hr-mgr', 'HR_MANAGER', 'usr-admin'),
('usr-recruiter', 'RECRUITER', 'usr-admin'),
('usr-hiring-mgr', 'HIRING_MGR', 'usr-admin'),
('usr-interviewer', 'INTERVIEWER', 'usr-admin'),
('usr-approver', 'APPROVER', 'usr-admin'),
('usr-dual-role', 'HIRING_MGR', 'usr-admin'),   -- Đa vai trò 1
('usr-dual-role', 'INTERVIEWER', 'usr-admin'),  -- Đa vai trò 2
('usr-locked', 'RECRUITER', 'usr-admin')
ON CONFLICT DO NOTHING;

-- 5. Nhật ký mẫu (Audit Logs)
INSERT INTO audit_logs (id, actor_id, actor_name, actor_email, action, target_resource, target_id, details) VALUES
('log-01', 'usr-admin', 'Nguyễn Quản Trị', 'admin@company.com', 'INITIALIZE_SYSTEM', 'SYSTEM', NULL, '{"note": "Khởi tạo hệ thống và 7 vai trò chuẩn Sprint 1"}'),
('log-02', 'usr-admin', 'Nguyễn Quản Trị', 'admin@company.com', 'CREATE_USER', 'USERS', 'usr-hr-mgr', '{"email": "hrmanager@company.com", "role": "HR_MANAGER"}'),
('log-03', 'usr-admin', 'Nguyễn Quản Trị', 'admin@company.com', 'ASSIGN_MULTI_ROLE', 'USERS', 'usr-dual-role', '{"roles": ["HIRING_MGR", "INTERVIEWER"]}'),
('log-04', 'usr-admin', 'Nguyễn Quản Trị', 'admin@company.com', 'LOCK_USER', 'USERS', 'usr-locked', '{"reason": "Nhân sự nghỉ việc, thu hồi phiên làm việc tức thời"}');
