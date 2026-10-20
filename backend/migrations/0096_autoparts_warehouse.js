/*
 * Automotive spare parts, part 2: warehouse locations and stock held in bins.
 *
 *   autoparts_settings    per business: the names of the location levels ("Warehouse, Zone, Aisle, Rack, Shelf, Bin" is only the default), put-away rules, stock-count approval
 *   warehouse_locations   a tree: warehouse > zone > aisle > rack > shelf > bin (any depth up to six; the names are the shop's). Each node has a segment ("R12"); its
 *                         full code ("WH-A-B-03-R12-04-B07") is the parent's code and its segment, unique per outlet. Only nodes marked can_store hold stock
 *   bin_stock             how much of a part is in a location: quantity, damaged quantity, reserved quantity. One location per part may be the primary (pick) bin
 *   bin_moves             the signed history of every movement into, out of and between locations. "From nothing" or "to nothing" is the UNASSIGNED stock
 *   putaway_tasks         stock that has been received but not yet shelved
 *
 * THE LEDGER IS THE TRUTH. Nothing here holds the stock total. branch_stock (through moveStock) is the only total, and the invariant is
 *     sum(bin_stock.qty for a part at an outlet)  <=  branch_stock.quantity
 * with the difference called UNASSIGNED (received, not yet shelved). moveStock itself keeps the invariant when stock falls (stock.js), so no caller can break it.
 * Forward only. To undo by hand (never on a live shop): drop the tables above in reverse order.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE autoparts_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      level_names JSONB NOT NULL DEFAULT '["Warehouse","Zone","Aisle","Rack","Shelf","Bin"]'::jsonb,
      -- a count difference larger than this many units, or this share of the system quantity, needs someone with stock_approve (0 = every difference does)
      count_auto_units NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (count_auto_units >= 0),
      safety_days SMALLINT NOT NULL DEFAULT 7 CHECK (safety_days BETWEEN 0 AND 180),
      review_days SMALLINT NOT NULL DEFAULT 30 CHECK (review_days BETWEEN 7 AND 365),
      dead_days SMALLINT NOT NULL DEFAULT 180 CHECK (dead_days BETWEEN 30 AND 1095),
      slow_days SMALLINT NOT NULL DEFAULT 90 CHECK (slow_days BETWEEN 14 AND 730),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  await client.query(`
    CREATE TABLE warehouse_locations (
      location_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES warehouse_locations(location_id) ON DELETE CASCADE,
      level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 6),
      segment VARCHAR(24) NOT NULL CHECK (segment <> ''),
      code VARCHAR(120) NOT NULL,
      name VARCHAR(80),
      loc_type VARCHAR(10) NOT NULL DEFAULT 'BIN' CHECK (loc_type IN ('WAREHOUSE','ZONE','AISLE','RACK','SHELF','BIN','OTHER')),
      can_store BOOLEAN NOT NULL DEFAULT FALSE,
      -- the most units the location is meant to hold (NULL = no limit) and the heaviest load (grams)
      capacity_units NUMERIC(14,3) CHECK (capacity_units IS NULL OR capacity_units >= 0),
      capacity_weight_g BIGINT CHECK (capacity_weight_g IS NULL OR capacity_weight_g >= 0),
      handling VARCHAR(200),
      notes VARCHAR(300),
      qr_token VARCHAR(32) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((parent_id IS NULL) = (level = 1))
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_wh_location_code ON warehouse_locations (branch_id, lower(code))`);
  await client.query(`CREATE UNIQUE INDEX uq_wh_location_qr ON warehouse_locations (qr_token)`);
  await client.query(`CREATE UNIQUE INDEX uq_wh_location_segment ON warehouse_locations (parent_id, lower(segment)) WHERE parent_id IS NOT NULL`);
  await client.query(`CREATE INDEX idx_wh_location_parent ON warehouse_locations (parent_id)`);
  await client.query(`CREATE INDEX idx_wh_location_business ON warehouse_locations (business_id, branch_id)`);

  await client.query(`
    CREATE TABLE bin_stock (
      location_id INTEGER NOT NULL REFERENCES warehouse_locations(location_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty >= 0),
      damaged_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
      reserved_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (location_id, product_id),
      CHECK (reserved_qty <= qty)
    )`);
  await client.query(`CREATE INDEX idx_bin_stock_product ON bin_stock (branch_id, product_id)`);
  await client.query(`CREATE INDEX idx_bin_stock_business ON bin_stock (business_id)`);
  await client.query(`CREATE UNIQUE INDEX uq_bin_primary ON bin_stock (branch_id, product_id) WHERE is_primary`);

  await client.query(`
    CREATE TABLE bin_moves (
      move_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      -- NULL on either side is the unassigned stock (received but not shelved, or left the building)
      from_location_id INTEGER REFERENCES warehouse_locations(location_id) ON DELETE SET NULL,
      to_location_id INTEGER REFERENCES warehouse_locations(location_id) ON DELETE SET NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('PUTAWAY','MOVE','PICK','AUTO','ADJUST','COUNT','DAMAGE','RETURN','RELOCATE')),
      ref_type VARCHAR(20),
      ref_id INTEGER,
      -- a retry carries the same key and moves nothing a second time
      source_key VARCHAR(100),
      note VARCHAR(200),
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_bin_move_key ON bin_moves (business_id, source_key) WHERE source_key IS NOT NULL`);
  await client.query(`CREATE INDEX idx_bin_moves_product ON bin_moves (business_id, product_id, created_at DESC)`);
  await client.query(`CREATE INDEX idx_bin_moves_location ON bin_moves (from_location_id) WHERE from_location_id IS NOT NULL`);
  await client.query(`CREATE INDEX idx_bin_moves_to ON bin_moves (to_location_id) WHERE to_location_id IS NOT NULL`);

  await client.query(`
    CREATE TABLE putaway_tasks (
      task_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      qty_done NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_done >= 0),
      status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
      source VARCHAR(10) NOT NULL DEFAULT 'GRN' CHECK (source IN ('GRN','RETURN','TRANSFER','MANUAL')),
      source_id INTEGER,
      suggested_location_id INTEGER REFERENCES warehouse_locations(location_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      done_at TIMESTAMPTZ,
      CHECK (qty_done <= qty)
    )`);
  await client.query(`CREATE INDEX idx_putaway_open ON putaway_tasks (business_id, branch_id) WHERE status = 'OPEN'`);
  await client.query(`CREATE INDEX idx_putaway_source ON putaway_tasks (source, source_id)`);
};
