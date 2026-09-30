/*
 * Salon module, part 3: commission, loyalty rules, stock batches, automation and the analytics view.
 *
 *   commissions      one row per commissionable invoice line, PENDING -> APPROVED -> PAID (or VOID when the
 *                    invoice is cancelled); a payout groups the approved rows it pays
 *   loyalty rules    points per Rs 100 by kind of line (services / products / packages / memberships),
 *                    layered on the existing points program and ledger
 *   stock batches    batch number and expiry for received stock; how much of a batch is left is derived from
 *                    current stock (oldest consumed first), so it can never drift from the stock ledger
 *   automations      which reminders are on, and a log that stops the same one going out twice
 *   salon_customer_stats   one row per customer of the numbers segments, churn and lifetime value are read from
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE salon_commission_payouts (
      payout_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      staff_id INTEGER NOT NULL REFERENCES salon_staff(staff_id),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      total_paise BIGINT NOT NULL CHECK (total_paise > 0),
      method VARCHAR(16) NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH','UPI','CARD','BANK_TRANSFER','OTHER')),
      reference VARCHAR(80),
      note VARCHAR(200),
      expense_id INTEGER REFERENCES expenses(expense_id) ON DELETE SET NULL,
      paid_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_payouts_staff ON salon_commission_payouts (business_id, staff_id, paid_at DESC)`);

  await client.query(`
    CREATE TABLE salon_commissions (
      commission_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id),
      staff_id INTEGER NOT NULL REFERENCES salon_staff(staff_id),
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      invoice_item_id INTEGER REFERENCES invoice_items(item_id) ON DELETE SET NULL,
      line_type VARCHAR(16) NOT NULL,
      base_paise BIGINT NOT NULL,
      rate_type VARCHAR(8) NOT NULL CHECK (rate_type IN ('PERCENT','FIXED')),
      rate NUMERIC(10,2) NOT NULL,
      amount_paise BIGINT NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','PAID','VOID')),
      earned_on DATE NOT NULL,
      approved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      payout_id INTEGER REFERENCES salon_commission_payouts(payout_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_commissions_staff ON salon_commissions (business_id, staff_id, status, earned_on)`);
  await client.query(`CREATE INDEX idx_salon_commissions_invoice ON salon_commissions (invoice_id)`);
  await client.query(`CREATE INDEX idx_salon_commissions_period ON salon_commissions (business_id, earned_on)`);

  // A salary / commission expense can name the person it was for.
  await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES salon_staff(staff_id) ON DELETE SET NULL`);

  await client.query(`
    CREATE TABLE salon_loyalty_rules (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('SERVICE','PRODUCT','PACKAGE','MEMBERSHIP')),
      -- points per Rs 100; NULL = the program's own rate
      earn_per_100 NUMERIC(6,2) CHECK (earn_per_100 IS NULL OR (earn_per_100 >= 0 AND earn_per_100 <= 100)),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (business_id, item_type)
    )
  `);

  await client.query(`
    CREATE TABLE salon_stock_batches (
      batch_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      batch_no VARCHAR(40),
      expiry_date DATE,
      qty_received NUMERIC(14,3) NOT NULL CHECK (qty_received > 0),
      unit_cost_paise BIGINT,
      received_on DATE NOT NULL DEFAULT CURRENT_DATE,
      source VARCHAR(16) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','PURCHASE','OPENING','TRANSFER')),
      reference_id INTEGER,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_salon_batches_product ON salon_stock_batches (branch_id, product_id, expiry_date)`);
  await client.query(`CREATE INDEX idx_salon_batches_expiry ON salon_stock_batches (business_id, expiry_date) WHERE expiry_date IS NOT NULL`);

  await client.query(`
    CREATE TABLE salon_automations (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      automation_key VARCHAR(32) NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (business_id, automation_key)
    )
  `);
  await client.query(`
    CREATE TABLE salon_automation_log (
      log_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      automation_key VARCHAR(32) NOT NULL,
      related_type VARCHAR(24) NOT NULL,
      related_id INTEGER NOT NULL,
      run_on DATE NOT NULL,
      outcome VARCHAR(16) NOT NULL DEFAULT 'SENT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, automation_key, related_type, related_id, run_on)
    )
  `);

  // Phone lookups at the till: the last ten digits, indexed per business.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customers_phone10
      ON customers (business_id, (RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10)))
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_branch_date ON invoices (business_id, branch_id, invoice_date DESC)`);

  /* The facts every retention and lifetime-value question is asked of, in one place. Read by segments, the
     dashboard and reports now; a future churn or recommendation model reads the same view. */
  await client.query(`
    CREATE VIEW salon_customer_stats AS
    SELECT c.business_id, c.customer_id,
           COUNT(i.invoice_id) FILTER (WHERE i.status = 'ISSUED')                              AS visits,
           COALESCE(SUM(i.total_paise) FILTER (WHERE i.status = 'ISSUED'), 0)                  AS spend_paise,
           MIN(i.invoice_date) FILTER (WHERE i.status = 'ISSUED')                              AS first_visit,
           MAX(i.invoice_date) FILTER (WHERE i.status = 'ISSUED')                              AS last_visit
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.customer_id
    GROUP BY c.business_id, c.customer_id
  `);
};

export const down = async (client) => {
  await client.query(`DROP VIEW IF EXISTS salon_customer_stats`);
  for (const t of ['salon_automation_log', 'salon_automations', 'salon_stock_batches', 'salon_loyalty_rules',
    'salon_commissions', 'salon_commission_payouts']) {
    await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
  await client.query(`ALTER TABLE expenses DROP COLUMN IF EXISTS staff_id`);
};
