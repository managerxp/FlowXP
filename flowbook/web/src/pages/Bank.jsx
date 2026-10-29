/* Bank reconciliation: import the bank's statement, match each line with what the books say, and add what the books lack (charges, interest). */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { inr, showDate, today } from '../lib.js';
import { STATEMENT_ALIASES, parseCsv, statementRow, toRecords } from '../csv.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Note, Page, Table, useAction } from '../ui.jsx';

const signed = (v) => `${Number(v) < 0 ? '−' : ''}${inr(Math.abs(Number(v)))}`;

const Import = ({ accountId, onDone }) => {
  const { o } = useSession();
  const a = useAction();
  const [rows, setRows] = useState(null);
  const choose = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    a.setError(''); a.setDone('');
    const { records } = toRecords(parseCsv(await file.text()), STATEMENT_ALIASES);
    setRows(records.map((r, i) => ({ line: i + 2, ...statementRow(r) })));
  };
  const good = (rows || []).filter((r) => !r.problem);
  const bad = (rows || []).filter((r) => r.problem);
  const send = () => a.run(async () => {
    const out = await o(`/bank/accounts/${accountId}/import`, { method: 'POST', body: { rows: good.map((r) => r.row) } });
    setRows(null); onDone();
    return out;
  }, 'Imported. Lines you had already imported were skipped.');
  return (
    <Card title="Import a bank statement"><p className="muted">A CSV from your bank (Excel: Save As, CSV) with a date column and either one amount column (money out as a minus) or separate Deposit and Withdrawal columns. Importing the same file twice is safe.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      <p className="actions"><input type="file" accept=".csv,text/csv" onChange={choose} aria-label="Statement CSV" /></p>
      {rows && !rows.length && <p className="notice warn">No data rows found. Is there a header row with Date and Amount (or Deposit and Withdrawal) columns?</p>}
      {rows?.length > 0 && <>
        <p>{good.length} lines ready{bad.length ? `, ${bad.length} cannot be read.` : '.'}</p>
        {bad.length > 0 && <Table head={['Line in file', 'Problem']}>{bad.slice(0, 20).map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.problem}</td></tr>)}</Table>}
        <p className="actions"><Btn kind="primary" busy={a.busy} disabled={!good.length} onClick={send}>Import {good.length} lines</Btn><Btn onClick={() => setRows(null)}>Cancel</Btn></p>
      </>}
    </Card>
  );
};

const Line = ({ s, book, accounts, accountId, reload }) => {
  const { o } = useSession();
  const a = useAction();
  const same = book.filter((b) => b.amount_minor === s.amount_minor);
  const [pick, setPick] = useState(s.suggestion_id ? String(s.suggestion_id) : '');
  const [adding, setAdding] = useState(false);
  const [counter, setCounter] = useState('');
  const act = (fn, msg) => a.run(async () => { await fn(); await reload(); }, msg);
  return (
    <tr className={s.status === 'IGNORED' ? 'muted' : ''}>
      <td>{showDate(s.date)}</td><td>{s.description}{s.reference && <span className="muted"> · {s.reference}</span>}</td>
      <td className="r num">{signed(s.amount_minor)}</td>
      <td>
        {a.error && <p className="notice bad">{a.error}</p>}
        {s.status === 'IGNORED' ? <><Badge status="VOID">ignored</Badge> <button className="linkish" onClick={() => act(() => o(`/bank/lines/${s.id}/ignore`, { method: 'POST', body: { ignored: false } }))}>Restore</button></>
          : adding ? (
            <span className="actions"><select aria-label="Other side" value={counter} onChange={(e) => setCounter(e.target.value)}><option value="">Other side…</option>{accounts.filter((x) => String(x.id) !== String(accountId)).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select>
              <Btn className="btn small primary" busy={a.busy} disabled={!counter} onClick={() => act(() => o(`/bank/lines/${s.id}/add-entry`, { method: 'POST', body: { counterAccountId: counter } }))}>Add</Btn><Btn className="btn small" onClick={() => setAdding(false)}>Cancel</Btn></span>
          ) : (
            <span className="actions">
              {same.length > 0 && <><select aria-label="Entry in your books" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose entry…</option>{same.map((b) => <option key={b.id} value={b.id}>{showDate(b.date)} · {b.entry_no} · {b.memo.slice(0, 30)}</option>)}</select>
                <Btn className="btn small primary" busy={a.busy} disabled={!pick} onClick={() => act(() => o(`/bank/lines/${s.id}/match`, { method: 'POST', body: { journalLineId: pick } }))}>{s.suggestion_id && String(s.suggestion_id) === pick ? 'Match (suggested)' : 'Match'}</Btn></>}
              <Btn className="btn small" onClick={() => setAdding(true)}>Add entry</Btn>
              <button className="linkish" onClick={() => act(() => o(`/bank/lines/${s.id}/ignore`, { method: 'POST', body: { ignored: true } }))}>Ignore</button>
            </span>)}
      </td>
    </tr>
  );
};

export default () => {
  const { o, org } = useSession();
  const [accountId, setAccountId] = useState('');
  const [asOf, setAsOf] = useState(today());
  const [closing, setClosing] = useState('');
  const accounts = useLoad(() => o('/bank/accounts'), [org.id]);
  const all = useLoad(() => o('/accounts'), [org.id]);
  const id = accountId || accounts.data?.[0]?.id || '';
  const bench = useLoad(() => (id ? o(`/bank/accounts/${id}?asOf=${asOf}`) : Promise.resolve(null)), [org.id, id, asOf]);
  const reload = async () => { await bench.reload(); await accounts.reload(); };
  const usable = (all.data || []).filter((x) => x.active !== false);

  return (
    <Page title="Bank reconciliation" lead="Check the bank's statement against your books, line by line.">
      <Card><div className="form">
        <Field label="Account"><select value={id} onChange={(e) => setAccountId(e.target.value)}>{(accounts.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.open_statement_lines ? ` · ${x.open_statement_lines} to review` : ''}</option>)}</select></Field>
        <Field label="Up to"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      </div></Card>
      <Async load={accounts}>{(list) => !list.length ? <Empty>No bank, UPI or card account yet. Add one under Accounts.</Empty> : null}</Async>
      {id && <Import accountId={id} onDone={reload} />}
      {id && <Async load={bench}>{(w) => w && (<>
        <Card title="Does it agree?"><dl className="kv">
          <dt>Balance in your books</dt><dd>₹{signed(w.summary.bookBalance)}</dd>
          <dt>In your books, not on the statement yet</dt><dd>₹{signed(w.summary.notOnStatement)} <span className="muted">(cheques not cleared, deposits not shown)</span></dd>
          <dt>On the statement, not in your books</dt><dd>₹{signed(w.summary.notInBooks)} <span className="muted">(charges, interest, receipts nobody recorded)</span></dd>
          <dt><strong>Closing balance the statement should show</strong></dt><dd><strong>₹{signed(w.summary.expectedStatementBalance)}</strong></dd>
        </dl>
          <div className="form" style={{ marginTop: '.75rem' }}><Field label="Closing balance on your bank statement (₹)" hint="Type it to check the difference"><input inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} /></Field></div>
          {closing !== '' && !Number.isNaN(Number(closing)) && (Math.round(Number(closing) * 100) === Math.round(Number(w.summary.expectedStatementBalance) * 100)
            ? <p className="notice ok">Matches. This account agrees with the statement.</p>
            : <p className="notice warn">Differs by ₹{signed(Number(closing) - Number(w.summary.expectedStatementBalance))}. Look for a missing line, a wrong amount, or an opening balance that was never entered.</p>)}
        </Card>
        <Card title={`Statement lines to review (${w.statement.length})`}>
          <Table head={['Date', 'Statement says', '>Amount', '']} empty={!w.statement.length && <Empty>Nothing to review. Import a statement to start.</Empty>}>
            {w.statement.map((s) => <Line key={s.id} s={s} book={w.book} accounts={usable} accountId={id} reload={reload} />)}
          </Table>
        </Card>
        <Card title={`In your books, not on the statement (${w.book.length})`}>
          <Table head={['Date', 'Entry', 'Note', '>Amount']} empty={!w.book.length && <Empty>Every entry is matched.</Empty>}>
            {w.book.map((b) => <tr key={b.id}><td>{showDate(b.date)}</td><td>{b.entry_no}</td><td>{b.memo}</td><td className="r num">{signed(b.amount_minor)}</td></tr>)}
          </Table>
        </Card>
      </>)}</Async>}
    </Page>
  );
};
