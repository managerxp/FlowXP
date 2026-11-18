/*
 * Payroll in the books (owner, 2026-11-18): paying a payroll run records a "Salaries" expense for what was paid to the staff, depositing PF, ESI, professional tax and TDS
 * records a "Payroll taxes and contributions" expense, and an advance given to a person is recorded as a "Staff advances" expense. Each keeps the id of its expense so
 * nothing is recorded twice. Expenses already feed the dashboard, profit and loss and the cash and bank accounts.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS salary_expense_id INT REFERENCES expenses(expense_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS dues_expense_id INT REFERENCES expenses(expense_id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS dues_paid_on DATE`);
  await client.query(`ALTER TABLE payroll_loans ADD COLUMN IF NOT EXISTS expense_id INT REFERENCES expenses(expense_id) ON DELETE SET NULL`);
  /* the add-on has no price until the owner sets one in the Super Admin */
  await client.query(`UPDATE addons SET price_monthly_paise = 0, price_yearly_paise = 0 WHERE addon_key = 'payroll' AND price_monthly_paise = 49900 AND price_yearly_paise = 499000`);
};
