import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePlate } from '../src/modules/ai/plateScan.js';

test('a plate is cleaned to letters and digits; non-plates give null', () => {
  assert.equal(normalisePlate('ka 01-ab 1234'), 'KA01AB1234');
  assert.equal(normalisePlate('22BH1234AA'), '22BH1234AA');
  for (const bad of [null, '', 'HELLO', '123456', 'AB1', 'KA01AB12345678']) assert.equal(normalisePlate(bad), null, String(bad));
});

import { fitsPlateFormat, scanPlate } from '../src/modules/ai/plateScan.js';
import { setProvider } from '../src/modules/ai/provider.js';

test('a plate that already fits is untouched; look-alike letters and digits are repaired by position', () => {
  for (const ok of ['KA01AB1234', 'MH12DE1433', 'DL3CAB1234', 'TN09A1234', '22BH1234AA']) assert.equal(normalisePlate(ok), ok);
  assert.equal(normalisePlate('KAO1AB1234'), 'KA01AB1234');   // O read for 0
  assert.equal(normalisePlate('KA01AB123I'), 'KA01AB1231');   // I read for 1
  assert.equal(normalisePlate('MH12DE143S'), 'MH12DE1435');
  assert.equal(normalisePlate('IND KA 01 AB 1234'), 'KA01AB1234');
  assert.equal(fitsPlateFormat('KA 01 AB 1234'), true);
  assert.equal(fitsPlateFormat('HELLO123'), false);
});

const reply = (input) => ({ content: [{ type: 'tool_use', name: 'record_plate', input }], usage: { input_tokens: 100, output_tokens: 20 }, model: 'm' });

test('an unreadable first look gets one more careful look, and the cost of both is counted', async () => {
  const seen = [];
  setProvider(async (req) => { seen.push(req.messages[0].content[1].text); return seen.length === 1 ? reply({ plate: null, confidence: 'low', problem: 'too_far' }) : reply({ plate: 'KA 01 AB 1234', confidence: 'medium', make: 'Honda' }); });
  const r = await scanPlate({ mediaType: 'image/jpeg', data: 'x' });
  setProvider(null);
  assert.equal(seen.length, 2);
  assert.equal(r.plate, 'KA01AB1234');
  assert.equal(r.make, 'Honda');
  assert.equal(r.usage.input_tokens, 200);
});

test('a clear first read is one call; a plate that cannot be read says why', async () => {
  let calls = 0;
  setProvider(async () => { calls += 1; return reply({ plate: 'MH12DE1433', confidence: 'high' }); });
  assert.equal((await scanPlate({ mediaType: 'image/jpeg', data: 'x' })).plate, 'MH12DE1433');
  assert.equal(calls, 1);
  setProvider(async () => reply({ plate: null, confidence: 'low', problem: 'too_dark' }));
  const none = await scanPlate({ mediaType: 'image/jpeg', data: 'x' });
  setProvider(null);
  assert.equal(none.plate, null);
  assert.equal(none.problem, 'too_dark');
});
