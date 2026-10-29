-- Projects: work done for a customer, with hours logged against it, bills and expenses tagged to it, and an invoice made from the unbilled hours.

CREATE TABLE projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  code TEXT,
  party_id BIGINT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  hourly_rate_minor BIGINT NOT NULL DEFAULT 0 CHECK (hourly_rate_minor >= 0),
  budget_minor BIGINT NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES parties (organization_id, id)
);
CREATE UNIQUE INDEX projects_code ON projects (organization_id, code) WHERE code IS NOT NULL;

CREATE TABLE time_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  work_date DATE NOT NULL,
  minutes INT NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  notes TEXT,
  billable BOOLEAN NOT NULL DEFAULT true,
  rate_minor BIGINT NOT NULL DEFAULT 0 CHECK (rate_minor >= 0),   -- the hourly rate when the time was logged
  invoice_id BIGINT,                                              -- the invoice (or draft) this time was billed on
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id)
);
CREATE INDEX time_entries_project ON time_entries (organization_id, project_id, work_date);

-- an expense is a journal entry, which never changes, so its project is kept beside it
CREATE TABLE project_expenses (
  organization_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  entry_id BIGINT NOT NULL,
  PRIMARY KEY (organization_id, entry_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  FOREIGN KEY (organization_id, entry_id) REFERENCES journal_entries (organization_id, id)
);

ALTER TABLE documents ADD COLUMN project_id BIGINT;
ALTER TABLE documents ADD CONSTRAINT documents_project_fk FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'time_entries', 'project_expenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON projects TO flowbook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO flowbook_app;
GRANT SELECT, INSERT ON project_expenses TO flowbook_app;
