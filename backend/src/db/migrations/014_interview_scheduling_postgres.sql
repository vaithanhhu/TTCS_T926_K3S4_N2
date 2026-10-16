ALTER TABLE interviews ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_format TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS meeting_room TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS meeting_link TEXT;

CREATE TABLE IF NOT EXISTS interview_interviewers (
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'INTERVIEWER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (interview_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_interviewers_user ON interview_interviewers(user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_scheduled_time ON interviews(scheduled_time);
