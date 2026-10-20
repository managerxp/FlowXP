import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancel, canNoShow, chargeBody, chargeProblem, departureFor, freeRoomsPath, isDay, movableRooms, moveBody, nightsBetween, quotePath, reasonBody, reasonProblem, stayBody, stayProblem, type StayForm } from '../src/lib/hotelDesk.ts';

const form = (over: Partial<StayForm> = {}): StayForm => ({ guestId: null, name: 'Asha Rao', phone: '9845000001', arrival: '2026-10-20', nights: 2, roomTypeId: 3, rooms: 1, adults: 2, children: 0, ratePlanId: null, roomId: null, advance: '', method: '', notes: '', ...over });

test('dates: a stay of n nights ends n days later, across a month end', () => {
  assert.equal(departureFor('2026-10-30', 3), '2026-11-02');
  assert.equal(departureFor('2026-10-20', 0), '2026-10-21');
  assert.equal(nightsBetween('2026-10-20', '2026-10-23'), 3);
  assert.equal(isDay('2026-10-20'), true); assert.equal(isDay('20-10-2026'), false); assert.equal(isDay('2026-13-40'), false);
});

test('a booking needs a guest, a room type, a valid date not in the past, sensible counts, and a method for an advance', () => {
  assert.equal(stayProblem(form(), '2026-10-13', false), '');
  assert.match(stayProblem(form({ name: ' ' }), '2026-10-13', false), /guest name/);
  assert.equal(stayProblem(form({ name: '', guestId: 5 }), '2026-10-13', false), '');
  assert.match(stayProblem(form({ roomTypeId: null }), '2026-10-13', false), /room type/);
  assert.match(stayProblem(form({ arrival: '20/10' }), '2026-10-13', false), /arrival date/);
  assert.match(stayProblem(form({ arrival: '2026-10-01' }), '2026-10-13', false), /before today/);
  assert.match(stayProblem(form({ arrival: '2026-10-13' }), '2026-10-13', true), /room number for a walk-in/);
  assert.equal(stayProblem(form({ arrival: '2026-10-13', roomId: 4 }), '2026-10-13', true), '');
  assert.match(stayProblem(form({ arrival: '2026-10-13', rooms: 2 }), '2026-10-13', true), /one room at a time/);
  assert.match(stayProblem(form({ nights: 0 }), '2026-10-13', false), /nights/);
  assert.match(stayProblem(form({ rooms: 9 }), '2026-10-13', false), /rooms/);
  assert.match(stayProblem(form({ roomId: 4, rooms: 2 }), '2026-10-13', false), /one room/);
  assert.match(stayProblem(form({ advance: '500' }), '2026-10-13', false), /how the advance/);
  assert.equal(stayProblem(form({ advance: '500', method: 'UPI' }), '2026-10-13', false), '');
});

test('a booking sends a known guest by id or a new one by name, one entry per room, and the advance in rupees', () => {
  const b = stayBody(form({ rooms: 2, ratePlanId: 8, advance: '1000', method: 'CASH', notes: ' late arrival ' }), false) as Record<string, unknown>;
  assert.equal(b.arrival, '2026-10-20'); assert.equal(b.departure, '2026-10-22'); assert.equal(b.source, 'PHONE');
  assert.deepEqual(b.guest, { name: 'Asha Rao', phone: '9845000001' });
  assert.equal((b.rooms as unknown[]).length, 2);
  assert.equal(b.rate_plan_id, 8); assert.deepEqual(b.advance, { amount: 1000, method: 'CASH' }); assert.equal(b.notes, 'late arrival');
  const w = stayBody(form({ guestId: 5, roomId: 12 }), true) as Record<string, unknown>;
  assert.equal('arrival' in w, false); assert.equal(w.source, 'WALK_IN'); assert.deepEqual(w.guest, { guest_id: 5 });
  assert.deepEqual((w.rooms as { room_id?: number }[])[0].room_id, 12);
});

test('the price quote and the free-room list are asked for only when there is something to ask', () => {
  assert.equal(quotePath(form({ roomTypeId: null })), null);
  assert.equal(quotePath(form({ arrival: 'x' })), null);
  assert.equal(quotePath(form({ ratePlanId: 8 })), '/hotel/quote?room_type_id=3&arrival=2026-10-20&departure=2026-10-22&adults=2&children=0&rate_plan_id=8');
  assert.equal(freeRoomsPath(3, '2026-10-20', '2026-10-22', 7), '/hotel/free-rooms?room_type_id=3&arrival=2026-10-20&departure=2026-10-22&exclude_rr_id=7');
});

test('a charge needs a description, a price above zero, and a sensible quantity and GST', () => {
  assert.match(chargeProblem('', '100', '1', '12'), /what the charge/);
  assert.match(chargeProblem('Laundry', '0', '1', '12'), /price/);
  assert.match(chargeProblem('Laundry', '100', '0', '12'), /quantity/);
  assert.match(chargeProblem('Laundry', '100', '1', '150'), /GST/);
  assert.equal(chargeProblem('Laundry', '100', '', ''), '');
  assert.deepEqual(chargeBody('LAUNDRY', ' Shirts ', '150', '2', '12', 4), { department: 'LAUNDRY', description: 'Shirts', price: 150, quantity: 2, tax_rate: 12, rr_id: 4 });
  assert.deepEqual(chargeBody('MISC', 'Taxi', '500', '', ''), { department: 'MISC', description: 'Taxi', price: 500, quantity: 1, tax_rate: 0 });
});

test('cancel and no-show: only a booked stay, and no-show only from its arrival day', () => {
  assert.equal(canCancel({ status: 'CONFIRMED' }), true); assert.equal(canCancel({ status: 'CHECKED_IN' }), false);
  assert.equal(canNoShow({ status: 'CONFIRMED', arrival: '2026-10-13' }, '2026-10-13'), true);
  assert.equal(canNoShow({ status: 'CONFIRMED', arrival: '2026-10-20' }, '2026-10-13'), false);
  assert.equal(canNoShow({ status: 'CANCELLED', arrival: '2026-10-01' }, '2026-10-13'), false);
  assert.match(reasonProblem('  '), /why/); assert.equal(reasonProblem('Guest called'), '');
  assert.equal(reasonBody('x'.repeat(400)).reason.length, 300);
});

test('rooms that can be moved are held or in the house and already have a number', () => {
  const r = (rr_id: number, room_id: number | null, status: string) => ({ rr_id, room_id, room_no: null, room_type: 'D', status, adults: 1, children: 0 });
  assert.deepEqual(movableRooms({ rooms: [r(1, 5, 'IN_HOUSE'), r(2, null, 'RESERVED'), r(3, 6, 'CANCELLED'), r(4, 7, 'RESERVED')] }).map((x) => x.rr_id), [1, 4]);
  assert.deepEqual(moveBody(1, 9, ' AC broken '), { rr_id: 1, room_id: 9, reason: 'AC broken' });
  assert.deepEqual(moveBody(1, 9, ''), { rr_id: 1, room_id: 9 });
});
