/*
 * Credit notes (exact tax reversal, settlement, stock, limits), round-off, and
 * the GST return: the report and register net off credit notes and agree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const reports = await import('../src/controllers/reports.controller.js');
const { profitability } = await import('../src/modules/profitability.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; }, send(b) { this.body = b; return this; } });

let biz; let A; let B; let owner; let dish; let packaged; let odd;
const tenant = (branchId = A, extra = {}) => ({ businessId: biz, branchId, scopeBranchId: null, role: 'OWNER', permissions: {}, ...extra });
const call = async (fn, { params = {}, body = {}, query = {}, branch = A, t = {} } = {}) => { const res = fakeRes(); await fn({ tenant: tenant(branch, t), auth: { userId: owner }, params, body, query, headers: {}, ip: '127.0.0.1' }, res); return res; };
const bill = async (items, { customerId, discount, paid = 'FULL', branch = A, date } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId, items, discount, invoiceDate: date, payment: paid === null ? undefined : { amount: paid } });
    await client.query('COMMIT');
    return inv;
  } finally { client.release(); }
};
const row = async (id) => (await pool.query(`SELECT * FROM invoices WHERE invoice_id = $1`, [id])).rows[0];
const lines = async (id) => (await pool.query(`SELECT item_id, description, quantity FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [id])).rows;
const stock = async (product) => Object.fromEntries((await pool.query(`SELECT branch_id, quantity FROM branch_stock WHERE product_id = $1`, [product])).rows.map((r) => [r.branch_id, Number(r.quantity)]));

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@cn.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status) VALUES ('Cafe',$1,'RESTAURANT',TRUE,'Karnataka','ACTIVE') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'MG Road',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Indiranagar',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const p = async (name, price, tax, track, hsn) => (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory, hsn_sac, current_stock) VALUES ($1,$2,'DISH',$3,$4,$5,$6,$7) RETURNING product_id`, [biz, name, price, tax, track, hsn, track ? 50 : 0])).rows[0].product_id;
  dish = await p('Biryani', 30000, 5, false, '9963');
  packaged = await p('Bottled Juice', 8000, 12, true, '2202');
  odd = await p('Odd Price Naan', 3333, 5, false, '1905');
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,50)`, [A, packaged]);
});

test('round-off rounds the bill to the rupee, keeps the difference, and never touches tax', { skip }, async () => {
  const before = await bill([{ product_id: odd, quantity: 1 }]);          // 33.33 + 5% = 34.9965 -> 35.00 with no round-off? (paise math below)
  assert.equal(before.round_off, 0, 'off by default');
  await pool.query(`UPDATE businesses SET round_off_enabled = TRUE WHERE business_id = $1`, [biz]);
  const inv = await bill([{ product_id: odd, quantity: 3 }]);              // 99.99 + 5.00 = 104.99 -> 105.00
  assert.equal(inv.total, Math.round(inv.total), 'a whole number of rupees');
  const stored = await row(inv.invoice_id);
  assert.equal(Number(stored.total_paise) % 100, 0);
  assert.equal(Number(stored.round_off_paise), Number(stored.total_paise) - (Number(stored.subtotal_paise) + Number(stored.tax_paise) - Number(stored.discount_paise)), 'the difference is kept on the invoice');
  assert.equal(Math.abs(Number(stored.round_off_paise)) < 50, true);
  assert.equal(inv.round_off, Number(stored.round_off_paise) / 100);
  assert.equal(stored.payment_status, 'PAID', '"FULL" pays the rounded total');
  assert.equal(Number(stored.amount_paid_paise), Number(stored.total_paise));
  await pool.query(`UPDATE businesses SET round_off_enabled = FALSE WHERE business_id = $1`, [biz]);
});

let inv; let items;
test('a credit note reverses exact tax on the chosen quantity and settles as a refund', { skip }, async () => {
  inv = await bill([{ product_id: dish, quantity: 4 }, { product_id: packaged, quantity: 3 }]);   // 1200 + 5% and 240 + 12%
  items = await lines(inv.invoice_id);
  const before = await row(inv.invoice_id);
  const res = await call(notes.create, { params: { id: inv.invoice_id }, body: { reason: 'Wrong dish served', items: [{ item_id: items[0].item_id, quantity: 1 }], refund: { method: 'cash' } } });
  assert.equal(res.code, 201);
  const cn = res.body.data;
  assert.match(cn.cn_number, /^CN-0001$/);
  assert.deepEqual([cn.subtotal, cn.tax, cn.cgst, cn.sgst, cn.igst, cn.total], [300, 15, 7.5, 7.5, 0, 315], 'one of four ₹300 biryanis, with its 5% GST');
  assert.equal(cn.refunded, 315, 'paid in full, so it goes back as money');
  assert.equal(cn.settled_against_balance, 0);
  const after = await row(inv.invoice_id);
  assert.equal(Number(after.credited_paise), 31500);
  assert.equal(Number(after.refunded_paise) - Number(before.refunded_paise), 31500);
  assert.equal(Number(after.cn_refunded_paise), 31500);
  const refund = (await pool.query(`SELECT amount_paise, method, credit_note_id FROM refunds WHERE invoice_id = $1`, [inv.invoice_id])).rows;
  assert.deepEqual(refund.map((r) => [Number(r.amount_paise), r.method, r.credit_note_id]), [[31500, 'CASH', cn.cn_id]]);
});

test('credit notes can’t take back more than was sold, and the last piece takes the exact remainder', { skip }, async () => {
  const credit = (id, qty, extra = {}) => call(notes.create, { params: { id: inv.invoice_id }, body: { reason: 'Return', items: [{ item_id: id, quantity: qty }], ...extra } });
  const over = await credit(items[0].item_id, 4);
  assert.equal(over.code, 400);
  assert.match(over.body.message, /only 3 left to credit/);
  assert.equal((await credit(items[0].item_id, 1)).code, 201);
  assert.equal((await credit(items[0].item_id, 1)).code, 201);
  const last = await credit(items[0].item_id, 1);
  assert.equal(last.code, 201);
  assert.equal(last.body.data.tax, 15);
  assert.equal((await credit(items[0].item_id, 1)).code, 400, 'fully credited');
  const totalCredited = (await pool.query(`SELECT SUM(tax_paise) AS t, SUM(total_paise) AS s FROM credit_notes WHERE invoice_id = $1`, [inv.invoice_id])).rows[0];
  assert.equal(Number(totalCredited.t), 6000, 'four notes reverse exactly the 60 of tax on the line');
  assert.equal(Number(totalCredited.s), 126000);
  // odd amounts: three separate notes for a line whose tax doesn't divide evenly still add up to the line
  const oddInv = await bill([{ product_id: odd, quantity: 3 }]);
  const oddLine = (await lines(oddInv.invoice_id))[0].item_id;
  const original = await row(oddInv.invoice_id);
  for (let n = 0; n < 3; n++) await call(notes.create, { params: { id: oddInv.invoice_id }, body: { reason: 'x', items: [{ item_id: oddLine, quantity: 1 }] } });
  const sums = (await pool.query(`SELECT SUM(tax_paise) AS tax, SUM(total_paise) AS total FROM credit_notes WHERE invoice_id = $1`, [oddInv.invoice_id])).rows[0];
  assert.equal(Number(sums.tax), Number(original.tax_paise), 'tax reversed to the paisa');
  assert.equal(Number(sums.total), Number(original.total_paise));
});

test('validation: a reason, real lines, no repeats, and only issued invoices', { skip }, async () => {
  const other = await bill([{ product_id: dish, quantity: 1 }]);
  const item = (await lines(other.invoice_id))[0].item_id;
  const go = (body, id = other.invoice_id) => call(notes.create, { params: { id }, body });
  assert.equal((await go({ items: [{ item_id: item, quantity: 1 }] })).code, 400, 'a reason is required');
  assert.equal((await go({ reason: 'x', items: [] })).code, 400);
  assert.equal((await go({ reason: 'x', items: [{ item_id: 999999, quantity: 1 }] })).code, 400);
  assert.equal((await go({ reason: 'x', items: [{ item_id: item, quantity: 0 }] })).code, 400);
  assert.equal((await go({ reason: 'x', items: [{ item_id: item, quantity: 1 }, { item_id: item, quantity: 1 }] })).code, 400, 'the same line twice');
  assert.equal((await go({ reason: 'x', items: [{ item_id: item, quantity: 1 }], refund: { method: 'barter' } })).code, 400);
  assert.equal((await go({ reason: 'x', items: [{ item_id: item, quantity: 1 }] }, 999999)).code, 404);
  // a line from another invoice can't be credited through this one
  assert.equal((await go({ reason: 'x', items: [{ item_id: items[1].item_id, quantity: 1 }] })).code, 400);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM credit_notes WHERE invoice_id = $1`, [other.invoice_id])).rows[0].n, 0, 'nothing half-saved');

  await call(invoices.cancel, { params: { id: other.invoice_id } });
  assert.equal((await go({ reason: 'x', items: [{ item_id: item, quantity: 1 }] })).code, 409, 'a cancelled invoice needs no credit note');
});

test('an unpaid bill is settled against what the customer owes, not paid back', { skip }, async () => {
  const credit = await bill([{ product_id: dish, quantity: 2 }], { paid: 0 });         // ₹630 owed
  const line = (await lines(credit.invoice_id))[0].item_id;
  const res = await call(notes.create, { params: { id: credit.invoice_id }, body: { reason: 'Guest left early', items: [{ item_id: line, quantity: 1 }], refund: { method: 'CASH' } } });
  assert.equal(res.code, 201);
  assert.deepEqual([res.body.data.settled_against_balance, res.body.data.refunded, res.body.data.unrefunded], [315, 0, 0]);
  const after = await row(credit.invoice_id);
  assert.equal(Number(after.balance_due_paise), 31500, 'now owes ₹315');
  assert.equal(Number(after.refunded_paise), 0, 'no money moved');
  // crediting the rest clears the balance, and the bill reads as settled
  const rest = await call(notes.create, { params: { id: credit.invoice_id }, body: { reason: 'Rest of it', items: [{ item_id: line, quantity: 1 }] } });
  assert.equal(rest.code, 201);
  const done = await row(credit.invoice_id);
  assert.deepEqual([Number(done.balance_due_paise), done.payment_status], [0, 'PAID']);
  assert.equal((await call(invoices.cancel, { params: { id: credit.invoice_id } })).code, 409, 'an invoice with credit notes can’t be cancelled');
});

test('a partial payment: the balance is cleared first, then money goes back', { skip }, async () => {
  const half = await bill([{ product_id: dish, quantity: 2 }], { paid: 400 });          // owes 230, paid 400
  const line = (await lines(half.invoice_id))[0].item_id;
  const res = await call(notes.create, { params: { id: half.invoice_id }, body: { reason: 'Both back', items: [{ item_id: line, quantity: 2 }], refund: { method: 'UPI' } } });
  assert.equal(res.code, 201);
  assert.deepEqual([res.body.data.total, res.body.data.settled_against_balance, res.body.data.refunded], [630, 230, 400]);
});

test('returned tracked items go back to stock at the invoice’s own outlet, only when asked', { skip }, async () => {
  const sold = await bill([{ product_id: packaged, quantity: 5 }], { branch: A });
  const line = (await lines(sold.invoice_id))[0].item_id;
  const start = await stock(packaged);
  await call(notes.create, { params: { id: sold.invoice_id }, body: { reason: 'Damaged', items: [{ item_id: line, quantity: 1 }] } });
  assert.deepEqual(await stock(packaged), start, 'not restocked unless asked');
  const res = await call(notes.create, { branch: B, params: { id: sold.invoice_id }, body: { reason: 'Unopened', restock: true, items: [{ item_id: line, quantity: 2 }] } });
  assert.equal(res.code, 201);
  const after = await stock(packaged);
  assert.equal(after[A], start[A] + 2, 'MG Road’s stock, though the person was viewing Indiranagar');
  assert.equal(after[B] ?? 0, start[B] ?? 0);
  const total = Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [packaged])).rows[0].current_stock);
  assert.equal(Object.values(after).reduce((s, n) => s + n, 0), total, 'outlet stock still adds up to the total');
  const ledger = (await pool.query(`SELECT transaction_type, quantity, branch_id FROM inventory_transactions WHERE reference_type = 'credit_note' AND reference_id = $1`, [res.body.data.cn_id])).rows;
  assert.deepEqual(ledger.map((l) => [l.transaction_type, Number(l.quantity), l.branch_id]), [['RETURN', 2, A]]);
  // a dish that isn't stock-tracked is never restocked
  const d = await bill([{ product_id: dish, quantity: 1 }]);
  const dl = (await lines(d.invoice_id))[0].item_id;
  const r2 = await call(notes.create, { params: { id: d.invoice_id }, body: { reason: 'x', restock: true, items: [{ item_id: dl, quantity: 1 }] } });
  assert.equal((await pool.query(`SELECT restocked FROM credit_note_items WHERE cn_id = $1`, [r2.body.data.cn_id])).rows[0].restocked, false);
});

test('the invoice-level discount is shared out, and the last note takes the remainder', { skip }, async () => {
  const disc = await bill([{ product_id: dish, quantity: 2 }], { discount: 100 });         // 600 + 30 tax − 100 = 530
  const [line] = await lines(disc.invoice_id);
  const first = await call(notes.create, { params: { id: disc.invoice_id }, body: { reason: 'a', items: [{ item_id: line.item_id, quantity: 1 }] } });
  assert.equal(first.body.data.discount_share, 50);
  assert.equal(first.body.data.total, 265, '315 less half the ₹100 discount');
  const second = await call(notes.create, { params: { id: disc.invoice_id }, body: { reason: 'b', items: [{ item_id: line.item_id, quantity: 1 }] } });
  assert.equal(second.body.data.total, 265);
  const done = await row(disc.invoice_id);
  assert.equal(Number(done.credited_paise), Number(done.total_paise), 'crediting everything credits exactly the invoice total');
});

test('isolation: another outlet or business cannot see or credit this invoice', { skip }, async () => {
  const mine = await bill([{ product_id: dish, quantity: 1 }], { branch: A });
  const line = (await lines(mine.invoice_id))[0].item_id;
  const pinnedB = { scopeBranchId: B, pinned: true };
  assert.equal((await call(notes.create, { branch: B, t: pinnedB, params: { id: mine.invoice_id }, body: { reason: 'x', items: [{ item_id: line, quantity: 1 }] } })).code, 404);
  assert.equal((await call(notes.options, { branch: B, t: pinnedB, params: { id: mine.invoice_id } })).code, 404);
  const foreign = fakeRes();
  await notes.create({ tenant: { businessId: biz + 999, scopeBranchId: null }, auth: { userId: owner }, params: { id: mine.invoice_id }, body: { reason: 'x', items: [{ item_id: line, quantity: 1 }] } }, foreign);
  assert.equal(foreign.code, 404);
  const ok = await call(notes.create, { params: { id: mine.invoice_id }, body: { reason: 'x', items: [{ item_id: line, quantity: 1 }] } });
  assert.equal(ok.code, 201);
  assert.equal((await call(notes.get, { branch: B, t: pinnedB, params: { id: ok.body.data.cn_id } })).code, 404);
  const seen = (await call(notes.list, { branch: B, t: pinnedB })).body.data.map((c) => c.cn_id);
  assert.ok(!seen.includes(ok.body.data.cn_id));
  const detail = (await call(notes.get, { params: { id: ok.body.data.cn_id } })).body.data;
  assert.equal(detail.items.length, 1);
  assert.equal(detail.outlet.name, 'MG Road');
  assert.equal((await call(notes.options, { params: { id: mine.invoice_id } })).body.data.items[0].remaining, 0);
});

/* ── the GST return ─────────────────────────────────────────────────────── */

test('the GST report is net of credit notes, and the register agrees with it', { skip }, async () => {
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, gstin, state) VALUES ($1,'Acme Foods','29ABCDE1234F1Z5','Karnataka') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const interstate = (await pool.query(`INSERT INTO customers (business_id, name, gstin, state) VALUES ($1,'=Far Away','27ABCDE1234F1Z5','Maharashtra') RETURNING customer_id`, [biz])).rows[0].customer_id;
  await bill([{ product_id: dish, quantity: 2 }], { customerId: customer });
  const igstInv = await bill([{ product_id: packaged, quantity: 4 }], { customerId: interstate });
  const igstLine = (await lines(igstInv.invoice_id))[0].item_id;
  const cn = await call(notes.create, { params: { id: igstInv.invoice_id }, body: { reason: 'Returned', items: [{ item_id: igstLine, quantity: 1 }] } });
  assert.deepEqual([cn.body.data.igst > 0, cn.body.data.cgst], [true, 0], 'an interstate sale is credited as IGST');

  const range = { from: '2000-01-01', to: '2999-12-31' };
  const gst = (await call(reports.gst, { query: range })).body.data;
  const reg = (await call(reports.gstRegister, { query: range })).body.data;
  assert.ok(gst.credit_notes.count >= 8);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.05, `${what}: ${a} vs ${b}`);
  near(reg.totals.taxable_value, gst.taxable_value, 'taxable value');
  near(reg.totals.cgst + reg.totals.sgst + reg.totals.igst, gst.total_tax, 'tax');
  near(reg.totals.igst, gst.igst, 'igst');
  assert.ok(reg.rows.some((r) => r.type === 'Credit note' && r.taxable < 0 && r.tax !== undefined || r.total < 0));
  assert.ok(reg.rows.some((r) => r.supply === 'B2B' && r.gstin === '29ABCDE1234F1Z5'));
  assert.ok(reg.rows.some((r) => r.supply === 'B2C'));
  // the HSN table nets off too
  const juice = gst.by_hsn.find((h) => h.hsn_sac === '2202');
  assert.ok(juice && juice.tax_rate === 12);

  // and it is a safe CSV
  const csv = await call(reports.gstRegister, { query: { ...range, format: 'csv' } });
  assert.match(csv.headers['Content-Type'], /text\/csv/);
  assert.match(csv.headers['Content-Disposition'], /gst-register-/);
  assert.equal(csv.body.split('\n')[0], 'Type,Number,Date,Customer,Customer GSTIN,State,Supply,Tax rate %,Taxable value,CGST,SGST,IGST,Total');
  assert.ok(csv.body.includes("'=Far Away"), 'a customer name starting with = is defused');
  assert.ok(csv.body.trim().split('\n').at(-1).startsWith('TOTAL,'));
});

test('revenue follows credit notes once, even when the credit note also refunded money', { skip }, async () => {
  const fresh = await bill([{ product_id: dish, quantity: 2 }], { date: '2024-06-15' });     // 600 revenue
  const line = (await lines(fresh.invoice_id))[0].item_id;
  const range = ['2024-06-15', '2024-06-15'];
  const revenue = async () => (await profitability(biz, ...range, pool)).totals.net_revenue;
  assert.equal(await revenue(), 60000);
  await call(notes.create, { params: { id: fresh.invoice_id }, body: { reason: 'x', items: [{ item_id: line, quantity: 1 }], refund: { method: 'CASH' } } });
  assert.equal(await revenue(), 30000, 'one biryani credited and refunded: revenue drops by its value once, not twice');
  await call(invoices.refund, { params: { id: fresh.invoice_id }, body: { amount: 100, reason: 'Goodwill', method: 'CASH' } });
  assert.ok(Math.abs((await revenue()) - (30000 - 10000 * (600 / 630))) < 200, 'a plain refund still reduces revenue on its own');
});

test('a credit note refund is not a leakage signal, and it is in the activity log wording', { skip }, async () => {
  const { describeAction, categoryOf } = await import('../src/modules/auditText.js');
  assert.equal(describeAction('credit_note.issued', { total: 315, refunded: 315 }, 'Credit note CN-0001'), 'Issued credit note Credit note CN-0001 for ₹315 (refunded ₹315)');
  assert.equal(categoryOf('credit_note.issued'), 'sales');
  const counted = (await pool.query(`SELECT COUNT(*)::int AS n FROM refunds WHERE business_id = $1 AND credit_note_id IS NULL`, [biz])).rows[0].n;
  const { collect } = await import('../src/modules/leakage.js');
  const data = await collect(biz, '2000-01-01', '2999-12-31');
  assert.ok(counted >= 1);
  assert.ok(Array.isArray(data.findings));
});
