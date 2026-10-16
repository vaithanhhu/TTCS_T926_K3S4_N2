CREATE TABLE IF NOT EXISTS candidate_talent_pool (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  interested_title TEXT NOT NULL,
  reason TEXT NOT NULL,
  final_round_confirmed BOOLEAN NOT NULL CHECK (final_round_confirmed=TRUE),
  confirmed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidate_talent_pool_created ON candidate_talent_pool(created_at);
