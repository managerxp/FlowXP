/*
 * Distributor module, part 2: the sales team.
 *
 *   dist_targets           what a salesperson / territory / brand / category / product / customer should sell in a period
 *   dist_commission_rules  how a sale earns commission: a % of value or margin, or an amount per unit, by scope
 *   dist_visits            a visit to a retailer on a beat: outcome, notes, next visit (idempotent by client_ref so a
 *                          visit recorded offline and replayed is still one visit)
 *
 * Achievement and commission are never stored: they are computed from the invoices, net of credit notes, so they can
 * never disagree with the books.
 */
export const up = async (client) => {
  /* 0052 allowed 'COLLECTIONS' in the check but sized the column for 10 characters */
  await client.query(`ALTER TABLE wholesale_salespeople ALTER COLUMN commission_on TYPE VARCHAR(16)`);
  await client.query(`
    CREATE TABLE dist_targets (
      target_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      scope_type VARCHAR(12) NOT NULL CHECK (scope_type IN ('BUSINESS','SALESPERSON','TERRITORY','BRAND','CATEGORY','PRODUCT','CUSTOMER')),
      scope_id INTEGER,
      period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      metric VARCHAR(6) NOT NULL DEFAULT 'VALUE' CHECK (metric IN ('VALUE','QTY')),
      target_amount NUMERIC(16,3) NOT NULL CHECK (target_amount > 0),   -- paise for VALUE, base units for QTY
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((scope_type = 'BUSINESS') = (scope_id IS NULL)),
      CHECK (period_end >= period_start)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_target ON dist_targets (business_id, scope_type, COALESCE(scope_id, 0), period_type, period_start, metric)`);
  await client.query(`CREATE INDEX idx_dist_target_period ON dist_targets (business_id, period_start, period_end)`);

  await client.query(`
    CREATE TABLE dist_commission_rules (
      rule_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      basis VARCHAR(8) NOT NULL CHECK (basis IN ('VALUE','QTY','MARGIN')),
      scope_type VARCHAR(10) NOT NULL DEFAULT 'ALL' CHECK (scope_type IN ('ALL','BRAND','PRODUCT','CATEGORY','TERRITORY','CUSTOMER')),
      scope_id INTEGER,
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE CASCADE,   -- NULL = every salesperson
      rate_pct NUMERIC(7,3) CHECK (rate_pct IS NULL OR (rate_pct >= 0 AND rate_pct <= 100)),
      per_unit_paise BIGINT CHECK (per_unit_paise IS NULL OR per_unit_paise >= 0),
      min_achievement_pct NUMERIC(6,2) CHECK (min_achievement_pct IS NULL OR min_achievement_pct >= 0),
      starts_on DATE,
      ends_on DATE,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((scope_type = 'ALL') = (scope_id IS NULL)),
      CHECK ((basis = 'QTY') = (per_unit_paise IS NOT NULL AND rate_pct IS NULL) OR (basis <> 'QTY' AND rate_pct IS NOT NULL)),
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
    )
  `);
  await client.query(`CREATE INDEX idx_dist_commission_rule ON dist_commission_rules (business_id, is_active)`);

  await client.query(`
    CREATE TABLE dist_visits (
      visit_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL,
      beat_id INTEGER REFERENCES dist_beats(beat_id) ON DELETE SET NULL,
      visit_date DATE NOT NULL,
      visited_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      outcome VARCHAR(14) NOT NULL CHECK (outcome IN ('ORDER','COLLECTION','NO_ORDER','CLOSED','NOT_AVAILABLE','FOLLOW_UP')),
      notes VARCHAR(500),
      next_visit_date DATE,
      lat NUMERIC(9,6),
      lng NUMERIC(9,6),
      client_ref VARCHAR(64),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_visit_ref ON dist_visits (business_id, client_ref) WHERE client_ref IS NOT NULL`);
  await client.query(`CREATE INDEX idx_dist_visit_rep ON dist_visits (business_id, salesperson_id, visit_date)`);
  await client.query(`CREATE INDEX idx_dist_visit_customer ON dist_visits (business_id, customer_id, visit_date DESC)`);

  await client.query(`ALTER TABLE wholesale_sales_orders ADD COLUMN IF NOT EXISTS visit_id INTEGER REFERENCES dist_visits(visit_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE wholesale_receipts ADD COLUMN IF NOT EXISTS visit_id INTEGER REFERENCES dist_visits(visit_id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_dist_orders_visit ON wholesale_sales_orders (visit_id) WHERE visit_id IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_dist_receipts_visit ON wholesale_receipts (visit_id) WHERE visit_id IS NOT NULL`);
  /* every sales report nets credit notes against the invoice line they came from */
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cn_items_invoice_item ON credit_note_items (invoice_item_id)`);
};

export const down = async (client) => {
  await client.query(`DROP INDEX IF EXISTS idx_cn_items_invoice_item`);
  await client.query(`DROP INDEX IF EXISTS idx_dist_receipts_visit`);
  await client.query(`DROP INDEX IF EXISTS idx_dist_orders_visit`);
  await client.query(`ALTER TABLE wholesale_receipts DROP COLUMN IF EXISTS visit_id`);
  await client.query(`ALTER TABLE wholesale_sales_orders DROP COLUMN IF EXISTS visit_id`);
  await client.query(`DROP TABLE IF EXISTS dist_visits`);
  await client.query(`DROP TABLE IF EXISTS dist_commission_rules`);
  await client.query(`DROP TABLE IF EXISTS dist_targets`);
};
