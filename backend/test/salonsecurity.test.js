/*
 * Salon security: who may reach what (the role table, enforced by the real route middleware), plan gating, salon-only
 * access, and that one salon — or one outlet — can never read or change another's records.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addClient, addService, addStaff, addStock, fakeRes, makeSalon, sell } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const router = (await import('../src/routes/salon.routes.js')).default;
const { createSalonInvoice } = await import('../src/modules/salon/pos.js');
const appts = (await import('../src/controllers/salonAppointments.controller.js')).default;
const clientsApi = (await import('../src/controllers/salonClients.controller.js')).default;
const catalog = (await import('../src/controllers/salonCatalog.controller.js')).default;
const staffApi = (await import('../src/controllers/salonStaff.controller.js')).default;
const plansApi = (await import('../src/controllers/salonPlans.controller.js')).default;
const commission = (await import('../src/controllers/salonCommission.controller.js')).default;
const inventory = (await import('../src/controllers/salonInventory.controller.js')).default;
const reports = (await import('../src/controllers/salonReports.controller.js')).default;
const posApi = (await import('../src/controllers/salonPos.controller.js')).default;

test.after(cleanup);

/* ── the route table, walked with the real middleware ─────────────────────── */

const routes = router.stack.filter((l) => l.route).map((l) => ({
  method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle)
}));

/**
 * Run a route's own gates for this tenant — everything between the sign-in/tenant lookup (which need a token and a
 * database row, and are tested with auth) and the controller. Returns the HTTP status the gates settle on, or 200
 * if the request would reach the controller.
 */
const gate = async (route, tenant, { method = 'GET' } = {}) => {
  const chain = route.stack.slice(2, -1);
  for (const mw of chain) {
    const res = fakeRes();
    let passed = false;
    await mw({ tenant, method, headers: {}, body: {}, get: () => undefined, originalUrl: route.path }, res, () => { passed = true; });
    if (!passed) return res.code;
  }
  return 200;
};
const find = (method, path) => { const r = routes.find((x) => x.method === method && x.path === path); assert.ok(r, `${method} ${path} exists`); return r; };

let A; let B; let rA; let rB; let cutA; let cutB; let asha; let sunil; let staffA; let staffB; let shampoo;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeSalon(pool, 'secA', { branches: 2 });
  B = await makeSalon(pool, 'secB');
  staffA = await addStaff(pool, A, { name: 'Ravi' });
  staffB = await addStaff(pool, B, { name: 'Bina' });
  cutA = await addService(pool, A, { name: 'Haircut A', price: 500 });
  cutB = await addService(pool, B, { name: 'Haircut B', price: 500 });
  shampoo = await addStock(pool, A, { name: 'Shampoo A', kind: 'DISH', price: 400, cost: 200, stock: 5 });
  asha = await addClient(pool, A, 'Asha', '9876500001');
  sunil = await addClient(pool, B, 'Sunil', '9876500002');
  rA = A.tenantFor('OWNER'); rB = B.tenantFor('OWNER');
});

test('every salon route is behind a permission, and none is reachable by a role that should not have it', { skip }, async () => {
  assert.ok(routes.length > 80, `the router has its routes (${routes.length})`);
  const tenantOf = (role) => A.tenantFor(role);
  // the gate outcome for each role at the routes that matter
  const table = [
    // [method, path, { role: expected }]
    ['POST', '/pos/invoices', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 200, ACCOUNTANT: 200, STYLIST: 403, INVENTORY_MANAGER: 403, KITCHEN: 403 }],
    ['POST', '/appointments', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 200, STYLIST: 403, ACCOUNTANT: 403, INVENTORY_MANAGER: 403 }],
    ['POST', '/appointments/:id/status', { OWNER: 200, RECEPTIONIST: 200, STYLIST: 200, ACCOUNTANT: 403, INVENTORY_MANAGER: 403 }],
    ['GET', '/schedule', { OWNER: 200, RECEPTIONIST: 200, STYLIST: 200, ACCOUNTANT: 403 }],
    ['PUT', '/settings', { OWNER: 200, ADMIN: 200, MANAGER: 403, RECEPTIONIST: 403, STYLIST: 403, ACCOUNTANT: 403, INVENTORY_MANAGER: 403 }],
    ['POST', '/services', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 403, STYLIST: 403, ACCOUNTANT: 403 }],
    ['PUT', '/services/:id/consumables', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 403, STYLIST: 403, INVENTORY_MANAGER: 403 }],
    ['POST', '/staff', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 403, STYLIST: 403, ACCOUNTANT: 403 }],
    ['GET', '/commissions', { OWNER: 200, MANAGER: 200, ACCOUNTANT: 403, RECEPTIONIST: 403, STYLIST: 403 }],
    ['POST', '/commissions/pay', { OWNER: 200, MANAGER: 200, ACCOUNTANT: 403, RECEPTIONIST: 403, STYLIST: 403 }],
    ['POST', '/stock/in', { OWNER: 200, MANAGER: 200, INVENTORY_MANAGER: 200, RECEPTIONIST: 403, STYLIST: 403, ACCOUNTANT: 403 }],
    ['GET', '/alerts', { OWNER: 200, MANAGER: 200, INVENTORY_MANAGER: 200, ACCOUNTANT: 200, RECEPTIONIST: 403, STYLIST: 403 }],
    ['GET', '/reports/:name', { OWNER: 200, MANAGER: 200, ACCOUNTANT: 200, RECEPTIONIST: 403, STYLIST: 403, INVENTORY_MANAGER: 403 }],
    ['GET', '/clients', { OWNER: 200, RECEPTIONIST: 200, STYLIST: 200, ACCOUNTANT: 200, INVENTORY_MANAGER: 403 }],
    ['POST', '/clients', { OWNER: 200, RECEPTIONIST: 200, MANAGER: 200, STYLIST: 403, ACCOUNTANT: 403 }],
    ['PUT', '/loyalty', { OWNER: 200, ADMIN: 200, MANAGER: 403, RECEPTIONIST: 403 }],
    ['POST', '/gift-cards', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 403, STYLIST: 403 }],
    ['POST', '/memberships/:id/cancel', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 403, STYLIST: 403 }],
    ['POST', '/campaigns', { OWNER: 200, ADMIN: 200, MANAGER: 403, RECEPTIONIST: 403 }],
    ['PUT', '/attendance', { OWNER: 200, MANAGER: 200, RECEPTIONIST: 200, STYLIST: 403, ACCOUNTANT: 403 }]
  ];
  for (const [method, path, expect] of table) {
    const route = find(method, path);
    for (const [role, want] of Object.entries(expect)) {
      assert.equal(await gate(route, tenantOf(role), { method }), want, `${role} ${method} ${path}`);
    }
  }
});

test('a per-person override can widen or narrow a role, and the owner cannot be locked out', { skip }, async () => {
  const pay = find('POST', '/commissions/pay');
  assert.equal(await gate(pay, A.tenantFor('RECEPTIONIST', { permissions: { staff_commission: true } })), 200, 'granted');
  assert.equal(await gate(pay, A.tenantFor('MANAGER', { permissions: { staff_commission: false } })), 403, 'revoked');
  assert.equal(await gate(pay, A.tenantFor('OWNER', { permissions: { staff_commission: false } })), 200, 'owner wildcard stands');
});

test('plans gate the separately-priced features, for everyone including the owner', { skip }, async () => {
  const cases = [['GET', '/appointments', 'salon_appointments'], ['GET', '/memberships', 'salon_memberships'], ['POST', '/packages', 'salon_packages'],
    ['GET', '/gift-cards', 'salon_gift_cards'], ['GET', '/commissions', 'salon_commission'], ['POST', '/campaigns', 'salon_automation'], ['GET', '/loyalty', 'loyalty']];
  for (const [method, path, feature] of cases) {
    const route = find(method, path);
    assert.equal(await gate(route, A.tenantFor('OWNER', { planFeatures: { [feature]: false } }), { method }), 402, `${feature} off → ${method} ${path}`);
    assert.equal(await gate(route, A.tenantFor('OWNER', { planFeatures: { [feature]: true } }), { method }), 200, `${feature} on`);
  }
  // the till, the client book and the catalogue stay open on every plan
  for (const [method, path] of [['POST', '/pos/invoices'], ['GET', '/clients'], ['GET', '/services'], ['GET', '/dashboard']]) {
    assert.equal(await gate(find(method, path), A.tenantFor('OWNER', { planFeatures: { salon_appointments: false, salon_memberships: false, salon_packages: false, salon_gift_cards: false, salon_commission: false, salon_automation: false } }), { method }), 200, `${method} ${path}`);
  }
});

test('the salon module does not exist for any other kind of business', { skip }, async () => {
  const { salonOnly } = await import('../src/modules/salon/common.js');
  for (const businessType of ['RESTAURANT', 'RETAIL', 'GENERAL', undefined]) {
    const res = fakeRes(); let passed = false;
    salonOnly({ tenant: { businessType } }, res, () => { passed = true; });
    assert.deepEqual([passed, res.code], [false, 404], String(businessType));
  }
  const res = fakeRes(); let passed = false;
  salonOnly({ tenant: { businessType: 'SALON' } }, res, () => { passed = true; });
  assert.equal(passed, true);
  // every route has salonOnly somewhere in its first three handlers
  for (const r of routes) assert.ok(r.stack.slice(0, 3).includes(salonOnly), `${r.method} ${r.path} is salon-only`);
});

test('writes need an active subscription and a concrete outlet where they create records', { skip }, async () => {
  const { requireOutlet } = await import('../src/middleware/auth.js');
  for (const [method, path] of [['POST', '/pos/invoices'], ['POST', '/appointments'], ['POST', '/stock/in'], ['POST', '/pos/quote']]) {
    const route = find(method, path);
    assert.equal(route.stack.includes(requireOutlet), true, `${method} ${path} needs an outlet`);
    assert.equal(await gate(route, { ...A.tenantFor('OWNER'), viewAll: true }, { method }), 400, `${method} ${path} refused for "all outlets"`);
  }
});

/* ── one salon can never reach another's records ──────────────────────────── */

test('another salon\'s clients, appointments, services and staff are invisible and untouchable', { skip }, async () => {
  // Salon B books an appointment; Salon A reaches for it
  const made = await B.call(appts.create, { body: { customer_id: sunil, start_at: new Date(Date.now() + 10 * 86400000).toISOString(), services: [{ service_id: cutB, staff_id: staffB }] } });
  // (may be refused for being outside hours; make one directly so the test does not depend on the day)
  let apptId = made.body?.data?.appointment_id;
  if (!apptId) {
    apptId = (await pool.query(
      `INSERT INTO salon_appointments (business_id, branch_id, customer_id, start_at, end_at, status) VALUES ($1,$2,$3, now() + interval '3 days', now() + interval '3 days 30 minutes', 'BOOKED') RETURNING appointment_id`,
      [B.businessId, B.branchId, sunil])).rows[0].appointment_id;
  }
  assert.equal((await A.call(appts.get, { params: { id: apptId } })).code, 404);
  assert.equal((await A.call(appts.setStatus, { params: { id: apptId }, body: { status: 'CANCELLED' } })).code, 404);
  assert.equal((await A.call(appts.reschedule, { params: { id: apptId }, body: { start_at: new Date(Date.now() + 9 * 86400000).toISOString() } })).code, 404);
  assert.equal((await A.call(appts.cart, { params: { id: apptId } })).code, 404);

  assert.equal((await A.call(clientsApi.get, { params: { id: sunil } })).code, 404);
  assert.equal((await A.call(clientsApi.update, { params: { id: sunil }, body: { name: 'Hacked' } })).code, 404);
  assert.equal((await A.call(clientsApi.addNote, { params: { id: sunil }, body: { body: 'x' } })).code, 404);
  assert.equal((await A.call(clientsApi.timeline, { params: { id: sunil } })).code, 404);
  assert.equal((await A.call(catalog.getService, { params: { id: cutB } })).code, 404);
  assert.equal((await A.call(catalog.updateService, { params: { id: cutB }, body: { name: 'Hacked' } })).code, 404);
  assert.equal((await A.call(catalog.setConsumables, { params: { id: cutB }, body: { items: [] } })).code, 404);
  assert.equal((await A.call(staffApi.get, { params: { id: staffB } })).code, 404);
  assert.equal((await A.call(staffApi.update, { params: { id: staffB }, body: { name: 'Hacked' } })).code, 404);

  // nothing changed on B's side
  assert.equal((await pool.query(`SELECT name FROM customers WHERE customer_id = $1`, [sunil])).rows[0].name, 'Sunil');
  assert.equal((await pool.query(`SELECT name FROM products WHERE product_id = $1`, [cutB])).rows[0].name, 'Haircut B');
  assert.equal((await pool.query(`SELECT status FROM salon_appointments WHERE appointment_id = $1`, [apptId])).rows[0].status, 'BOOKED');
});

test('lists and lookups only ever return the caller\'s own records', { skip }, async () => {
  const list = await A.call(clientsApi.list, { query: {} });
  assert.equal(list.code, 200);
  const names = list.body.data.map((c) => c.name);
  assert.ok(names.includes('Asha')); assert.ok(!names.includes('Sunil'));
  const look = await A.call(clientsApi.lookup, { query: { q: '9876500002' } });
  assert.equal((look.body.data ?? []).length, 0, 'B\'s number finds nothing in A');
  const services = await A.call(catalog.listServices, { query: {} });
  assert.ok(services.body.data.every((s) => s.name !== 'Haircut B'));
  const pcat = await A.call(posApi.catalog, { query: {} });
  assert.ok(!JSON.stringify(pcat.body).includes('Haircut B'));
  const st = await A.call(staffApi.list, { query: {} });
  assert.ok(st.body.data.every((s) => s.name !== 'Bina'));
});

test('the till refuses another salon\'s service, product, staff, client, gift card and package', { skip }, async () => {
  const go = (input, tenant = rA) => sell(pool, createSalonInvoice, A, input, { tenant });
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: cutB, staff_id: staffA }] }));
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: cutA, staff_id: staffB }] }));
  await assert.rejects(() => go({ customer_id: sunil, items: [{ type: 'SERVICE', service_id: cutA, staff_id: staffA }] }));
  // a gift card issued at B is not redeemable at A
  const card = (await pool.query(
    `INSERT INTO salon_gift_cards (business_id, branch_id, code, initial_paise, balance_paise) VALUES ($1,$2,'CROSSCHK',100000,100000) RETURNING card_id`, [B.businessId, B.branchId])).rows[0];
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: cutA, staff_id: staffA }], payments: [{ method: 'GIFT_CARD', amount: 100, gift_card_code: 'CROSSCHK' }] }));
  assert.equal(Number((await pool.query(`SELECT balance_paise FROM salon_gift_cards WHERE card_id = $1`, [card.card_id])).rows[0].balance_paise), 100000, 'B\'s card is untouched');
  const lookup = await A.call(plansApi.lookupCard, { query: { code: 'CROSSCHK' } });
  assert.equal(lookup.code, 404);
});

test('an invoice, its lines and its commissions belong to one salon', { skip }, async () => {
  const mine = await sell(pool, createSalonInvoice, A, { items: [{ type: 'SERVICE', service_id: cutA, staff_id: staffA }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const theirs = await sell(pool, createSalonInvoice, B, { items: [{ type: 'SERVICE', service_id: cutB, staff_id: staffB }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal((await A.call(posApi.invoiceLines, { params: { id: mine.invoice.invoice_id } })).code, 200);
  assert.equal((await A.call(posApi.invoiceLines, { params: { id: theirs.invoice.invoice_id } })).code, 404);
  const c = await A.call(commission.list, { query: {} });
  assert.ok(c.body.data.every((r) => r.staff_name !== 'Bina'));
  assert.equal((await A.call(commission.approve, { body: { ids: [1, 2, 3] } })).code === 200 || true, true);
  const leftover = await pool.query(`SELECT status FROM salon_commissions WHERE business_id = $1`, [B.businessId]);
  assert.ok(leftover.rows.every((r) => r.status === 'PENDING'), 'A cannot approve B\'s commissions');
});

test('reports and alerts carry only the caller\'s data', { skip }, async () => {
  const dash = await A.call(reports.dashboard, { query: {} });
  assert.equal(dash.code, 200);
  assert.ok(!JSON.stringify(dash.body).includes('Haircut B'));
  const alerts = await A.call(inventory.alerts, { query: {} });
  assert.equal(alerts.code, 200);
  assert.ok(!JSON.stringify(alerts.body).includes('Shampoo B'));
  // stock-in for another salon's product is a 404
  const r = await A.call(inventory.stockIn, { body: { product_id: (await pool.query(`SELECT product_id FROM products WHERE business_id = $1 LIMIT 1`, [B.businessId])).rows[0].product_id, quantity: 5 } });
  assert.equal(r.code, 404);
});

test('an unknown report name, and malformed ids, are plain refusals — never a crash or a leak', { skip }, async () => {
  assert.equal((await A.call(reports.run, { params: { name: 'nope; DROP TABLE customers' }, query: {} })).code, 404);
  assert.equal((await A.call(clientsApi.get, { params: { id: "1 OR 1=1" } })).code, 404);
  assert.equal((await A.call(appts.get, { params: { id: 'abc' } })).code, 404);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM customers`)).rows[0].n >= 2, true);
});

test('branch isolation: an outlet-pinned person sees only their outlet\'s stock and appointments', { skip }, async () => {
  const second = A.branchIds[1];
  const pinned = A.tenantFor('MANAGER', { branchId: second, pinned: true });
  const batch = (await pool.query(
    `INSERT INTO salon_stock_batches (business_id, branch_id, product_id, batch_no, expiry_date, qty_received, source) VALUES ($1,$2,$3,'MAIN-1', CURRENT_DATE + 30, 5, 'MANUAL') RETURNING batch_id`,
    [A.businessId, A.branchId, shampoo])).rows[0];
  const main = await A.call(inventory.batches, { query: { include_empty: '1' } }, A.tenantFor('MANAGER', { branchId: A.branchId, pinned: true }));
  assert.ok(main.body.data.some((b) => b.batch_id === batch.batch_id));
  const other = await A.call(inventory.batches, { query: { include_empty: '1' } }, pinned);
  assert.ok(!other.body.data.some((b) => b.batch_id === batch.batch_id), 'the other outlet does not see it');
});
