/*
 * Automotive spare parts, part 5: what happened to returned parts, and claims on suppliers.
 *
 *   part_returns     one row per part on a customer credit note: why it came back and where it went (back on the shelf, damaged, to the supplier, scrapped)
 *   supplier_claims  damaged or rejected goods (or a customer's warranty return) the supplier owes a credit, replacement or answer for. Money itself moves through the
 *                    existing purchase debit notes; this is the follow-up list
 * Forward only.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE supplier_claims (
      claim_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      source VARCHAR(10) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('GRN','RETURN','MANUAL')),
      source_id INTEGER,
      reason VARCHAR(10) NOT NULL DEFAULT 'DAMAGED' CHECK (reason IN ('DAMAGED','REJECTED','WARRANTY','WRONG_PART','SHORT')),
      status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CREDITED','REPLACED','DECLINED','WRITTEN_OFF')),
      amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
      note VARCHAR(300),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMPTZ,
      resolution_note VARCHAR(300)
    )`);
  await client.query(`CREATE INDEX idx_supplier_claims_open ON supplier_claims (business_id, supplier_id) WHERE status = 'OPEN'`);
  await client.query(`
    CREATE TABLE part_returns (
      return_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      cn_id INTEGER REFERENCES credit_notes(cn_id) ON DELETE SET NULL,
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      reason VARCHAR(20) NOT NULL CHECK (reason IN ('WRONG_PART','DEFECTIVE','NOT_REQUIRED','TRANSIT_DAMAGE','FITMENT','WARRANTY','OTHER')),
      disposition VARCHAR(10) NOT NULL CHECK (disposition IN ('RESTOCK','DAMAGED','SUPPLIER','SCRAP')),
      location_id INTEGER REFERENCES warehouse_locations(location_id) ON DELETE SET NULL,
      claim_id INTEGER REFERENCES supplier_claims(claim_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX idx_part_returns_business ON part_returns (business_id, created_at DESC)`);
  await client.query(`CREATE INDEX idx_part_returns_product ON part_returns (product_id)`);
};
