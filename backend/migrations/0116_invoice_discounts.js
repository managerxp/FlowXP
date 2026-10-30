/*
 * Discount given when a customer pays (a cash or settlement discount): part of what was owed is let go instead of collected.
 * It lowers the bill's balance but is not money received, so it is kept in its own table, not in payments: no money report
 * counts it as takings, and Profit & Loss and the party statement show it on its own line. Forward only.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE invoice_discounts (
      discount_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      given_on DATE NOT NULL DEFAULT CURRENT_DATE,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX idx_invoice_discounts_invoice ON invoice_discounts (invoice_id)`);
  await client.query(`CREATE INDEX idx_invoice_discounts_business_date ON invoice_discounts (business_id, given_on)`);
};
