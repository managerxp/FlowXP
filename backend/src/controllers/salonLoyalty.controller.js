/*
 * Salon loyalty settings and figures. The program itself (points per Rs 100, what a point is worth, the
 * minimum and the per-bill maximum, tiers) is FlowXP's existing /loyalty/points-program; this adds what the
 * salon layers on top: points expiry and a different earning rate per kind of sale.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { getPoints } from '../modules/points.js';
import { ITEM_TYPES, expirePoints, loadRules } from '../modules/salon/loyalty.js';
import { SalonError, audit, int, num, ok, wrapAll } from '../modules/salon/common.js';

const readAll = async (businessId) => {
  const program = (await pool.query(`SELECT * FROM points_programs WHERE business_id = $1`, [businessId])).rows[0];
  const rules = await loadRules(pool, businessId);
  return {
    enabled: Boolean(program?.is_enabled),
    program: program ? {
      earn_per_100: Number(program.earn_per_100), point_value: toRupees(program.point_value_paise),
      min_redeem_points: program.min_redeem_points, max_redeem_pct: program.max_redeem_pct
    } : null,
    expiry_days: program?.expiry_days ?? null,
    rules: Object.fromEntries(ITEM_TYPES.map((t) => [t, rules.get(t) ?? { earn_per_100: null, is_enabled: true }]))
  };
};

/* GET /api/salon/loyalty */
const get = async (req, res) => ok(res, await readAll(req.tenant.businessId));

/* PUT /api/salon/loyalty { expiry_days, rules: { SERVICE: { earn_per_100, is_enabled }, ... } } */
const put = async (req, res) => {
  const b = req.body || {};
  const before = await readAll(req.tenant.businessId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ('expiry_days' in b) {
      const days = b.expiry_days === null || b.expiry_days === '' ? null : int(b.expiry_days, 'Expiry', { min: 30, max: 3650, required: true });
      // the program row must exist to hold it; a salon that has not set up points yet gets the (disabled) defaults
      await client.query(`INSERT INTO points_programs (business_id, expiry_days) VALUES ($1,$2) ON CONFLICT (business_id) DO UPDATE SET expiry_days = EXCLUDED.expiry_days, updated_at = CURRENT_TIMESTAMP`, [req.tenant.businessId, days]);
    }
    if (b.rules) {
      if (typeof b.rules !== 'object' || Array.isArray(b.rules)) throw new SalonError(400, 'Rules must be set per kind of sale');
      for (const [type, r] of Object.entries(b.rules)) {
        const key = type.toUpperCase();
        if (!ITEM_TYPES.includes(key)) throw new SalonError(400, `Unknown kind of sale: ${type}`);
        const rate = r.earn_per_100 === null || r.earn_per_100 === '' || r.earn_per_100 === undefined ? null : num(r.earn_per_100, `${key} points per Rs 100`, { min: 0, max: 100 });
        await client.query(
          `INSERT INTO salon_loyalty_rules (business_id, item_type, earn_per_100, is_enabled) VALUES ($1,$2,$3,$4)
           ON CONFLICT (business_id, item_type) DO UPDATE SET earn_per_100 = EXCLUDED.earn_per_100, is_enabled = EXCLUDED.is_enabled`,
          [req.tenant.businessId, key, rate, r.is_enabled !== false]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const after = await readAll(req.tenant.businessId);
  audit(req, 'salon.loyalty_rules_changed', 'points_program', req.tenant.businessId, { expiry_days: before.expiry_days, rules: before.rules }, { expiry_days: after.expiry_days, rules: after.rules });
  ok(res, after);
};

/* GET /api/salon/loyalty/summary — issued, redeemed, expired, and what is still owed in points */
const summary = async (req, res) => {
  const id = req.tenant.businessId;
  const cfg = await getPoints(pool, id);
  const value = cfg?.program.point_value_paise ?? 100;
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const period = (await pool.query(
    `SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0)::int AS issued, COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0)::int AS redeemed,
            COALESCE(-SUM(points) FILTER (WHERE kind = 'EXPIRE'), 0)::int AS expired, COALESCE(SUM(points) FILTER (WHERE kind = 'ADJUST'), 0)::int AS adjusted
     FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL AND created_at > now() - ($2 || ' days')::interval`, [id, String(days)])).rows[0];
  const owed = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE bal > 0)::int AS holders, COALESCE(SUM(bal) FILTER (WHERE bal > 0), 0)::bigint AS points
     FROM (SELECT customer_id, SUM(points) AS bal FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL GROUP BY customer_id) t`, [id])).rows[0];
  ok(res, { days, ...period, holders: owed.holders, outstanding_points: Number(owed.points), liability: toRupees(Number(owed.points) * value) });
};

/* POST /api/salon/loyalty/expire — run expiry now (it also runs on its own every day) */
const expireNow = async (req, res) => {
  const days = (await pool.query(`SELECT expiry_days FROM points_programs WHERE business_id = $1`, [req.tenant.businessId])).rows[0]?.expiry_days;
  if (!days) throw new SalonError(409, 'Points do not expire. Set an expiry period first.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await expirePoints(client, req.tenant.businessId, days);
    await client.query('COMMIT');
    audit(req, 'salon.points_expired', 'points_program', req.tenant.businessId, null, result);
    ok(res, result);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export default wrapAll({ get, put, summary, expireNow });
