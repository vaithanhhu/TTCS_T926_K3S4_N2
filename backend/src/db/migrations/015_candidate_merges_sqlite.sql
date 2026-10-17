ALTER TABLE candidates ADD COLUMN merged_into_id TEXT REFERENCES candidates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_merged_into ON candidates(merged_into_id);

CREATE TABLE candidate_merge_events (
  id TEXT PRIMARY KEY,
  primary_candidate_id TEXT NOT NULL REFERENCES candidates(id),
  secondary_candidate_id TEXT NOT NULL REFERENCES candidates(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_name TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT,
  undone_by TEXT REFERENCES users(id),
  before_json TEXT NOT NULL,
  moved_rows_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'MERGED' CHECK(status IN ('MERGED','UNDONE'))
);
CREATE INDEX candidate_merge_events_recent ON candidate_merge_events(merged_at, status);
