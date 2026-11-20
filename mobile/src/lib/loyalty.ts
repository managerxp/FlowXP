/*
 * Coupons on the phone (owner and admin): offer codes. The same as the website's Loyalty page; the server checks every value again and all the
 * counting happens there. Pure: forms, bodies, checks and wording. Stamp and points cards are made on the website and designed on the phone (cardDesign.ts).
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));
const whole = (v: string): boolean => /^\d+$/.test(v.trim());

/** Owners and admins set loyalty up (the server enforces it; this hides the menu entry from everyone else). */
export const canLoyalty = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

/* ── coupons ─────────────────────────────────────────────────────────────── */
export type Coupon = {
  coupon_id: number; code: string; description: string | null; kind: 'PERCENT' | 'FLAT'; value: number; min_bill: number; max_discount: number | null; valid_from: string | null; valid_to: string | null;
  max_uses: number | null; max_uses_per_customer: number | null; is_active: boolean; used: number; discount_given: number;
};
export type CouponForm = { code: string; description: string; kind: 'PERCENT' | 'FLAT'; value: string; min_bill: string; max_discount: string; valid_from: string; valid_to: string; max_uses: string; max_uses_per_customer: string };
export const emptyCoupon = (): CouponForm => ({ code: '', description: '', kind: 'PERCENT', value: '', min_bill: '', max_discount: '', valid_from: '', valid_to: '', max_uses: '', max_uses_per_customer: '' });
const text = (v: number | string | null | undefined): string => (v == null || v === 0 ? '' : String(v));
export const couponForm = (c: Coupon): CouponForm => ({ code: c.code, description: c.description ?? '', kind: c.kind, value: String(c.value), min_bill: text(c.min_bill), max_discount: text(c.max_discount), valid_from: c.valid_from ?? '', valid_to: c.valid_to ?? '', max_uses: text(c.max_uses), max_uses_per_customer: text(c.max_uses_per_customer) });
const isDay = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const couponProblem = (f: CouponForm): string => {
  if (!/^[A-Z0-9_-]{3,24}$/.test(f.code.trim().toUpperCase())) return 'Code must be 3 to 24 letters, numbers, - or _';
  const v = Number(f.value);
  if (!(v > 0)) return 'Enter how much the coupon takes off';
  if (f.kind === 'PERCENT' && v > 100) return 'A percentage can’t be more than 100';
  for (const k of ['min_bill', 'max_discount'] as const) if (f[k] && !(Number(f[k]) >= 0)) return 'Amounts must be numbers';
  for (const k of ['max_uses', 'max_uses_per_customer'] as const) if (f[k] && !(whole(f[k]) && Number(f[k]) > 0)) return 'Uses must be a whole number above zero';
  if ((f.valid_from && !isDay(f.valid_from)) || (f.valid_to && !isDay(f.valid_to))) return 'Dates are written like 2026-10-31';
  if (f.valid_from && f.valid_to && f.valid_to < f.valid_from) return 'The end date is before the start date';
  return '';
};
/** The body of POST/PUT /coupons: blank limits are sent as null, so a limit can also be taken away. */
export const couponBody = (f: CouponForm): Record<string, unknown> => ({
  code: f.code.trim().toUpperCase(), description: f.description.trim(), kind: f.kind, value: Number(f.value),
  min_bill: f.min_bill ? Number(f.min_bill) : null, max_discount: f.kind === 'PERCENT' && f.max_discount ? Number(f.max_discount) : null,
  valid_from: f.valid_from || null, valid_to: f.valid_to || null, max_uses: f.max_uses ? Number(f.max_uses) : null, max_uses_per_customer: f.max_uses_per_customer ? Number(f.max_uses_per_customer) : null
});
export type CouponState = 'Live' | 'Off' | 'Expired' | 'Scheduled' | 'Used up';
export const couponState = (c: Coupon, today: string): CouponState => {
  if (!c.is_active) return 'Off';
  if (c.valid_to && c.valid_to < today) return 'Expired';
  if (c.valid_from && c.valid_from > today) return 'Scheduled';
  if (c.max_uses != null && c.used >= c.max_uses) return 'Used up';
  return 'Live';
};
export const couponOffer = (c: Coupon): string =>
  [c.kind === 'PERCENT' ? t('{value}% off', { value: c.value }) : t('{value} off', { value: money(c.value) }), c.max_discount != null ? t('(max {value})', { value: money(c.max_discount) }) : '', c.min_bill > 0 ? t('on bills of {value}+', { value: money(c.min_bill) }) : ''].filter(Boolean).join(' ');
export const couponLine = (c: Coupon): string =>
  [couponOffer(c), c.valid_from || c.valid_to ? `${c.valid_from || '…'} → ${c.valid_to || '…'}` : t('Always'), c.max_uses != null ? t('Used {n} / {max}', { n: c.used, max: c.max_uses }) : t('Used {n}', { n: c.used }), t('given off {value}', { value: money(c.discount_given) })].join(' · ');
export const todayText = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Every fixed text on the Loyalty screens, so the language tests can check each is translated. */
export const LOYALTY_TEXTS: string[] = [
  'Coupons',
  'Loyalty & coupons', 'Loyalty is set up by owners and admins.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Save', 'Back', 'Cancel', 'Saved.', 'You have changes not saved yet.', 'Remove', 'Optional', 'Edit',
  'New coupon', 'Edit {code}', 'Code', 'What the customer says or types.', 'Type', 'Percent off', 'Flat amount off', 'Percent', 'Amount (₹)', 'Note for staff', 'Most it can take off (₹)', 'Starts', 'Ends', 'Total uses', 'Blank = unlimited', 'Uses per customer', 'Needs the customer’s mobile at billing',
  'Create coupon', 'Save changes', 'Turn off', 'Turn on', 'Live', 'Off', 'Expired', 'Scheduled', 'Used up', '{value}% off', '{value} off', '(max {value})', 'on bills of {value}+', 'Always', 'Used {n}', 'Used {n} / {max}', 'given off {value}',
  'No coupons yet. Create one and give the code to a customer; the cashier enters it at billing.', 'Code must be 3 to 24 letters, numbers, - or _', 'Enter how much the coupon takes off', 'A percentage can’t be more than 100', 'Amounts must be numbers', 'Uses must be a whole number above zero',
  'Dates are written like 2026-10-31', 'The end date is before the start date', 'Name'
];
