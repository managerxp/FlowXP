/*
 * Staff commission: see what each person has earned, approve it, and pay it out.
 *
 * The rows come from billing (modules/salon/commission.js). Approving moves a person's PENDING rows for a period
 * to APPROVED; paying groups their APPROVED rows into one payout, marks them PAID and (unless told not to) records
 * the payout as a "Commission" expense against the outlet, so the profit report counts it. Negative rows (a
 * cancelled bill whose commission had already been paid) net off inside the payout; a payout that would come to
 * nothing or less is refused and the balance carries forward.
 */
import pool from '../config/database.js';
import { businessToday } from '../utils/dates.js';
import { branchFilter } from '../utils/scope.js';
import { toRupees } from '../utils/money.js';
import { SalonError, audit, bool, int, isoDate, ok, oneOf, page, paging, text, wrapAll } from '../modules/salon/common.js';

const period = async (req) => {
  const today = await businessToday(req.tenant.businessId);
  const from = isoDate(req.query?.from ?? req.body?.from, 'From') || `${today.slice(0, 8)}01`;
  const to = isoDate(req.query?.to ?? req.body?.to, 'To') || today;
  if (to < from) throw new SalonError(400, 'The end date is before the start date');
  return { from, to };
};

/* GET /api/salon/commissions?staff_id=&status=&from=&to=&limit=&offset= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const { from, to } = await period(req);
  const values = [req.tenant.businessId, from, to];
  let where = `c.business_id = $1 AND c.earned_on BETWEEN $2::date AND $3::date${branchFilter(req.tenant, 'c.branch_id', values)}`;
  if (req.query.staff_id) { values.push(Number(req.query.staff_id) || 0); where += ` AND c.staff_id = $${values.length}`; }
  if (req.query.status) { values.push(oneOf(req.query.status, 'Status', ['PENDING', 'APPROVED', 'PAID', 'VOID'])); where += ` AND c.status = $${values.length}`; }
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_commissions c WHERE ${where}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(
    `SELECT c.commission_id, c.staff_id, s.name AS staff_name, c.invoice_id, i.invoice_number, ii.description, c.line_type, c.base_paise, c.rate_type, c.rate, c.amount_paise, c.status, c.earned_on, c.payout_id
     FROM salon_commissions c JOIN salon_staff s ON s.staff_id = c.staff_id JOIN invoices i ON i.invoice_id = c.invoice_id LEFT JOIN invoice_items ii ON ii.item_id = c.invoice_item_id
     WHERE ${where} ORDER BY c.earned_on DESC, c.commission_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => ({ ...r, base: toRupees(r.base_paise), rate: Number(r.rate), amount: toRupees(r.amount_paise) })), total, pg);
};

/* GET /api/salon/commissions/summary?from=&to= — per person: sales, services done, and commission by stage */
const summary = async (req, res) => {
  const { from, to } = await period(req);
  const values = [req.tenant.businessId, from, to];
  const scope = branchFilter(req.tenant, 's.branch_id', values);
  const { rows } = await pool.query(
    `SELECT s.staff_id, s.name, s.staff_role,
            COALESCE(SUM(c.amount_paise) FILTER (WHERE c.status = 'PENDING'), 0) AS pending,
            COALESCE(SUM(c.amount_paise) FILTER (WHERE c.status = 'APPROVED'), 0) AS approved,
            COALESCE(SUM(c.amount_paise) FILTER (WHERE c.status = 'PAID'), 0) AS paid,
            COUNT(c.commission_id) FILTER (WHERE c.status <> 'VOID' AND c.amount_paise > 0) AS lines,
            COALESCE(SUM(c.base_paise) FILTER (WHERE c.status <> 'VOID' AND c.amount_paise > 0), 0) AS revenue
     FROM salon_staff s LEFT JOIN salon_commissions c ON c.staff_id = s.staff_id AND c.earned_on BETWEEN $2::date AND $3::date
     WHERE s.business_id = $1 AND s.status = 'ACTIVE'${scope} GROUP BY s.staff_id, s.name, s.staff_role ORDER BY s.name`, values);
  const out = rows.map((r) => ({
    staff_id: r.staff_id, name: r.name, staff_role: r.staff_role, lines: Number(r.lines), revenue: toRupees(r.revenue),
    pending: toRupees(r.pending), approved: toRupees(r.approved), paid: toRupees(r.paid), total: toRupees(Number(r.pending) + Number(r.approved) + Number(r.paid))
  }));
  ok(res, { from, to, staff: out, totals: { pending: out.reduce((s, r) => s + r.pending, 0), approved: out.reduce((s, r) => s + r.approved, 0), paid: out.reduce((s, r) => s + r.paid, 0) } });
};

/* POST /api/salon/commissions/approve { staff_id, from, to } — PENDING -> APPROVED for that person and period */
const approve = async (req, res) => {
  const staffId = int(req.body?.staff_id, 'Staff', { min: 1, required: true });
  const { from, to } = await period(req);
  const values = [req.tenant.businessId, staffId];
  const s = (await pool.query(`SELECT staff_id, name FROM salon_staff s WHERE s.business_id = $1 AND s.staff_id = $2${branchFilter(req.tenant, 's.branch_id', values)}`, values)).rows[0];
  if (!s) throw new SalonError(404, 'Not found');
  const r = (await pool.query(
    `UPDATE salon_commissions SET status = 'APPROVED', approved_by = $5, approved_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND staff_id = $2 AND status = 'PENDING' AND earned_on BETWEEN $3::date AND $4::date RETURNING amount_paise`,
    [req.tenant.businessId, staffId, from, to, req.auth.userId])).rows;
  const total = r.reduce((sum, x) => sum + Number(x.amount_paise), 0);
  audit(req, 'salon.commission_approved', 'salon_staff', staffId, null, { rows: r.length, total: toRupees(total) }, { staff: s.name, from, to });
  ok(res, { staff_id: staffId, approved_rows: r.length, total: toRupees(total) });
};

/* POST /api/salon/commissions/pay { staff_id, from, to, method, reference?, note?, record_expense? } */
const pay = async (req, res) => {
  const b = req.body || {};
  const staffId = int(b.staff_id, 'Staff', { min: 1, required: true });
  const { from, to } = await period(req);
  const method = oneOf(b.method, 'Payment method', ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'], { fallback: 'CASH' });
  const reference = text(b.reference, 'Reference', { max: 80 });
  const note = text(b.note, 'Note', { max: 200 });
  const recordExpense = b.record_expense === undefined ? true : bool(b.record_expense);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const values = [req.tenant.businessId, staffId];
    const staff = (await client.query(`SELECT staff_id, name, branch_id FROM salon_staff s WHERE s.business_id = $1 AND s.staff_id = $2${branchFilter(req.tenant, 's.branch_id', values)}`, values)).rows[0];
    if (!staff) throw new SalonError(404, 'Not found');
    const rows = (await client.query(
      `SELECT commission_id, amount_paise FROM salon_commissions WHERE business_id = $1 AND staff_id = $2 AND status = 'APPROVED' AND earned_on BETWEEN $3::date AND $4::date ORDER BY commission_id FOR UPDATE`,
      [req.tenant.businessId, staffId, from, to])).rows;
    const total = rows.reduce((s, r) => s + Number(r.amount_paise), 0);
    if (!rows.length) throw new SalonError(409, 'Nothing approved to pay for that period. Approve the commission first.');
    if (total <= 0) throw new SalonError(409, 'The approved commission nets to nothing (earlier bills were taken back), so there is nothing to pay. It carries forward.');

    let expenseId = null;
    if (recordExpense) {
      expenseId = (await client.query(
        `INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, expense_date, description, created_by, staff_id)
         VALUES ($1,$2,'Commission',$3,$4,(SELECT (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(timezone,'Asia/Kolkata'))::date FROM businesses WHERE business_id = $1),$5,$6,$7) RETURNING expense_id`,
        [req.tenant.businessId, staff.branch_id, total, method === 'OTHER' ? 'OTHER' : method, `Commission for ${staff.name}, ${from} to ${to}`, req.auth.userId, staffId])).rows[0].expense_id;
    }
    const payout = (await client.query(
      `INSERT INTO salon_commission_payouts (business_id, branch_id, staff_id, period_start, period_end, total_paise, method, reference, note, expense_id, paid_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING payout_id`,
      [req.tenant.businessId, staff.branch_id, staffId, from, to, total, method, reference, note, expenseId, req.auth.userId])).rows[0];
    await client.query(`UPDATE salon_commissions SET status = 'PAID', payout_id = $2 WHERE commission_id = ANY($1::bigint[])`, [rows.map((r) => r.commission_id), payout.payout_id]);
    await client.query('COMMIT');
    audit(req, 'salon.commission_paid', 'salon_staff', staffId, null, { total: toRupees(total), rows: rows.length }, { staff: staff.name, from, to, payout_id: payout.payout_id, method });
    ok(res, { payout_id: payout.payout_id, staff_id: staffId, total: toRupees(total), rows: rows.length, expense_id: expenseId }, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* GET /api/salon/commission-payouts?staff_id= */
const payouts = async (req, res) => {
  const pg = paging(req.query);
  const values = [req.tenant.businessId];
  let where = `p.business_id = $1${branchFilter(req.tenant, 'p.branch_id', values)}`;
  if (req.query.staff_id) { values.push(Number(req.query.staff_id) || 0); where += ` AND p.staff_id = $${values.length}`; }
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_commission_payouts p WHERE ${where}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(
    `SELECT p.payout_id, p.staff_id, s.name AS staff_name, p.period_start, p.period_end, p.total_paise, p.method, p.reference, p.note, p.paid_at, u.name AS paid_by
     FROM salon_commission_payouts p JOIN salon_staff s ON s.staff_id = p.staff_id LEFT JOIN users u ON u.user_id = p.paid_by
     WHERE ${where} ORDER BY p.payout_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => ({ ...r, total: toRupees(r.total_paise) })), total, pg);
};

export default wrapAll({ list, summary, approve, pay, payouts });
