/*
 * Custom-priced subscription payments via Cashfree Payment Links.
 *
 * There is no fixed public price list a business self-serves from (Option B,
 * owner's call, 2026-09-28): the super admin sets a price for one business and
 * generates a Cashfree hosted payment link for it. One row per link generated;
 * a business can have several over time (a failed/expired one, then a fresh
 * one). `link_id` is the id FlowXP itself chooses and sends to Cashfree, so
 * the webhook that reports back on it can be matched straight to this row
 * without a second call to Cashfree.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS subscription_orders (
      order_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      billing_cycle VARCHAR(16) NOT NULL CHECK (billing_cycle IN ('MONTHLY','YEARLY')),
      plan_code VARCHAR(32),
      link_id VARCHAR(80) UNIQUE,
      payment_link_url TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_subscription_orders_business ON subscription_orders (business_id, created_at DESC)`);
};
