-- WhatsApp: invoice, payment reminder and receipt messages. LINK mode opens a click-to-chat link for a person to press send;
-- CLOUD mode sends through the business's own Meta WhatsApp Cloud API number using approved templates.

ALTER TABLE parties ADD COLUMN whatsapp_opt_out BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE whatsapp_settings (
  organization_id BIGINT PRIMARY KEY REFERENCES organizations(id),
  mode TEXT NOT NULL DEFAULT 'LINK' CHECK (mode IN ('OFF', 'LINK', 'CLOUD')),
  phone_number_id TEXT,
  token_enc TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  auto_reminders BOOLEAN NOT NULL DEFAULT false,
  -- days from the due date: -3 is three days before, 0 is the day, 7 is a week late
  reminder_offsets INT[] NOT NULL DEFAULT '{-3,0,7,15}',
  template_invoice TEXT NOT NULL DEFAULT 'flowbook_invoice',
  template_reminder TEXT NOT NULL DEFAULT 'flowbook_payment_reminder',
  template_receipt TEXT NOT NULL DEFAULT 'flowbook_payment_received',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  party_id BIGINT NOT NULL,
  document_id BIGINT,
  payment_id BIGINT,
  kind TEXT NOT NULL CHECK (kind IN ('INVOICE', 'REMINDER', 'RECEIPT')),
  offset_days INT,
  auto BOOLEAN NOT NULL DEFAULT false,
  to_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'SKIPPED', 'OPENED')),
  error TEXT,
  provider_ref TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);
-- an automatic reminder is tried once per invoice and offset, whatever came of it; a person can resend by hand
CREATE UNIQUE INDEX whatsapp_auto_once ON whatsapp_messages (document_id, offset_days) WHERE auto;
CREATE INDEX whatsapp_by_document ON whatsapp_messages (organization_id, document_id, id DESC);

-- the settings are read across organizations by the reminder worker (the owner role), so they are not forced; the application role is held to its own organization
ALTER TABLE whatsapp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON whatsapp_settings USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON whatsapp_messages USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON whatsapp_settings, whatsapp_messages TO flowbook_app;
