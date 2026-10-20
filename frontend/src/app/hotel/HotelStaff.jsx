/*
 * Hotel staff, in one place: the people (records, department, shift and, for those allowed, pay), the weekly roster, daily attendance, leave, the monthly payroll sheet, and
 * the departments and shifts behind it. Pay is only shown to people with the payroll permission.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { setStaffMode, staffApi as api, useStaffLoad as useLoad } from '../../lib/staffBase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ID_TYPES, longDate, qs, timeText, useDebounced } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, Panel, Tabs, useAction } from '../salon/parts.jsx';
import { Attendance, Roster } from './StaffTime.jsx';
import Payroll from './StaffPayroll.jsx';
import { useT, T } from '../../i18n/useT.js';

const rs = (n) => formatCurrency(n);
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ── people ────────────────────────────────────────────────────────────── */

const EmployeeForm = ({ initial, depts, shifts, canPay, onClose, onSaved }) => {
  const tr = useT();
  const edit = Boolean(initial.employee_id);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    name: initial.name || '', phone: initial.phone || '', email: initial.email || '', dept_id: initial.dept_id || '', designation: initial.designation || '', joined_on: initial.joined_on || '',
    default_shift_id: initial.default_shift_id || '', weekly_off: initial.weekly_off ?? '', pay_type: initial.pay_type || 'MONTHLY', salary: initial.salary ?? '', bank_account: initial.bank_account || '',
    id_type: initial.id_type || '', id_number: initial.id_number || '', address: initial.address || '', emergency_contact: initial.emergency_contact || '', status: initial.status || 'ACTIVE', left_on: initial.left_on || '', notes: initial.notes || ''
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = {
      name: f.name, phone: f.phone || undefined, email: f.email || undefined, dept_id: f.dept_id ? Number(f.dept_id) : null, designation: f.designation || undefined, joined_on: f.joined_on || null,
      default_shift_id: f.default_shift_id ? Number(f.default_shift_id) : null, weekly_off: f.weekly_off === '' ? null : Number(f.weekly_off), id_type: f.id_type || undefined, id_number: f.id_number || undefined,
      address: f.address || undefined, emergency_contact: f.emergency_contact || undefined, notes: f.notes || undefined, status: f.status, ...(f.status === 'INACTIVE' && f.left_on ? { left_on: f.left_on } : {}),
      ...(canPay ? { pay_type: f.pay_type, salary: f.salary === '' ? 0 : Number(f.salary), bank_account: f.bank_account || undefined } : {})
    };
    const out = await run(() => api(edit ? `/hotel/staff/employees/${initial.employee_id}` : '/hotel/staff/employees', { method: edit ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onSaved();
  };
  return (
    <Modal title={edit ? `Edit ${initial.name}` : tr('Add a person')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5"><Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="em-n" label={tr('Name')}><Input id="em-n" value={f.name} onChange={set('name')} required autoFocus /></Field>
          <Field id="em-p" label={tr('Mobile')}><Input id="em-p" type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field id="em-e" label={tr('Email')}><Input id="em-e" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field id="em-d" label={tr('Department')}><Select id="em-d" value={f.dept_id} onChange={set('dept_id')}><option value="">{tr('None')}</option>{depts.map((d) => <option key={d.dept_id} value={d.dept_id}>{d.name}</option>)}</Select></Field>
          <Field id="em-ds" label={tr('Designation')}><Input id="em-ds" value={f.designation} onChange={set('designation')} placeholder={tr('Receptionist, Cook, Housekeeper…')} /></Field>
          <Field id="em-j" label={tr('Joined on')}><Input id="em-j" type="date" value={f.joined_on} onChange={set('joined_on')} /></Field>
          <Field id="em-s" label={tr('Usual shift')}><Select id="em-s" value={f.default_shift_id} onChange={set('default_shift_id')}><option value="">{tr('No fixed shift')}</option>{shifts.map((s) => <option key={s.shift_id} value={s.shift_id}>{tr('{{s_name}} ({{timeText}} to {{timeText2}})', { s_name: s.name, timeText: timeText(s.start_time), timeText2: timeText(s.end_time) })}</option>)}</Select></Field>
          <Field id="em-w" label={tr('Weekly off')}><Select id="em-w" value={f.weekly_off} onChange={set('weekly_off')}><option value="">{tr('None fixed')}</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <Field id="em-st" label={tr('Working here')}><Select id="em-st" value={f.status} onChange={set('status')}><option value="ACTIVE">{tr('Yes')}</option><option value="INACTIVE">{tr('Left')}</option></Select></Field>
        </div>
        {f.status === 'INACTIVE' && <Field id="em-l" label={tr('Last day')}><Input id="em-l" type="date" value={f.left_on} onChange={set('left_on')} /></Field>}
        {canPay && (
          <div className="rounded-(--radius-card) border border-line p-4">
            <p className="mb-3 text-small font-medium text-ink-900">{tr('Pay')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="em-pt" label={tr('Paid')}><Select id="em-pt" value={f.pay_type} onChange={set('pay_type')}><option value="MONTHLY">{tr('By the month')}</option><option value="DAILY">{tr('By the day')}</option></Select></Field>
              <Field id="em-sal" label={f.pay_type === 'DAILY' ? tr('Rate a day') : tr('Monthly salary')}><Input id="em-sal" type="number" min="0" step="any" value={f.salary} onChange={set('salary')} /></Field>
              <Field id="em-b" label={tr('Bank account')}><Input id="em-b" value={f.bank_account} onChange={set('bank_account')} /></Field>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="em-it" label={tr('ID type')}><Select id="em-it" value={f.id_type} onChange={set('id_type')}><option value="">{tr('Not taken')}</option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field id="em-in" label={tr('ID number')}><Input id="em-in" value={f.id_number} onChange={set('id_number')} /></Field>
          <Field id="em-ec" label={tr('Emergency contact')}><Input id="em-ec" value={f.emergency_contact} onChange={set('emergency_contact')} placeholder={tr('Name and number')} /></Field>
        </div>
        <Field id="em-a" label={tr('Address')}><Input id="em-a" value={f.address} onChange={set('address')} /></Field>
        <Field id="em-no" label={tr('Notes')}><Textarea id="em-no" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  );
};

const People = ({ canPay, canHr, depts, shifts }) => {
  const tr = useT();
  const [status, setStatus] = useState('ACTIVE');
  const [dept, setDept] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const [form, setForm] = useState(null);
  const head = useLoad('/hotel/staff/headcount');
  const list = useLoad(`/hotel/staff/employees${qs({ status, dept_id: dept, q: q.trim() })}`);
  const rows = list.data || [];
  const h = head.data;
  const reload = () => { list.reload(); head.reload(); };
  return (
    <div className="space-y-5">
      {h && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><StatCard label={tr('On the books')} value={h.total} /><StatCard label={tr('Present today')} value={h.present} tone="text-success" /><StatCard label={tr('Absent today')} value={h.absent} tone={h.absent ? 'text-danger' : undefined} /><StatCard label={tr('On leave')} value={h.on_leave} /><StatCard label={tr('Not marked yet')} value={h.unmarked} tone={h.unmarked ? 'text-warning' : undefined} /></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Chips label={tr('Show')} options={[{ value: 'ACTIVE', label: T('Working') }, { value: 'INACTIVE', label: T('Left') }, { value: 'ALL', label: T('All') }]} value={status} onChange={setStatus} />
        <Select aria-label={tr('Department')} value={dept} onChange={(e) => setDept(e.target.value)} className="max-w-48"><option value="">{tr('All departments')}</option>{depts.map((d) => <option key={d.dept_id} value={d.dept_id}>{d.name}</option>)}</Select>
        <Input aria-label={tr('Search people')} placeholder={tr('Name, code or phone')} value={text} onChange={(e) => setText(e.target.value)} className="max-w-60" />
        <div className="ml-auto">{canHr && <Button onClick={() => setForm({})}><UserPlus aria-hidden="true" className="h-4 w-4" />{tr('Add a person')}</Button>}</div>
      </div>
      <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && !rows.length} emptyLabel={q ? tr('Nobody matches.') : tr('No one here yet. Add your first person.')} />
      {rows.length > 0 && (
        <Table><Thead><Th>{tr('Code')}</Th><Th>{tr('Name')}</Th><Th>{tr('Department')}</Th><Th>{tr('Shift')}</Th><Th>{tr('Weekly off')}</Th>{canPay && <Th className="text-right">{tr('Pay')}</Th>}<Th></Th></Thead>
          <tbody>{rows.map((e) => (
            <Tr key={e.employee_id}>
              <Td className="text-ink-500">{e.emp_code}</Td>
              <Td><span className="font-medium text-ink-900">{e.name}</span>{e.status === 'INACTIVE' && <span className="ml-2"><Badge>Left {e.left_on ? longDate(e.left_on) : ''}</Badge></span>}<span className="block text-caption text-ink-500">{[e.designation, e.phone].filter(Boolean).join(' · ')}</span></Td>
              <Td>{e.department || '—'}</Td><Td>{e.shift_name || '—'}</Td><Td>{e.weekly_off != null ? WEEKDAYS[e.weekly_off] : '—'}</Td>
              {canPay && <Td className="tabular text-right">{e.salary_paise != null ? `${rs(Number(e.salary_paise) / 100)}${e.pay_type === 'DAILY' ? ' / day' : ' / month'}` : '—'}</Td>}
              <Td className="text-right">{canHr && <button type="button" aria-label={tr('Edit {{e_name}}', { e_name: e.name })} onClick={() => setForm({ ...e, salary: e.salary_paise != null ? Number(e.salary_paise) / 100 : '' })} className="text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="inline h-4 w-4" /></button>}</Td>
            </Tr>))}</tbody></Table>
      )}
      {form && <EmployeeForm initial={form} depts={depts} shifts={shifts} canPay={canPay} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </div>
  );
};

/* ── leave ─────────────────────────────────────────────────────────────── */

const KINDS = [['CASUAL', T('Casual')], ['SICK', T('Sick')], ['PAID', T('Paid')], ['UNPAID', T('Unpaid')]];
const LEAVE_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };

const LeaveForm = ({ people, onClose, onSaved }) => {
  const tr = useT();
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ employee_id: people[0]?.employee_id || '', from_date: '', to_date: '', kind: 'CASUAL', reason: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api('/hotel/staff/leaves', { method: 'POST', body: { ...f, employee_id: Number(f.employee_id), reason: f.reason || undefined, to_date: f.to_date || f.from_date } }).catch((c) => { setError(c.message); throw c; }), 'Leave recorded');
    if (out) onSaved();
  };
  return (
    <Modal title={tr('Leave')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <Field id="lv-e" label={tr('Who')}><Select id="lv-e" value={f.employee_id} onChange={set('employee_id')}>{people.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.name}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="lv-f" label={tr('From')}><Input id="lv-f" type="date" value={f.from_date} onChange={set('from_date')} required /></Field>
          <Field id="lv-t" label={tr('To (including)')}><Input id="lv-t" type="date" value={f.to_date} onChange={set('to_date')} placeholder={f.from_date} /></Field>
          <Field id="lv-k" label={tr('Kind')}><Select id="lv-k" value={f.kind} onChange={set('kind')}>{KINDS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
        </div>
        <Field id="lv-r" label={tr('Reason')}><Input id="lv-r" value={f.reason} onChange={set('reason')} /></Field>
        <p className="text-caption text-ink-500">Unpaid leave is not paid in payroll; casual, sick and paid leave are.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  );
};

const Leaves = ({ canHr }) => {
  const tr = useT();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const leaves = useLoad(`/hotel/staff/leaves${qs({ status })}`);
  const people = useLoad('/hotel/staff/employees');
  const decide = async (l, action) => { try { await api(`/hotel/staff/leaves/${l.leave_id}/decide`, { method: 'POST', body: { action } }); toast.success(action === 'APPROVE' ? tr('Approved: the days are marked') : action === 'REJECT' ? tr('Rejected') : tr('Cancelled')); leaves.reload(); } catch (e) { toast.error(e.message); } };
  const rows = leaves.data || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Chips label={tr('Show')} options={[{ value: '', label: T('All') }, { value: 'PENDING', label: T('Waiting') }, { value: 'APPROVED', label: T('Approved') }, { value: 'REJECTED', label: T('Rejected') }]} value={status} onChange={setStatus} />
        <div className="ml-auto">{canHr && people.data && <Button onClick={() => setOpen(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add leave')}</Button>}</div></div>
      <ListState loading={leaves.loading && !leaves.data} error={leaves.error} empty={!leaves.loading && !rows.length} emptyLabel={tr('No leave here.')} />
      {rows.length > 0 && <Table><Thead><Th>{tr('Who')}</Th><Th>{tr('Days')}</Th><Th>{tr('Kind')}</Th><Th>{tr('Reason')}</Th><Th>{tr('Status')}</Th><Th></Th></Thead>
        <tbody>{rows.map((l) => <Tr key={l.leave_id}><Td><span className="font-medium text-ink-900">{l.employee}</span><span className="block text-caption text-ink-500">{l.department}</span></Td><Td className="whitespace-nowrap">{longDate(l.from_date)}{l.to_date !== l.from_date ? ` to ${longDate(l.to_date)}` : ''}</Td><Td>{KINDS.find(([c]) => c === l.kind)?.[1]}</Td><Td>{l.reason || '—'}</Td><Td><Badge tone={LEAVE_TONE[l.status]}>{l.status.charAt(0) + l.status.slice(1).toLowerCase()}</Badge></Td>
          <Td className="text-right whitespace-nowrap">{canHr && l.status === 'PENDING' && <><button type="button" onClick={() => decide(l, 'APPROVE')} className="mr-3 text-caption font-medium text-brand-600 hover:underline">{tr('Approve')}</button><button type="button" onClick={() => decide(l, 'REJECT')} className="text-caption font-medium text-danger hover:underline">{tr('Reject')}</button></>}{canHr && l.status === 'APPROVED' && <button type="button" onClick={() => decide(l, 'CANCEL')} className="text-caption text-ink-500 hover:underline">{tr('Cancel')}</button>}</Td></Tr>)}</tbody></Table>}
      {open && <LeaveForm people={people.data} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); leaves.reload(); }} />}
    </div>
  );
};

/* ── departments and shifts ────────────────────────────────────────────── */

const Setup = ({ canHr }) => {
  const tr = useT();
  const dialog = useDialog();
  const toast = useToast();
  const depts = useLoad('/hotel/staff/departments');
  const shifts = useLoad('/hotel/staff/shifts');
  const [shift, setShift] = useState(null);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const addDept = async () => {
    const name = await dialog.prompt({ title: tr('Add a department'), label: tr('Name'), confirmLabel: tr('Add') });
    if (!name) return;
    try { await api('/hotel/staff/departments', { method: 'POST', body: { name } }); depts.reload(); } catch (e) { toast.error(e.message); }
  };
  const removeDept = async (d) => {
    if (!(await dialog.confirm({ title: `Remove ${d.name}?`, confirmLabel: tr('Remove'), danger: true }))) return;
    try { await api(`/hotel/staff/departments/${d.dept_id}`, { method: 'DELETE' }); depts.reload(); } catch (e) { toast.error(e.message); }
  };
  const saveShift = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(shift.shift_id ? `/hotel/staff/shifts/${shift.shift_id}` : '/hotel/staff/shifts', { method: shift.shift_id ? 'PUT' : 'POST', body: { name: shift.name, start_time: shift.start_time, end_time: shift.end_time } }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) { setShift(null); shifts.reload(); }
  };
  const removeShift = async (s) => { try { await api(`/hotel/staff/shifts/${s.shift_id}`, { method: 'DELETE' }); shifts.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={tr('Departments')} action={canHr && <Button size="sm" variant="secondary" onClick={addDept}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add')}</Button>}>
        <ListState loading={depts.loading && !depts.data} error={depts.error} />
        <ul className="divide-y divide-line">{(depts.data || []).map((d) => <li key={d.dept_id} className="flex items-center justify-between py-2 text-small"><span className="text-ink-900">{d.name}</span><span className="flex items-center gap-3 text-ink-500">{d.people} {d.people === 1 ? 'person' : 'people'}{canHr && <button type="button" aria-label={tr('Remove {{d_name}}', { d_name: d.name })} onClick={() => removeDept(d)} className="hover:text-danger"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>}</span></li>)}</ul>
      </Panel>
      <Panel title={tr('Shifts')} action={canHr && <Button size="sm" variant="secondary" onClick={() => { setError(''); setShift({ name: '', start_time: '09:00', end_time: '17:00' }); }}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add')}</Button>}>
        <ListState loading={shifts.loading && !shifts.data} error={shifts.error} />
        <ul className="divide-y divide-line">{(shifts.data || []).map((s) => <li key={s.shift_id} className="flex items-center justify-between py-2 text-small"><span className="text-ink-900">{s.name}</span><span className="flex items-center gap-3 text-ink-500">{timeText(s.start_time)} to {timeText(s.end_time)}{canHr && <><button type="button" aria-label={tr('Edit {{s_name}}', { s_name: s.name })} onClick={() => { setError(''); setShift({ ...s, start_time: String(s.start_time).slice(0, 5), end_time: String(s.end_time).slice(0, 5) }); }} className="hover:text-ink-900"><Pencil aria-hidden="true" className="h-4 w-4" /></button><button type="button" aria-label={tr('Remove {{s_name}}', { s_name: s.name })} onClick={() => removeShift(s)} className="hover:text-danger"><Trash2 aria-hidden="true" className="h-4 w-4" /></button></>}</span></li>)}</ul>
      </Panel>
      {shift && (
        <Modal title={shift.shift_id ? `Edit ${shift.name}` : tr('Add a shift')} onClose={() => setShift(null)}>
          <form onSubmit={saveShift} className="space-y-4"><Alert>{error}</Alert>
            <Field id="sh-n" label={tr('Name')}><Input id="sh-n" value={shift.name} onChange={(e) => setShift((x) => ({ ...x, name: e.target.value }))} required autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field id="sh-s" label={tr('Starts')}><Input id="sh-s" type="time" value={shift.start_time} onChange={(e) => setShift((x) => ({ ...x, start_time: e.target.value }))} required /></Field><Field id="sh-e" label={tr('Ends')}><Input id="sh-e" type="time" value={shift.end_time} onChange={(e) => setShift((x) => ({ ...x, end_time: e.target.value }))} required /></Field></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setShift(null)}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default function HotelStaff() {
  const tr = useT();
  const { can, business } = useAuth();
  setStaffMode(business?.business_type);   // a hotel and a spare parts workshop share these pages (lib/staffBase.js)
  const [params, setParams] = useSearchParams();
  const canHr = can('hr'); const canPay = can('payroll');
  const tabs = [{ key: 'people', label: T('People') }, ...(canHr ? [{ key: 'roster', label: T('Roster') }, { key: 'attendance', label: T('Attendance') }] : []), { key: 'leave', label: T('Leave') }, ...(canPay ? [{ key: 'payroll', label: T('Payroll') }] : []), { key: 'setup', label: T('Departments and shifts') }];
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'people';
  const depts = useLoad('/hotel/staff/departments');
  const shifts = useLoad('/hotel/staff/shifts');
  return (
    <div>
      <PageHeader title={tr('Staff')} lead={tr('Who works here, when they work, who turned up, who was away and what they are paid.')} />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setParams(k === 'people' ? {} : { tab: k })} />
      {tab === 'people' && <People canPay={canPay} canHr={canHr} depts={depts.data || []} shifts={shifts.data || []} />}
      {tab === 'roster' && <Roster />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'leave' && <Leaves canHr={canHr} />}
      {tab === 'payroll' && <Payroll />}
      {tab === 'setup' && <Setup canHr={canHr} />}
    </div>
  );
}
