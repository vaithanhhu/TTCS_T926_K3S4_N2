CREATE TABLE IF NOT EXISTS interview_invitation_tokens (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_hash ON interview_invitation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_interview ON interview_invitation_tokens(interview_id);
