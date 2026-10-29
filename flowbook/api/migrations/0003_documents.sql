-- Parties, items, tax rates, and the documents that post to the ledger: invoices, bills, credit notes and payments.

ALTER TABLE organizations ADD COLUMN gstin TEXT, ADD COLUMN state_code TEXT;

-- Rates are versioned by date and never hard-coded in the posting code: a document uses the latest rate whose
-- effective_from is on or before its date, and keeps the rate it used on each line.
CREATE TABLE tax_rates (
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate_bp INT NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  effective_from DATE NOT NULL,
  PRIMARY KEY (organization_id, code, effective_from)
);

CREATE TABLE parties (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK (kind IN ('CUSTOMER', 'VENDOR', 'BOTH')),
  name TEXT NOT NULL,
  gstin TEXT, pan TEXT, state_code TEXT, phone TEXT, email TEXT,
  credit_days INT NOT NULL DEFAULT 0 CHECK (credit_days BETWEEN 0 AND 365),
  active BOOLEAN NOT NULL DEFAULT true,
  external_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX parties_gstin ON parties (organization_id, gstin) WHERE gstin IS NOT NULL;
CREATE UNIQUE INDEX parties_external ON parties (organization_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'GOODS' CHECK (kind IN ('GOODS', 'SERVICE')),
  hsn_sac TEXT,
  tax_code TEXT,
  sale_price_minor BIGINT NOT NULL DEFAULT 0 CHECK (sale_price_minor >= 0),
  purchase_price_minor BIGINT NOT NULL DEFAULT 0 CHECK (purchase_price_minor >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, sku)
);

CREATE TABLE documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK (kind IN ('INVOICE', 'BILL', 'CREDIT_NOTE')),
  number TEXT,
  supplier_ref TEXT,
  party_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'VOID')),
  issue_date DATE NOT NULL,
  due_date DATE,
  place_of_supply TEXT,
  inter_state BOOLEAN NOT NULL DEFAULT false,
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  round_off_on BOOLEAN NOT NULL DEFAULT false,
  round_off_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  related_document_id BIGINT,
  journal_entry_id BIGINT,
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id),
  FOREIGN KEY (organization_id, related_document_id) REFERENCES documents (organization_id, id),
  CHECK (balance_minor >= 0 AND balance_minor <= total_minor),
  CHECK ((status = 'DRAFT') = (number IS NULL) OR status = 'VOID')
);
CREATE UNIQUE INDEX documents_number ON documents (organization_id, kind, number) WHERE number IS NOT NULL;
CREATE INDEX documents_party ON documents (organization_id, party_id, kind, status);

CREATE TABLE document_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL,
  line_no INT NOT NULL,
  item_id BIGINT,
  description TEXT NOT NULL,
  hsn_sac TEXT,
  quantity_milli BIGINT NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  taxable_minor BIGINT NOT NULL CHECK (taxable_minor >= 0),
  tax_code TEXT NOT NULL,
  tax_rate_bp INT NOT NULL,
  tax_minor BIGINT NOT NULL CHECK (tax_minor >= 0),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id),
  UNIQUE (document_id, line_no)
);

CREATE TABLE payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  number TEXT NOT NULL,
  party_id BIGINT NOT NULL,
  pay_date DATE NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('CASH', 'BANK', 'UPI', 'CARD')),
  reference TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  unallocated_minor BIGINT NOT NULL CHECK (unallocated_minor >= 0 AND unallocated_minor <= amount_minor),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOID')),
  journal_entry_id BIGINT,
  idempotency_key TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, number),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);
CREATE UNIQUE INDEX payments_idem ON payments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE payment_allocations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('PAYMENT', 'CREDIT_NOTE')),
  source_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  voided_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id)
);
CREATE INDEX payment_allocations_doc ON payment_allocations (organization_id, document_id);

-- an issued document's money and parties are frozen; only its balance, status and journal link move (accounting-rules I2)
CREATE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'only a draft can be deleted' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'VOID' THEN RAISE EXCEPTION 'a void document cannot change' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'ISSUED' AND (NEW.party_id, NEW.number, NEW.kind, NEW.issue_date, NEW.total_minor, NEW.tax_minor, NEW.subtotal_minor, NEW.inter_state)
        IS DISTINCT FROM (OLD.party_id, OLD.number, OLD.kind, OLD.issue_date, OLD.total_minor, OLD.tax_minor, OLD.subtotal_minor, OLD.inter_state) THEN
    RAISE EXCEPTION 'an issued document cannot be edited; void it and make a new one' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION documents_guard();

CREATE FUNCTION document_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT; did BIGINT;
BEGIN
  did := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
  SELECT status INTO st FROM documents WHERE id = did;
  IF st <> 'DRAFT' THEN RAISE EXCEPTION 'lines of an issued document cannot change' USING ERRCODE = 'P0001'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER document_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON document_lines FOR EACH ROW EXECUTE FUNCTION document_lines_guard();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_rates', 'parties', 'items', 'documents', 'document_lines', 'payments', 'payment_allocations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON tax_rates, parties, items, payments, payment_allocations TO flowbook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents, document_lines TO flowbook_app;
GRANT UPDATE (state_code, gstin, legal_name, pan) ON organizations TO flowbook_app;
CREATE POLICY tenant_update ON organizations FOR UPDATE USING (id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                                                   WITH CHECK (id = NULLIF(current_setting('app.org_id', true), '')::bigint);
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO flowbook_app;
