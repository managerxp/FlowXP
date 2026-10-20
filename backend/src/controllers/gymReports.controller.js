/*
 * Gym dashboard and reports. Every figure is a query over the same tables the desk writes (members, memberships, invoices, attendance): there is
 * nothing here that is stored separately and could drift. A viewer pinned to one outlet sees that outlet's attendance and its members.
 */
import pool from '../config/database.js';
import { visibleTo } from '../modules/gym/members.js';
import { addDays, isoDate, localParts, ok, wrapAll, withRupees } from '../modules/gym/common.js';
import { branchFilter } from '../utils/scope.js';

const tzOf = async (businessId) => (await pool.query(`SELECT COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1`, [businessId])).rows[0].tz;

/* members by what they are right now, using the same rule as the member list */
const stateCounts = async (tenant, today) => {
  const params = [tenant.businessId, today];
  const scope = visibleTo(tenant, params);
  const rows = (await pool.query(
    `SELECT state, COUNT(*)::int AS n FROM (
       SELECT CASE WHEN cur.membership_id IS NULL THEN 'NONE'
                   WHEN cur.start_date > $2::date THEN 'UPCOMING'
                   WHEN EXISTS (SELECT 1 FROM gym_freezes f WHERE f.membership_id = cur.membership_id AND $2::date BETWEEN f.from_date AND f.to_date) THEN 'FROZEN'
                   WHEN cur.end_date < $2::date THEN 'EXPIRED'
                   WHEN cur.end_date - $2::date <= 7 THEN 'EXPIRING'
                   ELSE 'ACTIVE' END AS state
       FROM gym_members gm
       LEFT JOIN LATERAL (SELECT ms.* FROM gym_memberships ms WHERE ms.member_id = gm.member_id AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP'
                          ORDER BY (ms.end_date >= $2::date) DESC, CASE WHEN ms.end_date >= $2::date THEN ms.start_date END ASC, ms.end_date DESC LIMIT 1) cur ON TRUE
       WHERE gm.business_id = $1 AND gm.status = 'ACTIVE'${scope}) t GROUP BY state`, params)).rows;
  const out = { ACTIVE: 0, EXPIRING: 0, FROZEN: 0, EXPIRED: 0, UPCOMING: 0, NONE: 0 };
  for (const r of rows) out[r.state] = r.n;
  return out;
};

const dashboard = async (req, res) => {
  const { businessId } = req.tenant;
  const { date: today } = await localParts(pool, businessId);
  const tz = await tzOf(businessId);
  const counts = await stateCounts(req.tenant, today);

  const a = [businessId, today]; const aScope = branchFilter(req.tenant, 'a.branch_id', a);
  const visits = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE a.local_date = $2::date)::int AS today,
            COUNT(DISTINCT a.member_id) FILTER (WHERE a.local_date = $2::date)::int AS today_unique,
            COUNT(*) FILTER (WHERE a.local_date = $2::date AND a.check_out_at IS NULL)::int AS open_now,
            COUNT(*) FILTER (WHERE a.local_date > $2::date - 7)::int AS last_7_days
     FROM gym_attendance a WHERE a.business_id = $1 AND a.status <> 'VOIDED' AND a.local_date > $2::date - 7${aScope}`, a)).rows[0];
  const e = [businessId, tz, today]; const eScope = branchFilter(req.tenant, 'e.branch_id', e);
  const denied = (await pool.query(
    `SELECT e.reason_code, COUNT(*)::int AS n FROM gym_access_events e WHERE e.business_id = $1 AND e.decision = 'DENIED' AND (e.occurred_at AT TIME ZONE $2::text)::date = $3::date${eScope}
     GROUP BY e.reason_code ORDER BY n DESC`, e)).rows;
  const monthStart = `${today.slice(0, 7)}-01`;
  const sales = (await pool.query(
    `SELECT COUNT(*)::int AS sold, COALESCE(SUM(i.total_paise - i.credited_paise), 0)::bigint AS sales_paise, COALESCE(SUM(i.balance_due_paise), 0)::bigint AS due_paise
     FROM gym_memberships m JOIN invoices i ON i.invoice_id = m.invoice_id WHERE m.business_id = $1 AND i.status <> 'CANCELLED' AND m.created_at >= $2::date`, [businessId, monthStart])).rows[0];
  const p = [businessId, monthStart]; const pScope = visibleTo(req.tenant, p);
  const joined = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_members gm WHERE gm.business_id = $1 AND gm.joined_on >= $2::date AND gm.status <> 'ARCHIVED'${pScope}`, p)).rows[0].n;
  const week = (await pool.query(
    `SELECT d::date::text AS date, COALESCE(c.n, 0)::int AS visits FROM generate_series($2::date - 6, $2::date, interval '1 day') d
     LEFT JOIN (SELECT a.local_date, COUNT(*) AS n FROM gym_attendance a WHERE a.business_id = $1 AND a.status <> 'VOIDED' AND a.local_date > $2::date - 7${aScope} GROUP BY a.local_date) c ON c.local_date = d::date
     ORDER BY d`, [...a])).rows;
  ok(res, withRupees({ today, members: counts, visits, denied_today: denied, joined_this_month: joined, sales_this_month: sales, last_7_days: week }));
};

const attendance = async (req, res) => {
  const { businessId } = req.tenant;
  const { date: today } = await localParts(pool, businessId);
  const from = isoDate(req.query.from, 'From') || addDays(today, -29); const to = isoDate(req.query.to, 'To') || today;
  const tz = await tzOf(businessId);
  const params = [businessId, from, to]; const scope = branchFilter(req.tenant, 'a.branch_id', params);
  const base = `FROM gym_attendance a WHERE a.business_id = $1 AND a.status <> 'VOIDED' AND a.local_date BETWEEN $2::date AND $3::date${scope}`;
  const byDay = (await pool.query(`SELECT a.local_date::text AS date, COUNT(*)::int AS visits, COUNT(DISTINCT a.member_id)::int AS members ${base} GROUP BY a.local_date ORDER BY a.local_date`, params)).rows;
  const tzIdx = params.length + 1;
  const byHour = (await pool.query(`SELECT EXTRACT(HOUR FROM a.check_in_at AT TIME ZONE $${tzIdx}::text)::int AS hour, COUNT(*)::int AS visits ${base} GROUP BY 1 ORDER BY 1`, [...params, tz])).rows;
  const top = (await pool.query(
    `SELECT a.member_id, gm.member_code, c.name, COUNT(*)::int AS visits FROM gym_attendance a JOIN gym_members gm ON gm.member_id = a.member_id JOIN customers c ON c.customer_id = gm.customer_id
     WHERE a.business_id = $1 AND a.status <> 'VOIDED' AND a.local_date BETWEEN $2::date AND $3::date${scope} GROUP BY a.member_id, gm.member_code, c.name ORDER BY visits DESC, c.name LIMIT 10`, params)).rows;
  const totals = (await pool.query(`SELECT COUNT(*)::int AS visits, COUNT(DISTINCT a.member_id)::int AS members ${base}`, params)).rows[0];
  const peak = byHour.reduce((best, h) => (!best || h.visits > best.visits ? h : best), null);
  const days = Math.max(1, byDay.length);
  const p2 = [businessId, from]; const pScope = visibleTo(req.tenant, p2);
  // active members who have not been in during the window (and have not just joined)
  const quiet = (await pool.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
     WHERE gm.business_id = $1 AND gm.status = 'ACTIVE' AND gm.joined_on < $2::date${pScope}
       AND EXISTS (SELECT 1 FROM gym_memberships ms WHERE ms.member_id = gm.member_id AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP' AND ms.end_date >= $2::date)
       AND NOT EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = gm.member_id AND a.status <> 'VOIDED' AND a.local_date >= $2::date)
     ORDER BY c.name LIMIT 100`, p2)).rows;
  ok(res, { from, to, totals: { ...totals, average_per_day: Math.round((totals.visits / days) * 10) / 10 }, by_day: byDay, by_hour: byHour, peak_hour: peak?.hour ?? null, most_frequent: top, not_seen: quiet });
};

const memberships = async (req, res) => {
  const { businessId } = req.tenant;
  const { date: today } = await localParts(pool, businessId);
  const from = isoDate(req.query.from, 'From') || `${today.slice(0, 7)}-01`; const to = isoDate(req.query.to, 'To') || today;
  const counts = await stateCounts(req.tenant, today);
  const byPlan = (await pool.query(
    `SELECT m.plan_name, COUNT(*)::int AS memberships FROM gym_memberships m WHERE m.business_id = $1 AND m.status = 'ACTIVE' AND m.kind = 'MEMBERSHIP' AND m.end_date >= $2::date AND m.start_date <= $2::date GROUP BY m.plan_name ORDER BY memberships DESC`, [businessId, today])).rows;
  const flow = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE kind = 'SOLD')::int AS new_sales, COUNT(*) FILTER (WHERE kind = 'RENEWED')::int AS renewals, COUNT(*) FILTER (WHERE kind IN ('CANCELLED','REFUNDED'))::int AS cancelled,
            COUNT(*) FILTER (WHERE kind = 'FROZEN')::int AS frozen, COUNT(*) FILTER (WHERE kind = 'TRANSFERRED')::int AS transferred
     FROM gym_membership_events WHERE business_id = $1 AND created_at >= $2::date AND created_at < $3::date + 1`, [businessId, from, to])).rows[0];
  const money = (await pool.query(
    `SELECT COALESCE(SUM(i.total_paise), 0)::bigint AS billed_paise, COALESCE(SUM(i.credited_paise), 0)::bigint AS credited_paise, COALESCE(SUM(i.amount_paid_paise), 0)::bigint AS paid_paise,
            COALESCE(SUM(i.balance_due_paise), 0)::bigint AS outstanding_paise
     FROM invoices i WHERE i.business_id = $1 AND i.status <> 'CANCELLED' AND i.invoice_id IN (SELECT invoice_id FROM gym_memberships WHERE business_id = $1 AND invoice_id IS NOT NULL AND created_at >= $2::date AND created_at < $3::date + 1)`, [businessId, from, to])).rows[0];
  const p = [businessId, today, addDays(today, 14)]; const scope = visibleTo(req.tenant, p);
  const expiring = (await pool.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone, m.plan_name, m.end_date::text AS ends_on FROM gym_memberships m JOIN gym_members gm ON gm.member_id = m.member_id JOIN customers c ON c.customer_id = gm.customer_id
     WHERE m.business_id = $1 AND m.status = 'ACTIVE' AND m.kind = 'MEMBERSHIP' AND m.end_date BETWEEN $2::date AND $3::date AND gm.status = 'ACTIVE'${scope}
       AND NOT EXISTS (SELECT 1 FROM gym_memberships n WHERE n.member_id = m.member_id AND n.status = 'ACTIVE' AND n.start_date > m.end_date)
     ORDER BY m.end_date, c.name LIMIT 200`, p)).rows;
  ok(res, withRupees({ from, to, members: counts, by_plan: byPlan, flow, money, expiring_soon: expiring }));
};

export default wrapAll({ dashboard, attendance, memberships });
