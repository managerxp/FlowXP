-- ---- retention: money held back on an issued bill or invoice until the work is accepted.
-- The document still sits in payables / receivables in full; only the part above retention can be settled.
ALTER TABLE documents ADD COLUMN retention_minor BIGINT NOT NULL DEFAULT 0 CHECK (retention_minor >= 0);
