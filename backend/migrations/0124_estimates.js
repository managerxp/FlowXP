/* Estimates / quotations: a priced offer to a customer that is not a sale. It keeps its own number series (EST-0001) and turns into an invoice in one step. Lines are kept as typed so the offer stays as quoted even if prices change. */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS estimate_prefix VARCHAR(8) NOT NULL DEFAULT 'EST'`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS estimate_next_number INTEGER NOT NULL DEFAULT 1`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS estimates (
      estimate_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      estimate_number VARCHAR(30) NOT NULL,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      customer_name VARCHAR(120),
      items JSONB NOT NULL DEFAULT '[]',
      discount_paise BIGINT NOT NULL DEFAULT 0,
      notes TEXT,
      valid_until DATE,
      status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONVERTED','CANCELLED')),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, estimate_number)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_estimates_business ON estimates (business_id, created_at DESC)`);
};
