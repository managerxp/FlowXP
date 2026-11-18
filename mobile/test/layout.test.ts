/* How wide things may be: phone, tablet upright, tablet on its side. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { columnsFor, isSideways, isWide, pageMax } from '../src/lib/layout.ts';

test('a phone on its side is wide but short: two columns and a wider page, a tablet is not', () => {
  assert.equal(isSideways(844, 390), true);
  assert.equal(isSideways(932, 430), true);
  assert.equal(isSideways(390, 844), false);   // upright
  assert.equal(isSideways(1024, 768), false);  // a tablet on its side
  assert.equal(columnsFor(844, 390), 2);
  assert.equal(columnsFor(844), 1);
  assert.equal(columnsFor(1024, 768), 2);   // a tablet on its side already had two columns
  assert.equal(pageMax(844, 760, false, 390), 900);
  assert.equal(pageMax(844, 560, false, 390), 560);
  assert.equal(pageMax(844, 760, true, 390), 1120);
  assert.equal(pageMax(1024, 760, false, 768), 760);
});

test('a rail from tablet width; two columns only when there is room for them', () => {
  assert.deepEqual([360, 412, 600].map(isWide), [false, false, false]);
  assert.deepEqual([768, 800, 1280].map(isWide), [true, true, true]);
  assert.deepEqual([360, 800, 999].map((w) => columnsFor(w)), [1, 1, 1]);
  assert.deepEqual([1000, 1280, 1600].map((w) => columnsFor(w)), [2, 2, 2]);
});

test('a list page opens up on a wide screen; a form never does', () => {
  assert.equal(pageMax(800, 760, true), 760);
  assert.equal(pageMax(1280, 760, true), 1120);
  assert.equal(pageMax(1280, 560), 560);
  assert.equal(pageMax(1280, 900, true), 1120);
  assert.equal(pageMax(1280), 760);
});
