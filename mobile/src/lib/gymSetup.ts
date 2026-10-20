/*
 * Gym set-up on the phone (people with the gym set-up right): the membership plans the gym sells, and the rules every check-in follows, each branch's
 * opening hours and holidays, and the entrance QR. The same as the website's Plans and Gym settings pages; the server checks everything again.
 * A plan only changes the next sale: each membership keeps the rules it was sold with. (Devices, the QR poster to print, and the check-in desk's
 * own screens are on the website or in lib/gym.ts.) Pure: types, wording, the forms, their checks and the bodies sent.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));
export const canGymSetup = (can: (perm: string) => boolean): boolean => can('gym_setup');
const whole = (v: string): boolean => /^\d+$/.test(v.trim());
const isDay = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/* ── plans ───────────────────────────────────────────────────────────────── */
export const AUDIENCES: [string, string][] = [['STANDARD', 'Anyone'], ['STUDENT', 'Students'], ['FAMILY', 'Family'], ['CORPORATE', 'Corporate']];
export const PAYMENT_POLICIES: [string, string][] = [['FULL_REQUIRED', 'Paid in full before they can come in'], ['ANY_PAYMENT', 'Any payment lets them in'], ['PAY_LATER', 'Can come in for a few days, then paid in full']];
export const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
export const DURATIONS: [string, string][] = [['30', 'Monthly'], ['90', 'Quarterly'], ['180', 'Half-yearly'], ['365', 'Yearly'], ['custom', 'Another length']];

export type TimeWindow = { days?: number[]; from?: string; to?: string } | null;
export type Plan = {
  plan_id: number; name: string; description: string | null; kind?: string; audience: string; duration_days: number; price: number; tax_rate: number | string; max_members: number; allowed_branch_ids: number[] | null; time_window: TimeWindow;
  grace_days: number | null; payment_policy: string; pay_later_days: number; freeze_allowed: boolean; max_freeze_days: number; is_active: boolean; sessions?: number | null;
};
export type Branch = { branch_id: number; name: string; city?: string | null; is_primary?: boolean; status?: string; hours: Record<string, { open: string; close: string }> | null; holidays: string[]; checkin_token?: string; checkin_url: string };

export const durationText = (days: number): string => {
  if (days % 365 === 0) return days === 365 ? t('1 year') : t('{n} years', { n: days / 365 });
  if (days % 30 === 0) return days === 30 ? t('1 month') : t('{n} months', { n: days / 30 });
  return t('{n} days', { n: days });
};
export const windowText = (w: TimeWindow): string => {
  if (!w) return t('Any time the gym is open');
  const days = w.days?.length ? DAYS.filter(([d]) => w.days!.includes(d)).map(([, n]) => t(n)).join(', ') : t('Every day');
  return `${days}${w.from ? `, ${t('{from} to {to}', { from: w.from, to: w.to ?? '' })}` : ''}`;
};
export const audienceText = (a: string): string => t(AUDIENCES.find(([v]) => v === a)?.[1] ?? a);
export const paymentText = (p: Plan): string => t(PAYMENT_POLICIES.find(([v]) => v === p.payment_policy)?.[1] ?? p.payment_policy) + (p.payment_policy === 'PAY_LATER' ? ` (${t('{n} days', { n: p.pay_later_days })})` : '');
export const planPriceText = (p: Plan): string => t('{price} + {tax}% GST', { price: money(p.price), tax: Number(p.tax_rate) });
export const planSub = (p: Plan, branches: Branch[]): string => [
  durationText(p.duration_days) + (p.audience !== 'STANDARD' ? ` · ${audienceText(p.audience)}` : '') + (p.max_members > 1 ? ` · ${t('covers {n} people', { n: p.max_members })}` : ''),
  paymentText(p), windowText(p.time_window),
  p.allowed_branch_ids ? t('Only at: {names}', { names: branches.filter((b) => p.allowed_branch_ids!.includes(b.branch_id)).map((b) => b.name).join(', ') }) : t('Every branch'),
  (p.freeze_allowed ? t('Can freeze up to {n} days', { n: p.max_freeze_days }) : t('Cannot be frozen')) + (p.grace_days != null ? ` · ${t('{n} grace days', { n: p.grace_days })}` : '')
].join(' · ');

export type PlanForm = {
  name: string; description: string; audience: string; duration_days: string; custom: boolean; price: string; tax_rate: string; max_members: string; payment_policy: string; pay_later_days: string; grace_days: string;
  freeze_allowed: boolean; max_freeze_days: string; branches: number[]; timed: boolean; days: number[]; from: string; to: string;
};
export const emptyPlan = (): PlanForm => ({
  name: '', description: '', audience: 'STANDARD', duration_days: '30', custom: false, price: '', tax_rate: '18', max_members: '1', payment_policy: 'FULL_REQUIRED', pay_later_days: '3', grace_days: '',
  freeze_allowed: true, max_freeze_days: '30', branches: [], timed: false, days: [1, 2, 3, 4, 5, 6, 0], from: '06:00', to: '22:00'
});
export const planForm = (p: Plan): PlanForm => ({
  name: p.name, description: p.description ?? '', audience: p.audience, duration_days: String(p.duration_days), custom: !DURATIONS.some(([d]) => d === String(p.duration_days)), price: String(p.price), tax_rate: String(Number(p.tax_rate)),
  max_members: String(p.max_members), payment_policy: p.payment_policy, pay_later_days: String(p.pay_later_days || 3), grace_days: p.grace_days == null ? '' : String(p.grace_days), freeze_allowed: p.freeze_allowed, max_freeze_days: String(p.max_freeze_days || 30),
  branches: p.allowed_branch_ids ?? [], timed: Boolean(p.time_window), days: p.time_window?.days ?? [1, 2, 3, 4, 5, 6, 0], from: p.time_window?.from ?? '06:00', to: p.time_window?.to ?? '22:00'
});
export const planProblem = (f: PlanForm): string => {
  if (!f.name.trim()) return 'Give the plan a name';
  if (!(Number(f.duration_days) >= 1) || !whole(f.duration_days)) return 'The length is a whole number of days, 1 or more';
  if (f.price.trim() === '' || !(Number(f.price) >= 0)) return 'Enter the price (before GST)';
  if (!(Number(f.tax_rate) >= 0 && Number(f.tax_rate) <= 100)) return 'The GST rate is a percentage from 0 to 100';
  if (!whole(f.max_members) || Number(f.max_members) < 1) return 'People covered is a whole number, 1 or more';
  if (f.payment_policy === 'PAY_LATER' && (!whole(f.pay_later_days) || Number(f.pay_later_days) < 1)) return 'Days before paying is a whole number, 1 or more';
  if (f.grace_days.trim() !== '' && !whole(f.grace_days)) return 'Grace days is a whole number, or empty to use the gym\'s default';
  if (f.freeze_allowed && (!whole(f.max_freeze_days) || Number(f.max_freeze_days) < 1)) return 'Most freeze days is a whole number, 1 or more';
  if (f.timed) { if (f.days.length === 0) return 'Choose at least one day'; if (!isTime(f.from) || !isTime(f.to)) return 'Times are written like 06:00'; }
  return '';
};
/** The body of POST/PUT /gym/plans. A plan open at every branch sends null; an off-peak window sends days and times. */
export const planBody = (f: PlanForm, allBranchIds: number[]): Record<string, unknown> => ({
  name: f.name.trim(), description: f.description.trim() || null, audience: f.audience, duration_days: Number(f.duration_days), price: Number(f.price), tax_rate: Number(f.tax_rate), max_members: Number(f.max_members),
  payment_policy: f.payment_policy, pay_later_days: f.payment_policy === 'PAY_LATER' ? Number(f.pay_later_days) : 0, grace_days: f.grace_days.trim() === '' ? null : Number(f.grace_days),
  freeze_allowed: f.freeze_allowed, max_freeze_days: f.freeze_allowed ? Number(f.max_freeze_days) : 0,
  allowed_branch_ids: f.branches.length && f.branches.length < allBranchIds.length ? f.branches : null,
  time_window: f.timed ? { days: f.days, from: f.from, to: f.to } : null
});
export const toggleIn = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
/** Whether a branch is ticked: none ticked means every branch. */
export const branchOn = (f: PlanForm, id: number): boolean => f.branches.length === 0 || f.branches.includes(id);
export const toggleBranch = (f: PlanForm, id: number, all: number[]): number[] => { const cur = f.branches.length ? f.branches : all; return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; };

/* ── settings ────────────────────────────────────────────────────────────── */
export type GymSettings = {
  member_prefix: string; public_slug: string | null; grace_days: number; cooldown_seconds: number; visits_per_day: number; checkout_enabled: boolean; reception_confirm: boolean; self_checkin_enabled: boolean; self_checkin_daily_code: boolean;
  self_checkin_fresh_otp_minutes: number | null; session_days: number; pass_ttl_seconds: number; travel_minutes: number; class_cancel_hours: number; pt_cancel_hours: number; class_booking_days: number; class_waitlist: boolean; portal_url?: string | null; branches: Branch[];
};
export type SettingsForm = {
  member_prefix: string; public_slug: string; grace_days: string; cooldown_seconds: string; visits_per_day: string; checkout_enabled: boolean; reception_confirm: boolean; self_checkin_enabled: boolean; self_checkin_daily_code: boolean;
  fresh: boolean; fresh_minutes: string; session_days: string; pass_ttl_seconds: string; travel_minutes: string; class_cancel_hours: string; pt_cancel_hours: string; class_booking_days: string; class_waitlist: boolean;
};
export const settingsForm = (s: GymSettings): SettingsForm => ({
  member_prefix: s.member_prefix, public_slug: s.public_slug ?? '', grace_days: String(s.grace_days), cooldown_seconds: String(s.cooldown_seconds), visits_per_day: String(s.visits_per_day), checkout_enabled: s.checkout_enabled, reception_confirm: s.reception_confirm,
  self_checkin_enabled: s.self_checkin_enabled, self_checkin_daily_code: s.self_checkin_daily_code, fresh: s.self_checkin_fresh_otp_minutes != null, fresh_minutes: String(s.self_checkin_fresh_otp_minutes ?? 10), session_days: String(s.session_days),
  pass_ttl_seconds: String(s.pass_ttl_seconds), travel_minutes: String(s.travel_minutes), class_cancel_hours: String(s.class_cancel_hours), pt_cancel_hours: String(s.pt_cancel_hours), class_booking_days: String(s.class_booking_days), class_waitlist: s.class_waitlist
});
type IntRule = [keyof SettingsForm, string, number, number];
export const INT_RULES: IntRule[] = [
  ['grace_days', 'Grace days after a membership ends', 0, 60], ['cooldown_seconds', 'Ignore a repeat scan for (seconds)', 0, 3600], ['visits_per_day', 'Most visits a day (0 = no limit)', 0, 20], ['travel_minutes', 'Same card at two branches within (minutes)', 0, 1440],
  ['session_days', 'Stay signed in for (days)', 1, 90], ['pass_ttl_seconds', 'A phone pass QR lasts (seconds)', 15, 600], ['class_cancel_hours', 'Cancel a class free until (hours before)', 0, 168], ['pt_cancel_hours', 'Cancel personal training free until (hours before)', 0, 168],
  ['class_booking_days', 'Members can book up to (days ahead)', 1, 90]
];
export const settingsProblem = (f: SettingsForm): string => {
  if (!/^[A-Za-z0-9]{1,8}$/.test(f.member_prefix.trim())) return 'The member code prefix is 1 to 8 letters or digits';
  if (f.public_slug.trim() && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(f.public_slug.trim())) return 'The address is 3 to 40 letters, digits or hyphens';
  for (const [k, label, min, max] of INT_RULES) { const v = String(f[k]); if (!whole(v) || Number(v) < min || Number(v) > max) return t('{label} must be a whole number from {min} to {max}', { label: t(label), min, max }); }
  if (f.fresh && (!whole(f.fresh_minutes) || Number(f.fresh_minutes) < 1 || Number(f.fresh_minutes) > 1440)) return 'A code counts for 1 to 1440 minutes';
  return '';
};
export const settingsBody = (f: SettingsForm): Record<string, unknown> => ({
  member_prefix: f.member_prefix.trim().toUpperCase(), public_slug: f.public_slug.trim().toLowerCase(), grace_days: Number(f.grace_days), cooldown_seconds: Number(f.cooldown_seconds), visits_per_day: Number(f.visits_per_day),
  checkout_enabled: f.checkout_enabled, reception_confirm: f.reception_confirm, self_checkin_enabled: f.self_checkin_enabled, self_checkin_daily_code: f.self_checkin_daily_code, self_checkin_fresh_otp_minutes: f.fresh ? Number(f.fresh_minutes || 10) : null,
  session_days: Number(f.session_days), pass_ttl_seconds: Number(f.pass_ttl_seconds), travel_minutes: Number(f.travel_minutes), class_cancel_hours: Number(f.class_cancel_hours), pt_cancel_hours: Number(f.pt_cancel_hours),
  class_booking_days: Number(f.class_booking_days), class_waitlist: f.class_waitlist
});
export const portalText = (s: Pick<GymSettings, 'public_slug' | 'portal_url'>): string => (s.public_slug ? t('Members open {url}', { url: s.portal_url ?? `/gym/${s.public_slug}` }) : t('Letters, digits and hyphens. Needed for members to sign in.'));

/* ── hours and holidays ──────────────────────────────────────────────────── */
export type Hours = Record<string, { open: string; close: string }> | null;
export const defaultHours = (): NonNullable<Hours> => Object.fromEntries([1, 2, 3, 4, 5, 6, 0].map((d) => [String(d), { open: '06:00', close: '22:00' }]));
export const setDayHours = (h: Hours, day: number, v: { open: string; close: string } | null): Hours => { const n = { ...(h ?? {}) }; if (v) n[String(day)] = v; else delete n[String(day)]; return n; };
export const holidaysOf = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean);
export const hoursProblem = (h: Hours, holidays: string): string => {
  if (h) for (const [, v] of Object.entries(h)) { if (!isTime(v.open) || !isTime(v.close)) return 'Times are written like 06:00'; if (v.close <= v.open) return 'Closing time must be after opening time'; }
  for (const d of holidaysOf(holidays)) if (!isDay(d)) return t('{date} is not a date. Write one a line, like 2026-11-08.', { date: d });
  return '';
};
export const hoursBody = (h: Hours, holidays: string): { hours: Hours; holidays: string[] } => ({ hours: h, holidays: holidaysOf(holidays) });

export const GYM_SETUP_TEXTS: string[] = [
  'Gym plans', 'What you sell. Each membership keeps the rules it was sold with, so changing a plan only affects the next sale.', 'New plan', 'No plans yet.', 'Add a monthly plan to start selling memberships.', 'Off sale', 'Take off sale', 'Put back on sale', 'Plan is back on sale', 'Plan taken off sale',
  'Anyone', 'Students', 'Family', 'Corporate', 'Paid in full before they can come in', 'Any payment lets them in', 'Can come in for a few days, then paid in full', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Another length',
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', '1 year', '{n} years', '1 month', '{n} months', '{n} days', 'Any time the gym is open', 'Every day', '{from} to {to}', '{price} + {tax}% GST', 'covers {n} people', 'Only at: {names}', 'Every branch', 'Can freeze up to {n} days', 'Cannot be frozen', '{n} grace days',
  'Edit {name}', 'Changing a plan does not change memberships already sold: each keeps the rules it was sold with.', 'Name', 'Monthly, Student quarterly, Off-peak annual', 'Who it is for', 'Length', 'Length in days', 'Price (₹, before GST)', 'GST rate', 'Gym memberships are usually 18%.', 'Description (optional)', 'People covered', 'The person who pays plus the others on the same membership.',
  'Payment and access', 'Can they come in before they have paid?', 'Days they can come in before paying', 'Grace days after it ends (optional)', 'Empty uses the gym\'s default. 0 means none for this plan.', 'Where and when it works', 'Branches', 'Only at certain times (an off-peak plan)', 'Days', 'From', 'To', 'Members can freeze it', 'Most days they can freeze in all', 'Save plan', 'Create plan',
  'Give the plan a name', 'The length is a whole number of days, 1 or more', 'Enter the price (before GST)', 'The GST rate is a percentage from 0 to 100', 'People covered is a whole number, 1 or more', 'Days before paying is a whole number, 1 or more', 'Grace days is a whole number, or empty to use the gym\'s default', 'Most freeze days is a whole number, 1 or more', 'Choose at least one day', 'Times are written like 06:00',
  'Gym settings', 'The rules for coming in, each branch\'s hours, and the entrance QR.', 'Rules', 'Branches and QR', 'Check-in rules', 'Every way in follows these: the desk, the member\'s phone and the gates.', 'Grace days after a membership ends', 'Ignore a repeat scan for (seconds)', 'Most visits a day (0 = no limit)', 'Same card at two branches within (minutes)',
  'Record check-out as well as check-in', 'Shows who is in the gym now.', 'The desk confirms every scan by looking at the member', 'Printed cards can be lent to a friend. With this on, the desk sees the member\'s photo and confirms.', 'Members on their own phone', 'A member signs in with a code sent to their phone, then shows a pass or checks in themselves. No app to install.',
  'Let members check in from their own phone', 'They scan the poster at the door with their phone\'s camera.', 'Also ask for today\'s front-desk code', 'Ask for a fresh sign-in code every time', 'A code counts for (minutes)', 'The gym\'s web address', 'Members open {url}', 'Letters, digits and hyphens. Needed for members to sign in.', 'Member number starts with', 'Stay signed in for (days)', 'A phone pass QR lasts (seconds)',
  'Classes', 'How booking works for members and the desk.', 'Cancel a class free until (hours before)', 'Cancel personal training free until (hours before)', 'Members can book up to (days ahead)', 'A full class has a waitlist', 'Save settings', 'Settings saved',
  'The member code prefix is 1 to 8 letters or digits', 'The address is 3 to 40 letters, digits or hyphens', '{label} must be a whole number from {min} to {max}', 'A code counts for 1 to 1440 minutes',
  'Opening hours', 'Nobody is let in outside these hours, whatever their plan.', 'Open all day, every day', 'Opens', 'Closes', 'Holidays (closed all day)', 'One date a line, like 2026-11-08.', 'Save hours', 'Hours saved', 'Closing time must be after opening time', '{date} is not a date. Write one a line, like 2026-11-08.',
  'Entrance QR', 'Put this poster at the door. It only opens the check-in page for this branch.', 'Check in here', 'Scan with your phone\'s camera. Sign in with the code we send you, then tap Check in.', 'New QR', 'Make a new entrance QR?', 'The poster on the wall stops working. Print the new one and put it up. Use this if the old poster was copied or spread around.', 'Make a new QR', 'New QR made. Print it now.',
  'Phone check-in is switched off. Turn it on under Rules before putting the poster up.', 'You do not have access to gym set-up.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back', 'Cancel', 'What the gym sells, for how long and for how much', 'Check-in rules, hours, holidays and the entrance QR', 'to', 'Closed'
];
