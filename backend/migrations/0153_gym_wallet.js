/*
 * The gym member wallet: money a member pays in advance and later spends on their bills. An append-only ledger (a row is never changed or removed);
 * a member's balance is the sum of their rows and may never go below zero (the code checks it under a lock on the member).
 * A deposit is money held for the member, not income: it becomes a sale only when a bill is paid from it.
 * Forward only. To undo by hand: DROP TABLE gym_wallet_ledger; DROP FUNCTION gym_wallet_ledger_frozen().
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE gym_wallet_ledger (
      entry_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES gym_members(member_id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('DEPOSIT', 'SPEND', 'REFUND', 'RETURN')),
      amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
      method VARCHAR(20),
      reason VARCHAR(200),
      invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE SET NULL,
      payment_id INTEGER REFERENCES payments(payment_id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((kind IN ('DEPOSIT', 'RETURN') AND amount_paise > 0) OR (kind IN ('SPEND', 'REFUND') AND amount_paise < 0))
    )`);
  await client.query(`CREATE INDEX idx_gym_wallet_member ON gym_wallet_ledger (business_id, member_id, entry_id DESC)`);
  await client.query(`CREATE UNIQUE INDEX uq_gym_wallet_return ON gym_wallet_ledger (invoice_id) WHERE kind = 'RETURN'`);
  await client.query(`
    CREATE FUNCTION gym_wallet_ledger_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'The wallet ledger cannot be changed or deleted; post a correcting entry'; END $$`);
  await client.query(`
    CREATE TRIGGER gym_wallet_ledger_frozen BEFORE UPDATE OR DELETE ON gym_wallet_ledger
    FOR EACH ROW WHEN (current_setting('session_replication_role') <> 'replica' AND pg_trigger_depth() = 0)
    EXECUTE FUNCTION gym_wallet_ledger_frozen()`);
};
