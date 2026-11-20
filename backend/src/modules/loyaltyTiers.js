/*
 * Tiers on a loyalty programme (points and spend cards): Silver, Gold, Platinum... A member's tier is decided by what they have EARNED in all ("lifetime"): spending
 * points never lowers it, undoing a sale does. A higher tier earns faster (a multiplier on each bill's points, applied by engine.earn, so the till, the Member desk and
 * "scan the bill" all agree). One set of tiers per programme; the first starts at 0 so every member has one.
 */
import { LoyaltyError } from './loyaltyEngine.js';

export const MAX_TIERS = 6;
export const TIERED_KINDS = ['POINTS', 'SPEND'];

export const tiersOf = async (db, programmeId) =>
  (await db.query(`SELECT tier_id, name, min_points, multiplier::float8 AS multiplier FROM loyalty_tiers WHERE programme_id = $1 ORDER BY min_points`, [programmeId])).rows;

/** What a member has earned in all: every live EARN, less the part of any earn that was undone. Spending is not counted, so it never demotes. */
export const lifetimeOf = async (db, membershipId) => (await db.query(
  `SELECT (COALESCE(SUM(l.points) FILTER (WHERE l.kind = 'EARN'), 0) + COALESCE(SUM(l.points) FILTER (WHERE l.kind = 'REVERSAL' AND o.kind = 'EARN'), 0))::int AS lifetime
     FROM points_ledger l LEFT JOIN points_ledger o ON o.entry_id = l.reverses_entry_id WHERE l.membership_id = $1 AND l.voided_at IS NULL`, [membershipId])).rows[0].lifetime;

/** The highest tier reached, and the next one up (null at the top). Pure. */
export const pick = (tiers, lifetime) => {
  let current = null; let next = null;
  for (const t of tiers) { if (t.min_points <= lifetime) current = t; else { next = t; break; } }
  return { current, next };
};

/** For the earn: 1 when the programme has no tiers. */
export const multiplierFor = async (db, programme, membershipId) => {
  if (!TIERED_KINDS.includes(programme.kind)) return 1;
  const tiers = await tiersOf(db, programme.programme_id);
  if (!tiers.length) return 1;
  return pick(tiers, await lifetimeOf(db, membershipId)).current?.multiplier ?? 1;
};

/** Where a member stands, for the desk and the card. null when the programme has no tiers. */
export const standing = async (db, programmeId, membershipId) => {
  const tiers = await tiersOf(db, programmeId);
  if (!tiers.length) return null;
  const lifetime = await lifetimeOf(db, membershipId);
  const { current, next } = pick(tiers, lifetime);
  return { tier: current && { name: current.name, multiplier: current.multiplier }, next: next && { name: next.name, points_to_go: next.min_points - lifetime, multiplier: next.multiplier }, lifetime };
};

/** Checks a list typed by the owner and returns clean rows: name, min_points, multiplier. */
export const cleanTiers = (list) => {
  const rows = Array.isArray(list) ? list : [];
  if (rows.length > MAX_TIERS) throw new LoyaltyError(`Up to ${MAX_TIERS} tiers`);
  const seen = new Set();
  const out = rows.map((t) => {
    const name = String(t?.name ?? '').trim();
    const min = Number(t?.min_points); const mult = Number(t?.multiplier ?? 1);
    if (!name || name.length > 30) throw new LoyaltyError('Every tier needs a name (up to 30 characters)');
    if (!Number.isInteger(min) || min < 0 || min > 1e8) throw new LoyaltyError('"From points" must be a whole number, 0 or more');
    if (!(mult >= 1 && mult <= 10)) throw new LoyaltyError('The earning speed must be between 1 and 10 times');
    if (seen.has(min)) throw new LoyaltyError('Two tiers start at the same number of points');
    seen.add(min);
    return { name, min_points: min, multiplier: Math.round(mult * 100) / 100 };
  }).sort((a, b) => a.min_points - b.min_points);
  if (out.length && out[0].min_points !== 0) throw new LoyaltyError('The first tier must start at 0 points so everyone has one');
  return out;
};

/** Replaces a programme's tiers. Runs inside the caller's transaction. */
export const saveTiers = async (db, businessId, programmeId, list) => {
  const rows = cleanTiers(list);
  const p = (await db.query(`SELECT kind FROM loyalty_programmes WHERE business_id = $1 AND programme_id = $2`, [businessId, programmeId])).rows[0];
  if (!p) throw new LoyaltyError('That programme was not found', 404);
  if (rows.length && !TIERED_KINDS.includes(p.kind)) throw new LoyaltyError('Tiers are for points and spend cards');
  await db.query(`DELETE FROM loyalty_tiers WHERE programme_id = $1`, [programmeId]);
  for (const t of rows) await db.query(`INSERT INTO loyalty_tiers (business_id, programme_id, name, min_points, multiplier) VALUES ($1,$2,$3,$4,$5)`, [businessId, programmeId, t.name, t.min_points, t.multiplier]);
  return tiersOf(db, programmeId);
};
