/*
 * How fast are the parts counter's queries on a big catalogue?   node scripts/perf-autoparts.js [sizes, e.g. 10000,100000]
 *
 * Builds a throwaway database, loads N parts (each with an OEM and a manufacturer number, three fitment rows, stock and a bin), then times what the counter
 * actually runs, p50 / p95 over repeated calls with different keys:
 *   counter lookup by OEM number (typed without dashes) · by SKU · by words · parts for a vehicle · where one part is · list page · reconciliation
 * Nothing here asserts a speed (machines differ); it prints the numbers so a regression shows up.
 */
import { setupTestDb } from '../test/helpers/db.js';

const sizes = (process.argv[2] || '10000,100000').split(',').map(Number);
const { pool, skip, cleanup } = await setupTestDb();
if (skip) { console.log(skip); process.exit(0); }
const { runMigrations } = await import('../src/config/migrate.js');
const parts = await import('../src/modules/autoparts/parts.js');
const vehicles = await import('../src/modules/autoparts/vehicles.js');
const bins = await import('../src/modules/autoparts/bins.js');
await runMigrations(pool);

const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('p','p@perf.test','x') RETURNING user_id`)).rows[0].user_id;
const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Perf','${owner}','AUTO_PARTS') RETURNING business_id`)).rows[0].business_id;
const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
const tenant = { businessId: biz, branchId: branch, scopeBranchId: branch, role: 'OWNER', permissions: {} };
const WORDS = ['Brake pad', 'Oil filter', 'Air filter', 'Spark plug', 'Clutch plate', 'Wiper blade', 'Headlamp', 'Coolant', 'Battery', 'Timing belt', 'Water pump', 'Shock absorber'];
const stats = (ms) => { const s = [...ms].sort((a, b) => a - b); return `${s[Math.floor(s.length * 0.5)].toFixed(1)} / ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms`; };
const time = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); await fn(i); out.push(Number(process.hrtime.bigint() - t) / 1e6); } return stats(out); };

// 200 models to spread fitment over
const make = (await pool.query(`INSERT INTO vehicle_makes (business_id, name, vehicle_type) VALUES ($1,'Perf Motors','CAR') RETURNING make_id`, [biz])).rows[0].make_id;
await pool.query(`INSERT INTO vehicle_models (business_id, make_id, name) SELECT $1, $2, 'Model ' || g FROM generate_series(1, 200) g`, [biz, make]);
const bin = (await pool.query(`INSERT INTO warehouse_locations (business_id, branch_id, level, segment, code, loc_type, can_store, qr_token) VALUES ($1,$2,1,'B1','B1','BIN',TRUE,'perfbin') RETURNING location_id`, [biz, branch])).rows[0].location_id;

let loaded = 0;
const rows = [];
for (const size of sizes) {
  const from = loaded + 1;
  await pool.query(
    `INSERT INTO products (business_id, name, sku, unit, selling_price_paise, purchase_price_paise, track_inventory, kind)
     SELECT $1, (ARRAY[${WORDS.map((w) => `'${w}'`).join(',')}])[1 + g % ${WORDS.length}] || ' ' || g, 'SKU-' || lpad(g::text, 7, '0'), 'pc', 50000, 30000, TRUE, 'DISH' FROM generate_series($2::int, $3::int) g`, [biz, from, size]);
  const ids = `SELECT product_id FROM products WHERE business_id = $1 AND sku >= 'SKU-' || lpad($2::text, 7, '0') AND sku <= 'SKU-' || lpad($3::text, 7, '0')`;
  await pool.query(`INSERT INTO autoparts_parts (product_id, business_id, oem_part_no, mfr_part_no) SELECT p.product_id, $1, 'OEM-' || substr(p.sku, 5) || '-A', 'MFR' || substr(p.sku, 5) FROM products p WHERE p.business_id = $1 AND p.sku >= 'SKU-' || lpad($2::text, 7, '0') AND p.sku <= 'SKU-' || lpad($3::text, 7, '0')`, [biz, from, size]);
  await pool.query(`INSERT INTO autoparts_part_numbers (business_id, product_id, number, key, kind) SELECT business_id, product_id, oem_part_no, regexp_replace(upper(oem_part_no), '[^A-Z0-9]', '', 'g'), 'OEM' FROM autoparts_parts WHERE business_id = $1 AND product_id IN (${ids})`, [biz, from, size]);
  await pool.query(`INSERT INTO autoparts_part_numbers (business_id, product_id, number, key, kind) SELECT business_id, product_id, mfr_part_no, regexp_replace(upper(mfr_part_no), '[^A-Z0-9]', '', 'g'), 'MFR' FROM autoparts_parts WHERE business_id = $1 AND product_id IN (${ids})`, [biz, from, size]);
  await pool.query(`INSERT INTO part_fitment (business_id, product_id, model_id, status, source) SELECT $1, p.product_id, m.model_id, 'VERIFIED', 'perf' FROM products p CROSS JOIN generate_series(0, 4) k JOIN LATERAL (SELECT model_id FROM vehicle_models WHERE business_id = $1 ORDER BY model_id OFFSET (p.product_id + k) % 200 LIMIT 1) m ON TRUE WHERE p.business_id = $1 AND p.sku >= 'SKU-' || lpad($2::text, 7, '0') AND p.sku <= 'SKU-' || lpad($3::text, 7, '0') ON CONFLICT DO NOTHING`, [biz, from, size]);
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) SELECT $4, product_id, 10 FROM products WHERE business_id = $1 AND sku >= 'SKU-' || lpad($2::text, 7, '0') AND sku <= 'SKU-' || lpad($3::text, 7, '0')`, [biz, from, size, branch]);
  await pool.query(`INSERT INTO bin_stock (location_id, product_id, business_id, branch_id, qty) SELECT $4, product_id, $1, $5, 6 FROM products WHERE business_id = $1 AND sku >= 'SKU-' || lpad($2::text, 7, '0') AND sku <= 'SKU-' || lpad($3::text, 7, '0')`, [biz, from, size, bin, branch]);
  loaded = size;
  for (const t of ['products', 'autoparts_parts', 'autoparts_part_numbers', 'part_fitment', 'branch_stock', 'bin_stock']) await pool.query(`ANALYZE ${t}`);
  const fit = Number((await pool.query(`SELECT COUNT(*) AS n FROM part_fitment WHERE business_id = $1`, [biz])).rows[0].n);

  const pick = (i) => 1 + ((i * 7919) % size);
  const modelId = (await pool.query(`SELECT model_id FROM vehicle_models WHERE business_id = $1 ORDER BY model_id LIMIT 1`, [biz])).rows[0].model_id;
  rows.push({
    parts: size, 'fitment rows': fit,
    'OEM number': await time(150, (i) => parts.lookup(pool, tenant, `OEM${String(pick(i)).padStart(7, '0')}A`)),
    'SKU': await time(150, (i) => parts.lookup(pool, tenant, 'SKU-' + String(pick(i)).padStart(7, '0'))),
    'words': await time(40, (i) => parts.lookup(pool, tenant, `${WORDS[i % WORDS.length].toLowerCase()} ${pick(i) % 97}`)),
    'parts for a vehicle': await time(20, () => vehicles.partsForVehicle(pool, tenant, { model_id: modelId }, { limit: 50, offset: 0 })),
    'where is a part': await time(100, (i) => bins.partLocations(pool, tenant, pick(i))),
    'list page': await time(30, () => parts.listParts(pool, tenant, {}, { limit: 30, offset: 0 })),
    'reconcile bins': await time(3, () => bins.reconcile(pool, tenant))
  });
}
console.log('p50 / p95 per call');
console.table(rows);
await cleanup();
