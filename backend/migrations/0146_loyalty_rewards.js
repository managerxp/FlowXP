/*
 * Loyalty engine, phase 2: the rewards a programme offers, and each time a member claims one.
 * A reward costs points and is worth a stated value (a discount or the price of a free item). Claiming one spends the points through the same
 * ledger as everything else (one points_ledger row, idempotent), and loyalty_redemptions records what was claimed, where and by whom.
 * A claim is cancelled by a reversal in the ledger, and its redemption row is then marked CANCELLED: nothing is deleted.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE loyalty_rewards (
      reward_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      programme_id INTEGER NOT NULL REFERENCES loyalty_programmes(programme_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      points_cost INTEGER NOT NULL CHECK (points_cost > 0),
      value_paise BIGINT NOT NULL DEFAULT 0 CHECK (value_paise >= 0),          -- the discount, or the price of the free item
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,   -- a free item, when the reward is one
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      valid_from DATE,
      valid_to DATE,
      max_per_member INTEGER CHECK (max_per_member IS NULL OR max_per_member > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
    )
  `);
  await client.query(`CREATE INDEX idx_loyalty_rewards_programme ON loyalty_rewards (business_id, programme_id, is_active)`);

  await client.query(`
    CREATE TABLE loyalty_redemptions (
      redemption_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      membership_id INTEGER NOT NULL REFERENCES loyalty_memberships(membership_id) ON DELETE CASCADE,
      reward_id INTEGER NOT NULL REFERENCES loyalty_rewards(reward_id) ON DELETE CASCADE,
      ledger_entry_id INTEGER NOT NULL REFERENCES points_ledger(entry_id),
      points INTEGER NOT NULL CHECK (points > 0),
      value_paise BIGINT NOT NULL DEFAULT 0,
      branch_id INTEGER,
      invoice_id INTEGER,
      status VARCHAR(10) NOT NULL DEFAULT 'REDEEMED' CHECK (status IN ('REDEEMED','CANCELLED')),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (ledger_entry_id)
    )
  `);
  await client.query(`CREATE INDEX idx_loyalty_redemptions_member ON loyalty_redemptions (membership_id, reward_id, status)`);
  await client.query(`CREATE INDEX idx_loyalty_redemptions_business ON loyalty_redemptions (business_id, created_at)`);
};
