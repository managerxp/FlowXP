/* How wide things may be: phone, tablet upright, tablet on its side. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { columnsFor, isWide, pageMax } from '../src/lib/layout.ts';

test('a rail from tablet width; two columns only when there is room for them', () => {
  assert.deepEqual([360, 412, 600].map(isWide), [false, false, false]);
  assert.deepEqual([768, 800, 1280].map(isWide), [true, true, true]);
  assert.deepEqual([360, 800, 999].map(columnsFor), [1, 1, 1]);
  assert.deepEqual([1000, 1280, 1600].map(columnsFor), [2, 2, 2]);
});

test('a list page opens up on a wide screen; a form never does', () => {
  assert.equal(pageMax(800, 760, true), 760);
  assert.equal(pageMax(1280, 760, true), 1120);
  assert.equal(pageMax(1280, 560), 560);
  assert.equal(pageMax(1280, 900, true), 1120);
  assert.equal(pageMax(1280), 760);
});
