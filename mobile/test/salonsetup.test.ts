/* Salon settings on the phone: each tab's form, its checks and body, outlet hours, online booking, loyalty, segments, automations, campaigns, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALON_SETUP_TEXTS, audienceText, automationBody, automationDirty, automationProblem, bookingLink, campaignProblem, canSalonSetup, cleanSlug, hoursBody, hoursForm, hoursProblem, inactiveDays, loyaltyBody, loyaltyForm, loyaltyProblem, onlineBody, onlineForm, onlineProblem, outletOffBody, outletOnBody, ownHours,
  profileBody, profileForm, profileProblem, programText, segmentBody, segmentForm, segmentProblem, summaryNote, taxBody, taxForm, taxProblem, toggleDay, toggleMethod, type Automation, type SalonBranch, type SalonSettings
} from '../src/lib/salonSetup.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const c: SalonSettings = {
  pan: null, registration_type: null, registration_no: null, working_days: [1, 2, 3, 4, 5, 6], open_time: '10:00', close_time: '20:00', slot_minutes: 15, min_advance_minutes: 0, max_advance_days: 90, buffer_minutes: 0, cancellation_policy: {}, no_show_policy: { fee_pct: 50, text: 'Fee applies' },
  tax_inclusive: false, default_service_tax_rate: 18, default_product_tax_rate: 18, default_service_sac: '999721', commission_on_package_use: true, commission_base: 'NET', expiry_alert_days: 30, consumption_alert_factor: 2,
  segment_rules: { new_days: 30, vip_spend: 20000, vip_visits: 12, high_spender: 3000, frequent_visits_90d: 4, inactive_days: [30, 60, 90] }, payment_methods: ['CASH', 'UPI'], online_booking_enabled: false, online_booking_slug: null, online_booking_notice: null
};

test('only owners and admins', () => { assert.equal(canSalonSetup('OWNER'), true); assert.equal(canSalonSetup('ADMIN'), true); assert.equal(canSalonSetup('CASHIER'), false); assert.equal(canSalonSetup(undefined), false); });

test('profile: PAN shape; blanks are sent as null', () => {
  const f = profileForm(c);
  assert.equal(profileProblem(f), ''); assert.deepEqual(profileBody({ pan: ' abcde1234f ', registration_type: '', registration_no: ' 123 ' }), { pan: 'ABCDE1234F', registration_type: null, registration_no: '123' }); assert.notEqual(profileProblem({ ...f, pan: 'ABC123' }), '');
});

test('hours and booking: days, times, rules, and policies that are left out when blank', () => {
  const f = hoursForm(c);
  assert.equal(f.noshow_fee, '50'); assert.equal(f.cancel_hours, ''); assert.equal(hoursProblem(f), '');
  const b = hoursBody({ ...f, cancel_hours: '24', cancel_fee: '', cancel_text: ' Please give a day ' }) as { cancellation_policy: object; no_show_policy: object; slot_minutes: number };
  assert.deepEqual(b.cancellation_policy, { min_notice_hours: 24, text: 'Please give a day' }); assert.deepEqual(b.no_show_policy, { fee_pct: 50, text: 'Fee applies' }); assert.equal(b.slot_minutes, 15);
  assert.notEqual(hoursProblem({ ...f, working_days: [] }), ''); assert.notEqual(hoursProblem({ ...f, open_time: '9am' }), ''); assert.notEqual(hoursProblem({ ...f, close_time: '09:00' }), ''); assert.notEqual(hoursProblem({ ...f, max_advance_days: '0' }), ''); assert.notEqual(hoursProblem({ ...f, cancel_fee: '101' }), ''); assert.notEqual(hoursProblem({ ...f, noshow_fee: 'x' }), '');
  assert.deepEqual(toggleDay([1, 3], 2), [1, 2, 3]); assert.deepEqual(toggleDay([1, 2, 3], 2), [1, 3]);
});

test('an outlet follows the default hours or keeps its own', () => {
  const b: SalonBranch = { branch_id: 1, name: 'A', is_primary: true, working_days: null, open_time: null, close_time: null, slot_minutes: null, ownership: 'OWNED', franchisee_name: null };
  assert.equal(ownHours(b), false); assert.equal(ownHours({ ...b, open_time: '09:00' }), true);
  assert.deepEqual(outletOnBody({ open_time: '10:00', close_time: '20:00', working_days: [1, 2] }), { open_time: '10:00', close_time: '20:00', working_days: [1, 2] }); assert.deepEqual(outletOffBody(), { open_time: null, close_time: null, working_days: null, slot_minutes: null });
});

test('online booking: a clean address, needed when switched on, and the link', () => {
  assert.equal(cleanSlug('Glow Salon!_2'), 'glowsalon2'); assert.equal(cleanSlug('glow-salon'), 'glow-salon');
  const f = onlineForm(c); assert.equal(onlineProblem(f), ''); assert.notEqual(onlineProblem({ ...f, enabled: true }), ''); assert.notEqual(onlineProblem({ ...f, slug: 'ab' }), ''); assert.equal(onlineProblem({ enabled: true, slug: 'glow', notice: '' }), '');
  assert.deepEqual(onlineBody({ enabled: true, slug: 'glow', notice: ' Park behind ' }), { online_booking_enabled: true, online_booking_slug: 'glow', online_booking_notice: 'Park behind' }); assert.equal(bookingLink('https://flowxp.in/', 'glow'), 'https://flowxp.in/book/glow'); assert.equal(bookingLink('https://x', ''), '');
});

test('tax and payments: rates, at least one method, SAC blank is null', () => {
  const f = taxForm(c);
  assert.equal(taxProblem(f), ''); assert.deepEqual(taxBody({ ...f, default_service_sac: ' ' }).default_service_sac, null); assert.equal(taxBody(f).default_service_tax_rate, 18);
  assert.notEqual(taxProblem({ ...f, payment_methods: [] }), ''); assert.notEqual(taxProblem({ ...f, default_product_tax_rate: '101' }), ''); assert.deepEqual(toggleMethod(['CASH'], 'UPI'), ['CASH', 'UPI']); assert.deepEqual(toggleMethod(['CASH', 'UPI'], 'CASH'), ['UPI']);
});

test('loyalty: rates by kind, expiry of 30 days or more, and the wording', () => {
  const d = { enabled: true, program: { earn_per_100: 5, point_value: 1, min_redeem_points: 50, max_redeem_pct: 50 }, expiry_days: null, rules: { SERVICE: { earn_per_100: null, is_enabled: true }, PRODUCT: { earn_per_100: 2, is_enabled: false } } };
  const f = loyaltyForm(d); assert.equal(f.rules.PRODUCT.earn_per_100, '2'); assert.equal(loyaltyProblem(f), '');
  assert.deepEqual(loyaltyBody({ ...f, expiry_days: '365' }), { expiry_days: 365, rules: { SERVICE: { earn_per_100: null, is_enabled: true }, PRODUCT: { earn_per_100: 2, is_enabled: false } } }); assert.equal(loyaltyBody(f).expiry_days, null);
  assert.notEqual(loyaltyProblem({ ...f, expiry_days: '10' }), ''); assert.notEqual(loyaltyProblem({ ...f, rules: { SERVICE: { earn_per_100: 'x', is_enabled: true } } }), '');
  assert.equal(programText(d), 'Loyalty is on: 5 points per ₹100, each worth ₹1; at least 50 points to use, up to 50% of a bill.'); assert.equal(programText({ ...d, enabled: false }), 'Loyalty points are off.'); assert.equal(summaryNote({ days: 30, issued: 0, redeemed: 0, expired: 0, holders: 3, outstanding_points: 100, liability: 1234.5 }), '3 people · worth ₹1,235');
});

test('client segments and stock alerts: numbers, one to three inactive-day limits, unusual use at 1.2 or more', () => {
  const f = segmentForm(c);
  assert.equal(f.inactive_days, '30, 60, 90'); assert.equal(segmentProblem(f), ''); assert.deepEqual(inactiveDays('30, 60 ,x, 90'), [30, 60, 90]);
  const b = segmentBody({ ...f, inactive_days: '45, 90' }) as { segment_rules: { inactive_days: number[]; vip_spend: number }; consumption_alert_factor: number };
  assert.deepEqual(b.segment_rules.inactive_days, [45, 90]); assert.equal(b.segment_rules.vip_spend, 20000); assert.equal(b.consumption_alert_factor, 2);
  assert.notEqual(segmentProblem({ ...f, inactive_days: '' }), ''); assert.notEqual(segmentProblem({ ...f, inactive_days: '1,2,3,4' }), ''); assert.notEqual(segmentProblem({ ...f, consumption_alert_factor: '1.1' }), ''); assert.notEqual(segmentProblem({ ...f, vip_visits: 'x' }), '');
});

test('automations: changed or not, whole numbers, and the body keeps the offer text as written', () => {
  const a: Automation = { key: 'INACTIVE', label: 'Inactive customer reminder', description: '', internal: false, is_enabled: false, config: { days: 60, offer_text: 'Come back' }, defaults: { days: 60, offer_text: 'Come back' } };
  assert.equal(automationDirty(a, false, a.config), false); assert.equal(automationDirty(a, true, a.config), true); assert.equal(automationDirty(a, false, { ...a.config, days: '45' }), true);
  assert.equal(automationProblem({ days: '45', offer_text: 'Hi' }), ''); assert.notEqual(automationProblem({ days: '0' }), ''); assert.notEqual(automationProblem({ days: '4.5' }), '');
  assert.deepEqual(automationBody(true, { days: '45', offer_text: 'Hi there' }), { is_enabled: true, config: { days: 45, offer_text: 'Hi there' } });
});

test('campaigns: a message of 5 or more characters to a group that has someone in it', () => {
  assert.equal(campaignProblem('Come in for 15% off', 4), ''); assert.notEqual(campaignProblem('Hi', 4), ''); assert.notEqual(campaignProblem('Come in for 15% off', 0), ''); assert.notEqual(campaignProblem('Come in for 15% off', undefined), '');
  assert.equal(audienceText(null), 'Counting…'); assert.equal(audienceText({ count: 1, sample: ['Asha'] }), '1 client would receive it (Asha).'); assert.equal(audienceText({ count: 7, sample: ['Asha', 'Ravi'] }), '7 clients would receive it (Asha, Ravi…).'); assert.equal(audienceText({ count: 0, sample: [] }), '0 clients would receive it.');
});

test('every text of the salon settings screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(SALON_SETUP_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
