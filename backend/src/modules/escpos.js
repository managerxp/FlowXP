/*
 * ESC/POS: the command language nearly every receipt printer speaks. These builders turn a receipt or a
 * kitchen ticket into raw bytes that the print agent (print-agent/agent.js) sends straight to the printer,
 * which is what makes printing silent (no browser dialog) and lets the same job pop the cash drawer.
 *
 * Text is plain ASCII: printers differ in code pages, and a wrong one prints garbage, so accents are
 * stripped and the rupee sign is written "Rs". A logo would need bitmap conversion and is left to the
 * browser receipt.
 */

import { taxName } from './gst/states.js';
import { rupeesInWords } from './amountWords.js';

const ESC = 0x1b; const GS = 0x1d; const LF = 0x0a;

/** Strip what a printer's default code page can't show. */
export const ascii = (value) => String(value ?? '')
  .replace(/₹/g, 'Rs ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/[–—‑−]/g, '-').replace(/×/g, 'x').replace(/•/g, '*').replace(/★/g, '*')
  .replace(/[·∙⋅|]/g, '-').replace(/…/g, '...').replace(/[  ]/g, ' ').replace(/½/g, '1/2').replace(/°/g, 'deg')   // the middle dot in "Belt · Brown · Free Size" used to print as "?"
  .replace(/[^\x20-\x7e\n]/g, '?');

export const COLS = { 58: 32, 80: 48 };

/** A logo already turned into black and white dots by the browser: { w, h, data } where data is base64 of h rows of w/8 bytes, left dot in the top bit, 1 = black.
    w is at most 384 dots (the whole width of 58 mm paper; on 80 mm paper it is centred), h at most 200. Anything else is not printed. */
export const MAX_LOGO_W = 384; export const MAX_LOGO_H = 200;
export const validLogoBits = (b) => {
  if (!b || typeof b !== 'object') return false;
  const { w, h, data } = b;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || w > MAX_LOGO_W || w % 8 || h < 1 || h > MAX_LOGO_H || typeof data !== 'string') return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(data) && Buffer.from(data, 'base64').length === (w / 8) * h;
};

class Job {
  constructor(cols) { this.cols = cols; this.out = [0x1b, 0x40]; }   // ESC @ : reset
  raw(...bytes) { this.out.push(...bytes); return this; }
  align(where) { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where] ?? 0); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  big(on) { return this.raw(GS, 0x21, on ? 0x11 : 0x00); }
  text(s = '') { for (const b of Buffer.from(ascii(s), 'latin1')) this.out.push(b); return this; }
  line(s = '') { return this.text(s).raw(LF); }
  wrap(s, indent = 0) { const pad = ' '.repeat(indent); for (const l of this.wrapLines(s, this.cols - indent)) this.line(pad + l); return this; }
  /** Break text into rows of at most `width` characters (long words are split). */
  wrapLines(s, width) {
    const rows = []; let row = '';
    for (const word of ascii(s).split(/\s+/).filter(Boolean)) {
      if (word.length > width) { if (row) { rows.push(row); row = ''; } for (let i = 0; i < word.length; i += width) rows.push(word.slice(i, i + width)); continue; }
      if ((row + ' ' + word).trim().length > width) { rows.push(row); row = word; } else row = (row + ' ' + word).trim();
    }
    if (row) rows.push(row);
    return rows;
  }
  /** "left ........ right", the right side never cut off. */
  pair(left, right) {
    const r = ascii(right); const l = ascii(left);
    const room = this.cols - r.length - 1;
    return this.line((l.length > room ? l.slice(0, Math.max(0, room)) : l).padEnd(this.cols - r.length) + r);
  }
  /** An item-table row: optional left text, then Qty, Rate and Amount right-aligned in fixed columns (wider on 80 mm paper). */
  tableWidths() { const w = this.cols >= 48 ? [7, 9, 10] : [7, 8, 9]; return { w, leftW: this.cols - w[0] - w[1] - w[2] }; }
  table(left, qty, rate, amount) {
    const { w, leftW } = this.tableWidths();
    const fit = (s, n) => ascii(s).slice(0, n).padStart(n);
    return this.line(ascii(left).slice(0, leftW).padEnd(leftW) + fit(qty, w[0]) + fit(rate, w[1]) + fit(amount, w[2]));
  }
  /** Run `fn` with the width halved: double-width text takes two columns per character. */
  half(fn) { const full = this.cols; this.cols = Math.floor(full / 2); try { fn(this); } finally { this.cols = full; } return this; }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  feed(n = 1) { return this.raw(ESC, 0x64, n); }
  /** A black-and-white picture (GS v 0): see validLogoBits for the shape. */
  raster({ w, h, data }) {
    const wb = w / 8;
    this.raw(GS, 0x76, 0x30, 0x00, wb & 0xff, wb >> 8, h & 0xff, h >> 8);
    for (const b of Buffer.from(data, 'base64')) this.out.push(b);
    return this;
  }
  cut(feed = 3) { return this.feed(feed).raw(GS, 0x56, 0x42, 0x03); }
  /** The printer's own QR code (model 2). */
  qr(data, size = 5) {
    const bytes = [...Buffer.from(data, 'utf8')];
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
    this.raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes);
    return this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  }
  drawer() { return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa); }   // pulse pin 2 for 50 ms
  bytes() { return Buffer.from(this.out); }
}

/** Just the cash-drawer kick. */
export const drawerBytes = () => new Job(32).drawer().bytes();

const money = (n) => Number(n).toFixed(2);
/* The time on a slip is the shop's own clock. The server runs on UTC, so without a zone every printed bill was 5 hours 30 minutes behind. */
export const stamp = (iso, timeZone = 'Asia/Kolkata') => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }) : '');

/**
 * @param r { business, settings, invoice }  the same data the browser receipt shows (see invoices.get)
 * @param opts { cols, drawer, cut }
 */
/* `upi` (rupees) is an amount being collected by UPI right now: the QR is printed for exactly that, even when the receipt setting that shows the balance QR is off. */
export const receiptBytes = ({ business, settings = {}, invoice }, opts = {}) => {
  // the business's copies setting prints the whole receipt again; the drawer opens once
  const copies = Math.min(5, Math.max(1, Number(settings.copies) || 1));
  return Buffer.concat(Array.from({ length: copies }, (_, i) => oneReceipt({ business, settings, invoice }, { ...opts, drawer: opts.drawer && i === 0 })));
};

const oneReceipt = ({ business, settings = {}, invoice }, { cols = 48, drawer = false, cut = true, upi: upiAmount = null } = {}) => {
  const j = new Job(cols);
  const outlet = invoice.outlet;
  const gstin = outlet?.gstin || business.gstin;
  const address = [outlet?.address || business.address, outlet?.city || business.city].filter(Boolean).join(', ');

  if (settings.show_logo !== false && validLogoBits(settings.logo_bits)) j.align('center').raster(settings.logo_bits).line();
  j.align('center').bold(true).big(true).half(() => j.wrap(business.name)).big(false).bold(false);
  if (outlet?.name) j.bold(true).line(outlet.name).bold(false);
  if (address) j.wrap(address);
  if (settings.header_text) j.wrap(settings.header_text);
  if (settings.show_phone !== false && (outlet?.phone || business.phone)) j.line(`Ph: ${outlet?.phone || business.phone}`);
  if (settings.show_gstin !== false && business.gst_enabled && gstin) j.line(`GSTIN: ${gstin}`);
  j.align('left').rule();

  j.pair(`Bill ${invoice.invoice_number}`, String(invoice.invoice_date ?? '').slice(0, 10));
  j.pair(stamp(invoice.created_at, business.timezone || undefined), invoice.table_name ? `Table ${invoice.table_name}` : '');
  if (invoice.cashier) j.line(`Served by ${invoice.cashier}`);
  if (invoice.customer_name) j.wrap(`Guest: ${invoice.customer_name}`);
  if (invoice.status === 'CANCELLED') j.align('center').bold(true).line('*** CANCELLED ***').bold(false).align('left');
  j.rule();

  // Item table: Qty, Rate and Amount in columns. The amount is before tax when the tax lines are shown (so the rows add up to the Subtotal) and with tax when they are hidden (so they add up to the Total).
  const showTax = settings.show_tax_lines !== false;
  const qtyText = (i) => { const q = String(Number(Number(i.quantity).toFixed(3))); return q; };
  j.bold(true).table('Item', 'Qty', 'Rate', 'Amount').bold(false);
  j.rule();
  let totalQty = 0; let lineSaved = 0;
  for (const i of invoice.items) {
    const amount = showTax ? Number(i.line_total) - Number(i.tax_amount || 0) - Number(i.cess || 0) : Number(i.line_total);
    totalQty += Number(i.quantity) || 0; lineSaved += Number(i.discount) || 0;
    // The name wraps inside the left column, so it never runs under Qty / Rate / Amount; the numbers sit on its last row.
    const nameRows = j.wrapLines(i.description, j.tableWidths().leftW);
    const last = nameRows.pop() ?? '';
    for (const r of nameRows) j.line(r);
    if (i.hsn && settings.show_hsn === true) { if (last) j.line(last); j.line(`  HSN ${i.hsn}`); }
    j.table(i.hsn && settings.show_hsn === true ? '' : last, `${qtyText(i)}${i.unit && String(i.unit).length <= 3 ? ` ${i.unit}` : ''}`, money(i.unit_price), money(amount));
    if (Number(i.discount) > 0) j.pair('  Discount', `-${money(i.discount)}`);
  }
  j.rule();
  j.pair(`Items: ${invoice.items.length}`, settings.show_total_qty === false ? '' : `Total Qty: ${String(Number(totalQty.toFixed(3)))}`);

  // "Show the tax lines" off: no Subtotal and no CGST / SGST (UTGST) / IGST rows. The item amounts already include the tax, so they add up to the total.
  if (showTax) {
    j.pair('Subtotal', money(invoice.subtotal));
    for (const [label, v] of [['CGST', invoice.cgst], [taxName(outlet?.state || business.state), invoice.sgst], ['IGST', invoice.igst]]) if (v > 0) j.pair(label, money(v));
  }
  const hand = invoice.discount - invoice.coupon_discount;
  if (hand > 0) j.pair('Discount', `-${money(hand)}`);
  if (invoice.coupon_discount > 0) j.pair(`Coupon ${invoice.coupon_code}`, `-${money(invoice.coupon_discount)}`);
  if (invoice.loyalty_discount > 0) j.pair('Loyalty reward', `-${money(invoice.loyalty_discount)}`);
  if (invoice.points_discount > 0) j.pair(`Points used (${invoice.points_redeemed})`, `-${money(invoice.points_discount)}`);
  if (invoice.round_off) j.pair('Round off', `${invoice.round_off > 0 ? '+' : '-'}${money(Math.abs(invoice.round_off))}`);
  j.rule();
  j.bold(true).big(true).half(() => j.pair('TOTAL', money(invoice.total))).big(false).bold(false);
  if (settings.show_amount_words === true) j.wrap(rupeesInWords(invoice.total));
  // everything the customer was given off, in one line: discounts on the lines (promos and free loyalty items are in these) plus the bill's own discount (which already holds the coupon and points)
  const saved = lineSaved + Number(invoice.discount || 0);
  if (saved > 0) j.align('center').bold(true).line(`You saved Rs ${money(saved)}`).bold(false).align('left');
  for (const p of invoice.payments || []) j.pair(`Paid (${String(p.method).replace('_', ' ')})`, money(p.amount));
  if (invoice.refunded > 0) j.pair('Refunded', `-${money(invoice.refunded)}`);
  const due = invoice.status === 'ISSUED' && invoice.balance_due > 0;
  if (due) j.bold(true).pair('BALANCE DUE', money(invoice.balance_due)).bold(false);

  // the amount to put in the QR: what is being collected now (never more than is owed), else the whole balance when the receipt setting allows it
  const collecting = upiAmount != null && Number(upiAmount) > 0 ? Math.min(Number(upiAmount), invoice.balance_due) : null;
  if (due && business.upi_vpa && (collecting != null || settings.show_upi_qr !== false)) {
    const amount = collecting ?? invoice.balance_due;
    const upi = `upi://pay?pa=${encodeURIComponent(business.upi_vpa)}&pn=${encodeURIComponent(business.name)}&am=${money(amount)}&cu=INR&tn=${encodeURIComponent(invoice.invoice_number)}`;
    // centred, a blank line either side of the QR, and the centring is sent again before the caption (some printers drop it after printing a QR)
    j.align('center').feed(1).qr(upi, 6).feed(1).align('center').line(collecting != null ? `Scan to pay Rs.${money(amount)} by UPI` : 'Scan to pay the balance').feed(1).align('left');
  }
  if (settings.show_loyalty !== false && invoice.loyalty_message) j.rule().align('center').wrap(`* ${invoice.loyalty_message}`).align('left');
  if (invoice.points_earned > 0) j.align('center').line(`Points earned: ${invoice.points_earned}`).align('left');
  if (settings.show_terms === true && settings.terms) j.rule().wrap(`Terms: ${settings.terms}`);
  if (settings.footer) j.rule().align('center').wrap(settings.footer).align('left');

  if (drawer) j.drawer();
  const blank = Number.isInteger(settings.extra_lines) ? settings.extra_lines : 3;
  // auto-cut is on unless the business turned it off; a printer with no cutter just feeds
  return (cut && settings.auto_cut !== false ? j.cut(blank) : j.feed(Math.max(blank, 2))).bytes();
};

/** One printable slip per kitchen station: [{ station, bytes }]. */
export const kotSlips = (kot, { cols = 48, drawer = false, tz } = {}) => {
  const where = kot.order_type === 'DINE_IN' ? (kot.table_name ? `TABLE ${kot.table_name}` : 'DINE-IN') : kot.platform ? `${kot.platform} DELIVERY` : kot.order_type;
  return kot.stations.map((slip) => {
    const j = new Job(cols);
    j.align('center').bold(true).big(true).half(() => j.wrap(kot.kot_number)).big(false).line(where);
    if (kot.cancelled) j.big(true).line('** CANCELLED **').big(false).bold(true).line('DO NOT MAKE').bold(false);
    else if (kot.priority === 'RUSH') j.big(true).line('** RUSH **').big(false);
    j.bold(false).line(`${kot.order_number}${kot.outlet ? ` - ${kot.outlet}` : ''}`).line(stamp(kot.created_at, tz || undefined)).align('left');
    j.bold(true).align('center').line(`[ ${slip.name} ]`).align('left').bold(false).rule();
    for (const i of slip.items) {
      j.bold(true).wrap(`${i.quantity} x ${i.description}`).bold(false);
      if (i.combo?.length) j.wrap(i.combo.join(', '), 3);
      if (i.modifiers?.length) j.wrap(`+ ${i.modifiers.join(', ')}`, 3);
      if (i.kitchen_notes) j.bold(true).wrap(`NOTE: ${i.kitchen_notes}`, 3).bold(false);
    }
    if (kot.order_notes) j.rule().wrap(`Order note: ${kot.order_notes}`);
    if (drawer) j.drawer();
    return { station: slip.name, station_id: slip.station_id ?? null, bytes: j.cut().bytes() };
  });
};

/** A short page that proves the printer, the connection and (optionally) the drawer work. */
export const testPage = ({ cols = 48, drawer = false } = {}) => {
  const j = new Job(cols);
  j.align('center').bold(true).big(true).line('FlowXP').big(false).bold(false).line('Print test').rule().align('left');
  j.line('Rs 1,234.50   x   + - = / ( )').line('If you can read this, printing works.').line(`Paper: ${cols} columns`);
  if (drawer) j.line('The cash drawer should open now.').drawer();
  return j.feed(1).cut().bytes();
};

/**
 * The running bill of an open order, handed to the guest before it is paid. It is a copy of what the till will charge
 * (lines at their price, GST added on top where the business charges it), marked so it is not mistaken for the final bill.
 * order: { order_number, order_type, table_name, customer_name, created_at, items: [{ description, quantity, unit_price, tax_rate }] }
 */
export const prebillBytes = ({ business, settings = {}, order, gstOn = false }, { cols = 48, cut = true } = {}) => {
  const j = new Job(cols);
  j.align('center').bold(true).big(true).half(() => j.wrap(business.name)).big(false).bold(false);
  const address = [business.address, business.city].filter(Boolean).join(', ');
  if (address) j.wrap(address);
  if (business.phone) j.line(`Ph: ${business.phone}`);
  if (settings.show_gstin !== false && business.gst_enabled && business.gstin) j.line(`GSTIN: ${business.gstin}`);
  j.bold(true).line('BILL (NOT YET PAID)').bold(false).align('left').rule();
  const where = order.order_type === 'DINE_IN' ? (order.table_name ? `Table ${order.table_name}` : 'Dine-in') : order.order_type === 'DELIVERY' ? 'Delivery' : 'Takeaway';
  j.pair(`Order ${order.order_number}`, where);
  j.line(stamp(order.created_at, business.timezone || undefined));
  if (order.customer_name) j.wrap(`Guest: ${order.customer_name}`);
  j.rule().bold(true).table('Item', 'Qty', 'Rate', 'Amount').bold(false).rule();
  let subtotal = 0; let gst = 0; let qtyTotal = 0;
  for (const i of order.items) {
    const amount = Number(i.quantity) * Number(i.unit_price);
    subtotal += amount; qtyTotal += Number(i.quantity);
    if (gstOn) gst += amount * (Number(i.tax_rate || 0) / 100);
    const rows = j.wrapLines(i.description, j.tableWidths().leftW); const last = rows.pop() ?? '';
    for (const r of rows) j.line(r);
    j.table(last, String(Number(Number(i.quantity).toFixed(3))), money(i.unit_price), money(amount));
  }
  j.rule().pair(`Items: ${order.items.length}`, `Total Qty: ${String(Number(qtyTotal.toFixed(3)))}`);
  if (gstOn && gst > 0) { j.pair('Subtotal', money(subtotal)); j.pair('GST', money(gst)); }
  j.rule().bold(true).big(true).half(() => j.pair('TOTAL', money(Math.round(subtotal + gst)))).big(false).bold(false);
  j.align('center').feed(1).line('Pay at the counter. Thank you!').align('left');
  const blank = Number.isInteger(settings.extra_lines) ? settings.extra_lines : 3;
  return (cut && settings.auto_cut !== false ? j.cut(blank) : j.feed(Math.max(blank, 2))).bytes();
};
