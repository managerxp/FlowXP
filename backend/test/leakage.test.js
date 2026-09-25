/*
 * Leakage detectors (pure, on hand-built rows) and the end-to-end findings for a
 * business with a planted discount pattern. The wording test guards the rule
 * that nothing here accuses anyone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const L = await import('../src/modules/leakage.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const controller = await import('../src/controllers/leakage.controller.js');

test.after(cleanup);

const user = (id, name, bills, gross, disc, large = 0) => ({ user_id: id, name, bills, gross_paise: gross, discount_paise: disc, large_bills: large });

test('a discount rate far above everyone elses is flagged, with the excess as the potential', () => {
  const found = L.detectDiscounts([user(1, 'Ana', 100, 1000000, 150000, 40), user(2, 'Bo', 200, 2000000, 20000), user(3, 'Cy', 50, 500000, 5000)]);
  assert.equal(found.length, 1);
  assert.equal(found[0].subject.id, 1);
  assert.equal(found[0].current_value, 15);
  assert.equal(found[0].expected_value, 1);
  assert.equal(found[0].potential_paise, 140000);
  assert.equal(found[0].severity, 'warning');
  assert.equal(found[0].confidence, 'high');
});

test('small samples and immaterial amounts are not flagged', () => {
  assert.equal(L.detectDiscounts([user(1, 'Ana', 10, 100000, 30000), user(2, 'Bo', 200, 2000000, 20000)]).length, 0);   // too few bills
  assert.equal(L.detectDiscounts([user(1, 'Ana', 100, 1000000, 40000), user(2, 'Bo', 200, 2000000, 10000)]).length, 0); // under Rs 500
  assert.equal(L.detectDiscounts([user(1, 'Ana', 100, 1000000, 60000), user(2, 'Bo', 200, 2000000, 100000)]).length, 0); // nobody stands out
});

test('cancelled invoices with money collected and no refund are listed; refunded ones are not', () => {
  const rows = [
    { invoice_id: 1, invoice_number: 'INV-1', invoice_date: '2026-09-01', paid_paise: 10000, refunded_paise: 10000 },
    { invoice_id: 2, invoice_number: 'INV-2', invoice_date: '2026-09-02', paid_paise: 50000, refunded_paise: 0 }
  ];
  const [f] = L.detectCancelledAfterPayment(rows);
  assert.equal(f.potential_paise, 50000);
  assert.equal(f.severity, 'warning');
  assert.equal(f.evidence.rows.length, 1);
  assert.equal(L.detectCancelledAfterPayment([{ ...rows[1], paid_paise: 600000 }])[0].severity, 'critical');
  assert.equal(L.detectCancelledAfterPayment([rows[0]]).length, 0);
});

test('a cancellation rate several times the rest of the teams is flagged', () => {
  const found = L.detectCancellationPattern([
    { user_id: 1, name: 'Ana', cancelled: 12, handled: 100 }, { user_id: 2, name: 'Bo', cancelled: 3, handled: 300 }, { user_id: 3, name: 'Cy', cancelled: 0, handled: 200 }
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].subject.id, 1);
  assert.equal(L.detectCancellationPattern([{ user_id: 1, name: 'A', cancelled: 3, handled: 10 }, { user_id: 2, name: 'B', cancelled: 0, handled: 90 }]).length, 0);   // fewer than 5
});

test('refunds are compared with the previous period as a share of sales', () => {
  const cur = { refunds_paise: 300000, refund_count: 8, sales_paise: 10000000 };
  assert.equal(L.detectRefunds({ cur, prev: { refunds_paise: 50000, sales_paise: 10000000 } }).length, 1);
  assert.equal(L.detectRefunds({ cur, prev: { refunds_paise: 250000, sales_paise: 10000000 } }).length, 0);
  assert.equal(L.detectRefunds({ cur: { ...cur, refunds_paise: 50000 }, prev: { refunds_paise: 0, sales_paise: 1 } }).length, 0);
});

test('wastage flags a large rise on one item, not a small wobble, and marks brand-new spikes low-confidence', () => {
  const p = (id, name, cost) => ({ product_id: id, name, unit: 'kg', quantity: 5, cost_paise: cost });
  const found = L.detectWastage([p(1, 'Tomato', 100000), p(2, 'Onion', 52000), p(3, 'Cream', 150000)], [p(1, 'Tomato', 40000), p(2, 'Onion', 50000)]);
  assert.deepEqual(found.map((f) => f.subject.name).sort(), ['Cream', 'Tomato']);
  assert.equal(found.find((f) => f.subject.name === 'Cream').confidence, 'low');
  assert.equal(found.find((f) => f.subject.name === 'Tomato').potential_paise, 60000);
});

test('no finding ever accuses anyone', () => {
  const all = [
    ...L.detectDiscounts([user(1, 'Ana', 100, 1000000, 150000), user(2, 'Bo', 200, 2000000, 20000)]),
    ...L.detectCancelledAfterPayment([{ invoice_id: 1, invoice_number: 'I', invoice_date: '2026-09-01', paid_paise: 900000, refunded_paise: 0 }]),
    ...L.detectCancellationPattern([{ user_id: 1, name: 'Ana', cancelled: 12, handled: 100 }, { user_id: 2, name: 'Bo', cancelled: 0, handled: 300 }]),
    ...L.detectRefunds({ cur: { refunds_paise: 300000, refund_count: 8, sales_paise: 10000000 }, prev: { refunds_paise: 0, sales_paise: 1 } }),
    ...L.detectWastage([{ product_id: 1, name: 'Tomato', unit: 'kg', quantity: 9, cost_paise: 200000 }], []),
    ...L.detectAdjustments([{ product_id: 1, name: 'Ghee', unit: 'kg', quantity: 5, cost_paise: 300000, events: 2 }]),
    ...L.detectComplimentary([{ user_id: 1, name: 'Ana', lines: 6, cost_paise: 90000 }])
  ];
  assert.ok(all.length >= 7);
  for (const f of all) assert.doesNotMatch(`${f.title} ${f.summary} ${f.recommendation}`, /fraud|theft|steal|stole|cheat|dishonest|suspect|guilty/i, f.type);
});

test('a dismissal quietens a finding for two weeks, then it can return; summaries count only open ones', () => {
  const finding = { fingerprint: 'refunds:business', potential_paise: 1000, severity: 'warning', category: 'refunds', status: 'OPEN' };
  const now = Date.now();
  const recent = L.applyReviews([finding], [{ fingerprint: 'refunds:business', status: 'DISMISSED', reviewed_at: new Date(now - 3 * 86400000) }], now)[0];
  const stale = L.applyReviews([finding], [{ fingerprint: 'refunds:business', status: 'DISMISSED', reviewed_at: new Date(now - 20 * 86400000) }], now)[0];
  assert.equal(recent.status, 'DISMISSED');
  assert.equal(stale.status, 'OPEN');
  assert.equal(L.summarise([recent]).potential_paise, 0);
  assert.equal(L.summarise([stale]).potential_paise, 1000);
});

/* ── end to end ─────────────────────────────────────────────────────────── */

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('a planted discount pattern and a paid-then-cancelled invoice surface, and can be reviewed', { skip }, async () => {
  await runMigrations(pool);
  const mk = async (n) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [n, `${n}@leak.test`])).rows[0].user_id;
  const [x, y, z] = [await mk('Xavier'), await mk('Yara'), await mk('Zed')];
  const owner = await mk('Owner');
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('leaky',$1,'RESTAURANT') RETURNING business_id`, [owner])).rows[0].business_id;
  const tenant = { businessId: biz, branchId: null };
  const req = (extra = {}) => ({ tenant, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });

  const bill = async (userId, discount, paid = true) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inv = await createInvoiceInTransaction(client, tenant, userId, { items: [{ description: 'Meal', unit_price: 100, quantity: 1 }], discount: discount || undefined, payment: paid ? { amount: 100 - (discount || 0) } : undefined });
      await client.query('COMMIT');
      return inv;
    } finally { client.release(); }
  };
  for (let i = 0; i < 30; i++) await bill(x, 20);      // Xavier: 20% off, every bill
  for (let i = 0; i < 40; i++) await bill(y, i % 20 === 0 ? 5 : 0);
  for (let i = 0; i < 40; i++) await bill(z, 0);
  const cancelled = await bill(y, 0);
  await invoices.cancel(req({ params: { id: cancelled.invoice_id } }), fakeRes());

  let res = fakeRes();
  await controller.list(req(), res);
  const d = res.body.data;
  const discount = d.findings.find((f) => f.type === 'discount_outlier');
  assert.equal(discount.subject.id, x);
  assert.equal(discount.subject.name, 'Xavier');
  assert.equal(d.findings.filter((f) => f.type === 'discount_outlier').length, 1);   // Yara and Zed are not flagged
  assert.equal(discount.evidence.rows.length, 10);
  assert.ok(discount.potential > 0);
  const cp = d.findings.find((f) => f.type === 'cancelled_after_payment');
  assert.equal(cp.potential, 100);
  assert.ok(d.summary.potential > 0 && d.summary.open === d.findings.length);

  res = fakeRes();
  await controller.review(req({ body: { fingerprint: discount.fingerprint, status: 'DISMISSED', note: 'Approved promo' } }), res);
  assert.equal(res.code, 200);
  res = fakeRes();
  await controller.list(req(), res);
  const after = res.body.data;
  assert.equal(after.findings.find((f) => f.fingerprint === discount.fingerprint).status, 'DISMISSED');
  assert.equal(after.summary.open, d.summary.open - 1);

  res = fakeRes();
  await controller.review(req({ body: { fingerprint: discount.fingerprint, status: 'MAYBE' } }), res);
  assert.equal(res.code, 400);
});

test('findings are scoped to the business asking', { skip }, async () => {
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o2','o2@leak.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('quiet',$1) RETURNING business_id`, [owner])).rows[0].business_id;
  const res = fakeRes();
  await controller.list({ tenant: { businessId: biz }, auth: { userId: owner }, query: {}, params: {}, body: {}, headers: {}, ip: '127.0.0.1' }, res);
  assert.equal(res.body.data.findings.length, 0);
});
