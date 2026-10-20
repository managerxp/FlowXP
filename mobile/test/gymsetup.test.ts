/* Gym plans and settings on the phone: plan wording, the plan form and its body, branches and time windows, the rules form, hours and holidays, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GYM_SETUP_TEXTS, branchOn, canGymSetup, defaultHours, durationText, emptyPlan, holidaysOf, hoursBody, hoursProblem, planBody, planForm, planPriceText, planProblem, planSub, portalText, setDayHours, settingsBody, settingsForm, settingsProblem, toggleBranch, toggleIn, windowText,
  type Branch, type GymSettings, type Plan
} from '../src/lib/gymSetup.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const branches: Branch[] = [{ branch_id: 1, name: 'Indiranagar', hours: null, holidays: [], checkin_url: 'x' }, { branch_id: 2, name: 'Koramangala', hours: null, holidays: [], checkin_url: 'y' }];
const plan: Plan = { plan_id: 5, name: 'Off-peak annual', description: null, audience: 'STUDENT', duration_days: 365, price: 9000, tax_rate: '18.00', max_members: 1, allowed_branch_ids: [2], time_window: { days: [1, 2, 3], from: '10:00', to: '16:00' }, grace_days: 3, payment_policy: 'PAY_LATER', pay_later_days: 5, freeze_allowed: true, max_freeze_days: 10, is_active: true };

test('only people with the gym set-up right', () => { assert.equal(canGymSetup((p) => p === 'gym_setup'), true); assert.equal(canGymSetup(() => false), false); });

test('how a plan reads: length, window, price, and the one line under it', () => {
  assert.equal(durationText(30), '1 month'); assert.equal(durationText(90), '3 months'); assert.equal(durationText(365), '1 year'); assert.equal(durationText(730), '2 years'); assert.equal(durationText(45), '45 days');
  assert.equal(windowText(null), 'Any time the gym is open'); assert.equal(windowText({ days: [1, 2, 3], from: '10:00', to: '16:00' }), 'Mon, Tue, Wed, 10:00 to 16:00'); assert.equal(windowText({ from: '06:00', to: '09:00' }), 'Every day, 06:00 to 09:00');
  assert.equal(planPriceText(plan), '₹9,000.00 + 18% GST');
  assert.equal(planSub(plan, branches), '1 year · Students · Can come in for a few days, then paid in full (5 days) · Mon, Tue, Wed, 10:00 to 16:00 · Only at: Koramangala · Can freeze up to 10 days · 3 grace days');
  assert.match(planSub({ ...plan, allowed_branch_ids: null, time_window: null, freeze_allowed: false, grace_days: null, payment_policy: 'FULL_REQUIRED', audience: 'STANDARD' }, branches), /Every branch · Cannot be frozen$/);
});

test('the plan form: round trip, checks, and the body (every-branch plans send null; pay-later days only for pay-later)', () => {
  const f = planForm(plan);
  assert.equal(f.price, '9000'); assert.equal(f.tax_rate, '18'); assert.equal(f.custom, false); assert.deepEqual(f.branches, [2]); assert.equal(f.timed, true); assert.equal(planProblem(f), '');
  const b = planBody(f, [1, 2]);
  assert.deepEqual(b, { name: 'Off-peak annual', description: null, audience: 'STUDENT', duration_days: 365, price: 9000, tax_rate: 18, max_members: 1, payment_policy: 'PAY_LATER', pay_later_days: 5, grace_days: 3, freeze_allowed: true, max_freeze_days: 10, allowed_branch_ids: [2], time_window: { days: [1, 2, 3], from: '10:00', to: '16:00' } });
  const open = planBody({ ...f, branches: [1, 2], timed: false, payment_policy: 'FULL_REQUIRED', grace_days: '', freeze_allowed: false }, [1, 2]);
  assert.equal(open.allowed_branch_ids, null); assert.equal(open.time_window, null); assert.equal(open.pay_later_days, 0); assert.equal(open.grace_days, null); assert.equal(open.max_freeze_days, 0);
  assert.equal(planForm({ ...plan, duration_days: 45 }).custom, true);
  const e = { ...emptyPlan(), name: 'Monthly', price: '1500' };
  assert.equal(planProblem(e), ''); assert.notEqual(planProblem({ ...e, name: ' ' }), ''); assert.notEqual(planProblem({ ...e, price: '' }), ''); assert.notEqual(planProblem({ ...e, duration_days: '0' }), ''); assert.notEqual(planProblem({ ...e, tax_rate: '101' }), '');
  assert.notEqual(planProblem({ ...e, timed: true, days: [] }), ''); assert.notEqual(planProblem({ ...e, timed: true, from: '6am' }), ''); assert.notEqual(planProblem({ ...e, grace_days: 'x' }), ''); assert.notEqual(planProblem({ ...e, payment_policy: 'PAY_LATER', pay_later_days: '0' }), '');
});

test('branches and days: none ticked means every branch; unticking one from "all" leaves the others', () => {
  const f = emptyPlan();
  assert.equal(branchOn(f, 1), true); assert.deepEqual(toggleBranch(f, 1, [1, 2]), [2]); assert.deepEqual(toggleBranch({ ...f, branches: [2] }, 1, [1, 2]), [2, 1]); assert.deepEqual(toggleIn([1, 2], 2), [1]); assert.deepEqual(toggleIn([1], 3), [1, 3]);
});

const settings: GymSettings = {
  member_prefix: 'IRON', public_slug: 'ironworks', grace_days: 2, cooldown_seconds: 120, visits_per_day: 0, checkout_enabled: true, reception_confirm: false, self_checkin_enabled: true, self_checkin_daily_code: true, self_checkin_fresh_otp_minutes: null, session_days: 30,
  pass_ttl_seconds: 60, travel_minutes: 30, class_cancel_hours: 4, pt_cancel_hours: 12, class_booking_days: 14, class_waitlist: true, portal_url: 'https://x/gym/ironworks', branches
};
test('the rules form: round trip, ranges as the server has them, and the body', () => {
  const f = settingsForm(settings);
  assert.equal(f.fresh, false); assert.equal(f.fresh_minutes, '10'); assert.equal(settingsProblem(f), '');
  const b = settingsBody({ ...f, member_prefix: 'iron', public_slug: ' IronWorks ', fresh: true, fresh_minutes: '15' });
  assert.equal(b.member_prefix, 'IRON'); assert.equal(b.public_slug, 'ironworks'); assert.equal(b.self_checkin_fresh_otp_minutes, 15); assert.equal(b.grace_days, 2); assert.equal(settingsBody(f).self_checkin_fresh_otp_minutes, null);
  assert.notEqual(settingsProblem({ ...f, member_prefix: '' }), ''); assert.notEqual(settingsProblem({ ...f, member_prefix: 'TOOLONGPREFIX' }), ''); assert.notEqual(settingsProblem({ ...f, public_slug: 'a' }), ''); assert.notEqual(settingsProblem({ ...f, pass_ttl_seconds: '10' }), '');
  assert.notEqual(settingsProblem({ ...f, session_days: '0' }), ''); assert.notEqual(settingsProblem({ ...f, visits_per_day: '21' }), ''); assert.match(settingsProblem({ ...f, grace_days: '99' }), /Grace days after a membership ends must be a whole number from 0 to 60/); assert.notEqual(settingsProblem({ ...f, fresh: true, fresh_minutes: '0' }), '');
  assert.equal(portalText(settings), 'Members open https://x/gym/ironworks'); assert.match(portalText({ public_slug: null }), /Letters, digits/);
});

test('hours and holidays: a day on or off, times checked, one date a line', () => {
  const h = defaultHours(); assert.equal(Object.keys(h).length, 7); assert.equal(h['0'].open, '06:00');
  const off = setDayHours(h, 0, null)!; assert.equal(off['0'], undefined); assert.equal(Object.keys(off).length, 6); assert.deepEqual(setDayHours(null, 2, { open: '07:00', close: '20:00' }), { '2': { open: '07:00', close: '20:00' } });
  assert.deepEqual(holidaysOf('2026-11-08\n2026-12-25, 2027-01-01'), ['2026-11-08', '2026-12-25', '2027-01-01']);
  assert.equal(hoursProblem(h, '2026-11-08'), ''); assert.equal(hoursProblem(null, ''), ''); assert.notEqual(hoursProblem({ '1': { open: '22:00', close: '06:00' } }, ''), ''); assert.notEqual(hoursProblem({ '1': { open: '6am', close: '10:00' } }, ''), '');
  assert.match(hoursProblem(h, '2026-13-01'), /2026-13-01 is not a date/); assert.match(hoursProblem(h, 'Diwali'), /Diwali is not a date/);
  assert.deepEqual(hoursBody(null, '2026-11-08'), { hours: null, holidays: ['2026-11-08'] });
});

test('every text of the gym set-up screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(GYM_SETUP_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
