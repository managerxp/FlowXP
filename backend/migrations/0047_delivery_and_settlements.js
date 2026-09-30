/*
 * Two pieces from the "Cloud Kitchen module" spec the owner asked to build
 * for real, after the earlier audit (2026-09-29, see brain.md):
 *
 * 1. Delivery rider assignment — reuses the business's own staff/RBAC
 *    (a new DELIVERY role) rather than a separate "DeliveryExecutive"
 *    entity, the same way orders.waiter_user_id already reuses `users`
 *    for waiters instead of a parallel table. Pickup/out-for-delivery/
 *    delivered are nullable timestamps, the same pattern order_items
 *    already uses for sent_at/ready_at/served_at, rather than a new status
 *    enum layered onto the existing order lifecycle.
 *
 * 2. Aggregator settlement reconciliation — real aggregator APIs need
 *    partner approval FlowXP doesn't have, so this is the spec's own
 *    documented fallback: "allow settlement statement import where API
 *    integration is unavailable" (§18). An owner pastes the statement
 *    Zomato/Swiggy/ONDC already gives them; FlowXP checks the statement's
 *    own arithmetic, cross-checks the order value against what it billed,
 *    and flags any of its own delivery orders with no matching line at all
 *    (paid nothing for an order it fulfilled).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY'))
  `);

  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS settlement_imports (
      import_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      platform VARCHAR(20) NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS settlement_lines (
      line_id BIGSERIAL PRIMARY KEY,
      import_id BIGINT NOT NULL REFERENCES settlement_imports(import_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      platform VARCHAR(20) NOT NULL,
      external_order_id VARCHAR(80) NOT NULL,
      settlement_date DATE,
      gross_amount_paise BIGINT NOT NULL DEFAULT 0,
      commission_paise BIGINT NOT NULL DEFAULT 0,
      payment_charges_paise BIGINT NOT NULL DEFAULT 0,
      delivery_charges_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      other_deductions_paise BIGINT NOT NULL DEFAULT 0,
      net_settled_paise BIGINT NOT NULL DEFAULT 0,
      order_id INTEGER REFERENCES orders(order_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_settlement_lines_business ON settlement_lines (business_id, platform, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_settlement_lines_order ON settlement_lines (order_id)`);
};
