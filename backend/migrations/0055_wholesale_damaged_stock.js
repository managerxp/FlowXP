/*
 * Wholesale module, part 4: damaged stock.
 *
 * Damaged goods are not sellable but are not gone either: they wait for a supplier claim, a repair or a write-off.
 * A signed log (+ in when goods are found damaged, − out when they are returned to the supplier or written off) keeps
 * the quantity honest without a second stock column that could drift: damaged on hand = SUM(qty).
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE wholesale_damaged_log (
      log_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL CHECK (qty <> 0),
      source VARCHAR(16) NOT NULL CHECK (source IN ('GRN','TRANSFER','RETURN','ADJUST','WRITE_OFF','SUPPLIER_RETURN')),
      ref_type VARCHAR(24),
      ref_id INTEGER,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ws_damaged ON wholesale_damaged_log (business_id, branch_id, product_id)`);
  /* serial-tracked goods: the serial numbers a picker put on the pick list */
  await client.query(`ALTER TABLE wholesale_pick_items ADD COLUMN IF NOT EXISTS serials TEXT`);
};

export const down = async (client) => {
  await client.query(`ALTER TABLE wholesale_pick_items DROP COLUMN IF EXISTS serials`);
  await client.query(`DROP TABLE IF EXISTS wholesale_damaged_log`);
};
