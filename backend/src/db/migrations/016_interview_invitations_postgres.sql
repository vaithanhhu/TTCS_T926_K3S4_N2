ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_response_status VARCHAR(30) DEFAULT 'PENDING';
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_response_note TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_responded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS interview_invitation_tokens (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_hash ON interview_invitation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_interview ON interview_invitation_tokens(interview_id);
