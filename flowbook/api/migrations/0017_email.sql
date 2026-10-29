-- Email: each business sends from its own mailbox (SMTP), so mail comes from their address and their provider's limits apply.

CREATE TABLE email_settings (
  organization_id BIGINT PRIMARY KEY REFERENCES organizations(id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  host TEXT,
  port INT NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
  secure BOOLEAN NOT NULL DEFAULT false,
  username TEXT,
  password_enc TEXT,
  from_name TEXT,
  from_email TEXT,
  reply_to TEXT,
  bcc_self BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  party_id BIGINT NOT NULL,
  document_id BIGINT,
  payment_id BIGINT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED')),
  error TEXT,
  provider_ref TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);
CREATE INDEX email_by_document ON email_messages (organization_id, document_id, id DESC);

ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON email_settings USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON email_messages USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON email_settings, email_messages TO flowbook_app;
