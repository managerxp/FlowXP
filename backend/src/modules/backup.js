/*
 * A backup of one business's data the owner can keep: a ZIP with one CSV per table (customers, suppliers, products, bills and their lines,
 * payments, refunds, credit notes, purchases, expenses, stock and its movements, outlets). It is the owner's own data, so it is every column as
 * stored, except the secret in a bill's public link. Amounts ending _paise are in paise (a hundredth of a rupee), exactly as the database holds them.
 * The same ZIP can be restored (modules/restore.js), which only adds what is missing.
 *
 * ponytail: built in memory, fine to a few hundred thousand rows a table; stream each file into the ZIP if a business ever outgrows that.
 */
import pool from '../config/database.js';
import { csv, zip } from './accountantPack.js';

/* [file, SQL taking the business id as $1] */
const TABLES = [
  ['branches', 'SELECT * FROM branches WHERE business_id = $1 ORDER BY branch_id'],
  ['categories', 'SELECT * FROM categories WHERE business_id = $1 ORDER BY category_id'],
  ['customers', 'SELECT * FROM customers WHERE business_id = $1 ORDER BY customer_id'],
  ['suppliers', 'SELECT * FROM suppliers WHERE business_id = $1 ORDER BY supplier_id'],
  ['products', 'SELECT * FROM products WHERE business_id = $1 ORDER BY product_id'],
  ['stock-by-outlet', 'SELECT bs.* FROM branch_stock bs JOIN branches b ON b.branch_id = bs.branch_id WHERE b.business_id = $1 ORDER BY bs.branch_id, bs.product_id'],
  ['stock-movements', 'SELECT * FROM inventory_transactions WHERE business_id = $1 ORDER BY txn_id'],
  ['invoices', 'SELECT * FROM invoices WHERE business_id = $1 ORDER BY invoice_id'],
  ['invoice-lines', 'SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id WHERE i.business_id = $1 ORDER BY ii.item_id'],
  ['payments', 'SELECT * FROM payments WHERE business_id = $1 ORDER BY payment_id'],
  ['refunds', 'SELECT * FROM refunds WHERE business_id = $1 ORDER BY refund_id'],
  ['credit-notes', 'SELECT * FROM credit_notes WHERE business_id = $1 ORDER BY cn_id'],
  ['credit-note-lines', 'SELECT ci.* FROM credit_note_items ci JOIN credit_notes c ON c.cn_id = ci.cn_id WHERE c.business_id = $1 ORDER BY ci.cn_item_id'],
  ['purchase-orders', 'SELECT * FROM purchase_orders WHERE business_id = $1 ORDER BY po_id'],
  ['purchase-order-lines', 'SELECT pi.* FROM purchase_order_items pi JOIN purchase_orders po ON po.po_id = pi.po_id WHERE po.business_id = $1 ORDER BY pi.item_id'],
  ['expenses', 'SELECT * FROM expenses WHERE business_id = $1 ORDER BY expense_id']
];
const SECRET_COLUMNS = new Set(['share_token']);

const cellOf = (v) => (v instanceof Date ? v.toISOString() : v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** The files of a backup: a README, then one CSV per table. */
export const buildBackup = async (businessId, db = pool) => {
  const business = (await db.query('SELECT name, business_type, gstin FROM businesses WHERE business_id = $1', [businessId])).rows[0] || {};
  const files = []; const counts = [];
  for (const [name, sql] of TABLES) {
    const { rows, fields } = await db.query(sql, [businessId]);
    const head = fields.map((f) => f.name).filter((c) => !SECRET_COLUMNS.has(c));
    files.push({ name: `${name}.csv`, data: csv(head, rows.map((r) => head.map((c) => cellOf(r[c])))) });
    counts.push(`${name}.csv: ${rows.length} rows`);
  }
  files.unshift({ name: 'README.txt', data: [
    `${business.name || 'FlowXP'} - backup of your data`, business.gstin ? `GSTIN ${business.gstin}` : null, `Made by FlowXP on ${new Date().toISOString().slice(0, 10)}`, '',
    'One CSV file per table, every column as stored. Amounts in columns ending _paise are in paise (100 paise = 1 rupee). Dates and times are in UTC or the date the record carries.',
    'This is a copy to keep, audit or move your records. To put it back, use Settings > Backup > Restore from a backup: it only adds what is missing and never changes what is already there.', '', ...counts].filter((l) => l !== null).join('\r\n') });
  return files;
};

export const backupZip = async (businessId, db = pool) => zip(await buildBackup(businessId, db));
