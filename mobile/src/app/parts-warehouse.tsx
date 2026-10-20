import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { setCaptured, useCaptured } from '../lib/capture.ts';
import { binByCode, moveBody, moveProblem, partSub, pickOrder, placePath, putAwayBody, putAwayProblem, stockText, storingBins, type PartLocations, type PartRow, type Place, type StorePlace, type Waiting } from '../lib/parts.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Tab = 'bin' | 'putaway' | 'move';

/* The storeroom: look inside a bin (scan its label or type its code), put received stock on a shelf, and move stock between bins. The stock total never changes here, only where it sits. */
export default function PartsWarehouse() {
  const params = useLocalSearchParams<{ tab?: string; product?: string }>();
  const [tab, setTab] = useState<Tab>((['bin', 'putaway', 'move'] as string[]).includes(params.tab ?? '') ? params.tab as Tab : 'bin');
  const places = useLoad<StorePlace[]>('parts-places', () => api.get<StorePlace[]>('/autoparts/locations'));
  const bins = storingBins(places.data ?? []);
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Racks and bins</Title><Soft>Where every part sits</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Tab> items={[{ id: 'bin', label: 'Look in a bin' }, { id: 'putaway', label: 'Put away' }, { id: 'move', label: 'Move stock' }]} value={tab} onChange={setTab} />
        {places.error && !places.data ? <Failed message={places.error} onRetry={() => { void places.refresh(); }} /> : null}
        {places.busy && !places.data ? <Loading /> : null}
        {places.data && bins.length === 0 ? <Empty>No bins are set up yet. Add racks and bins on the website.</Empty> : null}
        {places.data && bins.length ? (
          tab === 'bin' ? <LookInBin /> : tab === 'putaway' ? <PutAway bins={bins} first={Number(params.product) || 0} /> : <Move bins={bins} first={Number(params.product) || 0} />
        ) : null}
      </Page>
    </SafeAreaView>
  );
}

/* A scan or typed code for a bin: the label QR ("FXB:...") or the printed code. */
function useBinCode(onCode: (code: string) => void) {
  const captured = useCaptured();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { if (focused && captured) { onCode(captured); setCaptured(null); } }, [focused, captured]);   // eslint-disable-line react-hooks/exhaustive-deps
}
const scan = () => router.push({ pathname: '/scan', params: { capture: '1' } });

function LookInBin() {
  const [code, setCode] = useState('');
  const [placeCode, setPlaceCode] = useState('');
  useBinCode((c) => { setCode(c); setPlaceCode(c); });
  const place = useLoad<Place | null>(`parts-place:${placeCode}`, () => api.get<Place | null>(placePath(placeCode)), placeCode.trim().length > 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <TextInput style={s.input} value={code} onChangeText={setCode} onSubmitEditing={() => setPlaceCode(code)} autoCapitalize="characters" placeholder="Bin code, like WH-A-R12-B07" accessibilityLabel="Bin code" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Scan the label" onPress={scan} style={{ flex: 1 }} />
        <Button title="Look" kind="quiet" onPress={() => setPlaceCode(code)} disabled={!code.trim()} />
      </View>
      {place.busy && !place.data ? <Loading /> : null}
      {place.error ? <ErrorText>{place.error}</ErrorText> : null}
      {placeCode && !place.busy && !place.error && place.data === null ? <Empty>No bin has that code.</Empty> : null}
      {place.data ? (
        <>
          <SectionTitle>{place.data.code}</SectionTitle>
          <Soft>{place.data.path.map((p) => p.code).join('  ›  ')}{place.data.capacity_units ? ` · limit ${place.data.capacity_units}` : ''}</Soft>
          {place.data.parts.length === 0 ? <Empty>Nothing is stored here.</Empty> : place.data.parts.map((p, i) => (
            <Line key={i} left={p.name} sub={`${p.sku ?? ''}${p.reserved_qty ? ` · ${p.reserved_qty} held` : ''}${p.location_code !== place.data!.code ? ` · ${p.location_code}` : ''}`} right={`${p.qty}`} onPress={() => router.push({ pathname: '/parts-part/[id]', params: { id: String(p.product_id) } })} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function PutAway({ bins, first }: { bins: StorePlace[]; first: number }) {
  const waiting = useLoad<Waiting[]>('parts-waiting', () => api.get<Waiting[]>('/autoparts/warehouse/unassigned'));
  const [pick, setPick] = useState<Waiting | null>(null);
  const [bin, setBin] = useState<StorePlace | null>(null);
  const [binText, setBinText] = useState('');
  const [qty, setQty] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());   // one put-away, one key: a double tap puts away once
  useEffect(() => { if (!pick && first && waiting.data) { const w = waiting.data.find((x) => x.product_id === first); if (w) choose(w); } }, [waiting.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (w: Waiting) => { setPick(w); setQty(String(w.unassigned)); setBin(null); setBinText(''); setProblem(''); setKey(newKey()); };
  const setCode = (c: string) => {
    setBinText(c);
    const found = /^FXB:/i.test(c.trim()) ? null : binByCode(bins, c);
    if (found) { setBin(found); return; }
    // a scanned label carries a token: the server knows which bin it is
    if (/^FXB:/i.test(c.trim())) void api.get<Place | null>(placePath(c)).then((p) => { const hit = p ? bins.find((b) => b.location_id === p.location_id) : null; if (hit) { setBin(hit); setBinText(hit.code); } else setProblem('That label is not a bin that can hold stock.'); }).catch((e) => setProblem(e instanceof Error ? e.message : 'Could not read the label'));
  };
  useBinCode(setCode);
  const save = async () => {
    const bad = putAwayProblem(qty, pick?.unassigned ?? 0, bin?.location_id ?? null);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try { await api.post('/autoparts/warehouse/put-away', putAwayBody((pick as Waiting).product_id, (bin as StorePlace).location_id, qty, key), { idempotencyKey: key }); setPick(null); void waiting.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not put it away'); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {waiting.error && !waiting.data ? <Failed message={waiting.error} onRetry={() => { void waiting.refresh(); }} /> : null}
      {waiting.busy && !waiting.data ? <Loading /> : null}
      {waiting.data && waiting.data.length === 0 ? <Empty>Nothing is waiting. Everything received is on a shelf.</Empty> : null}
      {!pick ? (waiting.data ?? []).map((w) => <Line key={w.product_id} left={w.name} sub={`${w.sku ?? ''} · ${w.on_hand} in stock, ${w.binned} on shelves`} right={`${w.unassigned} waiting`} onPress={() => choose(w)} />) : (
        <>
          <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{pick.name}</Text>
          <Soft>{`${pick.unassigned} waiting for a bin`}</Soft>
          <TextInput style={s.input} value={binText} onChangeText={setCode} autoCapitalize="characters" placeholder="Bin code" accessibilityLabel="Bin code" />
          <Button title="Scan the bin label" kind="quiet" onPress={scan} />
          {bin ? <Text style={{ color: color.ok, fontWeight: '600' }}>{`Bin ${bin.code}${bin.capacity_units ? ` (limit ${bin.capacity_units}, holds ${bin.qty})` : ''}`}</Text> : <Soft>Or choose one:</Soft>}
          {!bin ? <Chips<string> items={bins.slice(0, 12).map((b) => ({ id: String(b.location_id), label: b.code }))} value="" onChange={(v) => { const b = bins.find((x) => x.location_id === Number(v)); if (b) { setBin(b); setBinText(b.code); } }} /> : null}
          <TextInput style={s.input} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="How many" accessibilityLabel="How many" />
          <ErrorText>{problem}</ErrorText>
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Put away" onPress={() => { void save(); }} busy={busy} style={{ flex: 1 }} /><Button title="Cancel" kind="quiet" onPress={() => setPick(null)} /></View>
        </>
      )}
    </ScrollView>
  );
}

function Move({ bins, first }: { bins: StorePlace[]; first: number }) {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term), 300); return () => clearTimeout(t); }, [term]);
  const found = useLoad<PartRow[]>(`parts-move-find:${q}`, () => api.get<PartRow[]>(`/autoparts/parts/lookup?q=${encodeURIComponent(q.trim())}&limit=6`), q.trim().length >= 2 && !first);
  const [part, setPart] = useState<{ product_id: number; name: string } | null>(null);
  const one = useLoad<{ product_id: number; name: string }>(`parts-move-part:${first}`, () => api.get(`/autoparts/parts/${first}`), first > 0);
  useEffect(() => { if (first && one.data && !part) setPart(one.data); }, [one.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const where = useLoad<PartLocations>(`parts-move-where:${part?.product_id}`, () => api.get<PartLocations>(`/autoparts/parts/${part?.product_id}/locations`), Boolean(part));
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState<StorePlace | null>(null);
  const [toText, setToText] = useState('');
  const [qty, setQty] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());
  useBinCode((c) => { setToText(c); const f = binByCode(bins, c); if (f) setTo(f); else setProblem('No bin has that code.'); });
  const src = where.data?.bins.find((b) => b.location_id === from);
  const save = async () => {
    const bad = moveProblem(from || null, to?.location_id ?? null, qty, src?.available ?? 0);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try { await api.post('/autoparts/warehouse/move', moveBody((part as { product_id: number }).product_id, from, (to as StorePlace).location_id, qty, key), { idempotencyKey: key }); setQty(''); setTo(null); setToText(''); setFrom(0); setKey(newKey()); void where.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not move it'); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {!part ? (
        <>
          <TextInput style={s.input} value={term} onChangeText={setTerm} placeholder="The part: name, code or part number" accessibilityLabel="Part" />
          {(found.data ?? []).map((p) => <Line key={p.product_id} left={p.name} sub={partSub(p)} right={stockText(p.stock)} onPress={() => setPart({ product_id: p.product_id, name: p.name })} />)}
        </>
      ) : (
        <>
          <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{part.name}</Text>
          {where.data && where.data.bins.length === 0 ? <Empty>This part is not on any shelf.</Empty> : null}
          <Soft>Move from</Soft>
          {pickOrder(where.data?.bins ?? []).map((b) => <Line key={b.location_id} left={b.code} sub={b.reserved_qty ? `${b.reserved_qty} held` : undefined} right={`${b.available} free`} selected={from === b.location_id} onPress={() => setFrom(b.location_id)} />)}
          <Soft>Move to</Soft>
          <TextInput style={s.input} value={toText} onChangeText={(t) => { setToText(t); setTo(binByCode(bins, t)); }} autoCapitalize="characters" placeholder="Bin code" accessibilityLabel="Bin to move to" />
          <Button title="Scan the bin label" kind="quiet" onPress={scan} />
          {to ? <Text style={{ color: color.ok, fontWeight: '600' }}>{`To ${to.code}`}</Text> : null}
          <TextInput style={s.input} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="How many" accessibilityLabel="How many" />
          <ErrorText>{problem}</ErrorText>
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Move it" onPress={() => { void save(); }} busy={busy} style={{ flex: 1 }} /><Button title="Another part" kind="quiet" onPress={() => { setPart(null); setFrom(0); setTo(null); setTerm(''); setProblem(''); }} /></View>
        </>
      )}
    </ScrollView>
  );
}
