import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { validStateCode } from './gst.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import { paiseToString, roundDiv, taxOn, toPaise } from './money.ts';
import { creditNoteJournal, customerPaymentJournal, saleJournal, supplierBillJournal, supplierPaymentJournal } from './rules.ts';
import type { Tender } from './rules.ts';

/* Invoices, bills and credit notes are drafts until issued. Issuing numbers the document and posts its journal in one
   transaction through the rules in rules.ts, so a document and its journal can never disagree (accounting-rules I1, I2). */

export type DocKind = 'INVOICE' | 'BILL' | 'CREDIT_NOTE';
export type LineIn = { itemId?: bigint; description?: string; hsnSac?: string; quantity?: string; unitPrice?: string; discount?: string; taxCode?: string };
export type DocIn = {
  kind: DocKind; partyId: bigint; date: string; dueDate?: string; placeOfSupply?: string; supplierRef?: string;
  relatedDocumentId?: bigint; memo?: string; roundOff?: boolean; lines: LineIn[];
};
type Override = { reason: string };

const PREFIX: Record<DocKind, string> = { INVOICE: 'INV', BILL: 'BILL', CREDIT_NOTE: 'CN' };
const gone = (what: string) => new LedgerError('not_found', `no such ${what}`);

/** Gapless numbers: the row lock taken by the upsert serialises callers, and a rolled-back transaction gives its number back. */
const nextNumber = async (c: Db, orgId: bigint, key: string): Promise<string> => {
  const n = (await c.query(
    `INSERT INTO document_sequences (organization_id, key, next_value) VALUES ($1, $2, 1)
       ON CONFLICT (organization_id, key) DO UPDATE SET next_value = document_sequences.next_value + 1 RETURNING next_value`, [orgId, key])).rows[0].next_value as bigint;
  return `${key}-${String(n).padStart(6, '0')}`;
};

const toMilli = (text: string): bigint => {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text.trim());
  const v = m ? BigInt(m[1] as string) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3)) : 0n;
  if (v <= 0n) throw new LedgerError('bad_quantity', `${text} is not a quantity above zero (three decimals at most)`);
  return v;
};

type Priced = { itemId: bigint | null; description: string; hsnSac: string | null; qtyMilli: bigint; unitPrice: bigint; discount: bigint; taxable: bigint; taxCode: string; rateBp: number; tax: bigint };

/** Prices lines with the tax rate in force on the document date, so an old invoice never changes when a rate does. */
const priceLines = async (c: Db, kind: DocKind, lines: LineIn[], date: string): Promise<Priced[]> => {
  if (lines.length === 0) throw new LedgerError('no_lines', 'a document needs at least one line');
  const out: Priced[] = [];
  for (const l of lines) {
    const item = l.itemId ? (await c.query(`SELECT name, hsn_sac, tax_code, sale_price_minor, purchase_price_minor FROM items WHERE id = $1 AND active`, [l.itemId])).rows[0] : null;
    if (l.itemId && !item) throw gone('item');
    const description = l.description?.trim() || (item?.name as string | undefined);
    if (!description) throw new LedgerError('description_required', 'each line needs an item or a description');
    const unitPrice = l.unitPrice !== undefined ? toPaise(l.unitPrice) : item ? (item[kind === 'BILL' ? 'purchase_price_minor' : 'sale_price_minor'] as bigint) : null;
    if (unitPrice === null) throw new LedgerError('price_required', 'each line needs a unit price or an item');
    const taxCode = l.taxCode ?? (item?.tax_code as string | undefined);
    if (!taxCode) throw new LedgerError('tax_code_required', 'each line needs a tax code (GST0 for none)');
    const rate = (await c.query(`SELECT rate_bp FROM tax_rates WHERE code = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`, [taxCode, date])).rows[0];
    if (!rate) throw new LedgerError('unknown_tax_code', `no rate for ${taxCode} on ${date}`);
    const qtyMilli = toMilli(l.quantity ?? '1');
    const discount = l.discount ? toPaise(l.discount) : 0n;
    if (unitPrice < 0n || discount < 0n) throw new LedgerError('bad_amount', 'prices and discounts cannot be negative');
    const gross = roundDiv(qtyMilli * unitPrice, 1000n);
    if (discount > gross) throw new LedgerError('discount_too_large', 'a discount cannot exceed the line amount');
    const taxable = gross - discount;
    out.push({ itemId: l.itemId ?? null, description, hsnSac: l.hsnSac ?? (item?.hsn_sac as string | null) ?? null, qtyMilli, unitPrice, discount, taxable, taxCode, rateBp: rate.rate_bp as number, tax: taxOn(taxable, rate.rate_bp as number) });
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
const roleOf = (kind: DocKind): 'CUSTOMER' | 'VENDOR' => (kind === 'BILL' ? 'VENDOR' : 'CUSTOMER');

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Create a draft (id null) or replace the content of one. Totals are worked out here, from the lines, never taken from the caller. */
export const saveDraft = async (c: Db, orgId: bigint, id: bigint | null, d: DocIn, actor: string): Promise<bigint> => {
  const party = await partyFor(c, d.partyId, roleOf(d.kind));
  if (d.roundOff && d.kind !== 'INVOICE') throw new LedgerError('round_off_unsupported', 'only invoices can be rounded off');
  if (d.placeOfSupply && !validStateCode(d.placeOfSupply)) throw new LedgerError('bad_state', `${d.placeOfSupply} is not a GST state code`);
  if (d.relatedDocumentId) {
    const ok = d.kind === 'CREDIT_NOTE' && (await c.query(`SELECT 1 FROM documents WHERE id = $1 AND kind = 'INVOICE' AND status = 'ISSUED' AND party_id = $2`, [d.relatedDocumentId, d.partyId])).rowCount;
    if (!ok) throw new LedgerError('bad_related_document', 'a credit note can only refer to an issued invoice of the same customer');
  }
  const lines = await priceLines(c, d.kind, d.lines, d.date);
  const org = (await c.query(`SELECT state_code FROM organizations WHERE id = $1`, [orgId])).rows[0];
  const place = d.placeOfSupply ?? party.state_code;
  const interState = Boolean(org?.state_code && place && org.state_code !== place);
  const subtotal = lines.reduce((a, l) => a + l.taxable, 0n);
  const tax = lines.reduce((a, l) => a + l.tax, 0n);
  const roundOff = d.roundOff ? roundDiv(subtotal + tax, 100n) * 100n - (subtotal + tax) : 0n;
  const due = d.kind === 'CREDIT_NOTE' ? null : d.dueDate ?? addDays(d.date, party.credit_days);
  const fields = [d.partyId, d.date, due, place ?? null, interState, d.supplierRef ?? null, d.relatedDocumentId ?? null, d.memo ?? null, Boolean(d.roundOff), subtotal, tax, roundOff, subtotal + tax + roundOff];
  if (id === null) {
    id = (await c.query(
      `INSERT INTO documents (organization_id, kind, created_by, party_id, issue_date, due_date, place_of_supply, inter_state, supplier_ref, related_document_id, memo, round_off_on, subtotal_minor, tax_minor, round_off_minor, total_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`, [orgId, d.kind, actor, ...fields])).rows[0].id as bigint;
    await audit(c, orgId, { actor, action: 'document.drafted', entityType: 'document', entityId: id, detail: { kind: d.kind } });
  } else {
    const cur = (await c.query(`SELECT kind, status FROM documents WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw gone('document');
    if (cur.status !== 'DRAFT') throw new LedgerError('not_draft', 'only a draft can be edited; void an issued document and make a new one');
    if (cur.kind !== d.kind) throw new LedgerError('kind_mismatch', 'a document cannot change its kind');
    await c.query(
      `UPDATE documents SET party_id = $2, issue_date = $3, due_date = $4, place_of_supply = $5, inter_state = $6, supplier_ref = $7, related_document_id = $8, memo = $9, round_off_on = $10,
              subtotal_minor = $11, tax_minor = $12, round_off_minor = $13, total_minor = $14 WHERE id = $1`, [id, ...fields]);
    await c.query(`DELETE FROM document_lines WHERE document_id = $1`, [id]);
  }
  let no = 0;
  for (const l of lines) {
    no += 1;
    await c.query(
      `INSERT INTO document_lines (organization_id, document_id, line_no, item_id, description, hsn_sac, quantity_milli, unit_price_minor, discount_minor, taxable_minor, tax_code, tax_rate_bp, tax_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [orgId, id, no, l.itemId, l.description, l.hsnSac, l.qtyMilli, l.unitPrice, l.discount, l.taxable, l.taxCode, l.rateBp, l.tax]);
  }
  return id;
};

const DOC_COLS = `d.id, d.kind, d.number, d.supplier_ref, d.party_id, p.name AS party_name, d.status, d.issue_date::text AS issue_date, d.due_date::text AS due_date,
  d.place_of_supply, d.inter_state, d.subtotal_minor, d.tax_minor, d.round_off_minor, d.total_minor, d.balance_minor, d.related_document_id, d.journal_entry_id, d.memo`;

export const listDocuments = async (c: Db, kind: DocKind, q: { status?: string; partyId?: bigint; before?: bigint; limit: number }) => (await c.query(
  `SELECT ${DOC_COLS} FROM documents d JOIN parties p ON p.id = d.party_id
    WHERE d.kind = $1 AND ($2::text IS NULL OR d.status = $2) AND ($3::bigint IS NULL OR d.party_id = $3) AND ($4::bigint IS NULL OR d.id < $4) ORDER BY d.id DESC LIMIT $5`,
  [kind, q.status ?? null, q.partyId ?? null, q.before ?? null, q.limit])).rows;

export const getDocument = async (c: Db, kind: DocKind, id: bigint) => {
  const doc = (await c.query(`SELECT ${DOC_COLS} FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1 AND d.kind = $2`, [id, kind])).rows[0];
  if (!doc) return null;
  const lines = (await c.query(
    `SELECT id, line_no, item_id, description, hsn_sac, round(quantity_milli::numeric / 1000, 3)::text AS quantity, unit_price_minor, discount_minor, taxable_minor, tax_code, tax_rate_bp, tax_minor
       FROM document_lines WHERE document_id = $1 ORDER BY line_no`, [id])).rows;
  const allocations = (await c.query(`SELECT source_type, source_id, amount_minor, voided_at IS NOT NULL AS voided FROM payment_allocations WHERE document_id = $1 ORDER BY id`, [id])).rows;
  return { ...doc, lines, allocations };
};

export const deleteDraft = async (c: Db, orgId: bigint, kind: DocKind, id: bigint, actor: string): Promise<void> => {
  const cur = (await c.query(`SELECT status FROM documents WHERE id = $1 AND kind = $2 FOR UPDATE`, [id, kind])).rows[0];
  if (!cur) throw gone('document');
  if (cur.status !== 'DRAFT') throw new LedgerError('not_draft', 'only a draft can be deleted; void an issued document instead');
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
    kind, partyId: doc.party_id, date: doc.issue_d, dueDate: doc.due_d ?? undefined,
    placeOfSupply: doc.place_of_supply ?? undefined, supplierRef: doc.supplier_ref ?? undefined, relatedDocumentId: doc.related_document_id ?? undefined, memo: doc.memo ?? undefined, roundOff: doc.round_off_on,
    lines: stored.map((l) => ({ itemId: l.item_id ?? undefined, description: l.description, hsnSac: l.hsn_sac ?? undefined, quantity: milli(l.quantity_milli), unitPrice: paiseToString(l.unit_price_minor), discount: paiseToString(l.discount_minor), taxCode: l.tax_code }))
  }, actor);
  const fresh = (await c.query(`SELECT *, issue_date::text AS d FROM documents WHERE id = $1`, [id])).rows[0];
  const lines = (await c.query(`SELECT taxable_minor, tax_rate_bp FROM document_lines WHERE document_id = $1`, [id])).rows;
  const total = fresh.total_minor as bigint;
  if (total <= 0n) throw new LedgerError('zero_total', 'a document with nothing to pay cannot be issued');
  if (kind === 'BILL' && fresh.supplier_ref) {
    const dup = (await c.query(`SELECT number FROM documents WHERE kind = 'BILL' AND status = 'ISSUED' AND party_id = $1 AND lower(supplier_ref) = lower($2) AND id <> $3`, [fresh.party_id, fresh.supplier_ref, id])).rows[0];
    if (dup) throw new LedgerError('duplicate_bill', `this supplier invoice number was already entered as ${dup.number}`);
  }
  const number = await nextNumber(c, orgId, PREFIX[kind]);
  const taxed = lines.map((l) => ({ taxable: l.taxable_minor as bigint, rateBp: l.tax_rate_bp as number }));
  const common = { date: fresh.d as string, partyId: fresh.party_id as bigint, lines: taxed, interState: fresh.inter_state as boolean };
  const journal = kind === 'INVOICE' ? saleJournal({ ...common, invoiceId: number, roundOff: fresh.round_off_minor as bigint })
    : kind === 'BILL' ? supplierBillJournal({ ...common, billId: number })
    : creditNoteJournal({ ...common, noteId: number });
  const posted = await post(c, orgId, { ...journal, actor, override });
  await c.query(`UPDATE documents SET status = 'ISSUED', number = $2, journal_entry_id = $3, balance_minor = total_minor WHERE id = $1`, [id, number, posted.entryId]);
  await audit(c, orgId, { actor, action: 'document.issued', entityType: 'document', entityId: id, detail: { kind, number, entryNo: posted.entryNo, total: paiseToString(total) } });
  return { number, entryNo: posted.entryNo };
};

/** Cancel an issued document the only allowed way: reverse its journal. Refused while money has been applied to it. */
export const voidDocument = async (c: Db, orgId: bigint, kind: DocKind, id: bigint, o: { date: string; reason: string }, actor: string, override?: Override): Promise<void> => {
  const doc = (await c.query(`SELECT status, journal_entry_id, balance_minor, total_minor, number FROM documents WHERE id = $1 AND kind = $2 FOR UPDATE`, [id, kind])).rows[0];
  if (!doc) throw gone('document');
  if (doc.status !== 'ISSUED') throw new LedgerError('not_issued', 'only an issued document can be voided');
  if (doc.balance_minor !== doc.total_minor) throw new LedgerError('has_allocations', 'payments or credits are applied to this document; void those first');
  await reverse(c, orgId, doc.journal_entry_id as bigint, { date: o.date, reason: o.reason, actor, override });
  await c.query(`UPDATE documents SET status = 'VOID', balance_minor = 0 WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'document.voided', entityType: 'document', entityId: id, detail: { number: doc.number, reason: o.reason } });
};

/* ---- applying money to documents */

export type Alloc = { documentId: bigint; amount: bigint };
const byId = (a: Alloc, b: Alloc) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0);

const applyAllocations = async (c: Db, orgId: bigint, src: { type: 'PAYMENT' | 'CREDIT_NOTE'; id: bigint; partyId: bigint }, docKind: DocKind, allocs: Alloc[]): Promise<bigint> => {
  const seen = new Set<bigint>();
  let total = 0n;
  for (const a of [...allocs].sort(byId)) {                       // a fixed order, so two callers cannot deadlock on each other
    if (a.amount <= 0n) throw new LedgerError('bad_amount', 'an allocation must be above zero');
    if (seen.has(a.documentId)) throw new LedgerError('duplicate_allocation', 'a document appears twice in the allocations');
    seen.add(a.documentId);
    const doc = (await c.query(`SELECT kind, status, party_id, balance_minor FROM documents WHERE id = $1 FOR UPDATE`, [a.documentId])).rows[0];
    if (!doc) throw gone('document');
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

/* ---- payments */

export type PaymentIn = { direction: 'IN' | 'OUT'; partyId: bigint; date: string; mode: Tender; amount: bigint; reference?: string; allocations?: Alloc[]; idempotencyKey: string };
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
  await partyFor(c, p.partyId, p.direction === 'IN' ? 'CUSTOMER' : 'VENDOR');
  const number = await nextNumber(c, orgId, p.direction === 'IN' ? 'RCT' : 'PAY');
  const id = (await c.query(
    `INSERT INTO payments (organization_id, direction, number, party_id, pay_date, mode, reference, amount_minor, unallocated_minor, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10) RETURNING id`, [orgId, p.direction, number, p.partyId, p.date, p.mode, p.reference ?? null, p.amount, p.idempotencyKey, actor])).rows[0].id as bigint;
  const base = { date: p.date, paymentId: number, partyId: p.partyId, mode: p.mode, amount: p.amount };
  const journal = p.direction === 'IN' ? customerPaymentJournal(base) : supplierPaymentJournal(base);
  const posted = await post(c, orgId, { ...journal, actor, override });
  await c.query(`UPDATE payments SET journal_entry_id = $2 WHERE id = $1`, [id, posted.entryId]);
  if (p.allocations?.length) await allocatePayment(c, orgId, id, p.allocations, actor);
  await audit(c, orgId, { actor, action: 'payment.recorded', entityType: 'payment', entityId: id, detail: { number, direction: p.direction, amount: paiseToString(p.amount) } });
  return { id, number, entryNo: posted.entryNo, replayed: false };
};

export const voidPayment = async (c: Db, orgId: bigint, id: bigint, o: { date: string; reason: string }, actor: string, override?: Override): Promise<void> => {
  const p = (await c.query(`SELECT status, journal_entry_id, number FROM payments WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!p) throw gone('payment');
  if (p.status !== 'POSTED') throw new LedgerError('not_posted', 'this payment is already void');
  await reverse(c, orgId, p.journal_entry_id as bigint, { date: o.date, reason: o.reason, actor, override });
  const applied = (await c.query(`SELECT document_id, amount_minor FROM payment_allocations WHERE source_type = 'PAYMENT' AND source_id = $1 AND voided_at IS NULL`, [id])).rows;
  for (const a of applied) await c.query(`UPDATE documents SET balance_minor = balance_minor + $2 WHERE id = $1`, [a.document_id, a.amount_minor]);
  await c.query(`UPDATE payment_allocations SET voided_at = now() WHERE source_type = 'PAYMENT' AND source_id = $1 AND voided_at IS NULL`, [id]);
  await c.query(`UPDATE payments SET status = 'VOID', unallocated_minor = 0 WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'payment.voided', entityType: 'payment', entityId: id, detail: { number: p.number, reason: o.reason } });
};

export const listPayments = async (c: Db, q: { direction?: string; partyId?: bigint; before?: bigint; limit: number }) => (await c.query(
  `SELECT p.id, p.direction, p.number, p.party_id, pt.name AS party_name, p.pay_date::text AS pay_date, p.mode, p.reference, p.amount_minor, p.unallocated_minor, p.status, p.journal_entry_id
     FROM payments p JOIN parties pt ON pt.id = p.party_id
    WHERE ($1::text IS NULL OR p.direction = $1) AND ($2::bigint IS NULL OR p.party_id = $2) AND ($3::bigint IS NULL OR p.id < $3) ORDER BY p.id DESC LIMIT $4`,
  [q.direction ?? null, q.partyId ?? null, q.before ?? null, q.limit])).rows;

export const getPayment = async (c: Db, id: bigint) => {
  const p = (await c.query(
    `SELECT p.id, p.direction, p.number, p.party_id, pt.name AS party_name, p.pay_date::text AS pay_date, p.mode, p.reference, p.amount_minor, p.unallocated_minor, p.status, p.journal_entry_id
       FROM payments p JOIN parties pt ON pt.id = p.party_id WHERE p.id = $1`, [id])).rows[0];
  if (!p) return null;
  const allocations = (await c.query(`SELECT document_id, amount_minor, voided_at IS NOT NULL AS voided FROM payment_allocations WHERE source_type = 'PAYMENT' AND source_id = $1 ORDER BY id`, [id])).rows;
  return { ...p, allocations };
};

/* ---- reports */

/** Who owes what, by how late. Uses the balances today, so it answers "as of now"; a past date only moves the buckets. */
export const ageing = async (c: Db, orgId: bigint, kind: 'INVOICE' | 'BILL', asOf: string) => {
  const rows = (await c.query(
    `SELECT party_id, party_name,
            COALESCE(SUM(balance_minor) FILTER (WHERE age <= 0), 0)::bigint AS not_due,
            COALESCE(SUM(balance_minor) FILTER (WHERE age BETWEEN 1 AND 30), 0)::bigint AS days_1_30,
            COALESCE(SUM(balance_minor) FILTER (WHERE age BETWEEN 31 AND 60), 0)::bigint AS days_31_60,
            COALESCE(SUM(balance_minor) FILTER (WHERE age BETWEEN 61 AND 90), 0)::bigint AS days_61_90,
            COALESCE(SUM(balance_minor) FILTER (WHERE age > 90), 0)::bigint AS days_over_90,
            SUM(balance_minor)::bigint AS total
       FROM (SELECT d.party_id, p.name AS party_name, d.balance_minor, ($3::date - COALESCE(d.due_date, d.issue_date)) AS age
               FROM documents d JOIN parties p ON p.id = d.party_id
              WHERE d.organization_id = $1 AND d.kind = $2 AND d.status = 'ISSUED' AND d.balance_minor > 0) x
      GROUP BY party_id, party_name ORDER BY party_name`, [orgId, kind, asOf])).rows as { total: bigint }[];
  return { rows, total: rows.reduce((a, r) => a + r.total, 0n) };
};
