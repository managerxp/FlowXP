/* Attendance: who came when, every time somebody was turned away and why, and the figures behind it (busy hours, regulars, people who have gone quiet). */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { REASON, SOURCE_NAME, addDays, clockTime, dayTime, hourName, longDate, qs, reasonName, useDebounced, useLoad } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Pager, Panel, Tabs, useAction } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const PAGE = 40;

const Range = ({ from, to, setFrom, setTo }) => {
  const tr = useT();
  return (
  <div className="mb-4 flex flex-wrap items-end gap-3">
    <Field id="r-from" label={tr('From')}><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
    <Field id="r-to" label={tr('To')}><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    <div className="flex gap-1.5 pb-0.5">
      {[['Today', 0], ['7 days', 6], ['30 days', 29]].map(([l, n]) => <Button key={l} size="sm" variant="secondary" onClick={() => { setFrom(addDays(todayStr(), -n)); setTo(todayStr()); }}>{l}</Button>)}
    </div>
  </div>
);
};

const AddVisit = ({ onClose, onSaved }) => {
  const tr = useT();
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const found = useLoad(q.trim().length >= 2 ? `/gym/members${qs({ q: q.trim(), limit: 6 })}` : null, { paged: true });
  const [member, setMember] = useState(null);
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title={tr('Add a missed visit')} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!member || !reason.trim()} onClick={() => run(async () => { setError(''); try { await api('/gym/attendance', { method: 'POST', body: { member_id: member.member_id, reason, ...(when ? { check_in_at: new Date(when).toISOString() } : {}) } }); onSaved(); } catch (e) { setError(e.message); } }, null)}>{tr('Add the visit')}</Button></>}>
      {member ? <p className="mb-3 text-small">Member: <strong>{member.name}</strong> ({member.member_code}) <button type="button" className="ml-2 text-brand-600 hover:underline" onClick={() => setMember(null)}>{tr('change')}</button></p> : (
        <div className="mb-3">
          <Input aria-label={tr('Find the member')} autoFocus placeholder={tr('Name, phone or member number')} value={text} onChange={(e) => setText(e.target.value)} />
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line">{(found.data || []).map((m) => <li key={m.member_id}><button type="button" onClick={() => setMember(m)} className="w-full px-3 py-2 text-left text-small hover:bg-surface-2">{m.name} <span className="text-ink-500">{m.member_code}</span></button></li>)}</ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="v-when" label={tr('Came in at')} hint={tr('Empty means now.')}><Input id="v-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field id="v-reason" label={tr('Why is it being added?')}><Input id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('The scanner was down')} /></Field>
      </div>
      <p className="mt-3 text-caption text-ink-500">{tr('This is written to the access log as a correction, with your name, not as a scan.')}</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

const Visits = () => {
  const tr = useT();
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [params] = useSearchParams();
  const member = params.get('member') || '';
  const [from, setFrom] = useState(addDays(todayStr(), -6));
  const [to, setTo] = useState(todayStr());
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const list = useLoad(`/gym/attendance${qs({ from, to, member_id: member, limit: PAGE, offset })}`, { paged: true });
  const rows = list.data || [];
  const manager = can('gym_setup');
  const voidIt = async (v) => {
    const reason = await dialog.prompt({ title: `Void ${v.member_name}'s visit?`, body: tr('It stays on record, marked as voided, with your name and the reason.'), label: tr('Reason'), required: true, confirmLabel: tr('Void the visit'), danger: true });
    if (!reason) return;
    try { await api(`/gym/attendance/${v.attendance_id}/correct`, { method: 'POST', body: { void: true, reason } }); toast.success(tr('Voided')); list.reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <Range from={from} to={to} setFrom={(v) => { setOffset(0); setFrom(v); }} setTo={(v) => { setOffset(0); setTo(v); }} />
      {manager && <div className="mb-3"><Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add a missed visit')}</Button></div>}
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={tr('No visits in this time.')} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>{tr('Member')}</Th><Th>{tr('In')}</Th><Th>{tr('Out')}</Th><Th>{tr('How')}</Th><Th>{tr('Plan')}</Th>{manager && <Th> </Th>}</Thead>
          <tbody>{rows.map((v) => (
            <Tr key={v.attendance_id}>
              <Td><Link to={`/app/gym/members/${v.member_id}`} className="font-medium text-brand-600 hover:underline">{v.member_name}</Link><span className="block text-caption text-ink-500">{v.member_code}</span></Td>
              <Td className="whitespace-nowrap">{dayTime(v.check_in_at)}</Td>
              <Td className="whitespace-nowrap text-ink-500">{v.check_out_at ? clockTime(v.check_out_at) : '–'}</Td>
              <Td>{SOURCE_NAME[v.source]}{v.status === 'VOIDED' && <> <Badge tone="danger">{tr('Voided')}</Badge></>}</Td>
              <Td className="text-ink-500">{v.plan_name || '–'}</Td>
              {manager && <Td className="text-right">{v.status !== 'VOIDED' && <Button size="sm" variant="ghost" onClick={() => voidIt(v)}>{tr('Void')}</Button>}</Td>}
            </Tr>
          ))}</tbody>
        </Table>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
      {adding && <AddVisit onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast.success(tr('Visit added')); list.reload(); }} />}
    </div>
  );
};

const Log = () => {
  const tr = useT();
  const [params] = useSearchParams();
  const [from, setFrom] = useState(addDays(todayStr(), -2));
  const [to, setTo] = useState(todayStr());
  const [decision, setDecision] = useState('DENIED');
  const [reason, setReason] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(`/gym/access/events${qs({ from, to, decision, reason, member_id: params.get('member') || '', limit: PAGE, offset })}`, { paged: true });
  const rows = list.data || [];
  return (
    <div>
      <Range from={from} to={to} setFrom={(v) => { setOffset(0); setFrom(v); }} setTo={(v) => { setOffset(0); setTo(v); }} />
      <div className="mb-4 flex flex-wrap gap-3">
        <span className="block w-52"><Select aria-label={tr('Outcome')} value={decision} onChange={(e) => { setOffset(0); setDecision(e.target.value); }}><option value="DENIED">{tr('Turned away')}</option><option value="APPROVED">{tr('Let in')}</option><option value="">{tr('Both')}</option></Select></span>
        <span className="block w-52"><Select aria-label={tr('Reason')} value={reason} onChange={(e) => { setOffset(0); setReason(e.target.value); }}><option value="">{tr('Any reason')}</option>{Object.keys(REASON).filter((k) => k !== 'APPROVED').map((k) => <option key={k} value={k}>{reasonName(k)}</option>)}</Select></span>
      </div>
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={tr('Nothing in this time.')} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>{tr('When')}</Th><Th>{tr('Who')}</Th><Th>{tr('Result')}</Th><Th>{tr('How')}</Th><Th>{tr('By')}</Th></Thead>
          <tbody>{rows.map((e) => (
            <Tr key={e.event_id}>
              <Td className="whitespace-nowrap">{dayTime(e.occurred_at)}</Td>
              <Td>{e.member_id ? <Link to={`/app/gym/members/${e.member_id}`} className="text-brand-600 hover:underline">{e.member_name}</Link> : <span className="text-ink-500">{tr('Unknown')}</span>}{e.member_code && <span className="block text-caption text-ink-500">{e.member_code}</span>}</Td>
              <Td><Badge tone={e.decision === 'APPROVED' ? 'success' : REASON[e.reason_code]?.tone === 'warning' ? 'warning' : 'danger'}>{e.decision === 'APPROVED' ? (e.detail?.correction ? tr('Added by hand') : (e.action === 'OUT' ? tr('Checked out') : tr('Let in'))) : reasonName(e.reason_code)}</Badge>{e.detail?.reason && <span className="block text-caption text-ink-500">{e.detail.reason}</span>}</Td>
              <Td>{SOURCE_NAME[e.source]}</Td>
              <Td className="text-ink-500">{e.actor || '–'}</Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
    </div>
  );
};

const Bars = ({ rows, label }) => {
  const tr = useT();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={tr(label)} className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 text-small">
          <span className="w-14 shrink-0 text-ink-500">{tr(r.label)}</span>
          <span className="h-3 flex-1 rounded-full bg-surface-3"><span className="block h-3 rounded-full bg-brand-500" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="tabular w-10 shrink-0 text-right text-ink-900">{r.value}</span>
        </li>
      ))}
    </ul>
  );
};

const Report = () => {
  const tr = useT();
  const [from, setFrom] = useState(addDays(todayStr(), -29));
  const [to, setTo] = useState(todayStr());
  const r = useLoad(`/gym/reports/attendance${qs({ from, to })}`);
  const d = r.data;
  return (
    <div>
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <ListState loading={r.loading && !d} error={r.error} />
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={tr('Visits')} value={d.totals.visits} /><StatCard label={tr('Different members')} value={d.totals.members} /><StatCard label={tr('Average a day')} value={d.totals.average_per_day} />
            <StatCard label={tr('Busiest hour')} value={d.peak_hour == null ? '–' : hourName(d.peak_hour)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title={tr('By hour of the day')} lead={tr('Check-ins in the gym\'s own time')}><Bars label={tr('Visits by hour')} rows={d.by_hour.map((h) => ({ key: h.hour, label: hourName(h.hour), value: h.visits }))} />{!d.by_hour.length && <p className="text-small text-ink-500">{tr('No visits yet.')}</p>}</Panel>
            <Panel title={tr('By day')}><Bars label={tr('Visits by day')} rows={d.by_day.slice(-14).map((x) => ({ key: x.date, label: longDate(x.date).slice(0, 6), value: x.visits }))} />{!d.by_day.length && <p className="text-small text-ink-500">{tr('No visits yet.')}</p>}</Panel>
            <Panel title={tr('Most regular')}>{d.most_frequent.length ? <ol className="space-y-1.5 text-small">{d.most_frequent.map((m) => <li key={m.member_id} className="flex justify-between"><Link to={`/app/gym/members/${m.member_id}`} className="text-brand-600 hover:underline">{m.name}</Link><span className="tabular text-ink-700">{tr('{{visits}} visits', { visits: m.visits })}</span></li>)}</ol> : <p className="text-small text-ink-500">{tr('Nobody yet.')}</p>}</Panel>
            <Panel title={tr('Gone quiet')} lead={tr('Running memberships with no visit since {{longDate}}', { longDate: longDate(from) })}>{d.not_seen.length ? <ul className="space-y-1.5 text-small">{d.not_seen.slice(0, 15).map((m) => <li key={m.member_id} className="flex justify-between"><Link to={`/app/gym/members/${m.member_id}`} className="text-brand-600 hover:underline">{m.name}</Link><span className="tabular text-ink-500">{m.phone}</span></li>)}</ul> : <p className="text-small text-ink-500">{tr('Everyone with a running membership has visited.')}</p>}</Panel>
          </div>
        </div>
      )}
    </div>
  );
};

export default function GymAttendance() {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'visits';
  const tabs = [{ key: 'visits', label: T('Visits') }, ...(can('gym_desk') || can('gym_setup') ? [{ key: 'log', label: T('Access log') }] : []), ...(can('reports') || can('gym_setup') ? [{ key: 'report', label: T('Figures') }] : [])];
  return (
    <div>
      <PageHeader title={tr('Attendance')} lead={tr('Visits, the people turned away, and the figures behind them.')} />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t, ...(params.get('member') ? { member: params.get('member') } : {}) }, { replace: true })} />
      {tab === 'visits' && <Visits />}
      {tab === 'log' && <Log />}
      {tab === 'report' && <Report />}
    </div>
  );
}
