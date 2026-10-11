/* A pharmacy with no signal: the medicines are on the phone, a sale is kept and sent later to the pharmacy till, exactly once, and what the server wants checked comes back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { migrate } from '../src/lib/migrate.ts';
import { sendEntry } from '../src/lib/till.ts';
import { addMedicine, estimate, fromProduct, pharmacyProblem, previewOf, saleBody } from '../src/lib/pharmacy.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const open = async () => { const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); return { db, catalog: createCatalog(db), outbox: createOutbox(db) }; };
const rx = { manufacturer: 'Cipla', strength: '500mg', dosage_form: 'Capsule', salt_composition: 'Amoxicillin', schedule_class: 'H', prescription_required: true, batch_tracking: true, expiry_tracking: true };

test('the phone finds a medicine by its salt or maker with no signal, and knows it needs a prescription', async () => {
  const server = fakeServer([P(1, 'Amoxil 500', 12.5, { tax_rate: 12, pharmacy: rx } as never), P(2, 'Crocin', 30, { tax_rate: 12 })]);
  const { catalog } = await open(); await catalog.sync(server.api);
  server.state.down = true;
  const bySalt = await catalog.search('amoxicillin', 10);
  assert.deepEqual(bySalt.map((p) => p.name), ['Amoxil 500']);
  assert.deepEqual((await catalog.search('cipla', 10)).map((p) => p.name), ['Amoxil 500'], 'by maker');
  const m = fromProduct(bySalt[0]);
  assert.deepEqual([m.prescription_required, m.batch_tracking, m.strength, m.manufacturer], [true, true, '500mg', 'Cipla']);
  assert.equal(fromProduct((await catalog.search('crocin', 10))[0]).prescription_required, false);
});

test('a prescription medicine cannot be billed offline until the prescription is checked, and the server is told it was', async () => {
  const server = fakeServer([P(1, 'Amoxil 500', 12.5, { pharmacy: rx } as never)]);
  const { catalog } = await open(); await catalog.sync(server.api);
  const lines = addMedicine([], fromProduct((await catalog.search('amoxil', 5))[0]), 2);
  assert.match(pharmacyProblem(lines, false), /prescription/i);
  assert.equal(pharmacyProblem(lines, true), '');
  assert.equal(saleBody(lines, null, 'CASH', '', '', { rxChecked: true }).prescription_checked, true);
  assert.equal('prescription_checked' in saleBody(lines, null, 'CASH', '', '', { rxChecked: false }), false);
});

test('the estimate adds GST to the shelf price, per line, and the provisional bill shows it', () => {
  const med = (id: number, price: number, tax: number) => ({ product_id: id, name: `M${id}`, selling_price: price, tax_rate: tax, track_inventory: true } as never);
  const l = addMedicine(addMedicine([], med(1, 100, 12), 2), med(2, 30, 5));
  assert.deepEqual(estimate(l), { subtotalPaise: 23000, taxPaise: 2400 + 150, totalPaise: 25550 });
  const p = previewOf(l, 'UPI');
  assert.deepEqual([p.lines.length, p.totalPaise, p.method, p.lines[0].unitPricePaise], [2, 25550, 'UPI', 10000]);
});

test('an offline pharmacy sale goes to the pharmacy till with the same key, once; what the server wants checked stays on the sent bill', async () => {
  const server = fakeServer([P(1, 'Crocin', 30, { tax_rate: 12 })]);
  const { catalog, outbox } = await open(); await catalog.sync(server.api);
  const lines = addMedicine([], fromProduct((await catalog.search('crocin', 5))[0]), 3);
  const body = saleBody(lines, null, 'CASH', '', '', { expectedTotal: estimate(lines).totalPaise / 100 });
  server.state.down = true;
  const e = (await outbox.add({ id: 'ph-1', body, preview: previewOf(lines, 'CASH'), path: '/pharmacy/pos/invoices' }))!;
  assert.equal(e.path, '/pharmacy/pos/invoices');
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 0, failed: 0, stopped: 'offline' }, 'nothing lost while offline');
  server.state.down = false; server.state.review = ['Crocin: 2 more sold than the shelf held'];
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null });
  assert.equal(server.state.sales.length, 1);
  assert.equal(server.state.calls.filter((c) => c === 'POST /pharmacy/pos/invoices').length, 2, 'the failed try and the one that worked, to the pharmacy till only');
  assert.equal(server.state.calls.includes('POST /invoices'), false);
  const sent = (await outbox.get('ph-1'))!;
  assert.deepEqual([sent.state, sent.invoice_number], ['sent', 'INV-0001']);
  assert.match(sent.error!, /Check: Crocin: 2 more sold/);
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 0, failed: 0, stopped: null }, 'a sent bill is never sent again');
  assert.equal(server.state.sales[0].headers['X-Offline-Sale'], '1');
});

test('an older phone database is upgraded: a queued sale made before the upgrade still goes to the ordinary till', async () => {
  const db = nodeDb();
  await db.exec(`CREATE TABLE outbox (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, local_no TEXT NOT NULL, body TEXT NOT NULL, preview TEXT NOT NULL, taken_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, invoice_id INTEGER, invoice_number TEXT)`);
  await db.run(`INSERT INTO outbox (id, local_no, body, preview, taken_at) VALUES ('old-1','P-AAA-0001','{"items":[]}','{"lines":[],"subtotalPaise":0,"taxPaise":0,"totalPaise":0,"method":"CASH"}',1)`);
  assert.deepEqual((await migrate(db)).slice(-1), [4]);
  const e = (await createOutbox(db).get('old-1'))!;
  assert.equal(e.path, null, 'no path means the ordinary till');
});
