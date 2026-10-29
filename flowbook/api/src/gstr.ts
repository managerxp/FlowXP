import type { Db } from './db.ts';
import { validGstin } from './gst.ts';

/* GSTR-1 and GSTR-3B drafts, worked out from issued documents. The file layout follows the offline-utility JSON that the
   MIT-licensed Free-GST-Billing-Software writes (https://github.com/IamRamgarhia/Free-GST-Billing-Software). It is a
   draft to check, not a filed return: it has not been uploaded to the GST portal, and `problems` lists what the portal is known to reject. */

const RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
const INUM = /^[A-Za-z0-9/-]{1,16}$/;
const rs = (paise: bigint | number): number => Math.round(Number(paise)) / 100;
const r2 = (n: number): number => Math.round(n * 100) / 100;
/** B2C Large: an inter-state sale to an unregistered buyer above this value is listed invoice by invoice (1 lakh from 1 Aug 2024). */
const b2clLimit = (date: string): bigint => (date >= '2024-08-01' ? 10_000_000n : 25_000_000n);

type Doc = { id: bigint; kind: string; number: string; status: string; issue_date: string; inter_state: boolean; place_of_supply: string | null; total_minor: bigint; round_off_minor: bigint; gstin: string | null; state_code: string | null; name: string };
type Ln = { document_id: bigint; hsn_sac: string | null; description: string; unit: string | null; quantity_milli: bigint; taxable_minor: bigint; tax_rate_bp: number; tax_minor: bigint };
type Tax = { txval: number; iamt: number; camt: number; samt: number; csamt: number };
type Problem = { level: 'block' | 'warn'; message: string };
const zero = (): Tax => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
/** CGST is half and SGST the rest, exactly as the posting rule splits it, so the return agrees with the books. */
const add = (t: Tax, l: Ln, inter: boolean, sign = 1): void => {
  const half = l.tax_minor / 2n;
  t.txval += sign * rs(l.taxable_minor);
  if (inter) t.iamt += sign * rs(l.tax_minor); else { t.camt += sign * rs(half); t.samt += sign * rs(l.tax_minor - half); }
};
const fix = (t: Tax): Tax => ({ txval: r2(t.txval), iamt: r2(t.iamt), camt: r2(t.camt), samt: r2(t.samt), csamt: r2(t.csamt) });
const gstDate = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const monthEnd = (month: string): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

const load = async (c: Db, kinds: string[], month: string, statuses: string[]) => {
  const docs = (await c.query(
    `SELECT d.id, d.kind, d.number, d.status, d.issue_date::text AS issue_date, d.inter_state, d.place_of_supply, d.total_minor, d.round_off_minor, p.gstin, p.state_code, p.name
       FROM documents d JOIN parties p ON p.id = d.party_id
      WHERE d.kind = ANY($1) AND d.status = ANY($2) AND d.number IS NOT NULL AND d.issue_date BETWEEN $3::date AND $4::date ORDER BY d.number`,
    [kinds, statuses, `${month}-01`, monthEnd(month)])).rows as Doc[];
  const lines = docs.length ? (await c.query(
    `SELECT document_id, hsn_sac, description, unit, quantity_milli, taxable_minor, tax_rate_bp, tax_minor FROM document_lines WHERE document_id = ANY($1) ORDER BY document_id, line_no`,
    [docs.map((d) => d.id)])).rows as Ln[] : [];
  const byDoc = new Map<string, Ln[]>();
  for (const l of lines) byDoc.set(String(l.document_id), [...(byDoc.get(String(l.document_id)) ?? []), l]);
  return { docs, linesOf: (d: Doc) => byDoc.get(String(d.id)) ?? [] };
};

const gstinProblem = (gstin: string | null): Problem[] => (gstin && validGstin(gstin) ? [] : [{ level: 'block', message: 'Your business GSTIN is missing or not valid. Set it in Settings.' }]);

export const gstr1 = async (c: Db, orgId: bigint, month: string, opts: { hsnDigits?: number } = {}) => {
  const org = (await c.query(`SELECT gstin, state_code FROM organizations WHERE id = $1`, [orgId])).rows[0] as { gstin: string | null; state_code: string | null };
  const minHsn = opts.hsnDigits ?? 4;
  const problems: Problem[] = gstinProblem(org.gstin);
  const block = (m: string) => problems.push({ level: 'block', message: m });
  const warn = (m: string) => problems.push({ level: 'warn', message: m });

  const { docs: all, linesOf } = await load(c, ['INVOICE', 'CREDIT_NOTE'], month, ['ISSUED', 'VOID']);
  const docs = all.filter((d) => d.status === 'ISSUED');
  const badNo = docs.filter((d) => !INUM.test(d.number));
  if (badNo.length) block(`${badNo.length} document number(s) break the portal rule (up to 16 letters, digits, "-" or "/"). First: ${badNo[0]?.number}`);

  const rateMap = (d: Doc) => {
    const m = new Map<number, Tax>();
    for (const l of linesOf(d)) { const rt = l.tax_rate_bp / 100; const t = m.get(rt) ?? zero(); add(t, l, d.inter_state); m.set(rt, t); }
    return m;
  };
  const itms = (m: Map<number, Tax>, igstOnly = false) => [...m].map(([rt, t], i) => ({ num: i + 1, itm_det: { rt, ...(igstOnly ? { txval: r2(t.txval), iamt: r2(t.iamt), csamt: r2(t.csamt) } : fix(t)) } }));
  const pos = (d: Doc): string => d.place_of_supply ?? d.state_code ?? org.state_code ?? '';
  const val = (d: Doc): number => rs(d.total_minor - d.round_off_minor);

  const b2b = new Map<string, { ctin: string; inv: unknown[] }>();
  const cdnr = new Map<string, { ctin: string; nt: unknown[] }>();
  const b2cl = new Map<string, { pos: string; inv: unknown[] }>();
  const b2cs = new Map<string, { sply_ty: string; pos: string; rt: number } & Tax>();
  let creditToUnregistered = 0;
  let largeCount = 0;
  const badRates = new Set<number>();

  for (const d of docs) {
    for (const l of linesOf(d)) if (!RATES.includes(l.tax_rate_bp / 100)) badRates.add(l.tax_rate_bp / 100);
    if (d.kind === 'CREDIT_NOTE') {
      if (!d.gstin) { creditToUnregistered += 1; continue; }
      const e = cdnr.get(d.gstin) ?? { ctin: d.gstin, nt: [] };
      e.nt.push({ ntty: 'C', nt_num: d.number, nt_dt: gstDate(d.issue_date), val: val(d), pos: pos(d), rchrg: 'N', inv_typ: 'R', itms: itms(rateMap(d)) });
      cdnr.set(d.gstin, e);
    } else if (d.gstin) {
      const e = b2b.get(d.gstin) ?? { ctin: d.gstin, inv: [] };
      e.inv.push({ inum: d.number, idt: gstDate(d.issue_date), val: val(d), pos: pos(d), rchrg: 'N', inv_typ: 'R', itms: itms(rateMap(d)) });
      b2b.set(d.gstin, e);
    } else if (d.inter_state && d.total_minor > b2clLimit(d.issue_date)) {
      const e = b2cl.get(pos(d)) ?? { pos: pos(d), inv: [] };
      e.inv.push({ inum: d.number, idt: gstDate(d.issue_date), val: val(d), itms: itms(rateMap(d), true) });
      b2cl.set(pos(d), e);
      largeCount += 1;
    } else {
      for (const [rt, t] of rateMap(d)) {
        const key = `${d.inter_state ? 'INTER' : 'INTRA'}|${pos(d)}|${rt}`;
        const e = b2cs.get(key) ?? { sply_ty: d.inter_state ? 'INTER' : 'INTRA', pos: pos(d), rt, ...zero() };
        for (const k of ['txval', 'iamt', 'camt', 'samt', 'csamt'] as const) e[k] += t[k];
        b2cs.set(key, e);
      }
    }
  }
  if (badRates.size) block(`Tax rate(s) the portal does not accept: ${[...badRates].join(', ')}%. Accepted: ${RATES.join(', ')}%.`);
  if (creditToUnregistered) warn(`${creditToUnregistered} credit note(s) to customers without a GSTIN are not in this file (the portal wants them in a separate table, CDNUR, which is not built yet).`);

  // HSN summary: one row per HSN, rate and unit; credit notes take away. A line with no HSN cannot be listed.
  const hsn = new Map<string, { hsn_sc: string; desc: string; uqc: string; qty: number; rt: number } & Tax>();
  let noHsn = 0; let shortHsn = 0; let noUnit = 0;
  for (const d of docs) for (const l of linesOf(d)) {
    const code = (l.hsn_sac ?? '').trim();
    if (!code) { noHsn += 1; continue; }
    if (code.length < minHsn) shortHsn += 1;
    const uqc = code.startsWith('99') ? 'NA' : l.unit || 'OTH';
    if (uqc === 'OTH') noUnit += 1;
    const key = `${code}|${l.tax_rate_bp}|${uqc}`;
    const e = hsn.get(key) ?? { hsn_sc: code, desc: l.description.slice(0, 30), uqc, qty: 0, rt: l.tax_rate_bp / 100, ...zero() };
    const sign = d.kind === 'CREDIT_NOTE' ? -1 : 1;
    add(e, l, d.inter_state, sign);
    if (uqc !== 'NA') e.qty += sign * Number(l.quantity_milli) / 1000;
    hsn.set(key, e);
  }
  if (noHsn) warn(`${noHsn} line(s) have no HSN/SAC and are left out of the HSN summary. Table 12 needs one for every line.`);
  if (shortHsn) warn(`${shortHsn} line(s) have an HSN shorter than ${minHsn} digits. The portal may reject them.`);
  if (noUnit) warn(`${noUnit} goods line(s) have no unit, so they go under "OTH". Pick a unit on the item.`);

  // Documents issued: invoices are nature 1 and credit notes nature 5, one row per number series (the number without its trailing digits).
  const series = new Map<string, { nature: number; from: string; to: string; total: number; cancelled: number }>();
  for (const d of all) {
    const nature = d.kind === 'INVOICE' ? 1 : 5;
    const key = `${nature}|${d.number.replace(/\d+$/, '')}`;
    const e = series.get(key) ?? { nature, from: d.number, to: d.number, total: 0, cancelled: 0 };
    if (d.number < e.from) e.from = d.number;
    if (d.number > e.to) e.to = d.number;
    e.total += 1; if (d.status === 'VOID') e.cancelled += 1;
    series.set(key, e);
  }
  const natures = [...new Set([...series.values()].map((s) => s.nature))];
  const sales = docs.filter((d) => d.kind === 'INVOICE');
  const registered = sales.filter((d) => d.gstin).length;
  return {
    file: {
      gstin: org.gstin ?? '', fp: `${month.slice(5, 7)}${month.slice(0, 4)}`, gt: 0, cur_gt: 0, version: 'GST3.1.6', hash: 'hash',
      b2b: [...b2b.values()], b2cs: [...b2cs.values()].map((e) => ({ ...e, ...fix(e) })),
      ...(b2cl.size ? { b2cl: [...b2cl.values()] } : {}), ...(cdnr.size ? { cdnr: [...cdnr.values()] } : {}),
      hsn: { data: [...hsn.values()].map((e, i) => ({ num: i + 1, ...e, ...fix(e), qty: r2(e.qty) })) },
      doc_issue: { doc_det: natures.map((n) => ({ doc_num: n, docs: [...series.values()].filter((s) => s.nature === n).map((s, i) => ({ num: i + 1, from: s.from, to: s.to, totnum: s.total, cancel: s.cancelled, net_issue: s.total - s.cancelled })) })) }
    },
    counts: { invoices: sales.length, b2b: registered, b2cl: largeCount, b2cs: sales.length - registered - largeCount, creditNotes: docs.length - sales.length, cancelled: all.length - docs.length },
    problems
  };
};

/** GSTR-3B: outward supplies less credit notes, and the input tax credit on bills. Interest, late fee, reverse charge and table 3.2 (inter-state sales to unregistered buyers) are not worked out. */
export const gstr3b = async (c: Db, orgId: bigint, month: string) => {
  const org = (await c.query(`SELECT gstin FROM organizations WHERE id = $1`, [orgId])).rows[0] as { gstin: string | null };
  const out = zero(); const nil = zero(); const itc = zero();
  for (const kinds of [['INVOICE', 'CREDIT_NOTE'], ['BILL']]) {
    const { docs, linesOf } = await load(c, kinds, month, ['ISSUED']);
    for (const d of docs) for (const l of linesOf(d)) {
      const sign = d.kind === 'CREDIT_NOTE' ? -1 : 1;
      if (d.kind === 'BILL') add(itc, l, d.inter_state); else if (l.tax_rate_bp === 0) add(nil, l, false, sign); else add(out, l, d.inter_state, sign);
    }
  }
  const z = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const { txval: _taxable, ...credit } = fix(itc);
  return {
    file: {
      gstin: org.gstin ?? '', ret_period: `${month.slice(5, 7)}${month.slice(0, 4)}`, version: 'GST3.0.4', hash: 'hash',
      sup_details: { osup_det: fix(out), osup_zero: { txval: 0, ...z }, osup_nil_exmp: { txval: r2(nil.txval) }, isup_rev: { txval: 0, ...z }, osup_nongst: { txval: 0 } },
      itc_elg: { itc_avl: ['IMPG', 'IMPS', 'ISRC', 'ISD'].map((ty) => ({ ty, ...z })).concat([{ ty: 'OTH', ...credit }]), itc_inelg: [{ ty: 'RUL', ...z }, { ty: 'OTH', ...z }] },
      inward_sup: { isup_details: [{ ty: 'GST', inter: 0, intra: 0 }, { ty: 'NONGST', inter: 0, intra: 0 }] }
    },
    problems: [...gstinProblem(org.gstin), { level: 'warn' as const, message: 'Zero-rate lines are treated as nil/exempt. Imports, reverse charge, interest and late fee are not included. Check every box against your own records before filing.' }]
  };
};
