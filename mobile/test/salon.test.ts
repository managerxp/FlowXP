/* The salon till: building a bill, what a client can take free, and what is sent to the server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPackage, addPlan, addRetail, addService, canBill, canNoShow, itemsBody, linesFromAppointment, removeLine, roughPaise, saleBody, salonProblem, setRetailQty, setUse, staffFor, usesFor,
  type Appointment, type Entitlements, type SalonCatalog, type SalonLine
} from '../src/lib/salon.ts';

const cut = { service_id: 1, name: 'Haircut', category_id: 1, price: 400, tax_rate: 18, duration_min: 30, gender: 'ANY' };
const colour = { service_id: 2, name: 'Colour', category_id: 1, price: 1500, tax_rate: 18, duration_min: 90, gender: 'ANY' };
const asha = { staff_id: 7, name: 'Asha', staff_role: 'STYLIST', service_ids: [1] };
const ravi = { staff_id: 8, name: 'Ravi', staff_role: 'STYLIST', service_ids: [2] };
const catalog: SalonCatalog = { categories: [], services: [cut, colour], staff: [asha, ravi], packages: [], membership_plans: [], payment_methods: ['CASH', 'UPI', 'CARD', 'GIFT_CARD'], tax: { inclusive: false, gst_enabled: true, round_off: true }, loyalty: { enabled: false } };
const ent: Entitlements = {
  customer: { customer_id: 5, name: 'Aanya' },
  membership: { membership_id: 3, plan_name: 'Gold', expiry_date: '2027-01-01', discount_pct: 10, free_services: [{ service_id: 1, name: 'Haircut', remaining: 1 }] },
  packages: [{ cp_id: 9, name: 'Spa 5', expiry_date: '2027-01-01', items: [{ service_id: 2, name: 'Colour', remaining: 2 }] }], gift_cards: []
};

test('the team members who do a service come first, the rest after', () => {
  assert.deepEqual(staffFor(catalog, 1).qualified.map((s) => s.name), ['Asha']);
  assert.deepEqual(staffFor(catalog, 1).others.map((s) => s.name), ['Ravi']);
});

test('a bill holds services with who does them, retail by quantity, a package and a membership once each', () => {
  let l: SalonLine[] = addService([], cut, asha);
  l = addRetail(addRetail(l, { product_id: 40, name: 'Shampoo', price: 250, tax_rate: 18, stock: 5, brand: null }), { product_id: 40, name: 'Shampoo', price: 250, tax_rate: 18, stock: 5, brand: null });
  l = addPlan(addPlan(l, { plan_id: 2, name: 'Gold', description: null, price: 3000, duration_days: 365, tax_rate: 18 }), { plan_id: 2, name: 'Gold', description: null, price: 3000, duration_days: 365, tax_rate: 18 });
  l = addPackage(l, { package_id: 4, name: 'Spa 5', price: 5000, validity_days: 90, tax_rate: 18, items: [] });
  assert.equal(l.length, 4); assert.equal(l.find((x) => x.type === 'PRODUCT' && x.quantity === 2) != null, true);
  assert.equal(roughPaise(l), 40000 + 50000 + 300000 + 500000);
  const shampoo = l.find((x) => x.type === 'PRODUCT')!;
  assert.equal(setRetailQty(l, shampoo.key, 0).length, 3, 'zero takes it off');
  assert.equal(removeLine(l, l[0].key).length, 3);
});

test('a client can take a package visit or a membership service free, never more than is left, and not twice on one bill', () => {
  assert.deepEqual(usesFor(ent, 1, []).map((u) => u.kind), ['MEMBERSHIP']);
  assert.deepEqual(usesFor(ent, 2, []).map((u) => u.kind), ['PACKAGE']);
  assert.deepEqual(usesFor(null, 1, []), []);
  const one = addService([], cut, asha);
  assert.equal((setUse(one, one[0].key, { kind: 'MEMBERSHIP', label: 'Gold' })[0] as { use?: unknown }).use != null, true);
  const withUse = addService([], cut, asha).map((x) => ({ ...x, use: { kind: 'MEMBERSHIP' as const, label: 'Gold' } }));
  assert.deepEqual(usesFor(ent, 1, withUse), [], 'the one free haircut is already on this bill');
});

test('a free service costs nothing in the rough total', () => {
  const l = addService([], cut, asha).map((x) => ({ ...x, use: { kind: 'MEMBERSHIP' as const, label: 'Gold' } }));
  assert.equal(roughPaise(l), 0);
});

test('what is sent: services with staff, a membership use by kind only, and the payment of the whole quoted total', () => {
  const line = addService([], cut, asha)[0];
  const free = { ...line, use: { kind: 'MEMBERSHIP' as const, label: 'Gold' } };
  const pkg = { ...addService([], colour, ravi)[0], use: { kind: 'PACKAGE' as const, cp_id: 9, label: 'Spa 5' } };
  assert.deepEqual(itemsBody([free, pkg]), [
    { type: 'SERVICE', service_id: 1, staff_id: 7, quantity: 1, use: { kind: 'MEMBERSHIP' } },
    { type: 'SERVICE', service_id: 2, staff_id: 8, quantity: 1, use: { kind: 'PACKAGE', cp_id: 9 } }
  ]);
  const body = saleBody([line], 5, 77, 472, 'UPI', ' ref1 ');
  assert.deepEqual(body, { items: [{ type: 'SERVICE', service_id: 1, staff_id: 7, quantity: 1 }], customer_id: 5, appointment_id: 77, payments: [{ method: 'UPI', amount: 472, reference_number: 'ref1' }] });
  assert.deepEqual(saleBody([line], null, null, 0, 'CASH', '').payments, [], 'a fully free bill takes no payment');
});

test('a bill needs an item, and a package, membership or free visit needs a client', () => {
  const svc = addService([], cut, asha);
  assert.match(salonProblem([], null), /at least one/);
  assert.equal(salonProblem(svc, null), '');
  assert.match(salonProblem(addPackage(svc, { package_id: 1, name: 'P', price: 1, validity_days: 1, tax_rate: 0, items: [] }), null), /client/);
  assert.equal(salonProblem(addPlan(svc, { plan_id: 1, name: 'G', description: null, price: 1, duration_days: 1, tax_rate: 0 }), 5), '');
});

const appt = (status: Appointment['status'], start: string): Appointment => ({ appointment_id: 1, customer_id: 5, customer_name: 'Aanya', customer_phone: null, start_at: start, end_at: start, status, notes: null, invoice_id: null, services: [], total: 0 });

test('an appointment becomes a bill with its services and who does them; only an open one can be billed; a no-show only once its time has come', () => {
  const lines = linesFromAppointment({ appointment_id: 1, customer_id: 5, guest_name: null, items: [{ type: 'SERVICE', service_id: 1, staff_id: 7, staff_name: 'Asha', name: 'Haircut', price: 399, quantity: 1 }] }, catalog);
  assert.deepEqual(lines.map((l) => [l.type, l.type === 'SERVICE' ? l.price : 0, l.type === 'SERVICE' ? l.staff_name : '']), [['SERVICE', 400, 'Asha']], 'today\'s price from the menu');
  assert.equal(canBill(appt('IN_SERVICE', '2026-10-08T10:00:00Z')), true);
  assert.equal(canBill(appt('COMPLETED', '2026-10-08T10:00:00Z')), false);
  const now = new Date('2026-10-08T12:00:00Z');
  assert.equal(canNoShow(appt('BOOKED', '2026-10-08T10:00:00Z'), now), true);
  assert.equal(canNoShow(appt('BOOKED', '2026-10-08T15:00:00Z'), now), false);
  assert.equal(canNoShow(appt('CHECKED_IN', '2026-10-08T10:00:00Z'), now), false);
});
