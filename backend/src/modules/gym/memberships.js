/*
 * The membership lifecycle: sell, renew, change plan, freeze, extend, cancel, transfer.
 *
 * MONEY stays in FlowXP's invoice engine. Selling a membership is `createInvoiceInTransaction` (GST, split payments, coupons, numbering) plus one
 * gym_memberships row, in the same transaction, so the invoice and the membership can never disagree about whether a sale happened. Whether a member
 * may come in on a pending or part-paid invoice is the PLAN's rule (payment_policy), read from the invoice at the moment of the scan.
 *
 * STATE is derived. A membership's stored status is ACTIVE, CANCELLED or TRANSFERRED. Whether it has started, is frozen, has ended, is in grace or is
 * unpaid is worked out from its dates, its freezes and its invoice at the moment of use (`membershipView`, and `evaluate` in access.js).
 *
 * DATES are inclusive gym-local calendar days: a 30-day membership starting on the 1st ends on the 30th and still works on the 30th.
 * A freeze pushes the end date out by the days frozen; ending it early gives the unused days back.
 */
import { createInvoiceInTransaction } from '../billing.js';
import { toRupees } from '../../utils/money.js';
import { GymError, addDays, daysBetween, getSettings, localParts } from './common.js';
import { paymentOk, frozenOn, loadMemberships } from './access.js';
import { awardForMembership, reverseForMembership, safely } from './rewards.js';
import { onInvoiceVoided as voidPacksFor } from './classes.js';

const DAY_LIMIT_PAST = 31;     // a membership can be started this many days back (a sign-up written down on paper) ...
const DAY_LIMIT_AHEAD = 366;   // ... or this many days ahead (a renewal booked early)

const event = (db, membershipId, businessId, kind, detail, userId) =>
  db.query(`INSERT INTO gym_membership_events (membership_id, business_id, kind, detail, actor_user_id) VALUES ($1,$2,$3,$4,$5)`, [membershipId, businessId, kind, JSON.stringify(detail || {}), userId ?? null]);

export const events = async (db, businessId, membershipId) =>
  (await db.query(`SELECT e.event_id, e.kind, e.detail, e.created_at, u.name AS actor FROM gym_membership_events e LEFT JOIN users u ON u.user_id = e.actor_user_id
                   WHERE e.membership_id = $1 AND e.business_id = $2 ORDER BY e.created_at, e.event_id`, [membershipId, businessId])).rows;

/** What a screen shows about one membership right now. */
export const membershipView = (m, today, graceDefault = 0) => {
  const grace = m.grace_days ?? graceDefault;
  let state;
  if (m.status === 'CANCELLED') state = 'CANCELLED';
  else if (m.status === 'TRANSFERRED') state = 'TRANSFERRED';
  else if (m.start_date > today) state = 'UPCOMING';
  else if (frozenOn(m.freezes, today)) state = 'FROZEN';
  else if (today > addDays(m.end_date, grace)) state = 'EXPIRED';
  else if (today > m.end_date) state = 'GRACE';
  else state = 'ACTIVE';
  let payment;
  if (m.payment_basis === 'COMPED') payment = 'COMPED';
  else if (m.payment_basis === 'TRANSFER') payment = 'CARRIED_OVER';
  else if (!m.inv) payment = 'NO_INVOICE';
  else if (m.inv.inv_status === 'CANCELLED') payment = 'INVOICE_CANCELLED';
  else if (Number(m.inv.total_paise) > 0 && Number(m.inv.credited_paise) >= Number(m.inv.total_paise)) payment = 'REFUNDED';
  else if (Number(m.inv.balance_due_paise) <= 0) payment = 'PAID';
  else if (Number(m.inv.amount_paid_paise) > 0) payment = 'PARTIAL';
  else payment = 'UNPAID';
  return {
    membership_id: m.membership_id, member_id: m.member_id, plan_id: m.plan_id, plan_name: m.plan_name, start_date: m.start_date, end_date: m.end_date, status: m.status,
    state, payment, payment_ok: m.status === 'ACTIVE' && paymentOk(m, m.inv, today),
    days_left: m.status === 'ACTIVE' ? daysBetween(today, m.end_date) : null,
    price_paise: Number(m.price_paise), price: Number(m.price_paise) / 100,
    invoice_id: m.invoice_id, amount_due_paise: m.inv ? Number(m.inv.balance_due_paise) : 0, amount_due: m.inv ? Number(m.inv.balance_due_paise) / 100 : 0,
    allowed_branch_ids: m.allowed_branch_ids, time_window: m.time_window, payment_policy: m.payment_policy, pay_later_until: m.pay_later_until,
    payment_basis: m.payment_basis, max_members: m.max_members, freezes: m.freezes, freeze_allowed: m.freeze_allowed, max_freeze_days: m.max_freeze_days,
    renewed_from: m.renewed_from, transferred_from: m.transferred_from, cancel_reason: m.cancel_reason, shared_from: m.shared_from ?? null, created_at: m.created_at
  };
};

export const viewsFor = async (db, businessId, memberId, today) => {
  const settings = await getSettings(db, businessId);
  return (await loadMemberships(db, businessId, memberId)).map((m) => membershipView(m, today, settings.grace_days)).reverse();
};

const lockedMembership = async (db, businessId, membershipId) => {
  const m = (await db.query(
    `SELECT *, start_date::text AS start_date, end_date::text AS end_date, pay_later_until::text AS pay_later_until FROM gym_memberships WHERE membership_id = $1 AND business_id = $2 FOR UPDATE`, [membershipId, businessId])).rows[0];
  if (!m) throw new GymError(404, 'Not found');
  return m;
};

const memberFor = async (db, businessId, memberId) => {
  const m = (await db.query(
    `SELECT gm.member_id, gm.status, gm.customer_id, gm.head_member_id, c.name FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.member_id = $1 AND gm.business_id = $2 FOR UPDATE OF gm`, [memberId, businessId])).rows[0];
  if (!m) throw new GymError(404, 'Not found');
  return m;
};

/**
 * Sell a membership (or renew one) and bill it. Call inside a transaction.
 * input: { plan_id, start_date?, renewed_from?, complimentary?, discount? (rupees), coupon_code?, payment? | payments?, notes?, tax_inclusive? }
 * `allowDiscount` is decided by the caller from the person's permission: the desk cannot hand out discounts it was not trusted with.
 */
export const sellMembership = async (db, tenant, userId, memberId, input, { allowDiscount = false, allowComplimentary = false } = {}) => {
  const member = await memberFor(db, tenant.businessId, memberId);
  if (member.status === 'ARCHIVED') throw new GymError(409, 'This member is archived');
  const plan = (await db.query(`SELECT * FROM gym_plans WHERE plan_id = $1 AND business_id = $2`, [Number(input.plan_id), tenant.businessId])).rows[0];
  if (!plan || !plan.is_active) throw new GymError(400, 'That plan is not available');
  if (plan.kind !== 'MEMBERSHIP') throw new GymError(400, 'Sell packs from the packs screen');
  const { date: today } = await localParts(db, tenant.businessId);
  let start = input.start_date ? String(input.start_date).slice(0, 10) : null;
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new GymError(400, 'The start date must be a date (YYYY-MM-DD)');
  let renewedFrom = null;
  if (input.renewed_from) {
    const prev = await lockedMembership(db, tenant.businessId, Number(input.renewed_from));
    if (prev.member_id !== memberId) throw new GymError(400, 'That membership belongs to someone else');
    renewedFrom = prev.membership_id;
    // a renewal picks up the day after the one it renews, unless that has already passed
    if (!start) start = prev.end_date >= today ? addDays(prev.end_date, 1) : today;
  }
  start ||= today;
  if (daysBetween(today, start) < -DAY_LIMIT_PAST || daysBetween(today, start) > DAY_LIMIT_AHEAD) throw new GymError(400, 'The start date is too far from today');
  const end = addDays(start, plan.duration_days - 1);

  const discount = input.discount != null && input.discount !== '' ? Number(input.discount) : 0;
  if (discount && !allowDiscount) throw new GymError(403, 'You cannot give a discount. Ask a manager');
  if (!Number.isFinite(discount) || discount < 0) throw new GymError(400, 'The discount must be an amount');
  const complimentary = input.complimentary === true;
  if (complimentary && !allowComplimentary) throw new GymError(403, 'Only a manager can give a membership free');

  let invoice = null;
  if (!complimentary) {
    invoice = await createInvoiceInTransaction(db, tenant, userId, {
      customerId: member.customer_id,
      items: [{ description: `${plan.name} (${start} to ${end})`, quantity: 1, unit_price: toRupees(plan.price_paise), tax_rate: Number(plan.tax_rate), discount: discount || undefined }],
      taxInclusive: input.tax_inclusive === true,
      payment: input.payment, payments: input.payments, couponCode: input.coupon_code, notes: input.notes || `Gym membership: ${plan.name}`,
      invoiceDate: today
    });
  }
  const taxable = invoice ? Math.round((invoice.subtotal - invoice.discount) * 100) : 0;
  const payLaterUntil = plan.payment_policy === 'PAY_LATER' ? addDays(start, plan.pay_later_days) : null;

  const row = (await db.query(
    `INSERT INTO gym_memberships (business_id, member_id, branch_id, plan_id, plan_name, kind, start_date, end_date, price_paise, allowed_branch_ids, time_window, grace_days,
       payment_policy, pay_later_until, freeze_allowed, max_freeze_days, max_members, payment_basis, invoice_id, renewed_from, created_by)
     VALUES ($1,$2,$3,$4,$5,'MEMBERSHIP',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING membership_id`,
    [tenant.businessId, memberId, tenant.branchId, plan.plan_id, plan.name, start, end, taxable, plan.allowed_branch_ids, plan.time_window ? JSON.stringify(plan.time_window) : null,
     plan.grace_days, plan.payment_policy, payLaterUntil, plan.freeze_allowed, plan.max_freeze_days, plan.max_members, complimentary ? 'COMPED' : 'INVOICE', invoice?.invoice_id ?? null, renewedFrom, userId])).rows[0];
  // a membership paid in full on the spot earns its points now; one paid later earns them when the payment completes (onInvoicePaid)
  if (invoice && Number(invoice.balance_due) <= 0) await safely(db, 'membership points', () => awardForMembership(db, { businessId: tenant.businessId, membershipId: row.membership_id }));
  await event(db, row.membership_id, tenant.businessId, renewedFrom ? 'RENEWED' : 'SOLD', { plan: plan.name, start, end, invoice_id: invoice?.invoice_id ?? null, complimentary, discount: discount || undefined }, userId);
  return { membership_id: row.membership_id, start_date: start, end_date: end, invoice };
};

/**
 * Move a member to another plan part-way through a membership. The unused days of the old membership are worth a credit (its taxable price, pro rata),
 * taken off the new plan's bill as a discount; the old membership ends yesterday. No cash moves here: a cash refund is a credit note on the old invoice.
 */
export const changePlan = async (db, tenant, userId, membershipId, input, opts) => {
  if (input.discount && !opts?.allowDiscount) throw new GymError(403, 'You cannot give a discount. Ask a manager');
  const old = await lockedMembership(db, tenant.businessId, membershipId);
  if (old.status !== 'ACTIVE') throw new GymError(409, 'Only a running membership can be changed');
  const { date: today } = await localParts(db, tenant.businessId);
  if (old.end_date < today) throw new GymError(409, 'That membership has already ended. Sell a new one');
  const total = daysBetween(old.start_date, old.end_date) + 1;
  const left = Math.max(0, daysBetween(old.start_date > today ? old.start_date : today, old.end_date) + 1);
  const credit = old.payment_basis === 'INVOICE' ? Math.round((Number(old.price_paise) * left) / total) : 0;

  const plan = (await db.query(`SELECT price_paise FROM gym_plans WHERE plan_id = $1 AND business_id = $2 AND is_active`, [Number(input.plan_id), tenant.businessId])).rows[0];
  if (!plan) throw new GymError(400, 'That plan is not available');
  const credited = Math.min(credit, Number(plan.price_paise));
  await db.query(`UPDATE gym_memberships SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Changed plan', end_date = LEAST(end_date, $2::date) WHERE membership_id = $1`, [membershipId, addDays(today, -1) < old.start_date ? old.start_date : addDays(today, -1)]);
  await event(db, membershipId, tenant.businessId, 'PLAN_CHANGED', { credit_paise: credited, unused_days: left, to_plan_id: Number(input.plan_id) }, userId);
  const sold = await sellMembership(db, tenant, userId, old.member_id, { ...input, start_date: today, discount: (Number(input.discount || 0) + credited / 100) || undefined }, { ...opts, allowDiscount: true });
  return { ...sold, credit_paise: credited, unused_days: left };
};

/** Freeze a membership from one day to another (inclusive). Its end date moves out by the days frozen. */
export const freeze = async (db, tenant, userId, membershipId, { from, to, reason }) => {
  const m = await lockedMembership(db, tenant.businessId, membershipId);
  if (m.status !== 'ACTIVE') throw new GymError(409, 'Only a running membership can be frozen');
  if (!m.freeze_allowed || m.max_freeze_days <= 0) throw new GymError(409, 'This plan cannot be frozen');
  const { date: today } = await localParts(db, tenant.businessId);
  const a = String(from || today).slice(0, 10); const b = String(to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) throw new GymError(400, 'Give the first and last day of the freeze');
  if (b < a) throw new GymError(400, 'The freeze cannot end before it starts');
  if (a < today) throw new GymError(400, 'A freeze cannot start in the past');
  if (a > m.end_date) throw new GymError(400, 'The freeze would start after the membership ends');
  const days = daysBetween(a, b) + 1;
  const rows = (await db.query(`SELECT from_date::text AS f, to_date::text AS t FROM gym_freezes WHERE membership_id = $1`, [membershipId])).rows;
  if (rows.some((r) => a <= r.t && r.f <= b)) throw new GymError(409, 'It is already frozen on some of those days');
  const used = rows.reduce((s, r) => s + daysBetween(r.f, r.t) + 1, 0);
  if (used + days > m.max_freeze_days) throw new GymError(409, `This plan allows ${m.max_freeze_days} frozen days in all (${used} already used)`);
  const f = (await db.query(`INSERT INTO gym_freezes (membership_id, business_id, from_date, to_date, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING freeze_id`, [membershipId, tenant.businessId, a, b, reason ? String(reason).slice(0, 200) : null, userId])).rows[0];
  const newEnd = addDays(m.end_date, days);
  await db.query(`UPDATE gym_memberships SET end_date = $2 WHERE membership_id = $1`, [membershipId, newEnd]);
  await event(db, membershipId, tenant.businessId, 'FROZEN', { from: a, to: b, days, new_end: newEnd, reason: reason || null }, userId);
  return { freeze_id: f.freeze_id, end_date: newEnd, days };
};

/** Bring a freeze to an end today (or cancel one that has not started). The days not used come back off the end date. */
export const unfreeze = async (db, tenant, userId, membershipId) => {
  const m = await lockedMembership(db, tenant.businessId, membershipId);
  const { date: today } = await localParts(db, tenant.businessId);
  const f = (await db.query(`SELECT freeze_id, from_date::text AS f, to_date::text AS t FROM gym_freezes WHERE membership_id = $1 AND to_date >= $2 ORDER BY from_date LIMIT 1`, [membershipId, today])).rows[0];
  if (!f) throw new GymError(409, 'There is no freeze to end');
  let returned; let newTo = null;
  if (f.f >= today) { returned = daysBetween(f.f, f.t) + 1; await db.query(`DELETE FROM gym_freezes WHERE freeze_id = $1`, [f.freeze_id]); }
  else { newTo = addDays(today, -1); returned = daysBetween(newTo, f.t); await db.query(`UPDATE gym_freezes SET to_date = $2, ended_early_on = $3 WHERE freeze_id = $1`, [f.freeze_id, newTo, today]); }
  const newEnd = addDays(m.end_date, -returned);
  await db.query(`UPDATE gym_memberships SET end_date = $2 WHERE membership_id = $1`, [membershipId, newEnd]);
  await event(db, membershipId, tenant.businessId, 'UNFROZEN', { days_returned: returned, new_end: newEnd }, userId);
  return { end_date: newEnd, days_returned: returned };
};

/** Add days to a membership (a make-good, a promotion). */
export const extend = async (db, tenant, userId, membershipId, { days, reason }) => {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new GymError(400, 'Days must be a whole number from 1 to 365');
  const m = await lockedMembership(db, tenant.businessId, membershipId);
  if (m.status !== 'ACTIVE') throw new GymError(409, 'Only a running membership can be extended');
  const newEnd = addDays(m.end_date, n);
  await db.query(`UPDATE gym_memberships SET end_date = $2 WHERE membership_id = $1`, [membershipId, newEnd]);
  await event(db, membershipId, tenant.businessId, 'EXTENDED', { days: n, new_end: newEnd, reason: reason ? String(reason).slice(0, 200) : null }, userId);
  return { end_date: newEnd };
};

/** End a membership now. Cancelling moves no money: a refund is a credit note on its invoice, which has its own screen and its own audit. */
export const cancel = async (db, tenant, userId, membershipId, { reason }) => {
  const m = await lockedMembership(db, tenant.businessId, membershipId);
  if (m.status !== 'ACTIVE') throw new GymError(409, 'This membership is already ended');
  await db.query(`UPDATE gym_memberships SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2 WHERE membership_id = $1`, [membershipId, reason ? String(reason).slice(0, 200) : null]);
  await event(db, membershipId, tenant.businessId, 'CANCELLED', { reason: reason || null, invoice_id: m.invoice_id }, userId);
  return { membership_id: membershipId, invoice_id: m.invoice_id };
};

/** Hand what is left of a membership to another member. The new one carries the same end date and rules, and is not billed again. */
export const transfer = async (db, tenant, userId, membershipId, { to_member_id: toMemberId }) => {
  const m = await lockedMembership(db, tenant.businessId, membershipId);
  if (m.status !== 'ACTIVE') throw new GymError(409, 'Only a running membership can be transferred');
  if (m.max_members > 1) throw new GymError(409, 'A family membership cannot be transferred');
  const target = await memberFor(db, tenant.businessId, Number(toMemberId));
  if (target.member_id === m.member_id) throw new GymError(400, 'Choose a different member');
  if (target.status === 'ARCHIVED') throw new GymError(409, 'That member is archived');
  const { date: today } = await localParts(db, tenant.businessId);
  if (m.end_date < today) throw new GymError(409, 'That membership has already ended');
  const sourceStart = m.start_date > today ? m.start_date : today;
  const cut = addDays(sourceStart, -1);
  // the giver keeps what they have already had (up to yesterday); the receiver gets the rest
  await db.query(`UPDATE gym_memberships SET status = 'TRANSFERRED', cancelled_at = now(), cancel_reason = 'Transferred', end_date = GREATEST(start_date, $2::date) WHERE membership_id = $1`, [membershipId, cut < m.start_date ? m.start_date : cut]);
  const created = (await db.query(
    `INSERT INTO gym_memberships (business_id, member_id, branch_id, plan_id, plan_name, kind, start_date, end_date, price_paise, allowed_branch_ids, time_window, grace_days,
       payment_policy, freeze_allowed, max_freeze_days, max_members, payment_basis, transferred_from, created_by)
     VALUES ($1,$2,$3,$4,$5,'MEMBERSHIP',$6,$7,0,$8,$9,$10,'FULL_REQUIRED',$11,$12,1,'TRANSFER',$13,$14) RETURNING membership_id`,
    [tenant.businessId, target.member_id, m.branch_id, m.plan_id, m.plan_name, sourceStart, m.end_date, m.allowed_branch_ids, m.time_window ? JSON.stringify(m.time_window) : null, m.grace_days,
     m.freeze_allowed, m.max_freeze_days, m.membership_id, userId])).rows[0];
  await event(db, membershipId, tenant.businessId, 'TRANSFERRED', { to_member_id: target.member_id, new_membership_id: created.membership_id }, userId);
  await event(db, created.membership_id, tenant.businessId, 'TRANSFERRED_IN', { from_membership_id: membershipId, until: m.end_date }, userId);
  return { membership_id: created.membership_id };
};

/* ── when the invoice changes under a membership (called from the invoice and credit-note flows, inside their transaction) ── */

/** A cancelled invoice ends the membership it paid for. */
export const onInvoiceCancelled = async (db, { businessId, invoiceId, userId = null }) => {
  const rows = (await db.query(
    `UPDATE gym_memberships SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Invoice cancelled' WHERE invoice_id = $1 AND business_id = $2 AND status = 'ACTIVE' RETURNING membership_id`, [invoiceId, businessId])).rows;
  for (const r of rows) {
    await event(db, r.membership_id, businessId, 'CANCELLED', { reason: 'Invoice cancelled', invoice_id: invoiceId }, userId);
    await safely(db, 'points reversal', () => reverseForMembership(db, { businessId, membershipId: r.membership_id, userId }));
  }
  await voidPacksFor(db, { businessId, invoiceId });
};

/** A credit note that refunds the whole invoice ends the membership; a part credit leaves it running. */
export const onCreditNote = async (db, { businessId, invoiceId, userId = null }) => {
  const inv = (await db.query(`SELECT total_paise, credited_paise FROM invoices WHERE invoice_id = $1 AND business_id = $2`, [invoiceId, businessId])).rows[0];
  if (!inv || Number(inv.total_paise) <= 0 || Number(inv.credited_paise) < Number(inv.total_paise)) return;
  await voidPacksFor(db, { businessId, invoiceId });
  const rows = (await db.query(
    `UPDATE gym_memberships SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Refunded' WHERE invoice_id = $1 AND business_id = $2 AND status = 'ACTIVE' RETURNING membership_id`, [invoiceId, businessId])).rows;
  for (const r of rows) {
    await event(db, r.membership_id, businessId, 'REFUNDED', { invoice_id: invoiceId }, userId);
    await safely(db, 'points reversal', () => reverseForMembership(db, { businessId, membershipId: r.membership_id, userId }));
  }
};

/** A payment brought an invoice to nothing owing: the memberships it paid for earn their points (once; calling again pays nothing more). */
export const onInvoicePaid = async (db, { businessId, invoiceId }) => {
  const rows = (await db.query(`SELECT membership_id FROM gym_memberships WHERE invoice_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [invoiceId, businessId])).rows;
  for (const r of rows) await safely(db, 'membership points', () => awardForMembership(db, { businessId, membershipId: r.membership_id }));
};
