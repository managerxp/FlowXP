/*
 * The customer's own loyalty pages (/api/public/card/*). No login:
 *   GET  /join/:code   what a programme offers, for the page its QR / NFC tag / link opens
 *   POST /join/:code   a new customer joins with their name and mobile number
 *   GET  /:token       a member's card: balance, rewards, recent activity. The long secret token IS the key, so it is only ever shown to its owner.
 * A mobile number alone never reveals a card: someone already in the programme is told to ask the staff, who can hand over their link.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import { effectiveFeatureFlags, hasPlanFeature } from '../modules/planFeatures.js';
import * as engine from '../modules/loyaltyEngine.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const gone = () => new engine.LoyaltyError('This card is not available right now', 404);
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof engine.LoyaltyError) return res.status(e.status).json({ success: false, message: e.message });
    console.error('[loyalty-card]', e.message);
    res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};

/* The business's plan and type decide whether loyalty programmes exist for it, same as for staff. */
const FEATURE_SQL = `COALESCE(pl.feature_flags, '{}'::jsonb) AS plan_feature_flags, btf.feature_flags AS type_feature_flags, COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides`;
const FEATURE_JOINS = `LEFT JOIN plans pl ON pl.plan_code = b.plan_code
  LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
  LEFT JOIN LATERAL (SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) bfo ON true`;
const featureOn = (r) => b_ok(r) && hasPlanFeature({ planFeatures: effectiveFeatureFlags([r.plan_feature_flags, r.type_feature_flags], r.feature_overrides, r.business_type) }, 'loyalty_programmes');
const b_ok = (r) => r.business_status === 'ACTIVE' || r.business_status === 'TRIAL';

const programmeByCode = async (code) => {
  const r = (await pool.query(
    `SELECT p.*, b.name AS business_name, b.business_type, b.status AS business_status, b.receipt_settings->>'logo_url' AS business_logo, ${FEATURE_SQL}
     FROM loyalty_programmes p JOIN businesses b ON b.business_id = p.business_id ${FEATURE_JOINS} WHERE p.join_code = $1`, [String(code || '').slice(0, 40)])).rows[0];
  if (!r || !featureOn(r)) throw gone();
  return r;
};

/* only what a customer should see of a programme */
const publicProgramme = (r) => ({
  name: r.name, kind: r.kind, description: r.description, business: r.business_name, logo_url: r.logo_url || r.business_logo || null, card: engine.cardFields(r.card),
  earn_points: r.earn_points, per_amount_paise: String(r.per_amount_paise), redeem_points: r.redeem_points, redeem_value_paise: String(r.redeem_value_paise),
  open: (() => { try { engine.programmeOpen(r); return true; } catch { return false; } })()
});

export const joinInfo = wrap(async (req, res) => ok(res, publicProgramme(await programmeByCode(req.params.code))));

export const join = wrap(async (req, res) => {
  const r = await programmeByCode(req.params.code);
  engine.programmeOpen(r);
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
  if (!name || phone.length !== 10) throw new engine.LoyaltyError('Enter your name and 10 digit mobile number');
  const out = await withTransaction(async (c) => {
    const found = (await c.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = $2 ORDER BY customer_id LIMIT 1`, [r.business_id, phone])).rows[0];
    const customerId = found ? found.customer_id : (await c.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [r.business_id, name, phone])).rows[0].customer_id;
    return engine.enrol(c, { businessId: r.business_id, programmeId: r.programme_id, customerId, consentMarketing: req.body?.consent_marketing === true });
  });
  if (!out.created) return ok(res, { already: true });   // never hand a card to whoever types a number
  ok(res, { already: false, token: out.membership.token, membership_no: out.membership.membership_no }, 201);
});

export const card = wrap(async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 20 || token.length > 100) throw gone();
  const m = (await pool.query(
    `SELECT m.membership_id, m.business_id, m.membership_no, m.status, m.expires_at, c.name AS customer_name, p.*, b.name AS business_name, b.business_type, b.status AS business_status,
            b.receipt_settings->>'logo_url' AS business_logo, ${FEATURE_SQL}
     FROM loyalty_memberships m JOIN loyalty_programmes p ON p.programme_id = m.programme_id JOIN customers c ON c.customer_id = m.customer_id
     JOIN businesses b ON b.business_id = m.business_id ${FEATURE_JOINS} WHERE m.token = $1`, [token])).rows[0];
  if (!m || !featureOn(m)) throw gone();
  const bal = await engine.balanceOf(pool, m.membership_id);
  const rewards = (await engine.rewardsFor(pool, m.business_id, m.membership_id)).map((x) => ({ reward_id: x.reward_id, name: x.name, description: x.description, points_cost: x.points_cost, affordable: x.affordable, points_short: x.points_short }));
  const ledger = (await engine.ledgerFor(pool, m.business_id, m.membership_id, 20)).map((e) => ({ kind: e.kind, points: e.points, note: e.note, at: e.created_at }));
  res.set('Cache-Control', 'no-store');
  ok(res, { ...publicProgramme(m), customer: m.customer_name, membership_no: m.membership_no, status: m.status, expires_at: m.expires_at, ...bal, redeem_at: m.redeem_points, rewards, ledger });
});
