-- Batches and serial numbers. An item can be counted plainly, by batch (batch number and optional expiry date, taken first-expiry-first-out unless you choose),
-- or by serial number (one row per unit). Cost stays one weighted average per item; batches and serials say which units, not what they cost.
ALTER TABLE items ADD COLUMN tracking TEXT NOT NULL DEFAULT 'NONE' CHECK (tracking IN ('NONE', 'BATCH', 'SERIAL'));
ALTER TABLE items ADD CONSTRAINT items_tracking_needs_stock CHECK (tracking = 'NONE' OR track_stock);
GRANT UPDATE (tracking) ON items TO flowbook_app;

ALTER TABLE stock_moves ADD COLUMN batch_no TEXT;
ALTER TABLE stock_moves ADD COLUMN expiry_date DATE;
ALTER TABLE stock_moves ADD COLUMN serial_no TEXT;
CREATE INDEX stock_moves_batch ON stock_moves (organization_id, item_id, batch_no) WHERE batch_no IS NOT NULL;
CREATE INDEX stock_moves_serial ON stock_moves (organization_id, item_id, serial_no) WHERE serial_no IS NOT NULL;
