/*
 * Named GST rates (owner, 2026-11-18): each business keeps its own list ("GST 5%", "Exempt", "Nil rated", "Non-GST" ...), products pick one,
 * and the bill and the GST returns use its name and kind.
 *  - kind: TAXABLE (a GST rate, 0 to 100), NIL (nil rated), EXEMPT, NON_GST (outside GST, e.g. petrol, liquor). The last three are always 0%.
 *    GSTR-1 table 8 and GSTR-3B 3.1(c)/(e) report them apart, which a bare "0%" cannot tell.
 *  - products.tax_rate_id: the named rate chosen; products.tax_rate stays the number every tax calculation already uses (kept in step).
 *  - invoice_items.tax_kind / tax_name: what the line was billed under, kept as it was on the day.
 * The default list is made for a business the first time it is read (modules/taxRates.js), not here.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tax_rates (
      tax_rate_id SERIAL PRIMARY KEY,
      business_id INT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
      kind VARCHAR(10) NOT NULL DEFAULT 'TAXABLE' CHECK (kind IN ('TAXABLE','NIL','EXEMPT','NON_GST')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (kind = 'TAXABLE' OR rate = 0)
    )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_rates_name ON tax_rates (business_id, lower(name))`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate_id INT REFERENCES tax_rates(tax_rate_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_kind VARCHAR(10), ADD COLUMN IF NOT EXISTS tax_name VARCHAR(60)`);
};
