-- ---- flats and plots sold in stages: a unit has a price, a buyer and a schedule of stages; each stage becomes an invoice when it is raised
CREATE TABLE project_units (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  party_id BIGINT,                       -- the buyer; null while the unit is still for sale
  tax_code TEXT NOT NULL DEFAULT 'GST0',
  sold_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, project_id, name),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);
CREATE TABLE unit_stages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  unit_id BIGINT NOT NULL,
  seq INT NOT NULL,
  name TEXT NOT NULL,
  share_bp INT NOT NULL CHECK (share_bp BETWEEN 1 AND 10000),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),   -- before GST
  due_date DATE,
  invoice_id BIGINT,
  UNIQUE (unit_id, seq),
  FOREIGN KEY (organization_id, unit_id) REFERENCES project_units (organization_id, id)
);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_units', 'unit_stages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON project_units, unit_stages TO flowbook_app;
