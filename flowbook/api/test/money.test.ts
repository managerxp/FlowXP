import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, formatINR, roundDiv, taxOn, toPaise } from '../src/money.ts';

test('rounding is half away from zero, for positives and negatives', () => {
  assert.equal(roundDiv(5n, 2n), 3n);
  assert.equal(roundDiv(-5n, 2n), -3n);
  assert.equal(roundDiv(4n, 3n), 1n);
  assert.equal(roundDiv(1n, 2n), 1n);
  assert.equal(roundDiv(-1n, 2n), -1n);
  assert.equal(roundDiv(14n, 10n), 1n);
  assert.throws(() => roundDiv(1n, 0n));
});

test('tax is on whole paise: 18% of 1000.00, 2.5% of 0.99, and half-paise cases round up', () => {
  assert.equal(taxOn(100000n, 1800), 18000n);
  assert.equal(taxOn(99n, 250), 2n);       // 2.475 paise
  assert.equal(taxOn(10n, 500), 1n);       // 0.5 paise rounds away from zero
  assert.equal(taxOn(0n, 1800), 0n);
  assert.throws(() => taxOn(100n, 1.5));
});

test('allocation always adds up to the whole', () => {
  assert.deepEqual(allocate(10000n, [1n, 1n, 1n]), [3334n, 3333n, 3333n]);
  for (let total = 0n; total < 500n; total += 7n) {
    const parts = allocate(total, [3n, 5n, 11n, 1n]);
    assert.equal(parts.reduce((a, b) => a + b, 0n), total);
  }
});

test('amounts parse and print without floats', () => {
  assert.equal(toPaise('1180.50'), 118050n);
  assert.equal(toPaise('5'), 500n);
  assert.equal(toPaise('0.5'), 50n);
  assert.equal(toPaise('-2.05'), -205n);
  assert.throws(() => toPaise('1.234'));
  assert.throws(() => toPaise('1e3'));
  assert.equal(formatINR(118050n), '1,180.50');
  assert.equal(formatINR(123456789n), '12,34,567.89');
  assert.equal(formatINR(-5n), '-0.05');
});
