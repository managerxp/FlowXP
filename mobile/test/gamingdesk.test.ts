import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingBody, bookingProblem, entryBody, newPlayerBody, newPlayerProblem, slotsFor, topupBody, topupProblem, windowFor } from '../src/lib/gamingDesk.ts';

test('start times are half-hours from 10:00 to 23:30, and today leaves out what has gone', () => {
  const day = new Date(2026, 10, 20); const all = slotsFor(day, new Date(2026, 10, 1));
  assert.equal(all.length, 28);
  const now = new Date(2026, 10, 20, 15, 10); const left = slotsFor(day, now);
  assert.equal(new Date(left[0].id).getHours(), 15); assert.equal(new Date(left[0].id).getMinutes(), 30);
});

test('a booking needs a station, a time and a name; the body sends only a usable phone', () => {
  assert.match(bookingProblem(null, 'x', 'Ravi'), /station/); assert.match(bookingProblem(1, '', 'Ravi'), /time/); assert.match(bookingProblem(1, 'x', ' '), /who/); assert.equal(bookingProblem(1, 'x', 'Ravi'), '');
  assert.deepEqual(bookingBody(3, 'T', 60, 2, ' Ravi ', '', ''), { station_id: 3, starts_at: 'T', minutes: 60, players: 2, guest_name: 'Ravi' });
  assert.equal(bookingBody(3, 'T', 60, 2, 'Ravi', '+91 98765 43210').guest_phone, '9876543210');
});

test('a player needs a name; the mobile number is optional but must be whole; a top-up needs an amount', () => {
  assert.match(newPlayerProblem('A', ''), /name/); assert.equal(newPlayerProblem('Ravi', ''), ''); assert.match(newPlayerProblem('Ravi', '98'), /10-digit/);
  assert.deepEqual(newPlayerBody(' Ravi ', '98765 43210', ' ace '), { name: 'Ravi', phone: '9876543210', gamer_tag: 'ace' });
  assert.match(topupProblem(0), /amount/); assert.match(topupProblem(600000), /5,00,000/); assert.equal(topupProblem(500), '');
  assert.deepEqual(topupBody(500, 'UPI', 'r1'), { amount: 500, method: 'UPI', request_id: 'r1' });
});

test('a tournament entry is for a known player or a typed name, paid now or left', () => {
  assert.deepEqual(entryBody({ customer_id: 5 }, true, 'CASH'), { customer_id: 5, payment: { method: 'CASH', amount: 'FULL' } });
  assert.deepEqual(entryBody({ name: ' Asha ', phone: '98765 43210' }, false, 'CASH'), { customer_id: null, player_name: 'Asha', phone: '9876543210' });
});

test('the takings window ends today', () => {
  const t = new Date(2026, 10, 10);
  assert.deepEqual(windowFor('today', t), { from: '2026-11-10', to: '2026-11-10' }); assert.equal(windowFor('week', t).from, '2026-11-04'); assert.equal(windowFor('month', t).from, '2026-10-12');
});
