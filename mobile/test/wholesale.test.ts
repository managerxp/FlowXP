/* Wholesale: building an order, what is sent, credit in plain words, and spreading a payment over what is owed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addLine, collectBody, collectProblem, creditText, dropLine, isOpen, ledgerText, linesBody, needsReference, orderActions, orderBody, orderProblem, previewBody, setQty, setUnit, shortLines, spread,
  type OpenInvoice, type WPreview, type WProduct
} from '../src/lib/wholesale.ts';

const prod = (id: number, over: Partial<WProduct> = {}): WProduct => ({ product_id: id, name: `P${id}`, sku: null, unit: 'kg', selling_price: 50, wholesale_price: 45, tax_rate: 5, moq: 1, track_inventory: true, ...over });
const inv = (id: number, balance: number): OpenInvoice => ({ invoice_id: id, invoice_number: `INV-${id}`, invoice_date: '2026-09-01', due_date: '2026-09-16', days_overdue: 10, total: balance, balance });

test('adding the same product and unit again makes it one more; another unit is its own line; the minimum order sets the first quantity', () => {
  let l = addLine([], prod(1, { moq: 10 }));
  assert.equal(l[0].quantity, '10');
  l = addLine(addLine(l, prod(1, { moq: 10 })), prod(1, { moq: 10 }), 'Carton');
  assert.deepEqual(l.map((x) => [x.unit_name, x.quantity]), [[null, '11'], ['Carton', '10']]);
  assert.equal(setQty(l, l[0].key, '25')[0].quantity, '25');
  assert.equal(setUnit(l, l[0].key, 'Bag')[0].unit_name, 'Bag');
  assert.equal(dropLine(l, l[0].key).length, 1);
});

test('what is sent: product, quantity and unit only (the server prices); a line with no quantity is left out; the extras only when typed', () => {
  const l = [...addLine([], prod(1)), ...addLine([], prod(2), 'Carton')];
  const z = setQty(l, l[1].key, '0');
  assert.deepEqual(linesBody(z), [{ product_id: 1, quantity: 1 }]);
  assert.deepEqual(linesBody(l), [{ product_id: 1, quantity: 1 }, { product_id: 2, quantity: 1, unit_name: 'Carton' }]);
  assert.deepEqual(previewBody(7, l), { customer_id: 7, lines: linesBody(l) });
  assert.deepEqual(orderBody(7, l), { customer_id: 7, lines: linesBody(l) });
  assert.deepEqual(orderBody(7, l, { submit: true, customerPo: ' PO-9 ', notes: ' rush ', expectedDelivery: '2026-10-20' }), { customer_id: 7, lines: linesBody(l), submit: true, customer_po: 'PO-9', notes: 'rush', expected_delivery: '2026-10-20' });
});

test('an order needs a customer, something ordered, and at least the minimum when sold by the piece', () => {
  const l = addLine([], prod(1, { moq: 12, unit: 'pcs' }));
  assert.match(orderProblem(null, l), /customer/);
  assert.match(orderProblem(5, []), /at least one/);
  assert.match(orderProblem(5, setQty(l, l[0].key, '6')), /minimum order is 12 pcs/);
  assert.equal(orderProblem(5, setQty(l, l[0].key, '12')), '');
  assert.equal(orderProblem(5, setUnit(setQty(l, l[0].key, '1'), l[0].key, 'Carton')), '', 'a carton is not held to the per-piece minimum on the phone; the server decides');
});

test('what can be done with an order depends on where it is; nothing once it is on its way', () => {
  assert.deepEqual(orderActions({ status: 'DRAFT' }).map((a) => a.id), ['submit', 'confirm', 'cancel']);
  assert.deepEqual(orderActions({ status: 'PENDING' }).map((a) => a.id), ['confirm', 'cancel']);
  assert.deepEqual(orderActions({ status: 'CONFIRMED' }).map((a) => a.id), ['cancel']);
  for (const s of ['DISPATCHED', 'DELIVERED', 'CANCELLED', 'REJECTED', 'FULFILLED'] as const) assert.deepEqual(orderActions({ status: s }), [], s);
  assert.equal(isOpen('PENDING'), true); assert.equal(isOpen('DELIVERED'), false);
});

test('credit is said in plain words, and short lines are found', () => {
  assert.deepEqual(creditText({ level: 'BLOCK', reasons: ['This takes them over their credit limit by ₹6,600'], limit: 40000, outstanding: 45000, available: 0 }), { tone: 'bad', text: 'This takes them over their credit limit by ₹6,600' });
  assert.equal(creditText({ level: 'WARN', reasons: [], limit: 1, outstanding: 1, available: 0 }).tone, 'warn');
  assert.deepEqual(creditText({ level: 'OK', reasons: [], limit: 1, outstanding: 0, available: 1 }), { tone: 'ok', text: 'Within the credit limit' });
  assert.deepEqual(creditText(null), { tone: 'ok', text: '' });
  const p = { lines: [{ short: 0 }, { short: 3 }] } as unknown as WPreview;
  assert.equal(shortLines(p).length, 1); assert.deepEqual(shortLines(null), []);
});

test('a payment needs a customer and an amount, and a reference for UPI, bank and cheque', () => {
  assert.match(collectProblem(null, '100', 'CASH', ''), /customer/);
  for (const a of ['', '0', '-5', 'x']) assert.match(collectProblem(5, a, 'CASH', ''), /amount/, a);
  assert.equal(collectProblem(5, '100', 'CASH', ''), '');
  assert.match(collectProblem(5, '100', 'CHEQUE', ' '), /cheque number/);
  assert.match(collectProblem(5, '100', 'UPI', ''), /reference/);
  assert.equal(collectProblem(5, '100', 'BANK_TRANSFER', 'UTR1'), '');
  assert.deepEqual([needsReference('CASH'), needsReference('CARD'), needsReference('CHEQUE')], [false, false, true]);
});

test('what is sent for a payment: the oldest bills first unless one is chosen; cheque details only for a cheque', () => {
  assert.deepEqual(collectBody(5, '1000', 'CASH', ''), { customer_id: 5, amount: 1000, method: 'CASH', allocate: 'OLDEST' });
  assert.deepEqual(collectBody(5, '1000', 'CHEQUE', ' 123456 ', { chequeDate: '2026-10-20', bank: ' HDFC ', notes: '' }), { customer_id: 5, amount: 1000, method: 'CHEQUE', reference: '123456', cheque_date: '2026-10-20', bank: 'HDFC', allocate: 'OLDEST' });
  assert.equal('cheque_date' in collectBody(5, '1000', 'UPI', 'U1', { chequeDate: '2026-10-20' }), false);
  assert.deepEqual((collectBody(5, '500', 'UPI', 'U1', { invoiceId: 42 }) as { allocations?: unknown }).allocations, [{ invoice_id: 42, amount: 500 }]);
});

test('a payment is spread over the oldest bills, and what is left over is kept as an advance', () => {
  const p = spread([inv(1, 300), inv(2, 500), inv(3, 200)], 700);
  assert.deepEqual(p.map((x) => [x.invoice.invoice_id, x.pay]), [[1, 300], [2, 400]]);
  assert.equal(p.advance, 0);
  const more = spread([inv(1, 300)], 450.5);
  assert.deepEqual([more[0].pay, more.advance], [300, 150.5]);
  assert.equal(spread([], 100).advance, 100);
});

test('an account line reads in words', () => {
  assert.equal(ledgerText({ date: '2026-10-01', type: 'SALES_INVOICE', ref: 'INV-9', description: 'goods', debit: 100, credit: 0, balance: 100 }), 'sales invoice INV-9: goods');
  assert.equal(ledgerText({ date: '2026-10-01', type: 'RECEIPT', ref: null, description: null, debit: 0, credit: 50, balance: 50 }), 'receipt');
});
