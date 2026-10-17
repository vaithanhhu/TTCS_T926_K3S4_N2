ALTER TABLE interviews ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS reschedule_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
