/*
 * Wholesale module, part 1: the foundation.
 *
 * FlowXP already has tenants, outlets with per-outlet stock (a warehouse IS an outlet), products, customers,
 * suppliers, purchase orders, the billing engine, credit/debit notes, payments and expenses. A wholesaler reuses all
 * of it. This migration adds only what has no generic home:
 *
 *   - widening checks (roles, payment method CHEQUE)
 *   - categories.parent_id (subcategories); branch_stock.reserved_qty (stock promised to open orders)
 *   - invoice_items.unit_name / unit_factor (a carton line moves 288 pieces of stock, at the carton's price)
 *   - wholesale_settings (one row per business)
 *   - wholesale_item_details (the wholesale half of a product) and wholesale_product_units (carton = 24 boxes ...)
 *   - price lists and their rules (product / category, quantity breaks, dates, customer-specific lists)
 *   - wholesale_customer_profiles and wholesale_supplier_profiles (type, terms, addresses, opening balance)
 *   - wholesale_salespeople
 *   - warehouses (extension of branches), bin locations and the default bin of a product
 *   - batches (expiry, FEFO) and serial numbers
 *
 * Every table carries business_id (tenant). Money is integer paise, quantities are numeric in BASE units of the
 * product (the unit stock is kept in); a selling unit is a multiple of the base unit.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check
      CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY',
                      'RECEPTIONIST','STYLIST','ACCOUNTANT',
                      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER'))
  `);
  await client.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check`);
  await client.query(`
    ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check
      CHECK (payment_method IN ('CASH','UPI','CARD','BANK_TRANSFER','CREDIT','OTHER','WALLET','GIFT_CARD','CHEQUE'))
  `);

  await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE branch_stock ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC(14,3) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_name VARCHAR(24), ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1`);

  /* one counter per business per document kind: SO, PK, CH, TR, GRN, RC, RT ... */
  await client.query(`
    CREATE TABLE wholesale_counters (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL,
      next_number INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (business_id, kind)
    )
  `);

  /* ── settings ────────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE wholesale_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      credit_policy VARCHAR(8) NOT NULL DEFAULT 'WARN' CHECK (credit_policy IN ('OFF','WARN','BLOCK')),
      block_when_overdue BOOLEAN NOT NULL DEFAULT FALSE,
      overdue_grace_days INTEGER NOT NULL DEFAULT 0 CHECK (overdue_grace_days BETWEEN 0 AND 365),
      default_payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (default_payment_terms_days BETWEEN 0 AND 365),
      default_price_list_id INTEGER,
      negative_stock VARCHAR(8) NOT NULL DEFAULT 'BLOCK' CHECK (negative_stock IN ('BLOCK','ALLOW')),
      reserve_on_confirm BOOLEAN NOT NULL DEFAULT TRUE,
      fefo BOOLEAN NOT NULL DEFAULT TRUE,
      expiry_alert_days JSONB NOT NULL DEFAULT '[30,60,90]',
      order_approval_over_paise BIGINT CHECK (order_approval_over_paise IS NULL OR order_approval_over_paise > 0),
      slow_moving_days INTEGER NOT NULL DEFAULT 60 CHECK (slow_moving_days BETWEEN 7 AND 730),
      dead_stock_days INTEGER NOT NULL DEFAULT 180 CHECK (dead_stock_days BETWEEN 30 AND 1460),
      order_prefix VARCHAR(8) NOT NULL DEFAULT 'SO',
      invoice_footer VARCHAR(300),
      notifications JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* ── product master extension ────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE wholesale_item_details (
      product_id INTEGER PRIMARY KEY REFERENCES products(product_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      subcategory_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
      manufacturer VARCHAR(120),
      mrp_paise BIGINT CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
      distributor_price_paise BIGINT CHECK (distributor_price_paise IS NULL OR distributor_price_paise >= 0),
      wholesale_price_paise BIGINT CHECK (wholesale_price_paise IS NULL OR wholesale_price_paise >= 0),
      retailer_price_paise BIGINT CHECK (retailer_price_paise IS NULL OR retailer_price_paise >= 0),
      moq NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (moq > 0),
      max_stock NUMERIC(14,3) CHECK (max_stock IS NULL OR max_stock >= 0),
      batch_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      expiry_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      serial_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      sale_unit VARCHAR(24),
      purchase_unit VARCHAR(24),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_product_units (
      unit_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      unit_name VARCHAR(24) NOT NULL,
      factor NUMERIC(14,4) NOT NULL CHECK (factor > 0),
      barcode VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_units_name ON wholesale_product_units (product_id, lower(unit_name))`);
  await client.query(`CREATE INDEX idx_ws_units_barcode ON wholesale_product_units (business_id, barcode) WHERE barcode IS NOT NULL`);

  /* ── price lists ─────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE wholesale_price_lists (
      list_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      kind VARCHAR(10) NOT NULL DEFAULT 'STANDARD' CHECK (kind IN ('STANDARD','PROMOTION')),
      customer_type VARCHAR(12),
      starts_on DATE,
      ends_on DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_price_list_name ON wholesale_price_lists (business_id, lower(name))`);
  await client.query(`
    CREATE TABLE wholesale_price_list_items (
      item_id SERIAL PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES wholesale_price_lists(list_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(category_id) ON DELETE CASCADE,
      unit_name VARCHAR(24),
      min_qty NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
      price_paise BIGINT CHECK (price_paise IS NULL OR price_paise >= 0),
      discount_pct NUMERIC(5,2) CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100)),
      CHECK ((product_id IS NOT NULL) <> (category_id IS NOT NULL)),
      CHECK ((price_paise IS NOT NULL) <> (discount_pct IS NOT NULL))
    )
  `);
  await client.query(`CREATE INDEX idx_ws_pli_list ON wholesale_price_list_items (list_id)`);
  await client.query(`CREATE INDEX idx_ws_pli_product ON wholesale_price_list_items (business_id, product_id) WHERE product_id IS NOT NULL`);
  await client.query(`ALTER TABLE wholesale_settings ADD CONSTRAINT fk_ws_default_list FOREIGN KEY (default_price_list_id) REFERENCES wholesale_price_lists(list_id) ON DELETE SET NULL`);

  /* ── people ──────────────────────────────────────────────────────────── */
  await client.query(`
    CREATE TABLE wholesale_salespeople (
      salesperson_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(32),
      email VARCHAR(160),
      territory VARCHAR(120),
      commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
      commission_on VARCHAR(10) NOT NULL DEFAULT 'SALES' CHECK (commission_on IN ('SALES','COLLECTIONS')),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_customer_profiles (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(customer_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_type VARCHAR(12) NOT NULL DEFAULT 'RETAILER' CHECK (customer_type IN ('RETAILER','DEALER','DISTRIBUTOR','BUSINESS','CORPORATE','OTHER')),
      contact_person VARCHAR(120),
      pan VARCHAR(10),
      billing_address TEXT,
      shipping_address TEXT,
      city VARCHAR(80),
      shipping_city VARCHAR(80),
      shipping_state VARCHAR(80),
      shipping_pincode VARCHAR(6),
      payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365),
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL,
      price_list_id INTEGER REFERENCES wholesale_price_lists(list_id) ON DELETE SET NULL,
      default_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_discount_pct BETWEEN 0 AND 100),
      opening_balance_paise BIGINT NOT NULL DEFAULT 0,
      credit_policy VARCHAR(8) CHECK (credit_policy IS NULL OR credit_policy IN ('OFF','WARN','BLOCK')),
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ws_cust_salesperson ON wholesale_customer_profiles (business_id, salesperson_id)`);
  await client.query(`
    CREATE TABLE wholesale_customer_prices (
      price_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(category_id) ON DELETE CASCADE,
      unit_name VARCHAR(24),
      min_qty NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
      price_paise BIGINT CHECK (price_paise IS NULL OR price_paise >= 0),
      discount_pct NUMERIC(5,2) CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100)),
      starts_on DATE,
      ends_on DATE,
      CHECK ((product_id IS NOT NULL) <> (category_id IS NOT NULL)),
      CHECK ((price_paise IS NOT NULL) <> (discount_pct IS NOT NULL))
    )
  `);
  await client.query(`CREATE INDEX idx_ws_custprice ON wholesale_customer_prices (business_id, customer_id)`);
  await client.query(`
    CREATE TABLE wholesale_supplier_profiles (
      supplier_id INTEGER PRIMARY KEY REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      contact_person VARCHAR(120),
      pan VARCHAR(10),
      city VARCHAR(80),
      state VARCHAR(80),
      pincode VARCHAR(6),
      payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365),
      opening_balance_paise BIGINT NOT NULL DEFAULT 0,
      bank_details VARCHAR(300),
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* ── warehouses, bins, batches, serials ──────────────────────────────── */
  await client.query(`
    CREATE TABLE wholesale_warehouses (
      branch_id INTEGER PRIMARY KEY REFERENCES branches(branch_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      manager_name VARCHAR(120),
      manager_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      phone VARCHAR(32),
      is_dispatch BOOLEAN NOT NULL DEFAULT TRUE,
      notes VARCHAR(300)
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_locations (
      location_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      code VARCHAR(24) NOT NULL,
      description VARCHAR(120),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_loc_code ON wholesale_locations (branch_id, lower(code))`);
  await client.query(`
    CREATE TABLE wholesale_bin_assignments (
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES wholesale_locations(location_id) ON DELETE CASCADE,
      PRIMARY KEY (branch_id, product_id)
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_batches (
      batch_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      batch_no VARCHAR(40) NOT NULL,
      mfg_date DATE,
      expiry_date DATE,
      qty_on_hand NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
      cost_paise BIGINT,
      received_on DATE NOT NULL DEFAULT CURRENT_DATE,
      source VARCHAR(12) NOT NULL DEFAULT 'GRN' CHECK (source IN ('GRN','OPENING','TRANSFER','RETURN','ADJUST')),
      ref_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_batch_key ON wholesale_batches (branch_id, product_id, lower(batch_no))`);
  await client.query(`CREATE INDEX idx_ws_batch_fefo ON wholesale_batches (branch_id, product_id, expiry_date NULLS LAST, batch_id) WHERE qty_on_hand > 0`);
  await client.query(`CREATE INDEX idx_ws_batch_expiry ON wholesale_batches (business_id, expiry_date) WHERE qty_on_hand > 0 AND expiry_date IS NOT NULL`);
  await client.query(`
    CREATE TABLE wholesale_batch_moves (
      move_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      batch_id BIGINT NOT NULL REFERENCES wholesale_batches(batch_id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL,
      ref_type VARCHAR(24) NOT NULL,
      ref_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_ws_batch_moves ON wholesale_batch_moves (batch_id)`);
  await client.query(`CREATE INDEX idx_ws_batch_moves_ref ON wholesale_batch_moves (ref_type, ref_id)`);
  await client.query(`
    CREATE TABLE wholesale_serials (
      serial_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      serial_no VARCHAR(64) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','SOLD','RETURNED','DAMAGED')),
      ref_type VARCHAR(24),
      ref_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_serial ON wholesale_serials (business_id, product_id, lower(serial_no))`);
};

export const down = async (client) => {
  for (const t of ['wholesale_counters', 'wholesale_serials', 'wholesale_batch_moves', 'wholesale_batches', 'wholesale_bin_assignments', 'wholesale_locations',
    'wholesale_warehouses', 'wholesale_supplier_profiles', 'wholesale_customer_prices', 'wholesale_customer_profiles', 'wholesale_salespeople',
    'wholesale_price_list_items']) await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  await client.query(`ALTER TABLE wholesale_settings DROP CONSTRAINT IF EXISTS fk_ws_default_list`);
  await client.query(`DROP TABLE IF EXISTS wholesale_price_lists CASCADE`);
  for (const t of ['wholesale_product_units', 'wholesale_item_details', 'wholesale_settings']) await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  await client.query(`ALTER TABLE invoice_items DROP COLUMN IF EXISTS unit_name, DROP COLUMN IF EXISTS unit_factor`);
  await client.query(`ALTER TABLE branch_stock DROP COLUMN IF EXISTS reserved_qty`);
  await client.query(`ALTER TABLE categories DROP COLUMN IF EXISTS parent_id`);
};
