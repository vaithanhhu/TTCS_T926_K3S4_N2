CREATE TABLE IF NOT EXISTS onboarding_templates (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('ACCOUNT', 'EQUIPMENT', 'WORKSPACE', 'DOCUMENTATION')),
  title TEXT NOT NULL,
  description TEXT,
  default_assignee_role TEXT,
  default_assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  relative_due_days INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES onboarding_templates(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  progress_percentage INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('ACCOUNT', 'EQUIPMENT', 'WORKSPACE', 'DOCUMENTATION')),
  title TEXT NOT NULL,
  description TEXT,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'SKIPPED')),
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_audit_logs (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES onboarding_checklist_items(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_cand ON onboarding_checklists(candidate_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_dept ON onboarding_checklists(department_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_items_ck ON onboarding_checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_items_asg ON onboarding_checklist_items(assignee_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_items_st ON onboarding_checklist_items(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_tmpl_dept ON onboarding_templates(department_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tmpl_items_tmpl ON onboarding_template_items(template_id);

INSERT OR IGNORE INTO onboarding_templates (id, department_id, name, description, is_default, created_at, updated_at)
VALUES ('tmpl-default', NULL, 'Mẫu Onboarding Tiêu chuẩn', 'Quy trình onboarding chung áp dụng cho mọi phòng ban', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO onboarding_template_items (id, template_id, category, title, description, relative_due_days, display_order, is_required, created_at, updated_at)
VALUES
  ('tmpl-item-def-1', 'tmpl-default', 'ACCOUNT', 'Khởi tạo tài khoản email công ty và Slack', 'Tạo tài khoản Google Workspace và tài khoản chat nội bộ', 1, 1, 1, datetime('now'), datetime('now')),
  ('tmpl-item-def-2', 'tmpl-default', 'ACCOUNT', 'Cấp quyền truy cập hệ thống nghiệp vụ nội bộ', 'Cấp quyền vào Jira, Confluence, CRM/ATS', 1, 2, 1, datetime('now'), datetime('now')),
  ('tmpl-item-def-3', 'tmpl-default', 'EQUIPMENT', 'Cấp phát máy tính xách tay và thiết bị làm việc', 'Chuẩn bị laptop, bàn phím, chuột và tai nghe', 1, 3, 1, datetime('now'), datetime('now')),
  ('tmpl-item-def-4', 'tmpl-default', 'WORKSPACE', 'Bố trí chỗ ngồi và thẻ ra vào văn phòng', 'Chuẩn bị bàn làm việc, ghế và phát thẻ từ ra vào tòa nhà', 1, 4, 1, datetime('now'), datetime('now')),
  ('tmpl-item-def-5', 'tmpl-default', 'DOCUMENTATION', 'Tiếp nhận hồ sơ nhân sự và ký HĐLĐ', 'Thu thập bản sao bằng cấp, CCCD, ký hợp đồng lao động và cam kết bảo mật', 3, 5, 1, datetime('now'), datetime('now'));
