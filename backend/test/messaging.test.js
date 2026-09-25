/*
 * Customer messaging: templates, the outbox, opt-out, campaigns, the bill link and the automatic sends.
 * A test double stands in for the provider, so nothing leaves the machine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const messaging = await import('../src/controllers/messaging.controller.js');
const publicBill = await import('../src/controllers/publicBill.controller.js');
const reservations = await import('../src/controllers/reservations.controller.js');
const { render, metaBody, TEMPLATES } = await import('../src/modules/messaging/templates.js');
const { setProvider, toE164, MessageError } = await import('../src/modules/messaging/provider.js');
const mod = await import('../src/modules/messaging/index.js');

test.after(async () => { setProvider(null); await cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return null; };

/* ── pure ───────────────────────────────────────────────────────────────── */

test('templates fill their variables, and refuse a missing one', () => {
  const m = render('BILL', { name: 'Asha', business: 'Spice Hub', number: 'INV-0007', total: '₹450', link: 'https://x.test/bill/abc' });
  assert.match(m.text, /Asha.*Spice Hub.*INV-0007.*₹450.*https:\/\/x\.test\/bill\/abc/);
  assert.deepEqual(m.template, { name: 'flowxp_bill', params: ['Asha', 'Spice Hub', 'INV-0007', '₹450', 'https://x.test/bill/abc'] });
  assert.equal(m.promo, false);
  assert.throws(() => render('BILL', { name: 'Asha' }), /needs business/);
  assert.throws(() => render('NOPE', {}), /Unknown message kind/);
  assert.equal(render('OFFER', { name: 'A', business: 'B', offer: 'C' }).promo, true);
});

test('the Meta template text uses numbered variables in order', () => {
  assert.equal(metaBody('WAITLIST_READY'), 'Hi {{1}}, your table at {{2}} is ready. Please come to the host desk.');
  for (const kind of Object.keys(TEMPLATES)) assert.match(metaBody(kind), /\{\{1\}\}/);
});

test('phone numbers become international, once', () => {
  assert.equal(toE164('98765 43210'), '919876543210');
  assert.equal(toE164('+91 98765 43210'), '919876543210');
});

test('settings accept only known values', () => {
  const cur = { ...mod.DEFAULT_SETTINGS };
  assert.equal(mod.cleanSettings({ channel: 'FAX' }, cur).error, 'Channel must be WhatsApp, SMS or off');
  assert.deepEqual(mod.cleanSettings({ channel: 'SMS', bill_auto: false, junk: 1 }, cur).settings, { ...cur, channel: 'SMS', bill_auto: false });
});

/* ── database ───────────────────────────────────────────────────────────── */

let A; let B;
const sent = [];
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@msg.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [`${label} Kitchen`, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Thali',25000,FALSE) RETURNING product_id`, [biz.business_id])).rows[0].product_id;
  const customer = async (name, phone, extra = {}) => (await pool.query(`INSERT INTO customers (business_id, name, phone, marketing_opt_out) VALUES ($1,$2,$3,$4) RETURNING customer_id`, [biz.business_id, name, phone, extra.optOut ?? false])).rows[0].customer_id;
  const bill = async (customerId, date) => { const r = await call(invoices.create, { body: { customer_id: customerId, items: [{ product_id: dish, quantity: 1 }], ...(date ? { invoice_date: date } : {}) } }); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
  const setChannel = (channel) => pool.query(`UPDATE businesses SET messaging_settings = $1 WHERE business_id = $2`, [JSON.stringify({ channel }), biz.business_id]);
  return { tenant, biz: biz.business_id, branchId, req, call, dish, customer, bill, setChannel };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  setProvider(async (m) => { sent.push(m); return { status: 'SENT', providerId: `wamid.${sent.length}` }; });
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.asha = await A.customer('Asha', '98765 43210');
  A.ravi = await A.customer('Ravi', '9876500001');
  A.nophone = await A.customer('No Phone', null);
  A.stop = await A.customer('Stopped', '9876500002', { optOut: true });
});

test('with messaging off nothing is sent or recorded', { skip }, async () => {
  const inv = await A.bill(A.asha);
  const r = await mod.sendBill(pool, { businessId: A.biz, invoiceId: inv.invoice_id });
  assert.deepEqual(r, { skipped: 'OFF' });
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [A.biz])).rows[0].n, 0);
  assert.equal(sent.length, 0);
  A.firstInvoice = inv;
});

test('settings can be read and changed by the owner', { skip }, async () => {
  const before = (await A.call(messaging.getSettingsHandler)).body.data;
  assert.equal(before.settings.channel, 'OFF');
  assert.equal(before.provider.connected, true);            // the test double counts as connected
  assert.equal((await A.call(messaging.putSettings, { body: { channel: 'FAX' } })).code, 400);
  const after = await A.call(messaging.putSettings, { body: { channel: 'WHATSAPP' } });
  assert.equal(after.body.data.settings.channel, 'WHATSAPP');
  assert.equal((await B.call(messaging.getSettingsHandler)).body.data.settings.channel, 'OFF');   // per business
});

test('sending a bill records it, uses the customer number and links to a stable public page', { skip }, async () => {
  const res = await A.call(messaging.sendBillHandler, { body: { invoice_id: A.firstInvoice.invoice_id } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const m = res.body.data;
  assert.equal(m.status, 'SENT');
  assert.equal(m.channel, 'WHATSAPP');
  assert.equal(m.phone, '9876543210');
  assert.match(m.body, new RegExp(A.firstInvoice.invoice_number));
  const link = m.body.match(/https?:\/\/\S+\/bill\/(\w+)/);
  assert.ok(link, m.body);

  const provider = sent.at(-1);
  assert.equal(provider.to, '9876543210');
  assert.equal(provider.template.name, 'flowxp_bill');
  assert.equal(provider.template.params[2], A.firstInvoice.invoice_number);

  await A.call(messaging.sendBillHandler, { body: { invoice_id: A.firstInvoice.invoice_id } });
  const again = (await A.call(messaging.list)).body.data[0].body.match(/\/bill\/(\w+)/)[1];
  assert.equal(again, link[1]);                            // same link every time
  A.token = link[1];
});

test('a bill with nobody to send to, or in another business, is refused', { skip }, async () => {
  const noPhone = await A.bill(A.nophone);
  assert.equal((await A.call(messaging.sendBillHandler, { body: { invoice_id: noPhone.invoice_id } })).code, 400);
  assert.equal((await A.call(messaging.sendBillHandler, { body: { invoice_id: noPhone.invoice_id, phone: '123' } })).code, 400);
  assert.equal((await A.call(messaging.sendBillHandler, { body: { invoice_id: noPhone.invoice_id, phone: '9000000001' } })).code, 201);   // typed at the till
  assert.equal((await B.call(messaging.sendBillHandler, { body: { invoice_id: A.firstInvoice.invoice_id } })).code, 404);
});

test('the public bill page shows one bill by its token and nothing else', { skip }, async () => {
  const ok = fakeRes();
  await publicBill.bill({ params: { token: A.token } }, ok);
  assert.equal(ok.body.data.invoice_number, A.firstInvoice.invoice_number);
  assert.equal(ok.body.data.business, 'a Kitchen');
  assert.equal(ok.body.data.items[0].description, 'Thali');
  assert.equal(ok.body.data.total, A.firstInvoice.total);
  assert.equal('phone' in ok.body.data, false);
  for (const token of ['nope', '', 'x'.repeat(100)]) {
    const r = fakeRes(); await publicBill.bill({ params: { token } }, r);
    assert.equal(r.code, 404);
  }
});

test('a provider failure is recorded and can be retried', { skip }, async () => {
  setProvider(async () => { throw new MessageError('WhatsApp refused the message'); });
  const failedRes = await A.call(messaging.sendBillHandler, { body: { invoice_id: A.firstInvoice.invoice_id } });
  assert.equal(failedRes.code, 201, JSON.stringify(failedRes.body));
  const failed = failedRes.body.data;
  assert.equal(failed.status, 'FAILED');
  assert.match(failed.error, /refused/);

  setProvider(async (m) => { sent.push(m); return { status: 'SENT', providerId: 'wamid.retry' }; });
  const retried = await A.call(messaging.resendHandler, { params: { id: failed.message_id } });
  assert.equal(retried.body.data.status, 'SENT');
  assert.equal(retried.body.data.error, null);
  assert.equal((await A.call(messaging.resendHandler, { params: { id: failed.message_id } })).code, 409);   // already sent
  assert.equal((await B.call(messaging.resendHandler, { params: { id: failed.message_id } })).code, 404);
});

test('with no provider configured messages are recorded as skipped, honestly', { skip }, async () => {
  setProvider(null);            // the real driver in this environment is "log"
  const r = (await A.call(messaging.sendBillHandler, { body: { invoice_id: A.firstInvoice.invoice_id } })).body.data;
  assert.equal(r.status, 'SKIPPED');
  assert.match(r.error, /nothing was sent/);
  setProvider(async (m) => { sent.push(m); return { status: 'SENT', providerId: 'wamid.x' }; });
});

test('offers and reminders never reach someone who opted out; bills still do', { skip }, async () => {
  assert.equal((await A.call(messaging.setOptOut, { params: { id: A.ravi }, body: { opt_out: true } })).body.data.marketing_opt_out, true);
  assert.equal((await B.call(messaging.setOptOut, { params: { id: A.ravi }, body: { opt_out: true } })).code, 404);
  const offer = await mod.send(pool, { businessId: A.biz, customerId: A.ravi, phone: '9876500001', kind: 'OFFER', values: { name: 'Ravi', business: 'a', offer: '10% off' } });
  assert.deepEqual(offer, { skipped: 'OPTED_OUT' });
  const bill = await mod.send(pool, { businessId: A.biz, customerId: A.ravi, phone: '9876500001', kind: 'BILL', values: { name: 'Ravi', business: 'a', number: 'X', total: '₹1', link: 'l' } });
  assert.equal(bill.status, 'SENT');
  await A.call(messaging.setOptOut, { params: { id: A.ravi }, body: { opt_out: false } });
});

test('a campaign reaches only eligible customers, once an hour, and is tracked', { skip }, async () => {
  const preview = (await A.call(messaging.preview, { body: { segment: 'ALL' } })).body.data;
  assert.equal(preview.count, 2);                          // Asha and Ravi: not the opted-out, not the one without a number
  assert.equal((await A.call(messaging.preview, { body: { segment: 'MAYBE' } })).code, 400);

  assert.equal((await A.call(messaging.campaign, { body: { segment: 'ALL', text: 'Hi' } })).code, 400);                                       // too short
  assert.equal((await A.call(messaging.campaign, { body: { segment: 'ALL', text: 'Flat 10% off, see https://x.test/offer' } })).code, 400);  // link
  assert.equal((await B.call(messaging.campaign, { body: { segment: 'ALL', text: 'Flat 10% off this week' } })).code, 409);                    // B has messaging off

  const started = await A.call(messaging.campaign, { body: { segment: 'ALL', text: 'Flat 10% off this week on all thalis.' } });
  assert.equal(started.code, 202, JSON.stringify(started.body));
  assert.equal(started.body.data.recipients, 2);
  const batch = started.body.data.batch;
  const status = await until(async () => { const s = (await A.call(messaging.campaignStatus, { params: { batch } })).body.data; return s.sent === 2 ? s : null; });
  assert.deepEqual(status, { sent: 2 });
  const offers = (await A.call(messaging.list, { query: { kind: 'offer' } })).body.data;
  assert.equal(offers.length, 2);
  assert.ok(offers.every((o) => /Flat 10% off/.test(o.body) && /Reply STOP/.test(o.body)));

  const again = await A.call(messaging.campaign, { body: { segment: 'ALL', text: 'Another offer for you today.' } });
  assert.equal(again.code, 429);
});

test('audience segments: lapsed customers and those one visit from a reward', { skip }, async () => {
  const old = await A.customer('Lapsed Lata', '9876500010');
  await pool.query(`INSERT INTO invoices (business_id, branch_id, customer_id, invoice_number, invoice_date, total_paise) VALUES ($1,$2,$3,'OLD-1', CURRENT_DATE - 90, 1000)`, [A.biz, A.branchId, old]);
  const lapsed = await mod.audience(pool, A.biz, { segment: 'LAPSED', days: 30 });
  assert.deepEqual(lapsed.customers.map((c) => c.name), ['Lapsed Lata']);   // Asha has a recent bill

  assert.equal((await mod.audience(pool, A.biz, { segment: 'NEAR_REWARD' })).error, 'Switch the loyalty program on first');
  await pool.query(`INSERT INTO loyalty_programs (business_id, is_enabled, visits_required, reward_product_id, reward_quantity, min_bill_paise) VALUES ($1,TRUE,4,$2,1,0)`, [A.biz, A.dish]);
  // 4 visits needed = 3 stamps then the reward; two stamps means one to go
  for (const [customer, days] of [[A.asha, 3], [A.asha, 2]]) {
    await pool.query(`INSERT INTO loyalty_events (business_id, customer_id, kind, visit_date) VALUES ($1,$2,'VISIT', CURRENT_DATE - $3::int)`, [A.biz, customer, days]);
  }
  const near = await mod.audience(pool, A.biz, { segment: 'NEAR_REWARD' });
  assert.ok(near.customers.some((c) => c.name === 'Asha'));
  assert.ok(!near.customers.some((c) => c.name === 'Ravi'));
});

test('billing a known customer sends their bill, and a nudge when the next visit is free', { skip }, async () => {
  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1 AND kind = 'BILL'`, [A.biz])).rows[0].n;
  const meera = await A.customer('Meera', '9876500020');
  const inv = await A.bill(meera, '2026-01-10');
  await until(async () => (await pool.query(`SELECT 1 FROM messages WHERE business_id = $1 AND customer_id = $2 AND kind = 'BILL'`, [A.biz, meera])).rows.length);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1 AND kind = 'BILL'`, [A.biz])).rows[0].n, before + 1);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE customer_id = $1 AND kind = 'LOYALTY_NEXT'`, [meera])).rows[0].n, 0);   // 1 stamp of 3: not yet

  await A.bill(meera, '2026-01-11');
  await A.bill(meera, '2026-01-12');                       // third stamp: the next visit is free
  const nudge = await until(async () => (await pool.query(`SELECT body FROM messages WHERE customer_id = $1 AND kind = 'LOYALTY_NEXT'`, [meera])).rows[0]);
  assert.ok(nudge, 'a loyalty nudge was sent');
  assert.match(nudge.body, /free Thali/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE customer_id = $1 AND kind = 'LOYALTY_NEXT'`, [meera])).rows[0].n, 1);   // not repeated
  assert.ok(inv.invoice_id);
});

test('bill messages can be switched off separately from the channel', { skip }, async () => {
  await pool.query(`UPDATE businesses SET messaging_settings = $1 WHERE business_id = $2`, [JSON.stringify({ channel: 'WHATSAPP', bill_auto: false, loyalty_nudge: false }), A.biz]);
  const c = await A.customer('Quiet', '9876500030');
  await A.bill(c, '2026-02-01');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE customer_id = $1`, [c])).rows[0].n, 0);
  await A.setChannel('WHATSAPP');
});

test('bookings and the waitlist message the guest', { skip }, async () => {
  const table = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, seats, qr_token) VALUES ($1,$2,'T1',4,'msg-t1') RETURNING table_id`, [A.biz, A.branchId])).rows[0].table_id;
  const at = new Date(Date.now() + 3 * 3600e3).toISOString();
  const booked = await A.call(reservations.create, { body: { guest_name: 'Divya', phone: '9876500040', party_size: 4, reserved_at: at, table_id: table } });
  assert.equal(booked.code, 201);
  const conf = await until(async () => (await pool.query(`SELECT body FROM messages WHERE kind = 'RESERVATION' AND business_id = $1`, [A.biz])).rows[0]);
  assert.match(conf.body, /Divya.*a Kitchen.*party of 4/);

  await A.call(reservations.setStatus, { params: { id: booked.body.data.reservation_id }, body: { status: 'CANCELLED' } });
  assert.ok(await until(async () => (await pool.query(`SELECT 1 FROM messages WHERE kind = 'RESERVATION_CANCELLED' AND business_id = $1`, [A.biz])).rows.length));

  const w = (await A.call(reservations.waitlistAdd, { body: { guest_name: 'Karan', phone: '9876500041', party_size: 2 } })).body.data;
  assert.ok(await until(async () => (await pool.query(`SELECT 1 FROM messages WHERE kind = 'WAITLIST_ADDED' AND business_id = $1`, [A.biz])).rows.length));
  await A.call(reservations.waitlistNotify, { params: { id: w.entry_id } });
  const ready = await until(async () => (await pool.query(`SELECT body FROM messages WHERE kind = 'WAITLIST_READY' AND business_id = $1`, [A.biz])).rows[0]);
  assert.match(ready.body, /Karan.*ready/);

  // a guest with no number is simply not messaged
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [A.biz])).rows[0].n;
  await A.call(reservations.waitlistAdd, { body: { guest_name: 'No Number', party_size: 2 } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [A.biz])).rows[0].n, n);
});

test('the log is per business and can be filtered', { skip }, async () => {
  assert.equal((await B.call(messaging.list)).body.data.length, 0);
  const failed = (await A.call(messaging.list, { query: { status: 'failed' } })).body.data;
  assert.ok(failed.every((m) => m.status === 'FAILED'));
  const templates = (await A.call(messaging.templates)).body.data;
  assert.equal(templates.length, Object.keys(TEMPLATES).length);
  assert.match(templates.find((t) => t.kind === 'BILL').body, /\{\{5\}\}/);
});
