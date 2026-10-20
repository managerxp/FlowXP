/*
 * Salon settings on the phone (owner and admin): the business profile and outlets, opening hours and booking rules, online booking, tax and payment
 * methods, commission rules, loyalty earning rates, what the client segments mean, stock alerts, and the automatic messages and campaigns. The same as
 * the website's Salon settings page, six tabs; the server checks everything again. The business name, address, GSTIN and invoice numbering stay in
 * Business settings. (lib/salon.ts is the daily-use till; this is the set-up.) Pure: types, forms, checks, bodies and wording.
 */
import { t } from './i18n.ts';

export const canSalonSetup = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';
const whole = (v: string): boolean => /^\d+$/.test(v.trim());
const num = (v: string): boolean => v.trim() !== '' && Number.isFinite(Number(v));
const isTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const WEEKDAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
export const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', WALLET: 'Wallet' };
export const KIND_LABEL: Record<string, string> = { SERVICE: 'Services', PRODUCT: 'Retail products', PACKAGE: 'Packages', MEMBERSHIP: 'Memberships', GIFT_CARD: 'Gift cards' };
export const SEGMENT_CHOICES: [string, string][] = [['NEW', 'New clients'], ['RETURNING', 'Returning clients'], ['VIP', 'VIP clients'], ['HIGH_SPENDER', 'High spenders'], ['FREQUENT', 'Frequent visitors'], ['MEMBER', 'Members'], ['INACTIVE_30', 'Inactive 30+ days'], ['INACTIVE_60', 'Inactive 60+ days'], ['INACTIVE_90', 'Inactive 90+ days']];
export const toggleDay = (days: number[], d: number): number[] => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b));

export type SalonBranch = { branch_id: number; name: string; city?: string | null; state?: string | null; is_primary: boolean; working_days: number[] | null; open_time: string | null; close_time: string | null; slot_minutes: number | null; ownership: 'OWNED' | 'FRANCHISE'; franchisee_name: string | null };
export type Policy = { min_notice_hours?: number; fee_pct?: number; text?: string };
export type SalonSettings = {
  pan: string | null; registration_type: string | null; registration_no: string | null; working_days: number[]; open_time: string; close_time: string; slot_minutes: number; min_advance_minutes: number; max_advance_days: number; buffer_minutes: number;
  cancellation_policy: Policy; no_show_policy: Policy; tax_inclusive: boolean; default_service_tax_rate: number; default_product_tax_rate: number; default_service_sac: string | null; commission_on_package_use: boolean; commission_base: 'NET' | 'GROSS';
  expiry_alert_days: number; consumption_alert_factor: number; segment_rules: { new_days: number; vip_spend: number; vip_visits: number; high_spender: number; frequent_visits_90d: number; inactive_days: number[] }; payment_methods: string[];
  online_booking_enabled: boolean; online_booking_slug: string | null; online_booking_notice: string | null;
};
export type SettingsData = { settings: SalonSettings; branches: SalonBranch[]; choices: { payment_methods: string[]; slot_minutes: number[] } };

/* ── profile ─────────────────────────────────────────────────────────────── */
export type ProfileForm = { pan: string; registration_type: string; registration_no: string };
export const profileForm = (s: SalonSettings): ProfileForm => ({ pan: s.pan ?? '', registration_type: s.registration_type ?? '', registration_no: s.registration_no ?? '' });
export const profileProblem = (f: ProfileForm): string => (f.pan.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan.trim().toUpperCase()) ? 'The PAN looks like ABCDE1234F' : '');
export const profileBody = (f: ProfileForm): Record<string, unknown> => ({ pan: f.pan.trim().toUpperCase() || null, registration_type: f.registration_type.trim() || null, registration_no: f.registration_no.trim() || null });

/* ── hours and booking ───────────────────────────────────────────────────── */
export type HoursForm = {
  working_days: number[]; open_time: string; close_time: string; slot_minutes: string; min_advance_minutes: string; max_advance_days: string; buffer_minutes: string;
  cancel_hours: string; cancel_fee: string; cancel_text: string; noshow_fee: string; noshow_text: string;
};
const s2 = (v: number | undefined): string => (v == null ? '' : String(v));
export const hoursForm = (c: SalonSettings): HoursForm => ({
  working_days: c.working_days, open_time: c.open_time, close_time: c.close_time, slot_minutes: String(c.slot_minutes), min_advance_minutes: String(c.min_advance_minutes), max_advance_days: String(c.max_advance_days), buffer_minutes: String(c.buffer_minutes),
  cancel_hours: s2(c.cancellation_policy?.min_notice_hours), cancel_fee: s2(c.cancellation_policy?.fee_pct), cancel_text: c.cancellation_policy?.text ?? '', noshow_fee: s2(c.no_show_policy?.fee_pct), noshow_text: c.no_show_policy?.text ?? ''
});
export const hoursProblem = (f: HoursForm): string => {
  if (f.working_days.length === 0) return 'Choose at least one open day';
  if (!isTime(f.open_time) || !isTime(f.close_time)) return 'Times are written like 10:00';
  if (f.close_time <= f.open_time) return 'Closing time must be after opening time';
  if (!whole(f.min_advance_minutes) || !whole(f.buffer_minutes)) return 'Notice and gap are whole numbers of minutes';
  if (!whole(f.max_advance_days) || Number(f.max_advance_days) < 1) return 'Book up to is a whole number of days, 1 or more';
  for (const v of [f.cancel_hours, f.cancel_fee, f.noshow_fee]) if (v.trim() !== '' && !num(v)) return 'Hours and fees are numbers';
  for (const v of [f.cancel_fee, f.noshow_fee]) if (v.trim() !== '' && Number(v) > 100) return 'A fee is a percentage from 0 to 100';
  return '';
};
const pol = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
export const hoursBody = (f: HoursForm): Record<string, unknown> => ({
  working_days: f.working_days, open_time: f.open_time, close_time: f.close_time, slot_minutes: Number(f.slot_minutes), min_advance_minutes: Number(f.min_advance_minutes), max_advance_days: Number(f.max_advance_days), buffer_minutes: Number(f.buffer_minutes),
  cancellation_policy: pol({ min_notice_hours: f.cancel_hours.trim() === '' ? '' : Number(f.cancel_hours), fee_pct: f.cancel_fee.trim() === '' ? '' : Number(f.cancel_fee), text: f.cancel_text.trim() }),
  no_show_policy: pol({ fee_pct: f.noshow_fee.trim() === '' ? '' : Number(f.noshow_fee), text: f.noshow_text.trim() })
});
/** Whether an outlet keeps its own hours (otherwise it follows the default). */
export const ownHours = (b: SalonBranch): boolean => b.open_time != null || b.working_days != null;
export const outletOnBody = (f: Pick<HoursForm, 'open_time' | 'close_time' | 'working_days'>): Record<string, unknown> => ({ open_time: f.open_time, close_time: f.close_time, working_days: f.working_days });
export const outletOffBody = (): Record<string, unknown> => ({ open_time: null, close_time: null, working_days: null, slot_minutes: null });
export const outletLine = (b: SalonBranch): string => [b.city, b.state].filter(Boolean).join(', ');

export type OnlineForm = { enabled: boolean; slug: string; notice: string };
export const onlineForm = (c: SalonSettings): OnlineForm => ({ enabled: Boolean(c.online_booking_enabled), slug: c.online_booking_slug ?? '', notice: c.online_booking_notice ?? '' });
export const cleanSlug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9-]/g, '');
export const onlineProblem = (f: OnlineForm): string => (f.enabled && !f.slug.trim() ? 'Choose your booking address first' : f.slug && f.slug.length < 3 ? 'The address is at least 3 letters or numbers' : '');
export const onlineBody = (f: OnlineForm): Record<string, unknown> => ({ online_booking_enabled: f.enabled, online_booking_slug: f.slug || null, online_booking_notice: f.notice.trim() || null });
export const bookingLink = (origin: string, slug: string): string => (slug ? `${origin.replace(/\/$/, '')}/book/${slug}` : '');

/* ── tax and payments ────────────────────────────────────────────────────── */
export type TaxForm = { tax_inclusive: boolean; default_service_tax_rate: string; default_product_tax_rate: string; default_service_sac: string; payment_methods: string[]; commission_base: 'NET' | 'GROSS'; commission_on_package_use: boolean };
export const taxForm = (c: SalonSettings): TaxForm => ({ tax_inclusive: c.tax_inclusive, default_service_tax_rate: String(c.default_service_tax_rate), default_product_tax_rate: String(c.default_product_tax_rate), default_service_sac: c.default_service_sac ?? '', payment_methods: c.payment_methods, commission_base: c.commission_base, commission_on_package_use: c.commission_on_package_use });
export const taxProblem = (f: TaxForm): string => {
  for (const v of [f.default_service_tax_rate, f.default_product_tax_rate]) if (!num(v) || Number(v) < 0 || Number(v) > 100) return 'A GST rate is a percentage from 0 to 100';
  if (f.payment_methods.length === 0) return 'Keep at least one method on.';
  return '';
};
export const taxBody = (f: TaxForm): Record<string, unknown> => ({ ...f, default_service_tax_rate: Number(f.default_service_tax_rate), default_product_tax_rate: Number(f.default_product_tax_rate), default_service_sac: f.default_service_sac.trim() || null });
export const toggleMethod = (list: string[], m: string): string[] => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);

/* ── loyalty ─────────────────────────────────────────────────────────────── */
export type LoyaltyData = { enabled: boolean; program: { earn_per_100: number; point_value: number; min_redeem_points: number; max_redeem_pct: number } | null; expiry_days: number | null; rules: Record<string, { earn_per_100: number | null; is_enabled: boolean }> };
export type LoyaltySummary = { days: number; issued: number; redeemed: number; expired: number; holders: number; outstanding_points: number; liability: number };
export type LoyaltyForm = { expiry_days: string; rules: Record<string, { earn_per_100: string; is_enabled: boolean }> };
export const loyaltyForm = (d: LoyaltyData): LoyaltyForm => ({ expiry_days: d.expiry_days == null ? '' : String(d.expiry_days), rules: Object.fromEntries(Object.entries(d.rules).map(([k, v]) => [k, { earn_per_100: v.earn_per_100 == null ? '' : String(v.earn_per_100), is_enabled: v.is_enabled !== false }])) });
export const loyaltyProblem = (f: LoyaltyForm): string => {
  if (f.expiry_days.trim() !== '' && (!whole(f.expiry_days) || Number(f.expiry_days) < 30)) return 'Points last at least 30 days, or leave empty so they never expire';
  for (const r of Object.values(f.rules)) if (r.earn_per_100.trim() !== '' && (!num(r.earn_per_100) || Number(r.earn_per_100) < 0)) return 'Points per ₹100 is a number';
  return '';
};
export const loyaltyBody = (f: LoyaltyForm): Record<string, unknown> => ({
  expiry_days: f.expiry_days.trim() === '' ? null : Number(f.expiry_days),
  rules: Object.fromEntries(Object.entries(f.rules).map(([k, r]) => [k, { earn_per_100: r.earn_per_100.trim() === '' ? null : Number(r.earn_per_100), is_enabled: r.is_enabled }]))
});
export const programText = (d: LoyaltyData): string => (d.enabled && d.program ? t('Loyalty is on: {earn} points per ₹100, each worth ₹{value}; at least {min} points to use, up to {max}% of a bill.', { earn: d.program.earn_per_100, value: d.program.point_value, min: d.program.min_redeem_points, max: d.program.max_redeem_pct }) : t('Loyalty points are off.'));
export const summaryNote = (s: LoyaltySummary): string => t('{n} people · worth ₹{value}', { n: s.holders, value: Math.round(s.liability).toLocaleString('en-IN') });

/* ── clients and stock ───────────────────────────────────────────────────── */
export type SegmentForm = { new_days: string; vip_spend: string; vip_visits: string; high_spender: string; frequent_visits_90d: string; inactive_days: string; expiry_alert_days: string; consumption_alert_factor: string };
export const segmentForm = (c: SalonSettings): SegmentForm => { const r = c.segment_rules; return { new_days: String(r.new_days), vip_spend: String(r.vip_spend), vip_visits: String(r.vip_visits), high_spender: String(r.high_spender), frequent_visits_90d: String(r.frequent_visits_90d), inactive_days: r.inactive_days.join(', '), expiry_alert_days: String(c.expiry_alert_days), consumption_alert_factor: String(c.consumption_alert_factor) }; };
export const inactiveDays = (v: string): number[] => v.split(',').map((x) => Number(x.trim())).filter(Boolean);
export const segmentProblem = (f: SegmentForm): string => {
  for (const v of [f.new_days, f.vip_spend, f.vip_visits, f.high_spender, f.frequent_visits_90d, f.expiry_alert_days]) if (!num(v) || Number(v) < 0) return 'These are numbers, 0 or more';
  if (!(Number(f.consumption_alert_factor) >= 1.2)) return 'Unusual use is flagged at 1.2 times the usual or more';
  const d = inactiveDays(f.inactive_days);
  if (d.length === 0 || d.length > 3) return 'Give one to three inactive-day limits, like 30, 60, 90';
  return '';
};
export const segmentBody = (f: SegmentForm): Record<string, unknown> => ({
  segment_rules: { new_days: Number(f.new_days), vip_spend: Number(f.vip_spend), vip_visits: Number(f.vip_visits), high_spender: Number(f.high_spender), frequent_visits_90d: Number(f.frequent_visits_90d), inactive_days: inactiveDays(f.inactive_days) },
  expiry_alert_days: Number(f.expiry_alert_days), consumption_alert_factor: Number(f.consumption_alert_factor)
});

/* ── messages ────────────────────────────────────────────────────────────── */
export type Automation = { key: string; label: string; description: string; internal: boolean; is_enabled: boolean; config: Record<string, number | string>; defaults: Record<string, number | string> };
export type Automations = { channel: string; channel_on: boolean; automations: Automation[] };
export const CONFIG_LABEL: Record<string, string> = { hours_before: 'Hours before', days_before: 'Days before', days_after: 'Days after the visit', days: 'Days without a visit', days_overdue: 'Days overdue', repeat_days: 'Repeat every', offer_text: 'Message' };
export const automationDirty = (a: Automation, on: boolean, config: Record<string, number | string>): boolean => on !== a.is_enabled || JSON.stringify(config) !== JSON.stringify(a.config);
/** The settings of one automation as sent: every number a whole number from 1, the offer text as written. */
export const automationProblem = (config: Record<string, number | string>): string => { for (const [k, v] of Object.entries(config)) if (k !== 'offer_text' && (!whole(String(v)) || Number(v) < 1)) return 'These are whole numbers, 1 or more'; return ''; };
export const automationBody = (on: boolean, config: Record<string, number | string>): { is_enabled: boolean; config: Record<string, number | string> } => ({ is_enabled: on, config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, k === 'offer_text' ? String(v) : Number(v)])) });
export const campaignProblem = (text: string, count: number | undefined): string => (text.trim().length < 5 ? 'Write the message (5 to 300 characters)' : !count ? 'Nobody is in that group right now' : '');
export const audienceText = (a: { count: number; sample: string[] } | null): string => (!a ? t('Counting…') : a.count === 1 ? t('1 client would receive it{names}.', { names: a.sample.length ? ` (${a.sample.join(', ')})` : '' }) : t('{n} clients would receive it{names}.', { n: a.count, names: a.sample.length ? ` (${a.sample.join(', ')}${a.count > a.sample.length ? '…' : ''})` : '' }));

export const SALON_SETUP_TEXTS: string[] = [
  'Salon settings', 'How your salon works. Every rule here is yours to change.', 'Profile', 'Hours & booking', 'Tax & payments', 'Loyalty', 'Clients & stock', 'Messages', 'Only owners and admins can change salon settings.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back', 'Saved', 'Save changes',
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'Business profile', 'These print on your tax invoices.', 'The business name, address, GSTIN, logo and invoice numbering are in Business settings.', 'PAN', 'Like ABCDE1234F', 'Registration type', 'e.g. Shops & Establishments', 'Registration number', 'The PAN looks like ABCDE1234F',
  'Outlets', 'Mark outlets you run yourself or that a franchisee runs. Add outlets under Outlets.', 'Main', 'Owned', 'Franchise', 'Franchisee name',
  'Opening hours', 'The default for every outlet. Each person can have their own hours under Team.', 'Open on', 'Opens', 'Closes', 'Booking slots every', '{n} minutes', 'Booking rules', 'Shortest notice (minutes)', '0 lets clients book right now', 'Book up to (days ahead)', 'Gap between clients (minutes)', 'Kept free after every booking',
  'Cancellations and no-shows', 'Shown to the team when it happens. Nothing is charged automatically.', 'Free cancellation until (hours before)', 'Late cancellation fee (%)', 'Cancellation policy wording', 'No-show fee (%)', 'No-show policy wording',
  'Different hours at an outlet', 'Leave an outlet as it is to use the default hours above.', 'Its own hours', 'Outlet hours saved', 'Choose at least one open day', 'Times are written like 10:00', 'Closing time must be after opening time', 'Notice and gap are whole numbers of minutes', 'Book up to is a whole number of days, 1 or more', 'Hours and fees are numbers', 'A fee is a percentage from 0 to 100',
  'Online booking', 'A page clients can use to book themselves, without calling. It follows your opening hours, team hours, leave and booking rules.', 'Let clients book online', 'Needs the Appointments feature on your plan.', 'Your booking address', 'Letters, numbers and dashes. This becomes part of the link.', 'Message at the top of the page', 'Optional — parking, what to bring, a festive notice.',
  'Online bookings arrive as Booked appointments marked Online. One mobile number can hold up to three upcoming online bookings.', 'Share link', 'Choose your booking address first', 'The address is at least 3 letters or numbers', 'Online booking is on',
  'GST', 'Whether GST applies at all is set in Business settings. Rates can be different on each service and product.', 'Prices are', 'Before GST — tax added on top', 'Including GST — tax is inside the price', 'GST is added on top of the price you type.', 'The price you type is what the client pays; GST is worked out from inside it.', 'New services start at (%)', 'New products start at (%)', 'Default SAC code',
  'Payment methods at the till', 'Gift cards and pay-later follow what you sell and who the client is.', 'Cash', 'UPI', 'Card', 'Bank transfer', 'Wallet', 'Keep at least one method on.', 'A GST rate is a percentage from 0 to 100', 'Commission rules', 'Commission is worked out on', 'What the client paid (after discounts)', 'The price before discounts', 'Either way, GST is never part of it.',
  'Pay commission when a service is used from a package or membership', 'Worked out on the service’s list price, since nothing is charged at the time.',
  'The programme', 'Points per ₹100, what a point is worth, and the most a bill can be paid with points.', 'Loyalty is on: {earn} points per ₹100, each worth ₹{value}; at least {min} points to use, up to {max}% of a bill.', 'Loyalty points are off.', 'Set the programme and tiers on the Loyalty screen.',
  'Earning rates by kind of sale', 'Leave the rate empty to use the programme’s rate. Turn a kind off and it earns nothing. Gift cards never earn.', 'Services', 'Retail products', 'Packages', 'Memberships', 'Gift cards', 'Points per ₹100', 'Earns points', 'Expiry', 'How long points last. Empty means they never expire.', 'Points expire after (days)',
  'Points expire on their own once a day. Clients are warned first if the Loyalty points expiry message is on under Messages.', 'Expire old points now', 'Expire old points now?', 'Points older than the expiry period are taken off clients’ balances. Running it twice changes nothing more.', 'Expire points', '{n} points expired', 'Cancel',
  'Last 30 days', 'Issued', 'Used', 'Expired', 'Owed to clients', '{n} people · worth ₹{value}', 'Points last at least 30 days, or leave empty so they never expire', 'Points per ₹100 is a number', 'Save loyalty rules', 'Loyalty rules saved',
  'What the client segments mean', 'Used by the client list, reminders and campaigns.', 'New client for (days)', 'After their first visit', 'VIP: spent at least (₹)', 'VIP: visits at least', 'High spender: average bill at least (₹)', 'Frequent: visits in 90 days', 'Inactive after (days, up to three)', 'e.g. 30, 60, 90',
  'Stock alerts', 'Warn about expiry (days before)', 'Flag unusual use at (× the usual)', 'Compares this week with the previous four', 'These are numbers, 0 or more', 'Unusual use is flagged at 1.2 times the usual or more', 'Give one to three inactive-day limits, like 30, 60, 90',
  'Messages are switched off, so nothing will be sent yet. Choose a channel under Messaging: WhatsApp, SMS or both, through the provider you use.', 'Automatic messages', 'They go out by themselves, only to clients who have a mobile number and have not opted out.', 'Check now', 'Checked — anything due has been sent', 'Team only', 'On', 'Off',
  'Hours before', 'Days before', 'Days after the visit', 'Days without a visit', 'Days overdue', 'Repeat every', 'Message', 'These are whole numbers, 1 or more', 'Save',
  'Appointment confirmations', 'Tell a client when an appointment is booked or cancelled.', 'Appointment reminder', 'Remind a client before their appointment.', 'Birthday message', 'Wish a client on their birthday.', 'Anniversary message', 'Wish a client on their anniversary.', 'Membership expiry reminder', 'Remind a member before their membership ends.',
  'Loyalty points expiry', 'Warn a client before their points expire.', 'Revisit reminder', 'Invite a client back some days after their last visit.', 'Inactive customer reminder', 'Win back a client who has not visited for a long time.', 'Payment reminder', 'Remind a client about a bill that is still unpaid.', 'Stock alerts', 'Notify the team about low, expiring and expired stock.',
  'Enjoy a special treat on us this month.', 'Celebrate with a little something from us.', 'Come back and see what is new.',
  'Send a campaign', 'One message to a group of clients. One campaign an hour.', 'Who', 'New clients', 'Returning clients', 'VIP clients', 'High spenders', 'Frequent visitors', 'Members', 'Inactive 30+ days', 'Inactive 60+ days', 'Inactive 90+ days', 'Counting…',
  '1 client would receive it{names}.', '{n} clients would receive it{names}.', 'Your salon’s name is added. 5–300 characters.', 'Come in this week and enjoy 15% off any service.', 'Send to {n} people?', 'This goes out now and cannot be recalled.', 'Send campaign', 'Sent to {n} people', 'Write the message (5 to 300 characters)', 'Nobody is in that group right now',
  'Hours, booking, tax, loyalty, reminders and campaigns'
];
