CREATE TABLE IF NOT EXISTS candidate_saved_filters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidate_saved_filters_user ON candidate_saved_filters(user_id);
CREATE INDEX IF NOT EXISTS idx_candidate_search_interview_score ON interviews(candidate_id,status);
CREATE INDEX IF NOT EXISTS idx_candidate_search_created ON candidates(created_at,id);
