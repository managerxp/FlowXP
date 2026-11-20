/*
 * Earning on a Loyalty card by kind of sale (a salon: services, products, packages), and the member multiplier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

let biz; let cust; let p;
test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('ke','ke@rw.test','x') RETURNING user_id`)).rows[0];
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('ke',$1,'SALON') RETURNING business_id`, [user.user_id])).rows[0].business_id;
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz]);
  cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Asha','9876500301') RETURNING customer_id`, [biz])).rows[0].customer_id;
});

test('the by-kind rates are checked and stored on the card', () => {
  const f = engine.programmeFields({ name: 'Salon', kind: 'POINTS', earn_points: 1, per_amount_paise: 10000, earn_by_kind: { SERVICE: 200, PRODUCT: 0, NOPE: 5 } });
  assert.deepEqual(f.settings.earn_by_kind, { SERVICE: 200, PRODUCT: 0 });
  assert.equal(engine.programmeFields({ name: 'Salon', kind: 'POINTS', per_amount_paise: 10000 }).settings.earn_by_kind, null);
  assert.throws(() => engine.programmeFields({ name: 'Salon', kind: 'POINTS', per_amount_paise: 10000, earn_by_kind: { SERVICE: 5000 } }));
});

test('a bill earns by kind: services double, products never, gift cards never; the member multiplier on top', { skip }, async () => {
  p = (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, settings)
    VALUES ($1,'Salon points','POINTS',1,10000,100,5000,$2) RETURNING *`, [biz, { auto_enrol: true, earn_by_kind: { SERVICE: 200, PRODUCT: 0 } }])).rows[0];
  const lines = [{ type: 'SERVICE', paise: 100000 }, { type: 'PRODUCT', paise: 50000 }, { type: 'PACKAGE', paise: 100000 }, { type: 'GIFT_CARD', paise: 0 }];
  const out = await withTransaction((c) => engine.creditBill(c, { businessId: biz, customerId: cust, invoiceId: 9001, amountPaise: 250000, lines }));
  assert.equal(out[0].points, 30);   // 1000 x 2 / 100 = 20, product 0, package 1000 / 100 = 10
  const again = await withTransaction((c) => engine.creditBill(c, { businessId: biz, customerId: cust, invoiceId: 9002, amountPaise: 100000, lines: [{ type: 'SERVICE', paise: 100000 }], multiplier: 2 }));
  assert.equal(again[0].points, 40);   // 20 x 2
  const plain = await withTransaction((c) => engine.creditBill(c, { businessId: biz, customerId: cust, invoiceId: 9003, amountPaise: 100000 }));
  assert.equal(plain[0].points, 10);   // no kinds sent: the whole bill at the normal rate
});
