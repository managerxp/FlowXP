/*
 * Wholesale module, part 2: sales orders, reservations, picking, packing, delivery and warehouse transfers.
 *
 *   Order → (confirm: stock reserved in branch_stock.reserved_qty) → pick list → packages → delivery challan
 *   → invoice (the shared billing engine; stock leaves) → payment.
 *
 * Quantities on order lines are in the line's selling unit; *_base columns are the same in the product's base unit,
 * which is what stock is kept in. An order can be fulfilled in several shipments (partial fulfilment): what is
 * not yet shipped stays reserved as a back-order.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE wholesale_sales_orders (
      order_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      order_number VARCHAR(32) NOT NULL,
      order_date DATE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
        ('DRAFT','PENDING','CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','PACKED','DISPATCHED','DELIVERED','CANCELLED')),
      payment_terms_days INTEGER NOT NULL DEFAULT 0,
      expected_delivery DATE,
      shipping_address TEXT,
      shipping_charge_paise BIGINT NOT NULL DEFAULT 0 CHECK (shipping_charge_paise >= 0),
      shipping_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
      subtotal_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      total_paise BIGINT NOT NULL DEFAULT 0,
      customer_po VARCHAR(40),
      notes TEXT,
      credit_note VARCHAR(200),
      approval_needed BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      confirmed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      confirmed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancel_reason VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_so_number ON wholesale_sales_orders (business_id, order_number)`);
  await client.query(`CREATE INDEX idx_ws_so_status ON wholesale_sales_orders (business_id, status, order_date DESC)`);
  await client.query(`CREATE INDEX idx_ws_so_customer ON wholesale_sales_orders (business_id, customer_id, order_date DESC)`);
  await client.query(`CREATE INDEX idx_ws_so_branch ON wholesale_sales_orders (branch_id, status)`);
  await client.query(`
    CREATE TABLE wholesale_sales_order_items (
      item_id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES wholesale_sales_orders(order_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(product_id),
      unit_name VARCHAR(24) NOT NULL,
      unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0),
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      base_qty NUMERIC(14,3) NOT NULL CHECK (base_qty > 0),
      price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
      price_source VARCHAR(24),
      discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      reserved_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reserved_base >= 0),
      picked_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (picked_base >= 0),
      shipped_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (shipped_base >= 0),
      cancelled_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (cancelled_base >= 0),
      notes VARCHAR(200),
      CHECK (shipped_base + cancelled_base <= base_qty + 0.0005)
    )
  `);
  await client.query(`CREATE INDEX idx_ws_soi_order ON wholesale_sales_order_items (order_id)`);
  await client.query(`CREATE INDEX idx_ws_soi_product ON wholesale_sales_order_items (business_id, product_id)`);

  await client.query(`
    CREATE TABLE wholesale_pick_lists (
      pick_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      order_id INTEGER NOT NULL REFERENCES wholesale_sales_orders(order_id) ON DELETE CASCADE,
      pick_number VARCHAR(32) NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PICKING','PICKED','PACKING','PACKED','DISPATCHED','CANCELLED')),
      picker_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      picker_name VARCHAR(120),
      notes VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      picked_at TIMESTAMPTZ,
      packed_at TIMESTAMPTZ,
      dispatched_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_pick_number ON wholesale_pick_lists (business_id, pick_number)`);
  await client.query(`CREATE INDEX idx_ws_pick_status ON wholesale_pick_lists (business_id, status)`);
  await client.query(`CREATE INDEX idx_ws_pick_order ON wholesale_pick_lists (order_id)`);
  await client.query(`
    CREATE TABLE wholesale_pick_items (
      pick_item_id SERIAL PRIMARY KEY,
      pick_id INTEGER NOT NULL REFERENCES wholesale_pick_lists(pick_id) ON DELETE CASCADE,
      order_item_id INTEGER NOT NULL REFERENCES wholesale_sales_order_items(item_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id),
      location_id INTEGER REFERENCES wholesale_locations(location_id) ON DELETE SET NULL,
      qty_base NUMERIC(14,3) NOT NULL CHECK (qty_base > 0),
      picked_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (picked_base >= 0)
    )
  `);
  await client.query(`CREATE INDEX idx_ws_pickitem_pick ON wholesale_pick_items (pick_id)`);
  await client.query(`
    CREATE TABLE wholesale_pick_item_batches (
      pick_item_id INTEGER NOT NULL REFERENCES wholesale_pick_items(pick_item_id) ON DELETE CASCADE,
      batch_id BIGINT NOT NULL REFERENCES wholesale_batches(batch_id),
      qty_base NUMERIC(14,3) NOT NULL CHECK (qty_base > 0),
      PRIMARY KEY (pick_item_id, batch_id)
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_packages (
      package_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      pick_id INTEGER NOT NULL REFERENCES wholesale_pick_lists(pick_id) ON DELETE CASCADE,
      package_no VARCHAR(40) NOT NULL,
      weight_kg NUMERIC(10,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
      length_cm NUMERIC(8,1), width_cm NUMERIC(8,1), height_cm NUMERIC(8,1),
      notes VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_package_items (
      package_id INTEGER NOT NULL REFERENCES wholesale_packages(package_id) ON DELETE CASCADE,
      pick_item_id INTEGER NOT NULL REFERENCES wholesale_pick_items(pick_item_id) ON DELETE CASCADE,
      qty_base NUMERIC(14,3) NOT NULL CHECK (qty_base > 0),
      PRIMARY KEY (package_id, pick_item_id)
    )
  `);

  await client.query(`
    CREATE TABLE wholesale_deliveries (
      delivery_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      order_id INTEGER NOT NULL REFERENCES wholesale_sales_orders(order_id) ON DELETE CASCADE,
      pick_id INTEGER REFERENCES wholesale_pick_lists(pick_id) ON DELETE SET NULL,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      challan_number VARCHAR(32) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','FAILED','RETURNED')),
      driver_name VARCHAR(120),
      driver_phone VARCHAR(32),
      driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      vehicle_no VARCHAR(20),
      delivery_address TEXT,
      dispatch_date DATE,
      expected_date DATE,
      delivered_at TIMESTAMPTZ,
      packages_count INTEGER NOT NULL DEFAULT 0,
      notes VARCHAR(300),
      pod_received_by VARCHAR(120),
      pod_note VARCHAR(300),
      pod_image_url TEXT,
      failure_reason VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_delivery_number ON wholesale_deliveries (business_id, challan_number)`);
  await client.query(`CREATE INDEX idx_ws_delivery_status ON wholesale_deliveries (business_id, status)`);
  await client.query(`CREATE INDEX idx_ws_delivery_order ON wholesale_deliveries (order_id)`);
  await client.query(`CREATE INDEX idx_ws_delivery_driver ON wholesale_deliveries (driver_user_id) WHERE driver_user_id IS NOT NULL`);

  await client.query(`
    CREATE TABLE wholesale_invoice_meta (
      invoice_id INTEGER PRIMARY KEY REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES wholesale_sales_orders(order_id) ON DELETE SET NULL,
      delivery_id INTEGER REFERENCES wholesale_deliveries(delivery_id) ON DELETE SET NULL,
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL,
      kind VARCHAR(8) NOT NULL DEFAULT 'TAX' CHECK (kind IN ('TAX','CASH','CREDIT')),
      payment_terms_days INTEGER NOT NULL DEFAULT 0,
      due_date DATE NOT NULL,
      shipping_charge_paise BIGINT NOT NULL DEFAULT 0,
      shipping_address TEXT,
      customer_po VARCHAR(40)
    )
  `);
  await client.query(`CREATE INDEX idx_ws_inv_meta_due ON wholesale_invoice_meta (business_id, due_date)`);
  await client.query(`CREATE INDEX idx_ws_inv_meta_order ON wholesale_invoice_meta (order_id)`);
  await client.query(`CREATE INDEX idx_ws_inv_meta_sp ON wholesale_invoice_meta (business_id, salesperson_id)`);

  /* warehouse-to-warehouse transfers with an in-transit stage (the older stock_transfers move instantly) */
  await client.query(`
    CREATE TABLE wholesale_transfers (
      transfer_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      from_branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      to_branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
      transfer_number VARCHAR(32) NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_TRANSIT','RECEIVED','CANCELLED')),
      notes VARCHAR(300),
      vehicle_no VARCHAR(20),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dispatched_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      CHECK (from_branch_id <> to_branch_id)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX idx_ws_transfer_number ON wholesale_transfers (business_id, transfer_number)`);
  await client.query(`CREATE INDEX idx_ws_transfer_status ON wholesale_transfers (business_id, status)`);
  await client.query(`
    CREATE TABLE wholesale_transfer_items (
      item_id SERIAL PRIMARY KEY,
      transfer_id INTEGER NOT NULL REFERENCES wholesale_transfers(transfer_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id),
      qty_base NUMERIC(14,3) NOT NULL CHECK (qty_base > 0),
      received_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_base >= 0),
      damaged_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (damaged_base >= 0)
    )
  `);
  await client.query(`
    CREATE TABLE wholesale_transfer_batches (
      item_id INTEGER NOT NULL REFERENCES wholesale_transfer_items(item_id) ON DELETE CASCADE,
      batch_no VARCHAR(40) NOT NULL,
      mfg_date DATE, expiry_date DATE, cost_paise BIGINT,
      qty_base NUMERIC(14,3) NOT NULL CHECK (qty_base > 0),
      PRIMARY KEY (item_id, batch_no)
    )
  `);
};

export const down = async (client) => {
  for (const t of ['wholesale_transfer_batches', 'wholesale_transfer_items', 'wholesale_transfers', 'wholesale_invoice_meta', 'wholesale_deliveries',
    'wholesale_package_items', 'wholesale_packages', 'wholesale_pick_item_batches', 'wholesale_pick_items', 'wholesale_pick_lists',
    'wholesale_sales_order_items', 'wholesale_sales_orders']) await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
};
