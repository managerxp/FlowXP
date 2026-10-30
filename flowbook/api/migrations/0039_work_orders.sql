-- ---- work orders and running-account (RA) bills: a contract with quantities and rates, billed in stages by measuring the work done to date.
-- side PAYABLE = work a subcontractor does for you (an RA bill from them is a purchase bill); RECEIVABLE = work you do for a client (an RA bill to them is a sales invoice).
CREATE TABLE work_orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  party_id BIGINT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('PAYABLE', 'RECEIVABLE')),
  title TEXT NOT NULL,
  tax_code TEXT NOT NULL DEFAULT 'GST18',
  retention_bp INT NOT NULL DEFAULT 0 CHECK (retention_bp BETWEEN 0 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);
CREATE TABLE work_order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL,
  seq INT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT,
  qty_milli BIGINT NOT NULL CHECK (qty_milli > 0),
  rate_minor BIGINT NOT NULL CHECK (rate_minor >= 0),
  UNIQUE (work_order_id, seq),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, work_order_id) REFERENCES work_orders (organization_id, id)
);
CREATE TABLE ra_bills (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL,
  seq INT NOT NULL,
  bill_date DATE NOT NULL,
  document_id BIGINT NOT NULL,
  UNIQUE (work_order_id, seq),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, work_order_id) REFERENCES work_orders (organization_id, id)
);
-- the work measured up to this bill, per item (cumulative, so each bill bills only the difference from the one before)
CREATE TABLE ra_bill_lines (
  organization_id BIGINT NOT NULL,
  ra_bill_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  cum_qty_milli BIGINT NOT NULL CHECK (cum_qty_milli >= 0),
  PRIMARY KEY (ra_bill_id, item_id),
  FOREIGN KEY (organization_id, ra_bill_id) REFERENCES ra_bills (organization_id, id),
  FOREIGN KEY (organization_id, item_id) REFERENCES work_order_items (organization_id, id)
);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_orders', 'work_order_items', 'ra_bills', 'ra_bill_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON work_orders, work_order_items, ra_bills, ra_bill_lines TO flowbook_app;
