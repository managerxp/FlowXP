import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLoad } from '../api.js';
import { financialYear, inr, showDate, today, uuid } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Confirm, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const TYPES = [['ASSET', 'Assets (what you own)'], ['LIABILITY', 'Liabilities (what you owe)'], ['EQUITY', 'Equity'], ['INCOME', 'Income'], ['EXPENSE', 'Expenses']];

export const Accounts = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/accounts'), [org.id]);
  const [form, setForm] = useState(null);
  const a = useAction();
  const save = (e) => { e.preventDefault(); a.run(async () => { await o('/accounts', { method: 'POST', body: form }); setForm(null); await load.reload(); }, 'Account added.'); };
  return (
    <Page title="Chart of accounts" lead="Every rupee in the books sits in one of these accounts. System accounts are used by invoices and payments and cannot be removed."
      actions={<Btn kind="primary" onClick={() => { a.setError(''); a.setDone(''); setForm({ code: '', name: '', type: 'EXPENSE' }); }}>Add account</Btn>}>
      <Note>{a.done}</Note>
      {form && (
        <Card title="New account"><Err>{a.error}</Err>
          <form className="form" onSubmit={save}>
            <Field label="Code" hint="Letters, digits, dot or dash, up to 12"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required maxLength={12} pattern="[A-Za-z0-9.\-]{1,12}" /></Field>
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></Field>
            <Field label="Type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></Field>
            <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={() => setForm(null)}>Cancel</Btn></div>
          </form></Card>
      )}
      <Async load={load}>{(rows) => TYPES.map(([t, label]) => (
        <Card key={t} title={label}><Table head={['Code', 'Name', '']}>
          {rows.filter((r) => r.type === t).map((r) => (<tr key={r.id}><td>{r.code}</td><td>{r.name}</td><td>{r.is_system && <span className="muted">system</span>}</td></tr>))}
        </Table></Card>
      ))}</Async>
    </Page>
  );
};

export const Journals = () => {
  const { o, org } = useSession();
  const nav = useNavigate();
  const fy = financialYear();
  const [range, setRange] = useState({ from: fy.from, to: fy.to });
  const [extra, setExtra] = useState([]);
  const load = useLoad(() => { setExtra([]); return o(`/journals?from=${range.from}&to=${range.to}&limit=50`); }, [org.id, range.from, range.to]);
  const more = useAction();
  const rows = load.data ? [...load.data.entries, ...extra] : [];
  const next = extra.length ? extra.next : load.data?.next;
  const loadMore = () => more.run(async () => { const r = await o(`/journals?from=${range.from}&to=${range.to}&limit=50&before=${next}`); setExtra(Object.assign([...extra, ...r.entries], { next: r.next })); });
  return (
    <Page title="Journals" lead="Every change to the books, newest first. Invoices and payments post their own entries." actions={<Link className="btn primary" to="/journals/new">New journal entry</Link>}>
      <Card><div className="form">
        <Field label="From"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div></Card>
      <Async load={load}>{() => (
        <Card>
          <Table head={['No.', 'Date', 'What', 'From', '>Amount']} empty={!rows.length && <Empty>No entries in this range.</Empty>}>
            {rows.map((e) => (<tr key={e.id} className="click" onClick={() => nav(`/journals/${e.id}`)}><td><Link to={`/journals/${e.id}`}>{e.entry_no}</Link></td><td>{showDate(e.posting_date)}</td><td>{e.memo || '—'}</td>
              <td className="muted">{e.reverses_entry_id ? 'reversal' : String(e.source_type).replaceAll('_', ' ')}</td><td className="r"><Money v={e.total} /></td></tr>))}
          </Table>
          <Err>{more.error}</Err>{next && <p><Btn busy={more.busy} onClick={loadMore}>Show more</Btn></p>}
        </Card>
      )}</Async>
    </Page>
  );
};

export const JournalView = () => {
  const { id } = useParams();
  const { o, org } = useSession();
  const load = useLoad(() => o(`/journals/${id}`), [org.id, id]);
  const a = useAction();
  const [panel, setPanel] = useState(false);
  const [r, setR] = useState({ date: today(), reason: '' });
  const nav = useNavigate();
  return (
    <Page title={load.data ? `Entry ${load.data.entry_no}` : 'Entry'} lead={load.data?.memo} actions={load.data && <Btn kind="danger" onClick={() => setPanel(!panel)}>Reverse</Btn>}>
      <Async load={load}>{(e) => (<>
        <Err>{a.error}</Err>
        {panel && (<Confirm><p>Reversing adds a mirror entry. The original stays in the history.</p>
          <div className="form"><Field label="Date"><input type="date" value={r.date} onChange={(x) => setR({ ...r, date: x.target.value })} /></Field><Field label="Reason"><input value={r.reason} onChange={(x) => setR({ ...r, reason: x.target.value })} /></Field></div>
          <p><Btn kind="danger" busy={a.busy} disabled={!r.reason} onClick={() => a.run(async () => { const out = await o(`/journals/${id}/reverse`, { method: 'POST', body: r }); nav(`/journals/${out.id}`); })}>Reverse entry</Btn></p></Confirm>)}
        <Card>
          <Badge status={e.status} /> <span className="muted">{showDate(e.posting_date)} · {String(e.source_type).replaceAll('_', ' ')}</span>
          {e.reverses_entry_id && <p className="muted">Reverses <Link to={`/journals/${e.reverses_entry_id}`}>an earlier entry</Link>.</p>}
          <Table head={['Account', '>Debit', '>Credit', 'Note']}>
            {e.lines.map((l) => (<tr key={l.line_no}><td>{l.account_code} · {l.account_name}</td><td className="r num">{l.side === 'D' ? inr(l.amount) : ''}</td><td className="r num">{l.side === 'C' ? inr(l.amount) : ''}</td><td className="muted">{l.memo}</td></tr>))}
          </Table>
        </Card>
      </>)}</Async>
    </Page>
  );
};

export const JournalForm = () => {
  const { o, org } = useSession();
  const nav = useNavigate();
  const accounts = useLoad(() => o('/accounts'), [org.id]);
  const a = useAction();
  const [key] = useState(uuid);
  const [f, setF] = useState({ date: today(), memo: '', lines: [{ account: '', side: 'D', amount: '' }, { account: '', side: 'C', amount: '' }] });
  const cents = (s) => Math.round(Number(s || 0) * 100);
  const debit = f.lines.filter((l) => l.side === 'D').reduce((s, l) => s + cents(l.amount), 0);
  const credit = f.lines.filter((l) => l.side === 'C').reduce((s, l) => s + cents(l.amount), 0);
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      const out = await o('/journals', { method: 'POST', headers: { 'idempotency-key': key }, body: { date: f.date, memo: f.memo || undefined, lines: f.lines.filter((l) => cents(l.amount) > 0).map((l) => ({ account: l.account, side: l.side, amount: String(l.amount) })) } });
      nav(`/journals/${out.id}`);
    });
  };
  return (
    <Page title="New journal entry" lead="For things no invoice or payment covers: opening balances, depreciation, corrections. Debits must equal credits.">
      <Err>{a.error}</Err>
      <form onSubmit={submit}>
        <Card><div className="form"><Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field><Field label="Note"><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={500} /></Field></div></Card>
        <Card title="Lines" actions={<Btn type="button" className="btn small" onClick={() => setF({ ...f, lines: [...f.lines, { account: '', side: 'D', amount: '' }] })}>Add line</Btn>}>
          <div className="lines">{f.lines.map((l, i) => (
            <div className="line" key={i} style={{ gridTemplateColumns: undefined }}>
              <Field label="Account"><select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} required><option value="">Choose…</option>{(accounts.data || []).map((x) => <option key={x.id} value={x.code}>{x.code} · {x.name}</option>)}</select></Field>
              <Field label="Side"><select value={l.side} onChange={(e) => setLine(i, { side: e.target.value })}><option value="D">Debit</option><option value="C">Credit</option></select></Field>
              <Field label="Amount (₹)"><input inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} /></Field>
              <Btn type="button" className="btn small danger" disabled={f.lines.length <= 2} onClick={() => setF({ ...f, lines: f.lines.filter((_, n) => n !== i) })}>Remove</Btn>
            </div>))}</div>
          <p className={debit === credit && debit > 0 ? 'notice ok' : 'notice warn'} style={{ marginTop: '.75rem' }}>Debits ₹{inr(debit / 100)} · Credits ₹{inr(credit / 100)}{debit === credit && debit > 0 ? ' · balanced' : ` · difference ₹${inr(Math.abs(debit - credit) / 100)}`}</p>
        </Card>
        <div className="actions"><Btn kind="primary" busy={a.busy} disabled={debit !== credit || debit === 0}>Post entry</Btn><Btn type="button" onClick={() => nav(-1)}>Cancel</Btn></div>
      </form>
    </Page>
  );
};
