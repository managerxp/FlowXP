/*
 * The owner's numbers for the gym front page: money in, money owed, where the money came from, who is about to lapse, low stock and what just happened.
 * Every figure is a query over the invoices, payments, items, memberships and stock FlowXP already keeps (nothing is stored separately). A viewer pinned to one
 * outlet sees that outlet's invoices, payments and stock.
 */
import { branchFilter } from '../../utils/scope.js';
import { visibleTo } from './members.js';
import { addDays, withRupees } from './common.js';

/** Payments received today and this month, what is owed, where this month's billing came from, shop sales and low stock. */
export const moneyOverview = async (db, tenant, { today, tz }) => {
  const monthStart = `${today.slice(0, 7)}-01`;
  const p = [tenant.businessId, tz, today, monthStart];
  const pScope = branchFilter(tenant, 'pm.branch_id', p);
  const paid = (await db.query(
    `SELECT COALESCE(SUM(pm.amount_paise) FILTER (WHERE (pm.created_at AT TIME ZONE $2::text)::date = $3::date), 0)::bigint AS today_paise,
            COALESCE(SUM(pm.amount_paise) FILTER (WHERE (pm.created_at AT TIME ZONE $2::text)::date >= $4::date), 0)::bigint AS month_paise
       FROM payments pm JOIN invoices i ON i.invoice_id = pm.invoice_id
      WHERE pm.business_id = $1 AND i.status <> 'CANCELLED' AND (pm.created_at AT TIME ZONE $2::text)::date >= $4::date${pScope}`, p)).rows[0];

  const o = [tenant.businessId];
  const oScope = branchFilter(tenant, 'i.branch_id', o);
  const owed = (await db.query(
    `SELECT COALESCE(SUM(i.balance_due_paise), 0)::bigint AS owed_paise, COUNT(*)::int AS bills
       FROM invoices i WHERE i.business_id = $1 AND i.status <> 'CANCELLED' AND i.balance_due_paise > 0${oScope}`, o)).rows[0];

  const b = [tenant.businessId, monthStart];
  const bScope = branchFilter(tenant, 'i.branch_id', b);
  const split = (await db.query(
    `SELECT kind, COALESCE(SUM(total_paise - credited_paise), 0)::bigint AS billed_paise FROM (
       SELECT i.total_paise, i.credited_paise,
              CASE WHEN EXISTS (SELECT 1 FROM gym_memberships ms WHERE ms.invoice_id = i.invoice_id) THEN 'membership'
                   WHEN EXISTS (SELECT 1 FROM gym_packs gp WHERE gp.invoice_id = i.invoice_id) THEN 'training'
                   WHEN EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.invoice_id AND it.product_id IS NOT NULL) THEN 'shop'
                   ELSE 'other' END AS kind
         FROM invoices i WHERE i.business_id = $1 AND i.status <> 'CANCELLED' AND i.invoice_date >= $2::date${bScope}) x GROUP BY kind`, b)).rows;
  const billed = { membership: 0, training: 0, shop: 0, other: 0 };
  for (const r of split) billed[r.kind] = Number(r.billed_paise);

  const s = [tenant.businessId];
  const stockScope = tenant.scopeBranchId != null ? (s.push(tenant.scopeBranchId), ' LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2') : '';
  const qty = tenant.scopeBranchId != null ? 'COALESCE(bs.quantity, 0)' : 'p.current_stock';
  const low = (await db.query(
    `SELECT COUNT(*)::int AS n FROM products p${stockScope} WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND ${qty} <= p.min_stock`, s)).rows[0].n;

  return withRupees({
    received_today_paise: paid.today_paise, received_month_paise: paid.month_paise,
    owed_paise: owed.owed_paise, owed_bills: owed.bills,
    billed_month: { membership_paise: billed.membership, training_paise: billed.training, shop_paise: billed.shop, other_paise: billed.other },
    low_stock: low
  });
};

/** Members whose running membership ends in the next 30 days and who have nothing queued after it. Counted at 7, 15 and 30 days; the list is the first 30. */
export const renewalsDue = async (db, tenant, { today }) => {
  const p = [tenant.businessId, today, addDays(today, 30)];
  const scope = visibleTo(tenant, p);
  const rows = (await db.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone, m.plan_name, m.end_date::text AS ends_on, (m.end_date - $2::date)::int AS days_left
       FROM gym_memberships m JOIN gym_members gm ON gm.member_id = m.member_id JOIN customers c ON c.customer_id = gm.customer_id
      WHERE m.business_id = $1 AND m.status = 'ACTIVE' AND m.kind = 'MEMBERSHIP' AND m.end_date BETWEEN $2::date AND $3::date AND gm.status = 'ACTIVE'${scope}
        AND NOT EXISTS (SELECT 1 FROM gym_memberships n WHERE n.member_id = m.member_id AND n.status = 'ACTIVE' AND n.start_date > m.end_date)
      ORDER BY m.end_date, c.name`, p)).rows;
  return {
    d7: rows.filter((r) => r.days_left <= 7).length, d15: rows.filter((r) => r.days_left <= 15).length, d30: rows.length,
    list: rows.slice(0, 30)
  };
};

/** The latest things that happened at the desk: sign-ups, memberships sold / renewed / frozen / cancelled, payments and check-ins. Newest first. */
export const recentActivity = async (db, tenant, { limit = 15 } = {}) => {
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const m = [tenant.businessId]; const mScope = visibleTo(tenant, m);
  const joined = (await db.query(
    `SELECT 'JOINED' AS kind, gm.member_id, c.name, NULL::text AS detail, gm.created_at AS at
       FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.business_id = $1 AND gm.status <> 'ARCHIVED'${mScope} ORDER BY gm.created_at DESC LIMIT ${cap}`, m)).rows;
  const e = [tenant.businessId]; const eScope = visibleTo(tenant, e);
  const events = (await db.query(
    `SELECT ev.kind, gm.member_id, c.name, ms.plan_name AS detail, ev.created_at AS at
       FROM gym_membership_events ev JOIN gym_memberships ms ON ms.membership_id = ev.membership_id JOIN gym_members gm ON gm.member_id = ms.member_id JOIN customers c ON c.customer_id = gm.customer_id
      WHERE ev.business_id = $1 AND ev.kind IN ('SOLD','RENEWED','FROZEN','UNFROZEN','CANCELLED','REFUNDED','TRANSFERRED')${eScope} ORDER BY ev.created_at DESC LIMIT ${cap}`, e)).rows;
  const y = [tenant.businessId]; const yScope = branchFilter(tenant, 'pm.branch_id', y);
  const pays = (await db.query(
    `SELECT 'PAYMENT' AS kind, gm.member_id, c.name, pm.payment_method AS detail, pm.amount_paise, pm.created_at AS at
       FROM payments pm JOIN invoices i ON i.invoice_id = pm.invoice_id JOIN customers c ON c.customer_id = pm.customer_id LEFT JOIN gym_members gm ON gm.customer_id = c.customer_id AND gm.business_id = pm.business_id
      WHERE pm.business_id = $1 AND i.status <> 'CANCELLED'${yScope} ORDER BY pm.created_at DESC LIMIT ${cap}`, y)).rows;
  const a = [tenant.businessId]; const aScope = branchFilter(tenant, 'a.branch_id', a);
  const visits = (await db.query(
    `SELECT 'CHECKIN' AS kind, a.member_id, c.name, NULL::text AS detail, a.check_in_at AS at
       FROM gym_attendance a JOIN gym_members gm ON gm.member_id = a.member_id JOIN customers c ON c.customer_id = gm.customer_id
      WHERE a.business_id = $1 AND a.status <> 'VOIDED'${aScope} ORDER BY a.check_in_at DESC LIMIT 5`, a)).rows;
  return [...joined, ...events, ...pays, ...visits].sort((x, y2) => new Date(y2.at) - new Date(x.at)).slice(0, cap);
};
