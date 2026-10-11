ALTER TABLE candidates ADD COLUMN IF NOT EXISTS job_posting_id TEXT REFERENCES job_postings(id);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cover_letter TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tracking_code TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS withdraw_token_hash TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referrer_id TEXT REFERENCES users(id);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referrer_name TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referral_notes TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS is_internal_referral BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_tracking_code ON candidates(tracking_code) WHERE tracking_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_job_posting ON candidates(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_candidates_referrer ON candidates(referrer_id);

CREATE TABLE IF NOT EXISTS candidate_documents (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'CV',
  parsed_text TEXT,
  parsed_data_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candidate_documents_cand ON candidate_documents(candidate_id);

CREATE TABLE IF NOT EXISTS candidate_status_history (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  before_stage TEXT,
  after_stage TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candidate_status_hist_cand ON candidate_status_history(candidate_id);

CREATE TABLE IF NOT EXISTS candidate_tags (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candidate_tags_cand ON candidate_tags(candidate_id);

CREATE TABLE IF NOT EXISTS candidate_notes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  author_name TEXT NOT NULL,
  note_text TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candidate_notes_cand ON candidate_notes(candidate_id);

CREATE TABLE IF NOT EXISTS application_rate_limits (
  id TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL,
  action TEXT NOT NULL,
  attempt_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_rate_limits_ip ON application_rate_limits(ip_address, action, attempt_time);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  template_name TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);

CREATE TABLE IF NOT EXISTS application_tracking_tokens (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'WITHDRAW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_tracking_tokens_cand ON application_tracking_tokens(candidate_id);
