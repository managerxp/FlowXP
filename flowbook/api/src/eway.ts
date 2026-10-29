import type { Db } from './db.ts';
import { validGstin } from './gst.ts';
import { LedgerError } from './ledger.ts';

/* E-way bill bulk-upload JSON for an issued invoice (the layout the NIC portal's "generate in bulk" tool reads, as used by the MIT-licensed
   Free-GST-Billing-Software). It is a file to upload, not a generated e-way bill, and it has not been checked on the portal. */

export type Transport = { distanceKm: number; mode?: 1 | 2 | 3 | 4; vehicleNo?: string; transporterId?: string; transporterName?: string; transDocNo?: string; transDocDate?: string };
const slash = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const rs = (paise: bigint): number => Math.round(Number(paise)) / 100;

export const ewayBill = async (c: Db, orgId: bigint, invoiceId: bigint, t: Transport) => {
  const d = (await c.query(
    `SELECT d.id, d.number, d.status, d.kind, d.issue_date::text AS date, d.inter_state, d.place_of_supply, d.subtotal_minor, d.tax_minor, d.round_off_minor, d.total_minor,
            p.gstin AS to_gstin, p.state_code AS to_state, p.address_line AS to_addr, p.city AS to_city, p.pincode AS to_pin,
            p.ship_address_line, p.ship_city, p.ship_pincode
       FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1`, [invoiceId])).rows[0];
  if (!d) throw new LedgerError('not_found', 'no such invoice');
  if (d.kind !== 'INVOICE' || d.status !== 'ISSUED') throw new LedgerError('not_sendable', 'an e-way bill file is made for an issued invoice');
  const org = (await c.query(`SELECT gstin, state_code, address_line, city, pincode FROM organizations WHERE id = $1`, [orgId])).rows[0];
  const problems: string[] = [];
  if (!org.gstin || !validGstin(org.gstin)) problems.push('your business GSTIN is missing or not valid (Settings)');
  if (!/^\d{6}$/.test(org.pincode ?? '')) problems.push('your business PIN code is missing (Settings, Business)');
  const toPin = d.ship_pincode || d.to_pin;
  if (!/^\d{6}$/.test(toPin ?? '')) problems.push('the customer\'s PIN code is missing (Customers)');
  if (!Number.isInteger(t.distanceKm) || t.distanceKm < 1) problems.push('the distance must be at least 1 km');
  if (t.vehicleNo && !/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(t.vehicleNo.replace(/[\s-]/g, '').toUpperCase())) problems.push('the vehicle number does not look right (like MH12AB1234)');
  if (problems.length) throw new LedgerError('eway_incomplete', `Cannot make the file yet: ${problems.join('; ')}.`);

  const lines = (await c.query(`SELECT description, hsn_sac, unit, quantity_milli, taxable_minor, tax_rate_bp FROM document_lines WHERE document_id = $1 ORDER BY line_no`, [invoiceId])).rows;
  const noHsn = lines.filter((l) => !l.hsn_sac).length;
  const toState = Number(d.place_of_supply ?? d.to_state ?? org.state_code);
  return {
    file: {
      version: '1.0.1221',
      billLists: [{
        userGstin: org.gstin, supplyType: 'O', subSupplyType: 1, docType: 'INV', docNo: d.number, docDate: slash(d.date),
        fromGstin: org.gstin, fromAddr1: (org.address_line ?? '').slice(0, 120), fromPlace: org.city ?? '', fromPincode: Number(org.pincode), fromStateCode: Number(org.state_code),
        toGstin: d.to_gstin ?? 'URP', toAddr1: (d.ship_address_line ?? d.to_addr ?? '').slice(0, 120), toPlace: d.ship_city ?? d.to_city ?? '', toPincode: Number(toPin), toStateCode: toState,
        totalValue: rs(d.subtotal_minor),
        cgstValue: d.inter_state ? 0 : rs(d.tax_minor / 2n), sgstValue: d.inter_state ? 0 : rs(d.tax_minor - d.tax_minor / 2n), igstValue: d.inter_state ? rs(d.tax_minor) : 0, cessValue: 0,
        totInvValue: rs(d.total_minor), transMode: t.mode ?? 1, transDistance: t.distanceKm, transporterName: t.transporterName ?? '', transporterId: t.transporterId ?? '',
        transDocNo: t.transDocNo ?? '', transDocDate: t.transDocDate ? slash(t.transDocDate) : '', vehicleNo: (t.vehicleNo ?? '').replace(/[\s-]/g, '').toUpperCase(), vehicleType: 'R',
        itemList: lines.map((l, i) => ({
          itemNo: i + 1, productName: l.description, productDesc: l.description, hsnCode: Number(l.hsn_sac) || 0, quantity: Number(l.quantity_milli) / 1000, qtyUnit: l.unit ?? 'OTH', taxableAmount: rs(l.taxable_minor),
          cgstRate: d.inter_state ? 0 : l.tax_rate_bp / 200, sgstRate: d.inter_state ? 0 : l.tax_rate_bp / 200, igstRate: d.inter_state ? l.tax_rate_bp / 100 : 0, cessRate: 0
        }))
      }]
    },
    warnings: [
      ...(noHsn ? [`${noHsn} line(s) have no HSN/SAC; the portal needs one on every line.`] : []),
      ...(d.total_minor <= 5_000_000n ? ['The invoice value is ₹50,000 or less; an e-way bill is normally not needed for it.'] : [])
    ]
  };
};
