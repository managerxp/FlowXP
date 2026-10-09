import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { grnBody, grnLineProblem, grnProblem, newGrnLine, type GrnLine, type Medicine } from '../lib/pharmacy.ts';
import type { Supplier } from '../lib/buying.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* A delivery of medicines arrives (a goods received note): who from, then each medicine with how many, what each cost, its batch number and use-by date. Stock goes up batch by batch. */
export default function PharmacyReceive() {
  const suppliers = useLoad<Supplier[]>('suppliers', () => api.get<Supplier[]>('/suppliers'));
  const [supplier, setSupplier] = useState('0');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [text, setText] = useState('');
  const [found, setFound] = useState<Medicine[]>([]);
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const [key] = useState(newKey());   // one key for this delivery: a double tap records it once

  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { void api.get<Medicine[]>(`/pharmacy/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text]);

  const add = (m: Medicine) => { setLines((l) => (l.some((x) => x.product.product_id === m.product_id) ? l : [...l, newGrnLine(m)])); setText(''); setFound([]); };
  const edit = (id: number, patch: Partial<GrnLine>) => setLines((l) => l.map((x) => (x.product.product_id === id ? { ...x, ...patch } : x)));
  const drop = (id: number) => setLines((l) => l.filter((x) => x.product.product_id !== id));

  const save = async () => {
    const supplierId = supplier === '0' ? null : Number(supplier);
    const bad = grnProblem(lines, supplierId, today());
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const grn = await api.post<{ grn_number: string }>('/pharmacy/grn', grnBody(lines, supplierId!, invoiceNo, paid, 'CASH'), { idempotencyKey: key });
      setMade(`${grn.grn_number ?? 'The delivery'} is recorded. Stock is updated batch by batch.`);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not record the delivery'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Receive medicines</Title><Soft>A delivery from a supplier</Soft></View>
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
            {suppliers.data && suppliers.data.length === 0 ? <Empty>Add a supplier first (More, then Suppliers).</Empty> : null}
            <Chips items={(suppliers.data ?? []).map((x) => ({ id: String(x.supplier_id), label: x.name }))} value={supplier} onChange={setSupplier} />
            <View style={{ padding: 16, gap: 10 }}>
              <TextInput style={s.input} value={invoiceNo} onChangeText={setInvoiceNo} placeholder="Supplier's invoice number (optional)" accessibilityLabel="Supplier invoice number" />
              <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search a medicine to add" accessibilityLabel="Search a medicine" autoCorrect={false} />
            </View>
            {found.map((m) => <Line key={m.product_id} left={`${m.name}${m.strength ? ` ${m.strength}` : ''}`} sub="Tap to add" onPress={() => add(m)} />)}
            {lines.length === 0 ? <Empty>Search a medicine above and tap it to add it to this delivery.</Empty> : null}
            {lines.map((l) => {
              const id = l.product.product_id;
              const tracked = l.product.batch_tracking || l.product.expiry_tracking;
              const warn = grnLineProblem(l, today());
              return (
                <View key={id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink, flex: 1 }}>{l.product.name}{l.product.strength ? ` ${l.product.strength}` : ''}</Text>
                    <Button title="Remove" kind="quiet" onPress={() => drop(id)} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={l.received} onChangeText={(v) => edit(id, { received: v })} keyboardType="decimal-pad" placeholder="How many came" accessibilityLabel={`How many ${l.product.name} came`} />
                    <TextInput style={[s.input, { flex: 1 }]} value={l.damaged} onChangeText={(v) => edit(id, { damaged: v })} keyboardType="decimal-pad" placeholder="Damaged" accessibilityLabel={`How many ${l.product.name} were damaged`} />
                  </View>
                  <TextInput style={s.input} value={l.unit_cost} onChangeText={(v) => edit(id, { unit_cost: v })} keyboardType="decimal-pad" placeholder="Cost of one (what you pay)" accessibilityLabel={`Cost of one ${l.product.name}`} />
                  {tracked ? (
                    <>
                      <TextInput style={s.input} value={l.batch_no} onChangeText={(v) => edit(id, { batch_no: v })} autoCapitalize="characters" placeholder="Batch number" accessibilityLabel={`Batch number of ${l.product.name}`} />
                      {l.product.expiry_tracking ? <TextInput style={s.input} value={l.expiry} onChangeText={(v) => edit(id, { expiry: v })} placeholder="Use by, like 03/2027" accessibilityLabel={`Use-by date of ${l.product.name}`} autoCapitalize="none" /> : null}
                      <TextInput style={s.input} value={l.mfg} onChangeText={(v) => edit(id, { mfg: v })} placeholder="Made on, like 03/2025 (optional)" accessibilityLabel={`Made-on date of ${l.product.name}`} autoCapitalize="none" />
                    </>
                  ) : null}
                  {warn ? <Text style={{ color: color.warn }}>{warn}</Text> : null}
                </View>
              );
            })}
            {lines.length ? (
              <View style={{ padding: 16, gap: 10 }}>
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
