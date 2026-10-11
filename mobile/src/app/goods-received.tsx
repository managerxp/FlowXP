import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { acceptedOf, directLine, editR, grnBody, grnProblem, linesFromPO, rLineProblem, stillDue, type BuyProduct, type PO, type PayMethod, type RLine, type Supplier } from '../lib/purchasing.ts';
import { qty } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { SearchBox } from '../lib/SearchBox.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const METHODS: { id: PayMethod; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'BANK_TRANSFER', label: 'Bank' }];

/* A delivery arrives. Against an order: each line starts as everything still due; type what really arrived, what was damaged, and the batch and use-by date. With no order: choose the supplier and add what came. Stock goes up, and customers waiting on those goods are given them. */
export default function GoodsReceived() {
  const { po: poId } = useLocalSearchParams<{ po?: string }>();
  const order = useLoad<PO>(`po:${poId}`, () => api.get<PO>(`/wholesale/purchase-orders/${poId}`), Boolean(poId));
  const suppliers = useLoad<Supplier[]>('wh-suppliers', () => api.get<Supplier[]>('/wholesale/suppliers?limit=100'), !poId);
  const [lines, setLines] = useState<RLine[]>([]);
  const [supplier, setSupplier] = useState('0');
  const [text, setText] = useState('');
  const [found, setFound] = useState<BuyProduct[]>([]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [extra, setExtra] = useState(false);
  const [closePO, setClosePO] = useState(false);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const [key] = useState(newKey());   // one key for this delivery: a double tap or a retry records it once

  useEffect(() => { if (order.data && lines.length === 0) setLines(linesFromPO(order.data)); }, [order.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (poId || text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { void api.get<BuyProduct[]>(`/wholesale/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text, poId]);

  const supplierId = poId ? (order.data?.supplier_id ?? null) : supplier === '0' ? null : Number(supplier);
  const edit = (k: string, patch: Partial<RLine>) => { setLines((l) => editR(l, k, patch)); setProblem(''); };
  const arrived = lines.filter((l) => Number(l.received) > 0).length;

  const save = async () => {
    const bad = grnProblem(lines, today(), extra, supplierId, Boolean(poId)) || (Number(paid) > 0 && method !== 'CASH' && !reference.trim() ? 'Enter the payment reference' : '');
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const g = await api.post<{ grn_number: string; order_status?: string; back_orders_filled?: unknown[] }>('/wholesale/grns', grnBody({ poId: poId ? Number(poId) : null, supplierId, lines, invoiceNo, invoiceDate, allowExcess: extra, closePO, paid, method, reference }), { idempotencyKey: key });
      const filled = g.back_orders_filled?.length ?? 0;
      setMade(`${g.grn_number} is recorded. Stock is updated${g.order_status === 'PARTIAL' ? ' and the order is part delivered' : g.order_status === 'RECEIVED' ? ' and the order is complete' : ''}${filled ? `. ${filled} waiting customer order${filled === 1 ? ' was' : 's were'} given their goods` : ''}.`);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not record the delivery'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Goods received</Title><Soft>{order.data ? `${order.data.po_number} · ${order.data.supplier}` : 'A delivery with no order'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {made ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{made}</Text>
            <Button title="Done" onPress={() => { if (poId) router.replace({ pathname: '/purchase-order/[id]', params: { id: poId } }); else goBack(); }} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            {!poId ? (
              <>
                <SectionTitle>From</SectionTitle>
                <Chips items={(suppliers.data ?? []).map((x) => ({ id: String(x.supplier_id), label: x.name }))} value={supplier} onChange={setSupplier} />
                <View style={{ padding: 16 }}><SearchBox value={text} onChange={setText} placeholder="Search a product to add" label="Search a product" /></View>
                {found.map((p) => <Line key={p.product_id} left={p.name} sub="Tap to add" onPress={() => { setLines((l) => [...l, directLine(p, null)]); setText(''); setFound([]); }} />)}
              </>
            ) : null}
            {lines.length === 0 ? <Empty>{poId ? (order.data ? 'Everything on this order has already arrived.' : 'Loading the order…') : 'Search a product above and tap it to add it.'}</Empty> : null}

            {lines.map((l) => {
              const warn = rLineProblem(l, today(), extra);
              const tracked = l.batch_tracking || l.expiry_tracking;
              return (
                <View key={l.key} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{l.name}</Text>
                  {l.outstanding != null ? <Soft>{`${qty(l.ordered ?? 0)} ordered · ${qty(l.outstanding)} still due${stillDue(l) > 0 && Number(l.received) > 0 ? ` · ${qty(stillDue(l))} would still be due after this` : ''}`}</Soft> : null}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={l.received} onChangeText={(v) => edit(l.key, { received: v })} keyboardType="decimal-pad" placeholder={`How many ${l.unit_name} arrived`} accessibilityLabel={`How many ${l.name} arrived`} />
                    <TextInput style={[s.input, { flex: 1 }]} value={l.damaged} onChangeText={(v) => edit(l.key, { damaged: v })} keyboardType="decimal-pad" placeholder="Damaged" accessibilityLabel={`How many ${l.name} were damaged`} />
                  </View>
                  {Number(l.damaged) > 0 ? <Soft>{`${qty(acceptedOf(l))} ${l.unit_name} go into stock; the damaged ones are not paid for`}</Soft> : null}
                  <TextInput style={s.input} value={l.unit_cost} onChangeText={(v) => edit(l.key, { unit_cost: v })} keyboardType="decimal-pad" placeholder={l.po_item_id ? 'Cost of one, if different from the order (optional)' : 'Cost of one'} accessibilityLabel={`Cost of one ${l.name}`} />
                  {tracked ? (
                    <>
                      <TextInput style={s.input} value={l.batch_no} onChangeText={(v) => edit(l.key, { batch_no: v })} autoCapitalize="characters" placeholder="Batch number" accessibilityLabel={`Batch number of ${l.name}`} />
                      {l.expiry_tracking ? <TextInput style={s.input} value={l.expiry} onChangeText={(v) => edit(l.key, { expiry: v })} placeholder="Use by, like 03/2027" accessibilityLabel={`Use-by date of ${l.name}`} autoCapitalize="none" /> : null}
                    </>
                  ) : null}
                  {Number(l.received) > 0 && warn ? <Text style={{ color: color.warn }}>{warn}</Text> : null}
                </View>
              );
            })}

            {lines.length ? (
              <View style={{ padding: 16, gap: 10 }}>
                <Soft>{`${arrived} product${arrived === 1 ? '' : 's'} arrived`}</Soft>
                <TextInput style={s.input} value={invoiceNo} onChangeText={setInvoiceNo} placeholder="Supplier's bill number (optional)" accessibilityLabel="Supplier bill number" />
                <TextInput style={s.input} value={invoiceDate} onChangeText={setInvoiceDate} placeholder="Supplier's bill date, like 2026-10-08 (optional)" accessibilityLabel="Supplier bill date" autoCapitalize="none" />
                {poId ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                      <Text style={{ color: color.ink, flex: 1 }}>Accept more than was ordered</Text>
                      <Switch value={extra} onValueChange={setExtra} accessibilityLabel="Accept more than was ordered" />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                      <Text style={{ color: color.ink, flex: 1 }}>Close the order: no more is coming</Text>
                      <Switch value={closePO} onValueChange={setClosePO} accessibilityLabel="Close the order" />
                    </View>
                  </>
                ) : null}
                <TextInput style={s.input} value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder="Paid now (optional)" accessibilityLabel="Paid now" />
                {Number(paid) > 0 ? <Chips<PayMethod> items={METHODS} value={method} onChange={setMethod} /> : null}
                {Number(paid) > 0 && method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Payment reference" accessibilityLabel="Payment reference" /> : null}
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
