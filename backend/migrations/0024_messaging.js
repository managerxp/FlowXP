/*
 * Customer messages (WhatsApp / SMS).
 *
 * `messages` is the outbox and the log in one: every message a business sends
 * (or tried to) with its outcome, so "did the customer get the bill?" has an
 * answer and a failed one can be resent. Offers and reminders respect
 * customers.marketing_opt_out; bills and booking confirmations are transactional.
 * invoices.share_token is the unguessable key in the bill link sent to the customer.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN messaging_settings JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE customers ADD COLUMN marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE invoices ADD COLUMN share_token VARCHAR(40)`);
  await client.query(`CREATE UNIQUE INDEX uq_invoices_share_token ON invoices (share_token) WHERE share_token IS NOT NULL`);

  await client.query(`
    CREATE TABLE messages (
      message_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      -- no foreign key on purpose: a message written right after a bill would otherwise lock the customer row the billing
      -- transaction is holding while it waits on the business row, and the two deadlock
      customer_id INTEGER,
      phone VARCHAR(20) NOT NULL,
      channel VARCHAR(10) NOT NULL CHECK (channel IN ('WHATSAPP','SMS')),
      kind VARCHAR(24) NOT NULL,
      body TEXT NOT NULL,
      params JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(10) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
      provider_id VARCHAR(80),
      error VARCHAR(300),
      related_type VARCHAR(20),
      related_id INTEGER,
      batch VARCHAR(24),
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX idx_messages_business ON messages (business_id, created_at DESC)`);
  await client.query(`CREATE INDEX idx_messages_customer_kind ON messages (customer_id, kind, created_at DESC)`);
  await client.query(`CREATE INDEX idx_messages_batch ON messages (batch) WHERE batch IS NOT NULL`);
};
