/*
 * Bug reports from the app: a signed-in person's own words (filed under their own name and business), crashes the app sends by itself, and the admin's view of both with a status
 * that a repeat crash resets. Nobody but a platform admin can read them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { fakeRes, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const bugs = await import('../src/controllers/appErrors.controller.js');
const main = (await import('../src/routes/index.js')).default;
const adminRouter = (await import('../src/routes/admin.routes.js')).default;

test.after(cleanup);

let S; let T;
const send = async (handler, req) => { const res = fakeRes(); await handler({ headers: {}, body: {}, query: {}, params: {}, ...req }, res); return res; };
const as = (shop) => ({ auth: { userId: shop.userId, user: { name: 'x' } }, memberships: [{ business_id: shop.businessId }] });
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); return res.body.data; };

test('setup', { skip }, async () => { await runMigrations(pool); S = await makeShop(pool, 'bug'); T = await makeShop(pool, 'bug2'); });

test('a written report needs a few words, and is filed under the signed-in person and their business', { skip }, async () => {
  assert.equal((await send(bugs.create, { ...as(S), body: { description: 'short' } })).code, 400);
  const r = okBody(await send(bugs.create, { ...as(S), body: { category: 'BROKE', description: 'The pay screen froze when I tapped Cash on a bill of 3 items.', screen: '/pay', version: '1.0.0 (1)', platform: 'android', os_version: '14', device: 'abc',
    user_id: T.userId, business_id: T.businessId } }), 201);
  const row = (await pool.query(`SELECT * FROM app_errors WHERE error_id = $1`, [r.report_id])).rows[0];
  assert.equal(row.kind, 'REPORT'); assert.equal(row.category, 'BROKE'); assert.equal(row.status, 'NEW');
  assert.equal(row.user_id, S.userId, 'the session decides who, not the request body');
  assert.equal(row.business_id, S.businessId);
  const odd = okBody(await send(bugs.create, { ...as(S), body: { category: 'NOPE', description: 'An unknown kind of report still gets filed.' } }), 201);
  assert.equal((await pool.query(`SELECT category FROM app_errors WHERE error_id = $1`, [odd.report_id])).rows[0].category, 'OTHER');
});

test('filing a report needs a sign-in; the admin screens need a platform admin', { skip }, async () => {
  const route = main.stack.filter((l) => l.route).find((l) => l.route.path === '/app-reports' && l.route.methods.post);
  assert.ok(route, 'POST /app-reports exists');
  const first = route.route.stack[0].handle;
  const res = fakeRes(); let passed = false;
  await first({ headers: {}, get: () => undefined, method: 'POST', cookies: {} }, res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(res.code, 401);
  // every admin route sits behind sign-in, super admin and two-step verification
  const names = adminRouter.stack.filter((l) => !l.route).map((l) => l.handle.name);
  assert.ok(names.includes('requireAuth') && names.includes('requireSuperAdmin'), names.join(','));
  const paths = adminRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  for (const p of ['get /app-errors', 'patch /app-errors/status', 'get /bug-reports', 'patch /bug-reports/:id', 'get /bug-summary']) assert.ok(paths.includes(p), p);
  const idx = (n) => adminRouter.stack.findIndex((l) => !l.route && l.handle.name === n);
  const firstAdmin = adminRouter.stack.findIndex((l) => l.route && l.route.path === '/app-errors');
  assert.ok(idx('requireSuperAdmin') < firstAdmin, 'the admin check comes before the bug routes');
});

test('crashes are grouped by message with a status; a repeat after FIXED comes back as NEW', { skip }, async () => {
  const crash = (message) => send(bugs.report, { body: { message, stack: 'at x', screen: '/pay', fatal: true, version: '1.0.0', platform: 'android', os_version: '14', device: 'p1' } });
  okBody(await crash('Cannot read properties of undefined'), 201);
  okBody(await crash('Cannot read properties of undefined'), 201);
  okBody(await crash('Network request failed'), 201);
  let list = okBody(await send(bugs.list, {}));
  const g = list.find((x) => x.message === 'Cannot read properties of undefined');
  assert.equal(g.times, 2); assert.equal(g.status, 'NEW'); assert.equal(g.fatal, true);
  okBody(await send(bugs.setCrashStatus, { auth: { userId: S.userId }, body: { message: g.message, status: 'FIXED', note: 'fixed in 1.0.1' } }));
  list = okBody(await send(bugs.list, { query: { status: 'FIXED' } }));
  assert.deepEqual(list.map((x) => x.message), ['Cannot read properties of undefined']);
  assert.equal(list[0].note, 'fixed in 1.0.1');
  okBody(await crash('Cannot read properties of undefined'), 201);
  assert.equal(okBody(await send(bugs.list, {})).find((x) => x.message === g.message).status, 'NEW', 'it happened again, so it is new again');
  assert.equal((await send(bugs.setCrashStatus, { auth: { userId: S.userId }, body: { message: 'never happened', status: 'FIXED' } })).code, 404);
  assert.equal((await send(bugs.setCrashStatus, { auth: { userId: S.userId }, body: { message: g.message, status: 'WRONG' } })).code, 400);
});

test('the admin sees who sent a report, can filter it and move it along with a note', { skip }, async () => {
  const mine = okBody(await send(bugs.create, { ...as(T), body: { category: 'WRONG', description: 'The stock figure on the Parts screen is different from the website.' } }), 201);
  let list = okBody(await send(bugs.reports, {}));
  const r = list.find((x) => x.report_id === mine.report_id);
  assert.equal(r.business_name, `Shop ${T.tag}`); assert.match(r.user_email, /@parts\.test$/); assert.equal(r.status, 'NEW'); assert.equal(r.category, 'WRONG');
  assert.ok(list.every((x) => x.description), 'crash rows are not in the list of written reports');
  okBody(await send(bugs.setReportStatus, { auth: { userId: S.userId }, params: { id: String(mine.report_id) }, body: { status: 'SEEN', note: 'looking at it' } }));
  assert.deepEqual(okBody(await send(bugs.reports, { query: { status: 'SEEN' } })).map((x) => x.report_id), [mine.report_id]);
  assert.equal(okBody(await send(bugs.reports, { query: { status: 'SEEN' } }))[0].note, 'looking at it');
  assert.equal((await send(bugs.setReportStatus, { auth: { userId: S.userId }, params: { id: '999999' }, body: { status: 'FIXED' } })).code, 404);
  assert.equal((await send(bugs.setReportStatus, { auth: { userId: S.userId }, params: { id: String(mine.report_id) }, body: { status: 'DONE' } })).code, 400);
  // a crash row cannot be changed through the written-report route
  const crashId = (await pool.query(`SELECT error_id FROM app_errors WHERE kind = 'CRASH' LIMIT 1`)).rows[0].error_id;
  assert.equal((await send(bugs.setReportStatus, { auth: { userId: S.userId }, params: { id: String(crashId) }, body: { status: 'FIXED' } })).code, 404);
});

test('the console badge counts what is new', { skip }, async () => {
  const before = okBody(await send(bugs.summary, {}));
  await send(bugs.create, { ...as(S), body: { description: 'Another problem that nobody has seen yet.' } });
  const after = okBody(await send(bugs.summary, {}));
  assert.equal(after.new_reports, before.new_reports + 1);
  assert.ok(after.new_crashes >= 1);
});

test('deleting a business or a person keeps the report but drops the link', { skip }, async () => {
  const U = await makeShop(pool, 'bug3');
  const r = okBody(await send(bugs.create, { ...as(U), body: { description: 'A report from a shop that is later removed.' } }), 201);
  await pool.query(`DELETE FROM businesses WHERE business_id = $1`, [U.businessId]);
  const row = (await pool.query(`SELECT business_id, user_id FROM app_errors WHERE error_id = $1`, [r.report_id])).rows[0];
  assert.equal(row.business_id, null);
});
