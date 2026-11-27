import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushedOut } from '../src/lib/printerSetup.ts';

test('a slip sent over Bluetooth is pushed past the tear edge; a network printer gets exactly what was made', () => {
  const slip = Uint8Array.from([65, 10]);
  assert.deepEqual([...pushedOut('bluetooth', slip)], [65, 10, 0x1b, 0x64, 6]);
  assert.equal(pushedOut('network', slip), slip);
});
