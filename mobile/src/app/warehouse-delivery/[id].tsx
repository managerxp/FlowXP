import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { DELIVERY_LABEL, deliveryActions, deliveryBody, deliveryProblem, type Delivery, type DeliveryAction } from '../../lib/warehouse.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

/* A delivery on the road: out for delivery, then delivered (who received it) or could not deliver (why). A shop that refused some of the goods is handled on the website, which makes the credit note. */
export default function DeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useLoad<Delivery>(`wh-delivery:${id}`, () => api.get<Delivery>(`/wholesale/deliveries/${id}`));
  const x = d.data;
  const [asking, setAsking] = useState<DeliveryAction | null>(null);
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const keys = useRef<Record<string, string>>({});

  const go = async (a: DeliveryAction) => {
    if (a.ask && asking?.to !== a.to) { setAsking(a); setProblem(''); return; }
    const bad = deliveryProblem(a, who, reason);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const sig = `${a.to}:${who}:${reason}`;
      await api.post(`/wholesale/deliveries/${id}/status`, deliveryBody(a, who, note, reason), { idempotencyKey: (keys.current[sig] ??= newKey()) });
      setAsking(null); setWho(''); setNote(''); setReason(''); await d.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{x?.challan_number ?? 'Delivery'}</Title>{x ? <Soft>{`${x.customer} · ${x.order_number}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {d.busy && !x ? <Loading /> : null}
        {d.error && !x ? <Failed message={d.error} onRetry={() => { void d.refresh(); }} /> : null}
        {x ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16, gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: x.status === 'FAILED' ? color.danger : x.status === 'DELIVERED' ? color.ok : color.ink }}>{DELIVERY_LABEL[x.status]}</Text>
              {x.invoice_number ? <Soft>{`Bill ${x.invoice_number}${x.invoice_total != null ? ` · ${rupees(toPaise(x.invoice_total))}` : ''}`}</Soft> : null}
              <Soft>{[x.vehicle_no, x.driver_name, x.driver_phone].filter(Boolean).join(' · ') || 'No vehicle or driver yet'}</Soft>
              {x.delivery_address ? <Soft>{x.delivery_address}</Soft> : null}
              <Soft>{`Sent ${String(x.dispatch_date).slice(0, 10)}${x.expected_date ? ` · expected ${String(x.expected_date).slice(0, 10)}` : ''} · ${x.packages_count} package${x.packages_count === 1 ? '' : 's'}`}</Soft>
              {x.pod_received_by ? <Soft>{`Received by ${x.pod_received_by}`}</Soft> : null}
              {x.failure_reason ? <Text style={{ color: color.danger }}>{x.failure_reason}</Text> : null}
            </View>
            {x.invoice_id ? <View style={{ padding: 16 }}><Button title="Open the bill" kind="quiet" onPress={() => router.push({ pathname: '/receipt', params: { id: String(x.invoice_id) } })} /></View> : null}

            {deliveryActions(x.status).length ? <SectionTitle>What happened?</SectionTitle> : null}
            <View style={{ padding: 16, gap: 10 }}>
              {asking?.ask === 'name' ? (
                <>
                  <TextInput style={s.input} value={who} onChangeText={setWho} placeholder="Who received it?" accessibilityLabel="Who received it" />
                  <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="A note (optional)" accessibilityLabel="Note" />
                </>
              ) : null}
              {asking?.ask === 'reason' ? <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Why? (a few words)" accessibilityLabel="Why" /> : null}
              <ErrorText>{problem}</ErrorText>
              {deliveryActions(x.status).map((a) => <Button key={a.to} title={asking?.to === a.to ? `Confirm: ${a.label}` : a.label} kind={a.to === 'DELIVERED' || a.to === 'OUT_FOR_DELIVERY' ? 'primary' : 'quiet'} busy={busy} onPress={() => { void go(a); }} />)}
              {asking ? <Button title="Not now" kind="quiet" onPress={() => { setAsking(null); setProblem(''); }} /> : null}
              {x.status === 'DELIVERED' || x.status === 'RETURNED' ? <Soft>This delivery is finished.</Soft> : null}
              {x.status === 'OUT_FOR_DELIVERY' ? <Soft>If the shop refused some of the goods, finish it on the FlowXP website: it makes the credit note and takes the goods back into stock.</Soft> : null}
            </View>
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
