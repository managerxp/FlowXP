-- Unrealised exchange gain or loss: at a date, open foreign invoices and bills are restated at that day's rate. The entry is reversed the next day,
-- so the books carry it for the report date only and settlement still works from the original rupee amounts.
CREATE TABLE fx_revaluations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  as_of DATE NOT NULL,
  entry_id BIGINT NOT NULL,
  reversal_entry_id BIGINT,
  net_minor BIGINT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, as_of),
  FOREIGN KEY (organization_id, entry_id) REFERENCES journal_entries (organization_id, id)
);
ALTER TABLE fx_revaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_revaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON fx_revaluations USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON fx_revaluations TO flowbook_app;
GRANT USAGE ON SEQUENCE fx_revaluations_id_seq TO flowbook_app;
