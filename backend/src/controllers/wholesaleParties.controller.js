/*
 * Wholesale parties: B2B customers, suppliers, salespeople, and the module's settings.
 *
 * A wholesale customer is still a `customers` row (invoices, credit notes, loyalty and every existing screen keep
 * working); the trade half — type, terms, addresses, salesperson, price list, opening balance — lives in
 * wholesale_customer_profiles. The same goes for suppliers. What a party owes is never stored: it is computed from
 * the documents by modules/wholesale/ledger.js, the one definition every screen shares.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { checkEmail, checkGstin, checkName, firstError } from '../utils/validate.js';
import {
  WholesaleError, audit, bool, withTransaction, diff, getSettings, int, isoDate, like, money, num, ok, oneOf, page, paging, phone, text, today, wrapAll
} from '../modules/wholesale/common.js';
import { creditPosition } from '../modules/wholesale/credit.js';
import { BUCKETS, customerBalances, customerLedger, receivableAgeing, supplierBalances, supplierLedger } from '../modules/wholesale/ledger.js';

const CUSTOMER_TYPES = ['RETAILER', 'DEALER', 'DISTRIBUTOR', 'BUSINESS', 'CORPORATE', 'OTHER'];
const rupees = (v) => toRupees(Number(v || 0));
const pan = (v) => {
  const s = text(v, 'PAN', { max: 10 });
  if (s && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(s)) throw new WholesaleError(400, 'A PAN is 10 characters like ABCDE1234F');
  return s ? s.toUpperCase() : null;
};
const pin = (v, field = 'Pincode') => {
  const s = text(v, field, { max: 6 });
  if (s && !/^[1-9]\d{5}$/.test(s)) throw new WholesaleError(400, `${field} is 6 digits`);
  return s;
};
const failed = (e) => { if (e) throw new WholesaleError(400, e); };

/** A sales executive sees and creates only their own customers: the salesperson record linked to their login (0 = none, sees nothing). */
export const mySalesperson = async (req) => {
  if (!['SALES_EXECUTIVE', 'FIELD_SALES'].includes(req.tenant.role)) return null;
  const row = (await pool.query(`SELECT salesperson_id FROM wholesale_salespeople WHERE business_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [req.tenant.businessId, req.auth.userId])).rows[0];
  return row ? row.salesperson_id : 0;
};

/** A customer row this person may see: everyone's for staff, only their own customers' for a sales executive. */
export const visibleCustomer = async (req, id) => {
  const row = await loadCustomer(pool, req.tenant.businessId, id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const mine = await mySalesperson(req);
  if (mine != null && row.salesperson_id !== mine) throw new WholesaleError(404, 'Not found');
  return row;
};

/* ═══ customers ═══════════════════════════════════════════════════════════════════════════════ */

const CUSTOMER_FROM = `
  FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id
  LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = w.salesperson_id
  LEFT JOIN wholesale_price_lists pl ON pl.list_id = w.price_list_id
  LEFT JOIN dist_territories tt ON tt.territory_id = w.territory_id`;
const CUSTOMER_COLS = `c.customer_id, c.name, c.phone, c.email, c.address, c.state, c.pincode, c.gstin, c.credit_limit_paise, c.status, c.created_at,
  w.customer_type, w.contact_person, w.pan, w.billing_address, w.shipping_address, w.city, w.shipping_city, w.shipping_state, w.shipping_pincode,
  w.payment_terms_days, w.salesperson_id, sp.name AS salesperson_name, w.price_list_id, pl.name AS price_list_name, w.default_discount_pct,
  w.opening_balance_paise, w.credit_policy, w.notes, w.territory_id, tt.name AS territory_name`;

const customerShape = (r, bal = null, position = null) => ({
  customer_id: r.customer_id, name: r.name, phone: r.phone, email: r.email, status: r.status, created_at: r.created_at,
  customer_type: r.customer_type || 'RETAILER', contact_person: r.contact_person, gstin: r.gstin, pan: r.pan,
  address: r.address, state: r.state, pincode: r.pincode, billing_address: r.billing_address || r.address, shipping_address: r.shipping_address,
  city: r.city, shipping_city: r.shipping_city, shipping_state: r.shipping_state, shipping_pincode: r.shipping_pincode,
  credit_limit: rupees(r.credit_limit_paise), payment_terms_days: r.payment_terms_days, salesperson_id: r.salesperson_id, salesperson: r.salesperson_name,
  price_list_id: r.price_list_id, price_list: r.price_list_name, territory_id: r.territory_id ?? null, territory: r.territory_name ?? null, default_discount_pct: Number(r.default_discount_pct || 0),
  opening_balance: rupees(r.opening_balance_paise), credit_policy: r.credit_policy, notes: r.notes,
  ...(bal ? { outstanding: rupees(bal.outstanding), overdue: rupees(bal.overdue), total_invoiced: rupees(bal.invoiced), total_paid: rupees(bal.paid) } : {}),
  ...(position ? { credit: { limit: rupees(position.limit), outstanding: rupees(position.outstanding), overdue: rupees(position.overdue), promised: rupees(position.promised), available: position.available == null ? null : rupees(position.available), utilization_pct: position.utilization_pct, policy: position.policy } } : {})
});

/* GET /customers?q=&type=&salesperson_id=&status=&has_balance=1&overdue=1&sort=&limit=&offset= */
const listCustomers = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId];
  const where = [`c.business_id = $1`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`c.status = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`(c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR c.gstin ILIKE $${values.length} OR w.contact_person ILIKE $${values.length})`); }
  if (req.query.type) { values.push(oneOf(req.query.type, 'Type', CUSTOMER_TYPES)); where.push(`COALESCE(w.customer_type, 'RETAILER') = $${values.length}`); }
  if (req.query.salesperson_id) { values.push(Number(req.query.salesperson_id) || 0); where.push(`w.salesperson_id = $${values.length}`); }
  const mine = await mySalesperson(req);
  if (mine) { values.push(mine); where.push(`w.salesperson_id = $${values.length}`); }
  const base = `${CUSTOMER_FROM} WHERE ${where.join(' AND ')}`;
  const wantsBalance = req.query.has_balance === '1' || req.query.overdue === '1' || ['balance', 'overdue'].includes(String(req.query.sort));
  if (!wantsBalance) {
    const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
    values.push(pg.limit, pg.offset);
    const rows = (await pool.query(`SELECT ${CUSTOMER_COLS} ${base} ORDER BY lower(c.name), c.customer_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
    const s = await getSettings(pool, req.tenant.businessId);
    const bal = await customerBalances(pool, { businessId: req.tenant.businessId, customerIds: rows.map((r) => r.customer_id), graceDays: s.overdue_grace_days });
    return page(res, rows.map((r) => customerShape(r, bal.get(r.customer_id))), total, pg);
  }
  // filtering / sorting on a computed balance: compute for the candidates, then filter in memory (bounded by the business's customers)
  const s = await getSettings(pool, req.tenant.businessId);
  const rows = (await pool.query(`SELECT ${CUSTOMER_COLS} ${base} ORDER BY lower(c.name)`, values)).rows;
  const bal = await customerBalances(pool, { businessId: req.tenant.businessId, customerIds: rows.map((r) => r.customer_id), graceDays: s.overdue_grace_days });
  let out = rows.map((r) => customerShape(r, bal.get(r.customer_id)));
  if (req.query.has_balance === '1') out = out.filter((c) => c.outstanding > 0);
  if (req.query.overdue === '1') out = out.filter((c) => c.overdue > 0);
  if (req.query.sort === 'balance') out.sort((a, b) => b.outstanding - a.outstanding);
  if (req.query.sort === 'overdue') out.sort((a, b) => b.overdue - a.overdue);
  page(res, out.slice(pg.offset, pg.offset + pg.limit), out.length, pg);
};

const loadCustomer = async (db, businessId, id) => (await db.query(`SELECT ${CUSTOMER_COLS} ${CUSTOMER_FROM} WHERE c.business_id = $1 AND c.customer_id = $2`, [businessId, id])).rows[0];

const getCustomer = async (req, res) => {
  const row = await visibleCustomer(req, req.params.id);
  const s = await getSettings(pool, req.tenant.businessId);
  const bal = (await customerBalances(pool, { businessId: req.tenant.businessId, customerIds: [row.customer_id], graceDays: s.overdue_grace_days })).get(row.customer_id);
  const position = await creditPosition(pool, { businessId: req.tenant.businessId, customerId: row.customer_id, settings: s });
  const stats = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'ISSUED') AS invoices, MAX(invoice_date) FILTER (WHERE status = 'ISSUED') AS last_invoice, COALESCE(AVG(total_paise) FILTER (WHERE status = 'ISSUED'), 0) AS avg_invoice
     FROM invoices WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, row.customer_id])).rows[0];
  const orders = (await pool.query(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE status IN ('PENDING','CONFIRMED','PARTIALLY_FULFILLED','PACKED','DISPATCHED')) AS open FROM wholesale_sales_orders WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, row.customer_id])).rows[0];
  ok(res, { ...customerShape(row, bal, position), stats: { invoices: Number(stats.invoices), last_invoice: stats.last_invoice, average_invoice: rupees(stats.avg_invoice), orders: Number(orders.n), open_orders: Number(orders.open) } });
};

const customerFields = (b, partial) => {
  const core = {}; const prof = {};
  const has = (k) => !partial || k in b;
  if (has('name')) { failed(checkName(b.name, 'Customer name')); core.name = String(b.name).trim(); }
  if (has('phone')) { phone(b.phone); core.phone = text(b.phone, 'Phone', { max: 32 }); }
  if (has('email')) { if (b.email) failed(checkEmail(b.email)); core.email = b.email ? String(b.email).trim().toLowerCase() : null; }
  if (has('gstin')) { failed(checkGstin(b.gstin)); core.gstin = b.gstin ? String(b.gstin).trim().toUpperCase() : null; }
  if ('address' in b) core.address = text(b.address, 'Address', { max: 400 });
  if ('state' in b) core.state = text(b.state, 'State', { max: 80 });
  if ('pincode' in b) core.pincode = pin(b.pincode);
  if ('credit_limit' in b) core.credit_limit_paise = money(b.credit_limit, 'Credit limit') ?? 0;
  if ('customer_type' in b) prof.customer_type = oneOf(b.customer_type, 'Customer type', CUSTOMER_TYPES, { required: true });
  if ('contact_person' in b) prof.contact_person = text(b.contact_person, 'Contact person', { max: 120 });
  if ('pan' in b) prof.pan = pan(b.pan);
  if ('billing_address' in b) prof.billing_address = text(b.billing_address, 'Billing address', { max: 400 });
  if ('shipping_address' in b) prof.shipping_address = text(b.shipping_address, 'Shipping address', { max: 400 });
  if ('city' in b) prof.city = text(b.city, 'City', { max: 80 });
  if ('shipping_city' in b) prof.shipping_city = text(b.shipping_city, 'Shipping city', { max: 80 });
  if ('shipping_state' in b) prof.shipping_state = text(b.shipping_state, 'Shipping state', { max: 80 });
  if ('shipping_pincode' in b) prof.shipping_pincode = pin(b.shipping_pincode, 'Shipping pincode');
  if ('payment_terms_days' in b) prof.payment_terms_days = int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 });
  if ('salesperson_id' in b) prof.salesperson_id = int(b.salesperson_id, 'Salesperson', { min: 1 });
  if ('price_list_id' in b) prof.price_list_id = int(b.price_list_id, 'Price list', { min: 1 });
  if ('default_discount_pct' in b) prof.default_discount_pct = num(b.default_discount_pct, 'Standing discount', { min: 0, max: 100 }) ?? 0;
  if ('opening_balance' in b) prof.opening_balance_paise = money(b.opening_balance, 'Opening balance', { min: -100000000000 }) ?? 0;
  if ('credit_policy' in b) prof.credit_policy = b.credit_policy ? oneOf(b.credit_policy, 'Credit policy', ['OFF', 'WARN', 'BLOCK']) : null;
  if ('notes' in b) prof.notes = text(b.notes, 'Notes', { max: 1000 });
  if ('territory_id' in b) prof.territory_id = int(b.territory_id, 'Territory', { min: 1 });
  return { core, prof };
};

const checkRefs = async (db, businessId, prof) => {
  if (prof.salesperson_id && !(await db.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [businessId, prof.salesperson_id])).rowCount) throw new WholesaleError(400, 'That salesperson does not exist');
  if (prof.price_list_id && !(await db.query(`SELECT 1 FROM wholesale_price_lists WHERE business_id = $1 AND list_id = $2`, [businessId, prof.price_list_id])).rowCount) throw new WholesaleError(400, 'That price list does not exist');
  if (prof.territory_id && !(await db.query(`SELECT 1 FROM dist_territories WHERE business_id = $1 AND territory_id = $2`, [businessId, prof.territory_id])).rowCount) throw new WholesaleError(400, 'That territory was not found');
};

const upsertProfile = async (client, businessId, customerId, prof) => {
  const keys = Object.keys(prof);
  const cols = ['customer_id', 'business_id', ...keys];
  const updates = [...keys, 'updated_at'].map((k) => (k === 'updated_at' ? 'updated_at = CURRENT_TIMESTAMP' : `${k} = EXCLUDED.${k}`)).join(', ');
  await client.query(`INSERT INTO wholesale_customer_profiles (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (customer_id) DO UPDATE SET ${updates}`, [customerId, businessId, ...keys.map((k) => prof[k])]);
};

const createCustomer = async (req, res) => {
  const { core, prof } = customerFields(req.body || {}, false);
  await checkRefs(pool, req.tenant.businessId, prof);
  if (core.phone) {
    const dup = await pool.query(`SELECT customer_id, name FROM customers WHERE business_id = $1 AND status = 'ACTIVE' AND right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = right(regexp_replace($2, '\\D', '', 'g'), 10) LIMIT 1`, [req.tenant.businessId, core.phone]);
    if (dup.rowCount) throw new WholesaleError(409, `${dup.rows[0].name} already has that phone number`, { data: { customer_id: dup.rows[0].customer_id } });
  }
  const mine = await mySalesperson(req);
  if (mine && !prof.salesperson_id) prof.salesperson_id = mine;
  const id = await withTransaction(async (client) => {
    const keys = Object.keys(core);
    const row = (await client.query(`INSERT INTO customers (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING customer_id`, [req.tenant.businessId, ...keys.map((k) => core[k])])).rows[0];
    await upsertProfile(client, req.tenant.businessId, row.customer_id, prof);
    return row.customer_id;
  });
  audit(req, 'wholesale.customer_created', 'customer', id, null, { ...core, ...prof });
  ok(res, customerShape(await loadCustomer(pool, req.tenant.businessId, id)), 201);
};

const updateCustomer = async (req, res) => {
  const before = await visibleCustomer(req, req.params.id);
  const { core, prof } = customerFields(req.body || {}, true);
  if (!Object.keys(core).length && !Object.keys(prof).length) throw new WholesaleError(400, 'Nothing to update');
  await checkRefs(pool, req.tenant.businessId, prof);
  await withTransaction(async (client) => {
    const keys = Object.keys(core);
    if (keys.length) await client.query(`UPDATE customers SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, before.customer_id, ...keys.map((k) => core[k])]);
    if (Object.keys(prof).length) await upsertProfile(client, req.tenant.businessId, before.customer_id, prof);
  });
  const after = await loadCustomer(pool, req.tenant.businessId, before.customer_id);
  audit(req, 'wholesale.customer_updated', 'customer', before.customer_id, null, null, { changes: diff(customerShape(before), customerShape(after)) });
  ok(res, customerShape(after));
};

const setCustomerStatus = (status) => async (req, res) => {
  await visibleCustomer(req, req.params.id);
  const hit = await pool.query(`UPDATE customers SET status = $3 WHERE business_id = $1 AND customer_id = $2 RETURNING customer_id`, [req.tenant.businessId, req.params.id, status]);
  if (!hit.rowCount) throw new WholesaleError(404, 'Not found');
  audit(req, `wholesale.customer_${status === 'ACTIVE' ? 'restored' : 'archived'}`, 'customer', hit.rows[0].customer_id);
  ok(res, { customer_id: hit.rows[0].customer_id, status });
};

const customerLedgerEndpoint = async (req, res) => {
  const row = await visibleCustomer(req, req.params.id);
  const l = await customerLedger(pool, { businessId: req.tenant.businessId, customerId: row.customer_id, from: isoDate(req.query.from, 'From'), to: isoDate(req.query.to, 'To') });
  ok(res, {
    customer: { customer_id: row.customer_id, name: row.name, gstin: row.gstin, phone: row.phone },
    opening: rupees(l.opening), closing: rupees(l.closing), total_closing: rupees(l.total_closing),
    total_debit: rupees(l.lines.reduce((s, x) => s + x.debit, 0)), total_credit: rupees(l.lines.reduce((s, x) => s + x.credit, 0)),
    lines: l.lines.map((x) => ({ date: x.date, type: x.type, ref: x.ref, ref_id: x.ref_id, description: x.description, debit: rupees(x.debit), credit: rupees(x.credit), balance: rupees(x.balance) }))
  });
};

const customerAgeing = async (req, res) => {
  const row = await visibleCustomer(req, req.params.id);
  const items = await receivableAgeing(pool, { businessId: req.tenant.businessId, customerId: row.customer_id });
  const buckets = Object.fromEntries(BUCKETS.map(([k]) => [k, 0]));
  for (const i of items) buckets[i.bucket] += Number(i.balance_due_paise);
  ok(res, { buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, rupees(v)])), invoices: items.map((i) => ({ invoice_id: i.invoice_id, invoice_number: i.invoice_number, invoice_date: i.invoice_date, due_date: i.due_date, days_overdue: i.days_overdue, bucket: i.bucket, total: rupees(i.total_paise), paid: rupees(i.amount_paid_paise), balance: rupees(i.balance_due_paise) })) });
};

const customerInvoices = async (req, res) => {
  await visibleCustomer(req, req.params.id);
  const pg = paging(req.query, { max: 100, fallback: 25 });
  const { rows } = await pool.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.total_paise, i.balance_due_paise, i.payment_status, i.status, m.due_date, m.kind, COUNT(*) OVER() AS total
     FROM invoices i LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id WHERE i.business_id = $1 AND i.customer_id = $2
     ORDER BY i.invoice_date DESC, i.invoice_id DESC LIMIT $3 OFFSET $4`, [req.tenant.businessId, req.params.id, pg.limit, pg.offset]);
  page(res, rows.map((r) => ({ invoice_id: r.invoice_id, invoice_number: r.invoice_number, invoice_date: r.invoice_date, due_date: r.due_date, kind: r.kind, total: rupees(r.total_paise), balance_due: rupees(r.balance_due_paise), payment_status: r.payment_status, status: r.status })), Number(rows[0]?.total || 0), pg);
};

const customerCredit = async (req, res) => {
  await visibleCustomer(req, req.params.id);
  const position = await creditPosition(pool, { businessId: req.tenant.businessId, customerId: Number(req.params.id) });
  if (!position) throw new WholesaleError(404, 'Not found');
  ok(res, { limit: rupees(position.limit), outstanding: rupees(position.outstanding), overdue: rupees(position.overdue), promised: rupees(position.promised), available: position.available == null ? null : rupees(position.available), utilization_pct: position.utilization_pct, policy: position.policy });
};

/* A standing credit limit change is a money decision: its own endpoint so it is audited with the old and new figure. */
const setCreditLimit = async (req, res) => {
  const limit = money(req.body?.credit_limit, 'Credit limit', { required: true });
  const before = (await pool.query(`SELECT credit_limit_paise FROM customers WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  await pool.query(`UPDATE customers SET credit_limit_paise = $3 WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, req.params.id, limit]);
  audit(req, 'wholesale.credit_limit_changed', 'customer', Number(req.params.id), { credit_limit: rupees(before.credit_limit_paise) }, { credit_limit: rupees(limit) }, { reason: text(req.body?.reason, 'Reason', { max: 200 }) });
  ok(res, { credit_limit: rupees(limit) });
};

/* ═══ suppliers ═══════════════════════════════════════════════════════════════════════════════ */

const SUPPLIER_COLS = `s.supplier_id, s.name, s.phone, s.email, s.address, s.gstin, s.status, s.created_at,
  w.contact_person, w.pan, w.city, w.state, w.pincode, w.payment_terms_days, w.opening_balance_paise, w.bank_details, w.notes`;
const SUPPLIER_FROM = `FROM suppliers s LEFT JOIN wholesale_supplier_profiles w ON w.supplier_id = s.supplier_id`;
const supplierShape = (r, bal = null) => ({
  supplier_id: r.supplier_id, name: r.name, phone: r.phone, email: r.email, address: r.address, gstin: r.gstin, status: r.status, created_at: r.created_at,
  contact_person: r.contact_person, pan: r.pan, city: r.city, state: r.state, pincode: r.pincode, payment_terms_days: r.payment_terms_days,
  opening_balance: rupees(r.opening_balance_paise), bank_details: r.bank_details, notes: r.notes,
  ...(bal ? { outstanding: rupees(bal.outstanding), total_purchased: rupees(bal.bought), total_paid: rupees(bal.paid) } : {})
});

const listSuppliers = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = [`s.business_id = $1`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`s.status = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`(s.name ILIKE $${values.length} OR s.phone ILIKE $${values.length} OR s.gstin ILIKE $${values.length} OR w.contact_person ILIKE $${values.length})`); }
  const base = `${SUPPLIER_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT ${SUPPLIER_COLS} ${base} ORDER BY lower(s.name), s.supplier_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  const bal = await supplierBalances(pool, { businessId: req.tenant.businessId, supplierIds: rows.map((r) => r.supplier_id) });
  page(res, rows.map((r) => supplierShape(r, bal.get(r.supplier_id))), total, pg);
};

const loadSupplier = async (db, businessId, id) => (await db.query(`SELECT ${SUPPLIER_COLS} ${SUPPLIER_FROM} WHERE s.business_id = $1 AND s.supplier_id = $2`, [businessId, id])).rows[0];

const getSupplier = async (req, res) => {
  const row = await loadSupplier(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const bal = (await supplierBalances(pool, { businessId: req.tenant.businessId, supplierIds: [row.supplier_id] })).get(row.supplier_id);
  const stats = (await pool.query(`SELECT COUNT(*) AS orders, MAX(po_date) AS last_order FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2 AND status <> 'CANCELLED'`, [req.tenant.businessId, row.supplier_id])).rows[0];
  ok(res, { ...supplierShape(row, bal), stats: { orders: Number(stats.orders), last_order: stats.last_order } });
};

const supplierFields = (b, partial) => {
  const core = {}; const prof = {}; const has = (k) => !partial || k in b;
  if (has('name')) { failed(checkName(b.name, 'Supplier name')); core.name = String(b.name).trim(); }
  if ('phone' in b) { phone(b.phone); core.phone = text(b.phone, 'Phone', { max: 32 }); }
  if ('email' in b) { if (b.email) failed(checkEmail(b.email)); core.email = b.email ? String(b.email).trim().toLowerCase() : null; }
  if ('gstin' in b) { failed(checkGstin(b.gstin)); core.gstin = b.gstin ? String(b.gstin).trim().toUpperCase() : null; }
  if ('address' in b) core.address = text(b.address, 'Address', { max: 400 });
  if ('contact_person' in b) prof.contact_person = text(b.contact_person, 'Contact person', { max: 120 });
  if ('pan' in b) prof.pan = pan(b.pan);
  if ('city' in b) prof.city = text(b.city, 'City', { max: 80 });
  if ('state' in b) prof.state = text(b.state, 'State', { max: 80 });
  if ('pincode' in b) prof.pincode = pin(b.pincode);
  if ('payment_terms_days' in b) prof.payment_terms_days = int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 });
  if ('opening_balance' in b) prof.opening_balance_paise = money(b.opening_balance, 'Opening balance', { min: -100000000000 }) ?? 0;
  if ('bank_details' in b) prof.bank_details = text(b.bank_details, 'Bank details', { max: 300 });
  if ('notes' in b) prof.notes = text(b.notes, 'Notes', { max: 1000 });
  return { core, prof };
};
const upsertSupplierProfile = async (client, businessId, supplierId, prof) => {
  const keys = Object.keys(prof); const cols = ['supplier_id', 'business_id', ...keys];
  await client.query(`INSERT INTO wholesale_supplier_profiles (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (supplier_id) DO UPDATE SET ${[...keys.map((k) => `${k} = EXCLUDED.${k}`), 'updated_at = CURRENT_TIMESTAMP'].join(', ')}`, [supplierId, businessId, ...keys.map((k) => prof[k])]);
};

const createSupplier = async (req, res) => {
  const { core, prof } = supplierFields(req.body || {}, false);
  const id = await withTransaction(async (client) => {
    const keys = Object.keys(core);
    const row = (await client.query(`INSERT INTO suppliers (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING supplier_id`, [req.tenant.businessId, ...keys.map((k) => core[k])])).rows[0];
    await upsertSupplierProfile(client, req.tenant.businessId, row.supplier_id, prof);
    return row.supplier_id;
  });
  audit(req, 'wholesale.supplier_created', 'supplier', id, null, { ...core, ...prof });
  ok(res, supplierShape(await loadSupplier(pool, req.tenant.businessId, id)), 201);
};

const updateSupplier = async (req, res) => {
  const before = await loadSupplier(pool, req.tenant.businessId, req.params.id);
  if (!before) throw new WholesaleError(404, 'Not found');
  const { core, prof } = supplierFields(req.body || {}, true);
  if (!Object.keys(core).length && !Object.keys(prof).length) throw new WholesaleError(400, 'Nothing to update');
  await withTransaction(async (client) => {
    const keys = Object.keys(core);
    if (keys.length) await client.query(`UPDATE suppliers SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND supplier_id = $2`, [req.tenant.businessId, before.supplier_id, ...keys.map((k) => core[k])]);
    if (Object.keys(prof).length) await upsertSupplierProfile(client, req.tenant.businessId, before.supplier_id, prof);
  });
  const after = await loadSupplier(pool, req.tenant.businessId, before.supplier_id);
  audit(req, 'wholesale.supplier_updated', 'supplier', before.supplier_id, null, null, { changes: diff(supplierShape(before), supplierShape(after)) });
  ok(res, supplierShape(after));
};

const setSupplierStatus = (status) => async (req, res) => {
  const hit = await pool.query(`UPDATE suppliers SET status = $3 WHERE business_id = $1 AND supplier_id = $2 RETURNING supplier_id`, [req.tenant.businessId, req.params.id, status]);
  if (!hit.rowCount) throw new WholesaleError(404, 'Not found');
  audit(req, `wholesale.supplier_${status === 'ACTIVE' ? 'restored' : 'archived'}`, 'supplier', hit.rows[0].supplier_id);
  ok(res, { supplier_id: hit.rows[0].supplier_id, status });
};

const supplierLedgerEndpoint = async (req, res) => {
  const row = await loadSupplier(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const l = await supplierLedger(pool, { businessId: req.tenant.businessId, supplierId: row.supplier_id, from: isoDate(req.query.from, 'From'), to: isoDate(req.query.to, 'To') });
  ok(res, {
    supplier: { supplier_id: row.supplier_id, name: row.name, gstin: row.gstin },
    opening: rupees(l.opening), closing: rupees(l.closing), total_closing: rupees(l.total_closing),
    lines: l.lines.map((x) => ({ date: x.date, type: x.type, ref: x.ref, ref_id: x.ref_id, description: x.description, debit: rupees(x.debit), credit: rupees(x.credit), balance: rupees(x.balance) }))
  });
};

/* ═══ ledger adjustments (write-offs, corrections) ════════════════════════════════════════════ */

const adjustLedger = async (req, res) => {
  const b = req.body || {};
  const partyType = oneOf(b.party_type, 'Party type', ['CUSTOMER', 'SUPPLIER'], { required: true });
  const partyId = int(b.party_id, 'Party', { min: 1, required: true });
  const amount = money(b.amount, 'Amount', { min: -100000000000, required: true });
  if (amount === 0) throw new WholesaleError(400, 'The amount cannot be zero');
  const reason = text(b.reason, 'Reason', { max: 200, required: true, min: 3 });
  const table = partyType === 'CUSTOMER' ? 'customers' : 'suppliers';
  if (!(await pool.query(`SELECT 1 FROM ${table} WHERE business_id = $1 AND ${partyType === 'CUSTOMER' ? 'customer_id' : 'supplier_id'} = $2`, [req.tenant.businessId, partyId])).rowCount) throw new WholesaleError(404, 'Party not found');
  const date = isoDate(b.date, 'Date') || await today(pool, req.tenant.businessId);
  const row = (await pool.query(`INSERT INTO wholesale_ledger_adjustments (business_id, party_type, party_id, adj_date, amount_paise, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING adj_id`, [req.tenant.businessId, partyType, partyId, date, amount, reason, req.auth.userId])).rows[0];
  audit(req, 'wholesale.ledger_adjusted', partyType.toLowerCase(), partyId, null, { amount: rupees(amount), reason, date });
  ok(res, { adj_id: row.adj_id }, 201);
};

/* ═══ salespeople ═════════════════════════════════════════════════════════════════════════════ */

const spShape = (r) => ({
  salesperson_id: r.salesperson_id, user_id: r.user_id, name: r.name, phone: r.phone, email: r.email, territory: r.territory,
  commission_pct: Number(r.commission_pct), commission_on: r.commission_on, status: r.status,
  employee_id: r.employee_id ?? null, sales_role: r.sales_role ?? 'SALES_EXECUTIVE', territory_id: r.territory_id ?? null, manager_id: r.manager_id ?? null,
  ...(r.customers != null ? { customers: Number(r.customers) } : {})
});

const listSalespeople = async (req, res) => {
  const values = [req.tenant.businessId]; let where = `sp.business_id = $1`;
  if (String(req.query.status || 'ACTIVE').toUpperCase() !== 'ALL') { values.push(String(req.query.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'); where += ` AND sp.status = $2`; }
  const rows = (await pool.query(`SELECT sp.*, (SELECT COUNT(*) FROM wholesale_customer_profiles w WHERE w.salesperson_id = sp.salesperson_id) AS customers FROM wholesale_salespeople sp WHERE ${where} ORDER BY lower(sp.name)`, values)).rows;
  ok(res, rows.map(spShape));
};

const spFields = (b, partial) => {
  const f = {}; const has = (k) => !partial || k in b;
  if (has('name')) f.name = text(b.name, 'Name', { max: 120, min: 2, required: true });
  if ('phone' in b) { phone(b.phone); f.phone = text(b.phone, 'Phone', { max: 32 }); }
  if ('email' in b) { if (b.email) failed(checkEmail(b.email)); f.email = b.email ? String(b.email).trim().toLowerCase() : null; }
  if ('territory' in b) f.territory = text(b.territory, 'Territory', { max: 120 });
  if ('commission_pct' in b) f.commission_pct = num(b.commission_pct, 'Commission', { min: 0, max: 100 }) ?? 0;
  if ('commission_on' in b) f.commission_on = oneOf(b.commission_on, 'Commission basis', ['SALES', 'COLLECTIONS'], { required: true });
  if ('status' in b) f.status = oneOf(b.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  if ('user_id' in b) f.user_id = int(b.user_id, 'Login', { min: 1 });
  if ('employee_id' in b) f.employee_id = text(b.employee_id, 'Employee ID', { max: 40 });
  if ('sales_role' in b) f.sales_role = oneOf(b.sales_role, 'Role', ['SALES_MANAGER', 'SALES_EXECUTIVE', 'FIELD_SALES', 'COLLECTION_EXECUTIVE', 'DELIVERY_EXECUTIVE'], { required: true });
  if ('territory_id' in b) f.territory_id = int(b.territory_id, 'Territory', { min: 1 });
  if ('manager_id' in b) f.manager_id = int(b.manager_id, 'Manager', { min: 1 });
  return f;
};

const checkUser = async (businessId, userId) => {
  if (userId && !(await pool.query(`SELECT 1 FROM business_users WHERE business_id = $1 AND user_id = $2`, [businessId, userId])).rowCount) throw new WholesaleError(400, 'That login is not on your team');
};

const createSalesperson = async (req, res) => {
  const f = spFields(req.body || {}, false); await checkUser(req.tenant.businessId, f.user_id);
  const keys = Object.keys(f);
  const row = (await pool.query(`INSERT INTO wholesale_salespeople (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0];
  audit(req, 'wholesale.salesperson_created', 'salesperson', row.salesperson_id, null, f);
  ok(res, spShape(row), 201);
};

const updateSalesperson = async (req, res) => {
  const before = (await pool.query(`SELECT * FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = spFields(req.body || {}, true); await checkUser(req.tenant.businessId, f.user_id);
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  const after = (await pool.query(`UPDATE wholesale_salespeople SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND salesperson_id = $2 RETURNING *`, [req.tenant.businessId, before.salesperson_id, ...keys.map((k) => f[k])])).rows[0];
  audit(req, 'wholesale.salesperson_updated', 'salesperson', before.salesperson_id, null, null, { changes: diff(spShape(before), spShape(after)) });
  ok(res, spShape(after));
};

/* GET /salespeople/:id/performance?from=&to= — sales, collections, customers, commission due */
const salespersonPerformance = async (req, res) => {
  const sp = (await pool.query(`SELECT * FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!sp) throw new WholesaleError(404, 'Not found');
  const to = isoDate(req.query.to, 'To') || await today(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || `${to.slice(0, 8)}01`;
  const sold = (await pool.query(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total_paise), 0) AS sales FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
     WHERE i.business_id = $1 AND m.salesperson_id = $2 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $3 AND $4`, [req.tenant.businessId, sp.salesperson_id, from, to])).rows[0];
  const collected = (await pool.query(
    `SELECT COALESCE(SUM(p.amount_paise), 0) AS collected FROM payments p JOIN wholesale_invoice_meta m ON m.invoice_id = p.invoice_id
     WHERE p.business_id = $1 AND m.salesperson_id = $2 AND p.payment_date BETWEEN $3 AND $4`, [req.tenant.businessId, sp.salesperson_id, from, to])).rows[0];
  const customers = Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_customer_profiles WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, sp.salesperson_id])).rows[0].n);
  const basis = sp.commission_on === 'COLLECTIONS' ? Number(collected.collected) : Number(sold.sales);
  ok(res, {
    salesperson: spShape(sp), from, to, invoices: Number(sold.invoices), sales: rupees(sold.sales), collections: rupees(collected.collected), customers,
    commission_basis: sp.commission_on, commission: rupees(Math.round(basis * Number(sp.commission_pct) / 100))
  });
};

/* ═══ settings ════════════════════════════════════════════════════════════════════════════════ */

const settingsShape = (s) => ({
  credit_policy: s.credit_policy, block_when_overdue: s.block_when_overdue, overdue_grace_days: s.overdue_grace_days, default_payment_terms_days: s.default_payment_terms_days,
  default_price_list_id: s.default_price_list_id, negative_stock: s.negative_stock, reserve_on_confirm: s.reserve_on_confirm, fefo: s.fefo, expiry_alert_days: s.expiry_alert_days,
  order_approval_over: s.order_approval_over_paise == null ? null : rupees(s.order_approval_over_paise), slow_moving_days: s.slow_moving_days, dead_stock_days: s.dead_stock_days,
  order_prefix: s.order_prefix, invoice_footer: s.invoice_footer, notifications: s.notifications || {},
  distributor_enabled: Boolean(s.distributor_enabled), scheme_stacking: s.scheme_stacking || 'BEST', visit_location: Boolean(s.visit_location),
  field_collections: s.field_collections !== false, credit_manager_override: s.credit_manager_override !== false
});
/** A DISTRIBUTOR business always has the distributor features; a WHOLESALE business can switch them on. */
const withMode = (req, shaped) => ({ ...shaped, distributor_enabled: req.tenant.businessType === 'DISTRIBUTOR' || shaped.distributor_enabled, distributor_locked: req.tenant.businessType === 'DISTRIBUTOR' });

const getSettingsEndpoint = async (req, res) => ok(res, withMode(req, settingsShape(await getSettings(pool, req.tenant.businessId))));

const NOTIFY_KEYS = ['order_confirmed', 'order_dispatched', 'invoice_issued', 'payment_received', 'payment_due', 'payment_overdue'];

const updateSettings = async (req, res) => {
  const b = req.body || {}; const f = {};
  if ('credit_policy' in b) f.credit_policy = oneOf(b.credit_policy, 'Credit policy', ['OFF', 'WARN', 'BLOCK'], { required: true });
  if ('block_when_overdue' in b) f.block_when_overdue = bool(b.block_when_overdue);
  if ('overdue_grace_days' in b) f.overdue_grace_days = int(b.overdue_grace_days, 'Grace days', { min: 0, max: 365, required: true });
  if ('default_payment_terms_days' in b) f.default_payment_terms_days = int(b.default_payment_terms_days, 'Payment terms', { min: 0, max: 365, required: true });
  if ('default_price_list_id' in b) {
    f.default_price_list_id = int(b.default_price_list_id, 'Price list', { min: 1 });
    if (f.default_price_list_id && !(await pool.query(`SELECT 1 FROM wholesale_price_lists WHERE business_id = $1 AND list_id = $2`, [req.tenant.businessId, f.default_price_list_id])).rowCount) throw new WholesaleError(400, 'That price list does not exist');
  }
  if ('negative_stock' in b) f.negative_stock = oneOf(b.negative_stock, 'Negative stock', ['BLOCK', 'ALLOW'], { required: true });
  if ('reserve_on_confirm' in b) f.reserve_on_confirm = bool(b.reserve_on_confirm);
  if ('fefo' in b) f.fefo = bool(b.fefo);
  if ('expiry_alert_days' in b) {
    const days = [...new Set((Array.isArray(b.expiry_alert_days) ? b.expiry_alert_days : []).map(Number))];
    if (days.length > 6 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 730)) throw new WholesaleError(400, 'Expiry alert days are up to 6 whole numbers between 1 and 730');
    f.expiry_alert_days = JSON.stringify(days.sort((a, c) => a - c));
  }
  if ('order_approval_over' in b) f.order_approval_over_paise = b.order_approval_over === '' || b.order_approval_over == null ? null : money(b.order_approval_over, 'Approval limit', { min: 100 });
  if ('slow_moving_days' in b) f.slow_moving_days = int(b.slow_moving_days, 'Slow-moving days', { min: 7, max: 730, required: true });
  if ('dead_stock_days' in b) f.dead_stock_days = int(b.dead_stock_days, 'Dead-stock days', { min: 30, max: 1460, required: true });
  if ('order_prefix' in b) {
    f.order_prefix = text(b.order_prefix, 'Order prefix', { max: 8, required: true });
    if (!/^[A-Za-z0-9]{1,8}$/.test(f.order_prefix)) throw new WholesaleError(400, 'The order prefix is letters and digits only');
    f.order_prefix = f.order_prefix.toUpperCase();
  }
  if ('distributor_enabled' in b) f.distributor_enabled = req.tenant.businessType === 'DISTRIBUTOR' ? true : bool(b.distributor_enabled);
  if ('scheme_stacking' in b) f.scheme_stacking = oneOf(b.scheme_stacking, 'Scheme stacking', ['BEST', 'ALL'], { required: true });
  if ('visit_location' in b) f.visit_location = bool(b.visit_location);
  if ('field_collections' in b) f.field_collections = bool(b.field_collections);
  if ('credit_manager_override' in b) f.credit_manager_override = bool(b.credit_manager_override);
  if ('invoice_footer' in b) f.invoice_footer = text(b.invoice_footer, 'Invoice footer', { max: 300 });
  if ('notifications' in b) {
    const n = {}; for (const k of NOTIFY_KEYS) if (k in (b.notifications || {})) n[k] = bool(b.notifications[k]);
    const current = (await getSettings(pool, req.tenant.businessId)).notifications || {};
    f.notifications = JSON.stringify({ ...current, ...n });
  }
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  const before = settingsShape(await getSettings(pool, req.tenant.businessId));
  await pool.query(
    `INSERT INTO wholesale_settings (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (business_id) DO UPDATE SET ${keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`, [req.tenant.businessId, ...keys.map((k) => f[k])]);
  const after = settingsShape(await getSettings(pool, req.tenant.businessId));
  audit(req, 'wholesale.settings_updated', 'settings', req.tenant.businessId, null, null, { changes: diff(before, after) });
  ok(res, withMode(req, after));
};

export default wrapAll({
  listCustomers, getCustomer, createCustomer, updateCustomer, archiveCustomer: setCustomerStatus('ARCHIVED'), restoreCustomer: setCustomerStatus('ACTIVE'),
  customerLedger: customerLedgerEndpoint, customerAgeing, customerInvoices, customerCredit, setCreditLimit,
  listSuppliers, getSupplier, createSupplier, updateSupplier, archiveSupplier: setSupplierStatus('ARCHIVED'), restoreSupplier: setSupplierStatus('ACTIVE'), supplierLedger: supplierLedgerEndpoint,
  adjustLedger, listSalespeople, createSalesperson, updateSalesperson, salespersonPerformance,
  getSettings: getSettingsEndpoint, updateSettings
});
