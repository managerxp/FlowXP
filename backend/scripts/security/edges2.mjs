/* node scripts/security/edges2.mjs   (development server running; the demo accounts). Edge cases beyond the till: a cafe table's order (empty, huge, billed twice, cancelled
   then billed, moved to a taken table), a wholesale sales order, and a sale from a van (more than it holds, bad quantities, another business's shop, the same sale
   twice). 5xx or a wrongly accepted request is a failure. Everything made is cancelled or put back. */
import pool from '../../src/config/database.js';

const base = 'http://localhost:5100';
let failures = 0; let checks = 0; let seq = 0;
const bad = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const good = (cond, m) => { checks++; if (!cond) bad(m); };
const key = () => `edge2-${Date.now()}-${seq++}`;
const is4 = (s) => s >= 400 && s < 500;

const login = async (email) => {
  const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) })).json();
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const headers = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
  const call = async (method, path, body, extra = {}) => { const res = await fetch(base + '/api' + path, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }); let json = null; try { json = await res.json(); } catch { /* */ } return { status: res.status, json }; };
  return { call, b };
};
const cleanup = [];

try {
  /* ── a cafe table's order ─────────────────────────────────────────────── */
  console.log('Cafe: table orders');
  const cafe = await login('cafe-manager@flowxp.test');
  const prod = ((await cafe.call('GET', '/products?limit=60')).json.data || []).find((p) => p.selling_price >= 50 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT');
  const tables = (await cafe.call('GET', '/tables')).json.data || [];
  const free = tables.filter((t) => !t.open_order_id && (t.status ?? 'FREE') === 'FREE');
  good(free.length >= 2, `there are two free tables to test with (${free.length})`);
  if (free.length >= 2) {
    const open = async (t) => { const r = await cafe.call('POST', '/orders', { order_type: 'DINE_IN', table_id: t.table_id }, { 'idempotency-key': key() }); const id = r.json?.data?.order_id ?? r.json?.data?.order?.order_id; if (id) cleanup.push(() => cafe.call('POST', `/orders/${id}/cancel`, { reason: 'edge' })); return { r, id }; };
    const a = await open(free[0]);
    good(a.r.status === 201, `opens a tab on ${free[0].name} (${a.r.status} ${a.r.json?.message || ''})`);
    const dup = await cafe.call('POST', '/orders', { order_type: 'DINE_IN', table_id: free[0].table_id }, { 'idempotency-key': key() });
    good(dup.status !== 500 && (is4(dup.status) || dup.json?.data?.order_id === a.id || dup.json?.data?.order?.order_id === a.id), `a second tab on a taken table is refused or returns the same tab (${dup.status})`);
    good(is4((await cafe.call('POST', '/orders', { order_type: 'DINE_IN', table_id: 99999999 }, { 'idempotency-key': key() })).status), 'a table that does not exist is refused');
    good(is4((await cafe.call('POST', '/orders', { order_type: 'TELEPORT' }, { 'idempotency-key': key() })).status), 'an unknown order type is refused');
    const emptyKot = await cafe.call('POST', `/orders/${a.id}/kot`, {});
    good(emptyKot.status < 500, `sending an empty order to the kitchen does not crash (${emptyKot.status})`);
    const emptyBill = await cafe.call('POST', `/orders/${a.id}/bill`, { payment: { method: 'CASH', amount: 'FULL' } }, { 'idempotency-key': key() });
    good(is4(emptyBill.status), `billing an empty order is refused (${emptyBill.status})`);
    good(is4((await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ product_id: prod.product_id, quantity: -1 }] }, { 'idempotency-key': key() })).status), 'adding a negative quantity is refused');
    good(is4((await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ product_id: prod.product_id, quantity: 99999 }] }, { 'idempotency-key': key() })).status), 'adding 99,999 of a dish is refused');
    good(is4((await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ product_id: 99999999, quantity: 1 }] }, { 'idempotency-key': key() })).status), 'adding a product that does not exist is refused');
    good(is4((await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ description: 'Custom thing', quantity: 1 }] }, { 'idempotency-key': key() })).status), 'a custom line with no price is refused');
    const added = await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ product_id: prod.product_id, quantity: 2 }] }, { 'idempotency-key': key() });
    good(added.status < 300, 'adds two to the tab');
    const k = key();
    const added2 = await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ product_id: prod.product_id, quantity: 1 }] }, { 'idempotency-key': k });
    const added3 = await cafe.call('POST', `/orders/${a.id}/items`, { items: [{ product_id: prod.product_id, quantity: 1 }] }, { 'idempotency-key': k });
    const detail = (await cafe.call('GET', `/orders/${a.id}`)).json?.data;
    const lines = (detail?.items || detail?.order?.items || []).filter((i) => i.status !== 'CANCELLED');
    const qty = lines.reduce((n, i) => n + Number(i.quantity), 0);
    good(added2.status < 300 && added3.status < 300 && qty === 3, `adding the same thing twice with one key adds it once (tab holds ${qty}, wanted 3)`);
    const moved = await cafe.call('POST', `/orders/${a.id}/transfer`, { table_id: 99999999 }, { 'idempotency-key': key() });
    good(is4(moved.status), `moving a tab to a table that does not exist is refused (${moved.status})`);
    const b2 = await open(free[1]);
    const taken = await cafe.call('POST', `/orders/${a.id}/transfer`, { table_id: free[1].table_id }, { 'idempotency-key': key() });
    good(taken.status !== 500, `moving a tab onto a table with its own tab does not crash (${taken.status})`);
    const over = await cafe.call('POST', `/orders/${a.id}/bill`, { payment: { method: 'CASH', amount: 1e9 }, items: [{ order_item_id: 99999999, quantity: 1 }] }, { 'idempotency-key': key() });
    good(over.status !== 500, `billing a part that is not on the tab does not crash (${over.status})`);
    const bill1 = await cafe.call('POST', `/orders/${a.id}/bill`, { payment: { method: 'CASH', amount: 'FULL' } }, { 'idempotency-key': key() });
    good(bill1.status < 300, `bills the tab (${bill1.status} ${bill1.json?.message || ''})`);
    const inv = bill1.json?.data?.invoice_id ?? bill1.json?.data?.invoice?.invoice_id;
    if (inv) cleanup.push(() => cafe.call('POST', `/invoices/${inv}/cancel`, { reason: 'edge' }));
    const bill2 = await cafe.call('POST', `/orders/${a.id}/bill`, { payment: { method: 'CASH', amount: 'FULL' } }, { 'idempotency-key': key() });
    good(is4(bill2.status), `billing it again is refused (${bill2.status})`);
    const cancelBilled = await cafe.call('POST', `/orders/${a.id}/cancel`, { reason: 'edge' });
    good(cancelBilled.status !== 500, `cancelling a billed tab does not crash (${cancelBilled.status})`);
    const bill3 = await cafe.call('POST', `/orders/${b2.id}/bill`, { payment: { method: 'CASH', amount: 'FULL' } }, { 'idempotency-key': key() });
    good(is4(bill3.status), `billing an untouched empty tab is refused (${bill3.status})`);
  }

  /* ── wholesale sales order ────────────────────────────────────────────── */
  console.log('\nWholesale: sales orders');
  const ws = await login('wholesale@flowxp.test');
  const wsProducts = (await ws.call('GET', '/wholesale/products?limit=40')).json.data || [];
  const wsCustomers = (await ws.call('GET', '/wholesale/customers?limit=20')).json.data || [];
  const wp = wsProducts.find((p) => p.status !== 'ARCHIVED') ?? wsProducts[0]; const wc = wsCustomers.find((c) => c.status !== 'ARCHIVED') ?? wsCustomers[0];
  good(Boolean(wp && wc), 'a product and a customer exist to test with');
  if (wp && wc) {
    const order = (items, extra = {}) => ws.call('POST', '/wholesale/orders', { customer_id: wc.customer_id, lines: items, ...extra }, { 'idempotency-key': key() });
    const L = (q, extra = {}) => ({ product_id: wp.product_id, quantity: q, ...extra });
    for (const [what, items] of [['no lines', []], ['quantity 0', [L(0)]], ['negative quantity', [L(-3)]], ['quantity as text', [L('many')]], ['absurd quantity', [L(1e12)]], ['a product that does not exist', [{ product_id: 99999999, quantity: 1 }]]]) {
      const r = await order(items); good(is4(r.status), `${what}: ${r.status}${r.status < 300 ? ' (ACCEPTED)' : ''}`);
      const id = r.json?.data?.order_id; if (id && r.status < 300) cleanup.push(() => ws.call('POST', `/wholesale/orders/${id}/cancel`, { reason: 'edge' }));
    }
    good(is4((await ws.call('POST', '/wholesale/orders', { customer_id: 99999999, lines: [L(1)] }, { 'idempotency-key': key() })).status), 'a customer that does not exist is refused');
    good(is4((await order([L(1, { price: -10 })])).status), 'a negative price is refused');
    good(is4((await order([L(1, { discount_pct: 150 })])).status), 'a discount of 150% is refused');
    const moq = Number(wp.moq ?? wp.wholesale?.moq ?? wp.min_order_qty ?? 12) || 12; const ok1 = await order([L(Math.max(moq, 12))]);
    good(ok1.status === 201, `a normal order is accepted (${ok1.status} ${ok1.json?.message || ''})`);
    const oid = ok1.json?.data?.order_id;
    if (oid) {
      cleanup.push(() => ws.call('POST', `/wholesale/orders/${oid}/cancel`, { reason: 'edge' }));
      const k = key();
      const s1 = await ws.call('POST', `/wholesale/orders/${oid}/submit`, {}, { 'idempotency-key': k }); const s2 = await ws.call('POST', `/wholesale/orders/${oid}/submit`, {}, { 'idempotency-key': k });
      good(s1.status < 500 && s2.status === s1.status, `submitting twice with one key answers the same (${s1.status}/${s2.status})`);
      const c1 = await ws.call('POST', `/wholesale/orders/${oid}/cancel`, { reason: 'edge' }, { 'idempotency-key': key() });
      const c2 = await ws.call('POST', `/wholesale/orders/${oid}/cancel`, { reason: 'edge' }, { 'idempotency-key': key() });
      good(c1.status < 500 && is4(c2.status), `cancelling twice: ${c1.status} then ${c2.status}`);
      const conf = await ws.call('POST', `/wholesale/orders/${oid}/confirm`, {}, { 'idempotency-key': key() });
      good(is4(conf.status), `confirming a cancelled order is refused (${conf.status})`);
    }
    good((await ws.call('GET', '/wholesale/orders/99999999')).status === 404, 'an order that does not exist is a 404');
  }

  /* ── a sale from a van ────────────────────────────────────────────────── */
  console.log('\nVan sales');
  const fs = await login('wholesale-field1@flowxp.test');
  const vans = (await fs.call('GET', '/distributor/vehicles')).json.data || [];
  const van = vans[0];
  good(Boolean(van), `the salesperson has a van (${vans.length})`);
  if (van) {
    const detail = (await fs.call('GET', `/distributor/vehicles/${van.vehicle_id}`)).json.data;
    const stock = (detail.stock || detail.lines || detail.items || []).find((s) => Number(s.qty ?? s.quantity ?? s.on_van ?? 0) >= 40);
    const shops = (await fs.call('GET', '/distributor/field/today')).json?.data?.beats?.flatMap((b) => b.customers || []) || [];
    const shop = shops[0];
    good(Boolean(stock && shop), `there is stock on the van and a shop to sell to (${stock ? 'stock' : 'no stock'}, ${shop ? 'shop' : 'no shop'})`);
    if (stock && shop) {
      const pid = stock.product_id;
      const sell = (lines, extra = {}, headers = {}) => fs.call('POST', `/distributor/vehicles/${van.vehicle_id}/sell`, { customer_id: shop.customer_id, lines, invoice_kind: 'TAX', payment: { amount: 'FULL', method: 'CASH' }, ...extra }, { 'idempotency-key': key(), ...headers });
      for (const [what, lines] of [['no lines', []], ['quantity 0', [{ product_id: pid, quantity: 0 }]], ['negative quantity', [{ product_id: pid, quantity: -4 }]], ['quantity as text', [{ product_id: pid, quantity: 'lots' }]], ['more than the van holds', [{ product_id: pid, quantity: 1e6 }]], ['a product that is not on the van', [{ product_id: 99999999, quantity: 1 }]]]) {
        const r = await sell(lines); good(is4(r.status), `${what}: ${r.status}${r.status < 300 ? ' (ACCEPTED)' : ''}`);
      }
      good(is4((await sell([{ product_id: pid, quantity: 12 }], { customer_id: 99999999 })).status), 'a shop that does not exist is refused');
      const other = await login('cafe@flowxp.test');
      const foreign = ((await other.call('GET', '/customers?limit=5')).json.data || [])[0];
      if (foreign) good(is4((await sell([{ product_id: pid, quantity: 12 }], { customer_id: foreign.customer_id })).status), "another business's customer is refused");
      const before = (await fs.call('GET', `/distributor/vehicles/${van.vehicle_id}`)).json.data;
      const k = key();
      const one = await sell([{ product_id: pid, quantity: 12 }], {}, { 'idempotency-key': k }); const two = await sell([{ product_id: pid, quantity: 12 }], {}, { 'idempotency-key': k });
      good(one.status < 300 && two.status < 300 && (one.json.data.invoice_id === two.json.data.invoice_id), `the same van sale twice is one bill (${one.status} ${one.json?.message || ''} ${one.json?.data?.invoice_id} / ${two.status} ${two.json?.data?.invoice_id})`);
      const inv = one.json?.data?.invoice_id; if (inv) cleanup.push(async () => { const m = await login('wholesale@flowxp.test'); await m.call('POST', `/invoices/${inv}/cancel`, { reason: 'edge' }); });
      const after = (await fs.call('GET', `/distributor/vehicles/${van.vehicle_id}`)).json.data;
      const q = (d) => Number((d.stock || d.lines || d.items || []).find((s) => s.product_id === pid)?.qty ?? 0);
      good(q(before) - q(after) > 0 && q(before) - q(after) <= 12.0001, `the van lost one sale's worth, not two (${q(before)} -> ${q(after)})`);
      const off = await sell([{ product_id: pid, quantity: 12 }], {}, { 'X-Offline-Sale': '1', 'X-Sale-Date': '2020-01-01' });
      good(off.status < 500, `an offline sale with an absurd old date does not crash (${off.status})`);
      const offId = off.json?.data?.invoice_id; if (offId) cleanup.push(async () => { const m = await login('wholesale@flowxp.test'); await m.call('POST', `/invoices/${offId}/cancel`, { reason: 'edge' }); });
    }
  }
} catch (e) { bad(`the drill itself stopped: ${e.message}`); console.error(e); }
finally {
  for (const f of cleanup.reverse()) { try { await f(); } catch { /* best effort */ } }
  await pool.end();
}
console.log(`\n${checks} checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
