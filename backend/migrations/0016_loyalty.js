/*
 * Loyalty (visit card) and coupons.
 *
 * Loyalty: the owner sets "every Nth visit, this item is free". A customer is
 * identified by mobile number. Progress is never a stored counter: it is
 * derived from loyalty_events (one row per customer per day, VISIT or REDEEM,
 * voided when the invoice is cancelled), so a cancellation puts everything back
 * without any repair code.
 *
 * Coupons: a code with a rule (percent or flat), an optional minimum bill, a
 * validity window and usage limits. Each use is a coupon_redemptions row, also
 * voided on cancellation.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE loyalty_programs (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      -- the Nth visit earns the reward: visits_required = 7 means six stamps, then the seventh visit is free
      visits_required SMALLINT NOT NULL DEFAULT 7 CHECK (visits_required BETWEEN 2 AND 50),
      reward_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      reward_quantity SMALLINT NOT NULL DEFAULT 1 CHECK (reward_quantity BETWEEN 1 AND 10),
      -- a visit only counts when the bill is at least this much (0 = any bill)
      min_bill_paise BIGINT NOT NULL DEFAULT 0 CHECK (min_bill_paise >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE loyalty_events (
      event_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('VISIT','REDEEM')),
      visit_date DATE NOT NULL,
      amount_paise BIGINT NOT NULL DEFAULT 0,      -- value of the free item, for REDEEM
      voided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // One stamp (or reward) per customer per day, however many bills the table splits into.
  await client.query(`CREATE UNIQUE INDEX uq_loyalty_day ON loyalty_events (customer_id, visit_date) WHERE voided_at IS NULL`);
  await client.query(`CREATE INDEX idx_loyalty_events_invoice ON loyalty_events (invoice_id)`);
  await client.query(`CREATE INDEX idx_loyalty_events_business ON loyalty_events (business_id, created_at DESC)`);

  await client.query(`
    CREATE TABLE coupons (
      coupon_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      code VARCHAR(24) NOT NULL,
      description VARCHAR(160),
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('PERCENT','FLAT')),
      -- PERCENT: 10 = 10%; FLAT: paise
      value NUMERIC(12,2) NOT NULL CHECK (value > 0),
      min_bill_paise BIGINT NOT NULL DEFAULT 0 CHECK (min_bill_paise >= 0),
      max_discount_paise BIGINT CHECK (max_discount_paise IS NULL OR max_discount_paise > 0),
      valid_from DATE,
      valid_to DATE,
      max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
      max_uses_per_customer INTEGER CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (kind <> 'PERCENT' OR value <= 100)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_coupons_code ON coupons (business_id, upper(code))`);

  await client.query(`
    CREATE TABLE coupon_redemptions (
      redemption_id BIGSERIAL PRIMARY KEY,
      coupon_id INTEGER NOT NULL REFERENCES coupons(coupon_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      amount_paise BIGINT NOT NULL,
      voided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id) WHERE voided_at IS NULL`);
  await client.query(`CREATE INDEX idx_coupon_redemptions_invoice ON coupon_redemptions (invoice_id)`);

  // What an invoice's discount was made of, so reports and the leakage check can tell a coupon or a reward from a hand-given discount.
  await client.query(`ALTER TABLE invoices ADD COLUMN coupon_code VARCHAR(24)`);
  await client.query(`ALTER TABLE invoices ADD COLUMN coupon_discount_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN loyalty_discount_paise BIGINT NOT NULL DEFAULT 0`);

  // Look up a customer by mobile ignoring spaces, +91 and dashes.
  await client.query(`CREATE INDEX idx_customers_mobile ON customers (business_id, (RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10)))`);
};
