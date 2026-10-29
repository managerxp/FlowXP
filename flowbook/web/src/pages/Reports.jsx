import { useState } from 'react';
import { useLoad } from '../api.js';
import { financialYear, inr, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { GstReturns, Statement } from './Gst.jsx';
import { Async, Badge, Card, Empty, Field, Money, Page, Table, Tabs } from '../ui.jsx';

const Range = ({ r, set, one }) => (
  <Card className="no-print"><div className="form">
    {!one && <Field label="From"><input type="date" value={r.from} onChange={(e) => set({ ...r, from: e.target.value })} /></Field>}
    <Field label={one ? 'As of' : 'To'}><input type="date" value={r.to} onChange={(e) => set({ ...r, to: e.target.value })} /></Field>
  </div></Card>
);
const Lines = ({ rows }) => rows.map((r) => <tr key={r.code}><td>{r.code} · {r.name}</td><td className="r"><Money v={r.amount} /></td></tr>);

const TrialBalance = ({ r }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/reports/trial-balance?from=${r.from}&to=${r.to}`), [org.id, r.from, r.to]);
  return <Async load={load}>{(d) => (
    <Card>{!d.balanced && <p className="notice bad">Debits and credits differ. This should never happen; contact support.</p>}
      <Table head={['Account', '>Debit', '>Credit']} empty={!d.rows.length && <Empty>No entries in this range.</Empty>}>
        {d.rows.map((x) => <tr key={x.id}><td>{x.code} · {x.name}</td><td className="r num">{Number(x.debitBalance) ? inr(x.debitBalance) : ''}</td><td className="r num">{Number(x.creditBalance) ? inr(x.creditBalance) : ''}</td></tr>)}
        <tr className="total"><td>Total</td><td className="r num">{inr(d.totalDebit)}</td><td className="r num">{inr(d.totalCredit)}</td></tr>
      </Table></Card>)}</Async>;
};

const ProfitLoss = ({ r }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/reports/profit-and-loss?from=${r.from}&to=${r.to}`), [org.id, r.from, r.to]);
  return <Async load={load}>{(d) => (
    <Card><Table head={['', '>Amount']}>
      <tr><td colSpan={2}><strong>Income</strong></td></tr><Lines rows={d.income} /><tr className="total"><td>Total income</td><td className="r"><Money v={d.totalIncome} /></td></tr>
      <tr><td colSpan={2}><strong>Expenses</strong></td></tr><Lines rows={d.expense} /><tr className="total"><td>Total expenses</td><td className="r"><Money v={d.totalExpense} /></td></tr>
      <tr className="total"><td>{Number(d.netProfit) < 0 ? 'Loss' : 'Profit'}</td><td className="r"><Money v={d.netProfit} strong /></td></tr>
    </Table></Card>)}</Async>;
};

const BalanceSheet = ({ r }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/reports/balance-sheet?asOf=${r.to}`), [org.id, r.to]);
  return <Async load={load}>{(d) => (
    <Card>{!d.balanced && <p className="notice bad">The sheet does not balance. This should never happen; contact support.</p>}
      <Table head={['', '>Amount']}>
        <tr><td colSpan={2}><strong>Assets</strong></td></tr><Lines rows={d.assets} /><tr className="total"><td>Total assets</td><td className="r"><Money v={d.totalAssets} /></td></tr>
        <tr><td colSpan={2}><strong>Liabilities</strong></td></tr><Lines rows={d.liabilities} />
        <tr><td colSpan={2}><strong>Equity</strong></td></tr><Lines rows={d.equity} /><tr><td>Profit not yet closed</td><td className="r"><Money v={d.profitToDate} /></td></tr>
        <tr className="total"><td>Total liabilities and equity</td><td className="r"><Money v={d.totalLiabilitiesAndEquity} /></td></tr>
      </Table></Card>)}</Async>;
};

const Ageing = ({ r, type }) => {
  const { o, org } = useSession();
  const load = useLoad(() => o(`/reports/ageing?type=${type}&asOf=${r.to}`), [org.id, r.to, type]);
  return <Async load={load}>{(d) => (
    <Card><Table head={[type === 'receivables' ? 'Customer' : 'Vendor', '>Not due', '>1–30 days', '>31–60', '>61–90', '>Over 90', '>Total']} empty={!d.rows.length && <Empty>Nothing outstanding.</Empty>}>
      {d.rows.map((x) => <tr key={x.party_id}><td>{x.party_name}</td>{['not_due', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'].map((k) => <td key={k} className="r num">{Number(x[k]) ? inr(x[k]) : ''}</td>)}<td className="r num strong">{inr(x.total)}</td></tr>)}
      {d.rows.length > 0 && <tr className="total"><td>Total</td><td colSpan={5} /><td className="r num">{inr(d.total)}</td></tr>}
    </Table><p className="muted">Worked out for the date chosen: a payment counts from its own date. Days are counted past the due date (or the invoice date when there is none).</p></Card>)}</Async>;
};

const Checks = () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/reports/reconcile'), [org.id]);
  return <Async load={load}>{(d) => (d.issues.length
    ? <Card title="Things that do not agree"><ul>{d.issues.map((i, n) => <li key={n}>{i}</li>)}</ul></Card>
    : <Card><Badge status="OK">All good</Badge> Every journal balances, and every customer and vendor balance matches its documents.</Card>)}</Async>;
};

export default () => {
  const fy = financialYear();
  const [tab, setTab] = useState('pnl');
  const [r, setR] = useState({ from: fy.from, to: today() });
  const asOfOnly = ['bs', 'ar', 'ap'].includes(tab);
  return (
    <Page title="Reports" lead={fy.label + ' by default. Change the dates to look at any period.'} actions={<button className="btn no-print" onClick={() => window.print()}>Print</button>}>
      <Tabs value={tab} onChange={setTab} tabs={[['pnl', 'Profit and loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance'], ['ar', 'Who owes you'], ['ap', 'Who you owe'], ['stmt', 'Party statement'], ['gst', 'GST returns'], ['chk', 'Checks']]} />
      {!['chk', 'gst'].includes(tab) && <Range r={r} set={setR} one={asOfOnly} />}
      {tab === 'pnl' && <ProfitLoss r={r} />}{tab === 'bs' && <BalanceSheet r={r} />}{tab === 'tb' && <TrialBalance r={r} />}
      {tab === 'ar' && <Ageing r={r} type="receivables" />}{tab === 'ap' && <Ageing r={r} type="payables" />}{tab === 'chk' && <Checks />}{tab === 'gst' && <GstReturns />}{tab === 'stmt' && <Statement r={r} />}
    </Page>
  );
};
