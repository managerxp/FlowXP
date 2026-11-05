/*
 * The garage's day at a glance: what the owner opens the app to see. Counts of vehicles by stage, what came in and went out today, what customers still owe, and the vehicles in the garage now.
 * It reads the job cards, bills, expenses and payments the garage already keeps; "today" is the server's calendar day for the outlet scope.
 * Cash in hand here is today's cash in minus today's cash out; the opening balance joins it when Close Today exists.
 */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = async (db, tenant, now = new Date()) => {
  const day = iso(now);
  const scoped = tenant.scopeBranchId != null;
  const scope = scoped ? ' AND j.branch_id = $3' : '';
  const args = [tenant.businessId, day]; if (scoped) args.push(tenant.scopeBranchId);
  const c = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE j.opened_at::date = $2::date AND j.status <> 'CANCELLED')::int AS received_today,
            COUNT(*) FILTER (WHERE j.status IN ('OPEN','CHECKING','IN_PROGRESS','WAITING_PARTS'))::int AS in_progress,
            COUNT(*) FILTER (WHERE j.status = 'READY')::int AS ready,
            COUNT(*) FILTER (WHERE j.delivered_at::date = $2::date)::int AS delivered_today
       FROM job_cards j WHERE j.business_id = $1${scope}`, args)).rows[0];

  const pScope = scoped ? ' AND branch_id = $3' : '';
  const collected = (await db.query(
    `SELECT COALESCE(SUM(amount_paise), 0) AS total,
            COALESCE(SUM(amount_paise) FILTER (WHERE payment_method = 'CASH'), 0) AS cash
       FROM payments WHERE business_id = $1 AND payment_date = $2::date AND supplier_id IS NULL AND po_id IS NULL AND payment_method <> 'CREDIT'${pScope}`, args)).rows[0];
  const other = (await db.query(
    `SELECT COALESCE(SUM(amount_paise), 0) AS total, COALESCE(SUM(amount_paise) FILTER (WHERE payment_method = 'CASH'), 0) AS cash
       FROM other_income WHERE business_id = $1 AND income_date = $2::date${pScope}`, args)).rows[0];
  const spent = (await db.query(
    `SELECT COALESCE(SUM(amount_paise), 0) AS total, COALESCE(SUM(amount_paise) FILTER (WHERE payment_method = 'CASH'), 0) AS cash FROM (
        SELECT amount_paise, payment_method FROM expenses WHERE business_id = $1 AND expense_date = $2::date${pScope}
        UNION ALL
        SELECT amount_paise, payment_method FROM payments WHERE business_id = $1 AND payment_date = $2::date AND (po_id IS NOT NULL OR supplier_id IS NOT NULL)${pScope}) x`, args)).rows[0];

  const one = scoped ? [tenant.businessId, tenant.scopeBranchId] : [tenant.businessId];
  const dues = (await db.query(
    `SELECT COALESCE(SUM(balance_due_paise), 0) AS total, COUNT(DISTINCT customer_id)::int AS customers
       FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND balance_due_paise > 0${scoped ? ' AND branch_id = $2' : ''}`, one)).rows[0];

  const work = (await db.query(
    `SELECT j.job_id, j.job_no, j.status, j.vehicle_reg, j.make, j.model, j.promised_on::text AS promised_on, j.opened_at, c.name AS customer_name
       FROM job_cards j LEFT JOIN customers c ON c.customer_id = j.customer_id
      WHERE j.business_id = $1 AND j.status IN ('OPEN','CHECKING','IN_PROGRESS','WAITING_PARTS','READY')${scoped ? ' AND j.branch_id = $2' : ''}
      ORDER BY CASE j.status WHEN 'READY' THEN 0 ELSE 1 END, j.promised_on NULLS LAST, j.opened_at DESC LIMIT 30`, one)).rows;

  const cashIn = Number(collected.cash) + Number(other.cash);
  return {
    day, ...c,
    collected_paise: Number(collected.total) + Number(other.total), cash_collected_paise: cashIn,
    spent_paise: Number(spent.total), cash_in_hand_paise: cashIn - Number(spent.cash),
    customer_due_paise: Number(dues.total), customers_owing: dues.customers,
    work
  };
};
