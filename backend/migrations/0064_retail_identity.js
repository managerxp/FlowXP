/*
 * Supermarket / retail foundations: a product's identity is its immutable product_id, and everything a person or a
 * scanner might call it by hangs off that — a generated SKU, any number of barcodes, aliases, supplier codes and an
 * optional ERP code. None of those is the identity, so none of them is ever required and any can change.
 *
 *   product_barcodes      every barcode of a product (unique per business). products.barcode stays as the primary one
 *                         because wholesale, pharmacy and salon code reads and writes it directly; a trigger mirrors it
 *                         here so there is one place that guarantees "a barcode belongs to one product".
 *   product_aliases       other names the product is searched by (user-made now; AI/supplier-derived later)
 *   product_supplier_codes  a supplier's own code for the product
 *   products.erp_code     optional external system number, unique per business when set
 *   products.mrp_paise    maximum retail price, optional
 *   sku_counters          per business and prefix, only ever counts up, so a generated SKU is never reused
 *   retail_settings       the owner's choices for the retail screens (one row per business, absent = defaults)
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp_paise BIGINT CHECK (mrp_paise IS NULL OR mrp_paise >= 0)`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS erp_code VARCHAR(64)`);
  /* SKUs differ by case only are the same SKU. The index is added when no business already has such a pair (older
     data might); the app checks case-insensitively either way. */
  const clash = await client.query(`SELECT 1 FROM products WHERE sku IS NOT NULL AND sku <> '' GROUP BY business_id, lower(sku) HAVING count(*) > 1 LIMIT 1`);
  if (!clash.rows.length) {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku_ci ON products (business_id, lower(sku)) WHERE sku IS NOT NULL AND sku <> ''`);
  }
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_erp
      ON products (business_id, lower(erp_code)) WHERE erp_code IS NOT NULL AND erp_code <> ''
  `);

  await client.query(`
    CREATE TABLE product_barcodes (
      barcode_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      barcode VARCHAR(64) NOT NULL CHECK (barcode <> ''),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, barcode)
    )
  `);
  await client.query(`CREATE INDEX idx_product_barcodes_product ON product_barcodes (product_id)`);
  await client.query(`
    INSERT INTO product_barcodes (business_id, product_id, barcode)
    SELECT business_id, product_id, barcode FROM products WHERE barcode IS NOT NULL AND barcode <> ''
  `);

  /* products.barcode is the primary barcode. Whoever writes it (this module's service, or the older wholesale /
     pharmacy / salon code) the barcode table follows: the old primary leaves, the new one arrives. Other barcodes
     of the product are untouched. A barcode that belongs to another product raises the unique violation, same as
     it always did. */
  await client.query(`
    CREATE OR REPLACE FUNCTION sync_product_barcode() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.barcode IS DISTINCT FROM NEW.barcode AND OLD.barcode IS NOT NULL AND OLD.barcode <> '' THEN
        DELETE FROM product_barcodes WHERE business_id = OLD.business_id AND product_id = OLD.product_id AND barcode = OLD.barcode;
      END IF;
      IF NEW.barcode IS NOT NULL AND NEW.barcode <> '' THEN
        IF NOT EXISTS (SELECT 1 FROM product_barcodes WHERE business_id = NEW.business_id AND product_id = NEW.product_id AND barcode = NEW.barcode) THEN
          INSERT INTO product_barcodes (business_id, product_id, barcode) VALUES (NEW.business_id, NEW.product_id, NEW.barcode);
        END IF;
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `);
  await client.query(`
    CREATE TRIGGER trg_sync_product_barcode AFTER INSERT OR UPDATE OF barcode ON products
      FOR EACH ROW EXECUTE FUNCTION sync_product_barcode()
  `);

  await client.query(`
    CREATE TABLE product_aliases (
      alias_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      alias VARCHAR(160) NOT NULL,
      alias_key VARCHAR(160) NOT NULL,
      source VARCHAR(12) NOT NULL DEFAULT 'USER' CHECK (source IN ('USER','AI','SUPPLIER')),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (product_id, alias_key)
    )
  `);
  await client.query(`CREATE INDEX idx_product_aliases_business_key ON product_aliases (business_id, alias_key)`);

  await client.query(`
    CREATE TABLE product_supplier_codes (
      code_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL CHECK (code <> ''),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // a supplier's code names one product (no supplier chosen counts as one "unspecified" supplier)
  await client.query(`CREATE UNIQUE INDEX uq_product_supplier_codes ON product_supplier_codes (business_id, COALESCE(supplier_id, 0), lower(code))`);
  await client.query(`CREATE INDEX idx_product_supplier_codes_product ON product_supplier_codes (product_id)`);

  await client.query(`
    CREATE TABLE sku_counters (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      prefix VARCHAR(8) NOT NULL,
      next_number INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (business_id, prefix)
    )
  `);

  await client.query(`
    CREATE TABLE retail_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      auto_sku BOOLEAN NOT NULL DEFAULT TRUE,
      require_barcode BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* "Contains" searches on names stay fast on a big catalogue with trigram indexes. The extension may not be
     installable everywhere (managed databases), so it is optional: without it the same queries still work, they
     just scan the business's own products. A savepoint keeps a refusal from aborting the migration. */
  await client.query('SAVEPOINT trgm');
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await client.query(`CREATE INDEX idx_products_name_trgm ON products USING gin (lower(name) gin_trgm_ops)`);
    await client.query(`CREATE INDEX idx_product_aliases_key_trgm ON product_aliases USING gin (alias_key gin_trgm_ops)`);
    await client.query('RELEASE SAVEPOINT trgm');
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT trgm');
  }
};
