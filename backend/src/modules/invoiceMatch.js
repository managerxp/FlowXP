/*
 * Matching the lines of a read supplier bill to the business's own products, most certain first:
 *
 *   1. barcode         the line's barcode is one of a product's barcodes
 *   2. supplier code   this supplier's own code for the item (product_supplier_codes; a code saved with no supplier counts too)
 *   3. learned name    the bill's wording was matched by a person before (product_aliases)
 *   4. name            the closest product name, by shared words and sizes; a SUGGESTION only
 *
 * The first three are exact lookups; the fourth never counts as certain. Whatever is found, a person still reviews
 * every line before any stock moves: this only saves them the searching.
 */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();

const UNIT_WORDS = { gm: 'g', gms: 'g', gram: 'g', grams: 'g', kgs: 'kg', ltr: 'l', ltrs: 'l', litre: 'l', liter: 'l', ml: 'ml', pcs: 'pc', pc: 'pc', piece: 'pc', pieces: 'pc' };
const STOP = new Set(['the', 'and', 'of', 'with', 'in', 'pack', 'pkt', 'packet', 'new', 'x']);

/** Words of a name, with "500gm" / "500 g" both read as "500g", and filler dropped. */
export const tokens = (s) => {
  const t = norm(s).replace(/(\d)\s+(g|gm|gms|gram|grams|kg|kgs|ml|l|ltr|ltrs|litre|liter|pcs|pc)\b/g, '$1$2');
  const out = new Set();
  for (const w of t.split(' ')) {
    if (!w || STOP.has(w)) continue;
    const m = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(w);
    out.add(m ? `${m[1]}${UNIT_WORDS[m[2]] || m[2]}` : (UNIT_WORDS[w] || w));
  }
  return out;
};

/** 0..1: shared words over all words, with sizes ("500g") counting double (butter 500g is not butter 100g). */
export const similarity = (a, b) => {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  const weight = (w) => (/^\d/.test(w) ? 2 : 1);
  let both = 0; let all = 0;
  for (const w of new Set([...A, ...B])) { const x = weight(w); all += x; if (A.has(w) && B.has(w)) both += x; }
  return both / all;
};

const SUGGEST_FROM = 0.34;   // below this a name is not worth showing
const LIKELY_FROM = 0.6;     // at or above this the best name is preselected (still reviewed)

const info = (p) => ({ product_id: p.product_id, name: p.name, sku: p.sku || null, unit: p.unit || null });

/**
 * @param db        pg client or pool
 * @param lines     normalised bill lines ({ description, barcode, supplier_code })
 * @returns         one result per line: { match: {product_id,name,sku,unit,via}|null, suggestions: [...] }
 */
export const matchLines = async (db, { businessId, supplierId = null, lines }) => {
  const results = lines.map(() => ({ match: null, suggestions: [] }));

  // 1. barcodes, in one query
  const codes = [...new Set(lines.map((l) => l.barcode).filter(Boolean))];
  if (codes.length) {
    const { rows } = await db.query(
      `SELECT pb.barcode, p.product_id, p.name, p.sku, p.unit FROM product_barcodes pb JOIN products p ON p.product_id = pb.product_id
       WHERE pb.business_id = $1 AND p.status = 'ACTIVE' AND lower(pb.barcode) = ANY($2::text[])`, [businessId, codes.map((c) => c.toLowerCase())]);
    const byCode = new Map(rows.map((r) => [r.barcode.toLowerCase(), r]));
    lines.forEach((l, i) => { const p = l.barcode && byCode.get(l.barcode.toLowerCase()); if (p) results[i].match = { ...info(p), via: 'barcode' }; });
  }

  // 2. this supplier's own codes (a code saved for "any supplier" is used when this supplier has none of its own)
  const supCodes = [...new Set(lines.filter((l, i) => !results[i].match && l.supplier_code).map((l) => l.supplier_code.toLowerCase()))];
  if (supCodes.length) {
    const { rows } = await db.query(
      `SELECT lower(c.code) AS code, c.supplier_id, p.product_id, p.name, p.sku, p.unit FROM product_supplier_codes c JOIN products p ON p.product_id = c.product_id
       WHERE c.business_id = $1 AND p.status = 'ACTIVE' AND lower(c.code) = ANY($2::text[]) AND (c.supplier_id = $3 OR c.supplier_id IS NULL)
       ORDER BY (c.supplier_id IS NULL)`, [businessId, supCodes, supplierId]);
    const byCode = new Map(); for (const r of rows) if (!byCode.has(r.code)) byCode.set(r.code, r);
    lines.forEach((l, i) => { if (results[i].match || !l.supplier_code) return; const p = byCode.get(l.supplier_code.toLowerCase()); if (p) results[i].match = { ...info(p), via: 'supplier_code' }; });
  }

  // 3. wording a person has matched before
  const keys = [...new Set(lines.filter((l, i) => !results[i].match).map((l) => norm(l.description)).filter(Boolean))];
  if (keys.length) {
    const { rows } = await db.query(
      `SELECT a.alias_key, p.product_id, p.name, p.sku, p.unit FROM product_aliases a JOIN products p ON p.product_id = a.product_id
       WHERE a.business_id = $1 AND p.status = 'ACTIVE' AND a.alias_key = ANY($2::text[]) ORDER BY a.created_at DESC`, [businessId, keys]);
    const byKey = new Map(); for (const r of rows) if (!byKey.has(r.alias_key)) byKey.set(r.alias_key, r);
    lines.forEach((l, i) => { if (results[i].match) return; const p = byKey.get(norm(l.description)); if (p) results[i].match = { ...info(p), via: 'alias' }; });
  }

  // 4. the closest names, for what is still open: narrow by a word or two in SQL, then score
  for (const [i, l] of lines.entries()) {
    if (results[i].match) continue;
    const words = [...tokens(l.description)].filter((w) => !/^\d/.test(w) && w.length >= 3).slice(0, 4);
    if (!words.length) continue;
    const { rows } = await db.query(
      `SELECT product_id, name, sku, unit FROM products
       WHERE business_id = $1 AND status = 'ACTIVE' AND kind <> 'INGREDIENT' AND lower(name) LIKE ANY($2::text[]) LIMIT 60`,
      [businessId, words.map((w) => `%${w.replace(/[%_]/g, '')}%`)]);
    const scored = rows.map((p) => ({ p, s: similarity(l.description, p.name) })).filter((x) => x.s >= SUGGEST_FROM).sort((a, b) => b.s - a.s).slice(0, 3);
    results[i].suggestions = scored.map((x) => ({ ...info(x.p), score: Math.round(x.s * 100) / 100 }));
    if (scored[0] && scored[0].s >= LIKELY_FROM) results[i].match = { ...info(scored[0].p), via: 'name', score: Math.round(scored[0].s * 100) / 100 };
  }
  return results;
};

/** The supplier the bill names, among the business's suppliers: exact name first, else the closest by words. */
export const matchSupplier = async (db, { businessId, name }) => {
  if (!name) return null;
  const { rows } = await db.query(`SELECT supplier_id, name FROM suppliers WHERE business_id = $1`, [businessId]);
  const key = norm(name);
  const exact = rows.find((s) => norm(s.name) === key);
  if (exact) return { supplier_id: exact.supplier_id, name: exact.name };
  const best = rows.map((s) => ({ s, score: similarity(name, s.name) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 0.5 ? { supplier_id: best.s.supplier_id, name: best.s.name } : null;
};

/** Is this supplier's bill number already on a recorded purchase? Returns the purchase's number, or null. */
export const findDuplicateBill = async (db, { businessId, supplierId, invoiceNo }) => {
  if (!supplierId || !invoiceNo) return null;
  const { rows } = await db.query(
    `SELECT po_number FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2 AND lower(supplier_invoice_no) = lower($3) AND status <> 'CANCELLED' LIMIT 1`,
    [businessId, supplierId, String(invoiceNo).trim()]);
  return rows[0]?.po_number ?? null;
};
