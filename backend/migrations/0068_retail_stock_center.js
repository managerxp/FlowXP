/*
 * Retail stock center (Phase 3).
 *
 *   products.track_expiry   opt-in per product: its stock is kept in dated batches and sold soonest-expiry first.
 *                           The batches themselves live in wholesale_batches (the table pharmacy already uses), so
 *                           there is one batch model, not two.
 *   stock_counts / _items   a stock take: items are counted (by scanning), compared with what the system held when
 *                           each was counted, and only on "apply" become ledger movements of type COUNT.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS track_expiry BOOLEAN NOT NULL DEFAULT FALSE`);

  await client.query(`ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check`);
  await client.query(`
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
      CHECK (transaction_type IN ('SALE','PURCHASE','ADJUSTMENT','RETURN','OPENING','WASTAGE','TRANSFER','PURCHASE_RETURN','COUNT'))`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS stock_counts (
      count_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      scope VARCHAR(10) NOT NULL DEFAULT 'FULL' CHECK (scope IN ('FULL','CATEGORY')),
      category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPLIED','CANCELLED')),
      note TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      applied_at TIMESTAMPTZ,
      lines_adjusted INTEGER,
      net_units NUMERIC(14,3),
      net_value_paise BIGINT
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_counts_biz ON stock_counts (business_id, status, created_at DESC)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS stock_count_items (
      count_id INTEGER NOT NULL REFERENCES stock_counts(count_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      system_qty NUMERIC(14,3) NOT NULL,
      counted_qty NUMERIC(14,3) NOT NULL CHECK (counted_qty >= 0),
      counted_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (count_id, product_id)
    )`);
};
