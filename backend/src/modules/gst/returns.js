/*
 * GST returns from what FlowXP already recorded: GSTR-1 (the outward supplies file) and the GSTR-3B figures.
 *
 * Everything is worked out line by line, in paise, the way billing worked it out, so the totals here equal the GST
 * report for the same dates. Each GSTIN files on its own, so a return covers the invoices of the outlets whose GSTIN
 * (their own, or else the business's) is the one asked for.
 *
 * What the return needs and FlowXP cannot know is reported as a warning (a B2B customer's GSTIN missing, a product
 * with no HSN code, a state it doesn't recognise) rather than guessed.
 */
import { stateCode, gstinState, placeOfSupply, uqc, ddmmyyyy, rs } from './states.js';

export const DEFAULT_B2CL_LIMIT_RUPEES = 250000;

const isGstin = (g) => gstinState(g) != null;
const split = (taxPaise, inter) => (inter ? { igst: taxPaise, cgst: 0, sgst: 0 } : { igst: 0, cgst: Math.floor(taxPaise / 2), sgst: taxPaise - Math.floor(taxPaise / 2) });

/* ── loading ────────────────────────────────────────────────────────────── */

export const loadDocs = async (db, { businessId, gstin, from, to }) => {
  const inv = (await db.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date::text AS date, i.total_paise, i.discount_paise, i.round_off_paise, (i.igst_paise > 0) AS inter, i.branch_id,
            cu.gstin AS buyer_gstin, cu.name AS buyer_name, cu.state AS buyer_state, cu.pincode AS buyer_pincode, cu.address AS buyer_address,
            COALESCE(br.gstin, b.gstin) AS seller_gstin, COALESCE(br.state, b.state) AS seller_state,
            ii.item_id, ii.description, ii.quantity, ii.unit_price_paise, ii.discount_paise AS line_discount, ii.tax_rate, ii.tax_amount_paise, ii.line_total_paise, ii.tax_kind,
            COALESCE(ii.hsn_sac, p.hsn_sac) AS hsn_sac, p.unit
     FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.invoice_id JOIN businesses b ON b.business_id = i.business_id
     LEFT JOIN branches br ON br.branch_id = i.branch_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id LEFT JOIN products p ON p.product_id = ii.product_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) = $4
     ORDER BY i.invoice_date, i.invoice_id, ii.item_id`, [businessId, from, to, gstin])).rows;

  const notes = (await db.query(
    `SELECT c.cn_id, c.cn_number, c.cn_date::text AS date, c.total_paise, (c.igst_paise > 0) AS inter, i.invoice_number AS orig_number, i.invoice_date::text AS orig_date, i.total_paise AS orig_total,
            cu.gstin AS buyer_gstin, cu.name AS buyer_name, cu.state AS buyer_state,
            COALESCE(br.gstin, b.gstin) AS seller_gstin, COALESCE(br.state, b.state) AS seller_state,
            ci.description, ci.quantity, ci.tax_rate, ci.tax_amount_paise, ci.line_total_paise, COALESCE(ci.hsn_sac, p.hsn_sac) AS hsn_sac, p.unit,
            (SELECT x.tax_kind FROM invoice_items x WHERE x.item_id = ci.invoice_item_id) AS tax_kind
     FROM credit_notes c JOIN credit_note_items ci ON ci.cn_id = c.cn_id JOIN invoices i ON i.invoice_id = c.invoice_id JOIN businesses b ON b.business_id = c.business_id
     LEFT JOIN branches br ON br.branch_id = i.branch_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id LEFT JOIN products p ON p.product_id = ci.product_id
     WHERE c.business_id = $1 AND c.cn_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) = $4
     ORDER BY c.cn_date, c.cn_id, ci.cn_item_id`, [businessId, from, to, gstin])).rows;

  // every document number used in the period (cancelled ones too), for the document summary
  const docNumbers = (await db.query(
    `SELECT 'INV' AS kind, i.invoice_number AS number, (i.status = 'CANCELLED') AS cancelled
       FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
       WHERE i.business_id = $1 AND i.invoice_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) = $4
     UNION ALL
     SELECT 'CN', c.cn_number, FALSE
       FROM credit_notes c JOIN invoices i ON i.invoice_id = c.invoice_id JOIN businesses b ON b.business_id = c.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
       WHERE c.business_id = $1 AND c.cn_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) = $4`, [businessId, from, to, gstin])).rows;

  const others = (await db.query(
    `SELECT DISTINCT COALESCE(br.gstin, b.gstin) AS gstin FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) IS DISTINCT FROM $4`, [businessId, from, to, gstin])).rows.map((r) => r.gstin);
  return { inv, notes, docNumbers, otherGstins: others };
};

/** Lines to documents, with each line's tax split the way billing split it. */
const group = (rows, keyOf, headOf) => {
  const docs = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (!docs.has(key)) docs.set(key, { ...headOf(r), lines: [] });
    const taxable = Number(r.line_total_paise) - Number(r.tax_amount_paise);
    const inter = docs.get(key).inter;
    docs.get(key).lines.push({
      // kind: what the named GST rate said (TAXABLE, NIL, EXEMPT, NON_GST); a line billed before named rates has none
      rate: Number(r.tax_rate), kind: r.tax_kind || null, taxable, tax: Number(r.tax_amount_paise), ...split(Number(r.tax_amount_paise), inter),
      total: Number(r.line_total_paise), hsn: r.hsn_sac || null, unit: r.unit, qty: Number(r.quantity), description: r.description,
      unitPrice: r.unit_price_paise != null ? Number(r.unit_price_paise) : null, lineDiscount: r.line_discount != null ? Number(r.line_discount) : 0
    });
  }
  return [...docs.values()];
};

const head = (r) => ({
  buyerGstin: isGstin(r.buyer_gstin) ? String(r.buyer_gstin).toUpperCase() : null, rawGstin: r.buyer_gstin || null, buyerName: r.buyer_name, buyerState: r.buyer_state,
  buyerPincode: r.buyer_pincode ?? null, buyerAddress: r.buyer_address ?? null, sellerState: r.seller_state, sellerGstin: r.seller_gstin, inter: r.inter
});

export const shape = ({ inv, notes }) => ({
  invoices: group(inv, (r) => r.invoice_id, (r) => ({ id: r.invoice_id, number: r.invoice_number, date: r.date, total: Number(r.total_paise), billDiscount: Number(r.discount_paise), roundOff: Number(r.round_off_paise), ...head(r) })),
  notes: group(notes, (r) => r.cn_id, (r) => ({ id: r.cn_id, number: r.cn_number, date: r.date, total: Number(r.total_paise), origNumber: r.orig_number, origDate: r.orig_date, origTotal: Number(r.orig_total), ...head(r) }))
});

/* ── GSTR-1 ─────────────────────────────────────────────────────────────── */

const byRate = (lines) => {
  const m = new Map();
  for (const l of lines) {
    const cur = m.get(l.rate) || { rate: l.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.taxable += l.taxable; cur.igst += l.igst; cur.cgst += l.cgst; cur.sgst += l.sgst; m.set(l.rate, cur);
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate);
};
const itemsOf = (lines) => byRate(lines).map((r, i) => ({ num: i + 1, itm_det: { rt: r.rate, txval: rs(r.taxable), iamt: rs(r.igst), camt: rs(r.cgst), samt: rs(r.sgst), csamt: 0 } }));

const seriesOf = (number) => { const m = String(number).match(/^(.*?)(\d+)$/); return m ? { prefix: m[1], n: Number(m[2]) } : { prefix: String(number), n: null }; };

/** The document-issue table: per series, the first and last number, how many, how many cancelled. */
const docIssue = (docNumbers, warnings) => {
  const out = [];
  for (const [kind, num, label] of [['INV', 1, 'Invoices for outward supply'], ['CN', 5, 'Credit Note']]) {
    const bySeries = new Map();
    for (const d of docNumbers.filter((x) => x.kind === kind)) {
      const s = seriesOf(d.number);
      if (!bySeries.has(s.prefix)) bySeries.set(s.prefix, []);
      bySeries.get(s.prefix).push({ ...d, n: s.n });
    }
    const docs = [];
    let serial = 1;
    for (const [prefix, list] of bySeries) {
      const nums = list.filter((d) => d.n != null).sort((a, b) => a.n - b.n);
      if (!nums.length) continue;
      const cancelled = list.filter((d) => d.cancelled).length;
      docs.push({ num: serial++, from: nums[0].number, to: nums.at(-1).number, totnum: list.length, cancel: cancelled, net_issue: list.length - cancelled });
      const span = nums.at(-1).n - nums[0].n + 1;
      if (span !== list.length) warnings.push({ code: 'DOC_GAP', message: `${label}, series ${prefix || '(no prefix)'}: numbers ${nums[0].number} to ${nums.at(-1).number} cover ${span} numbers but only ${list.length} documents exist in this period. If some were issued in another period, ignore this; otherwise a number is missing.` });
    }
    if (docs.length) out.push({ doc_num: num, doc_typ: label, docs });
  }
  return out;
};

export const buildGstr1 = ({ data, shaped, gstin, fp, settings = {}, turnover = { current: 0, previous: 0 } }) => {
  const warnings = [];
  const limit = Math.round(Number(settings.b2cl_limit ?? DEFAULT_B2CL_LIMIT_RUPEES) * 100);
  const sellerCode = gstinState(gstin);
  const b2b = new Map(); const b2cl = new Map(); const b2cs = new Map(); const cdnr = new Map(); const cdnur = [];
  const hsn = new Map();
  let noHsn = 0; let discounted = 0; const badGstin = []; const noState = [];
  const totals = { b2b: 0, b2cl: 0, b2cs: 0, cdnr: 0, cdnur: 0 };

  const addHsn = (line, sign) => {
    if (!line.hsn) noHsn += 1;
    const key = `${line.hsn || 'NA'}|${line.rate}|${uqc(line.unit)}`;
    const cur = hsn.get(key) || { hsn: line.hsn || '', rate: line.rate, uqc: uqc(line.unit), qty: 0, val: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.qty += sign * line.qty; cur.val += sign * line.total; cur.taxable += sign * line.taxable; cur.igst += sign * line.igst; cur.cgst += sign * line.cgst; cur.sgst += sign * line.sgst;
    hsn.set(key, cur);
  };
  const addCs = (d, lines, sign) => {
    const pos = d.inter ? placeOfSupply(d.buyerGstin, d.buyerState) : sellerCode;
    if (!pos) { noState.push(d.number); }
    for (const l of lines) {
      const key = `${d.inter ? 'INTER' : 'INTRA'}|${pos ?? sellerCode}|${l.rate}`;
      const cur = b2cs.get(key) || { sply_ty: d.inter ? 'INTER' : 'INTRA', pos: pos ?? sellerCode, rate: l.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      cur.taxable += sign * l.taxable; cur.igst += sign * l.igst; cur.cgst += sign * l.cgst; cur.sgst += sign * l.sgst; b2cs.set(key, cur);
    }
  };

  /* Table 8: nil rated, exempt and non-GST supplies go here, by supply type, and not into B2B / B2C (only lines billed under a named rate of that kind). */
  const nilTable = new Map();
  const addNil = (d, l, sign) => {
    const ty = `${d.inter ? 'INTR' : 'INTRA'}${d.buyerGstin ? 'B2B' : 'B2C'}`;
    const cur = nilTable.get(ty) || { sply_ty: ty, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
    cur[l.kind === 'NIL' ? 'nil_amt' : l.kind === 'EXEMPT' ? 'expt_amt' : 'ngsup_amt'] += sign * l.taxable;
    nilTable.set(ty, cur);
  };
  const outsideTax = (l) => ['NIL', 'EXEMPT', 'NON_GST'].includes(l.kind);

  const b2clInvoices = new Set();
  for (const doc of shaped.invoices) {
    for (const l of doc.lines) addHsn(l, 1);
    for (const l of doc.lines.filter(outsideTax)) addNil(doc, l, 1);
    const d = { ...doc, lines: doc.lines.filter((l) => !outsideTax(l)) };
    if (!d.lines.length) continue;
    if (d.billDiscount > 0) discounted += 1;
    if (d.rawGstin && !d.buyerGstin) badGstin.push(d.number);
    const taxableSum = d.lines.reduce((s, l) => s + l.taxable, 0);
    if (d.buyerGstin) {
      const pos = gstinState(d.buyerGstin);
      if (!b2b.has(d.buyerGstin)) b2b.set(d.buyerGstin, []);
      b2b.get(d.buyerGstin).push({ inum: d.number, idt: ddmmyyyy(d.date), val: rs(d.total), pos, rchrg: 'N', inv_typ: 'R', itms: itemsOf(d.lines) });
      totals.b2b += taxableSum;
    } else if (d.inter && d.total > limit) {
      const pos = placeOfSupply(null, d.buyerState);
      if (!pos) noState.push(d.number);
      const key = pos ?? sellerCode;
      if (!b2cl.has(key)) b2cl.set(key, []);
      b2cl.get(key).push({ inum: d.number, idt: ddmmyyyy(d.date), val: rs(d.total), itms: itemsOf(d.lines) });
      b2clInvoices.add(d.number);
      totals.b2cl += taxableSum;
    } else {
      addCs(d, d.lines, 1);
      totals.b2cs += taxableSum;
    }
  }

  for (const note of shaped.notes) {
    for (const l of note.lines) addHsn(l, -1);
    for (const l of note.lines.filter(outsideTax)) addNil(note, l, -1);
    const n = { ...note, lines: note.lines.filter((l) => !outsideTax(l)) };
    if (!n.lines.length) continue;
    const taxableSum = n.lines.reduce((s, l) => s + l.taxable, 0);
    if (n.buyerGstin) {
      if (!cdnr.has(n.buyerGstin)) cdnr.set(n.buyerGstin, []);
      cdnr.get(n.buyerGstin).push({ ntty: 'C', nt_num: n.number, nt_dt: ddmmyyyy(n.date), inum: n.origNumber, idt: ddmmyyyy(n.origDate), val: rs(n.total), pos: gstinState(n.buyerGstin), rchrg: 'N', inv_typ: 'R', itms: itemsOf(n.lines) });
      totals.cdnr += taxableSum;
    } else if (n.inter && n.origTotal > limit) {
      cdnur.push({ typ: 'B2CL', ntty: 'C', nt_num: n.number, nt_dt: ddmmyyyy(n.date), inum: n.origNumber, idt: ddmmyyyy(n.origDate), val: rs(n.total), pos: placeOfSupply(null, n.buyerState) ?? sellerCode, itms: itemsOf(n.lines) });
      totals.cdnur += taxableSum;
    } else {
      addCs(n, n.lines, -1);                      // a return on a small B2C sale takes its share back out of the B2CS table
      totals.b2cs -= taxableSum;
    }
  }

  if (badGstin.length) warnings.push({ code: 'BAD_GSTIN', message: `${badGstin.length} invoice${badGstin.length === 1 ? ' has' : 's have'} a customer GSTIN that isn't a valid GSTIN, so ${badGstin.length === 1 ? 'it is' : 'they are'} filed as B2C: ${badGstin.slice(0, 5).join(', ')}${badGstin.length > 5 ? '…' : ''}. Correct the customer's GSTIN and export again.` });
  if (noState.length) warnings.push({ code: 'NO_STATE', message: `The place of supply can't be worked out for ${noState.length} inter-state sale${noState.length === 1 ? '' : 's'} (the customer's state is missing or not recognised): ${[...new Set(noState)].slice(0, 5).join(', ')}. They are filed under your own state until the customer's state is set.` });
  if (noHsn) warnings.push({ code: 'NO_HSN', message: `${noHsn} line${noHsn === 1 ? ' has' : 's have'} no HSN/SAC code. Add it to the product (Products) and export again; the HSN table lists them under a blank code.` });
  if (discounted) warnings.push({ code: 'BILL_DISCOUNT', message: `${discounted} invoice${discounted === 1 ? ' carries' : 's carry'} a bill-level discount, coupon or points. Taxable values here are the item values before that discount, the same as your GST report. If it was given at the time of supply, your accountant may want to reduce the taxable value.` });

  const hsnData = [...hsn.values()].filter((h) => h.taxable !== 0 || h.qty !== 0).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate).map((h, i) => ({
    num: i + 1, hsn_sc: h.hsn, desc: '', uqc: h.uqc, qty: Math.round(h.qty * 1000) / 1000, val: rs(h.val), txval: rs(h.taxable), iamt: rs(h.igst), camt: rs(h.cgst), samt: rs(h.sgst), csamt: 0, rt: h.rate
  }));

  const json = {
    gstin, fp, gt: rs(turnover.previous), cur_gt: rs(turnover.current),
    b2b: [...b2b].map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: [...b2cl].map(([pos, inv]) => ({ pos, inv })),
    b2cs: [...b2cs.values()].filter((c) => c.taxable !== 0 || c.igst !== 0 || c.cgst !== 0).map((c) => ({ sply_ty: c.sply_ty, typ: 'OE', pos: c.pos, rt: c.rate, txval: rs(c.taxable), iamt: rs(c.igst), camt: rs(c.cgst), samt: rs(c.sgst), csamt: 0 })),
    cdnr: [...cdnr].map(([ctin, nt]) => ({ ctin, nt })),
    cdnur,
    nil: { inv: [...nilTable.values()].filter((r) => r.nil_amt || r.expt_amt || r.ngsup_amt).map((r) => ({ sply_ty: r.sply_ty, nil_amt: rs(r.nil_amt), expt_amt: rs(r.expt_amt), ngsup_amt: rs(r.ngsup_amt) })) },
    hsn: { data: hsnData },
    doc_issue: { doc_det: docIssue(data.docNumbers, warnings) }
  };
  if (!json.nil.inv.length) delete json.nil;
  for (const key of ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur']) if (!json[key].length) delete json[key];
  if (!hsnData.length) delete json.hsn;
  if (!json.doc_issue.doc_det.length) delete json.doc_issue;

  const money = (k) => rs(totals[k]);
  const summary = {
    invoices: shaped.invoices.length, credit_notes: shaped.notes.length,
    b2b: { invoices: [...b2b.values()].reduce((n, l) => n + l.length, 0), customers: b2b.size, taxable_value: money('b2b') },
    b2cl: { invoices: [...b2cl.values()].reduce((n, l) => n + l.length, 0), taxable_value: money('b2cl') },
    b2cs: { rows: json.b2cs?.length ?? 0, taxable_value: money('b2cs') },
    credit_notes_registered: { notes: [...cdnr.values()].reduce((n, l) => n + l.length, 0), taxable_value: money('cdnr') },
    credit_notes_unregistered: { notes: cdnur.length, taxable_value: money('cdnur') },
    hsn_rows: hsnData.length,
    other_gstins: data.otherGstins.filter(Boolean)
  };
  if (summary.other_gstins.length) warnings.push({ code: 'OTHER_GSTIN', message: `Other outlets bill under ${summary.other_gstins.join(', ')}. Each GSTIN files its own return: choose it from the list to prepare that one.` });
  return { json, warnings, summary };
};

/* ── GSTR-3B ────────────────────────────────────────────────────────────── */

/**
 * The figures to key into GSTR-3B: outward supplies (3.1, net of credit notes), inter-state supplies to unregistered
 * people by state (3.2), and input tax credit from purchases (4).
 * Purchases are taken as bought inside your own state (CGST + SGST), because a purchase order doesn't yet record
 * the supplier's state; credit is counted only for suppliers that have a GSTIN.
 */
export const buildGstr3b = ({ shaped, purchases, debits, gstin, fp }) => {
  const z = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
  const add = (o, l, sign) => { o.taxable += sign * l.taxable; o.igst += sign * l.igst; o.cgst += sign * l.cgst; o.sgst += sign * l.sgst; };
  const taxed = z(); const nil = z(); const nonGst = z(); const inter = new Map();
  for (const [docs, sign] of [[shaped.invoices, 1], [shaped.notes, -1]]) {
    for (const d of docs) {
      for (const l of d.lines) {
        add(l.kind === 'NON_GST' ? nonGst : l.rate > 0 ? taxed : nil, l, sign);   // 3.1(e) non-GST apart from 3.1(c) nil rated and exempt
        if (d.inter && !d.buyerGstin && l.rate > 0) {
          const pos = placeOfSupply(null, d.buyerState) ?? 'unknown';
          const cur = inter.get(pos) || { taxable: 0, igst: 0 };
          cur.taxable += sign * l.taxable; cur.igst += sign * l.igst; inter.set(pos, cur);
        }
      }
    }
  }
  const itc = { eligible: 0, ineligible: 0 };
  /* Purchases on reverse charge (3.1(d)): the buyer pays the tax in cash and may claim it back (4A(3)) whether or not the supplier has a GSTIN. */
  const rcm = { taxable: 0, tax: 0 };
  for (const p of purchases) {
    if (p.reverse_charge) { rcm.taxable += Number(p.subtotal_paise); rcm.tax += Number(p.tax_paise); itc.eligible += Number(p.tax_paise); continue; }
    (isGstin(p.gstin) ? (itc.eligible += Number(p.tax_paise)) : (itc.ineligible += Number(p.tax_paise)));
  }
  for (const d of debits) if (isGstin(d.gstin)) itc.eligible -= Number(d.tax_paise);
  const half = Math.floor(itc.eligible / 2);
  const credit = { igst: 0, cgst: half, sgst: itc.eligible - half };
  const payable = { igst: Math.max(0, taxed.igst - credit.igst), cgst: Math.max(0, taxed.cgst - credit.cgst), sgst: Math.max(0, taxed.sgst - credit.sgst) };
  const fmt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rs(v)]));
  const rcmHalf = Math.floor(rcm.tax / 2);
  const rcmTax = { taxable: rcm.taxable, igst: 0, cgst: rcmHalf, sgst: rcm.tax - rcmHalf };
  return {
    gstin, period: fp,
    outward_taxable: fmt(taxed), outward_nil_or_exempt: fmt({ taxable: nil.taxable }), outward_non_gst: fmt({ taxable: nonGst.taxable }),
    inter_state_to_unregistered: [...inter].map(([pos, v]) => ({ pos, ...fmt(v) })),
    itc: { eligible: rs(itc.eligible), ineligible: rs(itc.ineligible), cgst: rs(credit.cgst), sgst: rs(credit.sgst), igst: rs(credit.igst) },
    tax_payable_in_cash: fmt(payable),
    reverse_charge_inward: fmt(rcmTax),
    total_cash_with_reverse_charge: fmt({ igst: payable.igst, cgst: payable.cgst + rcmTax.cgst, sgst: payable.sgst + rcmTax.sgst }),
    notes: ['Outward figures are net of credit notes issued in the period.', 'Input credit assumes purchases were made inside your own state and only counts suppliers that have a GSTIN, except purchases on reverse charge, which always count.', 'Set-off of credit against liability follows the portal\'s own order; check the figures before you file.']
  };
};

export { stateCode };

/* ── GSTR-9 (annual) ────────────────────────────────────────────────────── */

/**
 * The annual return's figures for a financial year, from the same documents as GSTR-1 and GSTR-3B: outward supplies on which tax is payable
 * (table 4: B2C, B2B, less credit notes), nil rated / exempt / non-GST supplies (table 5), input tax credit from purchases (table 6),
 * tax payable (table 9) and the HSN summary (table 17). Amounts are rupees. What FlowXP cannot know (tax actually paid in cash or
 * through credit, amendments made in the year's returns, late fees) is left to the accountant and listed in `notes`.
 */
export const buildGstr9 = ({ data, shaped, purchases, debits, gstin, fy }) => {
  const z = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
  const add = (o, l, sign = 1) => { o.taxable += sign * l.taxable; o.igst += sign * l.igst; o.cgst += sign * l.cgst; o.sgst += sign * l.sgst; };
  const b2c = z(); const b2b = z(); const cn = z(); const nil = { nil: 0, exempt: 0, non_gst: 0 };
  const outside = (l) => ['NIL', 'EXEMPT', 'NON_GST'].includes(l.kind);
  const toNil = (l, sign) => { nil[l.kind === 'NIL' ? 'nil' : l.kind === 'EXEMPT' ? 'exempt' : 'non_gst'] += sign * l.taxable; };
  for (const d of shaped.invoices) for (const l of d.lines) { if (outside(l)) toNil(l, 1); else add(d.buyerGstin ? b2b : b2c, l); }
  for (const n of shaped.notes) for (const l of n.lines) { if (outside(l)) toNil(l, -1); else add(cn, l); }
  const net = z(); add(net, b2c); add(net, b2b); add(net, cn, -1);
  let itc = 0; let itcNoGstin = 0; const rcm = { taxable: 0, tax: 0 };
  for (const p of purchases) {
    if (p.reverse_charge) { rcm.taxable += Number(p.subtotal_paise); rcm.tax += Number(p.tax_paise); itc += Number(p.tax_paise); continue; }
    if (isGstin(p.gstin)) itc += Number(p.tax_paise); else itcNoGstin += Number(p.tax_paise);
  }
  for (const d of debits) if (isGstin(d.gstin)) itc -= Number(d.tax_paise);
  const half = Math.floor(itc / 2);
  const hsn = buildGstr1({ data, shaped, gstin, fp: '' }).json.hsn?.data ?? [];
  const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rs(v)]));
  return {
    gstin, financial_year: fy,
    table4: { b2c: f(b2c), b2b: f(b2b), credit_notes: f(cn), total: f(net) },
    table5: { nil_rated: rs(nil.nil), exempted: rs(nil.exempt), non_gst: rs(nil.non_gst), total: rs(nil.nil + nil.exempt + nil.non_gst) },
    turnover: rs(net.taxable + nil.nil + nil.exempt + nil.non_gst),
    table6: { itc_total: rs(itc), cgst: rs(half), sgst: rs(itc - half), igst: 0, reverse_charge_inward: f({ taxable: rcm.taxable, tax: rcm.tax }), not_claimable_no_gstin: rs(itcNoGstin) },
    table9: { tax_payable: f({ igst: net.igst, cgst: net.cgst + Math.floor(rcm.tax / 2), sgst: net.sgst + (rcm.tax - Math.floor(rcm.tax / 2)) }) },
    table17_hsn: hsn,
    notes: [
      'Worked out from the bills, credit notes and purchases in FlowXP for the year. Check them against the GSTR-1 and GSTR-3B you filed: GSTR-9 is filed on the portal from those returns.',
      'Tax actually paid (in cash or from credit), amendments, refunds, demands and late fees are not known to FlowXP; your accountant fills those tables.',
      'Input credit assumes purchases were made inside your own state and counts only suppliers with a GSTIN, except purchases on reverse charge.'
    ]
  };
};
