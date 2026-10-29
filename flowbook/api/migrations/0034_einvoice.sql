-- E-invoicing: what the government invoice registration portal (IRP) answered for an issued invoice or credit note (src/einvoice.ts).
-- FlowBook makes the file; the IRP numbers the invoice (the IRN) and signs it; we keep the answer here.
CREATE TABLE einvoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  document_id BIGINT NOT NULL,
  irn TEXT NOT NULL CHECK (irn ~ '^[0-9a-f]{64}$'),
  ack_no TEXT NOT NULL,
  ack_date TIMESTAMPTZ NOT NULL,
  signed_qr TEXT,
  status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'CANCELLED')),
  cancel_reason INT CHECK (cancel_reason IN (1, 2, 3, 4)),
  cancel_remark TEXT,
  cancelled_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX einvoices_live ON einvoices (organization_id, document_id) WHERE status = 'GENERATED';
CREATE UNIQUE INDEX einvoices_irn ON einvoices (organization_id, irn);
ALTER TABLE einvoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON einvoices USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON einvoices TO flowbook_app;
