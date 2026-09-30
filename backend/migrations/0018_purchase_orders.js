/*
 * Purchase orders as a lifecycle: DRAFT -> ORDERED (sent to the supplier) ->
 * RECEIVED (stock comes in) or CANCELLED.
 *
 * Until now a purchase was recorded only once the goods had arrived. Now an order
 * can exist before them: it moves no stock and no money until it is received, and
 * the received quantities and prices (what the delivery and its invoice actually
 * said) replace the ordered ones. Orders created directly as "received" keep
 * working exactly as before.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check`);
  await client.query(`ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('DRAFT','ORDERED','RECEIVED','CANCELLED'))`);
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN expected_date DATE`);
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN ordered_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN received_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN source VARCHAR(12) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','FORECAST'))`);
  await client.query(`UPDATE purchase_orders SET received_at = created_at WHERE status = 'RECEIVED'`);
  await client.query(`ALTER TABLE purchase_order_items ADD COLUMN received_quantity NUMERIC(14,3)`);
  await client.query(`UPDATE purchase_order_items i SET received_quantity = i.quantity FROM purchase_orders po WHERE po.po_id = i.po_id AND po.status = 'RECEIVED'`);
  await client.query(`CREATE INDEX idx_po_open ON purchase_orders (business_id, branch_id, status) WHERE status IN ('DRAFT','ORDERED')`);
};
