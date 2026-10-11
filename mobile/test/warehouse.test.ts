/* The warehouse: picking in the sold unit, short picks, packing, dispatch, and the delivery on the road. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boardLines, deliveryActions, deliveryBody, deliveryProblem, dispatchBody, dispatchProblem, inUnit, matchScan, packBody, packProblem, pickBody, pickNext, pickProblem, pickedBase, shortItems, wantedText,
  type Board, type PickItem
} from '../src/lib/warehouse.ts';

const item = (id: number, over: Partial<PickItem> = {}): PickItem => ({ pick_item_id: id, order_item_id: id + 100, product_id: id + 1000, product: `P${id}`, sku: null, base_unit: 'pcs', unit_name: 'Carton', unit_factor: 12, location: 'A-01', qty_base: 48, picked_base: 0, serials: [], batches: [], ...over });

test('quantities are read in the unit the order was sold in: 48 pieces of a 12-piece carton is 4 cartons', () => {
  assert.equal(inUnit(item(1), 48), 4);
  assert.equal(wantedText(item(1)), '4 Carton');
  assert.equal(wantedText(item(2, { unit_name: null, unit_factor: 1, qty_base: 7 })), '7 pcs');
  assert.equal(inUnit(item(1), 30), 2.5);
});

test('what was picked is typed in the sold unit and sent in base units; blank means all of it', () => {
  const a = item(1); const b = item(2, { qty_base: 10, unit_name: null, unit_factor: 1 });
  assert.equal(pickedBase(a, undefined), 48); assert.equal(pickedBase(a, ' '), 48);
  assert.equal(pickedBase(a, '3'), 36); assert.equal(pickedBase(a, '0'), 0);
  assert.deepEqual(pickBody([a, b], { 1: '3' }), { items: [{ pick_item_id: 1, picked_base: 36 }, { pick_item_id: 2, picked_base: 10 }] });
});

test('picking more than was asked, or nothing, is caught before it is sent; a short pick is named', () => {
  const a = item(1); const b = item(2, { qty_base: 10, unit_name: null, unit_factor: 1 });
  assert.match(pickProblem([a, b], { 1: '5' }), /cannot pick more than 4 Carton/);
  assert.match(pickProblem([a, b], { 1: 'x' }), /enter how many/);
  assert.match(pickProblem([a], { 1: '0' }), /Nothing was picked/);
  assert.equal(pickProblem([a, b], {}), '');
  assert.equal(pickProblem([a, b], { 1: '0' }), '', 'one item at nothing is fine while another is picked');
  assert.deepEqual(shortItems([a, b], { 1: '3', 2: '10' }), [{ product: 'P1', short: 1, unit: 'Carton' }]);
  assert.deepEqual(shortItems([a, b], {}), []);
});

test('a scanned barcode ticks the item of that product, and says nothing for one that is not on the list', () => {
  const list = [item(1), item(2)];
  assert.equal(matchScan(list, 1002)?.pick_item_id, 2);
  assert.equal(matchScan(list, 9999), null); assert.equal(matchScan(list, null), null);
});

test('what a pick list does next depends on where it is', () => {
  assert.deepEqual(['PENDING', 'PICKING', 'PICKED', 'PACKING', 'PACKED', 'DISPATCHED', 'CANCELLED'].map((s) => pickNext(s as never)), ['start', 'pick', 'pack', 'pack', 'dispatch', null, null]);
});

test('packing puts everything picked in one package, with a weight only if given', () => {
  const l = [item(1, { picked_base: 48 }), item(2, { picked_base: 0 })];
  assert.deepEqual(packBody(l, ' 12.5 '), { packages: [{ weight_kg: 12.5, items: [{ pick_item_id: 1, qty_base: 48 }] }] });
  assert.deepEqual(packBody(l, ''), { packages: [{ items: [{ pick_item_id: 1, qty_base: 48 }] }] });
  assert.equal(packProblem(''), ''); assert.match(packProblem('abc'), /not a number/);
});

test('dispatch sends the vehicle, the driver, the kind of bill, and a payment of the whole bill only for a paid-now bill', () => {
  assert.deepEqual(dispatchBody({ vehicle: ' ts09ub1234 ', driver: ' Mahesh ', phone: '', kind: 'TAX', method: 'CASH', reference: '' }), { invoice_kind: 'TAX', vehicle_no: 'TS09UB1234', driver_name: 'Mahesh' });
  assert.deepEqual(dispatchBody({ vehicle: '', driver: '', phone: '98', kind: 'CASH', method: 'UPI', reference: ' U1 ' }), { invoice_kind: 'CASH', driver_phone: '98', payment: { amount: 'FULL', method: 'UPI', reference_number: 'U1' } });
  assert.equal('payment' in dispatchBody({ vehicle: '', driver: '', phone: '', kind: 'CREDIT', method: 'CASH', reference: '' }), false);
  assert.match(dispatchProblem('CASH', 'UPI', ' '), /reference/); assert.equal(dispatchProblem('CASH', 'CASH', ''), ''); assert.equal(dispatchProblem('TAX', 'UPI', ''), '');
});

test('a delivery moves on the road: out, then delivered (who took it) or could not deliver (why); a refusal of some goods is left to the website', () => {
  assert.deepEqual(deliveryActions('ASSIGNED').map((a) => a.to), ['OUT_FOR_DELIVERY']);
  assert.deepEqual(deliveryActions('OUT_FOR_DELIVERY').map((a) => [a.to, a.ask]), [['DELIVERED', 'name'], ['FAILED', 'reason']]);
  assert.deepEqual(deliveryActions('FAILED').map((a) => a.to), ['OUT_FOR_DELIVERY', 'RETURNED']);
  for (const s of ['DELIVERED', 'PARTIAL', 'RETURNED'] as const) assert.deepEqual(deliveryActions(s), [], s);
  const [delivered, failed] = deliveryActions('OUT_FOR_DELIVERY');
  assert.match(deliveryProblem(delivered, ' ', ''), /who received/); assert.match(deliveryProblem(failed, '', 'no'), /why/);
  assert.equal(deliveryProblem(delivered, 'Ravi', ''), '');
  assert.deepEqual(deliveryBody(delivered, ' Ravi ', ' at the gate ', ''), { status: 'DELIVERED', pod_received_by: 'Ravi', pod_note: 'at the gate' });
  assert.deepEqual(deliveryBody(failed, '', '', ' shop closed '), { status: 'FAILED', failure_reason: 'shop closed' });
});

test('the board reads as short lines in the order the work flows', () => {
  const b: Board = { orders_to_pick: 3, pick_lists: { PENDING: 1, PICKING: 2, PICKED: 1, PACKED: 2 }, deliveries: { OUT_FOR_DELIVERY: 4, FAILED: 1 } };
  assert.deepEqual(boardLines(b).map((l) => [l.label, l.n]), [['Orders to pick', 3], ['Being picked', 3], ['Ready to pack', 1], ['Ready to send out', 2], ['On the road', 4], ['Could not deliver', 1]]);
  assert.deepEqual(boardLines(null), []);
});
