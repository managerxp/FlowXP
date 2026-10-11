/* A distributor's field rep: today's route, the shop in front of them, a visit, an order and a payment taken there. With no signal each is kept on the
   phone and sent later, in order (the visit first, so the order and the payment can name it), once each. The server prices and checks everything again. */
import { ApiError, NetworkError, newKey, type Api } from './api.ts';
import type { Actions } from './actions.ts';
import type { Product } from './catalog.ts';
import { toPaise } from './money.ts';

export type RouteShop = {
  seq: number; customer_id: number; name: string; phone: string | null; address: string | null; contact_person: string | null; city: string | null; last_order: string | null;
  outstanding: number; overdue: number; credit_limit: number; visit_id: number | null; visit_outcome: Outcome | null; visited: boolean;
};
export type FieldToday = {
  salesperson: { salesperson_id: number; name: string }; date: string;
  beats: { beat_id: number; name: string; customers: RouteShop[] }[];
  summary: { planned: number; visited: number; orders: number; order_value: number; collected: number; month_target: null | { target: number; actual: number; achievement_pct: number; remaining: number; required_per_day: number; days_left: number; status: string } };
};
export type FieldShop = {
  customer: { customer_id: number; name: string; phone: string | null; address: string | null; gstin: string | null; contact_person: string | null; city: string | null; payment_terms_days: number | null; territory: string | null };
  credit: { limit: number; outstanding: number; overdue: number; available: number | null; utilization_pct: number | null; policy: string | null };
  orders: { order_id: number; order_number: string; order_date: string; status: string; total: number }[];
  open_invoices: { invoice_id: number; invoice_number: string; invoice_date: string; due_date: string | null; balance: number; overdue: boolean }[];
  visits: { visit_id: number; visit_date: string; outcome: Outcome; notes: string | null; order_value: number; collection: number }[];
};

export type Outcome = 'ORDER' | 'COLLECTION' | 'NO_ORDER' | 'CLOSED' | 'NOT_AVAILABLE' | 'FOLLOW_UP';
export const OUTCOME_LABEL: Record<Outcome, string> = { ORDER: 'Took an order', COLLECTION: 'Collected a payment', NO_ORDER: 'No order today', CLOSED: 'Shop was closed', NOT_AVAILABLE: 'Owner not there', FOLLOW_UP: 'Come back later' };
/** The outcomes a rep picks when there is no order or payment to record. */
export const NO_SALE_OUTCOMES: Outcome[] = ['NO_ORDER', 'CLOSED', 'NOT_AVAILABLE', 'FOLLOW_UP'];

/* ── sending now, or keeping for later ── */
export type Sent<T> = { kind: 'sent'; data: T } | { kind: 'queued' } | { kind: 'full' };
const unreachable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && [502, 503, 504].includes(e.status));

/**
 * Send one thing to the server now; if it cannot be reached keep it on the phone. Anything already waiting means this one waits too, behind it,
 * so a visit is always sent before the order that names it. A refusal (a minimum order, a payment with no reference) is thrown, not queued.
 */
export const sendOrQueue = async <T>(
  { api, actions }: { api: Api; actions: Actions },
  { id, label, method, path, body, tryMs = 8000 }: { id: string; label: string; method: string; path: string; body: Record<string, unknown>; tryMs?: number }
): Promise<Sent<T>> => {
  const waiting = (await actions.counts()).pending > 0;
  if (!waiting) {
    try { return { kind: 'sent', data: await api.post<T>(path, body, { idempotencyKey: id, timeoutMs: tryMs }) }; }
    catch (e) { if (!unreachable(e)) throw e; }
  }
  return (await actions.add({ id, label, method, path, body })) ? { kind: 'queued' } : { kind: 'full' };
};

/* ── a visit ── */
export type KV = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };
export type VisitMark = { ref: string; outcome: Outcome };
const visitKey = (date: string, customerId: number) => `field-visit:${date}:${customerId}`;

export type Where = { lat: number; lng: number };
export const visitBody = (a: { customerId: number; outcome: Outcome; ref: string; beatId?: number | null; notes?: string; nextVisit?: string; date?: string; where?: Where | null }) => ({
  customer_id: a.customerId, outcome: a.outcome, client_ref: a.ref, ...(a.beatId ? { beat_id: a.beatId } : {}), ...(a.notes?.trim() ? { notes: a.notes.trim() } : {}),
  ...(a.nextVisit?.trim() ? { next_visit_date: a.nextVisit.trim() } : {}), ...(a.date ? { visit_date: a.date } : {}), ...(a.where ? { lat: a.where.lat, lng: a.where.lng } : {})
});

/** Where the phone is, for a business that records where visits happen. Set once when the app starts (it needs the phone's location); with none set, or if it gives up, a visit is recorded without a place. */
let spot: (() => Promise<Where | null>) | null = null;
export const setSpotProvider = (fn: (() => Promise<Where | null>) | null) => { spot = fn; };

/** Today's visit to this shop: made the first time something is done there (an order, a payment or "closed"), and the same one after that. */
export const ensureVisit = async (
  deps: { api: Api; actions: Actions; kv: KV },
  { date, customerId, shopName, outcome, beatId, notes, nextVisit }: { date: string; customerId: number; shopName: string; outcome: Outcome; beatId?: number | null; notes?: string; nextVisit?: string }
): Promise<{ ref: string; sent: boolean }> => {
  const have = await deps.kv.get(visitKey(date, customerId));
  if (have) return { ref: (JSON.parse(have) as VisitMark).ref, sent: true };
  const ref = newKey();
  const where = spot ? await spot().catch(() => null) : null;
  const r = await sendOrQueue(deps, { id: `visit-${ref}`, label: `Visit to ${shopName}`, method: 'POST', path: '/distributor/visits', body: visitBody({ customerId, outcome, ref, beatId, notes, nextVisit, date, where }) });
  if (r.kind === 'full') throw new Error('Too many changes are waiting to send. Connect to the internet before going on.');
  await deps.kv.set(visitKey(date, customerId), JSON.stringify({ ref, outcome } satisfies VisitMark));
  return { ref, sent: r.kind === 'sent' };
};

/** Which shops on today's route have been visited from this phone (so the route shows it even before the visit reaches the server). */
export const visitedHere = async (kv: KV, date: string, customerIds: number[]): Promise<Map<number, Outcome>> => {
  const out = new Map<number, Outcome>();
  for (const id of customerIds) { const v = await kv.get(visitKey(date, id)); if (v) out.set(id, (JSON.parse(v) as VisitMark).outcome); }
  return out;
};

/* ── an order, priced from the phone's own copy of the products ── */
export type FLine = { key: string; product: Product; unit_name: string | null; quantity: string };
let counter = 0;
const nextKey = () => `f${++counter}`;

/** The price of one in the unit asked for (a carton is its factor times the piece price). */
export const unitFactor = (p: Product, unit: string | null): number => (unit ? (p.wholesale?.units.find((u) => u.unit_name === unit)?.factor ?? 1) : 1);
export const pieceRupees = (p: Product): number => p.wholesale?.wholesale_price ?? p.selling_price;

export const addFLine = (lines: FLine[], product: Product, unit: string | null = null): FLine[] => {
  const have = lines.find((l) => l.product.product_id === product.product_id && l.unit_name === unit);
  if (have) return lines.map((l) => (l === have ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
  return [...lines, { key: nextKey(), product, unit_name: unit, quantity: String(Math.max(1, product.wholesale?.moq ?? 1)) }];
};
export const setFQty = (lines: FLine[], key: string, quantity: string): FLine[] => lines.map((l) => (l.key === key ? { ...l, quantity } : l));
export const setFUnit = (lines: FLine[], key: string, unit: string | null): FLine[] => lines.map((l) => (l.key === key ? { ...l, unit_name: unit } : l));
export const dropFLine = (lines: FLine[], key: string): FLine[] => lines.filter((l) => l.key !== key);

/** About what the order comes to (shelf wholesale price per piece times the unit's size, plus GST). The server's price list, offers and rounding replace it. */
export const estimateOrder = (lines: FLine[]): { subtotalPaise: number; taxPaise: number; totalPaise: number } => {
  let subtotal = 0; let tax = 0;
  for (const l of lines) {
    const q = Number(l.quantity); if (!(q > 0)) continue;
    const line = Math.round(toPaise(pieceRupees(l.product)) * unitFactor(l.product, l.unit_name) * q);
    subtotal += line; tax += Math.round(line * (l.product.tax_rate / 100));
  }
  return { subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax };
};

export const fieldOrderProblem = (lines: FLine[]): string => {
  const live = lines.filter((l) => Number(l.quantity) > 0);
  if (!live.length) return 'Add at least one product, with how many';
  const below = live.find((l) => !l.unit_name && Number(l.quantity) < (l.product.wholesale?.moq ?? 1));
  return below ? `${below.product.name}: the minimum order is ${below.product.wholesale?.moq} ${below.product.unit ?? ''}`.trim() : '';
};

/** What an order taken in the field sends: the products, the visit it came from, that it came from the field, and the total the shop was shown. */
export const fieldOrderBody = (customerId: number, lines: FLine[], visitRef: string, expectedTotalRupees: number, extra: { customerPo?: string; notes?: string } = {}) => ({
  customer_id: customerId, submit: true, source: 'FIELD', visit_ref: visitRef, expected_total: expectedTotalRupees,
  lines: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ product_id: l.product.product_id, quantity: Number(l.quantity), ...(l.unit_name ? { unit_name: l.unit_name } : {}) })),
  ...(extra.customerPo?.trim() ? { customer_po: extra.customerPo.trim() } : {}), ...(extra.notes?.trim() ? { notes: extra.notes.trim() } : {})
});

/** A payment taken in the field: against the oldest bills, and tied to the visit. */
export const fieldReceiptBody = (customerId: number, amount: string, method: string, reference: string, visitRef: string, notes = '') => ({
  customer_id: customerId, amount: Number(amount), method, allocate: 'OLDEST', visit_ref: visitRef,
  ...(reference.trim() ? { reference: reference.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {})
});

/** The route as a flat list in visiting order, with each shop's beat. */
export const routeShops = (t: FieldToday | null): (RouteShop & { beat_id: number; beat: string })[] => (t ? t.beats.flatMap((b) => b.customers.map((c) => ({ ...c, beat_id: b.beat_id, beat: b.name }))) : []);
