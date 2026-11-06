import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNames, translateName } from '../src/modules/ai/productNames.js';
import { setProvider } from '../src/modules/ai/provider.js';

test('only known languages survive, trimmed, and empties go', () => {
  assert.deepEqual(cleanNames({ hi: '  दूध ', ta: '', fr: 'lait', ml: 5 }), { hi: 'दूध' });
  assert.deepEqual(cleanNames(null), {});
});

test('the model reply becomes a clean names object', async () => {
  setProvider(async () => ({ content: [{ type: 'tool_use', name: 'record_names', input: { hi: 'दूध', ta: 'பால்', zz: 'x' } }] }));
  assert.deepEqual(await translateName('Milk'), { hi: 'दूध', ta: 'பால்' });
  setProvider(null);
});
