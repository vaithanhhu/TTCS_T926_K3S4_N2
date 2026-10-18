CREATE TABLE IF NOT EXISTS offer_approvals (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'REQUEST_REVISION')),
  approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approver_name TEXT,
  approver_role TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offer_approvals_offer ON offer_approvals(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_approvals_approver ON offer_approvals(approver_id);
CREATE TRIGGER IF NOT EXISTS trg_prevent_offer_approvals_update
BEFORE UPDATE ON offer_approvals
BEGIN
  SELECT RAISE(ABORT, 'OFFER_APPROVALS_ARE_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS trg_prevent_offer_approvals_delete
BEFORE DELETE ON offer_approvals
BEGIN
  SELECT RAISE(ABORT, 'OFFER_APPROVALS_ARE_IMMUTABLE');
END;
