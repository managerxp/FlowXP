-- Unit of measure (the GST "UQC" code) for items and lines, and recurring document templates.

ALTER TABLE items ADD COLUMN unit TEXT;
ALTER TABLE document_lines ADD COLUMN unit TEXT;

-- A template makes a DRAFT each time it falls due; a person still checks and issues it.
CREATE TABLE recurring_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK (kind IN ('INVOICE', 'BILL')),
  party_id BIGINT NOT NULL,
  every TEXT NOT NULL CHECK (every IN ('WEEK', 'MONTH', 'QUARTER', 'YEAR')),
  next_date DATE NOT NULL,
  end_date DATE,
  memo TEXT,
  lines JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  runs INT NOT NULL DEFAULT 0,
  last_document_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);

ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON recurring_templates USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_templates TO flowbook_app;
