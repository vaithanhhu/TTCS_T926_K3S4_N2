CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_active_candidate ON offers(candidate_id) WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT');
CREATE INDEX IF NOT EXISTS idx_offers_predecessor ON offers(predecessor_offer_id);
CREATE INDEX IF NOT EXISTS idx_offers_superseded_by ON offers(superseded_by_offer_id);
CREATE INDEX IF NOT EXISTS idx_offers_rejection_category ON offers(rejection_reason_category);
