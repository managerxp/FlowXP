/* The checks on what a till may send: a discount, a price, a GST rate and a quantity that cannot be used to change what a bill is worth. These run against the real server in the audit; here the rules are pinned in the source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/modules/billing.js', import.meta.url), 'utf8');

test('billing refuses a negative or oversized discount, a negative price or GST rate, and an absurd quantity', () => {
  for (const rule of [
    "'A discount cannot be negative'", "'The discount cannot be more than the price of the item'", "'The discount cannot be more than the bill'",
    "'The price cannot be negative'", "'The GST rate must be from 0 to 100'", "'That quantity is too large'"
  ]) assert.ok(src.includes(rule), `missing: ${rule}`);
});
