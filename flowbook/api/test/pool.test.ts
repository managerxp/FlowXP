// PostgreSQL restarting must not stop the server: a lost idle connection is logged, not thrown. No database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/db.ts';

test('an error on an idle connection does not become an uncaught exception', async () => {
  const pool = createPool('postgres://nobody@127.0.0.1:1/none');
  assert.doesNotThrow(() => pool.emit('error', new Error('terminating connection due to administrator command')));
  await pool.end();
});
