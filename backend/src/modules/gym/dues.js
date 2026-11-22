/*
 * Dues control: who owes the gym money, for how long, whether they have a credit limit or a payment promise, and the door rule that follows.
 * Nothing about the amount is stored: it is the unpaid balance on the member's invoices (memberships, packs and shop bills alike).
 * A credit limit is optional. A member who owes MORE than their limit is turned away at the door (reason "Payment due") unless they have a promise dated
 * today or later; the desk can still take a payment and let them in. A promise is a date and an optional amount and note, kept on the member.
 */
import { branchFilter } from '../../utils/scope.js';
import { visibleTo } from './members.js';
import { GymError, isoDate, money, text, withRupees } from './common.js';

/** The members who owe, biggest debt first. `overdueDays`: only those whose oldest unpaid bill is at least that many days old. */
export const duesList = async (db, tenant, { today, overdueDays = 0, search = '', limit = 200 }) => {
  const p = [tenant.businessId, today];
  const scope = visibleTo(tenant, p);
  const inv = branchFilter(tenant, 'i.branch_id', p);
  const like = String(search || '').trim();
  let q = '';
  if (like) { p.push(`%${like}%`); q = ` AND (c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR gm.member_code ILIKE $${p.length})`; }
  const rows = (await db.query(
    `SELECT gm.member_id, gm.member_code, c.name, c.phone, gm.credit_limit_paise, gm.promise_on::text AS promise_on, gm.promise_paise, gm.promise_note,
            SUM(i.balance_due_paise)::bigint AS owed_paise, COUNT(*)::int AS bills, MIN(i.invoice_date)::text AS oldest_on, ($2::date - MIN(i.invoice_date))::int AS days_old
       FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
       JOIN invoices i ON i.customer_id = gm.customer_id AND i.business_id = gm.business_id AND i.status <> 'CANCELLED' AND i.balance_due_paise > 0${inv}
      WHERE gm.business_id = $1 AND gm.status <> 'ARCHIVED'${scope}${q}
      GROUP BY gm.member_id, c.name, c.phone
     HAVING ($2::date - MIN(i.invoice_date)) >= ${Math.max(0, Math.floor(Number(overdueDays)) || 0)}
      ORDER BY SUM(i.balance_due_paise) DESC LIMIT ${Math.min(Math.max(Number(limit) || 200, 1), 500)}`, p)).rows;
  const list = rows.map((r) => ({
    ...r, owed_paise: Number(r.owed_paise), credit_limit_paise: r.credit_limit_paise == null ? null : Number(r.credit_limit_paise),
    promise_paise: r.promise_paise == null ? null : Number(r.promise_paise),
    over_limit: r.credit_limit_paise != null && Number(r.owed_paise) > Number(r.credit_limit_paise),
    promise_broken: r.promise_on != null && r.promise_on < today
  }));
  return withRupees({
    total_owed_paise: list.reduce((a, r) => a + r.owed_paise, 0), members: list.length,
    over_limit: list.filter((r) => r.over_limit).length, promises_broken: list.filter((r) => r.promise_broken).length, rows: list
  });
};

/** Set (or clear, with null or empty) a member's credit limit, in rupees. */
export const setCreditLimit = async (db, tenant, memberId, b) => {
  const limit = money(b.credit_limit, 'Credit limit', { min: 0 });
  const r = await db.query(`UPDATE gym_members SET credit_limit_paise = $3 WHERE member_id = $1 AND business_id = $2 RETURNING member_id`, [memberId, tenant.businessId, limit]);
  if (!r.rowCount) throw new GymError(404, 'Not found');
  return { credit_limit_paise: limit };
};

/** Record when a member promised to pay (and optionally how much). A date of null or empty clears it. */
export const setPromise = async (db, tenant, memberId, b, today) => {
  const on = isoDate(b.promise_on, 'Date');
  if (on && on < today) throw new GymError(400, 'A promise date cannot be in the past');
  const amount = on ? money(b.amount, 'Amount', { min: 1 }) : null;
  const note = on ? text(b.note, 'Note', { max: 200 }) : null;
  const r = await db.query(`UPDATE gym_members SET promise_on = $3, promise_paise = $4, promise_note = $5 WHERE member_id = $1 AND business_id = $2 RETURNING member_id`, [memberId, tenant.businessId, on, amount, note]);
  if (!r.rowCount) throw new GymError(404, 'Not found');
  return { promise_on: on, promise_paise: amount, promise_note: note };
};

/** The door rule, pure: does what this member owes, against their limit and promise, stop them today? */
export const blockedByDues = (member, today) =>
  member.credit_limit_paise != null && Number(member.owed_paise) > Number(member.credit_limit_paise) && !(member.promise_on && member.promise_on >= today);
