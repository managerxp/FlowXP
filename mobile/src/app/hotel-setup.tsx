import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import {
  DIETS, MEAL_PLANS, blockBody, blockLine, blockProblem, bulkBody, bulkCount, bulkProblem, bulkText, canHotelSetup, emptyBlock, emptyBulk, emptyHall, emptyPackage, emptyPlan, emptySeason, emptyType, hallBody, hallForm, hallProblem, hallSub, packageBody, packageForm, packageProblem, packageSub,
  planBody, planForm, planProblem, planSub, roomBody, roomProblem, roomSub, seasonBody, seasonLine, seasonProblem, settingsBody, settingsForm, settingsProblem, typeBody, typeForm, typeProblem, typeSub,
  type Block, type BlockForm, type BulkForm, type Hall, type HallForm, type HotelSettings, type Package, type PackageForm, type PlanForm, type RatePlan, type Room, type RoomForm, type RoomType, type Season, type SeasonForm, type SettingsForm, type TypeForm
} from '../lib/hotelSetup.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>{children}{hint ? <Soft>{t(hint)}</Soft> : null}</View>
);
const Input = ({ label, value, onChange, hint, numeric, max, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; hint?: string; numeric?: boolean; max?: number; placeholder?: string; multiline?: boolean }) => (
  <Field label={label} hint={hint}>
    <TextInput style={[s.input, multiline ? { minHeight: 80, textAlignVertical: 'top', paddingTop: 12 } : null]} multiline={multiline} value={value} onChangeText={(v) => onChange(numeric ? v.replace(/[^\d.]/g, '') : v)} keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={max} placeholder={placeholder ? t(placeholder) : undefined} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
  </Field>
);
const Row = ({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(label)}</Text>{hint ? <Soft>{t(hint)}</Soft> : null}</View><Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} /></View>
);
const Panel = ({ children }: { children: React.ReactNode }) => <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
const Card = ({ children }: { children: React.ReactNode }) => <View style={[s.card, { gap: 10 }]}>{children}</View>;

/** Load one list from the server and keep it fresh. */
function useList<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { api.get<T>(path).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
/** Run a save/remove: report the result, never throw. */
const useAct = () => {
  const [error, setError] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (problem: string, job: () => Promise<unknown>, done = 'Saved') => {
    if (problem) { setError(t(problem)); setNote(''); return false; }
    setBusy(true); setError(''); setNote('');
    try { await job(); setNote(t(done)); return true; } catch (e) { setError(why(e)); return false; } finally { setBusy(false); }
  };
  return { error, note, busy, run, setError, setNote };
};
const Msg = ({ a }: { a: { error: string; note: string } }) => <><ErrorText>{a.error}</ErrorText>{a.note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{a.note}</Text> : null}</>;
const confirm = (title: string, body: string, ok: string, go: () => void, danger = true) => Alert.alert(title, body, [{ text: t('Cancel'), style: 'cancel' }, { text: t(ok), style: danger ? 'destructive' : 'default', onPress: go }]);

/* ── rooms ───────────────────────────────────────────────────────────────── */
const RoomsTab = () => {
  const types = useList<RoomType[]>('/hotel/room-types');
  const rooms = useList<Room[]>('/hotel/rooms?all=1');
  const [tf, setTf] = useState<{ id?: number; f: TypeForm } | null>(null);
  const [bulk, setBulk] = useState<BulkForm | null>(null);
  const [one, setOne] = useState<{ id?: number; active?: boolean; f: RoomForm } | null>(null);
  const a = useAct();
  const reload = () => { types.reload(); rooms.reload(); };
  if (types.error && !types.data) return <Failed message={types.error} onRetry={reload} />;
  if (!types.data || !rooms.data) return <Loading />;
  const typeList = types.data;
  const chips = typeList.map((x) => ({ id: String(x.room_type_id), label: x.name }));
  return (
    <Panel>
      <SectionTitle>Room types</SectionTitle>
      <Soft>{t('Each type has its own rack rate and how many people it takes.')}</Soft>
      <Button title="Add a type" onPress={() => { a.setError(''); setTf({ f: emptyType() }); }} />
      {typeList.length === 0 ? <Soft>{t('Add your first room type, such as Deluxe or Standard.')}</Soft> : null}
      {typeList.map((x) => <Line key={x.room_type_id} left={`${x.name} · ${x.code}`} sub={typeSub(x)} onPress={() => { a.setError(''); setTf({ id: x.room_type_id, f: typeForm(x) }); }} />)}
      {tf ? (
        <Card>
          <Input label="Name" value={tf.f.name} onChange={(v) => setTf({ ...tf, f: { ...tf.f, name: v } })} max={60} placeholder="Deluxe, Sea view, Dormitory…" />
          <Input label="Short code" hint="Shown on the calendar" value={tf.f.code} onChange={(v) => setTf({ ...tf, f: { ...tf.f, code: v.toUpperCase() } })} max={12} />
          <Input label="Rack rate a night" hint="Before GST" numeric value={tf.f.base_rate} onChange={(v) => setTf({ ...tf, f: { ...tf.f, base_rate: v } })} max={9} />
          <Input label="Adults the rate includes" numeric value={tf.f.base_adults} onChange={(v) => setTf({ ...tf, f: { ...tf.f, base_adults: v } })} max={2} />
          <Input label="Most adults" numeric value={tf.f.max_adults} onChange={(v) => setTf({ ...tf, f: { ...tf.f, max_adults: v } })} max={2} />
          <Input label="Most children" numeric value={tf.f.max_children} onChange={(v) => setTf({ ...tf, f: { ...tf.f, max_children: v } })} max={2} />
          <Input label="Each extra adult, a night" numeric value={tf.f.extra_adult} onChange={(v) => setTf({ ...tf, f: { ...tf.f, extra_adult: v } })} max={9} />
          <Input label="Each child, a night" numeric value={tf.f.extra_child} onChange={(v) => setTf({ ...tf, f: { ...tf.f, extra_child: v } })} max={9} />
          <Input label="What is in the room" hint="Separate with commas" value={tf.f.amenities} onChange={(v) => setTf({ ...tf, f: { ...tf.f, amenities: v } })} placeholder="Air conditioning, TV, sea view, breakfast" />
          <Input label="Description" multiline value={tf.f.description} onChange={(v) => setTf({ ...tf, f: { ...tf.f, description: v } })} max={300} />
          <Msg a={a} />
          <Button title="Save" onPress={() => { void a.run(typeProblem(tf.f), async () => { await api.call(tf.id ? `/hotel/room-types/${tf.id}` : '/hotel/room-types', { method: tf.id ? 'PUT' : 'POST', body: typeBody(tf.f) }); setTf(null); reload(); }); }} busy={a.busy} />
          {tf.id ? <Button title="Remove" kind="danger" onPress={() => confirm(t('Remove {name}?', { name: tf.f.name }), t('It disappears from new bookings. Past bookings keep it.'), 'Remove', () => { void a.run('', async () => { await api.call(`/hotel/room-types/${tf.id}`, { method: 'DELETE', body: {} }); setTf(null); reload(); }, 'Removed'); })} /> : null}
          <Button title="Cancel" kind="quiet" onPress={() => setTf(null)} />
        </Card>
      ) : null}

      <SectionTitle>Rooms</SectionTitle>
      <Soft>{t('The rooms you can sell.')}</Soft>
      {typeList.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Add many" kind="quiet" onPress={() => { a.setError(''); setBulk(emptyBulk(typeList[0]?.room_type_id)); }} /></View>
          <View style={{ flex: 1 }}><Button title="Add a room" onPress={() => { a.setError(''); setOne({ f: { room_no: '', floor: '', room_type_id: String(typeList[0].room_type_id) } }); }} /></View>
        </View>
      ) : null}
      {rooms.data.length === 0 ? <Soft>{t('No rooms yet. Add many at once, for example 101 to 110.')}</Soft> : null}
      {rooms.data.map((r) => <View key={r.room_id} style={{ opacity: r.is_active ? 1 : 0.5 }}><Line left={r.room_no} sub={roomSub(r)} onPress={() => { a.setError(''); setOne({ id: r.room_id, active: r.is_active, f: { room_no: r.room_no, floor: r.floor ?? '', room_type_id: String(r.room_type_id) } }); }} /></View>)}
      {bulk ? (
        <Card>
          <Field label="Room type"><Chips items={chips} value={bulk.room_type_id} onChange={(v) => setBulk({ ...bulk, room_type_id: v })} /></Field>
          <Input label="First number" numeric value={bulk.from} onChange={(v) => setBulk({ ...bulk, from: v })} max={5} />
          <Input label="Last number" numeric value={bulk.to} onChange={(v) => setBulk({ ...bulk, to: v })} max={5} />
          <Input label="Floor" value={bulk.floor} onChange={(v) => setBulk({ ...bulk, floor: v })} max={10} />
          <Input label="Prefix" hint="Like A" value={bulk.prefix} onChange={(v) => setBulk({ ...bulk, prefix: v })} max={6} />
          <Msg a={a} />
          <Button title="Add the rooms" onPress={() => { void a.run(bulkProblem(bulk), async () => { const out = await api.post<Room[]>('/hotel/rooms/bulk', bulkBody(bulk)); a.setNote(bulkText(out.length, bulkCount(bulk))); setBulk(null); reload(); }, 'Saved'); }} busy={a.busy} />
          <Button title="Cancel" kind="quiet" onPress={() => setBulk(null)} />
        </Card>
      ) : null}
      {one ? (
        <Card>
          <Input label="Room number" value={one.f.room_no} onChange={(v) => setOne({ ...one, f: { ...one.f, room_no: v } })} max={10} />
          <Input label="Floor" value={one.f.floor} onChange={(v) => setOne({ ...one, f: { ...one.f, floor: v } })} max={10} />
          <Field label="Type"><Chips items={chips} value={one.f.room_type_id} onChange={(v) => setOne({ ...one, f: { ...one.f, room_type_id: v } })} /></Field>
          {one.id ? <Row label={one.active ? 'Retire' : 'Restore'} value={Boolean(one.active)} onChange={(v) => setOne({ ...one, active: v })} /> : null}
          <Msg a={a} />
          <Button title="Save" onPress={() => { void a.run(roomProblem(one.f), async () => { await api.call(one.id ? `/hotel/rooms/${one.id}` : '/hotel/rooms', { method: one.id ? 'PUT' : 'POST', body: roomBody(one.f, one.id ? one.active : undefined) }); setOne(null); reload(); }); }} busy={a.busy} />
          <Button title="Cancel" kind="quiet" onPress={() => setOne(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

/* ── rates ───────────────────────────────────────────────────────────────── */
const RatesTab = () => {
  const types = useList<RoomType[]>('/hotel/room-types');
  const plans = useList<RatePlan[]>('/hotel/rate-plans');
  const seasons = useList<Season[]>('/hotel/seasonal-rates');
  const [pf, setPf] = useState<{ id?: number; f: PlanForm } | null>(null);
  const [sf, setSf] = useState<SeasonForm | null>(null);
  const a = useAct();
  const reload = () => { plans.reload(); seasons.reload(); };
  if (!types.data || !plans.data || !seasons.data) return types.error ? <Failed message={types.error} onRetry={reload} /> : <Loading />;
  const typeList = types.data;
  return (
    <Panel>
      <SectionTitle>Rate plans</SectionTitle>
      <Soft>{t("A plan is a way of selling the same room, such as room only or with breakfast. Leave a rate empty to use the room type's rack rate.")}</Soft>
      {typeList.length === 0 ? <Soft>{t('Add a room type first. A “Room only” plan is made for you.')}</Soft> : <Button title="Add a plan" onPress={() => { a.setError(''); setPf({ f: emptyPlan() }); }} />}
      {plans.data.map((p) => <Line key={p.rate_plan_id} left={`${p.name}${p.is_default ? ` · ${t('Default')}` : ''}`} sub={planSub(p, typeList)} onPress={() => { a.setError(''); setPf({ id: p.rate_plan_id, f: planForm(p) }); }} />)}
      {pf ? (
        <Card>
          <Input label="Name" value={pf.f.name} onChange={(v) => setPf({ ...pf, f: { ...pf.f, name: v } })} max={60} placeholder="With breakfast" />
          <Input label="Short code" value={pf.f.code} onChange={(v) => setPf({ ...pf, f: { ...pf.f, code: v.toUpperCase() } })} max={12} placeholder="CP" />
          <Field label="Meals included"><Chips items={MEAL_PLANS.map(([c, l]) => ({ id: c, label: l }))} value={pf.f.meal_plan} onChange={(v) => setPf({ ...pf, f: { ...pf.f, meal_plan: v } })} /></Field>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t('Rate a night for each room type (before GST)')}</Text>
          {typeList.map((x) => <Input key={x.room_type_id} label={x.name} hint={`${t('Rack rate')} ${money(x.base_rate)}`} numeric value={pf.f.rates[x.room_type_id] ?? ''} onChange={(v) => setPf({ ...pf, f: { ...pf.f, rates: { ...pf.f.rates, [x.room_type_id]: v } } })} max={9} placeholder={t('Rack rate')} />)}
          <Row label="Use this plan when none is chosen" value={pf.f.is_default} onChange={(v) => setPf({ ...pf, f: { ...pf.f, is_default: v } })} />
          <Msg a={a} />
          <Button title="Save" onPress={() => { void a.run(planProblem(pf.f), async () => { await api.call(pf.id ? `/hotel/rate-plans/${pf.id}` : '/hotel/rate-plans', { method: pf.id ? 'PUT' : 'POST', body: planBody(pf.f, typeList) }); setPf(null); reload(); }); }} busy={a.busy} />
          <Button title="Cancel" kind="quiet" onPress={() => setPf(null)} />
        </Card>
      ) : null}

      <SectionTitle>Seasonal rates</SectionTitle>
      <Soft>{t('A different rate for a stretch of dates, such as the peak season, a festival or weekends. The newest one wins where they overlap.')}</Soft>
      {typeList.length > 0 ? <Button title="Add a seasonal rate" onPress={() => { a.setError(''); setSf(emptySeason(typeList[0].room_type_id)); }} /> : null}
      {seasons.data.length === 0 ? <Soft>{t('No seasonal rates. Every night uses the plan or rack rate.')}</Soft> : null}
      {seasons.data.map((o) => <Line key={o.override_id} left={o.name || t('Seasonal rate')} right={money(o.rate)} sub={seasonLine(o)} onPress={() => confirm(t('Remove this seasonal rate?'), t('Bookings already made keep the rate they were given.'), 'Remove', () => { void a.run('', async () => { await api.call(`/hotel/seasonal-rates/${o.override_id}`, { method: 'DELETE', body: {} }); reload(); }, 'Removed'); })} />)}
      {sf ? (
        <Card>
          <Input label="Name" value={sf.name} onChange={(v) => setSf({ ...sf, name: v })} max={60} placeholder="Peak season, Diwali, New Year…" />
          <Field label="Room type"><Chips items={typeList.map((x) => ({ id: String(x.room_type_id), label: x.name }))} value={sf.room_type_id} onChange={(v) => setSf({ ...sf, room_type_id: v })} /></Field>
          <Field label="Plan"><Chips items={[{ id: '', label: 'Every plan' }, ...plans.data.map((p) => ({ id: String(p.rate_plan_id), label: p.name }))]} value={sf.rate_plan_id} onChange={(v) => setSf({ ...sf, rate_plan_id: v })} /></Field>
          <Input label="From" value={sf.from_date} onChange={(v) => setSf({ ...sf, from_date: v })} max={10} placeholder="2026-11-01" />
          <Input label="To (including)" value={sf.to_date} onChange={(v) => setSf({ ...sf, to_date: v })} max={10} placeholder="2027-03-31" />
          <Input label="Rate a night" hint="Before GST" numeric value={sf.rate} onChange={(v) => setSf({ ...sf, rate: v })} max={9} />
          <Row label="Friday and Saturday nights only" value={sf.weekends} onChange={(v) => setSf({ ...sf, weekends: v })} />
          <Msg a={a} />
          <Button title="Add" onPress={() => { void a.run(seasonProblem(sf), async () => { await api.call('/hotel/seasonal-rates', { method: 'POST', body: seasonBody(sf) }); setSf(null); reload(); }); }} busy={a.busy} />
          <Button title="Cancel" kind="quiet" onPress={() => setSf(null)} />
        </Card>
      ) : null}
      {!pf && !sf ? <Msg a={a} /> : null}
    </Panel>
  );
};

/* ── out of sale ─────────────────────────────────────────────────────────── */
const BlocksTab = () => {
  const rooms = useList<Room[]>('/hotel/rooms');
  const blocks = useList<Block[]>('/hotel/room-blocks');
  const [f, setF] = useState<BlockForm | null>(null);
  const a = useAct();
  if (!rooms.data || !blocks.data) return blocks.error ? <Failed message={blocks.error} onRetry={blocks.reload} /> : <Loading />;
  return (
    <Panel>
      <SectionTitle>Rooms out of sale</SectionTitle>
      <Soft>{t('Take a room off the calendar for repairs, painting or owner use. For a room that is out of order right now, use the front desk.')}</Soft>
      <Button title="Take a room out of sale" onPress={() => { a.setError(''); setF(emptyBlock(rooms.data?.[0]?.room_id)); }} />
      {blocks.data.length === 0 ? <Soft>{t('No rooms are out of sale.')}</Soft> : null}
      {blocks.data.map((b) => <Line key={b.block_id} left={b.room_no} right={t('Put back on sale')} sub={blockLine(b)} onPress={() => confirm(t('Put room {room} back on sale?', { room: b.room_no }), '', 'Put back on sale', () => { void a.run('', async () => { await api.call(`/hotel/room-blocks/${b.block_id}`, { method: 'DELETE', body: {} }); blocks.reload(); }, 'Back on sale'); }, false)} />)}
      {f ? (
        <Card>
          <Field label="Room"><Chips items={rooms.data.map((r) => ({ id: String(r.room_id), label: r.room_no }))} value={f.room_id} onChange={(v) => setF({ ...f, room_id: v })} /></Field>
          <Input label="First night" value={f.from_date} onChange={(v) => setF({ ...f, from_date: v })} max={10} placeholder="2026-11-01" />
          <Input label="Open for booking again on" value={f.to_date} onChange={(v) => setF({ ...f, to_date: v })} max={10} placeholder="2026-11-05" />
          <Input label="Why" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} max={120} placeholder="Repainting, plumbing, owner's guests…" />
          <Msg a={a} />
          <Button title="Take out of sale" onPress={() => { void a.run(blockProblem(f), async () => { await api.call('/hotel/room-blocks', { method: 'POST', body: blockBody(f) }); setF(null); blocks.reload(); }, 'Room taken out of sale'); }} busy={a.busy} />
          <Button title="Cancel" kind="quiet" onPress={() => setF(null)} />
        </Card>
      ) : null}
      {!f ? <Msg a={a} /> : null}
    </Panel>
  );
};

/* ── banquet ─────────────────────────────────────────────────────────────── */
const BanquetTab = () => {
  const halls = useList<Hall[]>('/hotel/banquet/halls');
  const packs = useList<Package[]>('/hotel/banquet/packages');
  const [hf, setHf] = useState<{ id?: number; f: HallForm } | null>(null);
  const [pf, setPf] = useState<{ id?: number; f: PackageForm } | null>(null);
  const a = useAct();
  const reload = () => { halls.reload(); packs.reload(); };
  if (!halls.data || !packs.data) return halls.error ? <Failed message={halls.error} onRetry={reload} /> : <Loading />;
  return (
    <Panel>
      <SectionTitle>Banquet halls</SectionTitle>
      <Soft>{t('Each hall has its capacity and the rent for one function.')}</Soft>
      <Button title="Add a hall" onPress={() => { a.setError(''); setHf({ f: emptyHall() }); }} />
      {halls.data.length === 0 ? <Soft>{t('No banquet halls yet.')}</Soft> : null}
      {halls.data.map((h) => <Line key={h.hall_id} left={h.name} sub={hallSub(h)} onPress={() => { a.setError(''); setHf({ id: h.hall_id, f: hallForm(h) }); }} />)}
      {hf ? (
        <Card>
          <Input label="Name" value={hf.f.name} onChange={(v) => setHf({ ...hf, f: { ...hf.f, name: v } })} max={60} placeholder="Grand Ballroom, Sea Lawn…" />
          <Input label="Seated" numeric value={hf.f.capacity_seated} onChange={(v) => setHf({ ...hf, f: { ...hf.f, capacity_seated: v } })} max={5} />
          <Input label="Standing" numeric value={hf.f.capacity_floating} onChange={(v) => setHf({ ...hf, f: { ...hf.f, capacity_floating: v } })} max={5} />
          <Input label="Rent a function" hint="Before GST" numeric value={hf.f.rent} onChange={(v) => setHf({ ...hf, f: { ...hf.f, rent: v } })} max={9} />
          <Input label="What the hall has" hint="Separate with commas" value={hf.f.amenities} onChange={(v) => setHf({ ...hf, f: { ...hf.f, amenities: v } })} placeholder="Stage, air conditioning, projector, parking" />
          <Msg a={a} />
          <Button title="Save" onPress={() => { void a.run(hallProblem(hf.f), async () => { await api.call(hf.id ? `/hotel/banquet/halls/${hf.id}` : '/hotel/banquet/halls', { method: hf.id ? 'PUT' : 'POST', body: hallBody(hf.f) }); setHf(null); reload(); }); }} busy={a.busy} />
          {hf.id ? <Button title="Remove" kind="danger" onPress={() => confirm(t('Remove {name}?', { name: hf.f.name }), t('It cannot be removed while events are booked in it.'), 'Remove', () => { void a.run('', async () => { await api.call(`/hotel/banquet/halls/${hf.id}`, { method: 'DELETE', body: {} }); setHf(null); reload(); }, 'Removed'); })} /> : null}
          <Button title="Cancel" kind="quiet" onPress={() => setHf(null)} />
        </Card>
      ) : null}

      <SectionTitle>Menu packages</SectionTitle>
      <Soft>{t('A package is a menu with a price a plate. Pick one when you plan a function and the food is charged for the guaranteed guests.')}</Soft>
      <Button title="Add a package" onPress={() => { a.setError(''); setPf({ f: emptyPackage() }); }} />
      {packs.data.length === 0 ? <Soft>{t('No packages yet.')}</Soft> : null}
      {packs.data.map((p) => <Line key={p.package_id} left={p.name} sub={packageSub(p)} onPress={() => { a.setError(''); setPf({ id: p.package_id, f: packageForm(p) }); }} />)}
      {pf ? (
        <Card>
          <Input label="Name" value={pf.f.name} onChange={(v) => setPf({ ...pf, f: { ...pf.f, name: v } })} max={60} />
          <Field label="Diet"><Chips items={DIETS.map(([c, l]) => ({ id: c, label: l }))} value={pf.f.diet} onChange={(v) => setPf({ ...pf, f: { ...pf.f, diet: v } })} /></Field>
          <Input label="Price a plate" hint="Before GST" numeric value={pf.f.per_plate} onChange={(v) => setPf({ ...pf, f: { ...pf.f, per_plate: v } })} max={7} />
          <Input label="Fewest guests charged" numeric value={pf.f.min_guests} onChange={(v) => setPf({ ...pf, f: { ...pf.f, min_guests: v } })} max={5} />
          <Input label="GST %" numeric value={pf.f.tax_rate} onChange={(v) => setPf({ ...pf, f: { ...pf.f, tax_rate: v } })} max={5} />
          <Input label="Menu" multiline value={pf.f.menu} onChange={(v) => setPf({ ...pf, f: { ...pf.f, menu: v } })} max={1000} placeholder="Welcome drink, two starters, three mains, rice, breads, dessert" />
          <Msg a={a} />
          <Button title="Save" onPress={() => { void a.run(packageProblem(pf.f), async () => { await api.call(pf.id ? `/hotel/banquet/packages/${pf.id}` : '/hotel/banquet/packages', { method: pf.id ? 'PUT' : 'POST', body: packageBody(pf.f) }); setPf(null); reload(); }); }} busy={a.busy} />
          {pf.id ? <Button title="Remove" kind="danger" onPress={() => confirm(t('Remove {name}?', { name: pf.f.name }), t('Events already booked keep their price.'), 'Remove', () => { void a.run('', async () => { await api.call(`/hotel/banquet/packages/${pf.id}`, { method: 'DELETE', body: {} }); setPf(null); reload(); }, 'Removed'); })} /> : null}
          <Button title="Cancel" kind="quiet" onPress={() => setPf(null)} />
        </Card>
      ) : null}
      {!hf && !pf ? <Msg a={a} /> : null}
    </Panel>
  );
};

/* ── settings ────────────────────────────────────────────────────────────── */
const SettingsTab = () => {
  const st = useList<HotelSettings>('/hotel/settings');
  const [f, setF] = useState<SettingsForm | null>(null);
  const a = useAct();
  useEffect(() => { if (st.data) setF(settingsForm(st.data)); }, [st.data]);
  if (!st.data || !f) return st.error ? <Failed message={st.error} onRetry={st.reload} /> : <Loading />;
  const audits = st.data.audits;
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  return (
    <Panel>
      <SectionTitle>Check-in and check-out</SectionTitle>
      <Input label="Check-in from" value={f.check_in_time} onChange={(v) => set('check_in_time', v)} max={5} placeholder="12:00" />
      <Input label="Check-out by" value={f.check_out_time} onChange={(v) => set('check_out_time', v)} max={5} placeholder="11:00" />
      <Input label="Booking number prefix" value={f.res_prefix} onChange={(v) => set('res_prefix', v.toUpperCase())} max={8} />
      <Field label="The hotel's date today" hint={audits === 0 ? 'You can set this until you run the first night audit. After that only night audit moves it.' : 'Only night audit moves this now.'}>
        <TextInput style={[s.input, audits > 0 ? { opacity: 0.5 } : null]} value={f.business_date} editable={audits === 0} onChangeText={(v) => set('business_date', v)} maxLength={10} placeholder="2026-11-01" accessibilityLabel={t("The hotel's date today")} />
      </Field>
      <SectionTitle>GST on room tariff</SectionTitle>
      <Soft>{t('Room tariff is taxed by the rate charged for the night. Check the rates and the limit with your accountant; the law has changed more than once.')}</Soft>
      <Input label="Limit a night" hint="Up to this, the lower rate applies" numeric value={f.tax_threshold} onChange={(v) => set('tax_threshold', v)} max={9} />
      <Input label="GST up to the limit (%)" numeric value={f.tax_low_pct} onChange={(v) => set('tax_low_pct', v)} max={5} />
      <Input label="GST above the limit (%)" numeric value={f.tax_high_pct} onChange={(v) => set('tax_high_pct', v)} max={5} />
      <SectionTitle>Bookings</SectionTitle>
      <Row label="Allow more bookings than rooms" hint="Off is safer: the system refuses a booking when no room of that type is free." value={f.allow_overbooking} onChange={(v) => set('allow_overbooking', v)} />
      <Msg a={a} />
      <Button title="Save settings" onPress={() => { void a.run(settingsProblem(f, audits), async () => { await api.call('/hotel/settings', { method: 'PUT', body: settingsBody(f, audits) }); st.reload(); }); }} busy={a.busy} />
    </Panel>
  );
};

/* Hotel set-up: rooms and room types, rates, rooms out of sale, banquet, and the property's rules. */
export default function HotelSetupScreen() {
  const me = currentBusiness(useSession());
  const ok = canHotelSetup((p) => allowed(me, p));
  const [tab, setTab] = useState<'rooms' | 'rates' | 'blocks' | 'banquet' | 'settings'>('rooms');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Hotel set-up</Title><Soft>Your rooms, rates and rules. Set these once, then the front desk takes it from there.</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to hotel set-up.</Empty> : (
          <>
            <Chips items={[{ id: 'rooms', label: 'Rooms' }, { id: 'rates', label: 'Rates' }, { id: 'blocks', label: 'Out of sale' }, { id: 'banquet', label: 'Banquet' }, { id: 'settings', label: 'Settings' }]} value={tab} onChange={setTab} />
            {tab === 'rooms' ? <RoomsTab key="r" /> : tab === 'rates' ? <RatesTab key="t" /> : tab === 'blocks' ? <BlocksTab key="b" /> : tab === 'banquet' ? <BanquetTab key="q" /> : <SettingsTab key="s" />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
