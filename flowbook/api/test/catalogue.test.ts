import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { CATALOGUE, addFromCatalogue, catalogueFor } from '../src/catalogue.ts';
import { seedTaxRates } from '../src/masters.ts';
import { UQC } from '../src/gst.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

test('every catalogue entry uses a unit and GST code the books accept, and no two share a code', () => {
  const codes = new Set<string>();
  for (const g of CATALOGUE) for (const [name, unit, , tax] of g.rows) {
    assert.ok(UQC.includes(unit), `${name}: unit ${unit}`); assert.match(tax, /^GST(0|5|12|18|28)$/, name);
    assert.ok(!codes.has(name), `duplicate ${name}`); codes.add(name);
  }
});

test('picking catalogue items adds them once, goods are stock-tracked, services are not', { skip }, async () => {
  const org = await newOrg(pool);
  await run(org, (c) => seedTaxRates(c, org));
  const list = await run(org, (c) => catalogueFor(c));
  const cement = list[0]!.items[0]!; const mason = list.at(-1)!.items[0]!;
  assert.equal(await run(org, (c) => addFromCatalogue(c, org, [cement.sku, mason.sku], 't')), 2);
  assert.equal(await run(org, (c) => addFromCatalogue(c, org, [cement.sku], 't')), 0);
  const rows = (await run(org, (c) => c.query(`SELECT kind, track_stock, hsn_sac, tax_code FROM items ORDER BY kind`))).rows;
  assert.deepEqual(rows.map((r) => [r.kind, r.track_stock, r.tax_code]), [['GOODS', true, 'GST18'], ['SERVICE', false, 'GST18']]);
  const all = await run(org, (c) => addFromCatalogue(c, org, 'all', 't'));
  assert.equal(all, CATALOGUE.reduce((n, g) => n + g.rows.length, 0) - 2);
  assert.ok((await run(org, (c) => catalogueFor(c))).every((g) => g.items.every((i) => i.added)));
});
