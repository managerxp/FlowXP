-- Foreign-currency bank accounts. An account holds a currency; its journal lines carry the amount in that currency beside the rupee value, so the
-- account's balance is known in both. The rupee value is what each deposit was booked at (spending takes it out at the average), and period-end
-- revaluation (fx.ts) restates it with a reversing entry that moves no foreign amount.
ALTER TABLE accounts ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE accounts ADD COLUMN is_bank BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE journal_lines ADD COLUMN foreign_amount_minor BIGINT CHECK (foreign_amount_minor > 0);
ALTER TABLE payments ADD COLUMN account_id BIGINT;

-- money moved between two of your own accounts: rupees to dollars, dollars back to rupees, or one bank to another
CREATE TABLE bank_transfers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  from_account_id BIGINT NOT NULL,
  to_account_id BIGINT NOT NULL,
  transfer_date DATE NOT NULL,
  from_amount_minor BIGINT NOT NULL CHECK (from_amount_minor > 0),   -- in the currency of the account it left
  to_amount_minor BIGINT NOT NULL CHECK (to_amount_minor > 0),       -- in the currency of the account it reached
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOID')),
  journal_entry_id BIGINT,
  idempotency_key TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, from_account_id) REFERENCES accounts (organization_id, id),
  FOREIGN KEY (organization_id, to_account_id) REFERENCES accounts (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  CHECK (from_account_id <> to_account_id)
);
ALTER TABLE bank_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON bank_transfers USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON bank_transfers TO flowbook_app;
