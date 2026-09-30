/*
 * Loyalty points and tiers, alongside the visit card.
 *
 * A customer earns points on every bill (points per Rs 100 paid, times their tier's multiplier) and
 * can spend them as a discount on a later bill. The ledger is the truth: the balance is the sum of
 * its live rows, so a cancelled bill simply voids its rows and everything follows. A tier is decided
 * by the points a customer has earned over their life (spending points never demotes them).
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE points_programs (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      earn_per_100 NUMERIC(6,2) NOT NULL DEFAULT 5 CHECK (earn_per_100 > 0 AND earn_per_100 <= 100),   -- points earned per Rs 100 paid
      point_value_paise INTEGER NOT NULL DEFAULT 100 CHECK (point_value_paise BETWEEN 1 AND 100000),    -- what one point is worth
      min_redeem_points INTEGER NOT NULL DEFAULT 50 CHECK (min_redeem_points >= 1),
      max_redeem_pct SMALLINT NOT NULL DEFAULT 50 CHECK (max_redeem_pct BETWEEN 1 AND 100),           -- most of one bill points may pay for
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE points_tiers (
      tier_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(30) NOT NULL,
      min_points INTEGER NOT NULL CHECK (min_points >= 0),          -- lifetime points needed
      multiplier NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (multiplier >= 1 AND multiplier <= 10),
      UNIQUE (business_id, min_points)
    )
  `);

  await client.query(`
    CREATE TABLE points_ledger (
      entry_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL,
      invoice_id INTEGER,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('EARN','REDEEM','ADJUST','REVERSAL')),
      points INTEGER NOT NULL CHECK (points <> 0),                   -- signed: earning is +, spending and reversals are -
      amount_paise BIGINT NOT NULL DEFAULT 0,                        -- the bill it was earned on, or the discount it paid for
      note VARCHAR(200),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_points_ledger_customer ON points_ledger (customer_id, entry_id) WHERE voided_at IS NULL`);
  await client.query(`CREATE INDEX idx_points_ledger_invoice ON points_ledger (invoice_id) WHERE invoice_id IS NOT NULL`);
  await client.query(`CREATE INDEX idx_points_ledger_business ON points_ledger (business_id, created_at)`);

  await client.query(`ALTER TABLE invoices ADD COLUMN points_discount_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0`);
};
