/* Salon: booking, gift cards, offer codes and points, and how clients, timelines and reports read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addGiftCard, addService, bookBody, bookProblem, cellText, clientLine, dayChoices, freeAt, itemsBody, monthRange, paymentsFor, quoteBody, rowLines, saleBody, slotStart, timelineText, totalMinutes,
  type SalonCatalog, type SalonClient, type TimelineRow
} from '../src/lib/salon.ts';

const cut = { service_id: 1, name: 'Haircut', category_id: 1, price: 400, tax_rate: 18, duration_min: 30, gender: 'ANY' };
const spa = { service_id: 2, name: 'Spa', category_id: 1, price: 1500, tax_rate: 18, duration_min: 60, gender: 'ANY' };
const asha = { staff_id: 7, name: 'Asha', staff_role: 'STYLIST', service_ids: [1] };
const catalog = { services: [cut, spa], staff: [asha] } as unknown as SalonCatalog;

test('the booking days start today, then tomorrow, then dated, across a month end', () => {
  const d = dayChoices(new Date(2026, 9, 30), 4);
  assert.deepEqual(d.map((x) => x.id), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual([d[0].label, d[1].label], ['Today', 'Tomorrow']);
});

test('a slot becomes the moment it starts, and the length of a booking is its services added up', () => {
  const at = new Date(slotStart('2026-10-09', '14:30'));
  assert.deepEqual([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()], [2026, 9, 9, 14, 30]);
  assert.equal(totalMinutes(catalog, [1, 2]), 90);
});

test('a booking sends a known client or a guest name and phone, the services (with one team member when chosen), and a note only if typed', () => {
  const start = '2026-10-09T09:00:00.000Z';
  assert.deepEqual(bookBody({ customerId: 5, guestName: '', guestPhone: '', startIso: start, serviceIds: [1, 2], staffId: null, notes: '' }),
    { customer_id: 5, start_at: start, source: 'PHONE', services: [{ service_id: 1 }, { service_id: 2 }] });
  assert.deepEqual(bookBody({ customerId: null, guestName: ' Meera ', guestPhone: ' 9812345678 ', startIso: start, serviceIds: [1], staffId: 7, notes: ' window seat ' }),
    { guest_name: 'Meera', guest_phone: '9812345678', start_at: start, source: 'PHONE', services: [{ service_id: 1, staff_id: 7 }], notes: 'window seat' });
});

test('a booking needs a client or a name, a service and a time; free staff come from the chosen slot', () => {
  assert.match(bookProblem(null, ' ', [1], '10:00'), /client/);
  assert.match(bookProblem(5, '', [], '10:00'), /service/);
  assert.match(bookProblem(5, '', [1], null), /time/);
  assert.equal(bookProblem(5, '', [1], '10:00'), '');
  const slots = [{ time: '10:00', staff: [{ staff_id: 7, name: 'Asha' }] }, { time: '10:30', staff: [] }];
  assert.deepEqual(freeAt(slots, '10:00').map((s) => s.name), ['Asha']);
  assert.deepEqual(freeAt(slots, '11:00'), []);
});

test('a gift card sold is a line of its amount; a gift card paid with covers what it has and the chosen method pays the rest', () => {
  const lines = addGiftCard([], 1000);
  assert.deepEqual(itemsBody(lines), [{ type: 'GIFT_CARD', amount: 1000 }]);
  assert.deepEqual(paymentsFor(1180, 'UPI', ' r1 ', { code: 'GC-AB12', balance: 500 }), [{ method: 'GIFT_CARD', amount: 500, code: 'GC-AB12' }, { method: 'UPI', amount: 680, reference_number: 'r1' }]);
  assert.deepEqual(paymentsFor(300, 'CASH', '', { code: 'GC-AB12', balance: 500 }), [{ method: 'GIFT_CARD', amount: 300, code: 'GC-AB12' }], 'the card covers it all: nothing else is taken');
  assert.deepEqual(paymentsFor(300, 'CASH', '', undefined), [{ method: 'CASH', amount: 300 }]);
  assert.deepEqual(paymentsFor(0, 'CASH', '', { code: 'x', balance: 10 }), []);
});

test('an offer code and points go to the quote and the sale, only when given', () => {
  const lines = addService([], cut, asha);
  assert.deepEqual(Object.keys(quoteBody(lines, 5, null)).sort(), ['customer_id', 'items']);
  const q = quoteBody(lines, 5, null, { offerCode: ' DIWALI ', redeemPoints: 50 });
  assert.deepEqual([q.offer_code, q.redeem_points], ['DIWALI', 50]);
  assert.equal('redeem_points' in quoteBody(lines, 5, null, { redeemPoints: 0 }), false);
  assert.equal(saleBody(lines, 5, null, 472, 'CASH', '', { offerCode: 'X' }).offer_code, 'X');
});

test('a client row and a timeline entry read in plain words', () => {
  const c = { customer_id: 1, name: 'Aanya', phone: '9812345678', visits: 1, last_visit: '2026-10-03T10:00:00Z', points: 0, membership: null, labels: [], allergies: null } as SalonClient;
  assert.equal(clientLine(c), '9812345678 · 1 visit · last 2026-10-03');
  assert.equal(clientLine({ ...c, visits: 3, phone: null, last_visit: null }), '3 visits');
  const row = (type: TimelineRow['type'], detail: string | null, summary: string | null): TimelineRow => ({ at: '2026-10-03', type, detail, summary, amount: null });
  assert.equal(timelineText(row('appointment', 'NO_SHOW', 'Haircut')), 'Appointment (no show): Haircut');
  assert.equal(timelineText(row('invoice', null, 'INV-7 — Haircut')), 'Bill INV-7 — Haircut');
  assert.equal(timelineText(row('note', null, 'Prefers Asha')), 'Note: Prefers Asha');
});

test('a report row shows its first column as the title and the rest as label and value; money in rupees', () => {
  const cols = [{ key: 'service', label: 'Service', type: 'text' as const }, { key: 'done', label: 'Times done', type: 'number' as const }, { key: 'revenue', label: 'Revenue', type: 'money' as const }];
  assert.deepEqual(rowLines({ service: 'Haircut', done: 12, revenue: 4800.5 }, cols), { title: 'Haircut', lines: ['Times done: 12', 'Revenue: ₹4,800.50'] });
  assert.equal(cellText(null, 'money'), '-');
  assert.deepEqual(monthRange(new Date(2026, 9, 8)), { from: '2026-10-01', to: '2026-10-08' });
});
