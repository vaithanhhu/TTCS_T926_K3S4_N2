CREATE TABLE IF NOT EXISTS interview_asked_questions (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
  asked_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_interview_asked_questions UNIQUE(interview_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_asked_questions_interview ON interview_asked_questions(interview_id);
CREATE INDEX IF NOT EXISTS idx_asked_questions_question ON interview_asked_questions(question_id);
