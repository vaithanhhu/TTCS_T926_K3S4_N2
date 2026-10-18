CREATE TABLE IF NOT EXISTS hiring_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
  interview_id TEXT REFERENCES interviews(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('OFFER', 'REJECT', 'PASS', 'HOLD')),
  rejection_reason_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE SET NULL,
  reason_text TEXT,
  notes TEXT,
  consensus_score REAL,
  next_action TEXT,
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hiring_decisions_candidate ON hiring_decisions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_hiring_decisions_interview ON hiring_decisions(interview_id);
CREATE INDEX IF NOT EXISTS idx_hiring_decisions_decided_by ON hiring_decisions(decided_by);
