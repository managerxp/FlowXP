/*
 * Rows stamped "today" carry the business's date, not the database's UTC date (0067). Pago Pago is UTC-11, so for part
 * of every day its date is the previous UTC day; Kiritimati is UTC+14, the next one. One of the two always differs from UTC.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
test.after(cleanup);

const dateOf = async (sql, params = []) => (await pool.query(sql, params)).rows[0].d;

test('payments and expenses default to the business date and keep an explicit one', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('u','u@bd.test','x') RETURNING user_id`)).rows[0].user_id;
  for (const tz of ['Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
    const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, timezone) VALUES ($1,$2,'RETAIL',$1) RETURNING business_id`, [tz, user])).rows[0].business_id;
    const local = await dateOf(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date::text AS d`, [tz]);
    const pay = await dateOf(`INSERT INTO payments (business_id, payment_method, amount_paise) VALUES ($1,'CASH',100) RETURNING payment_date::text AS d`, [biz]);
    const exp = await dateOf(`INSERT INTO expenses (business_id, category, amount_paise) VALUES ($1,'Rent',100) RETURNING expense_date::text AS d`, [biz]);
    assert.equal(pay, local, `${tz} payment`);
    assert.equal(exp, local, `${tz} expense`);
    assert.equal(await dateOf(`INSERT INTO payments (business_id, payment_method, amount_paise, payment_date) VALUES ($1,'CASH',100,'2020-02-29') RETURNING payment_date::text AS d`, [biz]), '2020-02-29', 'a back-dated entry is kept');
  }
});
