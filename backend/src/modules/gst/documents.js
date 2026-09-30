/*
 * The two documents the government portals want per invoice: the e-invoice (sent to the IRP, which returns the IRN)
 * and the e-way bill (for moving goods worth more than Rs 50,000). FlowXP prepares the JSON from the invoice and
 * lists anything missing; a person uploads it on the portal and records the number it returns.
 *
 * E-invoicing applies to businesses above a turnover limit and to B2B, export and similar supplies, not to
 * ordinary sales to customers without a GSTIN; E-way bills are for goods, not services (HSN, not SAC).
 */
import { gstinState, placeOfSupply, stateCode, uqc, ddmmyyyy, rs } from './states.js';

const pin = (v) => { const s = String(v ?? '').replace(/\D/g, ''); return /^[1-9]\d{5}$/.test(s) ? Number(s) : null; };
const text = (s, max) => String(s ?? '').trim().slice(0, max);

/** Invoices with everything the documents need, in one shape. */
export const loadInvoices = async (db, businessId, { ids = null, from = null, to = null, gstin = null }) => {
  const rows = (await db.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date::text AS date, i.total_paise, i.subtotal_paise, i.discount_paise, i.round_off_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
            i.irn, i.irn_ack_no, i.irn_ack_date::text AS irn_ack_date, i.eway_bill_no, i.eway_bill_date::text AS eway_bill_date,
            b.name AS business_name, b.gstin AS business_gstin, b.address AS business_address, b.city AS business_city, b.state AS business_state, b.postal_code AS business_pin,
            br.name AS outlet_name, br.gstin AS outlet_gstin, br.address AS outlet_address, br.city AS outlet_city, br.state AS outlet_state, br.pincode AS outlet_pin,
            cu.name AS buyer_name, cu.gstin AS buyer_gstin, cu.state AS buyer_state, cu.address AS buyer_address, cu.pincode AS buyer_pin
     FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED'
       AND ($2::int[] IS NULL OR i.invoice_id = ANY($2::int[]))
       AND ($3::date IS NULL OR i.invoice_date >= $3::date) AND ($4::date IS NULL OR i.invoice_date <= $4::date)
       AND ($5::text IS NULL OR COALESCE(br.gstin, b.gstin) = $5)
     ORDER BY i.invoice_date, i.invoice_id`, [businessId, ids, from, to, gstin])).rows;
  if (!rows.length) return [];
  const lines = (await db.query(
    `SELECT ii.invoice_id, ii.item_id, ii.description, ii.quantity, ii.unit_price_paise, ii.discount_paise, ii.tax_rate, ii.tax_amount_paise, ii.line_total_paise, p.hsn_sac, p.unit
     FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id WHERE ii.invoice_id = ANY($1::int[]) ORDER BY ii.item_id`, [rows.map((r) => r.invoice_id)])).rows;
  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.invoice_id === r.invoice_id) }));
};

const seller = (r) => ({
  gstin: (r.outlet_gstin || r.business_gstin || '').toUpperCase(),
  name: r.business_name, address: r.outlet_address || r.business_address, place: r.outlet_city || r.business_city,
  pin: pin(r.outlet_pin || r.business_pin), state: stateCode(r.outlet_state || r.business_state)
});
const buyer = (r) => {
  const gstin = String(r.buyer_gstin ?? '').trim().toUpperCase();
  return { gstin: gstinState(gstin) ? gstin : null, name: r.buyer_name, address: r.buyer_address, pin: pin(r.buyer_pin), state: placeOfSupply(gstin, r.buyer_state) };
};

/** What is missing for this invoice to go on the portals. */
const missing = (s, b, r, { needBuyerGstin }) => {
  const e = [];
  if (!gstinState(s.gstin)) e.push('Your GSTIN (Business settings, or the outlet\'s own)');
  if (!s.address) e.push('Your address'); if (!s.place) e.push('Your city'); if (!s.pin) e.push('Your 6-digit pincode (Business settings postal code, or the outlet\'s)'); if (!s.state) e.push('Your state');
  if (needBuyerGstin && !b.gstin) e.push('The customer\'s GSTIN');
  if (!b.name) e.push('The customer'); if (!b.address) e.push('The customer\'s address'); if (!b.pin) e.push('The customer\'s 6-digit pincode'); if (!b.state) e.push('The customer\'s state');
  if (r.lines.some((l) => !l.hsn_sac)) e.push('An HSN/SAC code on every product sold');
  return e;
};

/* ── e-invoice (IRP schema 1.1) ─────────────────────────────────────────── */

export const buildEInvoice = (r) => {
  const s = seller(r); const b = buyer(r);
  const errors = missing(s, b, r, { needBuyerGstin: true });
  const warnings = [];
  if (r.irn) warnings.push({ code: 'HAS_IRN', message: `This invoice already has an IRN (${r.irn}).` });
  const inter = Number(r.igst_paise) > 0;
  const items = r.lines.map((l, i) => {
    const gross = Math.round(Number(l.quantity) * Number(l.unit_price_paise));
    const taxable = Number(l.line_total_paise) - Number(l.tax_amount_paise);
    const half = Math.floor(Number(l.tax_amount_paise) / 2);
    return {
      SlNo: String(i + 1), PrdDesc: text(l.description, 300), IsServc: String(l.hsn_sac ?? '').startsWith('99') ? 'Y' : 'N', HsnCd: text(l.hsn_sac, 8),
      Qty: Number(l.quantity), Unit: uqc(l.unit), UnitPrice: rs(l.unit_price_paise), TotAmt: rs(gross), Discount: rs(l.discount_paise), AssAmt: rs(taxable), GstRt: Number(l.tax_rate),
      IgstAmt: inter ? rs(l.tax_amount_paise) : 0, CgstAmt: inter ? 0 : rs(half), SgstAmt: inter ? 0 : rs(Number(l.tax_amount_paise) - half), CesRt: 0, CesAmt: 0, TotItemVal: rs(l.line_total_paise)
    };
  });
  const itemsTotal = r.lines.reduce((n, l) => n + Number(l.line_total_paise), 0);
  const expected = itemsTotal - Number(r.discount_paise) + Number(r.round_off_paise);
  if (expected !== Number(r.total_paise)) warnings.push({ code: 'TOTAL_MISMATCH', message: 'The invoice total does not equal its items less the bill discount plus round-off, so the portal may reject it.' });
  if (Number(r.discount_paise) > 0) warnings.push({ code: 'BILL_DISCOUNT', message: 'This invoice has a bill-level discount, coupon or points. The IRP checks the discount against the item values; your accountant should confirm how it should be shown.' });

  const json = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: r.invoice_number, Dt: ddmmyyyy(r.date, '/') },
    SellerDtls: { Gstin: s.gstin, LglNm: text(s.name, 100), Addr1: text(s.address, 100), Loc: text(s.place, 50), Pin: s.pin, Stcd: s.state },
    BuyerDtls: { Gstin: b.gstin, LglNm: text(b.name, 100), Pos: b.state, Addr1: text(b.address, 100), Loc: text(r.buyer_state, 50) || text(b.address, 50), Pin: b.pin, Stcd: b.state },
    ItemList: items,
    ValDtls: {
      AssVal: rs(r.lines.reduce((n, l) => n + Number(l.line_total_paise) - Number(l.tax_amount_paise), 0)),
      CgstVal: rs(inter ? 0 : r.cgst_paise), SgstVal: rs(inter ? 0 : r.sgst_paise), IgstVal: rs(inter ? r.igst_paise : 0), CesVal: 0,
      Discount: rs(r.discount_paise), OthChrg: 0, RndOffAmt: rs(r.round_off_paise), TotInvVal: rs(r.total_paise)
    }
  };
  return { invoice_id: r.invoice_id, invoice_number: r.invoice_number, json, errors, warnings, irn: r.irn ?? null };
};

/* ── e-way bill (bulk upload format) ────────────────────────────────────── */

const MODES = { road: 1, rail: 2, air: 3, ship: 4 };
export const EWAY_LIMIT_RUPEES = 50000;

/** `transport`: { mode: road|rail|air|ship, distance_km, vehicle_no?, transporter_id?, transporter_name?, doc_no?, doc_date? } */
export const buildEWayBill = (r, transport = {}) => {
  const s = seller(r); const b = buyer(r);
  const errors = missing(s, b, r, { needBuyerGstin: false }).filter((m) => !/customer's GSTIN/.test(m));
  const warnings = [];
  const mode = MODES[String(transport.mode ?? 'road').toLowerCase()];
  if (!mode) errors.push('The transport mode (road, rail, air or ship)');
  const distance = Number(transport.distance_km);
  if (!(Number.isFinite(distance) && distance >= 0 && distance <= 4000)) errors.push('The distance in km (0 to 4000)');
  if (mode === 1 && !transport.vehicle_no && !transport.transporter_id) errors.push('The vehicle number, or the transporter\'s ID');
  if (r.lines.some((l) => String(l.hsn_sac ?? '').startsWith('99'))) errors.push('Only goods need an e-way bill; this invoice has a service (SAC 99…)');
  const value = Number(r.total_paise);
  if (value < EWAY_LIMIT_RUPEES * 100) warnings.push({ code: 'BELOW_LIMIT', message: `The invoice is under Rs ${EWAY_LIMIT_RUPEES.toLocaleString('en-IN')}, so an e-way bill is normally not required.` });
  if (r.eway_bill_no) warnings.push({ code: 'HAS_EWB', message: `This invoice already has e-way bill ${r.eway_bill_no}.` });
  const inter = Number(r.igst_paise) > 0;
  const rate = (l) => Number(l.tax_rate);

  const json = {
    version: '1.0.0621',
    billLists: [{
      userGstin: s.gstin, supplyType: 'O', subSupplyType: 1, docType: 'INV', docNo: r.invoice_number, docDate: ddmmyyyy(r.date, '/'),
      fromGstin: s.gstin, fromTrdName: text(s.name, 100), fromAddr1: text(s.address, 120), fromPlace: text(s.place, 50), fromPincode: s.pin, fromStateCode: Number(s.state), actualFromStateCode: Number(s.state),
      toGstin: b.gstin || 'URP', toTrdName: text(b.name, 100), toAddr1: text(b.address, 120), toPlace: text(r.buyer_state, 50) || text(b.address, 50), toPincode: b.pin, toStateCode: Number(b.state), actualToStateCode: Number(b.state),
      transactionType: 1,
      totalValue: rs(r.lines.reduce((n, l) => n + Number(l.line_total_paise) - Number(l.tax_amount_paise), 0)),
      cgstValue: rs(inter ? 0 : r.cgst_paise), sgstValue: rs(inter ? 0 : r.sgst_paise), igstValue: rs(inter ? r.igst_paise : 0), cessValue: 0, totInvValue: rs(r.total_paise),
      transporterId: transport.transporter_id ? String(transport.transporter_id).toUpperCase() : '', transporterName: text(transport.transporter_name, 100),
      transDocNo: text(transport.doc_no, 15), transMode: String(mode ?? ''), transDistance: String(Math.round(distance || 0)), transDocDate: transport.doc_date ? ddmmyyyy(transport.doc_date, '/') : '',
      vehicleNo: text(transport.vehicle_no, 20).replace(/\s+/g, '').toUpperCase(), vehicleType: 'R',
      itemList: r.lines.map((l) => ({
        productName: text(l.description, 100), productDesc: text(l.description, 100), hsnCode: Number(String(l.hsn_sac ?? '').replace(/\D/g, '')) || 0, quantity: Number(l.quantity), qtyUnit: uqc(l.unit),
        taxableAmount: rs(Number(l.line_total_paise) - Number(l.tax_amount_paise)), sgstRate: inter ? 0 : rate(l) / 2, cgstRate: inter ? 0 : rate(l) / 2, igstRate: inter ? rate(l) : 0, cessRate: 0
      }))
    }]
  };
  return { invoice_id: r.invoice_id, invoice_number: r.invoice_number, json, errors, warnings, eway_bill_no: r.eway_bill_no ?? null };
};
