/* "Scan the bill, get your stamp": one real paid bill credits once, only for a little while, never for a bill already on a card, and joins a new customer on the spot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const claim = await import('../src/modules/loyaltyBillClaim.js');
const pub = await import('../src/controllers/loyaltyCard.controller.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let other; let n = 0;
const mkBiz = async (name) => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@bq.test`])).rows[0];
  const b = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ($1,$2,'CAFE',(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [name, u.user_id])).rows[0].business_id;
  await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'loyalty_programmes',TRUE),($1,'loyalty_bill_qr',TRUE) ON CONFLICT DO NOTHING`, [b]);
  return b;
};
const mkProg = async (b, billQr) => (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points, min_txn_paise, settings) VALUES ($1,'Stamps','STAMPS',1,0,5,0,5,5000,$2) RETURNING programme_id`, [b, JSON.stringify({ bill_qr: billQr })])).rows[0].programme_id;
/** A bill; `paid` false leaves a balance, `ago` hours old, `customer` already on it. */
const bill = async (b, { total = 20000, paid = true, ago = 0, customer = null, status = 'ISSUED' } = {}) => {
  n += 1;
  return (await pool.query(`INSERT INTO invoices (business_id, invoice_number, total_paise, balance_due_paise, status, customer_id, created_at) VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' hours')::interval) RETURNING invoice_id`, [b, `BQ-${n}`, total, paid ? 0 : total, status, customer, String(ago)])).rows[0].invoice_id;
};
const tokenOf = async (id) => (await claim.linkFor(pool, id, biz)).split('/').pop();
const go = (token, extra = {}) => withTransaction((c) => claim.claim(c, token, { name: 'Asha', phone: '9000012345', ...extra }));
const balance = async (phone, programmeId) => (await pool.query(`SELECT COALESCE(SUM(l.points),0)::int AS b FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id LEFT JOIN points_ledger l ON l.membership_id = m.membership_id AND l.voided_at IS NULL WHERE right(c.phone,10) = $1 AND m.programme_id = $2`, [phone, programmeId])).rows[0].b;

test('setup', { skip }, async () => { await runMigrations(pool); biz = await mkBiz('bq1'); other = await mkBiz('bq2'); });

test('a card without the bill QR switched on prints no code', { skip }, async () => {
  const off = await mkProg(biz, false);
  assert.equal(await claim.linkFor(pool, await bill(biz), biz), null);
  await pool.query(`UPDATE loyalty_programmes SET is_active = FALSE WHERE programme_id = $1`, [off]);
});

let prog;
test('with it on, a paid bill gets a link, and scanning it joins a new customer and stamps their card once', { skip }, async () => {
  prog = await mkProg(biz, true);
  const id = await bill(biz);
  const link = await claim.linkFor(pool, id, biz);
  assert.match(link, /\/card\/bill\/[0-9a-f]{32}$/);
  assert.equal(await claim.linkFor(pool, id, biz), link);                         // the same code every time
  const token = link.split('/').pop();
  const i = await claim.info(pool, token);
  assert.equal(i.state, 'OPEN'); assert.equal(i.cards[0].gives, 1); assert.equal(i.business, 'bq1');
  const out = await go(token);
  assert.equal(out.added[0].new_member, true); assert.ok(out.token && out.token.length >= 20);
  assert.equal(await balance('9000012345', prog), 1);
  await assert.rejects(go(token), /already been added/);                           // a second scan of the same bill
  assert.equal(await balance('9000012345', prog), 1);
  assert.equal((await claim.info(pool, token)).state, 'CLAIMED');
});

test('an existing member (number saved with spaces) is credited but not handed their card link', { skip }, async () => {
  const token = await tokenOf(await bill(biz));
  const out = await go(token, { name: 'Someone else' });
  assert.equal(out.added[0].new_member, false); assert.equal(out.token, null);
  assert.equal(await balance('9000012345', prog), 2);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND right(phone,10) = '9000012345'`, [biz])).rows[0].n, 1);   // no duplicate customer
});

test('an unpaid, old, cancelled or already-on-a-card bill is refused, and a small bill earns nothing', { skip }, async () => {
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'At till','9000099999') RETURNING customer_id`, [biz])).rows[0].customer_id;
  for (const [opts, re] of [[{ paid: false }, /not paid/], [{ ago: 30 }, /too old/], [{ customer: cust }, /already on a loyalty card/], [{ status: 'CANCELLED' }, /cancelled/]]) {
    const id = await bill(biz, opts);
    const token = (await pool.query(`UPDATE invoices SET share_token = $2 WHERE invoice_id = $1 RETURNING share_token`, [id, `tok${id}abcdefgh`])).rows[0].share_token;
    await assert.rejects(go(token), re);
  }
  assert.equal(await claim.linkFor(pool, await bill(biz, { total: 1000 }), biz), null);   // under the card's minimum bill
});

test('bad numbers and strangers: the page route checks the plan, the number, and the bill belongs to the link', { skip }, async () => {
  const token = await tokenOf(await bill(biz));
  const call = async (fn, body) => { const res = fakeRes(); await fn({ params: { token }, body: body || {}, query: {} }, res); return res; };
  assert.equal((await call(pub.billClaimIt, { name: 'A', phone: '123' })).code, 400);
  assert.equal((await call(pub.billInfo)).code, 200);
  assert.equal((await call(pub.billClaimIt, { name: 'Ravi', phone: '9000055555' })).code, 201);
  const res = fakeRes(); await pub.billInfo({ params: { token: 'nope' }, query: {} }, res); assert.equal(res.code, 404);
  await pool.query(`UPDATE business_feature_overrides SET enabled = FALSE WHERE business_id = $1 AND feature_key = 'loyalty_bill_qr'`, [biz]);
  assert.equal((await call(pub.billInfo)).code, 404);                              // the plan can switch it off
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1`, [other])).rows[0].n, 0);   // nothing leaked to the other business
});

test('Card results count the stamps given by scanning the bill', { skip }, async () => {
  const { report } = await import('../src/modules/loyaltyReport.js');
  const r = await report(pool, biz, { days: 30 });
  const card = r.cards.find((c) => c.programme_id === prog);
  assert.ok(card.bill_scans >= 3); assert.equal(r.totals.bill_scans >= card.bill_scans, true);
});

test('one number can claim only a few scanned bills a day, and a scan never records marketing consent', { skip }, async () => {
  await pool.query(`UPDATE business_feature_overrides SET enabled = TRUE WHERE business_id = $1 AND feature_key = 'loyalty_bill_qr'`, [biz]);
  const phone = '9000077777';
  for (let k = 0; k < claim.DAILY_LIMIT; k++) await go(await tokenOf(await bill(biz)), { phone });
  await assert.rejects(go(await tokenOf(await bill(biz)), { phone }), /most bills it can today/);
  const m = (await pool.query(`SELECT bool_or(m.consent_marketing) AS c FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id WHERE right(c.phone,10) = $1`, [phone])).rows[0];
  assert.equal(m.c, false);
  const res = fakeRes(); await pub.billClaimIt({ params: { token: await tokenOf(await bill(biz)) }, body: { name: 'Z', phone: '9000066666', consent_marketing: true }, query: {} }, res);   // the check is off, so a ticked box is ignored
  assert.equal(res.code, 201);
  assert.equal((await pool.query(`SELECT bool_or(m.consent_marketing) AS c FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id WHERE right(c.phone,10) = '9000066666'`)).rows[0].c, false);
});

test('with the number check on: a code is sent first, the right code proves it once, and the phone then skips the code', { skip }, async () => {
  const { setProvider } = await import('../src/modules/messaging/provider.js');
  const sent = []; setProvider((m) => { sent.push(m); return { status: 'SENT', providerId: 'x' }; });
  try {
    await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'loyalty_phone_check',TRUE) ON CONFLICT (business_id, feature_key) DO UPDATE SET enabled = TRUE`, [biz]);
    await pool.query(`UPDATE loyalty_programmes SET settings = settings || '{"verify_phone": true}'::jsonb WHERE business_id = $1 AND programme_id = $2`, [biz, prog]);
    const token = await tokenOf(await bill(biz));
    const post = async (body) => { const res = fakeRes(); await pub.billClaimIt({ params: { token }, body: { name: 'Meera', phone: '9000088888', ...body }, query: {} }, res); return res; };
    const info = fakeRes(); await pub.billInfo({ params: { token }, query: {} }, info); assert.equal(info.body.data.check, true);
    assert.equal((await post({})).code, 428);                                         // first scan: a code goes out, nothing is credited
    assert.equal(sent.length, 1); assert.equal(await balance('9000088888', prog), 0);
    const code = /Code: (\d{6})/.exec(sent[0].text)[1];
    assert.equal((await post({ code: code === '000000' ? '111111' : '000000' })).code, 400);   // a wrong code
    const ok1 = await post({ code, consent_marketing: true });
    assert.equal(ok1.code, 201); assert.ok(ok1.body.data.proof.length > 20);
    assert.equal(await balance('9000088888', prog), 1);
    assert.equal((await pool.query(`SELECT bool_or(m.consent_marketing) AS c FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id WHERE right(c.phone,10) = '9000088888'`)).rows[0].c, true);   // proved, so the tick counts
    await assert.rejects(post({ code }).then((r) => { if (r.code >= 400) throw new Error('refused'); }), /refused/);   // the code is single use
    const next = await tokenOf(await bill(biz));
    const again = fakeRes(); await pub.billClaimIt({ params: { token: next }, body: { name: 'Meera', phone: '9000088888', proof: ok1.body.data.proof }, query: {} }, again);
    assert.equal(again.code, 201); assert.equal(sent.length, 1);                      // same phone: no new code
    const other = fakeRes(); await pub.billClaimIt({ params: { token: await tokenOf(await bill(biz)) }, body: { name: 'X', phone: '9000099998', proof: ok1.body.data.proof }, query: {} }, other);
    assert.equal(other.code, 428);                                                    // the proof is for that number only
  } finally { setProvider(null); }
});

test('"Send me offers" on the card: needs the WhatsApp code, then switches offers on for that person', { skip }, async () => {
  const { setProvider } = await import('../src/modules/messaging/provider.js');
  const sent = []; setProvider((m) => { sent.push(m); return { status: 'SENT', providerId: 'x' }; });
  try {
    await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'loyalty_phone_check',TRUE) ON CONFLICT (business_id, feature_key) DO UPDATE SET enabled = TRUE`, [biz]);
    const m = (await pool.query(`SELECT m.token FROM loyalty_memberships m JOIN customers c ON c.customer_id = m.customer_id WHERE right(c.phone,10) = '9000012345' AND m.business_id = $1 LIMIT 1`, [biz])).rows[0];   // joined by a scan, not opted in
    const view = async () => { const r = fakeRes(); await pub.card({ params: { token: m.token }, query: {} }, r); return r.body.data.offers; };
    assert.deepEqual(await view(), { on: false, can_ask: true });
    const post = async (body) => { const r = fakeRes(); await pub.offersOn({ params: { token: m.token }, body, query: {} }, r); return r; };
    assert.equal((await post({})).code, 428); assert.equal(sent.length, 1);
    assert.equal((await post({ code: '123456' })).code, sent[0].text.includes('123456') ? 200 : 400);
    const code = /Code: (\d{6})/.exec(sent[0].text)[1];
    const done = await post({ code }); assert.equal(done.code, 200); assert.equal(done.body.data.on, true);
    assert.deepEqual(await view(), { on: true, can_ask: false });
  } finally { setProvider(null); }
});
