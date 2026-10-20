import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, Row, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import {
  CLASS_CHOICES, NUMBER_KIND_CHOICES, VEHICLE_TYPE_CHOICES, emptyPart, emptyPlace, fitBody, fitLine, fitProblem, makeLine, makeProblem, modelLine, modelProblem, newPartBody, newPartProblem, numberLine, numberProblem, partLine, placeBody, placeLine, placeProblem,
  profileBody, profileForm, profileProblem, sortPlaces, type NewPart, type PartFull, type Place, type PlaceForm, type ProfileForm, type VMake
} from '../lib/partsAdmin.ts';
import { type PartRow } from '../lib/parts.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, s } from '../lib/ui.tsx';

const tr = (items: { id: string; label: string }[]) => items.map((x) => ({ id: x.id, label: t(x.label) }));

/** One part: its details, part numbers, and the vehicles it fits. */
const PartCard = ({ id, edit, onClose, onChanged }: { id: number; edit: boolean; onClose: () => void; onChanged: () => void }) => {
  const part = useList<PartFull>(`/autoparts/parts/${id}`);
  const veh = useList<VMake[]>('/autoparts/vehicles');
  const [pf, setPf] = useState<ProfileForm | null>(null);
  const [num, setNum] = useState(''); const [kind, setKind] = useState('ALTERNATE');
  const [model, setModel] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const a = useAct();
  useEffect(() => { if (part.data) setPf(profileForm(part.data)); }, [part.data]);
  const p = part.data;
  if (!p || !pf) return part.error ? <Failed message={part.error} onRetry={part.reload} /> : <Loading />;
  const reload = () => { part.reload(); onChanged(); };
  const setP = (patch: Partial<ProfileForm>) => setPf({ ...pf, ...patch });
  const models = (veh.data ?? []).flatMap((mk) => mk.models.map((m) => ({ id: String(m.model_id), label: `${mk.name} ${m.name}` })));
  const mrp = p.mrp_paise == null ? null : p.mrp_paise / 100;
  return (
    <Card>
      <SectionTitle>{p.name}</SectionTitle>
      <Soft>{partLine(p)}</Soft>
      {!p.has_profile ? <Soft>{t('No part details')}</Soft> : null}
      <SectionTitle>Part details</SectionTitle>
      <Field label="Type of part"><Chips items={tr(CLASS_CHOICES)} value={pf.classification} onChange={(v) => setP({ classification: v })} /></Field>
      <Field label="For"><Chips items={tr(VEHICLE_TYPE_CHOICES)} value={pf.vehicle_type} onChange={(v) => setP({ vehicle_type: v })} /></Field>
      <Input label="OEM part number" value={pf.oem_part_no} onChange={(v) => setP({ oem_part_no: v })} max={64} />
      <Input label="Manufacturer part number" value={pf.mfr_part_no} onChange={(v) => setP({ mfr_part_no: v })} max={64} />
      <Input label="Subcategory" value={pf.subcategory} onChange={(v) => setP({ subcategory: v })} max={80} />
      <Input label="Pack holds" numeric value={pf.pack_qty} onChange={(v) => setP({ pack_qty: v })} max={8} />
      <Input label="Reorder level" numeric value={pf.reorder_level} onChange={(v) => setP({ reorder_level: v })} max={9} />
      <Input label="Most to keep" numeric value={pf.max_stock} onChange={(v) => setP({ max_stock: v })} max={9} />
      <Input label="Trade price" numeric value={pf.wholesale_price} onChange={(v) => setP({ wholesale_price: v })} max={9} />
      <Input label="Handling" value={pf.handling} onChange={(v) => setP({ handling: v })} max={200} />
      {edit ? <Button title={p.has_profile ? 'Save details' : 'Add the part details'} busy={a.busy} onPress={() => { void a.run(profileProblem(pf, mrp), async () => { await api.call(`/autoparts/parts/${p.product_id}/profile`, { method: 'PUT', body: profileBody(pf) }); reload(); }); }} /> : null}

      <SectionTitle>Part numbers</SectionTitle>
      <Soft>{t('Every number this part is known by. Typing any of them, with or without dashes, finds the part.')}</Soft>
      {p.numbers.length === 0 ? <Soft>{t('No part numbers yet.')}</Soft> : null}
      {p.numbers.map((n) => <Line key={n.pn_id} left={numberLine(n)} onPress={() => { if (edit) confirm(t('Remove {name}?', { name: n.number }), '', 'Remove', () => { void a.run('', async () => { await api.call(`/autoparts/parts/${p.product_id}/numbers/${n.pn_id}`, { method: 'DELETE', body: {} }); reload(); }, 'Removed'); }); }} />)}
      {edit ? (
        <>
          <Input label="Add a number" value={num} onChange={setNum} max={64} />
          <Field label="Kind"><Chips items={tr(NUMBER_KIND_CHOICES)} value={kind} onChange={setKind} /></Field>
          <Button title="Add" kind="quiet" busy={a.busy} onPress={() => { void a.run(numberProblem(num), async () => { await api.post(`/autoparts/parts/${p.product_id}/numbers`, { number: num.trim(), kind }); setNum(''); reload(); }, 'Number added'); }} />
        </>
      ) : null}

      <SectionTitle>Vehicles it fits</SectionTitle>
      <Soft>{t('Only what is recorded here counts. A part with no record is never assumed to fit.')}</Soft>
      {p.fitment.length === 0 ? <Soft>{t('No vehicles recorded for this part.')}</Soft> : null}
      {p.fitment.map((f) => (
        <Card key={f.fit_id}>
          <Soft>{fitLine(f)}</Soft>
          {edit ? (
            <>
              {f.status !== 'VERIFIED' ? <Button title="Verify" kind="quiet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.call(`/autoparts/fitment/${f.fit_id}`, { method: 'PUT', body: { status: 'VERIFIED' } }); reload(); }); }} /> : null}
              {f.status !== 'NOT_FIT' ? <Button title="Does not fit" kind="quiet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.call(`/autoparts/fitment/${f.fit_id}`, { method: 'PUT', body: { status: 'NOT_FIT' } }); reload(); }); }} /> : null}
              <Button title="Remove" kind="quiet" busy={a.busy} onPress={() => { void a.run('', async () => { await api.call(`/autoparts/fitment/${f.fit_id}`, { method: 'DELETE', body: {} }); reload(); }, 'Removed'); }} />
            </>
          ) : null}
        </Card>
      ))}
      {edit ? (
        <>
          <Field label="Model"><Chips items={[{ id: '', label: t('Choose a model') }, ...models]} value={model} onChange={setModel} /></Field>
          <Input label="From year" numeric value={from} onChange={setFrom} max={4} />
          <Input label="To year" numeric value={to} onChange={setTo} max={4} />
          <Button title="Add as not verified" kind="quiet" busy={a.busy} onPress={() => { void a.run(fitProblem(model, from, to), async () => { await api.post(`/autoparts/parts/${p.product_id}/fitment`, fitBody(model, from, to)); setModel(''); setFrom(''); setTo(''); reload(); }, 'Added as not verified'); }} />
        </>
      ) : null}
      <Msg a={a} />
      <Button title="Close" kind="quiet" onPress={onClose} />
    </Card>
  );
};

const PartsTab = ({ edit }: { edit: boolean }) => {
  const [text, setText] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const timer = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(timer); }, [text]);
  const list = useList<(PartRow & { has_profile?: boolean; stock?: number })[]>(`/autoparts/parts?limit=40${q ? `&search=${encodeURIComponent(q)}` : ''}`);
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState<NewPart | null>(null);
  const a = useAct();
  const set = (patch: Partial<NewPart>) => form && setForm({ ...form, ...patch });
  return (
    <>
      <TextInput style={[s.input, { marginHorizontal: 16 }]} value={text} onChangeText={setText} placeholder={t('Name, code or part number')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Name, code or part number')} />
      {list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <Panel>
          {edit ? <Button title="Add a part" onPress={() => { a.setError(''); setOpen(null); setForm(emptyPart()); }} /> : null}
          {list.data.map((p) => <Line key={p.product_id} left={p.name} sub={partLine({ ...p, selling_price_paise: p.selling_price_paise })} onPress={() => { setForm(null); setOpen(p.product_id); }} />)}
          {open ? <PartCard key={open} id={open} edit={edit} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
          {form ? (
            <Card>
              <Input label="Name" value={form.name} onChange={(v) => set({ name: v })} max={160} placeholder="Front brake pad set, Swift 1.2" />
              <Input label="Item code" hint="Left blank, one is made for you" value={form.sku} onChange={(v) => set({ sku: v })} max={64} />
              <Input label="Barcode" value={form.barcode} onChange={(v) => set({ barcode: v })} max={64} />
              <Input label="HSN code" value={form.hsn_sac} onChange={(v) => set({ hsn_sac: v })} max={16} />
              <Input label="OEM part number" value={form.oem_part_no} onChange={(v) => set({ oem_part_no: v })} max={64} />
              <Input label="Manufacturer part number" value={form.mfr_part_no} onChange={(v) => set({ mfr_part_no: v })} max={64} />
              <Field label="Type of part"><Chips items={tr(CLASS_CHOICES)} value={form.classification} onChange={(v) => set({ classification: v })} /></Field>
              <Field label="For"><Chips items={tr(VEHICLE_TYPE_CHOICES)} value={form.vehicle_type} onChange={(v) => set({ vehicle_type: v })} /></Field>
              <Input label="Selling price" numeric value={form.selling_price} onChange={(v) => set({ selling_price: v })} max={9} />
              <Input label="Buying price" numeric value={form.purchase_price} onChange={(v) => set({ purchase_price: v })} max={9} />
              <Input label="MRP" numeric value={form.mrp} onChange={(v) => set({ mrp: v })} max={9} />
              <Input label="GST (%)" numeric value={form.tax_rate} onChange={(v) => set({ tax_rate: v })} max={5} />
              <Input label="Reorder level" numeric value={form.reorder_level} onChange={(v) => set({ reorder_level: v })} max={9} />
              <Input label="Opening stock" hint="Counted into the outlet you are in" numeric value={form.opening_stock} onChange={(v) => set({ opening_stock: v })} max={9} />
              <Msg a={a} />
              <Button title="Save" busy={a.busy} onPress={() => { void a.run(newPartProblem(form), async () => { const made = await api.post<{ product_id: number }>('/autoparts/parts', newPartBody(form)); setForm(null); list.reload(); setOpen(made.product_id); }, 'Part added'); }} />
              <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
            </Card>
          ) : null}
        </Panel>
      )}
    </>
  );
};

const VehiclesTab = ({ edit }: { edit: boolean }) => {
  const list = useList<VMake[]>('/autoparts/vehicles');
  const [make, setMake] = useState(''); const [type, setType] = useState('CAR');
  const [of, setOf] = useState(''); const [model, setModel] = useState('');
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  return (
    <Panel>
      {edit ? (
        <>
          <SectionTitle>Add a make</SectionTitle>
          <Input label="Make" value={make} onChange={setMake} max={60} placeholder="Maruti Suzuki" />
          <Field label="For"><Chips items={tr(VEHICLE_TYPE_CHOICES)} value={type} onChange={setType} /></Field>
          <Button title="Add a make" busy={a.busy} onPress={() => { void a.run(makeProblem(make), async () => { await api.post('/autoparts/vehicles/makes', { name: make.trim(), vehicle_type: type }); setMake(''); list.reload(); }, 'Make added'); }} />
          <SectionTitle>Add a model</SectionTitle>
          <Field label="Make"><Chips items={list.data.map((m) => ({ id: String(m.make_id), label: m.name }))} value={of} onChange={setOf} /></Field>
          <Input label="New model" value={model} onChange={setModel} max={80} placeholder="Swift" />
          <Button title="Add a model" busy={a.busy} onPress={() => { void a.run(modelProblem(of, model), async () => { await api.post('/autoparts/vehicles/models', { make_id: Number(of), name: model.trim() }); setModel(''); list.reload(); }, 'Model added'); }} />
          <Msg a={a} />
        </>
      ) : null}
      {list.data.length === 0 ? <Soft>{t('No vehicles yet. Add a make first.')}</Soft> : null}
      {list.data.map((m) => (
        <Card key={m.make_id}>
          <SectionTitle>{m.name}</SectionTitle>
          <Soft>{makeLine(m)}</Soft>
          {m.models.map((x) => <Line key={x.model_id} left={x.name} sub={modelLine(x)} />)}
        </Card>
      ))}
    </Panel>
  );
};

const RacksTab = ({ edit }: { edit: boolean }) => {
  const list = useList<Place[]>('/autoparts/locations');
  const [form, setForm] = useState<PlaceForm | null>(null);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const places = sortPlaces(list.data);
  const groups = [{ id: '', label: t('Top level') }, ...places.filter((p) => !p.can_store && p.is_active).map((p) => ({ id: String(p.location_id), label: p.code }))];
  const set = (patch: Partial<PlaceForm>) => form && setForm({ ...form, ...patch });
  return (
    <Panel>
      {edit ? <Button title="Add a place" onPress={() => { a.setError(''); setForm(emptyPlace()); }} /> : null}
      {places.length === 0 ? <Soft>{t('No places yet.')}</Soft> : null}
      {places.map((p) => (
        <Line key={p.location_id} left={p.code} sub={placeLine(p)} onPress={() => { if (edit && p.is_active) confirm(t('Switch off {name}?', { name: p.code }), '', 'Switch off', () => { void a.run('', async () => { await api.call(`/autoparts/locations/${p.location_id}`, { method: 'PUT', body: { is_active: false } }); list.reload(); }, 'Switched off'); }); }} />
      ))}
      {form ? (
        <Card>
          <Field label="Inside"><Chips items={groups} value={form.parent} onChange={(v) => { const lv = places.find((p) => String(p.location_id) === v)?.level ?? 0; set({ parent: v, can_store: lv + 1 >= 4 }); }} /></Field>
          <Row label="Add several at once" hint="R01, R02, R03 ... or A, B, C ..." value={form.bulk} onChange={(v) => set({ bulk: v })} />
          {form.bulk ? (
            <>
              <Input label="Starts with" upper value={form.prefix} onChange={(v) => set({ prefix: v })} max={12} placeholder="R" />
              <Input label="How many" numeric value={form.count} onChange={(v) => set({ count: v })} max={3} />
              <Row label="Use letters" value={form.letters} onChange={(v) => set({ letters: v })} />
            </>
          ) : (
            <>
              <Input label="Code" hint="Short, like R12 or B07. The full code is built from the places above it." upper value={form.segment} onChange={(v) => set({ segment: v })} max={20} />
              <Input label="Name (optional)" value={form.name} onChange={(v) => set({ name: v })} max={80} />
            </>
          )}
          <Row label="Stock is kept here" hint="Bins and shelves hold stock. Warehouses, zones, aisles and racks only group other places." value={form.can_store} onChange={(v) => set({ can_store: v })} />
          {form.can_store ? <Input label="Most units it should hold (optional)" numeric value={form.capacity} onChange={(v) => set({ capacity: v })} max={9} /> : null}
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(placeProblem(form), async () => { await api.call(form.bulk ? '/autoparts/locations/bulk' : '/autoparts/locations', { method: 'POST', body: placeBody(form) }); setForm(null); list.reload(); }, 'Place added'); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : <Msg a={a} />}
    </Panel>
  );
};

/* Manage parts: the catalogue (add a part, its details, numbers and vehicles), the makes and models, and the racks. */
export default function PartsManageScreen() {
  const me = currentBusiness(useSession());
  const [tab, setTab] = useState<'parts' | 'vehicles' | 'racks'>('parts');
  const cat = allowed(me, 'parts_catalog'); const wh = allowed(me, 'warehouse');
  return (
    <SetupShell title="Manage parts" sub="Add parts, their numbers and vehicles, the makes and models, and the racks" ok={cat || wh} denied="You do not have access to manage parts.">
      <Chips items={[{ id: 'parts', label: 'Parts' }, { id: 'vehicles', label: 'Vehicles' }, { id: 'racks', label: 'Racks' }]} value={tab} onChange={setTab} />
      {tab === 'parts' ? <PartsTab key="p" edit={cat} /> : tab === 'vehicles' ? <VehiclesTab key="v" edit={cat} /> : <RacksTab key="r" edit={wh} />}
    </SetupShell>
  );
}
