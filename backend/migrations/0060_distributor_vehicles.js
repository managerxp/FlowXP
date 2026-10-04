/*
 * Distributor module, part 4: van / vehicle stock.
 *
 * Warehouse → vehicle → retailer → sale → collection → reconciliation.
 *
 * Loading a van takes stock OUT of the home warehouse (a TRANSFER on the stock ledger, batches consumed first-expiry-
 * first-out) and puts it on the vehicle, where it is tracked per product and batch. A van sale invoices through the
 * normal billing engine but flags the lines as already out of the warehouse (stockHandledElsewhere), so nothing is
 * deducted twice, and takes the goods off the vehicle instead. At the end of the day the unsold stock is counted:
 * shortages and surpluses are recorded, and the rest goes back to the warehouse.
 *
 * Vehicle stock is always warehouse stock + vehicle stock = what the business owns; nothing is invented or lost
 * without a ledger row saying why.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE dist_vehicles (
      vehicle_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE RESTRICT,   -- the home warehouse
      vehicle_no VARCHAR(20) NOT NULL,
      driver_name VARCHAR(120),
      driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      salesperson_id INTEGER REFERENCES wholesale_salespeople(salesperson_id) ON DELETE SET NULL,
      route VARCHAR(160),
      capacity_kg NUMERIC(10,2) CHECK (capacity_kg IS NULL OR capacity_kg > 0),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      notes VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_vehicle_no ON dist_vehicles (business_id, upper(vehicle_no))`);
  await client.query(`
    CREATE TABLE dist_vehicle_stock (
      stock_id SERIAL PRIMARY KEY,
      vehicle_id INTEGER NOT NULL REFERENCES dist_vehicles(vehicle_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
      batch_id INTEGER REFERENCES wholesale_batches(batch_id) ON DELETE RESTRICT,
      qty_base NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_base >= 0)
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_dist_vehicle_stock ON dist_vehicle_stock (vehicle_id, product_id, COALESCE(batch_id, 0))`);
  await client.query(`CREATE INDEX idx_dist_vehicle_stock_product ON dist_vehicle_stock (business_id, product_id)`);
  await client.query(`
    CREATE TABLE dist_vehicle_moves (
      move_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      vehicle_id INTEGER NOT NULL REFERENCES dist_vehicles(vehicle_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
      batch_id INTEGER REFERENCES wholesale_batches(batch_id) ON DELETE SET NULL,
      qty_base NUMERIC(14,3) NOT NULL CHECK (qty_base <> 0),
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('LOAD','SALE','RETURN','COUNT_ADJUST')),
      ref_type VARCHAR(16),
      ref_id INTEGER,
      note VARCHAR(200),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_dist_vehicle_moves ON dist_vehicle_moves (vehicle_id, created_at DESC)`);
  await client.query(`
    CREATE TABLE dist_vehicle_reconciliations (
      recon_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      vehicle_id INTEGER NOT NULL REFERENCES dist_vehicles(vehicle_id) ON DELETE CASCADE,
      lines JSONB NOT NULL,
      shortage_paise BIGINT NOT NULL DEFAULT 0,
      surplus_paise BIGINT NOT NULL DEFAULT 0,
      returned BOOLEAN NOT NULL DEFAULT FALSE,
      note VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_dist_vehicle_recon ON dist_vehicle_reconciliations (vehicle_id, created_at DESC)`);
  /* a van sale has no delivery challan and a pick list: the goods changed hands on the spot */
  await client.query(`ALTER TABLE wholesale_sales_orders ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES dist_vehicles(vehicle_id) ON DELETE SET NULL`);
};

export const down = async (client) => {
  await client.query(`ALTER TABLE wholesale_sales_orders DROP COLUMN IF EXISTS vehicle_id`);
  await client.query(`DROP TABLE IF EXISTS dist_vehicle_reconciliations`);
  await client.query(`DROP TABLE IF EXISTS dist_vehicle_moves`);
  await client.query(`DROP TABLE IF EXISTS dist_vehicle_stock`);
  await client.query(`DROP TABLE IF EXISTS dist_vehicles`);
};
