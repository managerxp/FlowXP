/*
 * Owner's reports for a date range: where the money came from, who stayed and who left, and what the member wallets hold.
 * Every figure is a query over invoices, payments, memberships, attendance and the wallet ledger; nothing is stored separately.
 * A viewer pinned to one outlet sees that outlet's invoices, payments and members. Each report can also be given as CSV (opens in Excel).
 */
import { branchFilter } from '../../utils/scope.js';
import { visibleTo } from './members.js';
import { GymError, daysBetween, withRupees } from './common.js';

/** { from, to } as YYYY-MM-DD, this month to today by default, at most a year. */
export const range = (q, today) => {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const to = ok(q.to) ? q.to : today;
  const from = ok(q.from) ? q.from : `${today.slice(0, 7)}-01`;
  if (from > to) throw new GymError(400, 'The start date is after the end date');
  if (daysBetween(from, to) > 366) throw new GymError(400, 'Pick a range of at most a year');
  return { from, to };
};

const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Rows (arrays) to CSV text with a byte-order mark, so Excel reads the rupee sign and names correctly. */
export const toCsv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

export const revenue = async (db, tenant, { from, to, tz }) => {
  const b = [tenant.businessId, from, to];
  const scope = branchFilter(tenant, 'i.branch_id', b);
  const split = (await db.query(
    `SELECT kind, COALESCE(SUM(total_paise - credited_paise), 0)::bigint AS billed_paise, COUNT(*)::int AS bills FROM (
       SELECT i.total_paise, i.credited_paise,
              CASE WHEN EXISTS (SELECT 1 FROM gym_memberships ms WHERE ms.invoice_id = i.invoice_id) THEN 'membership'
                   WHEN EXISTS (SELECT 1 FROM gym_packs gp WHERE gp.invoice_id = i.invoice_id) THEN 'training'
                   WHEN EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.invoice_id AND it.product_id IS NOT NULL) THEN 'shop'
                   ELSE 'other' END AS kind
         FROM invoices i WHERE i.business_id = $1 AND i.status <> 'CANCELLED' AND i.invoice_date BETWEEN $2::date AND $3::date${scope}) x GROUP BY kind`, b)).rows;
  const billed = { membership: { billed_paise: 0, bills: 0 }, training: { billed_paise: 0, bills: 0 }, shop: { billed_paise: 0, bills: 0 }, other: { billed_paise: 0, bills: 0 } };
  for (const r of split) billed[r.kind] = { billed_paise: Number(r.billed_paise), bills: r.bills };

  const p = [tenant.businessId, tz, from, to];
  const pScope = branchFilter(tenant, 'pm.branch_id', p);
  const methods = (await db.query(
    `SELECT pm.payment_method AS method, COALESCE(SUM(pm.amount_paise), 0)::bigint AS amount_paise, COUNT(*)::int AS payments
       FROM payments pm JOIN invoices i ON i.invoice_id = pm.invoice_id
      WHERE pm.business_id = $1 AND i.status <> 'CANCELLED' AND (pm.created_at AT TIME ZONE $2::text)::date BETWEEN $3::date AND $4::date${pScope}
      GROUP BY pm.payment_method ORDER BY SUM(pm.amount_paise) DESC`, p)).rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) }));

  const s = [tenant.businessId, from, to];
  const sScope = branchFilter(tenant, 'i.branch_id', s);
  const products = (await db.query(
    `SELECT it.product_id, MAX(it.description) AS name, SUM(it.quantity)::numeric AS quantity, SUM(it.line_total_paise)::bigint AS spent_paise
       FROM invoice_items it JOIN invoices i ON i.invoice_id = it.invoice_id
      WHERE i.business_id = $1 AND i.status <> 'CANCELLED' AND i.invoice_date BETWEEN $2::date AND $3::date AND it.product_id IS NOT NULL${sScope}
      GROUP BY it.product_id ORDER BY SUM(it.line_total_paise) DESC LIMIT 15`, s)).rows.map((r) => ({ ...r, quantity: Number(r.quantity), spent_paise: Number(r.spent_paise) }));

  const total = Object.values(billed).reduce((a, x) => a + x.billed_paise, 0);
  return withRupees({ from, to, total_billed_paise: total, billed, collected_by_method: methods, collected_paise: methods.reduce((a, m) => a + m.amount_paise, 0), top_products: products });
};

/** Memberships that ended in the range: how many were renewed (another membership started within 30 days after) and who was not. Plus members gone quiet. */
export const retention = async (db, tenant, { from, to, today, quietDays = 14 }) => {
  const p = [tenant.businessId, from, to, today];
  const scope = visibleTo(tenant, p);
  const ended = (await db.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone, m.plan_name, m.end_date::text AS ended_on,
            EXISTS (SELECT 1 FROM gym_memberships n WHERE n.member_id = m.member_id AND n.membership_id <> m.membership_id AND n.status = 'ACTIVE' AND n.kind = 'MEMBERSHIP'
                      AND n.start_date > m.start_date AND n.start_date <= m.end_date + 30) AS renewed
       FROM gym_memberships m JOIN gym_members gm ON gm.member_id = m.member_id JOIN customers c ON c.customer_id = gm.customer_id
      WHERE m.business_id = $1 AND m.status = 'ACTIVE' AND m.kind = 'MEMBERSHIP' AND m.end_date BETWEEN $2::date AND $3::date AND m.end_date < $4::date AND gm.status <> 'ARCHIVED'${scope}
      ORDER BY m.end_date DESC`, p)).rows;
  const renewed = ended.filter((r) => r.renewed).length;
  const lapsed = ended.filter((r) => !r.renewed);

  const j = [tenant.businessId, from, to];
  const jScope = visibleTo(tenant, j);
  const joined = (await db.query(`SELECT COUNT(*)::int AS n FROM gym_members gm WHERE gm.business_id = $1 AND gm.joined_on BETWEEN $2::date AND $3::date AND gm.status <> 'ARCHIVED'${jScope}`, j)).rows[0].n;
  const c = [tenant.businessId, from, to];
  const cScope = visibleTo(tenant, c);
  const cancelled = (await db.query(
    `SELECT COUNT(*)::int AS n FROM gym_memberships m JOIN gym_members gm ON gm.member_id = m.member_id WHERE m.business_id = $1 AND m.status = 'CANCELLED' AND m.cancelled_at::date BETWEEN $2::date AND $3::date${cScope}`, c)).rows[0].n;

  const q = [tenant.businessId, today, Math.max(1, Math.floor(Number(quietDays)) || 14)];
  const qScope = visibleTo(tenant, q);
  const quiet = (await db.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone, (SELECT MAX(a.local_date)::text FROM gym_attendance a WHERE a.member_id = gm.member_id AND a.status <> 'VOIDED') AS last_visit
       FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
      WHERE gm.business_id = $1 AND gm.status = 'ACTIVE'${qScope}
        AND EXISTS (SELECT 1 FROM gym_memberships m WHERE m.member_id = gm.member_id AND m.status = 'ACTIVE' AND m.kind = 'MEMBERSHIP' AND m.start_date <= $2::date AND m.end_date >= $2::date)
        AND NOT EXISTS (SELECT 1 FROM gym_attendance a WHERE a.member_id = gm.member_id AND a.status <> 'VOIDED' AND a.local_date > $2::date - $3::int)
      ORDER BY 5 NULLS FIRST LIMIT 200`, q)).rows;

  return {
    from, to, ended: ended.length, renewed, lapsed_count: lapsed.length, renewal_rate: ended.length ? Math.round((renewed / ended.length) * 1000) / 10 : null,
    joined, cancelled, lapsed: lapsed.slice(0, 200), quiet_days: q[2], quiet
  };
};

/** What the wallets hold now, and what moved in the range. */
export const walletReport = async (db, tenant, { from, to, tz }) => {
  const a = [tenant.businessId];
  const aScope = branchFilter(tenant, 'w.branch_id', a);
  const held = (await db.query(
    `SELECT COALESCE(SUM(b), 0)::bigint AS held_paise, COUNT(*)::int AS members FROM (SELECT SUM(w.amount_paise) AS b FROM gym_wallet_ledger w WHERE w.business_id = $1${aScope} GROUP BY w.member_id HAVING SUM(w.amount_paise) > 0) x`, a)).rows[0];
  const m = [tenant.businessId, tz, from, to];
  const mScope = branchFilter(tenant, 'w.branch_id', m);
  const moved = (await db.query(
    `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE kind = 'DEPOSIT'), 0)::bigint AS deposits_paise, COALESCE(-SUM(amount_paise) FILTER (WHERE kind = 'SPEND'), 0)::bigint AS spent_paise,
            COALESCE(-SUM(amount_paise) FILTER (WHERE kind = 'REFUND'), 0)::bigint AS refunded_paise, COALESCE(SUM(amount_paise) FILTER (WHERE kind = 'RETURN'), 0)::bigint AS returned_paise
       FROM gym_wallet_ledger w WHERE w.business_id = $1 AND (w.created_at AT TIME ZONE $2::text)::date BETWEEN $3::date AND $4::date${mScope}`, m)).rows[0];
  const byMethod = (await db.query(
    `SELECT w.method, COALESCE(SUM(w.amount_paise), 0)::bigint AS amount_paise FROM gym_wallet_ledger w
      WHERE w.business_id = $1 AND w.kind = 'DEPOSIT' AND (w.created_at AT TIME ZONE $2::text)::date BETWEEN $3::date AND $4::date${mScope} GROUP BY w.method ORDER BY 2 DESC`, m)).rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) }));
  const l = [tenant.businessId];
  const lScope = visibleTo(tenant, l);
  const balances = (await db.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone, SUM(w.amount_paise)::bigint AS balance_paise, MAX(w.created_at) AS last_moved
       FROM gym_wallet_ledger w JOIN gym_members gm ON gm.member_id = w.member_id JOIN customers c ON c.customer_id = gm.customer_id
      WHERE w.business_id = $1${lScope} GROUP BY gm.member_id, c.name, c.phone HAVING SUM(w.amount_paise) > 0 ORDER BY SUM(w.amount_paise) DESC LIMIT 200`, l)).rows.map((r) => ({ ...r, balance_paise: Number(r.balance_paise) }));
  return withRupees({
    from, to, held_paise: Number(held.held_paise), members_with_balance: held.members, deposits_paise: Number(moved.deposits_paise), spent_paise: Number(moved.spent_paise),
    refunded_paise: Number(moved.refunded_paise), returned_paise: Number(moved.returned_paise), deposits_by_method: byMethod, balances
  });
};
