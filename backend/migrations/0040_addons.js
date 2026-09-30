/*
 * Paid add-ons (owner's request, 2026-09-29): "sell Reservations, Table QR,
 * Loyalty, Zomato/Swiggy, Flow AI as their own priced extras." Deliberately
 * built on what already exists rather than a parallel system:
 *   - the feature keys are the same ones in modules/planFeatures.js
 *   - paying one flips the SAME business_feature_overrides row an admin can
 *     already set by hand (migration 0039) — a paid add-on is just an
 *     override with a receipt behind it
 *   - `addon_orders` mirrors `subscription_orders` (migration 0034) exactly,
 *     down to the column names, since it's the same Cashfree Payment Links
 *     flow aimed at a smaller thing
 *
 * "AI-based review replies" was asked for too but isn't a real feature yet
 * (needs Google Business Profile API access — see brain.md's pending list),
 * so it is deliberately not in the seeded catalog: selling an add-on with
 * nothing behind it would be worse than not offering it.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS addons (
      addon_key VARCHAR(32) PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      description TEXT,
      price_monthly_paise BIGINT NOT NULL DEFAULT 0,
      price_yearly_paise BIGINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order SMALLINT NOT NULL DEFAULT 0
    )
  `);

  // Seeded at ₹0, same rule as plans: a wrong price on a sales call is worse than a blank one.
  await client.query(`
    INSERT INTO addons (addon_key, name, description, sort_order) VALUES
      ('reservations', 'Reservation link', 'Table bookings and the walk-in waitlist for a business whose plan doesn''t include it', 1),
      ('qr_ordering', 'Table QR ordering', 'Customers order from their phone by scanning a table QR code', 2),
      ('loyalty', 'Loyalty & rewards', 'Visit card, points and tiers, coupons', 3),
      ('integrations', 'Zomato / Swiggy integration', 'Delivery platform order sync and webhooks', 4),
      ('ai', 'Flow AI', 'The AI manager chat, briefings and menu-photo import', 5)
    ON CONFLICT (addon_key) DO NOTHING
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS addon_orders (
      order_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      addon_key VARCHAR(32) NOT NULL REFERENCES addons(addon_key),
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      billing_cycle VARCHAR(16) NOT NULL CHECK (billing_cycle IN ('MONTHLY','YEARLY')),
      link_id VARCHAR(80) UNIQUE,
      payment_link_url TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_addon_orders_business ON addon_orders (business_id, created_at DESC)`);
};
