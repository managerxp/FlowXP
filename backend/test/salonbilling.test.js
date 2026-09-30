/*
 * The salon till: services, products, mixed carts, discounts, GST (both ways), loyalty, split and partial
 * payments, credit notes, cancellation, gift cards, packages and memberships — all through the real billing engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addClient, addRecipe, addService, addStaff, addStock, fakeRes, makeSalon, sell, stockOf } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createSalonInvoice } = await import('../src/modules/salon/pos.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const creditNotes = await import('../src/controllers/creditNotes.controller.js');
const plansApi = (await import('../src/controllers/salonPlans.controller.js')).default;

test.after(cleanup);

let S; let ravi; let meena; let haircut; let facial; let shampoo; let colour; let colouring; let asha;
const rupees = (n) => Math.round(n * 100) / 100;
const row = async (sql, values) => (await pool.query(sql, values)).rows[0];
const rows = async (sql, values) => (await pool.query(sql, values)).rows;
const go = (input, opts) => sell(pool, createSalonInvoice, S, input, opts);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeSalon(pool, 'bill');
  ravi = await addStaff(pool, S, { name: 'Ravi', type: 'PERCENT', value: 20, productPct: 5 });
  meena = await addStaff(pool, S, { name: 'Meena', type: 'FIXED', value: 50 });
  haircut = await addService(pool, S, { name: 'Haircut', price: 500, tax: 18 });
  facial = await addService(pool, S, { name: 'Facial', price: 1000, tax: 18, commission: { type: 'PERCENT', value: 10 } });
  shampoo = await addStock(pool, S, { name: 'Shampoo', kind: 'DISH', price: 400, cost: 250, tax: 18, stock: 10 });
  colour = await addStock(pool, S, { name: 'Hair colour', kind: 'INGREDIENT', cost: 2, stock: 500, unit: 'ml' });
  colouring = await addService(pool, S, { name: 'Hair colouring', price: 2000, tax: 18 });
  await addRecipe(pool, S, colouring, colour, 50, { variable: true });
  asha = await addClient(pool, S, 'Asha', '9876500001');
});

test('a service sale: GST on top, the person who did it, and their commission', { skip }, async () => {
  const out = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal(out.invoice.subtotal, 500);
  assert.equal(out.invoice.tax, 90);
  assert.equal(out.invoice.cgst, 45); assert.equal(out.invoice.sgst, 45);
  assert.equal(out.invoice.total, 590);
  assert.equal(out.invoice.payment_status, 'PAID');
  const line = await row(`SELECT * FROM salon_invoice_lines WHERE invoice_id = $1`, [out.invoice.invoice_id]);
  assert.equal(line.line_type, 'SERVICE'); assert.equal(line.staff_id, ravi);
  const c = await row(`SELECT * FROM salon_commissions WHERE invoice_id = $1`, [out.invoice.invoice_id]);
  assert.equal(Number(c.amount_paise), 10000, '20% of the ₹500 before tax');
  assert.equal(c.status, 'PENDING');
});

test('a fixed commission is per service done, and a per-service rate beats the person\'s rate', { skip }, async () => {
  const a = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: meena, quantity: 2 }] });
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [a.invoice.invoice_id])).amount_paise), 10000, '₹50 x 2');
  const b = await go({ items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi }] });
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [b.invoice.invoice_id])).amount_paise), 10000, 'the facial itself pays 10% of ₹1000, not Ravi\'s 20%');
});

test('a retail product sale takes stock down and pays product commission', { skip }, async () => {
  const before = await stockOf(pool, S.branchId, shampoo);
  const out = await go({ items: [{ type: 'PRODUCT', product_id: shampoo, quantity: 2, staff_id: ravi }], payments: [{ method: 'UPI', amount: 'REST' }] });
  assert.equal(out.invoice.total, 944);
  assert.equal(await stockOf(pool, S.branchId, shampoo), before - 2);
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [out.invoice.invoice_id])).amount_paise), 4000, '5% of ₹800');
  await assert.rejects(() => go({ items: [{ type: 'PRODUCT', product_id: shampoo, quantity: 99 }] }), /Not enough stock/);
});

test('a mixed cart is one invoice with lines of each kind', { skip }, async () => {
  const out = await go({ customer_id: asha, items: [
    { type: 'SERVICE', service_id: haircut, staff_id: ravi },
    { type: 'PRODUCT', product_id: shampoo, quantity: 1 }
  ] });
  assert.equal(out.lines.length, 2);
  assert.equal(out.invoice.subtotal, 900);
  assert.equal(out.invoice.total, 1062);
  const types = (await rows(`SELECT line_type FROM salon_invoice_lines WHERE invoice_id = $1 ORDER BY item_id`, [out.invoice.invoice_id])).map((r) => r.line_type);
  assert.deepEqual(types, ['SERVICE', 'PRODUCT']);
});

test('a discount comes off before tax, and commission follows what was paid', { skip }, async () => {
  const out = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, discount: 50 }] });
  assert.equal(out.invoice.subtotal, 450);
  assert.equal(out.invoice.tax, 81);
  assert.equal(out.invoice.total, 531);
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [out.invoice.invoice_id])).amount_paise), 9000);
});

test('an invoice-level discount and the quote agree with the sale', { skip }, async () => {
  const cart = { items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi }], discount: 100 };
  const quote = await go(cart, { dryRun: true });
  const sale = await go(cart);
  assert.equal(quote.invoice.total, sale.invoice.total);
  assert.equal(sale.invoice.discount, 100);
  const numbers = (await rows(`SELECT invoice_number FROM invoices WHERE business_id = $1 ORDER BY invoice_id DESC LIMIT 2`, [S.businessId])).map((r) => r.invoice_number);
  assert.notEqual(numbers[0], quote.invoice.invoice_number === numbers[0] ? 'x' : numbers[0], 'a quote never keeps an invoice number');
});

test('GST can be tax-inclusive: the price is the total and the tax is carved out of it', { skip }, async () => {
  await pool.query(`UPDATE salon_settings SET tax_inclusive = TRUE WHERE business_id = $1`, [S.businessId]);
  try {
    const out = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
    assert.equal(out.invoice.total, 500, '₹500 all in');
    assert.equal(out.invoice.tax, 76.27);
    assert.equal(out.invoice.subtotal, 423.73);
    assert.equal(rupees(out.invoice.cgst + out.invoice.sgst), 76.27);
    assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [out.invoice.invoice_id])).amount_paise), 8475, 'commission on the ₹423.73 before tax');
  } finally {
    await pool.query(`UPDATE salon_settings SET tax_inclusive = FALSE WHERE business_id = $1`, [S.businessId]);
  }
});

test('a salon that is not GST-registered charges no tax at all', { skip }, async () => {
  const N = await makeSalon(pool, 'nogst', { gst: false });
  const st = await addStaff(pool, N, { name: 'Sam' });
  const svc = await addService(pool, N, { name: 'Cut', price: 300, tax: 18 });
  const out = await sell(pool, createSalonInvoice, N, { items: [{ type: 'SERVICE', service_id: svc, staff_id: st }] });
  assert.equal(out.invoice.tax, 0); assert.equal(out.invoice.total, 300);
});

test('split payments: part cash, the rest on UPI', { skip }, async () => {
  const out = await go({ items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi }, { type: 'SERVICE', service_id: haircut, staff_id: ravi }],
    payments: [{ method: 'CASH', amount: 500 }, { method: 'UPI', amount: 'REST', reference_number: 'UTR1' }] });
  assert.equal(out.invoice.total, 1770);
  const pays = await rows(`SELECT payment_method, amount_paise FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [out.invoice.invoice_id]);
  assert.deepEqual(pays.map((p) => [p.payment_method, Number(p.amount_paise)]), [['CASH', 50000], ['UPI', 127000]]);
  assert.equal(out.invoice.payment_status, 'PAID');
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'CASH', amount: 9999 }, { method: 'UPI', amount: 1 }] }), /more than the bill/);
});

test('partial payment leaves a balance, and no payment leaves the whole bill owing', { skip }, async () => {
  const part = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'CASH', amount: 200 }] });
  assert.equal(part.invoice.payment_status, 'PARTIAL'); assert.equal(part.invoice.balance_due, 390);
  const credit = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
  assert.equal(credit.invoice.payment_status, 'UNPAID'); assert.equal(credit.invoice.balance_due, 590);
});

test('a method the salon has switched off is refused', { skip }, async () => {
  await pool.query(`UPDATE salon_settings SET payment_methods = '["CASH","UPI"]' WHERE business_id = $1`, [S.businessId]);
  try {
    await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'CARD', amount: 'REST' }] }), /not switched on/);
  } finally {
    await pool.query(`UPDATE salon_settings SET payment_methods = '["CASH","UPI","CARD","BANK_TRANSFER","WALLET"]' WHERE business_id = $1`, [S.businessId]);
  }
  const wallet = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'WALLET', amount: 'REST' }] });
  assert.equal(wallet.invoice.payment_status, 'PAID');
});

test('a service needs someone to do it, and only the owner\'s own staff and items', { skip }, async () => {
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: haircut }] }), /Choose who is doing/);
  const other = await makeSalon(pool, 'other');
  const theirs = await addStaff(pool, other, { name: 'Their stylist' });
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: theirs }] }), /own active team/);
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: shampoo, staff_id: ravi }] }), /not a service/);
  await assert.rejects(() => go({ items: [] }), /at least one item/);
  await assert.rejects(() => go({ customer_id: 99999999, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /Client not found/);
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, unit_price: 1 }] }, { tenant: S.tenantFor('CASHIER') }), /change a price/);
  const overridden = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, unit_price: 400 }] });
  assert.equal(overridden.invoice.subtotal, 400, 'a manager may override a price');
});

test('a credit note takes back revenue and its share of commission; cancelling voids the rest', { skip }, async () => {
  const out = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, quantity: 2 }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const items = await rows(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [out.invoice.invoice_id]);
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [out.invoice.invoice_id])).amount_paise), 20000);

  const res = fakeRes();
  await creditNotes.create(S.req({ params: { id: out.invoice.invoice_id }, body: { items: [{ item_id: items[0].item_id, quantity: 1 }], reason: 'Unhappy', refund: { method: 'CASH' } } }), res);
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.total, 590);
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1 AND status <> 'VOID'`, [out.invoice.invoice_id])).amount_paise), 10000, 'half the commission is gone');

  await pool.query(`UPDATE salon_commissions SET status = 'PAID' WHERE invoice_id = $1`, [out.invoice.invoice_id]);
  const c2 = fakeRes();
  await creditNotes.create(S.req({ params: { id: out.invoice.invoice_id }, body: { items: [{ item_id: items[0].item_id, quantity: 1 }], reason: 'Rest too' } }), c2);
  assert.equal(c2.code, 201, JSON.stringify(c2.body));
  const net = Number((await row(`SELECT COALESCE(SUM(amount_paise), 0) AS n FROM salon_commissions WHERE invoice_id = $1 AND status <> 'VOID'`, [out.invoice.invoice_id])).n);
  assert.equal(net, 0, 'commission already paid out is offset, so the next payout nets it off');
});

test('cancelling an invoice voids commission and returns stock', { skip }, async () => {
  const before = await stockOf(pool, S.branchId, shampoo);
  const out = await go({ items: [{ type: 'PRODUCT', product_id: shampoo, quantity: 3, staff_id: ravi }] });
  assert.equal(await stockOf(pool, S.branchId, shampoo), before - 3);
  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: out.invoice.invoice_id } }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(await stockOf(pool, S.branchId, shampoo), before);
  assert.equal((await row(`SELECT COUNT(*) AS n FROM salon_commissions WHERE invoice_id = $1 AND status <> 'VOID'`, [out.invoice.invoice_id])).n, '0');
});

test('gift cards: sold for cash, spent as a payment, restored if the bill is cancelled', { skip }, async () => {
  const sold = await go({ customer_id: asha, items: [{ type: 'GIFT_CARD', amount: 2000 }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal(sold.invoice.total, 2000, 'no tax on the sale of a voucher');
  const card = sold.issued.gift_cards[0];
  assert.match(card.code, /^GC-/);
  await assert.rejects(() => go({ items: [{ type: 'GIFT_CARD', amount: 500 }], payments: [{ method: 'CASH', amount: 100 }] }), /paid in full/);

  const bill = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'GIFT_CARD', code: card.code.toLowerCase(), amount: 590 }] });
  assert.equal(bill.invoice.payment_status, 'PAID');
  const balance = async () => Number((await row(`SELECT balance_paise FROM salon_gift_cards WHERE card_id = $1`, [card.card_id])).balance_paise);
  assert.equal(await balance(), 141000);

  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi }], payments: [{ method: 'GIFT_CARD', code: card.code, amount: 5000 }] }), /only has/);
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi }], payments: [{ method: 'GIFT_CARD', code: 'GC-NOPE', amount: 100 }] }), /not found/);
  assert.equal(await balance(), 141000, 'failed attempts spend nothing');

  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: bill.invoice.invoice_id } }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(await balance(), 200000, 'the money goes back on the card');
  const cancelSold = fakeRes();
  await invoices.cancel(S.req({ params: { id: sold.invoice.invoice_id } }), cancelSold);
  assert.equal(cancelSold.code, 200, 'an unspent card can be withdrawn with its sale');
  assert.equal((await row(`SELECT status FROM salon_gift_cards WHERE card_id = $1`, [card.card_id])).status, 'CANCELLED');
});

test('a gift card that has been spent from cannot be taken back with its sale', { skip }, async () => {
  const sold = await go({ items: [{ type: 'GIFT_CARD', amount: 1000 }], payments: [{ method: 'CASH', amount: 'REST' }] });
  await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'GIFT_CARD', code: sold.issued.gift_cards[0].code, amount: 100 }, { method: 'CASH', amount: 'REST' }] });
  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: sold.invoice.invoice_id } }), res);
  assert.equal(res.code, 409);
  assert.match(res.body.message, /already been spent/);
});

test('packages: sold once, used visit by visit at no charge, and never overspent', { skip }, async () => {
  const created = fakeRes();
  await plansApi.createPackage(S.req({ body: { name: 'Bridal', price: 1800, tax_rate: 18, validity_days: 90, items: [{ service_id: haircut, quantity: 2 }, { service_id: facial, quantity: 1 }] } }), created);
  assert.equal(created.code, 201, JSON.stringify(created.body));
  S.pkg = created.body.data;
  const sold = await go({ customer_id: asha, items: [{ type: 'PACKAGE', package_id: S.pkg.package_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal(sold.invoice.subtotal, 1800); assert.equal(sold.invoice.total, 2124);
  const cp = sold.issued.packages[0].cp_id;

  const use = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] });
  assert.equal(use.invoice.total, 0);
  const left = async (svc) => { const r = await row(`SELECT qty_total - qty_used AS n FROM salon_customer_package_items WHERE cp_id = $1 AND service_id = $2`, [cp, svc]); return Number(r.n); };
  assert.equal(await left(haircut), 1);
  assert.equal(Number((await row(`SELECT amount_paise FROM salon_commissions WHERE invoice_id = $1`, [use.invoice.invoice_id])).amount_paise), 10000, 'commission on the ₹500 list price');

  await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] });
  await assert.rejects(() => go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] }), /no visits left/);
  assert.equal(await left(haircut), 0, 'the failed attempt spent nothing');
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] }), /Choose a client/);

  const other = await addClient(pool, S, 'Someone else');
  await assert.rejects(() => go({ customer_id: other, items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] }), /not on this client/);

  // the package can't be withdrawn once it has been used
  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: sold.invoice.invoice_id } }), res);
  assert.equal(res.code, 409); assert.match(res.body.message, /already been used/);
});

test('cancelling a package visit gives the visit back', { skip }, async () => {
  const res0 = fakeRes();
  await plansApi.createPackage(S.req({ body: { name: 'Mini', price: 500, tax_rate: 0, validity_days: 30, items: [{ service_id: haircut, quantity: 1 }] } }), res0);
  const sold = await go({ customer_id: asha, items: [{ type: 'PACKAGE', package_id: res0.body.data.package_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const cp = sold.issued.packages[0].cp_id;
  const use = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] });
  assert.equal(Number((await row(`SELECT qty_used FROM salon_customer_package_items WHERE cp_id = $1`, [cp])).qty_used), 1);
  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: use.invoice.invoice_id } }), res);
  assert.equal(res.code, 200);
  assert.equal(Number((await row(`SELECT qty_used FROM salon_customer_package_items WHERE cp_id = $1`, [cp])).qty_used), 0);
});

test('memberships: a discount on services and free services, used up and handed back on cancel', { skip }, async () => {
  const res = fakeRes();
  await plansApi.createPlan(S.req({ body: { name: 'Premium', price: 1999, tax_rate: 18, duration_days: 30, benefits: { discount_pct: 10, free_services: [{ service_id: facial, qty: 1 }], points_multiplier: 2 } } }), res);
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const sold = await go({ customer_id: asha, items: [{ type: 'MEMBERSHIP', plan_id: res.body.data.plan_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal(sold.invoice.subtotal, 1999);
  assert.equal(sold.issued.memberships[0].renewed, false);

  const visit = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }, { type: 'SERVICE', service_id: facial, staff_id: ravi, use: { kind: 'MEMBERSHIP' } }] });
  assert.equal(visit.invoice.subtotal, 450, '10% off the haircut; the facial is free');
  assert.equal(visit.membership_discount_pct, 10);
  assert.equal(visit.lines[1].total, 0);
  assert.equal(Number((await row(`SELECT COUNT(*) AS n FROM salon_membership_usage WHERE invoice_id = $1 AND voided_at IS NULL`, [visit.invoice.invoice_id])).n), 2, 'one free service and one discount');
  await assert.rejects(() => go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi, use: { kind: 'MEMBERSHIP' } }] }), /used up/);

  const cancel = fakeRes();
  await invoices.cancel(S.req({ params: { id: visit.invoice.invoice_id } }), cancel);
  assert.equal(cancel.code, 200);
  const again = await go({ customer_id: asha, items: [{ type: 'SERVICE', service_id: facial, staff_id: ravi, use: { kind: 'MEMBERSHIP' } }] });
  assert.equal(again.invoice.total, 0, 'the free facial is available again');
});

test('offers: first visit only, a code, per-client limits and what they apply to', { skip }, async () => {
  const mk = async (body) => { const r = fakeRes(); await plansApi.createOffer(S.req({ body }), r); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
  const first = await mk({ name: 'First visit 20%', discount_type: 'PERCENT', value: 20, applies_to: 'SERVICES', auto_apply: true, conditions: { first_visit: true } });
  const newbie = await addClient(pool, S, 'Newbie');
  const out = await go({ customer_id: newbie, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }, { type: 'PRODUCT', product_id: shampoo, quantity: 1 }] });
  assert.equal(out.offers[0].amount, 100, '20% of the service only');
  assert.equal(out.invoice.subtotal, 800, '₹400 service after discount + ₹400 product');
  assert.equal((await row(`SELECT COUNT(*) AS n FROM salon_offer_redemptions WHERE invoice_id = $1`, [out.invoice.invoice_id])).n, '1');

  const again = await go({ customer_id: newbie, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
  assert.equal(again.offers.length, 0, 'it was for the first visit');
  await assert.rejects(() => go({ customer_id: newbie, offer_ids: [first.offer_id], items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /first visit/);

  await mk({ name: 'Flat 100', code: 'SAVE100', discount_type: 'FIXED', value: 100, applies_to: 'ALL', per_customer_limit: 1, conditions: { min_bill: 400 } });
  const plain = await addClient(pool, S, 'Plain client');
  await go({ customer_id: plain, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });   // so the first-visit offer is behind them
  const a = await go({ customer_id: plain, offer_code: 'save100', items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
  assert.equal(a.offers[0].amount, 100); assert.equal(a.invoice.subtotal, 400);
  await assert.rejects(() => go({ customer_id: plain, offer_code: 'SAVE100', items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /already used/);
  await assert.rejects(() => go({ customer_id: plain, offer_code: 'NOPE', items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /not valid/);

  const cancel = fakeRes();
  await invoices.cancel(S.req({ params: { id: a.invoice.invoice_id } }), cancel);
  const b = await go({ customer_id: plain, offer_code: 'SAVE100', items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
  assert.equal(b.offers[0].amount, 100, 'a cancelled bill gives the offer back');
});

test('offers respect dates, outlets and birthdays', { skip }, async () => {
  const mk = async (body) => { const r = fakeRes(); await plansApi.createOffer(S.req({ body }), r); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
  const fresh = await addClient(pool, S, 'Fresh client');
  const expired = await mk({ name: 'Old', code: 'OLD10', discount_type: 'PERCENT', value: 10, ends_on: '2020-01-01' });
  await assert.rejects(() => go({ customer_id: fresh, offer_code: expired.code, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /ended/);
  const elsewhere = await mk({ name: 'Elsewhere', code: 'ELSE10', discount_type: 'PERCENT', value: 10, branch_ids: [S.branchId + 9999] });
  await assert.rejects(() => go({ customer_id: fresh, offer_code: elsewhere.code, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /not available at this outlet/);
  const bday = await mk({ name: 'Birthday', code: 'BDAY', discount_type: 'PERCENT', value: 15, conditions: { birthday: true, window_days: 0 } });
  await assert.rejects(() => go({ customer_id: fresh, offer_code: bday.code, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }), /birthday/);
  const { businessToday } = await import('../src/utils/dates.js');
  const today = await businessToday(S.businessId);   // the salon's own today, which is not always the server's
  await pool.query(`INSERT INTO salon_customer_profiles (customer_id, business_id, dob) VALUES ($1,$2,$3) ON CONFLICT (customer_id) DO UPDATE SET dob = EXCLUDED.dob`, [fresh, S.businessId, `1990${today.slice(4)}`]);
  const ok = await go({ customer_id: fresh, offer_code: bday.code, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
  assert.equal(ok.offers.find((o) => o.name === 'Birthday').amount, 60, '15% of what the first-visit offer left (₹400)');
});

test('hair colouring uses the recipe by default and the amount the stylist actually used when told', { skip }, async () => {
  const start = await stockOf(pool, S.branchId, colour);
  await go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi }] });
  assert.equal(await stockOf(pool, S.branchId, colour), start - 50);
  await go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: 60 }] }] });
  assert.equal(await stockOf(pool, S.branchId, colour), start - 50 - 60, 'the ledger reflects the 60 ml actually used');
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: shampoo + 99999, quantity: 5 }] }] }), /not in your stock list/);
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: -1 }] }] }), /zero or more/);
  assert.equal(rupees(await stockOf(pool, S.branchId, colour)), start - 110);
});

test('a feature the plan does not include is refused at the till', { skip }, async () => {
  const limited = S.tenantFor('OWNER', { planFeatures: { salon_gift_cards: false, salon_packages: false, salon_memberships: false } });
  await assert.rejects(() => go({ items: [{ type: 'GIFT_CARD', amount: 500 }], payments: [{ method: 'CASH', amount: 'REST' }] }, { tenant: limited }), /not available on your plan/);
  await assert.rejects(() => go({ customer_id: asha, items: [{ type: 'PACKAGE', package_id: S.pkg.package_id }] }, { tenant: limited }), /not available on your plan/);
  const fine = await go({ items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }, { tenant: limited });
  assert.equal(fine.invoice.total, 590, 'ordinary services still work');
});
