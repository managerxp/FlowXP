/*
 * Automatic reminders for customers who owe money: only when switched on, only bills 7+ days old, at most once a week per customer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { runDueReminders } = await import('../src/modules/messaging/dueReminders.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

test('reminders go to customers with old unpaid bills, once a week, only when on', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('P','o@dr.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Bolt','DISH',10000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const customer = async (name, phone) => (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [biz, name, phone])).rows[0].customer_id;
  const old = await customer('Old debt', '9876543210'); const fresh = await customer('Fresh debt', '9876543211');
  const bill = async (customerId, ageDays) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId, items: [{ product_id: product, quantity: 1 }] });
      await client.query(`UPDATE invoices SET invoice_date = CURRENT_DATE - $2::int WHERE invoice_id = $1`, [inv.invoice_id, ageDays]);
      await client.query('COMMIT');
    } finally { client.release(); }
  };
  await bill(old, 10); await bill(fresh, 1);

  assert.equal(await runDueReminders(pool), 0, 'messaging is off');
  await pool.query(`UPDATE businesses SET messaging_settings = '{"channel":"WHATSAPP"}' WHERE business_id = $1`, [biz]);
  assert.equal(await runDueReminders(pool), 0, 'the reminder switch is off');
  await pool.query(`UPDATE businesses SET messaging_settings = '{"channel":"WHATSAPP","due_reminders":true}' WHERE business_id = $1`, [biz]);
  assert.equal(await runDueReminders(pool), 1, 'only the old debt');
  assert.equal(await runDueReminders(pool), 0, 'not again within a week');
  const logged = (await pool.query(`SELECT customer_id FROM messages WHERE business_id = $1 AND kind = 'BALANCE_DUE'`, [biz])).rows;
  assert.deepEqual(logged.map((r) => r.customer_id), [old]);
});
