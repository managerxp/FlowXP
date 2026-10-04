/*
 * Salon module, part 2: things a client buys that are used later.
 *
 *   memberships   a plan (price, duration, benefits) and each client's own copy of it
 *   packages      a bundle of services at one price, consumed visit by visit
 *   gift cards    stored value, redeemed as a payment method at the till
 *   offers        automatic / conditional discounts (first visit, birthday, anniversary ...)
 *
 * A client's membership or package is a SNAPSHOT of the plan at the time of sale: editing a plan next month
 * never changes what someone already paid for. Usage rows are voided (never deleted) when an invoice is
 * cancelled, so the balance always follows the ledger.
 */
export const up = async (client) => {
  /* ── memberships ─────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_membership_plans (
      plan_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
      hsn_sac VARCHAR(16),
      duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3660),
      -- { discount_pct, discount_applies_to: ['SERVICE','PRODUCT'], free_services: [{ service_id, qty }],
      --   priority_booking, points_multiplier, perks: [text] }
      benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_membership_plans_business ON salon_membership_plans (business_id, is_active)`);

  await client.query(`
    CREATE TABLE salon_customer_memberships (
      membership_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES salon_membership_plans(plan_id) ON DELETE SET NULL,
      plan_name VARCHAR(80) NOT NULL,
      start_date DATE NOT NULL,
      expiry_date DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED')),
      price_paise BIGINT NOT NULL DEFAULT 0,
      benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      renewed_from INTEGER REFERENCES salon_customer_memberships(membership_id) ON DELETE SET NULL,
      reminder_sent_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (expiry_date >= start_date)
    )
  `);
  await client.query(`CREATE INDEX idx_salon_memberships_customer ON salon_customer_memberships (customer_id, status, expiry_date)`);
  await client.query(`CREATE INDEX idx_salon_memberships_expiry ON salon_customer_memberships (business_id, status, expiry_date)`);

  await client.query(`
    CREATE TABLE salon_membership_usage (
      usage_id SERIAL PRIMARY KEY,
      membership_id INTEGER NOT NULL REFERENCES salon_customer_memberships(membership_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('FREE_SERVICE','DISCOUNT')),
      service_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
      discount_paise BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_salon_membership_usage_m ON salon_membership_usage (membership_id) WHERE voided_at IS NULL`);
  await client.query(`CREATE INDEX idx_salon_membership_usage_invoice ON salon_membership_usage (invoice_id)`);

  /* ── packages ────────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_packages (
      package_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
      hsn_sac VARCHAR(16),
      validity_days INTEGER NOT NULL CHECK (validity_days BETWEEN 1 AND 3660),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_packages_business ON salon_packages (business_id, is_active)`);
  await client.query(`
    CREATE TABLE salon_package_items (
      package_id INTEGER NOT NULL REFERENCES salon_packages(package_id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES products(product_id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 500),
      PRIMARY KEY (package_id, service_id)
    )
  `);

  await client.query(`
    CREATE TABLE salon_customer_packages (
      cp_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      package_id INTEGER REFERENCES salon_packages(package_id) ON DELETE SET NULL,
      name VARCHAR(80) NOT NULL,
      purchased_on DATE NOT NULL,
      expiry_date DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED')),
      price_paise BIGINT NOT NULL DEFAULT 0,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_cpackages_customer ON salon_customer_packages (customer_id, status, expiry_date)`);
  await client.query(`
    CREATE TABLE salon_customer_package_items (
      cp_id INTEGER NOT NULL REFERENCES salon_customer_packages(cp_id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES products(product_id),
      qty_total INTEGER NOT NULL CHECK (qty_total > 0),
      qty_used INTEGER NOT NULL DEFAULT 0 CHECK (qty_used >= 0),
      PRIMARY KEY (cp_id, service_id),
      CHECK (qty_used <= qty_total)
    )
  `);
  await client.query(`
    CREATE TABLE salon_package_usage (
      usage_id SERIAL PRIMARY KEY,
      cp_id INTEGER NOT NULL REFERENCES salon_customer_packages(cp_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES products(product_id),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_salon_package_usage_invoice ON salon_package_usage (invoice_id)`);
  await client.query(`CREATE INDEX idx_salon_package_usage_cp ON salon_package_usage (cp_id)`);

  /* ── gift cards ──────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_gift_cards (
      card_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      code VARCHAR(20) NOT NULL,
      initial_paise BIGINT NOT NULL CHECK (initial_paise > 0),
      balance_paise BIGINT NOT NULL CHECK (balance_paise >= 0),
      expires_on DATE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_salon_gift_cards_code ON salon_gift_cards (business_id, code)`);
  await client.query(`CREATE INDEX idx_salon_gift_cards_customer ON salon_gift_cards (customer_id)`);
  await client.query(`
    CREATE TABLE salon_gift_card_txns (
      txn_id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES salon_gift_cards(card_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('ISSUE','REDEEM','REFUND','ADJUST')),
      amount_paise BIGINT NOT NULL,                 -- signed: issue / refund / upward adjust +, redeem -
      balance_after_paise BIGINT NOT NULL,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_gift_card_txns_card ON salon_gift_card_txns (card_id, txn_id)`);
  await client.query(`CREATE INDEX idx_salon_gift_card_txns_invoice ON salon_gift_card_txns (invoice_id)`);

  /* ── offers ──────────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE salon_offers (
      offer_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(300),
      code VARCHAR(24),
      discount_type VARCHAR(8) NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
      value NUMERIC(10,2) NOT NULL CHECK (value > 0),
      max_discount_paise BIGINT CHECK (max_discount_paise IS NULL OR max_discount_paise > 0),
      applies_to VARCHAR(10) NOT NULL DEFAULT 'ALL' CHECK (applies_to IN ('ALL','SERVICES','PRODUCTS')),
      -- when non-empty, only these service / product ids are discounted
      item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- { first_visit, birthday, anniversary, window_days, membership_plan_ids, customer_ids, min_bill_paise }
      conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      branch_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      starts_on DATE,
      ends_on DATE,
      usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
      per_customer_limit INTEGER CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
      auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
      CHECK (discount_type <> 'PERCENT' OR value <= 100)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_salon_offers_code ON salon_offers (business_id, upper(code)) WHERE code IS NOT NULL`);
  await client.query(`CREATE INDEX idx_salon_offers_business ON salon_offers (business_id, is_active)`);
  await client.query(`
    CREATE TABLE salon_offer_redemptions (
      redemption_id SERIAL PRIMARY KEY,
      offer_id INTEGER NOT NULL REFERENCES salon_offers(offer_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      amount_paise BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_salon_offer_redemptions_offer ON salon_offer_redemptions (offer_id) WHERE voided_at IS NULL`);
  await client.query(`CREATE INDEX idx_salon_offer_redemptions_invoice ON salon_offer_redemptions (invoice_id)`);
};

export const down = async (client) => {
  for (const t of ['salon_offer_redemptions', 'salon_offers', 'salon_gift_card_txns', 'salon_gift_cards', 'salon_package_usage',
    'salon_customer_package_items', 'salon_customer_packages', 'salon_package_items', 'salon_packages', 'salon_membership_usage',
    'salon_customer_memberships', 'salon_membership_plans']) {
    await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
};
