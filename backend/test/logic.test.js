/*
 * The pieces of logic that are wrong quietly.
 *
 * Trial expiry decides whether a paying-in-future customer can use the
 * product, the permission check decides whether a cashier can change
 * settings, and the tax module decides how much GST every invoice in the
 * product charges. All three are pure functions, so none of them need a
 * database — the dummy env below exists only because importing the modules
 * loads config.
 *
 * Run: npm test
 */
process.env.DATABASE_URL ||= 'postgres://unused/unused';
process.env.JWT_SECRET ||= 'test-secret-not-used-for-signing-anything-real';

import test from 'node:test';
import assert from 'node:assert/strict';

const { trialDaysRemaining, effectiveStatus, subscriptionSummary } =
  await import('../src/modules/subscription.js');
const { hasPermission } = await import('../src/middleware/auth.js');
const { computeLineTax, sumLines, isInterState } = await import('../src/modules/tax.js');

const DAY = 86400000;
const now = new Date('2026-09-05T12:00:00Z');
const inDays = (n) => new Date(now.getTime() + n * DAY);

test('trial days remaining rounds up, and floors at zero', () => {
  assert.equal(trialDaysRemaining(inDays(7), now), 7);
  // 18 hours left is "1 day", not "0" — the product still works, so saying
  // zero would be a lie the user can see through.
  assert.equal(trialDaysRemaining(new Date(now.getTime() + 18 * 3600000), now), 1);
  assert.equal(trialDaysRemaining(inDays(-1), now), 0);
  assert.equal(trialDaysRemaining(null, now), 0);
});

test('a trial past its end date is EXPIRED without anything having run', () => {
  assert.equal(effectiveStatus({ subscription_status: 'TRIAL', trial_ends_at: inDays(3) }, now), 'TRIAL');
  assert.equal(effectiveStatus({ subscription_status: 'TRIAL', trial_ends_at: inDays(-1) }, now), 'EXPIRED');
});

test('a paid subscription is not expired by a stale trial date', () => {
  // The trial ended months ago; they paid. Only the provider's webhook may
  // take an ACTIVE subscription away.
  assert.equal(
    effectiveStatus({ subscription_status: 'ACTIVE', trial_ends_at: inDays(-90) }, now),
    'ACTIVE'
  );
});

test('writing is gated on trial or paid, reading is not', () => {
  const expired = subscriptionSummary(
    { subscription_status: 'TRIAL', plan_code: 'TRIAL', trial_ends_at: inDays(-1) }, now
  );
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.can_write, false);
  assert.equal(expired.trial_days_remaining, 0);

  const live = subscriptionSummary(
    { subscription_status: 'TRIAL', plan_code: 'TRIAL', trial_ends_at: inDays(5) }, now
  );
  assert.equal(live.can_write, true);
  assert.equal(live.trial_days_remaining, 5);
});

test('roles grant what they should and nothing more', () => {
  const owner = { role: 'OWNER', permissions: {} };
  const cashier = { role: 'CASHIER', permissions: {} };

  assert.equal(hasPermission(owner, 'settings'), true);
  assert.equal(hasPermission(cashier, 'billing'), true);
  assert.equal(hasPermission(cashier, 'settings'), false);
  assert.equal(hasPermission(cashier, 'reports'), false);
  assert.equal(hasPermission(null, 'billing'), false);
});

test('a per-user override beats the role default, in both directions', () => {
  assert.equal(hasPermission({ role: 'CASHIER', permissions: { reports: true } }, 'reports'), true);
  assert.equal(hasPermission({ role: 'MANAGER', permissions: { expenses: false } }, 'expenses'), false);
  // Revoking from an owner is deliberately impossible — an owner locked out of
  // their own settings has no way back in.
  assert.equal(hasPermission({ role: 'OWNER', permissions: { settings: false } }, 'settings'), true);
});

test('an unregistered business charges no GST regardless of the product tax rate', () => {
  const line = computeLineTax({ quantity: 2, unitPricePaise: 10000, taxRatePercent: 18, gstEnabled: false });
  assert.equal(line.tax_paise, 0);
  assert.equal(line.cgst_paise, 0);
  assert.equal(line.line_total_paise, 20000);
});

test('an intra-state sale splits GST evenly into CGST + SGST', () => {
  // ₹1000 at 18% = ₹180 tax, ₹90 + ₹90.
  const line = computeLineTax({ quantity: 1, unitPricePaise: 100000, taxRatePercent: 18, gstEnabled: true, interState: false });
  assert.equal(line.tax_paise, 18000);
  assert.equal(line.cgst_paise, 9000);
  assert.equal(line.sgst_paise, 9000);
  assert.equal(line.igst_paise, 0);
  assert.equal(line.line_total_paise, 118000);
});

test('an inter-state sale charges IGST only, never CGST/SGST', () => {
  const line = computeLineTax({ quantity: 1, unitPricePaise: 100000, taxRatePercent: 18, gstEnabled: true, interState: true });
  assert.equal(line.igst_paise, 18000);
  assert.equal(line.cgst_paise, 0);
  assert.equal(line.sgst_paise, 0);
});

test('an odd paisa of tax is not lost or invented when split into CGST + SGST', () => {
  // ₹100 at 5% = ₹5.00 exactly, but pick a rate that leaves an odd paisa.
  const line = computeLineTax({ quantity: 1, unitPricePaise: 333, taxRatePercent: 18, gstEnabled: true, interState: false });
  assert.equal(line.cgst_paise + line.sgst_paise, line.tax_paise);
});

test('discount reduces the taxable value before tax is calculated', () => {
  // ₹1000 line, ₹200 discount -> tax on ₹800, not ₹1000.
  const line = computeLineTax({ quantity: 1, unitPricePaise: 100000, discountPaise: 20000, taxRatePercent: 18, gstEnabled: true, interState: false });
  assert.equal(line.taxable_paise, 80000);
  assert.equal(line.tax_paise, 14400);
});

test('sumLines adds every field across the invoice, not just the total', () => {
  const totals = sumLines([
    computeLineTax({ quantity: 1, unitPricePaise: 100000, taxRatePercent: 18, gstEnabled: true, interState: false }),
    computeLineTax({ quantity: 1, unitPricePaise: 50000, taxRatePercent: 12, gstEnabled: true, interState: true })
  ]);
  assert.equal(totals.subtotal_paise, 150000);
  assert.equal(totals.cgst_paise, 9000);
  assert.equal(totals.sgst_paise, 9000);
  assert.equal(totals.igst_paise, 6000);
  assert.equal(totals.total_paise, 118000 + 56000);   // 100000+18000, 50000+6000
});

test('inter-state detection treats an unknown state as intra-state, not as a guess', () => {
  assert.equal(isInterState('Telangana', 'Telangana'), false);
  assert.equal(isInterState('Telangana', 'Karnataka'), true);
  assert.equal(isInterState('Telangana', 'telangana'), false); // case-insensitive
  assert.equal(isInterState(null, 'Karnataka'), false);
  assert.equal(isInterState('Telangana', null), false);
});
