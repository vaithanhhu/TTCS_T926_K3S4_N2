CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_response_token ON offers(response_token) WHERE response_token IS NOT NULL;
