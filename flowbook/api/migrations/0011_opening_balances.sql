-- What a customer owed you, or you owed a vendor, when you started using the books. It is a document (so it can be paid and shows on the
-- statement) but it is not a sale or a purchase: it never reaches GST returns or sales analysis, and it posts against an opening-balance account.

ALTER TABLE documents ADD COLUMN is_opening BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', o.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'OPENING_BALANCE') THEN
      INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
        VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '3900') THEN '3910' ELSE '3900' END, 'Opening balances', 'EQUITY', 'C', 'OPENING_BALANCE', true);
    END IF;
  END LOOP;
END $$;
