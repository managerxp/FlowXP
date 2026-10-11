import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { WProduct } from '../lib/wholesale.ts';
import { addTLine, dropTLine, setTQty, setTUnit, transferBody, transferProblem, type TLine, type Transfer, type Warehouse } from '../lib/transfers.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Move goods from one warehouse to another. Choose where they leave from and go to, add the items and how many. It can be sent straight away, or kept until the van is ready. */
export default function TransferNew() {
  const houses = useLoad<Warehouse[]>('transfer-warehouses', () => api.get<Warehouse[]>('/wholesale/warehouses'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [found, setFound] = useState<WProduct[]>([]);
  const [lines, setLines] = useState<TLine[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const key = useRef(newKey());   // one key for this transfer: a double tap makes one
  const fromId = from ? Number(from) : null; const toId = to ? Number(to) : null;
  const bad = transferProblem(fromId, toId, lines);
  const edit = (next: TLine[]) => { setLines(next); key.current = newKey(); setProblem(''); };

  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { void api.get<WProduct[]>(`/wholesale/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text]);

  const save = async (sendNow: boolean) => {
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const t = await api.post<Transfer>('/wholesale/transfers', transferBody(fromId!, toId!, lines, { vehicle, notes, sendNow }), { idempotencyKey: key.current });
      router.replace({ pathname: '/transfer/[id]', params: { id: String(t.transfer_id) } });
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the transfer'); }
    finally { setBusy(false); }
  };

  const ware = (houses.data ?? []).map((w) => ({ id: String(w.branch_id), label: w.name }));
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Move stock</Title><Soft>From one warehouse to another</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <SectionTitle>Goods leave from</SectionTitle>
          <Chips items={ware} value={from} onChange={(v) => { setFrom(v); setProblem(''); }} />
          <SectionTitle>and go to</SectionTitle>
          <Chips items={ware.filter((w) => w.id !== from)} value={to} onChange={(v) => { setTo(v); setProblem(''); }} />
          {houses.data && houses.data.length < 2 ? <Empty>You have only one warehouse. Add another on the website to move stock between them.</Empty> : null}

          <SectionTitle>What is going</SectionTitle>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search for an item" accessibilityLabel="Search for an item" autoCorrect={false} />
            {found.map((p) => <Line key={p.product_id} left={p.name} sub={p.on_hand != null ? `${p.on_hand} in stock here` : undefined} onPress={() => { edit(addTLine(lines, p)); setText(''); setFound([]); }} />)}
          </View>
          {lines.map((l) => {
            const units = [l.product.unit ?? 'piece', ...(l.product.units ?? []).map((u) => u.unit_name)].filter((u, i, a) => a.indexOf(u) === i);
            return (
              <View key={l.product.product_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <Text style={{ fontSize: 16, color: color.ink }}>{l.product.name}</Text>
                {units.length > 1 ? <Chips items={units.map((u, i) => ({ id: i === 0 ? '' : u, label: u }))} value={l.unit_name ?? ''} onChange={(u) => edit(setTUnit(lines, l.product.product_id, u || null))} /> : null}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput style={[s.input, { width: 120 }]} value={l.quantity} onChangeText={(v) => edit(setTQty(lines, l.product.product_id, v))} keyboardType="decimal-pad" accessibilityLabel={`How many ${l.product.name}`} />
                  <Button title="Remove" kind="quiet" onPress={() => edit(dropTLine(lines, l.product.product_id))} />
                </View>
              </View>
            );
          })}
          <View style={{ padding: 16, gap: 10 }}>
            <TextInput style={s.input} value={vehicle} onChangeText={setVehicle} placeholder="Vehicle number (optional)" autoCapitalize="characters" accessibilityLabel="Vehicle number" />
            <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" />
            <ErrorText>{problem}</ErrorText>
            <Button title="Send it now" onPress={() => { void save(true); }} busy={busy} disabled={Boolean(bad)} />
            <Button title="Keep it, send later" kind="quiet" onPress={() => { void save(false); }} busy={busy} disabled={Boolean(bad)} />
            <Soft>Sending takes the goods off the first warehouse. They are added to the other one when it marks them as received.</Soft>
          </View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
