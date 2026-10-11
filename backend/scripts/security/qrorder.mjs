/* node scripts/security/qrorder.mjs  (development server running; demo café with QR ordering). What a guest at a table can send, however many devices it comes from.
   The test orders are cancelled and the table's order count reset afterwards. */
import pool from '../../src/config/database.js';
const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok  ' + m); };
const base = 'http://localhost:5100/api/public/menu';
const t = (await pool.query(`SELECT t.table_id, t.business_id, t.qr_token FROM dining_tables t JOIN businesses b ON b.business_id = t.business_id WHERE t.qr_token IS NOT NULL AND b.business_type = 'RESTAURANT' ORDER BY t.table_id LIMIT 1`)).rows[0];
if (!t) { console.log('no table with a QR token'); await pool.end(); process.exit(1); }
const started = new Date();
const menu = (await (await fetch(`${base}/${t.qr_token}`)).json()).data;
const prod = (menu.categories?.flatMap((c) => c.items || c.products || []) || menu.items || menu.products || []).find((p) => !(p.modifier_groups?.length) && !(p.modifier_group_ids?.length));
if (!prod) throw new Error('no plain menu item found: ' + Object.keys(menu));
const pid = prod.product_id ?? prod.id;
const post = async (items, ip) => { const r = await fetch(`${base}/${t.qr_token}/order`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || '10.9.9.' + Math.floor(Math.random() * 200) }, body: JSON.stringify({ items }) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const placed = [];
try {
  const big = await post([{ product_id: pid, quantity: 500 }]);
  ok(big.status === 400, `500 of one dish in one go is refused: "${big.json?.message}"`);
  const wide = await post(Array.from({ length: 31 }, () => ({ product_id: pid, quantity: 1 })));
  ok(wide.status === 400, '31 lines in one order is refused');
  const many = await post([{ product_id: pid, quantity: 20 }, { product_id: pid, quantity: 20 }, { product_id: pid, quantity: 20 }, { product_id: pid, quantity: 1 }]);
  ok(many.status === 400, 'more than 60 portions in one order is refused');
  const fine = await post([{ product_id: pid, quantity: 2 }]);
  ok(fine.status === 201, 'a normal order goes through (' + fine.status + ')'); placed.push(fine.json.data.order_number);
  let last = fine;
  for (let i = 0; i < 12 && last.status === 201; i++) { last = await post([{ product_id: pid, quantity: 1 }]); if (last.status === 201) placed.push(last.json.data.order_number); }
  ok(last.status === 429, `after a dozen orders in an hour the table is refused, whichever device it comes from: "${last.json?.message}"`);
} finally {
  await pool.query(`DELETE FROM audit_log WHERE business_id = $1 AND action = 'order.placed_by_customer' AND created_at >= $2`, [t.business_id, started]);
  if (placed.length) await pool.query(`UPDATE orders SET status = 'CANCELLED' WHERE business_id = $1 AND order_number = ANY($2)`, [t.business_id, placed]);
  await pool.end();
}
console.log('All good.');
