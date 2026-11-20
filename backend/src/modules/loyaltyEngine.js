/*
 * The loyalty engine: one set of rules for every kind of business.
 *
 * A programme holds its own earning and redeeming rules (loyalty_programmes); nothing here knows a rate. A customer joins a programme as a membership.
 * Everything that moves points goes through points_ledger and is:
 *   - atomic:     the membership row is locked first, so two scans of the same card can never both spend the same points;
 *   - idempotent: every credit, deduction and reversal carries a key, and a repeat returns the original entry instead of writing another;
 *   - append-only: a mistake is undone with a REVERSAL row that points at the entry it undoes (a database trigger refuses edits to history).
 * Money is integer paise, points are whole numbers. Callers pass a client inside a transaction (withTransaction).
 */
import crypto from 'node:crypto';

export class LoyaltyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* Kinds whose engine is built. The rest can be named in the schema but are not offered until they work. */
export const KINDS = ['POINTS', 'SPEND', 'VISITS', 'STAMPS'];
const PER_BILL = new Set(['VISITS', 'STAMPS']);   // earn a fixed amount per qualifying bill, not per rupee

const int = (v, name, { min = 0, max = 1e9, required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw new LoyaltyError(`${name} is needed`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new LoyaltyError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const day = (v, name) => { if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw new LoyaltyError(`${name} must look like 2026-01-31`); return String(v); };

/** Checks a programme as typed by the owner and returns the columns to store. */
const HEX = /^#[0-9a-fA-F]{6}$/;
export const CARD_ICONS = ['star', 'coffee', 'heart', 'gift', 'scissors', 'utensils', 'car', 'dumbbell', 'crown', 'sparkles', 'smile', 'cake', 'pizza', 'shirt', 'wrench', 'bike'];
/** How the card looks. Colours are checked so nothing but a colour can ever be stored (the customer's page paints them). */
export const cardFields = (c = {}) => {
  const hex = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
  return {
    bg: hex(c.bg, '#0f766e'), fg: hex(c.fg, '#ffffff'), accent: hex(c.accent, '#fbbf24'),
    icon: CARD_ICONS.includes(c.icon) ? c.icon : 'star',
    title: String(c.title || '').trim().slice(0, 40), message: String(c.message || '').trim().slice(0, 140)
  };
};

export const programmeFields = (b) => {
  const kind = String(b.kind || '').toUpperCase();
  if (!KINDS.includes(kind)) throw new LoyaltyError(`Choose a programme type: ${KINDS.join(', ')}`);
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) throw new LoyaltyError('Give the programme a name (up to 80 characters)');
  const perBill = PER_BILL.has(kind);
  const f = {
    name, kind, description: String(b.description || '').trim().slice(0, 300) || null,
    logo_url: String(b.logo_url || '').trim().slice(0, 500) || null,
    is_active: b.is_active !== false,
    starts_on: day(b.starts_on, 'Start date'), ends_on: day(b.ends_on, 'End date'),
    earn_points: int(b.earn_points ?? 1, 'Points earned', { min: 1, max: 100000, required: true }),
    per_amount_paise: perBill ? 0 : int(b.per_amount_paise, 'Amount that earns the points', { min: 1, max: 1e12, required: true }),
    min_txn_paise: int(b.min_txn_paise ?? 0, 'Minimum bill', { min: 0, max: 1e12 }),
    redeem_points: int(b.redeem_points ?? 1, 'Points per reward', { min: 1, max: 1e7, required: true }),
    redeem_value_paise: int(b.redeem_value_paise ?? 0, 'Reward value', { min: 0, max: 1e12 }),
    min_redeem_points: int(b.min_redeem_points ?? 1, 'Minimum points to redeem', { min: 1, max: 1e7, required: true }),
    max_redeem_per_txn: int(b.max_redeem_per_txn, 'Most points on one bill', { min: 1, max: 1e7 }),
    reward_limit_per_member: int(b.reward_limit_per_member, 'Reward limit per member', { min: 1, max: 1e6 }),
    expiry_days: int(b.expiry_days, 'Points expiry (days)', { min: 1, max: 3650 }),
    membership_days: int(b.membership_days, 'Membership length (days)', { min: 1, max: 3650 }),
    settings: { auto_enrol: b.auto_enrol !== undefined ? b.auto_enrol === true : b.settings?.auto_enrol === true, bill_qr: b.bill_qr !== undefined ? b.bill_qr === true : b.settings?.bill_qr === true },
    card: cardFields(b.card),
    branch_ids: Array.isArray(b.branch_ids) && b.branch_ids.length ? b.branch_ids.map((x) => int(x, 'Outlet', { min: 1, required: true })) : null
  };
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw new LoyaltyError('The end date must be after the start date');
  if (f.min_redeem_points < f.redeem_points && PER_BILL.has(kind)) f.min_redeem_points = f.redeem_points;   // a stamp card pays out whole rewards
  if (f.max_redeem_per_txn && f.max_redeem_per_txn < f.min_redeem_points) throw new LoyaltyError('The most on one bill cannot be less than the minimum to redeem');
  return f;
};

/** Points a bill earns on a programme. Rounded down; 0 when the bill is under the minimum. */
export const pointsFor = (p, amountPaise, multiplier = 1) => {
  const amount = Number(amountPaise);
  if (!Number.isFinite(amount) || amount < 0) throw new LoyaltyError('The bill amount is not valid');
  if (amount < Number(p.min_txn_paise)) return 0;
  const base = PER_BILL.has(p.kind) ? p.earn_points : Math.floor((amount * p.earn_points) / Number(p.per_amount_paise));
  return Math.max(0, Math.floor(base * multiplier + 1e-9));
};

/** What `points` are worth, or an error when this redemption is not allowed. Balance and rules only; the caller has locked the membership. */
export const redemptionValue = (p, balance, points) => {
  if (!Number.isInteger(points) || points <= 0) throw new LoyaltyError('Enter a whole number of points');
  if (points < p.min_redeem_points) throw new LoyaltyError(`The least you can redeem is ${p.min_redeem_points} points`);
  if (points > balance) throw new LoyaltyError(`Only ${balance} points are available`);
  if (p.max_redeem_per_txn && points > p.max_redeem_per_txn) throw new LoyaltyError(`At most ${p.max_redeem_per_txn} points can be redeemed on one bill`);
  if (PER_BILL.has(p.kind) && points % p.redeem_points !== 0) throw new LoyaltyError(`Redeem in multiples of ${p.redeem_points}`);
  return Math.floor((points * Number(p.redeem_value_paise)) / p.redeem_points);
};

const ref = () => crypto.randomBytes(24).toString('hex');
const numberFor = () => `M${crypto.randomInt(0, 1e8).toString().padStart(8, '0')}`;

/* ── programmes ─────────────────────────────────────────────────────────── */

export const getProgramme = async (db, businessId, programmeId) => {
  const row = (await db.query(`SELECT * FROM loyalty_programmes WHERE business_id = $1 AND programme_id = $2`, [businessId, programmeId])).rows[0];
  if (!row) throw new LoyaltyError('That programme was not found', 404);
  return row;
};

/** A programme is usable now when it is on, within its dates, and offered at this outlet. */
export const programmeOpen = (p, { branchId = null, on = new Date() } = {}) => {
  if (!p.is_active) throw new LoyaltyError('This programme is switched off');
  const d = on.toISOString().slice(0, 10);
  if (p.starts_on && d < String(p.starts_on).slice(0, 10)) throw new LoyaltyError('This programme has not started yet');
  if (p.ends_on && d > String(p.ends_on).slice(0, 10)) throw new LoyaltyError('This programme has ended');
  if (p.branch_ids && branchId && !p.branch_ids.includes(Number(branchId))) throw new LoyaltyError('This programme is not offered at this outlet');
};

/* ── memberships ────────────────────────────────────────────────────────── */

/** Joins a customer to a programme. The same customer in the same programme gets their existing membership back (no duplicates). */
export const enrol = async (db, { businessId, programmeId, customerId, consentMarketing = false, createdBy = null }) => {
  const p = await getProgramme(db, businessId, programmeId);
  const customer = (await db.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND customer_id = $2`, [businessId, customerId])).rows[0];
  if (!customer) throw new LoyaltyError('That customer was not found', 404);
  const existing = (await db.query(`SELECT * FROM loyalty_memberships WHERE programme_id = $1 AND customer_id = $2`, [programmeId, customerId])).rows[0];
  if (existing) return { membership: existing, created: false };
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await db.query(
      `INSERT INTO loyalty_memberships (business_id, programme_id, customer_id, membership_no, token, expires_at, consent_marketing, consent_at, created_by)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + ($6::int || ' days')::interval END, $7, CASE WHEN $7 THEN CURRENT_TIMESTAMP END, $8)
       ON CONFLICT DO NOTHING RETURNING *`,
      [businessId, programmeId, customerId, numberFor(), ref(), p.membership_days, Boolean(consentMarketing), createdBy]
    );
    if (r.rows[0]) return { membership: r.rows[0], created: true };
    const again = (await db.query(`SELECT * FROM loyalty_memberships WHERE programme_id = $1 AND customer_id = $2`, [programmeId, customerId])).rows[0];
    if (again) return { membership: again, created: false };   // lost a race with another enrolment: theirs stands
  }
  throw new LoyaltyError('Could not make a membership number, try again', 500);
};

/** Finds a membership by the customer's secret token, membership number, or (with a programme) the customer's mobile number. Always inside one business. */
export const findMembership = async (db, businessId, { token, membershipNo, phone, programmeId }) => {
  let q; let params;
  if (token) { q = `m.token = $2`; params = [businessId, String(token)]; }
  else if (membershipNo) { q = `m.membership_no = $2`; params = [businessId, String(membershipNo).toUpperCase()]; }
  else if (phone) {
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    if (digits.length < 6) throw new LoyaltyError('Enter the customer\'s mobile number');
    q = `right(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g'), 10) = $2`; params = [businessId, digits];
    if (programmeId) { q += ` AND m.programme_id = $3`; params.push(Number(programmeId)); }
  } else throw new LoyaltyError('Scan the card, or enter a membership number or mobile number');
  const rows = (await db.query(
    `SELECT m.*, c.name AS customer_name, c.phone AS customer_phone, p.name AS programme_name, p.kind
     FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id JOIN loyalty_programmes p ON p.programme_id = m.programme_id
     WHERE m.business_id = $1 AND ${q} ORDER BY m.membership_id LIMIT 5`, params)).rows;
  if (!rows.length) throw new LoyaltyError('No membership found', 404);
  return rows;
};

export const balanceOf = async (db, membershipId) => {
  const r = (await db.query(
    `SELECT COALESCE(SUM(points), 0)::int AS balance,
            COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0)::int AS earned,
            COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0)::int AS redeemed
     FROM points_ledger WHERE membership_id = $1 AND voided_at IS NULL`, [membershipId])).rows[0];
  return r;
};

/** Locks the membership row so everything that follows for this card happens one at a time, and checks the card can be used. */
const lock = async (db, businessId, membershipId) => {
  const m = (await db.query(`SELECT * FROM loyalty_memberships WHERE business_id = $1 AND membership_id = $2 FOR UPDATE`, [businessId, membershipId])).rows[0];
  if (!m) throw new LoyaltyError('That membership was not found', 404);
  return m;
};
const usable = (m) => {
  if (m.status !== 'ACTIVE') throw new LoyaltyError('This membership is switched off', 409);
  if (m.expires_at && new Date(m.expires_at) < new Date()) throw new LoyaltyError('This membership has expired. Renew it first', 409);
};

/** Writes one ledger row, or returns the row an earlier identical request wrote. */
const post = async (db, row) => {
  const r = await db.query(
    `INSERT INTO points_ledger (business_id, customer_id, invoice_id, kind, points, amount_paise, note, created_by, programme_id, membership_id, branch_id, idempotency_key, reverses_entry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *`,
    [row.businessId, row.customerId, row.invoiceId ?? null, row.kind, row.points, row.amountPaise ?? 0, row.note ?? null, row.createdBy ?? null, row.programmeId, row.membershipId, row.branchId ?? null, row.key ?? null, row.reverses ?? null]);
  if (r.rows[0]) return { entry: r.rows[0], duplicate: false };
  const old = (await db.query(`SELECT * FROM points_ledger WHERE business_id = $1 AND idempotency_key = $2`, [row.businessId, row.key])).rows[0];
  if (old.membership_id !== row.membershipId || old.kind !== row.kind) throw new LoyaltyError('That request key was already used for something else', 409);
  return { entry: old, duplicate: true };
};

/* ── moving points ──────────────────────────────────────────────────────── */

/** Credits points for a completed bill. A bill (invoice) or request key can only ever credit once. */
export const earn = async (db, { businessId, membershipId, amountPaise, branchId = null, invoiceId = null, key = null, createdBy = null, multiplier = 1 }) => {
  const m = await lock(db, businessId, membershipId);
  usable(m);
  const p = await getProgramme(db, businessId, m.programme_id);
  programmeOpen(p, { branchId });
  const idem = key || (invoiceId ? `earn:${m.programme_id}:inv:${invoiceId}` : null);
  if (!idem) throw new LoyaltyError('A request key or an invoice is needed so the same bill cannot earn twice');
  const points = pointsFor(p, amountPaise, multiplier);
  if (points <= 0) return { points: 0, duplicate: false, entry: null, balance: (await balanceOf(db, membershipId)).balance };
  const { entry, duplicate } = await post(db, { businessId, customerId: m.customer_id, invoiceId, kind: 'EARN', points, amountPaise, programmeId: p.programme_id, membershipId, branchId, key: idem, createdBy, note: 'Earned on a bill' });
  return { points: entry.points, duplicate, entry, balance: (await balanceOf(db, membershipId)).balance };
};

/** Spends points. Checks the balance after locking, so concurrent redemptions queue and the later one fails if the balance is gone. */
export const redeem = async (db, { businessId, membershipId, points, branchId = null, invoiceId = null, key, createdBy = null, reward = null }) => {
  if (!key) throw new LoyaltyError('A request key is needed so a retry cannot spend twice');
  const m = await lock(db, businessId, membershipId);
  const done = (await db.query(`SELECT * FROM points_ledger WHERE business_id = $1 AND idempotency_key = $2`, [businessId, key])).rows[0];
  if (done) {
    if (done.membership_id !== membershipId || done.kind !== 'REDEEM') throw new LoyaltyError('That request key was already used for something else', 409);
    return { entry: done, duplicate: true, value_paise: Number(done.amount_paise), balance: (await balanceOf(db, membershipId)).balance };
  }
  usable(m);
  const p = await getProgramme(db, businessId, m.programme_id);
  programmeOpen(p, { branchId });
  if (p.reward_limit_per_member) {
    const used = Number((await db.query(
      `SELECT COUNT(*) AS n FROM points_ledger r WHERE r.membership_id = $1 AND r.kind = 'REDEEM' AND NOT EXISTS (SELECT 1 FROM points_ledger x WHERE x.reverses_entry_id = r.entry_id)`, [membershipId])).rows[0].n);
    if (used >= p.reward_limit_per_member) throw new LoyaltyError(`This member has already had the ${p.reward_limit_per_member} reward${p.reward_limit_per_member === 1 ? '' : 's'} allowed`, 409);
  }
  const { balance } = await balanceOf(db, membershipId);
  let value;
  if (reward) {   // a reward costs its own exact points and is worth its own value; the programme's redeem rules do not apply, the balance still does
    if (Number(points) > balance) throw new LoyaltyError(`Only ${balance} points are available`);
    value = Number(reward.valuePaise);
  } else value = redemptionValue(p, balance, Number(points));
  const { entry, duplicate } = await post(db, { businessId, customerId: m.customer_id, invoiceId, kind: 'REDEEM', points: -Number(points), amountPaise: value, programmeId: p.programme_id, membershipId, branchId, key, createdBy, note: reward ? `Reward: ${reward.name}` : 'Redeemed' });
  return { entry, duplicate, value_paise: value, balance: (await balanceOf(db, membershipId)).balance };
};

/**
 * Undoes some or all of an entry with a reversal row. Earned points taken back never push the balance below zero (any shortfall is reported);
 * a redemption given back returns points. An entry can be reversed in parts, never beyond what is left of it.
 */
export const reverse = async (db, { businessId, entryId, points = null, key, reason = null, createdBy = null, viaClaim = false }) => {
  if (!key) throw new LoyaltyError('A request key is needed so a retry cannot reverse twice');
  const orig = (await db.query(`SELECT * FROM points_ledger WHERE business_id = $1 AND entry_id = $2`, [businessId, entryId])).rows[0];
  if (!orig || !orig.membership_id) throw new LoyaltyError('That entry was not found', 404);
  if (!['EARN', 'REDEEM'].includes(orig.kind)) throw new LoyaltyError('Only a credit or a redemption can be reversed');
  if (!viaClaim && (await db.query(`SELECT 1 FROM loyalty_redemptions WHERE ledger_entry_id = $1 AND status = 'REDEEMED'`, [entryId])).rows[0]) throw new LoyaltyError('That is a reward claim. Cancel the claim instead', 409);
  const m = await lock(db, businessId, orig.membership_id);
  const used = Number((await db.query(`SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE reverses_entry_id = $1`, [entryId])).rows[0].n);
  const left = Math.abs(orig.points) + (orig.points > 0 ? used : -used);   // reversals of a credit are negative, of a redemption positive
  if (left <= 0) throw new LoyaltyError('That entry has already been reversed', 409);
  const want = points == null ? left : Number(points);
  if (!Number.isInteger(want) || want <= 0) throw new LoyaltyError('Enter a whole number of points to reverse');
  if (want > left) throw new LoyaltyError(left <= 0 ? 'That entry has already been reversed' : `Only ${left} points of that entry can still be reversed`, 409);
  let take = want;
  let shortfall = 0;
  if (orig.points > 0) {
    const { balance } = await balanceOf(db, orig.membership_id);
    take = Math.min(want, Math.max(0, balance));
    shortfall = want - take;
  }
  if (take <= 0) return { entry: null, shortfall, balance: (await balanceOf(db, orig.membership_id)).balance, duplicate: false };
  const { entry, duplicate } = await post(db, { businessId, customerId: m.customer_id, invoiceId: orig.invoice_id, kind: 'REVERSAL', points: orig.points > 0 ? -take : take, amountPaise: 0, programmeId: orig.programme_id, membershipId: orig.membership_id, branchId: orig.branch_id, key, reverses: entryId, createdBy, note: reason || 'Reversed' });
  return { entry, shortfall, duplicate, balance: (await balanceOf(db, orig.membership_id)).balance };
};

/** A refund or credit note on a bill: takes back the share of the points that bill earned (and gives back the points it spent, in proportion). */
export const reverseForRefund = async (db, { businessId, invoiceId, refundedPaise, totalPaise, key, createdBy = null }) => {
  if (!(Number(totalPaise) > 0) || !(Number(refundedPaise) > 0)) throw new LoyaltyError('The refund amount is not valid');
  const share = Math.min(1, Number(refundedPaise) / Number(totalPaise));
  const entries = (await db.query(`SELECT * FROM points_ledger WHERE business_id = $1 AND invoice_id = $2 AND membership_id IS NOT NULL AND kind IN ('EARN','REDEEM') ORDER BY entry_id`, [businessId, invoiceId])).rows;
  const out = [];
  for (const e of entries) {
    const used = Number((await db.query(`SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE reverses_entry_id = $1`, [e.entry_id])).rows[0].n);
    const total = Math.abs(e.points);
    const done = Math.abs(used);
    const target = Math.min(total, Math.round(total * share));
    const now = target - done;
    if (now > 0) out.push(await reverse(db, { businessId, entryId: e.entry_id, points: now, key: `${key}:${e.entry_id}`, reason: 'Refund or credit note', createdBy }));
  }
  return out;
};

export const ledgerFor = async (db, businessId, membershipId, limit = 50) =>
  (await db.query(
    `SELECT entry_id, kind, points, amount_paise, invoice_id, reverses_entry_id, note, created_at,
            EXISTS (SELECT 1 FROM points_ledger x WHERE x.reverses_entry_id = points_ledger.entry_id) AS undone,
            (SELECT d.redemption_id FROM loyalty_redemptions d WHERE d.ledger_entry_id = points_ledger.entry_id AND d.status = 'REDEEMED') AS claim_id FROM points_ledger
     WHERE business_id = $1 AND membership_id = $2 ORDER BY entry_id DESC LIMIT $3`, [businessId, membershipId, Math.min(200, limit)])).rows;

/* ── expiry ─────────────────────────────────────────────────────────────── */

/**
 * Expires what a member earned more than `expiry_days` ago and has not used. Oldest points are treated as used first (first in, first out), so a member who
 * keeps redeeming never loses points they could have used: expiring = credits older than the cutoff, minus everything already taken off (redeemed, reversed, or
 * expired before), never more than the balance. Written as one EXPIRE row (history is never edited). The key carries the cutoff day, so running it twice
 * a day, or from two servers, writes it once. Returns { expired, balance } (expired 0 = nothing to do, no row written).
 */
export const expireMembership = async (db, { businessId, membershipId, on = new Date() }) => {
  const m = await lock(db, businessId, membershipId);
  const p = await getProgramme(db, businessId, m.programme_id);
  if (!p?.expiry_days) return { expired: 0, balance: (await balanceOf(db, membershipId)).balance };
  const cutoff = new Date(on.getTime() - p.expiry_days * 86400000);
  const r = (await db.query(
    `SELECT COALESCE(SUM(points) FILTER (WHERE points > 0 AND created_at < $2), 0)::int AS old_credit,
            COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)::int AS taken, COALESCE(SUM(points), 0)::int AS balance
       FROM points_ledger WHERE membership_id = $1 AND voided_at IS NULL`, [membershipId, cutoff])).rows[0];
  const expired = Math.min(r.balance, Math.max(0, r.old_credit - r.taken));
  if (expired <= 0) return { expired: 0, balance: r.balance };
  const { duplicate } = await post(db, { businessId, customerId: m.customer_id, kind: 'EXPIRE', points: -expired, amountPaise: 0, programmeId: p.programme_id, membershipId, key: `expire:${membershipId}:${cutoff.toISOString().slice(0, 10)}`, note: `Expired after ${p.expiry_days} days` });
  return { expired: duplicate ? 0 : expired, balance: r.balance - (duplicate ? 0 : expired) };
};

/* ── rewards ────────────────────────────────────────────────────────────── */

export const rewardFields = (b) => {
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) throw new LoyaltyError('Give the reward a name (up to 80 characters)');
  const f = {
    name, description: String(b.description || '').trim().slice(0, 300) || null,
    points_cost: int(b.points_cost, 'Points it costs', { min: 1, max: 1e7, required: true }),
    value_paise: int(b.value_paise ?? 0, 'Reward value', { min: 0, max: 1e12 }),
    product_id: int(b.product_id, 'Product', { min: 1 }),
    is_active: b.is_active !== false, valid_from: day(b.valid_from, 'Valid from'), valid_to: day(b.valid_to, 'Valid to'),
    max_per_member: int(b.max_per_member, 'Limit per member', { min: 1, max: 1e6 })
  };
  if (f.valid_from && f.valid_to && f.valid_to < f.valid_from) throw new LoyaltyError('The end date must be after the start date');
  return f;
};

/** The rewards this member can see: the programme's active, in-date rewards, each marked affordable or not, and how many they may still claim. */
export const rewardsFor = async (db, businessId, membershipId) => {
  const m = (await db.query(`SELECT programme_id FROM loyalty_memberships WHERE business_id = $1 AND membership_id = $2`, [businessId, membershipId])).rows[0];
  if (!m) throw new LoyaltyError('That membership was not found', 404);
  const { balance } = await balanceOf(db, membershipId);
  const rows = (await db.query(
    `SELECT r.*, (SELECT COUNT(*) FROM loyalty_redemptions d WHERE d.reward_id = r.reward_id AND d.membership_id = $3 AND d.status = 'REDEEMED')::int AS claimed
     FROM loyalty_rewards r WHERE r.business_id = $1 AND r.programme_id = $2 AND r.is_active
       AND (r.valid_from IS NULL OR r.valid_from <= CURRENT_DATE) AND (r.valid_to IS NULL OR r.valid_to >= CURRENT_DATE) ORDER BY r.points_cost`, [businessId, m.programme_id, membershipId])).rows;
  return rows.map((r) => ({ ...r, affordable: balance >= r.points_cost && (!r.max_per_member || r.claimed < r.max_per_member), points_short: Math.max(0, r.points_cost - balance) }));
};

/** A member claims a reward: points are spent once (the same key never spends twice) and the claim is recorded. */
export const redeemReward = async (db, { businessId, membershipId, rewardId, branchId = null, invoiceId = null, key, createdBy = null }) => {
  if (!key) throw new LoyaltyError('A request key is needed so a retry cannot spend twice');
  const reward = (await db.query(`SELECT * FROM loyalty_rewards WHERE business_id = $1 AND reward_id = $2`, [businessId, rewardId])).rows[0];
  if (!reward) throw new LoyaltyError('That reward was not found', 404);
  const m = await lock(db, businessId, membershipId);
  if (reward.programme_id !== m.programme_id) throw new LoyaltyError('That reward belongs to a different programme', 409);
  const earlier = (await db.query(`SELECT d.* FROM loyalty_redemptions d JOIN points_ledger l ON l.entry_id = d.ledger_entry_id WHERE l.business_id = $1 AND l.idempotency_key = $2`, [businessId, key])).rows[0];
  if (earlier) return { redemption: earlier, duplicate: true, balance: (await balanceOf(db, membershipId)).balance };
  if (!reward.is_active) throw new LoyaltyError('This reward is switched off', 409);
  const today = new Date().toISOString().slice(0, 10);
  if (reward.valid_from && today < String(reward.valid_from).slice(0, 10)) throw new LoyaltyError('This reward has not started yet', 409);
  if (reward.valid_to && today > String(reward.valid_to).slice(0, 10)) throw new LoyaltyError('This reward has ended', 409);
  if (reward.max_per_member) {
    const n = Number((await db.query(`SELECT COUNT(*) AS n FROM loyalty_redemptions WHERE reward_id = $1 AND membership_id = $2 AND status = 'REDEEMED'`, [rewardId, membershipId])).rows[0].n);
    if (n >= reward.max_per_member) throw new LoyaltyError(`This member has already claimed this reward ${reward.max_per_member} time${reward.max_per_member === 1 ? '' : 's'}`, 409);
  }
  const spent = await redeem(db, { businessId, membershipId, points: reward.points_cost, branchId, invoiceId, key, createdBy, reward: { name: reward.name, valuePaise: reward.value_paise } });
  const redemption = (await db.query(
    `INSERT INTO loyalty_redemptions (business_id, membership_id, reward_id, ledger_entry_id, points, value_paise, branch_id, invoice_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (ledger_entry_id) DO UPDATE SET ledger_entry_id = EXCLUDED.ledger_entry_id RETURNING *`,
    [businessId, membershipId, rewardId, spent.entry.entry_id, reward.points_cost, reward.value_paise, branchId, invoiceId, createdBy])).rows[0];
  return { redemption, duplicate: spent.duplicate, balance: spent.balance };
};

/** Cancels a claim: the points go back through a reversal, and the claim is marked cancelled (never deleted). */
export const cancelRedemption = async (db, { businessId, redemptionId, key, createdBy = null }) => {
  const d = (await db.query(`SELECT * FROM loyalty_redemptions WHERE business_id = $1 AND redemption_id = $2 FOR UPDATE`, [businessId, redemptionId])).rows[0];
  if (!d) throw new LoyaltyError('That claim was not found', 404);
  if (d.status === 'CANCELLED') throw new LoyaltyError('That claim is already cancelled', 409);
  if (d.applied_invoice_id) throw new LoyaltyError('That reward was used on a bill. Cancel the bill first', 409);
  const out = await reverse(db, { businessId, entryId: d.ledger_entry_id, key, reason: 'Reward claim cancelled', createdBy, viaClaim: true });
  await db.query(`UPDATE loyalty_redemptions SET status = 'CANCELLED' WHERE redemption_id = $1`, [redemptionId]);
  return out;
};

/* ── hooks for billing: a loyalty problem must never stop a sale ────────── */

const safely = async (db, name, fn) => {
  await db.query(`SAVEPOINT ${name}`);
  try { const out = await fn(); await db.query(`RELEASE SAVEPOINT ${name}`); return out; }
  catch (e) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
    if (!(e instanceof LoyaltyError)) console.error('[loyalty] skipped:', e.message);
    return null;
  }
};

/** After a bill is saved: joins the customer to any open programme that enrols automatically, then credits every programme they are in. Never throws. */
export const creditBill = async (db, { businessId, customerId, invoiceId, amountPaise, branchId = null, createdBy = null }) => {
  if (!customerId || !(Number(amountPaise) >= 0)) return [];
  const programmes = (await db.query(`SELECT * FROM loyalty_programmes WHERE business_id = $1 AND is_active`, [businessId])).rows;
  const out = [];
  for (const p of programmes) {
    const result = await safely(db, 'lp_credit', async () => {
      programmeOpen(p, { branchId });
      let m = (await db.query(`SELECT * FROM loyalty_memberships WHERE programme_id = $1 AND customer_id = $2`, [p.programme_id, customerId])).rows[0];
      if (!m && p.settings?.auto_enrol) m = (await enrol(db, { businessId, programmeId: p.programme_id, customerId, createdBy })).membership;
      if (!m) return null;
      return earn(db, { businessId, membershipId: m.membership_id, amountPaise, branchId, invoiceId, createdBy });
    });
    if (result) out.push({ programme_id: p.programme_id, ...result });
  }
  return out;
};

/** After a credit note: takes back the share of this bill's loyalty points. Never throws. */
export const refundBill = async (db, { businessId, invoiceId, refundedPaise, totalPaise, key, createdBy = null }) =>
  safely(db, 'lp_refund', () => reverseForRefund(db, { businessId, invoiceId, refundedPaise, totalPaise, key, createdBy }));
