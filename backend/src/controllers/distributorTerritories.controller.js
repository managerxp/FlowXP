/*
 * Territories and beats.
 *
 * Region → Territory → Area is one self-referencing table (dist_territories). A beat is a day's route under an area:
 * an ordered list of retailers for one salesperson on one weekday. A retailer is on at most one beat per weekday, so
 * nobody is visited twice on the same day by two reps.
 */
import pool from '../config/database.js';
import { WholesaleError, audit, diff, idList, int, like, ok, oneOf, paging, page, text, withTransaction, wrapAll, territoryScope } from '../modules/distributor/common.js';

const NEXT_LEVEL = { REGION: 'TERRITORY', TERRITORY: 'AREA' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ═══ territories ═══════════════════════════════════════════════════════════════════ */

/* GET /territories — the whole hierarchy (flat, with parent_id), with how many retailers each node holds, rolled up */
const list = async (req, res) => {
  const rows = (await pool.query(
    `SELECT t.territory_id, t.parent_id, t.level, t.name, t.code, t.status,
            (SELECT COUNT(*) FROM wholesale_customer_profiles w WHERE w.territory_id = t.territory_id) AS direct_customers,
            (SELECT COUNT(*) FROM wholesale_salespeople s WHERE s.territory_id = t.territory_id AND s.status = 'ACTIVE') AS salespeople,
            (SELECT COUNT(*) FROM dist_beats b WHERE b.territory_id = t.territory_id AND b.status = 'ACTIVE') AS beats
     FROM dist_territories t WHERE t.business_id = $1 ORDER BY t.level, lower(t.name)`, [req.tenant.businessId])).rows;
  const byId = new Map(rows.map((r) => [r.territory_id, { ...r, customers: Number(r.direct_customers) }]));
  for (const r of rows) { // roll customers up: area → territory → region
    let p = r.parent_id;
    while (p != null && byId.has(p)) { byId.get(p).customers += Number(r.direct_customers); p = byId.get(p).parent_id; }
  }
  ok(res, [...byId.values()].map((r) => ({ territory_id: r.territory_id, parent_id: r.parent_id, level: r.level, name: r.name, code: r.code, status: r.status, customers: r.customers, salespeople: Number(r.salespeople), beats: Number(r.beats) })));
};

const create = async (req, res) => {
  const b = req.body || {};
  const level = oneOf(b.level, 'Level', ['REGION', 'TERRITORY', 'AREA'], { required: true });
  const name = text(b.name, 'Name', { max: 120, min: 2, required: true });
  const parentId = int(b.parent_id, 'Parent', { min: 1 });
  if (level === 'REGION' && parentId) throw new WholesaleError(400, 'A region has no parent');
  if (level !== 'REGION') {
    const parent = parentId ? (await pool.query(`SELECT level FROM dist_territories WHERE business_id = $1 AND territory_id = $2`, [req.tenant.businessId, parentId])).rows[0] : null;
    if (!parent) throw new WholesaleError(400, `Choose the ${level === 'TERRITORY' ? 'region' : 'territory'} it belongs to`);
    if (NEXT_LEVEL[parent.level] !== level) throw new WholesaleError(400, `A ${level.toLowerCase()} goes under a ${level === 'TERRITORY' ? 'region' : 'territory'}`);
  }
  let row;
  try {
    row = (await pool.query(`INSERT INTO dist_territories (business_id, parent_id, level, name, code) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.tenant.businessId, parentId, level, name, text(b.code, 'Code', { max: 20 })])).rows[0];
  } catch (e) { if (e.code === '23505') throw new WholesaleError(409, `There is already a ${level.toLowerCase()} called ${name} there`); throw e; }
  audit(req, 'distributor.territory_created', 'territory', row.territory_id, null, { level, name, parent_id: parentId });
  ok(res, row, 201);
};

const update = async (req, res) => {
  const b = req.body || {};
  const before = (await pool.query(`SELECT * FROM dist_territories WHERE business_id = $1 AND territory_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = {};
  if ('name' in b) f.name = text(b.name, 'Name', { max: 120, min: 2, required: true });
  if ('code' in b) f.code = text(b.code, 'Code', { max: 20 });
  if ('status' in b) f.status = oneOf(b.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  let after;
  try { after = (await pool.query(`UPDATE dist_territories SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND territory_id = $2 RETURNING *`, [req.tenant.businessId, before.territory_id, ...keys.map((k) => f[k])])).rows[0]; }
  catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'That name is already used there'); throw e; }
  audit(req, 'distributor.territory_updated', 'territory', before.territory_id, null, null, { changes: diff(before, after) });
  ok(res, after);
};

const remove = async (req, res) => {
  const id = Number(req.params.id);
  const busy = (await pool.query(
    `SELECT (SELECT COUNT(*) FROM dist_territories WHERE business_id = $1 AND parent_id = $2) AS children,
            (SELECT COUNT(*) FROM wholesale_customer_profiles WHERE business_id = $1 AND territory_id = $2) AS customers,
            (SELECT COUNT(*) FROM dist_beats WHERE business_id = $1 AND territory_id = $2) AS beats,
            (SELECT COUNT(*) FROM wholesale_salespeople WHERE business_id = $1 AND territory_id = $2) AS reps`, [req.tenant.businessId, id])).rows[0];
  if (Number(busy.children) || Number(busy.customers) || Number(busy.beats) || Number(busy.reps)) throw new WholesaleError(409, 'Move its areas, beats, retailers and salespeople first, or mark it inactive instead');
  const hit = await pool.query(`DELETE FROM dist_territories WHERE business_id = $1 AND territory_id = $2 RETURNING name, level`, [req.tenant.businessId, id]);
  if (!hit.rowCount) throw new WholesaleError(404, 'Not found');
  audit(req, 'distributor.territory_deleted', 'territory', id, hit.rows[0]);
  ok(res, { deleted: true });
};

/* POST /customers/assign { customer_ids: [], territory_id?, salesperson_id? } — bulk territory / salesperson assignment (null clears) */
const assignCustomers = async (req, res) => {
  const b = req.body || {};
  const ids = idList(b.customer_ids, 'Retailers', { max: 2000 });
  if (!ids.length) throw new WholesaleError(400, 'Choose at least one retailer');
  const sets = []; const values = [req.tenant.businessId, ids];
  if ('territory_id' in b) {
    const t = int(b.territory_id, 'Territory', { min: 1 });
    if (t != null && !(await pool.query(`SELECT 1 FROM dist_territories WHERE business_id = $1 AND territory_id = $2`, [req.tenant.businessId, t])).rowCount) throw new WholesaleError(400, 'That territory was not found');
    values.push(t); sets.push(`territory_id = $${values.length}`);
  }
  if ('salesperson_id' in b) {
    const s = int(b.salesperson_id, 'Salesperson', { min: 1 });
    if (s != null && !(await pool.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, s])).rowCount) throw new WholesaleError(400, 'That salesperson was not found');
    values.push(s); sets.push(`salesperson_id = $${values.length}`);
  }
  if (!sets.length) throw new WholesaleError(400, 'Choose a territory or a salesperson to assign');
  const done = await withTransaction(async (client) => {
    // a retailer with no trade profile yet gets one, so the assignment has somewhere to live
    await client.query(`INSERT INTO wholesale_customer_profiles (customer_id, business_id) SELECT c.customer_id, c.business_id FROM customers c WHERE c.business_id = $1 AND c.customer_id = ANY($2::int[]) ON CONFLICT (customer_id) DO NOTHING`, [req.tenant.businessId, ids]);
    return (await client.query(`UPDATE wholesale_customer_profiles SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND customer_id = ANY($2::int[])`, values)).rowCount;
  });
  audit(req, 'distributor.customers_assigned', 'customer', null, null, null, { count: done, territory_id: b.territory_id, salesperson_id: b.salesperson_id });
  ok(res, { assigned: done });
};

/* ═══ beats ═════════════════════════════════════════════════════════════════════════ */

const beatShape = (r) => ({
  beat_id: r.beat_id, name: r.name, weekday: r.weekday, weekday_name: r.weekday == null ? null : WEEKDAYS[r.weekday], territory_id: r.territory_id, territory: r.territory_name ?? null,
  salesperson_id: r.salesperson_id, salesperson: r.salesperson_name ?? null, status: r.status, notes: r.notes, ...(r.customers != null ? { customers: Number(r.customers) } : {})
});

const BEAT_SELECT = `SELECT b.*, t.name AS territory_name, s.name AS salesperson_name, (SELECT COUNT(*) FROM dist_beat_customers bc WHERE bc.beat_id = b.beat_id) AS customers
  FROM dist_beats b LEFT JOIN dist_territories t ON t.territory_id = b.territory_id LEFT JOIN wholesale_salespeople s ON s.salesperson_id = b.salesperson_id`;

/** A sales rep or field rep sees their own beats only. */
const myRep = async (req) => {
  if (!['SALES_EXECUTIVE', 'FIELD_SALES', 'COLLECTION_EXECUTIVE'].includes(req.tenant.role)) return null;
  const row = (await pool.query(`SELECT salesperson_id FROM wholesale_salespeople WHERE business_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [req.tenant.businessId, req.auth.userId])).rows[0];
  return row ? row.salesperson_id : 0;
};

const listBeats = async (req, res) => {
  const values = [req.tenant.businessId]; const where = ['b.business_id = $1'];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'); where.push(`b.status = $${values.length}`); }
  const mine = await myRep(req);
  if (mine != null) { values.push(mine); where.push(`b.salesperson_id = $${values.length}`); }
  else if (req.query.salesperson_id) { values.push(Number(req.query.salesperson_id) || 0); where.push(`b.salesperson_id = $${values.length}`); }
  if (req.query.weekday != null && req.query.weekday !== '') { values.push(Number(req.query.weekday)); where.push(`b.weekday = $${values.length}`); }
  if (req.query.territory_id) {
    const scope = await territoryScope(pool, req.tenant.businessId, Number(req.query.territory_id) || 0);
    values.push(scope); where.push(`b.territory_id = ANY($${values.length}::int[])`);
  }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`b.name ILIKE $${values.length}`); }
  const rows = (await pool.query(`${BEAT_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.weekday NULLS LAST, lower(b.name)`, values)).rows;
  ok(res, rows.map(beatShape));
};

const beatFields = async (req, b, partial) => {
  const f = {}; const has = (k) => !partial || k in b;
  if (has('name')) f.name = text(b.name, 'Beat name', { max: 120, min: 2, required: true });
  if ('weekday' in b) f.weekday = b.weekday === '' || b.weekday == null ? null : int(b.weekday, 'Day', { min: 0, max: 6 });
  if ('territory_id' in b) {
    f.territory_id = int(b.territory_id, 'Territory', { min: 1 });
    if (f.territory_id != null && !(await pool.query(`SELECT 1 FROM dist_territories WHERE business_id = $1 AND territory_id = $2`, [req.tenant.businessId, f.territory_id])).rowCount) throw new WholesaleError(400, 'That territory was not found');
  }
  if ('salesperson_id' in b) {
    f.salesperson_id = int(b.salesperson_id, 'Salesperson', { min: 1 });
    if (f.salesperson_id != null && !(await pool.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, f.salesperson_id])).rowCount) throw new WholesaleError(400, 'That salesperson was not found');
  }
  if ('status' in b) f.status = oneOf(b.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 300 });
  return f;
};

/** Put these retailers on the beat, in this order. A retailer already on another active beat for the same weekday is refused. */
const setBeatCustomers = async (client, businessId, beat, customerIds) => {
  const own = (await client.query(`SELECT customer_id, name FROM customers WHERE business_id = $1 AND customer_id = ANY($2::int[])`, [businessId, customerIds])).rows;
  if (own.length !== new Set(customerIds).size) throw new WholesaleError(400, 'One of the retailers was not found');
  if (beat.weekday != null && customerIds.length) {
    const clash = (await client.query(
      `SELECT c.name, b.name AS beat FROM dist_beat_customers bc JOIN dist_beats b ON b.beat_id = bc.beat_id JOIN customers c ON c.customer_id = bc.customer_id
       WHERE bc.business_id = $1 AND bc.customer_id = ANY($2::int[]) AND b.beat_id <> $3 AND b.status = 'ACTIVE' AND b.weekday = $4 LIMIT 1`, [businessId, customerIds, beat.beat_id, beat.weekday])).rows[0];
    if (clash) throw new WholesaleError(409, `${clash.name} is already on ${clash.beat}, which runs on the same day`);
  }
  await client.query(`DELETE FROM dist_beat_customers WHERE beat_id = $1`, [beat.beat_id]);
  if (customerIds.length) {
    await client.query(`INSERT INTO dist_beat_customers (beat_id, customer_id, business_id, seq) SELECT $1, x.id, $2, x.ord FROM unnest($3::int[]) WITH ORDINALITY AS x(id, ord)`, [beat.beat_id, businessId, customerIds]);
  }
};

const createBeat = async (req, res) => {
  const b = req.body || {}; const f = await beatFields(req, b, false);
  const customerIds = idList(b.customer_ids, 'Retailers', { max: 500 });
  const id = await withTransaction(async (client) => {
    const keys = Object.keys(f); let row;
    try { row = (await client.query(`INSERT INTO dist_beats (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0]; }
    catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'You already have a beat with that name'); throw e; }
    await setBeatCustomers(client, req.tenant.businessId, row, customerIds);
    return row.beat_id;
  });
  audit(req, 'distributor.beat_created', 'beat', id, null, { ...f, customers: customerIds.length });
  ok(res, beatShape((await pool.query(`${BEAT_SELECT} WHERE b.business_id = $1 AND b.beat_id = $2`, [req.tenant.businessId, id])).rows[0]), 201);
};

const getBeat = async (req, res) => {
  const row = (await pool.query(`${BEAT_SELECT} WHERE b.business_id = $1 AND b.beat_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!row) throw new WholesaleError(404, 'Not found');
  const mine = await myRep(req);
  if (mine != null && row.salesperson_id !== mine) throw new WholesaleError(404, 'Not found');
  const customers = (await pool.query(
    `SELECT bc.seq, c.customer_id, c.name, c.phone, c.address, w.contact_person, w.city,
            (SELECT MAX(order_date) FROM wholesale_sales_orders o WHERE o.customer_id = c.customer_id AND o.status <> 'CANCELLED') AS last_order
     FROM dist_beat_customers bc JOIN customers c ON c.customer_id = bc.customer_id LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id
     WHERE bc.beat_id = $1 ORDER BY bc.seq`, [row.beat_id])).rows;
  ok(res, { ...beatShape(row), customers: customers.map((c) => ({ seq: c.seq, customer_id: c.customer_id, name: c.name, phone: c.phone, address: c.address, contact_person: c.contact_person, city: c.city, last_order: c.last_order })) });
};

const updateBeat = async (req, res) => {
  const b = req.body || {};
  const before = (await pool.query(`SELECT * FROM dist_beats WHERE business_id = $1 AND beat_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = await beatFields(req, b, true); const keys = Object.keys(f);
  const customerIds = 'customer_ids' in b ? idList(b.customer_ids, 'Retailers', { max: 500 }) : null;
  if (!keys.length && customerIds == null) throw new WholesaleError(400, 'Nothing to update');
  const after = await withTransaction(async (client) => {
    let row = before;
    if (keys.length) {
      try { row = (await client.query(`UPDATE dist_beats SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND beat_id = $2 RETURNING *`, [req.tenant.businessId, before.beat_id, ...keys.map((k) => f[k])])).rows[0]; }
      catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'You already have a beat with that name'); throw e; }
    }
    // changing the weekday re-checks the existing retailers against the new day
    const ids = customerIds ?? (keys.includes('weekday') ? (await client.query(`SELECT customer_id FROM dist_beat_customers WHERE beat_id = $1 ORDER BY seq`, [before.beat_id])).rows.map((r) => r.customer_id) : null);
    if (ids != null) await setBeatCustomers(client, req.tenant.businessId, row, ids);
    return row;
  });
  audit(req, 'distributor.beat_updated', 'beat', before.beat_id, null, null, { changes: diff(before, after), customers: customerIds?.length });
  ok(res, beatShape((await pool.query(`${BEAT_SELECT} WHERE b.business_id = $1 AND b.beat_id = $2`, [req.tenant.businessId, before.beat_id])).rows[0]));
};

export default wrapAll({ list, create, update, remove, assignCustomers, listBeats, createBeat, getBeat, updateBeat });
