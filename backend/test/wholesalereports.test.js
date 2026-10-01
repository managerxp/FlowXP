/*
 * Wholesale dashboard, reports, imports, bulk edits and background checks: every figure ties back to the documents.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addCustomer, addProduct, addSupplier, dayFromNow, makeInvoice, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const dashboard = (await import('../src/controllers/wholesaleDashboard.controller.js')).default;
const reports = (await import('../src/controllers/wholesaleReports.controller.js')).default;
const importer = (await import('../src/controllers/wholesaleImport.controller.js')).default;
const money = (await import('../src/controllers/wholesaleMoney.controller.js')).default;
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const returns = (await import('../src/controllers/wholesaleReturns.controller.js')).default;
const purchasing = (await import('../src/controllers/wholesalePurchasing.controller.js')).default;
const scans = await import('../src/modules/wholesale/scans.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const report = async (w, key, query = {}, tenant) => { const r = await w.call(reports.run, { params: { key }, query }, tenant); assert.equal(r.code, 200, `${key}: ${JSON.stringify(r.body)}`); return r.body.data; };

t('dashboard KPIs tie to invoices, receivables, stock and orders', async () => {
  const w = await makeWholesaler(pool, 'd1');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 18, stock: 100, min: 150 });
  const c = await addCustomer(pool, w, { name: 'Sharma', terms: 30, limit: 1000 });
  const sale = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 10 }], dispatch: { payment: { amount: 500, method: 'CASH' } } });   // ₹1,180
  assert.equal(sale.invoiceTotal, 1180);
  await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 1 }], submit: true } });     // a pending order
  const d = (await w.call(dashboard.dashboard, {})).body.data;
  assert.equal(d.sales.today.total, 1180);
  assert.equal(d.sales.month.total, 1180);
  assert.equal(d.money.receivable, 680);
  assert.equal(d.money.collected_today, 500);
  assert.equal(d.money.gross_profit_month, 400);                      // 10 × (100 − 60)
  assert.equal(d.money.credit_exceeded, 0);
  assert.equal(d.orders.pending, 1);
  assert.equal(d.inventory.stock_value, 90 * 60);
  assert.equal(d.inventory.alerts.low_stock, 1);                      // 90 on hand, reorder level 150
  assert.ok(d.alerts.some((a) => /running low/.test(a.text)));
  assert.equal(d.sales.trend.length, 30);
  assert.equal(d.sales.top_customers[0].name, 'Sharma');
  assert.equal(d.sales.top_products[0].name, 'Soap');
  // a return reduces sales and profit
  const opts = (await w.call(returns.returnableLines, { params: { id: sale.invoiceId } })).body.data;
  await w.call(returns.salesReturn, { body: { invoice_id: sale.invoiceId, reason: 'OTHER', items: [{ invoice_item_id: opts.items[0].item_id, quantity: 2 }] } });
  const after = (await w.call(dashboard.dashboard, {})).body.data;
  assert.equal(after.sales.month.total, 1180 - 236);
  assert.equal(after.money.gross_profit_month, 400 - 80);
});

t('the dashboard shows people only what they may see', async () => {
  const w = await makeWholesaler(pool, 'd2');
  const p = await addProduct(pool, w, { name: 'X', price: 100, stock: 50 });
  const c = await addCustomer(pool, w, {});
  await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 1 }] });
  const staff = (await w.call(dashboard.dashboard, {}, w.tenantFor('WAREHOUSE_STAFF'))).body.data;
  assert.equal(staff.money, undefined); assert.equal(staff.sales, undefined);
  assert.ok(staff.fulfilment);
  const exec = (await w.call(dashboard.dashboard, {}, w.tenantFor('SALES_EXECUTIVE'))).body.data;
  assert.equal(exec.money, undefined);
  assert.equal(exec.sales.month.total, 0);                           // not their customer's sale
  const accountant = (await w.call(dashboard.dashboard, {}, w.tenantFor('ACCOUNTANT'))).body.data;
  assert.ok(accountant.money.receivable > 0);
});

t('reports: sales, product margin, ageing, valuation and balances all tie out', async () => {
  const w = await makeWholesaler(pool, 'rp');
  const p1 = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 100, units: [{ name: 'carton', factor: 10 }] });
  const p2 = await addProduct(pool, w, { name: 'Oil', price: 200, cost: 150, tax: 0, stock: 50 });
  const c1 = await addCustomer(pool, w, { name: 'Alpha', terms: 10 });
  const c2 = await addCustomer(pool, w, { name: 'Beta', terms: 10 });
  const i1 = await makeInvoice(w, { customer: c1, lines: [{ product_id: p1, unit_name: 'carton', quantity: 2 }, { product_id: p2, quantity: 5 }] });   // 2000 + 1000
  await makeInvoice(w, { customer: c2, lines: [{ product_id: p2, quantity: 10 }] });                                                                  // 2000

  const sales = await report(w, 'sales_summary');
  assert.equal(sales.totals.total, 5000);
  assert.equal(sales.rows.length, 1);
  const byCust = await report(w, 'sales_by_customer');
  assert.deepEqual(byCust.rows.map((x) => [x.customer, x.net]), [['Alpha', 3000], ['Beta', 2000]]);
  const byProd = await report(w, 'sales_by_product');
  const soap = byProd.rows.find((x) => x.product === 'Soap');
  assert.equal(soap.units, 20); assert.equal(soap.revenue, 2000); assert.equal(soap.cost, 1200); assert.equal(soap.margin_pct, 40);
  assert.equal(byProd.totals.revenue, 5000);
  assert.equal(byProd.totals.revenue, sales.totals.taxable);
  const val = await report(w, 'stock_valuation');
  assert.equal(val.totals.value, 80 * 60 + 35 * 150);
  const ageing = await report(w, 'receivables_ageing');
  assert.equal(ageing.totals.total, 5000);
  assert.equal(ageing.totals.current, 5000);
  const credit = await report(w, 'customer_outstanding');
  assert.equal(credit.totals.outstanding, 5000);
  // pay one off: receivables and collections follow
  await w.call(money.create, { body: { customer_id: c2, amount: 2000, method: 'upi', reference: 'U9' } });
  assert.equal((await report(w, 'receivables_ageing')).totals.total, 3000);
  assert.equal((await report(w, 'collections')).totals.amount, 2000);
  assert.equal((await report(w, 'sales_by_salesperson')).totals.sales, 5000);
  assert.equal((await report(w, 'sales_by_warehouse')).totals.sales, 5000);
  assert.equal((await report(w, 'order_book')).rows.length, 2);                      // dispatched, not yet delivered
  // an unknown report and a bad period are refused
  assert.equal((await w.call(reports.run, { params: { key: 'nope' }, query: {} })).code, 404);
  assert.equal((await w.call(reports.run, { params: { key: 'sales_summary' }, query: { from: '2026-05-02', to: '2026-05-01' } })).code, 400);
  assert.ok(i1.invoiceId);
});

t('purchase, expiry and slow-moving reports', async () => {
  const w = await makeWholesaler(pool, 'rp2');
  const sup = await addSupplier(pool, w);
  const p = await addProduct(pool, w, { name: 'Milk', price: 50, cost: 30, tax: 0, expiry: true });
  await w.call(purchasing.createGRN, { body: { supplier_id: sup, items: [{ product_id: p, received: 40, unit_cost: 30, batch_no: 'M1', expiry_date: dayFromNow(20) }, { product_id: p, received: 10, unit_cost: 30, batch_no: 'M2', expiry_date: dayFromNow(300) }] } });
  const bySup = await report(w, 'purchase_by_supplier');
  assert.equal(bySup.totals.total, 1500);
  const byProd = await report(w, 'purchase_by_product');
  assert.equal(byProd.rows[0].units, 50); assert.equal(byProd.rows[0].avg_cost, 30);
  assert.equal((await report(w, 'grn_register')).rows.length, 1);
  const expiry = await report(w, 'expiry');
  assert.deepEqual(expiry.rows.map((x) => [x.batch, x.qty]), [['M1', 40]]);                // only the batch inside the 90-day window
  assert.equal((await report(w, 'supplier_outstanding')).totals.outstanding, 1500);
  const slow = await report(w, 'slow_moving');                                             // never sold: dead
  assert.equal(slow.rows[0].class, 'Dead');
  assert.equal((await report(w, 'payables_ageing')).totals.total, 1500);
});

t('product import: dry run reports row errors, apply is all-or-nothing, units and opening stock land', async () => {
  const w = await makeWholesaler(pool, 'im');
  const rows = [
    { Name: 'Biscuit 100g', SKU: 'BIS100', Unit: 'pcs', Category: 'Snacks', 'Tax Rate': '18', 'Purchase Price': '5', 'Wholesale Price': '8', MRP: '10', MOQ: '12', 'Unit 1 Name': 'carton', 'Unit 1 Factor': '144', 'Opening Stock': '1440' },
    { Name: 'Tea 250g', SKU: 'TEA250', Unit: 'pcs', Category: 'Snacks', 'Tax Rate': '5', 'Wholesale Price': '90', 'Expiry Tracking': 'yes', 'Opening Stock': '30', 'Batch No': 'T1', 'Expiry Date': dayFromNow(200) }
  ];
  const dry = await w.call(importer.importProducts, { body: { rows } });
  assert.equal(dry.body.data.applied, false); assert.equal(dry.body.data.to_create, 2);
  assert.equal((await pool.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1`, [w.businessId])).rows[0].n, '0');
  const bad = await w.call(importer.importProducts, { body: { apply: true, rows: [...rows, { Name: 'X', SKU: 'BIS100' }, { Name: '', SKU: 'Z' }, { Name: 'Oil', 'Tax Rate': 'abc' }] } });
  assert.equal(bad.code, 422);
  assert.deepEqual(bad.body.data.errors.map((e) => e.row), [4, 5, 6]);
  assert.equal((await pool.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1`, [w.businessId])).rows[0].n, '0');          // nothing written

  const done = await w.call(importer.importProducts, { body: { apply: true, rows } });
  assert.equal(done.code, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.created, 2); assert.equal(done.body.data.opening_stock_lines, 2);
  const biscuit = (await pool.query(`SELECT p.product_id, p.current_stock, d.moq, d.mrp_paise FROM products p JOIN wholesale_item_details d ON d.product_id = p.product_id WHERE p.sku = 'BIS100' AND p.business_id = $1`, [w.businessId])).rows[0];
  assert.equal(Number(biscuit.current_stock), 1440); assert.equal(Number(biscuit.moq), 12); assert.equal(Number(biscuit.mrp_paise), 1000);
  assert.equal(Number((await pool.query(`SELECT factor FROM wholesale_product_units WHERE product_id = $1`, [biscuit.product_id])).rows[0].factor), 144);
  assert.equal(Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE batch_no = 'T1' AND business_id = $1`, [w.businessId])).rows[0].qty_on_hand), 30);
  // re-importing without "update" is refused; with it, the product changes
  assert.equal((await w.call(importer.importProducts, { body: { apply: true, rows: [rows[0]] } })).code, 422);
  const up = await w.call(importer.importProducts, { body: { apply: true, mode: 'upsert', rows: [{ Name: 'Biscuit 100g', SKU: 'BIS100', 'Wholesale Price': '9' }] } });
  assert.equal(up.body.data.updated, 1);
  assert.equal((await pool.query(`SELECT selling_price_paise FROM products WHERE product_id = $1`, [biscuit.product_id])).rows[0].selling_price_paise, '900');
});

t('customer and supplier import, then bulk edits', async () => {
  const w = await makeWholesaler(pool, 'im2');
  const sp = (await w.call(parties.createSalesperson, { body: { name: 'Ravi' } })).body.data;
  const imp = await w.call(importer.importCustomers, { body: { apply: true, rows: [
    { Name: 'Mehta Stores', Phone: '9876543210', GSTIN: '36ABCDE1234F1Z5', Type: 'dealer', 'Credit Limit': '50000', 'Payment Terms Days': '45', Salesperson: 'Ravi', 'Opening Balance': '1,200' },
    { Name: 'Rao Traders', Phone: '9123456780' }
  ] } });
  assert.equal(imp.body.data.created, 2, JSON.stringify(imp.body));
  const mehta = (await w.call(parties.listCustomers, { query: { q: 'Mehta' } })).body.data[0];
  assert.equal(mehta.customer_type, 'DEALER'); assert.equal(mehta.credit_limit, 50000); assert.equal(mehta.salesperson, 'Ravi'); assert.equal(mehta.opening_balance, 1200);
  // the same GSTIN updates rather than duplicates
  const again = await w.call(importer.importCustomers, { body: { apply: true, rows: [{ Name: 'Mehta Stores Pvt', GSTIN: '36ABCDE1234F1Z5', 'Credit Limit': '75000' }] } });
  assert.equal(again.body.data.updated, 1);
  assert.equal((await w.call(parties.getCustomer, { params: { id: mehta.customer_id } })).body.data.credit_limit, 75000);
  assert.equal((await w.call(importer.importCustomers, { body: { apply: true, rows: [{ Name: 'X', GSTIN: 'bad' }] } })).code, 422);
  assert.equal((await w.call(importer.importSuppliers, { body: { apply: true, rows: [{ Name: 'Acme', 'Payment Terms Days': '15' }] } })).body.data.created, 1);

  const ids = (await w.call(parties.listCustomers, {})).body.data.map((x) => x.customer_id);
  const bulk = await w.call(importer.bulkCustomers, { body: { ids, action: 'SET_TERMS', value: 60 } });
  assert.equal(bulk.body.data.updated, 2);
  assert.equal((await w.call(parties.getCustomer, { params: { id: ids[0] } })).body.data.payment_terms_days, 60);
  await w.call(importer.bulkCustomers, { body: { ids: [ids[0]], action: 'ARCHIVE' } });
  assert.equal((await w.call(parties.listCustomers, {})).body.data.length, 1);

  const pa = await addProduct(pool, w, { name: 'A', price: 10 }); const pb = await addProduct(pool, w, { name: 'B', price: 10 });
  const upd = await w.call(importer.bulkProducts, { body: { ids: [pa, pb], action: 'SET_MOQ', value: 6 } });
  assert.equal(upd.body.data.updated, 2);
  assert.equal((await pool.query(`SELECT moq FROM wholesale_item_details WHERE product_id = $1`, [pa])).rows[0].moq, '6.000');
  // another business's ids are simply ignored
  const other = await makeWholesaler(pool, 'im3');
  assert.equal((await other.call(importer.bulkProducts, { body: { ids: [pa, pb], action: 'ARCHIVE' } })).body.data.updated, 0);
});

t('the worker scan raises stock and overdue notices once a day and sends reminders only when switched on', async () => {
  const w = await makeWholesaler(pool, 'sc');
  const p = await addProduct(pool, w, { name: 'X', price: 100, tax: 0, stock: 5, min: 10 });
  const c = await addCustomer(pool, w, { name: 'Late', terms: 10 });
  await pool.query(`UPDATE customers SET phone = '9876500123' WHERE customer_id = $1`, [c]);
  const sale = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 1 }] });
  await pool.query(`UPDATE wholesale_invoice_meta SET due_date = CURRENT_DATE - 5 WHERE invoice_id = $1`, [sale.invoiceId]);
  const first = await scans.runForBusiness(pool, w.businessId);
  assert.equal(first.stock, 1); assert.equal(first.overdue, 1);                               // the owner heard once
  const second = await scans.runForBusiness(pool, w.businessId);
  assert.equal(second.stock, 0); assert.equal(second.overdue, 0);                             // same day: nothing more
  const note = (await pool.query(`SELECT title FROM notifications WHERE business_id = $1 AND type = 'wholesale_overdue'`, [w.businessId])).rows[0];
  assert.match(note.title, /1 customer overdue/);
  assert.equal(first.reminders, undefined);                                                   // opt-in: not switched on

  await w.call(parties.updateSettings, { body: { notifications: { payment_overdue: true } } });
  await pool.query(`UPDATE businesses SET messaging_settings = '{"channel":"WHATSAPP"}'::jsonb WHERE business_id = $1`, [w.businessId]);
  const third = await scans.runForBusiness(pool, w.businessId);
  assert.equal(third.reminders, 1);
  assert.equal((await scans.runForBusiness(pool, w.businessId)).reminders, 0);                // once a week per invoice
  const msg = (await pool.query(`SELECT kind, body FROM messages WHERE business_id = $1`, [w.businessId])).rows[0];
  assert.equal(msg.kind, 'WS_PAYMENT_OVERDUE'); assert.match(msg.body, /5 days overdue/);
});
