import { useState } from 'react';
import { View } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Field, Input, Msg, Panel, Row, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import {
  CHILD_LEVEL, LEVEL_LABEL, WEEKDAY_CHOICES, beatBody, beatForm, beatProblem, beatSub, emptyBeat, flattenTerritories, placeBody, placePath, placeProblem, placeSub, type Beat, type BeatForm, type Territory
} from '../lib/distributorSetup.ts';
import { Button, Chips, Failed, Line, Loading, Soft } from '../lib/ui.tsx';

type Rep = { salesperson_id: number; name: string };

const PlacesTab = ({ edit }: { edit: boolean }) => {
  const list = useList<Territory[]>('/distributor/territories');
  const [form, setForm] = useState<{ id?: number; level?: string; parent?: number | null; name: string; code: string; title: string } | null>(null);
  const [open, setOpen] = useState<Territory | null>(null);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const rows = flattenTerritories(list.data);
  return (
    <Panel>
      <Soft>{t('Region, then territory, then area. Shop counts include everything inside.')}</Soft>
      {edit ? <Button title="Add a region" onPress={() => { a.setError(''); setOpen(null); setForm({ level: 'REGION', parent: null, name: '', code: '', title: t('Add a region') }); }} /> : null}
      {rows.length === 0 ? <Soft>{t('Start with a region, say Hyderabad, then add territories and areas inside it.')}</Soft> : null}
      {rows.map(({ place, depth }) => (
        <View key={place.territory_id} style={{ marginLeft: depth * 16 }}><Line left={place.name} sub={placeSub(place)} onPress={() => { setForm(null); a.setError(''); a.setNote(''); setOpen(place); }} /></View>
      ))}
      {open ? (
        <Card>
          <Soft>{placePath(list.data, open.territory_id)}</Soft>
          {edit && CHILD_LEVEL[open.level] ? <Button title={t('Add {what}', { what: t(LEVEL_LABEL[CHILD_LEVEL[open.level] as string]) })} onPress={() => { setForm({ level: CHILD_LEVEL[open.level], parent: open.territory_id, name: '', code: '', title: t('Add {what}', { what: t(LEVEL_LABEL[CHILD_LEVEL[open.level] as string]) }) }); setOpen(null); }} /> : null}
          {edit ? <Button title="Rename" kind="quiet" onPress={() => { setForm({ id: open.territory_id, name: open.name, code: open.code ?? '', title: t('Rename') }); setOpen(null); }} /> : null}
          {edit ? <Button title="Delete" kind="danger" onPress={() => confirm(t('Delete {name}?', { name: open.name }), t('Only an empty one can be deleted. Otherwise mark it inactive.'), 'Delete', () => { void a.run('', async () => { await api.call(`/distributor/territories/${open.territory_id}`, { method: 'DELETE', body: {} }); setOpen(null); list.reload(); }, 'Deleted'); })} /> : null}
          <Msg a={a} />
          <Button title="Close" kind="quiet" onPress={() => setOpen(null)} />
        </Card>
      ) : null}
      {form ? (
        <Card>
          <Soft>{form.title}</Soft>
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} max={120} />
          <Input label="Short code" hint="Optional, for your own reference" value={form.code} onChange={(v) => setForm({ ...form, code: v })} max={20} />
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(placeProblem(form.name), async () => { await api.call(form.id ? `/distributor/territories/${form.id}` : '/distributor/territories', { method: form.id ? 'PUT' : 'POST', body: form.id ? placeBody(form.name, form.code) : placeBody(form.name, form.code, form.level, form.parent) }); setForm(null); list.reload(); }); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

const BeatsTab = ({ edit }: { edit: boolean }) => {
  const [day, setDay] = useState('all');
  const list = useList<Beat[]>(day === 'all' ? '/distributor/beats' : `/distributor/beats?weekday=${day}`);
  const places = useList<Territory[]>('/distributor/territories');
  const reps = useList<Rep[]>('/wholesale/salespeople?status=ACTIVE');
  const [form, setForm] = useState<{ id?: number; f: BeatForm } | null>(null);
  const a = useAct();
  if (list.error && !list.data) return <Failed message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const areaChoices = [{ id: '', label: t('No area') }, ...(places.data ?? []).map((p) => ({ id: String(p.territory_id), label: placePath(places.data ?? [], p.territory_id) }))];
  const repChoices = [{ id: '', label: t('Unassigned') }, ...(reps.data ?? []).map((r) => ({ id: String(r.salesperson_id), label: r.name }))];
  const set = (patch: Partial<BeatForm>) => form && setForm({ ...form, f: { ...form.f, ...patch } });
  return (
    <Panel>
      <Soft>{t("A beat is a salesperson's route on one day: the shops to visit, in order.")}</Soft>
      <Chips items={[{ id: 'all', label: 'Every day' }, ...WEEKDAY_CHOICES.filter((d) => d.id !== '')]} value={day} onChange={setDay} />
      {edit ? <Button title="New beat" onPress={() => { a.setError(''); setForm({ f: emptyBeat() }); }} /> : null}
      {list.data.length === 0 ? <Soft>{t('No beats yet.')}</Soft> : null}
      {list.data.map((b) => <Line key={b.beat_id} left={b.name} sub={beatSub(b)} onPress={() => { if (edit) { a.setError(''); setForm({ id: b.beat_id, f: beatForm(b) }); } }} />)}
      {form ? (
        <Card>
          <Input label="Beat name" value={form.f.name} onChange={(v) => set({ name: v })} max={120} placeholder="Monday, Ameerpet" />
          <Field label="Day of the week"><Chips items={WEEKDAY_CHOICES} value={form.f.weekday} onChange={(v) => set({ weekday: v })} /></Field>
          <Field label="Area it covers"><Chips items={areaChoices} value={form.f.territory_id} onChange={(v) => set({ territory_id: v })} /></Field>
          <Field label="Salesperson"><Chips items={repChoices} value={form.f.salesperson_id} onChange={(v) => set({ salesperson_id: v })} /></Field>
          {form.id ? <Row label="Active" value={form.f.status === 'ACTIVE'} onChange={(v) => set({ status: v ? 'ACTIVE' : 'INACTIVE' })} /> : null}
          <Soft>{t('The shops on a beat, and their order, are set on the web. A beat you edit here keeps its shops.')}</Soft>
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(beatProblem(form.f), async () => { await api.call(form.id ? `/distributor/beats/${form.id}` : '/distributor/beats', { method: form.id ? 'PUT' : 'POST', body: beatBody(form.f, Boolean(form.id)) }); setForm(null); list.reload(); }); }} />
          <Button title="Cancel" kind="quiet" onPress={() => setForm(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

/* Areas and routes: where the shops are (regions, territories, areas) and the beats the salespeople walk. */
export default function AreasScreen() {
  const me = currentBusiness(useSession());
  const [tab, setTab] = useState<'places' | 'beats'>('places');
  return (
    <SetupShell title="Areas and routes" sub="Where your shops are, and the routes your salespeople walk" ok={allowed(me, 'territories', 'field_sales', 'reports')} denied="You do not have access to areas and routes.">
      <Chips items={[{ id: 'places', label: 'Areas' }, { id: 'beats', label: 'Beats' }]} value={tab} onChange={setTab} />
      {tab === 'places' ? <PlacesTab key="p" edit={allowed(me, 'territories')} /> : <BeatsTab key="b" edit={allowed(me, 'territories')} />}
    </SetupShell>
  );
}
