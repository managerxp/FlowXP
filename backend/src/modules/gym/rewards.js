/*
 * Gym rewards: points for visits, paid renewals, referrals, milestones and birthdays; a catalogue to spend them on.
 *
 * THE LEDGER IS THE TRUTH. A member's balance is the sum of gym_points_ledger and nothing else: no balance column to edit, no way to change a
 * balance without a row that says who, why and from what event. An EARN row is a lot with `remaining` and an expiry date: spending takes the oldest
 * points first, expiry takes only what is still unspent, and a refund takes back only what has not been spent.
 *
 * ONCE ONLY. Every award names the event it is for (source_type + source_ref: "visit:2026-10-12", "membership:41", "milestone:10") and the table
 * refuses a second row for the same event. A replayed webhook, a double tap or a retried request therefore cannot pay twice, and nothing here has to
 * remember that it already did.
 *
 * NO REWARD WITHOUT THE REAL THING. Points are awarded only for what happened: a visit that was let in (not a refused or repeated scan), a membership
 * that is paid in full (not an unpaid or refunded one), a referral whose new member has paid their first membership.
 */
import crypto from 'node:crypto';
import { GymError, addDays, bool, int, localParts, num } from './common.js';

const RULE_COLUMNS = ['is_enabled', 'visit_points', 'renewal_flat_points', 'renewal_points_per_100', 'referral_points', 'referee_points', 'birthday_points', 'milestones', 'expiry_days', 'max_points_per_day', 'min_redeem_points', 'point_value_paise'];

export const getRules = async (db, businessId) => {
  await db.query(`INSERT INTO gym_reward_rules (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  const r = (await db.query(`SELECT * FROM gym_reward_rules WHERE business_id = $1`, [businessId])).rows[0];
  return { ...r, renewal_points_per_100: Number(r.renewal_points_per_100) };
};

const cleanMilestones = (value) => {
  if (!Array.isArray(value)) throw new GymError(400, 'Milestones are a list');
  if (value.length > 20) throw new GymError(400, 'Twenty milestones at most');
  const seen = new Set();
  return value.map((m) => {
    const visits = int(m?.visits, 'Milestone visits', { min: 1, max: 100000, required: true });
    const points = int(m?.points, 'Milestone points', { min: 1, max: 100000, required: true });
    if (seen.has(visits)) throw new GymError(400, `Two milestones at ${visits} visits`);
    seen.add(visits);
    return { visits, points };
  }).sort((a, b) => a.visits - b.visits);
};

export const saveRules = async (db, businessId, b) => {
  const cur = await getRules(db, businessId);
  const has = (k) => b[k] !== undefined;
  const next = {
    is_enabled: has('is_enabled') ? bool(b.is_enabled) : cur.is_enabled,
    visit_points: has('visit_points') ? int(b.visit_points, 'Points for a visit', { min: 0, max: 1000, required: true }) : cur.visit_points,
    renewal_flat_points: has('renewal_flat_points') ? int(b.renewal_flat_points, 'Points for a renewal', { min: 0, max: 100000, required: true }) : cur.renewal_flat_points,
    renewal_points_per_100: has('renewal_points_per_100') ? num(b.renewal_points_per_100, 'Points per ₹100', { min: 0, max: 1000, required: true }) : cur.renewal_points_per_100,
    referral_points: has('referral_points') ? int(b.referral_points, 'Points for the member who refers', { min: 0, max: 100000, required: true }) : cur.referral_points,
    referee_points: has('referee_points') ? int(b.referee_points, 'Points for the new member', { min: 0, max: 100000, required: true }) : cur.referee_points,
    birthday_points: has('birthday_points') ? int(b.birthday_points, 'Birthday points', { min: 0, max: 100000, required: true }) : cur.birthday_points,
    milestones: has('milestones') ? cleanMilestones(b.milestones) : cur.milestones,
    expiry_days: has('expiry_days') ? int(b.expiry_days, 'Points last (days)', { min: 1, max: 3650 }) : cur.expiry_days,
    max_points_per_day: has('max_points_per_day') ? int(b.max_points_per_day, 'Most points a day', { min: 1, max: 1000000 }) : cur.max_points_per_day,
    min_redeem_points: has('min_redeem_points') ? int(b.min_redeem_points, 'Fewest points to spend', { min: 0, max: 1000000, required: true }) : cur.min_redeem_points,
    point_value_paise: has('point_value') ? Math.round(num(b.point_value, 'What a point is worth', { min: 0, max: 1000, required: true }) * 100) : cur.point_value_paise
  };
  const values = RULE_COLUMNS.map((c) => (c === 'milestones' ? JSON.stringify(next[c]) : next[c]));
  await db.query(`UPDATE gym_reward_rules SET ${RULE_COLUMNS.map((c, i) => `${c} = $${i + 2}${c === 'milestones' ? '::jsonb' : ''}`).join(', ')}, updated_at = now() WHERE business_id = $1`, [businessId, ...values]);
  return getRules(db, businessId);
};

/**
 * Run a reward step so that it can never break the thing that caused it: a failed award rolls back to the point it started from, is logged, and the
 * visit, the sale or the refund carries on. Needs a transaction in progress (a savepoint is how a step is undone alone).
 */
export const safely = async (db, label, fn) => {
  try {
    await db.query('SAVEPOINT gym_reward');
    const out = await fn();
    await db.query('RELEASE SAVEPOINT gym_reward');
    return out;
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT gym_reward').catch(() => {});
    console.error(`[gym] ${label} not paid:`, error.message);
    return null;
  }
};

/* ── the ledger ─────────────────────────────────────────────────────────────────────────────── */

const lock = (db, businessId, memberId) => db.query('SELECT pg_advisory_xact_lock($1, $2)', [businessId, memberId]);

/** Points whose date has passed leave the balance as EXPIRE rows. Idempotent: one expiry row per lot, whenever it runs. */
export const sweepExpired = async (db, businessId, memberId, today) => {
  const lots = (await db.query(
    `SELECT entry_id, remaining FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2 AND kind = 'EARN' AND remaining > 0 AND expires_on IS NOT NULL AND expires_on < $3::date ORDER BY entry_id FOR UPDATE`,
    [businessId, memberId, today])).rows;
  let expired = 0;
  for (const lot of lots) {
    const ins = await db.query(
      `INSERT INTO gym_points_ledger (business_id, member_id, kind, points, reason, source_type, source_ref) VALUES ($1,$2,'EXPIRE',$3,'EXPIRY','EXPIRE',$4) ON CONFLICT DO NOTHING RETURNING entry_id`,
      [businessId, memberId, -lot.remaining, `exp:${lot.entry_id}`]);
    if (ins.rows.length) { await db.query(`UPDATE gym_points_ledger SET remaining = 0 WHERE entry_id = $1`, [lot.entry_id]); expired += lot.remaining; }
  }
  return expired;
};

/** What a member can spend today: unspent points that have not run out. Read only. */
export const balanceOf = async (db, businessId, memberId, today) =>
  Number((await db.query(
    `SELECT COALESCE(SUM(remaining), 0) AS n FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2 AND kind = 'EARN' AND (expires_on IS NULL OR expires_on >= $3::date)`,
    [businessId, memberId, today])).rows[0].n);

/** The ledger itself added up: the same number as the balance once expiry has been posted. */
export const ledgerTotal = async (db, businessId, memberId) =>
  Number((await db.query(`SELECT COALESCE(SUM(points), 0) AS n FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2`, [businessId, memberId])).rows[0].n);

const memberFor = async (db, businessId, memberId) => (await db.query(
  `SELECT member_id, status, rewards_excluded, referred_by, dob::text AS dob FROM gym_members WHERE member_id = $1 AND business_id = $2`, [memberId, businessId])).rows[0] || null;

/**
 * Pay points for one event, once. Returns { awarded, duplicate, reason }.
 * Nothing is paid when rewards are off, the member is not active or is excluded, or the event has already been paid (the unique key says so).
 */
export const award = async (db, { businessId, memberId, points, reason, sourceType, sourceRef, note = null, userId = null, now = new Date(), rules = null }) => {
  const n = Math.floor(Number(points));
  if (!(n > 0)) return { awarded: 0, reason: 'NOTHING_TO_PAY' };
  const r = rules || await getRules(db, businessId);
  if (!r.is_enabled) return { awarded: 0, reason: 'REWARDS_OFF' };
  await lock(db, businessId, memberId);
  const m = await memberFor(db, businessId, memberId);
  if (!m || m.status !== 'ACTIVE' || m.rewards_excluded) return { awarded: 0, reason: 'NOT_ELIGIBLE' };
  const { date: today } = await localParts(db, businessId, now);
  let pay = n;
  if (r.max_points_per_day) {
    const got = Number((await db.query(
      `SELECT COALESCE(SUM(points), 0) AS n FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2 AND kind = 'EARN' AND reason <> 'MANUAL' AND reason <> 'REFUND'
         AND (created_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date = $3::date`, [businessId, memberId, today])).rows[0].n);
    pay = Math.min(n, Math.max(0, r.max_points_per_day - got));
    if (pay <= 0) return { awarded: 0, reason: 'DAILY_CAP' };
  }
  const expires = r.expiry_days ? addDays(today, r.expiry_days) : null;
  const ins = await db.query(
    `INSERT INTO gym_points_ledger (business_id, member_id, kind, points, remaining, expires_on, reason, source_type, source_ref, note, created_by, created_at)
     VALUES ($1,$2,'EARN',$3,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING entry_id`,
    [businessId, memberId, pay, expires, reason, sourceType, sourceRef, note, userId, now]);
  if (!ins.rows.length) return { awarded: 0, duplicate: true, reason: 'ALREADY_PAID' };
  return { awarded: pay, entry_id: Number(ins.rows[0].entry_id), capped: pay < n };
};

/* ── the events that earn ───────────────────────────────────────────────────────────────────── */

/** A visit that was let in. One reward a day however many times they come in; then any milestone their visit count has reached. */
export const awardVisit = async (db, { businessId, memberId, localDate, now = new Date() }) => {
  const rules = await getRules(db, businessId);
  if (!rules.is_enabled) return { awarded: 0 };
  let total = 0;
  if (rules.visit_points > 0) total += (await award(db, { businessId, memberId, points: rules.visit_points, reason: 'VISIT', sourceType: 'VISIT', sourceRef: `visit:${localDate}`, now, rules })).awarded;
  if (rules.milestones.length) {
    const count = (await db.query(`SELECT COUNT(DISTINCT local_date)::int AS n FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND status <> 'VOIDED'`, [memberId, businessId])).rows[0].n;
    for (const m of rules.milestones) {
      if (m.visits <= count) total += (await award(db, { businessId, memberId, points: m.points, reason: 'MILESTONE', sourceType: 'MILESTONE', sourceRef: `milestone:${m.visits}`, note: `${m.visits} visits`, now, rules })).awarded;
    }
  }
  return { awarded: total };
};

/**
 * A membership has been paid in full: points for the renewal, and, if this is the first membership of someone who was referred, the referral rewards.
 * Safe to call again for the same membership: it pays once.
 */
export const awardForMembership = async (db, { businessId, membershipId, now = new Date() }) => {
  const rules = await getRules(db, businessId);
  if (!rules.is_enabled) return { awarded: 0 };
  const m = (await db.query(
    `SELECT ms.membership_id, ms.member_id, ms.status, ms.price_paise, ms.payment_basis, i.status AS inv_status, i.total_paise, i.balance_due_paise, i.credited_paise
     FROM gym_memberships ms LEFT JOIN invoices i ON i.invoice_id = ms.invoice_id AND i.business_id = ms.business_id WHERE ms.membership_id = $1 AND ms.business_id = $2`, [membershipId, businessId])).rows[0];
  if (!m || m.status !== 'ACTIVE' || m.payment_basis !== 'INVOICE') return { awarded: 0, reason: 'NOT_A_PAID_SALE' };
  const total = Number(m.total_paise);
  if (m.inv_status !== 'ISSUED' || Number(m.balance_due_paise) > 0 || (total > 0 && Number(m.credited_paise) >= total)) return { awarded: 0, reason: 'NOT_PAID' };
  let awarded = 0;
  const pts = rules.renewal_flat_points + Math.floor((rules.renewal_points_per_100 * Number(m.price_paise)) / 10000 + 1e-9);
  if (pts > 0) awarded += (await award(db, { businessId, memberId: m.member_id, points: pts, reason: 'RENEWAL', sourceType: 'MEMBERSHIP', sourceRef: `membership:${membershipId}`, now, rules })).awarded;

  // a referral is paid when the new member's FIRST membership is paid, and only once
  const member = await memberFor(db, businessId, m.member_id);
  if (member?.referred_by && member.referred_by !== m.member_id && (rules.referral_points > 0 || rules.referee_points > 0)) {
    const earlier = (await db.query(
      `SELECT 1 FROM gym_memberships ms JOIN invoices i ON i.invoice_id = ms.invoice_id WHERE ms.member_id = $1 AND ms.business_id = $2 AND ms.membership_id <> $3 AND ms.payment_basis = 'INVOICE' AND i.status = 'ISSUED' AND i.balance_due_paise <= 0 LIMIT 1`,
      [m.member_id, businessId, membershipId])).rows.length;
    if (!earlier) {
      awarded += (await award(db, { businessId, memberId: member.referred_by, points: rules.referral_points, reason: 'REFERRAL', sourceType: 'REFERRAL', sourceRef: `referral:${m.member_id}`, note: `membership:${membershipId}`, now, rules })).awarded;
      awarded += (await award(db, { businessId, memberId: m.member_id, points: rules.referee_points, reason: 'REFERRAL', sourceType: 'REFEREE', sourceRef: `referee:${m.member_id}`, note: `membership:${membershipId}`, now, rules })).awarded;
    }
  }
  return { awarded };
};

/** On their birthday, once a year. Called by the daily scan. */
export const awardBirthday = async (db, { businessId, memberId, year, now = new Date() }) => {
  const rules = await getRules(db, businessId);
  if (!rules.is_enabled || !(rules.birthday_points > 0)) return { awarded: 0 };
  return award(db, { businessId, memberId, points: rules.birthday_points, reason: 'BIRTHDAY', sourceType: 'BIRTHDAY', sourceRef: `birthday:${year}`, now, rules });
};

/** Take back what a refunded or cancelled sale earned (and the referral it triggered), as far as it has not been spent. Idempotent. */
export const reverseForMembership = async (db, { businessId, membershipId, userId = null, now = new Date() }) => {
  const lots = (await db.query(
    `SELECT entry_id, member_id, remaining FROM gym_points_ledger WHERE business_id = $1 AND kind = 'EARN'
       AND ((source_type = 'MEMBERSHIP' AND source_ref = $2) OR (source_type IN ('REFERRAL','REFEREE') AND note = $3)) ORDER BY entry_id FOR UPDATE`,
    [businessId, `membership:${membershipId}`, `membership:${membershipId}`])).rows;
  let taken = 0;
  for (const lot of lots) {
    if (!(lot.remaining > 0)) continue;
    const ins = await db.query(
      `INSERT INTO gym_points_ledger (business_id, member_id, kind, points, reason, source_type, source_ref, note, created_by, created_at) VALUES ($1,$2,'REVERSAL',$3,'REFUND','REVERSAL',$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING entry_id`,
      [businessId, lot.member_id, -lot.remaining, `rev:${lot.entry_id}`, 'Sale refunded or cancelled', userId, now]);
    if (ins.rows.length) { await db.query(`UPDATE gym_points_ledger SET remaining = 0 WHERE entry_id = $1`, [lot.entry_id]); taken += lot.remaining; }
  }
  return { taken };
};

/* ── spending ───────────────────────────────────────────────────────────────────────────────── */

/** Use up `points` from the oldest lots first. Call inside a transaction with the member locked. */
const spendLots = async (db, businessId, memberId, points, today) => {
  const lots = (await db.query(
    `SELECT entry_id, remaining FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2 AND kind = 'EARN' AND remaining > 0 AND (expires_on IS NULL OR expires_on >= $3::date)
     ORDER BY expires_on NULLS LAST, entry_id FOR UPDATE`, [businessId, memberId, today])).rows;
  let need = points;
  for (const lot of lots) {
    if (need <= 0) break;
    const take = Math.min(need, lot.remaining);
    await db.query(`UPDATE gym_points_ledger SET remaining = remaining - $2 WHERE entry_id = $1`, [lot.entry_id, take]);
    need -= take;
  }
  if (need > 0) throw new GymError(409, 'Not enough points');
};

/** Add or take away points by hand, always with a reason. A positive amount is a new lot that never expires. */
export const adjust = async (db, { businessId, memberId, points, reason, userId, now = new Date() }) => {
  const n = Math.trunc(Number(points));
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 100000) throw new GymError(400, 'Enter a number of points to add or take away');
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new GymError(400, 'Say why the points are being changed');
  await lock(db, businessId, memberId);
  if (!await memberFor(db, businessId, memberId)) throw new GymError(404, 'Not found');
  const { date: today } = await localParts(db, businessId, now);
  await sweepExpired(db, businessId, memberId, today);
  if (n > 0) {
    await db.query(`INSERT INTO gym_points_ledger (business_id, member_id, kind, points, remaining, reason, source_type, note, created_by, created_at) VALUES ($1,$2,'EARN',$3,$3,'MANUAL','MANUAL',$4,$5,$6)`, [businessId, memberId, n, why, userId, now]);
  } else {
    await spendLots(db, businessId, memberId, -n, today);
    await db.query(`INSERT INTO gym_points_ledger (business_id, member_id, kind, points, reason, source_type, note, created_by, created_at) VALUES ($1,$2,'ADJUST',$3,'MANUAL','MANUAL',$4,$5,$6)`, [businessId, memberId, n, why, userId, now]);
  }
  return { balance: await balanceOf(db, businessId, memberId, today) };
};

/**
 * Spend points on a catalogue item. Two people redeeming for the same member at once cannot overspend: the member is locked, the balance read inside the lock.
 * `extend` is the membership module's own function, so free days go through the same rules and history as any other extension.
 */
export const redeem = async (db, { businessId, memberId, rewardId, userId, now = new Date(), extend }) => {
  await lock(db, businessId, memberId);
  const rules = await getRules(db, businessId);
  if (!rules.is_enabled) throw new GymError(409, 'Rewards are switched off');
  const m = await memberFor(db, businessId, memberId);
  if (!m) throw new GymError(404, 'Not found');
  if (m.status !== 'ACTIVE') throw new GymError(409, 'This account is not active');
  const reward = (await db.query(`SELECT * FROM gym_rewards WHERE reward_id = $1 AND business_id = $2 FOR UPDATE`, [Number(rewardId), businessId])).rows[0];
  if (!reward || !reward.is_active) throw new GymError(400, 'That reward is not available');
  if (reward.stock != null && reward.stock < 1) throw new GymError(409, 'That reward is out of stock');
  if (reward.points_cost < rules.min_redeem_points) throw new GymError(409, `The fewest points that can be spent is ${rules.min_redeem_points}`);
  const { date: today } = await localParts(db, businessId, now);
  await sweepExpired(db, businessId, memberId, today);
  const balance = await balanceOf(db, businessId, memberId, today);
  if (balance < reward.points_cost) throw new GymError(409, `They have ${balance} points and this costs ${reward.points_cost}`);

  let running = null;
  if (reward.kind === 'FREE_DAYS') {
    running = (await db.query(`SELECT membership_id FROM gym_memberships WHERE member_id = $1 AND business_id = $2 AND status = 'ACTIVE' AND kind = 'MEMBERSHIP' AND end_date >= $3::date ORDER BY end_date DESC LIMIT 1`, [memberId, businessId, today])).rows[0];
    if (!running) throw new GymError(409, 'They have no running membership to add days to');
  }
  await spendLots(db, businessId, memberId, reward.points_cost, today);
  const entry = (await db.query(
    `INSERT INTO gym_points_ledger (business_id, member_id, kind, points, reason, source_type, source_ref, note, created_by, created_at) VALUES ($1,$2,'REDEEM',$3,'REDEMPTION','REDEEM',$4,$5,$6,$7) RETURNING entry_id`,
    [businessId, memberId, -reward.points_cost, `redeem:${crypto.randomUUID()}`, reward.name, userId, now])).rows[0];
  if (reward.stock != null) await db.query(`UPDATE gym_rewards SET stock = stock - 1 WHERE reward_id = $1`, [reward.reward_id]);
  const red = (await db.query(
    `INSERT INTO gym_reward_redemptions (business_id, member_id, reward_id, reward_name, reward_kind, reward_value, points, status, ledger_entry_id, created_by, created_at, fulfilled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING redemption_id`,
    [businessId, memberId, reward.reward_id, reward.name, reward.kind, reward.value, reward.points_cost, reward.kind === 'FREE_DAYS' ? 'FULFILLED' : 'ISSUED', entry.entry_id, userId, now, reward.kind === 'FREE_DAYS' ? now : null])).rows[0];
  if (running && extend) await extend(db, { businessId }, userId, running.membership_id, { days: Math.round(Number(reward.value)), reason: `Reward: ${reward.name}` });
  return { redemption_id: red.redemption_id, balance: balance - reward.points_cost, kind: reward.kind };
};

export const fulfil = async (db, { businessId, redemptionId, note = null, now = new Date() }) => {
  const r = (await db.query(`UPDATE gym_reward_redemptions SET status = 'FULFILLED', fulfilled_at = $3, note = COALESCE($4, note) WHERE redemption_id = $1 AND business_id = $2 AND status = 'ISSUED' RETURNING redemption_id`, [redemptionId, businessId, now, note])).rows[0];
  if (!r) throw new GymError(409, 'That reward is not waiting to be handed over');
  return r;
};

/** Cancel an unfulfilled redemption: the points come back as a new lot (no expiry: they were spent in good faith), and the stock goes back. */
export const cancelRedemption = async (db, { businessId, redemptionId, userId, now = new Date() }) => {
  const r = (await db.query(`SELECT * FROM gym_reward_redemptions WHERE redemption_id = $1 AND business_id = $2 FOR UPDATE`, [redemptionId, businessId])).rows[0];
  if (!r) throw new GymError(404, 'Not found');
  if (r.status !== 'ISSUED') throw new GymError(409, r.status === 'FULFILLED' ? 'It has already been handed over' : 'It is already cancelled');
  await lock(db, businessId, r.member_id);
  await db.query(`UPDATE gym_reward_redemptions SET status = 'CANCELLED' WHERE redemption_id = $1`, [redemptionId]);
  await db.query(
    `INSERT INTO gym_points_ledger (business_id, member_id, kind, points, remaining, reason, source_type, source_ref, note, created_by, created_at) VALUES ($1,$2,'EARN',$3,$3,'REFUND','CANCEL_REDEEM',$4,$5,$6,$7)`,
    [businessId, r.member_id, r.points, `cancel:${redemptionId}`, `Cancelled: ${r.reward_name}`, userId, now]);
  if (r.reward_id) await db.query(`UPDATE gym_rewards SET stock = stock + 1 WHERE reward_id = $1 AND stock IS NOT NULL`, [r.reward_id]);
  return { returned: r.points };
};

/* ── reading ────────────────────────────────────────────────────────────────────────────────── */

export const memberPoints = async (db, businessId, memberId, { limit = 50, now = new Date() } = {}) => {
  const { date: today } = await localParts(db, businessId, now);
  const balance = await balanceOf(db, businessId, memberId, today);
  const entries = (await db.query(
    `SELECT l.entry_id, l.kind, l.points, l.reason, l.note, l.expires_on::text AS expires_on, l.created_at, u.name AS actor FROM gym_points_ledger l LEFT JOIN users u ON u.user_id = l.created_by
     WHERE l.business_id = $1 AND l.member_id = $2 ORDER BY l.entry_id DESC LIMIT $3`, [businessId, memberId, Math.min(200, limit)])).rows;
  const soon = Number((await db.query(
    `SELECT COALESCE(SUM(remaining), 0) AS n FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2 AND kind = 'EARN' AND expires_on BETWEEN $3::date AND $4::date`, [businessId, memberId, today, addDays(today, 30)])).rows[0].n);
  return { balance, expiring_in_30_days: soon, entries };
};

/** What the gym owes in points: outstanding and its worth, and what moved in a period. */
export const liability = async (db, businessId, { from, to, now = new Date() }) => {
  const rules = await getRules(db, businessId);
  const { date: today } = await localParts(db, businessId, now);
  const out = (await db.query(
    `SELECT COALESCE(SUM(remaining), 0)::bigint AS points, COUNT(DISTINCT member_id)::int AS members FROM gym_points_ledger WHERE business_id = $1 AND kind = 'EARN' AND (expires_on IS NULL OR expires_on >= $2::date)`, [businessId, today])).rows[0];
  const soon = Number((await db.query(`SELECT COALESCE(SUM(remaining), 0) AS n FROM gym_points_ledger WHERE business_id = $1 AND kind = 'EARN' AND expires_on BETWEEN $2::date AND $3::date`, [businessId, today, addDays(today, 30)])).rows[0].n);
  const moved = (await db.query(
    `SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0)::bigint AS earned, COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0)::bigint AS redeemed,
            COALESCE(-SUM(points) FILTER (WHERE kind = 'EXPIRE'), 0)::bigint AS expired, COALESCE(-SUM(points) FILTER (WHERE kind = 'REVERSAL'), 0)::bigint AS reversed
     FROM gym_points_ledger WHERE business_id = $1 AND (created_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date BETWEEN $2::date AND $3::date`, [businessId, from, to])).rows[0];
  const byReason = (await db.query(
    `SELECT reason, COALESCE(SUM(points), 0)::bigint AS points FROM gym_points_ledger WHERE business_id = $1 AND kind = 'EARN' AND (created_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date BETWEEN $2::date AND $3::date GROUP BY reason ORDER BY points DESC`, [businessId, from, to])).rows;
  const pts = Number(out.points);
  return { outstanding_points: pts, members_with_points: out.members, liability_paise: pts * rules.point_value_paise, expiring_in_30_days: soon, earned: Number(moved.earned), redeemed: Number(moved.redeemed), expired: Number(moved.expired), reversed: Number(moved.reversed), earned_by_reason: byReason.map((r) => ({ reason: r.reason, points: Number(r.points) })) };
};
