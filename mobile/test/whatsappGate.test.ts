import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFeature } from '../src/lib/access.ts';
import { saleBody } from '../src/lib/cart.ts';

test('a plan feature is on unless the plan says false', () => {
  assert.equal(hasFeature(null, 'messaging'), true, 'an older sign-in without the flags shows the door; the server still decides');
  assert.equal(hasFeature({ subscription: { feature_flags: {} } }, 'messaging'), true);
  assert.equal(hasFeature({ subscription: { feature_flags: { messaging: false } } }, 'messaging'), false);
});

test('a bill is marked "do not send on WhatsApp" only when that was chosen', () => {
  const cart = { lines: [] } as never;
  const pay = { method: 'CASH' };
  assert.equal('send_whatsapp' in saleBody(cart, pay, { customerId: 1 }), false);
  assert.equal((saleBody(cart, pay, { customerId: 1, sendWhatsapp: false }) as { send_whatsapp?: boolean }).send_whatsapp, false);
});
