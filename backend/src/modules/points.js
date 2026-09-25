/*
 * Loyalty points: the rules in one place (used by billing, credit notes, cancellation and the screens).
 *
 * Money is integer paise; points are whole numbers. The ledger (points_ledger) is the truth:
 *   balance  = sum of live rows                    (what the customer can spend)
 *   lifetime = live EARN + REVERSAL rows           (decides the tier; spending never demotes)
 * customers.customer_id has no foreign key on the ledger on purpose: billing locks the customer row and
 * writes here in the same transaction, and a foreign key would add a second lock to that path.
 */

export class PointsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** { program, tiers } when points are switched on for the business, otherwise null. */
export const getPoints = async (db, businessId) => {
  const program = (await db.query(`SELECT * FROM points_programs WHERE business_id = $1`, [businessId])).rows[0];
  if (!program?.is_enabled) return null;
  const tiers = (await db.query(`SELECT tier_id, name, min_points, multiplier FROM points_tiers WHERE business_id = $1 ORDER BY min_points`, [businessId])).rows
    .map((t) => ({ ...t, multiplier: Number(t.multiplier) }));
  return { program: { ...program, earn_per_100: Number(program.earn_per_100) }, tiers };
};

/** The tier a lifetime total puts someone in (the highest one reached), and the next one up. */
export const tierFor = (tiers, lifetime) => {
  let current = null; let next = null;
  for (const t of tiers) { if (t.min_points <= lifetime) current = t; else { next = t; break; } }
  return { current, next };
};

/** Balance, lifetime, tier and what is next, for one customer. */
export const standing = async (db, businessId, customerId, cfg) => {
  const r = (await db.query(
    `SELECT COALESCE(SUM(points), 0)::int AS balance,
            COALESCE(SUM(points) FILTER (WHERE kind IN ('EARN','REVERSAL')), 0)::int AS lifetime
     FROM points_ledger WHERE business_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [businessId, customerId])).rows[0];
  const { current, next } = tierFor(cfg.tiers, r.lifetime);
  return {
    balance: r.balance, lifetime: r.lifetime,
    tier: current ? { name: current.name, multiplier: current.multiplier } : null,
    next_tier: next ? { name: next.name, points_needed: next.min_points - r.lifetime } : null
  };
};

/** Points a bill of `basePaise` earns: per Rs 100, times the tier multiplier, rounded down. */
export const earnFor = (cfg, st, basePaise) => {
  const multiplier = st.tier?.multiplier ?? 1;
  return Math.max(0, Math.floor((Number(basePaise) * cfg.program.earn_per_100 * multiplier) / 10000 + 1e-9));
};

/**
 * Can `points` be spent on a bill with `payablePaise` still to pay? Returns the discount in paise or throws.
 * Rules: at least the minimum, no more than the balance, and no more than max_redeem_pct of the bill.
 */
export const redemption = (cfg, st, points, payablePaise) => {
  const { program } = cfg;
  if (!Number.isInteger(points) || points <= 0) throw new PointsError('Enter a whole number of points');
  if (points < program.min_redeem_points) throw new PointsError(`The least you can use is ${program.min_redeem_points} points`);
  if (points > st.balance) throw new PointsError(`Only ${st.balance} points are available`);
  const cap = Math.floor((Number(payablePaise) * program.max_redeem_pct) / 100);
  const most = Math.floor(cap / program.point_value_paise);
  if (points > most) throw new PointsError(`At most ${most} points can be used on this bill (${program.max_redeem_pct}% of it)`);
  return points * program.point_value_paise;
};

export const addEntry = (db, { businessId, customerId, invoiceId = null, kind, points, amountPaise = 0, note = null, createdBy = null }) =>
  db.query(
    `INSERT INTO points_ledger (business_id, customer_id, invoice_id, kind, points, amount_paise, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [businessId, customerId, invoiceId, kind, points, amountPaise, note, createdBy]
  );

/** A credit note takes back a share of the points the bill earned (never taking the balance below zero). */
export const reverseForCredit = async (db, { businessId, invoiceId, creditedTotalPaise, createdBy = null }) => {
  const inv = (await db.query(`SELECT customer_id, total_paise, points_earned FROM invoices WHERE invoice_id = $1 AND business_id = $2`, [invoiceId, businessId])).rows[0];
  if (!inv?.customer_id || !inv.points_earned || !Number(inv.total_paise)) return 0;
  const target = Math.min(inv.points_earned, Math.round((inv.points_earned * Number(creditedTotalPaise)) / Number(inv.total_paise)));
  const done = -Number((await db.query(`SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE invoice_id = $1 AND kind = 'REVERSAL' AND voided_at IS NULL`, [invoiceId])).rows[0].n);
  const balance = Number((await db.query(`SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE business_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [businessId, inv.customer_id])).rows[0].n);
  const take = Math.min(target - done, Math.max(0, balance));
  if (take <= 0) return 0;
  await addEntry(db, { businessId, customerId: inv.customer_id, invoiceId, kind: 'REVERSAL', points: -take, note: 'Credit note', createdBy });
  return take;
};
