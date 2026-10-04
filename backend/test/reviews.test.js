/*
 * Post-bill customer feedback (owner's request, 2026-09-29) — the honest,
 * fully-buildable half of "AI-based Google reviews": no Google API, just a
 * rating on the same public bill page, private unless it's good, and Flow AI
 * drafting a reply. Covers the public capture (publicBill.controller.js),
 * feature gating, and the owner-side list/draft/send (reviews.controller.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const publicBill = await import('../src/controllers/publicBill.controller.js');
const reviews = await import('../src/controllers/reviews.controller.js');
const admin = await import('../src/controllers/admin.controller.js');
const { setProvider: setAIProvider, setConfigured: setAIConfigured, AIProviderError } = await import('../src/modules/ai/provider.js');
const { setProvider: setMsgProvider } = await import('../src/modules/messaging/provider.js');
const mod = await import('../src/modules/messaging/index.js');

test.after(async () => { setAIProvider(null); setAIConfigured(undefined); setMsgProvider(null); await cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const say = (text) => ({ content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { input_tokens: 40, output_tokens: 20 } });

let A; let B;
const sentMsgs = [];
const makeBusiness = async (label, planCode = 'GROWTH') => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@reviews.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ($1,$2,'RESTAURANT',$3) RETURNING business_id`, [`${label} Diner`, user.user_id, planCode])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Thali',25000,FALSE) RETURNING product_id`, [biz.business_id])).rows[0].product_id;
  const customer = async (name, phone) => (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [biz.business_id, name, phone])).rows[0].customer_id;
  const bill = async (customerId) => { const r = await call(invoices.create, { body: { customer_id: customerId, items: [{ product_id: dish, quantity: 1 }] } }); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
  const tokenFor = (invoiceId) => mod.shareLink(pool, invoiceId).then((url) => url.split('/').pop());
  await pool.query(`UPDATE businesses SET messaging_settings = $1 WHERE business_id = $2`, [JSON.stringify({ channel: 'WHATSAPP' }), biz.business_id]);
  return { tenant, biz: biz.business_id, branchId, userId: user.user_id, req, call, dish, customer, bill, tokenFor };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  setMsgProvider(async (m) => { sentMsgs.push(m); return { status: 'SENT', providerId: `wamid.${sentMsgs.length}` }; });
  A = await makeBusiness('a');
  B = await makeBusiness('b');
  A.asha = await A.customer('Asha', '9876543210');
});

/* ── public capture ─────────────────────────────────────────────────────── */

test('the bill page offers feedback by default, and none exists yet', { skip }, async () => {
  const inv = await A.bill(A.asha);
  const token = await A.tokenFor(inv.invoice_id);
  const res = fakeRes();
  await publicBill.bill({ params: { token } }, res);
  assert.equal(res.body.data.feedback_enabled, true);
  assert.equal(res.body.data.feedback, null);
  A.firstToken = token; A.firstInvoice = inv;
});

test('a rating 1-5 is required, and a comment over 1000 chars is trimmed', { skip }, async () => {
  const bad1 = fakeRes();
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 0 } }, bad1);
  assert.equal(bad1.code, 400);
  const bad2 = fakeRes();
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 6 } }, bad2);
  assert.equal(bad2.code, 400);

  const ok = fakeRes();
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 5, comment: 'x'.repeat(1200) } }, ok);
  assert.equal(ok.code ?? 200, 200);
  const row = (await pool.query(`SELECT rating, length(comment) AS len FROM customer_feedback WHERE invoice_id = $1`, [A.firstInvoice.invoice_id])).rows[0];
  assert.equal(row.rating, 5);
  assert.equal(row.len, 1000);
});

test('an unknown token is 404, never which fields are wrong', { skip }, async () => {
  const res = fakeRes();
  await publicBill.submitFeedback({ params: { token: 'not-a-real-token' }, body: { rating: 5 } }, res);
  assert.equal(res.code, 404);
});

test('4-5 stars offers the Google link; 1-3 stays private with no link', { skip }, async () => {
  const happy = fakeRes();
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 4, comment: 'Lovely evening' } }, happy);
  assert.equal(happy.body.data.happy, true);
  assert.equal(happy.body.data.google_review_link, null, 'no link set yet on the business');

  await pool.query(`UPDATE businesses SET google_review_link = 'https://g.page/r/test/review' WHERE business_id = $1`, [A.biz]);
  const happyWithLink = fakeRes();
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 5 } }, happyWithLink);
  assert.equal(happyWithLink.body.data.google_review_link, 'https://g.page/r/test/review');

  const inv2 = await A.bill(A.asha);
  const token2 = await A.tokenFor(inv2.invoice_id);
  const unhappy = fakeRes();
  await publicBill.submitFeedback({ params: { token: token2 }, body: { rating: 2, comment: 'Order was late' } }, unhappy);
  assert.equal(unhappy.body.data.happy, false);
  assert.equal(unhappy.body.data.google_review_link, null, 'an unhappy customer is never pointed at Google');
  A.unhappyFeedbackId = (await pool.query(`SELECT feedback_id FROM customer_feedback WHERE invoice_id = $1`, [inv2.invoice_id])).rows[0].feedback_id;
});

test('resubmitting the same bill updates the one row rather than duplicating it', { skip }, async () => {
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 3, comment: 'changed my mind' } }, fakeRes());
  const rows = (await pool.query(`SELECT rating, comment FROM customer_feedback WHERE invoice_id = $1`, [A.firstInvoice.invoice_id])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 3);
  // restore to 5-star for later tests that assume the fixture's original rating
  await publicBill.submitFeedback({ params: { token: A.firstToken }, body: { rating: 5, comment: 'Lovely evening' } }, fakeRes());
});

test('a cancelled bill, or one with the feature switched off, refuses feedback entirely', { skip }, async () => {
  const inv = await A.bill(A.asha);
  const token = await A.tokenFor(inv.invoice_id);
  await A.call(invoices.cancel, { params: { id: inv.invoice_id } });

  const onCancelled = fakeRes();
  await publicBill.bill({ params: { token } }, onCancelled);
  assert.equal(onCancelled.body.data.feedback_enabled, false);
  const cancelledSubmit = fakeRes();
  await publicBill.submitFeedback({ params: { token }, body: { rating: 5 } }, cancelledSubmit);
  assert.equal(cancelledSubmit.code, 404);

  // now switch the feature off for A's business via a real override and prove the *other* business is unaffected
  await admin.setBusinessOverride({ params: { id: A.biz }, body: { feature_key: 'reviews', enabled: false } }, fakeRes());
  const inv2 = await A.bill(A.asha);
  const token2 = await A.tokenFor(inv2.invoice_id);
  const off = fakeRes();
  await publicBill.bill({ params: { token: token2 } }, off);
  assert.equal(off.body.data.feedback_enabled, false);
  const offSubmit = fakeRes();
  await publicBill.submitFeedback({ params: { token: token2 }, body: { rating: 5 } }, offSubmit);
  assert.equal(offSubmit.code, 404);

  const bInv = await B.bill(await B.customer('Ravi', '9876500009'));
  const bToken = await B.tokenFor(bInv.invoice_id);
  const bOn = fakeRes();
  await publicBill.bill({ params: { token: bToken } }, bOn);
  assert.equal(bOn.body.data.feedback_enabled, true, 'switching it off for A must not touch B');

  await admin.setBusinessOverride({ params: { id: A.biz }, body: { feature_key: 'reviews', enabled: true } }, fakeRes()); // restore
});

/* ── owner side: list, draft, send ─────────────────────────────────────── */

test('list returns this business\'s feedback, newest first, isolated from another business', { skip }, async () => {
  const res = await A.call(reviews.list);
  assert.equal(res.code ?? 200, 200);
  assert.ok(res.body.data.length >= 2);
  assert.ok(res.body.data.every((r) => r.rating >= 1 && r.rating <= 5));

  const bRes = await B.call(reviews.list);
  assert.ok(bRes.body.data.every((r) => !A.firstInvoice || r.invoice_number !== A.firstInvoice.invoice_number));
});

test('list filters by rating and never leaks another business\'s row by id', { skip }, async () => {
  const filtered = await A.call(reviews.list, { query: { rating: '2' } });
  assert.ok(filtered.body.data.every((r) => r.rating === 2));

  const crossBusiness = await B.call(reviews.draftReply, { params: { id: A.unhappyFeedbackId } });
  assert.equal(crossBusiness.code, 404);
});

test('without an AI key, drafting says so and nothing is charged', { skip }, async () => {
  setAIConfigured(false);
  try {
    const res = await A.call(reviews.draftReply, { params: { id: A.unhappyFeedbackId } });
    assert.equal(res.code, 503);
    assert.equal(res.body.code, 'AI_NOT_CONFIGURED');
  } finally { setAIConfigured(undefined); }
});

test('a draft reply is generated, tailored to the rating, and metered', { skip }, async () => {
  setAIProvider(async () => say("We're sorry your order was late — we'll look into it."));
  const before = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [A.biz])).rows[0].n);
  const res = await A.call(reviews.draftReply, { params: { id: A.unhappyFeedbackId } });
  assert.equal(res.code ?? 200, 200);
  assert.match(res.body.data.reply, /sorry/i);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [A.biz])).rows[0].n), before + 1);
});

test('a provider failure while drafting is reported plainly, not thrown', { skip }, async () => {
  setAIProvider(async () => { throw new AIProviderError('The AI service could not answer that'); });
  const res = await A.call(reviews.draftReply, { params: { id: A.unhappyFeedbackId } });
  assert.equal(res.code, 502);
  assert.equal(res.body.code, 'AI_UNAVAILABLE');
});

test('sending a reply needs text and a phone on file, then records and messages it', { skip }, async () => {
  const blank = await A.call(reviews.sendReply, { params: { id: A.unhappyFeedbackId }, body: { text: '' } });
  assert.equal(blank.code, 400);

  const res = await A.call(reviews.sendReply, { params: { id: A.unhappyFeedbackId }, body: { text: "We're sorry — please give us another chance." } });
  assert.equal(res.code ?? 200, 200);
  assert.equal(res.body.data.status, 'SENT');

  const row = (await pool.query(`SELECT reply_text, reply_sent_at FROM customer_feedback WHERE feedback_id = $1`, [A.unhappyFeedbackId])).rows[0];
  assert.match(row.reply_text, /sorry/i);
  assert.ok(row.reply_sent_at);
  assert.ok(sentMsgs.some((m) => m.text.includes('sorry')));

  const audited = (await pool.query(`SELECT action FROM audit_log WHERE business_id = $1 AND action = 'reviews.reply_sent' ORDER BY audit_id DESC LIMIT 1`, [A.biz])).rows[0];
  assert.ok(audited);
});

test('sending fails cleanly when messaging is off for the business', { skip }, async () => {
  await pool.query(`UPDATE businesses SET messaging_settings = $1 WHERE business_id = $2`, [JSON.stringify({ channel: 'OFF' }), A.biz]);
  const res = await A.call(reviews.sendReply, { params: { id: A.unhappyFeedbackId }, body: { text: 'Another note' } });
  assert.equal(res.code, 400);
  await pool.query(`UPDATE businesses SET messaging_settings = $1 WHERE business_id = $2`, [JSON.stringify({ channel: 'WHATSAPP' }), A.biz]);
});
