import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInBody, roomChargeBody, roomGuestLine, checkInProblem, checkOutBody, checkOutProblem, hkChoices, paymentBody, paymentProblem, rackFilter, rackSort, type RackRoom } from '../src/lib/hotel.ts';

const room = (no: string, hk: RackRoom['hk_status'], occ: RackRoom['occupancy']): RackRoom => ({ room_id: Number(no), room_no: no, floor: null, hk_status: hk, hk_note: null, room_type: 'Deluxe', occupancy: occ, stay_booking_id: null, stay_guest: null, stay_departure: null, next_guest: null, next_arrival: null, blocked: false });

test('rooms due out come first, then arriving, then dirty, then the rest, each in room order', () => {
  const sorted = rackSort([room('110', 'CLEAN', 'VACANT'), room('9', 'DIRTY', 'VACANT'), room('21', 'CLEAN', 'ARRIVING'), room('3', 'DIRTY', 'DUE_OUT'), room('2', 'CLEAN', 'VACANT')]);
  assert.deepEqual(sorted.map((r) => r.room_no), ['3', '21', '9', '2', '110']);
});

test('filters: dirty, free to sell, occupied', () => {
  const all = [room('1', 'DIRTY', 'VACANT'), room('2', 'CLEAN', 'OCCUPIED'), room('3', 'CLEAN', 'ARRIVING'), room('4', 'CLEAN', 'DUE_OUT')];
  assert.deepEqual(rackFilter(all, 'dirty').map((r) => r.room_no), ['1']);
  assert.deepEqual(rackFilter(all, 'vacant').map((r) => r.room_no), ['1', '3']);
  assert.deepEqual(rackFilter(all, 'occupied').map((r) => r.room_no), ['2', '4']);
  assert.equal(rackFilter(all, 'all').length, 4);
});

test('a room can move to any housekeeping state but the one it is in', () => {
  assert.deepEqual(hkChoices('DIRTY'), ['CLEAN', 'INSPECTED', 'OUT_OF_ORDER']);
});

test('check-in needs a booked stay with a room number on every room', () => {
  const r = (room_id: number | null, status = 'RESERVED') => ({ rr_id: 1, room_id, room_no: null, room_type: 'Deluxe', status, adults: 1, children: 0 });
  assert.equal(checkInProblem({ status: 'CONFIRMED', rooms: [r(5)] }), '');
  assert.match(checkInProblem({ status: 'CONFIRMED', rooms: [r(5), r(null)] }), /Choose a room number/);
  assert.equal(checkInProblem({ status: 'CONFIRMED', rooms: [r(5), { ...r(null), rr_id: 2 }] }, { 2: 9 }), '');
  assert.match(checkInProblem({ status: 'CONFIRMED', rooms: [{ ...r(null), rr_id: 2 }, { ...r(null), rr_id: 3 }] }, { 2: 9, 3: 9 }), /twice/);
  assert.deepEqual(checkInBody({ 2: 9, 3: 0 }), { assignments: [{ rr_id: 2, room_id: 9 }] });
  assert.deepEqual(checkInBody({ 2: 9 }, true), { assignments: [{ rr_id: 2, room_id: 9 }], allow_dirty: true });
  assert.match(checkInProblem({ status: 'CONFIRMED', rooms: [r(null, 'CANCELLED')] }), /no room/);
  assert.equal(checkInProblem({ status: 'CHECKED_IN', rooms: [r(5)] }), 'Already checked in');
  assert.match(checkInProblem({ status: 'CANCELLED', rooms: [r(5)] }), /cannot be checked in/);
});

test('check-out settles what is owed, refunds a credit, and sends nothing extra for a clear bill', () => {
  assert.deepEqual(checkOutBody(0, ''), {});
  assert.deepEqual(checkOutBody(150000, 'UPI', ' ref1 '), { settlement: { method: 'UPI', reference: 'ref1' } });
  assert.deepEqual(checkOutBody(-5000, 'CASH'), { refund_method: 'CASH' });
  assert.match(checkOutProblem(1000, ''), /how the balance/);
  assert.match(checkOutProblem(-1000, ''), /refund/);
  assert.equal(checkOutProblem(0, ''), '');
});

test('a payment needs an amount above zero and a method; the body is in rupees', () => {
  assert.match(paymentProblem('', 'CASH'), /amount/);
  assert.match(paymentProblem('0', 'CASH'), /amount/);
  assert.match(paymentProblem('500', ''), /how it was paid/);
  assert.equal(paymentProblem('500', 'CASH'), '');
  assert.deepEqual(paymentBody('500', 'CARD', '', 'ADVANCE'), { kind: 'ADVANCE', method: 'CARD', amount: 500 });
});

test('a bill charged to a room names the stay and carries no payment', () => {
  assert.deepEqual(roomChargeBody({ items: [{ product_id: 1, quantity: 2 }], payment: { method: 'CASH', amount: 'FULL' }, apply_promotions: true }, 42), { items: [{ product_id: 1, quantity: 2 }], apply_promotions: true, charge_to_booking_id: 42 });
  assert.equal(roomGuestLine({ guest_name: 'Asha Rao', rooms: '204, 205' }), 'Asha Rao · room 204, 205');
  assert.equal(roomGuestLine({ guest_name: 'Walk In', rooms: null }), 'Walk In');
});
