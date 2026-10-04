/*
 * Wholesale catalogue: units of measure, the price a customer pays (customer price → list → quantity break →
 * promotion → tier), customers and suppliers, ledgers, and that one wholesaler can never see another's records.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, addSupplier, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const catalog = (await import('../src/controllers/wholesaleCatalog.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const { priceOne } = await import('../src/modules/wholesale/pricing.js');
const { customerBalances } = await import('../src/modules/wholesale/ledger.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

t('a product with carton = 24 boxes = 288 pieces converts both ways', async () => {
  const w = await makeWholesaler(pool, 'units');
  const res = await w.call(catalog.create, { body: { name: 'Biscuit', unit: 'pcs', wholesale_price: 10, units: [{ unit_name: 'box', factor: 12 }, { unit_name: 'carton', factor: 288 }] } });
  assert.equal(res.code, 201);
  assert.deepEqual(res.body.data.units.map((u) => [u.unit_name, u.factor]), [['box', 12], ['carton', 288]]);
  const bad = await w.call(catalog.update, { params: { id: res.body.data.product_id }, body: { units: [{ unit_name: 'pcs', factor: 2 }] } });
  assert.equal(bad.code, 400);   // the base unit cannot be re-declared
});

t('price precedence: customer price beats list beats quantity break beats tier', async () => {
  const w = await makeWholesaler(pool, 'price');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, units: [{ name: 'carton', factor: 10 }] });
  await pool.query(`UPDATE wholesale_item_details SET distributor_price_paise = 9000, retailer_price_paise = 11000 WHERE product_id = $1`, [p]);
  const retailer = await addCustomer(pool, w, { name: 'R', type: 'RETAILER' });
  const dist = await addCustomer(pool, w, { name: 'D', type: 'DISTRIBUTOR' });
  const q = async (customerId, quantity, unit) => (await priceOne(pool, { businessId: w.businessId, customerId, line: { product_id: p, quantity, unit_name: unit } }));

  assert.equal((await q(retailer, 1)).price_paise, 11000);      // retailer tier
  assert.equal((await q(dist, 1)).price_paise, 9000);           // distributor tier
  assert.equal((await q(retailer, 1, 'carton')).price_paise, 110000);   // a carton is 10 × the base price

  const list = (await w.call(catalog.createList, { body: { name: 'Gold', kind: 'STANDARD' } })).body.data;
  await w.call(catalog.setItems, { params: { id: list.list_id }, body: { items: [
    { product_id: p, min_qty: 1, price: 95 }, { product_id: p, min_qty: 50, price: 90 }
  ] } });
  await pool.query(`UPDATE wholesale_customer_profiles SET price_list_id = $2 WHERE customer_id = $1`, [retailer, list.list_id]);
  assert.equal((await q(retailer, 10)).price_paise, 9500);      // list price replaces the tier
  assert.equal((await q(retailer, 60)).price_paise, 9000);      // quantity break
  assert.equal((await q(retailer, 60)).source, 'LIST');

  await w.call(catalog.setCustomerPrices, { params: { id: retailer }, body: { items: [{ product_id: p, min_qty: 1, price: 80 }] } });
  const special = await q(retailer, 60);
  assert.equal(special.price_paise, 8000);
  assert.equal(special.source, 'CUSTOMER');

  // the quote endpoint agrees with the engine
  const quoted = await w.call(catalog.quote, { body: { customer_id: retailer, lines: [{ product_id: p, quantity: 60 }] } });
  assert.equal(quoted.body.data[0].price, 80);
});

t('a running promotion wins only when it is lower; an expired one is ignored', async () => {
  const w = await makeWholesaler(pool, 'promo');
  const p = await addProduct(pool, w, { name: 'Tea', price: 200 });
  const c = await addCustomer(pool, w, { name: 'C', type: 'DEALER' });
  const promo = (await w.call(catalog.createList, { body: { name: 'Festival', kind: 'PROMOTION' } })).body.data;
  await w.call(catalog.setItems, { params: { id: promo.list_id }, body: { items: [{ product_id: p, discount_pct: 10 }] } });
  assert.equal((await priceOne(pool, { businessId: w.businessId, customerId: c, line: { product_id: p, quantity: 1 } })).price_paise, 18000);
  await pool.query(`UPDATE wholesale_price_lists SET starts_on = '2020-01-01', ends_on = '2020-02-01' WHERE list_id = $1`, [promo.list_id]);
  assert.equal((await priceOne(pool, { businessId: w.businessId, customerId: c, line: { product_id: p, quantity: 1 } })).price_paise, 20000);
});

t('MOQ is reported and a standing customer discount applies to list prices only', async () => {
  const w = await makeWholesaler(pool, 'moq');
  const p = await addProduct(pool, w, { name: 'Rice', price: 50, moq: 10 });
  const c = await addCustomer(pool, w, { name: 'C', discount: 10 });
  const one = await priceOne(pool, { businessId: w.businessId, customerId: c, line: { product_id: p, quantity: 5 } });
  assert.equal(one.below_moq, true);
  assert.equal(one.price_paise, 4500);
});

t('customers: create with GSTIN/PAN/terms, duplicate phone is refused, balances start from the opening balance', async () => {
  const w = await makeWholesaler(pool, 'cust');
  const sp = (await w.call(parties.createSalesperson, { body: { name: 'Ravi', commission_pct: 2 } })).body.data;
  const made = await w.call(parties.createCustomer, { body: { name: 'Mehta Stores', phone: '9876543210', gstin: '36ABCDE1234F1Z5', pan: 'ABCDE1234F', customer_type: 'dealer', credit_limit: 50000, payment_terms_days: 45, salesperson_id: sp.salesperson_id, opening_balance: 1200 } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.customer_type, 'DEALER');
  assert.equal(made.body.data.credit_limit, 50000);
  const dup = await w.call(parties.createCustomer, { body: { name: 'Other', phone: '98765 43210' } });
  assert.equal(dup.code, 409);
  const badGst = await w.call(parties.createCustomer, { body: { name: 'X', gstin: '123' } });
  assert.equal(badGst.code, 400);
  const bal = (await customerBalances(pool, { businessId: w.businessId, customerIds: [made.body.data.customer_id] })).get(made.body.data.customer_id);
  assert.equal(bal.outstanding, 120000);
  const ledger = await w.call(parties.customerLedger, { params: { id: made.body.data.customer_id } });
  assert.equal(ledger.body.data.closing, 1200);
  const adj = await w.call(parties.adjustLedger, { body: { party_type: 'CUSTOMER', party_id: made.body.data.customer_id, amount: -200, reason: 'Write-off' } });
  assert.equal(adj.code, 201);
  assert.equal((await w.call(parties.customerLedger, { params: { id: made.body.data.customer_id } })).body.data.closing, 1000);
});

t('suppliers and settings round-trip', async () => {
  const w = await makeWholesaler(pool, 'supp');
  const s = await w.call(parties.createSupplier, { body: { name: 'Acme Mills', gstin: '27AAPFU0939F1ZV', payment_terms_days: 30, opening_balance: 500 } });
  assert.equal(s.code, 201, JSON.stringify(s.body));
  const led = await w.call(parties.supplierLedger, { params: { id: s.body.data.supplier_id } });
  assert.equal(led.body.data.closing, 500);
  const set = await w.call(parties.updateSettings, { body: { credit_policy: 'block', default_payment_terms_days: 15, expiry_alert_days: [15, 45], order_approval_over: 100000 } });
  assert.equal(set.code, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.credit_policy, 'BLOCK');
  assert.deepEqual(set.body.data.expiry_alert_days, [15, 45]);
  assert.equal(set.body.data.order_approval_over, 100000);
});

t('tenancy: another wholesaler cannot read or change these records', async () => {
  const a = await makeWholesaler(pool, 'ta');
  const b = await makeWholesaler(pool, 'tb');
  const cust = await addCustomer(pool, a, { name: 'Secret' });
  const sup = await addSupplier(pool, a);
  const prod = await addProduct(pool, a, { name: 'Hidden' });
  for (const [fn, extra] of [[parties.getCustomer, { params: { id: cust } }], [parties.customerLedger, { params: { id: cust } }], [parties.updateCustomer, { params: { id: cust }, body: { name: 'Hacked' } }],
    [parties.getSupplier, { params: { id: sup } }], [catalog.get, { params: { id: prod } }], [catalog.update, { params: { id: prod }, body: { name: 'Hacked' } }]]) {
    const res = await b.call(fn, extra);
    assert.equal(res.code, 404, `${fn.name || 'handler'} leaked`);
  }
  const mine = await b.call(parties.listCustomers, {});
  assert.equal(mine.body.data.length, 0);
  const cross = await b.call(catalog.quote, { body: { customer_id: cust, lines: [{ product_id: prod, quantity: 1 }] } });
  assert.equal(cross.code, 400);
});
