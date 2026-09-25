/*
 * Credit notes, cash round-off and what a GST return needs.
 *
 * A credit note is the formal document that reduces an issued invoice: for goods
 * sent back, a wrong item, a price correction. It carries its own number, the tax
 * it reverses (split CGST/SGST/IGST like the invoice), and settles against the
 * customer's balance, or as a refund, or as nothing at all (a credit on account).
 * Refunds alone (which only move money) stay as they are; credit notes are what
 * change revenue and GST.
 *
 * Round-off: a business can round each bill to the nearest rupee. The difference
 * is kept on the invoice so the books still add up.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN round_off_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE businesses ADD COLUMN credit_note_prefix VARCHAR(12) NOT NULL DEFAULT 'CN'`);
  await client.query(`ALTER TABLE businesses ADD COLUMN credit_note_next_number INTEGER NOT NULL DEFAULT 1`);

  await client.query(`ALTER TABLE invoices ADD COLUMN round_off_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE invoices ADD COLUMN credited_paise BIGINT NOT NULL DEFAULT 0`);
  // The part of refunded_paise that came from credit notes, so revenue isn't reduced twice for the same return.
  await client.query(`ALTER TABLE invoices ADD COLUMN cn_refunded_paise BIGINT NOT NULL DEFAULT 0`);

  await client.query(`
    CREATE TABLE credit_notes (
      cn_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id),
      cn_number VARCHAR(32) NOT NULL,
      cn_date DATE NOT NULL DEFAULT CURRENT_DATE,
      reason TEXT NOT NULL,
      subtotal_paise BIGINT NOT NULL DEFAULT 0,       -- taxable value
      cgst_paise BIGINT NOT NULL DEFAULT 0,
      sgst_paise BIGINT NOT NULL DEFAULT 0,
      igst_paise BIGINT NOT NULL DEFAULT 0,
      tax_paise BIGINT NOT NULL DEFAULT 0,
      discount_share_paise BIGINT NOT NULL DEFAULT 0, -- this note's share of the invoice-level discount
      total_paise BIGINT NOT NULL DEFAULT 0,
      settled_balance_paise BIGINT NOT NULL DEFAULT 0, -- taken off what the customer still owed
      refunded_paise BIGINT NOT NULL DEFAULT 0,        -- paid back
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE UNIQUE INDEX uq_credit_notes_number ON credit_notes (business_id, cn_number)`);
  await client.query(`CREATE INDEX idx_credit_notes_invoice ON credit_notes (invoice_id)`);
  await client.query(`CREATE INDEX idx_credit_notes_date ON credit_notes (business_id, branch_id, cn_date)`);

  await client.query(`
    CREATE TABLE credit_note_items (
      cn_item_id SERIAL PRIMARY KEY,
      cn_id INTEGER NOT NULL REFERENCES credit_notes(cn_id) ON DELETE CASCADE,
      invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(item_id),
      product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
      description VARCHAR(200) NOT NULL,
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      tax_amount_paise BIGINT NOT NULL DEFAULT 0,
      line_total_paise BIGINT NOT NULL,               -- tax included, before the invoice-level discount share
      restocked BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await client.query(`CREATE INDEX idx_cn_items_cn ON credit_note_items (cn_id)`);
  await client.query(`CREATE INDEX idx_cn_items_invoice_item ON credit_note_items (invoice_item_id)`);

  await client.query(`ALTER TABLE refunds ADD COLUMN credit_note_id INTEGER REFERENCES credit_notes(cn_id) ON DELETE SET NULL`);
};
