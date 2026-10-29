-- Back-dated stock: costs that depend on the average (sales, stock taken out, sales returned) are worked out again in date order whenever an earlier
-- movement is entered, so each one is costed at the average as it stood that day. The value of such a movement can therefore be corrected afterwards.
ALTER TABLE stock_moves ADD COLUMN costed BOOLEAN NOT NULL DEFAULT false;              -- valued at the running average (not at a price paid)
ALTER TABLE stock_moves ADD COLUMN reverses_move_id BIGINT REFERENCES stock_moves(id);  -- a VOID row points at the movement it undoes
UPDATE stock_moves SET costed = true WHERE source_type IN ('INVOICE', 'CREDIT_NOTE') OR (source_type = 'ADJUSTMENT' AND qty_milli < 0);
UPDATE stock_moves v SET reverses_move_id = o.id FROM stock_moves o
 WHERE v.source_type = 'VOID' AND o.document_id = v.document_id AND o.item_id = v.item_id AND o.source_type <> 'VOID';
GRANT UPDATE (value_minor) ON stock_moves TO flowbook_app;
