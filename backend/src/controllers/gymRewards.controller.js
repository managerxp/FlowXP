/*
 * Gym rewards and reminders for staff: the rules, the catalogue, a member's points, redemptions and the liability figure, and which reminders are on.
 * What the rules mean is in modules/gym/rewards.js; permissions are decided in the router.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { visibleTo } from '../modules/gym/members.js';
import { extend } from '../modules/gym/memberships.js';
import * as rewards from '../modules/gym/rewards.js';
import { AUTOMATIONS, getAutomations, saveAutomation } from '../modules/gym/automation.js';
import { GymError, audit, bool, inTx, int, isoDate, localParts, num, ok, text, wrapAll, withRupees } from '../modules/gym/common.js';

const id = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new GymError(404, 'Not found'); return n; };

const visible = async (req, memberId) => {
  const params = [req.tenant.businessId, memberId];
  if (!(await pool.query(`SELECT 1 FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(req.tenant, params)}`, params)).rows.length) throw new GymError(404, 'Not found');
};

const shapeRules = (r) => ({ ...r, point_value: Number(r.point_value_paise) / 100 });

const getRules = async (req, res) => ok(res, shapeRules(await rewards.getRules(pool, req.tenant.businessId)));
const putRules = async (req, res) => {
  const before = await rewards.getRules(pool, req.tenant.businessId);
  const after = await inTx((db) => rewards.saveRules(db, req.tenant.businessId, req.body || {}));
  audit(req, 'gym.reward_rules_updated', 'gym_reward_rules', req.tenant.businessId, null, { enabled: after.is_enabled, was_enabled: before.is_enabled });
  ok(res, shapeRules(after));
};

/* ── the catalogue ──────────────────────────────────────────────────────────────────────────── */

const cleanReward = (b, cur = {}) => {
  const has = (k) => b[k] !== undefined;
  const kind = has('kind') ? String(b.kind).toUpperCase() : cur.kind || 'ITEM';
  if (!['FREE_DAYS', 'DISCOUNT', 'ITEM'].includes(kind)) throw new GymError(400, 'The kind of reward is not valid');
  const out = {
    name: has('name') ? text(b.name, 'Name', { max: 80, required: true }) : cur.name ?? text(b.name, 'Name', { max: 80, required: true }),
    description: has('description') ? text(b.description, 'Description', { max: 300 }) : cur.description ?? null,
    points_cost: has('points_cost') ? int(b.points_cost, 'Points', { min: 1, max: 1000000, required: true }) : cur.points_cost ?? int(b.points_cost, 'Points', { min: 1, max: 1000000, required: true }),
    kind,
    value: has('value') ? num(b.value, 'Value', { min: 0, max: 100000, required: true }) : Number(cur.value ?? 0),
    stock: has('stock') ? int(b.stock, 'Stock', { min: 0, max: 1000000 }) : cur.stock ?? null
  };
  if (kind === 'FREE_DAYS' && !(out.value >= 1 && out.value <= 365 && Number.isInteger(out.value))) throw new GymError(400, 'Free days: say how many, from 1 to 365');
  if (kind === 'DISCOUNT' && !(out.value > 0)) throw new GymError(400, 'A discount needs an amount');
  return out;
};

const catalogue = async (req, res) => ok(res, withRupees((await pool.query(`SELECT * FROM gym_rewards WHERE business_id = $1 ${req.query.all === 'true' ? '' : 'AND is_active'} ORDER BY points_cost, reward_id`, [req.tenant.businessId])).rows.map((r) => ({ ...r, value: Number(r.value) }))));
const rewardCreate = async (req, res) => {
  const r = cleanReward(req.body || {});
  const row = (await pool.query(`INSERT INTO gym_rewards (business_id, name, description, points_cost, kind, value, stock) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.tenant.businessId, r.name, r.description, r.points_cost, r.kind, r.value, r.stock])).rows[0];
  audit(req, 'gym.reward_created', 'gym_reward', row.reward_id, null, { name: row.name });
  ok(res, { ...row, value: Number(row.value) }, 201);
};
const rewardUpdate = async (req, res) => {
  const cur = (await pool.query(`SELECT * FROM gym_rewards WHERE reward_id = $1 AND business_id = $2`, [id(req), req.tenant.businessId])).rows[0];
  if (!cur) throw new GymError(404, 'Not found');
  const r = cleanReward(req.body || {}, cur);
  const row = (await pool.query(`UPDATE gym_rewards SET name = $3, description = $4, points_cost = $5, kind = $6, value = $7, stock = $8 WHERE reward_id = $1 AND business_id = $2 RETURNING *`, [cur.reward_id, req.tenant.businessId, r.name, r.description, r.points_cost, r.kind, r.value, r.stock])).rows[0];
  audit(req, 'gym.reward_updated', 'gym_reward', row.reward_id, null, { name: row.name });
  ok(res, { ...row, value: Number(row.value) });
};
const rewardActive = (on) => async (req, res) => {
  const row = (await pool.query(`UPDATE gym_rewards SET is_active = $3 WHERE reward_id = $1 AND business_id = $2 RETURNING *`, [id(req), req.tenant.businessId, on])).rows[0];
  if (!row) throw new GymError(404, 'Not found');
  audit(req, on ? 'gym.reward_restored' : 'gym.reward_archived', 'gym_reward', row.reward_id);
  ok(res, { ...row, value: Number(row.value) });
};

/* ── a member's points ──────────────────────────────────────────────────────────────────────── */

const memberPoints = async (req, res) => { const memberId = id(req); await visible(req, memberId); ok(res, await rewards.memberPoints(pool, req.tenant.businessId, memberId)); };

const adjust = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const out = await inTx((db) => rewards.adjust(db, { businessId: req.tenant.businessId, memberId, points: req.body?.points, reason: req.body?.reason, userId: req.auth.userId }));
  audit(req, 'gym.points_adjusted', 'gym_member', memberId, null, { points: Number(req.body?.points), reason: String(req.body?.reason || '').slice(0, 200) });
  ok(res, out);
};

const redeem = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const out = await inTx((db) => rewards.redeem(db, { businessId: req.tenant.businessId, memberId, rewardId: req.body?.reward_id, userId: req.auth.userId, extend }));
  audit(req, 'gym.reward_redeemed', 'gym_member', memberId, null, { reward_id: Number(req.body?.reward_id), redemption_id: out.redemption_id });
  ok(res, out, 201);
};

const exclude = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  await pool.query(`UPDATE gym_members SET rewards_excluded = $3 WHERE member_id = $1 AND business_id = $2`, [memberId, req.tenant.businessId, bool(req.body?.excluded)]);
  audit(req, 'gym.rewards_exclusion', 'gym_member', memberId, null, { excluded: bool(req.body?.excluded) });
  ok(res, { excluded: bool(req.body?.excluded) });
};

const redemptions = async (req, res) => {
  const params = [req.tenant.businessId];
  let where = 'r.business_id = $1';
  if (req.query.status) { params.push(String(req.query.status).toUpperCase()); where += ` AND r.status = $${params.length}`; }
  where += visibleTo(req.tenant, params);
  const rows = (await pool.query(
    `SELECT r.redemption_id, r.member_id, gm.member_code, c.name AS member_name, r.reward_name, r.reward_kind, r.points, r.status, r.created_at, r.fulfilled_at
     FROM gym_reward_redemptions r JOIN gym_members gm ON gm.member_id = r.member_id JOIN customers c ON c.customer_id = gm.customer_id WHERE ${where} ORDER BY r.created_at DESC LIMIT 200`, params)).rows;
  ok(res, rows);
};
const ownRedemption = async (req) => {
  const r = (await pool.query(`SELECT member_id FROM gym_reward_redemptions WHERE redemption_id = $1 AND business_id = $2`, [id(req), req.tenant.businessId])).rows[0];
  if (!r) throw new GymError(404, 'Not found');
  await visible(req, r.member_id);
};
const fulfil = async (req, res) => { await ownRedemption(req); ok(res, await inTx((db) => rewards.fulfil(db, { businessId: req.tenant.businessId, redemptionId: id(req), note: req.body?.note }))); };
const cancelRedemption = async (req, res) => {
  await ownRedemption(req);
  const out = await inTx((db) => rewards.cancelRedemption(db, { businessId: req.tenant.businessId, redemptionId: id(req), userId: req.auth.userId }));
  audit(req, 'gym.redemption_cancelled', 'gym_reward_redemption', id(req));
  ok(res, out);
};

const liability = async (req, res) => {
  const { date: today } = await localParts(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || `${today.slice(0, 7)}-01`; const to = isoDate(req.query.to, 'To') || today;
  ok(res, withRupees({ from, to, ...(await rewards.liability(pool, req.tenant.businessId, { from, to })) }));
};

/* ── reminders ──────────────────────────────────────────────────────────────────────────────── */

const automations = async (req, res) => ok(res, await getAutomations(pool, req.tenant.businessId));
const putAutomation = async (req, res) => {
  const key = String(req.params.key || '').toUpperCase();
  if (!AUTOMATIONS[key]) throw new GymError(404, 'Not found');
  const out = await saveAutomation(pool, req.tenant.businessId, key, req.body || {});
  recordAudit(req, { action: 'gym.automation_updated', resource_type: 'gym_automation', resource_id: key, metadata: { enabled: out.is_enabled } });
  ok(res, out);
};

export default wrapAll({ getRules, putRules, catalogue, rewardCreate, rewardUpdate, rewardArchive: rewardActive(false), rewardRestore: rewardActive(true), memberPoints, adjust, redeem, exclude, redemptions, fulfil, cancelRedemption, liability, automations, putAutomation });
