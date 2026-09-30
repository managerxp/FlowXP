/*
 * Split bills, table transfer and merge.
 *
 * - order_items.invoice_id: an item is "billed" once it belongs to an invoice.
 *   The kitchen status is left alone — a dish can be paid for before it is out.
 * - invoices.order_id: an order can now produce several invoices (one per guest),
 *   so the link runs from the invoice to its order instead of one invoice_id on
 *   the order. orders.invoice_id stays as "the last invoice" for existing screens.
 * - orders.status MERGED / merged_into_order_id: a merged tab keeps its record
 *   but frees its table.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE order_items ADD COLUMN invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX idx_order_items_invoice ON order_items (invoice_id) WHERE invoice_id IS NOT NULL`);

  await client.query(`ALTER TABLE invoices ADD COLUMN order_id INTEGER REFERENCES orders(order_id) ON DELETE SET NULL`);
  await client.query(`UPDATE invoices i SET order_id = o.order_id FROM orders o WHERE o.invoice_id = i.invoice_id`);
  await client.query(`CREATE INDEX idx_invoices_order ON invoices (order_id) WHERE order_id IS NOT NULL`);
  // Items on already-billed orders belong to that order's invoice.
  await client.query(`UPDATE order_items oi SET invoice_id = o.invoice_id FROM orders o WHERE o.order_id = oi.order_id AND o.invoice_id IS NOT NULL AND oi.status <> 'CANCELLED'`);

  await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
  await client.query(`
    ALTER TABLE orders ADD CONSTRAINT orders_status_check
      CHECK (status IN ('OPEN','PREPARING','READY','SERVED','BILLED','CANCELLED','MERGED'))
  `);
  await client.query(`ALTER TABLE orders ADD COLUMN merged_into_order_id INTEGER REFERENCES orders(order_id) ON DELETE SET NULL`);

  // A merged tab no longer occupies its table.
  await client.query(`DROP INDEX IF EXISTS uq_orders_open_table`);
  await client.query(`
    CREATE UNIQUE INDEX uq_orders_open_table
      ON orders (table_id) WHERE table_id IS NOT NULL AND status NOT IN ('BILLED','CANCELLED','MERGED')
  `);
  await client.query(`DROP INDEX IF EXISTS idx_orders_table`);
  await client.query(`CREATE INDEX idx_orders_table ON orders (table_id) WHERE status NOT IN ('BILLED','CANCELLED','MERGED')`);
};
