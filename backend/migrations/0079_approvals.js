/*
 * Manager approval. A person with only the billing right (a cashier, a waiter) cannot cancel a bill or give a discount above the business's cap on their own:
 * a manager or the owner enters their PIN to allow it. This adds
 *   - the approver's PIN (stored hashed) on the user,
 *   - the business's two settings: the biggest manual discount staff may give without approval (percent of what is being sold) and whether cancelling a bill needs one,
 *   - a log of PIN attempts, so wrong guesses can be limited (a PIN has few possibilities, so five wrong tries lock the person for fifteen minutes).
 * Existing businesses start with a 20% cap and approval for cancels; the owner can change both.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_pin_hash TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_pin_set_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS discount_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (discount_cap_pct >= 0 AND discount_cap_pct <= 100)`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cancel_needs_approval BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS approval_attempts (
      attempt_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      ok BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_attempts_user ON approval_attempts (user_id, created_at DESC)`);
};
