/*
 * Loyalty programmes and memberships: the owner makes programmes, staff look a member up and credit, redeem or reverse points.
 * All the rules are in modules/loyaltyEngine.js. Every route is scoped to the signed-in business.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import { recordAudit } from '../modules/events.js';
import * as engine from '../modules/loyaltyEngine.js';
import { pushBalance } from '../modules/walletGoogle.js';

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof engine.LoyaltyError) return res.status(e.status).json({ success: false, message: e.message });
    console.error('[loyalty-engine]', e.message);
    res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const bid = (req) => req.tenant.businessId;
const id = (req, name = 'id') => { const n = Number(req.params[name]); if (!Number.isInteger(n) || n < 1) throw new engine.LoyaltyError('Not found', 404); return n; };

const COLS = ['name', 'kind', 'description', 'logo_url', 'is_active', 'starts_on', 'ends_on', 'earn_points', 'per_amount_paise', 'min_txn_paise', 'redeem_points', 'redeem_value_paise', 'min_redeem_points', 'max_redeem_per_txn', 'reward_limit_per_member', 'expiry_days', 'membership_days', 'branch_ids', 'settings', 'card'];

export const kinds = wrap(async (_req, res) => ok(res, engine.KINDS));

export const listProgrammes = wrap(async (req, res) => {
  const rows = (await pool.query(
    `SELECT p.*, (SELECT COUNT(*) FROM loyalty_memberships m WHERE m.programme_id = p.programme_id)::int AS members
     FROM loyalty_programmes p WHERE p.business_id = $1 ORDER BY p.is_active DESC, p.programme_id`, [bid(req)])).rows;
  ok(res, rows);
});

export const createProgramme = wrap(async (req, res) => {
  const f = engine.programmeFields(req.body || {});
  const row = (await pool.query(
    `INSERT INTO loyalty_programmes (business_id, ${COLS.join(', ')}) VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [bid(req), ...COLS.map((c) => f[c])])).rows[0];
  recordAudit(req, { business_id: bid(req), action: 'loyalty.programme_created', resource_type: 'loyalty_programme', resource_id: row.programme_id, metadata: { name: f.name, kind: f.kind } });
  ok(res, row, 201);
});

export const updateProgramme = wrap(async (req, res) => {
  const programmeId = id(req);
  const old = await engine.getProgramme(pool, bid(req), programmeId);
  const f = engine.programmeFields({ ...old, ...req.body, kind: old.kind });   // the type is fixed once members have points on it
  const row = (await pool.query(
    `UPDATE loyalty_programmes SET ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND programme_id = $2 RETURNING *`,
    [bid(req), programmeId, ...COLS.map((c) => f[c])])).rows[0];
  recordAudit(req, { business_id: bid(req), action: 'loyalty.programme_changed', resource_type: 'loyalty_programme', resource_id: programmeId, metadata: req.body });
  ok(res, row);
});

/* Enrol an existing customer (customer_id), or a new one (name and mobile number). The same customer in the same programme gets the membership they already have. */
export const enrol = wrap(async (req, res) => {
  const b = req.body || {};
  const out = await withTransaction(async (c) => {
    let customerId = Number(b.customer_id) || null;
    if (!customerId) {
      const name = String(b.name || '').trim();
      const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
      if (!name || phone.length !== 10) throw new engine.LoyaltyError('Enter the customer\'s name and 10 digit mobile number');
      const found = (await c.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2 ORDER BY customer_id LIMIT 1`, [bid(req), phone])).rows[0];
      customerId = found ? found.customer_id : (await c.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [bid(req), name, phone])).rows[0].customer_id;
    }
    return engine.enrol(c, { businessId: bid(req), programmeId: Number(b.programme_id), customerId, consentMarketing: b.consent_marketing === true, createdBy: req.auth.userId });
  });
  if (out.created) recordAudit(req, { business_id: bid(req), action: 'loyalty.member_enrolled', resource_type: 'loyalty_membership', resource_id: out.membership.membership_id, metadata: { programme_id: out.membership.programme_id } });
  ok(res, out, out.created ? 201 : 200);
});

/* Search: by mobile number, membership number, or a scanned card's token. */
export const lookup = wrap(async (req, res) => {
  const rows = await engine.findMembership(pool, bid(req), { token: req.query.token, membershipNo: req.query.no, phone: req.query.phone, programmeId: req.query.programme_id });
  ok(res, await Promise.all(rows.map(async (m) => ({ ...m, token: undefined, ...(await engine.balanceOf(pool, m.membership_id)) }))));
});

export const getMembership = wrap(async (req, res) => {
  const membershipId = id(req);
  const m = (await pool.query(
    `SELECT m.*, c.name AS customer_name, c.phone AS customer_phone, p.name AS programme_name, p.kind, p.card, p.redeem_points, p.min_redeem_points, p.min_txn_paise FROM loyalty_memberships m
     JOIN customers c ON c.customer_id = m.customer_id JOIN loyalty_programmes p ON p.programme_id = m.programme_id WHERE m.business_id = $1 AND m.membership_id = $2`, [bid(req), membershipId])).rows[0];
  if (!m) throw new engine.LoyaltyError('That membership was not found', 404);
  ok(res, { ...m, ...(await engine.balanceOf(pool, membershipId)), ledger: await engine.ledgerFor(pool, bid(req), membershipId) });
});

export const setMembershipStatus = wrap(async (req, res) => {
  const status = req.body?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const r = await pool.query(`UPDATE loyalty_memberships SET status = $3 WHERE business_id = $1 AND membership_id = $2 RETURNING membership_id, status`, [bid(req), id(req), status]);
  if (!r.rows[0]) throw new engine.LoyaltyError('That membership was not found', 404);
  recordAudit(req, { business_id: bid(req), action: 'loyalty.member_status', resource_type: 'loyalty_membership', resource_id: r.rows[0].membership_id, metadata: { status } });
  ok(res, r.rows[0]);
});

const key = (req) => String(req.get('Idempotency-Key') || req.body?.key || '').slice(0, 100);

export const earn = wrap(async (req, res) => {
  const out = await withTransaction((c) => engine.earn(c, { businessId: bid(req), membershipId: id(req), amountPaise: req.body?.amount_paise, branchId: req.tenant.branchId, invoiceId: Number(req.body?.invoice_id) || null, key: key(req) || null, createdBy: req.auth.userId }));
  pushBalance([id(req)]);
  ok(res, out);
});

export const redeem = wrap(async (req, res) => {
  const out = await withTransaction((c) => engine.redeem(c, { businessId: bid(req), membershipId: id(req), points: Number(req.body?.points), branchId: req.tenant.branchId, invoiceId: Number(req.body?.invoice_id) || null, key: key(req), createdBy: req.auth.userId }));
  if (!out.duplicate) recordAudit(req, { business_id: bid(req), action: 'loyalty.points_redeemed', resource_type: 'loyalty_membership', resource_id: id(req), metadata: { points: Number(req.body?.points) } });
  pushBalance([id(req)]);
  ok(res, out);
});

export const reverse = wrap(async (req, res) => {
  const out = await withTransaction((c) => engine.reverse(c, { businessId: bid(req), entryId: id(req, 'entryId'), points: req.body?.points == null ? null : Number(req.body.points), key: key(req), reason: String(req.body?.reason || '').slice(0, 200) || null, createdBy: req.auth.userId }));
  if (!out.duplicate) recordAudit(req, { business_id: bid(req), action: 'loyalty.points_reversed', resource_type: 'points_ledger', resource_id: id(req, 'entryId'), metadata: { points: req.body?.points ?? 'all' } });
  pushBalance(out.entry ? [out.entry.membership_id] : []);
  ok(res, out);
});

/* ── outlet locations: where a wallet card should remind the member (optional) ── */
export const listLocations = wrap(async (req, res) => ok(res, (await pool.query(
  `SELECT branch_id, name, latitude::float8 AS latitude, longitude::float8 AS longitude FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY branch_id`, [bid(req)])).rows));

export const setLocation = wrap(async (req, res) => {
  const branchId = id(req, 'branchId');
  const clear = req.body?.latitude === null && req.body?.longitude === null;
  const lat = Number(req.body?.latitude); const lng = Number(req.body?.longitude);
  if (!clear && !(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new engine.LoyaltyError('Enter a latitude between -90 and 90 and a longitude between -180 and 180');
  const r = await pool.query(`UPDATE branches SET latitude = $3, longitude = $4 WHERE business_id = $1 AND branch_id = $2 RETURNING branch_id, name, latitude::float8 AS latitude, longitude::float8 AS longitude`, [bid(req), branchId, clear ? null : lat, clear ? null : lng]);
  if (!r.rows[0]) throw new engine.LoyaltyError('That outlet was not found', 404);
  recordAudit(req, { business_id: bid(req), action: 'loyalty.outlet_location', resource_type: 'branch', resource_id: branchId, metadata: { set: !clear } });
  ok(res, r.rows[0]);
});

/* ── rewards ── */
const RCOLS = ['programme_id', 'name', 'description', 'points_cost', 'value_paise', 'product_id', 'is_active', 'valid_from', 'valid_to', 'max_per_member'];

export const listRewards = wrap(async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM loyalty_rewards WHERE business_id = $1 ${req.query.programme_id ? 'AND programme_id = $2' : ''} ORDER BY is_active DESC, points_cost`, req.query.programme_id ? [bid(req), Number(req.query.programme_id)] : [bid(req)])).rows;
  ok(res, rows);
});

export const createReward = wrap(async (req, res) => {
  const programmeId = Number(req.body?.programme_id);
  await engine.getProgramme(pool, bid(req), programmeId);
  const f = { ...engine.rewardFields(req.body || {}), programme_id: programmeId };
  const row = (await pool.query(`INSERT INTO loyalty_rewards (business_id, ${RCOLS.join(', ')}) VALUES ($1, ${RCOLS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [bid(req), ...RCOLS.map((c) => f[c])])).rows[0];
  recordAudit(req, { business_id: bid(req), action: 'loyalty.reward_created', resource_type: 'loyalty_reward', resource_id: row.reward_id, metadata: { name: f.name, points_cost: f.points_cost } });
  ok(res, row, 201);
});

export const updateReward = wrap(async (req, res) => {
  const rewardId = id(req);
  const old = (await pool.query(`SELECT * FROM loyalty_rewards WHERE business_id = $1 AND reward_id = $2`, [bid(req), rewardId])).rows[0];
  if (!old) throw new engine.LoyaltyError('That reward was not found', 404);
  const f = { ...engine.rewardFields({ ...old, ...req.body }), programme_id: old.programme_id };   // the programme is fixed once made
  const row = (await pool.query(`UPDATE loyalty_rewards SET ${RCOLS.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND reward_id = $2 RETURNING *`, [bid(req), rewardId, ...RCOLS.map((c) => f[c])])).rows[0];
  recordAudit(req, { business_id: bid(req), action: 'loyalty.reward_changed', resource_type: 'loyalty_reward', resource_id: rewardId, metadata: req.body });
  ok(res, row);
});

/* The rewards a customer has claimed and not yet used on a bill: the till lists them to apply one. */
export const customerClaims = wrap(async (req, res) => ok(res, (await pool.query(
  `SELECT d.redemption_id, d.value_paise, d.created_at, r.name FROM loyalty_redemptions d JOIN loyalty_memberships m ON m.membership_id = d.membership_id JOIN loyalty_rewards r ON r.reward_id = d.reward_id
   WHERE d.business_id = $1 AND m.customer_id = $2 AND d.status = 'REDEEMED' AND d.applied_invoice_id IS NULL AND d.value_paise > 0 ORDER BY d.redemption_id`, [bid(req), id(req)])).rows));

export const memberRewards = wrap(async (req, res) => ok(res, await engine.rewardsFor(pool, bid(req), id(req))));

export const claimReward = wrap(async (req, res) => {
  const out = await withTransaction((c) => engine.redeemReward(c, { businessId: bid(req), membershipId: id(req), rewardId: Number(req.body?.reward_id), branchId: req.tenant.branchId, invoiceId: Number(req.body?.invoice_id) || null, key: key(req), createdBy: req.auth.userId }));
  if (!out.duplicate) recordAudit(req, { business_id: bid(req), action: 'loyalty.reward_claimed', resource_type: 'loyalty_redemption', resource_id: out.redemption.redemption_id, metadata: { reward_id: req.body?.reward_id } });
  pushBalance([id(req)]);
  ok(res, out);
});

export const cancelClaim = wrap(async (req, res) => {
  const out = await withTransaction((c) => engine.cancelRedemption(c, { businessId: bid(req), redemptionId: id(req), key: key(req) || `cancel:${id(req)}`, createdBy: req.auth.userId }));
  recordAudit(req, { business_id: bid(req), action: 'loyalty.reward_claim_cancelled', resource_type: 'loyalty_redemption', resource_id: id(req), metadata: {} });
  pushBalance(out.entry ? [out.entry.membership_id] : []);
  ok(res, out);
});
