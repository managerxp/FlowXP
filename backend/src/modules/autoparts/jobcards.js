/*
 * Workshop job cards (migration 0109): a vehicle comes in for service; the spare parts fitted and the labour are written on its card; when the work is done the card becomes
 * one ordinary invoice.
 *
 * Stock. Adding a part to a card holds that stock for the card's customer (modules/autoparts/sales.js reservations), so the counter cannot sell it to someone else. The
 * invoice made from the card is billed to the same customer, so billing uses that hold up (fulfilForSale) and takes the stock: a job card never moves stock itself, and
 * cancelling a card gives every hold back. A part the shop does not have yet can still be put on the card (allow_short), unheld, so the customer gets a full quote; billing
 * then refuses to sell what is not on the shelf, exactly as at the counter.
 *
 * Money. Prices come from the customer's trade price list or the part's price; a lower price needs the price_change right. Labour is a typed line with the shop's labour GST
 * rate. The figures on the card are an estimate; the invoice is the record, and works out GST the way every bill does.
 */
import { PartsError, int, isoDate, money, num, oneOf, text, withRupees } from './common.js';
import * as sales from './sales.js';
import { createInvoiceInTransaction } from '../billing.js';
import { hasPermission } from '../../middleware/auth.js';

export const JOB_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY', 'BILLED', 'CANCELLED'];
export const LIVE = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'];
const q3 = (n) => Math.round(Number(n) * 1000) / 1000;
const branchOf = (tenant) => {
  const id = tenant.scopeBranchId ?? tenant.branchId;
  if (!id) throw new PartsError(400, 'Choose an outlet first');
  return id;
};

/** The estimate printed on a card: parts and labour before tax, the tax, and the total. */
export const estimateOf = (lines) => {
  let parts = 0; let labour = 0; let tax = 0;
  for (const l of lines) {
    const amount = Math.round(Number(l.quantity) * Number(l.unit_price_paise));
    if (l.kind === 'PART') parts += amount; else labour += amount;
    tax += Math.round(amount * Number(l.tax_rate) / 100);
  }
  return { parts_paise: parts, labour_paise: labour, tax_paise: tax, total_paise: parts + labour + tax };
};

const settingsOf = async (db, businessId) => {
  await db.query(`INSERT INTO autoparts_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  return (await db.query(`SELECT job_prefix, job_next_no, labour_tax_rate FROM autoparts_settings WHERE business_id = $1 FOR UPDATE`, [businessId])).rows[0];
};

/* ── reading ─────────────────────────────────────────────────────────────── */

const JOB_SQL = `SELECT j.*, j.promised_on::text AS promised_on, j.next_service_on::text AS next_service_on, c.name AS customer_name, c.phone AS customer_phone, e.name AS mechanic_name
  FROM job_cards j LEFT JOIN customers c ON c.customer_id = j.customer_id LEFT JOIN hr_employees e ON e.employee_id = j.mechanic_id`;

const jobRow = async (db, tenant, id, { lock = false } = {}) => {
  const r = (await db.query(`${JOB_SQL} WHERE j.job_id = $1 AND j.business_id = $2${lock ? ' FOR UPDATE OF j' : ''}`, [Number(id), tenant.businessId])).rows[0];
  if (!r || (tenant.scopeBranchId != null && r.branch_id !== tenant.scopeBranchId)) throw new PartsError(404, 'Not found');
  return r;
};

/** Does a part fit this card's vehicle? NO_VEHICLE when the card names no model from the shop's list; UNKNOWN when the part has no record for it. */
const fitOf = async (db, businessId, job, productIds) => {
  const out = new Map(productIds.map((id) => [id, job.model_id ? 'UNKNOWN' : 'NO_VEHICLE']));
  if (!job.model_id || !productIds.length) return out;
  const rows = (await db.query(
    `SELECT product_id, status FROM part_fitment WHERE business_id = $1 AND model_id = $2 AND product_id = ANY($3::int[])
       AND ($4::int IS NULL OR year_from IS NULL OR year_from <= $4) AND ($4::int IS NULL OR year_to IS NULL OR year_to >= $4)`,
    [businessId, job.model_id, productIds, job.vehicle_year])).rows;
  for (const r of rows) {
    const cur = out.get(r.product_id);
    if (r.status === 'NOT_FIT' || cur === 'NOT_FIT') out.set(r.product_id, 'NOT_FIT');
    else if (r.status === 'VERIFIED' || cur === 'VERIFIED') out.set(r.product_id, 'VERIFIED');
    else out.set(r.product_id, 'UNVERIFIED');
  }
  return out;
};

const shapeLine = (l, fit) => ({
  line_id: Number(l.line_id), kind: l.kind, product_id: l.product_id, description: l.description, sku: l.sku ?? null, quantity: Number(l.quantity), unit_price_paise: Number(l.unit_price_paise),
  tax_rate: Number(l.tax_rate), held: Boolean(l.reservation_id && l.res_status === 'OPEN'), fitment: l.kind === 'PART' ? (fit.get(l.product_id) ?? 'UNKNOWN') : null,
  amount_paise: Math.round(Number(l.quantity) * Number(l.unit_price_paise))
});

export const getJob = async (db, tenant, id) => {
  const job = await jobRow(db, tenant, id);
  const lines = (await db.query(
    `SELECT l.*, p.sku, r.status AS res_status FROM job_card_lines l LEFT JOIN products p ON p.product_id = l.product_id LEFT JOIN part_reservations r ON r.reservation_id = l.reservation_id WHERE l.job_id = $1 ORDER BY l.kind DESC, l.line_id`, [job.job_id])).rows;
  const fit = await fitOf(db, tenant.businessId, job, lines.filter((l) => l.kind === 'PART').map((l) => l.product_id));
  const earlier = Number((await db.query(`SELECT COUNT(*) AS n FROM job_cards WHERE business_id = $1 AND upper(vehicle_reg) = upper($2) AND job_id <> $3 AND status <> 'CANCELLED'`, [tenant.businessId, job.vehicle_reg, job.job_id])).rows[0].n);
  return withRupees({ ...shapeJob(job), lines: lines.map((l) => shapeLine(l, fit)), estimate: estimateOf(lines), earlier_visits: earlier });
};

const shapeJob = (r) => ({
  job_id: r.job_id, job_no: r.job_no, status: r.status, customer_id: r.customer_id, customer_name: r.customer_name, customer_phone: r.customer_phone, vehicle_reg: r.vehicle_reg, vehicle_type: r.vehicle_type,
  make: r.make, model: r.model, variant: r.variant, model_id: r.model_id, vehicle_year: r.vehicle_year, odometer_km: r.odometer_km, complaint: r.complaint, diagnosis: r.diagnosis, notes: r.notes,
  mechanic_id: r.mechanic_id, mechanic_name: r.mechanic_name, promised_on: r.promised_on, next_service_on: r.next_service_on, next_service_km: r.next_service_km, invoice_id: r.invoice_id,
  opened_at: r.opened_at, ready_at: r.ready_at, billed_at: r.billed_at
});

export const listJobs = async (db, tenant, { status = 'LIVE', q = null, reg = null, customerId = null, mechanicId = null, limit = 50, offset = 0, like }) => {
  const args = [tenant.businessId]; const where = ['j.business_id = $1'];
  if (tenant.scopeBranchId != null) { args.push(tenant.scopeBranchId); where.push(`j.branch_id = $${args.length}`); }
  const st = String(status || 'LIVE').toUpperCase();
  if (st === 'LIVE') where.push(`j.status IN ('OPEN','IN_PROGRESS','WAITING_PARTS','READY')`);
  else if (st !== 'ALL') { args.push(oneOf(st, 'Status', JOB_STATUSES, { required: true })); where.push(`j.status = $${args.length}`); }
  if (q) { args.push(like(q)); where.push(`(j.job_no ILIKE $${args.length} OR j.vehicle_reg ILIKE $${args.length} OR c.name ILIKE $${args.length} OR c.phone ILIKE $${args.length})`); }
  if (reg) { args.push(String(reg).toUpperCase().replace(/\s+/g, '')); where.push(`upper(replace(j.vehicle_reg, ' ', '')) = $${args.length}`); }
  if (customerId) { args.push(Number(customerId)); where.push(`j.customer_id = $${args.length}`); }
  if (mechanicId) { args.push(Number(mechanicId)); where.push(`j.mechanic_id = $${args.length}`); }
  args.push(limit, offset);
  const rows = (await db.query(
    `${JOB_SQL.replace('FROM job_cards j', `, (SELECT COALESCE(SUM(ROUND(quantity * unit_price_paise * (100 + tax_rate) / 100)), 0) FROM job_card_lines WHERE job_id = j.job_id) AS total_paise, (SELECT COUNT(*) FROM job_card_lines WHERE job_id = j.job_id AND kind = 'PART') AS parts FROM job_cards j`)}
     WHERE ${where.join(' AND ')} ORDER BY CASE WHEN j.status IN ('BILLED','CANCELLED') THEN 1 ELSE 0 END, j.opened_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args)).rows;
  return rows.map((r) => withRupees({ ...shapeJob(r), total_paise: Number(r.total_paise), parts: Number(r.parts) }));
};

/** Vehicles whose last service said when the next one is due, soonest first: the ones to phone. */
export const dueServices = async (db, tenant, { days = 14 }) => {
  const args = [tenant.businessId]; let scope = '';
  if (tenant.scopeBranchId != null) { args.push(tenant.scopeBranchId); scope = ` AND j.branch_id = $${args.length}`; }
  const rows = (await db.query(
    `SELECT DISTINCT ON (upper(replace(j.vehicle_reg, ' ', ''))) j.job_id, j.job_no, j.vehicle_reg, j.make, j.model, j.next_service_on::text AS next_service_on, j.next_service_km, j.customer_id, c.name AS customer_name, c.phone AS customer_phone
       FROM job_cards j LEFT JOIN customers c ON c.customer_id = j.customer_id
      WHERE j.business_id = $1 AND j.status = 'BILLED' AND j.next_service_on IS NOT NULL${scope}
      ORDER BY upper(replace(j.vehicle_reg, ' ', '')), j.billed_at DESC`, args)).rows;
  const today = new Date().toISOString().slice(0, 10); const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return rows.filter((r) => r.next_service_on <= limit).map((r) => ({ ...r, overdue: r.next_service_on < today })).sort((a, b) => a.next_service_on.localeCompare(b.next_service_on));
};

export const mechanics = async (db, tenant) =>
  (await db.query(`SELECT employee_id, name, designation FROM hr_employees WHERE branch_id = $1 AND status = 'ACTIVE' ORDER BY name`, [branchOf(tenant)])).rows;

/* ── writing ─────────────────────────────────────────────────────────────── */

const reg = (v) => {
  const s = text(v, 'Registration number', { max: 20, required: true });
  const t = s.toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z0-9][A-Z0-9 -]{2,19}$/.test(t)) throw new PartsError(400, 'A registration number is letters and digits, like KA01AB1234');
  return t;
};

const jobFields = async (db, tenant, b, { creating }) => {
  const f = {};
  if (creating || b.customer_id !== undefined) {
    f.customer_id = int(b.customer_id, 'Customer', { min: 1, required: true });
    if (!(await db.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [f.customer_id, tenant.businessId])).rowCount) throw new PartsError(400, 'Choose the customer first');
  }
  if (creating || b.vehicle_reg !== undefined) f.vehicle_reg = reg(b.vehicle_reg);
  if (b.vehicle_type !== undefined) f.vehicle_type = oneOf(b.vehicle_type, 'Vehicle type', ['CAR', 'BIKE', 'SCOOTER', 'TRUCK', 'BUS', 'COMMERCIAL', 'OTHER'], { required: true });
  if (b.make !== undefined) f.make = text(b.make, 'Make', { max: 60 });
  if (b.model !== undefined) f.model = text(b.model, 'Model', { max: 80 });
  if (b.variant !== undefined) f.variant = text(b.variant, 'Variant', { max: 60 });
  if (b.model_id !== undefined) {
    f.model_id = b.model_id === null || b.model_id === '' ? null : int(b.model_id, 'Model', { min: 1 });
    if (f.model_id) {
      const m = (await db.query(`SELECT m.name, k.name AS make FROM vehicle_models m JOIN vehicle_makes k ON k.make_id = m.make_id WHERE m.model_id = $1 AND m.business_id = $2`, [f.model_id, tenant.businessId])).rows[0];
      if (!m) throw new PartsError(400, 'That vehicle model is not in your list');
      if (b.make === undefined) f.make = m.make;
      if (b.model === undefined) f.model = m.name;
    }
  }
  if (b.vehicle_year !== undefined) f.vehicle_year = b.vehicle_year === null || b.vehicle_year === '' ? null : int(b.vehicle_year, 'Year', { min: 1900, max: 2100 });
  if (b.odometer_km !== undefined) f.odometer_km = b.odometer_km === null || b.odometer_km === '' ? null : int(b.odometer_km, 'Odometer', { min: 0, max: 5000000 });
  if (b.complaint !== undefined) f.complaint = text(b.complaint, 'Complaint', { max: 2000 });
  if (b.diagnosis !== undefined) f.diagnosis = text(b.diagnosis, 'Diagnosis', { max: 2000 });
  if (b.notes !== undefined) f.notes = text(b.notes, 'Notes', { max: 2000 });
  if (b.promised_on !== undefined) f.promised_on = isoDate(b.promised_on, 'Promised date') || null;
  if (b.next_service_on !== undefined) f.next_service_on = isoDate(b.next_service_on, 'Next service date') || null;
  if (b.next_service_km !== undefined) f.next_service_km = b.next_service_km === null || b.next_service_km === '' ? null : int(b.next_service_km, 'Next service km', { min: 0, max: 5000000 });
  if (b.mechanic_id !== undefined) {
    f.mechanic_id = b.mechanic_id === null || b.mechanic_id === '' ? null : int(b.mechanic_id, 'Mechanic', { min: 1 });
    if (f.mechanic_id && !(await db.query(`SELECT 1 FROM hr_employees WHERE employee_id = $1 AND branch_id = $2 AND status = 'ACTIVE'`, [f.mechanic_id, branchOf(tenant)])).rowCount) throw new PartsError(400, 'That mechanic is not on your staff list');
  }
  return f;
};

export const createJob = async (db, tenant, userId, b) => {
  const branchId = branchOf(tenant);
  const f = await jobFields(db, tenant, b, { creating: true });
  const s = await settingsOf(db, tenant.businessId);
  await db.query(`UPDATE autoparts_settings SET job_next_no = job_next_no + 1 WHERE business_id = $1`, [tenant.businessId]);
  const jobNo = `${s.job_prefix}-${String(s.job_next_no).padStart(4, '0')}`;
  const all = { ...f, job_no: jobNo, business_id: tenant.businessId, branch_id: branchId, created_by: userId };
  const keys = Object.keys(all);
  const id = (await db.query(`INSERT INTO job_cards (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING job_id`, keys.map((k) => all[k]))).rows[0].job_id;
  return getJob(db, tenant, id);
};

const ensureLive = (job) => { if (!LIVE.includes(job.status)) throw new PartsError(409, job.status === 'BILLED' ? 'This job has been billed' : 'This job was cancelled'); };

export const updateJob = async (db, tenant, id, b) => {
  const job = await jobRow(db, tenant, id, { lock: true });
  ensureLive(job);
  const f = await jobFields(db, tenant, b, { creating: false });
  const keys = Object.keys(f);
  if (!keys.length) throw new PartsError(400, 'Nothing to update');
  if (f.customer_id && f.customer_id !== job.customer_id && (await db.query(`SELECT 1 FROM job_card_lines WHERE job_id = $1 AND reservation_id IS NOT NULL LIMIT 1`, [job.job_id])).rowCount) throw new PartsError(409, 'Parts are held for the current customer. Remove them before changing the customer');
  await db.query(`UPDATE job_cards SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE job_id = $1`, [job.job_id, ...keys.map((k) => f[k])]);
  return getJob(db, tenant, job.job_id);
};

const releaseHolds = async (db, tenant, jobId) => {
  const held = (await db.query(`SELECT l.line_id, l.reservation_id FROM job_card_lines l JOIN part_reservations r ON r.reservation_id = l.reservation_id AND r.status = 'OPEN' WHERE l.job_id = $1`, [jobId])).rows;
  for (const h of held) { await sales.release(db, tenant, h.reservation_id); await db.query(`UPDATE job_card_lines SET reservation_id = NULL WHERE line_id = $1`, [h.line_id]); }
};

export const setStatus = async (db, tenant, id, status) => {
  const job = await jobRow(db, tenant, id, { lock: true });
  const next = oneOf(status, 'Status', ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY', 'CANCELLED'], { required: true });
  ensureLive(job);
  if (next === 'CANCELLED') await releaseHolds(db, tenant, job.job_id);
  await db.query(`UPDATE job_cards SET status = $2::varchar, ready_at = CASE WHEN $2::varchar = 'READY' THEN COALESCE(ready_at, now()) ELSE ready_at END WHERE job_id = $1`, [job.job_id, next]);
  return getJob(db, tenant, job.job_id);
};

const holdFor = async (db, tenant, userId, job, productId, qty, note) =>
  (await sales.reserve(db, tenant, userId, { product_id: productId, qty, customer_id: job.customer_id, note })).reservation_id;

/** A part or a labour line. A part is held for the customer unless the shop is short and `allow_short` says to quote it anyway. */
export const addLine = async (db, tenant, userId, id, b) => {
  const job = await jobRow(db, tenant, id, { lock: true });
  ensureLive(job);
  const kind = oneOf(b.kind, 'Line', ['PART', 'LABOUR'], { required: true });
  const quantity = q3(num(b.quantity ?? 1, 'Quantity', { min: 0.001, max: 100000, required: true }));
  const typedPrice = b.unit_price === undefined || b.unit_price === null || b.unit_price === '' ? null : money(b.unit_price, 'Price', { min: 0 });
  if (kind === 'LABOUR') {
    const description = text(b.description, 'What was done', { max: 200, required: true });
    if (typedPrice == null) throw new PartsError(400, 'Enter the labour charge');
    const rate = b.tax_rate === undefined ? Number((await settingsOf(db, tenant.businessId)).labour_tax_rate) : num(b.tax_rate, 'GST rate', { min: 0, max: 100, required: true });
    const l = (await db.query(`INSERT INTO job_card_lines (job_id, kind, description, quantity, unit_price_paise, tax_rate) VALUES ($1,'LABOUR',$2,$3,$4,$5) RETURNING line_id`, [job.job_id, description, quantity, typedPrice, rate])).rows[0];
    return { line_id: Number(l.line_id), job: await getJob(db, tenant, job.job_id) };
  }
  const productId = int(b.product_id, 'Part', { min: 1, required: true });
  const p = (await db.query(`SELECT product_id, name, selling_price_paise, tax_rate, track_inventory, status FROM products WHERE product_id = $1 AND business_id = $2`, [productId, tenant.businessId])).rows[0];
  if (!p) throw new PartsError(404, 'Not found');
  if (p.status !== 'ACTIVE') throw new PartsError(400, `${p.name} is archived`);
  const list = (await sales.tradePrices(db, tenant.businessId, job.customer_id, [productId])).get(productId) ?? Number(p.selling_price_paise);
  const price = typedPrice ?? list;
  if (price < list && !hasPermission(tenant, 'price_change')) throw new PartsError(403, 'A price below the list price needs the price change right');
  const description = text(b.description, 'Description', { max: 200 }) || p.name;
  let reservationId = null;
  if (p.track_inventory) {
    try { reservationId = await holdFor(db, tenant, userId, job, productId, quantity, `Job card ${job.job_no}`); }
    catch (e) { if (!(e instanceof PartsError && e.status === 409 && b.allow_short === true)) throw e; }
  }
  const l = (await db.query(`INSERT INTO job_card_lines (job_id, kind, product_id, description, quantity, unit_price_paise, tax_rate, reservation_id) VALUES ($1,'PART',$2,$3,$4,$5,$6,$7) RETURNING line_id`,
    [job.job_id, productId, description, quantity, price, Number(p.tax_rate), reservationId])).rows[0];
  return { line_id: Number(l.line_id), job: await getJob(db, tenant, job.job_id) };
};

const lineRow = async (db, tenant, lineId) => {
  const l = (await db.query(`SELECT l.*, j.job_id AS jid FROM job_card_lines l JOIN job_cards j ON j.job_id = l.job_id WHERE l.line_id = $1 AND j.business_id = $2`, [Number(lineId), tenant.businessId])).rows[0];
  if (!l) throw new PartsError(404, 'Not found');
  const job = await jobRow(db, tenant, l.jid, { lock: true });
  ensureLive(job);
  return { l, job };
};

export const updateLine = async (db, tenant, userId, lineId, b) => {
  const { l, job } = await lineRow(db, tenant, lineId);
  const f = {};
  if (b.quantity !== undefined) f.quantity = q3(num(b.quantity, 'Quantity', { min: 0.001, max: 100000, required: true }));
  if (b.unit_price !== undefined) f.unit_price_paise = money(b.unit_price, 'Price', { min: 0, required: true });
  if (b.description !== undefined) f.description = text(b.description, 'Description', { max: 200, required: true });
  if (b.tax_rate !== undefined && l.kind === 'LABOUR') f.tax_rate = num(b.tax_rate, 'GST rate', { min: 0, max: 100, required: true });
  if (!Object.keys(f).length) throw new PartsError(400, 'Nothing to update');
  if (f.unit_price_paise !== undefined && l.kind === 'PART') {
    const list = (await sales.tradePrices(db, tenant.businessId, job.customer_id, [l.product_id])).get(l.product_id) ?? Number((await db.query(`SELECT selling_price_paise FROM products WHERE product_id = $1`, [l.product_id])).rows[0].selling_price_paise);
    if (f.unit_price_paise < list && !hasPermission(tenant, 'price_change')) throw new PartsError(403, 'A price below the list price needs the price change right');
  }
  if (f.quantity !== undefined && l.kind === 'PART' && Number(l.quantity) !== f.quantity) {
    const had = Boolean(l.reservation_id);
    if (had) { await sales.release(db, tenant, l.reservation_id).catch(() => {}); }
    f.reservation_id = had ? await holdFor(db, tenant, userId, job, l.product_id, f.quantity, `Job card ${job.job_no}`) : null;
  }
  const keys = Object.keys(f);
  await db.query(`UPDATE job_card_lines SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE line_id = $1`, [l.line_id, ...keys.map((k) => f[k])]);
  return getJob(db, tenant, job.job_id);
};

export const removeLine = async (db, tenant, lineId) => {
  const { l, job } = await lineRow(db, tenant, lineId);
  if (l.reservation_id) await sales.release(db, tenant, l.reservation_id).catch(() => {});
  await db.query(`DELETE FROM job_card_lines WHERE line_id = $1`, [l.line_id]);
  return getJob(db, tenant, job.job_id);
};

/**
 * Bill the card: one invoice for the parts (billing takes the held stock) and the labour. `payment` / `payments` / `discount` pass through to billing as at the counter.
 * Call inside a transaction that rolls back on any error.
 */
export const billJob = async (client, tenant, userId, id, b = {}) => {
  const job = await jobRow(client, tenant, id, { lock: true });
  ensureLive(job);
  const lines = (await client.query(`SELECT * FROM job_card_lines WHERE job_id = $1 ORDER BY kind DESC, line_id`, [job.job_id])).rows;
  if (!lines.length) throw new PartsError(400, 'Add the parts or labour before billing the job');
  if (!job.customer_id) throw new PartsError(400, 'Choose the customer first');
  const items = lines.map((l) => (l.kind === 'PART'
    ? { product_id: l.product_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price_paise) / 100, description: l.description }
    : { description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price_paise) / 100, tax_rate: Number(l.tax_rate) }));
  const vehicle = [job.vehicle_reg, [job.make, job.model].filter(Boolean).join(' '), job.odometer_km != null ? `${job.odometer_km} km` : ''].filter(Boolean).join(' · ');
  const invoice = await createInvoiceInTransaction(client, tenant, userId, {
    customerId: job.customer_id, items, discount: b.discount, payment: b.payment, payments: b.payments, notes: `Job card ${job.job_no} · ${vehicle}`, clientKey: b.clientKey
  });
  await client.query(`UPDATE job_cards SET status = 'BILLED', invoice_id = $2, billed_at = now() WHERE job_id = $1`, [job.job_id, invoice.invoice_id]);
  return { invoice, job: await getJob(client, tenant, job.job_id) };
};

/* ── services the shop charges for ───────────────────────────────────────── */

export const listServices = async (db, tenant) =>
  (await db.query(`SELECT service_id, name, price_paise, tax_rate FROM workshop_services WHERE business_id = $1 AND is_active ORDER BY lower(name)`, [tenant.businessId])).rows
    .map((r) => ({ ...r, price_paise: Number(r.price_paise), tax_rate: r.tax_rate == null ? null : Number(r.tax_rate) }));

/** Add a service, or change the charge of the one with the same name. */
export const saveService = async (db, tenant, b) => {
  const name = text(b.name, 'Service name', { max: 120, required: true });
  const price = money(b.price, 'Charge', { required: true });
  const tax = b.tax_rate === undefined || b.tax_rate === null || b.tax_rate === '' ? null : num(b.tax_rate, 'GST rate', { min: 0, max: 100 });
  const row = (await db.query(
    `INSERT INTO workshop_services (business_id, name, price_paise, tax_rate) VALUES ($1,$2,$3,$4)
     ON CONFLICT (business_id, lower(name)) WHERE is_active DO UPDATE SET price_paise = EXCLUDED.price_paise, tax_rate = EXCLUDED.tax_rate
     RETURNING service_id, name, price_paise, tax_rate`, [tenant.businessId, name, price, tax])).rows[0];
  return { ...row, price_paise: Number(row.price_paise), tax_rate: row.tax_rate == null ? null : Number(row.tax_rate) };
};

export const removeService = async (db, tenant, id) => {
  const r = await db.query(`UPDATE workshop_services SET is_active = FALSE WHERE service_id = $1 AND business_id = $2 AND is_active RETURNING service_id`, [id, tenant.businessId]);
  if (!r.rowCount) throw new PartsError(404, 'Not found');
  return { removed: true };
};

/**
 * What the workshop earned on the bills made from job cards, by day: labour and parts before GST, the GST, and the bill totals (cancelled bills left out),
 * plus each mechanic's labour. These bills are ordinary invoices, so they are also in the shop's sales reports; this only splits them into labour and parts.
 */
export const workshopReport = async (db, tenant, { from, to }) => {
  const args = [tenant.businessId, from, to];
  const scope = tenant.scopeBranchId != null ? ` AND j.branch_id = $4` : '';
  if (scope) args.push(tenant.scopeBranchId);
  const days = (await db.query(
    `SELECT i.invoice_date AS day, COUNT(DISTINCT j.job_id)::int AS jobs,
            COALESCE(SUM(ROUND(l.quantity * l.unit_price_paise)) FILTER (WHERE l.kind = 'LABOUR'), 0) AS labour_paise,
            COALESCE(SUM(ROUND(l.quantity * l.unit_price_paise)) FILTER (WHERE l.kind = 'PART'), 0) AS parts_paise,
            MAX(i.total_paise) AS total_paise
       FROM job_cards j JOIN invoices i ON i.invoice_id = j.invoice_id AND i.status = 'ISSUED'
       JOIN job_card_lines l ON l.job_id = j.job_id
      WHERE j.business_id = $1 AND j.status = 'BILLED' AND i.invoice_date BETWEEN $2 AND $3${scope}
      GROUP BY i.invoice_date, j.job_id`, args)).rows;
  const byDay = new Map();
  for (const r of days) {
    const d = byDay.get(String(r.day).slice(0, 10)) || { day: String(r.day).slice(0, 10), jobs: 0, labour_paise: 0, parts_paise: 0, total_paise: 0 };
    d.jobs += r.jobs; d.labour_paise += Number(r.labour_paise); d.parts_paise += Number(r.parts_paise); d.total_paise += Number(r.total_paise);
    byDay.set(d.day, d);
  }
  const rows = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const totals = rows.reduce((t, d) => ({ jobs: t.jobs + d.jobs, labour_paise: t.labour_paise + d.labour_paise, parts_paise: t.parts_paise + d.parts_paise, total_paise: t.total_paise + d.total_paise }), { jobs: 0, labour_paise: 0, parts_paise: 0, total_paise: 0 });
  const mech = (await db.query(
    `SELECT COALESCE(e.name, 'Not assigned') AS name, COUNT(DISTINCT j.job_id)::int AS jobs,
            COALESCE(SUM(ROUND(l.quantity * l.unit_price_paise)) FILTER (WHERE l.kind = 'LABOUR'), 0) AS labour_paise
       FROM job_cards j JOIN invoices i ON i.invoice_id = j.invoice_id AND i.status = 'ISSUED'
       JOIN job_card_lines l ON l.job_id = j.job_id LEFT JOIN hr_employees e ON e.employee_id = j.mechanic_id
      WHERE j.business_id = $1 AND j.status = 'BILLED' AND i.invoice_date BETWEEN $2 AND $3${scope}
      GROUP BY e.name ORDER BY labour_paise DESC`, args)).rows.map((r) => ({ ...r, labour_paise: Number(r.labour_paise) }));
  return { from, to, totals, days: rows, mechanics: mech };
};


/* ── telling the customer on WhatsApp ────────────────────────────────────── */

const rupees = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(paise) / 100) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const SHARE_EVENTS = ['received', 'estimate', 'ready', 'bill'];

/**
 * The words for one update to the customer, and a wa.me address that opens WhatsApp on their number with those words ready: sent by a person from the shop's own
 * WhatsApp, so it needs no WhatsApp Business set-up and nothing is sent from here. events: received (we have your vehicle), estimate (what it will cost, please approve),
 * ready (come and collect), bill (the bill with its link).
 */
export const shareJob = async (db, tenant, id, event) => {
  const kind = String(event || '').toLowerCase();
  if (!SHARE_EVENTS.includes(kind)) throw new PartsError(400, `Message must be one of: ${SHARE_EVENTS.join(', ')}`);
  const job = await getJob(db, tenant, id);
  const shop = (await db.query(`SELECT name FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0]?.name || 'our workshop';
  const name = job.customer_name || 'there';
  const vehicle = [[job.make, job.model].filter(Boolean).join(' '), job.vehicle_reg].filter(Boolean).join(' ');
  let text;
  if (kind === 'received') {
    text = `Hi ${name}, we have received your ${vehicle} at ${shop}. Job card ${job.job_no}.${job.complaint ? ` Work asked for: ${job.complaint}.` : ''}${job.promised_on ? ` We expect to have it ready by ${job.promised_on}.` : ''} We will keep you updated.`;
  } else if (kind === 'estimate') {
    if (!job.lines.length) throw new PartsError(400, 'Add the parts or labour first, so there is an estimate to send');
    const lines = job.lines.map((l) => `${l.description}${l.kind === 'PART' ? ` x${Number(l.quantity)}` : ''}: ${rupees(l.amount_paise)}`).join('; ');
    text = `Hi ${name}, the estimate for your ${vehicle} at ${shop} (${job.job_no}): ${lines}. GST ${rupees(job.estimate.tax_paise)}. Total ${rupees(job.estimate.total_paise)}. Please reply to approve the work.`;
  } else if (kind === 'ready') {
    text = `Hi ${name}, your ${vehicle} is ready at ${shop} (${job.job_no}).${job.estimate.total_paise ? ` The bill will be about ${rupees(job.estimate.total_paise)}.` : ''} You can collect it now.`;
  } else {
    if (!job.invoice_id) throw new PartsError(409, 'Make the bill first');
    const { billShare } = await import('../messaging/index.js');
    const b = await billShare(db, { businessId: tenant.businessId, invoiceId: job.invoice_id, phone: job.customer_phone });
    if (b.problem) throw new PartsError(b.code || 400, b.problem);
    text = `Hi ${name}, your ${vehicle} is done at ${shop}. ${b.text.replace(/^Hi [^,]*, /, '')}`;
  }
  const { normalisePhone } = await import('../loyalty.js');
  const { default: config } = await import('../../config/env.js');
  const digits = normalisePhone(job.customer_phone);
  if (!digits) throw new PartsError(400, 'This customer has no mobile number');
  const to = digits.length === 10 ? `${config.messaging.countryCode}${digits}` : digits;
  return { event: kind, text, phone: to, wa_url: `https://wa.me/${to}?text=${encodeURIComponent(text)}` };
};
