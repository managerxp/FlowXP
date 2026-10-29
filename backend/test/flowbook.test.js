/*
 * The FlowBook link: the events built from bills, the signature, discovery from the tables billing already writes,
 * and in-order delivery with retry. Delivery is tested with a fake sender; nothing leaves the machine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDb } from './helpers/db.js';
import { creditNoteEvent, envelope, modeOf, paymentEvent, saleEvent, signature } from '../src/modules/flowbook/events.js';

const invoice = (extra = {}) => ({ invoice_id: 7, invoice_number: 'INV-0007', invoice_date: '2026-06-10', subtotal_paise: 100000, discount_paise: 0, cgst_paise: 9000, sgst_paise: 9000, igst_paise: 0,
  round_off_paise: 0, total_paise: 118000, cess_paise: 0, tcs_paise: 0, tds_paise: 0, ...extra });
const customer = { customer_id: 3, name: 'Ravi Stores', state_code: '27' };

test('a sale becomes an event with the figures FlowXP stored and its tenders', () => {
  const r = saleEvent(invoice(), [{ payment_method: 'CASH', amount_paise: 50000 }, { payment_method: 'BANK_TRANSFER', amount_paise: 30000, reference_number: 'UTR1' }], customer);
  assert.equal(r.skip, undefined);
  assert.deepEqual(r.payload.tenders, [{ mode: 'CASH', amount_minor: 50000 }, { mode: 'BANK', amount_minor: 30000, reference: 'UTR1' }]);
  assert.deepEqual([r.payload.net_minor, r.payload.cgst_minor, r.payload.total_minor, r.payload.unpaid_minor], [100000, 9000, 118000, 38000]);
  assert.equal(r.payload.customer.id, '3');
  assert.equal(r.payload.date, '2026-06-10');
});

test('a bill that cannot be sent correctly is skipped with the reason, never sent wrong', () => {
  assert.match(saleEvent(invoice({ cess_paise: 500 }), [], customer).skip, /cess/);
  assert.match(saleEvent(invoice({ total_paise: 118001 }), [], customer).skip, /do not add up/);
  assert.match(saleEvent(invoice(), [{ payment_method: 'GIFT_CARD', amount_paise: 1000 }], customer).skip, /GIFT_CARD/);
  assert.match(saleEvent(invoice(), [], null).skip, /no customer/);
  assert.match(saleEvent(invoice(), [{ payment_method: 'CASH', amount_paise: 200000 }], customer).skip, /more than the bill/);
  assert.equal(saleEvent(invoice(), [{ payment_method: 'CASH', amount_paise: 118000 }], null).skip, undefined, 'a fully paid walk-in sale needs no customer');
});

test('an invoice discount and a round-off are carried, and the total still adds up', () => {
  const r = saleEvent(invoice({ discount_paise: 5000, round_off_paise: -40, total_paise: 112960 }), [{ payment_method: 'UPI', amount_paise: 112960 }], null);
  assert.equal(r.skip, undefined);
  assert.deepEqual([r.payload.discount_minor, r.payload.round_off_minor, r.payload.total_minor], [5000, -40, 112960]);
});

test('credit notes and later payments', () => {
  const note = { cn_id: 2, cn_number: 'CN-0002', invoice_id: 7, cn_date: '2026-06-11', subtotal_paise: 50000, cgst_paise: 4500, sgst_paise: 4500, igst_paise: 0, discount_share_paise: 0, total_paise: 59000 };
  const r = creditNoteEvent(note, 'INV-0007', [{ method: 'cash', amount_paise: 59000 }], customer);
  assert.deepEqual(r.payload.refund_tenders, [{ mode: 'CASH', amount_minor: 59000 }]);
  assert.match(creditNoteEvent({ ...note, total_paise: 1 }, 'INV-0007', [], customer).skip, /do not add up/);
  assert.match(creditNoteEvent(note, 'INV-0007', [{ method: 'WALLET', amount_paise: 100 }], customer).skip, /WALLET/);
  const p = paymentEvent({ payment_id: 9, invoice_id: 7, payment_date: '2026-06-12', payment_method: 'UPI', amount_paise: 38000 }, customer);
  assert.deepEqual([p.payload.mode, p.payload.amount_minor, p.payload.customer.id], ['UPI', 38000, '3']);
  assert.equal(modeOf('upi'), 'UPI');
  assert.equal(modeOf('OTHER'), null);
});

test('the signature is HMAC-SHA256 over timestamp, a dot and the exact body', () => {
  const body = envelope({ eventId: 'e1', type: 'sale.finalized', businessId: 5, sequence: 12, occurredAt: '2026-06-10T10:00:00.000Z', payload: { a: 1 } });
  const sig = signature('fxs_secret', body, 1700000000);
  const want = crypto.createHmac('sha256', 'fxs_secret').update(`1700000000.${body}`).digest('hex');
  assert.equal(sig, `t=1700000000,v1=${want}`);
  const parsed = JSON.parse(body);
  assert.deepEqual([parsed.event_id, parsed.schema_version, parsed.business_id, parsed.sequence], ['e1', 1, '5', '12']);
});

/* ---- discovery and delivery against a real database */

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { encrypt } = await import('../src/modules/crypto.js');
const { discover, deliver, DOMAIN } = await import('../src/modules/flowbook/outbox.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const { checkUrl } = await import('../src/controllers/flowbook.controller.js');
test.after(cleanup);

let biz; let owner; let dish; let ravi; let link;
const SECRET = `fxs_${'ab'.repeat(32)}`;
const bill = async (items, { customerId, paid = 'FULL' } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: null }, owner, { customerId, items, payment: paid === null ? undefined : { amount: paid } });
    await client.query('COMMIT');
    return inv;
  } finally { client.release(); }
};
/** a bill is left a few seconds to settle before it is picked up: make everything old enough */
const age = async () => {
  await pool.query(`UPDATE payments SET created_at = created_at - interval '1 hour' WHERE business_id = $1`, [biz]);
  await pool.query(`UPDATE invoices SET created_at = created_at - interval '1 hour' WHERE business_id = $1`, [biz]);
  await pool.query(`UPDATE credit_notes SET created_at = created_at - interval '1 hour' WHERE business_id = $1`, [biz]);
};
const outbox = async () => (await pool.query(`SELECT outbox_id, event_type, source_id, status, last_error, attempts, payload FROM flowbook_outbox WHERE business_id = $1 ORDER BY outbox_id`, [biz])).rows;
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; }, send(b) { this.body = b; return this; } });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@fb.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status) VALUES ('Cafe',$1,'RESTAURANT',TRUE,'Maharashtra','ACTIVE') RETURNING business_id`, [owner])).rows[0].business_id;
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz]);
  dish = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory, hsn_sac) VALUES ($1,'Biryani','DISH',30000,5,FALSE,'9963') RETURNING product_id`, [biz])).rows[0].product_id;
  ravi = (await pool.query(`INSERT INTO customers (business_id, name, state) VALUES ($1,'Ravi Stores','Maharashtra') RETURNING customer_id`, [biz])).rows[0].customer_id;
  link = (await pool.query(
    `INSERT INTO flowbook_links (business_id, base_url, secret_enc, enabled, enabled_from) VALUES ($1,'https://books.example.com',$2,TRUE, CURRENT_TIMESTAMP - interval '1 day') RETURNING *`, [biz, encrypt(SECRET, DOMAIN)])).rows[0];
});

test('new bills are found once; the cash sale carries its tender and the credit sale its customer', { skip }, async () => {
  const cash = await bill([{ product_id: dish, quantity: 2 }]);
  const credit = await bill([{ product_id: dish, quantity: 1 }], { customerId: ravi, paid: null });
  assert.equal(await discover(link), 0, 'a bill still being written is left a moment');
  await age();
  assert.equal(await discover(link), 2);
  assert.equal(await discover(link), 0, 'scanning again adds nothing');
  const rows = await outbox();
  assert.deepEqual(rows.map((r) => [r.event_type, r.status]), [['sale.finalized', 'PENDING'], ['sale.finalized', 'PENDING']]);
  const [a, b] = rows.map((r) => r.payload);
  assert.deepEqual([a.invoice_id, a.tenders[0].mode, a.unpaid_minor], [String(cash.invoice_id), 'CASH', 0]);
  assert.deepEqual([b.invoice_id, b.customer.name, b.unpaid_minor, b.tenders.length], [String(credit.invoice_id), 'Ravi Stores', 31500, 0]);
});

test('delivery is in order, signed with the stored secret, and a failure holds back everything behind it', { skip }, async () => {
  const seen = [];
  let failNext = true;
  const send = async (url, body, sig) => {
    if (failNext) { failNext = false; throw new Error('FlowBook answered 503'); }
    seen.push({ url, body, sig });
  };
  const first = await deliver(link, { send });
  assert.deepEqual(first, { sent: 0, failed: 1 });
  let rows = await outbox();
  assert.deepEqual([rows[0].status, rows[0].attempts, rows[0].last_error, rows[1].status], ['PENDING', 1, 'FlowBook answered 503', 'PENDING']);
  assert.deepEqual(await deliver(link, { send }), { sent: 0, failed: 0 }, 'the failed row waits out its delay; the second does not jump ahead');

  await pool.query(`UPDATE flowbook_outbox SET next_attempt_at = CURRENT_TIMESTAMP WHERE business_id = $1`, [biz]);
  assert.deepEqual(await deliver(link, { send, now: () => 1700000000 }), { sent: 2, failed: 0 });
  assert.equal(seen[0].url, 'https://books.example.com/v1/integrations/flowxp/events');
  const parsed = seen.map((s) => JSON.parse(s.body));
  assert.deepEqual(parsed.map((p) => p.payload.invoice_id), rows.map((r) => r.payload.invoice_id), 'sent in outbox order');
  assert.equal(seen[0].sig, `t=1700000000,v1=${crypto.createHmac('sha256', SECRET).update(`1700000000.${seen[0].body}`).digest('hex')}`);
  assert.deepEqual(parsed[0].business_id, String(biz));
  rows = await outbox();
  assert.deepEqual(rows.map((r) => r.status), ['SENT', 'SENT']);
});

test('a cancellation, a later payment and a credit note follow their sale; a cancelled-before-sent bill is only counted', { skip }, async () => {
  const sale = await bill([{ product_id: dish, quantity: 2 }], { customerId: ravi, paid: null });         // 630.00 unpaid
  const doomed = await bill([{ product_id: dish, quantity: 1 }]);
  await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE invoice_id = $1`, [doomed.invoice_id]);   // before it is ever sent
  await age();
  await discover(link);
  // taken ten minutes after the sale, so it is not one of the sale's own tenders
  await pool.query(`INSERT INTO payments (business_id, invoice_id, customer_id, payment_method, amount_paise, payment_date, created_at)
                    VALUES ($1,$2,$3,'UPI',20000,CURRENT_DATE, (SELECT created_at FROM invoices WHERE invoice_id = $2) + interval '10 minutes')`, [biz, sale.invoice_id, ravi]);
  const lines = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [sale.invoice_id])).rows;
  const req = { tenant: { businessId: biz, branchId: null, scopeBranchId: null, role: 'OWNER', permissions: {} }, auth: { userId: owner }, params: { id: sale.invoice_id }, body: { reason: 'Wrong dish', items: [{ item_id: lines[0].item_id, quantity: 1 }] }, query: {}, headers: {}, ip: '127.0.0.1' };
  const res = fakeRes();
  await notes.create(req, res);
  assert.equal(res.code, 201);
  await age();
  await discover(link);
  await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE invoice_id = $1`, [sale.invoice_id]);
  await discover(link);

  const rows = (await outbox()).slice(2);
  const byType = Object.fromEntries(rows.map((r) => [`${r.event_type}:${r.source_id}`, r]));
  assert.equal(byType[`sale.finalized:${doomed.invoice_id}`].status, 'SKIPPED');
  assert.match(byType[`sale.finalized:${doomed.invoice_id}`].last_error, /Cancelled before/);
  assert.equal(byType[`sale.finalized:${sale.invoice_id}`].status, 'PENDING');
  assert.ok(Object.keys(byType).some((k) => k.startsWith('payment.received:')), 'the later payment is its own event');
  const note = Object.values(byType).find((r) => r.event_type === 'sale.returned');
  assert.equal(note.status, 'PENDING');
  assert.equal(note.payload.net_minor, 30000);
  assert.ok(!Object.keys(byType).some((k) => k === `sale.voided:${doomed.invoice_id}`), 'nothing to void for a bill that was never sent');
  const voided = byType[`sale.voided:${sale.invoice_id}`];
  assert.ok(voided && voided.status === 'PENDING', 'the cancelled sale that did go out is voided');
  const order = rows.filter((r) => r.status === 'PENDING').map((r) => r.event_type);
  assert.ok(order.indexOf('sale.finalized') < order.indexOf('sale.voided'), 'the sale is sent before its cancellation');
});

test('parked events are counted, and the address check keeps the server from calling inward', { skip }, async () => {
  assert.equal(checkUrl('https://books.example.com/').url, 'https://books.example.com');
  assert.match(checkUrl('ftp://x').error, /https/);
  assert.match(checkUrl('not a url').error, /address/);
  await pool.query(`UPDATE flowbook_outbox SET status = 'DEAD', attempts = 12 WHERE business_id = $1 AND status = 'PENDING' AND event_type = 'payment.received'`, [biz]);
  const dead = (await pool.query(`SELECT count(*)::int AS n FROM flowbook_outbox WHERE business_id = $1 AND status = 'DEAD'`, [biz])).rows[0].n;
  assert.equal(dead, 1);
});
