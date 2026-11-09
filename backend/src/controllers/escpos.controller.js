/*
 * Raw printer output (ESC/POS) for receipts, kitchen tickets and a test page. The browser fetches these and
 * hands them to the print agent on the till computer; the server never talks to a printer itself.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { COLS, drawerBytes, kotSlips, prebillBytes, receiptBytes, testPage } from '../modules/escpos.js';
import * as ordersCtl from './orders.controller.js';
import * as invoices from './invoices.controller.js';
import * as kitchen from './kitchen.controller.js';
import { loadFor } from './printers.controller.js';
import { pickPrinter, targetOf } from '../modules/printers.js';

/* Run an existing handler and keep what it answers, so a receipt is built from exactly the data the screen shows. */
const capture = async (handler, req) => {
  const out = { status: 200, body: null };
  const res = { status(code) { out.status = code; return res; }, json(body) { out.body = body; return res; }, set() { return res; } };
  await handler(req, res);
  return out;
};

/* where a slip goes at this outlet (Settings > Printers); null when nothing is set up and the device's own addresses apply */
const routeFor = async (req, role, stationId = null) => {
  const { printers, routing } = await loadFor(pool, req.tenant.businessId, req.tenant.branchId);
  return pickPrinter(routing, printers, role, stationId);
};

const width = async (req, printer = null) => {
  const asked = Number(req.query.cols);
  if ([32, 48].includes(asked)) return asked;
  if (printer) return COLS[printer.paper_width] ?? 48;   // the chosen printer's own paper
  const row = (await pool.query(`SELECT receipt_settings FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  return COLS[Number(row?.receipt_settings?.paper_width)] ?? 48;
};

const b64 = (bytes) => bytes.toString('base64');

/* GET /api/invoices/:id/escpos?cols=&drawer=1&upi=<rupees> — upi: print the QR for exactly that amount (the UPI payment being taken) */
export const receipt = async (req, res) => {
  const got = await capture(invoices.get, req);
  if (got.status !== 200) return res.status(got.status).json(got.body);
  const business = (await pool.query(
    `SELECT name, gstin, address, city, phone, gst_enabled, upi_vpa, receipt_settings FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  // a takeaway or delivery bill can go to its own printer
  const kind = (await pool.query(`SELECT o.order_type FROM invoices i LEFT JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_id = $1 AND i.business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0]?.order_type;
  const printer = await routeFor(req, ['TAKEAWAY', 'DELIVERY'].includes(kind) ? 'takeaway' : 'receipt');
  const bytes = receiptBytes({ business, settings: business.receipt_settings || {}, invoice: got.body.data },
    { cols: await width(req, printer), drawer: req.query.drawer === '1', upi: req.query.upi != null ? Number(req.query.upi) : null });
  res.json({ success: true, data: { data: b64(bytes), bytes: bytes.length, target: targetOf(printer), printer: printer?.name ?? null } });
};

/* GET /api/orders/:id/escpos?cols=&mark=0 — the running bill of an open order, for the guest. Printing it marks the order "bill printed" (mark=0 does not). */
export const prebill = async (req, res) => {
  const got = await capture(ordersCtl.get, req);
  if (got.status !== 200) return res.status(got.status).json(got.body);
  const order = got.body.data;
  if (['BILLED', 'CANCELLED', 'MERGED'].includes(order.status)) return res.status(400).json({ success: false, message: 'This order is already billed or cancelled' });
  const items = order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed);
  if (!items.length) return res.status(400).json({ success: false, message: 'Add an item before printing the bill' });
  const business = (await pool.query(
    `SELECT name, gstin, address, city, phone, gst_enabled, receipt_settings FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  const printer = await routeFor(req, ['TAKEAWAY', 'DELIVERY'].includes(order.order_type) ? 'takeaway' : 'receipt');
  const bytes = prebillBytes({ business, settings: business.receipt_settings || {}, order: { ...order, items }, gstOn: Boolean(business.gst_enabled) }, { cols: await width(req, printer) });
  if (req.query.mark !== '0') await pool.query(`UPDATE orders SET bill_printed_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND business_id = $2`, [order.order_id, req.tenant.businessId]);
  res.json({ success: true, data: { data: b64(bytes), bytes: bytes.length, target: targetOf(printer), printer: printer?.name ?? null } });
};

/* GET /api/kitchen/kots/:id/escpos?cols= — one job per kitchen station */
export const kot = async (req, res) => {
  const got = await capture(kitchen.printableKot, req);
  if (got.status !== 200) return res.status(got.status).json(got.body);
  const { printers, routing } = await loadFor(pool, req.tenant.businessId, req.tenant.branchId);
  // every station can have its own printer, each with its own paper width; slips for stations with none use the kitchen default
  const made = new Map();
  const slipsFor = (printer) => { const cols = [32, 48].includes(Number(req.query.cols)) ? Number(req.query.cols) : COLS[printer?.paper_width]; const k = cols ?? 'default'; if (!made.has(k)) made.set(k, kotSlips(got.body.data, { cols: cols ?? undefined })); return made.get(k); };
  const defaultCols = await width(req);
  const slips = kotSlips(got.body.data, { cols: defaultCols }).map((s) => {
    const printer = pickPrinter(routing, printers, 'kot', s.station_id);
    const own = printer && COLS[printer.paper_width] !== defaultCols ? slipsFor(printer).find((x) => x.station_id === s.station_id) : null;
    return { station: s.station, station_id: s.station_id, data: b64((own || s).bytes), target: targetOf(printer), printer: printer?.name ?? null };
  });
  res.json({ success: true, data: { slips } });
};

/* GET /api/print/test?cols=&drawer=1 */
export const test = async (req, res) => {
  // ?printer=<id> tests that printer with its own paper width; with none, the receipt printer
  let printer = null;
  if (req.query.printer) printer = (await loadFor(pool, req.tenant.businessId, req.tenant.branchId)).printers.find((p) => p.printer_id === Number(req.query.printer)) || null;
  else printer = await routeFor(req, 'receipt');
  if (req.query.printer && !printer) return res.status(404).json({ success: false, message: 'Printer not found' });
  const bytes = testPage({ cols: await width(req, printer), drawer: req.query.drawer === '1' });
  res.json({ success: true, data: { data: b64(bytes), bytes: bytes.length, target: targetOf(printer), printer: printer?.name ?? null } });
};

/* GET /api/print/drawer — just the cash-drawer kick */
export const drawer = async (req, res) => {
  recordAudit(req, { action: 'drawer.opened', resource_type: 'business', resource_id: req.tenant.businessId });   // opening it without a sale should leave a trace
  res.json({ success: true, data: { data: b64(drawerBytes()), target: targetOf(await routeFor(req, 'drawer')) } });
};
