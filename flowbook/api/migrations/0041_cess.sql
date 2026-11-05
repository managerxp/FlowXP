-- Compensation cess (GST cess): a percentage of the taxable value, on top of GST, for goods like tobacco, aerated drinks and some vehicles.
-- It is its own line on a document and its own ledger account, never mixed into CGST/SGST/IGST. A specific (per piece or per thousand) cess is not covered.
ALTER TABLE items ADD COLUMN cess_rate_bp INT NOT NULL DEFAULT 0 CHECK (cess_rate_bp BETWEEN 0 AND 100000);
ALTER TABLE document_lines ADD COLUMN cess_rate_bp INT NOT NULL DEFAULT 0 CHECK (cess_rate_bp BETWEEN 0 AND 100000),
                           ADD COLUMN cess_minor BIGINT NOT NULL DEFAULT 0 CHECK (cess_minor >= 0);
ALTER TABLE documents ADD COLUMN cess_minor BIGINT NOT NULL DEFAULT 0 CHECK (cess_minor >= 0);

-- the accounts it posts to, for businesses that already exist (new ones get them from the chart of accounts)
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', o.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'INPUT_CESS') THEN
      INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
        VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '1303') THEN '1304' ELSE '1303' END, 'Input cess', 'ASSET', 'D', 'INPUT_CESS', true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'OUTPUT_CESS') THEN
      INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
        VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '2103') THEN '2104' ELSE '2103' END, 'Output cess', 'LIABILITY', 'C', 'OUTPUT_CESS', true);
    END IF;
  END LOOP;
END $$;
