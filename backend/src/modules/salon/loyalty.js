/*
 * Salon loyalty: earning rules by kind of sale, expiry and the figures the owner watches.
 *
 * The points program, tiers and ledger are FlowXP's existing ones (modules/points.js). The salon layers two
 * things on top of them:
 *
 *   - different earning rates for services, products, packages and memberships (salon_loyalty_rules); a kind
 *     with no rule earns the program's own rate, and gift cards never earn (buying stored value is not a sale)
 *   - expiry: points lapse `expiry_days` after they were earned. Expiry is FIFO-by-assumption — every debit
 *     (redemption, earlier expiry, reversal, negative adjustment) is taken to use the oldest credits first — so
 *     what has expired is always max(0, old credits - everything already used), and running it twice changes
 *     nothing.
 */
import { addEntry } from '../points.js';

export const ITEM_TYPES = ['SERVICE', 'PRODUCT', 'PACKAGE', 'MEMBERSHIP'];

export const loadRules = async (db, businessId) => {
  const rows = (await db.query(`SELECT item_type, earn_per_100, is_enabled FROM salon_loyalty_rules WHERE business_id = $1`, [businessId])).rows;
  return new Map(rows.map((r) => [r.item_type, { earn_per_100: r.earn_per_100 == null ? null : Number(r.earn_per_100), is_enabled: r.is_enabled }]));
};

/**
 * Points a bill earns, by kind of line. `lines` are the billing engine's computed lines paired with their salon
 * kind (`type`) and whether the item earns points; invoice-level discounts (coupon, points, manual) scale every
 * line down pro rata so points are earned on what was actually paid.
 */
export const earnedPoints = ({ lines, finalTotalPaise, state, cfg, rules, memberMultiplier = 1 }) => {
  const sum = lines.reduce((s, l) => s + l.line_total_paise, 0);
  if (sum <= 0 || finalTotalPaise <= 0) return 0;
  const scale = finalTotalPaise / sum;
  let raw = 0;
  for (const l of lines) {
    if (l.type === 'GIFT_CARD' || l.earnable === false || l.line_total_paise <= 0) continue;
    const rule = rules.get(l.type);
    if (rule && rule.is_enabled === false) continue;
    const rate = rule?.earn_per_100 ?? cfg.program.earn_per_100;
    raw += (l.line_total_paise * scale * rate) / 10000;
  }
  const tier = state?.tier?.multiplier ?? 1;
  return Math.max(0, Math.floor(raw * tier * memberMultiplier + 1e-9));
};

/** Credits older than `cutoff`, everything used so far, and the current balance, for one customer. */
const position = async (db, businessId, customerId, cutoff) => (await db.query(
  `SELECT COALESCE(SUM(points) FILTER (WHERE (kind = 'EARN' OR (kind = 'ADJUST' AND points > 0)) AND created_at < $3), 0)::int AS old_credits,
          COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)::int AS used,
          COALESCE(SUM(points), 0)::int AS balance
   FROM points_ledger WHERE business_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [businessId, customerId, cutoff])).rows[0];

/** Points that will lapse within the next `withinDays`, for the customer's profile and the reminder. */
export const expiringPoints = async (db, businessId, customerId, expiryDays, withinDays = 30) => {
  const cutoff = new Date(Date.now() - (expiryDays - withinDays) * 86400000);
  const p = await position(db, businessId, customerId, cutoff);
  return Math.max(0, Math.min(p.old_credits - p.used, p.balance));
};

/**
 * Expire what is due for every customer of a business. Returns { customers, points }. Safe to run any number
 * of times: a second run finds nothing left to expire.
 */
export const expirePoints = async (db, businessId, expiryDays, now = new Date()) => {
  const cutoff = new Date(now.getTime() - expiryDays * 86400000);
  const { rows } = await db.query(
    `SELECT customer_id,
            COALESCE(SUM(points) FILTER (WHERE (kind = 'EARN' OR (kind = 'ADJUST' AND points > 0)) AND created_at < $2), 0)::int AS old_credits,
            COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)::int AS used,
            COALESCE(SUM(points), 0)::int AS balance
     FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL GROUP BY customer_id
     HAVING COALESCE(SUM(points) FILTER (WHERE (kind = 'EARN' OR (kind = 'ADJUST' AND points > 0)) AND created_at < $2), 0) > 0`,
    [businessId, cutoff]
  );
  let customers = 0; let total = 0;
  for (const r of rows) {
    const due = Math.min(r.old_credits - r.used, r.balance);
    if (due <= 0) continue;
    await addEntry(db, { businessId, customerId: r.customer_id, kind: 'EXPIRE', points: -due, note: `Expired after ${expiryDays} days` });
    customers++; total += due;
  }
  return { customers, points: total };
};

/** Customers with points that will lapse within `withinDays`, and how many. One query for the whole business. */
export const expiringSoonAll = async (db, businessId, expiryDays, withinDays = 14) => {
  const cutoff = new Date(Date.now() - (expiryDays - withinDays) * 86400000);
  const { rows } = await db.query(
    `SELECT customer_id,
            COALESCE(SUM(points) FILTER (WHERE (kind = 'EARN' OR (kind = 'ADJUST' AND points > 0)) AND created_at < $2), 0)::int AS old_credits,
            COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)::int AS used, COALESCE(SUM(points), 0)::int AS balance
     FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL GROUP BY customer_id
     HAVING COALESCE(SUM(points) FILTER (WHERE (kind = 'EARN' OR (kind = 'ADJUST' AND points > 0)) AND created_at < $2), 0) > 0`, [businessId, cutoff]);
  return rows.map((r) => ({ customer_id: r.customer_id, points: Math.min(r.old_credits - r.used, r.balance) })).filter((r) => r.points > 0);
};
