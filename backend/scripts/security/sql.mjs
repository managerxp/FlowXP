/* Static scan: every UPDATE / DELETE statement in controllers and modules that does not mention business_id (or a branch of the business, or a user's own row). Candidates for human review. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk(root);
const hits = [];
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // template or quoted SQL strings
  const re = /`([^`]*?)`|'((?:UPDATE|DELETE FROM)[^']*)'/gs;
  let m;
  while ((m = re.exec(src))) {
    const sql = (m[1] ?? m[2] ?? '');
    if (!/^\s*(UPDATE|DELETE\s+FROM)\b/i.test(sql)) continue;
    total++;
    if (/business_id|businessId/i.test(sql)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    hits.push({ file: path.relative(root, f).replace(/\\/g, '/'), line, sql: sql.replace(/\s+/g, ' ').slice(0, 170) });
  }
}
console.log(total, 'UPDATE/DELETE statements;', hits.length, 'without business_id in the statement itself');
for (const h of hits) console.log(`${h.file}:${h.line}  ${h.sql}`);
