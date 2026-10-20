/*
 * Automotive spare parts (business type AUTO_PARTS), part 1: the parts catalogue and vehicle fitment.
 *
 * There is no second product table. A spare part IS a `products` row (SKU, barcodes, price, GST, MRP, stock all live there and in the stock ledger);
 * these tables only add what a parts shop needs on top.
 *
 *   autoparts_parts          1:1 on products: manufacturer and OEM numbers, genuine / aftermarket / refurbished / used, vehicle type, pack size, stock limits,
 *                            preferred supplier, technical specifications, size and weight, handling notes, wholesale price
 *   autoparts_part_numbers   every number a part is known by (OEM, manufacturer, alternate, supplier, "replaces"). `key` is the number with spaces, dashes
 *                            and slashes removed and in capitals, which is what a scanner or a counter person types, so "04465-0K 280" finds "044650K280"
 *   vehicle_makes / models / variants   the lounge's own vehicle list, per business. Entered by hand or imported from a file the shop supplies; nothing is
 *                            pre-filled, because a wrong fitment is worse than none
 *   part_fitment             which vehicle a part is said to fit, for which years, who said so, and whether anyone has checked it
 *                            (VERIFIED, UNVERIFIED, NOT_FIT). A part is never assumed to fit because it looks the same
 *
 * Forward only. To undo by hand (never on a live shop): drop the tables above in reverse order and restore business_users_role_check without STOREKEEPER and
 * PARTS_COUNTER. Nothing here changes an existing table except that role constraint.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE business_users DROP CONSTRAINT IF EXISTS business_users_role_check`);
  await client.query(`
    ALTER TABLE business_users ADD CONSTRAINT business_users_role_check CHECK (role IN (
      'OWNER','ADMIN','MANAGER','CASHIER','STAFF','WAITER','KITCHEN','INVENTORY_MANAGER','DELIVERY','RECEPTIONIST','STYLIST','ACCOUNTANT',
      'SALES_MANAGER','SALES_EXECUTIVE','WAREHOUSE_MANAGER','WAREHOUSE_STAFF','PURCHASE_MANAGER','DISTRIBUTOR_ADMIN','FIELD_SALES',
      'COLLECTION_EXECUTIVE','DELIVERY_MANAGER','PHARMACIST','SALES_STAFF','GRN_MANAGER','AUDITOR',
      'FRONT_DESK','HOUSEKEEPER','HOUSEKEEPING_SUPERVISOR','NIGHT_AUDITOR','BANQUET_MANAGER','HR_MANAGER',
      'GYM_RECEPTIONIST','TRAINER','GAMING_ATTENDANT','STOREKEEPER','PARTS_COUNTER'))`);

  await client.query(`
    CREATE TABLE autoparts_parts (
      product_id INTEGER PRIMARY KEY REFERENCES products(product_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      mfr_part_no VARCHAR(64),
      oem_part_no VARCHAR(64),
      classification VARCHAR(12) NOT NULL DEFAULT 'AFTERMARKET' CHECK (classification IN ('OEM','AFTERMARKET','REFURBISHED','USED')),
      vehicle_type VARCHAR(12) NOT NULL DEFAULT 'CAR' CHECK (vehicle_type IN ('CAR','BIKE','SCOOTER','TRUCK','BUS','COMMERCIAL','OTHER')),
      subcategory VARCHAR(80),
      pack_qty NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (pack_qty > 0),
      max_stock NUMERIC(14,3) CHECK (max_stock IS NULL OR max_stock >= 0),
      reorder_level NUMERIC(14,3) CHECK (reorder_level IS NULL OR reorder_level >= 0),
      preferred_supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
      specs JSONB NOT NULL DEFAULT '{}'::jsonb,
      weight_g INTEGER CHECK (weight_g IS NULL OR weight_g >= 0),
      length_mm INTEGER CHECK (length_mm IS NULL OR length_mm >= 0),
      width_mm INTEGER CHECK (width_mm IS NULL OR width_mm >= 0),
      height_mm INTEGER CHECK (height_mm IS NULL OR height_mm >= 0),
      handling VARCHAR(200),
      wholesale_price_paise BIGINT CHECK (wholesale_price_paise IS NULL OR wholesale_price_paise >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_autoparts_parts_business ON autoparts_parts (business_id, classification)`);

  await client.query(`
    CREATE TABLE autoparts_part_numbers (
      pn_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      number VARCHAR(64) NOT NULL,
      key VARCHAR(64) NOT NULL CHECK (key <> ''),
      kind VARCHAR(10) NOT NULL DEFAULT 'ALTERNATE' CHECK (kind IN ('OEM','MFR','ALTERNATE','SUPPLIER','REPLACES')),
      note VARCHAR(120),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (product_id, key, kind)
    )`);
  await client.query(`CREATE INDEX idx_autoparts_pn_key ON autoparts_part_numbers (business_id, key)`);
  await client.query(`CREATE INDEX idx_autoparts_pn_product ON autoparts_part_numbers (product_id)`);
  const trgm = (await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)).rowCount;
  if (trgm) await client.query(`CREATE INDEX idx_autoparts_pn_key_trgm ON autoparts_part_numbers USING gin (key gin_trgm_ops)`);

  await client.query(`
    CREATE TABLE vehicle_makes (
      make_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      vehicle_type VARCHAR(12) NOT NULL DEFAULT 'CAR' CHECK (vehicle_type IN ('CAR','BIKE','SCOOTER','TRUCK','BUS','COMMERCIAL','OTHER')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_vehicle_make ON vehicle_makes (business_id, lower(name), vehicle_type)`);
  await client.query(`
    CREATE TABLE vehicle_models (
      model_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      make_id INTEGER NOT NULL REFERENCES vehicle_makes(make_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_vehicle_model ON vehicle_models (make_id, lower(name))`);
  await client.query(`CREATE INDEX idx_vehicle_models_business ON vehicle_models (business_id, make_id)`);
  await client.query(`
    CREATE TABLE vehicle_variants (
      variant_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      model_id INTEGER NOT NULL REFERENCES vehicle_models(model_id) ON DELETE CASCADE,
      generation VARCHAR(40),
      variant VARCHAR(60),
      engine_type VARCHAR(40),
      engine_cc INTEGER CHECK (engine_cc IS NULL OR engine_cc BETWEEN 1 AND 20000),
      fuel VARCHAR(12) CHECK (fuel IS NULL OR fuel IN ('PETROL','DIESEL','CNG','LPG','ELECTRIC','HYBRID','OTHER')),
      transmission VARCHAR(12) CHECK (transmission IS NULL OR transmission IN ('MANUAL','AUTOMATIC','AMT','CVT','DCT','OTHER')),
      year_from SMALLINT CHECK (year_from IS NULL OR year_from BETWEEN 1900 AND 2100),
      year_to SMALLINT CHECK (year_to IS NULL OR year_to BETWEEN 1900 AND 2100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (year_to IS NULL OR year_from IS NULL OR year_to >= year_from)
    )`);
  await client.query(`CREATE INDEX idx_vehicle_variants_model ON vehicle_variants (model_id)`);

  await client.query(`
    CREATE TABLE part_fitment (
      fit_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      model_id INTEGER NOT NULL REFERENCES vehicle_models(model_id) ON DELETE CASCADE,
      -- NULL = every variant of the model in these years
      variant_id INTEGER REFERENCES vehicle_variants(variant_id) ON DELETE CASCADE,
      year_from SMALLINT CHECK (year_from IS NULL OR year_from BETWEEN 1900 AND 2100),
      year_to SMALLINT CHECK (year_to IS NULL OR year_to BETWEEN 1900 AND 2100),
      status VARCHAR(10) NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('VERIFIED','UNVERIFIED','NOT_FIT')),
      -- where the fitment came from: "OEM catalogue 2024", "supplier list", "mechanic said", "import"
      source VARCHAR(80),
      note VARCHAR(200),
      verified_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      verified_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (year_to IS NULL OR year_from IS NULL OR year_to >= year_from)
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_part_fitment ON part_fitment (product_id, model_id, COALESCE(variant_id, 0), COALESCE(year_from, 0), COALESCE(year_to, 0))`);
  await client.query(`CREATE INDEX idx_part_fitment_model ON part_fitment (business_id, model_id)`);
  await client.query(`CREATE INDEX idx_part_fitment_variant ON part_fitment (variant_id) WHERE variant_id IS NOT NULL`);
};
