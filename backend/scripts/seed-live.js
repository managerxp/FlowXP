/*
 * A live floor for the demo restaurant, on top of `npm run seed:demo`: open tables and kitchen tickets at every stage,
 * takeaway and delivery orders with riders, today's bookings and waitlist, customer reviews, supplier orders and a
 * Zomato statement to reconcile. Everything goes through the running API (so it needs the dev server up).
 *
 *   npm run seed:live
 */
import 'dotenv/config';
import pool from '../src/config/database.js';

const API = process.env.SEED_API || 'http://localhost:5100/api';
const login = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@flowxp.test', password: 'demo1234' }) })).json();
const token = login.data.token;
const biz = (await pool.query(`SELECT business_id FROM businesses WHERE name = 'FlowXP Demo Restaurant' ORDER BY business_id DESC LIMIT 1`)).rows[0].business_id;
const outlets = (await pool.query(`SELECT branch_id, name FROM branches WHERE business_id = $1 ORDER BY branch_id`, [biz])).rows;
const MG = outlets[0].branch_id;
const call = async (method, path, body, branch = MG) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-branch-id': String(branch), 'idempotency-key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) console.warn(`  ${method} ${path} -> ${r.status} ${j.message || ''}`);
  return j.data;
};
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

// start clean: nothing left open from an earlier run
await pool.query(`UPDATE orders SET status = 'CANCELLED' WHERE business_id = $1 AND status IN ('OPEN','PENDING_ACCEPT') AND branch_id = $2`, [biz, MG]).catch(() => {});
await pool.query(`UPDATE dining_tables SET status = 'FREE' WHERE business_id = $1 AND branch_id = $2`, [biz, MG]).catch(() => {});

const tables = (await call('GET', '/tables')) || [];
const menu = ((await call('GET', '/products?kind=DISH&limit=200')) || []).filter((p) => p.status !== 'ARCHIVED');
const dish = (name) => menu.find((p) => p.name === name);
const customers = (await call('GET', '/customers?limit=40')) || [];
// dishes with a required option (Spice level) take Medium
const medium = (await pool.query(`SELECT m.modifier_id FROM modifiers m JOIN modifier_groups g ON g.group_id = m.group_id WHERE g.business_id = $1 AND g.name = 'Spice level' AND m.name = 'Medium'`, [biz])).rows[0]?.modifier_id;
const spicy = new Set((await pool.query(`SELECT pg.product_id FROM product_modifier_groups pg JOIN modifier_groups g ON g.group_id = pg.group_id WHERE g.business_id = $1 AND g.name = 'Spice level'`, [biz])).rows.map((r) => r.product_id));
const line = (name, quantity = 1) => { const p = dish(name); return { product_id: p.product_id, quantity, ...(spicy.has(p.product_id) && medium ? { modifier_ids: [medium] } : {}) }; };

/* ── dine-in tables, in every state of a meal ── */
const floor = [
  ['T1', [line('Butter Chicken'), line('Butter Naan', 3), line('Cola 300ml', 2)], 'ready'],
  ['T2', [line('Chicken Biryani', 2), line('Plain Rice')], 'cooking'],
  ['T3', [line('Paneer Tikka'), line('Chicken 65'), line('Mutton Biryani')], 'cooking-late'],
  ['T5', [line('Dal Makhani'), line('Tandoori Roti', 4), line('Kadai Paneer')], 'sent'],
  ['T6', [line('Veg Biryani', 3), line('Sweet Lassi', 3)], 'served'],
  ['P1', [line('Egg Curry'), line('Plain Rice', 2)], 'sent']
];
const opened = [];
for (const [name, items, stage] of floor) {
  const table = tables.find((t) => t.name === name);
  if (!table) continue;
  const order = await call('POST', '/orders', { order_type: 'DINE_IN', table_id: table.table_id });
  if (!order) continue;
  await call('POST', `/orders/${order.order_id}/items`, { items });
  await call('POST', `/orders/${order.order_id}/kot`, {});
  opened.push({ order, stage });
}
for (const { order, stage } of opened) {
  const items = (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1 ORDER BY order_item_id`, [order.order_id])).rows.map((r) => r.order_item_id);
  if (stage === 'cooking' || stage === 'cooking-late') await call('POST', '/kitchen/advance', { item_ids: items, status: 'PREPARING' });
  if (stage === 'ready') { await call('POST', '/kitchen/advance', { item_ids: items, status: 'PREPARING' }); await call('POST', '/kitchen/advance', { item_ids: items.slice(0, 2), status: 'READY' }); }
  if (stage === 'served') { await call('POST', '/kitchen/advance', { item_ids: items, status: 'PREPARING' }); await call('POST', '/kitchen/advance', { item_ids: items, status: 'READY' }); await call('POST', '/kitchen/advance', { item_ids: items, status: 'SERVED' }); }
  const sent = { 'cooking-late': 24, cooking: 9, ready: 16, served: 38, sent: 3 }[stage];
  await pool.query(`UPDATE order_items SET sent_at = $2::timestamptz WHERE order_id = $1`, [order.order_id, minutesAgo(sent)]);
  if (stage === 'ready' || stage === 'served') await pool.query(`UPDATE order_items SET ready_at = $2::timestamptz WHERE order_id = $1 AND status IN ('READY','SERVED')`, [order.order_id, minutesAgo(Math.max(1, sent - 11))]);
}
// one table is waiting on a rush ticket
if (opened[3]) await call('POST', `/kitchen/orders/${opened[3].order.order_id}/rush`, {});

/* ── takeaway and delivery with a rider ── */
const rider = await pool.query(`SELECT user_id FROM users WHERE email = 'demo-rider@flowxp.test'`);
let riderId = rider.rows[0]?.user_id;
if (!riderId) {
  riderId = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Mohan Das','demo-rider@flowxp.test',(SELECT password_hash FROM users WHERE email = 'demo@flowxp.test'),TRUE) RETURNING user_id`)).rows[0].user_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,'DELIVERY','ACTIVE',$3)`, [biz, riderId, MG]);
  await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) SELECT 'Sunil Yadav','demo-rider2@flowxp.test',password_hash,TRUE FROM users WHERE email = 'demo@flowxp.test' ON CONFLICT DO NOTHING`);
  const second = (await pool.query(`SELECT user_id FROM users WHERE email = 'demo-rider2@flowxp.test'`)).rows[0]?.user_id;
  if (second) await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,'DELIVERY','ACTIVE',$3) ON CONFLICT DO NOTHING`, [biz, second, MG]);
}
const riders = (await call('GET', '/orders/riders')) || [];
const deliveries = [
  [customers[1], [line('Chicken Biryani', 2), line('Cola 300ml', 2)], 'DELIVERY', 'out'], [customers[4], [line('Paneer Butter Masala'), line('Butter Naan', 4)], 'DELIVERY', 'picked'],
  [customers[7], [line('Veg Biryani'), line('Gulab Jamun', 2)], 'DELIVERY', 'new'], [customers[9], [line('Tandoori Roti', 6), line('Dal Tadka')], 'TAKEAWAY', 'ready'],
  [customers[12], [line('Chicken Curry'), line('Plain Rice', 2)], 'TAKEAWAY', 'cooking']
];
for (const [cust, items, type, stage] of deliveries) {
  if (!cust) continue;
  const order = await call('POST', '/orders', { order_type: type, customer_id: cust.customer_id, notes: type === 'DELIVERY' ? `Deliver to ${cust.name}, ${int(10, 90)} 4th Cross, Indiranagar` : undefined });
  if (!order) continue;
  await call('POST', `/orders/${order.order_id}/items`, { items });
  await call('POST', `/orders/${order.order_id}/kot`, {});
  const ids = (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1`, [order.order_id])).rows.map((r) => r.order_item_id);
  if (stage !== 'new') await call('POST', '/kitchen/advance', { item_ids: ids, status: 'PREPARING' });
  if (['ready', 'out', 'picked'].includes(stage)) await call('POST', '/kitchen/advance', { item_ids: ids, status: 'READY' });
  if (type === 'DELIVERY' && riders.length && stage !== 'new') {
    await call('PATCH', `/orders/${order.order_id}/rider`, { rider_user_id: riders[stage === 'out' ? 0 : riders.length - 1].user_id });
    await call('POST', `/orders/${order.order_id}/delivery-status`, { status: 'PICKED_UP' });
    if (stage === 'out') await call('POST', `/orders/${order.order_id}/delivery-status`, { status: 'OUT_FOR_DELIVERY' });
  }
  await pool.query(`UPDATE order_items SET sent_at = $2::timestamptz WHERE order_id = $1`, [order.order_id, minutesAgo({ out: 31, picked: 22, new: 2, ready: 12, cooking: 6 }[stage])]);
}
function int(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

/* ── bookings and the waitlist ── */
const at = (hours, minutes = 0) => { const d = new Date(); d.setHours(hours, minutes, 0, 0); return d.toISOString(); };
const free = tables.filter((t) => !floor.some(([n]) => n === t.name));
for (const [i, [name, party, hh, mm, phone]] of [['Rahul Menon', 4, 19, 30, '9845012345'], ['Sneha Rao', 2, 20, 0, '9845012346'], ['Anand Pillai', 6, 20, 30, '9845012347'], ['Kiran Shah', 3, 21, 0, '9845012348'], ['Divya Nair', 2, 21, 15, '9845012349']].entries()) {
  await call('POST', '/reservations', { guest_name: name, party_size: party, phone, reserved_at: at(hh, mm), table_id: free[i % Math.max(1, free.length)]?.table_id });
}
await call('POST', '/waitlist', { guest_name: 'Farhan K', party_size: 2, phone: '9845099001' });
await call('POST', '/waitlist', { guest_name: 'Meera Kapoor', party_size: 4, phone: '9845099002' });

/* ── customer reviews on recent bills ── */
// a bill's link (and so its feedback form) exists once someone has shared it: give the latest ones theirs
await pool.query(`UPDATE invoices SET share_token = substr(md5(random()::text || invoice_id::text), 1, 24) WHERE invoice_id IN (SELECT invoice_id FROM invoices WHERE business_id = $1 AND status <> 'CANCELLED' AND share_token IS NULL ORDER BY invoice_id DESC LIMIT 60)`, [biz]);
const bills = (await pool.query(`SELECT share_token FROM invoices WHERE business_id = $1 AND status <> 'CANCELLED' AND share_token IS NOT NULL ORDER BY invoice_id DESC LIMIT 60`, [biz])).rows;
const reviews = [[5, 'Biryani was spot on and the service was quick. Will be back this weekend.'], [5, 'Loved the butter chicken. Staff were very friendly.'], [4, 'Good food, a bit of a wait for the naan.'], [5, 'Best biryani in the area, and the QR ordering at the table was so easy.'],
  [2, 'Food arrived cold and we waited 40 minutes for the bill.'], [4, 'Great taste. Parking is a problem but the food makes up for it.'], [3, 'Decent food, portion was smaller than last time.'], [5, 'Birthday dinner here, they brought a free dessert. Thank you!']];
for (const [i, [rating, comment]] of reviews.entries()) {
  if (!bills[i * 3]) continue;
  await fetch(`${API}/public/bill/${bills[i * 3].share_token}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating, comment }) }).catch(() => {});
}

/* ── supplier orders in different states ── */
const suppliers = (await call('GET', '/suppliers')) || [];
const ingredients = ((await call('GET', '/products?kind=INGREDIENT&limit=50')) || []);
const ing = (name) => ingredients.find((p) => p.name === name);
for (const [i, items] of [[0, [['Chicken', 40, 232], ['Mutton', 12, 690]]], [1, [['Paneer', 15, 322], ['Cheese', 8, 410]]], [2, [['Basmati Rice', 60, 91], ['Maida', 30, 40]]]].map(([i, l]) => [i, l])) {
  const supplier = suppliers[i];
  if (!supplier) continue;
  const po = await call('POST', '/purchases/orders', { supplier_id: supplier.supplier_id, expected_date: new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10), items: items.filter(([n]) => ing(n)).map(([n, quantity, unit_cost]) => ({ product_id: ing(n).product_id, quantity, unit_cost })) });
  if (po && i < 2) await call('POST', `/purchases/${po.po_id}/send`, {});
}

/* ── a Zomato statement to reconcile: most lines match, one is short, one does not add up ── */
const missing = (await call('GET', '/settlements/missing?platform=ZOMATO')) || {};
const rows = (missing.orders || missing.rows || []).slice(0, 7);
const statement = rows.map((o, i) => {
  const gross = Number(o.total ?? o.amount ?? 0); const commission = Math.round(gross * 22) / 100; const pay = Math.round(gross * 2) / 100;
  const net = i === 4 ? Math.round((gross - commission - pay - 40) * 100) / 100 : Math.round((gross - commission - pay) * 100) / 100;
  return { external_order_id: o.external_order_number || o.external_order_id, settlement_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), gross_amount: i === 5 ? gross - 20 : gross, commission, payment_charges: pay, delivery_charges: 0, tax: 0, other_deductions: 0, net_settled: net };
}).filter((r) => r.external_order_id);
if (statement.length) await call('POST', '/settlements/import', { platform: 'ZOMATO', rows: statement });

console.log(`Live floor ready for ${outlets[0].name}: ${opened.length} tables open, ${deliveries.length} takeaway and delivery orders, 5 bookings, ${statement.length} statement lines.`);
await pool.end();
