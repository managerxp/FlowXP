import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { validStateCode } from './gst.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import { paiseToString, roundDiv, taxOn, toPaise } from './money.ts';
import { BASE, checkCurrency, rateMicro, rateOn } from './fx.ts';
import { costEntry, costIn, costOut, defaultWarehouse, record, trackedLines, undoMoves } from './stock.ts';
import { creditNoteJournal, customerPaymentJournal, debitNoteJournal, openingJournal, saleJournal, supplierBillJournal, supplierPaymentJournal } from './rules.ts';
import type { Tender } from './rules.ts';

/* Invoices, bills and credit notes are drafts until issued. Issuing numbers the document and posts its journal in one
   transaction through the rules in rules.ts, so a document and its journal can never disagree (accounting-rules I1, I2). */

export type DocKind = 'INVOICE' | 'BILL' | 'CREDIT_NOTE' | 'QUOTE' | 'SALES_ORDER' | 'PURCHASE_ORDER' | 'DEBIT_NOTE';
const POSTS_NOTHING = (k: DocKind): boolean => k === 'QUOTE' || k === 'SALES_ORDER' || k === 'PURCHASE_ORDER';
export type LineIn = { itemId?: bigint; description?: string; hsnSac?: string; quantity?: string; unitPrice?: string; discount?: string; taxCode?: string; unit?: string; inclusive?: boolean };
export type DocIn = {
  currency?: string; fxRate?: string; projectId?: bigint; warehouseId?: bigint;
  kind: DocKind; partyId: bigint; date: string; dueDate?: string; placeOfSupply?: string; supplierRef?: string;
  relatedDocumentId?: bigint; memo?: string; roundOff?: boolean; reverseCharge?: boolean; tcsRateBp?: number; tcsSection?: string; lines: LineIn[];
};
type Override = { reason: string };

const PREFIX: Record<DocKind, string> = { INVOICE: 'INV', BILL: 'BILL', CREDIT_NOTE: 'CN', QUOTE: 'QUO', SALES_ORDER: 'SO', PURCHASE_ORDER: 'PO', DEBIT_NOTE: 'DN' };
const gone = (what: string) => new LedgerError('not_found', `no such ${what}`);

/** The financial year (April to March) a date falls in, by its starting year. */
export const fyStart = (date: string): number => (Number(date.slice(5, 7)) >= 4 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1);

/**
 * Gapless numbers that restart every financial year: INV-26-27-000001 is 16 characters, the most the GST rules allow on an invoice.
 * The row lock taken by the upsert serialises callers, and a rolled-back transaction gives its number back. Each prefix is its own series.
 */
const nextNumber = async (c: Db, orgId: bigint, prefix: string, date: string): Promise<string> => {
  const fy = fyStart(date);
  const n = (await c.query(
    `INSERT INTO document_sequences (organization_id, key, next_value) VALUES ($1, $2, 1)
       ON CONFLICT (organization_id, key) DO UPDATE SET next_value = document_sequences.next_value + 1 RETURNING next_value`, [orgId, `${prefix}:${fy}`])).rows[0].next_value as bigint;
  return `${prefix}-${String(fy).slice(2)}-${String(fy + 1).slice(2)}-${String(n).padStart(6, '0')}`;
};
const invoicePrefix = async (c: Db, orgId: bigint): Promise<string> => (await c.query(`SELECT invoice_prefix FROM organizations WHERE id = $1`, [orgId])).rows[0].invoice_prefix as string;

const toMilli = (text: string): bigint => {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text.trim());
  const v = m ? BigInt(m[1] as string) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3)) : 0n;
  if (v <= 0n) throw new LedgerError('bad_quantity', `${text} is not a quantity above zero (three decimals at most)`);
  return v;
};

type Priced = { itemId: bigint | null; description: string; hsnSac: string | null; qtyMilli: bigint; unitPrice: bigint; discount: bigint; taxable: bigint; unit: string | null; taxCode: string; rateBp: number; tax: bigint; inclusive: boolean; unitPriceFc: bigint | null; discountFc: bigint | null; grossFc: bigint | null };

/** Prices lines with the tax rate in force on the document date, so an old invoice never changes when a rate does. */
const priceLines = async (c: Db, kind: DocKind, lines: LineIn[], date: string, fx: bigint | null): Promise<Priced[]> => {
  if (lines.length === 0) throw new LedgerError('no_lines', 'a document needs at least one line');
  const out: Priced[] = [];
  for (const l of lines) {
    const item = l.itemId ? (await c.query(`SELECT name, hsn_sac, unit, tax_code, sale_price_minor, purchase_price_minor FROM items WHERE id = $1 AND active`, [l.itemId])).rows[0] : null;
    if (l.itemId && !item) throw gone('item');
    const description = l.description?.trim() || (item?.name as string | undefined);
    if (!description) throw new LedgerError('description_required', 'each line needs an item or a description');
    const unitPrice = l.unitPrice !== undefined ? toPaise(l.unitPrice) : item ? (item[kind === 'BILL' ? 'purchase_price_minor' : 'sale_price_minor'] as bigint) : null;
    if (unitPrice === null) throw new LedgerError('price_required', 'each line needs a unit price or an item');
    // in a foreign currency the typed price is in that currency; an item's saved price is in rupees and is converted
    const fcUnit = fx ? (l.unitPrice !== undefined ? unitPrice : roundDiv(unitPrice * 1_000_000n, fx)) : null;
    const taxCode = l.taxCode ?? (item?.tax_code as string | undefined);
    if (!taxCode) throw new LedgerError('tax_code_required', 'each line needs a tax code (GST0 for none)');
    const rate = (await c.query(`SELECT rate_bp FROM tax_rates WHERE code = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`, [taxCode, date])).rows[0];
    if (!rate) throw new LedgerError('unknown_tax_code', `no rate for ${taxCode} on ${date}`);
    const qtyMilli = toMilli(l.quantity ?? '1');
    const discountFc = l.discount ? toPaise(l.discount) : 0n;
    if (unitPrice < 0n || discountFc < 0n) throw new LedgerError('bad_amount', 'prices and discounts cannot be negative');
    const grossFc = fx ? roundDiv(qtyMilli * (fcUnit as bigint), 1000n) : null;
    if (grossFc !== null && discountFc > grossFc) throw new LedgerError('discount_too_large', 'a discount cannot exceed the line amount');
    const toBase = (fc: bigint): bigint => (fx ? roundDiv(fc * fx, 1_000_000n) : fc);
    const discount = toBase(discountFc);
    const gross = grossFc !== null ? toBase(grossFc) : roundDiv(qtyMilli * unitPrice, 1000n);
    if (discount > gross) throw new LedgerError('discount_too_large', 'a discount cannot exceed the line amount');
    const rateBp = rate.rate_bp as number;
    const inclusive = Boolean(l.inclusive);
    // an inclusive line's amount is what the customer pays: tax is carved out of it, so the total is exactly the typed amount
    const taxable = inclusive ? roundDiv((gross - discount) * 10_000n, 10_000n + BigInt(rateBp)) : gross - discount;
    const tax = inclusive ? gross - discount - taxable : taxOn(taxable, rateBp);
    out.push({ itemId: l.itemId ?? null, description, hsnSac: l.hsnSac ?? (item?.hsn_sac as string | null) ?? null, qtyMilli, unitPrice: fx ? toBase(fcUnit as bigint) : unitPrice, discount, taxable, unit: l.unit ?? (item?.unit as string | null) ?? null, taxCode, rateBp, tax, inclusive, unitPriceFc: fcUnit, discountFc: fx ? discountFc : null, grossFc });
  }
  return out;
};

const partyFor = async (c: Db, id: bigint, role: 'CUSTOMER' | 'VENDOR') => {
  const p = (await c.query(`SELECT kind, active, state_code, credit_days FROM parties WHERE id = $1`, [id])).rows[0];
  if (!p) throw gone('party');
  if (!p.active) throw new LedgerError('inactive_party', 'that party is inactive');
  if (p.kind !== 'BOTH' && p.kind !== role) throw new LedgerError('wrong_party_kind', `that party is not a ${role.toLowerCase()}`);
  return p as { state_code: string | null; credit_days: number };
};
const roleOf = (kind: DocKind): 'CUSTOMER' | 'VENDOR' => (kind === 'BILL' || kind === 'PURCHASE_ORDER' || kind === 'DEBIT_NOTE' ? 'VENDOR' : 'CUSTOMER');

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Create a draft (id null) or replace the content of one. Totals are worked out here, from the lines, never taken from the caller. */
export const saveDraft = async (c: Db, orgId: bigint, id: bigint | null, d: DocIn, actor: string): Promise<bigint> => {
  const party = await partyFor(c, d.partyId, roleOf(d.kind));
  if (d.roundOff && d.kind !== 'INVOICE' && !POSTS_NOTHING(d.kind)) throw new LedgerError('round_off_unsupported', 'only invoices can be rounded off');
  if (d.placeOfSupply && !validStateCode(d.placeOfSupply)) throw new LedgerError('bad_state', `${d.placeOfSupply} is not a GST state code`);
  if (d.relatedDocumentId) {
    const target = d.kind === 'CREDIT_NOTE' ? 'INVOICE' : d.kind === 'DEBIT_NOTE' ? 'BILL' : null;
    const ok = target && (await c.query(`SELECT 1 FROM documents WHERE id = $1 AND kind = $3 AND status = 'ISSUED' AND party_id = $2 AND NOT reverse_charge`, [d.relatedDocumentId, d.partyId, target])).rowCount;
    if (!ok) throw new LedgerError('bad_related_document', d.kind === 'DEBIT_NOTE' ? 'a debit note can only refer to an issued bill of the same vendor (not one under reverse charge)' : 'a credit note can only refer to an issued invoice of the same customer');
  }
  const currency = d.currency ?? BASE;
  let rateStr = '1'; let rate: bigint | null = null;
  if (currency !== BASE) {
    checkCurrency(currency);
    if (d.kind === 'CREDIT_NOTE' || d.kind === 'DEBIT_NOTE') throw new LedgerError('foreign_note', 'credit and debit notes are written in rupees; set a foreign-currency invoice right with a payment');
    if (d.roundOff) throw new LedgerError('round_off_unsupported', 'a foreign-currency document cannot be rounded off');
    const found = d.fxRate ?? (await rateOn(c, currency, d.date));
    if (!found) throw new LedgerError('rate_required', `no ${currency} rate saved for ${d.date}; type the rate (rupees for one ${currency})`);
    rateStr = found; rate = rateMicro(found);
  }
  if (d.projectId && !(await c.query(`SELECT 1 FROM projects WHERE id = $1`, [d.projectId])).rowCount) throw gone('project');
  const lines = await priceLines(c, d.kind, d.lines, d.date, rate);
  const org = (await c.query(`SELECT state_code FROM organizations WHERE id = $1`, [orgId])).rows[0];
  const place = d.placeOfSupply ?? party.state_code;
  const interState = Boolean(org?.state_code && place && org.state_code !== place);
  const subtotal = lines.reduce((a, l) => a + l.taxable, 0n);
  const tax = lines.reduce((a, l) => a + l.tax, 0n);
  if (d.reverseCharge && d.kind !== 'BILL') throw new LedgerError('reverse_charge_unsupported', 'reverse charge applies to purchase bills only');
  if (d.tcsRateBp && d.kind !== 'INVOICE') throw new LedgerError('tcs_unsupported', 'TCS is collected on sales invoices only');
  const tcsRate = d.tcsRateBp ?? 0;
  if (!Number.isInteger(tcsRate) || tcsRate < 0 || tcsRate > 2000) throw new LedgerError('bad_tcs_rate', 'the TCS rate must be between 0 and 20 percent');
  const tcs = roundDiv((subtotal + tax) * BigInt(tcsRate), 10_000n);
  const roundOff = d.roundOff ? roundDiv(subtotal + tax + tcs, 100n) * 100n - (subtotal + tax + tcs) : 0n;
  // the foreign total the customer sees: each line's price in that currency, plus the tax converted back (unless the price already includes it)
  const foreignTotal = rate ? lines.reduce((a, l) => a + (l.grossFc as bigint) - (l.discountFc as bigint) + (l.inclusive || d.reverseCharge ? 0n : roundDiv(l.tax * 1_000_000n, rate)), 0n) + roundDiv(tcs * 1_000_000n, rate) : null;
  const due = d.kind === 'CREDIT_NOTE' || d.kind === 'DEBIT_NOTE' ? null : d.dueDate ?? addDays(d.date, party.credit_days);
  const fields = [d.partyId, d.date, due, place ?? null, interState, d.supplierRef ?? null, d.relatedDocumentId ?? null, d.memo ?? null, Boolean(d.roundOff), subtotal, tax, roundOff, subtotal + (d.reverseCharge ? 0n : tax) + tcs + roundOff, tcsRate, tcs, tcsRate ? d.tcsSection ?? null : null, Boolean(d.reverseCharge), currency, rateStr, foreignTotal, d.projectId ?? null];
  if (id === null) {
    id = (await c.query(
      `INSERT INTO documents (organization_id, kind, created_by, party_id, issue_date, due_date, place_of_supply, inter_state, supplier_ref, related_document_id, memo, round_off_on, subtotal_minor, tax_minor, round_off_minor, total_minor, tcs_rate_bp, tcs_minor, tcs_section, reverse_charge, currency, fx_rate, foreign_total_minor, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) RETURNING id`, [orgId, d.kind, actor, ...fields])).rows[0].id as bigint;
    await audit(c, orgId, { actor, action: 'document.drafted', entityType: 'document', entityId: id, detail: { kind: d.kind } });
  } else {
    const cur = (await c.query(`SELECT kind, status FROM documents WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw gone('document');
    if (cur.status !== 'DRAFT') throw new LedgerError('not_draft', 'only a draft can be edited; void an issued document and make a new one');
    if (cur.kind !== d.kind) throw new LedgerError('kind_mismatch', 'a document cannot change its kind');
    await c.query(
      `UPDATE documents SET party_id = $2, issue_date = $3, due_date = $4, place_of_supply = $5, inter_state = $6, supplier_ref = $7, related_document_id = CASE WHEN kind IN ('CREDIT_NOTE', 'DEBIT_NOTE') THEN $8::bigint ELSE related_document_id END, memo = $9, round_off_on = $10,
              subtotal_minor = $11, tax_minor = $12, round_off_minor = $13, total_minor = $14, tcs_rate_bp = $15, tcs_minor = $16, tcs_section = $17, reverse_charge = $18, currency = $19, fx_rate = $20, foreign_total_minor = $21, project_id = $22 WHERE id = $1`, [id, ...fields]);
    await c.query(`DELETE FROM document_lines WHERE document_id = $1`, [id]);
  }
  if (d.warehouseId && !(await c.query(`SELECT 1 FROM warehouses WHERE id = $1 AND active`, [d.warehouseId])).rowCount) throw gone('warehouse');
  await c.query(`UPDATE documents SET warehouse_id = $2 WHERE id = $1`, [id, d.warehouseId ?? null]);
  let no = 0;
  for (const l of lines) {
    no += 1;
    await c.query(
      `INSERT INTO document_lines (organization_id, document_id, line_no, item_id, description, hsn_sac, quantity_milli, unit_price_minor, discount_minor, taxable_minor, tax_code, tax_rate_bp, tax_minor, unit, price_includes_tax, unit_price_fc_minor, discount_fc_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [orgId, id, no, l.itemId, l.description, l.hsnSac, l.qtyMilli, l.unitPrice, l.discount, l.taxable, l.taxCode, l.rateBp, l.tax, l.unit, l.inclusive, l.unitPriceFc, l.discountFc]);
  }
  return id;
};

const DOC_COLS = `d.id, d.kind, d.number, d.supplier_ref, d.party_id, p.name AS party_name, d.status, d.issue_date::text AS issue_date, d.due_date::text AS due_date,
  d.place_of_supply, d.inter_state, d.subtotal_minor, d.tax_minor, d.round_off_minor, d.outcome, d.converted_document_id, (SELECT x.kind FROM documents x WHERE x.id = d.converted_document_id) AS converted_kind, (SELECT x.kind FROM documents x WHERE x.id = d.related_document_id) AS related_kind, d.tcs_rate_bp, d.tcs_minor, d.tcs_section, d.reverse_charge, d.project_id, d.warehouse_id, (SELECT w.name FROM warehouses w WHERE w.id = d.warehouse_id) AS warehouse_name, (SELECT pr.name FROM projects pr WHERE pr.id = d.project_id) AS project_name, d.currency, d.fx_rate::text AS fx_rate, d.foreign_total_minor, d.foreign_balance_minor, d.total_minor, d.balance_minor, d.related_document_id, d.journal_entry_id, d.memo`;

export const listDocuments = async (c: Db, kind: DocKind, q: { status?: string; partyId?: bigint; before?: bigint; limit: number }) => (await c.query(
  `SELECT ${DOC_COLS} FROM documents d JOIN parties p ON p.id = d.party_id
    WHERE d.kind = $1 AND ($2::text IS NULL OR d.status = $2) AND ($3::bigint IS NULL OR d.party_id = $3) AND ($4::bigint IS NULL OR d.id < $4) ORDER BY d.id DESC LIMIT $5`,
  [kind, q.status ?? null, q.partyId ?? null, q.before ?? null, q.limit])).rows;

export const getDocument = async (c: Db, kind: DocKind, id: bigint) => {
  const doc = (await c.query(`SELECT ${DOC_COLS} FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1 AND d.kind = $2`, [id, kind])).rows[0];
  if (!doc) return null;
  const lines = (await c.query(
    `SELECT id, line_no, item_id, description, hsn_sac, round(quantity_milli::numeric / 1000, 3)::text AS quantity, unit_price_minor, discount_minor, taxable_minor, tax_code, tax_rate_bp, tax_minor, unit, price_includes_tax, unit_price_fc_minor, discount_fc_minor
       FROM document_lines WHERE document_id = $1 ORDER BY line_no`, [id])).rows;
  const allocations = (await c.query(`SELECT source_type, source_id, amount_minor, voided_at IS NOT NULL AS voided FROM payment_allocations WHERE document_id = $1 ORDER BY id`, [id])).rows;
  return { ...doc, lines, allocations };
};

export const deleteDraft = async (c: Db, orgId: bigint, kind: DocKind, id: bigint, actor: string): Promise<void> => {
  const cur = (await c.query(`SELECT status FROM documents WHERE id = $1 AND kind = $2 FOR UPDATE`, [id, kind])).rows[0];
  if (!cur) throw gone('document');
  if (cur.status !== 'DRAFT') throw new LedgerError('not_draft', 'only a draft can be deleted; void an issued document instead');
  await c.query(`UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = $1`, [id]);   // hours billed on this draft become billable again
  await c.query(`DELETE FROM document_lines WHERE document_id = $1`, [id]);
  await c.query(`DELETE FROM documents WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'document.draft_deleted', entityType: 'document', entityId: id });
};

/** Number the draft, post its journal and mark it issued. Prices are worked out again first, so the journal always matches the lines. */
export const issueDocument = async (c: Db, orgId: bigint, kind: DocKind, id: bigint, actor: string, override?: Override) => {
  const doc = (await c.query(`SELECT *, issue_date::text AS issue_d, due_date::text AS due_d FROM documents WHERE id = $1 AND kind = $2 FOR UPDATE`, [id, kind])).rows[0];
  if (!doc) throw gone('document');
  if (doc.status !== 'DRAFT') throw new LedgerError('not_draft', 'this document is already issued');
  const stored = (await c.query(`SELECT * FROM document_lines WHERE document_id = $1 ORDER BY line_no`, [id])).rows;
  const milli = (q: bigint) => `${q / 1000n}.${String(q % 1000n).padStart(3, '0')}`;
  await saveDraft(c, orgId, id, {
    kind, currency: doc.currency, fxRate: doc.fx_rate, projectId: doc.project_id ?? undefined, warehouseId: doc.warehouse_id ?? undefined, partyId: doc.party_id, date: doc.issue_d, dueDate: doc.due_d ?? undefined,
    placeOfSupply: doc.place_of_supply ?? undefined, supplierRef: doc.supplier_ref ?? undefined, relatedDocumentId: kind === 'CREDIT_NOTE' || kind === 'DEBIT_NOTE' ? doc.related_document_id ?? undefined : undefined, memo: doc.memo ?? undefined, roundOff: doc.round_off_on, tcsRateBp: doc.tcs_rate_bp, tcsSection: doc.tcs_section ?? undefined, reverseCharge: doc.reverse_charge,
    lines: stored.map((l) => ({ itemId: l.item_id ?? undefined, description: l.description, hsnSac: l.hsn_sac ?? undefined, quantity: milli(l.quantity_milli), unitPrice: paiseToString(l.unit_price_fc_minor ?? l.unit_price_minor), discount: paiseToString(l.discount_fc_minor ?? l.discount_minor), taxCode: l.tax_code, unit: l.unit ?? undefined, inclusive: l.price_includes_tax }))
  }, actor);
  const fresh = (await c.query(`SELECT *, issue_date::text AS d FROM documents WHERE id = $1`, [id])).rows[0];
  const lines = (await c.query(`SELECT taxable_minor, tax_rate_bp FROM document_lines WHERE document_id = $1`, [id])).rows;
  const total = fresh.total_minor as bigint;
  if (total <= 0n) throw new LedgerError('zero_total', 'a document with nothing to pay cannot be issued');
  if (kind === 'BILL' && fresh.supplier_ref) {
    const dup = (await c.query(`SELECT number FROM documents WHERE kind = 'BILL' AND status = 'ISSUED' AND party_id = $1 AND lower(supplier_ref) = lower($2) AND id <> $3`, [fresh.party_id, fresh.supplier_ref, id])).rows[0];
    if (dup) throw new LedgerError('duplicate_bill', `this supplier invoice number was already entered as ${dup.number}`);
  }
  const number = await nextNumber(c, orgId, kind === 'INVOICE' ? await invoicePrefix(c, orgId) : PREFIX[kind], fresh.d as string);
  if (POSTS_NOTHING(kind)) {   // a quote or order: numbered, nothing posted, nothing owed
    await c.query(`UPDATE documents SET status = 'ISSUED', number = $2, balance_minor = 0 WHERE id = $1`, [id, number]);
    await audit(c, orgId, { actor, action: 'document.issued', entityType: 'document', entityId: id, detail: { kind, number, total: paiseToString(total) } });
    return { number, entryNo: null as string | null };
  }
  const taxed = lines.map((l) => ({ taxable: l.taxable_minor as bigint, rateBp: l.tax_rate_bp as number }));
  const common = { date: fresh.d as string, partyId: fresh.party_id as bigint, lines: taxed, interState: fresh.inter_state as boolean };
  // goods that are counted: what they cost is worked out first (it may refuse for lack of stock), the moves are recorded once the entries exist
  const tracked = kind === 'BILL' || kind === 'DEBIT_NOTE' || kind === 'INVOICE' || kind === 'CREDIT_NOTE' ? await trackedLines(c, id) : [];
  const worth = tracked.map((t) => t.taxable_minor).reduce((a, b) => a + b, 0n);
  const cost = new Map<bigint, bigint>();
  const whId = tracked.length ? ((await c.query(`SELECT warehouse_id FROM documents WHERE id = $1`, [id])).rows[0].warehouse_id as bigint | null) ?? await defaultWarehouse(c, orgId) : 0n;
  for (const t of tracked) {
    if (kind === 'INVOICE' || kind === 'DEBIT_NOTE') cost.set(t.item_id, await costOut(c, t.item_id, t.qty_milli, fresh.d as string, whId));
    else if (kind === 'CREDIT_NOTE') cost.set(t.item_id, await costIn(c, t.item_id, t.qty_milli, fresh.d as string));
  }
  const journal = kind === 'INVOICE' ? saleJournal({ ...common, invoiceId: number, roundOff: fresh.round_off_minor as bigint, tcs: fresh.tcs_minor as bigint })
    : kind === 'BILL' ? supplierBillJournal({ ...common, billId: number, reverseCharge: fresh.reverse_charge as boolean, inventoryNet: worth })
    : kind === 'DEBIT_NOTE' ? debitNoteJournal({ ...common, noteId: number, inventoryNet: worth })
    : creditNoteJournal({ ...common, noteId: number });
  const posted = await post(c, orgId, { ...journal, actor, override });
  await c.query(`UPDATE documents SET status = 'ISSUED', number = $2, journal_entry_id = $3, balance_minor = total_minor, foreign_balance_minor = foreign_total_minor WHERE id = $1`, [id, number, posted.entryId]);
  if (tracked.length) {
    const sold = kind === 'INVOICE' || kind === 'CREDIT_NOTE';
    const value = [...cost.values()].reduce((a, b) => a + b, 0n);
    const costed = sold && value > 0n ? await costEntry(c, orgId, { date: fresh.d as string, number, kind: kind as 'INVOICE' | 'CREDIT_NOTE', value, actor, override }) : null;
    if (costed) await c.query(`UPDATE documents SET stock_entry_id = $2 WHERE id = $1`, [id, costed.entryId]);
    for (const t of tracked) {
      const inward = kind === 'BILL' || kind === 'CREDIT_NOTE';
      const v = kind === 'BILL' || kind === 'DEBIT_NOTE' ? t.taxable_minor : cost.get(t.item_id) ?? 0n;
      await record(c, orgId, actor, { itemId: t.item_id, qty: inward ? t.qty_milli : -t.qty_milli, value: inward ? v : -v, date: fresh.d as string, source: kind as 'BILL', documentId: id, entryId: costed?.entryId ?? posted.entryId, memo: number, costed: sold, override, warehouseId: whId });
    }
  }
  await audit(c, orgId, { actor, action: 'document.issued', entityType: 'document', entityId: id, detail: { kind, number, entryNo: posted.entryNo, total: paiseToString(total) } });
  return { number, entryNo: posted.entryNo };
};

/** An opening balance: what a customer owes you (INVOICE) or you owe a vendor (BILL) from before the books began. Issued at once; paid like any other document. */
export const createOpeningBalance = async (c: Db, orgId: bigint, o: { kind: 'INVOICE' | 'BILL'; partyId: bigint; date: string; amount: bigint; dueDate?: string; memo?: string }, actor: string, override?: Override) => {
  if (o.amount <= 0n) throw new LedgerError('bad_amount', 'an opening balance must be above zero');
  await partyFor(c, o.partyId, roleOf(o.kind));
  const number = await nextNumber(c, orgId, 'OB', o.date);
  const id = (await c.query(
    `INSERT INTO documents (organization_id, kind, created_by, party_id, issue_date, due_date, status, number, memo, subtotal_minor, total_minor, balance_minor, is_opening)
     VALUES ($1, $2, $3, $4, $5, $6, 'ISSUED', $7, $8, $9, $9, $9, true) RETURNING id`, [orgId, o.kind, actor, o.partyId, o.date, o.dueDate ?? null, number, o.memo ?? 'Opening balance', o.amount])).rows[0].id as bigint;
  const posted = await post(c, orgId, { ...openingJournal({ date: o.date, number, partyId: o.partyId, kind: o.kind, amount: o.amount }), actor, override });
  await c.query(`UPDATE documents SET journal_entry_id = $2 WHERE id = $1`, [id, posted.entryId]);
  await audit(c, orgId, { actor, action: 'document.opening_balance', entityType: 'document', entityId: id, detail: { number, kind: o.kind, amount: paiseToString(o.amount) } });
  return { id, number };
};

/** A customer said yes or no to a quote or order that was sent. */
export const setOutcome = async (c: Db, orgId: bigint, id: bigint, outcome: 'ACCEPTED' | 'DECLINED', actor: string) => {
  const d = (await c.query(`SELECT kind, status, outcome, number FROM documents WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!d) throw gone('document');
  if (!POSTS_NOTHING(d.kind as DocKind)) throw new LedgerError('not_a_quote', 'only a quote or an order can be accepted or declined');
  if (d.status !== 'ISSUED') throw new LedgerError('not_issued', 'send it first');
  if (d.outcome === 'CONVERTED') throw new LedgerError('converted', 'it was already turned into another document');
  await c.query(`UPDATE documents SET outcome = $2 WHERE id = $1`, [id, outcome]);
  await audit(c, orgId, { actor, action: `document.${outcome.toLowerCase()}`, entityType: 'document', entityId: id, detail: { number: d.number } });
};

/** Turn a sent quote into a sales order or an invoice, or a sales order into an invoice. The new document is a draft with the same lines; nothing is posted until it is issued. */
export const convertDocument = async (c: Db, orgId: bigint, id: bigint, to: 'SALES_ORDER' | 'INVOICE' | 'BILL', date: string, actor: string) => {
  const d = (await c.query(`SELECT * FROM documents WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!d) throw gone('document');
  const from = d.kind as DocKind;
  if (!((from === 'QUOTE' && (to === 'SALES_ORDER' || to === 'INVOICE')) || (from === 'SALES_ORDER' && to === 'INVOICE') || (from === 'PURCHASE_ORDER' && to === 'BILL'))) throw new LedgerError('bad_conversion', 'a quote becomes a sales order or an invoice; a sales order becomes an invoice; a purchase order becomes a bill');
  if (d.status !== 'ISSUED') throw new LedgerError('not_issued', 'send it first');
  if (d.outcome === 'CONVERTED') throw new LedgerError('converted', 'it was already turned into another document');
  if (d.outcome === 'DECLINED') throw new LedgerError('declined', 'the customer declined this');
  const stored = (await c.query(`SELECT * FROM document_lines WHERE document_id = $1 ORDER BY line_no`, [id])).rows;
  const milli = (q: bigint) => `${q / 1000n}.${String(q % 1000n).padStart(3, '0')}`;
  const newId = await saveDraft(c, orgId, null, {
    kind: to, currency: d.currency, fxRate: d.fx_rate, projectId: d.project_id ?? undefined, warehouseId: d.warehouse_id ?? undefined, partyId: d.party_id, date, placeOfSupply: d.place_of_supply ?? undefined, memo: d.memo ?? undefined, roundOff: d.round_off_on,
    lines: stored.map((l) => ({ itemId: l.item_id ?? undefined, description: l.description, hsnSac: l.hsn_sac ?? undefined, quantity: milli(l.quantity_milli), unitPrice: paiseToString(l.unit_price_fc_minor ?? l.unit_price_minor), discount: paiseToString(l.discount_fc_minor ?? l.discount_minor), taxCode: l.tax_code, unit: l.unit ?? undefined, inclusive: l.price_includes_tax }))
  }, actor);
  await c.query(`UPDATE documents SET related_document_id = $2 WHERE id = $1`, [newId, id]);
  await c.query(`UPDATE documents SET outcome = 'CONVERTED', converted_document_id = $2 WHERE id = $1`, [id, newId]);
  await audit(c, orgId, { actor, action: 'document.converted', entityType: 'document', entityId: id, detail: { number: d.number, to, newId: String(newId) } });
  return { id: newId };
};

/** Cancel an issued document the only allowed way: reverse its journal. Refused while money has been applied to it. */
export const voidDocument = async (c: Db, orgId: bigint, kind: DocKind, id: bigint, o: { date: string; reason: string }, actor: string, override?: Override): Promise<void> => {
  const doc = (await c.query(`SELECT status, journal_entry_id, stock_entry_id, balance_minor, total_minor, number FROM documents WHERE id = $1 AND kind = $2 FOR UPDATE`, [id, kind])).rows[0];
  if (!doc) throw gone('document');
  if (doc.status !== 'ISSUED') throw new LedgerError('not_issued', 'only an issued document can be voided');
  if (POSTS_NOTHING(kind)) {
    if ((await c.query(`SELECT outcome FROM documents WHERE id = $1`, [id])).rows[0].outcome === 'CONVERTED') throw new LedgerError('converted', 'this was already turned into another document; void that one first');
    await c.query(`UPDATE documents SET status = 'VOID', voided_on = $2 WHERE id = $1`, [id, o.date]);
    await audit(c, orgId, { actor, action: 'document.voided', entityType: 'document', entityId: id, detail: { number: doc.number, reason: o.reason } });
    return;
  }
  if (doc.balance_minor !== doc.total_minor) throw new LedgerError('has_allocations', 'payments or credits are applied to this document; void those first');
  await reverse(c, orgId, doc.journal_entry_id as bigint, { date: o.date, reason: o.reason, actor, override });
  await c.query(`UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = $1`, [id]);   // a voided invoice frees the hours it billed
  if (doc.stock_entry_id) await reverse(c, orgId, doc.stock_entry_id as bigint, { date: o.date, reason: o.reason, actor, override });
  const worth = await undoMoves(c, orgId, id, o.date, actor, override);
  if (doc.stock_entry_id) {   // if the cost was corrected after the sale, the cost entry reversed above is not the whole of what the stock moves undo
    const orig = (await c.query(`SELECT COALESCE(SUM(l.base_amount_minor), 0)::bigint AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 AND a.system_key = 'INVENTORY'`, [doc.stock_entry_id])).rows[0].v as bigint;
    const diff = (worth < 0n ? -worth : worth) - orig;
    if (diff !== 0n) {
      const amount = diff < 0n ? -diff : diff; const inventorySide = (worth < 0n) === (diff > 0n) ? 'D' : 'C';
      await post(c, orgId, { date: o.date, sourceType: 'stock_void_adjust', sourceId: `${id}`, kind: 'COGS', memo: `Cost corrections undone with ${doc.number}`, actor, override,
        lines: [{ account: 'INVENTORY', side: inventorySide, amount }, { account: 'COGS', side: inventorySide === 'D' ? 'C' : 'D', amount }] });
    }
  }
  await c.query(`UPDATE documents SET status = 'VOID', balance_minor = 0, foreign_balance_minor = CASE WHEN foreign_total_minor IS NULL THEN NULL ELSE 0 END, voided_on = $2 WHERE id = $1`, [id, o.date]);
  await audit(c, orgId, { actor, action: 'document.voided', entityType: 'document', entityId: id, detail: { number: doc.number, reason: o.reason } });
};

/* ---- applying money to documents */

export type Alloc = { documentId: bigint; amount: bigint };
const byId = (a: Alloc, b: Alloc) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0);

const applyAllocations = async (c: Db, orgId: bigint, src: { type: 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE'; id: bigint; partyId: bigint }, docKind: DocKind, allocs: Alloc[]): Promise<bigint> => {
  const seen = new Set<bigint>();
  let total = 0n;
  for (const a of [...allocs].sort(byId)) {                       // a fixed order, so two callers cannot deadlock on each other
    if (a.amount <= 0n) throw new LedgerError('bad_amount', 'an allocation must be above zero');
    if (seen.has(a.documentId)) throw new LedgerError('duplicate_allocation', 'a document appears twice in the allocations');
    seen.add(a.documentId);
    const doc = (await c.query(`SELECT kind, status, party_id, balance_minor, currency FROM documents WHERE id = $1 FOR UPDATE`, [a.documentId])).rows[0];
    if (!doc) throw gone('document');
    if (doc.currency !== BASE) throw new LedgerError('foreign_document', `document ${a.documentId} is in ${doc.currency}; settle it with a payment in that currency`);
    if (doc.kind !== docKind || doc.status !== 'ISSUED') throw new LedgerError('not_allocatable', `document ${a.documentId} is not an issued ${docKind.toLowerCase().replace('_', ' ')}`);
    if (doc.party_id !== src.partyId) throw new LedgerError('party_mismatch', 'the document belongs to a different party');
    if (a.amount > (doc.balance_minor as bigint)) throw new LedgerError('over_allocation', `document ${a.documentId} has only ${paiseToString(doc.balance_minor)} outstanding`);
    await c.query(`UPDATE documents SET balance_minor = balance_minor - $2 WHERE id = $1`, [a.documentId, a.amount]);
    await c.query(`INSERT INTO payment_allocations (organization_id, source_type, source_id, document_id, amount_minor) VALUES ($1, $2, $3, $4, $5)`, [orgId, src.type, src.id, a.documentId, a.amount]);
    total += a.amount;
  }
  return total;
};

/** Use the unapplied credit on a credit note to settle the customer's invoices. No journal: both already sit in receivables. */
export const applyCreditNote = async (c: Db, orgId: bigint, noteId: bigint, allocs: Alloc[], actor: string): Promise<void> => {
  const note = (await c.query(`SELECT status, party_id, balance_minor FROM documents WHERE id = $1 AND kind = 'CREDIT_NOTE' FOR UPDATE`, [noteId])).rows[0];
  if (!note) throw gone('credit note');
  if (note.status !== 'ISSUED') throw new LedgerError('not_issued', 'only an issued credit note can be applied');
  const total = await applyAllocations(c, orgId, { type: 'CREDIT_NOTE', id: noteId, partyId: note.party_id }, 'INVOICE', allocs);
  if (total > (note.balance_minor as bigint)) throw new LedgerError('over_allocation', `the credit note has only ${paiseToString(note.balance_minor)} left`);
  await c.query(`UPDATE documents SET balance_minor = balance_minor - $2 WHERE id = $1`, [noteId, total]);
  await audit(c, orgId, { actor, action: 'credit_note.applied', entityType: 'document', entityId: noteId, detail: { total: paiseToString(total) } });
};

/** Use the unapplied credit on a debit note to settle the vendor's bills. No journal: both already sit in payables. */
export const applyDebitNote = async (c: Db, orgId: bigint, noteId: bigint, allocs: Alloc[], actor: string): Promise<void> => {
  const note = (await c.query(`SELECT status, party_id, balance_minor FROM documents WHERE id = $1 AND kind = 'DEBIT_NOTE' FOR UPDATE`, [noteId])).rows[0];
  if (!note) throw gone('debit note');
  if (note.status !== 'ISSUED') throw new LedgerError('not_issued', 'only an issued debit note can be applied');
  const total = await applyAllocations(c, orgId, { type: 'DEBIT_NOTE', id: noteId, partyId: note.party_id }, 'BILL', allocs);
  if (total > (note.balance_minor as bigint)) throw new LedgerError('over_allocation', `the debit note has only ${paiseToString(note.balance_minor)} left`);
  await c.query(`UPDATE documents SET balance_minor = balance_minor - $2 WHERE id = $1`, [noteId, total]);
  await audit(c, orgId, { actor, action: 'debit_note.applied', entityType: 'document', entityId: noteId, detail: { total: paiseToString(total) } });
};

/* ---- payments */

/** fx: a payment that settles one foreign-currency document. amount is the rupees that moved; foreignAmount is the part of the document's currency it settles. */
export type PaymentIn = { fx?: { documentId: bigint; foreignAmount: bigint }; direction: 'IN' | 'OUT'; partyId: bigint; date: string; mode: Tender; amount: bigint; tds?: bigint; tdsSection?: string; reference?: string; allocations?: Alloc[]; idempotencyKey: string };
const docKindFor = (direction: 'IN' | 'OUT'): DocKind => (direction === 'IN' ? 'INVOICE' : 'BILL');

export const allocatePayment = async (c: Db, orgId: bigint, paymentId: bigint, allocs: Alloc[], actor: string): Promise<void> => {
  const p = (await c.query(`SELECT direction, status, party_id, unallocated_minor FROM payments WHERE id = $1 FOR UPDATE`, [paymentId])).rows[0];
  if (!p) throw gone('payment');
  if (p.status !== 'POSTED') throw new LedgerError('not_posted', 'this payment is void');
  const total = await applyAllocations(c, orgId, { type: 'PAYMENT', id: paymentId, partyId: p.party_id }, docKindFor(p.direction), allocs);
  if (total > (p.unallocated_minor as bigint)) throw new LedgerError('over_allocation', `the payment has only ${paiseToString(p.unallocated_minor)} unapplied`);
  await c.query(`UPDATE payments SET unallocated_minor = unallocated_minor - $2 WHERE id = $1`, [paymentId, total]);
  await audit(c, orgId, { actor, action: 'payment.allocated', entityType: 'payment', entityId: paymentId, detail: { total: paiseToString(total) } });
};

/** Money in from a customer or out to a vendor, posted at once. Whatever is not applied to a document stays as an advance on the party. */
export const createPayment = async (c: Db, orgId: bigint, p: PaymentIn, actor: string, override?: Override) => {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${orgId}:payment:${p.idempotencyKey}`]);   // one request per key at a time
  const prior = (await c.query(`SELECT id, number, journal_entry_id FROM payments WHERE idempotency_key = $1`, [p.idempotencyKey])).rows[0];
  if (prior) return { id: prior.id as bigint, number: prior.number as string, replayed: true };
  if (p.amount <= 0n) throw new LedgerError('bad_amount', 'a payment must be above zero');
  const tds = p.tds ?? 0n;
  if (tds < 0n) throw new LedgerError('bad_amount', 'TDS cannot be negative');
  await partyFor(c, p.partyId, p.direction === 'IN' ? 'CUSTOMER' : 'VENDOR');
  // settling a foreign-currency document: the rupees it was booked at, for the share being paid, against the rupees that actually moved
  let adj = 0n; let share = 0n; let fxDoc: { currency: string; foreign_balance_minor: bigint } | null = null;
  if (p.fx) {
    if (tds !== 0n) throw new LedgerError('fx_tds', 'TDS cannot be combined with a foreign-currency settlement');
    if (p.allocations?.length) throw new LedgerError('fx_allocations', 'a foreign-currency payment settles its own document; do not allocate it again');
    if (p.fx.foreignAmount <= 0n) throw new LedgerError('bad_amount', 'the foreign amount must be above zero');
    const doc = (await c.query(`SELECT kind, status, party_id, balance_minor, currency, foreign_balance_minor FROM documents WHERE id = $1 FOR UPDATE`, [p.fx.documentId])).rows[0];
    if (!doc) throw gone('document');
    if (doc.kind !== docKindFor(p.direction) || doc.status !== 'ISSUED') throw new LedgerError('not_allocatable', `that is not an issued ${docKindFor(p.direction).toLowerCase()}`);
    if (doc.party_id !== p.partyId) throw new LedgerError('party_mismatch', 'the document belongs to a different party');
    if (doc.currency === BASE) throw new LedgerError('not_foreign', 'that document is in rupees; record the payment normally');
    if (p.fx.foreignAmount > (doc.foreign_balance_minor as bigint)) throw new LedgerError('over_allocation', `only ${paiseToString(doc.foreign_balance_minor)} ${doc.currency} is outstanding on that document`);
    share = p.fx.foreignAmount === doc.foreign_balance_minor ? (doc.balance_minor as bigint) : roundDiv((doc.balance_minor as bigint) * p.fx.foreignAmount, doc.foreign_balance_minor as bigint);
    adj = share - p.amount;
    fxDoc = doc;
  }
  const number = await nextNumber(c, orgId, p.direction === 'IN' ? 'RCT' : 'PAY', p.date);
  const id = (await c.query(
    `INSERT INTO payments (organization_id, direction, number, party_id, pay_date, mode, reference, amount_minor, unallocated_minor, idempotency_key, created_by, tds_minor, tds_section, currency, foreign_amount_minor, fx_settle_adj_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8 + $11::bigint + $15::bigint, $9, $10, $11, $12, $13, $14, $15) RETURNING id`, [orgId, p.direction, number, p.partyId, p.date, p.mode, p.reference ?? null, p.amount, p.idempotencyKey, actor, tds, tds ? p.tdsSection ?? null : null, fxDoc?.currency ?? BASE, p.fx?.foreignAmount ?? null, adj])).rows[0].id as bigint;
  const base = { date: p.date, paymentId: number, partyId: p.partyId, mode: p.mode, amount: p.amount, tds, adj };
  const journal = p.direction === 'IN' ? customerPaymentJournal(base) : supplierPaymentJournal(base);
  const posted = await post(c, orgId, { ...journal, actor, override });
  await c.query(`UPDATE payments SET journal_entry_id = $2 WHERE id = $1`, [id, posted.entryId]);
  if (p.allocations?.length) await allocatePayment(c, orgId, id, p.allocations, actor);
  if (p.fx && fxDoc) {
    await c.query(`UPDATE documents SET balance_minor = balance_minor - $2, foreign_balance_minor = foreign_balance_minor - $3 WHERE id = $1`, [p.fx.documentId, share, p.fx.foreignAmount]);
    await c.query(`INSERT INTO payment_allocations (organization_id, source_type, source_id, document_id, amount_minor, foreign_minor) VALUES ($1, 'PAYMENT', $2, $3, $4, $5)`, [orgId, id, p.fx.documentId, share, p.fx.foreignAmount]);
    await c.query(`UPDATE payments SET unallocated_minor = unallocated_minor - $2 WHERE id = $1`, [id, share]);
  }
  await audit(c, orgId, { actor, action: 'payment.recorded', entityType: 'payment', entityId: id, detail: { number, direction: p.direction, amount: paiseToString(p.amount), ...(tds ? { tds: paiseToString(tds) } : {}) } });
  return { id, number, entryNo: posted.entryNo, replayed: false };
};

export const voidPayment = async (c: Db, orgId: bigint, id: bigint, o: { date: string; reason: string }, actor: string, override?: Override): Promise<void> => {
  const p = (await c.query(`SELECT status, journal_entry_id, number FROM payments WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!p) throw gone('payment');
  if (p.status !== 'POSTED') throw new LedgerError('not_posted', 'this payment is already void');
  await reverse(c, orgId, p.journal_entry_id as bigint, { date: o.date, reason: o.reason, actor, override });
  const applied = (await c.query(`SELECT document_id, amount_minor, foreign_minor FROM payment_allocations WHERE source_type = 'PAYMENT' AND source_id = $1 AND voided_at IS NULL`, [id])).rows;
  for (const a of applied) await c.query(`UPDATE documents SET balance_minor = balance_minor + $2, foreign_balance_minor = foreign_balance_minor + COALESCE($3::bigint, 0) WHERE id = $1`, [a.document_id, a.amount_minor, a.foreign_minor]);
  await c.query(`UPDATE payment_allocations SET voided_at = now() WHERE source_type = 'PAYMENT' AND source_id = $1 AND voided_at IS NULL`, [id]);
  await c.query(`UPDATE payments SET status = 'VOID', unallocated_minor = 0 WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'payment.voided', entityType: 'payment', entityId: id, detail: { number: p.number, reason: o.reason } });
};

export const listPayments = async (c: Db, q: { direction?: string; partyId?: bigint; before?: bigint; limit: number }) => (await c.query(
  `SELECT p.id, p.direction, p.number, p.party_id, pt.name AS party_name, p.pay_date::text AS pay_date, p.mode, p.reference, p.amount_minor, p.tds_minor, p.tds_section, p.unallocated_minor, p.status, p.journal_entry_id, p.currency, p.foreign_amount_minor, p.fx_settle_adj_minor
     FROM payments p JOIN parties pt ON pt.id = p.party_id
    WHERE ($1::text IS NULL OR p.direction = $1) AND ($2::bigint IS NULL OR p.party_id = $2) AND ($3::bigint IS NULL OR p.id < $3) ORDER BY p.id DESC LIMIT $4`,
  [q.direction ?? null, q.partyId ?? null, q.before ?? null, q.limit])).rows;

export const getPayment = async (c: Db, id: bigint) => {
  const p = (await c.query(
    `SELECT p.id, p.direction, p.number, p.party_id, pt.name AS party_name, p.pay_date::text AS pay_date, p.mode, p.reference, p.amount_minor, p.tds_minor, p.tds_section, p.unallocated_minor, p.status, p.journal_entry_id, p.currency, p.foreign_amount_minor, p.fx_settle_adj_minor
       FROM payments p JOIN parties pt ON pt.id = p.party_id WHERE p.id = $1`, [id])).rows[0];
  if (!p) return null;
  const allocations = (await c.query(`SELECT document_id, amount_minor, voided_at IS NOT NULL AS voided FROM payment_allocations WHERE source_type = 'PAYMENT' AND source_id = $1 ORDER BY id`, [id])).rows;
  return { ...p, allocations };
};

/* ---- reports */

/**
 * Who owes what, by how late, as of a date. The balance is rebuilt for that date: a payment or credit counts from its own date, and
 * one voided later still counts until then. ponytail: an allocation is treated as voided on the day it was voided in the system, not on the date given for the reversal.
 */
export const ageing = async (c: Db, orgId: bigint, kind: 'INVOICE' | 'BILL', asOf: string) => {
  const rows = (await c.query(
    `SELECT party_id, party_name,
            COALESCE(SUM(balance_minor) FILTER (WHERE age <= 0), 0)::bigint AS not_due,
            COALESCE(SUM(balance_minor) FILTER (WHERE age BETWEEN 1 AND 30), 0)::bigint AS days_1_30,
            COALESCE(SUM(balance_minor) FILTER (WHERE age BETWEEN 31 AND 60), 0)::bigint AS days_31_60,
            COALESCE(SUM(balance_minor) FILTER (WHERE age BETWEEN 61 AND 90), 0)::bigint AS days_61_90,
            COALESCE(SUM(balance_minor) FILTER (WHERE age > 90), 0)::bigint AS days_over_90,
            SUM(balance_minor)::bigint AS total
       FROM (SELECT d.party_id, p.name AS party_name, ($3::date - COALESCE(d.due_date, d.issue_date)) AS age,
                    d.total_minor - COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a
                       WHERE a.document_id = d.id AND (a.voided_at IS NULL OR a.voided_at::date > $3::date)
                         AND (CASE a.source_type WHEN 'PAYMENT' THEN (SELECT pay_date FROM payments x WHERE x.id = a.source_id)
                                                 ELSE (SELECT issue_date FROM documents x WHERE x.id = a.source_id) END) <= $3::date), 0) AS balance_minor
               FROM documents d JOIN parties p ON p.id = d.party_id
              WHERE d.organization_id = $1 AND d.kind = $2 AND d.issue_date <= $3::date
                AND (d.status = 'ISSUED' OR (d.status = 'VOID' AND d.voided_on > $3::date))) x
      WHERE balance_minor > 0
      GROUP BY party_id, party_name ORDER BY party_name`, [orgId, kind, asOf])).rows as { party_id: bigint; party_name: string; not_due: bigint; days_1_30: bigint; days_31_60: bigint; days_61_90: bigint; days_over_90: bigint; total: bigint }[];
  return { rows, total: rows.reduce((a, r) => a + r.total, 0n) };
};
