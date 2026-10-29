/* Reading a CSV file into rows, and turning its columns into what the import API takes. Nothing here talks to the server. */
import { UNITS } from './lib.js';

/** CSV text to an array of rows of cells. Handles quoted cells, doubled quotes, commas and line breaks inside quotes, a leading BOM, and CRLF. */
export const parseCsv = (text) => {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i += 1; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
/** Rows with a header line to objects keyed by the field each header means (headers are matched ignoring case, spaces and punctuation). */
export const toRecords = (grid, aliases) => {
  const [head = [], ...body] = grid;
  const map = head.map((h) => Object.entries(aliases).find(([, names]) => names.includes(norm(h)))?.[0] ?? null);
  return { unknown: head.filter((_, i) => !map[i]).map((h) => h.trim()).filter(Boolean), records: body.map((cells) => Object.fromEntries(map.map((k, i) => [k, (cells[i] ?? '').trim()]).filter(([k, v]) => k && v !== ''))) };
};

export const PARTY_ALIASES = {
  name: ['name', 'partyname', 'customername', 'vendorname', 'businessname', 'company'], gstin: ['gstin', 'gst', 'gstno', 'gstnumber'], pan: ['pan'], stateCode: ['state', 'statecode'],
  phone: ['phone', 'mobile', 'phoneno', 'mobileno', 'contact'], email: ['email', 'emailid'], creditDays: ['creditdays', 'daystopay', 'paymentterms', 'credit'], kind: ['type', 'kind', 'partytype']
};
export const ITEM_ALIASES = {
  sku: ['code', 'sku', 'itemcode'], name: ['name', 'itemname', 'item', 'product', 'productname'], kind: ['type', 'kind'], hsnSac: ['hsn', 'sac', 'hsnsac', 'hsncode', 'saccode'], unit: ['unit', 'uom', 'uqc'],
  taxCode: ['gst', 'gstrate', 'tax', 'taxrate', 'taxcode', 'gstpercent'], salePrice: ['sellingprice', 'saleprice', 'price', 'rate', 'mrp'], purchasePrice: ['buyingprice', 'purchaseprice', 'costprice', 'cost']
};

const money = (v) => String(v).replace(/[₹,\s]/g, '');

/** One party record to the API's row, with a problem message when something in it cannot be understood (the row is then not sent). */
export const partyRow = (r, defaultKind, states) => {
  const kind = /^v/i.test(r.kind || '') ? 'VENDOR' : /^b/i.test(r.kind || '') ? 'BOTH' : /^c/i.test(r.kind || '') ? 'CUSTOMER' : defaultKind;
  let stateCode; let problem;
  if (r.stateCode) {
    stateCode = /^\d{1,2}$/.test(r.stateCode) ? r.stateCode.padStart(2, '0') : Object.entries(states).find(([, n]) => n.toLowerCase() === r.stateCode.toLowerCase())?.[0]?.toString().padStart(2, '0');
    if (!stateCode) problem = `"${r.stateCode}" is not a state name or GST state code`;
  }
  if (r.creditDays && !/^\d+$/.test(r.creditDays)) problem = `"${r.creditDays}" is not a number of days`;
  return { problem, row: { kind, name: r.name || '', ...(r.gstin && { gstin: r.gstin.toUpperCase().replace(/\s/g, '') }), ...(r.pan && { pan: r.pan.toUpperCase() }), ...(stateCode && { stateCode }),
    ...(r.phone && { phone: r.phone.slice(0, 20) }), ...(r.email && { email: r.email }), ...(/^\d+$/.test(r.creditDays || '') && { creditDays: Number(r.creditDays) }) } };
};

/** One item record to the API's row. A unit may be a code (KGS) or a label (Kg); GST may be a code (GST18) or a number (18, 18%). */
export const itemRow = (r) => {
  const unit = r.unit && UNITS.find(([c, n]) => c === r.unit.toUpperCase() || n.toLowerCase() === r.unit.toLowerCase())?.[0];
  const pct = /^(\d+(\.\d+)?)\s*%?$/.exec(r.taxCode || '');
  const taxCode = r.taxCode && (pct ? `GST${Number(pct[1])}` : r.taxCode.toUpperCase());
  const bad = (v) => v && !/^\d{1,13}(\.\d{1,2})?$/.test(money(v));
  const problem = r.unit && !unit ? `"${r.unit}" is not a unit we know (use Nos, Kg, Litre, Box...)` : bad(r.salePrice) ? `"${r.salePrice}" is not a price` : bad(r.purchasePrice) ? `"${r.purchasePrice}" is not a price` : undefined;
  return { problem, row: { sku: r.sku || '', name: r.name || '', ...(/^s/i.test(r.kind || '') && { kind: 'SERVICE' }), ...(r.hsnSac && { hsnSac: r.hsnSac.slice(0, 12) }), ...(unit && { unit }), ...(taxCode && { taxCode }),
    ...(r.salePrice && !bad(r.salePrice) && { salePrice: money(r.salePrice) }), ...(r.purchasePrice && !bad(r.purchasePrice) && { purchasePrice: money(r.purchasePrice) }) } };
};

export const download = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click(); URL.revokeObjectURL(url);
};
