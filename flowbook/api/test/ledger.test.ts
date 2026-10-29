import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import { LedgerError, post, reverse } from '../src/ledger.ts';
import { setPeriodStatus } from '../src/periods.ts';
import { reconcile, trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);

const cashSale = (id: string, amount = 100000n) => ({ date: '2026-06-10', sourceType: 'invoice', sourceId: id, lines: [{ account: 'CASH', side: 'D' as const, amount }, { account: 'SALES', side: 'C' as const, amount }] });
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => (e instanceof LedgerError ? e.code : e.message));

test('a balanced entry posts; unbalanced, single-line and zero-amount entries are refused before the database', { skip }, async () => {
  const org = await newOrg(pool);
  const out = await withOrg(pool, org, (c) => post(c, org, cashSale('A1')));
  assert.equal(out.entryNo, 'JE-000001'); assert.equal(out.replayed, false);
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, { ...cashSale('A2'), lines: [{ account: 'CASH', side: 'D', amount: 100n }, { account: 'SALES', side: 'C', amount: 99n }] }))), 'unbalanced');
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, { ...cashSale('A3'), lines: [{ account: 'CASH', side: 'D', amount: 100n }] }))), 'too_few_lines');
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, { ...cashSale('A4'), lines: [{ account: 'CASH', side: 'D', amount: 0n }, { account: 'SALES', side: 'C', amount: 0n }] }))), 'bad_amount');
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, { ...cashSale('A5'), lines: [{ account: 'NOPE', side: 'D', amount: 5n }, { account: 'SALES', side: 'C', amount: 5n }] }))), 'unknown_account');
});

test('the database itself refuses an unbalanced posted entry, even if the application is bypassed', { skip }, async () => {
  const org = await newOrg(pool);
  await assert.rejects(withOrg(pool, org, async (c) => {
    const { id } = (await c.query(`INSERT INTO journal_entries (organization_id, entry_no, posting_date, source_type, source_id) VALUES ($1, 'X-1', '2026-06-10', 't', '1') RETURNING id`, [org])).rows[0];
    const acc = (await c.query(`SELECT id FROM accounts WHERE system_key IN ('CASH', 'SALES') ORDER BY code`)).rows;
    await c.query(`INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, side, amount_minor, base_amount_minor) VALUES ($1, $2, 1, $3, 'D', 100, 100), ($1, $2, 2, $4, 'C', 90, 90)`, [org, id, acc[0].id, acc[1].id]);
    await c.query(`UPDATE journal_entries SET status = 'POSTED', posted_at = now() WHERE id = $1`, [id]);
  }), /not balanced/);
});

test('a posted entry and its lines cannot be edited or deleted, by anyone using the application role', { skip }, async () => {
  const org = await newOrg(pool);
  const { entryId } = await withOrg(pool, org, (c) => post(c, org, cashSale('B1')));
  for (const sql of [`UPDATE journal_entries SET memo = 'x' WHERE id = $1`, `DELETE FROM journal_entries WHERE id = $1`,
    `UPDATE journal_lines SET amount_minor = 1, base_amount_minor = 1 WHERE entry_id = $1`, `DELETE FROM journal_lines WHERE entry_id = $1`]) {
    await assert.rejects(withOrg(pool, org, (c) => c.query(sql, [entryId])), /immutable|cannot be deleted/, sql);
  }
  await assert.rejects(withOrg(pool, org, (c) => c.query(`INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, side, amount_minor, base_amount_minor) SELECT $1, $2, 9, id, 'D', 5, 5 FROM accounts LIMIT 1`, [org, entryId])), /immutable/);
});

test('posting the same document 20 times at once gives one entry; the rest return it', { skip }, async () => {
  const org = await newOrg(pool);
  const results = await Promise.all(Array.from({ length: 20 }, () => withOrg(pool, org, (c) => post(c, org, cashSale('C1')))));
  assert.equal(new Set(results.map((r) => r.entryId)).size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const n = (await withOrg(pool, org, (c) => c.query(`SELECT count(*)::int AS n FROM journal_entries`))).rows[0].n;
  assert.equal(n, 1);
});

test('entry numbers are gapless under concurrency, and a failed post leaves no hole', { skip }, async () => {
  const org = await newOrg(pool);
  const jobs = Array.from({ length: 15 }, (_, i) => withOrg(pool, org, (c) => post(c, org, cashSale(`D${i}`))));
  jobs.push(withOrg(pool, org, (c) => post(c, org, { ...cashSale('Dbad'), lines: [{ account: 'NOPE', side: 'D', amount: 5n }, { account: 'SALES', side: 'C', amount: 5n }] })).catch(() => null) as never);
  await Promise.all(jobs);
  const nos = (await withOrg(pool, org, (c) => c.query(`SELECT entry_no FROM journal_entries ORDER BY entry_no`))).rows.map((r) => r.entry_no);
  assert.deepEqual(nos, Array.from({ length: 15 }, (_, i) => `JE-${String(i + 1).padStart(6, '0')}`));
});

test('a reversal is a linked mirror entry, allowed once, and nets the books to zero', { skip }, async () => {
  const org = await newOrg(pool);
  const orig = await withOrg(pool, org, (c) => post(c, org, cashSale('E1', 5000n)));
  assert.equal(await withOrg(pool, org, (c) => code(reverse(c, org, orig.entryId, { date: '2026-06-11', reason: ' ' }))), 'reason_required');
  const rev = await withOrg(pool, org, (c) => reverse(c, org, orig.entryId, { date: '2026-06-11', reason: 'wrong customer', actor: 'asha' }));
  assert.notEqual(rev.entryId, orig.entryId);
  assert.equal(await withOrg(pool, org, (c) => code(reverse(c, org, orig.entryId, { date: '2026-06-12', reason: 'again' }))), 'already_reversed');
  const tb = await withOrg(pool, org, (c) => trialBalance(c, org, { to: '2026-12-31' }));
  assert.ok(tb.rows.every((r) => r.debitBalance === 0n && r.creditBalance === 0n), 'every account nets to zero');
  assert.deepEqual(await withOrg(pool, org, (c) => reconcile(c, org)), []);
});

test('a locked period refuses posting; an override needs a reason and is written to the audit log', { skip }, async () => {
  const org = await newOrg(pool);
  await withOrg(pool, org, (c) => setPeriodStatus(c, org, '2026-06-15', 'CLOSED', 'owner'));
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, cashSale('F1')))), 'period_locked');
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, { ...cashSale('F1'), override: { reason: '  ' } }))), 'period_locked');
  const ok = await withOrg(pool, org, (c) => post(c, org, { ...cashSale('F1'), override: { reason: 'CA adjustment', }, actor: 'ca' }));
  assert.equal(ok.replayed, false);
  const log = (await withOrg(pool, org, (c) => c.query(`SELECT action, detail FROM audit_log WHERE action = 'period.override'`))).rows;
  assert.equal(log.length, 1); assert.equal(log[0].detail.reason, 'CA adjustment');
  // a date with no period at all
  assert.equal(await withOrg(pool, org, (c) => code(post(c, org, { ...cashSale('F2'), date: '2030-01-01' }))), 'no_period');
});

test('the audit log is append-only and its hash chain detects tampering', { skip }, async () => {
  const org = await newOrg(pool);
  await withOrg(pool, org, (c) => post(c, org, cashSale('G1')));
  await assert.rejects(withOrg(pool, org, (c) => c.query(`DELETE FROM audit_log`)), /append-only|permission denied/);
  await assert.rejects(withOrg(pool, org, (c) => c.query(`UPDATE audit_log SET actor = 'x'`)), /append-only|permission denied/);
  assert.deepEqual(await withOrg(pool, org, (c) => reconcile(c, org)), []);
  // tamper as the database owner (bypassing the trigger), the way a malicious operator would
  await pool.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`);
  await pool.query(`UPDATE audit_log SET detail = '{"forged":true}' WHERE organization_id = $1 AND id = (SELECT min(id) FROM audit_log WHERE organization_id = $1)`, [org]);
  await pool.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`);
  const issues = await withOrg(pool, org, (c) => reconcile(c, org));
  assert.ok(issues.some((i) => /audit chain broken/.test(i)), issues.join('; '));
});
