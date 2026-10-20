import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import {
  BLOCK_CHOICES, DAY_CHOICES, KIND_CHOICES, canGamingSetup, emptyOffer, emptyRate, emptyStation, gsettingsBody, gsettingsForm, gsettingsProblem, newBand, offerBody, offerForm, offerProblem, offerSub,
  rateBody, rateForm, rateProblem, rateSummary, scopeName, stationBody, stationForm, stationProblem, stationSub, zoneProblem,
  type GSettings, type GSettingsForm, type GStation, type Offer, type OfferForm, type Rate, type RateForm, type StationForm, type Zone
} from '../lib/gamingSetup.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
const tr = (items: { id: string; label: string }[]) => items.map((x) => ({ id: x.id, label: t(x.label) }));

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>{children}{hint ? <Soft>{t(hint)}</Soft> : null}</View>
);
const Input = ({ label, value, onChange, hint, numeric, max, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; numeric?: boolean; max?: number; placeholder?: string }) => (
  <Field label={label} hint={hint}>
    <TextInput style={s.input} value={value} onChangeText={(v) => onChange(numeric ? v.replace(/[^\d.]/g, '') : v)} keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={max} placeholder={placeholder ? t(placeholder) : undefined} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
  </Field>
);
const Row = ({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(label)}</Text>{hint ? <Soft>{t(hint)}</Soft> : null}</View><Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} /></View>
);
const Multi = ({ items, values, onToggle }: { items: { id: string; label: string }[]; values: string[]; onToggle: (id: string) => void }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {items.map((i) => {
      const on = values.includes(i.id);
      return <Pressable key={i.id} onPress={() => onToggle(i.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ minHeight: 44, minWidth: 52, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: on ? color.brand : color.card, borderWidth: 1, borderColor: on ? color.brand : color.line }}><Text style={{ color: on ? '#fff' : color.ink, fontWeight: '600' }}>{i.label}</Text></Pressable>;
    })}
  </View>
);
const Panel = ({ children }: { children: React.ReactNode }) => <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
const Card = ({ children }: { children: React.ReactNode }) => <View style={[s.card, { gap: 10 }]}>{children}</View>;

function useList<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { api.get<T>(path).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
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
const confirm = (title: string, body: string, ok: string, go: () => void) => Alert.alert(title, body, [{ text: t('Cancel'), style: 'cancel' }, { text: t(ok), style: 'destructive', onPress: go }]);

/* ── stations ────────────────────────────────────────────────────────────── */
const StationsTab = () => {
  const st = useList<GStation[]>('/gaming/stations');
  const zn = useList<Zone[]>('/gaming/zones');
  const [sf, setSf] = useState<{ id?: number; f: StationForm } | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zedit, setZedit] = useState<{ id: number; name: string } | null>(null);
  const [fault, setFault] = useState<{ id: number; note: string } | null>(null);
  const a = useAct();
  const reload = () => { st.reload(); zn.reload(); };
  if (!st.data || !zn.data) return st.error ? <Failed message={st.error} onRetry={reload} /> : <Loading />;
  const zones = zn.data;
  const zoneChips = [{ id: '', label: t('No zone') }, ...zones.map((z) => ({ id: String(z.zone_id), label: z.name }))];
  return (
    <Panel>
      <SectionTitle>Zones</SectionTitle>
      <Soft>{t('The groups on the board: Console lounge, Private rooms, Pool and snooker')}</Soft>
      {zones.map((z) => <Line key={z.zone_id} left={z.name} sub={t('{n} stations', { n: z.stations })} onPress={() => { a.setError(''); setZedit({ id: z.zone_id, name: z.name }); }} />)}
      {zedit ? (
        <Card>
          <Input label="Zone name" value={zedit.name} onChange={(v) => setZedit({ ...zedit, name: v })} max={40} />
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(zoneProblem(zedit.name), async () => { await api.call(`/gaming/zones/${zedit.id}`, { method: 'PUT', body: { name: zedit.name.trim() } }); setZedit(null); reload(); }); }} />
          <Button title="Remove" kind="danger" onPress={() => confirm(t('Remove {name}?', { name: zedit.name }), t('Move or retire its stations first.'), 'Remove', () => { void a.run('', async () => { await api.call(`/gaming/zones/${zedit.id}`, { method: 'DELETE', body: {} }); setZedit(null); reload(); }, 'Removed'); })} />
          <Button title="Cancel" kind="quiet" onPress={() => setZedit(null)} />
        </Card>
      ) : null}
      <Input label="New zone" value={zoneName} onChange={setZoneName} max={40} />
      <Button title="Add a zone" kind="quiet" busy={a.busy} onPress={() => { void a.run(zoneProblem(zoneName), async () => { await api.post('/gaming/zones', { name: zoneName.trim() }); setZoneName(''); reload(); }, 'Zone added'); }} />

      <SectionTitle>Stations</SectionTitle>
      <Soft>{t('Each one has its own table, so food and drink for it sit on the same bill as its time')}</Soft>
      <Button title="Add a station" onPress={() => { a.setError(''); setSf({ f: emptyStation(zones[0]?.zone_id) }); }} />
      {st.data.length === 0 ? <Soft>{t('Add your first PS5, room or table.')}</Soft> : null}
      {st.data.map((x) => <View key={x.station_id} style={{ opacity: x.status === 'OUT_OF_SERVICE' ? 0.6 : 1 }}><Line left={x.status === 'OUT_OF_SERVICE' ? `${x.name} · ${t('Out of service')}` : x.name} sub={stationSub(x)} onPress={() => { a.setError(''); setSf({ id: x.station_id, f: stationForm(x) }); setFault(x.status === 'OUT_OF_SERVICE' ? { id: x.station_id, note: x.status_note ?? '' } : null); }} /></View>)}
      {sf ? (
        <Card>
          <Input label="Name" hint="What the staff call it: PS5-1, Room A, Pool 2" value={sf.f.name} onChange={(v) => setSf({ ...sf, f: { ...sf.f, name: v } })} max={40} />
          <Field label="Kind"><Chips items={tr(KIND_CHOICES)} value={sf.f.kind} onChange={(v) => setSf({ ...sf, f: { ...sf.f, kind: v } })} /></Field>
          <Field label="Zone"><Chips items={zoneChips} value={sf.f.zone_id} onChange={(v) => setSf({ ...sf, f: { ...sf.f, zone_id: v } })} /></Field>
          <Input label="What it is (optional)" hint="PS5, Xbox Series X, 8-ball" value={sf.f.label} onChange={(v) => setSf({ ...sf, f: { ...sf.f, label: v } })} max={40} />
          <Input label="Most players" numeric value={sf.f.max_players} onChange={(v) => setSf({ ...sf, f: { ...sf.f, max_players: v } })} max={2} />
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(stationProblem(sf.f), async () => { await api.call(sf.id ? `/gaming/stations/${sf.id}` : '/gaming/stations', { method: sf.id ? 'PUT' : 'POST', body: stationBody(sf.f) }); setSf(null); reload(); }); }} />
          {sf.id ? (
            <>
              <Input label="What is wrong? (shown on the board)" value={fault?.note ?? ''} onChange={(v) => setFault({ id: sf.id as number, note: v })} max={80} />
              <Button title={st.data.find((x) => x.station_id === sf.id)?.status === 'OUT_OF_SERVICE' ? 'Back in service' : 'Out of service'} kind="quiet" onPress={() => { const out = st.data?.find((x) => x.station_id === sf.id)?.status !== 'OUT_OF_SERVICE'; void a.run('', async () => { await api.call(`/gaming/stations/${sf.id}/status`, { method: 'POST', body: { out_of_service: out, note: out ? (fault?.note ?? '') : '' } }); setSf(null); reload(); }, out ? 'Taken out of service' : 'Back in service'); }} />
              <Button title="Retire" kind="danger" onPress={() => confirm(t('Retire {name}?', { name: sf.f.name }), t('Its history stays.'), 'Retire', () => { void a.run('', async () => { await api.call(`/gaming/stations/${sf.id}/archive`, { method: 'POST', body: {} }); setSf(null); reload(); }, 'Retired'); })} />
            </>
          ) : null}
          <Button title="Cancel" kind="quiet" onPress={() => setSf(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

/* ── rates ───────────────────────────────────────────────────────────────── */
const RatesTab = () => {
  const rates = useList<Rate[]>('/gaming/rates');
  const zn = useList<Zone[]>('/gaming/zones');
  const st = useList<GStation[]>('/gaming/stations');
  const [rf, setRf] = useState<{ id?: number; f: RateForm } | null>(null);
  const a = useAct();
  if (!rates.data || !zn.data || !st.data) return rates.error ? <Failed message={rates.error} onRetry={rates.reload} /> : <Loading />;
  const scopes = [{ id: 'all', label: t('Every station') }, ...KIND_CHOICES.map((k) => ({ id: `kind:${k.id}`, label: t(k.label) })), ...zn.data.map((z) => ({ id: `zone:${z.zone_id}`, label: t('Zone {name}', { name: z.name }) })), ...st.data.map((x) => ({ id: `station:${x.station_id}`, label: x.name }))];
  const set = (patch: Partial<RateForm>) => rf && setRf({ ...rf, f: { ...rf.f, ...patch } });
  const setTier = (i: number, k: 'players' | 'hour', v: string) => rf && set({ tiers: rf.f.tiers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const setBand = (i: number, patch: Partial<RateForm['bands'][number]>) => rf && set({ bands: rf.f.bands.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Panel>
      <SectionTitle>Rates</SectionTitle>
      <Soft>{t('What time costs. A station with no rate cannot start a session.')}</Soft>
      <Button title="New rate" onPress={() => { a.setError(''); setRf({ f: emptyRate() }); }} />
      {rates.data.length === 0 ? <Soft>{t('Add one for your consoles, for example 1 player ₹100 an hour, 2 players ₹150.')}</Soft> : null}
      {rates.data.map((r) => <Line key={r.rate_id} left={`${r.name} · ${scopeName(r, zn.data as Zone[], st.data as GStation[])}`} sub={rateSummary(r)} onPress={() => { a.setError(''); setRf({ id: r.rate_id, f: rateForm(r) }); }} />)}
      {rf ? (
        <Card>
          {rf.id ? <Soft>{t('Sessions already running keep the rate they started with. A change applies to the next session.')}</Soft> : null}
          <Input label="Name" value={rf.f.name} onChange={(v) => set({ name: v })} max={80} placeholder="PS5 hourly, Pool by the frame" />
          <Field label="Applies to" hint="A station's own rate beats its zone's, which beats its kind's"><Chips items={scopes} value={rf.f.scope} onChange={(v) => set({ scope: v })} /></Field>
          <Row label="Charge for the time on the clock" hint="Off for a table charged only per frame or game" value={rf.f.bill_time} onChange={(v) => set({ bill_time: v })} />
          {rf.f.bill_time ? (
            <>
              <SectionTitle>Price per hour, by number of players</SectionTitle>
              {rf.f.tiers.map((x, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}><Input label="Players" numeric value={x.players} onChange={(v) => setTier(i, 'players', v)} max={2} /></View>
                  <View style={{ flex: 2 }}><Input label="Per hour" numeric value={x.hour} onChange={(v) => setTier(i, 'hour', v)} max={7} /></View>
                  {rf.f.tiers.length > 1 ? <Button title="Remove" kind="quiet" onPress={() => set({ tiers: rf.f.tiers.filter((_, j) => j !== i) })} /> : null}
                </View>
              ))}
              <Button title="Another price" kind="quiet" onPress={() => set({ tiers: [...rf.f.tiers, { players: String(Number(rf.f.tiers[rf.f.tiers.length - 1]?.players || 0) + 1), hour: '' }] })} />
              <Input label="Each extra player past the last row" hint="Blank: the last row's price" numeric value={rf.f.extra} onChange={(v) => set({ extra: v })} max={7} />
              <Soft>{t('Three players pay the next row up (a row for 4 covers 3 and 4).')}</Soft>
              <Field label="Billed" hint="Time over a block is rounded up"><Chips items={tr(BLOCK_CHOICES)} value={rf.f.block} onChange={(v) => set({ block: v })} /></Field>
              <Input label="Grace (minutes)" hint="Not billed if within this much over" numeric value={rf.f.grace} onChange={(v) => set({ grace: v })} max={2} />
              <Input label="Minimum (minutes)" hint="The least ever billed" numeric value={rf.f.min} onChange={(v) => set({ min: v })} max={3} />
            </>
          ) : null}
          <SectionTitle>Per frame or game (pool, snooker, table games)</SectionTitle>
          <Input label="What you count" value={rf.f.unitLabel} onChange={(v) => set({ unitLabel: v })} max={20} placeholder="frame" />
          <Input label="Price each" hint={rf.f.bill_time ? 'Added to the time' : 'Required when the clock is not charged'} numeric value={rf.f.unitPrice} onChange={(v) => set({ unitPrice: v })} max={7} />
          {rf.f.bill_time ? (
            <>
              <SectionTitle>Peak and happy-hour times</SectionTitle>
              {rf.f.bands.map((b, i) => (
                <Card key={i}>
                  <Input label="Name" value={b.name} onChange={(v) => setBand(i, { name: v })} max={30} />
                  <Input label="From" hint="Like 18:00" value={b.from} onChange={(v) => setBand(i, { from: v })} max={5} />
                  <Input label="To" hint="Like 23:00" value={b.to} onChange={(v) => setBand(i, { to: v })} max={5} />
                  <Input label="Price is (%)" hint="of the normal price" numeric value={b.pct} onChange={(v) => setBand(i, { pct: v })} max={4} />
                  <Field label="Days"><Multi items={DAY_CHOICES.map((d) => ({ id: String(d.id), label: t(d.label) }))} values={b.days.map(String)} onToggle={(v) => setBand(i, { days: b.days.includes(Number(v)) ? b.days.filter((d) => d !== Number(v)) : [...b.days, Number(v)] })} /></Field>
                  <Button title="Remove" kind="quiet" onPress={() => set({ bands: rf.f.bands.filter((_, j) => j !== i) })} />
                </Card>
              ))}
              <Button title="Add a peak time" kind="quiet" onPress={() => set({ bands: [...rf.f.bands, newBand()] })} />
              <Soft>{t('120% is a fifth more than normal; 80% is a fifth off (a happy hour).')}</Soft>
            </>
          ) : null}
          <Msg a={a} />
          <Button title="Save rate" busy={a.busy} onPress={() => { void a.run(rateProblem(rf.f), async () => { await api.call(rf.id ? `/gaming/rates/${rf.id}` : '/gaming/rates', { method: rf.id ? 'PUT' : 'POST', body: rateBody(rf.f) }); setRf(null); rates.reload(); }); }} />
          {rf.id ? <Button title="Switch off" kind="danger" onPress={() => confirm(t('Switch off {name}?', { name: rf.f.name }), t('Sessions already running keep it.'), 'Switch off', () => { void a.run('', async () => { await api.call(`/gaming/rates/${rf.id}`, { method: 'DELETE', body: {} }); setRf(null); rates.reload(); }, 'Switched off'); })} /> : null}
          <Button title="Cancel" kind="quiet" onPress={() => setRf(null)} />
        </Card>
      ) : null}
    </Panel>
  );
};

/* ── offers and hour packs ───────────────────────────────────────────────── */
const OffersBlock = ({ pack }: { pack: boolean }) => {
  const list = useList<Offer[]>(`/gaming/bundles?kind=${pack ? 'PACK' : 'SESSION'}`);
  const [of, setOf] = useState<{ id?: number; f: OfferForm } | null>(null);
  const a = useAct();
  if (!list.data) return list.error ? <Failed message={list.error} onRetry={list.reload} /> : <Loading />;
  const set = (patch: Partial<OfferForm>) => of && setOf({ ...of, f: { ...of.f, ...patch } });
  return (
    <>
      <SectionTitle>{pack ? 'Hour packs' : 'Offers'}</SectionTitle>
      <Soft>{pack ? t('Prepaid hours sold to a player and played from the board: 10 hours for ₹800') : t('Fixed time at a set price, started from the board: 3 hours for ₹250')}</Soft>
      <Button title={pack ? 'New pack' : 'New offer'} onPress={() => { a.setError(''); setOf({ f: emptyOffer(pack) }); }} />
      {list.data.length === 0 ? <Soft>{pack ? t('Packs are optional.') : t('Offers are optional. Without one, every session is paid by the time used.')}</Soft> : null}
      {list.data.map((o) => <Line key={o.bundle_id} left={o.name} sub={offerSub(o, pack)} onPress={() => { a.setError(''); setOf({ id: o.bundle_id, f: offerForm(o) }); }} />)}
      {of ? (
        <Card>
          <Input label="Name" value={of.f.name} onChange={(v) => set({ name: v })} max={80} placeholder="3 hours, Weekend special" />
          <Input label="Hours" numeric value={of.f.hours} onChange={(v) => set({ hours: v })} max={5} />
          <Input label="Price (before GST)" numeric value={of.f.price} onChange={(v) => set({ price: v })} max={8} />
          {pack ? <Input label="Good for (days)" hint="Blank: never expires" numeric value={of.f.valid} onChange={(v) => set({ valid: v })} max={4} /> : <Input label="Players covered" numeric value={of.f.players} onChange={(v) => set({ players: v })} max={2} />}
          <Field label="For which stations" hint="None ticked: any"><Multi items={tr(KIND_CHOICES)} values={of.f.kinds} onToggle={(v) => set({ kinds: of.f.kinds.includes(v) ? of.f.kinds.filter((k) => k !== v) : [...of.f.kinds, v] })} /></Field>
          <Soft>{pack ? t('A pack is prepaid hours the player spends over several visits. Minutes beyond what is left are charged at the rate of the station.') : t('An offer is time sold as a block at one price. Stopping early refunds nothing; time over is charged at the rate of the station.')}</Soft>
          <Msg a={a} />
          <Button title="Save" busy={a.busy} onPress={() => { void a.run(offerProblem(of.f, pack), async () => { await api.call(of.id ? `/gaming/bundles/${of.id}` : '/gaming/bundles', { method: of.id ? 'PUT' : 'POST', body: offerBody(of.f, pack) }); setOf(null); list.reload(); }); }} />
          {of.id ? <Button title="Switch off" kind="danger" onPress={() => confirm(t('Switch off {name}?', { name: of.f.name }), t('Sessions already running keep it.'), 'Switch off', () => { void a.run('', async () => { await api.call(`/gaming/bundles/${of.id}`, { method: 'DELETE', body: {} }); setOf(null); list.reload(); }, 'Switched off'); })} /> : null}
          <Button title="Cancel" kind="quiet" onPress={() => setOf(null)} />
        </Card>
      ) : null}
    </>
  );
};
const OffersTab = () => <Panel><OffersBlock pack={false} /><OffersBlock pack /></Panel>;

/* ── games ───────────────────────────────────────────────────────────────── */
const GamesTab = () => {
  const g = useList<{ game_id: number; name: string }[]>('/gaming/games');
  const [name, setName] = useState('');
  const a = useAct();
  if (!g.data) return g.error ? <Failed message={g.error} onRetry={g.reload} /> : <Loading />;
  return (
    <Panel>
      <SectionTitle>Games</SectionTitle>
      <Soft>{t('A short list to pick from when you start a session, so you can see what is played most')}</Soft>
      <Input label="New game" value={name} onChange={setName} max={60} placeholder="FIFA 26, Tekken 8, GTA V" />
      <Msg a={a} />
      <Button title="Add" busy={a.busy} onPress={() => { void a.run(name.trim() ? '' : 'Give the game a name', async () => { await api.post('/gaming/games', { name: name.trim() }); setName(''); g.reload(); }, 'Added'); }} />
      {g.data.length === 0 ? <Soft>{t('No games yet')}</Soft> : null}
      {g.data.map((x) => <Line key={x.game_id} left={x.name} onPress={() => confirm(t('Remove {name}?', { name: x.name }), '', 'Remove', () => { void a.run('', async () => { await api.call(`/gaming/games/${x.game_id}`, { method: 'DELETE', body: {} }); g.reload(); }, 'Removed'); })} />)}
    </Panel>
  );
};

/* ── settings ────────────────────────────────────────────────────────────── */
const SettingsTab = () => {
  const st = useList<GSettings>('/gaming/settings');
  const [f, setF] = useState<GSettingsForm | null>(null);
  const a = useAct();
  useEffect(() => { if (st.data) setF(gsettingsForm(st.data)); }, [st.data]);
  if (!f) return st.error ? <Failed message={st.error} onRetry={st.reload} /> : <Loading />;
  const set = (patch: Partial<GSettingsForm>) => setF({ ...f, ...patch });
  return (
    <Panel>
      <Input label="Warn when this much time is left (minutes)" hint="The tile turns amber and staff get a notification" numeric value={f.alert} onChange={(v) => set({ alert: v })} max={2} />
      <Input label="GST on gaming time (%)" hint="Usually 18%. Food and drink use their own rates." numeric value={f.gst} onChange={(v) => set({ gst: v })} max={5} />
      <Input label="Hold a booked station for (minutes)" hint="Before a booking, the station shows as booked" numeric value={f.hold} onChange={(v) => set({ hold: v })} max={3} />
      <Input label="Mark a no-show after (minutes)" numeric value={f.noshow} onChange={(v) => set({ noshow: v })} max={3} />
      <SectionTitle>Wallet top-up bonus</SectionTitle>
      {f.bonus.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Input label="When they pay at least" numeric value={r.min} onChange={(v) => set({ bonus: f.bonus.map((x, j) => (j === i ? { ...x, min: v } : x)) })} max={7} /></View>
          <View style={{ flex: 1 }}><Input label="They get extra" numeric value={r.bonus} onChange={(v) => set({ bonus: f.bonus.map((x, j) => (j === i ? { ...x, bonus: v } : x)) })} max={7} /></View>
          <Button title="Remove" kind="quiet" onPress={() => set({ bonus: f.bonus.filter((_, j) => j !== i) })} />
        </View>
      ))}
      <Button title="Add a bonus" kind="quiet" onPress={() => set({ bonus: [...f.bonus, { min: '500', bonus: '50' }] })} />
      <Soft>{t('Pay ₹500, get ₹50 extra. A top-up earns the highest bonus it reaches.')}</Soft>
      <Msg a={a} />
      <Button title="Save settings" busy={a.busy} onPress={() => { void a.run(gsettingsProblem(f, true), async () => { await api.call('/gaming/settings', { method: 'PUT', body: gsettingsBody(f, true) }); st.reload(); }); }} />
    </Panel>
  );
};

/* Gaming set-up: stations and zones, rates, offers and packs, the games list and the lounge settings. */
export default function GamingSetupScreen() {
  const me = currentBusiness(useSession());
  const ok = canGamingSetup((p) => allowed(me, p));
  const [tab, setTab] = useState<'stations' | 'rates' | 'offers' | 'games' | 'settings'>('stations');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Gaming set-up</Title><Soft>Stations, rates, offers and the lounge rules</Soft></View><Button title="Back" kind="quiet" onPress={goBack} /></View>
        {!ok ? <Empty>You do not have access to gaming set-up.</Empty> : (
          <>
            <Chips items={[{ id: 'stations', label: 'Stations' }, { id: 'rates', label: 'Rates' }, { id: 'offers', label: 'Offers' }, { id: 'games', label: 'Games' }, { id: 'settings', label: 'Settings' }]} value={tab} onChange={setTab} />
            {tab === 'stations' ? <StationsTab key="s" /> : tab === 'rates' ? <RatesTab key="r" /> : tab === 'offers' ? <OffersTab key="o" /> : tab === 'games' ? <GamesTab key="g" /> : <SettingsTab key="t" />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
