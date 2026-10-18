ALTER TABLE offers ADD COLUMN IF NOT EXISTS current_approval_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS required_approval_levels INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS offer_approvals (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'REQUEST_REVISION')),
  approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approver_name TEXT,
  approver_role TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_offer_approvals_offer ON offer_approvals(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_approvals_approver ON offer_approvals(approver_id);
CREATE OR REPLACE FUNCTION prevent_offer_approvals_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'OFFER_APPROVALS_ARE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_prevent_offer_approvals_update ON offer_approvals;
CREATE TRIGGER trg_prevent_offer_approvals_update
BEFORE UPDATE ON offer_approvals
FOR EACH ROW EXECUTE FUNCTION prevent_offer_approvals_mutation();
DROP TRIGGER IF EXISTS trg_prevent_offer_approvals_delete ON offer_approvals;
CREATE TRIGGER trg_prevent_offer_approvals_delete
BEFORE DELETE ON offer_approvals
FOR EACH ROW EXECUTE FUNCTION prevent_offer_approvals_mutation();
