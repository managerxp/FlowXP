/* A booking address made from the business name ("Glow Salon & Spa" -> glow-salon-spa), made unique by a number when another business has it. */
import pool from '../config/database.js';

const base = (name) => {
  const s = String(name || '').toLowerCase().replace(/&/g, ' and ').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34);
  return s.length >= 3 ? s : 'my-place';
};

/** `table`/`column` are fixed names from the callers, never user input. */
export const suggestSlug = async (businessId, table, column) => {
  const { rows } = await pool.query(`SELECT name FROM businesses WHERE business_id = $1`, [businessId]);
  const root = base(rows[0]?.name);
  for (let n = 0; n < 50; n++) {
    const candidate = n ? `${root}-${n + 1}` : root;
    const taken = await pool.query(`SELECT 1 FROM ${table} WHERE lower(${column}) = $1 AND business_id <> $2`, [candidate, businessId]);
    if (!taken.rowCount) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
};
