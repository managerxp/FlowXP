/*
 * The link to FlowBook (modules/flowbook/): one connection per business, and an outbox of the events to send.
 *
 * The outbox is filled by a scan that looks at invoices, credit notes and payments made since the link was switched on
 * (so every module that bills is covered without touching each one), and drained in order by the worker. A row is never
 * deleted: SENT, SKIPPED (with the reason, because a sale that cannot be sent is a gap in the books someone must see)
 * and DEAD (retries used up, waiting for a person to retry) all stay. Forward only.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE flowbook_links (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      base_url VARCHAR(200) NOT NULL,
      secret_enc TEXT NOT NULL,                       -- encrypted at rest (modules/crypto.js)
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      enabled_from TIMESTAMPTZ,                       -- only what was made after this is sent (no silent backfill)
      last_ok_at TIMESTAMPTZ,
      last_error VARCHAR(300),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE flowbook_outbox (
      outbox_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      event_id UUID NOT NULL UNIQUE,
      event_type VARCHAR(30) NOT NULL,
      source_id INTEGER NOT NULL,                     -- invoice id, credit note id or payment id
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','SKIPPED','DEAD')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMPTZ,
      UNIQUE (business_id, event_type, source_id)
    )
  `);
  await client.query(`CREATE INDEX idx_flowbook_outbox_due ON flowbook_outbox (business_id, outbox_id) WHERE status = 'PENDING'`);
};
