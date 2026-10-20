/*
 * Offers on the phone (owner, or anyone with the products or settings permission): the offers the till applies by itself, how each reads in
 * the list, and the body a new one is sent as. The same as the website's Offers page; the server checks everything again and works out the
 * discount when the bill is made. Pure: kinds, wording, the form and its checks.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

export type OfferKind = 'PERCENT_OFF' | 'BUY_X_GET_Y' | 'BUNDLE_PRICE' | 'MIX_BUNDLE';
export type Offer = {
  promo_id: number; name: string; kind: OfferKind; percent: number | null; min_qty: number; buy_qty: number | null; get_qty: number | null; bundle_qty: number | null; bundle_price: number | null;
  products: unknown[]; product_name: string | null; category_name: string | null; starts_on: string | null; ends_on: string | null; days_of_week: number[] | null;
  start_time: string | null; end_time: string | null; members_only: boolean; is_active: boolean; live: boolean; on_now: boolean;
};
export const OFFER_KINDS: { id: OfferKind; label: string; hint: string }[] = [
  { id: 'PERCENT_OFF', label: 'Percentage off', hint: 'for example 10% off, or 15% off when you buy 3 or more' },
  { id: 'BUY_X_GET_Y', label: 'Buy some, get some free', hint: 'for example buy 1 get 1 free' },
  { id: 'BUNDLE_PRICE', label: 'A bundle price', hint: 'for example 3 for ₹140' },
  { id: 'MIX_BUNDLE', label: 'Mix and match', hint: 'for example any 3 of these biscuits for ₹50' }
];
/** Monday first, as the website shows them; the number is the weekday the server uses (Sunday is 0). */
export const OFFER_DAYS: { label: string; day: number }[] = [{ label: 'Mon', day: 1 }, { label: 'Tue', day: 2 }, { label: 'Wed', day: 3 }, { label: 'Thu', day: 4 }, { label: 'Fri', day: 5 }, { label: 'Sat', day: 6 }, { label: 'Sun', day: 0 }];

/** Who may see and change offers: the products or settings permission (owners have both). */
export const canOffers = (can: (perm: string) => boolean): boolean => can('products') || can('settings');
export const OFFER_TYPES_EXTRA = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'HOTEL', 'GAMING_CAFE'];   // plus the shops, which come from retail.ts

/* ── how an offer reads in the list ──────────────────────────────────────── */
const price = (n: number | null): string => rupees(toPaise(n ?? 0));
export const describeOffer = (o: Offer): string => {
  if (o.kind === 'PERCENT_OFF') return o.min_qty > 1 ? t('{percent}% off when you buy {qty} or more', { percent: o.percent ?? 0, qty: o.min_qty }) : t('{percent}% off', { percent: o.percent ?? 0 });
  if (o.kind === 'BUY_X_GET_Y') return t('Buy {buy}, get {get} free', { buy: o.buy_qty ?? 0, get: o.get_qty ?? 0 });
  if (o.kind === 'MIX_BUNDLE') return t('Any {qty} for {price}', { qty: o.bundle_qty ?? 0, price: price(o.bundle_price) });
  return t('{qty} for {price}', { qty: o.bundle_qty ?? 0, price: price(o.bundle_price) });
};
export const offerWhen = (o: Offer): string => {
  const days = o.days_of_week ? OFFER_DAYS.filter((d) => o.days_of_week!.includes(d.day)).map((d) => t(d.label)).join(', ') : '';
  return [days, o.start_time ? t('{from} to {to}', { from: o.start_time, to: o.end_time ?? '' }) : ''].filter(Boolean).join(', ');
};
export const offerTarget = (o: Offer): string => (o.kind === 'MIX_BUNDLE' ? t('{n} products', { n: o.products.length }) : o.product_name || t('All {category}', { category: o.category_name ?? '' }));
export const offerSpan = (o: Offer): string => (o.starts_on || o.ends_on ? [o.starts_on ? t('from {date}', { date: o.starts_on }) : '', o.ends_on ? t('until {date}', { date: o.ends_on }) : ''].filter(Boolean).join(' ') : t('no end date'));
export type OfferState = 'On now' | 'Not now' | 'Not today' | 'Off';
export const offerState = (o: Offer): OfferState => (o.on_now ? 'On now' : o.live ? 'Not now' : o.is_active ? 'Not today' : 'Off');
/** The grey line under the name. */
export const offerLine = (o: Offer): string => [describeOffer(o), offerTarget(o), offerSpan(o), offerWhen(o), o.members_only ? t('customers only') : ''].filter(Boolean).join(' · ');

/* ── the form ────────────────────────────────────────────────────────────── */
export type PickedProduct = { product_id: number; name: string };
export type OfferForm = {
  name: string; kind: OfferKind; target: 'product' | 'category'; product: PickedProduct | null; products: PickedProduct[]; category_id: string; days: number[];
  start_time: string; end_time: string; starts_on: string; ends_on: string; percent: string; min_qty: string; buy_qty: string; get_qty: string; bundle_qty: string; bundle_price: string; members_only: boolean;
};
export const emptyOffer = (): OfferForm => ({ name: '', kind: 'PERCENT_OFF', target: 'product', product: null, products: [], category_id: '', days: [], start_time: '', end_time: '', starts_on: '', ends_on: '', percent: '10', min_qty: '1', buy_qty: '1', get_qty: '1', bundle_qty: '3', bundle_price: '', members_only: false });

const isDay = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** What is wrong with the form, in words for the owner, or '' when it can be sent. The server checks all of it again. */
export const offerProblem = (f: OfferForm): string => {
  const mix = f.kind === 'MIX_BUNDLE';
  if (!f.name.trim()) return 'Give the offer a name (up to 80 characters)';
  if (mix && f.products.length < 2) return 'Choose at least two products for a mix-and-match bundle';
  if (!mix && f.target === 'product' && !f.product) return 'Choose the product the offer is for';
  if (!mix && f.target === 'category' && !f.category_id) return 'Choose the category the offer is for';
  if (f.kind === 'PERCENT_OFF') { const p = Number(f.percent); if (!(p > 0 && p <= 100)) return 'The percentage must be above 0 and at most 100'; if (!(Number(f.min_qty || 1) > 0)) return 'From quantity must be at least 1'; }
  if (f.kind === 'BUY_X_GET_Y' && !(Number(f.buy_qty) >= 1 && Number(f.get_qty) >= 1)) return 'Enter how many the customer buys and how many are free';
  if ((f.kind === 'BUNDLE_PRICE' || mix) && !(Number(f.bundle_qty) >= 2 && Number(f.bundle_price) > 0)) return 'Enter the units in the bundle (two or more) and its price';
  if ((f.starts_on && !isDay(f.starts_on)) || (f.ends_on && !isDay(f.ends_on))) return 'Dates are written like 2026-10-31';
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) return 'The offer cannot end before it starts';
  if (Boolean(f.start_time) !== Boolean(f.end_time)) return 'Give both times of day, or neither';
  if ((f.start_time && !isTime(f.start_time)) || (f.end_time && !isTime(f.end_time))) return 'Times are written like 16:00';
  return '';
};

/** The body of POST /retail/promotions; fields the offer does not use are left out, as the website does. */
export const offerBody = (f: OfferForm): Record<string, unknown> => {
  const mix = f.kind === 'MIX_BUNDLE';
  return {
    name: f.name.trim(), kind: f.kind, members_only: f.members_only, starts_on: f.starts_on || undefined, ends_on: f.ends_on || undefined,
    days_of_week: f.days.length ? f.days : undefined, start_time: f.start_time || undefined, end_time: f.end_time || undefined,
    ...(mix ? { product_ids: f.products.map((p) => p.product_id) } : f.target === 'product' ? { product_id: f.product?.product_id } : { category_id: f.category_id ? Number(f.category_id) : undefined }),
    ...(f.kind === 'PERCENT_OFF' ? { percent: Number(f.percent), min_qty: Number(f.min_qty || 1) } : {}),
    ...(f.kind === 'BUY_X_GET_Y' ? { buy_qty: Number(f.buy_qty), get_qty: Number(f.get_qty) } : {}),
    ...(f.kind === 'BUNDLE_PRICE' || mix ? { bundle_qty: Number(f.bundle_qty), bundle_price: f.bundle_price } : {})
  };
};

/** Every fixed text on the Offers screens, so the language tests can check each is translated. */
export const OFFERS_TEXTS: string[] = [
  'Discounts the till applies by itself',
  'Offers', 'Offers the till applies by itself: percentage off, buy some get some free, or a bundle price.', 'New offer', 'No offers yet', 'Try “3 for ₹140” on milk, or 10% off a whole category this weekend.',
  'On now', 'Not now', 'Not today', 'Off', 'Switch off', 'Switch on', 'Remove', 'Remove “{name}”?', 'Bills already made keep what they were charged.', 'You do not have access to offers.', 'Could not load.', 'Could not save. Check the connection and try again.',
  'Percentage off', 'Buy some, get some free', 'A bundle price', 'Mix and match', 'for example 10% off, or 15% off when you buy 3 or more', 'for example buy 1 get 1 free', 'for example 3 for ₹140', 'for example any 3 of these biscuits for ₹50',
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', '{percent}% off', '{percent}% off when you buy {qty} or more', 'Buy {buy}, get {get} free', 'Any {qty} for {price}', '{qty} for {price}', '{n} products', 'All {category}', 'from {date}', 'until {date}', 'no end date', 'customers only', '{from} to {to}',
  'Name', 'Shown on the bill line, so customers see what they got.', 'e.g. Milk 3 for ₹140', 'What kind of offer', 'Products in the bundle', 'Pick two or more. Any of them can make up the bundle.', 'Search by name or barcode, then tap to add', 'Search by name or barcode', 'Applies to', 'One product', 'A whole category', 'Product', 'Category', 'Change', 'Choose…',
  'Percent off', 'From quantity', '1 means every sale.', 'Customer buys', 'And gets free', 'Units in the bundle', 'Bundle price (₹)', 'With GST, as on the shelf.', 'Starts', 'Ends', 'Optional. The last day it applies.', 'Optional.', 'Dates are written like 2026-10-31', 'Days', '(none ticked means every day)', 'From (time of day)', 'Until', 'Both, or neither. An end before the start runs overnight.', 'Only when the bill has a customer on it',
  'If several offers fit one product, the one that saves the most is used. Offers never add up on top of each other.', 'Save the offer', 'Back', 'Cancel',
  'Give the offer a name (up to 80 characters)', 'Choose at least two products for a mix-and-match bundle', 'Choose the product the offer is for', 'Choose the category the offer is for', 'The percentage must be above 0 and at most 100', 'From quantity must be at least 1',
  'Enter how many the customer buys and how many are free', 'Enter the units in the bundle (two or more) and its price', 'The offer cannot end before it starts', 'Give both times of day, or neither', 'Times are written like 16:00'
];
