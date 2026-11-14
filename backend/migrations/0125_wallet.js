/* WhatsApp credit: a rupee wallet per business, topped up by the Super Admin, spent one message at a time. The ledger is the history; businesses.wallet_paise is the running balance. */
export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS wallet_paise BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS charge_paise INTEGER NOT NULL DEFAULT 0`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      entry_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      amount_paise BIGINT NOT NULL,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('TOPUP','MESSAGE','ADJUST')),
      message_id INTEGER,
      note VARCHAR(200),
      balance_after_paise BIGINT NOT NULL,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_ledger_business ON wallet_ledger (business_id, entry_id DESC)`);
};
