// One-off: translate the names of products that have none yet. Run from backend/: node scripts/fill-product-names.mjs
import pool from '../src/config/database.js';
import { fillNames } from '../src/modules/ai/productNames.js';
const { rows } = await pool.query(`SELECT business_id, product_id, name FROM products WHERE name_i18n = '{}'::jsonb ORDER BY product_id`);
let n = 0;
for (const r of rows) { await fillNames(r.business_id, r.product_id, r.name); if (++n % 25 === 0) console.log(n, 'of', rows.length); }
console.log('done', rows.length);
await pool.end();
