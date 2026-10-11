/*
 * Retail offers (percent off, buy X get Y, bundle price) and exchange credit: the pricing rules themselves (pure), the
 * owner's list, the cart preview, and bills made with offers (the saving is a line discount BEFORE tax, recorded on the
 * line) and with the credit from a return (spent as a payment, never twice).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction, BillingError } = await import('../src/modules/billing.js');
const { saving, priceLines, dropPromotionCache, runsNow, activePromotions } = await import('../src/modules/promotions.js');
const offers = await import('../src/controllers/promotions.controller.js');
const notes = await import('../src/controllers/creditNotes.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── pure ───────────────────────────────────────────────────────────────── */

const P = (o) => ({ promo_id: 1, name: 'Offer', members_only: false, min_qty: 1, product_id: 7, category_id: null, ...o });
const line = (index, qty, unit = 10000, extra = {}) => ({ index, product_id: 7, category_id: 3, quantity: qty, unitPricePaise: unit, discountPaise: 0, ...extra });

test('each kind of offer saves the right amount', () => {
  const pct = P({ kind: 'PERCENT_OFF', percent: 10, min_qty: 3 });
  assert.equal(saving(pct, 2, 10000), 0, 'below the minimum quantity');
  assert.equal(saving(pct, 3, 10000), 3000);
  const bogo = P({ kind: 'BUY_X_GET_Y', buy_qty: 2, get_qty: 1 });
  assert.equal(saving(bogo, 2, 10000), 0); assert.equal(saving(bogo, 3, 10000), 10000); assert.equal(saving(bogo, 7, 10000), 20000, 'two full sets of three');
  const bundle = P({ kind: 'BUNDLE_PRICE', bundle_qty: 3, bundle_price_paise: 25000 });
  assert.equal(saving(bundle, 2, 10000), 0); assert.equal(saving(bundle, 3, 10000), 5000); assert.equal(saving(bundle, 7, 10000), 10000, 'two bundles, one left over at full price');
  assert.equal(saving(P({ kind: 'BUNDLE_PRICE', bundle_qty: 3, bundle_price_paise: 40000 }), 3, 10000), 0, 'a "bundle" dearer than the shelf price saves nothing');
});

test('the best offer on a product is used, offers do not stack, and member offers need a customer', () => {
  const promos = [P({ promo_id: 1, name: '5% off', kind: 'PERCENT_OFF', percent: 5 }), P({ promo_id: 2, name: '3 for 250', kind: 'BUNDLE_PRICE', bundle_qty: 3, bundle_price_paise: 25000 }), P({ promo_id: 3, name: 'Members 20%', kind: 'PERCENT_OFF', percent: 20, members_only: true })];
  const walkIn = priceLines(promos, [line(0, 3)]);
  assert.deepEqual(walkIn.get(0), { discountPaise: 5000, promo_id: 2, name: '3 for 250' });
  const member = priceLines(promos, [line(0, 3)], { hasCustomer: true });
  assert.equal(member.get(0).promo_id, 3); assert.equal(member.get(0).discountPaise, 6000);
});

test('an offer for a category covers its products, and the saving is spread over a product’s lines to the paisa', () => {
  const cat = [P({ promo_id: 9, name: 'Dairy 10%', kind: 'PERCENT_OFF', percent: 10, product_id: null, category_id: 3 })];
  assert.ok(priceLines(cat, [line(0, 1)]).has(0));
  assert.equal(priceLines(cat, [line(0, 1, 10000, { category_id: 4 })]).size, 0, 'another category');
  const bogo = [P({ kind: 'BUY_X_GET_Y', buy_qty: 1, get_qty: 1 })];
  const split = priceLines(bogo, [line(0, 1, 9999), line(1, 1, 9999)]);       // two lines of the same product: one pair, one free
  assert.equal([...split.values()].reduce((s, r) => s + r.discountPaise, 0), 9999, 'exactly the free unit, nothing lost to rounding');
  const odd = priceLines([P({ kind: 'PERCENT_OFF', percent: 33.33 })], [line(0, 1, 1001), line(1, 2, 1001), line(2, 1, 1001)]);
  assert.equal([...odd.values()].reduce((s, r) => s + r.discountPaise, 0), Math.round(4 * 1001 * 0.3333));
});

test('a line that already has a discount is only cut on what is left, and a product with no price or no offer is left alone', () => {
  const r = priceLines([P({ kind: 'PERCENT_OFF', percent: 50 })], [line(0, 1, 10000, { discountPaise: 8000 })]);
  assert.equal(r.get(0).discountPaise, 2000, '50% of the shelf price is 5000, but only 2000 is left to cut: never more than the line costs');
  assert.equal(priceLines([P({ kind: 'PERCENT_OFF', percent: 50 })], [{ index: 0, product_id: null, quantity: 1, unitPricePaise: 5000, discountPaise: 0 }]).size, 0, 'a custom line has no product to offer on');
  assert.equal(priceLines([], [line(0, 1)]).size, 0);
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let other; let branch; let owner; let milk; let bread; let dairy; let customer;
const tenant = (businessId = biz) => ({ businessId, branchId: branch, scopeBranchId: null, role: 'OWNER', permissions: {}, businessType: 'SUPERMARKET', planFeatures: {} });
const call = async (fn, { body = {}, params = {}, businessId = biz } = {}) => { const res = fakeRes(); await fn({ tenant: tenant(businessId), auth: { userId: owner }, body, params, query: {}, headers: {}, ip: '127.0.0.1' }, res); return res; };
const bill = async (input) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const inv = await createInvoiceInTransaction(client, tenant(), owner, input); await client.query('COMMIT'); return inv; }
  catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@promo.test','x') RETURNING user_id`)).rows[0].user_id;
  const mk = async (n) => (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code) VALUES ($1,$2,'SUPERMARKET',TRUE,'Karnataka','ACTIVE','ENTERPRISE') RETURNING business_id`, [n, owner])).rows[0].business_id;
  [biz, other] = [await mk('Fresh Basket'), await mk('Other')];
  branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  dairy = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Dairy') RETURNING category_id`, [biz])).rows[0].category_id;
  const prod = async (name, price, cat) => (await pool.query(`INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory, category_id) VALUES ($1,$2,$3,'DISH','pc',$4,5,FALSE,$5) RETURNING product_id`, [biz, name, name.slice(0, 3).toUpperCase(), price, cat])).rows[0].product_id;
  milk = await prod('Milk 1L', 5000, dairy); bread = await prod('Bread', 4000, null);
  customer = (await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1,'Regular') RETURNING customer_id`, [biz])).rows[0].customer_id;
});

test('the owner makes, changes, switches off and removes offers; bad ones are refused with a reason', { skip }, async () => {
  const made = await call(offers.create, { body: { name: 'Milk 3 for ₹140', kind: 'BUNDLE_PRICE', product_id: milk, bundle_qty: 3, bundle_price: 140, ends_on: '2999-12-31' } });
  assert.equal(made.code, 201); assert.equal(made.body.data.bundle_price, 140); assert.equal(made.body.data.live, true);
  const id = made.body.data.promo_id;
  assert.equal((await call(offers.update, { params: { id }, body: { is_active: false } })).body.data.live, false);
  assert.equal((await call(offers.update, { params: { id }, body: { is_active: true, bundle_price: 135 } })).body.data.bundle_price, 135);
  const refused = [
    { name: '', kind: 'PERCENT_OFF', product_id: milk, percent: 10 },
    { name: 'x', kind: 'PERCENT_OFF', product_id: milk, percent: 150 },
    { name: 'x', kind: 'PERCENT_OFF', percent: 10 },                                           // neither product nor category
    { name: 'x', kind: 'PERCENT_OFF', product_id: milk, category_id: dairy, percent: 10 },     // both
    { name: 'x', kind: 'BUY_X_GET_Y', product_id: milk, buy_qty: 0, get_qty: 1 },
    { name: 'x', kind: 'BUNDLE_PRICE', product_id: milk, bundle_qty: 1, bundle_price: 10 },
    { name: 'x', kind: 'PERCENT_OFF', product_id: milk, percent: 10, starts_on: '2026-12-31', ends_on: '2026-01-01' },
    { name: 'x', kind: 'NOPE', product_id: milk }
  ];
  for (const body of refused) assert.equal((await call(offers.create, { body })).code, 400, JSON.stringify(body));
  const foreign = await call(offers.create, { businessId: other, body: { name: 'x', kind: 'PERCENT_OFF', product_id: milk, percent: 10 } });
  assert.equal(foreign.code, 400, 'another business’s product cannot be offered');
  assert.equal((await call(offers.remove, { params: { id }, businessId: other })).code, 404, 'nor removed');
  assert.equal((await call(offers.remove, { params: { id } })).code, 200);
  assert.equal((await call(offers.list)).body.data.length, 0);
});

test('a bill with offers takes the saving off the line before tax and records it; without the flag nothing changes', { skip }, async () => {
  await call(offers.create, { body: { name: 'Milk 3 for ₹140', kind: 'BUNDLE_PRICE', product_id: milk, bundle_qty: 3, bundle_price: 140 } });
  await call(offers.create, { body: { name: 'Bread buy 1 get 1', kind: 'BUY_X_GET_Y', product_id: bread, buy_qty: 1, get_qty: 1 } });
  const items = [{ product_id: milk, quantity: 3 }, { product_id: bread, quantity: 2 }];

  const plain = await bill({ items, payment: { amount: 'FULL' } });
  assert.equal(plain.total, 3 * 50 * 1.05 + 2 * 40 * 1.05, 'no offers asked for: shelf prices');

  const preview = await call(offers.preview, { body: { lines: [{ product_id: milk, quantity: 3, unit_price: 50 }, { product_id: bread, quantity: 2, unit_price: 40 }] } });
  assert.deepEqual(preview.body.data.lines.map((l) => [l.index, l.discount]), [[0, 10], [1, 40]]);
  assert.equal(preview.body.data.saving, 50);

  const inv = await bill({ items, applyPromotions: true, payment: { amount: 'FULL' } });
  assert.equal(inv.total, (140 + 40) * 1.05, 'milk 3 for 140, bread pays for one: GST on what was charged');
  const rows = (await pool.query(`SELECT description, discount_paise, promo_id, promo_discount_paise, tax_amount_paise, line_total_paise FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [inv.invoice_id])).rows;
  assert.deepEqual(rows.map((r) => [Number(r.discount_paise), Number(r.promo_discount_paise), r.promo_id != null]), [[1000, 1000, true], [4000, 4000, true]]);
  assert.equal(Number(rows[0].tax_amount_paise), 700, '5% of 140, not of 150');
  // an offer that is switched off, or past its end date, is not applied
  await pool.query(`UPDATE promotions SET ends_on = '2000-01-01' WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  assert.equal((await bill({ items, applyPromotions: true, payment: { amount: 'FULL' } })).total, plain.total, 'expired offers are ignored');
  assert.equal((await call(offers.active)).body.data.count, 0);
  await pool.query(`UPDATE promotions SET ends_on = NULL, is_active = FALSE WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  assert.equal((await bill({ items, applyPromotions: true, payment: { amount: 'FULL' } })).total, plain.total);
});

test('member offers need a customer on the bill', { skip }, async () => {
  await pool.query(`DELETE FROM promotions WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  await call(offers.create, { body: { name: 'Members 20% on dairy', kind: 'PERCENT_OFF', category_id: dairy, percent: 20, members_only: true } });
  const walkIn = await bill({ items: [{ product_id: milk, quantity: 1 }], applyPromotions: true, payment: { amount: 'FULL' } });
  assert.equal(walkIn.total, 52.5);
  const member = await bill({ customerId: customer, items: [{ product_id: milk, quantity: 1 }], applyPromotions: true, payment: { amount: 'FULL' } });
  assert.equal(member.total, 42);
});

test('exchange: the credit from a return pays for the new bill, once, and the rest is paid the usual way', { skip }, async () => {
  const old = await bill({ items: [{ product_id: milk, quantity: 2 }], payment: { amount: 'FULL' } });          // ₹105 paid
  const oldLine = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [old.invoice_id])).rows[0].item_id;
  const cn = await call(notes.create, { params: { id: old.invoice_id }, body: { reason: 'Exchange', items: [{ item_id: oldLine, quantity: 2 }], restock: true } });
  assert.equal(cn.code, 201);
  const credit = cn.body.data;
  assert.equal(credit.total, 105);
  assert.equal(credit.refunded ?? 0, 0, 'no money went back: the credit is kept for the exchange');

  // a ₹168 sale (bread 4 × 40 + 5% GST): ₹105 of credit, ₹63 paid in cash
  const swap = await bill({ items: [{ product_id: bread, quantity: 4 }], exchangeCreditNoteId: credit.cn_id, payment: { amount: 'FULL', method: 'CASH' } });
  assert.equal(swap.total, 168); assert.equal(swap.payment_status, 'PAID');
  const paid = (await pool.query(`SELECT payment_method, amount_paise, reference_number FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [swap.invoice_id])).rows;
  assert.deepEqual(paid.map((p) => [p.payment_method, Number(p.amount_paise)]), [['OTHER', 10500], ['CASH', 6300]]);
  assert.match(paid[0].reference_number, new RegExp(`Exchange ${credit.cn_number}`));
  assert.equal(Number((await pool.query(`SELECT credit_used_paise FROM credit_notes WHERE cn_id = $1`, [credit.cn_id])).rows[0].credit_used_paise), 10500);

  await assert.rejects(bill({ items: [{ product_id: bread, quantity: 1 }], exchangeCreditNoteId: credit.cn_id, payment: { amount: 'FULL' } }), (e) => e instanceof BillingError && /no credit left/.test(e.message), 'the same credit cannot be spent twice');
  await assert.rejects(bill({ items: [{ product_id: bread, quantity: 1 }], exchangeCreditNoteId: 999999, payment: { amount: 'FULL' } }), /not found/);
});

test('a smaller exchange uses only what it needs and leaves the rest of the credit', { skip }, async () => {
  const old = await bill({ items: [{ product_id: milk, quantity: 4 }], payment: { amount: 'FULL' } });          // ₹210
  const oldLine = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [old.invoice_id])).rows[0].item_id;
  const credit = (await call(notes.create, { params: { id: old.invoice_id }, body: { reason: 'Exchange', items: [{ item_id: oldLine, quantity: 4 }] } })).body.data;
  const swap = await bill({ items: [{ product_id: bread, quantity: 1 }], exchangeCreditNoteId: credit.cn_id, payment: { amount: 'FULL' } });   // ₹42
  assert.equal(swap.total, 42);
  const used = Number((await pool.query(`SELECT credit_used_paise FROM credit_notes WHERE cn_id = $1`, [credit.cn_id])).rows[0].credit_used_paise);
  assert.equal(used, 4200);
  const again = await bill({ items: [{ product_id: bread, quantity: 2 }], exchangeCreditNoteId: credit.cn_id, payment: { amount: 'FULL' } });   // ₹84 from the ₹168 left
  assert.equal(again.balance_due ?? 0, 0);
  assert.equal(Number((await pool.query(`SELECT credit_used_paise FROM credit_notes WHERE cn_id = $1`, [credit.cn_id])).rows[0].credit_used_paise), 12600);
});

test('the retail day figures count what offers took off today and what was returned', { skip }, async () => {
  const dash = await import('../src/controllers/retailDashboard.controller.js');
  await pool.query(`DELETE FROM promotions WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  await call(offers.create, { body: { name: 'Milk 10% off', kind: 'PERCENT_OFF', product_id: milk, percent: 10 } });
  dash.dropDashboardCache();
  const before = (await call(dash.today)).body.data;
  await bill({ items: [{ product_id: milk, quantity: 2 }], applyPromotions: true, payment: { amount: 'FULL' } });     // 10% of 100: ₹10 off one line
  dash.dropDashboardCache();
  const after = (await call(dash.today)).body.data;
  assert.equal(after.offers.saving - before.offers.saving, 10); assert.equal(after.offers.lines - before.offers.lines, 1);
  assert.ok(after.returns.count >= 1, 'the returns made earlier today are counted');
  const other2 = (await call(dash.today, { businessId: other })).body.data;
  assert.deepEqual(other2, { offers: { lines: 0, saving: 0 }, returns: { count: 0, total: 0 } }, 'another business sees only its own');
});
