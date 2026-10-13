/*
 * Automotive spare parts, part 4: holding parts for a customer, and trading with garages.
 *
 *   part_reservations              parts held for a customer or a special order. branch_stock.reserved_qty (and bin_stock.reserved_qty) carry the total; this is who and why
 *   autoparts_price_lists          a named trade price list: a % off the selling price, with per-part prices that win over the %
 *   autoparts_price_list_items     the per-part prices
 *   autoparts_customer_profiles    a customer's class (retail / workshop / garage / fleet / wholesale), price list, credit limit and what to do at the limit
 * Forward only.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE part_reservations (
      reservation_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      qty_fulfilled NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_fulfilled >= 0),
      status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FULFILLED','RELEASED','EXPIRED')),
      expires_on DATE,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMPTZ,
      CHECK (qty_fulfilled <= qty)
    )`);
  await client.query(`CREATE INDEX idx_part_res_open ON part_reservations (branch_id, product_id) WHERE status = 'OPEN'`);
  await client.query(`CREATE INDEX idx_part_res_customer ON part_reservations (customer_id) WHERE status = 'OPEN'`);

  await client.query(`
    CREATE TABLE autoparts_price_lists (
      price_list_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_ap_price_list_name ON autoparts_price_lists (business_id, lower(name))`);
  await client.query(`
    CREATE TABLE autoparts_price_list_items (
      price_list_id INTEGER NOT NULL REFERENCES autoparts_price_lists(price_list_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      PRIMARY KEY (price_list_id, product_id)
    )`);
  await client.query(`
    CREATE TABLE autoparts_customer_profiles (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(customer_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_class VARCHAR(10) NOT NULL DEFAULT 'RETAIL' CHECK (customer_class IN ('RETAIL','WORKSHOP','GARAGE','FLEET','WHOLESALE')),
      price_list_id INTEGER REFERENCES autoparts_price_lists(price_list_id) ON DELETE SET NULL,
      credit_limit_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
      credit_policy VARCHAR(5) NOT NULL DEFAULT 'WARN' CHECK (credit_policy IN ('OFF','WARN','BLOCK')),
      terms_days SMALLINT NOT NULL DEFAULT 0 CHECK (terms_days BETWEEN 0 AND 365),
      notes VARCHAR(300),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_ap_profile_business ON autoparts_customer_profiles (business_id)`);
};
