/*
 * Moves a shop's older Visit card ("every Nth visit, this item is free") onto the Loyalty cards engine, so one system does everything.
 *
 *   - The Visit card becomes a STAMPS card: N-1 stamps earn a reward that is the same free item, the minimum bill carries over, and customers
 *     billed with a mobile number join it automatically.
 *   - Every customer who has stamps on the old card is joined to the new one with the same number of stamps (an opening ledger row, never edited later).
 *   - The old card is switched OFF (its history stays), so a bill is never stamped twice. It can be switched back on from the older screen's API if ever needed.
 *
 * Runs once per shop (the new card remembers where it came from) and inside one transaction: it all happens or none of it does.
 * Not carried over: the old rule of one stamp per day (a new card stamps every qualifying bill), and the free item no longer attaches itself to the bill:
 * the customer claims it from their card or at Member desk and the till applies it.
 */
import * as engine from './loyaltyEngine.js';

const FROM = 'visit_card';
const COLS = ['name', 'kind', 'description', 'logo_url', 'is_active', 'starts_on', 'ends_on', 'earn_points', 'per_amount_paise', 'min_txn_paise', 'redeem_points', 'redeem_value_paise', 'min_redeem_points', 'max_redeem_per_txn', 'reward_limit_per_member', 'expiry_days', 'membership_days', 'settings', 'card', 'branch_ids'];

const oldCard = async (db, businessId, { lock = false } = {}) => (await db.query(
  `SELECT lp.*, p.name AS reward_name, p.selling_price_paise AS reward_price_paise FROM loyalty_programs lp LEFT JOIN products p ON p.product_id = lp.reward_product_id
   WHERE lp.business_id = $1 ${lock ? 'FOR UPDATE OF lp' : ''}`, [businessId])).rows[0] || null;

/** Stamps on each customer's card now: counted from the last reward, as the older screens count them. */
const stampsByCustomer = async (db, businessId) => {
  const rows = (await db.query(`SELECT customer_id, kind FROM loyalty_events WHERE business_id = $1 AND voided_at IS NULL ORDER BY customer_id, visit_date, event_id`, [businessId])).rows;
  const out = new Map();
  for (const e of rows) out.set(e.customer_id, e.kind === 'REDEEM' ? 0 : (out.get(e.customer_id) || 0) + 1);
  return new Map([...out].filter(([, n]) => n > 0));
};

const already = async (db, businessId) => (await db.query(`SELECT programme_id FROM loyalty_programmes WHERE business_id = $1 AND settings->>'migrated_from' = $2 LIMIT 1`, [businessId, FROM])).rows[0] || null;

/** What a move would do, for the screen to show before the owner agrees. `state`: READY, DONE (moved already) or NONE (nothing to move). */
export const preview = async (db, businessId) => {
  if (await already(db, businessId)) return { state: 'DONE' };
  const o = await oldCard(db, businessId);
  if (!o || !o.is_enabled || !o.reward_product_id) return { state: 'NONE' };
  const stamps = await stampsByCustomer(db, businessId);
  return { state: 'READY', visits_required: o.visits_required, reward: `${o.reward_quantity > 1 ? `${o.reward_quantity} × ` : ''}${o.reward_name}`, customers: stamps.size, stamps: [...stamps.values()].reduce((a, b) => a + b, 0) };
};

export const run = async (db, { businessId, createdBy = null }) => {
  const o = await oldCard(db, businessId, { lock: true });   // the older card row is locked: two clicks cannot move it twice
  if (await already(db, businessId)) throw new engine.LoyaltyError('This card has already been moved to Loyalty cards', 409);
  if (!o || !o.is_enabled || !o.reward_product_id) throw new engine.LoyaltyError('There is no switched-on Visit card to move', 409);
  const need = o.visits_required - 1, qty = o.reward_quantity, item = `${qty > 1 ? `${qty} × ` : ''}${o.reward_name}`;
  const f = engine.programmeFields({
    name: 'Visit card', kind: 'STAMPS', description: `Every ${o.visits_required}th visit: ${item} free`, earn_points: 1, min_txn_paise: Number(o.min_bill_paise || 0),
    redeem_points: need, min_redeem_points: need, redeem_value_paise: Number(o.reward_price_paise || 0) * qty,
    card: { title: `${item} free`.slice(0, 40) }, auto_enrol: true, bill_qr: false
  });
  f.settings = { ...f.settings, migrated_from: FROM };
  const p = (await db.query(`INSERT INTO loyalty_programmes (business_id, ${COLS.join(', ')}) VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [businessId, ...COLS.map((c) => f[c])])).rows[0];
  await db.query(`INSERT INTO loyalty_rewards (business_id, programme_id, name, points_cost, value_paise, product_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [businessId, p.programme_id, item.slice(0, 80), need, Number(o.reward_price_paise || 0) * qty, o.reward_product_id]);
  let members = 0, stampsMoved = 0;
  for (const [customerId, n] of await stampsByCustomer(db, businessId)) {
    const { membership } = await engine.enrol(db, { businessId, programmeId: p.programme_id, customerId, createdBy });
    await db.query(
      `INSERT INTO points_ledger (business_id, customer_id, kind, points, note, created_by, programme_id, membership_id, idempotency_key) VALUES ($1,$2,'EARN',$3,'Stamps moved from the older Visit card',$4,$5,$6,$7)
       ON CONFLICT (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [businessId, customerId, n, createdBy, p.programme_id, membership.membership_id, `migrate:visit:${p.programme_id}:${customerId}`]);
    members += 1; stampsMoved += n;
  }
  await db.query(`UPDATE loyalty_programs SET is_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1`, [businessId]);
  return { programme_id: p.programme_id, members, stamps: stampsMoved };
};
