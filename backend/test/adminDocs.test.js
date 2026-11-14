import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanItems, compute, fyLabel, isIntraState } from '../src/modules/adminDocs.js';

test('tax: same state splits CGST/SGST, another state is IGST, total rounds to the rupee', () => {
  const items = cleanItems([{ description: 'Pro plan, 1 year', qty: 1, rate_rupees: 9999, gst_rate: 18 }, { description: 'Setup', qty: 2, rate_rupees: 500.5, gst_rate: 18 }]);
  const a = compute(items, true).totals;
  assert.equal(a.taxable_paise, 999900 + 100100);
  assert.equal(a.cgst_paise + a.sgst_paise, Math.round(999900 * 0.18) + Math.round(100100 * 0.18));
  assert.equal(a.igst_paise, 0);
  assert.equal(a.total_paise % 100, 0);
  assert.equal(a.total_paise, a.taxable_paise + a.cgst_paise + a.sgst_paise + a.round_off_paise);
  const b = compute(items, false).totals;
  assert.equal(b.cgst_paise, 0); assert.equal(b.igst_paise, a.cgst_paise + a.sgst_paise);
});

test('state check, financial year and bad lines', () => {
  assert.equal(isIntraState('Karnataka', ' karnataka '), true);
  assert.equal(isIntraState('Karnataka', 'Kerala'), false);
  assert.equal(isIntraState('', 'Kerala'), true);
  assert.equal(fyLabel(new Date('2026-11-13')), '2627');
  assert.equal(fyLabel(new Date('2027-02-01')), '2627');
  assert.throws(() => cleanItems([]), /at least one/);
  assert.throws(() => cleanItems([{ description: '', qty: 1, rate_rupees: 1 }]), /what it is for/);
  assert.throws(() => cleanItems([{ description: 'x', qty: 0, rate_rupees: 1 }]), /quantity/);
  assert.throws(() => cleanItems([{ description: 'x', qty: 1, rate_rupees: 1, gst_rate: 7 }]), /GST/);
});

/* the whole flow against a real database: company details, a quotation, its conversion, payment */
import { setupTestDb } from './helpers/db.js';
const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

test('quotation to invoice to paid, with numbers in order', { skip }, async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const uid = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Admin','a@ad.test','x') RETURNING user_id`)).rows[0].user_id;
  const d = await import('../src/controllers/adminDocuments.controller.js');
  const call = async (fn, { body, params = {}, query = {} } = {}) => { let out; const res = { status(c) { this.code = c; return this; }, json(b) { out = { code: this.code ?? 200, body: b }; return this; } }; await fn({ body, params, query, auth: { userId: uid }, ip: '127.0.0.1', headers: {} }, res); return out; };
  assert.equal((await call(d.saveCompany, { body: { name: 'FlowXP', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' } })).code, 200);
  assert.equal((await call(d.saveCompany, { body: { gstin: '123' } })).code, 400);
  const body = { kind: 'QUOTE', client: { name: 'Sharma Auto', state: 'Kerala' }, items: [{ description: 'Pro plan', qty: 1, rate_rupees: 10000, gst_rate: 18 }] };
  const q = (await call(d.create, { body })).body.data;
  assert.match(q.doc_number, /^QT-\d{4}-0001$/);
  assert.equal(q.intra_state, false);
  assert.equal(q.totals.igst_paise, 180000);
  assert.equal((await call(d.setStatus, { params: { id: q.doc_id }, body: { status: 'PAID' } })).code, 409, 'a quotation cannot be paid');
  await call(d.setStatus, { params: { id: q.doc_id }, body: { status: 'SENT' } });
  const inv = (await call(d.convert, { params: { id: q.doc_id } })).body.data;
  assert.match(inv.doc_number, /^INV-\d{4}-0001$/);
  assert.equal(inv.from_quote_id, q.doc_id);
  assert.equal((await call(d.convert, { params: { id: q.doc_id } })).code, 409, 'only once');
  assert.equal((await call(d.update, { params: { id: inv.doc_id }, body: { ...body, kind: 'INVOICE', notes: 'x' } })).code, 200, 'a draft can change');
  assert.equal((await call(d.setStatus, { params: { id: inv.doc_id }, body: { status: 'PAID', method: 'CRYPTO' } })).code, 400, 'unknown method');
  assert.equal((await call(d.setStatus, { params: { id: inv.doc_id }, body: { status: 'PAID', method: 'UPI', paid_on: '2999-01-01' } })).code, 400, 'not in the future');
  const paid = (await call(d.setStatus, { params: { id: inv.doc_id }, body: { status: 'PAID', method: 'BANK_TRANSFER', paid_on: '2026-11-10', note: 'UTR 123' } })).body.data;
  assert.equal(paid.status, 'PAID'); assert.equal(paid.paid_method, 'BANK_TRANSFER'); assert.equal(paid.paid_note, 'UTR 123');
  assert.match(new Date(paid.paid_at).toISOString(), /^2026-11-(09|10)/, 'dated as the customer paid, not today');
  assert.equal((await call(d.update, { params: { id: inv.doc_id }, body })).code, 409, 'a paid invoice is fixed');
  assert.equal((await call(d.list, { query: { kind: 'INVOICE' } })).body.data.length, 1);
});

test('an invoice for WhatsApp credit loads it once, when paid, however it is paid', { skip }, async () => {
  const { setProvider } = await import('../src/modules/payments/cashfree.js');
  const { balanceOf } = await import('../src/modules/messaging/wallet.js');
  const { cashfree } = await import('../src/controllers/webhooks.controller.js');
  const d = await import('../src/controllers/adminDocuments.controller.js');
  const uid = (await pool.query(`SELECT user_id FROM users WHERE email = 'a@ad.test'`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Credit Cafe',$1,'CAFE','Karnataka') RETURNING business_id`, [uid])).rows[0].business_id;
  const call = async (fn, { body, params = {} } = {}) => { let out; const res = { status(c) { this.code = c; return this; }, json(b) { out = { code: this.code ?? 200, body: b }; return this; } }; await fn({ body, params, query: {}, auth: { userId: uid }, ip: '127.0.0.1', headers: {} }, res); return out; };
  const body = { kind: 'INVOICE', business_id: biz, credit_rupees: 1000, client: { name: 'Credit Cafe', state: 'Karnataka' }, items: [{ description: 'WhatsApp credit', qty: 1, rate_rupees: 1000, gst_rate: 0 }] };
  assert.equal((await call(d.create, { body: { ...body, business_id: null } })).code, 400, 'credit needs a client');
  const inv = (await call(d.create, { body })).body.data;
  assert.equal(Number(inv.credit_paise), 100000);

  let seen; setProvider(async (args) => { seen = args; return { linkUrl: 'https://pay.test/x' }; });
  const link = (await call(d.paymentLink, { params: { id: inv.doc_id } })).body.data;
  assert.equal(link.payment_link_url, 'https://pay.test/x');
  assert.match(seen.linkId, /^flowxp-doc-\d+-/);
  assert.equal((await call(d.paymentLink, { params: { id: inv.doc_id } })).body.data.payment_link_url, 'https://pay.test/x', 'one link per invoice');
  assert.equal((await pool.query(`SELECT status FROM admin_documents WHERE doc_id = $1`, [inv.doc_id])).rows[0].status, 'SENT');

  // Cashfree confirms payment (signature checked by the real code, so stand in for it with a signed call is out of scope here: use markPaid, which the webhook calls)
  const first = await d.markPaid(inv.doc_id, { note: 'Cashfree' });
  assert.equal(first.status, 'PAID'); assert.equal(first.credit_loaded, true);
  assert.equal(await balanceOf(pool, biz), 100000);
  assert.equal(await d.markPaid(inv.doc_id, { note: 'again' }), null, 'a retry changes nothing');
  assert.equal(await balanceOf(pool, biz), 100000, 'credit loaded once');
  assert.equal((await call(d.setStatus, { params: { id: inv.doc_id }, body: { status: 'PAID' } })).code, 409);
  const led = (await pool.query(`SELECT kind, note FROM wallet_ledger WHERE business_id = $1`, [biz])).rows;
  assert.deepEqual(led.map((r) => r.kind), ['TOPUP']); assert.match(led[0].note, /^Invoice INV-/);
  assert.equal(typeof cashfree, 'function');
  const mine = (await call(d.list, { body: undefined })).body.data;
  assert.ok(Array.isArray(mine));
  let out; await d.list({ query: { business_id: String(biz) } }, { json(b) { out = b; return this; } });
  assert.equal(out.data.length, 1, "a client's own documents");
  assert.equal(out.data[0].doc_id, inv.doc_id);
});

test('a document email carries the lines, the total and how to pay; client tags and follow-up are kept', { skip }, async () => {
  const d = await import('../src/controllers/adminDocuments.controller.js');
  const a = await import('../src/controllers/admin.controller.js');
  const m = d.documentEmail({ kind: 'INVOICE', doc_number: 'INV-2627-0009', status: 'SENT', client: { name: 'Sharma <Auto>' }, items: [{ description: 'Pro plan', qty: 1, total_paise: 1180000 }], totals: { total_paise: 1180000 }, payment_link_url: 'https://pay.test/y' }, { name: 'FlowXP', upi: 'flowxp@upi' });
  assert.match(m.subject, /Invoice INV-2627-0009/);
  assert.match(m.text, /Pay online: https:\/\/pay\.test\/y/); assert.match(m.text, /UPI: flowxp@upi/); assert.match(m.text, /11,800\.00/);
  assert.ok(m.html.includes('Sharma &lt;Auto&gt;'), 'names are escaped');
  assert.ok(!documentEmailPaid().text.includes('Pay online'), 'a paid invoice asks for nothing');
  function documentEmailPaid() { return d.documentEmail({ kind: 'INVOICE', doc_number: 'X', status: 'PAID', client: {}, items: [], totals: {}, payment_link_url: 'https://pay.test/y' }, {}); }

  const uid = (await pool.query(`SELECT user_id FROM users WHERE email = 'a@ad.test'`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Tag Cafe',$1,'CAFE') RETURNING business_id`, [uid])).rows[0].business_id;
  const call = async (body) => { let out; const res = { status(c) { this.code = c; return this; }, json(b) { out = { code: this.code ?? 200, body: b }; return this; } }; await a.updateClientCrm({ params: { id: biz }, body, auth: { userId: uid }, ip: '127.0.0.1', headers: {} }, res); return out; };
  const ok = await call({ tags: [' VIP ', 'vip', 'Renewal due'], follow_up_on: '2026-12-01', follow_up_note: 'Call' });
  assert.deepEqual(ok.body.data.tags, ['vip', 'renewal due']); assert.equal(ok.body.data.follow_up_on, '2026-12-01');
  assert.equal((await call({ follow_up_on: 'soon' })).code, 400);
  assert.equal((await call({})).code, 400);
  assert.equal((await call({ follow_up_on: null })).body.data.follow_up_on, null, 'a date can be cleared');
});
