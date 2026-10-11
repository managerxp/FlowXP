/*
 * Account deletion. A person can delete their own account (Google Play and good practice both require a way), or ask for it when they cannot sign in.
 *
 * Deleting a person never deletes a business's records: the bills, stock and customers belong to the business. The person's own details are wiped from their user row
 * (name, email, phone, password, 2FA, PIN) and they are removed from every business; the user row itself stays so old bills still say "made by a former team member".
 * Someone who is the only owner of a business cannot simply vanish from it: that becomes a request FlowXP support handles (closing the business or handing it over).
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS deletion_requests (
      request_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      email VARCHAR(255) NOT NULL,
      source VARCHAR(12) NOT NULL DEFAULT 'WEBSITE',
      note TEXT,
      status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','DECLINED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handled_at TIMESTAMPTZ,
      handled_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      handled_note TEXT
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests (status, created_at)`);
};
