/*
 * Vehicles: the van register — who drives, which salesperson works it, where it loads from, and what it is carrying now.
 * Opening a van shows its stock and lets you load it, sell from it, count it at the end of the day and send the unsold
 * stock back to the warehouse.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { money, useLoad } from '../../lib/distributor.js';
import { Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, NumberField, Toolbar, useAction } from '../wholesale/parts.jsx';
import { WarehouseSelect } from '../wholesale/parts.jsx';
import { SalespersonSelect } from './parts.jsx';

export const VehicleForm = ({ vehicle, onClose, onSaved }) => {
  const editing = Boolean(vehicle?.vehicle_id);
  const staff = useLoad('/staff').data || [];
  const [f, setF] = useState(() => ({ vehicle_no: vehicle?.vehicle_no || '', branch_id: vehicle?.branch_id ?? '', driver_name: vehicle?.driver_name || '', driver_user_id: vehicle?.driver_user_id ?? '', salesperson_id: vehicle?.salesperson_id ?? '', route: vehicle?.route || '', capacity_kg: vehicle?.capacity_kg ?? '', notes: vehicle?.notes || '', status: vehicle?.status || 'ACTIVE' }));
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const body = { vehicle_no: f.vehicle_no, branch_id: f.branch_id === '' ? undefined : Number(f.branch_id), driver_name: f.driver_name || null, driver_user_id: f.driver_user_id === '' ? null : Number(f.driver_user_id), salesperson_id: f.salesperson_id === '' ? null : f.salesperson_id, route: f.route || null, capacity_kg: f.capacity_kg === '' ? null : Number(f.capacity_kg), notes: f.notes || null, status: f.status };
    const r = await run(() => api(editing ? `/distributor/vehicles/${vehicle.vehicle_id}` : '/distributor/vehicles', { method: editing ? 'PUT' : 'POST', body }), editing ? 'Vehicle saved' : 'Vehicle added');
    if (r) onSaved(r);
  };
  return (
    <Modal title={editing ? `Edit ${vehicle.vehicle_no}` : 'Add a vehicle'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="vf-no" label="Vehicle number"><Input id="vf-no" value={f.vehicle_no} onChange={(e) => setF((x) => ({ ...x, vehicle_no: e.target.value.toUpperCase() }))} autoFocus maxLength={20} placeholder="TS09UB1234" /></Field>
          <WarehouseSelect id="vf-wh" label="Loads from" value={f.branch_id} onChange={(v) => setF((x) => ({ ...x, branch_id: v }))} />
          <Field id="vf-driver" label="Driver"><Input id="vf-driver" value={f.driver_name} onChange={set('driver_name')} maxLength={120} /></Field>
          <Field id="vf-login" label="Driver’s sign-in" hint="Optional"><Select id="vf-login" value={f.driver_user_id} onChange={set('driver_user_id')}><option value="">None</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}</Select></Field>
          <SalespersonSelect id="vf-rep" value={f.salesperson_id} onChange={set('salesperson_id')} label="Salesperson on this van" />
          <NumberField id="vf-cap" label="Capacity" suffix="kg" value={f.capacity_kg} onChange={set('capacity_kg')} />
          <div className="sm:col-span-2"><Field id="vf-route" label="Route"><Input id="vf-route" value={f.route} onChange={set('route')} maxLength={160} placeholder="Ameerpet – SR Nagar – Kukatpally" /></Field></div>
          {editing && <Field id="vf-status" label="Status"><Select id="vf-status" value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.vehicle_no.trim().length < 4}>{editing ? 'Save' : 'Add vehicle'}</Button></div>
      </div>
    </Modal>
  );
};

const Vehicles = () => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('ACTIVE');
  const [adding, setAdding] = useState(false);
  const { data, loading, error } = useLoad(`/distributor/vehicles?status=${status}`);
  return (
    <div>
      <PageHeader title="Vehicle stock" lead="Warehouse → van → retailer. Load a van, sell from it, count what is left at the end of the day." action={can('vehicles') && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add vehicle</Button>} />
      <Toolbar><Chips label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'ALL', label: 'All' }]} /></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Container} emptyLabel="No vehicles" emptyBody="Add the vans that carry stock to your retailers." emptyAction={can('vehicles') ? <Button onClick={() => setAdding(true)}>Add a vehicle</Button> : undefined} />
      {data?.length > 0 && <Table><Thead><Th>Vehicle</Th><Th>Driver</Th><Th>Salesperson</Th><Th>Loads from</Th><Th>Route</Th><Th className="text-right">Items on board</Th><Th className="text-right">Stock value</Th></Thead>
        <tbody>{data.map((v) => <Tr key={v.vehicle_id} onClick={() => navigate(`/app/distributor/vehicles/${v.vehicle_id}`)}><Td className="font-medium text-brand-700">{v.vehicle_no}{v.status === 'INACTIVE' && <Badge tone="warning">Inactive</Badge>}</Td><Td>{v.driver_name || '—'}</Td><Td>{v.salesperson || '—'}</Td><Td className="text-ink-500">{v.warehouse}</Td><Td className="max-w-48 truncate text-ink-500">{v.route || '—'}</Td><Td className="text-right tabular">{v.items}</Td><Td className="text-right tabular">{v.items ? money(v.stock_value) : '—'}</Td></Tr>)}</tbody></Table>}
      {adding && <VehicleForm onClose={() => setAdding(false)} onSaved={(v) => navigate(`/app/distributor/vehicles/${v.vehicle_id}`)} />}
    </div>
  );
};

export default Vehicles;
