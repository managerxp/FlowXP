/*
 * Classes: the timetable and its bookings, one-to-one training, trainers (and how busy they are), and the kinds of class. Times are the gym's own.
 * A class is made for a date and a clock time (never a browser time zone), repeated weekly if asked; booking, waitlists, cancellations and packs follow the
 * server's rules, which are the same ones the member's own page uses.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, Plus, UserPlus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { addDays, clockTime, longDate, qs, useDebounced, useLoad } from '../../lib/gym.js';
import { Alert, Avatar, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, Toggle, useAction } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const weekFrom = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const dayName = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const localDay = (iso, tz) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
const BOOK_STATUS = { BOOKED: ['Booked', 'success'], WAITLISTED: ['Waiting', 'warning'], ATTENDED: ['Came', 'success'], NO_SHOW: ['No-show', 'danger'] };

const ClassForm = ({ types, trainers, onClose, onSaved }) => {
  const tr = useT();
  const [f, setF] = useState({ class_type_id: types[0]?.class_type_id ?? '', date: addDays(todayStr(), 1), start: '18:00', trainer_id: '', capacity: '', room: '', weeks: '1' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const type = types.find((t) => String(t.class_type_id) === String(f.class_type_id));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => run(async () => {
    setError('');
    try { onSaved(await api('/gym/classes', { method: 'POST', body: { class_type_id: Number(f.class_type_id), date: f.date, start: f.start, trainer_id: f.trainer_id ? Number(f.trainer_id) : undefined, capacity: f.capacity ? Number(f.capacity) : undefined, room: f.room || undefined, weeks: Number(f.weeks) } })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={tr('Schedule a class')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!f.class_type_id}>{Number(f.weeks) > 1 ? `Schedule ${f.weeks} classes` : tr('Schedule')}</Button></>}>
      {!types.length ? <Alert>{tr('Add a kind of class first (Class types).')}</Alert> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-type" label={tr('Class')}><Select id="c-type" value={f.class_type_id} onChange={set('class_type_id')}>{types.map((t) => <option key={t.class_type_id} value={t.class_type_id}>{tr('{{t_name}} ({{duration_min}} min)', { t_name: t.name, duration_min: t.duration_min })}</option>)}</Select></Field>
          <Field id="c-trainer" label={tr('Trainer')}><Select id="c-trainer" value={f.trainer_id} onChange={set('trainer_id')}><option value="">{tr('Not set')}</option>{trainers.map((t) => <option key={t.trainer_id} value={t.trainer_id}>{t.name}</option>)}</Select></Field>
          <Field id="c-date" label={tr('Date')}><Input id="c-date" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field id="c-start" label={tr('Starts at')}><Input id="c-start" type="time" value={f.start} onChange={set('start')} /></Field>
          <NumberField id="c-cap" label={tr('Places')} value={f.capacity} onChange={(v) => setF((x) => ({ ...x, capacity: v }))} min={1} step={1} hint={type ? `Usually ${type.default_capacity}` : ''} />
          <Field id="c-room" label={tr('Room (optional)')}><Input id="c-room" value={f.room} onChange={set('room')} /></Field>
          <NumberField id="c-weeks" label={tr('Repeat for (weeks)')} value={f.weeks} onChange={(v) => setF((x) => ({ ...x, weeks: v }))} min={1} step={1} hint={tr('Every week on the same day and time.')} />
        </div>
      )}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

const SessionDialog = ({ session, canManage, onClose, onChanged }) => {
  const tr = useT();
  const toast = useToast();
  const dialog = useDialog();
  const list = useLoad(`/gym/classes/${session.session_id}/bookings`);
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const found = useLoad(q.trim().length >= 2 ? `/gym/members${qs({ q: q.trim(), limit: 5 })}` : null, { paged: true });
  const [error, setError] = useState('');
  const rows = list.data || [];
  const reload = () => { list.reload(); onChanged(); };
  const act = async (fn, ok) => { setError(''); try { await fn(); if (ok) toast.success(ok); reload(); } catch (e) { setError(e.message); } };
  const started = new Date(session.starts_at) <= new Date(Date.now() + 15 * 60000);
  const cancelClass = async () => {
    const reason = await dialog.prompt({ title: tr('Cancel this class?'), body: tr('Everyone booked is let off without a late fee, and any pack session is returned.'), label: tr('Reason'), required: true, confirmLabel: tr('Cancel the class'), danger: true });
    if (reason) { try { await api(`/gym/classes/${session.session_id}/cancel`, { method: 'POST', body: { reason } }); toast.success(tr('Class cancelled')); onChanged(); onClose(); } catch (e) { setError(e.message); } }
  };
  return (
    <Modal title={`${session.class_name}: ${clockTime(session.starts_at)}`} onClose={onClose} wide footer={<>{canManage && session.status === 'SCHEDULED' && <Button variant="danger" onClick={cancelClass}>{tr('Cancel the class')}</Button>}<Button variant="secondary" onClick={onClose}>{tr('Close')}</Button></>}>
      <p className="mb-3 text-small text-ink-500">{session.trainer_name ? `With ${session.trainer_name} · ` : ''}{session.capacity} places · {session.booked} booked{session.waitlisted ? ` · ${session.waitlisted} waiting` : ''}{session.needs_pack ? tr('· uses a class pack') : ''}</p>
      {session.status === 'SCHEDULED' && (
        <div className="mb-4">
          <Input aria-label={tr('Add a member to this class')} placeholder={tr('Add a member: name, phone or number')} value={text} onChange={(e) => setText(e.target.value)} />
          {(found.data || []).length > 0 && <ul className="mt-1 divide-y divide-line rounded-lg border border-line">{found.data.map((m) => <li key={m.member_id}><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-small hover:bg-surface-2" onClick={() => act(async () => { await api(`/gym/classes/${session.session_id}/book`, { method: 'POST', body: { member_id: m.member_id } }); setText(''); }, 'Booked')}>{m.name}<span className="text-ink-500">{m.member_code} <UserPlus aria-hidden="true" className="ml-1 inline h-4 w-4" /></span></button></li>)}</ul>}
        </div>
      )}
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={tr('Nobody is booked yet.')} />
      <ul className="divide-y divide-line">
        {rows.map((b) => (
          <li key={b.booking_id} className="flex flex-wrap items-center gap-2 py-2 text-small">
            <Avatar name={b.member_name} /><span className="min-w-0 flex-1"><Link to={`/app/gym/members/${b.member_id}`} className="font-medium text-brand-600 hover:underline">{b.member_name}</Link><span className="ml-2 text-caption text-ink-500">{b.member_code}</span></span>
            <Badge tone={BOOK_STATUS[b.status][1]}>{BOOK_STATUS[b.status][0]}</Badge>
            {started && ['BOOKED', 'ATTENDED', 'NO_SHOW'].includes(b.status) && <><Button size="sm" variant="secondary" onClick={() => act(() => api(`/gym/bookings/${b.booking_id}/attendance`, { method: 'POST', body: { status: 'ATTENDED' } }))}>{tr('Came')}</Button><Button size="sm" variant="ghost" onClick={() => act(() => api(`/gym/bookings/${b.booking_id}/attendance`, { method: 'POST', body: { status: 'NO_SHOW' } }))}>{tr('No-show')}</Button></>}
            {['BOOKED', 'WAITLISTED'].includes(b.status) && <Button size="sm" variant="ghost" aria-label={tr('Cancel {{member_name}}\'s booking', { member_name: b.member_name })} onClick={() => act(() => api(`/gym/bookings/${b.booking_id}/cancel`, { method: 'POST' }), 'Cancelled')}><X aria-hidden="true" className="h-4 w-4" /></Button>}
          </li>
        ))}
      </ul>
    </Modal>
  );
};

const Timetable = ({ canManage, tz }) => {
  const tr = useT();
  const [from, setFrom] = useState(weekFrom(todayStr()));
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const types = useLoad('/gym/class-types'); const trainers = useLoad('/gym/trainers');
  const list = useLoad(`/gym/classes${qs({ from, to: addDays(from, 6), cancelled: 'true' })}`);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const byDay = (d) => (list.data || []).filter((s) => localDay(s.starts_at, tz) === d);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setFrom(addDays(from, -7))}>{tr('Earlier')}</Button>
        <span className="text-small font-medium text-ink-900">{tr('{{longDate}} to {{longDate2}}', { longDate: longDate(from), longDate2: longDate(addDays(from, 6)) })}</span>
        <Button size="sm" variant="secondary" onClick={() => setFrom(addDays(from, 7))}>{tr('Later')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setFrom(weekFrom(todayStr()))}>{tr('This week')}</Button>
        {canManage && <Button size="sm" onClick={() => setAdding(true)} className="ml-auto"><CalendarPlus aria-hidden="true" className="h-4 w-4" />{tr('Schedule a class')}</Button>}
      </div>
      <ListState loading={list.loading && !list.data} error={list.error} />
      <div className="space-y-4">
        {days.map((d) => (
          <section key={d} aria-label={dayName(d)}>
            <h3 className={`mb-1.5 text-small font-semibold ${d === todayStr() ? 'text-brand-700' : 'text-ink-900'}`}>{dayName(d)}{d === todayStr() ? tr('(today)') : ''}</h3>
            {byDay(d).length === 0 ? <p className="text-caption text-ink-400">{tr('No classes.')}</p> : (
              <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {byDay(d).map((s) => (
                  <li key={s.session_id}>
                    <button type="button" onClick={() => setOpen(s)} className={`flex w-full flex-col rounded-(--radius-card) border bg-surface p-3 text-left transition-colors hover:border-line-strong ${s.status === 'CANCELLED' ? 'border-line opacity-60' : 'border-line'}`}>
                      <span className="flex items-center justify-between gap-2"><span className="text-body font-semibold text-ink-900">{s.class_name}</span><span className="tabular text-small text-ink-700">{clockTime(s.starts_at)}</span></span>
                      <span className="text-caption text-ink-500">{s.trainer_name || 'No trainer set'}{s.room ? ` · ${s.room}` : ''}</span>
                      <span className="mt-2 flex items-center gap-2 text-caption">{s.status === 'CANCELLED' ? <Badge tone="danger">{tr('Cancelled')}</Badge> : <><Badge tone={s.seats_left === 0 ? 'warning' : 'success'}>{s.seats_left === 0 ? tr('Full') : `${s.seats_left} left`}</Badge><span className="text-ink-500">{s.booked}/{s.capacity} booked{s.waitlisted ? `, ${s.waitlisted} waiting` : ''}</span></>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {adding && <ClassForm types={types.data || []} trainers={trainers.data || []} onClose={() => setAdding(false)} onSaved={(made) => { setAdding(false); list.reload(); void made; }} />}
      {open && <SessionDialog session={open} canManage={canManage} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
};

const PtBooking = ({ trainers, onClose, onSaved }) => {
  const tr = useT();
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const found = useLoad(q.trim().length >= 2 ? `/gym/members${qs({ q: q.trim(), limit: 5 })}` : null, { paged: true });
  const [member, setMember] = useState(null);
  const [f, setF] = useState({ trainer_id: trainers[0]?.trainer_id ?? '', date: addDays(todayStr(), 1), start: '07:00', minutes: '60', notes: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={tr('Book a personal-training session')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!member || !f.trainer_id} onClick={() => run(async () => { setError(''); try { await api('/gym/pt', { method: 'POST', body: { member_id: member.member_id, trainer_id: Number(f.trainer_id), date: f.date, start: f.start, minutes: Number(f.minutes), notes: f.notes || undefined } }); onSaved(); } catch (e) { setError(e.message); } }, null)}>{tr('Book')}</Button></>}>
      {member ? <p className="mb-3 text-small">Member: <strong>{member.name}</strong> <button type="button" className="ml-2 text-brand-600 hover:underline" onClick={() => setMember(null)}>{tr('change')}</button></p> : (
        <div className="mb-3"><Input aria-label={tr('Find the member')} autoFocus placeholder={tr('Name, phone or member number')} value={text} onChange={(e) => setText(e.target.value)} />
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line">{(found.data || []).map((m) => <li key={m.member_id}><button type="button" onClick={() => setMember(m)} className="w-full px-3 py-2 text-left text-small hover:bg-surface-2">{m.name} <span className="text-ink-500">{m.member_code}</span></button></li>)}</ul></div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pt-tr" label={tr('Trainer')}><Select id="pt-tr" value={f.trainer_id} onChange={set('trainer_id')}>{trainers.map((t) => <option key={t.trainer_id} value={t.trainer_id}>{t.name}</option>)}</Select></Field>
        <Field id="pt-date" label={tr('Date')}><Input id="pt-date" type="date" value={f.date} onChange={set('date')} /></Field>
        <Field id="pt-start" label={tr('Starts at')}><Input id="pt-start" type="time" value={f.start} onChange={set('start')} /></Field>
        <NumberField id="pt-min" label={tr('Length (minutes)')} value={f.minutes} onChange={(v) => setF((x) => ({ ...x, minutes: v }))} min={15} step={5} />
      </div>
      <p className="mt-3 text-caption text-ink-500">{tr('It takes one session from the member\'s personal-training pack, returned if they cancel in time.')}</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

const PersonalTraining = ({ canManage }) => {
  const tr = useT();
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const trainers = useLoad('/gym/trainers');
  const list = useLoad(`/gym/pt${qs({ from, to: addDays(from, 13) })}`);
  const [adding, setAdding] = useState(false);
  const rows = list.data || [];
  const act = async (id, what, body) => { try { await api(`/gym/pt/${id}/${what}`, { method: 'POST', body }); toast.success(tr('Saved')); list.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <div className="mb-4 flex items-center gap-2"><Field id="pt-from" label={tr('From')}><Input id="pt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>{(canManage || true) && <Button className="mt-6" onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Book a session')}</Button>}</div>
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={tr('No sessions in the next two weeks.')} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>{tr('When')}</Th><Th>{tr('Member')}</Th><Th>{tr('Trainer')}</Th><Th>{tr('Status')}</Th><Th> </Th></Thead>
          <tbody>{rows.map((p) => (
            <Tr key={p.pt_id}>
              <Td className="whitespace-nowrap">{new Date(p.starts_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Td>
              <Td><Link to={`/app/gym/members/${p.member_id}`} className="text-brand-600 hover:underline">{p.member_name}</Link></Td><Td>{p.trainer_name}</Td>
              <Td><Badge tone={{ SCHEDULED: 'brand', COMPLETED: 'success', CANCELLED: 'neutral', NO_SHOW: 'danger' }[p.status]}>{{ SCHEDULED: 'Booked', COMPLETED: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' }[p.status]}</Badge></Td>
              <Td className="text-right">{p.status === 'SCHEDULED' && <span className="inline-flex gap-1"><Button size="sm" variant="secondary" onClick={() => act(p.pt_id, 'finish', { status: 'COMPLETED' })}>{tr('Done')}</Button><Button size="sm" variant="ghost" onClick={() => act(p.pt_id, 'finish', { status: 'NO_SHOW' })}>{tr('No-show')}</Button><Button size="sm" variant="ghost" onClick={() => act(p.pt_id, 'cancel', {})}>{tr('Cancel')}</Button></span>}</Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
      {adding && <PtBooking trainers={trainers.data || []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast.success(tr('Booked')); list.reload(); }} />}
    </div>
  );
};

const TrainerForm = ({ trainer, onClose, onSaved }) => {
  const tr = useT();
  const [f, setF] = useState(trainer || { name: '', phone: '', specialties: '', bio: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={trainer ? `Edit ${trainer.name}` : tr('New trainer')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!f.name.trim()} onClick={() => run(async () => { setError(''); try { onSaved(await api(trainer ? `/gym/trainers/${trainer.trainer_id}` : '/gym/trainers', { method: trainer ? 'PUT' : 'POST', body: { name: f.name, phone: f.phone || null, specialties: f.specialties || null, bio: f.bio || null } })); } catch (e) { setError(e.message); } }, null)}>{tr('Save')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="t-name" label={tr('Name')}><Input id="t-name" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field id="t-phone" label={tr('Phone')}><Input id="t-phone" value={f.phone || ''} onChange={set('phone')} /></Field>
        <div className="sm:col-span-2"><Field id="t-spec" label={tr('Specialities')}><Input id="t-spec" value={f.specialties || ''} onChange={set('specialties')} placeholder={tr('Strength, yoga, rehab')} /></Field></div>
        <div className="sm:col-span-2"><Field id="t-bio" label={tr('About')}><Input id="t-bio" value={f.bio || ''} onChange={set('bio')} /></Field></div>
      </div>
      <p className="mt-3 text-caption text-ink-500">{tr('To let a trainer sign in and see only their own members, add them under Staff with the Trainer role, then link their login here.')}</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

const Trainers = ({ canManage }) => {
  const tr = useT();
  const toast = useToast();
  const list = useLoad('/gym/trainers?all=true');
  const rep = useLoad('/gym/reports/trainers');
  const [edit, setEdit] = useState(null);
  const stat = (id) => rep.data?.trainers?.find((t) => t.trainer_id === id);
  return (
    <div>
      {canManage && <div className="mb-4"><Button onClick={() => setEdit('new')}><Plus aria-hidden="true" className="h-4 w-4" />{tr('New trainer')}</Button></div>}
      <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && !(list.data || []).length} emptyLabel={tr('No trainers yet.')} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(list.data || []).map((t) => { const s = stat(t.trainer_id); return (
          <article key={t.trainer_id} className={`rounded-(--radius-card) border border-line bg-surface p-4 ${t.is_active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2"><Avatar name={t.name} /><div><p className="font-semibold text-ink-900">{t.name}</p><p className="text-caption text-ink-500">{t.specialties || 'No speciality set'}</p></div></div>{!t.is_active && <Badge>{tr('Not active')}</Badge>}</div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-caption">
              <div><dt className="text-ink-500">{tr('Clients')}</dt><dd className="tabular text-body font-semibold text-ink-900">{t.clients}</dd></div>
              <div><dt className="text-ink-500">{tr('Classes')}</dt><dd className="tabular text-body font-semibold text-ink-900">{s?.classes ?? '–'}</dd></div>
              <div><dt className="text-ink-500">{tr('1-to-1 done')}</dt><dd className="tabular text-body font-semibold text-ink-900">{s?.pt_completed ?? '–'}</dd></div>
            </dl>
            {s && s.seats > 0 && <p className="mt-2 text-caption text-ink-500">This month: classes {s.fill_rate}% full, {s.attendance_rate ?? 0}% of bookings came.</p>}
            {canManage && <Button className="mt-3" size="sm" variant="secondary" onClick={() => setEdit(t)}>{tr('Edit')}</Button>}
          </article>
        ); })}
      </div>
      {edit && <TrainerForm trainer={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast.success(tr('Saved')); list.reload(); rep.reload(); }} />}
    </div>
  );
};

const ClassTypes = ({ canManage }) => {
  const tr = useT();
  const toast = useToast();
  const list = useLoad('/gym/class-types?all=true');
  const [f, setF] = useState({ name: '', duration_min: '60', default_capacity: '20', requires_pack: false });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const add = () => run(async () => { setError(''); try { await api('/gym/class-types', { method: 'POST', body: { name: f.name, duration_min: Number(f.duration_min), default_capacity: Number(f.default_capacity), requires_pack: f.requires_pack } }); setF({ ...f, name: '' }); list.reload(); toast.success(tr('Added')); } catch (e) { setError(e.message); } }, null);
  return (
    <div className="space-y-4">
      {canManage && (
        <Panel title={tr('Add a kind of class')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="ct-name" label={tr('Name')}><Input id="ct-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tr('Yoga, Spin, Zumba')} /></Field>
            <NumberField id="ct-min" label={tr('Usual length (minutes)')} value={f.duration_min} onChange={(v) => setF({ ...f, duration_min: v })} min={10} step={5} />
            <NumberField id="ct-cap" label={tr('Usual places')} value={f.default_capacity} onChange={(v) => setF({ ...f, default_capacity: v })} min={1} step={1} />
          </div>
          <div className="mt-3"><Toggle id="ct-pack" checked={f.requires_pack} onChange={(v) => setF({ ...f, requires_pack: v })} label={tr('Sold separately: takes a session from a class pack')} hint={tr('Otherwise any member whose membership is good at that time can book.')} /></div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          <Button className="mt-3" onClick={add} loading={busy} disabled={!f.name.trim()}>{tr('Add')}</Button>
        </Panel>
      )}
      <ListState loading={list.loading && !list.data} error={list.error} />
      <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
        {(list.data || []).map((t) => <li key={t.class_type_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-small"><span className="font-medium text-ink-900">{t.name}</span><span className="text-ink-500">{t.duration_min} min · {t.default_capacity} places{t.requires_pack ? tr('· class pack') : ''}</span></li>)}
      </ul>
    </div>
  );
};

export default function GymClasses() {
  const tr = useT();
  const { can } = useAuth();
  const settings = useLoad('/gym/settings');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'timetable';
  const manager = can('gym_setup');
  const tz = settings.data?.timezone || 'Asia/Kolkata';
  const tabs = [{ key: 'timetable', label: T('Timetable') }, ...(can('gym_desk') || can('gym_trainer') || manager ? [{ key: 'pt', label: T('Personal training') }] : []), { key: 'trainers', label: T('Trainers') }, ...(manager ? [{ key: 'types', label: T('Kinds of class') }] : [])];
  return (
    <div>
      <PageHeader title={tr('Classes and training')} lead={tr('The timetable, who has booked, one-to-one sessions and the trainers.')} />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'timetable' && <Timetable canManage={manager} tz={tz} />}
      {tab === 'pt' && <PersonalTraining canManage={manager} />}
      {tab === 'trainers' && <Trainers canManage={manager} />}
      {tab === 'types' && <ClassTypes canManage={manager} />}
    </div>
  );
}
