-- Closing the smaller gaps: payments frozen like documents, the Discount given account for organizations made before it existed,
-- a numbering prefix per organization, the void date (so ageing can be worked out for a past date), and events that wait for
-- the document they depend on.

-- ---- payments and their allocations are frozen once posted: only the unapplied amount, status and journal link move
CREATE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'a payment cannot be deleted; void it' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'VOID' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'a void payment cannot change' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.organization_id, NEW.direction, NEW.number, NEW.party_id, NEW.pay_date, NEW.mode, NEW.amount_minor)
       IS DISTINCT FROM (OLD.organization_id, OLD.direction, OLD.number, OLD.party_id, OLD.pay_date, OLD.mode, OLD.amount_minor)
     OR (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'a posted payment cannot be edited; void it and record a new one' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();

CREATE FUNCTION payment_allocations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'an allocation cannot be deleted; void the payment instead' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.organization_id, NEW.source_type, NEW.source_id, NEW.document_id, NEW.amount_minor) IS DISTINCT FROM (OLD.organization_id, OLD.source_type, OLD.source_id, OLD.document_id, OLD.amount_minor)
     OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at) THEN
    RAISE EXCEPTION 'an allocation cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_allocations_guard BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocations_guard();

-- ---- the numbering prefix of sales invoices (up to three characters, so a number stays within the 16 the GST rules allow)
ALTER TABLE organizations ADD COLUMN invoice_prefix TEXT NOT NULL DEFAULT 'INV' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,3}$');
GRANT UPDATE (invoice_prefix) ON organizations TO flowbook_app;

-- ---- when an issued document was voided, for ageing at a past date
ALTER TABLE documents ADD COLUMN voided_on DATE;

-- ---- events that depend on a document that has not arrived yet wait for it, then run by themselves
ALTER TABLE integration_events DROP CONSTRAINT integration_events_status_check;
ALTER TABLE integration_events ADD CONSTRAINT integration_events_status_check
  CHECK (status IN ('RECEIVED', 'WAITING', 'POSTED', 'IGNORED_CUTOVER', 'IGNORED_UNSUPPORTED', 'FAILED_VALIDATION', 'NEEDS_ATTENTION'));
ALTER TABLE integration_events ADD COLUMN waiting_for TEXT;
CREATE INDEX integration_events_waiting ON integration_events (connection_id, waiting_for) WHERE status = 'WAITING';

-- ---- organizations made before "Discount given" existed get it now (their sales with a bill discount could not post without it)
DO $$
DECLARE o RECORD; chosen TEXT;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', o.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = 'DISCOUNT_GIVEN') THEN
      chosen := CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = '4150') THEN '4155' ELSE '4150' END;
      INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system) VALUES (o.id, chosen, 'Discount given', 'INCOME', 'C', 'DISCOUNT_GIVEN', true);
    END IF;
  END LOOP;
END $$;
