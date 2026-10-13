import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedOf, addRecvLine, binByCode, isBinLabel, lookupPath, moveBody, moveProblem, partSub, pickOrder, putAwayBody, putAwayProblem, recvBody, recvProblem, recvSummary, stockText, vehiclePartsPath, vehicleText, yearsText, type Bin, type RecvLine, type StorePlace } from '../src/lib/parts.ts';

const place = (id: number, code: string, over: Partial<StorePlace> = {}): StorePlace => ({ location_id: id, code, can_store: true, is_active: true, capacity_units: null, qty: 0, ...over });
const line = (over: Partial<RecvLine> = {}): RecvLine => ({ product_id: 1, name: 'Brake pad', sku: 'AP-1', received: '10', damaged: '', rejected: '', cost: '300', binId: null, binCode: null, ...over });

test('a part is described by the numbers a counter person reads out', () => {
  assert.equal(partSub({ sku: 'AP-0004', oem_part_no: '5551168K00', mfr_part_no: null, brand_name: 'Bosch' }), 'OEM 5551168K00 · AP-0004 · Bosch');
  assert.equal(partSub({ sku: null, oem_part_no: null, mfr_part_no: 'DF4551', brand_name: null }), 'Mfr DF4551');
  assert.equal(stockText(0), 'Out of stock'); assert.equal(stockText(12), '12 in stock'); assert.equal(stockText(undefined), '');
});

test('fitment text and years', () => {
  assert.equal(yearsText({ year_from: 2018, year_to: 2023 }), '2018 to 2023');
  assert.equal(yearsText({ year_from: 2018, year_to: null }), '2018 to ...');
  assert.equal(yearsText({ year_from: null, year_to: null }), 'any year');
  assert.equal(vehicleText({ make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi' }), 'Maruti Suzuki Swift VXi');
});

test('search needs two characters, a bin label is told from a part number, paths are encoded', () => {
  assert.equal(lookupPath('a'), null);
  assert.equal(lookupPath(' 5551 168K '), '/autoparts/parts/lookup?q=5551%20168K&limit=15');
  assert.equal(isBinLabel('FXB:ab12'), true); assert.equal(isBinLabel('5551168K00'), false);
  assert.equal(vehiclePartsPath(4, '2019', 'brake pad'), '/autoparts/vehicles/parts?model_id=4&year=2019&search=brake%20pad&limit=100');
  assert.equal(vehiclePartsPath(4, '19', ''), '/autoparts/vehicles/parts?model_id=4&limit=100');
});

test('a bin is found by the code typed or scanned, only if it holds stock and is on', () => {
  const places = [place(1, 'WH-A-R01-B01'), place(2, 'WH-A-R01', { can_store: false }), place(3, 'WH-A-R02-B01', { is_active: false })];
  assert.equal(binByCode(places, ' wh-a-r01-b01 ')?.location_id, 1);
  assert.equal(binByCode(places, 'WH-A-R01'), null);
  assert.equal(binByCode(places, 'WH-A-R02-B01'), null);
  assert.equal(binByCode(places, ''), null);
});

test('put away: a bin, a quantity above zero and no more than is waiting', () => {
  assert.match(putAwayProblem('3', 5, null), /bin/);
  assert.match(putAwayProblem('', 5, 1), /how many/);
  assert.match(putAwayProblem('6', 5, 1), /Only 5/);
  assert.equal(putAwayProblem('5', 5, 1), '');
  assert.deepEqual(putAwayBody(7, 2, '3', 'k1'), { product_id: 7, location_id: 2, qty: 3, source_key: 'k1' });
});

test('move: two different bins and a quantity the first can spare', () => {
  assert.match(moveProblem(null, 2, '1', 5), /it is in/);
  assert.match(moveProblem(1, null, '1', 5), /goes to/);
  assert.match(moveProblem(1, 1, '1', 5), /different/);
  assert.match(moveProblem(1, 2, '9', 5), /Only 5/);
  assert.equal(moveProblem(1, 2, '5', 5), '');
  assert.deepEqual(moveBody(7, 1, 2, '2', 'k'), { product_id: 7, from_location_id: 1, to_location_id: 2, qty: 2, source_key: 'k' });
});

test('pick from the pick bin first, then the fullest', () => {
  const b = (id: number, avail: number, primary = false): Bin => ({ location_id: id, code: `B${id}`, qty: avail, reserved_qty: 0, available: avail, is_primary: primary });
  assert.deepEqual(pickOrder([b(1, 9), b(2, 3, true), b(3, 12)]).map((x) => x.location_id), [2, 3, 1]);
});

test('receiving: only accepted stock counts, and damaged plus rejected cannot exceed what arrived', () => {
  assert.equal(acceptedOf(line({ received: '10', damaged: '2', rejected: '1' })), 7);
  assert.equal(acceptedOf(line({ received: '', damaged: '', rejected: '' })), 0);
  assert.match(recvProblem(null, [line()]), /supplier/);
  assert.match(recvProblem(3, [line({ received: '' })]), /at least one part/);
  assert.match(recvProblem(3, [line({ damaged: '8', rejected: '5' })]), /more than what arrived/);
  assert.match(recvProblem(3, [line({ received: '5x' })]), /numbers only/);
  assert.equal(recvProblem(3, [line()]), '');
});

test('a receipt sends the lines that arrived, with the bin if one was chosen, and an optional invoice number', () => {
  const body = recvBody(3, ' INV-9 ', [line({ damaged: '1', binId: 4 }), line({ product_id: 2, received: '' })]);
  assert.deepEqual(body, { supplier_id: 3, supplier_invoice_no: 'INV-9', items: [{ product_id: 1, received: 10, damaged: 1, rejected: 0, unit_cost: 300, bin_id: 4 }] });
  assert.equal('supplier_invoice_no' in recvBody(3, '', [line()]), false);
  assert.deepEqual(recvSummary([line({ damaged: '2', rejected: '1' }), line({ product_id: 2, received: '4' })]), { arrived: 14, accepted: 11, damaged: 2, rejected: 1 });
});

test('adding a part to a receipt twice is one line, starting at its purchase price', () => {
  const once = addRecvLine([], { product_id: 5, name: 'Oil filter', sku: 'F1', purchase_price_paise: 16000 });
  assert.equal(once[0].cost, '160');
  assert.equal(addRecvLine(once, { product_id: 5, name: 'Oil filter', sku: 'F1', purchase_price_paise: 16000 }).length, 1);
});
