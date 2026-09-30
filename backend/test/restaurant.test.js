/*
 * Modifiers, recipes, stock consumption, cancellation, wastage and refunds.
 * Pure rules run anywhere; the rest run against a throwaway Postgres (see
 * helpers/db.js) and skip when there is none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { pickModifiers, ModifierError } = await import('../src/modules/menu.js');
const { recipeCostPaise, recipeMargin, consumptionPerUnit } = await import('../src/modules/recipes.js');
const menu = await import('../src/controllers/menu.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const inventory = await import('../src/controllers/inventory.controller.js');

test.after(cleanup);

/* ── pure rules ─────────────────────────────────────────────────────────── */

const sizeGroup = {
  group_id: 1, name: 'Size', min_select: 1, max_select: 1,
  modifiers: [{ modifier_id: 10, name: 'Half', price_delta_paise: -5000 }, { modifier_id: 11, name: 'Full', price_delta_paise: 0 }]
};
const extras = {
  group_id: 2, name: 'Extras', min_select: 0, max_select: 2,
  modifiers: [
    { modifier_id: 20, name: 'Cheese', price_delta_paise: 2000, ingredient_product_id: 7, ingredient_qty: 0.03 },
    { modifier_id: 21, name: 'Egg', price_delta_paise: 1500 },
    { modifier_id: 22, name: 'Mushroom', price_delta_paise: 2500 }
  ]
};

test('modifier prices add to the base, and negative deltas shrink it', () => {
  const picked = pickModifiers([sizeGroup, extras], [10, 20]);
  assert.equal(picked.deltaPaise, -3000);
  assert.deepEqual(picked.snapshot.map((m) => m.name), ['Half', 'Cheese']);
  assert.equal(picked.snapshot[1].ingredient_product_id, 7);
});

test('a required group must be answered, and max is enforced', () => {
  assert.throws(() => pickModifiers([sizeGroup], []), ModifierError);
  assert.throws(() => pickModifiers([sizeGroup], [10, 11]), /at most 1/);
  assert.throws(() => pickModifiers([sizeGroup, extras], [11, 20, 21, 22]), /at most 2/);
  assert.doesNotThrow(() => pickModifiers([sizeGroup, extras], [11]));
});

test('an option that does not belong to the dish is rejected', () => {
  assert.throws(() => pickModifiers([sizeGroup], [11, 999]), /not available/);
});

test('recipe cost includes wastage, and margin is against the selling price', () => {
  const recipe = [
    { ingredient_id: 1, quantity: 0.25, wastage_pct: 0, price_paise: 8000 },
    { ingredient_id: 2, quantity: 0.18, wastage_pct: 10, price_paise: 20000 }
  ];
  assert.equal(recipeCostPaise(recipe), 2000 + 3960);
  assert.deepEqual(recipeMargin(5960, 20000), { cost_paise: 5960, gross_margin_paise: 14040, gross_margin_pct: 70.2 });
  assert.equal(recipeMargin(100, 0).gross_margin_pct, null);
});

test('consumption merges recipe lines and modifier ingredients', () => {
  const out = consumptionPerUnit(
    [{ ingredient_id: 2, quantity: 0.18, wastage_pct: 10 }],
    [{ ingredient_id: 0, ingredient_product_id: 2, ingredient_qty: 0.05 }]
  );
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].qty_per_unit - (0.198 + 0.05)) < 1e-9);
});

/* ── database ───────────────────────────────────────────────────────────── */

const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const stock = async (id) => Number((await pool.query('SELECT current_stock FROM products WHERE product_id = $1', [id])).rows[0].current_stock);

let A; let B;   // two businesses, to prove isolation

const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@t.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const product = async (name, { kind = 'DISH', price = 0, cost = 0, track = false, stockQty = 0 }) => {
    const id = (await pool.query(
      `INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, track_inventory, current_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING product_id`,
      [biz.business_id, name, kind, price, cost, track, stockQty]
    )).rows[0].product_id;
    if (track) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [branchId, id, stockQty]);
    return id;
  };
  const tenant = { businessId: biz.business_id, branchId };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  return { userId: user.user_id, tenant, product, req };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a');
  B = await makeBusiness('b');
});

test('billing a dish with a recipe and a modifier consumes ingredients and snapshots cost', { skip }, async () => {
  A.rice = await A.product('Rice', { kind: 'INGREDIENT', cost: 8000, track: true, stockQty: 10 });
  A.chicken = await A.product('Chicken', { kind: 'INGREDIENT', cost: 20000, track: true, stockQty: 10 });
  A.biryani = await A.product('Biryani', { price: 20000 });

  let res = fakeRes();
  await menu.setRecipe(A.req({ params: { id: A.biryani }, body: { ingredients: [
    { ingredient_id: A.rice, quantity: 0.25 },
    { ingredient_id: A.chicken, quantity: 0.18, wastage_pct: 10 }
  ] } }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.cost, 59.6);
  assert.equal(res.body.data.gross_margin_pct, 70.2);

  res = fakeRes();
  await menu.createGroup(A.req({ body: { name: 'Extras', min_select: 0, max_select: 2, modifiers: [
    { name: 'Extra chicken', price_delta: 30, ingredient_product_id: A.chicken, ingredient_qty: 0.05 }
  ] } }), res);
  assert.equal(res.code, 201);
  A.groupId = res.body.data.group_id;
  A.modId = res.body.data.modifiers[0].modifier_id;

  res = fakeRes();
  await menu.setProductGroups(A.req({ params: { id: A.biryani }, body: { group_ids: [A.groupId] } }), res);
  assert.equal(res.code, 200);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    A.invoice = await createInvoiceInTransaction(client, A.tenant, A.userId, {
      items: [{ product_id: A.biryani, quantity: 2, modifier_ids: [A.modId] }],
      payment: { amount: 460, method: 'CASH' }
    });
    await client.query('COMMIT');
  } finally { client.release(); }

  assert.equal(A.invoice.total, 460);                       // (200 + 30) x 2
  assert.equal(await stock(A.rice), 9.5);                   // 0.25 x 2
  assert.equal(Number((await stock(A.chicken)).toFixed(3)), 9.504);   // (0.198 + 0.05) x 2

  const line = (await pool.query(`SELECT description, unit_cost_paise, modifiers FROM invoice_items WHERE invoice_id = $1`, [A.invoice.invoice_id])).rows[0];
  assert.equal(line.description, 'Biryani (Extra chicken)');
  assert.equal(Number(line.unit_cost_paise), 2000 + 3960 + 1000);
  assert.equal(line.modifiers[0].price_paise, 3000);
});

test('cancelling the invoice restores the ingredients exactly', { skip }, async () => {
  const res = fakeRes();
  await invoices.cancel(A.req({ params: { id: A.invoice.invoice_id } }), res);
  assert.equal(res.code, 200);
  assert.equal(await stock(A.rice), 10);
  assert.equal(await stock(A.chicken), 10);
});

test('another business cannot use this business\'s modifier or ingredient', { skip }, async () => {
  const dishB = await B.product('Curry', { price: 10000 });
  let res = fakeRes();
  await menu.setProductGroups(B.req({ params: { id: dishB }, body: { group_ids: [A.groupId] } }), res);
  assert.equal(res.code, 400);

  res = fakeRes();
  await menu.setRecipe(B.req({ params: { id: dishB }, body: { ingredients: [{ ingredient_id: A.rice, quantity: 1 }] } }), res);
  assert.equal(res.code, 404);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(createInvoiceInTransaction(client, B.tenant, B.userId, { items: [{ product_id: dishB, quantity: 1, modifier_ids: [A.modId] }] }), /not available/);
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('wastage is a ledger movement with a reason, and is summarised', { skip }, async () => {
  let res = fakeRes();
  await inventory.recordWastage(A.req({ body: { product_id: A.rice, quantity: 1.5, reason_code: 'SPOILAGE' } }), res);
  assert.equal(res.code, 201);
  assert.equal(await stock(A.rice), 8.5);

  res = fakeRes();
  await inventory.recordWastage(A.req({ body: { product_id: A.rice, quantity: 1, reason_code: 'NONSENSE' } }), res);
  assert.equal(res.code, 400);

  res = fakeRes();
  await inventory.wastageSummary(A.req(), res);
  assert.equal(res.body.data.total_cost, 120);              // 1.5 kg x Rs 80
  assert.equal(res.body.data.by_reason.SPOILAGE, 120);
});

test('a refund cannot exceed what was collected, and accumulates', { skip }, async () => {
  const client = await pool.connect();
  let paid;
  try {
    await client.query('BEGIN');
    paid = await createInvoiceInTransaction(client, A.tenant, A.userId, { items: [{ description: 'Water', unit_price: 100, quantity: 1 }], payment: { amount: 100 } });
    await client.query('COMMIT');
  } finally { client.release(); }

  const refund = async (amount) => { const r = fakeRes(); await invoices.refund(A.req({ params: { id: paid.invoice_id }, body: { amount, reason: 'Wrong item' } }), r); return r; };
  assert.equal((await refund(60)).code, 201);
  assert.equal((await refund(50)).code, 400);              // only 40 left
  assert.equal((await refund(40)).code, 201);
  const row = (await pool.query('SELECT refunded_paise FROM invoices WHERE invoice_id = $1', [paid.invoice_id])).rows[0];
  assert.equal(Number(row.refunded_paise), 10000);

  const noReason = fakeRes();
  await invoices.refund(A.req({ params: { id: paid.invoice_id }, body: { amount: 1 } }), noReason);
  assert.equal(noReason.code, 400);
});

test('a plain product with no recipe still bills, tracks stock and cancels as before', { skip }, async () => {
  const cola = await A.product('Cola', { price: 4000, cost: 2500, track: true, stockQty: 5 });
  const client = await pool.connect();
  let inv;
  try {
    await client.query('BEGIN');
    inv = await createInvoiceInTransaction(client, A.tenant, A.userId, { items: [{ product_id: cola, quantity: 2 }] });
    await client.query('COMMIT');
  } finally { client.release(); }
  assert.equal(await stock(cola), 3);
  assert.equal(Number((await pool.query('SELECT unit_cost_paise FROM invoice_items WHERE invoice_id = $1', [inv.invoice_id])).rows[0].unit_cost_paise), 2500);

  await invoices.cancel(A.req({ params: { id: inv.invoice_id } }), fakeRes());
  assert.equal(await stock(cola), 5);
});

test('deleting a business removes its invoices, refunds, recipes and products together', { skip }, async () => {
  await pool.query('DELETE FROM businesses WHERE business_id = $1', [A.tenant.businessId]);
  for (const table of ['invoices', 'refunds', 'recipe_items', 'products', 'modifier_groups']) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE business_id = $1`, [A.tenant.businessId]);
    assert.equal(rows[0].n, 0, table);
  }
});

test('every role in ROLE_PERMISSIONS can be stored on a membership', { skip }, async () => {
  const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('r','roles@t.test','x') RETURNING user_id`)).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('roles', $1) RETURNING business_id`, [user.user_id])).rows[0];
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (business_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [biz.business_id, user.user_id, role]);
  }
});

test('the product list filters by kind', { skip }, async () => {
  const products = await import('../src/controllers/products.controller.js');
  const C = await makeBusiness('c');
  await C.product('Flour', { kind: 'INGREDIENT', track: true });
  await C.product('Naan', { kind: 'DISH', price: 5000 });
  const names = async (query) => { const r = fakeRes(); await products.list(C.req({ query }), r); return r.body.data.map((p) => p.name); };
  assert.deepEqual(await names({ kind: 'INGREDIENT' }), ['Flour']);
  assert.deepEqual(await names({ kind: 'dish' }), ['Naan']);
  assert.equal((await names({})).length, 2);
});

/* ── profitability ──────────────────────────────────────────────────────── */

test('an invoice\'s revenue, discounts and variable costs split across its lines and reconcile', async () => {
  const { profitOfInvoice } = await import('../src/modules/profitability.js');
  const settings = { payment_fee_pct: { CARD: 2 }, platform_commission_pct: { ZOMATO: 20 }, packaging_per_order_paise: 1000 };
  const r = profitOfInvoice(
    { subtotal_paise: 100000, tax_paise: 5000, discount_paise: 10500, refunded_paise: 0, platform: 'ZOMATO', order_type: 'DELIVERY', payments: [{ method: 'CARD', amount_paise: 94500 }] },
    [{ product_id: 1, name: 'A', quantity: 1, taxable_paise: 60000, cogs_paise: 15000 }, { product_id: 2, name: 'B', quantity: 1, taxable_paise: 40000, cogs_paise: 10000 }],
    settings
  );
  assert.equal(r.discount, 10000);                          // Rs 105 incl. tax -> Rs 100 ex-tax
  assert.equal(r.net_revenue, 90000);
  assert.equal(Math.round(r.payment_fees), 1890);
  assert.equal(r.commission, 18000);
  assert.equal(r.contribution, 90000 - 25000 - 1890 - 18000 - 1000);
  assert.equal(Math.round(r.lines[0].contribution), 26466);
  assert.equal(Math.round(r.lines.reduce((s, l) => s + l.contribution, 0)), Math.round(r.contribution));
});

test('with no settings saved, nothing is deducted that the owner never configured', async () => {
  const { profitOfInvoice } = await import('../src/modules/profitability.js');
  const r = profitOfInvoice({ subtotal_paise: 50000, tax_paise: 0, discount_paise: 0, refunded_paise: 0, platform: 'SWIGGY', order_type: 'DELIVERY', payments: [{ method: 'CARD', amount_paise: 50000 }] },
    [{ product_id: 1, name: 'A', quantity: 1, taxable_paise: 50000, cogs_paise: 20000 }]);
  assert.equal(r.contribution, 30000);
});

test('profitability summary: revenue, food cost, fees, period costs and estimated net', { skip }, async () => {
  const profitability = await import('../src/controllers/profitability.controller.js');
  const D = await makeBusiness('d');
  const dish = await D.product('Thali', { price: 30000, cost: 10000 });    // sells Rs 300, costs Rs 100

  let res = fakeRes();
  await profitability.putSettings(D.req({ body: { payment_fee_pct: { CARD: 2 }, packaging_per_order: 0 } }), res);
  assert.equal(res.code, 200);
  res = fakeRes();
  await profitability.putSettings(D.req({ body: { platform_commission_pct: { NOPE: 5 } } }), res);
  assert.equal(res.code, 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await createInvoiceInTransaction(client, D.tenant, D.userId, { items: [{ product_id: dish, quantity: 2 }], payment: { amount: 600, method: 'CARD' } });
    await client.query('COMMIT');
    assert.equal(inv.total, 600);
  } finally { client.release(); }

  await pool.query(`INSERT INTO expenses (business_id, category, amount_paise) VALUES ($1,'Rent',10000)`, [D.tenant.businessId]);

  res = fakeRes();
  await profitability.summary(D.req(), res);
  const d = res.body.data;
  assert.equal(d.totals.net_revenue, 600);
  assert.equal(d.totals.cogs, 200);
  assert.equal(d.totals.payment_fees, 12);
  assert.equal(d.totals.contribution, 388);
  assert.equal(d.totals.food_cost_pct, 33.3);
  assert.equal(d.period_costs.expenses_total, 100);
  assert.equal(d.totals.estimated_net, 288);
  assert.equal(d.items[0].name, 'Thali');
  assert.equal(d.items[0].contribution_per_unit, 194);
  assert.equal(d.is_estimate, true);
  assert.equal(d.change_pct.net_revenue_pct, null);             // nothing in the previous period to compare with
});

test('a cancelled invoice contributes nothing to profitability', { skip }, async () => {
  const profitability = await import('../src/controllers/profitability.controller.js');
  const E = await makeBusiness('e');
  const dish = await E.product('Soup', { price: 10000, cost: 4000 });
  const client = await pool.connect();
  let inv;
  try {
    await client.query('BEGIN');
    inv = await createInvoiceInTransaction(client, E.tenant, E.userId, { items: [{ product_id: dish, quantity: 1 }], payment: { amount: 100 } });
    await client.query('COMMIT');
  } finally { client.release(); }
  await invoices.cancel(E.req({ params: { id: inv.invoice_id } }), fakeRes());
  const res = fakeRes();
  await profitability.summary(E.req(), res);
  assert.equal(res.body.data.totals.net_revenue, 0);
  assert.equal(res.body.data.totals.invoices, 0);
});
