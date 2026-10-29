-- Warehouses: where the stock is kept. Cost is still one weighted average per item across all of them; a warehouse only splits the quantity.
CREATE TABLE warehouses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_default BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX warehouses_name ON warehouses (organization_id, lower(name));
CREATE UNIQUE INDEX warehouses_one_default ON warehouses (organization_id) WHERE is_default;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON warehouses USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON warehouses TO flowbook_app;

INSERT INTO warehouses (organization_id, name, is_default) SELECT id, 'Main', true FROM organizations;

ALTER TABLE stock_moves ADD COLUMN warehouse_id BIGINT;
UPDATE stock_moves m SET warehouse_id = (SELECT w.id FROM warehouses w WHERE w.organization_id = m.organization_id AND w.is_default);
ALTER TABLE stock_moves ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE stock_moves ADD FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses (organization_id, id);
CREATE INDEX stock_moves_warehouse ON stock_moves (organization_id, warehouse_id, item_id);

-- moving stock from one warehouse to another: an out and an in of the same value, no journal
ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_source_type_check;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_source_type_check CHECK (source_type IN ('BILL', 'INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'ADJUSTMENT', 'VOID', 'TRANSFER'));

ALTER TABLE documents ADD COLUMN warehouse_id BIGINT;   -- where the goods on this document come from or go to; empty means the default warehouse
ALTER TABLE documents ADD FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses (organization_id, id);
