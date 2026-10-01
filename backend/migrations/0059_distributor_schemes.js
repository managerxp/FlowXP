/*
 * Distributor module, part 3: schemes and free quantity.
 *
 * A scheme is a standing offer the distributor (or the principal behind it) runs: buy X get Y free, a discount for
 * buying a quantity, or a discount for an order above a value. Eligibility is by date, customer type, named retailers
 * and territories; the system works out what applies to an order, so nobody has to remember.
 *
 * Free goods are ordinary order lines at price 0 (is_free, with the scheme that gave them): they reserve, pick, ship
 * and cost through the existing stock paths, and reports tell paid quantity from free quantity.
 *
 *   dist_schemes / dist_scheme_customers / dist_scheme_territories   the offers and who qualifies
 *   dist_scheme_applications                                          what each order got from which scheme (rewritten
 *                                                                     whenever the order's lines are saved)
 *   wholesale_sales_orders.scheme_discount_paise                      the part of the order discount a scheme gave
 *   wholesale_price_lists.territory_id (0057)                         territory pricing reads it
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE dist_schemes (
      scheme_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      kind VARCHAR(14) NOT NULL CHECK (kind IN ('BUY_X_GET_Y','QTY_DISCOUNT','VALUE_DISCOUNT')),
      principal_id INTEGER REFERENCES dist_principals(principal_id) ON DELETE SET NULL,
      funded_by VARCHAR(12) NOT NULL DEFAULT 'DISTRIBUTOR' CHECK (funded_by IN ('PRINCIPAL','DISTRIBUTOR')),
      buy_product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
      buy_brand_id INTEGER REFERENCES brands(brand_id) ON DELETE CASCADE,
      buy_category_id INTEGER REFERENCES categories(category_id) ON DELETE CASCADE,
      buy_principal_id INTEGER REFERENCES dist_principals(principal_id) ON DELETE CASCADE,
      buy_unit_name VARCHAR(24),
      buy_min_qty NUMERIC(14,3) CHECK (buy_min_qty IS NULL OR buy_min_qty > 0),
      min_value_paise BIGINT CHECK (min_value_paise IS NULL OR min_value_paise > 0),
      free_product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
      free_qty NUMERIC(14,3) CHECK (free_qty IS NULL OR free_qty > 0),
      free_unit_name VARCHAR(24),
      repeat BOOLEAN NOT NULL DEFAULT TRUE,
      max_free_qty NUMERIC(14,3) CHECK (max_free_qty IS NULL OR max_free_qty > 0),
      discount_pct NUMERIC(6,3) CHECK (discount_pct IS NULL OR (discount_pct > 0 AND discount_pct <= 100)),
      discount_paise BIGINT CHECK (discount_paise IS NULL OR discount_paise > 0),
      customer_types TEXT[],
      starts_on DATE,
      ends_on DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      stackable BOOLEAN NOT NULL DEFAULT FALSE,
      priority INTEGER NOT NULL DEFAULT 0,
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
      CHECK ((CASE WHEN buy_product_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN buy_brand_id IS NOT NULL THEN 1 ELSE 0 END)
           + (CASE WHEN buy_category_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN buy_principal_id IS NOT NULL THEN 1 ELSE 0 END) <= 1),
      CHECK (kind <> 'BUY_X_GET_Y' OR (buy_min_qty IS NOT NULL AND free_qty IS NOT NULL AND (free_product_id IS NOT NULL OR buy_product_id IS NOT NULL))),
      CHECK (kind <> 'QTY_DISCOUNT' OR (buy_min_qty IS NOT NULL AND discount_pct IS NOT NULL)),
      CHECK (kind <> 'VALUE_DISCOUNT' OR (min_value_paise IS NOT NULL AND (discount_pct IS NOT NULL OR discount_paise IS NOT NULL)))
    )
  `);
  await client.query(`CREATE INDEX idx_dist_scheme_live ON dist_schemes (business_id, is_active, starts_on, ends_on)`);
  await client.query(`
    CREATE TABLE dist_scheme_customers (
      scheme_id INTEGER NOT NULL REFERENCES dist_schemes(scheme_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      PRIMARY KEY (scheme_id, customer_id)
    )
  `);
  await client.query(`
    CREATE TABLE dist_scheme_territories (
      scheme_id INTEGER NOT NULL REFERENCES dist_schemes(scheme_id) ON DELETE CASCADE,
      territory_id INTEGER NOT NULL REFERENCES dist_territories(territory_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      PRIMARY KEY (scheme_id, territory_id)
    )
  `);
  await client.query(`
    CREATE TABLE dist_scheme_applications (
      application_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES wholesale_sales_orders(order_id) ON DELETE CASCADE,
      scheme_id INTEGER NOT NULL REFERENCES dist_schemes(scheme_id) ON DELETE CASCADE,
      free_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      free_base NUMERIC(14,3) NOT NULL DEFAULT 0,
      discount_paise BIGINT NOT NULL DEFAULT 0,
      cost_paise BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_dist_scheme_app_order ON dist_scheme_applications (order_id)`);
  await client.query(`CREATE INDEX idx_dist_scheme_app_scheme ON dist_scheme_applications (business_id, scheme_id)`);

  await client.query(`
    ALTER TABLE wholesale_sales_order_items
      ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS scheme_id INTEGER REFERENCES dist_schemes(scheme_id) ON DELETE SET NULL
  `);
  await client.query(`ALTER TABLE wholesale_sales_orders ADD COLUMN IF NOT EXISTS scheme_discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (scheme_discount_paise >= 0)`);
};

export const down = async (client) => {
  await client.query(`ALTER TABLE wholesale_sales_orders DROP COLUMN IF EXISTS scheme_discount_paise`);
  await client.query(`DELETE FROM wholesale_sales_order_items WHERE is_free`);
  await client.query(`ALTER TABLE wholesale_sales_order_items DROP COLUMN IF EXISTS scheme_id, DROP COLUMN IF EXISTS is_free`);
  await client.query(`DROP TABLE IF EXISTS dist_scheme_applications`);
  await client.query(`DROP TABLE IF EXISTS dist_scheme_territories`);
  await client.query(`DROP TABLE IF EXISTS dist_scheme_customers`);
  await client.query(`DROP TABLE IF EXISTS dist_schemes`);
};
