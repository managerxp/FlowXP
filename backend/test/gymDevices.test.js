/*
 * Gate and reader devices: registration, signed requests, replay and forgery, decisions and gate commands kept apart, key rotation, offline events checked
 * afterwards, outages that fail closed, and reconciliation.
 */
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, day, fakeRes, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const devices = await import('../src/modules/gym/devices.js');
const creds = await import('../src/modules/gym/credentials.js');
const deviceRoutes = (await import('../src/routes/gymDevice.routes.js')).default;
const gymRoutes = (await import('../src/routes/gym.routes.js')).default;
const api = (await import('../src/controllers/gymDevices.controller.js')).default;
const { attempt } = await import('../src/modules/gym/access.js');
const { inTx, sha256 } = await import('../src/modules/gym/common.js');

let server; let base;
test.after(async () => { await new Promise((r) => server?.close(r)); await cleanup(); });

const TODAY = new Date().toLocaleDateString('en-CA');   // the server's clock is the one that matters for signed requests
let A; let B;

const card = async (g, m) => (await inTx((db) => creds.issueCard(db, { businessId: g.businessId, memberId: m, userId: g.userId }))).code;
const member = async (g, name, over = {}) => {
  const m = await addMember(pool, g, { name });
  await addMembership(pool, g, m, { start: day(TODAY, -5), end: day(TODAY, 25), ...over });
  return m;
};
const visits = async (m) => (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE member_id = $1 AND status <> 'VOIDED'`, [m])).rows[0].n;

/** A signed request exactly as a device would make it. */
const call = async (device, path, body, { ts = Math.floor(Date.now() / 1000), secret = device.secret, key = device.key_id, method = 'POST' } = {}) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  const sig = devices.signature(secret, { timestamp: String(ts), method, path, body: text });
  const res = await fetch(`${base}${path}`, {
    method, body: text || undefined,
    headers: { 'content-type': 'application/json', 'x-device-key': key, 'x-device-timestamp': String(ts), 'x-device-signature': sig }
  });
  const out = await res.json().catch(() => ({}));
  return { status: res.status, body: out, data: out.data };
};
const P = (name) => `/api/device/v1/${name}`;
let n = 0;
const eid = () => `evt-${Date.now()}-${++n}`;
const register = async (g, over = {}) => (await inTx((db) => devices.registerDevice(db, { businessId: g.businessId, branchId: g.branchId, name: 'Front door', kind: 'QR_READER', userId: g.userId, ...over })));

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const app = express();
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/device/v1', deviceRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  A = await makeGym(pool, 'devA', { branches: 2 });
  B = await makeGym(pool, 'devB');
});

/* ── registering ──────────────────────────────────────────────────────────── */

test('a device is registered with a secret shown once, kept encrypted, and checked for what it claims to be', { skip }, async () => {
  for (const bad of [{ name: '' }, { name: 'x'.repeat(81) }, { kind: 'TOASTER' }, { adapter: 'ACME_3000' }, { offlinePolicy: 'SOMETIMES' }, { branchId: B.branchId }, { branchId: 999999 }]) {
    await assert.rejects(register(A, bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  const d = await register(A, { name: 'Turnstile 1', kind: 'TURNSTILE' });
  assert.match(d.key_id, /^gd_[A-Za-z0-9_-]{10,}$/);
  assert.ok(d.secret.length >= 40);
  assert.equal(d.device.secret, undefined);
  const row = (await pool.query(`SELECT secret_enc FROM gym_devices WHERE key_id = $1`, [d.key_id])).rows[0];
  assert.ok(!row.secret_enc.includes(d.secret), 'the secret is not stored in readable form');
  const listed = await devices.listDevices(pool, A.businessId);
  assert.ok(!JSON.stringify(listed).includes(d.secret) && !JSON.stringify(listed).includes('secret_enc'), 'and never listed');
  assert.equal(devices.ADAPTERS.GENERIC_HTTP.label.length > 0, true);
});

/* ── authentication ───────────────────────────────────────────────────────── */

test('an unsigned, forged, tampered, stale or future request is refused, all alike', { skip }, async () => {
  const d = await register(A);
  const body = { event_id: eid(), credential: 'FXG1.' + 'a'.repeat(32) };
  const refused = [];
  refused.push((await fetch(`${base}${P('access')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })));     // no headers
  refused.push(await call(d, P('access'), body, { secret: 'not-the-secret' }));                                                                           // wrong secret
  refused.push(await call(d, P('access'), body, { key: 'gd_unknownkey123' }));                                                                            // unknown device
  refused.push(await call(d, P('access'), body, { ts: Math.floor(Date.now() / 1000) - 600 }));                                                            // old
  refused.push(await call(d, P('access'), body, { ts: Math.floor(Date.now() / 1000) + 600 }));                                                            // from the future
  // a body changed after signing
  const text = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = devices.signature(d.secret, { timestamp: String(ts), method: 'POST', path: P('access'), body: text });
  refused.push(await fetch(`${base}${P('access')}`, { method: 'POST', body: text.replace('FXG1', 'FXG2'), headers: { 'content-type': 'application/json', 'x-device-key': d.key_id, 'x-device-timestamp': String(ts), 'x-device-signature': sig } }));
  // a signature for another path
  const other = devices.signature(d.secret, { timestamp: String(ts), method: 'POST', path: P('heartbeat'), body: text });
  refused.push(await fetch(`${base}${P('access')}`, { method: 'POST', body: text, headers: { 'content-type': 'application/json', 'x-device-key': d.key_id, 'x-device-timestamp': String(ts), 'x-device-signature': other } }));
  const bodies = [];
  for (const r of refused) { assert.equal(r.status, 401); bodies.push(JSON.stringify(r instanceof Response ? await r.json() : r.body)); }
  assert.equal(new Set(bodies).size, 1, 'every refusal says the same thing: nothing leaks about which part was wrong');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_access_events WHERE business_id = $1`, [A.businessId])).rows[0].n, 0, 'and none of it was recorded as an access attempt');
});

test('a switched-off device, a gym without the feature, and another gym\'s device are all refused', { skip }, async () => {
  const d = await register(A);
  const m = await member(A, 'Door Tester');
  const code = await card(A, m);
  const ok1 = await call(d, P('access'), { event_id: eid(), credential: code });
  assert.equal(ok1.status, 200);
  await devices.setDeviceStatus(pool, { businessId: A.businessId, deviceId: d.device.device_id, status: 'DISABLED' });
  assert.equal((await call(d, P('access'), { event_id: eid(), credential: code })).status, 401, 'disabled');
  await devices.setDeviceStatus(pool, { businessId: A.businessId, deviceId: d.device.device_id, status: 'ACTIVE' });
  assert.equal((await call(d, P('access'), { event_id: eid(), credential: code })).status, 200, 'and back on');
  await pool.query(`UPDATE plans SET feature_flags = feature_flags || '{"gym_devices": false}'::jsonb WHERE plan_code = 'GROWTH'`);
  assert.equal((await call(d, P('access'), { event_id: eid(), credential: code })).status, 401, 'the plan does not include devices');
  await pool.query(`UPDATE plans SET feature_flags = feature_flags - 'gym_devices' WHERE plan_code = 'GROWTH'`);
  // a device of gym B cannot admit gym A's member: the card means nothing there
  const dB = await register(B, { name: 'Other gym door' });
  const r = await call(dB, P('access'), { event_id: eid(), credential: code });
  assert.equal(r.status, 200);
  assert.equal(r.data.open, false);
  assert.equal(r.data.reason, 'INVALID_CREDENTIAL');
});

/* ── decisions and commands ───────────────────────────────────────────────── */

test('an approval opens the gate with a command; a refusal says why; neither tells the device who the member is', { skip }, async () => {
  const d = await register(A);
  const m = await member(A, 'Opens The Gate');
  const code = await card(A, m);
  const r = await call(d, P('access'), { event_id: eid(), credential: code, occurred_at: new Date().toISOString() });
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, 'APPROVED');
  assert.equal(r.data.open, true);
  assert.ok(r.data.command_id > 0);
  assert.ok(!JSON.stringify(r.body).includes('Opens The Gate'), 'no member details to a gate');
  const att = (await pool.query(`SELECT source, device_id, status FROM gym_attendance WHERE member_id = $1`, [m])).rows[0];
  assert.deepEqual({ source: att.source, device_id: att.device_id, status: att.status }, { source: 'DEVICE', device_id: d.device.device_id, status: 'CONFIRMED' });
  const gone = await member(A, 'Ended Long Ago', { start: day(TODAY, -60), end: day(TODAY, -30) });
  const no = await call(d, P('access'), { event_id: eid(), credential: await card(A, gone) });
  assert.equal(no.data.open, false);
  assert.equal(no.data.reason, 'MEMBERSHIP_EXPIRED');
  assert.equal(no.data.command_id, null, 'no command to open anything');
  assert.equal((await call(d, P('access'), { event_id: eid(), credential: 'garbage' })).data.reason, 'INVALID_CREDENTIAL');
});

test('the same event sent again gets the first answer, one visit and one command', { skip }, async () => {
  const d = await register(A);
  const m = await member(A, 'Replay');
  const code = await card(A, m);
  const event = eid();
  const first = await call(d, P('access'), { event_id: event, credential: code });
  const again = await call(d, P('access'), { event_id: event, credential: code });
  const third = await call(d, P('access'), { event_id: event, credential: code });
  assert.equal(first.data.command_id, again.data.command_id);
  assert.equal(again.data.replayed, true);
  assert.equal(third.data.open, true);
  assert.equal(await visits(m), 1);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_gate_commands WHERE device_id = $1`, [d.device.device_id])).rows[0].n, 1);
  // the same event id on a different device is a different event
  const other = await register(A, { name: 'Other door' });
  const m2 = await member(A, 'Replay Two');
  const c2 = await card(A, m2);
  assert.equal((await call(d, P('access'), { event_id: 'shared-id-0001', credential: c2 })).data.open, true);
  assert.equal((await call(other, P('access'), { event_id: 'shared-id-0001', credential: c2 })).data.reason, 'DUPLICATE_SCAN', 'a separate event, judged on its own: here a repeat of the visit just made');
});

test('five readers asking about one card at the same moment let it in once', { skip }, async () => {
  const d = await register(A);
  const m = await member(A, 'Racing');
  const code = await card(A, m);
  const rs = await Promise.all(Array.from({ length: 5 }, () => call(d, P('access'), { event_id: eid(), credential: code })));
  assert.equal(rs.filter((r) => r.data.open).length, 1);
  assert.equal(await visits(m), 1);
});

test('malformed or hostile payloads are refused before they reach the rules', { skip }, async () => {
  const d = await register(A);
  const bad = [{}, { event_id: 'x', credential: 'FXG1.aaaa' }, { event_id: eid() }, { event_id: eid(), credential: 12345 }, { event_id: eid(), credential: 'x'.repeat(500) }, { event_id: eid(), credential: 'FXG1.a', action: 'EXPLODE' },
    { event_id: eid(), credential: 'FXG1.a', occurred_at: 'never' }, { event_id: "'; DROP TABLE gym_members;--", credential: 'FXG1.a' }, { event_id: eid(), credential: { $ne: null } }];
  for (const b of bad) assert.equal((await call(d, P('access'), b)).status, 400, JSON.stringify(b).slice(0, 60));
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_members`)).rows[0].n >= 0, true, 'the table is still there');
});

test('if the database fails, the device is told to keep the gate shut and nothing is half-recorded', { skip }, async () => {
  const d = await register(A);
  const m = await member(A, 'Outage');
  const code = await card(A, m);
  await pool.query(`ALTER TABLE gym_attendance RENAME TO gym_attendance_off`);
  let r;
  try { r = await call(d, P('access'), { event_id: eid(), credential: code }); } finally { await pool.query(`ALTER TABLE gym_attendance_off RENAME TO gym_attendance`); }
  assert.equal(r.status, 503);
  assert.equal(r.body.data.open, false);
  assert.equal(r.body.code, 'SERVICE_UNAVAILABLE');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_gate_commands WHERE device_id = $1`, [d.device.device_id])).rows[0].n, 0, 'no command was issued');
  assert.equal(await visits(m), 0);
});

/* ── acknowledgements and reconciliation ──────────────────────────────────── */

test('the device confirms the gate opened; the first answer stands; an unconfirmed gate is flagged after two minutes', { skip }, async () => {
  const d = await register(A); const other = await register(A, { name: 'Other' });
  const m = await member(A, 'Ack Me'); const code = await card(A, m);
  const cmd = (await call(d, P('access'), { event_id: eid(), credential: code })).data.command_id;
  assert.equal((await call(other, P('ack'), { command_id: cmd, result: 'OPENED' })).status, 404, 'another device cannot answer for this one');
  assert.equal((await call(d, P('ack'), { command_id: cmd, result: 'MAYBE' })).status, 400);
  assert.equal((await call(d, P('ack'), { command_id: 'x', result: 'OPENED' })).status, 400);
  assert.equal((await call(d, P('ack'), { command_id: 99999999, result: 'OPENED' })).status, 404);
  assert.equal((await call(d, P('ack'), { command_id: cmd, result: 'OPENED' })).data.status, 'OPENED');
  const again = await call(d, P('ack'), { command_id: cmd, result: 'FAILED' });
  assert.equal(again.data.status, 'OPENED', 'the first answer stands');
  assert.equal(again.data.already, true);

  // a gate that never answered
  const m2 = await member(A, 'No Ack'); const c2 = await card(A, m2);
  const cmd2 = (await call(d, P('access'), { event_id: eid(), credential: c2 })).data.command_id;
  await pool.query(`UPDATE gym_gate_commands SET issued_at = now() - interval '3 minutes' WHERE command_id = $1`, [cmd2]);
  assert.equal((await devices.reconcile(pool, { businessId: A.businessId })).timed_out >= 1, true);
  assert.equal((await pool.query(`SELECT status FROM gym_gate_commands WHERE command_id = $1`, [cmd2])).rows[0].status, 'TIMED_OUT');
  const problems = await devices.discrepancies(pool, A.businessId);
  assert.ok(problems.gate_not_confirmed.some((x) => Number(x.command_id) === Number(cmd2)), 'it is on the manager\'s list');
  // a late acknowledgement still counts: the gate did open
  assert.equal((await call(d, P('ack'), { command_id: cmd2, result: 'OPENED' })).data.status, 'OPENED');
  assert.ok(!(await devices.discrepancies(pool, A.businessId)).gate_not_confirmed.some((x) => Number(x.command_id) === Number(cmd2)));
  await devices.reconcile(pool, { businessId: A.businessId });
  assert.equal((await pool.query(`SELECT status FROM gym_gate_commands WHERE command_id = $1`, [cmd2])).rows[0].status, 'OPENED', 'reconciling again changes nothing');
});

test('a heartbeat says the device is alive and how it is; silence says offline', { skip }, async () => {
  const d = await register(A);
  assert.equal((await devices.listDevices(pool, A.businessId)).find((x) => x.device_id === d.device.device_id).online, false);
  const r = await call(d, P('heartbeat'), { firmware: '1.4.2', status: 'ok', queued_events: 3, junk: 'ignored' });
  assert.equal(r.status, 200);
  const dev = (await devices.listDevices(pool, A.businessId)).find((x) => x.device_id === d.device.device_id);
  assert.equal(dev.online, true);
  assert.deepEqual(dev.health, { firmware: '1.4.2', status: 'ok', queued_events: 3 });
  await pool.query(`UPDATE gym_devices SET last_seen_at = now() - interval '10 minutes' WHERE device_id = $1`, [d.device.device_id]);
  assert.equal((await devices.listDevices(pool, A.businessId)).find((x) => x.device_id === d.device.device_id).online, false);
});

/* ── rotating the secret ──────────────────────────────────────────────────── */

test('a new secret works at once, the old one for a day (or not at all if it leaked), and a lost one is not recoverable', { skip }, async () => {
  const d = await register(A);
  const rotated = await inTx((db) => devices.rotateSecret(db, { businessId: A.businessId, deviceId: d.device.device_id }));
  assert.notEqual(rotated.secret, d.secret);
  assert.equal((await call({ key_id: d.key_id }, P('heartbeat'), {}, { secret: rotated.secret })).status, 200, 'the new secret');
  assert.equal((await call({ key_id: d.key_id }, P('heartbeat'), {}, { secret: d.secret })).status, 200, 'the old one, during the grace');
  await pool.query(`UPDATE gym_devices SET prev_valid_until = now() - interval '1 minute' WHERE device_id = $1`, [d.device.device_id]);
  assert.equal((await call({ key_id: d.key_id }, P('heartbeat'), {}, { secret: d.secret })).status, 401, 'after the grace');
  const leaked = await inTx((db) => devices.rotateSecret(db, { businessId: A.businessId, deviceId: d.device.device_id, immediate: true }));
  assert.equal((await call({ key_id: d.key_id }, P('heartbeat'), {}, { secret: rotated.secret })).status, 401, 'an immediate rotation ends the old secret now');
  assert.equal((await call({ key_id: d.key_id }, P('heartbeat'), {}, { secret: leaked.secret })).status, 200);
  await assert.rejects(inTx((db) => devices.rotateSecret(db, { businessId: B.businessId, deviceId: d.device.device_id })), (e) => e.status === 404, 'not another gym\'s device');
});

/* ── events a device handled while offline ────────────────────────────────── */

const offline = async (g, name = 'Offline door') => {
  const d = await register(g, { name, offlinePolicy: 'REPORT_ONLY' });
  return d;
};

test('only a device set up for it may report events it handled offline', { skip }, async () => {
  const strict = await register(A, { name: 'Strict' });
  assert.equal((await call(strict, P('events/batch'), { events: [{ event_id: eid(), credential: 'FXG1.a', occurred_at: new Date().toISOString() }] })).status, 403);
  const d = await offline(A);
  assert.equal((await call(d, P('events/batch'), {})).status, 400);
  assert.equal((await call(d, P('events/batch'), { events: [] })).status, 400);
  assert.equal((await call(d, P('events/batch'), { events: Array.from({ length: 201 }, () => ({ event_id: eid(), credential: 'FXG1.a', occurred_at: new Date().toISOString() })) })).status, 400);
  assert.equal((await call(d, P('events/batch'), { events: [{ event_id: eid(), credential: 'FXG1.a', occurred_at: 'when' }] })).status, 400, 'one bad event refuses the whole batch');
});

test('offline events are checked as they would have been then: a visit, a refusal that was not honoured, and a replay', { skip }, async () => {
  const d = await offline(A);
  const m = await member(A, 'Offline Good'); const code = await card(A, m);
  const when = new Date(Date.now() - 3 * 3600000).toISOString();
  const e1 = eid();
  const r = await call(d, P('events/batch'), { events: [{ event_id: e1, credential: code, occurred_at: when }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.results[0].decision, 'APPROVED');
  const a = (await pool.query(`SELECT status, check_in_at FROM gym_attendance WHERE member_id = $1`, [m])).rows[0];
  assert.equal(a.status, 'CONFIRMED', 'validated, so no longer provisional');
  assert.ok(Math.abs(new Date(a.check_in_at) - new Date(when)) < 2000, 'the visit is dated when it happened, not when it was reported');
  // sent again (the sync was interrupted before the device knew): nothing is recorded twice
  const again = await call(d, P('events/batch'), { events: [{ event_id: e1, credential: code, occurred_at: when }] });
  assert.equal(again.data.results[0].replayed, true);
  assert.equal(await visits(m), 1);

  // a member whose membership ended before the moment the device says it admitted them
  const lapsed = await member(A, 'Admitted In Error', { start: day(TODAY, -60), end: day(TODAY, -30) });
  const code2 = await card(A, lapsed);
  const r2 = await call(d, P('events/batch'), { events: [{ event_id: eid(), credential: code2, occurred_at: new Date(Date.now() - 3600000).toISOString() }] });
  assert.equal(r2.data.results[0].decision, 'DENIED');
  assert.equal(await visits(lapsed), 0, 'never counted as a visit');
  const problems = await devices.discrepancies(pool, A.businessId);
  assert.ok(problems.admitted_in_error.some((x) => x.member_name === 'Admitted In Error'), 'but the manager is told');
});

test('a card or membership cancelled while the device was offline counts only from the moment it was cancelled', { skip }, async () => {
  const d = await offline(A);
  const mk = async (name) => { const m = await member(A, name); return { m, code: await card(A, m) }; };
  const before = await mk('Cancelled After'); const after = await mk('Cancelled Before'); const cardAfter = await mk('Card Revoked After'); const cardBefore = await mk('Card Revoked Before');
  const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000);
  // memberships cancelled 30 minutes ago; one event was 60 minutes ago (fine), one 10 minutes ago (too late)
  await pool.query(`UPDATE gym_memberships SET status = 'CANCELLED', cancelled_at = $2 WHERE member_id = ANY($1::int[])`, [[before.m, after.m], t(30)]);
  // cards revoked 30 minutes ago too
  await pool.query(`UPDATE gym_credentials SET status = 'REVOKED', revoked_at = $2 WHERE member_id = ANY($1::int[]) AND kind = 'CARD'`, [[cardAfter.m, cardBefore.m], t(30)]);
  const events = [
    { event_id: eid(), credential: before.code, occurred_at: t(60).toISOString() },
    { event_id: eid(), credential: after.code, occurred_at: t(10).toISOString() },
    { event_id: eid(), credential: cardAfter.code, occurred_at: t(60).toISOString() },
    { event_id: eid(), credential: cardBefore.code, occurred_at: t(10).toISOString() }
  ];
  const r = await call(d, P('events/batch'), { events });
  const byId = Object.fromEntries(r.data.results.map((x) => [x.event_id, x]));
  const decision = (i) => byId[events[i].event_id];
  // results come back in the order the events happened: look them up by event id
  assert.equal(decision(0).decision, 'APPROVED', 'membership cancelled after the event: it was good then');
  assert.equal(decision(1).decision, 'DENIED', 'membership cancelled before the event: it should not have been let in');
  assert.equal(decision(2).decision, 'APPROVED', 'card revoked after the event');
  assert.equal(decision(3).decision, 'DENIED');
  assert.equal(decision(3).reason, 'CREDENTIAL_REVOKED');
  assert.equal(await visits(before.m), 1);
  assert.equal(await visits(after.m), 0);
  // judged now, the same events from a live reader are refused
  assert.equal((await call(d, P('access'), { event_id: eid(), credential: after.code })).data.open, false);
});

test('events delivered out of order, close together or with a wrong clock cannot make extra visits or back-date them', { skip }, async () => {
  const d = await offline(A);
  const m = await member(A, 'Out Of Order'); const code = await card(A, m);
  const t0 = Date.now() - 2 * 3600000;
  const newer = { event_id: eid(), credential: code, occurred_at: new Date(t0 + 30000).toISOString() };
  const older = { event_id: eid(), credential: code, occurred_at: new Date(t0).toISOString() };
  const r1 = await call(d, P('events/batch'), { events: [newer] });      // the later one arrives first ...
  const r2 = await call(d, P('events/batch'), { events: [older] });      // ... then the earlier, 30 seconds before it
  assert.equal(r1.data.results[0].decision, 'APPROVED');
  assert.equal(r2.data.results[0].reason, 'DUPLICATE_SCAN', 'a second reading 30 seconds apart is one visit, whichever arrives first');
  assert.equal(await visits(m), 1);
  // delivered in one batch in the wrong order: applied oldest first
  const m2 = await member(A, 'One Batch'); const c2 = await card(A, m2);
  const rb = await call(d, P('events/batch'), { events: [
    { event_id: eid(), credential: c2, occurred_at: new Date(t0 + 20000).toISOString() },
    { event_id: eid(), credential: c2, occurred_at: new Date(t0).toISOString() }
  ] });
  assert.deepEqual(rb.data.results.map((x) => x.decision), ['APPROVED', 'DENIED'], 'the earlier is the visit, the later a repeat');
  assert.equal(await visits(m2), 1);
  // a clock that is wrong by weeks, or ahead
  const m3 = await member(A, 'Wrong Clock'); const c3 = await card(A, m3);
  const rc = await call(d, P('events/batch'), { events: [{ event_id: eid(), credential: c3, occurred_at: new Date(Date.now() - 20 * 86400000).toISOString() }] });
  assert.equal(rc.data.results[0].adjusted_time, true);
  const att = (await pool.query(`SELECT check_in_at FROM gym_attendance WHERE member_id = $1`, [m3])).rows[0];
  assert.ok(Date.now() - new Date(att.check_in_at) <= 48 * 3600000 + 5000, 'no further back than 48 hours');
  const m4 = await member(A, 'Future Clock'); const c4 = await card(A, m4);
  await call(d, P('events/batch'), { events: [{ event_id: eid(), credential: c4, occurred_at: new Date(Date.now() + 5 * 86400000).toISOString() }] });
  assert.ok(new Date((await pool.query(`SELECT check_in_at FROM gym_attendance WHERE member_id = $1`, [m4])).rows[0].check_in_at) <= new Date(), 'never in the future');
});

test('a sync that was cut off leaves visits provisional, and reconciling confirms them without duplicating anything', { skip }, async () => {
  const d = await offline(A);
  const m = await member(A, 'Interrupted'); const code = await card(A, m);
  const r = await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'DEVICE', deviceId: d.device.device_id, code, late: true, provisional: true, idempotencyKey: `d${d.device.device_id}:cut-off-0001`, now: new Date(Date.now() - 3600000), reveal: false });
  assert.equal(r.decision, 'APPROVED');
  assert.equal((await pool.query(`SELECT status FROM gym_attendance WHERE member_id = $1`, [m])).rows[0].status, 'PROVISIONAL');
  await pool.query(`UPDATE gym_attendance SET created_at = now() - interval '10 minutes' WHERE member_id = $1`, [m]);
  assert.ok((await devices.reconcile(pool, { businessId: A.businessId })).confirmed >= 1);
  assert.equal((await pool.query(`SELECT status FROM gym_attendance WHERE member_id = $1`, [m])).rows[0].status, 'CONFIRMED');
  // the device then sends the whole batch again: still one visit
  const again = await call(d, P('events/batch'), { events: [{ event_id: 'cut-off-0001', credential: code, occurred_at: new Date(Date.now() - 3600000).toISOString() }] });
  assert.equal(again.data.results[0].replayed, true);
  assert.equal(await visits(m), 1);
});

/* ── the manager's side ───────────────────────────────────────────────────── */

test('registering, rotating and switching off devices is a manager\'s job, only for this gym, and only if the plan has devices', { skip }, async () => {
  const owner = A.tenantFor('OWNER');
  const made = await A.call(api.register, { body: { name: 'Gate 2', kind: 'turnstile', branch_id: A.branchIds[1] } }, owner);
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.ok(made.body.data.secret);
  assert.equal(made.headers['Cache-Control'], 'no-store');
  const id = made.body.data.device.device_id;
  const list = await A.call(api.list, {}, A.allOutlets());
  assert.equal(list.body.data.devices.some((x) => x.device_id === id), true);
  assert.ok(!JSON.stringify(list.body).includes(made.body.data.secret));
  assert.equal((await B.call(api.rotate, { params: { id } }, B.tenantFor('OWNER'))).code, 404, 'another gym cannot reach it');
  assert.equal((await B.call(api.disable, { params: { id } }, B.tenantFor('OWNER'))).code, 404);
  assert.equal((await B.call(api.list, {}, B.tenantFor('OWNER'))).body.data.devices.length >= 0, true);
  const all = A.allOutlets();
  assert.equal((await A.call(api.update, { params: { id }, body: { offline_policy: 'sometimes' } }, all)).code, 400);
  assert.equal((await A.call(api.update, { params: { id }, body: { name: 'Gate 2 (left)', offline_policy: 'report_only' } }, all)).body.data.offline_policy, 'REPORT_ONLY');
  // an outlet-pinned manager sees only that outlet's devices
  const pinned = A.tenantFor('MANAGER', { branchId: A.branchIds[0], pinned: true });
  assert.equal((await A.call(api.list, {}, pinned)).body.data.devices.every((x) => x.branch_id === A.branchIds[0]), true);
  assert.equal((await A.call(api.rotate, { params: { id } }, pinned)).code, 404, 'and cannot touch the other outlet\'s');
  const reg = await A.call(api.register, { body: { name: 'Bad', kind: 'nope' } }, owner);
  assert.equal(reg.code, 400);

  const routes = gymRoutes.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
  const gate = async (method, path, t) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    for (const mw of route.stack.slice(2, -1)) { const res = fakeRes(); let ok = false; await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined }, res, () => { ok = true; }); if (!ok) return res.code; }
    return 200;
  };
  assert.equal(await gate('POST', '/devices', A.tenantFor('OWNER')), 200);
  assert.equal(await gate('POST', '/devices', A.tenantFor('GYM_RECEPTIONIST')), 403, 'the front desk cannot register a device');
  assert.equal(await gate('POST', '/devices/:id/rotate-secret', A.tenantFor('MANAGER')), 200);
  assert.equal(await gate('POST', '/devices/:id/rotate-secret', A.tenantFor('TRAINER')), 403);
  assert.equal(await gate('GET', '/devices', A.tenantFor('OWNER', { planFeatures: { gym_devices: false } })), 402);
  assert.equal(await gate('GET', '/devices/problems', A.tenantFor('CASHIER')), 403);
  assert.ok(sha256('x'));
});
