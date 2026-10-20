/*
 * Sharing a bill by hand: the message carries what is due on the bill and on the customer's account, the link is stable, and the WhatsApp
 * address opens a chat with the customer's number (country code added) or an empty one when the bill has no number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const { balanceShare, billShare, sendBalance } = await import('../src/modules/messaging/index.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

test('the share message says what is due, and the WhatsApp link goes to the customer', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@bs.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Spice Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Bolt','DISH',10000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const ravi = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi','98765 43210') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const bill = async (customerId, payment) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId, items: [{ product_id: product, quantity: 2 }], ...(payment ? { payment } : {}) }); await client.query('COMMIT'); return inv.invoice_id; } finally { client.release(); }
  };
  const first = await bill(ravi);                          // ₹200 on credit
  const second = await bill(ravi, { amount: 50 });         // ₹200, ₹50 paid: ₹150 due on this bill, ₹350 on the account

  const a = await billShare(pool, { businessId: biz, invoiceId: second });
  assert.match(a.text, /^Hi Ravi, thank you for visiting Spice Shop! Your bill .* is ₹200\./);
  assert.match(a.text, /₹150 is still due on this bill\./);
  assert.match(a.text, /Total due on your account: ₹350\./);
  assert.match(a.text, new RegExp(`View it here: ${a.link.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`));
  assert.equal(a.phone, '919876543210', 'ten digits, the country code added');
  assert.ok(a.wa_url.startsWith('https://wa.me/919876543210?text='));
  assert.equal(decodeURIComponent(a.wa_url.split('?text=')[1]), a.text);
  assert.equal((await billShare(pool, { businessId: biz, invoiceId: second })).link, a.link, 'the same link every time');

  const paid = await bill(null, { amount: 'FULL' });       // a walk-in, paid in full
  const w = await billShare(pool, { businessId: biz, invoiceId: paid });
  assert.ok(!/due/.test(w.text), 'nothing due, nothing said');
  assert.equal(w.phone, null);
  assert.ok(w.wa_url.startsWith('https://wa.me/?text='), 'no number: WhatsApp lets the person pick the chat');
  assert.equal((await billShare(pool, { businessId: biz, invoiceId: paid, phone: '90000 11111' })).phone, '919000011111', 'a number typed in wins');

  assert.equal((await billShare(pool, { businessId: biz, invoiceId: first + 99999 })).code, 404);

  // a payment reminder: what is due, the oldest unpaid bills first, to the customer's number; nothing due, nothing to remind
  const rem = await balanceShare(pool, { businessId: biz, customerId: ravi });
  assert.equal(rem.due, 350);
  assert.match(rem.text, /^Hi Ravi, a gentle reminder from Spice Shop: ₹350 is due on your account\. Unpaid: .* ₹200, .* ₹150\. Please pay when you can\. Thank you!$/);
  assert.equal(rem.phone, '919876543210');
  assert.ok(rem.wa_url.startsWith('https://wa.me/919876543210?text='));
  const clear = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Paid Up','9000012345') RETURNING customer_id`, [biz])).rows[0].customer_id;
  assert.equal((await balanceShare(pool, { businessId: biz, customerId: clear })).code, 409);
  assert.equal((await balanceShare(pool, { businessId: biz, customerId: 999999 })).code, 404);

  // the same reminder sent from the business's own number: refused when messaging is off, recorded (here as skipped: no provider in tests) when on
  assert.equal((await sendBalance(pool, { businessId: biz, customerId: ravi })).skipped, 'OFF');
  await pool.query(`UPDATE businesses SET messaging_settings = '{"channel":"WHATSAPP"}' WHERE business_id = $1`, [biz]);
  const sent = await sendBalance(pool, { businessId: biz, customerId: ravi, createdBy: owner });
  assert.equal(sent.status, 'SKIPPED');
  assert.equal(sent.kind, 'BALANCE_DUE');
  assert.equal(sent.body, rem.text, 'the message is word for word the one the shop would send by hand');
  assert.equal((await sendBalance(pool, { businessId: biz, customerId: clear })).code, 409);
  assert.equal((await sendBalance(pool, { businessId: biz, customerId: 999999 })).code, 404);
});
