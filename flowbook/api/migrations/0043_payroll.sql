-- ---- payroll: people on a salary, and a monthly run that posts to the books (any kind of business).
-- A run is made from each person's monthly pay and the days they were away; it has three journals: the salary (when the run is posted), paying the staff, and depositing PF, ESI, professional tax and TDS.
CREATE TABLE payroll_employees (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  designation TEXT,
  monthly_pay_minor BIGINT NOT NULL CHECK (monthly_pay_minor >= 0),
  basic_minor BIGINT CHECK (basic_minor IS NULL OR basic_minor >= 0),
  pf BOOLEAN NOT NULL DEFAULT FALSE,
  esi BOOLEAN NOT NULL DEFAULT FALSE,
  pt_minor BIGINT NOT NULL DEFAULT 0 CHECK (pt_minor >= 0),
  tds_minor BIGINT NOT NULL DEFAULT 0 CHECK (tds_minor >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE TABLE payroll_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  entry_id BIGINT,
  paid_entry_id BIGINT,
  dues_entry_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, month),
  UNIQUE (organization_id, id)
);
CREATE TABLE payroll_run_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  days_in_month INT NOT NULL,
  days_away NUMERIC(5, 1) NOT NULL DEFAULT 0,
  bonus_minor BIGINT NOT NULL DEFAULT 0,
  gross_minor BIGINT NOT NULL,
  pf_employee_minor BIGINT NOT NULL DEFAULT 0,
  pf_employer_minor BIGINT NOT NULL DEFAULT 0,
  pf_admin_minor BIGINT NOT NULL DEFAULT 0,
  esi_employee_minor BIGINT NOT NULL DEFAULT 0,
  esi_employer_minor BIGINT NOT NULL DEFAULT 0,
  pt_minor BIGINT NOT NULL DEFAULT 0,
  tds_minor BIGINT NOT NULL DEFAULT 0,
  net_minor BIGINT NOT NULL,
  UNIQUE (run_id, employee_id),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_runs (organization_id, id) ON DELETE CASCADE
);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_employees', 'payroll_runs', 'payroll_run_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_employees, payroll_runs, payroll_run_lines TO flowbook_app;
