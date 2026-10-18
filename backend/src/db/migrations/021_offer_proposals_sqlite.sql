CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_active_candidate ON offers(candidate_id) WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT');
CREATE INDEX IF NOT EXISTS idx_offers_job_title ON offers(job_title_id);
