/*
 * Field sales with no signal (see OFFLINE_FIRST.md). A rep's phone queues orders and receipts and sends them when it can, maybe days later, after the
 * 48-hour duplicate guard has forgotten the key. So each order and receipt keeps the key it arrived under, and the same key again returns the same
 * document instead of making a second one (the same way invoices keep theirs in invoices.client_key).
 *
 * The phone also keeps what a wholesale product is (carton sizes, minimum order, wholesale price) so it can show a price and quantity with no signal.
 * Those live in wholesale_item_details and wholesale_product_units, so a change there counts as a change to the product in the sync log (see 0074).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE wholesale_sales_orders ADD COLUMN IF NOT EXISTS client_key VARCHAR(80)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_wholesale_orders_client_key ON wholesale_sales_orders (business_id, client_key) WHERE client_key IS NOT NULL`);
  await client.query(`ALTER TABLE wholesale_receipts ADD COLUMN IF NOT EXISTS client_key VARCHAR(80)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_wholesale_receipts_client_key ON wholesale_receipts (business_id, client_key) WHERE client_key IS NOT NULL`);
  for (const table of ['wholesale_item_details', 'wholesale_product_units']) {
    await client.query(`DROP TRIGGER IF EXISTS trg_sync_log ON ${table}`);
    await client.query(`CREATE TRIGGER trg_sync_log AFTER INSERT OR UPDATE OR DELETE ON ${table}
                        FOR EACH ROW EXECUTE FUNCTION sync_log_change('product', 'product_id')`);
  }
};
