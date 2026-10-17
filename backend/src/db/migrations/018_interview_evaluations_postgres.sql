CREATE TABLE IF NOT EXISTS interview_evaluations (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL,
  framework_id TEXT REFERENCES competency_frameworks(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  snapshot_criteria TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REOPENED')),
  recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('RECOMMENDED', 'CONSIDER', 'NOT_RECOMMENDED')),
  general_notes TEXT,
  total_score NUMERIC(4, 2),
  submitted_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  reopened_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_interview_evaluations_int_user UNIQUE(interview_id, interviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_evaluations_interview ON interview_evaluations(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_evaluations_interviewer ON interview_evaluations(interviewer_id);
CREATE INDEX IF NOT EXISTS idx_interview_evaluations_status ON interview_evaluations(status);

CREATE TABLE IF NOT EXISTS interview_evaluation_items (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES interview_evaluations(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL,
  criterion_name TEXT NOT NULL,
  weight INTEGER NOT NULL,
  score INTEGER CHECK (score IS NULL OR (score >= 1 AND score <= 5)),
  comment TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_evaluation_items_eval_crit UNIQUE(evaluation_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_items_eval ON interview_evaluation_items(evaluation_id);
