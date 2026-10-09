/* node scripts/security/edges.mjs   (development server running; the demo accounts). Edge cases on the billing endpoint of every business type: bad quantities, prices,
   discounts, products from another business, the same request twice, cancelling twice, odd text, broken JSON. Anything that answers 5xx, or accepts nonsense, is a failure.
   Also builds a temporary cloud kitchen (removed at the end), because there is no demo one. Bills made are cancelled afterwards. */
import bcrypt from 'bcryptjs';
import pool from '../../src/config/database.js';

const base = 'http://localhost:5100';
let failures = 0; let checks = 0; let seq = 0;
const bad = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const good = (cond, m) => { checks++; if (!cond) bad(m); };
const key = () => `edge-${Date.now()}-${seq++}`;

const login = async (email, password = 'demo1234') => {
  const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password }) })).json();
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const headers = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
  const call = async (method, path, body, extra = {}, raw) => { const res = await fetch(base + '/api' + path, { method, headers: { ...headers, ...extra }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }); let json = null; try { json = await res.json(); } catch { /* */ } return { status: res.status, json }; };
  return { call, b };
};

const made = [];
const cancelAll = async (who) => { for (const [path] of made.splice(0)) await who.call('POST', path, {}, { 'idempotency-key': key() }).catch(() => {}); };

/* One suite, given how to make a sale on this type's till. */
const suite = async (label, who, { path, line, extras = {}, foreignProduct, cancelPath }) => {
  console.log(`\n${label}`);
  const sell = (body, extra = {}) => who.call('POST', path, { payment: { method: 'CASH', amount: 'FULL' }, ...extras, ...body }, { 'idempotency-key': key(), ...extra });
  const idOf = (r) => r.json?.data?.invoice?.invoice_id ?? r.json?.data?.invoice_id;
  const keep = (r) => { const id = idOf(r); if (id) made.push([cancelPath(id)]); return r; };
  const refused = async (what, body) => { const r = await sell(body); good(r.status >= 400 && r.status < 500, `${what}: answered ${r.status}, wanted a 4xx${r.status < 300 ? ' (it was ACCEPTED)' : ''}`); if (r.status < 300) keep(r); return r; };

  const ok = keep(await sell({ items: [line(1)] }));
  good(ok.status === 201, `a normal sale works (${ok.status} ${ok.json?.message || ''})`);
  if (ok.status !== 201) return;
  await refused('no items', { items: [] });
  await refused('items missing', {});
  await refused('quantity 0', { items: [line(0)] });
  await refused('negative quantity', { items: [line(-2)] });
  await refused('quantity as text', { items: [line('abc')] });
  await refused('absurd quantity (1e12)', { items: [line(1e12)] });
  await refused('unknown product', { items: [{ ...line(1), product_id: 99999999, ...(line(1).service_id ? { service_id: 99999999 } : {}) }] });
  if (foreignProduct) await refused("another business's product", { items: [{ ...line(1), product_id: foreignProduct, ...(line(1).service_id ? { service_id: foreignProduct } : {}) }] });
  await refused('negative price', { items: [{ ...line(1), unit_price: -5 }] });
  await refused('a discount bigger than the bill', { items: [line(1)], discount: 1e9 });
  await refused('a negative bill discount', { items: [line(1)], discount: -50 });
  await refused('an unknown payment method', { items: [line(1)], payment: { method: 'BITCOIN', amount: 'FULL' }, payments: extras.payments ? [{ method: 'BITCOIN', amount: 'FULL' }] : undefined });
  const longText = 'x'.repeat(5000);
  const long = await sell({ items: [line(1)], notes: longText }); keep(long);
  good(long.status < 500, `5000 characters of notes do not crash (${long.status})`);
  const odd = await sell({ items: [line(1)], notes: '<script>alert(1)</script> \u0000 \u{1F600} \'; DROP TABLE invoices;--' }); keep(odd);
  good(odd.status < 500, `script, null byte, emoji and SQL text in notes do not crash (${odd.status})`);
  const garbage = await who.call('POST', path, undefined, { 'idempotency-key': key() }, '{not json');
  good(garbage.status >= 400 && garbage.status < 500, `broken JSON gets a 4xx (${garbage.status})`);

  const k = key();
  const a = keep(await sell({ items: [line(1)] }, { 'idempotency-key': k }));
  const b2 = await sell({ items: [line(1)] }, { 'idempotency-key': k });
  good(a.status === 201 && b2.status === 201 && idOf(a) === idOf(b2), `the same request twice gives the same bill (${idOf(a)} / ${idOf(b2)}), not two`);

  const target = idOf(ok);
  const c1 = await who.call('POST', cancelPath(target), { reason: 'edge test' }, { 'idempotency-key': key() });
  good(c1.status === 200, `a bill can be cancelled (${c1.status} ${c1.json?.message || ''})`);
  const at = made.findIndex(([p]) => p === cancelPath(target)); if (at >= 0) made.splice(at, 1);
  const c2 = await who.call('POST', cancelPath(target), { reason: 'edge test' }, { 'idempotency-key': key() });
  good(c2.status >= 400 && c2.status < 500, `cancelling it again is refused (${c2.status})`);
  const c3 = await who.call('POST', cancelPath(99999999), { reason: 'edge test' }, { 'idempotency-key': key() });
  good(c3.status === 404, `cancelling a bill that does not exist is a 404 (${c3.status})`);
  await cancelAll(who);
};

const productsOf = async (who) => (await who.call('GET', '/products?limit=60')).json.data || [];
const plain = (ps) => ps.find((p) => p.selling_price >= 50 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT' && p.status !== 'ARCHIVED');

let ck;   // the temporary cloud kitchen
try {
  const cafe = await login('cafe-manager@flowxp.test');
  const others = await login('supermarket@flowxp.test');
  const foreign = plain(await productsOf(others))?.product_id;
  const item = plain(await productsOf(cafe));
  await suite('Cafe', cafe, { path: '/invoices', line: (q) => ({ product_id: item.product_id, quantity: q }), foreignProduct: foreign, cancelPath: (id) => `/invoices/${id}/cancel` });

  const sm = others; const smItem = plain(await productsOf(sm));
  await suite('Supermarket (retail)', sm, { path: '/invoices', line: (q) => ({ product_id: smItem.product_id, quantity: q }), foreignProduct: item.product_id, cancelPath: (id) => `/invoices/${id}/cancel` });

  const ws = await login('wholesale@flowxp.test'); const wsItem = plain(await productsOf(ws));
  if (wsItem) await suite('Wholesale counter bill', ws, { path: '/invoices', line: (q) => ({ product_id: wsItem.product_id, quantity: q }), foreignProduct: item.product_id, cancelPath: (id) => `/invoices/${id}/cancel` });

  const ph = await login('pharmacy@flowxp.test');
  const meds = (await ph.call('GET', '/pharmacy/products?limit=60')).json.data.filter((m) => (m.available ?? m.on_hand ?? 0) >= 5 && m.selling_price >= 20 && !m.prescription_required);
  if (meds[0]) await suite('Pharmacy till', ph, { path: '/pharmacy/pos/invoices', line: (q) => ({ product_id: meds[0].product_id, quantity: q }), extras: { payments: [{ method: 'CASH', amount: 'FULL' }], prescription_checked: true, payment: undefined }, foreignProduct: item.product_id, cancelPath: (id) => `/invoices/${id}/cancel` });

  const sa = await login('salon@flowxp.test');
  const cat = (await sa.call('GET', '/salon/pos/catalog')).json.data; const svc = cat.services.find((s) => s.price >= 100); const staff = cat.staff[0];
  await suite('Salon till', sa, { path: '/salon/pos/invoices', line: (q) => ({ type: 'SERVICE', service_id: svc.service_id, staff_id: staff.staff_id, quantity: q }), extras: { payments: [{ method: 'CASH', amount: 'FULL' }], payment: undefined }, foreignProduct: item.product_id, cancelPath: (id) => `/invoices/${id}/cancel` });

  /* a temporary cloud kitchen: no tables, delivery and takeaway only */
  const hash = await bcrypt.hash('edge-drill-pass-1', 10);
  const email = `ck-drill-${Date.now()}@flowxp.test`;
  const uid = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Drill Owner',$1,$2,TRUE) RETURNING user_id`, [email, hash])).rows[0].user_id;
  const bid = (await pool.query(`INSERT INTO businesses (name, business_type, owner_user_id, email, phone, city, state, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step) VALUES ('Drill Cloud Kitchen','CLOUD_KITCHEN',$1,$2,'9876500999','Pune','Maharashtra',FALSE,'ACTIVE','ENTERPRISE','MONTHLY',10) RETURNING business_id`, [uid, email])).rows[0].business_id;
  await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,'Kitchen 1','K1','Pune','Maharashtra',TRUE)`, [bid]);
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [bid, uid]);
  ck = { bid, uid };
  const owner = await login(email, 'edge-drill-pass-1');
  console.log('\nCloud kitchen (temporary)');
  const made1 = await owner.call('POST', '/products', { name: 'Paneer Bowl', selling_price: 220, kind: 'DISH', track_inventory: false, unit: 'pcs' }, { 'idempotency-key': key() });
  good(made1.status === 201, `adds a dish (${made1.status} ${made1.json?.message || ''})`);
  const dish = made1.json?.data;
  const tables = await owner.call('GET', '/tables');
  good(tables.status === 402 || tables.status === 403 || tables.status === 404 || (tables.status === 200 && (tables.json.data || []).length === 0), `no dining room: tables are off or empty (${tables.status})`);
  const dineIn = await owner.call('POST', '/orders', { order_type: 'DINE_IN' }, { 'idempotency-key': key() });
  good(dineIn.status >= 400 && dineIn.status < 500, `a dine-in order cannot be opened without a table (${dineIn.status})`);
  const del = await owner.call('POST', '/orders', { order_type: 'DELIVERY', customer_name: 'Edge Customer', customer_phone: '9876500998', delivery_address: '12 Test Road, Pune' }, { 'idempotency-key': key() });
  good(del.status === 201, `a delivery order opens (${del.status} ${del.json?.message || ''})`);
  const oid = del.json?.data?.order_id ?? del.json?.data?.order?.order_id;
  if (oid && dish) {
    good((await owner.call('POST', `/orders/${oid}/items`, { items: [{ product_id: dish.product_id, quantity: 2 }] }, { 'idempotency-key': key() })).status < 300, 'adds two dishes to the order');
    good((await owner.call('POST', `/orders/${oid}/items`, { items: [{ product_id: dish.product_id, quantity: 0 }] }, { 'idempotency-key': key() })).status >= 400, 'adding quantity 0 is refused');
    const kot = await owner.call('POST', `/orders/${oid}/kot`, {});
    good(kot.status < 300, `sends it to the kitchen (${kot.status} ${kot.json?.message || ''})`);
    const billed = await owner.call('POST', `/orders/${oid}/bill`, { payment: { method: 'UPI', amount: 'FULL' } }, { 'idempotency-key': key() });
    good(billed.status < 300, `bills it (${billed.status} ${billed.json?.message || ''})`);
    const again = await owner.call('POST', `/orders/${oid}/bill`, { payment: { method: 'CASH', amount: 'FULL' } }, { 'idempotency-key': key() });
    good(again.status >= 400 && again.status < 500, `billing the same order twice is refused (${again.status})`);
  }
  if (dish) await suite('Cloud kitchen counter sale', owner, { path: '/invoices', line: (q) => ({ product_id: dish.product_id, quantity: q }), foreignProduct: item.product_id, cancelPath: (id) => `/invoices/${id}/cancel` });
} catch (e) { bad(`the drill itself stopped: ${e.message}`); console.error(e); }
finally {
  if (ck) {
    try {
      await pool.query(`DELETE FROM businesses WHERE business_id = $1`, [ck.bid]);
      await pool.query(`DELETE FROM users WHERE user_id = $1`, [ck.uid]);
      console.log('\n(temporary cloud kitchen removed)');
    } catch (e) { console.log(`\n(could not remove the temporary cloud kitchen: ${e.message}; business_id ${ck.bid})`); }
  }
  await pool.end();
}
console.log(`\n${checks} checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
