/*
 * Bills put on hold at the till: a cashier parks a half-built bill to serve
 * the next customer, then resumes it, at this till or another one at the same
 * outlet. The bill is kept as the till built it (lines, customer, coupon,
 * note); nothing is charged, no stock moves and no invoice number is taken
 * until it is resumed and charged like any other bill.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE held_bills (
      hold_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      label VARCHAR(80),
      bill JSONB NOT NULL,
      item_count NUMERIC(12,3) NOT NULL DEFAULT 0,
      estimate_paise BIGINT NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_held_bills_outlet ON held_bills (business_id, branch_id, created_at)`);
};
