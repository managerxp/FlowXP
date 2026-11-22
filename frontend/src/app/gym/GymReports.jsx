/* Owner reports for a date range: where the money came from, who renewed and who left, and what the member wallets hold. Each can be downloaded for Excel. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { downloadFile } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { longDate, qs, rsPaise, useLoad } from '../../lib/gym.js';
import { Badge, Button, Input, ListState, PageHeader, StatCard, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Panel, Tabs } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const iso = (d) => d.toISOString().slice(0, 10);
const THIS_MONTH = () => { const n = new Date(); return [iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1))), iso(n)]; };
const KIND = { membership: 'Memberships', training: 'Personal training and class packs', shop: 'Shop', other: 'Other' };
const METHOD = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', WALLET: 'Wallet', OTHER: 'Other' };

const Bars = ({ rows, total }) => (
  <ul className="space-y-2.5 text-small">
    {rows.map(([label, v]) => (
      <li key={label}>
        <div className="flex justify-between"><span className="text-ink-700">{label}</span><span className="tabular font-medium">{rsPaise(v)}{total > 0 && <span className="text-ink-500"> · {Math.round((v / total) * 100)}%</span>}</span></div>
        <div className="mt-1 h-1.5 rounded-full bg-surface-3"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${total > 0 ? Math.round((v / total) * 100) : 0}%` }} /></div>
      </li>
    ))}
  </ul>
);

function Revenue({ q }) {
  const tr = useT();
  const r = useLoad(`/gym/reports/revenue${q}`);
  const d = r.data;
  return (
    <div className="space-y-5">
      <ListState loading={r.loading && !d} error={r.error} />
      {d && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={tr('Billed')} value={rsPaise(d.total_billed_paise)} note={tr('After refunds')} />
            <StatCard label={tr('Collected')} value={rsPaise(d.collected_paise)} note={tr('Payments on those bills and earlier ones')} />
            <StatCard label={tr('Memberships')} value={rsPaise(d.billed.membership.billed_paise)} note={`${d.billed.membership.bills} ${tr('bills')}`} />
            <StatCard label={tr('Shop')} value={rsPaise(d.billed.shop.billed_paise)} note={`${d.billed.shop.bills} ${tr('bills')}`} />
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title={tr('Where the billing came from')}><Bars total={d.total_billed_paise} rows={Object.entries(KIND).map(([k, l]) => [tr(l), d.billed[k].billed_paise])} /></Panel>
            <Panel title={tr('How it was paid')} lead={tr('Money in the till for these bills. Wallet deposits are under Wallet.')}>
              {d.collected_by_method.length === 0 ? <p className="text-small text-ink-500">{tr('No payments in this time.')}</p> : <Bars total={d.collected_paise} rows={d.collected_by_method.map((m) => [tr(METHOD[m.method] || m.method), m.amount_paise])} />}
            </Panel>
          </div>
          <Panel title={tr('Best-selling products')}>
            {d.top_products.length === 0 ? <p className="text-small text-ink-500">{tr('No shop sales in this time.')}</p> : (
              <Table><Thead><Th>{tr('Product')}</Th><Th className="text-right">{tr('Sold')}</Th><Th className="text-right">{tr('Amount')}</Th></Thead>
                <tbody>{d.top_products.map((p) => <Tr key={p.product_id}><Td className="font-medium text-ink-900">{p.name}</Td><Td className="tabular text-right">{p.quantity}</Td><Td className="tabular text-right">{rsPaise(p.spent_paise)}</Td></Tr>)}</tbody></Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Retention({ q }) {
  const tr = useT();
  const r = useLoad(`/gym/reports/retention${q}`);
  const d = r.data;
  return (
    <div className="space-y-5">
      <ListState loading={r.loading && !d} error={r.error} />
      {d && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={tr('Memberships ended')} value={d.ended} />
            <StatCard label={tr('Renewed')} value={d.renewed} tone={d.renewed ? 'success' : undefined} note={d.renewal_rate == null ? undefined : `${d.renewal_rate}%`} />
            <StatCard label={tr('Not renewed')} value={d.lapsed_count} tone={d.lapsed_count ? 'warning' : undefined} />
            <StatCard label={tr('New members')} value={d.joined} />
            <StatCard label={tr('Cancelled')} value={d.cancelled} />
          </section>
          <Panel title={tr('Not renewed')} lead={tr('Their membership ended in this time and nothing new started within 30 days. Worth a call.')}>
            {d.lapsed.length === 0 ? <p className="text-small text-ink-500">{tr('Nobody to follow up.')}</p> : (
              <Table><Thead><Th>{tr('Member')}</Th><Th>{tr('Plan')}</Th><Th>{tr('Ended')}</Th><Th>{tr('Phone')}</Th></Thead>
                <tbody>{d.lapsed.map((m) => <Tr key={m.member_id}><Td><Link to={`/app/gym/members/${m.member_id}`} className="font-medium text-brand-600 hover:underline">{m.name}</Link></Td><Td>{m.plan_name}</Td><Td>{longDate(m.ended_on)}</Td><Td className="tabular">{m.phone}</Td></Tr>)}</tbody></Table>
            )}
          </Panel>
          <Panel title={tr('Gone quiet')} lead={`${tr('Running memberships with no visit in the last')} ${d.quiet_days} ${tr('days')}`}>
            {d.quiet.length === 0 ? <p className="text-small text-ink-500">{tr('Everyone has been in.')}</p> : (
              <Table><Thead><Th>{tr('Member')}</Th><Th>{tr('Last visit')}</Th><Th>{tr('Phone')}</Th></Thead>
                <tbody>{d.quiet.map((m) => <Tr key={m.member_id}><Td><Link to={`/app/gym/members/${m.member_id}`} className="font-medium text-brand-600 hover:underline">{m.name}</Link></Td><Td>{m.last_visit ? longDate(m.last_visit) : <Badge tone="warning">{tr('Never')}</Badge>}</Td><Td className="tabular">{m.phone}</Td></Tr>)}</tbody></Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Wallet({ q }) {
  const tr = useT();
  const r = useLoad(`/gym/reports/wallet${q}`);
  const d = r.data;
  return (
    <div className="space-y-5">
      <ListState loading={r.loading && !d} error={r.error} />
      {d && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={tr('Held for members')} value={rsPaise(d.held_paise)} note={`${d.members_with_balance} ${tr('members')}`} />
            <StatCard label={tr('Added')} value={rsPaise(d.deposits_paise)} />
            <StatCard label={tr('Spent on bills')} value={rsPaise(d.spent_paise)} />
            <StatCard label={tr('Refunded')} value={rsPaise(d.refunded_paise)} />
            <StatCard label={tr('Back from cancelled bills')} value={rsPaise(d.returned_paise)} />
          </section>
          <Panel title={tr('Balances')} lead={tr('What each member has left with you right now.')}>
            {d.balances.length === 0 ? <p className="text-small text-ink-500">{tr('No member has money in the wallet.')}</p> : (
              <Table><Thead><Th>{tr('Member')}</Th><Th>{tr('Phone')}</Th><Th>{tr('Last moved')}</Th><Th className="text-right">{tr('Balance')}</Th></Thead>
                <tbody>{d.balances.map((m) => <Tr key={m.member_id}><Td><Link to={`/app/gym/members/${m.member_id}`} className="font-medium text-brand-600 hover:underline">{m.name}</Link></Td><Td className="tabular">{m.phone}</Td><Td>{longDate(String(m.last_moved).slice(0, 10))}</Td><Td className="tabular text-right">{rsPaise(m.balance_paise)}</Td></Tr>)}</tbody></Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export default function GymReports() {
  const tr = useT();
  const toast = useToast();
  const { hasFeature } = useAuth();
  const [tab, setTab] = useState('revenue');
  const [[from, to], setRange] = useState(THIS_MONTH);
  const q = qs({ from, to });
  const tabs = [{ key: 'revenue', label: tr('Revenue') }, { key: 'retention', label: tr('Renewals') }, ...(hasFeature('gym_wallet') ? [{ key: 'wallet', label: tr('Wallet') }] : [])];
  const download = async () => { try { await downloadFile(`/gym/reports/${tab}${qs({ from, to, format: 'csv' })}`, `gym-${tab}-${from}-to-${to}.csv`); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <PageHeader title={tr('Reports')} lead={tr('Money, renewals and wallets for any dates. Downloads open in Excel.')}
        action={<Button variant="secondary" onClick={download}><Download aria-hidden="true" className="h-4 w-4" />{tr('Download for Excel')}</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-3 text-small">
        <label className="flex items-center gap-2">{tr('From')}<Input type="date" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} className="w-auto" /></label>
        <label className="flex items-center gap-2">{tr('To')}<Input type="date" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} className="w-auto" /></label>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'revenue' && <Revenue q={q} />}
      {tab === 'retention' && <Retention q={q} />}
      {tab === 'wallet' && <Wallet q={q} />}
    </div>
  );
}
