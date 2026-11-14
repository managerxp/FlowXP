/* An invoice can carry a Cashfree payment link and, when it is for WhatsApp credit, the amount to load into the client's wallet the moment it is paid. */
export const up = async (client) => {
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS credit_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS credit_loaded BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS link_id VARCHAR(80)`);
  await client.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS payment_link_url TEXT`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_documents_link ON admin_documents (link_id) WHERE link_id IS NOT NULL`);
};
