import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceBody, auditBlocked, auditBody, bankPaymentBody, bankPaymentProblem, leaveDays, paymentKind, rs } from '../src/lib/hotelOps.ts';

test('money from the server is in paise and shown in rupees', () => {
  assert.equal(rs(1234500), '₹12,345'); assert.equal(rs(null), '₹0'); assert.equal(rs('50000'), '₹500');
});

test('the day cannot close while bookings have not arrived, unless they are all marked as no-shows', () => {
  assert.equal(auditBlocked({ pending_arrivals: [] }), false);
  assert.equal(auditBlocked({ pending_arrivals: [{ booking_id: 1, res_no: 'R1', arrival: '2026-11-10', guest_name: 'A', rooms: 1 }] }), true);
  assert.deepEqual(auditBody(true), { no_show_all: true }); assert.deepEqual(auditBody(false), {});
});

test('an event payment needs an amount, cannot pass what is owed, and the first one is the advance', () => {
  assert.match(bankPaymentProblem(0, 50000, 'PAYMENT'), /amount/);
  assert.match(bankPaymentProblem(600, 50000, 'PAYMENT'), /more than/);
  assert.equal(bankPaymentProblem(600, 50000, 'ADVANCE'), '');
  assert.equal(bankPaymentProblem(500, 50000, 'PAYMENT'), '');
  assert.deepEqual(bankPaymentBody(500, 'UPI', 'ADVANCE'), { kind: 'ADVANCE', method: 'UPI', amount: 500 });
  assert.equal(paymentKind({ payments: [] }), 'ADVANCE');
  assert.equal(paymentKind({ payments: [{ bp_id: 1, kind: 'ADVANCE', method: 'CASH', amount_paise: 1, pay_date: 'x' }] }), 'PAYMENT');
});

test('attendance and leave', () => {
  assert.deepEqual(attendanceBody('2026-11-10', 4, 'PRESENT'), { date: '2026-11-10', entries: [{ employee_id: 4, status: 'PRESENT' }] });
  assert.equal(leaveDays({ from_date: '2026-11-10', to_date: '2026-11-12' }), 3);
});
