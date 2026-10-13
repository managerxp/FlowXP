/*
 * The gym's single access decision engine. Reception scanning, a member's own phone check-in and a gate device all come through
 * `attempt()`; there is no second copy of "may this person come in".
 *
 * Three steps, kept apart so a failure in one can be reconciled:
 *   1. AUTHORIZE  `evaluate()` is a pure function of (member, memberships, the gym's clock, settings). It returns a reason code and never writes.
 *   2. RECORD     `attempt()` takes a per-member lock, re-checks duplicates, then writes the decision (gym_access_events) and, when approved, the
 *                 visit (gym_attendance) in ONE transaction. Both or neither: if the database fails there is no half-recorded entry.
 *   3. ACT        a gate opening is a separate command (devices.js) acknowledged separately; the decision here never opens anything by itself.
 *
 * FAILURE IS CLOSED. Any error that is not a plain refusal becomes SERVICE_UNAVAILABLE: nothing is approved, nothing is recorded as a visit.
 *
 * What a QR contains: a printed card is `FXG1.<random token>` and a phone pass is `FXD1.<random token>`. Neither holds a name, a phone number, a
 * membership or a database id. Only a SHA-256 of the token is stored, so a copy of the database cannot be turned back into working cards.
 * A static card can be lent to a friend. The controls that act on that are a duplicate cooldown, an impossible-travel check (same card at two
 * outlets within `travel_minutes`) and, if the owner switches it on, staff confirmation at the desk.
 */
import pool from '../../config/database.js';
import { awardVisit, safely } from './rewards.js';
import { GymError, getBranchSettings, getSettings, inWindow, localParts, sha256, toMinutes } from './common.js';

export const REASON = Object.freeze({
  APPROVED: 'APPROVED',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
  CREDENTIAL_REVOKED: 'CREDENTIAL_REVOKED',
  CREDENTIAL_EXPIRED: 'CREDENTIAL_EXPIRED',
  NO_MEMBERSHIP: 'NO_MEMBERSHIP',
  MEMBERSHIP_NOT_STARTED: 'MEMBERSHIP_NOT_STARTED',
  MEMBERSHIP_EXPIRED: 'MEMBERSHIP_EXPIRED',
  MEMBERSHIP_FROZEN: 'MEMBERSHIP_FROZEN',
  MEMBERSHIP_SUSPENDED: 'MEMBERSHIP_SUSPENDED',
  PAYMENT_REQUIRES_ATTENTION: 'PAYMENT_REQUIRES_ATTENTION',
  BRANCH_NOT_ALLOWED: 'BRANCH_NOT_ALLOWED',
  ACCESS_OUTSIDE_ALLOWED_HOURS: 'ACCESS_OUTSIDE_ALLOWED_HOURS',
  DUPLICATE_SCAN: 'DUPLICATE_SCAN',
  DEVICE_NOT_AUTHORIZED: 'DEVICE_NOT_AUTHORIZED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  NOT_CHECKED_IN: 'NOT_CHECKED_IN',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
});

/** What a person at the desk or on the phone is told. Plain words, no internals. */
export const REASON_TEXT = Object.freeze({
  APPROVED: 'Welcome in',
  MEMBER_NOT_FOUND: 'No such member here',
  INVALID_CREDENTIAL: 'This pass is not valid',
  CREDENTIAL_REVOKED: 'This card was cancelled or replaced',
  CREDENTIAL_EXPIRED: 'This pass has expired. Open a fresh one',
  NO_MEMBERSHIP: 'No membership on record',
  MEMBERSHIP_NOT_STARTED: 'The membership has not started yet',
  MEMBERSHIP_EXPIRED: 'The membership has ended',
  MEMBERSHIP_FROZEN: 'The membership is frozen',
  MEMBERSHIP_SUSPENDED: 'This account is on hold. Please see the desk',
  PAYMENT_REQUIRES_ATTENTION: 'A payment is due on this membership',
  BRANCH_NOT_ALLOWED: 'The membership is not valid at this branch',
  ACCESS_OUTSIDE_ALLOWED_HOURS: 'Not allowed at this time',
  DUPLICATE_SCAN: 'Already checked in',
  DEVICE_NOT_AUTHORIZED: 'This device is not authorised',
  VERIFICATION_REQUIRED: 'Please confirm who this is at the desk',
  NOT_CHECKED_IN: 'No check-in to close',
  ACTION_NOT_ALLOWED: 'Check-out is not switched on here',
  SERVICE_UNAVAILABLE: 'Please try again in a moment'
});

/* The floor under the cooldown: two scans of one card inside this many seconds are one visit, whatever the owner configured. */
const MIN_COOLDOWN_SECONDS = 5;
const SOURCES = ['RECEPTION', 'SELF', 'DEVICE'];

/* ── 1. AUTHORIZE: pure ─────────────────────────────────────────────────────────────────────── */

/** Is the gym open at this moment at this outlet? */
export const gymOpen = (hours, holidays, ctx) => {
  if (Array.isArray(holidays) && holidays.includes(ctx.today)) return { open: false, why: 'HOLIDAY' };
  if (!hours) return { open: true };
  const day = hours[String(ctx.dow)];
  if (!day) return { open: false, why: 'CLOSED_TODAY' };
  return inWindow(ctx.minutes, day.open, day.close) ? { open: true } : { open: false, why: 'CLOSED_NOW' };
};

/** Does this membership's own time window (an off-peak plan) allow now? */
export const windowAllows = (time_window, ctx) => {
  if (!time_window) return true;
  if (Array.isArray(time_window.days) && time_window.days.length && !time_window.days.map(Number).includes(ctx.dow)) return false;
  if (time_window.from && time_window.to) return inWindow(ctx.minutes, time_window.from, time_window.to);
  return true;
};

export const frozenOn = (freezes, today) => (freezes || []).some((f) => f.from <= today && today <= f.to);

/**
 * Has this membership been paid enough to let the member in? The money lives on the invoice; the membership only says what its plan asked for.
 * `inv` is the invoice row (or null when it is gone). A membership that was given free or carried over from another member is not an invoice case.
 */
export const paymentOk = (m, inv, today) => {
  if (m.payment_basis !== 'INVOICE') return true;
  if (!inv) return false;
  if (inv.inv_status === 'CANCELLED') return false;
  const total = Number(inv.total_paise);
  if (total > 0 && Number(inv.credited_paise) >= total) return false;   // fully refunded by credit note
  const paid = Number(inv.amount_paid_paise);
  const settled = Number(inv.balance_due_paise) <= 0;
  if (m.payment_policy === 'ANY_PAYMENT') return paid > 0 || total === 0;
  if (m.payment_policy === 'PAY_LATER') return settled || (m.pay_later_until != null && today <= m.pay_later_until);
  return settled;
};

/* When several memberships all say no, tell the member the reason that is closest to a yes. */
const CLOSENESS = ['MEMBERSHIP_EXPIRED', 'MEMBERSHIP_NOT_STARTED', 'MEMBERSHIP_FROZEN', 'PAYMENT_REQUIRES_ATTENTION', 'BRANCH_NOT_ALLOWED', 'ACCESS_OUTSIDE_ALLOWED_HOURS'];

/**
 * One membership against the moment of the scan. `m` carries its freezes (`freezes: [{from,to}]`) and its invoice figures (`inv`).
 * ctx: { today, dow, minutes, branchId, graceDefault, hours, holidays }
 */
export const evaluateMembership = (m, ctx) => {
  if (m.status !== 'ACTIVE' || m.kind !== 'MEMBERSHIP') return { ok: false, reason: null };
  if (m.start_date > ctx.today) return { ok: false, reason: REASON.MEMBERSHIP_NOT_STARTED };
  if (frozenOn(m.freezes, ctx.today)) return { ok: false, reason: REASON.MEMBERSHIP_FROZEN };
  const grace = m.grace_days ?? ctx.graceDefault ?? 0;
  const lastDay = new Date(`${m.end_date}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + grace);
  if (ctx.today > lastDay.toISOString().slice(0, 10)) return { ok: false, reason: REASON.MEMBERSHIP_EXPIRED };
  const inGrace = ctx.today > m.end_date;
  if (!paymentOk(m, m.inv, ctx.today)) return { ok: false, reason: REASON.PAYMENT_REQUIRES_ATTENTION };
  if (m.allowed_branch_ids && !m.allowed_branch_ids.includes(ctx.branchId)) return { ok: false, reason: REASON.BRANCH_NOT_ALLOWED };
  if (!windowAllows(m.time_window, ctx)) return { ok: false, reason: REASON.ACCESS_OUTSIDE_ALLOWED_HOURS };
  const open = gymOpen(ctx.hours, ctx.holidays, ctx);
  if (!open.open) return { ok: false, reason: REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, why: open.why };
  return { ok: true, reason: REASON.APPROVED, inGrace };
};

/**
 * Was this membership one that counted at `asOf`? A membership cancelled or transferred AFTER that moment still counted then. Only used when judging an event a
 * device reports after the fact (see devices.js): live decisions always use the membership as it is now.
 */
const countedAt = (m, asOf) => m.status === 'ACTIVE' || (asOf && ['CANCELLED', 'TRANSFERRED'].includes(m.status) && m.cancelled_at && new Date(m.cancelled_at) > asOf);

/** The member and all their memberships against the clock: the decision, and the membership that grants it (or the closest refusal). */
export const evaluate = ({ member, memberships, ctx }) => {
  if (!member || member.status === 'ARCHIVED') return { decision: 'DENIED', reason: REASON.MEMBER_NOT_FOUND };
  if (member.status !== 'ACTIVE') return { decision: 'DENIED', reason: REASON.MEMBERSHIP_SUSPENDED };
  const asOf = ctx.asOf || null;
  const live = memberships.filter((m) => m.kind === 'MEMBERSHIP' && countedAt(m, asOf)).map((m) => (m.status === 'ACTIVE' ? m : { ...m, status: 'ACTIVE' }));
  if (!live.length) return { decision: 'DENIED', reason: memberships.some((m) => m.kind === 'MEMBERSHIP') ? REASON.MEMBERSHIP_EXPIRED : REASON.NO_MEMBERSHIP };
  const results = live.map((m) => ({ m, r: evaluateMembership(m, ctx) }));
  const yes = results.find((x) => x.r.ok);
  if (yes) return { decision: 'APPROVED', reason: REASON.APPROVED, membership: yes.m, inGrace: yes.r.inGrace };
  const best = results.map((x) => x.r.reason).filter(Boolean).sort((a, b) => CLOSENESS.indexOf(b) - CLOSENESS.indexOf(a))[0] || REASON.MEMBERSHIP_EXPIRED;
  const m = results.find((x) => x.r.reason === best)?.m;
  return { decision: 'DENIED', reason: best, membership: m, why: results.find((x) => x.r.reason === best)?.r.why };
};

/* ── data loading ───────────────────────────────────────────────────────────────────────────── */

const loadMember = async (db, businessId, memberId) => (await db.query(
  `SELECT gm.member_id, gm.member_code, gm.status, gm.photo_url, c.name
   FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
   WHERE gm.member_id = $1 AND gm.business_id = $2`, [memberId, businessId])).rows[0] || null;

const MEMBERSHIP_SELECT = `
  SELECT m.*, m.start_date::text AS start_date, m.end_date::text AS end_date, m.pay_later_until::text AS pay_later_until,
         i.status AS inv_status, i.total_paise, i.amount_paid_paise, i.balance_due_paise, i.credited_paise,
         COALESCE((SELECT json_agg(json_build_object('from', f.from_date::text, 'to', f.to_date::text) ORDER BY f.from_date)
                   FROM gym_freezes f WHERE f.membership_id = m.membership_id), '[]'::json) AS freezes
  FROM gym_memberships m LEFT JOIN invoices i ON i.invoice_id = m.invoice_id AND i.business_id = m.business_id`;
const withInvoice = (m) => ({ ...m, inv: m.invoice_id ? { inv_status: m.inv_status, total_paise: m.total_paise, amount_paid_paise: m.amount_paid_paise, balance_due_paise: m.balance_due_paise, credited_paise: m.credited_paise } : null });

/**
 * Every membership that counts for a member, with its freezes and the figures of the invoice it was paid through: their own, plus, for a
 * dependent, the family membership of the person who pays for them (only as many dependents as that membership covers, in the order they joined).
 */
export const loadMemberships = async (db, businessId, memberId) => {
  const own = (await db.query(`${MEMBERSHIP_SELECT} WHERE m.member_id = $1 AND m.business_id = $2 ORDER BY m.start_date, m.membership_id`, [memberId, businessId])).rows.map(withInvoice);
  const me = (await db.query(`SELECT head_member_id FROM gym_members WHERE member_id = $1 AND business_id = $2`, [memberId, businessId])).rows[0];
  if (!me?.head_member_id) return own;
  const rank = (await db.query(
    `SELECT COUNT(*)::int AS n FROM gym_members WHERE business_id = $1 AND head_member_id = $2 AND status <> 'ARCHIVED' AND member_id < $3`, [businessId, me.head_member_id, memberId])).rows[0].n;
  const shared = (await db.query(`${MEMBERSHIP_SELECT} WHERE m.member_id = $1 AND m.business_id = $2 AND m.max_members > 1 AND m.status = 'ACTIVE'`, [me.head_member_id, businessId])).rows
    .map(withInvoice).filter((m) => rank < m.max_members - 1).map((m) => ({ ...m, shared_from: m.member_id }));
  return [...own, ...shared];
};

/**
 * What a presented code is. Read-only (the digital pass is consumed separately, atomically, in `consumePass`).
 * Returns { kind, credential } or { problem }.
 */
export const parseCode = (code) => {
  const text = String(code ?? '').trim();
  const m = /^(FXG1|FXD1)\.([A-Za-z0-9_-]{20,64})$/.exec(text);
  return m ? { kind: m[1] === 'FXG1' ? 'CARD' : 'DIGITAL', token: m[2] } : null;
};

const lookupCredential = async (db, businessId, parsed, now, historic = false) => {
  // a card cancelled after the moment being judged was a good card then
  const wasLive = (c) => c.status === 'ACTIVE' || (historic && c.revoked_at && new Date(c.revoked_at) > now);
  if (!parsed) return { problem: REASON.INVALID_CREDENTIAL, why: 'MALFORMED' };
  const hash = sha256(parsed.token);
  if (parsed.kind === 'CARD') {
    const c = (await db.query(`SELECT * FROM gym_credentials WHERE business_id = $1 AND kind = 'CARD' AND token_hash = $2`, [businessId, hash])).rows[0];
    if (!c) return { problem: REASON.INVALID_CREDENTIAL, why: 'UNKNOWN' };
    if (!wasLive(c)) return { problem: REASON.CREDENTIAL_REVOKED, credential: c };
    if (c.expires_at && new Date(c.expires_at) <= now) return { problem: REASON.CREDENTIAL_EXPIRED, credential: c };
    return { kind: 'CARD', credential: c };
  }
  // a phone pass: the token row says which credential it belongs to; it is single-use and short-lived
  const t = (await db.query(`SELECT * FROM gym_pass_tokens WHERE business_id = $1 AND token_hash = $2`, [businessId, hash])).rows[0];
  if (!t) return { problem: REASON.INVALID_CREDENTIAL, why: 'UNKNOWN' };
  const c = (await db.query(`SELECT * FROM gym_credentials WHERE credential_id = $1 AND business_id = $2`, [t.credential_id, businessId])).rows[0];
  if (!c) return { problem: REASON.INVALID_CREDENTIAL, why: 'UNKNOWN' };
  if (!wasLive(c)) return { problem: REASON.CREDENTIAL_REVOKED, credential: c };
  if (t.used_at) return { problem: REASON.INVALID_CREDENTIAL, why: 'REPLAY', credential: c };
  if (new Date(t.expires_at) <= now) return { problem: REASON.CREDENTIAL_EXPIRED, credential: c, why: 'TOKEN_EXPIRED' };
  return { kind: 'DIGITAL', credential: c, tokenHash: hash };
};

/* ── 2. RECORD ──────────────────────────────────────────────────────────────────────────────── */

const outcome = (base, extra = {}) => ({
  decision: base.decision, reason: base.reason, message: REASON_TEXT[base.reason] || '', ...extra
});

const minimal = (member) => (member ? { member_id: member.member_id, member_code: member.member_code, name: member.name, photo_url: member.photo_url || null, status: member.status } : null);

const shown = (m, today) => (m ? {
  membership_id: m.membership_id, plan_name: m.plan_name, end_date: m.end_date,
  days_left: Math.round((new Date(`${m.end_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000)
} : null);

/** A decision already recorded under this idempotency key, as the caller would have been told. */
const replay = async (db, businessId, source, key, reveal) => {
  const e = (await db.query(`SELECT * FROM gym_access_events WHERE business_id = $1 AND source = $2 AND idempotency_key = $3`, [businessId, source, key])).rows[0];
  if (!e) return null;
  const member = reveal && e.member_id ? minimal(await loadMember(db, businessId, e.member_id)) : null;
  return outcome({ decision: e.decision, reason: e.reason_code }, { event_id: Number(e.event_id), attendance_id: e.attendance_id, member, replayed: true, action: e.action });
};

/**
 * Decide and record one access attempt.
 *
 * input:
 *   businessId, branchId     the gym and outlet being entered. The caller has already proved the caller may act there (staff tenant, a member's session, a device).
 *   source                   'RECEPTION' | 'SELF' | 'DEVICE'
 *   action                   'IN' (default) | 'OUT'
 *   code                     a scanned credential (reception, device); or
 *   memberId                 a known member (self check-in by session, or the desk's manual lookup)
 *   confirm                  the desk attests it has looked at the person (manual lookup always needs it; scans need it when the owner asked for it)
 *   freshOtpAt               SELF: when this member's phone was last verified by OTP (Date)
 *   dailyCodeOk              SELF: the member typed today's front-desk code correctly (the caller checks it; the engine only asks that it was)
 *   deviceId, deviceTime     DEVICE: which reader, and the time IT says (recorded, never decisive for a live decision)
 *   late, provisional        DEVICE: this is an event the reader held while it could not reach the server. `now` is then the (clamped) time it says it happened; the visit starts
 *                            PROVISIONAL and the device module confirms it once the whole batch is through
 *   historic                 the decision is judged as of `now` in the past: a card or membership cancelled after that moment still counted then
 *   actorUserId, idempotencyKey, now, reveal
 */
export const attempt = async (input) => {
  const {
    businessId, branchId, source, action = 'IN', code = null, memberId = null, confirm = false, freshOtpAt = null, dailyCodeOk = false,
    deviceId = null, deviceTime = null, late = false, provisional = false, historic = false, actorUserId = null, idempotencyKey = null, now = new Date(), reveal = source === 'RECEPTION'
  } = input;
  if (!SOURCES.includes(source) || !['IN', 'OUT'].includes(action)) throw new GymError(400, 'Not a valid access request');
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 80) : null;

  const client = await pool.connect();
  try {
    if (key) {
      const done = await replay(client, businessId, source, key, reveal);
      if (done) return done;
    }
    await client.query('BEGIN');
    const result = await attemptInTransaction(client, { businessId, branchId, source, action, code, memberId, confirm, freshOtpAt, dailyCodeOk, deviceId, deviceTime, late, provisional, historic, actorUserId, key, now, reveal });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // the same key racing itself: the other request won, so answer with its result
    if (error?.code === '23505' && key) {
      const done = await replay(pool, businessId, source, key, reveal).catch(() => null);
      if (done) return done;
    }
    if (error instanceof GymError) throw error;
    console.error('[gym] access attempt failed:', error.message);
    return outcome({ decision: 'DENIED', reason: REASON.SERVICE_UNAVAILABLE }, { unavailable: true, action, member: null });
  } finally {
    client.release();
  }
};

const attemptInTransaction = async (db, x) => {
  const { businessId, branchId, source, action, now, reveal } = x;
  const settings = await getSettings(db, businessId);
  const branch = await getBranchSettings(db, businessId, branchId);
  const ctx0 = await localParts(db, businessId, now);
  const ctx = { ...ctx0, today: ctx0.date, branchId, graceDefault: settings.grace_days, hours: branch.hours, holidays: branch.holidays };

  const detail = { local_date: ctx.date, via: x.code ? 'QR' : 'MEMBER' };
  let member = null; let credential = null; let credentialKind = null; let early = null;

  if (source === 'DEVICE' && !x.deviceId) early = { decision: 'DENIED', reason: REASON.DEVICE_NOT_AUTHORIZED };

  if (!early && x.code) {
    const looked = await lookupCredential(db, businessId, parseCode(x.code), now, x.historic);
    if (looked.problem) {
      credential = looked.credential || null;
      if (looked.why) detail.why = looked.why;
      if (credential) member = await loadMember(db, businessId, credential.member_id);
      early = { decision: 'DENIED', reason: looked.problem };
    } else {
      credential = looked.credential; credentialKind = looked.kind;
      member = await loadMember(db, businessId, credential.member_id);
      if (looked.kind === 'DIGITAL') {
        // single use: whoever consumes it first wins, so a screenshot or a replay fails
        const used = await db.query(
          `UPDATE gym_pass_tokens SET used_at = $3 WHERE business_id = $1 AND token_hash = $2 AND used_at IS NULL RETURNING token_hash`, [businessId, looked.tokenHash, now]);
        if (!used.rows.length) { early = { decision: 'DENIED', reason: REASON.INVALID_CREDENTIAL }; detail.why = 'REPLAY'; }
      }
    }
  } else if (!early && x.memberId) {
    member = await loadMember(db, businessId, x.memberId);
    detail.method = source === 'SELF' ? 'SESSION' : 'MANUAL';
  } else if (!early) {
    early = { decision: 'DENIED', reason: REASON.INVALID_CREDENTIAL };
  }

  if (!early && !member) early = { decision: 'DENIED', reason: REASON.MEMBER_NOT_FOUND };

  /* one person at a time: a second scan of the same member waits here, then sees the first one's visit */
  if (member) await db.query('SELECT pg_advisory_xact_lock($1, $2)', [businessId, member.member_id]);

  let verdict = early;
  let membership = null; let inGrace = false;
  if (!verdict) {
    if (action === 'OUT') {
      if (!settings.checkout_enabled) verdict = { decision: 'DENIED', reason: REASON.ACTION_NOT_ALLOWED };
      else if (!member || member.status === 'ARCHIVED') verdict = { decision: 'DENIED', reason: REASON.MEMBER_NOT_FOUND };
      else verdict = { decision: 'APPROVED', reason: REASON.APPROVED };   // leaving never needs a valid membership
    } else {
      const memberships = await loadMemberships(db, businessId, member.member_id);
      verdict = evaluate({ member, memberships, ctx: x.historic ? { ...ctx, asOf: now } : ctx });
      membership = verdict.membership || null; inGrace = Boolean(verdict.inGrace);
      if (verdict.why) detail.why = verdict.why;
    }
  }

  /* things that depend on the history, not just on the membership */
  if (!early && verdict.decision === 'APPROVED' && action === 'IN') {
    // a repeat is a scan close in time to an earlier one on EITHER side of it, so a late-arriving event that happened just before one already recorded is still a repeat
    const cooldown = Math.max(MIN_COOLDOWN_SECONDS, settings.cooldown_seconds);
    const near = (await db.query(
      `SELECT abs(extract(epoch FROM occurred_at - $3::timestamptz)) AS gap FROM gym_access_events WHERE member_id = $1 AND business_id = $2 AND decision = 'APPROVED' AND action = 'IN'
         AND occurred_at BETWEEN $3::timestamptz - make_interval(secs => $4) AND $3::timestamptz + make_interval(secs => $4) ORDER BY gap LIMIT 1`,
      [member.member_id, businessId, now, cooldown])).rows[0];
    if (near) { verdict = { decision: 'DENIED', reason: REASON.DUPLICATE_SCAN }; detail.seconds_apart = Math.round(Number(near.gap)); }
    if (verdict.decision === 'APPROVED' && settings.visits_per_day > 0) {
      const n = (await db.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND local_date = $3 AND status <> 'VOIDED'`, [member.member_id, businessId, ctx.date])).rows[0].n;
      if (n >= settings.visits_per_day) { verdict = { decision: 'DENIED', reason: REASON.DUPLICATE_SCAN }; detail.visits_today = n; }
    }
    // a lent card shows up in two places: the same static card at another outlet within a few minutes needs a person to look
    if (verdict.decision === 'APPROVED' && credentialKind === 'CARD' && credential.last_used_branch && credential.last_used_branch !== branchId && credential.last_used_at
        && settings.travel_minutes > 0 && Math.abs(now - new Date(credential.last_used_at)) / 60000 < settings.travel_minutes && !x.confirm) {
      verdict = { decision: 'DENIED', reason: REASON.VERIFICATION_REQUIRED }; detail.why = 'TWO_OUTLETS';
    }
    // staff confirmation: asked for by the owner for scans, and always for a lookup by name
    if (verdict.decision === 'APPROVED' && source === 'RECEPTION' && !x.confirm && (settings.reception_confirm || detail.method === 'MANUAL')) {
      verdict = { decision: 'DENIED', reason: REASON.VERIFICATION_REQUIRED }; detail.why = 'STAFF_CONFIRM';
    }
    // a member's own phone: the OTP must be recent when the owner asked for that
    if (verdict.decision === 'APPROVED' && source === 'SELF' && settings.self_checkin_fresh_otp_minutes
        && (!x.freshOtpAt || (now - new Date(x.freshOtpAt)) / 60000 > settings.self_checkin_fresh_otp_minutes)) {
      verdict = { decision: 'DENIED', reason: REASON.VERIFICATION_REQUIRED }; detail.why = 'OTP_REQUIRED';
    }
    // the code shown at the front desk today: proof of being in the building, which the entrance poster alone is not
    if (verdict.decision === 'APPROVED' && source === 'SELF' && settings.self_checkin_daily_code && !x.dailyCodeOk) {
      verdict = { decision: 'DENIED', reason: REASON.VERIFICATION_REQUIRED }; detail.why = 'DAILY_CODE';
    }
  }

  if (inGrace) detail.in_grace = true;
  if (x.deviceTime) detail.device_time_reported = true;
  if (x.late) detail.late = true;
  const approved = verdict.decision === 'APPROVED';

  const ev = (await db.query(
    `INSERT INTO gym_access_events (business_id, branch_id, member_id, credential_id, membership_id, source, action, decision, reason_code, detail, device_id, actor_user_id, idempotency_key, occurred_at, device_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING event_id`,
    [businessId, branchId, member?.member_id ?? null, credential?.credential_id ?? null, membership?.membership_id ?? null, source, action, verdict.decision, verdict.reason, JSON.stringify(detail),
     x.deviceId, x.actorUserId, x.key, now, x.deviceTime ?? null])).rows[0];

  let attendanceId = null;
  if (approved && action === 'IN') {
    attendanceId = (await db.query(
      `INSERT INTO gym_attendance (business_id, branch_id, member_id, membership_id, check_in_at, local_date, source, device_id, status, access_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$10,$9) RETURNING attendance_id`,
      [businessId, branchId, member.member_id, membership?.membership_id ?? null, now, ctx.date, source, x.deviceId, ev.event_id, x.provisional ? 'PROVISIONAL' : 'CONFIRMED'])).rows[0].attendance_id;
  } else if (approved && action === 'OUT') {
    const open = (await db.query(
      `SELECT attendance_id FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND branch_id = $3 AND check_out_at IS NULL AND status <> 'VOIDED' ORDER BY check_in_at DESC LIMIT 1 FOR UPDATE`,
      [member.member_id, businessId, branchId])).rows[0];
    if (!open) {
      await db.query(`UPDATE gym_access_events SET decision = 'DENIED', reason_code = $2 WHERE event_id = $1`, [ev.event_id, REASON.NOT_CHECKED_IN]);
      return outcome({ decision: 'DENIED', reason: REASON.NOT_CHECKED_IN }, { event_id: Number(ev.event_id), action, member: reveal ? minimal(member) : null });
    }
    attendanceId = open.attendance_id;
    await db.query(`UPDATE gym_attendance SET check_out_at = $2 WHERE attendance_id = $1`, [attendanceId, now]);
  }
  if (attendanceId) await db.query(`UPDATE gym_access_events SET attendance_id = $2 WHERE event_id = $1`, [ev.event_id, attendanceId]);
  // points for a visit that was let in: a failure here is logged and never turns a welcome into a refusal
  if (approved && action === 'IN' && attendanceId) await safely(db, 'visit points', () => awardVisit(db, { businessId, memberId: member.member_id, localDate: ctx.date, now }));
  if (credential && approved) await db.query(`UPDATE gym_credentials SET last_used_at = $2, last_used_branch = $3 WHERE credential_id = $1`, [credential.credential_id, now, branchId]);

  const showMember = reveal || (approved && source === 'SELF');
  return outcome(verdict, {
    event_id: Number(ev.event_id), attendance_id: attendanceId, action, source,
    member: showMember ? minimal(member) : null,
    membership: showMember ? shown(membership, ctx.date) : null,
    in_grace: inGrace,
    ...(verdict.reason === REASON.VERIFICATION_REQUIRED ? { needs: detail.why } : {})
  });
};

/** Quiet housekeeping: spent and expired pass tokens are of no further use. Called when a new pass is issued. */
export const sweepPassTokens = (db = pool) =>
  db.query(`DELETE FROM gym_pass_tokens WHERE expires_at < now() - interval '1 day'`).catch(() => {});

export { toMinutes };
