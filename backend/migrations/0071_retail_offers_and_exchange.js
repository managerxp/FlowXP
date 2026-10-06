/*
 * Retail Phase 5 foundations.
 *
 *   promotions            offers the till applies by itself: a percentage off (optionally from a quantity, optionally for
 *                         customers on the bill only), buy X get Y free, or N for a bundle price. Each is for one product or
 *                         one category, inside a date window. Applied on the server when a bill is made (modules/promotions.js).
 *   invoice_items         which offer cut a line and by how much (reports can show what the offers cost)
 *   credit_notes          credit_used_paise: the part of a return's credit a customer has spent on an exchange bill, so the
 *                         same credit can never be spent twice
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE promotions (
      promo_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      kind VARCHAR(16) NOT NULL CHECK (kind IN ('PERCENT_OFF','BUY_X_GET_Y','BUNDLE_PRICE')),
      product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(category_id) ON DELETE CASCADE,
      percent NUMERIC(5,2) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
      min_qty NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
      buy_qty INTEGER CHECK (buy_qty IS NULL OR buy_qty >= 1),
      get_qty INTEGER CHECK (get_qty IS NULL OR get_qty >= 1),
      bundle_qty INTEGER CHECK (bundle_qty IS NULL OR bundle_qty >= 2),
      bundle_price_paise BIGINT CHECK (bundle_price_paise IS NULL OR bundle_price_paise >= 0),
      members_only BOOLEAN NOT NULL DEFAULT FALSE,
      starts_on DATE,
      ends_on DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((product_id IS NOT NULL) <> (category_id IS NOT NULL)),
      CHECK (kind <> 'PERCENT_OFF' OR percent IS NOT NULL),
      CHECK (kind <> 'BUY_X_GET_Y' OR (buy_qty IS NOT NULL AND get_qty IS NOT NULL)),
      CHECK (kind <> 'BUNDLE_PRICE' OR (bundle_qty IS NOT NULL AND bundle_price_paise IS NOT NULL)),
      CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
    )
  `);
  await client.query(`CREATE INDEX idx_promotions_business ON promotions (business_id, is_active)`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS promo_id INTEGER REFERENCES promotions(promo_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS promo_discount_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS credit_used_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_used_paise >= 0)`);
};
