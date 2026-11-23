/* Enquiries and follow-ups: who asked about joining, who to call today, and what happened. One tap to call or WhatsApp, a note after the call, one tap to make them a member. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { longDate, qs, useDebounced, useLoad } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, StatCard, useToast } from '../../components/ui.jsx';
import { Tabs, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const SOURCES = [['WALK_IN', 'Walked in'], ['PHONE', 'Phone call'], ['WHATSAPP', 'WhatsApp'], ['INSTAGRAM', 'Instagram'], ['REFERRAL', 'Friend'], ['WEBSITE', 'Website'], ['OTHER', 'Other']];
const INTERESTS = ['Weight loss', 'Muscle gain', 'General fitness', 'Personal training', 'Yoga or classes'];
const LOST = ['Too expensive', 'Too far away', 'Joined another gym', 'Not interested now', 'Could not reach them'];
const iso = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA');
const DAYS = [['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['In a month', 30]];

const Chips = ({ items, value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">{items.map(([k, label]) => (
    <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(value === k ? '' : k)}
            className={`rounded-full border px-3 py-1.5 text-small ${value === k ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-surface text-ink-700'}`}>{label}</button>
  ))}</div>
);

function AddEnquiry({ onClose, onSaved }) {
  const tr = useT();
  const [f, setF] = useState({ name: '', phone: '', source: 'WALK_IN', interest: '', note: '', follow: 1 });
  const { busy, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    return run(async () => { await api('/gym/enquiries', { method: 'POST', body: { name: f.name, phone: f.phone, source: f.source, interest: f.interest, note: f.note, follow_up_on: iso(f.follow) } }); onSaved(); }, tr('Enquiry saved'));
  };
  return (
    <Modal title={tr('New enquiry')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="en-name" label={tr('Name')}><Input id="en-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
          <Field id="en-phone" label={tr('Phone')}><Input id="en-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
        </div>
        <Field id="en-src" label={tr('How did they find you?')}><Chips items={SOURCES.map(([k, l]) => [k, tr(l)])} value={f.source} onChange={(v) => setF({ ...f, source: v || 'OTHER' })} /></Field>
        <Field id="en-int" label={tr('What are they looking for?')}><Chips items={INTERESTS.map((l) => [l, tr(l)])} value={f.interest} onChange={(v) => setF({ ...f, interest: v })} /></Field>
        <Field id="en-follow" label={tr('Call them')}><Chips items={DAYS.map(([l, n]) => [n, tr(l)])} value={f.follow} onChange={(v) => setF({ ...f, follow: v || 1 })} /></Field>
        <Field id="en-note" label={tr('Note (optional)')}><Input id="en-note" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save enquiry')}</Button></div>
      </form>
    </Modal>
  );
}

function LogCall({ enquiry, onClose, onSaved }) {
  const tr = useT();
  const [note, setNote] = useState('');
  const [days, setDays] = useState(1);
  const { busy, run } = useAction();
  const history = useLoad(`/gym/enquiries/${enquiry.enquiry_id}/notes`);
  const save = () => run(async () => { await api(`/gym/enquiries/${enquiry.enquiry_id}/notes`, { method: 'POST', body: { note, next_follow_up_on: iso(days) } }); onSaved(); }, tr('Saved'));
  return (
    <Modal title={`${tr('After the call')}: ${enquiry.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field id="lc-note" label={tr('What did they say?')}><Input id="lc-note" value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} placeholder={tr('Will come on Saturday, wants the 3 month plan…')} /></Field>
        <Field id="lc-next" label={tr('Call again')}><Chips items={DAYS.map(([l, n]) => [n, tr(l)])} value={days} onChange={(v) => setDays(v || 1)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!note.trim()}>{tr('Save and call later')}</Button></div>
        {history.data?.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-auto border-t border-line pt-3 text-caption text-ink-500">
            {history.data.map((n) => <li key={n.note_id}><span className="tabular">{longDate(String(n.created_at).slice(0, 10))}</span> · {n.note}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function NotJoining({ enquiry, onClose, onSaved }) {
  const tr = useT();
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const save = () => run(async () => { await api(`/gym/enquiries/${enquiry.enquiry_id}/lost`, { method: 'POST', body: { reason } }); onSaved(); }, tr('Closed'));
  return (
    <Modal title={`${tr('Not joining')}: ${enquiry.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field id="nj" label={tr('Why not?')}><Chips items={LOST.map((l) => [l, tr(l)])} value={reason} onChange={setReason} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!reason}>{tr('Close enquiry')}</Button></div>
      </div>
    </Modal>
  );
}

const waLink = (phone) => `https://wa.me/${String(phone).replace(/\D/g, '').replace(/^0+/, '').replace(/^(\d{10})$/, '91$1')}`;

export default function GymEnquiries() {
  const tr = useT();
  const toast = useToast();
  const nav = useNavigate();
  const [view, setView] = useState('today');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const d = useLoad(`/gym/enquiries${qs({ view, q: search.trim() })}`);
  const [dialog, setDialog] = useState(null);   // { kind: 'add' | 'call' | 'lost', enquiry }
  const [error, setError] = useState('');
  const { busy, run } = useAction();
  const done = () => { setDialog(null); d.reload?.(); };
  const counts = d.data?.counts;

  const join = (e) => run(async () => {
    setError('');
    try {
      const m = await api(`/gym/enquiries/${e.enquiry_id}/join`, { method: 'POST', body: {} });
      toast.success(tr('Now a member. Choose their plan.'));
      nav(`/app/gym/members/${m.member_id}`);
    } catch (caught) {
      if (caught.code === 'DUPLICATE_MEMBER' && window.confirm(tr('A member with this number already exists. Make a second member anyway?'))) {
        const m = await api(`/gym/enquiries/${e.enquiry_id}/join`, { method: 'POST', body: { confirm_duplicate: true } });
        nav(`/app/gym/members/${m.member_id}`);
      } else setError(caught.message);
    }
  });

  return (
    <div>
      <PageHeader title={tr('Enquiries')} lead={tr('People who asked about joining. Call the ones due today, note what they said, and make them a member with one tap.')}
                  action={<Button onClick={() => setDialog({ kind: 'add' })}><Plus aria-hidden="true" className="h-4 w-4" />{tr('New enquiry')}</Button>} />
      {counts && (
        <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={tr('To call today')} value={counts.today} tone={counts.today ? 'warning' : undefined} />
          <StatCard label={tr('Still open')} value={counts.open} />
          <StatCard label={tr('Joined (30 days)')} value={counts.joined_30d} />
          <StatCard label={tr('Not joined (30 days)')} value={counts.lost_30d} />
        </section>
      )}
      <Tabs value={view} onChange={setView} tabs={[{ key: 'today', label: 'Call today' }, { key: 'open', label: 'All open' }, { key: 'joined', label: 'Joined' }, { key: 'lost', label: 'Not joined' }]} />
      <Input aria-label={tr('Search')} placeholder={tr('Name or phone')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-xs" />
      <Alert>{error}</Alert>
      <ListState loading={d.loading && !d.data} error={d.error} />
      {d.data && d.data.rows.length === 0 && <p className="text-small text-ink-500">{view === 'today' ? tr('Nobody to call today. Add an enquiry when someone asks about joining.') : tr('Nothing here.')}</p>}
      <ul className="space-y-3">
        {d.data?.rows.map((e) => (
          <li key={e.enquiry_id} className="rounded-(--radius-card) border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2"><span className="text-body font-semibold text-ink-900">{e.name}</span>
                  {e.status === 'OPEN' && e.overdue && <Badge tone="danger">{tr('Overdue')}</Badge>}
                  {e.status === 'JOINED' && <Badge tone="success">{tr('Joined')}</Badge>}
                  {e.status === 'LOST' && <Badge>{e.lost_reason}</Badge>}</p>
                <p className="tabular text-small text-ink-700">{e.phone}</p>
                <p className="text-caption text-ink-500">{[SOURCES.find(([k]) => k === e.source)?.[1] && tr(SOURCES.find(([k]) => k === e.source)[1]), e.interest, e.next_follow_up && `${tr('Call')} ${longDate(e.next_follow_up)}`].filter(Boolean).join(' · ')}</p>
                {e.last_note && <p className="mt-1 text-small text-ink-700">“{e.last_note}”{e.calls > 1 ? <span className="text-caption text-ink-500"> · {e.calls} {tr('notes')}</span> : null}</p>}
              </div>
              {e.status === 'OPEN' && (
                <div className="flex flex-wrap gap-1.5">
                  <a href={`tel:${e.phone}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-(--radius-control) border border-line-strong px-3 text-small font-medium text-ink-900"><Phone aria-hidden="true" className="h-4 w-4" />{tr('Call')}</a>
                  <a href={waLink(e.phone)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-(--radius-control) border border-line-strong px-3 text-small font-medium text-ink-900"><MessageCircle aria-hidden="true" className="h-4 w-4" />WhatsApp</a>
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'call', enquiry: e })}>{tr('Log the call')}</Button>
                  <Button size="sm" onClick={() => join(e)} loading={busy}>{tr('Joined')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'lost', enquiry: e })}>{tr('Not joining')}</Button>
                </div>
              )}
              {e.status === 'JOINED' && e.member_id && <Button size="sm" variant="secondary" onClick={() => nav(`/app/gym/members/${e.member_id}`)}>{tr('Open member')}</Button>}
            </div>
          </li>
        ))}
      </ul>
      {dialog?.kind === 'add' && <AddEnquiry onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === 'call' && <LogCall enquiry={dialog.enquiry} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === 'lost' && <NotJoining enquiry={dialog.enquiry} onClose={() => setDialog(null)} onSaved={done} />}
    </div>
  );
}
