import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { issueDocument, saveDraft, setRetention } from './documents.ts';
import { UQC } from './gst.ts';
import { LedgerError } from './ledger.ts';
import { paiseToString, toPaise } from './money.ts';

/* Work orders and running-account (RA) bills. A work order lists the work (description, unit, quantity, rate) agreed with a subcontractor (PAYABLE) or a client (RECEIVABLE).
   Each RA bill records the work measured to date per item; it bills only what is new since the last bill, issues a purchase bill or sales invoice for it, and holds
   back the work order's retention percentage on that bill. */

const gone = (what: string) => new LedgerError('not_found', `no such ${what}`);

/** "12.5" -> 12500 (thousandths): quantities are kept to three decimals. */
export const toMilli = (text: string): bigint => {
  const m = /^(\d{1,12})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!m) throw new LedgerError('bad_quantity', `${text} is not a quantity`);
  return BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
};
export const milliText = (m: bigint): string => `${m / 1000n}.${String(m % 1000n).padStart(3, '0')}`;

export type WorkOrderIn = { projectId: bigint; partyId: bigint; side: 'PAYABLE' | 'RECEIVABLE'; title: string; taxCode?: string; retentionPercent?: number; items: { description: string; unit?: string; quantity: string; rate: string }[] };

export const createWorkOrder = async (c: Db, orgId: bigint, w: WorkOrderIn, actor: string): Promise<bigint> => {
  if (!w.title.trim()) throw new LedgerError('name_required', 'give the work order a title');
  if (!w.items.length) throw new LedgerError('no_items', 'list at least one item of work');
  if (!(await c.query(`SELECT 1 FROM projects WHERE id = $1`, [w.projectId])).rowCount) throw gone('project');
  const kinds = w.side === 'PAYABLE' ? ['VENDOR', 'BOTH'] : ['CUSTOMER', 'BOTH'];
  if (!(await c.query(`SELECT 1 FROM parties WHERE id = $1 AND kind = ANY($2)`, [w.partyId, kinds])).rowCount) throw new LedgerError('bad_party', w.side === 'PAYABLE' ? 'choose one of your vendors' : 'choose one of your customers');
  const bp = Math.round((w.retentionPercent ?? 0) * 100);
  if (!(bp >= 0 && bp <= 5000)) throw new LedgerError('bad_retention', 'retention must be between 0 and 50%');
  const row = (await c.query(
    `INSERT INTO work_orders (organization_id, project_id, party_id, side, title, tax_code, retention_bp) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [orgId, w.projectId, w.partyId, w.side, w.title.trim().slice(0, 160), w.taxCode || 'GST18', bp])).rows[0];
  for (const [i, it] of w.items.entries()) {
    if (it.unit && !UQC.includes(it.unit)) throw new LedgerError('bad_unit', `${it.unit} is not a unit code the GST portal knows`);
    const qty = toMilli(it.quantity);
    if (qty <= 0n) throw new LedgerError('bad_quantity', 'a quantity must be above zero');
    await c.query(`INSERT INTO work_order_items (organization_id, work_order_id, seq, description, unit, qty_milli, rate_minor) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, row.id, i + 1, it.description.trim().slice(0, 200) || `Item ${i + 1}`, it.unit ?? null, qty, toPaise(it.rate)]);
  }
  await audit(c, orgId, { actor, action: 'work_order.created', entityType: 'work_order', entityId: row.id as bigint, detail: { title: w.title, side: w.side } });
  return row.id as bigint;
};

/** The quantity measured to date per item, from the latest RA bill that has not been voided. */
const certified = async (c: Db, woId: bigint) => {
  const rows = (await c.query(
    `SELECT l.item_id, l.cum_qty_milli FROM ra_bill_lines l JOIN ra_bills b ON b.id = l.ra_bill_id JOIN documents d ON d.id = b.document_id
      WHERE b.work_order_id = $1 AND d.status = 'ISSUED' AND b.seq = (SELECT MAX(b2.seq) FROM ra_bills b2 JOIN documents d2 ON d2.id = b2.document_id WHERE b2.work_order_id = $1 AND d2.status = 'ISSUED')`, [woId])).rows;
  return new Map(rows.map((r) => [String(r.item_id), r.cum_qty_milli as bigint]));
};

/** Raise the next RA bill. `measured` gives, per item, the total work done to date; items left out keep their last figure. */
export const raiseRaBill = async (c: Db, orgId: bigint, woId: bigint, o: { date: string; measured: { itemId: bigint; quantity: string }[] }, actor: string) => {
  const w = (await c.query(`SELECT * FROM work_orders WHERE id = $1 FOR UPDATE`, [woId])).rows[0];
  if (!w) throw gone('work order');
  const items = (await c.query(`SELECT * FROM work_order_items WHERE work_order_id = $1 ORDER BY seq`, [woId])).rows;
  const before = await certified(c, woId);
  const now = new Map(before);
  for (const m of o.measured) {
    const it = items.find((x) => x.id === m.itemId);
    if (!it) throw new LedgerError('not_found', 'that item is not on this work order');
    const q = toMilli(m.quantity);
    if (q < (before.get(String(it.id)) ?? 0n)) throw new LedgerError('went_back', `${it.description}: the total to date cannot be less than what was already billed`);
    if (q > (it.qty_milli as bigint)) throw new LedgerError('over_contract', `${it.description}: ${milliText(q)} is more than the ${milliText(it.qty_milli)} in the work order`);
    now.set(String(it.id), q);
  }
  const lines = items.flatMap((it) => {
    const delta = (now.get(String(it.id)) ?? 0n) - (before.get(String(it.id)) ?? 0n);
    return delta > 0n ? [{ description: it.description as string, quantity: milliText(delta), unitPrice: paiseToString(it.rate_minor as bigint), taxCode: w.tax_code as string, unit: (it.unit as string | null) ?? undefined }] : [];
  });
  if (!lines.length) throw new LedgerError('nothing_new', 'no new work was measured since the last bill');
  const seq = ((await c.query(`SELECT COALESCE(MAX(seq), 0) AS n FROM ra_bills WHERE work_order_id = $1`, [woId])).rows[0].n as number) + 1;
  const kind = w.side === 'PAYABLE' ? 'BILL' : 'INVOICE';
  const docId = await saveDraft(c, orgId, null, {
    kind, partyId: w.party_id as bigint, date: o.date, projectId: w.project_id as bigint, memo: `${w.title}: RA bill ${seq}`,
    supplierRef: kind === 'BILL' ? `WO${woId}-RA${seq}` : undefined, projectCategory: kind === 'BILL' ? 'Contractors' : undefined, lines
  }, actor);
  await issueDocument(c, orgId, kind, docId, actor);
  const doc = (await c.query(`SELECT subtotal_minor FROM documents WHERE id = $1`, [docId])).rows[0];
  const hold = ((doc.subtotal_minor as bigint) * BigInt(w.retention_bp as number)) / 10000n;
  if (hold > 0n) await setRetention(c, orgId, docId, hold, actor);
  const ra = (await c.query(`INSERT INTO ra_bills (organization_id, work_order_id, seq, bill_date, document_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [orgId, woId, seq, o.date, docId])).rows[0];
  for (const it of items) await c.query(`INSERT INTO ra_bill_lines (organization_id, ra_bill_id, item_id, cum_qty_milli) VALUES ($1, $2, $3, $4)`, [orgId, ra.id, it.id, now.get(String(it.id)) ?? 0n]);
  await audit(c, orgId, { actor, action: 'work_order.ra_bill', entityType: 'work_order', entityId: woId, detail: { seq, documentId: String(docId), retention: String(hold) } });
  return { id: docId, seq, kind };
};

/** Each work order with its items (agreed, measured to date, value done) and its RA bills. */
export const listWorkOrders = async (c: Db, projectId: bigint) => {
  const orders = (await c.query(
    `SELECT w.id, w.title, w.side, w.party_id, p.name AS party_name, w.tax_code, w.retention_bp FROM work_orders w JOIN parties p ON p.id = w.party_id WHERE w.project_id = $1 ORDER BY w.id`, [projectId])).rows;
  const out = [];
  for (const w of orders) {
    const cum = await certified(c, w.id as bigint);
    const items = (await c.query(`SELECT id, seq, description, unit, qty_milli, rate_minor FROM work_order_items WHERE work_order_id = $1 ORDER BY seq`, [w.id])).rows
      .map((it) => { const done = cum.get(String(it.id)) ?? 0n; return { ...it, done_milli: done, done_minor: (done * (it.rate_minor as bigint)) / 1000n, total_minor: ((it.qty_milli as bigint) * (it.rate_minor as bigint)) / 1000n }; });
    const bills = (await c.query(
      `SELECT b.id, b.seq, b.bill_date::text AS bill_date, b.document_id, d.number, d.status, d.subtotal_minor, d.total_minor, d.balance_minor, d.retention_minor FROM ra_bills b JOIN documents d ON d.id = b.document_id WHERE b.work_order_id = $1 ORDER BY b.seq`, [w.id])).rows;
    out.push({ ...w, items, bills, contract_minor: items.reduce((a, i) => a + (i.total_minor as bigint), 0n), done_minor: items.reduce((a, i) => a + (i.done_minor as bigint), 0n) });
  }
  return out;
};
