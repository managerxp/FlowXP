/*
 * ProductIdentifierService — everything a product can be found by besides its immutable product_id.
 *
 *   FlowXP SKU (modules/sku.js) · barcodes (any number) · aliases · supplier codes · ERP code
 *
 * Manual entry, a scanner, a spreadsheet and AI invoice reading all call these same functions, so the rules (a barcode
 * belongs to one product, nothing is silently overwritten) are enforced once. `db` is a pool or a client.
 */
export class IdentityError extends Error {
  constructor(status, code, message, data) {
    super(message);
    this.name = 'IdentityError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/* ── cleaning ─────────────────────────────────────────────────────────────── */

/** Barcodes are printable characters with no spaces; what a scanner sends is trimmed. */
export const cleanBarcode = (value) => {
  const text = String(value ?? '').trim();
  if (!text) throw new IdentityError(400, 'BAD_BARCODE', 'Enter a barcode');
  if (!/^[\x21-\x7E]{1,64}$/.test(text)) throw new IdentityError(400, 'BAD_BARCODE', 'A barcode is up to 64 letters, digits or symbols, with no spaces');
  return text;
};

/** Supplier and ERP codes may contain spaces; they are trimmed and single-spaced. */
export const cleanCode = (value, label = 'Code') => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new IdentityError(400, 'BAD_CODE', `Enter the ${label.toLowerCase()}`);
  if (text.length > 64 || /[\x00-\x1F\x7F]/.test(text)) throw new IdentityError(400, 'BAD_CODE', `${label} is up to 64 characters`);
  return text;
};

export const cleanAlias = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 160) throw new IdentityError(400, 'BAD_ALIAS', 'An alternative name is 2 to 160 characters');
  return text;
};

/** LIKE patterns: the shopper's % and _ are text, not wildcards. */
const likeEscape = (text) => String(text).replace(/[\\%_]/g, '\\$&');

/* ── barcodes ─────────────────────────────────────────────────────────────── */

/** Which product holds this barcode, in this business. */
export const barcodeOwner = async (db, businessId, barcode) => {
  const { rows } = await db.query(
    `SELECT p.product_id, p.name, p.sku, p.status FROM product_barcodes b JOIN products p ON p.product_id = b.product_id
     WHERE b.business_id = $1 AND b.barcode = $2`, [businessId, barcode]
  );
  return rows[0] || null;
};

export const barcodesOf = async (db, businessId, productId) =>
  (await db.query(
    `SELECT b.barcode_id, b.barcode, (b.barcode = p.barcode) AS is_primary, b.created_at
     FROM product_barcodes b JOIN products p ON p.product_id = b.product_id
     WHERE b.business_id = $1 AND b.product_id = $2 ORDER BY (b.barcode = p.barcode) DESC, b.barcode_id`, [businessId, productId]
  )).rows;

/** Take a barcode off a product. If it was the primary, the oldest remaining one becomes primary. */
export const removeBarcode = async (db, { businessId, productId, barcode }) => {
  const product = (await db.query(`SELECT barcode FROM products WHERE business_id = $1 AND product_id = $2 FOR UPDATE`, [businessId, productId])).rows[0];
  if (!product) throw new IdentityError(404, 'NOT_FOUND', 'Not found');
  const held = await db.query(`SELECT 1 FROM product_barcodes WHERE business_id = $1 AND product_id = $2 AND barcode = $3`, [businessId, productId, barcode]);
  if (!held.rows.length) throw new IdentityError(404, 'NOT_FOUND', 'That barcode is not on this product');
  if (product.barcode === barcode) {
    const next = (await db.query(
      `SELECT barcode FROM product_barcodes WHERE business_id = $1 AND product_id = $2 AND barcode <> $3 ORDER BY barcode_id LIMIT 1`, [businessId, productId, barcode]
    )).rows[0];
    await db.query(`UPDATE products SET barcode = $3, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND product_id = $2`, [businessId, productId, next?.barcode ?? null]);
  } else {
    await db.query(`DELETE FROM product_barcodes WHERE business_id = $1 AND product_id = $2 AND barcode = $3`, [businessId, productId, barcode]);
  }
};

/**
 * Give a product another barcode. A barcode already on a different product is never taken silently: that is a 409
 * naming the owner, and only with `replace` AND `canReplace` (the barcode_reassign permission) is it moved.
 * Returns { status: 'added' | 'already_here' | 'moved', moved_from? }. Run it on a client inside a transaction.
 */
export const addBarcode = async (db, { businessId, productId, barcode, userId = null, replace = false, canReplace = false }) => {
  const code = cleanBarcode(barcode);
  const product = (await db.query(`SELECT barcode, status FROM products WHERE business_id = $1 AND product_id = $2 FOR UPDATE`, [businessId, productId])).rows[0];
  if (!product) throw new IdentityError(404, 'NOT_FOUND', 'Not found');

  const owner = await barcodeOwner(db, businessId, code);
  if (owner && owner.product_id === productId) return { status: 'already_here', barcode: code };

  let movedFrom = null;
  if (owner) {
    if (!replace) throw new IdentityError(409, 'BARCODE_IN_USE', `This barcode is already assigned to ${owner.name}.`, { product_id: owner.product_id, name: owner.name, sku: owner.sku });
    if (!canReplace) throw new IdentityError(403, 'REPLACE_NOT_ALLOWED', 'You need permission to move a barcode from one product to another.', { product_id: owner.product_id, name: owner.name });
    await removeBarcode(db, { businessId, productId: owner.product_id, barcode: code });
    movedFrom = { product_id: owner.product_id, name: owner.name };
  }

  // a savepoint, so that losing a race for the barcode (a unique violation) leaves the transaction usable to say who won
  await db.query('SAVEPOINT add_barcode');
  try {
    if (!product.barcode) {
      // the first barcode is the primary one; the trigger records it in product_barcodes
      await db.query(`UPDATE products SET barcode = $3, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND product_id = $2`, [businessId, productId, code]);
    } else {
      await db.query(`INSERT INTO product_barcodes (business_id, product_id, barcode, created_by) VALUES ($1,$2,$3,$4)`, [businessId, productId, code, userId]);
    }
    await db.query('RELEASE SAVEPOINT add_barcode');
  } catch (error) {
    if (error.code === '23505') {
      await db.query('ROLLBACK TO SAVEPOINT add_barcode');
      const raced = await barcodeOwner(db, businessId, code);
      throw new IdentityError(409, 'BARCODE_IN_USE', `This barcode is already assigned to ${raced?.name ?? 'another product'}.`, raced ? { product_id: raced.product_id, name: raced.name, sku: raced.sku } : undefined);
    }
    throw error;
  }
  return { status: movedFrom ? 'moved' : 'added', barcode: code, ...(movedFrom ? { moved_from: movedFrom } : {}) };
};

/* ── aliases ──────────────────────────────────────────────────────────────── */

export const aliasesOf = async (db, businessId, productId) =>
  (await db.query(`SELECT alias_id, alias, source FROM product_aliases WHERE business_id = $1 AND product_id = $2 ORDER BY alias_id`, [businessId, productId])).rows;

export const addAlias = async (db, { businessId, productId, alias, source = 'USER', userId = null }) => {
  const text = cleanAlias(alias);
  if (!(await db.query(`SELECT 1 FROM products WHERE business_id = $1 AND product_id = $2`, [businessId, productId])).rows.length) throw new IdentityError(404, 'NOT_FOUND', 'Not found');
  const { rows } = await db.query(
    `INSERT INTO product_aliases (business_id, product_id, alias, alias_key, source, created_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (product_id, alias_key) DO NOTHING RETURNING alias_id, alias, source`,
    [businessId, productId, text, text.toLowerCase(), source, userId]
  );
  return rows[0] ? { status: 'added', ...rows[0] } : { status: 'already_here', alias: text };
};

export const removeAlias = async (db, { businessId, productId, aliasId }) => {
  const { rows } = await db.query(`DELETE FROM product_aliases WHERE business_id = $1 AND product_id = $2 AND alias_id = $3 RETURNING alias`, [businessId, productId, aliasId]);
  if (!rows.length) throw new IdentityError(404, 'NOT_FOUND', 'Not found');
  return rows[0];
};

/* ── supplier codes ───────────────────────────────────────────────────────── */

export const supplierCodesOf = async (db, businessId, productId) =>
  (await db.query(
    `SELECT c.code_id, c.code, c.supplier_id, s.name AS supplier_name FROM product_supplier_codes c LEFT JOIN suppliers s ON s.supplier_id = c.supplier_id
     WHERE c.business_id = $1 AND c.product_id = $2 ORDER BY c.code_id`, [businessId, productId]
  )).rows;

export const addSupplierCode = async (db, { businessId, productId, code, supplierId = null, userId = null }) => {
  const text = cleanCode(code, 'Supplier code');
  if (!(await db.query(`SELECT 1 FROM products WHERE business_id = $1 AND product_id = $2`, [businessId, productId])).rows.length) throw new IdentityError(404, 'NOT_FOUND', 'Not found');
  if (supplierId != null && !(await db.query(`SELECT 1 FROM suppliers WHERE business_id = $1 AND supplier_id = $2`, [businessId, supplierId])).rows.length) {
    throw new IdentityError(400, 'BAD_SUPPLIER', 'Supplier not found');
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO product_supplier_codes (business_id, product_id, supplier_id, code, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING code_id, code, supplier_id`,
      [businessId, productId, supplierId, text, userId]
    );
    return rows[0];
  } catch (error) {
    if (error.code !== '23505') throw error;
    const owner = (await db.query(
      `SELECT p.product_id, p.name FROM product_supplier_codes c JOIN products p ON p.product_id = c.product_id
       WHERE c.business_id = $1 AND COALESCE(c.supplier_id, 0) = COALESCE($2::int, 0) AND lower(c.code) = lower($3)`, [businessId, supplierId, text]
    )).rows[0];
    throw new IdentityError(409, 'CODE_IN_USE', owner ? `That supplier code is already on ${owner.name}.` : 'That supplier code is already in use.', owner);
  }
};

export const removeSupplierCode = async (db, { businessId, productId, codeId }) => {
  const { rows } = await db.query(`DELETE FROM product_supplier_codes WHERE business_id = $1 AND product_id = $2 AND code_id = $3 RETURNING code`, [businessId, productId, codeId]);
  if (!rows.length) throw new IdentityError(404, 'NOT_FOUND', 'Not found');
  return rows[0];
};

/* ── finding a product ────────────────────────────────────────────────────── */

/**
 * The exact-match lookup behind a scan or an "enter the code" box: barcode, SKU, ERP code or a supplier code, whichever
 * the text is. More than one product is returned only when the same text really is on several (a supplier code two
 * suppliers share): the caller shows the choice rather than guessing.
 */
export const findByCode = async (db, businessId, code) => {
  const text = String(code ?? '').trim();
  if (!text) return [];
  const { rows } = await db.query(
    `SELECT product_id, name, sku, status, 'barcode' AS matched_on FROM products WHERE business_id = $1 AND product_id IN (SELECT product_id FROM product_barcodes WHERE business_id = $1 AND barcode = $2)
     UNION ALL SELECT product_id, name, sku, status, 'sku' FROM products WHERE business_id = $1 AND sku IS NOT NULL AND sku <> '' AND lower(sku) = lower($2)
     UNION ALL SELECT product_id, name, sku, status, 'erp_code' FROM products WHERE business_id = $1 AND erp_code IS NOT NULL AND erp_code <> '' AND lower(erp_code) = lower($2)
     UNION ALL SELECT p.product_id, p.name, p.sku, p.status, 'supplier_code' FROM product_supplier_codes c JOIN products p ON p.product_id = c.product_id WHERE c.business_id = $1 AND lower(c.code) = lower($2)`,
    [businessId, text]
  );
  const seen = new Map();
  for (const row of rows) if (!seen.has(row.product_id)) seen.set(row.product_id, row);
  return [...seen.values()];
};

/**
 * SQL for the product list's `search`: every word must match something of the product — its name, brand, SKU, ERP
 * code, an alias, a supplier code, or (exactly) a barcode — so "amul milk" finds "Amul Taaza Milk 1L" and a pasted
 * barcode finds its product. Pushes its parameters onto `values` and returns the clause (uses alias p, brand alias br).
 */
export const searchClause = (search, values, business = '$1') => {
  const words = String(search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return null;
  const parts = words.map((word) => {
    values.push(`%${likeEscape(word.toLowerCase())}%`);
    const like = `$${values.length}`;
    values.push(word);
    const exact = `$${values.length}`;
    // One index lookup per place a word can match, unioned: an OR of EXISTS checks per product row can use none of
    // the indexes and reads the whole catalogue (it took 200-600 ms at 100,000 products).
    return `p.product_id IN (
      SELECT product_id FROM products WHERE business_id = ${business} AND (lower(name) LIKE ${like} OR lower(sku) LIKE ${like} OR lower(erp_code) LIKE ${like})
      UNION SELECT product_id FROM products WHERE business_id = ${business} AND brand_id IN (SELECT brand_id FROM brands WHERE business_id = ${business} AND lower(name) LIKE ${like})
      UNION SELECT product_id FROM product_barcodes WHERE business_id = ${business} AND barcode = ${exact}
      UNION SELECT product_id FROM product_aliases WHERE business_id = ${business} AND alias_key LIKE ${like}
      UNION SELECT product_id FROM product_supplier_codes WHERE business_id = ${business} AND lower(code) LIKE ${like})`;
  });
  return parts.join(' AND ');
};

/** One product's whole identity, for its screen. */
export const identifiersOf = async (db, businessId, productId) => {
  const product = (await db.query(`SELECT sku, barcode, erp_code FROM products WHERE business_id = $1 AND product_id = $2`, [businessId, productId])).rows[0];
  if (!product) return null;
  const [barcodes, aliases, supplierCodes] = await Promise.all([
    barcodesOf(db, businessId, productId), aliasesOf(db, businessId, productId), supplierCodesOf(db, businessId, productId)
  ]);
  return { sku: product.sku, erp_code: product.erp_code, primary_barcode: product.barcode, barcodes, aliases, supplier_codes: supplierCodes };
};
