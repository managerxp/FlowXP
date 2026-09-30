/*
 * Clients: the salon's client book. The list is paged and filtered by the server (it stays quick with tens of
 * thousands of clients); segments (new, returning, VIP, inactive, members…) follow the rules set in Salon
 * settings. Opening a client shows their profile, membership / packages / gift cards / points, private notes and
 * a timeline of everything that has happened.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Cake, CalendarDays, Crown, Gift, Mail, NotebookPen, Phone, Plus, Receipt, Search, Sparkles, Star, UserRound } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { APPT_STATUS, dateText, longDate, qs, useDebounced, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, Pager, Tabs, useAction } from './parts.jsx';

const money = (n) => formatCurrency(n);
const PAGE = 25;
const SORTS = [['name', 'Name'], ['recent', 'Last visit'], ['spend', 'Spent most'], ['visits', 'Most visits'], ['newest', 'Newest']];
const LABEL_TONE = { NEW: 'brand', RETURNING: 'neutral', VIP: 'warning', HIGH_SPENDER: 'success', FREQUENT: 'success', MEMBER: 'warning' };
const LABEL_TEXT = { NEW: 'New', RETURNING: 'Returning', VIP: 'VIP', HIGH_SPENDER: 'High spender', FREQUENT: 'Frequent', MEMBER: 'Member' };

const Labels = ({ labels }) => (
  <span className="flex flex-wrap gap-1">
    {labels.map((l) => <Badge key={l} tone={l.startsWith('INACTIVE') ? 'danger' : LABEL_TONE[l] || 'neutral'}>{l.startsWith('INACTIVE') ? `Inactive ${l.split('_')[1]}+ days` : LABEL_TEXT[l] || l}</Badge>)}
  </span>
);

/* ── add / edit ───────────────────────────────────────────────────────────── */

const ClientForm = ({ initial, stylists, onSaved, onClose }) => {
  const isEdit = Boolean(initial.customer_id);
  const [form, setForm] = useState({
    name: initial.name || '', phone: initial.phone || '', email: initial.email || '', gender: initial.gender || '', dob: initial.dob ? String(initial.dob).slice(0, 10) : '',
    anniversary: initial.anniversary ? String(initial.anniversary).slice(0, 10) : '', allergies: initial.allergies || '', preferences: initial.preferences || '',
    favorite_staff_id: initial.favorite_staff_id || '', address: initial.address || '', marketing_opt_out: Boolean(initial.marketing_opt_out)
  });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = { ...form, phone: form.phone || null, email: form.email || null, gender: form.gender || null, dob: form.dob || null, anniversary: form.anniversary || null, favorite_staff_id: form.favorite_staff_id ? Number(form.favorite_staff_id) : null };
    const saved = await run(() => api(isEdit ? `/salon/clients/${initial.customer_id}` : '/salon/clients', { method: isEdit ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), isEdit ? 'Saved' : 'Client added');
    if (saved) onSaved(saved);
  };
  return (
    <Modal title={isEdit ? `Edit ${initial.name}` : 'Add a client'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cl-name" label="Name"><Input id="cl-name" value={form.name} onChange={set('name')} required autoFocus /></Field>
          <Field id="cl-phone" label="Mobile" hint="Used to find them at the till. Each number belongs to one client."><Input id="cl-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} /></Field>
          <Field id="cl-email" label="Email"><Input id="cl-email" type="email" value={form.email} onChange={set('email')} /></Field>
          <Field id="cl-gender" label="Gender"><Select id="cl-gender" value={form.gender} onChange={set('gender')}><option value="">Not said</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select></Field>
          <Field id="cl-dob" label="Birthday"><Input id="cl-dob" type="date" value={form.dob} onChange={set('dob')} /></Field>
          <Field id="cl-anniv" label="Anniversary"><Input id="cl-anniv" type="date" value={form.anniversary} onChange={set('anniversary')} /></Field>
          <Field id="cl-fav" label="Favourite stylist"><Select id="cl-fav" value={form.favorite_staff_id} onChange={set('favorite_staff_id')}><option value="">No preference</option>{stylists.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.name}</option>)}</Select></Field>
          <Field id="cl-addr" label="Address"><Input id="cl-addr" value={form.address} onChange={set('address')} /></Field>
        </div>
        <Field id="cl-allergy" label="Allergies and sensitivities" hint="Shown at the till and on the appointment so nobody misses it."><Textarea id="cl-allergy" rows={2} value={form.allergies} onChange={set('allergies')} /></Field>
        <Field id="cl-pref" label="Preferences"><Textarea id="cl-pref" rows={2} value={form.preferences} onChange={set('preferences')} placeholder="Products, styles, the quiet room…" /></Field>
        <label className="flex items-center gap-2 text-small text-ink-700"><input type="checkbox" checked={form.marketing_opt_out} onChange={(e) => setForm((f) => ({ ...f, marketing_opt_out: e.target.checked }))} className="h-4 w-4 accent-(--color-brand-500)" />Don’t send promotional messages (reminders still go out)</label>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{isEdit ? 'Save changes' : 'Add client'}</Button></div>
      </form>
    </Modal>
  );
};

/* ── one client ───────────────────────────────────────────────────────────── */

const TIMELINE_ICON = { appointment: CalendarDays, invoice: Receipt, payment: Receipt, points: Star, membership: Crown, package: Sparkles, note: NotebookPen };

const Timeline = ({ id, refreshKey }) => {
  const [page, setPage] = useState(0);
  const { data, error, loading } = useLoad(`/salon/clients/${id}/timeline?limit=30&offset=${page * 30}&k=${refreshKey}`);
  const describe = (e) => {
    if (e.type === 'appointment') return { title: `Appointment — ${APPT_STATUS[e.detail]?.label || e.detail}`, body: e.summary };
    if (e.type === 'invoice') return { title: `Bill${e.detail === 'CANCELLED' ? ' (cancelled)' : ''}`, body: e.summary, amount: e.amount != null ? money(e.amount) : null };
    if (e.type === 'payment') return { title: `Payment — ${String(e.detail).toLowerCase().replace('_', ' ')}`, amount: e.amount != null ? money(e.amount) : null };
    if (e.type === 'points') return { title: `Points ${e.detail === 'EARN' ? 'earned' : e.detail === 'REDEEM' ? 'used' : e.detail === 'EXPIRE' ? 'expired' : 'adjusted'}`, body: e.summary, amount: `${e.amount > 0 ? '+' : ''}${e.amount}` };
    if (e.type === 'membership') return { title: `Membership — ${String(e.detail).toLowerCase()}`, body: e.summary };
    if (e.type === 'package') return { title: `Package — ${String(e.detail).toLowerCase()}`, body: e.summary };
    return { title: 'Note', body: e.summary };
  };
  return (
    <div>
      <ListState loading={loading} error={error} empty={!loading && data?.length === 0} emptyLabel="Nothing has happened yet." />
      <ol className="space-y-3">
        {(data || []).map((e, i) => {
          const Icon = TIMELINE_ICON[e.type] || UserRound; const d = describe(e);
          return (
            <li key={`${e.type}-${e.ref_id}-${i}`} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-500"><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-small font-medium text-ink-900"><span>{d.title}</span>{d.amount && <span className="tabular">{d.amount}</span>}</p>
                {d.body && <p className="text-small text-ink-700">{d.body}</p>}
                <p className="text-caption text-ink-400">{new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {(page > 0 || (data?.length || 0) >= 30) && <div className="mt-4 flex justify-between"><Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button><Button variant="secondary" size="sm" disabled={(data?.length || 0) < 30} onClick={() => setPage((p) => p + 1)}>Older</Button></div>}
    </div>
  );
};

const PointsAdjust = ({ id, onDone, onClose }) => {
  const [form, setForm] = useState({ points: '', note: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/loyalty/customers/${id}/points/adjust`, { method: 'POST', body: { points: Number(form.points), note: form.note } }).catch((c) => { setError(c.message); throw c; }), 'Points adjusted');
    if (out) onDone();
  };
  return (
    <Modal title="Adjust points" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="adj-points" label="Points to add (or take off with −)"><Input id="adj-points" type="number" step="1" value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: e.target.value }))} required autoFocus /></Field>
        <Field id="adj-note" label="Why" hint="Kept in the client’s history."><Input id="adj-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} required /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Adjust</Button></div>
      </form>
    </Modal>
  );
};

const ClientModal = ({ id, stylists, canEdit, canAdjust, onClose, onChanged }) => {
  const { hasFeature } = useAuth();
  const toast = useToast();
  const { data: c, error, loading, reload } = useLoad(`/salon/clients/${id}`);
  const [tab, setTab] = useState('overview');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, run] = useAction();

  const addNote = async (e) => {
    e.preventDefault();
    const out = await run(() => api(`/salon/clients/${id}/notes`, { method: 'POST', body: { body: note } }), 'Note added');
    if (out) { setNote(''); reload(); setVersion((v) => v + 1); }
  };

  if (loading && !c) return <Modal title="Client" onClose={onClose}><ListState loading /></Modal>;
  if (error) return <Modal title="Client" onClose={onClose}><Alert>{error}</Alert></Modal>;
  const money_ = c.total_spent != null;
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-small text-ink-700">
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {c.phone && <span className="flex items-center gap-1.5"><Phone aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />{c.phone}</span>}
            {c.email && <span className="flex items-center gap-1.5"><Mail aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />{c.email}</span>}
            {c.dob && <span className="flex items-center gap-1.5"><Cake aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />{dateText(String(c.dob).slice(0, 10), { day: 'numeric', month: 'short' })}</span>}
          </p>
          <Labels labels={c.labels} />
        </div>
        <div className="flex gap-2">
          {canEdit && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
          <Button size="sm" to={`/app/salon/appointments?view=list`} variant="secondary">Appointments</Button>
        </div>
      </div>
      {c.allergies && <p className="mb-4 rounded-(--radius-control) bg-danger/10 px-3 py-2 text-small font-medium text-danger">Allergies: {c.allergies}</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Visits', c.visits], ['Last visit', c.last_visit ? longDate(c.last_visit) : '—'], ...(money_ ? [['Spent', money(c.total_spent)], ['Owes', money(c.outstanding)]] : []), ['Points', c.loyalty ? c.loyalty.available : c.points]].slice(0, 4).map(([k, v]) => (
          <div key={k} className="rounded-(--radius-card) border border-line p-3"><p className="text-caption text-ink-500">{k}</p><p className="tabular text-body font-semibold text-ink-900">{v}</p></div>
        ))}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'timeline', label: 'Timeline' }, { key: 'notes', label: 'Notes', count: c.notes.length }]} />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">Preferences</p><p className="text-small text-ink-700">{c.preferences || 'None noted'}{c.favorite_staff_name && <span className="block text-ink-500">Favourite stylist: {c.favorite_staff_name}</span>}</p></div>
            {c.loyalty && (
              <div>
                <p className="mb-1 flex items-center justify-between text-caption font-semibold uppercase tracking-wide text-ink-500">Loyalty{canAdjust && <button type="button" onClick={() => setAdjusting(true)} className="normal-case tracking-normal text-brand-600">Adjust</button>}</p>
                <p className="text-small text-ink-700">{c.loyalty.available} points available{c.loyalty.tier && ` · ${c.loyalty.tier}`}. {c.loyalty.redeemed} used, {c.loyalty.expired} expired.{c.loyalty.expiring_soon > 0 && <span className="block font-medium text-warning">{c.loyalty.expiring_soon} points expire within 30 days</span>}</p>
              </div>
            )}
          </div>
          {hasFeature('salon_memberships') && c.memberships.length > 0 && (
            <div><p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-500">Memberships</p>
              <ul className="space-y-1.5">{c.memberships.map((m) => <li key={m.membership_id} className="flex items-center justify-between rounded-(--radius-control) border border-line px-3 py-2 text-small"><span className="font-medium text-ink-900">{m.plan_name}</span><span className="text-ink-500">{m.active ? <Badge tone="success">Active</Badge> : <Badge>{m.status === 'ACTIVE' ? 'Expired' : m.status.toLowerCase()}</Badge>} until {longDate(String(m.expiry_date).slice(0, 10))}</span></li>)}</ul></div>
          )}
          {hasFeature('salon_packages') && c.packages.length > 0 && (
            <div><p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-500">Packages</p>
              <ul className="space-y-1.5">{c.packages.map((p) => <li key={p.cp_id} className="rounded-(--radius-control) border border-line px-3 py-2 text-small"><span className="flex items-center justify-between"><span className="font-medium text-ink-900">{p.name}</span><span className="text-ink-500">{p.active ? 'until' : 'ended'} {longDate(String(p.expiry_date).slice(0, 10))}</span></span><span className="text-caption text-ink-500">{(p.items || []).map((i) => `${i.remaining} of ${i.total} ${i.name}`).join(' · ')}</span></li>)}</ul></div>
          )}
          {hasFeature('salon_gift_cards') && c.gift_cards.length > 0 && (
            <div><p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-500">Gift cards</p>
              <ul className="space-y-1.5">{c.gift_cards.map((g) => <li key={g.card_id} className="flex items-center justify-between rounded-(--radius-control) border border-line px-3 py-2 text-small"><span className="flex items-center gap-2 font-mono text-ink-900"><Gift aria-hidden="true" className="h-4 w-4 text-ink-400" />{g.code}</span><span className="tabular">{money(g.balance)} of {money(g.initial)}</span></li>)}</ul></div>
          )}
        </div>
      )}
      {tab === 'timeline' && <Timeline id={id} refreshKey={version} />}
      {tab === 'notes' && (
        <div className="space-y-4">
          <form onSubmit={addNote} className="flex gap-2"><div className="flex-1"><Textarea aria-label="New note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A private note — only your team sees it" /></div><Button type="submit" loading={busy} disabled={!note.trim()}>Add</Button></form>
          {c.notes.length === 0 ? <p className="text-small text-ink-500">No notes yet.</p> : <ul className="space-y-3">{c.notes.map((n) => <li key={n.note_id} className="rounded-(--radius-control) bg-surface-2 px-3 py-2.5"><p className="text-small text-ink-900">{n.body}</p><p className="mt-1 text-caption text-ink-400">{n.author || 'Someone'} · {new Date(n.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p></li>)}</ul>}
        </div>
      )}

      {editing && <ClientForm initial={c} stylists={stylists} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChanged(); }} />}
      {adjusting && <PointsAdjust id={id} onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); reload(); setVersion((v) => v + 1); toast.success('Saved'); }} />}
    </Modal>
  );
};

/* ── the list ─────────────────────────────────────────────────────────────── */

const SalonClients = () => {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [segment, setSegment] = useState('');
  const [sort, setSort] = useState('name');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const openId = params.get('c');
  const refresh = () => setTick((t) => t + 1);

  const list = useLoad(`/salon/clients${qs({ q: term, segment, sort, limit: PAGE, offset, t: tick })}`, { paged: true });
  const segs = useLoad(can('customers') || can('billing') ? `/salon/clients/segments?t=${tick}` : null);
  const team = useLoad('/salon/staff?limit=200', { paged: true });
  useEffect(() => { setOffset(0); }, [term, segment, sort]);

  const rows = list.data || [];
  const stylists = team.data || [];
  const canEdit = can('customers');
  const opt = [{ value: '', label: 'Everyone', count: segs.data?.total }, ...(segs.data?.segments || []).map((s) => ({ value: s.key, label: s.label, count: s.count }))];

  return (
    <div>
      <PageHeader title="Clients" lead="Everyone who has been in — their visits, what they are owed, and what to remember about them."
                  action={canEdit && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add client</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input type="search" aria-label="Search clients" placeholder="Name or mobile" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-small text-ink-500">Sort<Select aria-label="Sort clients" value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto !py-1.5">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
      </div>
      {segs.data && <div className="mb-4"><Chips label="Segments" value={segment} onChange={setSegment} options={opt} /></div>}

      <ListState loading={list.loading && rows.length === 0} error={list.error} empty={!list.loading && rows.length === 0}
                 emptyIcon={UserRound} emptyLabel={term || segment ? 'No clients match.' : 'No clients yet.'} emptyBody={term || segment ? 'Try a different search or segment.' : 'Clients are added here, at the till, or when you book them.'} />
      {rows.length > 0 && (
        <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
          <Table>
            <Thead><Th>Client</Th><Th>Visits</Th><Th>Last visit</Th>{rows[0].total_spent != null && <Th className="text-right">Spent</Th>}<Th>Points</Th><Th>Labels</Th></Thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.customer_id} onClick={() => setParams({ c: c.customer_id })}>
                  <Td><span className="font-medium">{c.name}</span>{c.phone && <span className="block text-caption text-ink-500">{c.phone}</span>}</Td>
                  <Td className="tabular">{c.visits}</Td>
                  <Td className="whitespace-nowrap">{c.last_visit ? longDate(String(c.last_visit).slice(0, 10)) : <span className="text-ink-400">—</span>}</Td>
                  {c.total_spent != null && <Td className="text-right tabular">{money(c.total_spent)}{c.outstanding > 0 && <span className="block text-caption text-warning">{money(c.outstanding)} due</span>}</Td>}
                  <Td className="tabular">{c.points || '—'}</Td>
                  <Td><Labels labels={c.labels} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={list.meta} onPage={setOffset} />
        </div>
      )}

      {adding && <ClientForm initial={{}} stylists={stylists} onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); refresh(); setParams({ c: c.customer_id }); }} />}
      {openId && <ClientModal id={openId} stylists={stylists} canEdit={canEdit} canAdjust={can('settings')} onClose={() => setParams({})} onChanged={refresh} />}
    </div>
  );
};

export default SalonClients;
