import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlate } from '../src/modules/ai/plateScan.js';

test('a plate is cleaned to letters and digits; non-plates give null', () => {
  assert.equal(normalisePlate('ka 01-ab 1234'), 'KA01AB1234');
  assert.equal(normalisePlate('22BH1234AA'), '22BH1234AA');
  for (const bad of [null, '', 'HELLO', '123456', 'AB1', 'KA01AB12345678']) assert.equal(normalisePlate(bad), null, String(bad));
});
