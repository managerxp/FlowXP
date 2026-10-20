import { useState } from 'react';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, Row, SetupShell, useAct, useList } from '../lib/formKit.tsx';
import { emptyVehicle, vehicleBody, vehicleForm, vehicleProblem, vehicleSub, type Vehicle, type VehicleForm } from '../lib/distributorSetup.ts';
import { Button, Chips, Failed, Line, Loading, Soft } from '../lib/ui.tsx';

type House = { branch_id: number; name: string };

/* Vans: the register of vehicles, who drives, which salesperson works each, and where it loads from. */
export default function VansScreen() {
  const me = currentBusiness(useSession());
  const edit = allowed(me, 'vehicles');
  const [status, setStatus] = useState('ACTIVE');
  const list = useList<Vehicle[]>(`/distributor/vehicles?status=${status}`);
  const houses = useList<House[]>('/wholesale/warehouses');
  const reps = useList<{ salesperson_id: number; name: string }[]>('/wholesale/salespeople?status=ACTIVE');
  const [form, setForm] = useState<{ id?: number; f: VehicleForm } | null>(null);
  const a = useAct();
  const set = (patch: Partial<VehicleForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  const houseChoices = (houses.data ?? []).map((h) => ({ id: String(h.branch_id), label: h.name }));
  const repChoices = [{ id: '', label: t('Nobody') }, ...(reps.data ?? []).map((r) => ({ id: String(r.salesperson_id), label: r.name }))];
  return (
    <SetupShell title="Vans" sub="The vans that carry stock to your shops" ok={allowed(me, 'vehicles', 'field_sales', 'reports')} denied="You do not have access to vans.">
      <Chips items={[{ id: 'ACTIVE', label: 'Active' }, { id: 'INACTIVE', label: 'Inactive' }, { id: 'ALL', label: 'All' }]} value={status} onChange={setStatus} />
      {list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <Panel>
          {edit ? <Button title="Add a van" onPress={() => { a.setError(''); setForm({ f: emptyVehicle(houses.data?.[0]?.branch_id) }); }} /> : null}
          {list.data.length === 0 ? <Soft>{t('Add the vans that carry stock to your shops.')}</Soft> : null}
          {list.data.map((v) => <Line key={v.vehicle_id} left={v.vehicle_no} sub={vehicleSub(v)} onPress={() => { if (edit) { a.setError(''); setForm({ id: v.vehicle_id, f: vehicleForm(v) }); } }} />)}
          {form ? (
            <Card>
              <Input label="Vehicle number" value={form.f.vehicle_no} onChange={(v) => set({ vehicle_no: v })} max={20} upper placeholder="TS09UB1234" />
              {houseChoices.length > 1 ? <Field label="Loads from"><Chips items={houseChoices} value={form.f.branch_id} onChange={(v) => set({ branch_id: v })} /></Field> : null}
              <Input label="Driver" value={form.f.driver_name} onChange={(v) => set({ driver_name: v })} max={120} />
              <Field label="Salesperson on this van"><Chips items={repChoices} value={form.f.salesperson_id} onChange={(v) => set({ salesperson_id: v })} /></Field>
              <Input label="Capacity (kg)" numeric value={form.f.capacity_kg} onChange={(v) => set({ capacity_kg: v })} max={7} />
              <Input label="Route" value={form.f.route} onChange={(v) => set({ route: v })} max={160} placeholder="Ameerpet, SR Nagar, Kukatpally" />
              {form.id ? <Row label="Active" value={form.f.status === 'ACTIVE'} onChange={(v) => set({ status: v ? 'ACTIVE' : 'INACTIVE' })} /> : null}
              <Soft>{t('Loading a van and counting it at the end of the day is done on the web.')}</Soft>
              <Msg a={a} />
              <Button title="Save" busy={a.busy} onPress={() => { void a.run(vehicleProblem(form.f), async () => { await api.call(form.id ? `/distributor/vehicles/${form.id}` : '/distributor/vehicles', { method: form.id ? 'PUT' : 'POST', body: vehicleBody(form.f, Boolean(form.id)) }); setForm(null); list.reload(); }); }} />
              <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
            </Card>
          ) : null}
        </Panel>
      )}
    </SetupShell>
  );
}
