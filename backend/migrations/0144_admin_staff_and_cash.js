/* Super admin: payments collected outside the gateway (cash, UPI, bank) marked against a payment link, and staff logins with a role. */
export const up = async (client) => {
  for (const t of ['subscription_orders', 'addon_orders']) {
    await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS paid_method VARCHAR(20)`);
    await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS paid_note VARCHAR(200)`);
    await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS paid_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ`);
  }
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role VARCHAR(20)`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_disabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`UPDATE users SET admin_role = 'OWNER' WHERE is_super_admin AND admin_role IS NULL`);
};
