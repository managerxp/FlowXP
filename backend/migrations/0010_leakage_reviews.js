/*
 * What an owner did about a leakage finding. Findings themselves are computed
 * on read from sales, refunds, stock and audit data; only the human decision
 * ("looked at this", "not a concern") is stored, keyed by a stable fingerprint
 * such as "discounts:user:12".
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE leakage_reviews (
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      fingerprint VARCHAR(120) NOT NULL,
      status VARCHAR(12) NOT NULL CHECK (status IN ('REVIEWED','DISMISSED')),
      note TEXT,
      reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (business_id, fingerprint)
    )
  `);
};
