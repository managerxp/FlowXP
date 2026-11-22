/* The supplement desk: a sale to a member or walk-in, paying from the wallet, stock coming off, and the stock alerts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const members = (await import('../src/controllers/gymMembers.controller.js')).default;
const shop = (await import('../src/controllers/gymShop.controller.js')).default;
const walletApi = (await import('../src/controllers/gymWallet.controller.js')).default;

test.after(cleanup);

let A; let member; let whey; let shaker;
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };
const stock = async (id) => Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [id])).rows[0].current_stock);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'shop');
  member = okBody(await A.call(members.create, { body: { name: 'Kiran', phone: '9876500971' } }), 201).member_id;
  const add = async (name, price, qty, min) => (await pool.query(
    `INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock) VALUES ($1,$2,'DISH',$3,$4,0,TRUE,$5,$6) RETURNING product_id`,
    [A.businessId, name, price, Math.round(price / 2), qty, min])).rows[0].product_id;
  whey = await add('Whey 1kg', 200000, 5, 2);
  shaker = await add('Shaker', 30000, 3, 3);
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,5),($1,$3,3) ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`, [A.branchId, whey, shaker]);
});

test('products can be searched with their price and shelf stock', { skip }, async () => {
  const rows = okBody(await A.call(shop.products, { query: { q: 'whey' } }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].selling_price_paise, 200000);
});

test('a walk-in pays in full and stock comes off; a part-payment without a member is refused', { skip }, async () => {
  const before = await stock(shaker);
  const sold = okBody(await A.call(shop.sell, { body: { items: [{ product_id: shaker, quantity: 1 }], method: 'UPI', amount: 'FULL' } }), 201);
  assert.equal(sold.still_owed, 0);
  assert.equal(await stock(shaker), before - 1);
  const part = await A.call(shop.sell, { body: { items: [{ product_id: shaker, quantity: 1 }], method: 'CASH', amount: 100 } });
  assert.equal(part.code, 400);
  assert.equal(await stock(shaker), before - 1, 'a refused sale leaves the shelf alone');
});

test('a member can pay part from the wallet, part in cash, and owe the rest', { skip }, async () => {
  okBody(await A.call(walletApi.deposit, { params: { id: member }, body: { amount: 500, method: 'CASH' } }), 201);
  const sold = okBody(await A.call(shop.sell, { body: { member_id: member, items: [{ product_id: whey, quantity: 1 }], method: 'CASH', amount: 600, use_wallet: true } }), 201);
  assert.equal(sold.wallet_paid, 500);
  assert.equal(sold.still_owed, 900, 'Rs 2000 bill: 600 cash + 500 wallet leaves 900');
  assert.equal(okBody(await A.call(walletApi.get, { params: { id: member } })).balance_paise, 0);
  const nothing = await A.call(shop.sell, { body: { member_id: member, items: [{ product_id: whey, quantity: 50 }], method: 'CASH', amount: 'FULL' } });
  assert.equal(nothing.code, 409, 'not enough stock is refused');
});

test('wallet first, then the chosen method pays the rest, so nothing is owed', { skip }, async () => {
  okBody(await A.call(walletApi.deposit, { params: { id: member }, body: { amount: 500, method: 'CASH' } }), 201);
  const sold = okBody(await A.call(shop.sell, { body: { member_id: member, items: [{ product_id: whey, quantity: 1 }], method: 'UPI', amount: 'FULL', use_wallet: true } }), 201);
  assert.equal(sold.wallet_paid, 500);
  assert.equal(sold.still_owed, 0);
  assert.equal(okBody(await A.call(walletApi.get, { params: { id: member } })).balance_paise, 0);
});

test('stock alerts list products at or under their minimum', { skip }, async () => {
  const a = okBody(await A.call(shop.alerts, { query: {} }));
  assert.ok(a.low_stock.some((r) => r.product_id === shaker), 'the shaker (min 3) is low');
  assert.ok(Array.isArray(a.batches));
});
