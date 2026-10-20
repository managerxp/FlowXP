import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, SetupShell, useAct, useList } from '../lib/formKit.tsx';
import { canJobCards, customerProblem, dueLine, emptyJob, jobSub, newJobBody, newJobProblem, vehicleOf, type JobRow, type NewJobForm } from '../lib/jobCards.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, s } from '../lib/ui.tsx';

type Cust = { customer_id: number; name: string; phone: string | null };
type Make = { make_id: number; name: string; models: { model_id: number; name: string }[] };
const TYPES = [{ id: 'CAR', label: 'Car' }, { id: 'BIKE', label: 'Bike' }, { id: 'SCOOTER', label: 'Scooter' }, { id: 'TRUCK', label: 'Truck' }, { id: 'BUS', label: 'Bus' }, { id: 'COMMERCIAL', label: 'Commercial' }, { id: 'OTHER', label: 'Other' }];

/** Find the customer by name or phone, or add a new one on the spot. */
const CustomerFind = ({ form, set }: { form: NewJobForm; set: (patch: Partial<NewJobForm>) => void }) => {
  const [text, setText] = useState(''); const [rows, setRows] = useState<Cust[]>([]);
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const a = useAct();
  useEffect(() => {
    if (text.trim().length < 2) { setRows([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => { void api.get<Cust[]>(`/customers?search=${encodeURIComponent(text.trim())}&limit=6`).then((r) => { if (live && Array.isArray(r)) setRows(r); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  if (form.customer_id) return <Field label="Customer"><Line left={form.customer_name} onPress={() => set({ customer_id: null, customer_name: '' })} sub={t('Change')} /></Field>;
  return (
    <>
      <Field label="Customer"><TextInput style={s.input} value={text} onChangeText={setText} placeholder={t('Customer name or phone')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Customer name or phone')} /></Field>
      {rows.map((c) => <Line key={c.customer_id} left={c.name} sub={c.phone ?? ''} onPress={() => set({ customer_id: c.customer_id, customer_name: c.name })} />)}
      {adding ? (
        <Card>
          <Input label="Name" value={name} onChange={setName} max={120} />
          <Input label="Phone" value={phone} onChange={setPhone} max={15} />
          <Msg a={a} />
          <Button title="Add the customer" busy={a.busy} onPress={() => { void a.run(customerProblem(name, phone), async () => { const c = await api.post<Cust>('/customers', { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) }); set({ customer_id: c.customer_id, customer_name: c.name }); setAdding(false); }, 'Saved'); }} />
        </Card>
      ) : <Button title="New customer" kind="quiet" onPress={() => { setName(text); setAdding(true); }} />}
    </>
  );
};

/* Job cards: vehicles in for service. Open a card, add the parts and labour, move it along, and make the one bill. */
export default function JobCardsScreen() {
  const me = currentBusiness(useSession());
  const ok = canJobCards((p) => allowed(me, p));
  const [tab, setTab] = useState<'jobs' | 'due'>('jobs');
  const [show, setShow] = useState('LIVE');
  const [text, setText] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const timer = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(timer); }, [text]);
  const list = useList<JobRow[]>(tab === 'jobs' ? `/autoparts/jobcards?status=${show}${q ? `&q=${encodeURIComponent(q)}` : ''}` : null);
  const due = useList<{ job_id: number; vehicle_reg: string; make: string | null; model: string | null; next_service_on: string; overdue: boolean; customer_name: string | null }[]>(tab === 'due' ? '/autoparts/jobcards/due?days=30' : null);
  const makes = useList<Make[]>('/autoparts/vehicles');
  const mech = useList<{ employee_id: number; name: string }[]>('/autoparts/jobcards/mechanics');
  const [form, setForm] = useState<NewJobForm | null>(null);
  const a = useAct();
  const set = (patch: Partial<NewJobForm>) => form && setForm({ ...form, ...patch });
  const models = (makes.data ?? []).flatMap((m) => m.models.map((x) => ({ id: String(x.model_id), label: `${m.name} ${x.name}` })));
  return (
    <SetupShell title="Job cards" sub="Vehicles in for service: the parts fitted, the labour and one bill" ok={ok} denied="You do not have access to job cards.">
      <Chips items={[{ id: 'jobs', label: 'Job cards' }, { id: 'due', label: 'Services due' }]} value={tab} onChange={setTab} />
      {tab === 'jobs' ? (
        <>
          <TextInput style={[s.input, { marginHorizontal: 16 }]} value={text} onChangeText={setText} placeholder={t('Job number, registration or customer')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Job number, registration or customer')} />
          <Chips items={[{ id: 'LIVE', label: 'In the workshop' }, { id: 'READY', label: 'Ready' }, { id: 'BILLED', label: 'Billed' }, { id: 'ALL', label: 'All' }]} value={show} onChange={setShow} />
          {list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
            <Panel>
              <Button title="New job card" onPress={() => { a.setError(''); setForm(emptyJob()); }} />
              {list.data.length === 0 ? <><Soft>{t('No job cards here.')}</Soft><Soft>{t('Open a card when a vehicle comes in.')}</Soft></> : null}
              {list.data.map((j) => <Line key={j.job_id} left={`${j.job_no} · ${vehicleOf(j)}`} sub={jobSub(j)} onPress={() => router.push({ pathname: '/job-card/[id]', params: { id: String(j.job_id) } })} />)}
              {form ? (
                <Card>
                  <CustomerFind form={form} set={set} />
                  <Input label="Registration number" upper value={form.vehicle_reg} onChange={(v) => set({ vehicle_reg: v })} max={20} placeholder="KA01AB1234" />
                  <Field label="Vehicle"><Chips items={TYPES} value={form.vehicle_type} onChange={(v) => set({ vehicle_type: v })} /></Field>
                  {models.length ? <Field label="Make and model"><Chips items={[{ id: '', label: t('Not in the list') }, ...models]} value={form.model_id} onChange={(v) => set({ model_id: v })} /></Field> : null}
                  <Input label="Odometer (km)" numeric value={form.odometer_km} onChange={(v) => set({ odometer_km: v })} max={7} />
                  <Input label="What is wrong, or what to do" multiline value={form.complaint} onChange={(v) => set({ complaint: v })} max={2000} placeholder="Brake noise, full service" />
                  {(mech.data ?? []).length ? <Field label="Mechanic"><Chips items={[{ id: '', label: t('Not assigned') }, ...(mech.data ?? []).map((m) => ({ id: String(m.employee_id), label: m.name }))]} value={form.mechanic_id} onChange={(v) => set({ mechanic_id: v })} /></Field> : null}
                  <Input label="Promised for" hint="Like 2026-11-01" value={form.promised_on} onChange={(v) => set({ promised_on: v })} max={10} />
                  <Msg a={a} />
                  <Button title="Open the card" busy={a.busy} onPress={() => { void a.run(newJobProblem(form), async () => { const j = await api.post<{ job_id: number }>('/autoparts/jobcards', newJobBody(form)); setForm(null); list.reload(); router.push({ pathname: '/job-card/[id]', params: { id: String(j.job_id) } }); }); }} />
                  <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
                </Card>
              ) : null}
            </Panel>
          )}
        </>
      ) : (
        due.error && !due.data ? <Failed message={due.error} onRetry={due.reload} /> : !due.data ? <Loading /> : (
          <Panel>
            <SectionTitle>Services due</SectionTitle>
            <Soft>{t('Vehicles whose last job said when the next service is due. Call them.')}</Soft>
            {due.data.length === 0 ? <Soft>{t('No service is due in the next 30 days.')}</Soft> : null}
            {due.data.map((d) => <Line key={d.job_id} left={d.vehicle_reg} sub={dueLine(d)} />)}
          </Panel>
        )
      )}
    </SetupShell>
  );
}
