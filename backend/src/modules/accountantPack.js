/*
 * The accountant pack: one ZIP of CSV files for a period, the books an accountant asks for at filing time: the sales register with GSTIN and tax split,
 * the purchase register (GSTR-2 style), HSN and tax-rate summaries, the profit and loss, expenses, every transaction, and what customers owe and
 * what is owed to suppliers. Each file is the same report the Reports page shows, run for the person asking, so the numbers match the screens.
 * (Excel opens CSV directly, and Tally and most accounting packages import it.)
 *
 * The ZIP is written here with Node's zlib (deflate and CRC-32) rather than a library: a ZIP is a few headers around deflated files.
 */
import zlib from 'node:zlib';
import * as reports from '../controllers/reports.controller.js';
import * as gst from '../controllers/gstReports.controller.js';
import * as profit from '../controllers/profitReports.controller.js';
import * as expenses from '../controllers/expenseReports.controller.js';
import * as ledger from '../controllers/ledgerReports.controller.js';
import * as parties from '../controllers/partyReports.controller.js';
import pool from '../config/database.js';

/* a cell: quoted when it holds a comma, quote or newline; a leading = + @ or - that is not a number is defused so a spreadsheet never runs it */
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r-]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const csv = (head, rows) => `﻿${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;   // BOM: Excel reads the rupee sign and Indian names correctly

/** A ZIP (deflate) of files: [{ name, data: Buffer|string }]. */
export const zip = (files, now = new Date()) => {
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const packed = zlib.deflateRawSync(data); const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(8, 10); head.writeUInt16LE(dosTime, 12); head.writeUInt16LE(dosDate, 14);
    head.writeUInt32LE(crc, 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
};

/* run a report controller as the asker and hand back its data */
const run = async (fn, tenant, query) => {
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; }, set() { return this; }, send() { return this; } };
  await fn({ tenant, query, params: {}, body: {}, headers: {} }, res);
  if (!res.body?.success) throw new Error(res.body?.message || 'A report could not be made');
  return res.body.data;
};

/** The pack for a period: [{ name, data }] ready to zip. */
export const buildPack = async (tenant, from, to) => {
  const q = { from, to };
  const [register, purchases, hsn, rates, pl, expenseList, txns, customers, suppliers, business] = await Promise.all([
    run(reports.gstRegister, tenant, q), run(gst.gstr2, tenant, q), run(gst.summary, tenant, { ...q, by: 'hsn', kind: 'sales' }), run(gst.rates, tenant, q), run(profit.profitLoss, tenant, q),
    run(expenses.list, tenant, q), run(ledger.transactions, tenant, q), run(parties.all, tenant, { ...q, kind: 'customers' }), run(parties.all, tenant, { ...q, kind: 'suppliers' }),
    pool.query('SELECT name, gstin FROM businesses WHERE business_id = $1', [tenant.businessId]).then((r) => r.rows[0] || {})
  ]);
  const files = [];
  const add = (name, head, rows) => files.push({ name, data: csv(head, rows) });
  add('1-sales-register.csv', ['Type', 'Number', 'Date', 'Customer', 'Customer GSTIN', 'State', 'Supply', 'Tax rate %', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total'],
    register.rows.map((r) => [r.type, r.number, r.date, r.customer, r.gstin, r.state, r.supply, r.rate, r.taxable, r.cgst, r.sgst, r.igst, r.total]));
  add('2-purchase-register.csv', ['Date', 'Our number', 'Supplier bill', 'Supplier', 'Supplier GSTIN', 'Registered', 'Tax rate %', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax'],
    purchases.rows.map((r) => [r.date, r.number, r.bill_no, r.party, r.gstin, r.registered ? 'Yes' : 'No', r.rate, r.taxable, r.cgst, r.sgst, r.igst, r.tax]));
  add('3-hsn-summary-sales.csv', ['HSN/SAC', 'Tax rate %', 'Quantity', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax', 'Total'], hsn.rows.map((r) => [r.code, r.rate, r.qty, r.taxable, r.cgst, r.sgst, r.igst, r.tax, r.total]));
  add('4-gst-by-rate.csv', ['Tax rate %', 'Sales taxable', 'Output tax', 'Purchases taxable', 'Input tax', 'Net tax'], rates.rows.map((r) => [r.rate, r.sales_taxable, r.output_tax, r.purchase_taxable, r.input_tax, r.net_tax]));
  add('5-profit-and-loss.csv', ['Line', 'Amount'], [
    ['Gross sales', pl.gross_sales], ['Discounts', -pl.discounts], ['Returns', -pl.returns], ['Net sales', pl.net_sales], ['Cost of goods', -pl.cost_of_goods], ['Gross profit', pl.gross_profit],
    ...pl.expenses.map((e) => [e.category, -e.amount]), ['Total expenses', -pl.total_expenses], ['Net profit', pl.net_profit]]);
  add('6-expenses.csv', ['Date', 'Category', 'Description', 'Paid by', 'Amount'], expenseList.rows.map((r) => [r.date, r.category, r.description, r.method, r.amount]));
  add('7-all-transactions.csv', ['Date', 'Type', 'Number', 'Party', 'Total', 'Paid', 'Balance', 'Status'], txns.rows.map((r) => [r.date, r.type, r.number, r.party, r.total, r.paid, r.balance, r.status]));
  add('8-customers-receivable.csv', ['Customer', 'Phone', 'GSTIN', 'Bills in period', 'Total in period', 'Owed now', 'Last bill'], customers.rows.map((r) => [r.name, r.phone, r.gstin, r.docs, r.total, r.due, r.last_date]));
  add('9-suppliers-payable.csv', ['Supplier', 'Phone', 'GSTIN', 'Purchases in period', 'Total in period', 'Owed now', 'Last purchase'], suppliers.rows.map((r) => [r.name, r.phone, r.gstin, r.docs, r.total, r.due, r.last_date]));
  files.unshift({ name: 'README.txt', data: [
    `${business.name || 'FlowXP'} - accountant pack`, business.gstin ? `GSTIN ${business.gstin}` : null, `Period: ${from} to ${to}`, `Made by FlowXP on ${new Date().toISOString().slice(0, 10)}`, '',
    'Amounts are in rupees. Sales and expenses are from the bills and entries recorded in FlowXP; the profit and loss is a management figure (cost of goods is the cost on record',
    'when each item was sold), not a closed set of accounts. Each file is the same report shown in FlowXP > Reports for this period.'].filter((l) => l !== null).join('\r\n') });
  return files;
};
