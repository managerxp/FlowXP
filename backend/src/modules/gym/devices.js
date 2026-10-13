/*
 * Gate and reader devices: the provider-neutral contract, request signing, and what a device may ask.
 *
 * THE CONTRACT (the full text for a hardware vendor's integrator is GYM_DEVICES.md):
 *   A device signs every request: X-Device-Key (its id), X-Device-Timestamp (unix seconds) and X-Device-Signature = hex HMAC-SHA256 over
 *   "<timestamp>.<METHOD>.<path>.<sha256 of the exact body>" with its secret. A request more than two minutes old or from the future is refused, so a captured
 *   request cannot be replayed later, and every event carries its own id, so a replay inside the two minutes returns the first answer instead of recording again.
 *   The device asks "may this credential come in?" and gets back a decision and, when approved, a command id. It opens the gate only on an approval it has
 *   verified came back over a successful, signed-and-timely exchange, and it tells us afterwards whether the gate really opened (the acknowledgement).
 *   FAIL CLOSED: no answer, a late answer, an error, a refusal: the gate stays shut. FlowXP never says "yes" for a device that could not reach it.
 *
 * ADAPTERS. An adapter turns a vendor's payload into this contract's one normalised request ({ event_id, code, action, occurred_at }). The only adapter built is
 * GENERIC_HTTP, which speaks the contract directly. A vendor adapter is added when its documentation, credentials and a device to test against exist; there is
 * deliberately no guess at any vendor's wire format here.
 */
import crypto from 'node:crypto';
import pool from '../../config/database.js';
import { decrypt, encrypt } from '../crypto.js';
import { registerScan } from '../jobs.js';
import { attempt, REASON } from './access.js';
import { GymError, randomToken, safeEqual, sha256 } from './common.js';

const DOMAIN = 'flowxp-gym-device';
export const ADAPTERS = { GENERIC_HTTP: { label: 'Signed JSON over HTTPS (the FlowXP gym device contract)' } };
export const KINDS = ['QR_READER', 'RFID_READER', 'TURNSTILE', 'CONTROLLER'];
export const SKEW_SECONDS = 120;
const ROTATION_GRACE_HOURS = 24;
const ACK_TIMEOUT_SECONDS = 120;
const MAX_BATCH = 200;
const LATE_LIMIT_HOURS = 48;
const ONLINE_WITHIN_SECONDS = 180;

export const signature = (secret, { timestamp, method, path, body }) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${String(method).toUpperCase()}.${path}.${sha256(body ?? '')}`).digest('hex');

const publicDevice = (d, now = new Date()) => ({
  device_id: d.device_id, branch_id: d.branch_id, name: d.name, kind: d.kind, adapter: d.adapter, key_id: d.key_id, status: d.status, offline_policy: d.offline_policy,
  last_seen_at: d.last_seen_at, health: d.health, secret_rotated_at: d.secret_rotated_at, created_at: d.created_at,
  online: d.status === 'ACTIVE' && d.last_seen_at ? (now - new Date(d.last_seen_at)) / 1000 < ONLINE_WITHIN_SECONDS : false,
  old_secret_valid_until: d.prev_valid_until && new Date(d.prev_valid_until) > now ? d.prev_valid_until : null
});

/* ── management (staff) ─────────────────────────────────────────────────────────────────────── */

export const listDevices = async (db, businessId, branchId = null) =>
  (await db.query(`SELECT * FROM gym_devices WHERE business_id = $1 AND ($2::int IS NULL OR branch_id = $2) ORDER BY device_id`, [businessId, branchId])).rows.map((d) => publicDevice(d));

/** Register a device. The secret is returned here and never again: if it is lost, rotate it. */
export const registerDevice = async (db, { businessId, branchId, name, kind, adapter = 'GENERIC_HTTP', offlinePolicy = 'NONE', userId }) => {
  const label = String(name || '').trim();
  if (!label || label.length > 80) throw new GymError(400, 'Give the device a name (80 characters at most)');
  if (!KINDS.includes(kind)) throw new GymError(400, `The kind of device must be one of: ${KINDS.join(', ')}`);
  if (!ADAPTERS[adapter]) throw new GymError(400, `There is no adapter called ${adapter}. Supported: ${Object.keys(ADAPTERS).join(', ')}`);
  if (!['NONE', 'REPORT_ONLY'].includes(offlinePolicy)) throw new GymError(400, 'The offline policy must be NONE or REPORT_ONLY');
  const branch = (await db.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2`, [branchId, businessId])).rows.length;
  if (!branch) throw new GymError(400, 'Choose one of this gym\'s branches');
  const secret = randomToken(32);
  const keyId = `gd_${randomToken(10)}`;
  const d = (await db.query(
    `INSERT INTO gym_devices (business_id, branch_id, name, kind, adapter, key_id, secret_enc, offline_policy, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [businessId, branchId, label, kind, adapter, keyId, encrypt(secret, DOMAIN), offlinePolicy, userId])).rows[0];
  return { device: publicDevice(d), key_id: keyId, secret };
};

/** A new secret. The old one keeps working for a day so a fleet can be updated; `immediate` ends it now (a leaked secret). */
export const rotateSecret = async (db, { businessId, deviceId, immediate = false, now = new Date() }) => {
  const d = (await db.query(`SELECT * FROM gym_devices WHERE device_id = $1 AND business_id = $2 FOR UPDATE`, [deviceId, businessId])).rows[0];
  if (!d) throw new GymError(404, 'Not found');
  const secret = randomToken(32);
  await db.query(
    `UPDATE gym_devices SET secret_enc = $2, prev_secret_enc = $3, prev_valid_until = $4, secret_rotated_at = $5 WHERE device_id = $1`,
    [deviceId, encrypt(secret, DOMAIN), immediate ? null : d.secret_enc, immediate ? null : new Date(now.getTime() + ROTATION_GRACE_HOURS * 3600000), now]);
  return { key_id: d.key_id, secret, old_secret_valid_until: immediate ? null : new Date(now.getTime() + ROTATION_GRACE_HOURS * 3600000).toISOString() };
};

export const setDeviceStatus = async (db, { businessId, deviceId, status }) => {
  const d = (await db.query(`UPDATE gym_devices SET status = $3 WHERE device_id = $1 AND business_id = $2 RETURNING *`, [deviceId, businessId, status])).rows[0];
  if (!d) throw new GymError(404, 'Not found');
  return publicDevice(d);
};

export const updateDevice = async (db, { businessId, deviceId, name, offlinePolicy }) => {
  const cur = (await db.query(`SELECT * FROM gym_devices WHERE device_id = $1 AND business_id = $2`, [deviceId, businessId])).rows[0];
  if (!cur) throw new GymError(404, 'Not found');
  const label = name !== undefined ? String(name).trim() : cur.name;
  if (!label || label.length > 80) throw new GymError(400, 'Give the device a name (80 characters at most)');
  const policy = offlinePolicy ?? cur.offline_policy;
  if (!['NONE', 'REPORT_ONLY'].includes(policy)) throw new GymError(400, 'The offline policy must be NONE or REPORT_ONLY');
  return publicDevice((await db.query(`UPDATE gym_devices SET name = $3, offline_policy = $4 WHERE device_id = $1 AND business_id = $2 RETURNING *`, [deviceId, businessId, label, policy])).rows[0]);
};

/* ── authentication (the device) ────────────────────────────────────────────────────────────── */

/**
 * Who is calling? Returns the device row, or null: for ANY reason (unknown key, disabled, stale timestamp, bad signature) the answer is the same, so a caller learns
 * nothing about which of those it was. The business must be active and have the devices feature on its plan.
 */
export const authenticate = async ({ method, path, headers, rawBody, now = new Date() }) => {
  const keyId = String(headers['x-device-key'] || '');
  const ts = String(headers['x-device-timestamp'] || '');
  const sig = String(headers['x-device-signature'] || '');
  if (!/^gd_[A-Za-z0-9_-]{6,20}$/.test(keyId) || !/^\d{9,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > SKEW_SECONDS) return null;
  const d = (await pool.query(
    `SELECT d.*, b.status AS business_status, b.business_type, COALESCE(p.feature_flags, '{}'::jsonb) AS plan_flags, btf.feature_flags AS type_flags, COALESCE(bfo.overrides, '{}'::jsonb) AS overrides
     FROM gym_devices d JOIN businesses b ON b.business_id = d.business_id LEFT JOIN plans p ON p.plan_code = b.plan_code
     LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
     LEFT JOIN LATERAL (SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) bfo ON true
     WHERE d.key_id = $1`, [keyId])).rows[0];
  if (!d || d.status !== 'ACTIVE' || d.business_status !== 'ACTIVE' || d.business_type !== 'GYM') return null;
  const { effectiveFeatureFlags, hasPlanFeature } = await import('../planFeatures.js');
  if (!hasPlanFeature({ planFeatures: effectiveFeatureFlags([d.plan_flags, d.type_flags], d.overrides, d.business_type) }, 'gym_devices')) return null;
  const body = rawBody && rawBody.length ? rawBody : '';
  const candidates = [d.secret_enc];
  if (d.prev_secret_enc && d.prev_valid_until && new Date(d.prev_valid_until) > now) candidates.push(d.prev_secret_enc);
  for (const enc of candidates) {
    let secret;
    try { secret = decrypt(enc, DOMAIN); } catch { continue; }
    if (safeEqual(sig, signature(secret, { timestamp: ts, method, path, body }))) return d;
  }
  return null;
};

/* ── what a device may ask ──────────────────────────────────────────────────────────────────── */

const parseTime = (value) => {
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t;
};

/** "Someone presented this credential." Returns what the device acts on. Never throws for a refusal. */
export const processAccess = async (device, body, { now = new Date() } = {}) => {
  const eventId = String(body?.event_id ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{8,64}$/.test(eventId)) throw new GymError(400, 'event_id is required: 8 to 64 letters, digits or . _ : -');
  const code = typeof body?.credential === 'string' ? body.credential : (typeof body?.code === 'string' ? body.code : null);
  if (!code || code.length > 100) throw new GymError(400, 'credential is required');
  const action = body?.action === 'OUT' ? 'OUT' : body?.action === undefined || body?.action === 'IN' ? 'IN' : null;
  if (!action) throw new GymError(400, 'action must be IN or OUT');
  const deviceTime = body?.occurred_at ? parseTime(body.occurred_at) : null;
  if (body?.occurred_at && !deviceTime) throw new GymError(400, 'occurred_at must be a date and time');

  const result = await attempt({
    businessId: device.business_id, branchId: device.branch_id, source: 'DEVICE', action, code, deviceId: device.device_id, deviceTime,
    idempotencyKey: `d${device.device_id}:${eventId}`, now, reveal: false
  });
  if (result.unavailable) return { decision: 'DENIED', reason: REASON.SERVICE_UNAVAILABLE, open: false, event_id: eventId, unavailable: true };
  let commandId = null;
  if (result.decision === 'APPROVED' && result.event_id) {
    // one command per decision, however many times the same event is sent
    const c = await pool.query(
      `INSERT INTO gym_gate_commands (business_id, device_id, access_event_id) VALUES ($1,$2,$3) ON CONFLICT (access_event_id) WHERE access_event_id IS NOT NULL DO UPDATE SET access_event_id = EXCLUDED.access_event_id RETURNING command_id`,
      [device.business_id, device.device_id, result.event_id]);
    commandId = Number(c.rows[0].command_id);
  }
  return { decision: result.decision, reason: result.reason, message: result.message, open: result.decision === 'APPROVED', event_id: eventId, command_id: commandId, replayed: Boolean(result.replayed) };
};

/** The device says what happened at the gate. Idempotent: the first answer stands. */
export const processAck = async (device, body, { now = new Date() } = {}) => {
  const id = Number(body?.command_id);
  if (!Number.isInteger(id) || id <= 0) throw new GymError(400, 'command_id is required');
  const status = { OPENED: 'OPENED', NOT_PASSED: 'NOT_PASSED', FAILED: 'FAILED' }[String(body?.result || '').toUpperCase()];
  if (!status) throw new GymError(400, 'result must be OPENED, NOT_PASSED or FAILED');
  const c = (await pool.query(`SELECT * FROM gym_gate_commands WHERE command_id = $1 AND device_id = $2 AND business_id = $3`, [id, device.device_id, device.business_id])).rows[0];
  if (!c) throw new GymError(404, 'Not found');
  if (c.status !== 'ISSUED' && c.status !== 'TIMED_OUT') return { command_id: id, status: c.status, already: true };
  // a late acknowledgement still counts: the gate did open, even if we had given up waiting
  await pool.query(`UPDATE gym_gate_commands SET status = $2, acked_at = $3 WHERE command_id = $1`, [id, status, now]);
  return { command_id: id, status };
};

export const heartbeat = async (device, body, { now = new Date() } = {}) => {
  const h = {};
  for (const k of ['firmware', 'status', 'queued_events']) if (body?.[k] != null) h[k] = typeof body[k] === 'number' ? body[k] : String(body[k]).slice(0, 60);
  await pool.query(`UPDATE gym_devices SET last_seen_at = $2, health = $3::jsonb WHERE device_id = $1`, [device.device_id, now, JSON.stringify(h)]);
  return { ok: true, server_time: now.toISOString() };
};

/**
 * Events a device held while it could not reach us (offline_policy REPORT_ONLY): "I let this credential in at this time." Each is checked now, as it would have
 * been then: the credential as it stood at that moment (a card cancelled afterwards was valid when used), and the membership against the gym's local day and hours at that
 * moment. An event that should not have been let in is recorded as refused, with `already_admitted`, and shows in the discrepancy report for the manager; it is never
 * counted as a visit. Events are applied oldest first, each at most once (its id), and a visit is PROVISIONAL until the batch has been through.
 */
export const processBatch = async (device, body, { now = new Date() } = {}) => {
  if (device.offline_policy !== 'REPORT_ONLY') throw new GymError(403, 'This device is not set up to report events it handled offline');
  const events = Array.isArray(body?.events) ? body.events : null;
  if (!events || !events.length) throw new GymError(400, 'events is required');
  if (events.length > MAX_BATCH) throw new GymError(400, `Send at most ${MAX_BATCH} events at a time`);
  const parsed = events.map((e, i) => {
    const eventId = String(e?.event_id ?? '');
    const when = parseTime(e?.occurred_at);
    if (!/^[A-Za-z0-9._:-]{8,64}$/.test(eventId) || !when || typeof e?.credential !== 'string' || e.credential.length > 100) throw new GymError(400, `Event ${i + 1} is not valid`);
    return { eventId, when, credential: e.credential, action: e.action === 'OUT' ? 'OUT' : 'IN' };
  }).sort((a, b) => a.when - b.when);
  const results = [];
  for (const e of parsed) {
    // the time the device says, but never in the future and never older than the limit: a wrong clock cannot back-date a visit by weeks
    const earliest = new Date(now.getTime() - LATE_LIMIT_HOURS * 3600000);
    const at = e.when > now ? now : e.when < earliest ? earliest : e.when;
    const r = await attempt({
      businessId: device.business_id, branchId: device.branch_id, source: 'DEVICE', action: e.action, code: e.credential, deviceId: device.device_id, deviceTime: e.when,
      idempotencyKey: `d${device.device_id}:${e.eventId}`, now: at, late: true, provisional: true, reveal: false, historic: true
    });
    results.push({ event_id: e.eventId, decision: r.unavailable ? 'ERROR' : r.decision, reason: r.reason, replayed: Boolean(r.replayed), adjusted_time: at.getTime() !== e.when.getTime() });
    if (r.decision === 'DENIED' && r.event_id && !r.unavailable && !r.replayed) {
      await pool.query(`UPDATE gym_access_events SET detail = detail || '{"already_admitted": true}'::jsonb WHERE event_id = $1`, [r.event_id]);
    }
  }
  // the batch is through: what is still provisional and was approved is confirmed (nothing was found wrong with it)
  const confirmed = await pool.query(
    `UPDATE gym_attendance SET status = 'CONFIRMED' WHERE business_id = $1 AND device_id = $2 AND status = 'PROVISIONAL' AND access_event_id IN (SELECT event_id FROM gym_access_events WHERE business_id = $1 AND device_id = $2 AND decision = 'APPROVED') RETURNING attendance_id`,
    [device.business_id, device.device_id]);
  return { received: parsed.length, results, confirmed: confirmed.rowCount };
};

/* ── reconciliation (the worker, and the manager's screen) ──────────────────────────────────── */

/**
 * Gate commands nobody acknowledged become TIMED_OUT; visits left PROVISIONAL by a sync that was interrupted are confirmed (they were approved when recorded).
 * Safe to run any time, as often as wanted.
 */
export const reconcile = async (db = pool, { businessId = null, now = new Date() } = {}) => {
  const timedOut = await db.query(
    `UPDATE gym_gate_commands SET status = 'TIMED_OUT' WHERE status = 'ISSUED' AND issued_at < $1 AND ($2::int IS NULL OR business_id = $2) RETURNING command_id`,
    [new Date(now.getTime() - ACK_TIMEOUT_SECONDS * 1000), businessId]);
  const settled = await db.query(
    `UPDATE gym_attendance a SET status = 'CONFIRMED' FROM gym_access_events e WHERE a.status = 'PROVISIONAL' AND a.created_at < $1 AND e.event_id = a.access_event_id AND e.decision = 'APPROVED' AND ($2::int IS NULL OR a.business_id = $2) RETURNING a.attendance_id`,
    [new Date(now.getTime() - 5 * 60000), businessId]);
  return { timed_out: timedOut.rowCount, confirmed: settled.rowCount };
};

/** What a manager should look at: gates that never confirmed opening, and people a device let in who should not have been. */
export const discrepancies = async (db, businessId, { branchId = null, now = new Date(), days = 14 } = {}) => {
  const since = new Date(now.getTime() - days * 86400000);
  const commands = (await db.query(
    `SELECT c.command_id, c.status, c.issued_at, c.acked_at, d.name AS device, d.branch_id, gm.member_code, cu.name AS member_name
     FROM gym_gate_commands c JOIN gym_devices d ON d.device_id = c.device_id LEFT JOIN gym_access_events e ON e.event_id = c.access_event_id
     LEFT JOIN gym_members gm ON gm.member_id = e.member_id LEFT JOIN customers cu ON cu.customer_id = gm.customer_id
     WHERE c.business_id = $1 AND c.status IN ('TIMED_OUT','FAILED','NOT_PASSED') AND c.issued_at >= $2 AND ($3::int IS NULL OR d.branch_id = $3) ORDER BY c.issued_at DESC LIMIT 200`, [businessId, since, branchId])).rows;
  const admitted = (await db.query(
    `SELECT e.event_id, e.occurred_at, e.reason_code, e.detail, d.name AS device, gm.member_code, cu.name AS member_name
     FROM gym_access_events e JOIN gym_devices d ON d.device_id = e.device_id LEFT JOIN gym_members gm ON gm.member_id = e.member_id LEFT JOIN customers cu ON cu.customer_id = gm.customer_id
     WHERE e.business_id = $1 AND e.source = 'DEVICE' AND e.decision = 'DENIED' AND e.detail->>'already_admitted' = 'true' AND e.occurred_at >= $2 AND ($3::int IS NULL OR e.branch_id = $3) ORDER BY e.occurred_at DESC LIMIT 200`, [businessId, since, branchId])).rows;
  return { gate_not_confirmed: commands, admitted_in_error: admitted };
};

/* the worker's scan: time out unacknowledged gates and settle interrupted syncs, at most once a minute */
let lastReconcile = 0;
registerScan(async () => {
  if (Date.now() - lastReconcile < 60000) return;
  lastReconcile = Date.now();
  await reconcile(pool);
});
