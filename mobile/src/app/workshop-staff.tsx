import { useState } from 'react';
import { Text } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import {
  MARKS, PAY_TYPE_CHOICES, WEEKLY_OFF_CHOICES, adjustBody, adjustProblem, canStaff, dayCounts, emptyPerson, madeRun, markBody, markLabel, monthOf, personBody, personForm, personProblem, personSub, runLine, shiftMonth, slipForm, slipSub, unmarkedWarning,
  type DayRow, type Person, type PersonForm, type Run, type Slip
} from '../lib/workshopStaff.ts';
import { rupees } from '../lib/money.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, color } from '../lib/ui.tsx';

const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tr = (items: { id: string; label: string }[]) => items.map((x) => ({ id: x.id, label: t(x.label) }));

const PeopleTab = ({ edit, pay }: { edit: boolean; pay: boolean }) => {
  const list = useList<Person[]>('/autoparts/staff/employees?status=ALL');
  const depts = useList<{ dept_id: number; name: string }[]>('/autoparts/staff/departments');
  const [form, setForm] = useState<{ id?: number; f: PersonForm } | null>(null);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const set = (patch: Partial<PersonForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  return (
    <Panel>
      {edit ? <Button title="Add a person" onPress={() => { a.setError(''); setForm({ f: emptyPerson() }); }} /> : null}
      {list.data.length === 0 ? <Soft>{t('Add your mechanics and counter staff.')}</Soft> : null}
      {list.data.map((p) => <Line key={p.employee_id} left={`${p.name}${p.emp_code ? ` · ${p.emp_code}` : ''}`} sub={personSub(p)} onPress={() => { if (edit) { a.setError(''); setForm({ id: p.employee_id, f: personForm(p) }); } }} />)}
      {form ? (
        <Card>
          <Input label="Name" value={form.f.name} onChange={(v) => set({ name: v })} max={120} />
          <Input label="Phone" value={form.f.phone} onChange={(v) => set({ phone: v })} max={15} />
          <Input label="Job title" value={form.f.designation} onChange={(v) => set({ designation: v })} max={80} placeholder="Mechanic, counter, storekeeper" />
          <Field label="Department"><Chips items={[{ id: '', label: t('None') }, ...(depts.data ?? []).map((d) => ({ id: String(d.dept_id), label: d.name }))]} value={form.f.dept_id} onChange={(v) => set({ dept_id: v })} /></Field>
          {pay ? (
            <>
              <Field label="Pay"><Chips items={tr(PAY_TYPE_CHOICES)} value={form.f.pay_type} onChange={(v) => set({ pay_type: v })} /></Field>
              <Input label="Pay in rupees" numeric value={form.f.salary} onChange={(v) => set({ salary: v })} max={9} />
            </>
          ) : null}
          <Input label="Joined on" hint="Like 2026-11-01" value={form.f.joined_on} onChange={(v) => set({ joined_on: v })} max={10} />
          <Field label="Weekly day off"><Chips items={tr(WEEKLY_OFF_CHOICES)} value={form.f.weekly_off} onChange={(v) => set({ weekly_off: v })} /></Field>
          {form.id ? <Field label="Active"><Chips items={[{ id: 'ACTIVE', label: t('Active') }, { id: 'INACTIVE', label: t('Inactive') }]} value={form.f.status} onChange={(v) => set({ status: v })} /></Field> : null}
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(personProblem(form.f, pay), async () => { await api.call(form.id ? `/autoparts/staff/employees/${form.id}` : '/autoparts/staff/employees', { method: form.id ? 'PUT' : 'POST', body: personBody(form.f, pay, Boolean(form.id)) }); setForm(null); list.reload(); }); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

const AttendanceTab = ({ edit }: { edit: boolean }) => {
  const [day] = useState(today());
  const list = useList<{ date: string; rows: DayRow[] }>(`/autoparts/staff/attendance?date=${day}`);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const rows = list.data.rows;
  return (
    <Panel>
      <SectionTitle>Today</SectionTitle>
      <Soft>{`${day} · ${dayCounts(rows)}`}</Soft>
      {edit ? <Soft>{t('Mark each person who turned up.')}</Soft> : null}
      {rows.length === 0 ? <Soft>{t('Nobody to mark.')}</Soft> : null}
      {rows.map((r) => (
        <Card key={r.employee_id}>
          <Text style={{ color: color.ink, fontWeight: '600' }}>{r.name}</Text>
          <Soft>{[r.designation || '', markLabel(r.status)].filter(Boolean).join(' · ')}</Soft>
          {edit ? <Chips items={tr(MARKS)} value={r.status ?? ''} onChange={(v) => { void a.run('', async () => { await api.call('/autoparts/staff/attendance', { method: 'PUT', body: markBody(day, r.employee_id, v) }); list.reload(); }, 'Saved'); }} /> : null}
        </Card>
      ))}
      <Msg a={a} />
    </Panel>
  );
};

const PayrollTab = () => {
  const [month, setMonth] = useState(monthOf(today()));
  const run = useList<Run>(`/autoparts/staff/payroll/${month}`);
  const [open, setOpen] = useState<{ slip: Slip; f: { allowances: string; deductions: string; note: string } } | null>(null);
  const a = useAct();
  const r = madeRun(run.data ?? null);
  const reload = () => run.reload();
  return (
    <Panel>
      <Chips items={[{ id: shiftMonth(month, -1), label: t('Earlier month') }, { id: month, label: month }, { id: shiftMonth(month, 1), label: t('Later month') }]} value={month} onChange={(v) => { setOpen(null); setMonth(v); }} />
      {run.error && !run.data ? <Failed message={run.error} onRetry={run.reload} /> : null}
      {run.data && !r ? (
        <>
          <Soft>{t('Nothing has been made for this month yet.')}</Soft>
          <Soft>{t('Make it from the attendance marked so far. You can change a payslip until the month is final.')}</Soft>
          <Button title="Make the payroll sheet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.post('/autoparts/staff/payroll', { month }); reload(); }); }} />
        </>
      ) : r ? (
        <>
          <SectionTitle>{runLine(r)}</SectionTitle>
          {unmarkedWarning(r) ? <Text accessibilityRole="alert" style={{ color: color.warn }}>{unmarkedWarning(r)}</Text> : null}
          {r.slips.map((s) => <Line key={s.payslip_id} left={s.name} right={rupees(s.net_pay_paise)} sub={slipSub(s)} onPress={() => { if (r.status === 'DRAFT') { a.setError(''); setOpen({ slip: s, f: slipForm(s) }); } }} />)}
          {open ? (
            <Card>
              <Text style={{ color: color.ink, fontWeight: '600' }}>{open.slip.name}</Text>
              <Input label="Extra" numeric value={open.f.allowances} onChange={(v) => setOpen({ ...open, f: { ...open.f, allowances: v } })} max={9} />
              <Input label="Taken off" numeric value={open.f.deductions} onChange={(v) => setOpen({ ...open, f: { ...open.f, deductions: v } })} max={9} />
              <Input label="Note" value={open.f.note} onChange={(v) => setOpen({ ...open, f: { ...open.f, note: v } })} max={200} />
              <Msg a={a} />
              <Button title="Save the payslip" busy={a.busy} onPress={() => { void a.run(adjustProblem(open.f.allowances, open.f.deductions), async () => { await api.call(`/autoparts/staff/payslips/${open.slip.payslip_id}`, { method: 'PUT', body: adjustBody(open.f.allowances, open.f.deductions, open.f.note) }); setOpen(null); reload(); }); }} />
              <Button title="Cancel" kind="quiet" onPress={() => setOpen(null)} />
            </Card>
          ) : <Msg a={a} />}
          {r.status === 'DRAFT' ? (
            <>
              <Button title="Make it again" kind="quiet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.post('/autoparts/staff/payroll', { month }); reload(); }); }} />
              <Button title="Make it final" busy={a.busy} onPress={() => confirm(t('Make the payroll final?'), t('A final sheet cannot be changed.'), 'Make it final', () => { void a.run('', async () => { await api.post('/autoparts/staff/payroll/finalize', { month }); reload(); }, 'Payroll is final'); })} />
            </>
          ) : <Soft>{t('Payroll is final')}</Soft>}
        </>
      ) : !run.error ? <Loading /> : null}
    </Panel>
  );
};

/* Staff: the people of the workshop and counter, who turned up today, and the monthly payroll sheet. */
export default function WorkshopStaffScreen() {
  const me = currentBusiness(useSession());
  const hr = allowed(me, 'hr'); const pay = allowed(me, 'payroll');
  const [tab, setTab] = useState<'people' | 'attendance' | 'payroll'>('people');
  return (
    <SetupShell title="Staff" sub="People, attendance and payroll for your workshop and counter" ok={canStaff((p) => allowed(me, p))} denied="You do not have access to staff.">
      <Chips items={[{ id: 'people', label: 'People' }, { id: 'attendance', label: 'Attendance' }, ...(pay ? [{ id: 'payroll', label: 'Payroll' }] : [])]} value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab === 'people' ? <PeopleTab key="p" edit={hr} pay={pay} /> : tab === 'attendance' ? <AttendanceTab key="a" edit={hr} /> : <PayrollTab key="y" />}
    </SetupShell>
  );
}
