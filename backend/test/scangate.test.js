/*
 * The camera scanner's duplicate-scan rule (frontend/src/lib/scanGate.js): one scan per item presented, however many
 * frames the camera sees it in, and a deliberate second scan of the same item still counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanGate } from '../../frontend/src/lib/scanGate.js';

const clock = () => { let t = 1000; return { now: () => t, advance: (ms) => { t += ms; } }; };
/** Feed `code` every `everyMs` for `forMs`, return how many counted. */
const hold = (gate, c, code, forMs, everyMs = 40) => { let n = 0; for (let i = 0; i < forMs; i += everyMs) { if (gate(code)) n += 1; c.advance(everyMs); } return n; };

test('one item held in view for two seconds is one scan, not fifty', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  assert.equal(hold(gate, c, '8901', 2000), 1);
});

test('taking the item away and presenting it again counts again; that is how you scan two of the same', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  assert.equal(hold(gate, c, '8901', 600), 1);
  c.advance(800);                                                     // out of view
  assert.equal(hold(gate, c, '8901', 600), 1);
  c.advance(800);
  assert.equal(hold(gate, c, '8901', 600), 1);
});

test('a flicker (a few frames lost while the item is still there) does not double count', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  let n = 0;
  for (const gap of [0, 120, 300, 400, 120, 500]) { c.advance(gap); if (gate('8901')) n += 1; }
  assert.equal(n, 1);
});

test('different items scanned one after another each count immediately', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  const got = ['111', '222', '333', '444'].map((code) => { c.advance(400); return gate(code); });
  assert.deepEqual(got, [true, true, true, true]);
});

test('two barcodes in view at once do not keep re-triggering each other', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  let n = 0;
  for (let i = 0; i < 50; i++) { if (gate(i % 2 ? 'A' : 'B')) n += 1; c.advance(40); }
  assert.equal(n, 2);                                                  // each counted once while both stay in view
});

test('two different codes in the very same instant: the first wins, the other is not lost once the burst passes', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  assert.equal(gate('A'), true);
  assert.equal(gate('B'), false);                                      // same burst
  c.advance(300);
  assert.equal(gate('B'), true);                                       // still there next frame: now it counts
});

test('an item just added another way is not counted again while it is still in front of the lens, but is when presented anew', () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  gate.mark('NEW');                                                   // made at the till, already on the bill
  assert.equal(hold(gate, c, 'NEW', 1500), 0);                        // the camera comes back and still sees it
  c.advance(4000);                                                    // put down, picked up again later
  assert.equal(hold(gate, c, 'NEW', 600), 1);
});
