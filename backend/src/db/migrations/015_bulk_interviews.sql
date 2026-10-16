CREATE TABLE interview_batches (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_snapshot TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_id, request_key)
);
CREATE TABLE interview_batch_items (
  batch_id TEXT NOT NULL REFERENCES interview_batches(id) ON DELETE CASCADE,
  interview_id TEXT PRIMARY KEY NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  UNIQUE(batch_id, candidate_id)
);
CREATE TABLE interview_invitation_deliveries (
  outbox_id TEXT PRIMARY KEY NOT NULL REFERENCES email_outbox(id),
  interview_id TEXT NOT NULL UNIQUE REFERENCES interviews(id),
  state TEXT NOT NULL CHECK(state IN ('PENDING','SENDING','SENT','SIMULATED','FAILED','UNKNOWN')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_interview_deliveries_state ON interview_invitation_deliveries(state);
