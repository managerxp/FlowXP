/*
 * Multi-brand (owner's request, 2026-09-29, from a "Cloud Kitchen module"
 * spec — see brain.md for the full audit): one kitchen running several
 * virtual brands ("Brand A — Biryani", "Brand B — Burgers") from the same
 * outlet. The one genuinely new piece that spec asked for; everything else
 * in it (KDS, recipes, packaging-as-a-recipe-ingredient, inventory,
 * purchasing, delivery-integration adapters, GST, loyalty, RBAC, AI,
 * reports) already existed and needed no change.
 *
 * A brand is business-wide, not per-outlet — the same "shared catalog,
 * outlet overrides where it matters" shape products/categories already use
 * — so a brand sold from two outlets is one row, not two. `products.brand_id`
 * and `orders.brand_id` are both nullable: a business with no brands defined
 * behaves exactly as before (every screen this touches treats a NULL brand
 * as "not brand-specific", never a required field).
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS brands (
      brand_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      logo_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_brands_business ON brands (business_id)`);

  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL`);
};
