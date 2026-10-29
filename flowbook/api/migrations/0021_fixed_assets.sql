-- Fixed assets: a register of what the business owns and keeps for years, with depreciation posted month by month and a gain or loss when one is sold.

CREATE TABLE fixed_assets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  tag TEXT,
  category TEXT,
  purchase_date DATE NOT NULL,
  start_date DATE NOT NULL,                      -- depreciation begins in this month, a full month
  cost_minor BIGINT NOT NULL CHECK (cost_minor > 0),
  salvage_minor BIGINT NOT NULL DEFAULT 0 CHECK (salvage_minor >= 0),
  method TEXT NOT NULL CHECK (method IN ('SLM', 'WDV', 'NONE')),
  life_months INT CHECK (life_months BETWEEN 1 AND 1200),
  rate_bp INT CHECK (rate_bp BETWEEN 1 AND 10000),
  opening_accum_minor BIGINT NOT NULL DEFAULT 0 CHECK (opening_accum_minor >= 0),   -- depreciation already taken before it was entered here
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISPOSED', 'CANCELLED')),
  acquisition_entry_id BIGINT,
  disposed_on DATE,
  proceeds_minor BIGINT,
  disposal_entry_id BIGINT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (salvage_minor < cost_minor),
  CHECK (opening_accum_minor <= cost_minor - salvage_minor),
  CHECK ((method = 'SLM' AND life_months IS NOT NULL) OR (method = 'WDV' AND rate_bp IS NOT NULL) OR method = 'NONE')
);
CREATE UNIQUE INDEX fixed_assets_tag ON fixed_assets (organization_id, tag) WHERE tag IS NOT NULL;

CREATE TABLE asset_depreciation (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL,
  month DATE NOT NULL,                            -- the first day of the month depreciated
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  entry_id BIGINT NOT NULL,
  FOREIGN KEY (organization_id, asset_id) REFERENCES fixed_assets (organization_id, id),
  UNIQUE (asset_id, month)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fixed_assets', 'asset_depreciation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
                      WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON fixed_assets TO flowbook_app;
GRANT SELECT, INSERT ON asset_depreciation TO flowbook_app;

-- the accounts these post to, for businesses that already exist (new ones get them from the chart of accounts)
DO $$
DECLARE o RECORD; k TEXT; c TEXT; n TEXT; ty TEXT; nb TEXT;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', o.id::text, true);
    FOR k, c, n, ty, nb IN VALUES
      ('FIXED_ASSETS', '1500', 'Fixed assets', 'ASSET', 'D'),
      ('ACCUM_DEPRECIATION', '1590', 'Accumulated depreciation', 'ASSET', 'D'),
      ('DEPRECIATION', '5400', 'Depreciation', 'EXPENSE', 'D'),
      ('ASSET_SALE_GAIN_LOSS', '4400', 'Gain or loss on sale of assets', 'INCOME', 'C')
    LOOP
      IF NOT EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND system_key = k) THEN
        IF EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = c AND type = ty AND system_key IS NULL) THEN
          UPDATE accounts SET system_key = k, is_system = true WHERE organization_id = o.id AND code = c;
        ELSE
          INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system)
            VALUES (o.id, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE organization_id = o.id AND code = c) THEN c || '1' ELSE c END, n, ty, nb, k, true);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
