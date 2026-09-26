/*
 * Raw printer output (ESC/POS) for receipts, kitchen tickets and a test page. The browser fetches these and
 * hands them to the print agent on the till computer; the server never talks to a printer itself.
 */
import pool from '../config/database.js';
import { COLS, drawerBytes, kotSlips, receiptBytes, testPage } from '../modules/escpos.js';
import * as invoices from './invoices.controller.js';
import * as kitchen from './kitchen.controller.js';

/* Run an existing handler and keep what it answers, so a receipt is built from exactly the data the screen shows. */
const capture = async (handler, req) => {
  const out = { status: 200, body: null };
  const res = { status(code) { out.status = code; return res; }, json(body) { out.body = body; return res; }, set() { return res; } };
  await handler(req, res);
  return out;
};

const width = async (req) => {
  const asked = Number(req.query.cols);
  if ([32, 48].includes(asked)) return asked;
  const row = (await pool.query(`SELECT receipt_settings FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  return COLS[Number(row?.receipt_settings?.paper_width)] ?? 48;
};

const b64 = (bytes) => bytes.toString('base64');

/* GET /api/invoices/:id/escpos?cols=&drawer=1 */
export const receipt = async (req, res) => {
  const got = await capture(invoices.get, req);
  if (got.status !== 200) return res.status(got.status).json(got.body);
  const business = (await pool.query(
    `SELECT name, gstin, address, city, phone, gst_enabled, upi_vpa, receipt_settings FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  const bytes = receiptBytes({ business, settings: business.receipt_settings || {}, invoice: got.body.data },
    { cols: await width(req), drawer: req.query.drawer === '1' });
  res.json({ success: true, data: { data: b64(bytes), bytes: bytes.length } });
};

/* GET /api/kitchen/kots/:id/escpos?cols= — one job per kitchen station */
export const kot = async (req, res) => {
  const got = await capture(kitchen.printableKot, req);
  if (got.status !== 200) return res.status(got.status).json(got.body);
  const slips = kotSlips(got.body.data, { cols: await width(req) });
  res.json({ success: true, data: { slips: slips.map((s) => ({ station: s.station, station_id: s.station_id, data: b64(s.bytes) })) } });
};

/* GET /api/print/test?cols=&drawer=1 */
export const test = async (req, res) => {
  const bytes = testPage({ cols: await width(req), drawer: req.query.drawer === '1' });
  res.json({ success: true, data: { data: b64(bytes), bytes: bytes.length } });
};

/* GET /api/print/drawer — just the cash-drawer kick */
export const drawer = (_req, res) => {
  res.json({ success: true, data: { data: b64(drawerBytes()) } });
};
