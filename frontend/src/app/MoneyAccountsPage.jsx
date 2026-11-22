/*
 * Cash and bank: where the money is (cash, each bank account, each loan), which payment method lands where, money moved by hand (cash into the bank,
 * a loan, an instalment, money the owner put in or took out), each account's statement, and the trial balance and balance sheet worked out from it.
 * Backend: controllers/moneyAccounts.controller.js. Nothing changes at the till: payments, expenses and refunds already carry their method.
 */
import { useCallback, useEffect, useState } from 'react';
import { Landmark, Plus } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { formatDate } from '../lib/display.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Card, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const KIND = { CASH: T('Cash'), BANK: T('Bank account'), LOAN: T('Loan') };
const METHOD = { CASH: T('Cash'), UPI: 'UPI', CARD: T('Card'), BANK_TRANSFER: T('Bank transfer'), CHEQUE: T('Cheque'), OTHER: T('Other') };
const MOVES = {
  TRANSFER: { label: T('Move money between accounts'), from: ['CASH', 'BANK'], to: ['CASH', 'BANK'] },
  LOAN_TAKEN: { label: T('Loan received'), from: ['LOAN'], to: ['CASH', 'BANK'] },
  LOAN_REPAID: { label: T('Loan instalment paid'), from: ['CASH', 'BANK'], to: ['LOAN'] },
  CAPITAL_IN: { label: T('Owner put money in'), from: null, to: ['CASH', 'BANK'] },
  DRAWINGS: { label: T('Owner took money out'), from: ['CASH', 'BANK'], to: null }
};
/* words the server sends (statement lines, report rows), listed so they are translated like every other screen text */
// eslint-disable-next-line no-unused-vars
const SERVER_WORDS = [T('Bill paid'), T('Paid to supplier'), T('Received from customer'), T('Expense'), T('Other income'), T('Refund'), T('Moved'), T('Loan received'), T('Loan instalment'),
  T('Owner put money in'), T('Owner took money out'), T('Customers owe you'), T('Stock at cost'), T('You owe suppliers'), T('Capital at the start of the year'), T('Money put in this year'),
  T('Money taken out this year'), T('Profit this year'), T('Customers owe you (sundry debtors)'), T('You owe suppliers (sundry creditors)'), T('Sales (after discounts and returns)'),
  T('Cost of goods sold'), T('Expenses'), T('Discounts given at payment'), T('Loan interest'), T('Money taken out by the owner'), T('Money put in by the owner')];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const TABS = [['accounts', T('Accounts')], ['trial', T('Trial balance')], ['sheet', T('Balance sheet')]];

export default function MoneyAccountsPage() {
  const tr = useT();
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = useState('accounts');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(null);     // a kind, when the add form is open
  const [moving, setMoving] = useState(false);
  const [viewing, setViewing] = useState(null);   // an account, when its statement is open
  const load = useCallback(() => api('/money-accounts').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const setMethod = async (method, id) => {
    try { await api('/money-accounts/methods', { method: 'PUT', body: { ...data.payment_accounts, [method]: id ? Number(id) : null } }); toast.success(tr('Saved')); load(); }
    catch (e) { setError(e.message); }
  };
  const holding = data?.accounts.filter((a) => a.kind !== 'LOAN' && a.is_active) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-h3 font-semibold text-ink-900">{tr('Cash and bank')}</h1>
          <p className="text-small text-ink-500">{tr('Where your money is. Payments, expenses and refunds land in the account set for their method; money you move by hand is added here.')}</p>
        </div>
        {tab === 'accounts' && can('payments') && <Button onClick={() => setMoving(true)}>{tr('Record money moved')}</Button>}
      </div>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-small font-medium ${tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{tr(label)}</button>
        ))}
      </div>
      <Alert>{error}</Alert>

      {tab === 'accounts' && data && (
        <>
          {['CASH', 'BANK', 'LOAN'].map((kind) => {
            const list = data.accounts.filter((a) => a.kind === kind);
            return (
              <Card key={kind}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-ink-900">{kind === 'LOAN' ? tr('Loans') : kind === 'BANK' ? tr('Bank accounts') : tr('Cash')}</h2>
                  {can('settings') && <Button size="sm" variant="secondary" onClick={() => setAdding(kind)}><Plus aria-hidden="true" className="size-4" />{kind === 'LOAN' ? tr('Add a loan') : kind === 'BANK' ? tr('Add a bank account') : tr('Add a cash account')}</Button>}
                </div>
                {list.length === 0 ? <p className="mt-3 text-small text-ink-500">{kind === 'LOAN' ? tr('No loans.') : tr('None yet.')}</p> : (
                  <ul className="mt-3 divide-y divide-line">
                    {list.map((a) => (
                      <li key={a.account_id}>
                        <button type="button" onClick={() => setViewing(a)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-surface-muted">
                          <Landmark aria-hidden="true" className="size-4 text-ink-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-small font-medium text-ink-900">{a.name}{!a.is_active && ` · ${tr('closed')}`}</span>
                            <span className="block text-caption text-ink-500">{[a.bank_name, a.account_last4 && `…${a.account_last4}`, a.lender, a.interest_rate != null && `${a.interest_rate}%`].filter(Boolean).join(' · ') || tr(KIND[a.kind])}</span>
                          </span>
                          <span className="tabular text-small font-semibold text-ink-900">{kind === 'LOAN' ? tr('{{amount}} owed', { amount: formatCurrency(a.balance) }) : formatCurrency(a.balance)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
          <Card>
            <h2 className="text-base font-bold text-ink-900">{tr('Where each payment method lands')}</h2>
            <p className="mt-1 text-small text-ink-500">{tr('Bill payments, supplier payments, expenses, other income and refunds go to the account set for the way they were paid.')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {data.methods.map((m) => (
                <Field key={m} id={`pm_${m}`} label={tr(METHOD[m])}>
                  <Select id={`pm_${m}`} value={data.payment_accounts[m] ?? ''} disabled={!can('settings')} onChange={(e) => setMethod(m, e.target.value)}>
                    <option value="">{tr('Not linked')}</option>
                    {holding.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            {data.not_linked.length > 0 && (
              <p className="mt-3 text-small text-warning">{tr('Not in any account yet:')} {data.not_linked.map((x) => `${tr(METHOD[x.method] || x.method)} ${formatCurrency(x.amount)}`).join(', ')}</p>
            )}
          </Card>
        </>
      )}
      {tab === 'trial' && <TrialBalance />}
      {tab === 'sheet' && <BalanceSheet />}

      {adding && <AddAccount kind={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />}
      {moving && data && <MoveMoney accounts={data.accounts.filter((a) => a.is_active)} onClose={() => setMoving(false)} onSaved={() => { setMoving(false); load(); }} />}
      {viewing && <Statement account={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}

function AddAccount({ kind, onClose, onSaved }) {
  const tr = useT();
  const [f, setF] = useState({ name: '', opening_balance: '', opening_date: today(), bank_name: '', account_last4: '', ifsc: '', lender: '', interest_rate: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/money-accounts', { method: 'POST', body: { ...f, kind } }); onSaved(); } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  return (
    <Modal open title={kind === 'LOAN' ? tr('Add a loan') : kind === 'BANK' ? tr('Add a bank account') : tr('Add a cash account')} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Alert>{error}</Alert>
        <Field id="ac_name" label={tr('Name')}><Input id="ac_name" value={f.name} onChange={set('name')} placeholder={kind === 'BANK' ? 'HDFC current' : kind === 'LOAN' ? tr('Shop loan') : tr('Second counter')} required /></Field>
        {kind === 'BANK' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="ac_bank" label={tr('Bank')}><Input id="ac_bank" value={f.bank_name} onChange={set('bank_name')} /></Field>
            <Field id="ac_last4" label={tr('Account number (last 4)')}><Input id="ac_last4" inputMode="numeric" maxLength={4} value={f.account_last4} onChange={set('account_last4')} /></Field>
            <Field id="ac_ifsc" label="IFSC"><Input id="ac_ifsc" value={f.ifsc} onChange={set('ifsc')} /></Field>
          </div>
        )}
        {kind === 'LOAN' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ac_lender" label={tr('Lender')}><Input id="ac_lender" value={f.lender} onChange={set('lender')} /></Field>
            <Field id="ac_rate" label={tr('Interest rate (% a year)')}><Input id="ac_rate" type="number" min="0" max="100" step="0.01" value={f.interest_rate} onChange={set('interest_rate')} /></Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ac_open" label={kind === 'LOAN' ? tr('Still owed on that day (₹)') : tr('Money in it on that day (₹)')}><Input id="ac_open" type="number" step="0.01" value={f.opening_balance} onChange={set('opening_balance')} /></Field>
          <Field id="ac_date" label={tr('From the day')} hint={tr('Payments from this day on are counted in it')}><Input id="ac_date" type="date" value={f.opening_date} onChange={set('opening_date')} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Close')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  );
}

function MoveMoney({ accounts, onClose, onSaved }) {
  const tr = useT();
  const [kind, setKind] = useState('TRANSFER');
  const [f, setF] = useState({ from_account_id: '', to_account_id: '', amount: '', interest: '', date: today(), note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rule = MOVES[kind];
  const opts = (kinds) => accounts.filter((a) => kinds.includes(a.kind));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api('/money-accounts/transfers', { method: 'POST', body: { kind, ...f, from_account_id: rule.from ? f.from_account_id : null, to_account_id: rule.to ? f.to_account_id : null, interest: kind === 'LOAN_REPAID' ? f.interest : undefined } });
      onSaved();
    } catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  return (
    <Modal open title={tr('Record money moved')} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Alert>{error}</Alert>
        <Field id="mv_kind" label={tr('What happened')}>
          <Select id="mv_kind" value={kind} onChange={(e) => { setKind(e.target.value); setF({ ...f, from_account_id: '', to_account_id: '' }); }}>
            {Object.entries(MOVES).map(([k, m]) => <option key={k} value={k}>{tr(m.label)}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {rule.from && <Field id="mv_from" label={kind === 'LOAN_TAKEN' ? tr('Loan') : tr('From')}><Select id="mv_from" value={f.from_account_id} onChange={(e) => setF({ ...f, from_account_id: e.target.value })} required><option value="">{tr('Choose')}</option>{opts(rule.from).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</Select></Field>}
          {rule.to && <Field id="mv_to" label={kind === 'LOAN_REPAID' ? tr('Loan') : tr('Into')}><Select id="mv_to" value={f.to_account_id} onChange={(e) => setF({ ...f, to_account_id: e.target.value })} required><option value="">{tr('Choose')}</option>{opts(rule.to).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</Select></Field>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="mv_amount" label={kind === 'LOAN_REPAID' ? tr('Loan paid back (₹)') : tr('Amount (₹)')}><Input id="mv_amount" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
          {kind === 'LOAN_REPAID' && <Field id="mv_int" label={tr('Interest (₹)')}><Input id="mv_int" type="number" min="0" step="0.01" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} /></Field>}
          <Field id="mv_date" label={tr('Date')}><Input id="mv_date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field id="mv_note" label={tr('Note')}><Input id="mv_note" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Close')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  );
}

function Statement({ account, onClose, onChanged }) {
  const tr = useT();
  const { can } = useAuth();
  const [range, setRange] = useState({ from: daysAgo(30), to: today() });
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(`/money-accounts/${account.account_id}/statement?from=${range.from}&to=${range.to}`).then(setS).catch((e) => setError(e.message)), [account.account_id, range]);
  useEffect(() => { load(); }, [load]);
  const loan = account.kind === 'LOAN';
  const undo = async (id) => { try { await api(`/money-accounts/transfers/${id}/void`, { method: 'POST', body: {} }); load(); onChanged(); } catch (e) { setError(e.message); } };
  return (
    <Modal open wide title={loan ? tr('Loan statement: {{name}}', { name: account.name }) : tr('Statement: {{name}}', { name: account.name })} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field id="st_from" label={tr('From')}><Input id="st_from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field id="st_to" label={tr('To')}><Input id="st_to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <Button variant="secondary" onClick={() => window.print()}>{tr('Print')}</Button>
        </div>
        <Alert>{error}</Alert>
        {s && (
          <table className="w-full text-small">
            <thead><tr className="border-b border-line text-left text-caption text-ink-500">
              <th className="py-2">{tr('Date')}</th><th>{tr('What')}</th>
              <th className="text-right">{loan ? tr('Repaid') : tr('Money in')}</th><th className="text-right">{loan ? tr('Borrowed') : tr('Money out')}</th><th className="text-right">{loan ? tr('Owed') : tr('Balance')}</th><th className="print:hidden" />
            </tr></thead>
            <tbody>
              <tr className="border-b border-line"><td className="py-2" colSpan={4}>{tr('Balance on {{date}}', { date: formatDate(s.from) })}</td><td className="tabular text-right font-medium">{formatCurrency(s.opening_balance)}</td><td /></tr>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="tabular py-2 text-ink-500">{formatDate(l.date)}</td>
                  <td><span className="text-ink-900">{tr(l.what)}</span>{l.detail && <span className="block text-caption text-ink-500">{l.detail}</span>}</td>
                  <td className="tabular text-right text-success">{l.in ? formatCurrency(l.in) : ''}</td>
                  <td className="tabular text-right text-ink-700">{l.out ? formatCurrency(l.out) : ''}</td>
                  <td className="tabular text-right">{formatCurrency(l.balance)}</td>
                  <td className="text-right print:hidden">{l.transfer_id && can('payments') && <button type="button" className="text-caption text-danger hover:underline" onClick={() => undo(l.transfer_id)}>{tr('Undo')}</button>}</td>
                </tr>
              ))}
              <tr><td className="py-2 font-semibold" colSpan={4}>{tr('Balance on {{date}}', { date: formatDate(s.to) })}</td><td className="tabular text-right font-semibold">{formatCurrency(s.closing_balance)}</td><td /></tr>
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

const Notes = ({ notes }) => <div className="space-y-1">{notes?.map((n) => <p key={n} className="text-caption text-ink-500">{n}</p>)}</div>;

function TrialBalance() {
  const tr = useT();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/reports/trial-balance').then(setD).catch((e) => setError(e.message)); }, []);
  return (
    <Card>
      <Alert>{error}</Alert>
      {d && (
        <>
          <p className="text-small text-ink-500">{tr('As on {{date}}; profit and loss from {{from}}', { date: formatDate(d.as_on), from: formatDate(d.financial_year.from) })}</p>
          <table className="mt-3 w-full text-small">
            <thead><tr className="border-b border-line text-left text-caption text-ink-500"><th className="py-2">{tr('Account')}</th><th className="text-right">{tr('Debit')}</th><th className="text-right">{tr('Credit')}</th></tr></thead>
            <tbody>
              {d.rows.map((r) => <tr key={r.name} className="border-b border-line"><td className="py-2">{tr(r.name)}</td><td className="tabular text-right">{r.debit ? formatCurrency(r.debit) : ''}</td><td className="tabular text-right">{r.credit ? formatCurrency(r.credit) : ''}</td></tr>)}
              <tr className="font-semibold"><td className="py-2">{tr('Total')}</td><td className="tabular text-right">{formatCurrency(d.total_debit)}</td><td className="tabular text-right">{formatCurrency(d.total_credit)}</td></tr>
            </tbody>
          </table>
          <div className="mt-3 flex items-start justify-between gap-3"><Notes notes={d.notes} /><Button size="sm" variant="secondary" onClick={() => window.print()}>{tr('Print')}</Button></div>
        </>
      )}
    </Card>
  );
}

function BalanceSheet() {
  const tr = useT();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/reports/balance-sheet').then(setD).catch((e) => setError(e.message)); }, []);
  const Side = ({ title, rows, total }) => (
    <div>
      <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      <ul className="divide-y divide-line">{rows.map((r) => <li key={r.name} className="flex justify-between gap-3 py-1.5 text-small"><span>{tr(r.name)}</span><span className="tabular">{formatCurrency(r.amount)}</span></li>)}</ul>
      {total != null && <p className="mt-2 flex justify-between border-t border-line-strong pt-2 text-small font-semibold"><span>{tr('Total')}</span><span className="tabular">{formatCurrency(total)}</span></p>}
    </div>
  );
  return (
    <Card>
      <Alert>{error}</Alert>
      {d && (
        <>
          <p className="text-small text-ink-500">{tr('As on {{date}}', { date: formatDate(d.as_on) })}</p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <Side title={tr('What the business has')} rows={d.assets} total={d.total_assets} />
            <div className="space-y-5">
              <Side title={tr('What the business owes')} rows={d.liabilities} />
              <Side title={tr('Owner\'s capital')} rows={d.capital} total={d.total_liabilities_and_capital} />
            </div>
          </div>
          <div className="mt-4 flex items-start justify-between gap-3"><Notes notes={d.notes} /><Button size="sm" variant="secondary" onClick={() => window.print()}>{tr('Print')}</Button></div>
        </>
      )}
    </Card>
  );
}
