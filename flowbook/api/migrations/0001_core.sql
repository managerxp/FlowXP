-- FlowBook core: organizations, chart of accounts, periods, journals, audit.
-- Rules live in the database as well as in code (docs/accounting-rules.md I1 to I10): a bug in the app
-- must not be able to unbalance the books, edit a posted entry, or read another organization's rows.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowbook_app') THEN CREATE ROLE flowbook_app NOLOGIN; END IF;
END $$;

CREATE TABLE organizations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  pan TEXT,
  base_currency CHAR(3) NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  fy_start_month SMALLINT NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE financial_years (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  CHECK (end_date > start_date),
  UNIQUE (organization_id, id),
  EXCLUDE USING gist (organization_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE accounting_periods (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  financial_year_id BIGINT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SOFT_LOCKED', 'CLOSED')),
  CHECK (end_date >= start_date),
  FOREIGN KEY (organization_id, financial_year_id) REFERENCES financial_years (organization_id, id),
  UNIQUE (organization_id, id),
  EXCLUDE USING gist (organization_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
  normal_balance CHAR(1) NOT NULL CHECK (normal_balance IN ('D', 'C')),
  system_key TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);
CREATE UNIQUE INDEX accounts_system_key ON accounts (organization_id, system_key) WHERE system_key IS NOT NULL;

-- gapless per-organization numbering: the row lock on UPDATE serialises concurrent callers
CREATE TABLE document_sequences (
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  key TEXT NOT NULL,
  next_value BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, key)
);

CREATE TABLE journal_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  entry_no TEXT NOT NULL,
  posting_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  memo TEXT,
  reverses_entry_id BIGINT,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  fx_rate NUMERIC(18, 8) NOT NULL DEFAULT 1,
  rules_version INT NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ,
  CHECK ((status = 'POSTED') = (posted_at IS NOT NULL)),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, entry_no),
  FOREIGN KEY (organization_id, reverses_entry_id) REFERENCES journal_entries (organization_id, id)
);
CREATE UNIQUE INDEX journal_entries_one_reversal ON journal_entries (organization_id, reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX journal_entries_date ON journal_entries (organization_id, posting_date);

CREATE TABLE journal_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  entry_id BIGINT NOT NULL,
  line_no INT NOT NULL,
  account_id BIGINT NOT NULL,
  side CHAR(1) NOT NULL CHECK (side IN ('D', 'C')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor > 0),
  party_id BIGINT,
  branch_id BIGINT,
  tax_rate_bp INT,
  memo TEXT,
  FOREIGN KEY (organization_id, entry_id) REFERENCES journal_entries (organization_id, id),
  FOREIGN KEY (organization_id, account_id) REFERENCES accounts (organization_id, id),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX journal_lines_account ON journal_lines (organization_id, account_id);

-- one row per (source document, kind): the guard that stops a retry or a duplicate event posting twice
CREATE TABLE posting_register (
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  source_system TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  posting_kind TEXT NOT NULL,
  entry_id BIGINT,
  PRIMARY KEY (organization_id, source_system, source_type, source_id, posting_kind)
);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org ON audit_log (organization_id, id);

-- ---------------------------------------------------------------- triggers

-- A DRAFT entry may be turned into POSTED once, and only if it has two or more lines that balance.
-- A POSTED entry can never be changed or deleted (I1, I2).
CREATE FUNCTION journal_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d BIGINT; c BIGINT; n INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN RAISE EXCEPTION 'posted journal entries cannot be deleted' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'POSTED' THEN RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE = 'P0001'; END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT COALESCE(SUM(base_amount_minor) FILTER (WHERE side = 'D'), 0),
           COALESCE(SUM(base_amount_minor) FILTER (WHERE side = 'C'), 0), COUNT(*)
      INTO d, c, n FROM journal_lines WHERE entry_id = NEW.id;
    IF n < 2 THEN RAISE EXCEPTION 'a journal entry needs at least two lines' USING ERRCODE = 'P0001'; END IF;
    IF d <> c THEN RAISE EXCEPTION 'journal entry is not balanced: debits % credits %', d, c USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entries_guard BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_guard();

-- lines of a posted entry are frozen, and nothing can be added to one
CREATE FUNCTION journal_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT; eid BIGINT;
BEGIN
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  SELECT status INTO st FROM journal_entries WHERE id = eid;
  IF st = 'POSTED' THEN RAISE EXCEPTION 'lines of a posted journal entry are immutable' USING ERRCODE = 'P0001'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_guard();

CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'the audit log is append-only' USING ERRCODE = 'P0001'; END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- ---------------------------------------------------------------- tenant isolation (D-06)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_years', 'accounting_periods', 'accounts', 'document_sequences', 'journal_entries',
                           'journal_lines', 'posting_register', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON organizations FOR SELECT USING (id = NULLIF(current_setting('app.org_id', true), '')::bigint);

-- the application role: no DELETE on anything that is evidence, UPDATE only where a workflow needs it
GRANT SELECT ON organizations TO flowbook_app;
GRANT SELECT, INSERT, UPDATE ON financial_years, accounting_periods, accounts, document_sequences, posting_register TO flowbook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries, journal_lines TO flowbook_app;
GRANT SELECT, INSERT ON audit_log TO flowbook_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO flowbook_app;
