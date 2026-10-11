import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { addBLine, dropBLine, factorOf, lineCostRupees, orderEstimatePaise, poBody, poProblem, setBCost, setBQty, setBUnit, type BLine, type BuyProduct, type PO, type Supplier } from '../lib/purchasing.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { SearchBox } from '../lib/SearchBox.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* An order to a supplier, in the supplier's own units (cartons, bags). The supplier's price list and GST are applied when it is saved; it starts as a draft for approval. */
export default function NewPurchaseOrder() {
  const suppliers = useLoad<Supplier[]>('wh-suppliers', () => api.get<Supplier[]>('/wholesale/suppliers?limit=100'));
  const [supplier, setSupplier] = useState('0');
  const [text, setText] = useState('');
  const [found, setFound] = useState<BuyProduct[]>([]);
  const [lines, setLines] = useState<BLine[]>([]);
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [key, setKey] = useState(newKey());   // one key for this order: a double tap makes one order
  const supplierId = supplier === '0' ? null : Number(supplier);
  const bad = poProblem(supplierId, lines);
  const edit = (next: BLine[]) => { setLines(next); setKey(newKey()); setProblem(''); };

  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { void api.get<BuyProduct[]>(`/wholesale/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text]);

  const save = async () => {
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const po = await api.post<PO>('/wholesale/purchase-orders', poBody(supplierId!, lines, { expected, notes }), { idempotencyKey: key });
      router.replace({ pathname: '/purchase-order/[id]', params: { id: String(po.po_id) } });
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the order'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>New order to a supplier</Title><Soft>It is saved as a draft until it is approved</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <SectionTitle>Supplier</SectionTitle>
          {suppliers.data && suppliers.data.length === 0 ? <Empty>Add a supplier first (More, then Suppliers and stock coming in).</Empty> : null}
          <Chips items={(suppliers.data ?? []).map((x) => ({ id: String(x.supplier_id), label: x.name }))} value={supplier} onChange={(v) => { setSupplier(v); setProblem(''); }} />
          <View style={{ padding: 16 }}>
            <SearchBox value={text} onChange={setText} placeholder="Search a product to order" label="Search a product" />
          </View>
          {found.map((p) => <Line key={p.product_id} left={p.name} sub={`Last price ${money(p.purchase_price)}${(p.units ?? []).length ? ` · ${p.units!.map((u) => `${u.unit_name} (${u.factor})`).join(', ')}` : ''}`} onPress={() => { edit(addBLine(lines, p)); setText(''); setFound([]); }} />)}

          <SectionTitle>This order</SectionTitle>
          {lines.length === 0 ? <Empty>Search a product above and tap it to add it.</Empty> : null}
          {lines.map((l) => (
            <View key={l.key} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 16, color: color.ink, flex: 1 }}>{l.product.name}</Text>
                <Text style={{ fontWeight: '600', color: color.ink }}>{money(lineCostRupees(l))}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput style={[s.input, { width: 100 }]} value={l.quantity} onChangeText={(v) => edit(setBQty(lines, l.key, v))} keyboardType="decimal-pad" accessibilityLabel={`How many ${l.product.name}`} />
                <Text style={{ color: color.soft, flex: 1 }}>{l.unit_name ?? l.product.unit ?? ''}{l.unit_name ? ` of ${qty(factorOf(l.product, l.unit_name))}` : ''}</Text>
                <Button title="Remove" kind="quiet" onPress={() => edit(dropBLine(lines, l.key))} />
              </View>
              <TextInput style={s.input} value={l.unit_cost} onChangeText={(v) => edit(setBCost(lines, l.key, v))} keyboardType="decimal-pad" placeholder="Cost of one (blank: the supplier's price list)" accessibilityLabel={`Cost of one ${l.product.name}`} />
              {(l.product.units ?? []).length > 0 ? <Chips items={[{ id: '', label: l.product.unit ?? 'Piece' }, ...(l.product.units ?? []).map((u) => ({ id: u.unit_name, label: `${u.unit_name} (${u.factor})` }))]} value={l.unit_name ?? ''} onChange={(v) => edit(setBUnit(lines, l.key, v || null))} /> : null}
            </View>
          ))}
          {lines.length ? (
            <View style={{ padding: 16, gap: 10 }}>
              <Soft>{`About ${money(orderEstimatePaise(lines) / 100)} before GST`}</Soft>
              <TextInput style={s.input} value={expected} onChangeText={setExpected} placeholder="Expected by, like 2026-10-20 (optional)" accessibilityLabel="Expected by" autoCapitalize="none" />
              <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note for the supplier (optional)" accessibilityLabel="Note" />
              <ErrorText>{problem}</ErrorText>
              <Button title="Save the order" onPress={() => { void save(); }} busy={busy} disabled={Boolean(bad)} />
            </View>
          ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
