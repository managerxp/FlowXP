/*
 * Aggregator settlement reconciliation (owner's request, 2026-09-29) — the
 * spec's own fallback for no real aggregator API access: paste the
 * statement the platform already gives you, and FlowXP checks its
 * arithmetic and cross-checks the order value, rather than trusting it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const settlements = await import('../src/controllers/settlements.controller.js');
const { reconcile, expectedSettlementPaise, STATUS } = await import('../src/modules/settlements.js');
const { requirePlanFeature } = await import('../src/middleware/auth.js');

test.after(cleanup);

/* ── pure ───────────────────────────────────────────────────────────────── */

test('expected settlement subtracts every deduction from the gross amount', () => {
  assert.equal(expectedSettlementPaise({
    gross_amount_paise: 50000, commission_paise: 10000, payment_charges_paise: 1000,
    delivery_charges_paise: 2000, tax_paise: 500, other_deductions_paise: 0
  }), 36500);
});

test('reconcile: matched when the statement adds up and the order value agrees', () => {
  const line = { gross_amount_paise: 50000, commission_paise: 10000, payment_charges_paise: 0, delivery_charges_paise: 0, tax_paise: 0, other_deductions_paise: 0, net_settled_paise: 40000 };
  assert.equal(reconcile(line, 50000).status, STATUS.MATCHED);
});

test('reconcile: the platform\'s own arithmetic is wrong', () => {
  const line = { gross_amount_paise: 50000, commission_paise: 10000, payment_charges_paise: 0, delivery_charges_paise: 0, tax_paise: 0, other_deductions_paise: 0, net_settled_paise: 30000 };
  const r = reconcile(line, 50000);
  assert.equal(r.status, STATUS.ARITHMETIC_ERROR);
  assert.equal(r.arithmetic_diff_paise, -10000);
});

test('reconcile: the statement adds up fine, but the gross amount doesn\'t match what FlowXP billed', () => {
  const line = { gross_amount_paise: 55000, commission_paise: 10000, payment_charges_paise: 0, delivery_charges_paise: 0, tax_paise: 0, other_deductions_paise: 0, net_settled_paise: 45000 };
  const r = reconcile(line, 50000);
  assert.equal(r.status, STATUS.VALUE_MISMATCH);
  assert.equal(r.value_diff_paise, 5000);
});

test('reconcile: no matched order at all', () => {
  const line = { gross_amount_paise: 50000, commission_paise: 10000, payment_charges_paise: 0, delivery_charges_paise: 0, tax_paise: 0, other_deductions_paise: 0, net_settled_paise: 40000 };
  assert.equal(reconcile(line, null).status, STATUS.ORDER_NOT_FOUND);
});

test('reconcile: a rupee of rounding slack is not treated as a discrepancy', () => {
  const line = { gross_amount_paise: 50000, commission_paise: 10000, payment_charges_paise: 0, delivery_charges_paise: 0, tax_paise: 0, other_deductions_paise: 0, net_settled_paise: 40050 };
  assert.equal(reconcile(line, 50050).status, STATUS.MATCHED);
});

test('delivery settlement reconciliation reuses the integrations feature, on by default', () => {
  const middleware = requirePlanFeature('integrations');
  let next = false;
  middleware({ tenant: { planFeatures: {} } }, {}, () => { next = true; });
  assert.ok(next);
});

/* ── database ───────────────────────────────────────────────────────────── */

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let A; let B;

const makeBusiness = async (label) => {
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@settle.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ($1,$2,'CLOUD_KITCHEN','GROWTH') RETURNING business_id`, [label, owner.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: owner.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  /** A billed, platform-tagged order with an invoice of `totalRupees` — the direct-SQL shortcut, this file is about the reconciliation math, not the webhook-to-bill pipeline (already covered by deliveryorders.test.js). */
  const billedOrder = async (platform, externalId, totalRupees) => {
    const inv = (await pool.query(`INSERT INTO invoices (business_id, branch_id, invoice_number, total_paise, status) VALUES ($1,$2,$3,$4,'ISSUED') RETURNING invoice_id`, [biz.business_id, branchId, `INV-${externalId}`, totalRupees * 100])).rows[0];
    const order = (await pool.query(
      `INSERT INTO orders (business_id, branch_id, order_number, order_type, platform, external_order_id, status, invoice_id, created_by)
       VALUES ($1,$2,$3,'DELIVERY',$4,$5,'BILLED',$6,$7) RETURNING order_id, order_number`,
      [biz.business_id, branchId, `ORD-${externalId}`, platform, externalId, inv.invoice_id, owner.user_id]
    )).rows[0];
    return order;
  };
  return { biz: biz.business_id, branchId, tenant, req, call, billedOrder };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a');
  B = await makeBusiness('b');
});

test('import rejects an unknown platform, an empty import, or a row missing its order id or amount', { skip }, async () => {
  assert.equal((await A.call(settlements.importStatement, { body: { platform: 'DOORDASH', rows: [] } })).code, 400);
  assert.equal((await A.call(settlements.importStatement, { body: { platform: 'ZOMATO', rows: [] } })).code, 400);
  assert.equal((await A.call(settlements.importStatement, { body: { platform: 'ZOMATO', rows: [{ gross_amount: 100 }] } })).code, 400);
  assert.equal((await A.call(settlements.importStatement, { body: { platform: 'ZOMATO', rows: [{ external_order_id: 'Z1' }] } })).code, 400);
});

test('an imported line finds its FlowXP order, and status reflects whether the numbers agree', { skip }, async () => {
  const matched = await A.billedOrder('ZOMATO', 'Z-MATCH', 500);
  const mismatched = await A.billedOrder('ZOMATO', 'Z-MISMATCH', 500);
  const badMath = await A.billedOrder('ZOMATO', 'Z-BADMATH', 500);

  const res = await A.call(settlements.importStatement, {
    body: {
      platform: 'ZOMATO',
      rows: [
        { external_order_id: 'Z-MATCH', gross_amount: 500, commission: 100, net_settled: 400 },
        { external_order_id: 'Z-MISMATCH', gross_amount: 550, commission: 100, net_settled: 450 },
        { external_order_id: 'Z-BADMATH', gross_amount: 500, commission: 100, net_settled: 300 },
        { external_order_id: 'Z-UNKNOWN', gross_amount: 500, net_settled: 500 }
      ]
    }
  });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.rows, 4);

  const list = (await A.call(settlements.list, { query: { platform: 'ZOMATO' } })).body.data;
  const byId = Object.fromEntries(list.lines.map((l) => [l.external_order_id, l]));
  assert.equal(byId['Z-MATCH'].status, 'MATCHED');
  assert.equal(byId['Z-MATCH'].order_id, matched.order_id);
  assert.equal(byId['Z-MISMATCH'].status, 'VALUE_MISMATCH');
  assert.equal(byId['Z-MISMATCH'].order_id, mismatched.order_id);
  assert.equal(byId['Z-BADMATH'].status, 'ARITHMETIC_ERROR');
  assert.equal(byId['Z-BADMATH'].order_id, badMath.order_id);
  assert.equal(byId['Z-UNKNOWN'].status, 'ORDER_NOT_FOUND');
  assert.equal(byId['Z-UNKNOWN'].order_id, null);

  assert.equal(list.summary.count, 4);
  assert.equal(list.summary.matched, 1);
  assert.equal(list.summary.flagged, 3);
});

test('a business only ever sees its own settlement lines', { skip }, async () => {
  const bList = (await B.call(settlements.list, { query: { platform: 'ZOMATO' } })).body.data;
  assert.deepEqual(bList.lines, []);
});

test('missing settlements: a billed platform order with no statement line at all is flagged, with the amount owed', { skip }, async () => {
  const unpaid = await A.billedOrder('SWIGGY', 'S-NEVERPAID', 300);
  await A.billedOrder('SWIGGY', 'S-PAID', 200);
  await A.call(settlements.importStatement, { body: { platform: 'SWIGGY', rows: [{ external_order_id: 'S-PAID', gross_amount: 200, net_settled: 200 }] } });

  const res = await A.call(settlements.missing, { query: { platform: 'SWIGGY' } });
  assert.equal(res.body.data.orders.length, 1);
  assert.equal(res.body.data.orders[0].order_id, unpaid.order_id);
  assert.equal(res.body.data.orders[0].total, 300);
  assert.equal(res.body.data.total_owed, 300);
});
