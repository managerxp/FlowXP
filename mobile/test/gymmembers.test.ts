import test from 'node:test';
import assert from 'node:assert/strict';
import { currentMembership, daysLeftText, freezeBody, freezeProblem, newMemberBody, newMemberProblem, renewable, sellBody, sellProblem, type MembershipView } from '../src/lib/gymMembers.ts';

const ms = (state: MembershipView['state'], id: number, extra: Partial<MembershipView> = {}): MembershipView => ({ membership_id: id, plan_id: 1, plan_name: 'Monthly', start_date: '2026-10-01', end_date: '2026-10-31', status: 'ACTIVE', state, payment: 'PAID', payment_ok: true, days_left: null, price: 1000, amount_due: 0, freeze_allowed: true, max_freeze_days: 30, freezes: [], ...extra });

test('the current membership is the newest running one; an ended one is what gets renewed', () => {
  const list = [ms('UPCOMING', 3), ms('ACTIVE', 2), ms('EXPIRED', 1)];
  assert.equal(currentMembership({ memberships: list })?.membership_id, 3);
  assert.equal(currentMembership({ memberships: [ms('EXPIRED', 1), ms('CANCELLED', 0)] }), null);
  assert.equal(renewable({ memberships: [ms('CANCELLED', 5), ms('EXPIRED', 4)] })?.membership_id, 4);
  assert.equal(daysLeftText({ state: 'ACTIVE', days_left: 1, end_date: 'x' }), '1 day left'); assert.equal(daysLeftText({ state: 'ACTIVE', days_left: 0, end_date: 'x' }), 'Ends today'); assert.equal(daysLeftText({ state: 'FROZEN', days_left: null, end_date: 'x' }), '');
});

test('selling asks for a plan and, for a part payment, an amount; the body says how it is paid', () => {
  assert.match(sellProblem(null, 'FULL', 0), /plan/); assert.match(sellProblem(1, 'PART', 0), /how much/); assert.equal(sellProblem(1, 'LATER', 0), '');
  assert.deepEqual(sellBody(7, 'FULL', 'UPI'), { plan_id: 7, payment: { method: 'UPI', amount: 'FULL' } });
  assert.deepEqual(sellBody(7, 'PART', 'CASH', 500), { plan_id: 7, payment: { method: 'CASH', amount: 500 } });
  assert.deepEqual(sellBody(7, 'LATER', 'CASH'), { plan_id: 7 });
});

test('a freeze runs from today for the days asked, within what the plan allows', () => {
  assert.deepEqual(freezeBody(7, '2026-11-10'), { from: '2026-11-10', to: '2026-11-16' });
  assert.deepEqual(freezeBody(1, '2026-12-31'), { from: '2026-12-31', to: '2026-12-31' });
  assert.match(freezeProblem(0, 30), /how many/); assert.match(freezeProblem(45, 30), /up to 30/); assert.equal(freezeProblem(10, 30), '');
});

test('a new member needs a name and a 10-digit number; only the last 10 digits are sent', () => {
  assert.match(newMemberProblem('A', '9876543210'), /name/); assert.match(newMemberProblem('Asha', '98765'), /10-digit/); assert.equal(newMemberProblem('Asha', '98765 43210'), '');
  assert.deepEqual(newMemberBody(' Asha ', '+91 98765 43210', ' ', true), { name: 'Asha', phone: '9876543210', confirm_duplicate: true });
});
