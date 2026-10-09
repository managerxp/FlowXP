/* node scripts/push.mjs     Phone notifications, end to end, without a phone. Starts its own copy of the API on port 5102 pointed at a stand-in for Expo's push
   service, registers made-up phone addresses for demo staff, and checks who is told what: a guest's QR order, a dish ready for the waiter, a person who switched it off,
   a dead phone, a person from another business, and a push service that is down. Stop the other API server first (two workers would share one job queue).
   Leaves the demo data as it found it. */
import http from 'node:http';
import { spawn } from 'node:child_process';
import pool from '../src/config/database.js';

const API = 'http://127.0.0.1:5102';
let failures = 0; let checks = 0; let seq = 0;
const good = (cond, m) => { checks++; if (cond) console.log(`  ok  ${m}`); else { failures++; console.log(`  FAIL  ${m}`); } };
const key = () => `push-${Date.now()}-${seq++}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (name) => `ExponentPushToken[drill-${name}-${Date.now().toString(36)}]`;

/* the stand-in for Expo: records what it is sent, can be told to call a token dead or to fail */
const received = []; const dead = new Set(); let down = false;
const expo = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (down) { res.statusCode = 500; return res.end('down'); }
    const batch = JSON.parse(body); received.push(...batch);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: batch.map((m) => (dead.has(m.to) ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }));
  });
}).listen(5199, '127.0.0.1');

const server = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '5102', EXPO_PUSH_URL: 'http://127.0.0.1:5199/', WORKER_INTERVAL_MS: '400', PUSH_ENABLED: 'true' }, stdio: 'ignore' });
const stop = async () => { server.kill(); expo.close(); await pool.end().catch(() => {}); };
for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch { /* starting */ } await sleep(500); }

const login = async (email) => {
  const r = await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) })).json();
  const me = (await (await fetch(API + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const headers = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
  const call = async (method, path, body, extra = {}) => { const res = await fetch(API + '/api' + path, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }); let json = null; try { json = await res.json(); } catch { /* */ } return { status: res.status, json }; };
  return { call, b, userId: me.user.user_id };
};
const waitFor = async (pred, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(150); } return pred(); };
const to = (token) => received.filter((m) => m.to === token);

const undo = [];
try {
  const kitchen = await login('demo-kitchen@flowxp.test'); const waiter = await login('demo-waiter@flowxp.test'); const other = await login('cafe-manager@flowxp.test');
  const T = { kitchen: tok('kitchen'), waiter: tok('waiter'), other: tok('other'), gone: tok('gone') };
  undo.push(() => pool.query(`DELETE FROM push_devices WHERE token = ANY($1::text[])`, [Object.values(T)]));

  console.log('Registering phones');
  good((await kitchen.call('POST', '/notifications/devices', { token: 'not-a-token' })).status === 400, 'a made-up address is refused');
  good((await kitchen.call('POST', '/notifications/devices', { token: T.kitchen, platform: 'android' })).status === 201, 'the kitchen phone registers');
  good((await waiter.call('POST', '/notifications/devices', { token: T.waiter, platform: 'android' })).status === 201, 'the waiter phone registers');
  good((await other.call('POST', '/notifications/devices', { token: T.other, platform: 'android' })).status === 201, 'a phone from another business registers');
  await waiter.call('POST', '/notifications/devices', { token: T.gone, platform: 'android' });
  const owner = (await pool.query(`SELECT user_id FROM push_devices WHERE token = $1`, [T.gone])).rows[0]?.user_id;
  good(owner === waiter.userId, 'a phone belongs to the person who registered it');
  const mine = await kitchen.call('POST', '/notifications/devices', { token: T.gone, platform: 'android' });
  good((await pool.query(`SELECT user_id FROM push_devices WHERE token = $1`, [T.gone])).rows[0]?.user_id === kitchen.userId, `signing in as someone else on the same phone moves it to them (${mine.status})`);
  await kitchen.call('DELETE', '/notifications/devices', { token: T.gone });
  good(!(await pool.query(`SELECT 1 FROM push_devices WHERE token = $1`, [T.gone])).rows.length, 'a phone can be removed');
  const foreignDelete = await other.call('DELETE', '/notifications/devices', { token: T.kitchen });
  good((await pool.query(`SELECT 1 FROM push_devices WHERE token = $1`, [T.kitchen])).rows.length === 1, `nobody can remove someone else's phone (${foreignDelete.status})`);

  console.log('\nA guest orders from the table QR code');
  const table = (await pool.query(`SELECT t.table_id, t.qr_token, t.name FROM dining_tables t WHERE t.business_id = $1 AND t.qr_token IS NOT NULL ORDER BY t.table_id LIMIT 1`, [waiter.b.business_id])).rows[0];
  good(Boolean(table), 'the demo restaurant has a table with a QR code');
  const menu = (await (await fetch(`${API}/api/public/menu/${table.qr_token}`)).json()).data;
  const dish = menu.categories.flatMap((c) => c.products).find((p) => !(p.modifier_groups?.length) && !(p.modifier_group_ids?.length));
  const guest = (n = 1) => fetch(`${API}/api/public/menu/${table.qr_token}/order`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.7.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ items: [{ product_id: dish.product_id, quantity: n }] }) });
  const started = received.length;
  const r1 = await guest(2);
  good(r1.status === 201, `the guest's order is accepted (${r1.status})`);
  good(await waitFor(() => to(T.kitchen).length > 0 && to(T.waiter).length > 0), 'the kitchen phone and the waiter phone are both told');
  const m = to(T.kitchen)[0];
  good(m && /New order/.test(m.title) && m.channelId === 'alerts' && m.priority === 'high' && m.data.route === '/kitchen', `it rings as an alert and opens the kitchen: "${m?.title}" (${m?.channelId})`);
  good(to(T.other).length === 0, "a phone from another business hears nothing");
  const inbox = Number((await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND type = 'qr_order'`, [kitchen.userId])).rows[0].n);
  good(inbox === 0, 'it is not kept in the inbox (phone only)');

  console.log('\nSomeone switches it off');
  const prefs = (await waiter.call('GET', '/notifications/preferences')).json.data;
  good(prefs.some((p) => p.category === 'orders' && p.push === true), 'the waiter can see the New orders choice, on by default');
  await waiter.call('PUT', '/notifications/preferences', { preferences: [{ category: 'orders', in_app: true, email: false, push: false }] });
  undo.push(() => pool.query(`DELETE FROM notification_preferences WHERE user_id = $1 AND category = 'orders'`, [waiter.userId]));
  const before = { k: to(T.kitchen).length, w: to(T.waiter).length };
  await guest(1);
  await waitFor(() => to(T.kitchen).length > before.k);
  await sleep(1200);
  good(to(T.kitchen).length === before.k + 1 && to(T.waiter).length === before.w, 'the kitchen is still told; the waiter, who switched it off, is not');

  console.log('\nA dish is ready for the waiter');
  const free = ((await waiter.call('GET', '/tables')).json.data || []).find((t) => !t.open_order_id && (t.status ?? 'FREE') === 'FREE');
  const opened = await waiter.call('POST', '/orders', { order_type: 'DINE_IN', table_id: free.table_id }, { 'idempotency-key': key() });
  const oid = opened.json?.data?.order_id ?? opened.json?.data?.order?.order_id;
  undo.push(() => waiter.call('POST', `/orders/${oid}/cancel`, { reason: 'drill' }));
  await waiter.call('POST', `/orders/${oid}/items`, { items: [{ product_id: dish.product_id, quantity: 1 }] }, { 'idempotency-key': key() });
  await waiter.call('POST', `/orders/${oid}/kot`, {});
  const items = (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1 AND sent_at IS NOT NULL`, [oid])).rows.map((r) => r.order_item_id);
  good(items.length > 0, 'the order went to the kitchen');
  const w0 = to(T.waiter).length;
  const adv = await kitchen.call('POST', '/kitchen/advance', { item_ids: items, status: 'READY' });
  good(adv.status === 200, `the kitchen marks it ready (${adv.status})`);
  good(await waitFor(() => to(T.waiter).length > w0), 'the waiter who took the order is told it is ready');
  const rdy = to(T.waiter).slice(-1)[0];
  good(rdy && /ready/i.test(rdy.title) && rdy.data.route === '/tables', `"${rdy?.title}" opens the tables`);
  const k0 = to(T.kitchen).length;
  await sleep(1000);
  good(to(T.kitchen).length === k0 && !to(T.kitchen).some((x) => /ready/i.test(x.title)), 'the kitchen is not told about its own dish');
  const again = to(T.waiter).length;
  await kitchen.call('POST', '/kitchen/advance', { item_ids: items, status: 'SERVED' });
  await sleep(1200);
  good(to(T.waiter).length === again, 'marking it served does not ring the waiter again');

  console.log('\nA phone that is gone, and a push service that is down');
  dead.add(T.kitchen);
  await guest(1);
  await waitFor(() => !true, 100);
  await sleep(2000);
  good(!(await pool.query(`SELECT 1 FROM push_devices WHERE token = $1`, [T.kitchen])).rows.length, 'a phone Expo says is gone is forgotten');
  dead.delete(T.kitchen);
  await kitchen.call('POST', '/notifications/devices', { token: T.kitchen, platform: 'android' });
  down = true;
  const r3 = await guest(1);
  good(r3.status === 201, `the guest's order still goes through while the push service is down (${r3.status})`);
  await sleep(1500);
  const failed = Number((await pool.query(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'push' AND status <> 'DONE' AND last_error IS NOT NULL`)).rows[0].n);
  good(failed >= 1, `the failed push is kept to retry (${failed} waiting)`);
  down = false;
  await pool.query(`UPDATE jobs SET run_at = now() WHERE type = 'push' AND status = 'PENDING'`);
  await sleep(1500);
  const left = Number((await pool.query(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'push' AND status = 'PENDING'`)).rows[0].n);
  good(left === 0, `when it is back, the waiting push is sent (${left} left)`);
} catch (e) { failures++; console.log(`  FAIL  the drill stopped: ${e.message}`); console.error(e); }
finally {
  for (const f of undo.reverse()) { try { await f(); } catch { /* best effort */ } }
  await pool.query(`DELETE FROM jobs WHERE type = 'push' AND status <> 'DONE'`).catch(() => {});
  // the guests' test orders: put the tables back
  await pool.query(`UPDATE orders SET status = 'CANCELLED' WHERE status IN ('OPEN','PREPARING','READY') AND notes IS NULL AND created_by IS NULL AND created_at > now() - interval '10 minutes'`).catch(() => {});
  await stop();
}
console.log(`\n${checks} checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
