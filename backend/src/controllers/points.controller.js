/*
 * Loyalty points: the owner's settings and tiers, a customer's balance for the till, manual
 * adjustments and how the scheme is doing. The rules live in modules/points.js.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { addEntry, getPoints, standing } from '../modules/points.js';
import { toRupees } from '../utils/money.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

const DEFAULTS = { is_enabled: false, earn_per_100: 5, point_value_paise: 100, min_redeem_points: 50, max_redeem_pct: 50 };

const readProgram = async (db, businessId) => {
  const row = (await db.query(`SELECT * FROM points_programs WHERE business_id = $1`, [businessId])).rows[0] || DEFAULTS;
  const tiers = (await db.query(`SELECT tier_id, name, min_points, multiplier FROM points_tiers WHERE business_id = $1 ORDER BY min_points`, [businessId])).rows;
  return {
    is_enabled: row.is_enabled, earn_per_100: Number(row.earn_per_100), point_value: toRupees(row.point_value_paise),
    min_redeem_points: row.min_redeem_points, max_redeem_pct: row.max_redeem_pct,
    tiers: tiers.map((t) => ({ name: t.name, min_points: t.min_points, multiplier: Number(t.multiplier) }))
  };
};

/** What the till needs for one customer, or null when points are off. */
export const pointsCard = async (db, businessId, customerId) => {
  const cfg = await getPoints(db, businessId);
  if (!cfg) return null;
  const st = await standing(db, businessId, customerId, cfg);
  return {
    balance: st.balance, balance_value: toRupees(st.balance * cfg.program.point_value_paise), lifetime: st.lifetime,
    tier: st.tier, next_tier: st.next_tier,
    earn_per_100: cfg.program.earn_per_100 * (st.tier?.multiplier ?? 1),
    point_value: toRupees(cfg.program.point_value_paise), min_redeem_points: cfg.program.min_redeem_points, max_redeem_pct: cfg.program.max_redeem_pct
  };
};

/* GET /api/loyalty/points-program */
export const getProgram = async (req, res) => {
  res.json({ success: true, data: await readProgram(pool, req.tenant.businessId) });
};

/* PUT /api/loyalty/points-program */
export const putProgram = async (req, res) => {
  const b = req.body || {};
  const earn = Number(b.earn_per_100);
  const value = Number(b.point_value);
  const minRedeem = Number(b.min_redeem_points);
  const maxPct = Number(b.max_redeem_pct);
  if (!(earn > 0 && earn <= 100)) return bad(res, 'Points per Rs 100 must be above 0 and at most 100');
  if (!(value > 0 && value <= 1000)) return bad(res, 'A point must be worth between Rs 0.01 and Rs 1000');
  if (!Number.isInteger(minRedeem) || minRedeem < 1) return bad(res, 'The minimum to use must be a whole number of points');
  if (!Number.isInteger(maxPct) || maxPct < 1 || maxPct > 100) return bad(res, 'The most a bill can be paid with points must be 1 to 100 percent');

  const tiers = Array.isArray(b.tiers) ? b.tiers : [];
  if (tiers.length > 6) return bad(res, 'Up to six tiers');
  const seen = new Set();
  for (const t of tiers) {
    const name = String(t.name ?? '').trim();
    if (!name || name.length > 30) return bad(res, 'Every tier needs a name (up to 30 characters)');
    if (!Number.isInteger(Number(t.min_points)) || Number(t.min_points) < 0) return bad(res, `${name}: points to reach it must be a whole number, 0 or more`);
    if (seen.has(Number(t.min_points))) return bad(res, 'Two tiers start at the same number of points');
    seen.add(Number(t.min_points));
    if (!(Number(t.multiplier) >= 1 && Number(t.multiplier) <= 10)) return bad(res, `${name}: the earning multiplier must be from 1 to 10`);
  }
  if (tiers.length && !seen.has(0)) return bad(res, 'The first tier must start at 0 points so everyone has one');
  if (b.is_enabled === true && minRedeem * Math.round(value * 100) <= 0) return bad(res, 'Check the redemption settings');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO points_programs (business_id, is_enabled, earn_per_100, point_value_paise, min_redeem_points, max_redeem_pct, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
       ON CONFLICT (business_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, earn_per_100 = EXCLUDED.earn_per_100, point_value_paise = EXCLUDED.point_value_paise,
         min_redeem_points = EXCLUDED.min_redeem_points, max_redeem_pct = EXCLUDED.max_redeem_pct, updated_at = CURRENT_TIMESTAMP`,
      [req.tenant.businessId, b.is_enabled === true, earn, Math.round(value * 100), minRedeem, maxPct]
    );
    await client.query(`DELETE FROM points_tiers WHERE business_id = $1`, [req.tenant.businessId]);
    for (const t of tiers) {
      await client.query(`INSERT INTO points_tiers (business_id, name, min_points, multiplier) VALUES ($1,$2,$3,$4)`, [req.tenant.businessId, String(t.name).trim(), Number(t.min_points), Number(t.multiplier)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  recordAudit(req, { action: 'points.program_updated', resource_type: 'points_program', resource_id: req.tenant.businessId, metadata: { enabled: b.is_enabled === true, earn, tiers: tiers.length } });
  res.json({ success: true, data: await readProgram(pool, req.tenant.businessId) });
};

/* GET /api/loyalty/customers/:id/points — balance, tier and recent activity */
export const customerPoints = async (req, res) => {
  const own = (await pool.query(`SELECT name FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!own) return bad(res, 'Not found', 404);
  const card = await pointsCard(pool, req.tenant.businessId, Number(req.params.id));
  const ledger = (await pool.query(
    `SELECT l.entry_id, l.kind, l.points, l.note, l.created_at, i.invoice_number
     FROM points_ledger l LEFT JOIN invoices i ON i.invoice_id = l.invoice_id
     WHERE l.business_id = $1 AND l.customer_id = $2 AND l.voided_at IS NULL ORDER BY l.entry_id DESC LIMIT 30`, [req.tenant.businessId, req.params.id])).rows;
  res.json({ success: true, data: { customer: own.name, points: card, ledger } });
};

/* POST /api/loyalty/customers/:id/points/adjust { points, note } — a goodwill gift or a correction */
export const adjust = async (req, res) => {
  const points = Number(req.body?.points);
  const note = String(req.body?.note ?? '').trim().slice(0, 200);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100000) return bad(res, 'Enter a whole number of points, positive or negative');
  if (!note) return bad(res, 'Say why (it is kept in the customer\'s history)');
  const cfg = await getPoints(pool, req.tenant.businessId);
  if (!cfg) return bad(res, 'Switch loyalty points on first');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const own = (await client.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2 FOR UPDATE`, [req.params.id, req.tenant.businessId])).rows.length;
    if (!own) { await client.query('ROLLBACK'); return bad(res, 'Not found', 404); }
    const st = await standing(client, req.tenant.businessId, Number(req.params.id), cfg);
    if (st.balance + points < 0) { await client.query('ROLLBACK'); return bad(res, `They only have ${st.balance} points`, 409); }
    await addEntry(client, { businessId: req.tenant.businessId, customerId: Number(req.params.id), kind: 'ADJUST', points, note, createdBy: req.auth.userId });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  recordAudit(req, { action: 'points.adjusted', resource_type: 'customer', resource_id: req.params.id, metadata: { points, note } });
  res.json({ success: true, data: await pointsCard(pool, req.tenant.businessId, Number(req.params.id)) });
};

/* GET /api/loyalty/points-summary — how much is owed to customers in points, and who holds it */
export const summary = async (req, res) => {
  const id = req.tenant.businessId;
  const cfg = await getPoints(pool, id);
  const value = cfg?.program.point_value_paise ?? 100;
  const [totals, month, holders] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE bal > 0)::int AS members, COALESCE(SUM(bal) FILTER (WHERE bal > 0), 0)::bigint AS outstanding
                FROM (SELECT customer_id, SUM(points) AS bal FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL GROUP BY customer_id) t`, [id]),
    pool.query(`SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0)::int AS earned, COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0)::int AS redeemed,
                       COALESCE(SUM(amount_paise) FILTER (WHERE kind = 'REDEEM'), 0) AS discount_paise
                FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL AND created_at > now() - interval '30 days'`, [id]),
    pool.query(`SELECT c.customer_id, c.name, c.phone, SUM(l.points)::int AS balance, SUM(l.points) FILTER (WHERE l.kind IN ('EARN','REVERSAL'))::int AS lifetime
                FROM points_ledger l JOIN customers c ON c.customer_id = l.customer_id
                WHERE l.business_id = $1 AND l.voided_at IS NULL GROUP BY c.customer_id, c.name, c.phone ORDER BY balance DESC, c.name LIMIT 100`, [id])
  ]);
  const tiers = cfg?.tiers ?? [];
  const byTier = {};
  for (const h of holders.rows) {
    const t = tiers.length ? (tiersFor(tiers, h.lifetime || 0) ?? { name: 'No tier' }) : { name: 'Members' };
    byTier[t.name] = (byTier[t.name] || 0) + 1;
  }
  res.json({
    success: true,
    data: {
      enabled: Boolean(cfg), members_with_points: totals.rows[0].members, outstanding_points: Number(totals.rows[0].outstanding),
      liability: toRupees(Number(totals.rows[0].outstanding) * value),
      earned_30d: month.rows[0].earned, redeemed_30d: month.rows[0].redeemed, discount_30d: toRupees(month.rows[0].discount_paise),
      by_tier: byTier, top: holders.rows.slice(0, 10)
    }
  });
};

const tiersFor = (tiers, lifetime) => { let cur = null; for (const t of tiers) if (t.min_points <= lifetime) cur = t; return cur; };
