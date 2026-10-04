/*
 * Wholesale buying and money: purchase orders in cartons, approval, goods receipt (damaged, partial, batches),
 * back-orders filled on arrival, receipts allocated across invoices, advances, reversals, refunds, ageing, and
 * returns both ways (credit notes and debit notes).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addCustomer, addProduct, addSupplier, dayFromNow, invoiceRow, makeInvoice, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const purchasing = (await import('../src/controllers/wholesalePurchasing.controller.js')).default;
const money = (await import('../src/controllers/wholesaleMoney.controller.js')).default;
const returns = (await import('../src/controllers/wholesaleReturns.controller.js')).default;
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const inv = (await import('../src/controllers/wholesaleInventory.controller.js')).default;
const { customerBalances, supplierBalances, receivableAgeing, payableAgeing } = await import('../src/modules/wholesale/ledger.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const sumInvoiceBalances = async (customerId) => Number((await pool.query(`SELECT COALESCE(SUM(balance_due_paise), 0) AS s FROM invoices WHERE customer_id = $1 AND status = 'ISSUED'`, [customerId])).rows[0].s);
const outstanding = async (w, customerId) => (await customerBalances(pool, { businessId: w.businessId, customerIds: [customerId] })).get(customerId).outstanding;

t('purchase order in cartons: approval, partial goods receipt with damage, payable only for what was accepted', async () => {
  const w = await makeWholesaler(pool, 'p1');
  const sup = await addSupplier(pool, w);
  const p = await addProduct(pool, w, { name: 'Biscuit', price: 10, cost: 2, tax: 18, units: [{ name: 'carton', factor: 288 }] });
  const po = await w.call(purchasing.createPO, { body: { supplier_id: sup, items: [{ product_id: p, unit_name: 'carton', quantity: 5, unit_cost: 600 }], payment_terms_days: 15 } });
  assert.equal(po.code, 201, JSON.stringify(po.body));
  assert.equal(po.body.data.status, 'DRAFT');
  assert.equal(po.body.data.total, 3540);                         // 5 × 600 + 18%
  const id = po.body.data.po_id;
  const itemId = po.body.data.items[0].item_id;
  // a purchase officer cannot sign it off, the owner can
  assert.equal((await w.call(purchasing.createGRN, { body: { po_id: id, items: [{ po_item_id: itemId, received: 1 }] } }, w.tenantFor('WAREHOUSE_MANAGER'))).code, 409);   // not approved
  assert.equal((await w.call(purchasing.approvePO, { params: { id } })).body.data.status, 'ORDERED');

  const g1 = await w.call(purchasing.createGRN, { body: { po_id: id, supplier_invoice_no: 'INV-77', supplier_invoice_date: dayFromNow(-1), items: [{ po_item_id: itemId, received: 3, damaged: 1 }] } });
  assert.equal(g1.code, 201, JSON.stringify(g1.body));
  assert.equal(g1.body.data.order_status, 'PARTIAL');
  assert.equal(g1.body.data.items[0].accepted, 2);
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 576, reserved: 0 });          // 2 accepted cartons
  assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(qty),0) AS q FROM wholesale_damaged_log WHERE product_id = $1`, [p])).rows[0].q), 288);
  const mid = (await w.call(purchasing.getPO, { params: { id } })).body.data;
  assert.equal(mid.total, 1416);                                   // 2 × 600 + 18% — damaged cartons are not billed
  assert.equal(mid.items[0].outstanding, 3);
  assert.equal(String(mid.due_date).slice(0, 10), dayFromNow(14));   // invoice date − 1 + 15 days
  assert.equal((await pool.query(`SELECT purchase_price_paise FROM products WHERE product_id = $1`, [p])).rows[0].purchase_price_paise, '208');   // ₹600 / 288, per piece

  // the same supplier invoice cannot be booked twice; more than is due is refused
  assert.equal((await w.call(purchasing.createGRN, { body: { supplier_id: sup, supplier_invoice_no: 'inv-77', items: [{ product_id: p, unit_name: 'carton', received: 1, unit_cost: 600 }] } })).code, 409);
  assert.equal((await w.call(purchasing.createGRN, { body: { po_id: id, items: [{ po_item_id: itemId, received: 4 }] } })).code, 409);

  const g2 = await w.call(purchasing.createGRN, { body: { po_id: id, items: [{ po_item_id: itemId, received: 3 }], payment: { amount: 1000, method: 'BANK_TRANSFER', reference_number: 'NEFT1' } } });
  assert.equal(g2.body.data.order_status, 'RECEIVED');
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 1440, reserved: 0 });
  const done = (await w.call(purchasing.getPO, { params: { id } })).body.data;
  assert.equal(done.total, 3540); assert.equal(done.paid, 1000); assert.equal(done.balance, 2540);
  const bal = (await supplierBalances(pool, { businessId: w.businessId, supplierIds: [sup] })).get(sup);
  assert.equal(bal.outstanding, 254000);                           // what we owe the supplier
  assert.equal((await payableAgeing(pool, { businessId: w.businessId, supplierId: sup }))[0].balance_due_paise, '254000');
});

t('goods that arrive go straight to the customers waiting on a back-order, oldest first', async () => {
  const w = await makeWholesaler(pool, 'p2');
  const sup = await addSupplier(pool, w);
  const p = await addProduct(pool, w, { name: 'Oil', price: 100, tax: 0, stock: 10 });
  const c = await addCustomer(pool, w, {});
  const o1 = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 25 }] } })).body.data;
  const o2 = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 25 }] } })).body.data;
  await w.call(orders.confirm, { params: { id: o1.order_id } }); await w.call(orders.confirm, { params: { id: o2.order_id } });
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 10, reserved: 10 });
  const g = await w.call(purchasing.createGRN, { body: { supplier_id: sup, items: [{ product_id: p, received: 30, unit_cost: 50 }] } });
  assert.equal(g.code, 201, JSON.stringify(g.body));
  assert.deepEqual(g.body.data.back_orders_filled.map((x) => [x.order_number, x.reserved]), [[o1.order_number, 15], [o2.order_number, 15]]);
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 40, reserved: 40 });
  assert.equal(g.body.data.order_status, 'RECEIVED');                       // a direct purchase
});

t('a batch-tracked product needs its batch and expiry on receipt, and an expired batch is refused', async () => {
  const w = await makeWholesaler(pool, 'p3');
  const sup = await addSupplier(pool, w);
  const p = await addProduct(pool, w, { name: 'Milk', price: 50, tax: 0, expiry: true });
  const grn = (items) => w.call(purchasing.createGRN, { body: { supplier_id: sup, items } });
  assert.equal((await grn([{ product_id: p, received: 10, unit_cost: 30 }])).code, 400);
  assert.equal((await grn([{ product_id: p, received: 10, unit_cost: 30, batch_no: 'M1' }])).code, 400);
  assert.equal((await grn([{ product_id: p, received: 10, unit_cost: 30, batch_no: 'M1', expiry_date: dayFromNow(-2) }])).code, 400);
  const ok = await grn([{ product_id: p, received: 10, unit_cost: 30, batch_no: 'M1', expiry_date: dayFromNow(30) }]);
  assert.equal(ok.code, 201, JSON.stringify(ok.body));
  const stock = await w.call(inv.productStock, { params: { id: p } });
  assert.deepEqual(stock.body.data.batches.map((b) => [b.batch_no, b.qty_on_hand]), [['M1', 10]]);
});

t('a receipt settles several invoices oldest first; the rest is an advance that can be allocated later; reversing restores the balances', async () => {
  const w = await makeWholesaler(pool, 'm1');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, tax: 0, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'Sharma', terms: 30 });
  const a = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 10 }] });     // ₹1,000
  const b = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 20 }] });     // ₹2,000
  assert.equal(await outstanding(w, c), 300000);

  const r1 = await w.call(money.create, { body: { customer_id: c, amount: 1500, method: 'cheque', reference: '123456', bank: 'HDFC' } });
  assert.equal(r1.code, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.data.allocations.length, 2);
  assert.deepEqual(r1.body.data.allocations.map((x) => x.amount), [1000, 500]);               // oldest invoice in full, then part of the next
  assert.equal((await invoiceRow(pool, a.invoiceId)).payment_status, 'PAID');
  assert.equal((await invoiceRow(pool, b.invoiceId)).payment_status, 'PARTIAL');
  assert.equal(await outstanding(w, c), 150000);
  assert.equal(await outstanding(w, c), await sumInvoiceBalances(c));                       // the ledger and the invoices agree

  const r2 = await w.call(money.create, { body: { customer_id: c, amount: 2000, method: 'upi', reference: 'U1' } });   // ₹1,500 due → ₹500 advance
  assert.equal(r2.body.data.advance, 500);
  assert.equal(await outstanding(w, c), -50000);
  assert.equal((await invoiceRow(pool, b.invoiceId)).payment_status, 'PAID');
  assert.equal((await w.call(money.refund, { body: { customer_id: c, amount: 900, method: 'BANK_TRANSFER' } })).code, 409);     // only ₹500 to pay back
  const refunded = await w.call(money.refund, { body: { customer_id: c, amount: 500, method: 'BANK_TRANSFER', reference: 'R1' } });
  assert.equal(refunded.code, 201, JSON.stringify(refunded.body));
  assert.equal(await outstanding(w, c), 0);

  // the cheque bounces
  const bounced = await w.call(money.reverse, { params: { id: r1.body.data.receipt_id }, body: { reason: 'Cheque bounced' } });
  assert.equal(bounced.body.data.status, 'REVERSED');
  assert.equal((await invoiceRow(pool, a.invoiceId)).payment_status, 'UNPAID');
  assert.equal(await outstanding(w, c), await sumInvoiceBalances(c) - 0);
  assert.equal((await w.call(money.reverse, { params: { id: r1.body.data.receipt_id }, body: { reason: 'again' } })).code, 409);
  const ledger = (await w.call(parties.customerLedger, { params: { id: c } })).body.data;
  assert.equal(ledger.closing, ledger.total_closing);
  assert.ok(ledger.lines.some((l) => l.type === 'REVERSAL'));
});

t('an advance paid before any invoice is applied to the next invoice; allocations cannot exceed the receipt or the balance', async () => {
  const w = await makeWholesaler(pool, 'm2');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, tax: 0, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'Early', terms: 0 });
  const adv = await w.call(money.create, { body: { customer_id: c, amount: 5000, method: 'cash' } });
  assert.equal(adv.body.data.advance, 5000);
  const i1 = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 30 }] });          // ₹3,000
  const later = await w.call(money.allocateLater, { params: { id: adv.body.data.receipt_id }, body: {} });
  assert.equal(later.body.data.allocated, 3000);
  assert.equal(later.body.data.advance, 2000);
  assert.equal((await invoiceRow(pool, i1.invoiceId)).payment_status, 'PAID');
  assert.equal(await outstanding(w, c), -200000);
  const i2 = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 10 }] });
  const tooMuch = await w.call(money.allocateLater, { params: { id: adv.body.data.receipt_id }, body: { allocations: [{ invoice_id: i2.invoiceId, amount: 3000 }] } });
  assert.equal(tooMuch.code, 400);                                                                      // more than the ₹2,000 advance left
  const ok = await w.call(money.allocateLater, { params: { id: adv.body.data.receipt_id }, body: { allocations: [{ invoice_id: i2.invoiceId, amount: 1000 }] } });
  assert.equal(ok.code, 200);
  assert.equal((await w.call(money.create, { body: { customer_id: c, amount: 100, method: 'cheque' } })).code, 400);     // cheque number needed
});

t('ageing buckets follow each invoice’s due date; the credit position includes what is overdue', async () => {
  const w = await makeWholesaler(pool, 'm3');
  const p = await addProduct(pool, w, { name: 'X', price: 100, tax: 0, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'Slow', terms: 30, limit: 100000 });
  const ids = [];
  for (const q of [1, 2, 3, 4, 5]) ids.push((await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: q }] })).invoiceId);
  // due: in the future, 10 days late, 45, 75, 120
  for (const [i, late] of [-5, 10, 45, 75, 120].entries()) await pool.query(`UPDATE wholesale_invoice_meta SET due_date = CURRENT_DATE - $2::int WHERE invoice_id = $1`, [ids[i], late]);
  const rows = await receivableAgeing(pool, { businessId: w.businessId, customerId: c });
  assert.deepEqual(rows.map((r) => r.bucket), ['d90_plus', 'd61_90', 'd31_60', 'd1_30', 'current']);   // oldest due first
  const bal = (await customerBalances(pool, { businessId: w.businessId, customerIds: [c] })).get(c);
  assert.equal(bal.overdue, 200 * 100 + 300 * 100 + 400 * 100 + 500 * 100);
  const ageing = (await w.call(parties.customerAgeing, { params: { id: c } })).body.data;
  assert.equal(ageing.buckets.d90_plus, 500);
});

t('sales return: credit note, goods back on the shelf in the same batch, damaged goods held aside; the ledger agrees', async () => {
  const w = await makeWholesaler(pool, 'r1');
  const p = await addProduct(pool, w, { name: 'Milk', price: 10, tax: 18, expiry: true, units: [{ name: 'carton', factor: 24 }] });
  await addBatch(pool, w, p, { batchNo: 'B1', qty: 480, expiry: dayFromNow(60) });
  const c = await addCustomer(pool, w, { name: 'Dealer', terms: 30 });
  const sale = await makeInvoice(w, { customer: c, lines: [{ product_id: p, unit_name: 'carton', quantity: 10 }] });      // 240 pcs
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 240);
  const opts = (await w.call(returns.returnableLines, { params: { id: sale.invoiceId } })).body.data;
  assert.equal(opts.items[0].returnable, 10);
  assert.equal(opts.items[0].batches[0].batch_no, 'B1');

  const before = await outstanding(w, c);
  const r = await w.call(returns.salesReturn, { body: { invoice_id: sale.invoiceId, reason: 'DAMAGED', items: [{ invoice_item_id: opts.items[0].item_id, quantity: 2, disposition: 'RESTOCK' }] } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 288);                                              // 2 cartons = 48 pcs back
  assert.equal(Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE product_id = $1`, [p])).rows[0].qty_on_hand), 288);
  assert.equal(r.body.data.cn_total, 2 * 240 * 1.18);                                                        // 2 cartons × ₹240 + 18%
  assert.equal(await outstanding(w, c), before - Math.round(r.body.data.cn_total * 100));
  assert.equal(await outstanding(w, c), await sumInvoiceBalances(c));

  const d = await w.call(returns.salesReturn, { body: { invoice_id: sale.invoiceId, reason: 'DAMAGED', items: [{ invoice_item_id: opts.items[0].item_id, quantity: 1, disposition: 'DAMAGED' }] } });
  assert.equal(d.code, 201);
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 288);                                              // damaged goods are not on the shelf
  assert.equal((await w.call(inv.damaged, {})).body.data[0].qty, 24);
  const tooMany = await w.call(returns.salesReturn, { body: { invoice_id: sale.invoiceId, reason: 'OTHER', items: [{ invoice_item_id: opts.items[0].item_id, quantity: 8, disposition: 'RESTOCK' }] } });
  assert.equal(tooMany.code, 400);                                                                              // only 7 left to credit
  const list = (await w.call(returns.list, { query: { kind: 'SALE' } })).body.data;
  assert.equal(list.length, 2);
});

t('purchase return: debit note reduces what we owe and takes the cartons out of stock and batch', async () => {
  const w = await makeWholesaler(pool, 'r2');
  const sup = await addSupplier(pool, w);
  const p = await addProduct(pool, w, { name: 'Soap', price: 10, cost: 5, tax: 18, expiry: true, units: [{ name: 'carton', factor: 100 }] });
  const g = await w.call(purchasing.createGRN, { body: { supplier_id: sup, items: [{ product_id: p, unit_name: 'carton', received: 4, unit_cost: 500, batch_no: 'S1', expiry_date: dayFromNow(90) }] } });
  const poId = g.body.data.po_id;
  assert.equal((await supplierBalances(pool, { businessId: w.businessId, supplierIds: [sup] })).get(sup).outstanding, 4 * 500 * 118);
  const po = (await w.call(purchasing.getPO, { params: { id: poId } })).body.data;
  const ret = await w.call(returns.purchaseReturn, { body: { po_id: poId, reason: 'QUALITY', items: [{ po_item_id: po.items[0].item_id, quantity: 1 }] } });
  assert.equal(ret.code, 201, JSON.stringify(ret.body));
  assert.equal(ret.body.data.dn_total, 590);                                                                    // 1 carton ₹500 + 18%
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 300);                                              // 100 pcs went back
  assert.equal(Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE product_id = $1`, [p])).rows[0].qty_on_hand), 300);
  assert.equal((await supplierBalances(pool, { businessId: w.businessId, supplierIds: [sup] })).get(sup).outstanding, 4 * 500 * 118 - 59000);
  assert.equal((await w.call(returns.purchaseReturn, { body: { po_id: poId, reason: 'QUALITY', items: [{ po_item_id: po.items[0].item_id, quantity: 5 }] } })).code, 409);
});

t('tenancy: another wholesaler cannot see or touch receipts, returns, orders or goods receipts', async () => {
  const a = await makeWholesaler(pool, 'tn1');
  const b = await makeWholesaler(pool, 'tn2');
  const p = await addProduct(pool, a, { name: 'X', price: 100, tax: 0, stock: 100 });
  const c = await addCustomer(pool, a, { terms: 10 });
  const sup = await addSupplier(pool, a);
  const sale = await makeInvoice(a, { customer: c, lines: [{ product_id: p, quantity: 5 }] });
  const rc = (await a.call(money.create, { body: { customer_id: c, amount: 100, method: 'cash' } })).body.data;
  const g = (await a.call(purchasing.createGRN, { body: { supplier_id: sup, items: [{ product_id: p, received: 5, unit_cost: 10 }] } })).body.data;
  for (const [fn, extra] of [[money.get, { params: { id: rc.receipt_id } }], [money.reverse, { params: { id: rc.receipt_id }, body: { reason: 'xxx' } }], [purchasing.getGRN, { params: { id: g.grn_id } }],
    [purchasing.getPO, { params: { id: g.po_id } }], [returns.returnableLines, { params: { id: sale.invoiceId } }], [money.openInvoices, { params: { id: c } }]]) {
    assert.equal((await b.call(fn, extra)).code, 404, 'leak');
  }
  assert.equal((await b.call(returns.salesReturn, { body: { invoice_id: sale.invoiceId, reason: 'OTHER', items: [{ invoice_item_id: 1, quantity: 1 }] } })).code, 404);
  assert.equal((await b.call(money.create, { body: { customer_id: c, amount: 10, method: 'cash' } })).code, 400);
  assert.equal((await b.call(purchasing.createGRN, { body: { supplier_id: sup, items: [{ product_id: p, received: 1, unit_cost: 1 }] } })).code, 400);
  assert.equal((await b.call(money.list, {})).body.data.length, 0);
});
