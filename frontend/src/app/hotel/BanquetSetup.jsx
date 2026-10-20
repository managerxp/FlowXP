/* Banquet set-up: the halls (capacity and rent for one function) and the menu packages (price a plate). Used as a tab of Hotel set-up. */
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { DIETS, useLoad } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const dietName = (c) => DIETS.find(([k]) => k === c)?.[1] || c;

const HallForm = ({ initial, onClose, onSaved }) => {
  const tr = useT();
  const edit = Boolean(initial.hall_id);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: initial.name || '', capacity_seated: initial.capacity_seated ?? '', capacity_floating: initial.capacity_floating ?? '', rent: initial.rent ?? '', amenities: (initial.amenities || []).join(', ') });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = { name: f.name, capacity_seated: Number(f.capacity_seated) || 0, capacity_floating: Number(f.capacity_floating) || 0, rent: Number(f.rent) || 0, amenities: f.amenities.split(',').map((a) => a.trim()).filter(Boolean) };
    const out = await run(() => api(edit ? `/hotel/banquet/halls/${initial.hall_id}` : '/hotel/banquet/halls', { method: edit ? 'PUT' : 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onSaved();
  };
  return (
    <Modal title={edit ? `Edit ${initial.name}` : tr('Add a hall')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <Field id="hl-n" label={tr('Name')}><Input id="hl-n" value={f.name} onChange={set('name')} required autoFocus placeholder={tr('Grand Ballroom, Sea Lawn…')} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="hl-s" label={tr('Seated')}><Input id="hl-s" type="number" min="0" value={f.capacity_seated} onChange={set('capacity_seated')} /></Field>
          <Field id="hl-f" label={tr('Standing')}><Input id="hl-f" type="number" min="0" value={f.capacity_floating} onChange={set('capacity_floating')} /></Field>
          <Field id="hl-r" label={tr('Rent a function')} hint={tr('Before GST')}><Input id="hl-r" type="number" min="0" step="any" value={f.rent} onChange={set('rent')} /></Field>
        </div>
        <Field id="hl-a" label={tr('What the hall has')} hint={tr('Separate with commas')}><Input id="hl-a" value={f.amenities} onChange={set('amenities')} placeholder={tr('Stage, air conditioning, projector, parking')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  );
};

const PackageForm = ({ initial, onClose, onSaved }) => {
  const tr = useT();
  const edit = Boolean(initial.package_id);
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: initial.name || '', diet: initial.diet || 'VEG', per_plate: initial.per_plate_paise != null ? String(Number(initial.per_plate_paise) / 100) : '', min_guests: initial.min_guests ?? '', tax_rate: initial.tax_rate != null ? Number(initial.tax_rate) : 18, menu: initial.menu || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(edit ? `/hotel/banquet/packages/${initial.package_id}` : '/hotel/banquet/packages', { method: edit ? 'PUT' : 'POST', body: { name: f.name, diet: f.diet, per_plate: Number(f.per_plate), min_guests: Number(f.min_guests) || 0, tax_rate: Number(f.tax_rate), menu: f.menu || undefined } }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onSaved();
  };
  return (
    <Modal title={edit ? `Edit ${initial.name}` : tr('Add a menu package')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pk-n" label={tr('Name')}><Input id="pk-n" value={f.name} onChange={set('name')} required autoFocus placeholder={tr('Classic veg, Royal non-veg…')} /></Field>
          <Field id="pk-d" label={tr('Diet')}><Select id="pk-d" value={f.diet} onChange={set('diet')}>{DIETS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
          <Field id="pk-p" label={tr('Price a plate')} hint={tr('Before GST')}><Input id="pk-p" type="number" min="0" step="any" value={f.per_plate} onChange={set('per_plate')} required /></Field>
          <Field id="pk-m" label={tr('Fewest guests charged')}><Input id="pk-m" type="number" min="0" value={f.min_guests} onChange={set('min_guests')} /></Field>
          <Field id="pk-t" label={tr('GST %')} hint={tr('Check the rate for catering with your accountant')}><Input id="pk-t" type="number" min="0" max="100" step="any" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
        </div>
        <Field id="pk-menu" label={tr('Menu')}><Textarea id="pk-menu" rows={4} value={f.menu} onChange={set('menu')} placeholder={tr('Welcome drink, two starters, three mains, rice, breads, dessert')} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  );
};

export default function BanquetSetup() {
  const tr = useT();
  const dialog = useDialog();
  const toast = useToast();
  const halls = useLoad('/hotel/banquet/halls');
  const packages = useLoad('/hotel/banquet/packages');
  const [hall, setHall] = useState(null);
  const [pkg, setPkg] = useState(null);
  const reload = () => { halls.reload(); packages.reload(); };
  const remove = async (kind, row) => {
    if (!(await dialog.confirm({ title: `Remove ${row.name}?`, body: kind === 'halls' ? 'It cannot be removed while events are booked in it.' : 'Events already booked keep their price.', confirmLabel: tr('Remove'), danger: true }))) return;
    try { await api(`/hotel/banquet/${kind}/${row.hall_id || row.package_id}`, { method: 'DELETE' }); toast.success(tr('Removed')); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="space-y-8">
      <Panel title={tr('Banquet halls')} lead={tr('Each hall has its capacity and the rent for one function.')} action={<Button size="sm" onClick={() => setHall({})}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add a hall')}</Button>}>
        <ListState loading={halls.loading && !halls.data} error={halls.error} empty={!halls.loading && !(halls.data || []).length} emptyLabel={tr('No banquet halls yet.')} />
        {(halls.data || []).length > 0 && <Table><Thead><Th>{tr('Hall')}</Th><Th className="text-right">{tr('Seated')}</Th><Th className="text-right">{tr('Standing')}</Th><Th className="text-right">{tr('Rent a function')}</Th><Th>{tr('Has')}</Th><Th></Th></Thead>
          <tbody>{halls.data.map((h) => <Tr key={h.hall_id}><Td className="font-medium text-ink-900">{h.name}</Td><Td className="tabular text-right">{h.capacity_seated || '—'}</Td><Td className="tabular text-right">{h.capacity_floating || '—'}</Td><Td className="tabular text-right">{formatCurrency(h.rent)}</Td><Td className="text-ink-500">{(h.amenities || []).join(', ') || '—'}</Td>
            <Td className="text-right"><button type="button" aria-label={tr('Edit {{h_name}}', { h_name: h.name })} onClick={() => setHall(h)} className="mr-3 text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="inline h-4 w-4" /></button><button type="button" aria-label={tr('Remove {{h_name}}', { h_name: h.name })} onClick={() => remove('halls', h)} className="text-ink-500 hover:text-danger"><Trash2 aria-hidden="true" className="inline h-4 w-4" /></button></Td></Tr>)}</tbody></Table>}
      </Panel>
      <Panel title={tr('Menu packages')} lead={tr('A package is a menu with a price a plate. Pick one when you plan a function and the food is charged for the guaranteed guests.')} action={<Button size="sm" onClick={() => setPkg({})}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add a package')}</Button>}>
        <ListState loading={packages.loading && !packages.data} error={packages.error} empty={!packages.loading && !(packages.data || []).length} emptyLabel={tr('No packages yet.')} />
        {(packages.data || []).length > 0 && <Table><Thead><Th>{tr('Package')}</Th><Th>{tr('Diet')}</Th><Th className="text-right">{tr('Price a plate')}</Th><Th className="text-right">{tr('Fewest guests')}</Th><Th className="text-right">{tr('GST')}</Th><Th></Th></Thead>
          <tbody>{packages.data.map((p) => <Tr key={p.package_id}><Td className="font-medium text-ink-900">{p.name}{p.menu && <span className="block text-caption font-normal text-ink-500">{p.menu.slice(0, 70)}{p.menu.length > 70 ? '…' : ''}</span>}</Td><Td><Badge>{dietName(p.diet)}</Badge></Td><Td className="tabular text-right">{formatCurrency(Number(p.per_plate_paise) / 100)}</Td><Td className="tabular text-right">{p.min_guests || '—'}</Td><Td className="tabular text-right">{Number(p.tax_rate)}%</Td>
            <Td className="text-right"><button type="button" aria-label={tr('Edit {{p_name}}', { p_name: p.name })} onClick={() => setPkg(p)} className="mr-3 text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="inline h-4 w-4" /></button><button type="button" aria-label={tr('Remove {{p_name}}', { p_name: p.name })} onClick={() => remove('packages', p)} className="text-ink-500 hover:text-danger"><Trash2 aria-hidden="true" className="inline h-4 w-4" /></button></Td></Tr>)}</tbody></Table>}
      </Panel>
      {hall && <HallForm initial={hall} onClose={() => setHall(null)} onSaved={() => { setHall(null); reload(); }} />}
      {pkg && <PackageForm initial={pkg} onClose={() => setPkg(null)} onSaved={() => { setPkg(null); reload(); }} />}
    </div>
  );
}
