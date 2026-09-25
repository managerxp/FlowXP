/*
 * The activity log (readable sentences, filters, paging, outlet and business
 * isolation, safe CSV) and per-person permission overrides (owner only,
 * normalised, effective immediately).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const audit = await import('../src/controllers/audit.controller.js');
const staff = await import('../src/controllers/staff.controller.js');
const { withBusiness, hasPermission } = await import('../src/middleware/auth.js');
const { recordAudit } = await import('../src/modules/events.js');
const { describeAction, categoryOf, prefixesFor } = await import('../src/modules/auditText.js');
const { PERMISSIONS, roleDefaults, describePermissions, cleanOverrides } = await import('../src/modules/permissions.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; }, send(b) { this.body = b; return this; } });

/* ── pure ───────────────────────────────────────────────────────────────── */

test('audit rows read as sentences, and unknown actions still show', () => {
  assert.equal(describeAction('invoice.created', { total: 1250.5 }, 'Invoice INV-0042'), 'Billed Invoice INV-0042 for ₹1,250.5');
  assert.equal(describeAction('invoice.cancelled', {}, 'Invoice INV-0042'), 'Cancelled Invoice INV-0042');
  assert.equal(describeAction('invoice.refunded', { amount: 100, reason: 'Cold food' }, 'Invoice INV-0042'), 'Refunded ₹100 on Invoice INV-0042 (Cold food)');
  assert.equal(describeAction('staff.permissions_updated', { changes: { refunds: 'allowed' } }, 'Ravi'), 'Changed the permissions of Ravi (refunds: allowed)');
  assert.equal(describeAction('purchase_order.received', { total: 500, short: ['Chicken'] }, 'PO-0007'), 'Received purchase order PO-0007 worth ₹500 (short: Chicken)');
  assert.equal(describeAction('coupon.updated', ['is_active']), 'Changed a coupon (is_active)', 'metadata may be a list');
  assert.equal(describeAction('table.merged_all', {}, 'T4'), 'Merged all table T4', 'a brand-new action is humanised, not hidden');
  assert.equal(describeAction('invoice.created', null), 'Billed a sale');
});

test('actions group into categories for filtering', () => {
  assert.equal(categoryOf('invoice.cancelled'), 'sales');
  assert.equal(categoryOf('purchase_order.sent'), 'stock');
  assert.equal(categoryOf('staff.added'), 'team');
  assert.equal(categoryOf('mystery.thing'), 'other');
  assert.ok(prefixesFor('sales').includes('invoice'));
  assert.equal(prefixesFor('nope'), null);
});

test('permission overrides combine with the role, and only real differences are kept', () => {
  assert.equal(roleDefaults('CASHIER').billing, true);
  assert.equal(roleDefaults('CASHIER').refunds, false);
  assert.ok(Object.values(roleDefaults('OWNER')).every(Boolean));
  const shown = describePermissions('CASHIER', { refunds: true, billing: false });
  const by = Object.fromEntries(shown.map((p) => [p.key, p]));
  assert.deepEqual([by.refunds.role_default, by.refunds.override, by.refunds.effective], [false, true, true]);
  assert.deepEqual([by.billing.role_default, by.billing.override, by.billing.effective], [true, false, false]);
  assert.deepEqual([by.reports.override, by.reports.effective], [null, false]);

  assert.deepEqual(cleanOverrides('CASHIER', { refunds: true, billing: true }).overrides, { refunds: true }, 'allowing what the role already allows is dropped');
  assert.deepEqual(cleanOverrides('CASHIER', { refunds: null }, { refunds: true }).overrides, {}, 'null goes back to the role default');
  assert.deepEqual(cleanOverrides('MANAGER', { gst: true }, { refunds: false }).overrides, { refunds: false, gst: true });
  assert.match(cleanOverrides('CASHIER', { godmode: true }).error, /Unknown permission/);
  assert.match(cleanOverrides('CASHIER', { billing: 'yes' }).error, /allow, deny/);
  assert.ok(cleanOverrides('CASHIER', []).error);
  assert.equal(PERMISSIONS.length, new Set(PERMISSIONS).size);
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let A; let B; let owner; let admin; let cashier; let manager; let stranger; let strangerBiz; let invoiceId; let productId;
const membershipsFor = async (userId) => (await pool.query(
  `SELECT bu.business_id, bu.role, bu.branch_id, bu.permissions, b.name, b.business_type, b.status AS business_status, b.subscription_status, b.plan_code,
          b.billing_cycle, b.trial_started_at, b.trial_ends_at, b.next_billing_date, b.currency, b.onboarding_step, b.gst_enabled
   FROM business_users bu JOIN businesses b ON b.business_id = bu.business_id WHERE bu.user_id = $1 AND bu.status = 'ACTIVE'`, [userId])).rows;
const request = async (who, extra = {}) => {
  const req = { auth: { userId: who }, memberships: await membershipsFor(who), headers: {}, body: {}, query: {}, params: {}, ip: '127.0.0.1', ...extra };
  const res = fakeRes(); let ok = false;
  await withBusiness()(req, res, () => { ok = true; });
  return { req, res, ok };
};
const call = async (fn, who, extra) => { const { req, res, ok } = await request(who, extra); if (!ok) return res; const out = fakeRes(); await fn(req, out); return out; };
const log = async (rows) => { for (const r of rows) await pool.query(`INSERT INTO audit_log (business_id, user_id, action, resource_type, resource_id, metadata, branch_id, created_at, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()),'10.0.0.1')`, [biz, r.user, r.action, r.type ?? null, r.id ?? null, JSON.stringify(r.meta ?? {}), r.branch ?? null, r.at ?? null]); };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = async (n) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [n, `${n}@au.test`])).rows[0].user_id;
  [owner, admin, cashier, manager, stranger] = [await user('Priya'), await user('Adam'), await user('Ravi'), await user('Meera'), await user('Sam')];
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status) VALUES ('Cafe',$1,'RESTAURANT','ACTIVE') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'MG Road',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Indiranagar',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  for (const [u, role, branch] of [[owner, 'OWNER', null], [admin, 'ADMIN', null], [cashier, 'CASHIER', A], [manager, 'MANAGER', null]]) await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [biz, u, role, branch]);
  strangerBiz = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('Elsewhere',$1) RETURNING business_id`, [stranger])).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [strangerBiz, stranger]);
  await pool.query(`INSERT INTO audit_log (business_id, user_id, action, metadata) VALUES ($1,$2,'invoice.created','{}')`, [strangerBiz, stranger]);

  invoiceId = (await pool.query(`INSERT INTO invoices (business_id, branch_id, invoice_number, total_paise) VALUES ($1,$2,'INV-0042',100000) RETURNING invoice_id`, [biz, A])).rows[0].invoice_id;
  productId = (await pool.query(`INSERT INTO products (business_id, name) VALUES ($1,'Butter Naan') RETURNING product_id`, [biz])).rows[0].product_id;
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const longAgo = new Date(Date.now() - 40 * 86400000).toISOString();
  await log([
    { user: cashier, action: 'invoice.created', type: 'invoice', id: invoiceId, meta: { total: 1000 }, branch: A },
    { user: cashier, action: 'invoice.cancelled', type: 'invoice', id: invoiceId, branch: A },
    { user: manager, action: 'product.updated', type: 'product', id: productId, meta: { fields: ['selling_price'] }, branch: B },
    { user: admin, action: 'staff.updated', type: 'user', id: cashier, meta: { role: 'CASHIER' } },
    { user: owner, action: 'business.updated', meta: { fields: ['gstin'] }, at: yesterday },
    { user: owner, action: 'invoice.created', at: longAgo }
  ]);
});

test('the log reads as sentences, with the readable names of what was touched', { skip }, async () => {
  const res = await call(audit.list, owner, { query: {} });
  assert.equal(res.code, 200);
  const e = res.body.data.entries;
  const by = (action) => e.find((x) => x.action === action);
  assert.equal(by('invoice.created').summary, 'Billed Invoice INV-0042 for ₹1,000');
  assert.equal(by('invoice.created').user, 'Ravi');
  assert.equal(by('invoice.created').outlet, 'MG Road');
  assert.equal(by('invoice.cancelled').summary, 'Cancelled Invoice INV-0042');
  assert.equal(by('product.updated').summary, 'Edited Butter Naan (selling_price)');
  assert.equal(by('staff.updated').summary, 'Changed Ravi to cashier');
  assert.equal(by('staff.updated').outlet, null, 'business-level actions have no outlet');
  assert.ok(e.every((x) => x.audit_id && x.at && x.category));
  assert.ok(!e.some((x) => x.user === 'Sam'), 'never another business’s activity');
  assert.ok(e[0].audit_id > e.at(-1).audit_id, 'newest first');
});

test('the log defaults to the last week and can be widened, and filtered', { skip }, async () => {
  const week = (await call(audit.list, owner, { query: {} })).body.data.entries;
  assert.ok(!week.some((x) => x.action === 'invoice.created' && x.user === 'Priya'), 'the 40-day-old row is outside the default week');
  const wide = (await call(audit.list, owner, { query: { from: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) } })).body.data.entries;
  assert.ok(wide.some((x) => x.user === 'Priya' && x.action === 'invoice.created'));

  const only = async (query) => (await call(audit.list, owner, { query })).body.data.entries;
  assert.ok((await only({ user_id: cashier })).every((x) => x.user_id === cashier));
  assert.deepEqual([...new Set((await only({ category: 'sales' })).map((x) => x.category))], ['sales']);
  assert.deepEqual((await only({ category: 'team' })).map((x) => x.action), ['staff.updated']);
  assert.ok((await only({ outlet: B })).every((x) => x.outlet === 'Indiranagar'));
  assert.ok((await only({ q: 'gstin' })).some((x) => x.action === 'business.updated'), 'searches inside the details too');
  assert.equal((await call(audit.list, owner, { query: { category: 'nope' } })).code, 400);
  assert.equal((await call(audit.list, owner, { query: { from: '2026-02-01', to: '2026-01-01' } })).code, 400);
  assert.equal((await call(audit.list, owner, { query: { from: '2020-01-01', to: '2026-01-01' } })).code, 400, 'at most a year');
});

test('a user pinned to one outlet sees only that outlet, whatever they ask for', { skip }, async () => {
  await pool.query(`UPDATE business_users SET branch_id = $1, role = 'ADMIN' WHERE business_id = $2 AND user_id = $3`, [A, biz, manager]);   // a pinned admin
  const res = await call(audit.list, manager, { query: { outlet: B }, headers: { 'x-branch-id': String(B) } });
  assert.equal(res.code, 200);
  const e = res.body.data.entries;
  assert.ok(e.length > 0 && e.every((x) => x.outlet === 'MG Road'), 'own outlet only, and business-level rows stay with the group');
  await pool.query(`UPDATE business_users SET branch_id = NULL, role = 'MANAGER' WHERE business_id = $1 AND user_id = $2`, [biz, manager]);
});

test('paging walks the whole log without repeats', { skip }, async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ user: owner, action: 'expense.created', type: 'expense', id: i }));
  await log(many);
  const seen = []; let before; let pages = 0;
  do {
    const res = await call(audit.list, owner, { query: { category: 'money', limit: 50, ...(before ? { before } : {}) } });
    seen.push(...res.body.data.entries.map((x) => x.audit_id));
    before = res.body.data.next; pages++;
  } while (before && pages < 10);
  assert.equal(pages, 3);
  assert.equal(seen.length, 120);
  assert.equal(new Set(seen).size, 120, 'no repeats');
});

test('the export is a safe CSV and needs the export permission', { skip }, async () => {
  // a person whose name is a spreadsheet formula
  const sneaky = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('=HYPERLINK("http://evil")','sneaky@au.test','x') RETURNING user_id`)).rows[0].user_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'STAFF')`, [biz, sneaky]);
  await log([{ user: sneaky, action: 'order.opened' }]);
  const res = await call(audit.list, owner, { query: { format: 'csv' } });
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.headers['Content-Disposition'], /attachment; filename="activity-/);
  const lines = res.body.split('\n');
  assert.equal(lines[0], 'When,Who,Role,What,Action,Outlet,IP address');
  assert.ok(lines.length > 100, 'includes every row, not one page');
  assert.ok(res.body.includes("\"'=HYPERLINK"), 'a value that starts with = is defused for spreadsheets');
  assert.ok(!res.body.includes(',=HYPERLINK') && !res.body.includes(',"=HYPERLINK'));

  await pool.query(`UPDATE business_users SET permissions = '{"export": false}' WHERE business_id = $1 AND user_id = $2`, [biz, admin]);
  assert.equal((await call(audit.list, admin, { query: { format: 'csv' } })).code, 403);
  assert.equal((await call(audit.list, admin, { query: {} })).code, 200, 'reading the log is still allowed');
  await pool.query(`UPDATE business_users SET permissions = '{}' WHERE business_id = $1 AND user_id = $2`, [biz, admin]);
});

test('actions are recorded with the outlet the person was working in', { skip }, async () => {
  const before = (await pool.query(`SELECT COALESCE(MAX(audit_id),0) AS m FROM audit_log`)).rows[0].m;
  recordAudit({ tenant: { businessId: biz, scopeBranchId: B }, auth: { userId: cashier }, headers: {}, socket: {} }, { action: 'order.opened', resource_type: 'order', resource_id: 1 });
  recordAudit({ tenant: { businessId: biz, scopeBranchId: null }, auth: { userId: owner }, headers: {}, socket: {} }, { action: 'business.updated' });
  // audit writes are fire-and-forget: wait for both to land (up to 3 s under load)
  let rows = [];
  for (let i = 0; i < 30 && rows.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 100));
    rows = (await pool.query(`SELECT action, branch_id FROM audit_log WHERE audit_id > $1 ORDER BY audit_id`, [before])).rows;
  }
  assert.deepEqual(rows, [{ action: 'order.opened', branch_id: B }, { action: 'business.updated', branch_id: null }]);
});

/* ── permission overrides ───────────────────────────────────────────────── */

test('only the owner can see or change permissions, never their own, and never an owner’s', { skip }, async () => {
  const get = (who, target) => call(staff.getPermissions, who, { params: { userId: target } });
  const put = (who, target, permissions) => call(staff.putPermissions, who, { params: { userId: target }, body: { permissions } });

  const shown = await get(owner, cashier);
  assert.equal(shown.code, 200);
  assert.equal(shown.body.data.role, 'CASHIER');
  assert.equal(shown.body.data.permissions.find((p) => p.key === 'billing').effective, true);
  assert.equal(shown.body.data.permissions.find((p) => p.key === 'refunds').effective, false);
  assert.ok(shown.body.data.permissions.every((p) => p.label && p.description));

  assert.equal((await put(owner, cashier, { refunds: true })).code, 200);
  assert.equal((await put(owner, owner, { refunds: false })).code, 403, 'not your own');
  assert.equal((await put(owner, admin, { gst: false })).code, 200, 'an admin can be narrowed');
  assert.equal((await put(owner, 999999, { gst: false })).code, 404);
  assert.equal((await put(owner, cashier, { godmode: true })).code, 400);
  const ownerRow = fakeRes();
  await staff.putPermissions({ tenant: { businessId: biz, role: 'OWNER' }, auth: { userId: admin }, params: { userId: owner }, body: { permissions: { billing: false } } }, ownerRow);
  assert.equal(ownerRow.code, 403, 'owners always have every permission');

  // an admin (who holds 'settings') is refused at the route by requireOwner; the controller is only ever reached by owners
  const { requireOwner } = await import('../src/middleware/auth.js');
  const { req } = await request(admin);
  let passed = false; requireOwner(req, fakeRes(), () => { passed = true; });
  assert.equal(passed, false);
});

test('an override takes effect on the next request, in both directions, and is recorded', { skip }, async () => {
  const can = async (who, permission) => hasPermission((await request(who)).req.tenant, permission);
  assert.equal(await can(cashier, 'refunds'), true, 'granted above');
  assert.equal(await can(cashier, 'reports'), false);
  assert.equal(await can(admin, 'gst'), false, 'taken away above');
  assert.equal(await can(admin, 'settings'), true, 'the rest of the role is untouched');

  await call(staff.putPermissions, owner, { params: { userId: cashier }, body: { permissions: { refunds: null } } });
  assert.equal(await can(cashier, 'refunds'), false, 'back to the role default');
  assert.deepEqual((await pool.query(`SELECT permissions FROM business_users WHERE business_id = $1 AND user_id = $2`, [biz, cashier])).rows[0].permissions, {}, 'nothing stale is stored');

  let entries = [];
  for (let i = 0; i < 30 && !entries.some((e) => /Ravi (refunds: allowed)/.test(e.summary)); i++) {
    await new Promise((r) => setTimeout(r, 100));
    entries = (await call(audit.list, owner, { query: { category: 'team' } })).body.data.entries;
  }
  assert.ok(entries.some((e) => /Changed the permissions of Ravi \(refunds: allowed\)/.test(e.summary)), 'the change is in the activity log');
});

test('changing someone’s role clears their overrides, and the staff list shows who has any', { skip }, async () => {
  await call(staff.putPermissions, owner, { params: { userId: manager }, body: { permissions: { gst: true } } });
  let list = (await call(staff.list, owner)).body.data;
  assert.equal(list.find((p) => p.user_id === manager).custom_permissions, 1);
  assert.equal(list.find((p) => p.user_id === owner).custom_permissions, 0);
  assert.ok(list.every((p) => !('permissions' in p)), 'the raw JSON is not sent');

  const res = await call(staff.update, owner, { params: { userId: manager }, body: { role: 'CASHIER', branch_id: A } });
  assert.equal(res.code, 200);
  list = (await call(staff.list, owner)).body.data;
  assert.equal(list.find((p) => p.user_id === manager).custom_permissions, 0, 'a new role starts clean');
});
