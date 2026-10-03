/*
 * Indexes for finding a product on a big catalogue (measured with scripts/perf-retail.js: at 100,000 products a name
 * or alias search took 200-600 ms and an exact supplier-code lookup 30 ms before these).
 *
 *   product_supplier_codes (business_id, lower(code))   exact and prefix lookups by a supplier's code
 *   products (brand_id)                                  "products of the brands whose name matches"
 *   trigram indexes on SKU, ERP code and supplier code   "contains" searches on them, when pg_trgm is available
 */
export const up = async (client) => {
  await client.query(`CREATE INDEX IF NOT EXISTS idx_product_supplier_codes_code ON product_supplier_codes (business_id, lower(code))`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand_id) WHERE brand_id IS NOT NULL`);
  const trgm = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
  if (trgm.rows.length) {
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_sku_trgm ON products USING gin (lower(sku) gin_trgm_ops)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_erp_trgm ON products USING gin (lower(erp_code) gin_trgm_ops)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_product_supplier_codes_trgm ON product_supplier_codes USING gin (lower(code) gin_trgm_ops)`);
  }
};
