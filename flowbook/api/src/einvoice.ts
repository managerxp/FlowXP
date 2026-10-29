import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { validGstin } from './gst.ts';
import { LedgerError } from './ledger.ts';

/* E-invoicing (India). FlowBook builds the invoice file in the layout of the IRP's published schema (version 1.1) and records what the IRP answers
   (IRN, acknowledgement number and date, signed QR). It does not talk to the IRP: you upload the file (single or the bulk tool) on the IRP portal
   or through your GSP, then enter the answer here. Nothing here has been checked against the portal. Not covered: exports and SEZ, reverse charge,
   e-commerce and transport details, and whether your turnover makes e-invoicing compulsory (that is for you and your CA). */

const slash = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const rs = (paise: bigint | number): number => Math.round(Number(paise)) / 100;
const TYPE: Record<string, 'INV' | 'CRN'> = { INVOICE: 'INV', CREDIT_NOTE: 'CRN' };

export type Built = { id: string; number: string; file: Record<string, unknown> | null; problems: string[]; warnings: string[] };

/** The IRP file for one issued invoice or credit note, with every reason it cannot be sent yet. `file` is null when the document does not qualify at all. */
export const buildEinvoice = async (c: Db, orgId: bigint, docId: bigint): Promise<Built> => {
  const d = (await c.query(
    `SELECT d.id, d.kind, d.number, d.status, d.issue_date::text AS date, d.inter_state, d.place_of_supply, d.subtotal_minor, d.tax_minor, d.round_off_minor, d.total_minor, d.currency, d.related_document_id,
            p.name AS buyer, p.gstin AS buyer_gstin, p.state_code AS buyer_state, p.address_line AS buyer_addr, p.city AS buyer_city, p.pincode AS buyer_pin,
            r.number AS prec_no, r.issue_date::text AS prec_date
       FROM documents d JOIN parties p ON p.id = d.party_id LEFT JOIN documents r ON r.id = d.related_document_id WHERE d.id = $1`, [docId])).rows[0];
  if (!d) throw new LedgerError('not_found', 'no such document');
  const out = (file: Record<string, unknown> | null, problems: string[], warnings: string[] = []): Built => ({ id: String(docId), number: d.number ?? '', file, problems, warnings });
  if (!TYPE[d.kind as string]) return out(null, ['only sales invoices and credit notes are e-invoiced']);
  if (d.status !== 'ISSUED') return out(null, ['only an issued document can be e-invoiced']);
  if (!d.buyer_gstin) return out(null, ['a sale to a customer without a GSTIN is not e-invoiced (it needs no IRN)']);
  if (d.currency && d.currency !== 'INR') return out(null, ['foreign-currency invoices (exports) are not supported yet']);

  const org = (await c.query(`SELECT name, legal_name, gstin, state_code, address_line, city, pincode FROM organizations WHERE id = $1`, [orgId])).rows[0];
  const problems: string[] = [];
  if (!org.gstin || !validGstin(org.gstin)) problems.push('your business GSTIN is missing or not valid (Settings)');
  if (!/^\d{6}$/.test(org.pincode ?? '')) problems.push('your business PIN code is missing (Settings, Business)');
  if (!org.address_line || (org.address_line as string).length < 3) problems.push('your business address is missing (Settings, Business)');
  if (!org.city || (org.city as string).length < 3) problems.push('your business city is missing (Settings, Business)');
  if (!validGstin(d.buyer_gstin)) problems.push(`the customer GSTIN ${d.buyer_gstin} is not valid`);
  if (!/^\d{6}$/.test(d.buyer_pin ?? '')) problems.push('the customer PIN code is missing (Customers)');
  if (!d.buyer_addr || (d.buyer_addr as string).length < 3) problems.push('the customer address is missing (Customers)');
  if (!d.buyer_city || (d.buyer_city as string).length < 3) problems.push('the customer city is missing (Customers)');
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/.test(d.number ?? '')) problems.push(`the number ${d.number} is not allowed (up to 16 letters, digits, / and -)`);
  if (d.kind === 'CREDIT_NOTE' && !d.prec_no) problems.push('a credit note needs the invoice it is against (choose it on the note)');

  const lines = (await c.query(
    `SELECT l.description, l.hsn_sac, l.unit, l.quantity_milli, l.discount_minor, l.taxable_minor, l.tax_rate_bp, l.tax_minor,
            COALESCE((SELECT i.kind = 'SERVICE' FROM items i WHERE i.id = l.item_id), false) AS service
       FROM document_lines l WHERE l.document_id = $1 ORDER BY l.line_no`, [docId])).rows;
  lines.forEach((l, i) => {
    if (!/^\d{4,8}$/.test(l.hsn_sac ?? '')) problems.push(`line ${i + 1} needs an HSN/SAC code of 4 to 8 digits`);
  });
  if (!lines.length) problems.push('the document has no lines');
  const stateOf = (s: string | null): string => String(s ?? '').padStart(2, '0');
  const posState = stateOf(d.place_of_supply ?? d.buyer_state ?? org.state_code);
  if (!/^\d{2}$/.test(posState) || posState === '00') problems.push('the place of supply is missing (the customer state)');

  const inter = d.inter_state as boolean;
  const items = lines.map((l, i) => {
    const qty = Number(l.quantity_milli) / 1000;
    const gross = (l.taxable_minor as bigint) + (l.discount_minor as bigint);   // before discount, tax excluded
    const tax = l.tax_minor as bigint;
    const half = tax / 2n;
    return {
      SlNo: String(i + 1), PrdDesc: String(l.description).slice(0, 300), IsServc: l.service ? 'Y' : 'N', HsnCd: l.hsn_sac ?? '', Qty: qty, Unit: l.unit ?? 'OTH',
      UnitPrice: Math.round((rs(gross) / qty) * 1000) / 1000, TotAmt: rs(gross), Discount: rs(l.discount_minor), AssAmt: rs(l.taxable_minor), GstRt: l.tax_rate_bp / 100,
      IgstAmt: inter ? rs(tax) : 0, CgstAmt: inter ? 0 : rs(half), SgstAmt: inter ? 0 : rs(tax - half), CesRt: 0, CesAmt: 0, TotItemVal: rs((l.taxable_minor as bigint) + tax)
    };
  });
  const sum = (k: 'AssAmt' | 'IgstAmt' | 'CgstAmt' | 'SgstAmt' | 'Discount'): number => items.reduce((s, x) => s + Math.round(x[k] * 100), 0) / 100;
  const val = { AssVal: sum('AssAmt'), CgstVal: sum('CgstAmt'), SgstVal: sum('SgstAmt'), IgstVal: sum('IgstAmt'), CesVal: 0, Discount: sum('Discount'), RndOffAmt: rs(d.round_off_minor), TotInvVal: rs(d.total_minor) };
  const check = Math.round((val.AssVal + val.CgstVal + val.SgstVal + val.IgstVal + val.RndOffAmt) * 100) - Number(d.total_minor);
  if (Math.abs(check) > 100) problems.push('the line figures do not add up to the invoice total; check the document before sending');

  const file = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: TYPE[d.kind as string], No: d.number, Dt: slash(d.date) },
    SellerDtls: { Gstin: org.gstin, LglNm: org.legal_name ?? org.name, Addr1: String(org.address_line ?? '').slice(0, 100), Loc: String(org.city ?? '').slice(0, 50), Pin: Number(org.pincode), Stcd: stateOf(org.state_code) },
    BuyerDtls: { Gstin: d.buyer_gstin, LglNm: d.buyer, Pos: posState, Addr1: String(d.buyer_addr ?? '').slice(0, 100), Loc: String(d.buyer_city ?? '').slice(0, 50), Pin: Number(d.buyer_pin), Stcd: stateOf(d.buyer_state ?? posState) },
    ...(d.kind === 'CREDIT_NOTE' && d.prec_no ? { PrecDocDtls: [{ InvNo: d.prec_no, InvDt: slash(d.prec_date) }] } : {}),
    ItemList: items,
    ValDtls: val
  };
  const warnings = check !== 0 && Math.abs(check) <= 100 ? [`the figures differ from the total by ${(Math.abs(check) / 100).toFixed(2)} (rounding); the IRP allows about 1 rupee`] : [];
  return out(file, problems, warnings);
};

export type EinvoiceRow = { id: string; kind: string; number: string; date: string; party: string; total_minor: bigint; state: 'REGISTERED' | 'READY' | 'NEEDS_FIXING' | 'NOT_REQUIRED'; irn: string | null; problems: string[] };

/** Every issued invoice and credit note in the dates: registered, ready to send, or what is missing. A sale to a customer without a GSTIN is not required. */
export const einvoiceList = async (c: Db, orgId: bigint, from: string, to: string): Promise<EinvoiceRow[]> => {
  const docs = (await c.query(
    `SELECT d.id, d.kind, d.number, d.issue_date::text AS date, p.name AS party, d.total_minor, p.gstin IS NULL AS no_gstin, e.irn
       FROM documents d JOIN parties p ON p.id = d.party_id LEFT JOIN einvoices e ON e.document_id = d.id AND e.status = 'GENERATED'
      WHERE d.kind IN ('INVOICE', 'CREDIT_NOTE') AND d.status = 'ISSUED' AND d.issue_date BETWEEN $1 AND $2 ORDER BY d.issue_date, d.id`, [from, to])).rows;
  const rows: EinvoiceRow[] = [];
  for (const d of docs) {
    const base = { id: String(d.id), kind: d.kind as string, number: d.number as string, date: d.date as string, party: d.party as string, total_minor: d.total_minor as bigint, irn: (d.irn as string | null) ?? null };
    if (d.irn) { rows.push({ ...base, state: 'REGISTERED', problems: [] }); continue; }
    if (d.no_gstin) { rows.push({ ...base, state: 'NOT_REQUIRED', problems: [] }); continue; }
    const b = await buildEinvoice(c, orgId, d.id as bigint);
    rows.push({ ...base, state: b.problems.length ? 'NEEDS_FIXING' : 'READY', problems: b.problems });
  }
  return rows;
};

/** The bulk-upload file: every ready document in the dates, as an array of invoices. */
export const einvoiceBulk = async (c: Db, orgId: bigint, from: string, to: string) => {
  const rows = await einvoiceList(c, orgId, from, to);
  const ready = rows.filter((r) => r.state === 'READY');
  const file = [];
  for (const r of ready) file.push((await buildEinvoice(c, orgId, BigInt(r.id))).file);
  return { file, count: ready.length, skipped: rows.filter((r) => r.state === 'NEEDS_FIXING').map((r) => ({ number: r.number, problems: r.problems })) };
};

/** Keep the IRP's answer for a document. The IRN is 64 hex characters; a document has one live IRN at a time. */
export const recordIrn = async (c: Db, orgId: bigint, docId: bigint, a: { irn: string; ackNo: string; ackDate: string; signedQr?: string }, actor: string): Promise<void> => {
  const d = (await c.query(`SELECT kind, status, number FROM documents WHERE id = $1 FOR UPDATE`, [docId])).rows[0];
  if (!d || !TYPE[d.kind as string]) throw new LedgerError('not_found', 'no such invoice or credit note');
  if (d.status !== 'ISSUED') throw new LedgerError('not_issued', 'only an issued document has an IRN');
  const irn = a.irn.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(irn)) throw new LedgerError('bad_irn', 'an IRN is 64 letters and digits (0-9, a-f); copy it from the IRP acknowledgement');
  if (Number.isNaN(Date.parse(a.ackDate))) throw new LedgerError('bad_date', 'the acknowledgement date is not a date');
  if ((await c.query(`SELECT 1 FROM einvoices WHERE document_id = $1 AND status = 'GENERATED'`, [docId])).rows.length) throw new LedgerError('has_irn', 'this document already has an IRN; cancel it first to record another');
  if ((await c.query(`SELECT 1 FROM einvoices WHERE irn = $1`, [irn])).rows.length) throw new LedgerError('irn_used', 'that IRN is already recorded on another document');
  await c.query(`INSERT INTO einvoices (organization_id, document_id, irn, ack_no, ack_date, signed_qr, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [orgId, docId, irn, a.ackNo.trim(), a.ackDate, a.signedQr?.trim() || null, actor]);
  await audit(c, orgId, { actor, action: 'einvoice.recorded', entityType: 'document', entityId: docId, detail: { number: d.number, irn } });
};

/** Note that the IRN was cancelled on the IRP (allowed there within 24 hours; reasons 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other). */
export const cancelIrn = async (c: Db, orgId: bigint, docId: bigint, reason: 1 | 2 | 3 | 4, remark: string, actor: string): Promise<void> => {
  const e = (await c.query(`SELECT id, irn FROM einvoices WHERE document_id = $1 AND status = 'GENERATED' FOR UPDATE`, [docId])).rows[0];
  if (!e) throw new LedgerError('no_irn', 'this document has no live IRN');
  await c.query(`UPDATE einvoices SET status = 'CANCELLED', cancel_reason = $2, cancel_remark = $3, cancelled_at = now() WHERE id = $1`, [e.id, reason, remark.slice(0, 100)]);
  await audit(c, orgId, { actor, action: 'einvoice.cancelled', entityType: 'document', entityId: docId, detail: { irn: e.irn, reason } });
};

export const einvoiceOf = async (c: Db, docId: bigint) =>
  (await c.query(`SELECT irn, ack_no, ack_date, signed_qr, status, cancel_reason, cancelled_at FROM einvoices WHERE document_id = $1 ORDER BY id DESC LIMIT 1`, [docId])).rows[0] ?? null;
