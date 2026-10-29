-- Stock: goods you buy and sell are counted in and out, valued at weighted-average cost, and kept in step with the Inventory and Cost of goods sold accounts.

ALTER TABLE items ADD COLUMN track_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN reorder_level_milli BIGINT NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0);
ALTER TABLE items ADD CONSTRAINT items_stock_goods CHECK (NOT track_stock OR kind = 'GOODS');
GRANT UPDATE (track_stock, reorder_level_milli) ON items TO flowbook_app;

ALTER TABLE documents ADD COLUMN stock_entry_id BIGINT;   -- the cost-of-goods entry posted beside an invoice or credit note

-- Every change to the count. Signed: in is positive, out is negative; value has the same sign. Never edited; a mistake is undone by an opposite move.
CREATE TABLE stock_moves (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  item_id BIGINT NOT NULL,
  move_date DATE NOT NULL,
  qty_milli BIGINT NOT NULL CHECK (qty_milli <> 0),
  value_minor BIGINT NOT NULL CHECK (sign(value_minor) = sign(qty_milli) OR value_minor = 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('BILL', 'INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'ADJUSTMENT', 'VOID')),
  document_id BIGINT,
  journal_entry_id BIGINT,
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, item_id) REFERENCES items (organization_id, id)
);
CREATE INDEX stock_moves_item ON stock_moves (organization_id, item_id, id);
CREATE INDEX stock_moves_document ON stock_moves (organization_id, document_id);

ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_moves FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON stock_moves USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT ON stock_moves TO flowbook_app;
