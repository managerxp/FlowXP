/*
 * Clothing retail (business type CLOTHING), part 1: styles and size/colour variants.
 *
 * There is no second product table. A size/colour variant IS a `products` row (SKU, barcode, price, GST, MRP, stock all live there, in `product_barcodes`
 * and in the stock ledger), so the till, returns, exchanges, offers, transfers and the offline catalogue work per variant exactly as they do for any shop.
 * These tables only add what a clothing shop needs on top:
 *
 *   clothing_styles       what the shopper calls one product: brand, gender, season, fabric, pattern, fit, HSN, GST and the default prices its variants start from
 *   clothing_variants     1:1 on products: which style, which colour, which size (unique per style), plus the short colour code used in the SKU
 *   clothing_size_sets    a shop's own named size sets (the usual ones, XS-XXL, waist sizes, kids, shoes and free size, are built in)
 *
 * Forward only. To undo by hand (never on a live shop): drop the three tables and the sequence. Nothing existing is changed.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE clothing_styles (
      style_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      style_code VARCHAR(24) NOT NULL,
      name VARCHAR(160) NOT NULL,
      category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
      subcategory VARCHAR(80),
      brand_id INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL,
      gender VARCHAR(10) NOT NULL DEFAULT 'UNISEX' CHECK (gender IN ('MEN','WOMEN','BOYS','GIRLS','KIDS','UNISEX')),
      season VARCHAR(40),
      fabric VARCHAR(60),
      pattern VARCHAR(40),
      fit VARCHAR(40),
      description TEXT,
      image_url TEXT,
      hsn_sac VARCHAR(12),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
      mrp_paise BIGINT CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
      selling_price_paise BIGINT NOT NULL DEFAULT 0 CHECK (selling_price_paise >= 0),
      purchase_price_paise BIGINT NOT NULL DEFAULT 0 CHECK (purchase_price_paise >= 0),
      size_set VARCHAR(40),
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_clothing_style_code ON clothing_styles (business_id, lower(style_code))`);
  await client.query(`CREATE INDEX idx_clothing_styles_business ON clothing_styles (business_id, status)`);

  await client.query(`
    CREATE TABLE clothing_variants (
      product_id INTEGER PRIMARY KEY REFERENCES products(product_id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      style_id INTEGER NOT NULL REFERENCES clothing_styles(style_id) ON DELETE CASCADE,
      colour VARCHAR(40) NOT NULL,
      colour_code VARCHAR(6) NOT NULL,
      colour_hex VARCHAR(7),
      size VARCHAR(20) NOT NULL,
      sort_order SMALLINT NOT NULL DEFAULT 0
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_clothing_variant ON clothing_variants (style_id, lower(colour), lower(size))`);
  await client.query(`CREATE INDEX idx_clothing_variants_business ON clothing_variants (business_id, style_id)`);

  await client.query(`
    CREATE TABLE clothing_size_sets (
      set_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(40) NOT NULL,
      sizes JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX uq_clothing_size_set ON clothing_size_sets (business_id, lower(name))`);

  // in-store barcodes (EAN-13 starting with 2) come from one sequence, so a barcode is never reused between variants or shops
  await client.query(`CREATE SEQUENCE clothing_barcode_seq`);
};
