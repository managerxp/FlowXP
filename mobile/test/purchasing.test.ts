/* Buying: building a purchase order in the supplier's units, receiving a delivery against it (in part, with damage, batches and use-by dates), and paying the supplier. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedOf, addBLine, directLine, dropBLine, editR, grnBody, grnProblem, isOpenPO, linesFromPO, orderEstimatePaise, payBody, payProblem, poActions, poBody, poProblem, rLineProblem, setBCost, setBQty, setBUnit, stillDue,
  type BuyProduct, type PO
} from '../src/lib/purchasing.ts';

const prod = (id: number, over: Partial<BuyProduct> = {}): BuyProduct => ({ product_id: id, name: `P${id}`, sku: null, unit: 'pcs', purchase_price: 10, tax_rate: 5, batch_tracking: false, expiry_tracking: false, serial_tracking: false, units: [{ unit_name: 'Carton', factor: 24, barcode: null }], ...over });
const today = '2026-10-08';

test('the same product and unit added again is one more; a carton is its own line; the cost per unit defaults to the last price times the unit size', () => {
  let l = addBLine([], prod(1)); l = addBLine(l, prod(1)); l = addBLine(l, prod(1), 'Carton');
  assert.deepEqual(l.map((x) => [x.unit_name, x.quantity]), [[null, '2'], ['Carton', '1']]);
  assert.equal(orderEstimatePaise(l), 2 * 1000 + 24 * 1000, '2 pieces at 10, and one carton of 24 at 10 a piece');
  const typed = setBCost(setBQty(l, l[1].key, '3'), l[1].key, '200');
  assert.equal(orderEstimatePaise(typed), 2000 + 60000, 'a typed cost per carton wins');
  assert.equal(setBUnit(l, l[0].key, 'Carton')[0].unit_name, 'Carton'); assert.equal(dropBLine(l, l[0].key).length, 1);
});

test('an order needs a supplier and something ordered, and sends only product, quantity, unit, a typed cost and the extras', () => {
  const l = setBCost(addBLine([], prod(1), 'Carton'), addBLine([], prod(1), 'Carton')[0].key, '');
  assert.match(poProblem(null, l), /supplier/); assert.match(poProblem(4, []), /at least one/); assert.equal(poProblem(4, l), '');
  const c = addBLine([], prod(2)); const withCost = setBCost(c, c[0].key, '12.5');
  assert.deepEqual(poBody(4, withCost, { expected: ' 2026-10-20 ', notes: ' rush ' }), { supplier_id: 4, items: [{ product_id: 2, quantity: 1, unit_cost: 12.5 }], expected_date: '2026-10-20', notes: 'rush' });
  assert.deepEqual(poBody(4, l), { supplier_id: 4, items: [{ product_id: 1, quantity: 1, unit_name: 'Carton' }] });
  assert.match(poProblem(4, setBCost(c, c[0].key, 'x')), /not a number/);
});

test('what can be done with an order depends on where it is', () => {
  assert.deepEqual(poActions('DRAFT').map((a) => a.id), ['approve', 'cancel']);
  assert.deepEqual(poActions('ORDERED').map((a) => a.id), ['receive', 'send', 'cancel']);
  assert.deepEqual(poActions('PARTIAL').map((a) => a.id), ['receive', 'close', 'send']);
  for (const s of ['RECEIVED', 'CANCELLED'] as const) assert.deepEqual(poActions(s), [], s);
  assert.equal(isOpenPO('PARTIAL'), true); assert.equal(isOpenPO('DRAFT'), false);
});

const po = (): PO => ({
  po_id: 9, po_number: 'PO-9', po_date: '2026-10-01', status: 'ORDERED', supplier_id: 4, supplier: 'Acme Mills', warehouse: null, subtotal: 0, tax: 0, total: 0, paid: 0, balance: 500, payment_status: 'UNPAID', expected_date: null, notes: null, supplier_invoice_no: null, due_date: null, approved_by: null,
  items: [
    { item_id: 1, product_id: 11, description: 'Atta', unit_name: 'Bag', unit_factor: 1, base_unit: 'kg', ordered: 10, received: 4, outstanding: 6, batch_tracking: false, expiry_tracking: false, serial_tracking: false, unit_cost: 200, tax_rate: 0 },
    { item_id: 2, product_id: 12, description: 'Oil', unit_name: 'Carton', unit_factor: 12, base_unit: 'l', ordered: 5, received: 5, outstanding: 0, batch_tracking: true, expiry_tracking: true, serial_tracking: false, unit_cost: 900, tax_rate: 5 },
    { item_id: 3, product_id: 13, description: 'Biscuit', unit_name: 'Carton', unit_factor: 24, base_unit: 'pcs', ordered: 3, received: 0, outstanding: 3, batch_tracking: true, expiry_tracking: true, serial_tracking: false, unit_cost: 480, tax_rate: 18 }
  ]
});

test('a delivery against an order starts as everything still due arriving; lines already received in full are left out', () => {
  const l = linesFromPO(po());
  assert.deepEqual(l.map((x) => [x.name, x.received, x.unit_name]), [['Atta', '6', 'Bag'], ['Biscuit', '3', 'Carton']]);
  assert.equal(acceptedOf({ ...l[0], received: '6', damaged: '1' }), 5);
  assert.equal(stillDue({ ...l[0], received: '4' }), 2);
});

test('a delivery line needs a batch and a future use-by date where the item is tracked, no more damaged than arrived, and no more than is due unless extra is accepted', () => {
  const [atta, biscuit] = linesFromPO(po());
  assert.equal(rLineProblem(atta, today, false), '');
  assert.match(rLineProblem({ ...atta, received: '7' }, today, false), /only 6 Bag is still due/);
  assert.equal(rLineProblem({ ...atta, received: '7' }, today, true), '');
  assert.match(rLineProblem({ ...atta, damaged: '9' }, today, false), /damaged cannot be more/);
  assert.match(rLineProblem(biscuit, today, false), /batch number/);
  assert.match(rLineProblem({ ...biscuit, batch_no: 'B1' }, today, false), /use-by date/);
  assert.match(rLineProblem({ ...biscuit, batch_no: 'B1', expiry: '01/2026' }, today, false), /already expired/);
  assert.equal(rLineProblem({ ...biscuit, batch_no: 'B1', expiry: '03/2027' }, today, false), '');
  assert.match(rLineProblem({ ...atta, serial_tracking: true }, today, false), /serial numbers/);
  assert.equal(rLineProblem({ ...atta, received: '' }, today, false), '', 'a line with nothing arrived is left out');
});

test('a delivery needs something that arrived; with no order it needs a supplier and a cost on every line', () => {
  const lines = linesFromPO(po()).map((l) => ({ ...l, batch_no: 'B1', expiry: '03/2027' }));
  assert.equal(grnProblem(lines, today, false, null, true), '');
  assert.match(grnProblem(lines.map((l) => ({ ...l, received: '' })), today, false, null, true), /how many arrived/);
  const direct = [{ ...directLine(prod(5), null), received: '10' }];
  assert.match(grnProblem(direct, today, false, null, false), /supplier/);
  assert.match(grnProblem(direct, today, false, 4, false), /cost/);
  assert.equal(grnProblem(editR(direct, direct[0].key, { unit_cost: '12' }), today, false, 4, false), '');
});

test('what is sent for a delivery: the order or the supplier, the supplier\'s bill, each line that arrived with damage, batch and real dates, and a payment only if typed', () => {
  const lines = linesFromPO(po()).map((l) => (l.name === 'Biscuit' ? { ...l, received: '3', damaged: '1', batch_no: ' B7 ', expiry: '03/2027', mfg: '3/26' } : l));
  const body = grnBody({ poId: 9, supplierId: null, lines, invoiceNo: ' S-44 ', invoiceDate: '', allowExcess: false, closePO: true, paid: '500', method: 'UPI', reference: ' U9 ' });
  assert.deepEqual(body, {
    po_id: 9, supplier_invoice_no: 'S-44', close_po: true,
    items: [
      { po_item_id: 1, product_id: 11, received: 6, damaged: 0 },
      { po_item_id: 3, product_id: 13, received: 3, damaged: 1, batch_no: 'B7', expiry_date: '2027-03-31', mfg_date: '2026-03-31' }
    ],
    payment: { amount: 500, method: 'UPI', reference_number: 'U9' }
  });
  const d = [{ ...directLine(prod(5), 'Carton'), received: '2', unit_cost: '300' }];
  assert.deepEqual(grnBody({ poId: null, supplierId: 4, lines: d, invoiceNo: '', invoiceDate: '', allowExcess: false, closePO: false, paid: '', method: 'CASH', reference: '' }), { supplier_id: 4, items: [{ product_id: 5, unit_name: 'Carton', received: 2, damaged: 0, unit_cost: 300 }] });
});

test('paying the supplier needs an amount, not more than is owed on the order', () => {
  assert.match(payProblem('', 500), /amount/); assert.match(payProblem('600', 500), /more than the 500/); assert.equal(payProblem('500', 500), '');
  assert.deepEqual(payBody('250', 'UPI', ' U1 '), { amount: 250, method: 'UPI', reference_number: 'U1' }); assert.deepEqual(payBody('250', 'CASH', ''), { amount: 250, method: 'CASH' });
});
