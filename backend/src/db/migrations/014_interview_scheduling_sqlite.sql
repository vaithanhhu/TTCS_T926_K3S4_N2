CREATE TABLE IF NOT EXISTS interview_interviewers (
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'INTERVIEWER',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (interview_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_interviewers_user ON interview_interviewers(user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_scheduled_time ON interviews(scheduled_time);
