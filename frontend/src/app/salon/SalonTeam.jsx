/*
 * Team & commission.
 *   Team        who works here: role, skills, working hours, commission rates, whether they can be booked
 *   Attendance  present / absent / leave for each day (an absent person cannot be booked that day)
 *   Commission  what each person has earned in a period → approve → pay out (recorded as an expense)
 *   Payouts     what has been paid
 * Commission rates are visible only to people who may see them; a stylist sees only themselves.
 */
import { useMemo, useState } from 'react';
import { Check, Plus, UserRound } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { DEFAULT_TZ, STAFF_ROLES, WEEKDAYS, addDays, dateText, fromLocal, localParts, longDate, qs, toClock, toMinutes, todayIn, useLoad } from '../../lib/salon.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, NumberField, Pager, SelectField, Tabs, Toggle, useAction } from './parts.jsx';

const money = (n) => formatCurrency(n);

/* ── team ─────────────────────────────────────────────────────────────────── */

const HoursEditor = ({ value, onChange }) => (
  <div className="space-y-1.5">
    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
      const w = value[d];               // undefined = outlet hours, null = day off, {start,end} = own hours
      const mode = w === undefined ? 'outlet' : w === null ? 'off' : 'own';
      return (
        <div key={d} className="flex flex-wrap items-center gap-2 text-small">
          <span className="w-10 font-medium text-ink-700">{WEEKDAYS[d]}</span>
          <Select aria-label={`${WEEKDAYS[d]} hours`} value={mode} onChange={(e) => { const m = e.target.value; const next = { ...value }; if (m === 'outlet') delete next[d]; else if (m === 'off') next[d] = null; else next[d] = { start: '10:00', end: '19:00' }; onChange(next); }} className="!w-auto !py-1">
            <option value="outlet">Salon hours</option><option value="own">Own hours</option><option value="off">Day off</option>
          </Select>
          {mode === 'own' && <><div className="w-28"><Input aria-label={`${WEEKDAYS[d]} starts`} type="time" value={w.start} onChange={(e) => onChange({ ...value, [d]: { ...w, start: e.target.value } })} className="!py-1" /></div>–<div className="w-28"><Input aria-label={`${WEEKDAYS[d]} ends`} type="time" value={w.end} onChange={(e) => onChange({ ...value, [d]: { ...w, end: e.target.value } })} className="!py-1" /></div></>}
        </div>
      );
    })}
  </div>
);

const StaffForm = ({ person, canCommission, outlets, onSaved, onClose }) => {
  const logins = useLoad(canCommission ? '/staff' : null);
  const [form, setForm] = useState(() => ({
    name: person?.name || '', phone: person?.phone || '', email: person?.email || '', staff_role: person?.staff_role || 'HAIR_STYLIST', skills: (person?.skills || []).join(', '),
    commission_type: person?.commission_type || 'PERCENT', commission_value: person?.commission_value != null ? String(person.commission_value) : '0', product_commission_pct: person?.product_commission_pct != null ? String(person.product_commission_pct) : '0',
    working_hours: person?.working_hours || {}, is_bookable: person ? person.is_bookable : true, joined_on: person?.joined_on ? String(person.joined_on).slice(0, 10) : '', user_id: person?.user_id || '', branch_id: person?.branch_id || ''
  }));
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = {
      name: form.name, phone: form.phone || null, email: form.email || null, staff_role: form.staff_role, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      working_hours: Object.keys(form.working_hours).length ? form.working_hours : null, is_bookable: form.is_bookable, joined_on: form.joined_on || null, user_id: form.user_id ? Number(form.user_id) : null,
      ...(canCommission ? { commission_type: form.commission_type, commission_value: Number(form.commission_value) || 0, product_commission_pct: Number(form.product_commission_pct) || 0 } : {}),
      ...(!person && form.branch_id ? { branch_id: Number(form.branch_id) } : {})
    };
    const out = await run(() => api(person ? `/salon/staff/${person.staff_id}` : '/salon/staff', { method: person ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), person ? 'Saved' : 'Team member added');
    if (out) onSaved();
  };
  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add a team member'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="st-name" label="Name"><Input id="st-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required autoFocus /></Field>
          <SelectField id="st-role" label="Role" value={form.staff_role} onChange={set('staff_role')}>{Object.entries(STAFF_ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          <Field id="st-phone" label="Mobile"><Input id="st-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
          <Field id="st-email" label="Email"><Input id="st-email" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} /></Field>
          <Field id="st-skills" label="Skills" hint="Separate with commas, e.g. Colour, Bridal makeup"><Input id="st-skills" value={form.skills} onChange={(e) => set('skills')(e.target.value)} /></Field>
          <Field id="st-joined" label="Joined on"><Input id="st-joined" type="date" value={form.joined_on} onChange={(e) => set('joined_on')(e.target.value)} /></Field>
          {!person && outlets.length > 1 && <SelectField id="st-branch" label="Outlet" value={form.branch_id} onChange={set('branch_id')}><option value="">The outlet I am viewing</option>{outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}</SelectField>}
          {logins.data && <SelectField id="st-login" label="Sign-in account" value={form.user_id} onChange={set('user_id')} hint="Link a login so this person sees their own appointments"><option value="">Not linked</option>{logins.data.map((l) => <option key={l.user_id} value={l.user_id}>{l.name} ({l.role.toLowerCase()})</option>)}</SelectField>}
        </div>
        {canCommission && (
          <fieldset className="grid gap-4 rounded-(--radius-card) border border-line p-4 sm:grid-cols-3">
            <legend className="px-1 text-small font-semibold text-ink-900">Commission</legend>
            <SelectField id="st-ctype" label="On services" value={form.commission_type} onChange={set('commission_type')}><option value="PERCENT">Percent of the bill</option><option value="FIXED">Fixed ₹ per service</option></SelectField>
            <NumberField id="st-cval" label={form.commission_type === 'PERCENT' ? 'Percent' : 'Amount'} prefix={form.commission_type === 'FIXED' ? '₹' : undefined} suffix={form.commission_type === 'PERCENT' ? '%' : undefined} value={form.commission_value} onChange={set('commission_value')} />
            <NumberField id="st-pcom" label="On products they sell" suffix="%" value={form.product_commission_pct} onChange={set('product_commission_pct')} />
            <p className="text-caption text-ink-500 sm:col-span-3">A service or product can have its own rate, which wins over this one. How the base is worked out (before or after discounts) is in Salon settings.</p>
          </fieldset>
        )}
        <fieldset><legend className="mb-2 text-small font-semibold text-ink-900">Working hours</legend><HoursEditor value={form.working_hours} onChange={set('working_hours')} /></fieldset>
        <Toggle id="st-book" checked={form.is_bookable} onChange={set('is_bookable')} label="Can be booked for appointments" />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{person ? 'Save' : 'Add to the team'}</Button></div>
      </form>
    </Modal>
  );
};

const TeamTab = ({ canCommission, canEdit }) => {
  const { outlets } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [status, setStatus] = useState('ACTIVE');
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(null);
  const list = useLoad(`/salon/staff${qs({ status, limit: 200, t: tick })}`, { paged: true });
  const rows = list.data || [];
  const toggleActive = async (p) => {
    const inactive = p.status === 'ACTIVE';
    if (inactive && !(await dialog.confirm({ title: `Mark ${p.name} as left?`, body: 'They can no longer be booked or chosen at the till. Their past work and commission stay.', confirmLabel: 'Mark as left' }))) return;
    try { await api(`/salon/staff/${p.staff_id}`, { method: 'PUT', body: { status: inactive ? 'INACTIVE' : 'ACTIVE' } }); toast.success('Updated'); setTick((t) => t + 1); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Chips label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Working here' }, { value: 'INACTIVE', label: 'Left' }]} />
        {canEdit && <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />Add team member</Button>}
      </div>
      <ListState loading={list.loading && rows.length === 0} error={list.error} empty={!list.loading && rows.length === 0} emptyIcon={UserRound} emptyLabel={status === 'ACTIVE' ? 'No team members yet.' : 'Nobody has left.'} emptyBody="Add the people who do services so they can be booked and earn commission." emptyAction={canEdit && status === 'ACTIVE' && <Button onClick={() => setEditing({})}>Add the first one</Button>} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Name</Th><Th>Role</Th><Th>Skills</Th>{canCommission && <Th>Commission</Th>}<Th>Bookable</Th><Th><span className="sr-only">Actions</span></Th></Thead>
          <tbody>
            {rows.map((p) => (
              <Tr key={p.staff_id} onClick={canEdit ? () => setEditing(p) : undefined}>
                <Td><span className="font-medium">{p.name}</span>{p.phone && <span className="block text-caption text-ink-500">{p.phone}</span>}{p.branch_name && outlets.length > 1 && <span className="block text-caption text-ink-400">{p.branch_name}</span>}</Td>
                <Td>{STAFF_ROLES[p.staff_role] || p.staff_role}</Td>
                <Td className="text-caption text-ink-700">{(p.skills || []).join(', ') || <span className="text-ink-400">—</span>}</Td>
                {canCommission && <Td className="tabular">{p.commission_type === 'PERCENT' ? `${p.commission_value}%` : `${money(p.commission_value)} each`}{p.product_commission_pct > 0 && <span className="block text-caption text-ink-500">{p.product_commission_pct}% on products</span>}</Td>}
                <Td>{p.is_bookable ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge>}</Td>
                <Td className="text-right">{canEdit && <button type="button" onClick={(e) => { e.stopPropagation(); toggleActive(p); }} className="text-caption font-semibold text-ink-500 hover:text-ink-900">{p.status === 'ACTIVE' ? 'Mark as left' : 'Bring back'}</button>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <StaffForm person={editing.staff_id ? editing : null} canCommission={canCommission} outlets={outlets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />}
    </div>
  );
};

/* ── attendance ───────────────────────────────────────────────────────────── */

const AttendanceTab = ({ tz, canMark }) => {
  const [date, setDate] = useState(todayIn(tz));
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const day = useLoad(`/salon/attendance?date=${date}&t=${tick}`);
  const first = date.slice(0, 8) + '01';
  const sum = useLoad(`/salon/attendance/summary${qs({ from: first, to: date })}`, {});
  const mark = async (s, patch) => {
    const body = { staff_id: s.staff_id, work_date: date, status: patch.status || s.status || 'PRESENT', ...(patch.check_in !== undefined ? { check_in: patch.check_in } : {}), ...(patch.check_out !== undefined ? { check_out: patch.check_out } : {}) };
    try { await api('/salon/attendance', { method: 'PUT', body }); setTick((t) => t + 1); } catch (e) { toast.error(e.message); }
  };
  const t = (iso) => (iso ? toClock(localParts(iso, tz).minutes) : '');
  const at = (hhmm) => (hhmm ? fromLocal(date, toMinutes(hhmm), tz).toISOString() : null);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, -1))}>Previous day</Button>
        <div className="w-40"><Input type="date" aria-label="Day" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <Button variant="secondary" size="sm" disabled={date >= todayIn(tz)} onClick={() => setDate(addDays(date, 1))}>Next day</Button>
        <span className="ml-auto text-small font-medium text-ink-900">{dateText(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>
      <ListState loading={day.loading && !day.data} error={day.error} empty={!day.loading && day.data?.staff.length === 0} emptyLabel="No team members yet." />
      {day.data?.staff.length > 0 && (
        <Table>
          <Thead><Th>Name</Th><Th>Status</Th><Th>In</Th><Th>Out</Th><Th className="text-right">This month</Th></Thead>
          <tbody>
            {day.data.staff.map((s) => {
              const m = sum.data?.staff.find((x) => x.staff_id === s.staff_id);
              return (
                <Tr key={s.staff_id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>
                    {canMark ? <Select aria-label={`Attendance for ${s.name}`} value={s.status || ''} onChange={(e) => e.target.value && mark(s, { status: e.target.value })} className="!w-auto !py-1">
                      <option value="">Not marked</option><option value="PRESENT">Present</option><option value="HALF_DAY">Half day</option><option value="LEAVE">On leave</option><option value="ABSENT">Absent</option>
                    </Select> : (s.status ? <Badge>{s.status.toLowerCase().replace('_', ' ')}</Badge> : <span className="text-ink-400">—</span>)}
                  </Td>
                  <Td><div className="w-28"><Input aria-label={`${s.name} check-in`} type="time" disabled={!canMark || !s.status} value={t(s.check_in)} onChange={(e) => mark(s, { check_in: at(e.target.value) })} className="!py-1" /></div></Td>
                  <Td><div className="w-28"><Input aria-label={`${s.name} check-out`} type="time" disabled={!canMark || !s.status} value={t(s.check_out)} onChange={(e) => mark(s, { check_out: at(e.target.value) })} className="!py-1" /></div></Td>
                  <Td className="text-right text-caption text-ink-700">{m ? `${m.present} present · ${m.half_days} half · ${m.leave} leave · ${m.absent} absent` : '—'}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
};

/* ── commission ───────────────────────────────────────────────────────────── */

const RANGES = [
  ['month', 'This month', (t) => [t.slice(0, 8) + '01', t]],
  ['last', 'Last month', (t) => { const d = new Date(`${t.slice(0, 8)}01T00:00:00Z`); const e = new Date(d.getTime() - 86400000); return [`${e.toISOString().slice(0, 8)}01`, e.toISOString().slice(0, 10)]; }],
  ['week', 'Last 7 days', (t) => [addDays(t, -6), t]]
];

const PayModal = ({ person, from, to, onClose, onPaid }) => {
  const [form, setForm] = useState({ method: 'CASH', reference: '', note: '', record_expense: true });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api('/salon/commissions/pay', { method: 'POST', body: { staff_id: person.staff_id, from, to, ...form }, idempotencyKey: crypto.randomUUID() }).catch((c) => { setError(c.message); throw c; }), 'Payout recorded');
    if (out) onPaid();
  };
  return (
    <Modal title={`Pay ${person.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-small text-ink-700">{money(person.approved)} approved for {longDate(from)} – {longDate(to)}.</p>
        <Alert>{error}</Alert>
        <SelectField id="pay-method" label="Paid by" value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v }))}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></SelectField>
        <Field id="pay-ref" label="Reference"><Input id="pay-ref" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></Field>
        <Field id="pay-note" label="Note"><Input id="pay-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
        <Toggle id="pay-exp" checked={form.record_expense} onChange={(v) => setForm((f) => ({ ...f, record_expense: v }))} label="Record as an expense" hint="Shows under Expenses as Commission" />
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Pay {money(person.approved)}</Button></div>
      </form>
    </Modal>
  );
};

const CommissionDetail = ({ person, from, to, onClose }) => {
  const [offset, setOffset] = useState(0);
  const list = useLoad(`/salon/commissions${qs({ staff_id: person.staff_id, from, to, limit: 25, offset })}`, { paged: true });
  return (
    <Modal title={`${person.name} · commission`} onClose={onClose} wide>
      <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && list.data?.length === 0} emptyLabel="Nothing earned in this period." />
      {(list.data || []).length > 0 && (
        <>
          <Table>
            <Thead><Th>Date</Th><Th>Bill</Th><Th>For</Th><Th className="text-right">On</Th><Th className="text-right">Rate</Th><Th className="text-right">Earned</Th><Th>Status</Th></Thead>
            <tbody>
              {list.data.map((c) => (
                <Tr key={c.commission_id}>
                  <Td className="whitespace-nowrap">{longDate(String(c.earned_on).slice(0, 10))}</Td><Td>{c.invoice_number}</Td><Td>{c.description || c.line_type.toLowerCase().replace('_', ' ')}</Td>
                  <Td className="text-right tabular">{c.base ? money(c.base) : '—'}</Td><Td className="text-right tabular">{c.rate_type === 'PERCENT' ? `${c.rate}%` : c.rate ? money(c.rate) : '—'}</Td>
                  <Td className={`text-right tabular ${c.amount < 0 ? 'text-danger' : ''}`}>{money(c.amount)}</Td><Td><Badge tone={c.status === 'PAID' ? 'success' : c.status === 'VOID' ? 'neutral' : c.status === 'APPROVED' ? 'brand' : 'warning'}>{c.status.toLowerCase()}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={list.meta} onPage={setOffset} />
        </>
      )}
    </Modal>
  );
};

const CommissionTab = ({ tz, canPay }) => {
  const toast = useToast();
  const dialog = useDialog();
  const today = todayIn(tz);
  const [range, setRange] = useState('month');
  const [from, to] = RANGES.find((r) => r[0] === range)[2](today);
  const [tick, setTick] = useState(0);
  const [paying, setPaying] = useState(null);
  const [detail, setDetail] = useState(null);
  const sum = useLoad(`/salon/commissions/summary${qs({ from, to, t: tick })}`);
  const rows = sum.data?.staff || [];
  const totals = sum.data?.totals;

  const approve = async (p) => {
    if (!(await dialog.confirm({ title: `Approve ${money(p.pending)} for ${p.name}?`, body: `Commission earned ${longDate(from)} – ${longDate(to)}. Once approved it can be paid out.`, confirmLabel: 'Approve' }))) return;
    try { const r = await api('/salon/commissions/approve', { method: 'POST', body: { staff_id: p.staff_id, from, to } }); toast.success(`${r.approved_rows} entries approved`); setTick((t) => t + 1); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3"><Chips label="Period" value={range} onChange={setRange} options={RANGES.map(([value, label]) => ({ value, label }))} /><span className="text-caption text-ink-500">{longDate(from)} – {longDate(to)}</span></div>
      {totals && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <StatCard label="Waiting for approval" value={money(totals.pending)} tone={totals.pending > 0 ? 'warning' : undefined} />
          <StatCard label="Approved, to pay" value={money(totals.approved)} tone={totals.approved > 0 ? 'brand' : undefined} />
          <StatCard label="Paid" value={money(totals.paid)} />
        </div>
      )}
      <ListState loading={sum.loading && !sum.data} error={sum.error} empty={!sum.loading && rows.length === 0} emptyLabel="No team members yet." />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Name</Th><Th className="text-right">Done</Th><Th className="text-right">Sales</Th><Th className="text-right">Pending</Th><Th className="text-right">Approved</Th><Th className="text-right">Paid</Th><Th><span className="sr-only">Actions</span></Th></Thead>
          <tbody>
            {rows.map((p) => (
              <Tr key={p.staff_id} onClick={() => setDetail(p)}>
                <Td><span className="font-medium">{p.name}</span><span className="block text-caption text-ink-500">{STAFF_ROLES[p.staff_role] || ''}</span></Td>
                <Td className="text-right tabular">{p.lines}</Td><Td className="text-right tabular">{money(p.revenue)}</Td>
                <Td className="text-right tabular">{money(p.pending)}</Td><Td className="text-right tabular">{money(p.approved)}</Td><Td className="text-right tabular">{money(p.paid)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {canPay && p.pending !== 0 && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); approve(p); }}><Check aria-hidden="true" className="h-4 w-4" />Approve</Button>}{' '}
                  {canPay && p.approved > 0 && <Button size="sm" onClick={(e) => { e.stopPropagation(); setPaying(p); }}>Pay</Button>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-caption text-ink-500">When a bill that was already paid out is cancelled or credited, the next payout is reduced by the commission on it — the history is never rewritten.</p>
      {paying && <PayModal person={paying} from={from} to={to} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); setTick((t) => t + 1); }} />}
      {detail && <CommissionDetail person={detail} from={from} to={to} onClose={() => setDetail(null)} />}
    </div>
  );
};

const PayoutsTab = () => {
  const list = useLoad('/salon/commission-payouts');
  const rows = list.data || [];
  return (
    <div>
      <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && rows.length === 0} emptyLabel="No payouts yet." emptyBody="Approve and pay commission from the Commission tab." />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Paid on</Th><Th>Team member</Th><Th>For</Th><Th>By</Th><Th>Reference</Th><Th className="text-right">Amount</Th></Thead>
          <tbody>
            {rows.map((p) => (
              <Tr key={p.payout_id}>
                <Td className="whitespace-nowrap">{longDate(String(p.paid_at).slice(0, 10))}</Td><Td className="font-medium">{p.staff_name}</Td>
                <Td className="whitespace-nowrap text-caption text-ink-700">{longDate(String(p.period_start).slice(0, 10))} – {longDate(String(p.period_end).slice(0, 10))}</Td>
                <Td>{String(p.method).toLowerCase().replace('_', ' ')}</Td><Td>{p.reference || <span className="text-ink-400">—</span>}</Td><Td className="text-right tabular">{money(p.total)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────── */

const SalonTeam = () => {
  const { can, hasFeature } = useAuth();
  const canCommission = can('staff_commission');
  const canMark = can('appointments') || canCommission;
  const schedule = useLoad(can('appointments') && hasFeature('salon_appointments') ? `/salon/schedule?date=${todayIn(DEFAULT_TZ)}` : null);
  const tz = schedule.data?.timezone || DEFAULT_TZ;
  const tabs = useMemo(() => [
    { key: 'team', label: 'Team' },
    { key: 'attendance', label: 'Attendance' },
    ...(canCommission && hasFeature('salon_commission') ? [{ key: 'commission', label: 'Commission' }, { key: 'payouts', label: 'Payouts' }] : [])
  ], [canCommission, hasFeature]);
  const [tab, setTab] = useState('team');
  return (
    <div>
      <PageHeader title="Team & commission" lead="Who works here, when, and what they have earned." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'team' && <TeamTab canCommission={canCommission} canEdit={canCommission} />}
      {tab === 'attendance' && <AttendanceTab tz={tz} canMark={canMark && !schedule.error} />}
      {tab === 'commission' && <CommissionTab tz={tz} canPay />}
      {tab === 'payouts' && <PayoutsTab />}
    </div>
  );
};

export default SalonTeam;
