/* Wastage as a first-class ledger movement, and refunds as an explicit record. */
export const up = async (client) => {
  await client.query(`ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check`);
  await client.query(`
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check
      CHECK (transaction_type IN ('SALE','PURCHASE','ADJUSTMENT','RETURN','OPENING','WASTAGE'))
  `);
  await client.query(`
    ALTER TABLE inventory_transactions ADD COLUMN reason_code VARCHAR(20)
      CHECK (reason_code IS NULL OR reason_code IN ('SPOILAGE','EXPIRED','DAMAGED','PREPARATION','OVERPRODUCTION','OTHER'))
  `);

  await client.query(`
    CREATE TABLE refunds (
      refund_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE RESTRICT,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      method VARCHAR(16) NOT NULL DEFAULT 'CASH',
      reason TEXT NOT NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_refunds_invoice ON refunds (invoice_id)`);
  await client.query(`CREATE INDEX idx_refunds_business_time ON refunds (business_id, created_at DESC)`);
  await client.query(`ALTER TABLE invoices ADD COLUMN refunded_paise BIGINT NOT NULL DEFAULT 0`);
};
