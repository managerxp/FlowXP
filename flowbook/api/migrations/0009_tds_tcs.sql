-- TDS on payments (a customer pays us less because they deducted tax at source; we pay a vendor less because we deduct it) and TCS on sales invoices.

ALTER TABLE payments ADD COLUMN tds_minor BIGINT NOT NULL DEFAULT 0 CHECK (tds_minor >= 0), ADD COLUMN tds_section TEXT;
-- the money moved is amount_minor; what it settles is amount_minor + tds_minor
DO $$ DECLARE k TEXT; BEGIN
  FOR k IN SELECT conname FROM pg_constraint WHERE conrelid = 'payments'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%unallocated_minor <= amount_minor%' LOOP
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', k);
  END LOOP;
END $$;
ALTER TABLE payments ADD CONSTRAINT payments_unallocated_check CHECK (unallocated_minor >= 0 AND unallocated_minor <= amount_minor + tds_minor);

CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'a payment cannot be deleted; void it' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'VOID' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'a void payment cannot change' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.organization_id, NEW.direction, NEW.number, NEW.party_id, NEW.pay_date, NEW.mode, NEW.amount_minor, NEW.tds_minor)
       IS DISTINCT FROM (OLD.organization_id, OLD.direction, OLD.number, OLD.party_id, OLD.pay_date, OLD.mode, OLD.amount_minor, OLD.tds_minor)
     OR (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'a posted payment cannot be edited; void it and record a new one' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE documents
  ADD COLUMN tcs_rate_bp INT NOT NULL DEFAULT 0 CHECK (tcs_rate_bp BETWEEN 0 AND 2000),
  ADD COLUMN tcs_minor BIGINT NOT NULL DEFAULT 0 CHECK (tcs_minor >= 0),
  ADD COLUMN tcs_section TEXT;

-- the accounts these post to, for businesses that already exist (new ones get them from the chart of accounts)
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', o.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'TDS_RECEIVABLE') THEN
      INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
        VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '1310') THEN '1311' ELSE '1310' END, 'TDS receivable', 'ASSET', 'D', 'TDS_RECEIVABLE', true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'TCS_PAYABLE') THEN
      INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
        VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '2410') THEN '2411' ELSE '2410' END, 'TCS payable', 'LIABILITY', 'C', 'TCS_PAYABLE', true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'TDS_PAYABLE') THEN
      IF EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '2400' AND type = 'LIABILITY') THEN
        UPDATE accounts SET system_key = 'TDS_PAYABLE', is_system = true WHERE organization_id = o.id AND code = '2400';
      ELSE
        INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
          VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '2401') THEN '2402' ELSE '2401' END, 'TDS payable', 'LIABILITY', 'C', 'TDS_PAYABLE', true);
      END IF;
    END IF;
  END LOOP;
END $$;
