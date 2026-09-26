/*
 * ESC/POS: the command language nearly every receipt printer speaks. These builders turn a receipt or a
 * kitchen ticket into raw bytes that the print agent (print-agent/agent.js) sends straight to the printer,
 * which is what makes printing silent (no browser dialog) and lets the same job pop the cash drawer.
 *
 * Text is plain ASCII: printers differ in code pages, and a wrong one prints garbage, so accents are
 * stripped and the rupee sign is written "Rs". A logo would need bitmap conversion and is left to the
 * browser receipt.
 */

const ESC = 0x1b; const GS = 0x1d; const LF = 0x0a;

/** Strip what a printer's default code page can't show. */
export const ascii = (value) => String(value ?? '')
  .replace(/₹/g, 'Rs ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/•/g, '*').replace(/★/g, '*')
  .replace(/[^\x20-\x7e\n]/g, '?');

export const COLS = { 58: 32, 80: 48 };

class Job {
  constructor(cols) { this.cols = cols; this.out = [0x1b, 0x40]; }   // ESC @ : reset
  raw(...bytes) { this.out.push(...bytes); return this; }
  align(where) { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where] ?? 0); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  big(on) { return this.raw(GS, 0x21, on ? 0x11 : 0x00); }
  text(s = '') { for (const b of Buffer.from(ascii(s), 'latin1')) this.out.push(b); return this; }
  line(s = '') { return this.text(s).raw(LF); }
  wrap(s, indent = 0) {
    const width = this.cols - indent; const pad = ' '.repeat(indent);
    let row = '';
    for (const word of ascii(s).split(/\s+/).filter(Boolean)) {
      if (word.length > width) { if (row) { this.line(pad + row); row = ''; } for (let i = 0; i < word.length; i += width) this.line(pad + word.slice(i, i + width)); continue; }
      if ((row + ' ' + word).trim().length > width) { this.line(pad + row); row = word; } else row = (row + ' ' + word).trim();
    }
    if (row) this.line(pad + row);
    return this;
  }
  /** "left ........ right", the right side never cut off. */
  pair(left, right) {
    const r = ascii(right); const l = ascii(left);
    const room = this.cols - r.length - 1;
    return this.line((l.length > room ? l.slice(0, Math.max(0, room)) : l).padEnd(this.cols - r.length) + r);
  }
  /** Run `fn` with the width halved: double-width text takes two columns per character. */
  half(fn) { const full = this.cols; this.cols = Math.floor(full / 2); try { fn(this); } finally { this.cols = full; } return this; }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  feed(n = 1) { return this.raw(ESC, 0x64, n); }
  cut() { return this.feed(3).raw(GS, 0x56, 0x42, 0x03); }
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
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * @param r { business, settings, invoice }  the same data the browser receipt shows (see invoices.get)
 * @param opts { cols, drawer, cut }
 */
export const receiptBytes = ({ business, settings = {}, invoice }, { cols = 48, drawer = false, cut = true } = {}) => {
  const j = new Job(cols);
  const outlet = invoice.outlet;
  const gstin = outlet?.gstin || business.gstin;
  const address = [outlet?.address || business.address, outlet?.city || business.city].filter(Boolean).join(', ');

  j.align('center').bold(true).big(true).half(() => j.wrap(business.name)).big(false).bold(false);
  if (outlet?.name) j.bold(true).line(outlet.name).bold(false);
  if (address) j.wrap(address);
  if (outlet?.phone || business.phone) j.line(`Ph: ${outlet?.phone || business.phone}`);
  if (settings.show_gstin !== false && business.gst_enabled && gstin) j.line(`GSTIN: ${gstin}`);
  j.align('left').rule();

  j.pair(`Bill ${invoice.invoice_number}`, String(invoice.invoice_date ?? '').slice(0, 10));
  j.pair(stamp(invoice.created_at), invoice.table_name ? `Table ${invoice.table_name}` : '');
  if (invoice.cashier) j.line(`Served by ${invoice.cashier}`);
  if (invoice.customer_name) j.wrap(`Guest: ${invoice.customer_name}`);
  if (invoice.status === 'CANCELLED') j.align('center').bold(true).line('*** CANCELLED ***').bold(false).align('left');
  j.rule();

  j.bold(true).pair('Item', 'Amount').bold(false);
  for (const i of invoice.items) {
    j.wrap(i.description);
    j.pair(`  ${i.quantity} x ${money(i.unit_price)}`, money(i.line_total));
  }
  j.rule();

  j.pair('Subtotal', money(invoice.subtotal));
  for (const [label, v] of [['CGST', invoice.cgst], ['SGST', invoice.sgst], ['IGST', invoice.igst]]) if (v > 0) j.pair(label, money(v));
  const hand = invoice.discount - invoice.coupon_discount;
  if (hand > 0) j.pair('Discount', `-${money(hand)}`);
  if (invoice.coupon_discount > 0) j.pair(`Coupon ${invoice.coupon_code}`, `-${money(invoice.coupon_discount)}`);
  if (invoice.loyalty_discount > 0) j.pair('Loyalty reward', `-${money(invoice.loyalty_discount)}`);
  if (invoice.points_discount > 0) j.pair(`Points used (${invoice.points_redeemed})`, `-${money(invoice.points_discount)}`);
  if (invoice.round_off) j.pair('Round off', `${invoice.round_off > 0 ? '+' : '-'}${money(Math.abs(invoice.round_off))}`);
  j.rule();
  j.bold(true).big(true).half(() => j.pair('TOTAL', money(invoice.total))).big(false).bold(false);
  for (const p of invoice.payments || []) j.pair(`Paid (${String(p.method).replace('_', ' ')})`, money(p.amount));
  if (invoice.refunded > 0) j.pair('Refunded', `-${money(invoice.refunded)}`);
  const due = invoice.status === 'ISSUED' && invoice.balance_due > 0;
  if (due) j.bold(true).pair('BALANCE DUE', money(invoice.balance_due)).bold(false);

  if (due && business.upi_vpa && settings.show_upi_qr !== false) {
    const upi = `upi://pay?pa=${encodeURIComponent(business.upi_vpa)}&pn=${encodeURIComponent(business.name)}&am=${money(invoice.balance_due)}&cu=INR&tn=${encodeURIComponent(invoice.invoice_number)}`;
    j.align('center').feed(1).qr(upi, 5).line('Scan to pay the balance').align('left');
  }
  if (settings.show_loyalty !== false && invoice.loyalty_message) j.rule().align('center').wrap(`* ${invoice.loyalty_message}`).align('left');
  if (invoice.points_earned > 0) j.align('center').line(`Points earned: ${invoice.points_earned}`).align('left');
  if (settings.footer) j.rule().align('center').wrap(settings.footer).align('left');

  if (drawer) j.drawer();
  return (cut ? j.cut() : j.feed(2)).bytes();
};

/** One printable slip per kitchen station: [{ station, bytes }]. */
export const kotSlips = (kot, { cols = 48, drawer = false } = {}) => {
  const where = kot.order_type === 'DINE_IN' ? (kot.table_name ? `TABLE ${kot.table_name}` : 'DINE-IN') : kot.platform ? `${kot.platform} DELIVERY` : kot.order_type;
  return kot.stations.map((slip) => {
    const j = new Job(cols);
    j.align('center').bold(true).big(true).half(() => j.wrap(kot.kot_number)).big(false).line(where);
    if (kot.priority === 'RUSH') j.big(true).line('** RUSH **').big(false);
    j.bold(false).line(`${kot.order_number}${kot.outlet ? ` - ${kot.outlet}` : ''}`).line(stamp(kot.created_at)).align('left');
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
