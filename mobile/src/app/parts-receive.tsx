import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { SearchBox } from '../lib/SearchBox.tsx';
import { acceptedOf, addRecvLine, lookupPath, partSub, recvBody, recvProblem, recvSummary, storingBins, type PartRow, type RecvLine, type StorePlace } from '../lib/parts.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Supplier = { supplier_id: number; name: string };

/* Receiving a delivery: what arrived is accepted, damaged or rejected, and only the accepted part becomes stock you can sell. A part can go straight into a bin, or wait on the Put away list. */
export default function PartsReceive() {
  const suppliers = useLoad<Supplier[]>('parts-suppliers', () => api.get<Supplier[]>('/suppliers'));
  const places = useLoad<StorePlace[]>('parts-places', () => api.get<StorePlace[]>('/autoparts/locations'));
  const bins = storingBins(places.data ?? []);
  const [supplierId, setSupplierId] = useState(0);
  const [invoice, setInvoice] = useState('');
  const [lines, setLines] = useState<RecvLine[]>([]);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text), 300); return () => clearTimeout(t); }, [text]);
  const path = lookupPath(q, 6);
  const found = useLoad<PartRow[]>(`parts-recv-find:${q}`, () => api.get<PartRow[]>(path as string), path !== null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const key = useRef(newKey());   // one receipt, one key: a double tap books it once, a retried invoice number is refused

  const set = (i: number, k: 'received' | 'damaged' | 'rejected' | 'cost', v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const sum = recvSummary(lines);
  const save = async () => {
    const bad = recvProblem(supplierId || null, lines);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const out = await api.post<{ grn_number?: string; putaway_tasks?: number[] }>('/autoparts/grns', recvBody(supplierId, invoice, lines), { idempotencyKey: key.current });
      setDone(`Receipt ${out.grn_number ?? ''} booked.${out.putaway_tasks?.length ? ` ${out.putaway_tasks.length} part${out.putaway_tasks.length === 1 ? '' : 's'} wait for a bin.` : ''}`);
      setLines([]); setInvoice(''); key.current = newKey();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not book the receipt'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Receive parts</Title><Soft>Book a delivery against a supplier invoice</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600', paddingHorizontal: 16 }}>{done}</Text> : null}
          <SectionTitle>Supplier</SectionTitle>
          {suppliers.error && !suppliers.data ? <Failed message={suppliers.error} onRetry={() => { void suppliers.refresh(); }} /> : null}
          {suppliers.busy && !suppliers.data ? <Loading /> : null}
          {suppliers.data ? <Chips<string> items={suppliers.data.map((x) => ({ id: String(x.supplier_id), label: x.name }))} value={String(supplierId || '')} onChange={(v) => { setSupplierId(Number(v)); setDone(''); }} /> : null}
          <View style={{ padding: 16, gap: 8 }}>
            <TextInput style={s.input} value={invoice} onChangeText={setInvoice} placeholder="Supplier invoice number (the same one cannot be booked twice)" accessibilityLabel="Supplier invoice number" />
            <SearchBox value={text} onChange={setText} placeholder="Add a part: scan, or type a name or number" label="Add a part" />
          </View>
          {(found.data ?? []).map((p) => <Line key={p.product_id} left={p.name} sub={partSub(p)} right="Add" onPress={() => { setLines((ls) => addRecvLine(ls, p)); setText(''); setDone(''); }} />)}

          {lines.map((l, i) => (
            <View key={l.product_id} style={[s.card, { margin: 16, marginBottom: 0, gap: 8 }]}>
              <Text style={{ fontWeight: '700', color: color.ink }}>{l.name}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['received', 'damaged', 'rejected'] as const).map((k) => (
                  <View key={k} style={{ flex: 1, gap: 2 }}>
                    <Soft>{k === 'received' ? 'Arrived' : k === 'damaged' ? 'Damaged' : 'Rejected'}</Soft>
                    <TextInput style={s.input} value={l[k]} onChangeText={(v) => set(i, k, v)} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={`${k} ${l.name}`} />
                  </View>
                ))}
              </View>
              <Text style={{ color: color.ok, fontWeight: '600' }}>{`${acceptedOf(l)} to stock`}</Text>
              <TextInput style={s.input} value={l.cost} onChangeText={(v) => set(i, 'cost', v)} keyboardType="decimal-pad" placeholder="Cost each, in rupees" accessibilityLabel={`Cost ${l.name}`} />
              {bins.length ? <Chips<string> items={[{ id: '0', label: 'Put away later' }, ...bins.slice(0, 10).map((b) => ({ id: String(b.location_id), label: b.code }))]} value={String(l.binId ?? 0)} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, binId: Number(v) || null, binCode: bins.find((b) => b.location_id === Number(v))?.code ?? null } : x)))} /> : null}
              <Button title="Remove" kind="quiet" onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
            </View>
          ))}

          {lines.length ? (
            <View style={{ padding: 16, gap: 8 }}>
              <Soft>{`${sum.arrived} arrived: ${sum.accepted} to stock, ${sum.damaged} damaged, ${sum.rejected} rejected`}</Soft>
              <ErrorText>{problem}</ErrorText>
              <Button title="Book the receipt" onPress={() => { void save(); }} busy={busy} />
            </View>
          ) : <View style={{ padding: 16 }}><ErrorText>{problem}</ErrorText></View>}
          <View style={{ paddingHorizontal: 16 }}><Button title="See the Put away list" kind="quiet" onPress={() => router.push({ pathname: '/parts-warehouse', params: { tab: 'putaway' } })} /></View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
