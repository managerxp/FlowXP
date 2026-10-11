import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { syncAll } from '../lib/sync.ts';
import { useScope } from '../lib/local.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { Product } from '../lib/catalog.ts';
import { receiveBody, receiveProblem, receiveTotalPaise, type ReceiveLine, type Supplier } from '../lib/buying.ts';
import { rupees } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* A delivery arrives: pick what came and how many, with what each cost. Stock goes up, and what you owe the supplier is recorded. */
export default function Receive() {
  const scope = useScope();
  const suppliers = useLoad<Supplier[]>('suppliers', () => api.get<Supplier[]>('/suppliers'));
  const [supplier, setSupplier] = useState('0');
  const [billNo, setBillNo] = useState('');
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const [key] = useState(newKey());   // one key for this delivery: a double tap records it once

  useEffect(() => {
    if (!scope || text.trim().length < 2) { setFound([]); return; }
    let live = true;
    void scope.catalog.search(text.trim(), 8).then((r) => { if (live) setFound(r); });
    return () => { live = false; };
  }, [text, scope]);

  const add = (p: Product) => { setLines((l) => (l.some((x) => x.product_id === p.product_id) ? l : [...l, { product_id: p.product_id, name: p.name, quantity: '1', unit_cost: '', tax_rate: p.tax_rate, expiry: '' }])); setText(''); setFound([]); };
  const edit = (id: number, patch: Partial<ReceiveLine>) => setLines((l) => l.map((x) => (x.product_id === id ? { ...x, ...patch } : x)));
  const drop = (id: number) => setLines((l) => l.filter((x) => x.product_id !== id));

  const save = async () => {
    const bad = receiveProblem(lines);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const po = await api.post<{ po_number: string }>('/purchases', receiveBody(lines, supplier === '0' ? null : Number(supplier), billNo, paid, 'CASH'), { idempotencyKey: key });
      setMade(`${po.po_number} recorded. Stock is updated.`);
      void syncAll();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not record the delivery'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Receive stock</Title><Soft>What came in today</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {made ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{made}</Text>
            <Button title="Done" onPress={() => goBack()} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <SectionTitle>From</SectionTitle>
            <Chips items={[{ id: '0', label: 'No supplier' }, ...(suppliers.data ?? []).map((x) => ({ id: String(x.supplier_id), label: x.name }))]} value={supplier} onChange={setSupplier} />
            <View style={{ padding: 16, gap: 10 }}>
              <TextInput style={s.input} value={billNo} onChangeText={setBillNo} placeholder="Supplier's bill number (optional)" accessibilityLabel="Supplier bill number" />
              <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search an item to add" accessibilityLabel="Search an item" autoCorrect={false} />
            </View>
            {found.map((p) => <Line key={p.product_id} left={p.name} sub="Tap to add" onPress={() => add(p)} />)}
            {lines.length === 0 ? <Empty>Search an item above and tap it to add it to this delivery.</Empty> : null}
            {lines.map((l) => (
              <View key={l.product_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink, flex: 1 }}>{l.name}</Text>
                  <Button title="Remove" kind="quiet" onPress={() => drop(l.product_id)} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[s.input, { flex: 1 }]} value={l.quantity} onChangeText={(v) => edit(l.product_id, { quantity: v })} keyboardType="decimal-pad" placeholder="How many" accessibilityLabel={`How many ${l.name}`} />
                  <TextInput style={[s.input, { flex: 1 }]} value={l.unit_cost} onChangeText={(v) => edit(l.product_id, { unit_cost: v })} keyboardType="decimal-pad" placeholder="Cost each" accessibilityLabel={`Cost of one ${l.name}`} />
                </View>
                <TextInput style={s.input} value={l.expiry} onChangeText={(v) => edit(l.product_id, { expiry: v })} placeholder="Use-by date, like 2027-03-31 (if it expires)" accessibilityLabel={`Use-by date of ${l.name}`} autoCapitalize="none" />
              </View>
            ))}
            {lines.length ? (
              <View style={{ padding: 16, gap: 10 }}>
                <Soft>About {rupees(receiveTotalPaise(lines))} before GST.</Soft>
                <TextInput style={s.input} value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder="Paid now, in cash (optional)" accessibilityLabel="Paid now" />
                <ErrorText>{problem}</ErrorText>
                <Button title="Record the delivery" onPress={() => { void save(); }} busy={busy} />
              </View>
            ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
