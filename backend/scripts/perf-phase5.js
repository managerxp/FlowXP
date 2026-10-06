/*
 * How fast are the Phase 5 paths on a big catalogue?   node scripts/perf-phase5.js [products, default 100000]
 *
 * Builds a throwaway database with N products (barcodes, supplier codes) and 100 offers, then times, p50 / p95 over repeated runs:
 *   price a 300-line cart with 100 offers (pure)  ·  the same through the cart-preview endpoint  ·  make a 40-line bill with offers
 *   match 200 supplier-bill lines to products (barcode, code, wording, then name)  ·  find a bill for a return by number
 * Nothing here asserts a speed (machines differ); it prints the numbers so a regression shows up.
 */
import { setupTestDb } from '../test/helpers/db.js';

const N = Number(process.argv[2] || 100000);
const { pool, skip, cleanup } = await setupTestDb();
if (skip) { console.log(skip); process.exit(0); }
const { runMigrations } = await import('../src/config/migrate.js');
const { priceLines } = await import('../src/modules/promotions.js');
const { matchLines } = await import('../src/modules/invoiceMatch.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const offers = await import('../src/controllers/promotions.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
await runMigrations(pool);

const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('p','p@perf5.test','x') RETURNING user_id`)).rows[0].user_id;
const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state) VALUES ('Perf','${owner}','SUPERMARKET',TRUE,'Karnataka') RETURNING business_id`)).rows[0].business_id;
const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
const supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Perf Supplier') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
const WORDS = ['Milk', 'Bread', 'Rice', 'Biscuit', 'Soap', 'Tea', 'Oil', 'Salt', 'Sugar', 'Juice', 'Flour', 'Butter'];

process.stdout.write(`loading ${N} products… `);
const t0 = Date.now();
await pool.query(
  `INSERT INTO products (business_id, name, sku, barcode, kind, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory)
   SELECT $1, ('Brand ' || (g % 50) || ' ' || ($2::text[])[1 + g % 12] || ' ' || (50 + g % 900) || 'g #' || g), 'SKU' || g, (8900000000000 + g)::text, 'DISH', 'pc', 5000 + g % 4000, 3000, 5, FALSE
   FROM generate_series(1, $3::int) g`, [biz, WORDS, N]);
await pool.query(`INSERT INTO product_supplier_codes (business_id, product_id, supplier_id, code) SELECT business_id, product_id, $2, 'SC' || product_id FROM products WHERE business_id = $1 AND product_id % 4 = 0`, [biz, supplier]);
await pool.query(`ANALYZE products`);
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
const ids = (await pool.query(`SELECT product_id, name FROM products WHERE business_id = $1 ORDER BY product_id LIMIT 600`, [biz])).rows;
for (let i = 0; i < 100; i++) {
  await pool.query(`INSERT INTO promotions (business_id, name, kind, product_id, percent) VALUES ($1,$2,'PERCENT_OFF',$3,10)`, [biz, `Offer ${i}`, ids[i].product_id]);
}

const stats = (ms) => { const s = [...ms].sort((a, b) => a - b); return `${s[Math.floor(s.length * 0.5)].toFixed(1)} / ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms`; };
const time = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); await fn(i); out.push(Number(process.hrtime.bigint() - t) / 1e6); } return stats(out); };
const tenant = { businessId: biz, branchId: branch, scopeBranchId: null, role: 'OWNER', permissions: {}, businessType: 'SUPERMARKET', planFeatures: {} };

const promos = (await pool.query(`SELECT * FROM promotions WHERE business_id = $1`, [biz])).rows;
const cart = (n) => ids.slice(0, n).map((p, index) => ({ index, product_id: p.product_id, category_id: null, quantity: 1 + (index % 3), unitPricePaise: 6000, discountPaise: 0 }));
console.log(`\n(p50 / p95)`);
console.log(`price a 300-line cart, 100 offers (pure)    ${await time(200, () => priceLines(promos, cart(300)))}`);
console.log(`cart preview endpoint, 300 lines            ${await time(30, async () => { await offers.preview({ tenant, body: { lines: cart(300).map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price: 60 })) } }, { json() {}, status() { return this; } }); })}`);
console.log(`make a 40-line bill with offers             ${await time(15, async (i) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await createInvoiceInTransaction(client, tenant, owner, { items: ids.slice(i * 40 % 500, i * 40 % 500 + 40).map((p) => ({ product_id: p.product_id, quantity: 2 })), applyPromotions: true, payment: { amount: 'FULL' } }); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
})}`);

const billLines = (n) => Array.from({ length: n }, (_, i) => {
  const id = 1000 + ((i * 97) % (N - 1000));
  return i % 4 === 0 ? { description: 'x', barcode: String(8900000000000 + id) }
    : i % 4 === 1 ? { description: 'x', supplier_code: `SC${Math.ceil(id / 4) * 4}` }
      : { description: `Brand ${id % 50} ${WORDS[id % 12]} ${50 + (id % 900)}gm` };
});
console.log(`match 200 bill lines to ${N} products        ${await time(8, () => matchLines(pool, { businessId: biz, supplierId: supplier, lines: billLines(200) }))}`);

const invs = await invoices.list({ tenant, auth: { userId: owner }, query: { search: 'INV-000' }, params: {}, headers: {} }, { json() {}, status() { return this; } });
console.log(`find a bill for a return (search by number) ${await time(30, async (i) => { await invoices.list({ tenant, auth: { userId: owner }, query: { search: `INV-${String(i + 1).padStart(4, '0')}` }, params: {}, headers: {} }, { json() {}, status() { return this; } }); })}`);
void invs;
await cleanup();
