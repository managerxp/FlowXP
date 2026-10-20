/*
 * Loyalty and coupons on the phone (owner and admin): the visit card ("every Nth visit, this item is free"), points and tiers, and coupon
 * codes. The same as the website's Loyalty page; the server checks every value again and all the counting happens there. Pure: forms,
 * bodies, checks and wording. The plan decides whether the feature exists at all: when it does not, the server says so and the screen shows it.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));
const whole = (v: string): boolean => /^\d+$/.test(v.trim());

/** Owners and admins set loyalty up (the server enforces it; this hides the menu entry from everyone else). */
export const canLoyalty = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

/* ── the visit card ──────────────────────────────────────────────────────── */
export type Program = { is_enabled: boolean; visits_required: number; reward_product_id: number | null; reward_name: string | null; reward_price: number | null; reward_quantity: number; min_bill: number };
export type Dish = { product_id: number; name: string; selling_price: number; shared_price?: number | null };
export type ProgramForm = { is_enabled: boolean; visits_required: string; reward_product_id: string; reward_quantity: string; min_bill: string };
export const programForm = (p: Program): ProgramForm => ({ is_enabled: p.is_enabled, visits_required: String(p.visits_required), reward_product_id: p.reward_product_id ? String(p.reward_product_id) : '', reward_quantity: String(p.reward_quantity), min_bill: p.min_bill ? String(p.min_bill) : '' });
export const programBody = (f: ProgramForm): Record<string, unknown> => ({
  is_enabled: f.is_enabled, visits_required: Number(f.visits_required), reward_product_id: f.reward_product_id ? Number(f.reward_product_id) : null, reward_quantity: Number(f.reward_quantity) || 1, min_bill: f.min_bill ? Number(f.min_bill) : 0
});
export const programProblem = (f: ProgramForm): string => {
  const n = Number(f.visits_required);
  if (!Number.isInteger(n) || n < 2 || n > 50) return 'Visits needed must be a whole number from 2 to 50';
  if (f.min_bill && !(Number(f.min_bill) >= 0)) return 'Minimum bill must be a number';
  if (f.is_enabled && !f.reward_product_id) return 'Choose the free item before switching the program on';
  return '';
};
export const VISIT_CHOICES = [5, 7, 10];
export const BILL_CHOICES: { value: string; label: string }[] = [{ value: '', label: 'Every bill' }, { value: '100', label: '₹100 or more' }, { value: '150', label: '₹150 or more' }, { value: '300', label: '₹300 or more' }];
export const dishPrice = (d: Dish): number => d.shared_price ?? d.selling_price;

export type Member = { customer_id: number; name: string; phone: string | null; visits: number; stamps: number | null; last_visit: string | null };
export type Stats = {
  members: number; new_30d: number; active_30d: number; visits_30d: number; rewards_redeemed: number; rewards_redeemed_30d: number; rewards_value: number; lapsed_60d: number;
  by_visits: { label: string; count: number }[]; reward_due: { count: number; members: Member[] }; one_visit_away: { count: number; members: Member[] };
  regulars: { customer_id: number; name: string; phone: string | null; visits: number; stamps: number | null; reward_ready: boolean }[];
};
/** "today", "yesterday" or "3 days ago", from a YYYY-MM-DD day and today's date. */
export const daysAgoText = (day: string | null, now: Date = new Date()): string => {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const n = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / 86400000);
  return n <= 0 ? t('today') : n === 1 ? t('yesterday') : t('{n} days ago', { n });
};
export const memberLine = (m: Member, now?: Date): string => t('{visits} visits · last {when}', { visits: m.visits, when: daysAgoText(m.last_visit, now) });
export const percentOf = (count: number, of: number): number => (of ? Math.round((count / of) * 100) : 0);

/* ── points and tiers ────────────────────────────────────────────────────── */
export type Tier = { name: string; min_points: number | string; multiplier: number | string };
export type PointsProgram = { is_enabled: boolean; earn_per_100: number | string; point_value: number | string; min_redeem_points: number | string; max_redeem_pct: number | string; tiers: Tier[] };
export type PointsForm = { is_enabled: boolean; earn_per_100: string; point_value: string; min_redeem_points: string; max_redeem_pct: string; tiers: { name: string; min_points: string; multiplier: string }[] };
export const pointsForm = (p: PointsProgram): PointsForm => ({
  is_enabled: p.is_enabled, earn_per_100: String(p.earn_per_100), point_value: String(p.point_value), min_redeem_points: String(p.min_redeem_points), max_redeem_pct: String(p.max_redeem_pct),
  tiers: p.tiers.map((x) => ({ name: x.name, min_points: String(x.min_points), multiplier: String(x.multiplier) }))
});
export const newTier = (f: PointsForm): PointsForm['tiers'][number] => ({ name: '', min_points: f.tiers.length ? '' : '0', multiplier: '1' });
export const pointsBody = (f: PointsForm): Record<string, unknown> => ({
  is_enabled: f.is_enabled, earn_per_100: Number(f.earn_per_100), point_value: Number(f.point_value), min_redeem_points: Number(f.min_redeem_points), max_redeem_pct: Number(f.max_redeem_pct),
  tiers: f.tiers.map((x) => ({ name: x.name.trim(), min_points: Number(x.min_points), multiplier: Number(x.multiplier) }))
});
export const pointsProblem = (f: PointsForm): string => {
  const earn = Number(f.earn_per_100), value = Number(f.point_value), max = Number(f.max_redeem_pct);
  if (!(earn > 0 && earn <= 100)) return 'Points per Rs 100 must be above 0 and at most 100';
  if (!(value > 0 && value <= 1000)) return 'A point must be worth between Rs 0.01 and Rs 1000';
  if (!whole(f.min_redeem_points) || Number(f.min_redeem_points) < 1) return 'The minimum to use must be a whole number of points';
  if (!Number.isInteger(max) || max < 1 || max > 100) return 'The most a bill can be paid with points must be 1 to 100 percent';
  if (f.tiers.length > 6) return 'Up to six tiers';
  const seen = new Set<number>();
  for (const x of f.tiers) {
    if (!x.name.trim() || x.name.trim().length > 30) return 'Every tier needs a name (up to 30 characters)';
    if (!whole(x.min_points)) return 'Points to reach a tier must be a whole number, 0 or more';
    if (seen.has(Number(x.min_points))) return 'Two tiers start at the same number of points';
    seen.add(Number(x.min_points));
    if (!(Number(x.multiplier) >= 1 && Number(x.multiplier) <= 10)) return 'The earning multiplier must be from 1 to 10';
  }
  if (f.tiers.length && !seen.has(0)) return 'The first tier must start at 0 points so everyone has one';
  return '';
};
export const exampleEarn = (earnPer100: string): number => Math.floor(Number(earnPer100) * 5);
export type PointsSummary = { enabled: boolean; members_with_points: number; outstanding_points: number; liability: number; earned_30d: number; redeemed_30d: number; discount_30d: number; top: { customer_id: number; name: string; phone: string | null; balance: number; lifetime: number | null }[] };
/** Give or take points for one customer: a whole number that is not zero, and a reason. */
export const adjustProblem = (points: string, note: string): string => (/^-?\d+$/.test(points.trim()) && Number(points) !== 0 ? (note.trim() ? '' : 'Say why, so it is kept in their history') : 'Enter a whole number of points (negative takes away)');
export const adjustBody = (points: string, note: string): { points: number; note: string } => ({ points: Number(points), note: note.trim() });

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
  'Visit card, points and tiers, offer codes',
  'Loyalty & coupons', 'Bring customers back: a free item on every few visits, points, and offer codes.', 'Visit card', 'Points & tiers', 'Coupons', 'Loyalty is set up by owners and admins.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Save', 'Back', 'Cancel', 'Saved.', 'You have changes not saved yet.', 'Remove', 'Optional', 'Edit',
  'Visit card on', 'What is free?', 'Choose from your menu…', 'Change', 'How many free', 'On which visit?', 'Visit {n}', 'Which bills earn a stamp?', 'Every bill', '₹100 or more', '₹150 or more', '₹300 or more', 'Minimum bill (₹)', 'Visit number',
  'Customers get {item} free on their visit {n}, then the card starts again.', 'Pick the item that will be free.', 'Only bills of {value} or more earn a stamp.', 'Worth {value} to the customer.',
  'A customer is their mobile number. Every day they are billed counts as one visit, at any outlet. On the visit that earns it, the free item comes off the bill once it is on the order (the till offers to add it).',
  'Members', '{n} new in the last 30 days', 'Came back, 30 days', '{n} visits stamped', 'Free items given', '{n} in 30 days · worth {value}', 'Not back in 60 days', 'Free item due now', 'One visit away', 'Their next bill gets the free item. A nice reason to call them in.', 'One more visit and the next one is free.',
  'Nobody has a reward waiting.', 'Nobody is one visit away right now.', '{visits} visits · last {when}', 'today', 'yesterday', '{n} days ago', 'How often members come', 'Visits on the card since they joined.', 'Once', '2–3 times', '4–6 times', '7 or more', 'Your regulars', 'Free item due', '{visits} visits', 'and {n} more.',
  'Visits needed must be a whole number from 2 to 50', 'Minimum bill must be a number', 'Choose the free item before switching the program on',
  'Loyalty points are on', 'Points earned per ₹100 paid', 'A bill of ₹500 earns {n} points.', 'One point is worth (in rupees)', 'What a customer saves per point spent.', 'Least points that can be spent', 'Most of one bill points can pay (%)', 'Tiers',
  'A tier is decided by the points a customer has earned over time (spending points never lowers it). A higher tier earns points faster. The first tier must start at 0. Leave empty for no tiers.', 'Tier name', 'From points', '× earning', 'Add tier',
  'Customers with points', 'Points outstanding', 'Earned, last 30 days', 'Spent, last 30 days', '{points} ({value})', '{points} ({value} off)', 'Top holders', '{balance} points', '{earned} earned over time',
  'Give or take points', 'Customer mobile number', 'Find', 'No customer with that number.', 'Points for {name}', 'Negative takes away', 'Reason (kept in their history)', 'Birthday gift, service recovery…', '{name} now has {balance} points',
  'Points per Rs 100 must be above 0 and at most 100', 'A point must be worth between Rs 0.01 and Rs 1000', 'The minimum to use must be a whole number of points', 'The most a bill can be paid with points must be 1 to 100 percent', 'Up to six tiers', 'Every tier needs a name (up to 30 characters)',
  'Points to reach a tier must be a whole number, 0 or more', 'Two tiers start at the same number of points', 'The earning multiplier must be from 1 to 10', 'The first tier must start at 0 points so everyone has one', 'Say why, so it is kept in their history', 'Enter a whole number of points (negative takes away)',
  'New coupon', 'Edit {code}', 'Code', 'What the customer says or types.', 'Type', 'Percent off', 'Flat amount off', 'Percent', 'Amount (₹)', 'Note for staff', 'Most it can take off (₹)', 'Starts', 'Ends', 'Total uses', 'Blank = unlimited', 'Uses per customer', 'Needs the customer’s mobile at billing',
  'Create coupon', 'Save changes', 'Turn off', 'Turn on', 'Live', 'Off', 'Expired', 'Scheduled', 'Used up', '{value}% off', '{value} off', '(max {value})', 'on bills of {value}+', 'Always', 'Used {n}', 'Used {n} / {max}', 'given off {value}',
  'No coupons yet. Create one and give the code to a customer; the cashier enters it at billing.', 'Code must be 3 to 24 letters, numbers, - or _', 'Enter how much the coupon takes off', 'A percentage can’t be more than 100', 'Amounts must be numbers', 'Uses must be a whole number above zero',
  'Dates are written like 2026-10-31', 'The end date is before the start date', 'Name'
];
