/*
 * Internal support notes on a business, written by platform admins ("called, wants the Pro plan after the trial"). Never shown to the business.
 * Deleted with the business. Forward only.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_notes (
      note_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      note VARCHAR(1000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_notes_business ON admin_notes (business_id, created_at DESC)`);
};
