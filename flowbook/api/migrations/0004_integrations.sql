-- The FlowXP connection: who may send events, the events received (kept as they arrived), and the read-only copy of
-- each FlowXP document with the journal it produced (flowxp-integration-contract.md).

CREATE TABLE integration_connections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL CHECK (provider IN ('FLOWXP')),
  external_business_id TEXT NOT NULL,
  secret TEXT NOT NULL,
  previous_secret TEXT,
  previous_secret_until TIMESTAMPTZ,
  cutover_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (provider, external_business_id)
);

CREATE TABLE integration_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  connection_id BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INT NOT NULL,
  sequence TEXT,
  occurred_at TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'POSTED', 'IGNORED_CUTOVER', 'IGNORED_UNSUPPORTED', 'FAILED_VALIDATION', 'NEEDS_ATTENTION')),
  error TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  FOREIGN KEY (organization_id, connection_id) REFERENCES integration_connections (organization_id, id),
  UNIQUE (connection_id, event_id)
);
CREATE INDEX integration_events_status ON integration_events (organization_id, status, id DESC);

CREATE TABLE external_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  connection_id BIGINT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('sale', 'credit_note', 'payment')),
  source_id TEXT NOT NULL,
  number TEXT,
  doc_date DATE NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOID', 'REFERENCE')),
  journal_entry_id BIGINT,
  reversal_entry_id BIGINT,
  payload JSONB NOT NULL,
  FOREIGN KEY (organization_id, connection_id) REFERENCES integration_connections (organization_id, id),
  UNIQUE (connection_id, source_type, source_id)
);

-- the connection table is read before any organization is known (to find the secret that checks a signature), by the
-- owner role, so it is not forced; the application role is still held to its own organization
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON integration_connections USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                                               WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_events', 'external_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON integration_connections, integration_events, external_documents TO flowbook_app;
