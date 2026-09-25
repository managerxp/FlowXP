/*
 * Notifications: who hears about what, preferences, dedupe, the email job queue
 * with retries, scan slot claiming, and each scan's payloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const N = await import('../src/modules/notifications.js');
const J = await import('../src/modules/jobs.js');
const S = await import('../src/modules/scans.js');
const controller = await import('../src/controllers/notifications.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

/* ── payloads (pure) ────────────────────────────────────────────────────── */

const item = (over) => ({ product_id: 1, name: 'Chicken', unit: 'kg', current_stock: 8, tomorrow_need: 27, recommended_qty: 105, status: 'ORDER_NOW', ...over });

test('stock alerts: urgent items are critical, fine items are skipped, and the list is capped', () => {
  const alerts = S.stockAlerts({ items: [item(), item({ product_id: 2, name: 'Rice', status: 'ORDER_SOON' }), item({ product_id: 3, name: 'Oil', status: 'OK' })] }, '2026-09-25');
  assert.deepEqual(alerts.map((a) => [a.title, a.severity]), [['Chicken will run short', 'critical'], ['Rice needs ordering soon', 'warning']]);
  assert.match(alerts[0].body, /8 kg in stock, about 27 kg needed tomorrow\. Suggested order: 105 kg\./);
  assert.equal(alerts[0].dedupeKey, 'stock:1:ORDER_NOW:2026-09-25');

  const many = Array.from({ length: 12 }, (_, i) => item({ product_id: i + 1, name: `Item ${i}` }));
  const capped = S.stockAlerts({ items: many }, '2026-09-25');
  assert.equal(capped.length, 9);
  assert.match(capped[8].title, /4 more items/);
});

test('an item that gets worse is a new alert, the same one the same day is not', () => {
  const soon = S.stockAlerts({ items: [item({ status: 'ORDER_SOON' })] }, '2026-09-25')[0].dedupeKey;
  const now = S.stockAlerts({ items: [item({ status: 'ORDER_NOW' })] }, '2026-09-25')[0].dedupeKey;
  assert.notEqual(soon, now);
  assert.equal(now, S.stockAlerts({ items: [item({ status: 'ORDER_NOW' })] }, '2026-09-25')[0].dedupeKey);
});

test('leakage alerts include only open, meaningful findings, at most once a week each', () => {
  const f = (over) => ({ fingerprint: 'discounts:user:1', type: 'discount_outlier', severity: 'warning', status: 'OPEN', title: 'Unusual discount activity', summary: 'Bills carry more discounts.', potential_paise: 500000, ...over });
  const alerts = S.leakageAlerts([f(), f({ fingerprint: 'x', status: 'DISMISSED' }), f({ fingerprint: 'y', severity: 'informational' }), f({ fingerprint: 'z', potential_paise: 0 })], '2026-09-25');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].body, /Potential: ₹5,000\./);
  const sameWeek = S.leakageAlerts([f()], '2026-09-27')[0].dedupeKey;
  const nextWeek = S.leakageAlerts([f()], '2026-10-02')[0].dedupeKey;
  assert.equal(sameWeek, alerts[0].dedupeKey);
  assert.notEqual(nextWeek, sameWeek);
});

test('the evening summary reads plainly and says nothing on a day with no sales', () => {
  assert.equal(S.summaryAlert('2026-09-25', { invoices: 0 }, null), null);
  const a = S.summaryAlert('2026-09-25', { invoices: 40, net_revenue: 3300000, food_cost_pct: 24.5, contribution: 2500000 }, { net_revenue: 3000000 });
  assert.equal(a.title, 'Today: ₹33,000 from 40 orders');
  assert.match(a.body, /Up 10% on the same day last week\. Food cost 24\.5% of revenue\./);
  assert.equal(a.severity, 'positive');
});

test('trial alerts: last two days warn, expiry is critical, a healthy trial is quiet', () => {
  assert.equal(S.accountAlerts({ status: 'TRIAL', trial_ends_at: 'x', trial_days_remaining: 5 }, '2026-09-25').length, 0);
  assert.equal(S.accountAlerts({ status: 'TRIAL', trial_ends_at: 'x', trial_days_remaining: 1 }, '2026-09-25')[0].title, '1 day left in your trial');
  assert.equal(S.accountAlerts({ status: 'EXPIRED', trial_days_remaining: 0 }, '2026-09-25')[0].severity, 'critical');
  assert.equal(S.accountAlerts({ status: 'ACTIVE', trial_days_remaining: 0 }, '2026-09-25').length, 0);
});

test('a flurry of failed webhooks from one platform is one alert an hour', () => {
  const t = new Date('2026-09-25T10:05:00Z');
  const a = S.integrationAlert('ZOMATO', 'Signature check failed', t);
  assert.equal(a.title, 'A Zomato order could not be received');
  assert.equal(a.dedupeKey, S.integrationAlert('ZOMATO', 'x', new Date('2026-09-25T10:55:00Z')).dedupeKey);
  assert.notEqual(a.dedupeKey, S.integrationAlert('ZOMATO', 'x', new Date('2026-09-25T11:01:00Z')).dedupeKey);
});

/* ── delivery, preferences, queue ───────────────────────────────────────── */

let biz; const people = {};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const mk = async (name, role) => {
    const id = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@n.test`])).rows[0].user_id;
    people[name] = { id, role };
    return id;
  };
  const owner = await mk('owner', 'OWNER');
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, trial_ends_at) VALUES ('n',$1,'RESTAURANT', now() + interval '1 day') RETURNING business_id`, [owner])).rows[0].business_id;
  for (const [name, role] of [['manager', 'MANAGER'], ['cashier', 'CASHIER'], ['stockist', 'INVENTORY_MANAGER'], ['admin', 'ADMIN']]) await mk(name, role);
  for (const [name, p] of Object.entries(people)) await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,$3)`, [biz, p.id, p.role]);
});

const names = async (category) => (await N.recipientsFor(biz, category)).map((r) => r.email.split('@')[0]).sort();

test('people are notified only about what their role can open', { skip }, async () => {
  assert.deepEqual(await names('stock'), ['admin', 'manager', 'owner', 'stockist']);      // not the cashier
  assert.deepEqual(await names('leakage'), ['admin', 'owner']);                             // not managers or stock staff
  assert.deepEqual(await names('sales'), ['admin', 'manager', 'owner']);
  await assert.rejects(N.recipientsFor(biz, 'nonsense'), /Unknown notification category/);
});

test('a notification is sent once per dedupe key, to each eligible person', { skip }, async () => {
  const payload = { category: 'stock', type: 'order_now', severity: 'critical', title: 'Chicken will run short', body: 'b', link: '/app/forecast', dedupeKey: 'stock:1:ORDER_NOW:d1' };
  assert.equal(await N.notify(biz, payload), 4);
  assert.equal(await N.notify(biz, payload), 0);                                            // same period: nothing new
  assert.equal(await N.notify(biz, { ...payload, dedupeKey: 'stock:1:ORDER_NOW:d2' }), 4);   // next day: new
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE business_id = $1 AND dedupe_key = 'stock:1:ORDER_NOW:d1'`, [biz]);
  assert.equal(rows[0].n, 4);
});

test('preferences: in-app can be switched off, and email is opt-in and queued, not sent inline', { skip }, async () => {
  const tenant = (name) => ({ businessId: biz, role: people[name].role, permissions: {} });
  await N.savePreferences(tenant('manager'), people.manager.id, [{ category: 'stock', in_app: false, email: false }]);
  await N.savePreferences(tenant('owner'), people.owner.id, [{ category: 'stock', in_app: true, email: true }]);
  await N.savePreferences(tenant('cashier'), people.cashier.id, [{ category: 'stock', in_app: true, email: true }]);   // not allowed: ignored

  const before = Number((await pool.query(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'email'`)).rows[0].n);
  const sent = await N.notify(biz, { category: 'stock', type: 'order_now', title: 'Rice will run short', dedupeKey: 'stock:2:ORDER_NOW:d1' });
  assert.equal(sent, 3);                                                                     // manager opted out
  const after = Number((await pool.query(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'email'`)).rows[0].n);
  assert.equal(after - before, 1);                                                           // only the owner asked for email
  const { rows } = await pool.query(`SELECT payload FROM jobs WHERE type = 'email' ORDER BY job_id DESC LIMIT 1`);
  assert.equal(rows[0].payload.to, 'owner@n.test');

  assert.equal((await N.preferencesFor(tenant('cashier'), people.cashier.id)).length, 0);     // a cashier has nothing to configure
  const ownerPrefs = await N.preferencesFor(tenant('owner'), people.owner.id);
  assert.equal(ownerPrefs.find((p) => p.category === 'stock').email, true);
});

test('queued email is delivered by the worker, and a failing job retries then gives up', { skip }, async () => {
  assert.ok(await J.runDueJobs() >= 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'email' AND status <> 'DONE'`)).rows[0].n), 0);

  J.registerHandler('flaky', async () => { throw new Error('mail server down'); });
  const id = await J.enqueue('flaky', {});
  for (let attempt = 1; attempt <= 5; attempt++) {
    await pool.query(`UPDATE jobs SET run_at = now() WHERE job_id = $1`, [id]);
    await J.runDueJobs();
    const job = (await pool.query(`SELECT status, attempts, last_error, run_at > now() AS delayed FROM jobs WHERE job_id = $1`, [id])).rows[0];
    assert.equal(job.attempts, attempt);
    if (attempt < 5) { assert.equal(job.status, 'PENDING'); assert.equal(job.delayed, true); }
    else { assert.equal(job.status, 'FAILED'); assert.equal(job.last_error, 'mail server down'); }
  }
});

test('a job left running by a dead process goes back in the queue', { skip }, async () => {
  const id = await J.enqueue('email', { to: 'x@n.test', subject: 's', title: 't' });
  await pool.query(`UPDATE jobs SET status = 'RUNNING', locked_at = now() - interval '30 minutes' WHERE job_id = $1`, [id]);
  assert.equal(await J.recoverStuckJobs(), 1);
});

test('only one process gets a scan slot until the interval has passed', { skip }, async () => {
  assert.equal(await S.claim(biz, 'stock', 180), true);
  assert.equal(await S.claim(biz, 'stock', 180), false);
  await pool.query(`UPDATE scan_state SET last_run_at = now() - interval '200 minutes' WHERE business_id = $1 AND scan = 'stock'`, [biz]);
  assert.equal(await S.claim(biz, 'stock', 180), true);
});

test('inbox: unread count, marking read, and nobody can touch anyone elses', { skip }, async () => {
  const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const req = (name, extra = {}) => ({ tenant: { businessId: biz, role: people[name].role, permissions: {} }, auth: { userId: people[name].id }, query: {}, params: {}, body: {}, ...extra });

  let res = fakeRes();
  await controller.index(req('owner'), res);
  const { unread, items } = res.body.data;
  assert.ok(unread >= 3 && items.length === unread);
  assert.equal(items[0].title, 'Rice will run short');                                       // newest first

  const managerItem = (await pool.query(`SELECT notification_id FROM notifications WHERE user_id = $1 LIMIT 1`, [people.manager.id])).rows[0].notification_id;
  res = fakeRes();
  await controller.read(req('owner', { params: { id: managerItem } }), res);
  assert.equal(res.code, 404);                                                              // not the owner's to mark

  res = fakeRes();
  await controller.read(req('owner', { params: { id: items[0].notification_id } }), res);
  assert.equal(res.code, 200);
  res = fakeRes();
  await controller.count(req('owner'), res);
  assert.equal(res.body.data.unread, unread - 1);

  res = fakeRes();
  await controller.readAll(req('owner'), res);
  res = fakeRes();
  await controller.count(req('owner'), res);
  assert.equal(res.body.data.unread, 0);
});

test('scans notify from real data: trial clock and the evening summary', { skip }, async () => {
  assert.equal(await S.scanAccount(biz), 2);                                                // owner and admin (settings), one day left
  const trial = (await pool.query(`SELECT title FROM notifications WHERE business_id = $1 AND type = 'trial_ending'`, [biz])).rows;
  assert.equal(trial.length, 2);                                                            // owner + admin hold 'settings'
  assert.equal(trial[0].title, '1 day left in your trial');
  assert.equal(await S.scanAccount(biz), 0);                                                // already told today

  const tenant = { businessId: biz, branchId: null };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < 2; i++) await createInvoiceInTransaction(client, tenant, people.owner.id, { items: [{ description: 'Meal', unit_price: 500, quantity: 1 }], payment: { amount: 500 } });
    await client.query('COMMIT');
  } finally { client.release(); }
  assert.equal(await S.scanSummary(biz), 3);                                                // owner, admin, manager (reports)
  const summary = (await pool.query(`SELECT title FROM notifications WHERE business_id = $1 AND type = 'daily_summary' LIMIT 1`, [biz])).rows[0];
  assert.equal(summary.title, 'Today: ₹1,000 from 2 orders');
  assert.equal(await S.scanSummary(biz), 0);
});
