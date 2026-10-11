/* node scripts/security/offline.mjs  (development server running; demo café). A sale sent with the offline header is written down as one in the audit log. */
import pool from '../../src/config/database.js';
const base = 'http://localhost:5100';
const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: 'cafe-barista@flowxp.test', password: 'demo1234' }) })).json();
const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
const b = me.businesses[0];
const h = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
const item = (await (await fetch(base + '/api/products?limit=60', { headers: h })).json()).data.find((p) => p.selling_price >= 50 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT');
const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const send = (extra) => fetch(base + '/api/invoices', { method: 'POST', headers: { ...h, 'idempotency-key': 'offline-drill-' + Date.now() + Math.random(), ...extra }, body: JSON.stringify({ items: [{ product_id: item.product_id, quantity: 1 }], payment: { method: 'CASH', amount: 'FULL' } }) }).then((x) => x.json());
const off = await send({ 'x-offline-sale': '1', 'x-sale-date': day });
const on = await send({});
await new Promise((x) => setTimeout(x, 400));
const meta = async (id) => (await pool.query(`SELECT metadata FROM audit_log WHERE action = 'invoice.created' AND resource_id = $1`, [String(id)])).rows[0]?.metadata;
const a = await meta(off.data.invoice_id); const c = await meta(on.data.invoice_id);
const good = a?.offline === true && a.claimed_date === day && !('offline' in (c || {}));
console.log(good ? '  ok  offline sale is marked in the audit log (claimed ' + a.claimed_date + '); an ordinary one is not' : ' FAIL ' + JSON.stringify({ a, c }));
for (const id of [off.data.invoice_id, on.data.invoice_id]) {
  const m = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: 'cafe-manager@flowxp.test', password: 'demo1234' }) })).json();
  await fetch(`${base}/api/invoices/${id}/cancel`, { method: 'POST', headers: { ...h, authorization: 'Bearer ' + m.data.token, 'idempotency-key': 'c' + id + Date.now() }, body: '{}' });
}
await pool.end(); process.exit(good ? 0 : 1);
