/*
 * How fast are product lookups on a big catalogue?   node scripts/perf-retail.js [sizes, e.g. 1000,10000,100000]
 *
 * Builds a throwaway database, loads N products (each with a barcode, an alias and a supplier code), then times the
 * queries a till and the products screen actually run, p50 / p95 over repeated calls with different keys:
 *   barcode scan · SKU lookup · exact code lookup · name search (word, two words, brand) · alias search · list page
 * Nothing here asserts a speed (machines differ); it prints the numbers so a regression shows up.
 */
import { setupTestDb } from '../test/helpers/db.js';

const sizes = (process.argv[2] || '1000,10000,100000').split(',').map(Number);
const { pool, skip, cleanup } = await setupTestDb();
if (skip) { console.log(skip); process.exit(0); }
const { runMigrations } = await import('../src/config/migrate.js');
const { findByCode, searchClause } = await import('../src/modules/productIdentity.js');
await runMigrations(pool);

const trigram = (await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_products_name_trgm'`)).rows.length > 0;
console.log(`trigram indexes: ${trigram ? 'yes' : 'no (pg_trgm unavailable: name searches scan the business)'}\n`);

const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('p','p@perf.test','x') RETURNING user_id`)).rows[0].user_id;
const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Perf','${owner}','SUPERMARKET') RETURNING business_id`)).rows[0].business_id;
await pool.query(`INSERT INTO brands (business_id, name) SELECT $1, 'Brand ' || g FROM generate_series(1, 50) g`, [biz]);
const supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Perf Supplier') RETURNING supplier_id`, [biz])).rows[0].supplier_id;

const WORDS = ['Milk', 'Bread', 'Rice', 'Biscuit', 'Soap', 'Tea', 'Oil', 'Salt', 'Sugar', 'Juice', 'Flour', 'Butter'];
const stats = (ms) => { const s = [...ms].sort((a, b) => a - b); return `${s[Math.floor(s.length * 0.5)].toFixed(1)} / ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms`; };
const time = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); await fn(i); out.push(Number(process.hrtime.bigint() - t) / 1e6); } return stats(out); };

let loaded = 0;
const rows = [];
for (const size of sizes) {
  const from = loaded + 1;
  await pool.query(
    `INSERT INTO products (business_id, name, sku, barcode, selling_price_paise, brand_id)
     SELECT $1, (ARRAY[${WORDS.map((w) => `'${w}'`).join(',')}])[1 + g % ${WORDS.length}] || ' ' || g || ' ' || (g % 7)::text || 'L',
            'SKU-' || lpad(g::text, 7, '0'), '89' || lpad(g::text, 11, '0'), 1000, (SELECT brand_id FROM brands WHERE business_id = $1 ORDER BY brand_id LIMIT 1 OFFSET g % 50)
     FROM generate_series($2::int, $3::int) g`, [biz, from, size]);
  await pool.query(`INSERT INTO product_aliases (business_id, product_id, alias, alias_key) SELECT business_id, product_id, 'alias ' || product_id, 'alias ' || product_id FROM products WHERE business_id = $1 AND product_id NOT IN (SELECT product_id FROM product_aliases)`, [biz]);
  await pool.query(`INSERT INTO product_supplier_codes (business_id, product_id, supplier_id, code) SELECT business_id, product_id, $2, 'SC' || product_id FROM products WHERE business_id = $1 AND product_id NOT IN (SELECT product_id FROM product_supplier_codes)`, [biz, supplier]);
  loaded = size;
  await pool.query('ANALYZE products'); await pool.query('ANALYZE product_barcodes'); await pool.query('ANALYZE product_aliases'); await pool.query('ANALYZE product_supplier_codes');

  const pick = (i) => 1 + ((i * 7919) % size);
  const list = (search, limit = 50) => { const values = [biz]; const clause = searchClause(search, values); return pool.query(`SELECT p.product_id FROM products p LEFT JOIN brands br ON br.brand_id = p.brand_id WHERE p.business_id = $1 AND p.status = 'ACTIVE' ${clause ? `AND ${clause}` : ''} ORDER BY p.name, p.product_id LIMIT ${limit}`, values); };
  rows.push({
    products: size,
    'barcode scan': await time(200, (i) => pool.query(`SELECT product_id FROM product_barcodes WHERE business_id = $1 AND barcode = $2`, [biz, '89' + String(pick(i)).padStart(11, '0')])),
    'exact code': await time(200, (i) => findByCode(pool, biz, 'SKU-' + String(pick(i)).padStart(7, '0'))),
    'supplier code': await time(100, (i) => findByCode(pool, biz, 'SC' + pick(i))),
    'name: one word': await time(40, (i) => list(WORDS[i % WORDS.length].toLowerCase())),
    'name: two words': await time(40, (i) => list(`${WORDS[i % WORDS.length].toLowerCase()} ${pick(i) % 97}`)),
    'by alias': await time(40, (i) => list('alias ' + pick(i))),
    'list page': await time(40, () => list('', 50))
  });
}
console.log('p50 / p95 per call');
console.table(rows);
await cleanup();
