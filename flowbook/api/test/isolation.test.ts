import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import { post } from '../src/ledger.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);

const sale = (id: string) => ({ date: '2026-06-10', sourceType: 'invoice', sourceId: id, lines: [{ account: 'CASH', side: 'D' as const, amount: 100n }, { account: 'SALES', side: 'C' as const, amount: 100n }] });

test('one organization cannot see, write to or post against another', { skip }, async () => {
  const a = await newOrg(pool, 'Org A'); const b = await newOrg(pool, 'Org B');
  await withOrg(pool, a, (c) => post(c, a, sale('A1')));
  await withOrg(pool, b, (c) => post(c, b, sale('B1')));

  // each sees only its own rows, in every tenant table
  for (const table of ['accounts', 'journal_entries', 'journal_lines', 'posting_register', 'audit_log', 'financial_years', 'accounting_periods', 'document_sequences']) {
    const rows = (await withOrg(pool, a, (c) => c.query(`SELECT DISTINCT organization_id FROM ${table}`))).rows;
    assert.deepEqual(rows.map((r) => r.organization_id), [a], table);
  }
  assert.equal((await withOrg(pool, a, (c) => c.query(`SELECT count(*)::int AS n FROM organizations`))).rows[0].n, 1);

  // org A naming org B's id in a row it writes is refused by the policy
  await assert.rejects(withOrg(pool, a, (c) => c.query(`INSERT INTO accounts (organization_id, code, name, type, normal_balance) VALUES ($1, '9999', 'x', 'ASSET', 'D')`, [b])), /row-level security/);
  // org A cannot post using org B's account id
  const bCash = (await withOrg(pool, b, (c) => c.query(`SELECT id FROM accounts WHERE system_key = 'CASH'`))).rows[0].id as bigint;
  await assert.rejects(withOrg(pool, a, (c) => post(c, a, { ...sale('A2'), lines: [{ account: bCash, side: 'D', amount: 5n }, { account: 'SALES', side: 'C', amount: 5n }] })), /no account/);
});

test('a session that never set its organization sees nothing and can write nothing', { skip }, async () => {
  const a = await newOrg(pool, 'Org C');
  await withOrg(pool, a, (c) => post(c, a, sale('C1')));
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE flowbook_app');
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM journal_entries`)).rows[0].n, 0);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM accounts`)).rows[0].n, 0);
    await assert.rejects(c.query(`INSERT INTO accounts (organization_id, code, name, type, normal_balance) VALUES ($1, '9998', 'x', 'ASSET', 'D')`, [a]), /row-level security/);
  } finally { await c.query('ROLLBACK'); c.release(); }
});

test('the application role cannot create organizations or change the schema', { skip }, async () => {
  await assert.rejects(withOrg(pool, 1n, (c) => c.query(`INSERT INTO organizations (name) VALUES ('sneaky')`)), /permission denied/);
  await assert.rejects(withOrg(pool, 1n, (c) => c.query(`DROP TABLE journal_lines`)), /must be owner|permission denied/);
});
