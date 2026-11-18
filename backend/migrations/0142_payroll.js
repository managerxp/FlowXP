/*
 * Payroll add-on (owner, 2026-11-18): a complete payroll on top of the staff, attendance and leave records (hr_*), for every kind of business.
 *  - payroll_settings: per business, what is switched on (PF, ESI, professional tax) and its rates and ceilings.
 *  - payroll_pt_slabs: the business's professional tax slabs (monthly pay from..to, tax, and the February tax). A state's usual slabs are one tap to fill in.
 *  - payroll_profiles: per employee, how the salary splits (basic, HRA, the rest) and which deductions apply, plus PAN, UAN, ESI number, IFSC and a monthly TDS.
 *  - payroll_loans: advances and loans recovered by instalment from the salary.
 *  - hr_payslips / hr_payroll_runs: the new columns for the statutory amounts, loan recovery and when the run was paid.
 *  - The add-on itself (key "payroll"): free on every trial, then switched on per business or bought with a payment link. Its price is set later in the Super Admin (0 until then).
 *    The Enterprise plan includes it.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payroll_settings (
      business_id INT PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      pf_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      pf_cap_on_ceiling BOOLEAN NOT NULL DEFAULT TRUE,
      pf_ceiling_paise BIGINT NOT NULL DEFAULT 1500000,
      esi_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      esi_ceiling_paise BIGINT NOT NULL DEFAULT 2100000,
      pt_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      pt_state VARCHAR(60),
      default_basic_pct NUMERIC(5,2) NOT NULL DEFAULT 50,
      overtime_factor NUMERIC(4,2) NOT NULL DEFAULT 1.5,
      establishment_pf_code VARCHAR(30),
      establishment_esi_code VARCHAR(30),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS payroll_pt_slabs (
      slab_id SERIAL PRIMARY KEY,
      business_id INT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      from_paise BIGINT NOT NULL CHECK (from_paise >= 0),
      to_paise BIGINT CHECK (to_paise IS NULL OR to_paise >= from_paise),
      tax_paise BIGINT NOT NULL CHECK (tax_paise >= 0),
      february_paise BIGINT CHECK (february_paise IS NULL OR february_paise >= 0)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_payroll_pt_slabs_business ON payroll_pt_slabs (business_id, from_paise)`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS payroll_profiles (
      employee_id INT PRIMARY KEY REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      business_id INT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      basic_paise BIGINT CHECK (basic_paise IS NULL OR basic_paise >= 0),
      hra_paise BIGINT NOT NULL DEFAULT 0 CHECK (hra_paise >= 0),
      pf_applicable BOOLEAN NOT NULL DEFAULT FALSE,
      esi_applicable BOOLEAN NOT NULL DEFAULT FALSE,
      pt_applicable BOOLEAN NOT NULL DEFAULT TRUE,
      pan VARCHAR(10), uan VARCHAR(12), esi_number VARCHAR(17), ifsc VARCHAR(11),
      gender VARCHAR(1) CHECK (gender IS NULL OR gender IN ('M','F')),
      tds_monthly_paise BIGINT NOT NULL DEFAULT 0 CHECK (tds_monthly_paise >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS payroll_loans (
      loan_id SERIAL PRIMARY KEY,
      business_id INT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      kind VARCHAR(8) NOT NULL DEFAULT 'ADVANCE' CHECK (kind IN ('ADVANCE','LOAN')),
      principal_paise BIGINT NOT NULL CHECK (principal_paise > 0),
      emi_paise BIGINT NOT NULL CHECK (emi_paise > 0),
      recovered_paise BIGINT NOT NULL DEFAULT 0,
      taken_on DATE NOT NULL,
      note VARCHAR(200),
      status VARCHAR(8) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_payroll_loans_employee ON payroll_loans (employee_id, status)`);

  for (const c of ['basic_paise', 'hra_paise', 'pf_employee_paise', 'pf_employer_paise', 'pf_admin_paise', 'esi_employee_paise', 'esi_employer_paise', 'pt_paise', 'tds_paise', 'loan_recovery_paise', 'gross_paise', 'pf_wages_paise']) {
    await client.query(`ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS ${c} BIGINT NOT NULL DEFAULT 0`);
  }
  await client.query(`ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS paid_on DATE`);
  await client.query(`ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS paid_via VARCHAR(8)`);

  /* the add-on, unpriced for now (the owner sets it in the Super Admin); offered to every kind of business */
  const types = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING', 'RETAIL', 'SUPERMARKET', 'PHARMACY', 'ELECTRONICS', 'CLOTHING', 'SERVICES', 'AUTO_PARTS', 'MECHANIC', 'WHOLESALE', 'DISTRIBUTOR', 'SALON', 'GYM', 'OTHER'];
  await client.query(
    `INSERT INTO addons (addon_key, name, description, price_monthly_paise, price_yearly_paise, is_active, sort_order, business_types)
     VALUES ('payroll', 'Payroll', 'Salary sheets with PF, ESI, professional tax and TDS, payslips, loans and advances, and the bank, PF and ESI files', 0, 0, TRUE, 90, $1)
     ON CONFLICT (addon_key) DO UPDATE SET
       price_monthly_paise = CASE WHEN addons.price_monthly_paise = 0 THEN EXCLUDED.price_monthly_paise ELSE addons.price_monthly_paise END,
       price_yearly_paise = CASE WHEN addons.price_yearly_paise = 0 THEN EXCLUDED.price_yearly_paise ELSE addons.price_yearly_paise END`, [types]
  );

  /* the Enterprise plan includes it, for every kind of business */
  for (const type of types) {
    await client.query(
      `INSERT INTO business_type_features (business_type, plan_code, feature_flags) VALUES ($1, 'ENTERPRISE', '{"payroll": true}'::jsonb)
       ON CONFLICT (business_type, plan_code) DO UPDATE SET feature_flags = business_type_features.feature_flags || '{"payroll": true}'::jsonb`, [type]
    );
  }
};
