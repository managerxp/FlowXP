/* Job cards on the phone: a new card, the lines, the next steps, the bill, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_TEXTS, suggestMakes, suggestModels, billBody, billProblem, canBill, canJobCards, customerProblem, dueLine, emptyJob, estimateLines, isLive, jobSub, labourBody, labourProblem, lineSub, lineText, misfits, newJobBody, newJobProblem, quantityProblem, stepsFor, vehicleOf,
  type JobFull, type JobLine, type JobRow
} from '../src/lib/jobCards.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const part: JobLine = { line_id: 1, kind: 'PART', product_id: 5, description: 'Brake pad set', sku: 'AP-5', quantity: 2, unit_price_paise: 100000, tax_rate: 18, held: true, fitment: 'NOT_FIT', amount_paise: 200000 };
const labour: JobLine = { line_id: 2, kind: 'LABOUR', product_id: null, description: 'Fit pads', sku: null, quantity: 1, unit_price_paise: 50000, tax_rate: 18, held: false, fitment: null, amount_paise: 50000 };

test('only people at the counter', () => { assert.equal(canJobCards((p) => p === 'billing'), true); assert.equal(canJobCards(() => false), false); });

test('a new card: the customer and registration are needed, the body leaves blanks out', () => {
  const f = { ...emptyJob(), customer_id: 4, customer_name: 'Anil', vehicle_reg: ' ka01 ab 1234 ', odometer_km: '42000', complaint: ' Brake noise ', make: ' hero ', model: ' Splendor Plus ', variant: '110cc', vehicle_year: '2021', mechanic_id: '2' };
  assert.equal(newJobProblem(f), ''); assert.deepEqual(newJobBody(f), { customer_id: 4, vehicle_reg: 'KA01 AB 1234', vehicle_type: 'CAR', make: 'hero', model: 'Splendor Plus', variant: '110cc', vehicle_year: 2021, odometer_km: 42000, complaint: 'Brake noise', mechanic_id: 2 });
  assert.deepEqual(Object.keys(newJobBody({ ...emptyJob(), customer_id: 4, vehicle_reg: 'KA01AB1' })), ['customer_id', 'vehicle_reg', 'vehicle_type']);
  assert.notEqual(newJobProblem({ ...f, customer_id: null }), ''); assert.notEqual(newJobProblem({ ...f, vehicle_reg: '!!' }), ''); assert.notEqual(newJobProblem({ ...f, odometer_km: '4.5' }), ''); assert.notEqual(newJobProblem({ ...f, promised_on: '2026-13-01' }), '');
  assert.equal(customerProblem('A', ''), 'Give the customer a name'); assert.notEqual(customerProblem('Anil', 'abc'), ''); assert.equal(customerProblem('Anil', '9000000010'), '');
});

test('lines, warnings and the estimate', () => {
  assert.equal(lineText(part), 'Brake pad set · 2 × ₹1,000.00 = ₹2,000.00'); assert.equal(lineText(labour), 'Fit pads · ₹500.00');
  assert.equal(lineSub(part), 'AP-5 · Held for this customer · Does not fit'); assert.equal(lineSub({ ...part, held: false, fitment: 'NO_VEHICLE' }), 'AP-5 · Not held'); assert.equal(lineSub(labour), 'Labour');
  assert.deepEqual(misfits([part, labour]), ['Brake pad set']);
  assert.deepEqual(estimateLines({ parts_paise: 200000, labour_paise: 50000, tax_paise: 45000, total_paise: 295000 }), [['Parts', '₹2,000.00'], ['Labour', '₹500.00'], ['GST', '₹450.00'], ['Estimate', '₹2,950.00']]);
  assert.equal(labourProblem(' ', '500'), 'Say what was done'); assert.equal(labourProblem('Fit', ''), 'Enter the labour charge'); assert.equal(labourProblem('Fit', '500'), ''); assert.deepEqual(labourBody(' Fit ', '500'), { kind: 'LABOUR', description: 'Fit', unit_price: 500 });
  assert.equal(quantityProblem('0'), 'Quantity is a number above zero'); assert.equal(quantityProblem('2.5'), '');
});

test('moving along and billing', () => {
  assert.deepEqual(stepsFor('OPEN').map((x) => x.status), ['IN_PROGRESS', 'WAITING_PARTS', 'READY']); assert.deepEqual(stepsFor('READY').map((x) => x.status), ['IN_PROGRESS', 'WAITING_PARTS']);
  assert.equal(isLive('READY'), true); assert.equal(isLive('BILLED'), false);
  const j = { status: 'READY', lines: [part] } as Pick<JobFull, 'status' | 'lines'>;
  assert.equal(canBill(j), true); assert.equal(canBill({ ...j, lines: [] }), false); assert.equal(canBill({ ...j, status: 'BILLED' }), false);
  assert.deepEqual(billBody('CASH', ''), { payment: { amount: 'FULL', method: 'CASH' } }); assert.deepEqual(billBody('UPI', '1500'), { payment: { amount: 1500, method: 'UPI' } }); assert.deepEqual(billBody('CREDIT', '900'), {});
  assert.equal(billProblem('CASH', '0'), 'The amount paid is above zero'); assert.equal(billProblem('CASH', ''), ''); assert.equal(billProblem('CREDIT', 'x'), '');
});

test('list lines', () => {
  const r: JobRow = { job_id: 1, job_no: 'JC-0001', status: 'IN_PROGRESS', customer_id: 4, customer_name: 'Anil', customer_phone: null, vehicle_reg: 'KA01 AB 1234', vehicle_type: 'CAR', make: 'Maruti', model: 'Swift', mechanic_name: 'Raju', promised_on: null, total_paise: 295000, parts: 1 };
  assert.equal(vehicleOf(r), 'KA01 AB 1234 · Maruti Swift'); assert.equal(jobSub(r), 'Being worked on · Anil · Raju · ₹2,950.00');
  assert.equal(dueLine({ vehicle_reg: 'KA01AB1', make: 'Maruti', model: 'Swift', next_service_on: '2026-11-01', overdue: false, customer_name: 'Anil' }), 'KA01AB1 · Maruti Swift · Anil · due 2026-11-01');
  assert.match(dueLine({ vehicle_reg: 'KA01AB1', make: null, model: null, next_service_on: '2026-10-01', overdue: true, customer_name: null }), /overdue since 2026-10-01/);
});

test('every text of the job card screens is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(JOB_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});

test('the vehicle list on a new card: companies of this kind, models of the typed company, and a typed one is accepted as it is', () => {
  const tree = [
    { make_id: 1, name: 'Hero MotoCorp', vehicle_type: 'BIKE', models: [{ model_id: 1, name: 'Splendor Plus' }, { model_id: 2, name: 'HF Deluxe' }, { model_id: 3, name: 'Glamour' }] },
    { make_id: 2, name: 'Honda', vehicle_type: 'BIKE', models: [{ model_id: 4, name: 'Shine 125' }] },
    { make_id: 3, name: 'Honda', vehicle_type: 'CAR', models: [{ model_id: 5, name: 'City' }, { model_id: 6, name: 'Amaze' }] }
  ];
  assert.deepEqual(suggestMakes(tree, 'BIKE', ''), ['Hero MotoCorp', 'Honda'], 'only the bike companies, all of them when nothing is typed');
  assert.deepEqual(suggestMakes(tree, 'CAR', ''), ['Honda']);
  assert.deepEqual(suggestMakes(tree, 'BIKE', 'ho'), ['Honda'], 'only what contains the letters');
  assert.deepEqual(suggestMakes(tree, 'BIKE', 'o'), ['Hero MotoCorp', 'Honda'], 'nothing starts with it, so alphabetical');
  assert.deepEqual(suggestMakes(tree, 'BIKE', 'honda'), [], 'a company typed in full is not offered again');
  assert.deepEqual(suggestMakes(tree, 'BIKE', 'zzz'), [], 'a new company simply has no suggestions: it is typed and remembered');
  assert.deepEqual(suggestModels(tree, 'BIKE', 'hero motocorp', ''), ['Glamour', 'HF Deluxe', 'Splendor Plus']);
  assert.deepEqual(suggestModels(tree, 'BIKE', 'Hero MotoCorp', 'spl'), ['Splendor Plus']);
  assert.deepEqual(suggestModels(tree, 'CAR', 'Honda', 'a'), ['Amaze', 'City'].filter((x) => x.toLowerCase().includes('a')), 'the car Honda, not the bike one');
  assert.deepEqual(suggestModels(tree, 'BIKE', 'Unknown', ''), [], 'no models until the company is known');
  assert.equal(newJobProblem({ ...emptyJob(), customer_id: 1, vehicle_reg: 'KA01AB1234', model: 'Swift' }), 'Type the company too, like Hero or Maruti Suzuki');
  assert.equal(newJobProblem({ ...emptyJob(), customer_id: 1, vehicle_reg: 'KA01AB1234', make: 'Maruti', model: 'Swift', vehicle_year: '21' }), 'The year is four digits, like 2021');
});
