-- Migration 011: Candidate Stage Transitions & Exceptions (SQLite)
-- S5-03: Mandatory rejection reason, audit history, and interview skip exception control

-- 1. Default Rejection Reasons in recruitment_catalog_items
INSERT OR IGNORE INTO recruitment_catalog_items (id, type, code, name, status, display_order, created_at, updated_at)
VALUES
  ('cat-rej-skills', 'REJECTION_REASON', 'REJ-SKILLS', 'Không đáp ứng yêu cầu chuyên môn / kỹ năng', 'ACTIVE', 1, datetime('now'), datetime('now')),
  ('cat-rej-exp', 'REJECTION_REASON', 'REJ-EXP', 'Chưa đủ số năm kinh nghiệm yêu cầu', 'ACTIVE', 2, datetime('now'), datetime('now')),
  ('cat-rej-salary', 'REJECTION_REASON', 'REJ-SALARY', 'Kỳ vọng mức lương không phù hợp ngân sách', 'ACTIVE', 3, datetime('now'), datetime('now')),
  ('cat-rej-culture', 'REJECTION_REASON', 'REJ-CULTURE', 'Chưa phù hợp với văn hóa / môi trường làm việc', 'ACTIVE', 4, datetime('now'), datetime('now')),
  ('cat-rej-declined', 'REJECTION_REASON', 'REJ-OFFER-DECLINED', 'Ứng viên từ chối nhận việc / chọn cơ hội khác', 'ACTIVE', 5, datetime('now'), datetime('now')),
  ('cat-rej-noshow', 'REJECTION_REASON', 'REJ-NO-SHOW', 'Không tham gia phỏng vấn / mất liên lạc', 'ACTIVE', 6, datetime('now'), datetime('now')),
  ('cat-rej-other', 'REJECTION_REASON', 'REJ-OTHER', 'Khác', 'ACTIVE', 7, datetime('now'), datetime('now'));

-- 2. Candidate Stage Exceptions Table (Luồng phê duyệt ngoại lệ bỏ qua phỏng vấn)
CREATE TABLE IF NOT EXISTS candidate_stage_exceptions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  requisition_id TEXT REFERENCES requisitions(id),
  from_stage TEXT NOT NULL,
  target_stage TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  requester_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by TEXT REFERENCES users(id),
  approver_name TEXT,
  approved_at TEXT,
  decision_comment TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cand_stage_exc_cand ON candidate_stage_exceptions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cand_stage_exc_status ON candidate_stage_exceptions(status);
