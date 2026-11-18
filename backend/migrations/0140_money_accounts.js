/*
 * Cash, bank and loan accounts (owner, 2026-11-18): where the business's money sits, so FlowXP can show a bank statement, a loan statement,
 * a trial balance and a balance sheet.
 *  - money_accounts: CASH (the drawer), BANK (each bank account) and LOAN (money owed to a lender; its opening balance is what is owed).
 *  - businesses.payment_accounts: which account each payment method lands in, e.g. {"CASH": 3, "UPI": 4, "CARD": 4}.
 *    Bill payments, supplier payments, expenses, other income and refunds already record a method, so they follow it with no change.
 *  - money_transfers: money moved by hand: cash put in the bank (TRANSFER), a loan received (LOAN_TAKEN: from the loan to a bank),
 *    a loan instalment (LOAN_REPAID: from a bank to the loan, plus interest that is an expense), money the owner put in (CAPITAL_IN)
 *    or took out (DRAWINGS). Voided, never deleted.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS money_accounts (
      account_id SERIAL PRIMARY KEY,
      business_id INT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('CASH','BANK','LOAN')),
      opening_balance_paise BIGINT NOT NULL DEFAULT 0,
      opening_date DATE NOT NULL,
      bank_name VARCHAR(80), account_last4 VARCHAR(4), ifsc VARCHAR(11),
      lender VARCHAR(120), interest_rate NUMERIC(5,2),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_money_accounts_name ON money_accounts (business_id, lower(name))`);
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_accounts JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS money_transfers (
      transfer_id SERIAL PRIMARY KEY,
      business_id INT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('TRANSFER','LOAN_TAKEN','LOAN_REPAID','CAPITAL_IN','DRAWINGS')),
      from_account_id INT REFERENCES money_accounts(account_id),
      to_account_id INT REFERENCES money_accounts(account_id),
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      interest_paise BIGINT NOT NULL DEFAULT 0 CHECK (interest_paise >= 0),
      transfer_date DATE NOT NULL,
      note VARCHAR(200),
      created_by INT REFERENCES users(user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TIMESTAMPTZ,
      CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
      CHECK (from_account_id IS DISTINCT FROM to_account_id)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_money_transfers_business ON money_transfers (business_id, transfer_date)`);
};
