/* The Super Admin's own invoices and quotations: FlowXP billing its clients. Lines are kept as typed so a document stays as issued. */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_documents (
      doc_id SERIAL PRIMARY KEY,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('INVOICE','QUOTE')),
      doc_number VARCHAR(30) NOT NULL UNIQUE,
      business_id INTEGER REFERENCES businesses(business_id) ON DELETE SET NULL,
      client JSONB NOT NULL DEFAULT '{}',
      items JSONB NOT NULL DEFAULT '[]',
      totals JSONB NOT NULL DEFAULT '{}',
      intra_state BOOLEAN NOT NULL DEFAULT TRUE,
      issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date DATE,
      notes TEXT,
      status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','PAID','ACCEPTED','DECLINED','CONVERTED','CANCELLED')),
      paid_at TIMESTAMPTZ,
      paid_note VARCHAR(200),
      from_quote_id INTEGER REFERENCES admin_documents(doc_id) ON DELETE SET NULL,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_documents_kind ON admin_documents (kind, doc_id DESC)`);
  await client.query(`CREATE TABLE IF NOT EXISTS admin_doc_counters (series VARCHAR(20) PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 0)`);
};
