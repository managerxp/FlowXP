/*
 * Restore from a backup (modules/backup.js made it): put the records of a FlowXP backup ZIP back into a business WITHOUT touching anything that is already there.
 *
 * "Add what is missing" is the only mode. Every record in the backup is looked up in the business by what identifies it to a person (a bill by its number, a part by its code,
 * a customer by name and phone, a payment by its amount, date and time ...). A bill, credit note or purchase must match on its number AND its total: a number that is taken by a
 * different record is a clash, which is skipped (with the records that hang from it), never mistaken for "already here". A record that is already there is left exactly as it is; one that is missing is added, with a new
 * internal id, and the records that point at it (a bill's lines, a payment) are pointed at the new id. Nothing is ever changed or deleted, so a restore cannot damage today's
 * books, and running it twice adds nothing the second time.
 *
 *   - Lines that belong to a bill, purchase or credit note (and a new product's stock figures and movements) are added only together with the record they belong to. The stock of
 *     a product that already exists is never changed: a restore that brought back an old bill does not move the shelf. Do a stock count afterwards if goods were lost.
 *   - The same code serves the preview and the real thing: the preview runs inside a transaction that is rolled back, so what it reports is what would happen.
 *   - A record that cannot be added (it clashes with something else, or points at a record the backup does not have) is skipped and listed, never forced.
 *   - People who made a record (created_by) and other links outside the backup (brands, orders ...) are kept when they exist here and left empty when they do not.
 *
 * ponytail: rows are looked up one at a time; fine for a business of a few hundred thousand rows, batch the lookups per table if one ever outgrows that.
 */
import zlib from 'node:zlib';

export class RestoreError extends Error {
  constructor(status, message) { super(message); this.name = 'RestoreError'; this.status = status; }
}

const MAX_FILE = 200 * 1024 * 1024;   // one CSV, uncompressed
const MAX_TOTAL = 400 * 1024 * 1024;  // all of them (a ZIP of zeros must not fill the server)
const MAX_ROWS = 1_000_000;

/* ── reading the ZIP and the CSV ─────────────────────────────────────────── */

/** The files of a ZIP as { name: Buffer }. Stored and deflated entries only (what backups use); sizes are checked before anything is inflated. */
export const unzip = (buf) => {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || buf.length < 22) throw new RestoreError(400, 'That is not a ZIP file');
  const count = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16);
  const out = {}; let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new RestoreError(400, 'That ZIP file is damaged');
    const method = buf.readUInt16LE(at + 10); const crc = buf.readUInt32LE(at + 16); const csize = buf.readUInt32LE(at + 20); const usize = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28); const xlen = buf.readUInt16LE(at + 30); const clen = buf.readUInt16LE(at + 32); const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nlen);
    at += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (usize > MAX_FILE || (total += usize) > MAX_TOTAL) throw new RestoreError(413, 'That backup is too large to restore here');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const packed = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = packed;
    else if (method === 8) { try { data = zlib.inflateRawSync(packed, { maxOutputLength: MAX_FILE }); } catch { throw new RestoreError(400, 'That ZIP file is damaged'); } }
    else throw new RestoreError(400, 'That ZIP file uses a format FlowXP cannot read');
    if (zlib.crc32(data) !== crc) throw new RestoreError(400, `${name} is damaged (its checksum does not match)`);
    out[name.replace(/^.*[\\/]/, '')] = data;
  }
  return out;
};

/** CSV text to an array of { column: value }. Quoted cells, doubled quotes, newlines inside a cell, a leading byte-order mark. The backup's spreadsheet guard (a ' before = + @ -) is taken off. */
export const parseCsv = (text) => {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = []; let row = []; let cell = ''; let quoted = false; let i = 0;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i += 1; continue; }
      cell += c; i += 1; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i += 1; } else if (c === ',') { endCell(); i += 1; } else if (c === '\r') { i += 1; } else if (c === '\n') { endRow(); i += 1; } else { cell += c; i += 1; }
    if (rows.length > MAX_ROWS) throw new RestoreError(413, 'That backup has too many rows to restore here');
  }
  if (cell !== '' || row.length) endRow();
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, k) => [h, /^'[=+@\t\r-]/.test(r[k] ?? '') ? r[k].slice(1) : (r[k] ?? '')])));
};

/* ── what is restored, in dependency order ───────────────────────────────── */

/* A backup writes times to the millisecond; the database keeps microseconds. Two times within 2 ms are the same moment. */
const SAME_INSTANT = (column, param) => `abs(extract(epoch FROM ${column}) - extract(epoch FROM ${param}::timestamptz)) < 0.002`;

/**
 * file: the CSV; table, pk; fk: columns remapped through the ids of other restored tables; find: SQL ($1 = the business, then the row's values) answering "is it already here",
 * returning the id; parent / parentCol: a table whose lines are added only with a NEW parent; skip: columns never restored.
 */
const SPECS = [
  { file: 'branches.csv', table: 'branches', pk: 'branch_id', label: 'Outlets', find: 'SELECT branch_id AS id FROM branches WHERE business_id = $1 AND lower(name) = lower($2)', key: (r) => [r.name], skip: ['status'] },
  { file: 'categories.csv', table: 'categories', pk: 'category_id', label: 'Categories', find: 'SELECT category_id AS id FROM categories WHERE business_id = $1 AND lower(name) = lower($2)', key: (r) => [r.name], defer: { parent_id: 'categories' } },
  { file: 'customers.csv', table: 'customers', pk: 'customer_id', label: 'Customers', find: `SELECT customer_id AS id FROM customers WHERE business_id = $1 AND lower(name) = lower($2) AND COALESCE(phone, '') = $3`, key: (r) => [r.name, r.phone ?? ''] },
  { file: 'suppliers.csv', table: 'suppliers', pk: 'supplier_id', label: 'Suppliers', find: `SELECT supplier_id AS id FROM suppliers WHERE business_id = $1 AND lower(name) = lower($2) AND COALESCE(phone, '') = $3`, key: (r) => [r.name, r.phone ?? ''] },
  {
    file: 'products.csv', table: 'products', pk: 'product_id', label: 'Products', fk: { category_id: 'categories', supplier_id: 'suppliers' },
    find: `SELECT product_id AS id FROM products WHERE business_id = $1 AND (($2 <> '' AND lower(sku) = lower($2)) OR ($2 = '' AND $3 <> '' AND barcode = $3) OR ($2 = '' AND $3 = '' AND lower(name) = lower($4)))`, key: (r) => [r.sku ?? '', r.barcode ?? '', r.name]
  },
  { file: 'stock-by-outlet.csv', table: 'branch_stock', pk: null, label: 'Stock by outlet', fk: { branch_id: 'branches', product_id: 'products' }, parent: 'products', parentCol: 'product_id' },
  { file: 'stock-movements.csv', table: 'inventory_transactions', pk: 'txn_id', label: 'Stock movements', fk: { branch_id: 'branches', product_id: 'products' }, parent: 'products', parentCol: 'product_id' },
  {
    file: 'invoices.csv', table: 'invoices', pk: 'invoice_id', label: 'Bills', fk: { branch_id: 'branches', customer_id: 'customers' }, skip: ['client_key'],
    find: 'SELECT invoice_id AS id FROM invoices WHERE business_id = $1 AND invoice_number = $2 AND total_paise = $3::bigint', key: (r) => [r.invoice_number, r.total_paise || null]
  },
  { file: 'invoice-lines.csv', table: 'invoice_items', pk: 'item_id', label: 'Bill lines', fk: { invoice_id: 'invoices', product_id: 'products' }, parent: 'invoices', parentCol: 'invoice_id' },
  {
    file: 'payments.csv', table: 'payments', pk: 'payment_id', label: 'Payments', fk: { branch_id: 'branches', invoice_id: 'invoices', customer_id: 'customers', po_id: 'purchase_orders', supplier_id: 'suppliers' }, order: 'late',
    find: `SELECT payment_id AS id FROM payments WHERE business_id = $1 AND payment_method = $2 AND amount_paise = $3::bigint AND payment_date = $4::date AND ${SAME_INSTANT('created_at', '$5')}`, key: (r) => [r.payment_method, r.amount_paise || null, r.payment_date || null, r.created_at || null]
  },
  {
    file: 'credit-notes.csv', table: 'credit_notes', pk: 'cn_id', label: 'Credit notes', fk: { branch_id: 'branches', invoice_id: 'invoices' },
    find: 'SELECT cn_id AS id FROM credit_notes WHERE business_id = $1 AND cn_number = $2 AND total_paise = $3::bigint', key: (r) => [r.cn_number, r.total_paise || null]
  },
  { file: 'credit-note-lines.csv', table: 'credit_note_items', pk: 'cn_item_id', label: 'Credit note lines', fk: { cn_id: 'credit_notes', invoice_item_id: 'invoice_items', product_id: 'products' }, parent: 'credit_notes', parentCol: 'cn_id' },
  {
    file: 'refunds.csv', table: 'refunds', pk: 'refund_id', label: 'Refunds', fk: { invoice_id: 'invoices', credit_note_id: 'credit_notes' },
    find: `SELECT refund_id AS id FROM refunds WHERE business_id = $1 AND amount_paise = $2::bigint AND ${SAME_INSTANT('created_at', '$3')} AND reason = $4`, key: (r) => [r.amount_paise || null, r.created_at || null, r.reason]
  },
  {
    file: 'purchase-orders.csv', table: 'purchase_orders', pk: 'po_id', label: 'Purchases', fk: { branch_id: 'branches', supplier_id: 'suppliers' },
    find: 'SELECT po_id AS id FROM purchase_orders WHERE business_id = $1 AND po_number = $2 AND total_paise = $3::bigint', key: (r) => [r.po_number, r.total_paise || null]
  },
  { file: 'purchase-order-lines.csv', table: 'purchase_order_items', pk: 'item_id', label: 'Purchase lines', fk: { po_id: 'purchase_orders', product_id: 'products' }, parent: 'purchase_orders', parentCol: 'po_id' },
  {
    file: 'expenses.csv', table: 'expenses', pk: 'expense_id', label: 'Expenses', fk: { branch_id: 'branches' },
    find: `SELECT expense_id AS id FROM expenses WHERE business_id = $1 AND expense_date = $2::date AND amount_paise = $3::bigint AND category = $4 AND COALESCE(description, '') = $5 AND ${SAME_INSTANT('created_at', '$6')}`,
    key: (r) => [r.expense_date || null, r.amount_paise || null, r.category, r.description ?? '', r.created_at || null]
  }
];

/* payments are restored after the bills and purchases they pay, whatever the file order */
const ORDER = [...SPECS.filter((s) => s.order !== 'late'), ...SPECS.filter((s) => s.order === 'late')];
export const RESTORE_FILES = SPECS.map((s) => s.file);

/* a record with no name or number is not a record */
const NEED = { 'branches.csv': 'name', 'categories.csv': 'name', 'customers.csv': 'name', 'suppliers.csv': 'name', 'products.csv': 'name', 'invoices.csv': 'invoice_number', 'credit-notes.csv': 'cn_number', 'purchase-orders.csv': 'po_number' };

const columnsOf = async (db, cache, table) => {
  if (cache.has(table)) return cache.get(table);
  const cols = (await db.query(`SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows;
  const fks = (await db.query(
    `SELECT a.attname AS col, cl2.relname AS ref, a2.attname AS refcol FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class cl2 ON cl2.oid = c.confrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] JOIN pg_attribute a2 ON a2.attrelid = c.confrelid AND a2.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND cl.relname = $1 AND array_length(c.conkey, 1) = 1`, [table])).rows;
  const info = { cols: new Map(cols.map((c) => [c.column_name, { nullable: c.is_nullable === 'YES', type: c.data_type }])), fks: new Map(fks.map((f) => [f.col, f])) };
  cache.set(table, info);
  return info;
};

/** A link to something outside the backup (a user, a brand, an order ...): kept when it exists, empty when it does not. */
const outside = async (db, memo, ref, refcol, value, businessId) => {
  const k = `${ref}.${value}`;
  if (memo.has(k)) return memo.get(k);
  const scoped = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'business_id'`, [ref])).rowCount;
  const q = scoped ? `SELECT 1 FROM ${ref} WHERE ${refcol} = $1 AND business_id = $2` : `SELECT 1 FROM ${ref} WHERE ${refcol} = $1`;
  const found = (await db.query(q, scoped ? [value, businessId] : [value])).rowCount > 0;
  memo.set(k, found);
  return found;
};

/**
 * Run the restore inside the caller's transaction (the caller commits for the real thing and rolls back for a preview). `files` is { name: Buffer } from unzip().
 * Returns the report. Throws RestoreError for a file that is not a backup.
 */
export const restoreInto = async (db, businessId, files) => {
  if (!files['customers.csv'] && !files['products.csv'] && !files['invoices.csv']) throw new RestoreError(400, 'That does not look like a FlowXP backup. Choose the ZIP file you downloaded under Settings > Backup.');
  await db.query('SELECT 1 FROM businesses WHERE business_id = $1 FOR UPDATE', [businessId]);
  const maps = new Map(); const fresh = new Map();   // table -> Map(old id -> new id), table -> Set(old ids added now)
  const colCache = new Map(); const memo = new Map();
  const tables = [];
  const readme = files['README.txt']?.toString('utf8') ?? '';
  const source = { name: (readme.split(/\r?\n/)[0] || '').replace(/ - backup of your data$/, '') || null, gstin: (readme.match(/^GSTIN (\S+)/m) || [])[1] || null, made_on: (readme.match(/Made by FlowXP on (\d{4}-\d{2}-\d{2})/) || [])[1] || null };

  for (const spec of ORDER) {
    const report = { file: spec.file, label: spec.label, found: false, rows: 0, added: 0, already_there: 0, not_needed: 0, skipped: 0, problems: [] };
    tables.push(report);
    const data = files[spec.file];
    if (!data) continue;
    report.found = true;
    const rows = parseCsv(data.toString('utf8'));
    report.rows = rows.length;
    const idMap = new Map(); maps.set(spec.table, idMap);
    const newOnes = new Set(); fresh.set(spec.table, newOnes);
    const { cols, fks } = await columnsOf(db, colCache, spec.table);
    const deferred = [];

    for (let n = 0; n < rows.length; n += 1) {
      const row = rows[n];
      const oldId = spec.pk ? row[spec.pk] : null;
      const problem = (why) => { report.skipped += 1; if (report.problems.length < 10) report.problems.push({ row: n + 2, why }); };
      const need = NEED[spec.file];
      if (need && !String(row[need] ?? '').trim()) { problem(`it has no ${need.replace('_', ' ')}`); continue; }
      // lines go in only with a record that is new
      if (spec.parent) {
        const parentOld = row[spec.parentCol];
        if (!fresh.get(spec.parent)?.has(parentOld)) { report.not_needed += 1; continue; }
      } else if (spec.find) {
        const hit = (await db.query(spec.find, [businessId, ...spec.key(row).map((v) => (v === '' ? '' : v))])).rows[0];
        if (hit) { report.already_there += 1; if (oldId) idMap.set(oldId, hit.id); continue; }
      }
      // build the new row
      const names = []; const values = []; let bad = null;
      for (const [name, raw] of Object.entries(row)) {
        const meta = cols.get(name);
        if (!meta || name === spec.pk || spec.skip?.includes(name) || name === 'share_token') continue;
        let v = raw;
        if (name === 'business_id') v = String(businessId);
        else if (spec.defer?.[name]) { if (raw !== '') deferred.push({ oldId, col: name, old: raw }); continue; }
        else if (spec.fk?.[name] || fks.has(name)) {
          if (raw === '') v = null;
          else if (spec.fk?.[name]) { const m = maps.get(spec.fk[name])?.get(raw); if (m === undefined) { if (!meta.nullable) { bad = `${name} points at a record that is not in the backup`; break; } v = null; } else v = String(m); }
          else if (fks.get(name).ref === 'businesses') v = String(businessId);
          else if (await outside(db, memo, fks.get(name).ref, fks.get(name).refcol, raw, businessId)) v = raw;
          else if (meta.nullable) v = null;
          else { bad = `${name} points at a record that does not exist here`; break; }
        } else if (raw === '') v = meta.nullable ? null : (['text', 'character varying', 'character'].includes(meta.type) ? '' : null);
        names.push(name); values.push(v);
      }
      if (bad) { problem(bad); continue; }
      if (!names.length) { problem('the row is empty'); continue; }
      await db.query('SAVEPOINT row_restore');
      try {
        const r = await db.query(`INSERT INTO ${spec.table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) ${spec.pk ? `RETURNING ${spec.pk} AS id` : ''}`, values);
        await db.query('RELEASE SAVEPOINT row_restore');
        report.added += 1;
        if (oldId) { idMap.set(oldId, r.rows[0].id); newOnes.add(oldId); }
        // a stock row has no id of its own: it belongs to its product
        if (!spec.pk && spec.parentCol) newOnes.add(row[spec.parentCol]);
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT row_restore');
        problem(error.code === '23505' ? 'it clashes with a record that is already here' : error.code === '23514' || error.code === '23502' || error.code === '22P02' || error.code === '22007' || error.code === '22003' ? 'a value in it is not valid' : error.code === '23503' ? 'it points at a record that is missing' : 'it could not be added');
      }
    }
    // links between rows of the same table (a category inside another): set once every row has an id
    for (const d of deferred) {
      const mine = idMap.get(d.oldId); const parent = idMap.get(d.old);
      if (mine !== undefined && parent !== undefined && newOnes.has(d.oldId)) await db.query(`UPDATE ${spec.table} SET ${d.col} = $2 WHERE ${spec.pk} = $1`, [mine, parent]);
    }
  }

  // numbering: a restored bill number must never be handed out again
  const notes = [];
  for (const [table, number, prefixCol, counterCol, scope] of [['invoices', 'invoice_number', 'invoice_prefix', 'invoice_next_number', 'branch'], ['credit_notes', 'cn_number', 'credit_note_prefix', 'credit_note_next_number', 'business'], ['purchase_orders', 'po_number', 'po_prefix', 'po_next_number', 'business']]) {
    const made = fresh.get(table)?.size ? await db.query(`SELECT ${number} AS n${scope === 'branch' ? ', branch_id' : ''} FROM ${table} WHERE business_id = $1 AND ${number} ~ '-[0-9]+$'`, [businessId]) : { rows: [] };
    if (!made.rows.length) continue;
    const top = new Map();
    for (const r of made.rows) { const m = /^(.*)-(\d+)$/.exec(r.n); if (!m) continue; const k = `${scope === 'branch' ? r.branch_id : 'b'}|${m[1]}`; top.set(k, Math.max(top.get(k) ?? 0, Number(m[2]))); }
    for (const [k, max] of top) {
      const [where, prefix] = k.split('|');
      if (scope === 'branch' && where !== 'b') { await db.query(`UPDATE branches SET invoice_next_number = GREATEST(invoice_next_number, $3) WHERE branch_id = $1 AND business_id = $4 AND upper(invoice_prefix) = upper($2)`, [Number(where), prefix, max + 1, businessId]); }
      await db.query(`UPDATE businesses SET ${counterCol} = GREATEST(${counterCol}, $2) WHERE business_id = $1 AND upper(${prefixCol}) = upper($3)`, [businessId, max + 1, prefix]);
    }
    notes.push(`${table} numbering moved past the restored numbers`);
  }
  const totals = tables.reduce((t, r) => ({ added: t.added + r.added, already_there: t.already_there + r.already_there, skipped: t.skipped + r.skipped }), { added: 0, already_there: 0, skipped: 0 });
  return { source, tables, totals, notes: [...new Set(notes)] };
};
