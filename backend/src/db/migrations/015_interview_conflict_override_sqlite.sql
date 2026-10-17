CREATE TABLE IF NOT EXISTS interview_conflict_override_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  reason TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_conflict_override_interview ON interview_conflict_override_audit(interview_id);
