-- Multi-currency: invoices and bills may be written in a foreign currency. The books stay in rupees, converted at the document's rate; the foreign
-- amount is kept beside it. When the money arrives, the rupees that settle the document and the rupees that hit the bank differ by an exchange gain or loss.

CREATE TABLE exchange_rates (
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  currency CHAR(3) NOT NULL,
  rate_date DATE NOT NULL,
  rate NUMERIC(18, 6) NOT NULL CHECK (rate > 0),   -- rupees for one unit of the currency
  PRIMARY KEY (organization_id, currency, rate_date)
);
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON exchange_rates USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE ON exchange_rates TO flowbook_app;

ALTER TABLE documents ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE documents ADD COLUMN fx_rate NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (fx_rate > 0);
ALTER TABLE documents ADD COLUMN foreign_total_minor BIGINT;
ALTER TABLE documents ADD COLUMN foreign_balance_minor BIGINT;
ALTER TABLE documents ADD CONSTRAINT documents_foreign_check CHECK ((currency = 'INR') = (foreign_total_minor IS NULL));

ALTER TABLE document_lines ADD COLUMN unit_price_fc_minor BIGINT;
ALTER TABLE document_lines ADD COLUMN discount_fc_minor BIGINT;

ALTER TABLE payments ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE payments ADD COLUMN foreign_amount_minor BIGINT;
-- what the receivable (or payable) it settles is worth, minus the rupees that moved: positive when the document was worth more than the cash
ALTER TABLE payments ADD COLUMN fx_settle_adj_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payments DROP CONSTRAINT payments_unallocated_check;
ALTER TABLE payments ADD CONSTRAINT payments_unallocated_check CHECK (unallocated_minor >= 0 AND unallocated_minor <= amount_minor + tds_minor + fx_settle_adj_minor);

ALTER TABLE payment_allocations ADD COLUMN foreign_minor BIGINT;

-- the existing "Exchange gain" income account becomes the one gains and losses post to (a loss is a debit to it)
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', o.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'EXCHANGE_GAIN_LOSS') THEN
      IF EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '4300' AND type = 'INCOME' AND system_key IS NULL) THEN
        UPDATE accounts SET system_key = 'EXCHANGE_GAIN_LOSS', is_system = true, name = 'Exchange gain or loss' WHERE organization_id = o.id AND code = '4300';
      ELSE
        INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
          VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '4310') THEN '4311' ELSE '4310' END, 'Exchange gain or loss', 'INCOME', 'C', 'EXCHANGE_GAIN_LOSS', true);
      END IF;
    END IF;
  END LOOP;
END $$;
