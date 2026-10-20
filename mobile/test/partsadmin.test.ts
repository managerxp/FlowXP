/* Spare parts admin on the phone: a new part, its details, numbers and fitment, makes and models, racks, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTS_ADMIN_TEXTS, canPartsAdmin, emptyPart, emptyPlace, fitBody, fitLine, fitProblem, makeLine, makeProblem, modelLine, modelProblem, newPartBody, newPartProblem, numberLine, numberProblem, partLine, placeBody, placeLine, placeProblem,
  profileBody, profileForm, profileProblem, sortPlaces, type PartFull, type Place, type VMake
} from '../src/lib/partsAdmin.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const part: PartFull = {
  product_id: 4, name: 'Brake pad', sku: 'AP-0004', has_profile: true, classification: 'OEM', vehicle_type: 'CAR', oem_part_no: '5551168K00', mfr_part_no: null, subcategory: null, pack_qty: null, reorder_level: 5, max_stock: null, wholesale_price: 900, handling: null,
  selling_price_paise: 125000, mrp_paise: 150000, stock: 12, numbers: [{ pn_id: 1, number: '5551168K00', kind: 'OEM' }], fitment: []
};

test('only people with a parts right', () => { assert.equal(canPartsAdmin((p) => p === 'warehouse', 'parts_catalog', 'warehouse'), true); assert.equal(canPartsAdmin(() => false, 'a'), false); });

test('a new part: checks, and blank fields are left out', () => {
  const f = { ...emptyPart(), name: ' Brake pad ', selling_price: '1250', mrp: '1500', opening_stock: '10', sku: '' };
  assert.equal(newPartProblem(f), ''); assert.deepEqual(newPartBody(f), { name: 'Brake pad', classification: 'AFTERMARKET', vehicle_type: 'CAR', selling_price: 1250, mrp: 1500, tax_rate: 18, current_stock: 10 });
  assert.notEqual(newPartProblem({ ...f, name: 'B' }), ''); assert.notEqual(newPartProblem({ ...f, selling_price: '' }), ''); assert.notEqual(newPartProblem({ ...f, selling_price: '2000' }), ''); assert.notEqual(newPartProblem({ ...f, tax_rate: '120' }), '');
  assert.notEqual(newPartProblem({ ...f, purchase_price: 'x' }), ''); assert.notEqual(newPartProblem({ ...f, opening_stock: '-1' }), '');
});

test('details, numbers and fitment', () => {
  const f = profileForm(part);
  assert.equal(f.classification, 'OEM'); assert.equal(f.max_stock, ''); assert.equal(profileProblem(f, 1500), '');
  assert.deepEqual(profileBody(f), { classification: 'OEM', vehicle_type: 'CAR', oem_part_no: '5551168K00', mfr_part_no: '', subcategory: '', reorder_level: 5, max_stock: null, wholesale_price: 900, handling: '' });
  assert.equal(profileBody({ ...f, pack_qty: '4' }).pack_qty, 4); assert.notEqual(profileProblem({ ...f, pack_qty: '0' }, null), ''); assert.notEqual(profileProblem({ ...f, max_stock: '2' }, null), ''); assert.notEqual(profileProblem({ ...f, wholesale_price: '2000' }, 1500), ''); assert.equal(profileProblem({ ...f, wholesale_price: '2000' }, null), '');
  assert.equal(partLine(part), 'AP-0004 · OEM 5551168K00 · OEM (genuine) · ₹1,250.00 · 12 in stock'); assert.equal(partLine({ ...part, classification: null, oem_part_no: null, stock: undefined }), 'AP-0004 · No part details · ₹1,250.00');
  assert.equal(numberProblem('--'), 'A part number has letters or digits in it'); assert.equal(numberProblem('55-51 168'), ''); assert.equal(numberLine(part.numbers[0]), '5551168K00 · OEM number');
  assert.equal(fitProblem('', '', ''), 'Choose a model'); assert.notEqual(fitProblem('3', '19', ''), ''); assert.notEqual(fitProblem('3', '2020', '2018'), ''); assert.equal(fitProblem('3', '2018', ''), '');
  assert.deepEqual(fitBody('3', '2018', ''), { model_id: 3, year_from: 2018, year_to: null });
  assert.equal(fitLine({ fit_id: 1, make: 'Maruti', model: 'Swift', variant: 'VXi', year_from: 2018, year_to: null, status: 'UNVERIFIED' }), 'Maruti Swift VXi · 2018 to ... · Fitment not verified');
  assert.equal(fitLine({ fit_id: 1, make: 'Maruti', model: 'Swift', variant: null, year_from: null, year_to: null, status: 'VERIFIED' }), 'Maruti Swift · any year · Fits (verified)');
});

test('makes and models', () => {
  const m: VMake = { make_id: 1, name: 'Maruti', vehicle_type: 'CAR', models: [{ model_id: 2, name: 'Swift', variants: [1, 2], parts: 5 }] };
  assert.equal(makeProblem(' '), 'Give the make a name'); assert.equal(modelProblem('', 'x'), 'Choose the make'); assert.equal(modelProblem('1', ' '), 'Give the model a name'); assert.equal(modelProblem('1', 'Swift'), '');
  assert.equal(makeLine(m), 'Car · 1 models'); assert.equal(modelLine(m.models[0]), '2 variants · 5 parts on record');
});

test('racks and bins', () => {
  const list: Place[] = [{ location_id: 2, parent_id: 1, level: 2, code: 'WH-B', name: 'WH-B', can_store: false, is_active: true, capacity_units: null }, { location_id: 1, parent_id: null, level: 1, code: 'WH', name: 'Main', can_store: false, is_active: true, capacity_units: null }];
  assert.deepEqual(sortPlaces(list).map((p) => p.code), ['WH', 'WH-B']);
  const one = { ...emptyPlace('2', 1), segment: ' r12 ' };
  assert.equal(placeProblem(one), ''); assert.deepEqual(placeBody(one), { parent_id: 2, can_store: false, segment: 'r12' });
  assert.deepEqual(placeBody({ ...emptyPlace('', 4), segment: 'B07', name: 'Bin 7', capacity: '40' }), { loc_type: 'BIN', can_store: true, capacity_units: 40, segment: 'B07', name: 'Bin 7' });
  const many = { ...emptyPlace('2', 4), bulk: true, prefix: 'b', count: '4', letters: true };
  assert.equal(placeProblem(many), ''); assert.deepEqual(placeBody(many), { parent_id: 2, loc_type: 'BIN', can_store: true, count: 4, prefix: 'b', letters: true });
  assert.notEqual(placeProblem({ ...one, segment: 'R 12' }), ''); assert.notEqual(placeProblem({ ...many, count: '0' }), ''); assert.notEqual(placeProblem({ ...many, count: '30' }), ''); assert.notEqual(placeProblem({ ...one, capacity: 'x' }), '');
  assert.equal(placeLine({ ...list[0], name: 'Zone B' }), 'Zone B · Groups other places'); assert.equal(placeLine({ ...list[0], can_store: true, qty: 7, is_active: false }), 'Holds stock · 7 in stock · Switched off');
});

test('every text of the manage parts screen is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(PARTS_ADMIN_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
