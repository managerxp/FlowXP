/*
 * Post-bill customer feedback (owner's request, 2026-09-29 — the honest,
 * fully-buildable half of the "AI-based Google reviews" idea from brain.md's
 * pending list: real Google Business Profile integration needs Google's own
 * API approval FlowXP doesn't have). Instead: the same public bill page a
 * customer already opens (`publicBill.controller.js`, `invoices.share_token`)
 * gets a "rate your visit" prompt. A happy rating is asked to also post it on
 * Google (a plain share link the owner pastes once, no API); an unhappy one
 * stays private here for the owner to see and act on — protects the public
 * rating instead of risking a bad public review, and gives Flow AI something
 * real to summarise and draft replies from.
 *
 * One feedback row per invoice (a bill is rated once; resubmitting updates
 * it, see publicBill.controller.js's ON CONFLICT).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS google_review_link TEXT`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_feedback (
      feedback_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(invoice_id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      reply_text TEXT,
      reply_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_feedback_business ON customer_feedback (business_id, created_at DESC)`);
};
