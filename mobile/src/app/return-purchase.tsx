import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { PO } from '../lib/purchasing.ts';
import { REASONS, REASON_LABEL, editP, purchaseReturnBody, purchaseReturnProblem, sentence, startPurchaseLines, type PRLine, type Reason } from '../lib/returns.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* Goods go back to a supplier. Choose the order they came on, how many of each go back and why. FlowXP makes the debit note (you owe them less) and takes the stock off. */
export default function ReturnPurchase() {
  const [poId, setPoId] = useState<number | null>(null);
  const orders = useLoad<PO[]>('ret-pos', () => api.get<PO[]>('/wholesale/purchase-orders?status=PARTIAL,RECEIVED&limit=50'), poId == null);
  const po = useLoad<PO>(`ret-po:${poId}`, () => api.get<PO>(`/wholesale/purchase-orders/${poId}`), poId != null);
  const [lines, setLines] = useState<PRLine[]>([]);
  const [reason, setReason] = useState<Reason | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const key = useRef(newKey());

  const shown = lines.length ? lines : po.data ? startPurchaseLines((po.data.items ?? []).map((i) => ({ item_id: i.item_id, description: i.description, unit_name: i.unit_name, received: i.received, product_id: i.product_id }))) : [];
  const bad = purchaseReturnProblem(shown, reason);

  const save = async () => {
    if (bad || !po.data) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const r = await api.post<{ return_number: string; debit_note_total: number; credit_with_supplier: number }>('/wholesale/returns/purchase', purchaseReturnBody(po.data.po_id, shown, reason!, notes), { idempotencyKey: key.current });
      setMade(sentence(r, money));
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not send the goods back'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Send back to a supplier</Title><Soft>{po.data ? `${po.data.po_number} · ${po.data.supplier}` : 'Choose the order the goods came on'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {made ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{made}</Text>
            <Button title="Done" onPress={() => router.replace('/returns')} />
          </View>
        ) : poId == null ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            {orders.error && !orders.data ? <Failed message={orders.error} onRetry={() => { void orders.refresh(); }} /> : null}
            {orders.busy && !orders.data ? <Loading /> : null}
            {orders.data && orders.data.length === 0 ? <Empty>No order has had goods delivered yet.</Empty> : null}
            {(orders.data ?? []).map((o) => <Line key={o.po_id} left={`${o.po_number} · ${o.supplier}`} sub={`${String(o.po_date).slice(0, 10)}${o.balance > 0 ? ` · you owe ${money(o.balance)}` : ''}`} right={money(o.total)} onPress={() => setPoId(o.po_id)} />)}
          </ScrollView>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            {po.busy && !po.data ? <Loading /> : null}
            {po.error && !po.data ? <Failed message={po.error} onRetry={() => { void po.refresh(); }} /> : null}
            {po.data && shown.length === 0 ? <Empty>Nothing has arrived on this order, so nothing can go back.</Empty> : null}
            {shown.length ? (
              <>
                <SectionTitle>Why are they going back?</SectionTitle>
                <Chips<Reason> items={REASONS.filter((r) => r !== 'CUSTOMER_REJECTION').map((r) => ({ id: r, label: REASON_LABEL[r] }))} value={reason ?? ('' as Reason)} onChange={(r) => { setReason(r); key.current = newKey(); }} />
                <SectionTitle>How many of each go back?</SectionTitle>
                {shown.map((l) => (
                  <View key={l.item.item_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: Number(l.qty) > 0 ? '#eaf1ff' : color.card }}>
                    <Text style={{ fontSize: 16, color: color.ink }}>{l.item.description}</Text>
                    <Soft>{`${qty(l.item.received)} ${l.item.unit_name} arrived on this order`}</Soft>
                    <TextInput style={[s.input, { width: 120 }]} value={l.qty} onChangeText={(v) => { setLines(editP(shown, l.item.item_id, v)); key.current = newKey(); setProblem(''); }} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={`How many ${l.item.description} go back`} />
                  </View>
                ))}
                <View style={{ padding: 16, gap: 10 }}>
                  <Soft>The oldest stock goes back first. Stock that is promised to customers cannot be sent back.</Soft>
                  <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" />
                  <ErrorText>{problem}</ErrorText>
                  <Button title="Confirm: send it back" onPress={() => { void save(); }} busy={busy} disabled={Boolean(bad)} />
                </View>
              </>
            ) : null}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
