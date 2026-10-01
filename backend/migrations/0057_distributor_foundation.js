/*
 * Distributor module, part 1: the foundation.
 *
 * A distributor is a wholesaler with a principal above it and a field sales force below it, so this builds on the
 * wholesale tables (0052–0056) rather than beside them. What is new here:
 *
 *   - wholesale_settings.distributor_enabled   "Wholesale + Distributor" is a setting, not a second business type
 *   - dist_principals                          the manufacturers / brands the distributor represents. A principal is
 *                                              linked to an ordinary suppliers row, so purchase orders, goods receipts,
 *                                              payables and debit notes all work for it unchanged.
 *   - dist_territories, dist_beats             Region → Territory → Area, and a beat (a day's route) under an area
 *   - extensions on salespeople, customers, items, price lists, orders and receipts
 *
 * Every table carries business_id; every foreign key to another tenant-owned table is checked by the application
 * (all queries filter on business_id), and cascades with the business.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY',
                      'RECEPTIONIST','STYLIST','ACCOUNTANT',
                      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER',
                      'DISTRIBUTOR_ADMIN','FIELD_SALES','COLLECTION_EXECUTIVE','DELIVERY_MANAGER'))
  `);

  /* a rejected order is its own end state (the approver said no), distinct from one the salesperson cancelled */
  await client.query(`ALTER TABLE wholesale_sales_orders DROP CONSTRAINT IF EXISTS wholesale_sales_orders_status_check`);
  await client.query(`
    ALTER TABLE wholesale_sales_orders ADD CONSTRAINT wholesale_sales_orders_status_check
      CHECK (status IN ('DRAFT','PENDING','CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','PACKED','DISPATCHED','DELIVERED','CANCELLED','REJECTED'))
  `);
  /* a delivery can arrive in part: the customer took some of it and refused the rest */
  await client.query(`ALTER TABLE wholesale_deliveries DROP CONSTRAINT IF EXISTS wholesale_deliveries_status_check`);
  await client.query(`
    ALTER TABLE wholesale_deliveries ADD CONSTRAINT wholesale_deliveries_status_check
      CHECK (status IN ('PENDING','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','PARTIAL','FAILED','RETURNED'))
  `);

  await client.query(`
    ALTER TABLE wholesale_settings
      ADD COLUMN IF NOT EXISTS distributor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS scheme_stacking VARCHAR(8) NOT NULL DEFAULT 'BEST' CHECK (scheme_stacking IN ('BEST','ALL')),
      ADD COLUMN IF NOT EXISTS visit_location BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS field_collections BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS credit_manager_override BOOLEAN NOT NULL DEFAULT TRUE
  `);
  /* a DISTRIBUTOR business is always a distributor; existing ones get the features switched on */
  await client.query(`
    INSERT INTO wholesale_settings (business_id, distributor_enabled)
    SELECT business_id, TRUE FROM businesses WHERE business_type = 'DISTRIBUTOR'
    ON CONFLICT (business_id) DO UPDATE SET distributor_enabled = TRUE
  `);

  /* ── principals ───────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE dist_principals (
      principal_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL,
      company_name VARCHAR(160),
      contact_person VARCHAR(120),
      phone VARCHAR(32),
      email VARCHAR(160),
      gstin VARCHAR(15),
      pan VARCHAR(10),
      address TEXT,
      territory_note VARCHAR(200),
      agreement_start DATE,
      agreement_end DATE,
      margin_pct NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (margin_pct >= 0 AND margin_pct <= 100),
      payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR (payment_terms_days >= 0 AND payment_terms_days <= 365)),
      credit_limit_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (agreement_end IS NULL OR agreement_start IS NULL OR agreement_end >= agreement_start)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_principal_name ON dist_principals (business_id, lower(name))`);
  await client.query(`CREATE UNIQUE INDEX uq_dist_principal_supplier ON dist_principals (business_id, supplier_id) WHERE supplier_id IS NOT NULL`);
  await client.query(`ALTER TABLE brands ADD COLUMN IF NOT EXISTS principal_id INTEGER REFERENCES dist_principals(principal_id) ON DELETE SET NULL`);
  await client.query(`
    ALTER TABLE wholesale_item_details
      ADD COLUMN IF NOT EXISTS principal_id INTEGER REFERENCES dist_principals(principal_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS principal_price_paise BIGINT CHECK (principal_price_paise IS NULL OR principal_price_paise >= 0),
      ADD COLUMN IF NOT EXISTS pack_size VARCHAR(40)
  `);
  await client.query(`CREATE INDEX idx_dist_item_principal ON wholesale_item_details (business_id, principal_id) WHERE principal_id IS NOT NULL`);

  /* ── territories: REGION → TERRITORY → AREA ───────────────────────────── */
  await client.query(`
    CREATE TABLE dist_territories (
      territory_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES dist_territories(territory_id) ON DELETE RESTRICT,
      level VARCHAR(10) NOT NULL CHECK (level IN ('REGION','TERRITORY','AREA')),
      name VARCHAR(120) NOT NULL,
      code VARCHAR(20),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((level = 'REGION') = (parent_id IS NULL))
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_territory_name ON dist_territories (business_id, COALESCE(parent_id, 0), lower(name))`);
  await client.query(`CREATE INDEX idx_dist_territory_parent ON dist_territories (business_id, parent_id)`);

  await client.query(`ALTER TABLE wholesale_customer_profiles ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES dist_territories(territory_id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX idx_dist_cust_territory ON wholesale_customer_profiles (business_id, territory_id) WHERE territory_id IS NOT NULL`);
  await client.query(`ALTER TABLE wholesale_price_lists ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES dist_territories(territory_id) ON DELETE SET NULL`);

  await client.query(`
    ALTER TABLE wholesale_salespeople
      ADD COLUMN IF NOT EXISTS employee_id VARCHAR(40),
      ADD COLUMN IF NOT EXISTS sales_role VARCHAR(24) NOT NULL DEFAULT 'SALES_EXECUTIVE'
        CHECK (sales_role IN ('SALES_MANAGER','SALES_EXECUTIVE','FIELD_SALES','COLLECTION_EXECUTIVE','DELIVERY_EXECUTIVE')),
      ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES dist_territories(territory_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL
  `);

  /* ── beats: a day's route under an area ───────────────────────────────── */
  await client.query(`
    CREATE TABLE dist_beats (
      beat_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      territory_id INTEGER REFERENCES dist_territories(territory_id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL,
      weekday SMALLINT CHECK (weekday IS NULL OR (weekday >= 0 AND weekday <= 6)),   -- 0 = Sunday
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      notes VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_beat_name ON dist_beats (business_id, lower(name))`);
  await client.query(`CREATE INDEX idx_dist_beat_rep ON dist_beats (business_id, salesperson_id, weekday)`);
  await client.query(`
    CREATE TABLE dist_beat_customers (
      beat_id INTEGER NOT NULL REFERENCES dist_beats(beat_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (beat_id, customer_id)
    )
  `);
  await client.query(`CREATE INDEX idx_dist_beat_cust ON dist_beat_customers (business_id, customer_id)`);

  /* what a secondary sale knows about where it came from */
  await client.query(`
    ALTER TABLE wholesale_sales_orders
      ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES dist_territories(territory_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS beat_id INTEGER REFERENCES dist_beats(beat_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS source VARCHAR(8) NOT NULL DEFAULT 'OFFICE' CHECK (source IN ('OFFICE','FIELD','VAN')),
      ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reject_reason VARCHAR(200)
  `);
  await client.query(`CREATE INDEX idx_dist_orders_territory ON wholesale_sales_orders (business_id, territory_id, order_date) WHERE territory_id IS NOT NULL`);
  await client.query(`CREATE INDEX idx_dist_orders_rep ON wholesale_sales_orders (business_id, salesperson_id, order_date)`);
  await client.query(`CREATE INDEX idx_dist_meta_rep ON wholesale_invoice_meta (business_id, salesperson_id) WHERE salesperson_id IS NOT NULL`);
};

export const down = async (client) => {
  await client.query(`DROP INDEX IF EXISTS idx_dist_meta_rep`);
  await client.query(`DROP INDEX IF EXISTS idx_dist_orders_rep`);
  await client.query(`DROP INDEX IF EXISTS idx_dist_orders_territory`);
  await client.query(`ALTER TABLE wholesale_sales_orders DROP COLUMN IF EXISTS territory_id, DROP COLUMN IF EXISTS beat_id, DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS rejected_by, DROP COLUMN IF EXISTS reject_reason`);
  await client.query(`DROP TABLE IF EXISTS dist_beat_customers`);
  await client.query(`DROP TABLE IF EXISTS dist_beats`);
  await client.query(`ALTER TABLE wholesale_salespeople DROP COLUMN IF EXISTS employee_id, DROP COLUMN IF EXISTS sales_role, DROP COLUMN IF EXISTS territory_id, DROP COLUMN IF EXISTS manager_id`);
  await client.query(`ALTER TABLE wholesale_price_lists DROP COLUMN IF EXISTS territory_id`);
  await client.query(`DROP INDEX IF EXISTS idx_dist_cust_territory`);
  await client.query(`ALTER TABLE wholesale_customer_profiles DROP COLUMN IF EXISTS territory_id`);
  await client.query(`DROP TABLE IF EXISTS dist_territories`);
  await client.query(`DROP INDEX IF EXISTS idx_dist_item_principal`);
  await client.query(`ALTER TABLE wholesale_item_details DROP COLUMN IF EXISTS principal_id, DROP COLUMN IF EXISTS principal_price_paise, DROP COLUMN IF EXISTS pack_size`);
  await client.query(`ALTER TABLE brands DROP COLUMN IF EXISTS principal_id`);
  await client.query(`DROP TABLE IF EXISTS dist_principals`);
  await client.query(`
    ALTER TABLE wholesale_settings DROP COLUMN IF EXISTS distributor_enabled, DROP COLUMN IF EXISTS scheme_stacking, DROP COLUMN IF EXISTS visit_location,
      DROP COLUMN IF EXISTS field_collections, DROP COLUMN IF EXISTS credit_manager_override`);
  await client.query(`UPDATE wholesale_deliveries SET status = 'DELIVERED' WHERE status = 'PARTIAL'`);
  await client.query(`ALTER TABLE wholesale_deliveries DROP CONSTRAINT IF EXISTS wholesale_deliveries_status_check`);
  await client.query(`ALTER TABLE wholesale_deliveries ADD CONSTRAINT wholesale_deliveries_status_check CHECK (status IN ('PENDING','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','FAILED','RETURNED'))`);
  await client.query(`UPDATE wholesale_sales_orders SET status = 'CANCELLED' WHERE status = 'REJECTED'`);
  await client.query(`ALTER TABLE wholesale_sales_orders DROP CONSTRAINT IF EXISTS wholesale_sales_orders_status_check`);
  await client.query(`ALTER TABLE wholesale_sales_orders ADD CONSTRAINT wholesale_sales_orders_status_check CHECK (status IN ('DRAFT','PENDING','CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','PACKED','DISPATCHED','DELIVERED','CANCELLED'))`);
  await client.query(`UPDATE business_users SET role = 'STAFF' WHERE role IN ('DISTRIBUTOR_ADMIN','FIELD_SALES','COLLECTION_EXECUTIVE','DELIVERY_MANAGER')`);
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY','RECEPTIONIST','STYLIST','ACCOUNTANT',
                      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER'))
  `);
};
