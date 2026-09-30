/*
 * Revenue leakage: activity that differs from this business's own normal and
 * may be costing it money.
 *
 * Every finding is phrased as "unusual" or "needs review". Nothing here says
 * why something happened or who is responsible — a discount outlier can be a
 * manager comping a regular, a refund spike can be a bad batch. The job is to
 * surface it with the evidence attached, not to reach a verdict.
 *
 * Baselines are the business's own: a person is compared with everyone else's
 * rate, a period with the one before it. Detectors are pure functions over
 * pre-aggregated rows (unit-tested); collect() runs the queries and feeds them.
 * Thresholds are constants below.
 *
 * ponytail: thresholds are global constants, not per-business settings, and
 * every run re-queries the window. Make them configurable / cache nightly when
 * a real customer needs different sensitivity or a very large history.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';

export const THRESHOLDS = {
  discount: { minBills: 20, minDiscountPaise: 50000, ratio: 2, points: 0.02, criticalExcessPaise: 500000 },
  cancelledAfterPayment: { criticalPaise: 500000 },
  cancellationPattern: { minCancelled: 5, ratio: 3 },
  refunds: { minPaise: 100000, ratio: 2, minWhenNoBaselinePaise: 200000 },
  wastage: { minIncreasePct: 40, minIncreasePaise: 30000, minNewPaise: 100000 },
  adjustments: { minPaise: 200000 },
  complimentary: { minCostPaise: 50000 }
};

const SEVERITY_ORDER = { critical: 0, warning: 1, informational: 2 };
const pct1 = (n) => Math.round(n * 1000) / 10;
const rupees = (paise) => toRupees(Math.round(paise));
const inr = (paise) => `₹${rupees(paise).toLocaleString('en-IN')}`;
const confidenceFor = (n, high, medium) => (n >= high ? 'high' : n >= medium ? 'medium' : 'low');

/* ── discounts ────────────────────────────────────────────────────────────── */
/** rows: [{ user_id, name, bills, gross_paise, discount_paise, large_bills }] — gross is before any discount. */
export const detectDiscounts = (rows, t = THRESHOLDS.discount) => {
  const totalGross = rows.reduce((s, r) => s + Number(r.gross_paise), 0);
  const totalDisc = rows.reduce((s, r) => s + Number(r.discount_paise), 0);
  const out = [];
  for (const r of rows) {
    const gross = Number(r.gross_paise); const disc = Number(r.discount_paise); const bills = Number(r.bills);
    const othersGross = totalGross - gross;
    if (bills < t.minBills || disc < t.minDiscountPaise || othersGross <= 0) continue;
    const rate = disc / gross;
    const baseline = (totalDisc - disc) / othersGross;
    if (!(rate >= baseline * t.ratio && rate >= baseline + t.points)) continue;
    const excess = disc - baseline * gross;
    out.push({
      fingerprint: `discounts:user:${r.user_id}`, category: 'discounts', type: 'discount_outlier',
      severity: excess >= t.criticalExcessPaise ? 'critical' : 'warning',
      title: 'Unusual discount activity',
      summary: `Bills handled by ${r.name || 'one team member'} carry discounts at ${pct1(rate)}% of sales, against ${pct1(baseline)}% for everyone else. ${r.large_bills} of ${bills} bills had a discount above 10%.`,
      subject: { type: 'user', id: r.user_id, name: r.name },
      metric: { label: 'Discount as % of sales', unit: '%' },
      current_value: pct1(rate), expected_value: pct1(baseline), difference: pct1(rate - baseline),
      potential_paise: Math.max(0, Math.round(excess)),
      confidence: confidenceFor(bills, 100, t.minBills),
      recommendation: 'Review the largest discounted bills below and confirm they follow your discount policy. If discounts need approval, set that rule.',
      needs: 'discount_evidence'
    });
  }
  return out;
};

/* ── cancelled after payment ──────────────────────────────────────────────── */
/** rows: [{ invoice_id, invoice_number, invoice_date, paid_paise, refunded_paise, name }] */
export const detectCancelledAfterPayment = (rows, t = THRESHOLDS.cancelledAfterPayment) => {
  const open = rows.filter((r) => Number(r.paid_paise) - Number(r.refunded_paise) > 0);
  if (!open.length) return [];
  const total = open.reduce((s, r) => s + Number(r.paid_paise) - Number(r.refunded_paise), 0);
  return [{
    fingerprint: 'cancelled_paid:business', category: 'cancellations', type: 'cancelled_after_payment',
    severity: total >= t.criticalPaise ? 'critical' : 'warning',
    title: 'Invoices cancelled after payment was recorded',
    summary: `${open.length} cancelled invoice${open.length === 1 ? '' : 's'} still show money collected and no refund on record. Cancelling does not pay anything back, so this money should be accounted for.`,
    subject: { type: 'business' },
    metric: { label: 'Collected on cancelled invoices, no refund', unit: '₹' },
    current_value: rupees(total), expected_value: 0, difference: rupees(total),
    potential_paise: total, confidence: 'high',
    recommendation: 'Check each invoice below: if the customer was refunded, record the refund; if the sale was re-billed, no action is needed.',
    evidence: {
      columns: ['Invoice', 'Date', 'Collected', 'Refunded'],
      rows: open.slice(0, 12).map((r) => [r.invoice_number, String(r.invoice_date), rupees(Number(r.paid_paise)), rupees(Number(r.refunded_paise))])
    }
  }];
};

/* ── cancellation pattern ─────────────────────────────────────────────────── */
/** rows: [{ user_id, name, cancelled, handled }] — handled = invoices the person created. */
export const detectCancellationPattern = (rows, t = THRESHOLDS.cancellationPattern) => {
  const cancelled = rows.reduce((s, r) => s + Number(r.cancelled), 0);
  const handled = rows.reduce((s, r) => s + Number(r.handled), 0);
  const out = [];
  for (const r of rows) {
    const c = Number(r.cancelled); const h = Number(r.handled);
    if (c < t.minCancelled || h === 0 || handled - h <= 0) continue;
    const rate = c / h; const baseline = (cancelled - c) / (handled - h);
    if (!(rate >= baseline * t.ratio && rate > baseline)) continue;
    out.push({
      fingerprint: `cancellations:user:${r.user_id}`, category: 'cancellations', type: 'cancellation_pattern',
      severity: 'warning', title: 'Unusual number of cancellations',
      summary: `${c} of the ${h} bills created by ${r.name || 'one team member'} (${pct1(rate)}%) were later cancelled, against ${pct1(baseline)}% for everyone else.`,
      subject: { type: 'user', id: r.user_id, name: r.name },
      metric: { label: 'Cancelled bills', unit: '%' },
      current_value: pct1(rate), expected_value: pct1(baseline), difference: pct1(rate - baseline),
      potential_paise: 0, confidence: confidenceFor(h, 100, 30),
      recommendation: 'Look at why these bills were cancelled. Frequent corrections may point to a training need or a confusing screen rather than a problem.'
    });
  }
  return out;
};

/* ── refunds ──────────────────────────────────────────────────────────────── */
/** cur/prev: { refunds_paise, refund_count, sales_paise }; byReason: [{ reason, amount_paise, n }] */
export const detectRefunds = ({ cur, prev, byReason = [] }, t = THRESHOLDS.refunds) => {
  const amount = Number(cur.refunds_paise);
  if (amount < t.minPaise || Number(cur.sales_paise) <= 0) return [];
  const rate = amount / Number(cur.sales_paise);
  const prevRate = Number(prev.sales_paise) > 0 ? Number(prev.refunds_paise) / Number(prev.sales_paise) : 0;
  const unusual = prevRate > 0 ? rate >= prevRate * t.ratio : amount >= t.minWhenNoBaselinePaise;
  if (!unusual) return [];
  const excess = amount - prevRate * Number(cur.sales_paise);
  return [{
    fingerprint: 'refunds:business', category: 'refunds', type: 'refund_increase',
    severity: 'warning', title: 'Refunds higher than usual',
    summary: `${inr(amount)} refunded across ${cur.refund_count} bills (${pct1(rate)}% of sales)${prevRate > 0 ? `, up from ${pct1(prevRate)}% in the previous period` : ''}.`,
    subject: { type: 'business' },
    metric: { label: 'Refunds as % of sales', unit: '%' },
    current_value: pct1(rate), expected_value: pct1(prevRate), difference: pct1(rate - prevRate),
    potential_paise: Math.max(0, Math.round(excess)), confidence: confidenceFor(Number(cur.refund_count), 20, 5),
    recommendation: 'Check whether the reasons below point to one dish, one shift or one cause you can fix.',
    evidence: { columns: ['Reason', 'Refunds', 'Amount'], rows: byReason.slice(0, 8).map((r) => [r.reason, Number(r.n), rupees(Number(r.amount_paise))]) }
  }];
};

/* ── wastage ──────────────────────────────────────────────────────────────── */
/** cur/prev: [{ product_id, name, unit, quantity, cost_paise }] */
export const detectWastage = (cur, prev, t = THRESHOLDS.wastage) => {
  const before = new Map(prev.map((r) => [r.product_id, Number(r.cost_paise)]));
  const out = [];
  for (const r of cur) {
    const now = Number(r.cost_paise); const was = before.get(r.product_id) || 0;
    const increase = now - was;
    const isNew = was === 0;
    if (isNew ? now < t.minNewPaise : !(increase >= t.minIncreasePaise && (increase / was) * 100 >= t.minIncreasePct)) continue;
    out.push({
      fingerprint: `wastage:product:${r.product_id}`, category: 'wastage', type: 'wastage_increase',
      severity: 'warning', title: `${r.name} wastage is above its recent level`,
      summary: `${inr(now)} of ${r.name} was written off (${Number(r.quantity)} ${r.unit})${isNew ? '' : `, up ${Math.round((increase / was) * 100)}% from ${inr(was)}`}.`,
      subject: { type: 'product', id: r.product_id, name: r.name },
      metric: { label: `${r.name} wastage`, unit: '₹' },
      current_value: rupees(now), expected_value: rupees(was), difference: rupees(increase),
      potential_paise: Math.max(0, increase), confidence: isNew ? 'low' : 'medium',
      recommendation: 'Check storage, ordering quantity and preparation for this item. Wastage logged by reason is in Inventory.'
    });
  }
  return out;
};

/* ── manual stock reductions ──────────────────────────────────────────────── */
/** rows: [{ product_id, name, unit, quantity, cost_paise, events }] — downward adjustments only. */
export const detectAdjustments = (rows, t = THRESHOLDS.adjustments) =>
  rows.filter((r) => Number(r.cost_paise) >= t.minPaise).map((r) => ({
    fingerprint: `inventory:product:${r.product_id}`, category: 'inventory', type: 'stock_reduction',
    severity: 'warning', title: `Stock of ${r.name} was reduced by hand`,
    summary: `${Number(r.quantity)} ${r.unit} (about ${inr(Number(r.cost_paise))}) was taken off ${r.name} in ${r.events} manual adjustment${Number(r.events) === 1 ? '' : 's'}, outside of sales and logged wastage.`,
    subject: { type: 'product', id: r.product_id, name: r.name },
    metric: { label: 'Manual stock reductions', unit: '₹' },
    current_value: rupees(Number(r.cost_paise)), expected_value: 0, difference: rupees(Number(r.cost_paise)),
    potential_paise: Number(r.cost_paise), confidence: 'medium',
    recommendation: 'Compare with a physical count. If the stock was spoiled or damaged, log it as wastage with a reason.'
  }));

/* ── complimentary lines ──────────────────────────────────────────────────── */
/** rows: [{ user_id, name, lines, cost_paise }] — invoice lines billed at zero. */
export const detectComplimentary = (rows, t = THRESHOLDS.complimentary) =>
  rows.filter((r) => Number(r.cost_paise) >= t.minCostPaise).map((r) => ({
    fingerprint: `complimentary:user:${r.user_id}`, category: 'discounts', type: 'complimentary_items',
    severity: 'informational', title: 'Items given free',
    summary: `${r.lines} item${Number(r.lines) === 1 ? '' : 's'} on bills handled by ${r.name || 'one team member'} were billed at zero, about ${inr(Number(r.cost_paise))} at cost.`,
    subject: { type: 'user', id: r.user_id, name: r.name },
    metric: { label: 'Free items at cost', unit: '₹' },
    current_value: rupees(Number(r.cost_paise)), expected_value: 0, difference: rupees(Number(r.cost_paise)),
    potential_paise: Number(r.cost_paise), confidence: 'medium',
    recommendation: 'Confirm these were approved comps (a guest recovery, a staff meal) and note the reason on the bill.'
  }));

/* ── collection ───────────────────────────────────────────────────────────── */

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

export const collect = async (businessId, from, to, db = pool) => {
  const days = Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  const prevTo = iso(new Date(new Date(from).getTime() - DAY));
  const prevFrom = iso(new Date(new Date(from).getTime() - days * DAY));
  const inRange = `i.business_id = $1 AND i.invoice_date BETWEEN $2 AND $3`;

  const discountRows = (await db.query(
    `SELECT i.created_by AS user_id, u.name, COUNT(*)::int AS bills,
            SUM(i.subtotal_paise + i.tax_paise + COALESCE(l.disc, 0)) AS gross_paise,
            SUM(i.discount_paise - i.coupon_discount_paise + COALESCE(l.disc, 0) - i.loyalty_discount_paise) AS discount_paise,
            COUNT(*) FILTER (WHERE (i.discount_paise - i.coupon_discount_paise + COALESCE(l.disc, 0) - i.loyalty_discount_paise) * 10 > (i.subtotal_paise + i.tax_paise + COALESCE(l.disc, 0)))::int AS large_bills
     FROM invoices i
     LEFT JOIN users u ON u.user_id = i.created_by
     LEFT JOIN (SELECT invoice_id, SUM(discount_paise) AS disc FROM invoice_items GROUP BY invoice_id) l ON l.invoice_id = i.invoice_id
     WHERE ${inRange} AND i.status = 'ISSUED' AND i.created_by IS NOT NULL
     GROUP BY i.created_by, u.name`, [businessId, from, to]
  )).rows;

  const cancelledPaid = (await db.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.amount_paid_paise AS paid_paise, i.refunded_paise
     FROM invoices i WHERE ${inRange} AND i.status = 'CANCELLED' AND i.amount_paid_paise > i.refunded_paise
     ORDER BY (i.amount_paid_paise - i.refunded_paise) DESC`, [businessId, from, to]
  )).rows;

  // The share of each person's own bills that ended up cancelled (by anyone). A manager who cancels
  // other people's bills is not measured by this; the people whose bills keep needing correction are.
  const cancelPattern = (await db.query(
    `SELECT i.created_by AS user_id, u.name,
            COUNT(*) FILTER (WHERE i.status = 'CANCELLED')::int AS cancelled, COUNT(*)::int AS handled
     FROM invoices i JOIN users u ON u.user_id = i.created_by
     WHERE ${inRange} GROUP BY i.created_by, u.name`, [businessId, from, to]
  )).rows;

  const refundStats = async (a, b) => {
    const r = (await db.query(
      `SELECT COALESCE(SUM(amount_paise),0) AS refunds_paise, COUNT(*)::int AS refund_count FROM refunds
       WHERE business_id = $1 AND credit_note_id IS NULL AND created_at >= $2::date AND created_at < ($3::date + 1)`, [businessId, a, b])).rows[0];
    const s = (await db.query(
      `SELECT COALESCE(SUM(total_paise),0) AS sales_paise FROM invoices i WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3`, [businessId, a, b])).rows[0];
    return { ...r, ...s };
  };
  const [refCur, refPrev] = [await refundStats(from, to), await refundStats(prevFrom, prevTo)];
  const refundReasons = (await db.query(
    `SELECT reason, COUNT(*) AS n, SUM(amount_paise) AS amount_paise FROM refunds
     WHERE business_id = $1 AND credit_note_id IS NULL AND created_at >= $2::date AND created_at < ($3::date + 1) GROUP BY reason ORDER BY 3 DESC`, [businessId, from, to])).rows;

  const wastageBy = (a, b) => db.query(
    `SELECT p.product_id, p.name, p.unit, SUM(-t.quantity) AS quantity, SUM(-t.quantity * p.purchase_price_paise) AS cost_paise
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
     WHERE t.business_id = $1 AND t.transaction_type = 'WASTAGE' AND t.created_at >= $2::date AND t.created_at < ($3::date + 1)
     GROUP BY p.product_id, p.name, p.unit`, [businessId, a, b]);
  const [wCur, wPrev] = [(await wastageBy(from, to)).rows, (await wastageBy(prevFrom, prevTo)).rows];

  const adjustments = (await db.query(
    `SELECT p.product_id, p.name, p.unit, SUM(-t.quantity) AS quantity, SUM(-t.quantity * p.purchase_price_paise) AS cost_paise, COUNT(*)::int AS events
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
     WHERE t.business_id = $1 AND t.transaction_type = 'ADJUSTMENT' AND t.quantity < 0 AND t.created_at >= $2::date AND t.created_at < ($3::date + 1)
     GROUP BY p.product_id, p.name, p.unit`, [businessId, from, to])).rows;

  const complimentary = (await db.query(
    `SELECT i.created_by AS user_id, u.name, COUNT(*)::int AS lines, SUM(COALESCE(ii.unit_cost_paise,0) * ii.quantity) AS cost_paise
     FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id LEFT JOIN users u ON u.user_id = i.created_by
     WHERE ${inRange} AND i.status = 'ISSUED' AND ii.line_total_paise = 0 AND ii.product_id IS NOT NULL AND i.loyalty_discount_paise = 0
     GROUP BY i.created_by, u.name`, [businessId, from, to])).rows;

  const findings = [
    ...detectDiscounts(discountRows),
    ...detectCancelledAfterPayment(cancelledPaid),
    ...detectCancellationPattern(cancelPattern),
    ...detectRefunds({ cur: refCur, prev: refPrev, byReason: refundReasons }),
    ...detectWastage(wCur, wPrev),
    ...detectAdjustments(adjustments),
    ...detectComplimentary(complimentary)
  ];

  // Drill-down for discount outliers: the biggest discounted bills for that person.
  for (const f of findings.filter((x) => x.needs === 'discount_evidence')) {
    const bills = (await db.query(
      `SELECT i.invoice_number, i.invoice_date, i.subtotal_paise + i.tax_paise AS gross_paise, i.discount_paise - i.coupon_discount_paise AS discount_paise, i.created_at
       FROM invoices i WHERE ${inRange} AND i.status = 'ISSUED' AND i.created_by = $4 AND i.discount_paise - i.coupon_discount_paise > 0
       ORDER BY 4 DESC LIMIT 10`, [businessId, from, to, f.subject.id])).rows;
    f.evidence = {
      columns: ['Invoice', 'Date', 'Bill before discount', 'Discount', '% off'],
      rows: bills.map((b) => [b.invoice_number, String(b.invoice_date), rupees(Number(b.gross_paise)), rupees(Number(b.discount_paise)), pct1(Number(b.discount_paise) / Number(b.gross_paise))])
    };
    delete f.needs;
  }

  const period = { from, to, days };
  return { period, previous_period: { from: prevFrom, to: prevTo }, findings: findings.map(finalise).sort(bySeverity) };
};

const finalise = (f) => ({ ...f, potential: rupees(f.potential_paise || 0), evidence: f.evidence || null, status: 'OPEN' });
const bySeverity = (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.potential_paise - a.potential_paise;

const REVIEW_TTL_DAYS = 14;

/** Overlay owner decisions. A dismissal quietens a finding for 14 days, then it can come back if it is still happening. */
export const applyReviews = (findings, reviews, now = Date.now()) => {
  const by = new Map(reviews.map((r) => [r.fingerprint, r]));
  return findings.map((f) => {
    const r = by.get(f.fingerprint);
    if (!r) return f;
    const fresh = now - new Date(r.reviewed_at).getTime() < REVIEW_TTL_DAYS * DAY;
    return fresh ? { ...f, status: r.status, review: { note: r.note, reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by_name } } : f;
  });
};

export const summarise = (findings) => {
  const active = findings.filter((f) => f.status === 'OPEN');
  const byCategory = {};
  for (const f of active) byCategory[f.category] = (byCategory[f.category] || 0) + f.potential_paise;
  return {
    potential_paise: active.reduce((s, f) => s + f.potential_paise, 0),
    open: active.length,
    critical: active.filter((f) => f.severity === 'critical').length,
    by_category: Object.entries(byCategory).map(([category, paise]) => ({ category, potential: rupees(paise) })).sort((a, b) => b.potential - a.potential)
  };
};

/** Findings for a window with reviews applied — what the page shows, and what the daily scan alerts on. */
export const currentFindings = async (businessId, from, to, db = pool) => {
  const { period, previous_period, findings } = await collect(businessId, from, to, db);
  const reviews = (await db.query(
    `SELECT r.fingerprint, r.status, r.note, r.reviewed_at, u.name AS reviewed_by_name
     FROM leakage_reviews r LEFT JOIN users u ON u.user_id = r.reviewed_by WHERE r.business_id = $1`, [businessId])).rows;
  return { period, previous_period, findings: applyReviews(findings, reviews) };
};
