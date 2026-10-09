import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnFile } from '../src/modules/storage.js';

test('a business may only delete files inside its own folder', () => {
  assert.equal(isOwnFile('/uploads/products/12/20296-1700000000000.jpg', 12), true);
  assert.equal(isOwnFile('/uploads/logos/12/logo-1.png', 12), true);
  assert.equal(isOwnFile('https://cdn.example.com/bucket/products/12/9-1.webp', 12), true);
  assert.equal(isOwnFile('/uploads/products/13/20296-1.jpg', 12), false, 'another business\'s photo');
  assert.equal(isOwnFile('/uploads/products/12/../13/x.jpg', 12), false, 'a path that climbs out');
  assert.equal(isOwnFile('/uploads/products/120/x.jpg', 12), false, 'a business whose id merely starts the same');
  assert.equal(isOwnFile('https://tracker.example.com/pixel.png', 12), false, 'an address typed into the field');
  assert.equal(isOwnFile(null, 12), false);
});
