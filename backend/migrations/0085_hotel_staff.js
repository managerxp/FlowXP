/*
 * Staff management for a hotel: the people who work there (not the same as the people who sign in to FlowXP, though one can be linked to the other), their departments and
 * shifts, a weekly roster, daily attendance, leave, and a monthly payroll sheet. Also who is assigned to clean which room each day.
 *
 *   hr_departments    Front office, Housekeeping, Kitchen...
 *   hr_employees      one row per person, with the pay they are on
 *   hr_shifts         Morning, Evening, Night
 *   hr_roster         who works which shift on which day (no shift = day off)
 *   hr_attendance     what actually happened each day
 *   hr_leaves         leave asked for and decided
 *   hr_payroll_runs   one run per month, a draft until it is finalised
 *   hr_payslips       each employee's pay for the run, worked out from attendance and then adjustable by hand while it is a draft
 *   hk_assignments    a room given to a housekeeper for a day
 * This is a payroll SHEET: salary, days worked, overtime, allowances and deductions. It does not work out PF, ESI, professional tax or TDS.
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_departments (
      dept_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(60) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (branch_id, name)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_shifts (
      shift_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      name VARCHAR(40) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (branch_id, name)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_employees (
      employee_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      emp_code VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(20),
      email VARCHAR(255),
      dept_id INTEGER REFERENCES hr_departments(dept_id) ON DELETE SET NULL,
      designation VARCHAR(80),
      joined_on DATE,
      left_on DATE,
      status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      pay_type VARCHAR(8) NOT NULL DEFAULT 'MONTHLY' CHECK (pay_type IN ('MONTHLY','DAILY')),
      salary_paise BIGINT NOT NULL DEFAULT 0 CHECK (salary_paise >= 0),
      weekly_off SMALLINT CHECK (weekly_off IS NULL OR weekly_off BETWEEN 0 AND 6),
      default_shift_id INTEGER REFERENCES hr_shifts(shift_id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      id_type VARCHAR(24),
      id_number VARCHAR(40),
      address TEXT,
      emergency_contact VARCHAR(160),
      bank_account VARCHAR(40),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, emp_code)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hr_employees_branch ON hr_employees (branch_id, status)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_roster (
      roster_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      shift_id INTEGER REFERENCES hr_shifts(shift_id) ON DELETE SET NULL,
      UNIQUE (employee_id, work_date)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hr_roster_branch_date ON hr_roster (branch_id, work_date)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_attendance (
      att_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      status VARCHAR(12) NOT NULL CHECK (status IN ('PRESENT','ABSENT','HALF_DAY','LEAVE','UNPAID_LEAVE','WEEKLY_OFF','HOLIDAY')),
      in_time TIME,
      out_time TIME,
      overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
      note VARCHAR(200),
      marked_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      marked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, work_date)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hr_attendance_branch_date ON hr_attendance (branch_id, work_date)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_leaves (
      leave_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('CASUAL','SICK','PAID','UNPAID')),
      status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
      reason VARCHAR(300),
      requested_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      decided_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (to_date >= from_date)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_payroll_runs (
      run_id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      month CHAR(7) NOT NULL,
      status VARCHAR(8) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
      overtime_factor NUMERIC(4,2) NOT NULL DEFAULT 1.5,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finalized_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      finalized_at TIMESTAMPTZ,
      UNIQUE (branch_id, month)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS hr_payslips (
      payslip_id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES hr_payroll_runs(run_id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      pay_type VARCHAR(8) NOT NULL,
      salary_paise BIGINT NOT NULL,
      days_in_month SMALLINT NOT NULL,
      days_present NUMERIC(5,1) NOT NULL DEFAULT 0,
      days_paid_leave NUMERIC(5,1) NOT NULL DEFAULT 0,
      days_weekly_off SMALLINT NOT NULL DEFAULT 0,
      days_unpaid NUMERIC(5,1) NOT NULL DEFAULT 0,
      days_unmarked SMALLINT NOT NULL DEFAULT 0,
      overtime_minutes INTEGER NOT NULL DEFAULT 0,
      base_pay_paise BIGINT NOT NULL DEFAULT 0,
      overtime_pay_paise BIGINT NOT NULL DEFAULT 0,
      allowances_paise BIGINT NOT NULL DEFAULT 0,
      deductions_paise BIGINT NOT NULL DEFAULT 0,
      net_pay_paise BIGINT NOT NULL DEFAULT 0,
      note VARCHAR(200),
      UNIQUE (run_id, employee_id)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS hk_assignments (
      assignment_id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      UNIQUE (room_id, work_date)
    )`);
};
