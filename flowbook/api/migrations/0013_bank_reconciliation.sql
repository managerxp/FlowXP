-- Bank reconciliation: statement lines imported for a ledger account (a bank, UPI or card account) and matched one-to-one with journal lines on that account.
-- amount_minor is signed from the account's point of view: a deposit is positive, a withdrawal negative.

CREATE TABLE bank_statement_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  account_id BIGINT NOT NULL,
  txn_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MATCHED', 'IGNORED')),
  journal_line_id BIGINT REFERENCES journal_lines(id),
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id) REFERENCES accounts (organization_id, id),
  UNIQUE (organization_id, account_id, dedupe_key),
  CHECK ((status = 'MATCHED') = (journal_line_id IS NOT NULL))
);
CREATE UNIQUE INDEX bank_statement_lines_one_match ON bank_statement_lines (journal_line_id) WHERE journal_line_id IS NOT NULL;
CREATE INDEX bank_statement_lines_open ON bank_statement_lines (organization_id, account_id, status, txn_date);

ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON bank_statement_lines USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_lines TO flowbook_app;
