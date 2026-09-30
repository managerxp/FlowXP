/*
 * Offers: discounts the salon defines (a percentage or a fixed amount, on services and / or products) with the
 * rules that decide who gets them — first visit, birthday, anniversary, a membership plan, named clients — plus
 * dates, outlets and usage limits.
 *
 * The server decides, always: the till may suggest an offer or send a code, but eligibility and the amount are
 * worked out here from the client's own record. Offers come off as line discounts (so GST is charged on the
 * price actually paid and commission is worked out on it), applied after any membership discount, one after the
 * other, each on what the previous one left.
 *
 * Coupon codes the owner already has (FlowXP's /coupons) keep working at the till as before; an offer with a
 * `code` is the salon-specific version that can also carry these conditions.
 */
import { SalonError, bool, idList, int, isoDate, money, num, oneOf, text } from './common.js';

export const cleanOffer = (body, { partial }) => {
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Offer name', { max: 80, min: 2, required: true });
  if ('description' in body) f.description = text(body.description, 'Description', { max: 300 });
  if ('code' in body) {
    const c = text(body.code, 'Code', { max: 24 });
    if (c && !/^[A-Za-z0-9_-]{3,24}$/.test(c)) throw new SalonError(400, 'A code can use letters, numbers, - and _ (3 to 24 characters)');
    f.code = c ? c.toUpperCase() : null;
  }
  if (!partial || 'discount_type' in body) f.discount_type = oneOf(body.discount_type, 'Discount type', ['PERCENT', 'FIXED'], { required: true });
  if (!partial || 'value' in body) f.value = num(body.value, 'Discount', { min: 0.01, max: 10000000, required: true });
  if ('max_discount' in body) f.max_discount_paise = body.max_discount == null || body.max_discount === '' ? null : money(body.max_discount, 'Maximum discount', { min: 100 });
  if ('applies_to' in body) f.applies_to = oneOf(body.applies_to, 'Applies to', ['ALL', 'SERVICES', 'PRODUCTS'], { required: true });
  if ('item_ids' in body) f.item_ids = JSON.stringify(idList(body.item_ids, 'Items'));
  if ('branch_ids' in body) f.branch_ids = JSON.stringify(idList(body.branch_ids, 'Outlets'));
  if ('starts_on' in body) f.starts_on = isoDate(body.starts_on, 'Start date');
  if ('ends_on' in body) f.ends_on = isoDate(body.ends_on, 'End date');
  if ('usage_limit' in body) f.usage_limit = int(body.usage_limit, 'Usage limit', { min: 1, max: 10000000 });
  if ('per_customer_limit' in body) f.per_customer_limit = int(body.per_customer_limit, 'Per-client limit', { min: 1, max: 1000 });
  if ('auto_apply' in body) f.auto_apply = bool(body.auto_apply);
  if ('is_active' in body) f.is_active = bool(body.is_active);
  if ('conditions' in body) {
    const c = body.conditions && typeof body.conditions === 'object' && !Array.isArray(body.conditions) ? body.conditions : {};
    const out = {};
    if ('first_visit' in c) out.first_visit = bool(c.first_visit);
    if ('birthday' in c) out.birthday = bool(c.birthday);
    if ('anniversary' in c) out.anniversary = bool(c.anniversary);
    if ('window_days' in c) out.window_days = int(c.window_days, 'Window', { min: 0, max: 31, required: true });
    if ('membership_plan_ids' in c) out.membership_plan_ids = idList(c.membership_plan_ids, 'Membership plans');
    if ('customer_ids' in c) out.customer_ids = idList(c.customer_ids, 'Clients', { max: 500 });
    if ('min_bill' in c) out.min_bill_paise = c.min_bill == null || c.min_bill === '' ? null : money(c.min_bill, 'Minimum bill');
    f.conditions = JSON.stringify(out);
  }
  if (f.discount_type === 'PERCENT' && f.value > 100) throw new SalonError(400, 'A percentage discount cannot be more than 100');
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw new SalonError(400, 'The end date is before the start date');
  return f;
};

/** Days between two month/day pairs in the nearest year (so 30 Dec and 2 Jan are 3 apart). */
const monthDayGap = (dateText, todayText) => {
  const [, m, d] = dateText.slice(0, 10).split('-').map(Number);
  const t = new Date(`${todayText}T00:00:00Z`);
  let best = Infinity;
  for (const year of [t.getUTCFullYear() - 1, t.getUTCFullYear(), t.getUTCFullYear() + 1]) {
    const day = new Date(Date.UTC(year, m - 1, d));
    // Feb 29 in a non-leap year rolls to 1 March, which is where a leap-day birthday is usually celebrated
    best = Math.min(best, Math.abs(Math.round((day - t) / 86400000)));
  }
  return best;
};

/** Everything an offer's rules need to know about the client, read once. */
export const clientContext = async (db, businessId, customerId, today) => {
  if (!customerId) return { customerId: null, visits: 0, dob: null, anniversary: null, membershipPlanId: null };
  const r = (await db.query(
    `SELECT p.dob, p.anniversary,
            (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = $2 AND i.business_id = $1 AND i.status = 'ISSUED')::int AS visits,
            (SELECT m.plan_id FROM salon_customer_memberships m WHERE m.customer_id = $2 AND m.status = 'ACTIVE' AND m.expiry_date >= $3::date ORDER BY m.expiry_date DESC LIMIT 1) AS plan_id
     FROM customers c LEFT JOIN salon_customer_profiles p ON p.customer_id = c.customer_id WHERE c.customer_id = $2 AND c.business_id = $1`, [businessId, customerId, today])).rows[0];
  return { customerId, visits: r?.visits ?? 0, dob: r?.dob ? String(r.dob).slice(0, 10) : null, anniversary: r?.anniversary ? String(r.anniversary).slice(0, 10) : null, membershipPlanId: r?.plan_id ?? null };
};

/** Why an offer does not apply right now, or null when it does. */
export const whyNot = async (db, offer, ctx, { businessId, branchId, today, billPaise }) => {
  if (!offer.is_active) return 'This offer is switched off';
  if (offer.starts_on && String(offer.starts_on).slice(0, 10) > today) return `This offer starts on ${String(offer.starts_on).slice(0, 10)}`;
  if (offer.ends_on && String(offer.ends_on).slice(0, 10) < today) return 'This offer has ended';
  const branches = offer.branch_ids || [];
  if (branches.length && !branches.includes(branchId)) return 'This offer is not available at this outlet';
  const c = offer.conditions || {};
  if (c.min_bill_paise && billPaise < c.min_bill_paise) return `This offer needs a bill of at least ₹${c.min_bill_paise / 100}`;
  const needsClient = c.first_visit || c.birthday || c.anniversary || c.membership_plan_ids?.length || c.customer_ids?.length || offer.per_customer_limit;
  if (needsClient && !ctx.customerId) return 'Choose a client to use this offer';
  if (c.first_visit && ctx.visits > 0) return 'This offer is for a first visit';
  const window = c.window_days ?? 0;
  if (c.birthday && !(ctx.dob && monthDayGap(ctx.dob, today) <= window)) return 'This offer is for the client\'s birthday';
  if (c.anniversary && !(ctx.anniversary && monthDayGap(ctx.anniversary, today) <= window)) return 'This offer is for the client\'s anniversary';
  if (c.membership_plan_ids?.length && !c.membership_plan_ids.includes(ctx.membershipPlanId)) return 'This offer is for members';
  if (c.customer_ids?.length && !c.customer_ids.includes(ctx.customerId)) return 'This offer is not for this client';
  if (offer.usage_limit) {
    const n = Number((await db.query(`SELECT COUNT(*) AS n FROM salon_offer_redemptions WHERE offer_id = $1 AND voided_at IS NULL`, [offer.offer_id])).rows[0].n);
    if (n >= offer.usage_limit) return 'This offer has been fully used';
  }
  if (offer.per_customer_limit && ctx.customerId) {
    const n = Number((await db.query(`SELECT COUNT(*) AS n FROM salon_offer_redemptions WHERE offer_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [offer.offer_id, ctx.customerId])).rows[0].n);
    if (n >= offer.per_customer_limit) return 'The client has already used this offer';
  }
  return null;
};

/** Spread `total` paise over the listed lines in proportion to what each still costs; the last takes the remainder. */
export const allocate = (lines, indexes, total) => {
  const room = indexes.map((i) => Math.max(0, lines[i].grossPaise - lines[i].discountPaise));
  const sum = room.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return new Map();
  const capped = Math.min(total, sum);
  const out = new Map(); let given = 0;
  indexes.forEach((lineIdx, k) => {
    const share = k === indexes.length - 1 ? capped - given : Math.min(room[k], Math.floor((capped * room[k]) / sum));
    const take = Math.min(share, room[k]);
    out.set(lineIdx, take); given += take;
  });
  return out;
};

/**
 * Work out one offer against the cart. `lines` are { type, productId, grossPaise, discountPaise, free }; a line
 * that is free (a package or membership visit) never takes a discount. Returns { amountPaise, perLine }.
 */
export const computeOffer = (offer, lines) => {
  const scope = offer.applies_to;
  const ids = (offer.item_ids || []).map(Number);
  const indexes = [];
  lines.forEach((l, i) => {
    if (l.free) return;
    const typeOk = scope === 'ALL' ? ['SERVICE', 'PRODUCT'].includes(l.type) : scope === 'SERVICES' ? l.type === 'SERVICE' : l.type === 'PRODUCT';
    if (typeOk && (!ids.length || ids.includes(l.productId))) indexes.push(i);
  });
  const eligible = indexes.reduce((s, i) => s + Math.max(0, lines[i].grossPaise - lines[i].discountPaise), 0);
  if (!eligible) return { amountPaise: 0, perLine: new Map() };
  let amount = offer.discount_type === 'PERCENT' ? Math.round((eligible * Number(offer.value)) / 100) : Math.round(Number(offer.value) * 100);
  if (offer.max_discount_paise) amount = Math.min(amount, Number(offer.max_discount_paise));
  amount = Math.min(amount, eligible);
  const perLine = allocate(lines, indexes, amount);
  return { amountPaise: [...perLine.values()].reduce((a, b) => a + b, 0), perLine };
};
