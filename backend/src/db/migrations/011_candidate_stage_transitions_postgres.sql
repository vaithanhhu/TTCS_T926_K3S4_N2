-- Migration 011: Candidate Stage Transitions & Exceptions (PostgreSQL)
-- S5-03: Mandatory rejection reason, audit history, and interview skip exception control

-- 1. Default Rejection Reasons in recruitment_catalog_items
INSERT INTO recruitment_catalog_items (id, type, code, name, status, display_order, created_at, updated_at)
VALUES
  ('cat-rej-skills', 'REJECTION_REASON', 'REJ-SKILLS', 'Không đáp ứng yêu cầu chuyên môn / kỹ năng', 'ACTIVE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat-rej-exp', 'REJECTION_REASON', 'REJ-EXP', 'Chưa đủ số năm kinh nghiệm yêu cầu', 'ACTIVE', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat-rej-salary', 'REJECTION_REASON', 'REJ-SALARY', 'Kỳ vọng mức lương không phù hợp ngân sách', 'ACTIVE', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat-rej-culture', 'REJECTION_REASON', 'REJ-CULTURE', 'Chưa phù hợp với văn hóa / môi trường làm việc', 'ACTIVE', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat-rej-declined', 'REJECTION_REASON', 'REJ-OFFER-DECLINED', 'Ứng viên từ chối nhận việc / chọn cơ hội khác', 'ACTIVE', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat-rej-noshow', 'REJECTION_REASON', 'REJ-NO-SHOW', 'Không tham gia phỏng vấn / mất liên lạc', 'ACTIVE', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat-rej-other', 'REJECTION_REASON', 'REJ-OTHER', 'Khác', 'ACTIVE', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

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
  approved_at TIMESTAMPTZ,
  decision_comment TEXT,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cand_stage_exc_cand ON candidate_stage_exceptions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cand_stage_exc_status ON candidate_stage_exceptions(status);

ALTER TABLE candidate_status_history ADD COLUMN IF NOT EXISTS rejection_reason_id TEXT REFERENCES recruitment_catalog_items(id);
ALTER TABLE candidate_status_history ADD COLUMN IF NOT EXISTS skipped_interview_approved_by TEXT REFERENCES users(id);
ALTER TABLE candidate_status_history ADD COLUMN IF NOT EXISTS skipped_interview_approved_name TEXT;
ALTER TABLE candidate_status_history ADD COLUMN IF NOT EXISTS skipped_interview_approved_at TIMESTAMPTZ;
ALTER TABLE candidate_status_history ADD COLUMN IF NOT EXISTS exception_request_id TEXT REFERENCES candidate_stage_exceptions(id);
