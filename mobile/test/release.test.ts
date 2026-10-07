/* Phase 4: crash reporting, receipt printing, clearing a phone, and the release configuration (what the store build will contain). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createReporter, toReport, type Report } from '../src/lib/report.ts';
import { receiptHtml } from '../src/lib/print.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { sendEntry } from '../src/lib/till.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

/* ── crash reports ──────────────────────────────────────────────────────── */

const memoryQueue = () => { let items: Report[] = []; return { read: async () => items, write: async (r: Report[]) => { items = r; }, get: () => items }; };
const ctx = { version: '1.0.0 (3)', platform: 'android', os_version: '14', device: 'AB3', screen: '/till' };

test('a report is the error plus technical facts only, cut to size, from any kind of thrown thing', () => {
  const r = toReport(new Error('x'.repeat(900)), ctx);
  assert.equal(r.message.length, 500); assert.ok(r.stack && r.stack.length <= 4000); assert.deepEqual([r.version, r.platform, r.device], ['1.0.0 (3)', 'android', 'AB3']);
  assert.equal(toReport('plain text', ctx).message, 'plain text');
  assert.equal(toReport({ code: 7 }, ctx).message, '{"code":7}');
  assert.equal(toReport(undefined, ctx).message.length > 0, true);
});

test('sent at once when it can; kept (newest 20) when it cannot; the same message is not sent twice a minute; it never throws', async () => {
  let clock = 1000; const sent: Report[] = []; let down = false;
  const queue = memoryQueue();
  const reporter = createReporter({ send: async (r) => { if (down) throw new Error('offline'); sent.push(r); }, queue, now: () => clock, cap: 3 });
  assert.equal(await reporter.report(new Error('boom'), ctx), 'sent');
  assert.equal(await reporter.report(new Error('boom'), ctx), 'skipped', 'the same message again, a moment later');
  clock += 61000; assert.equal(await reporter.report(new Error('boom'), ctx), 'sent', 'a minute on, it is news again');
  down = true;
  for (const m of ['a', 'b', 'c', 'd']) assert.equal(await reporter.report(new Error(m), ctx), 'queued');
  assert.deepEqual(queue.get().map((r) => r.message), ['b', 'c', 'd'], 'only the newest three are kept (the cap)');
  const broken = createReporter({ send: async () => { throw new Error('x'); }, queue: { read: async () => { throw new Error('disk'); }, write: async () => { throw new Error('disk'); } } });
  assert.equal(await broken.report(new Error('z'), ctx), 'skipped', 'even a broken queue cannot cause a second crash');
});

test('queued reports go out oldest first when the connection returns, and stop at the first failure', async () => {
  const queue = memoryQueue(); const sent: string[] = []; let failAt = '';
  const reporter = createReporter({ send: async (r) => { if (r.message === failAt) throw new Error('offline'); sent.push(r.message); }, queue, gapMs: 0 });
  failAt = '*';
  const down = createReporter({ send: async () => { throw new Error('offline'); }, queue, gapMs: 0 });
  for (const m of ['one', 'two', 'three']) await down.report(new Error(m), ctx);
  failAt = 'two';
  assert.equal(await reporter.flush(), 1); assert.deepEqual(queue.get().map((r) => r.message), ['two', 'three']);
  failAt = '';
  assert.equal(await reporter.flush(), 2); assert.deepEqual(sent, ['one', 'two', 'three']); assert.deepEqual(queue.get(), []);
});

/* ── printing ───────────────────────────────────────────────────────────── */

test('the printed receipt is escaped text in a monospace block sized to the paper', () => {
  const text = 'Tea <b>& Biscuit</b>\n  2 x ₹50.00      ₹100.00';
  const small = receiptHtml(text, '58'); const big = receiptHtml(text, '80');
  assert.ok(small.html.includes('Tea &lt;b&gt;&amp; Biscuit&lt;/b&gt;') && !small.html.includes('<b>'), 'text cannot become markup');
  assert.ok(small.html.includes('₹100.00') && small.html.includes('white-space: pre'));
  assert.ok(big.width > small.width); assert.equal(small.width, 164); assert.equal(big.width, 227);
  // 32 characters of a monospace font (about 0.6 em each) must fit the paper width
  for (const [paper, r] of [['58', small], ['80', big]] as const) { const px = Number(/font-size: ([\d.]+)px/.exec(r.html)![1]); assert.ok(32 * 0.6 * px <= r.width, `${paper} mm: 32 columns fit`); assert.ok(32 * 0.6 * px > r.width * 0.9, `${paper} mm: and fill the paper`); }
});

/* ── clearing a phone ───────────────────────────────────────────────────── */

test('clearing removes the product copy and sent sales, never a sale still waiting or refused; the phone keeps its code', async () => {
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
  const catalog = createCatalog(db); const outbox = createOutbox(db); const server = fakeServer([P(1, 'Tea', 50, { modifier_group_ids: [1] })]);
  server.state.groups = [{ group_id: 1, name: 'Size', is_variant: true, min_select: 1, max_select: 1, modifiers: [] }];
  await catalog.sync(server.api);
  const body = { items: [{ product_id: 1, quantity: 1 }], payment: { method: 'CASH', amount: 'FULL' } };
  const preview = { lines: [], subtotalPaise: 0, taxPaise: 0, totalPaise: 0, method: 'CASH' };
  for (const id of ['sent', 'waiting', 'refused']) await outbox.add({ id, body: { ...body, id }, preview });
  server.state.refuse.set('refused', { status: 400, message: 'Coupon expired' });
  const code = await outbox.device();
  await outbox.flush(sendEntry(server.api));
  await catalog.clear(); await outbox.forgetSent();
  assert.equal(await catalog.count(), 0); assert.deepEqual(await catalog.groupsFor(P(1, 'Tea', 50, { modifier_group_ids: [1] })), []);
  assert.deepEqual((await outbox.list()).map((e) => e.id), ['refused'], 'the refused sale is still there; the other two were sent and are forgotten');
  assert.equal(await outbox.device(), code);
  assert.equal((await catalog.sync(server.api)).mode, 'full', 'next time everything downloads again');
});

/* ── the release configuration ──────────────────────────────────────────── */

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const png = (path: string) => { const b = readFileSync(new URL(`../${path.replace('./', '')}`, import.meta.url)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

test('the app asks for the camera and nothing else, and has one identity on both stores', () => {
  assert.equal(app.android.package, 'com.flowxp.app'); assert.equal(app.ios.bundleIdentifier, 'com.flowxp.app'); assert.equal(app.name, 'FlowXP');
  assert.deepEqual(app.android.permissions, ['CAMERA']);
  for (const p of ['RECORD_AUDIO', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) assert.ok(app.android.blockedPermissions.includes(`android.permission.${p}`), `${p} blocked`);
  const camera = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-camera');
  assert.equal(camera[1].recordAudioAndroid, false, 'the camera plugin does not ask for the microphone'); assert.match(camera[1].cameraPermission, /barcode/);
  assert.match(app.version, /^\d+\.\d+\.\d+$/); assert.ok(Number.isInteger(app.android.versionCode) && app.android.versionCode >= 1);
  assert.deepEqual(app.runtimeVersion, { policy: 'appVersion' }, 'an update only reaches builds with the same app version');
});

test('the icons exist at the sizes the stores need', () => {
  for (const f of [app.icon, app.android.adaptiveIcon.foregroundImage, app.android.adaptiveIcon.monochromeImage]) { assert.ok(existsSync(new URL(`../${f.replace('./', '')}`, import.meta.url)), `${f} exists`); assert.deepEqual(png(f), { w: 1024, h: 1024 }, `${f} is 1024 x 1024`); }
  assert.ok(statSync(new URL(`../${app.icon.replace('./', '')}`, import.meta.url)).size < 1024 * 1024);
});

test('the build profiles: a test build (apk) for the preview, a store build (aab, auto-numbered) for production, both pointed at the real server', () => {
  assert.equal(eas.build.preview.android.buildType, 'apk'); assert.equal(eas.build.production.android.buildType, 'app-bundle'); assert.equal(eas.build.production.autoIncrement, true);
  for (const name of ['preview', 'production']) { assert.equal(eas.build[name].env.EXPO_PUBLIC_API_URL, 'https://flowxp.in'); assert.equal(eas.build[name].channel, name); }
  assert.ok(eas.build.development.env.EXPO_PUBLIC_API_URL.startsWith('http://'), 'development talks to a local server');
  assert.equal(eas.submit.production.android.releaseStatus, 'draft', 'a submitted build waits for a person to press release');
  assert.equal(JSON.stringify(eas).includes('BEGIN'), false, 'no key in the config');
  assert.ok(readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').includes('play-service-account.json'), 'the Play key can never be committed');
});
