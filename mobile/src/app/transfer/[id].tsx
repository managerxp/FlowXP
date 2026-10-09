import { useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { STATUS_LABEL, receiveBody, receiveProblem, receiveSummary, setDamaged, setGood, shortBy, startReceive, transferActions, type RLine, type TransferDetail } from '../../lib/transfers.ts';
import { qty } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

/* One transfer: what is moving and where, with the buttons that fit where it is: send it, mark it received (and say what was short or damaged), or cancel it. */
export default function TransferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useLoad<TransferDetail>(`transfer:${id}`, () => api.get<TransferDetail>(`/wholesale/transfers/${id}`));
  const x = t.data;
  const [receiving, setReceiving] = useState<RLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const key = useRef(newKey());

  const act = async (what: 'dispatch' | 'receive' | 'cancel', body?: unknown) => {
    setBusy(true); setProblem('');
    try { await api.post(`/wholesale/transfers/${id}/${what}`, body ?? {}, { idempotencyKey: key.current }); key.current = newKey(); setReceiving(null); await t.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(false); }
  };
  const bad = receiving ? receiveProblem(receiving) : '';
  const cancel = () => Alert.alert(x?.status === 'IN_TRANSIT' ? 'Cancel this transfer?' : 'Drop this transfer?', x?.status === 'IN_TRANSIT' ? 'The goods go back into the warehouse they left.' : 'Nothing has left the warehouse yet.', [
    { text: 'Keep it', style: 'cancel' }, { text: 'Yes, cancel', style: 'destructive', onPress: () => { void act('cancel'); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{x?.transfer_number ?? 'Transfer'}</Title>{x ? <Soft>{`${x.from_warehouse} to ${x.to_warehouse}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {t.busy && !x ? <Loading /> : null}
        {t.error && !x ? <Failed message={t.error} onRetry={() => { void t.refresh(); }} /> : null}
        {x ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={{ paddingHorizontal: 16, gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: x.status === 'RECEIVED' ? color.ok : x.status === 'CANCELLED' ? color.danger : color.ink }}>{STATUS_LABEL[x.status]}</Text>
              <Soft>{[x.vehicle_no ? `Vehicle ${x.vehicle_no}` : null, x.dispatched_at ? `sent ${String(x.dispatched_at).slice(0, 10)}` : null, x.received_at ? `received ${String(x.received_at).slice(0, 10)}` : null, x.notes].filter(Boolean).join(' · ')}</Soft>
            </View>

            {!receiving ? (
              <>
                <SectionTitle>Items</SectionTitle>
                {x.items.map((i) => (
                  <Line key={i.item_id} left={i.product}
                    sub={x.status === 'RECEIVED' ? `Arrived ${qty(i.received_base)}${i.damaged_base > 0 ? ` · damaged ${qty(i.damaged_base)}` : ''}${(i.short_base ?? 0) > 0 ? ` · short ${qty(i.short_base ?? 0)}` : ''}` : i.batches.length ? i.batches.map((b) => `batch ${b.batch_no}`).join(', ') : undefined}
                    right={`${qty(i.qty_base)} ${i.unit ?? ''}`} />
                ))}
                <View style={{ padding: 16, gap: 10 }}>
                  <ErrorText>{problem}</ErrorText>
                  {transferActions(x).map((a) => (
                    <Button key={a.id} title={a.label} kind={a.id === 'cancel' ? 'danger' : 'primary'} busy={busy}
                      onPress={() => { if (a.id === 'send') void act('dispatch'); else if (a.id === 'receive') { setReceiving(startReceive(x.items)); setProblem(''); } else cancel(); }} />
                  ))}
                </View>
              </>
            ) : (
              <>
                <SectionTitle>What arrived?</SectionTitle>
                <Soft style={{ paddingHorizontal: 16 }}>Everything is filled in as arrived in good condition. Change only what is different.</Soft>
                {receiving.map((l) => (
                  <View key={l.item.item_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: shortBy(l) > 0 || Number(l.damaged) > 0 ? '#fff7ed' : color.card, marginTop: 8 }}>
                    <Text style={{ fontSize: 16, color: color.ink }}>{l.item.product}</Text>
                    <Soft>{`${qty(l.item.qty_base)} ${l.item.unit ?? ''} were sent`}</Soft>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={{ flex: 1, gap: 4 }}><Soft>Good</Soft><TextInput style={s.input} value={l.good} onChangeText={(v) => { setReceiving(setGood(receiving, l.item.item_id, v)); setProblem(''); }} keyboardType="decimal-pad" accessibilityLabel={`${l.item.product} arrived in good condition`} /></View>
                      <View style={{ flex: 1, gap: 4 }}><Soft>Damaged</Soft><TextInput style={s.input} value={l.damaged} onChangeText={(v) => { setReceiving(setDamaged(receiving, l.item.item_id, v)); setProblem(''); }} keyboardType="decimal-pad" accessibilityLabel={`${l.item.product} arrived damaged`} /></View>
                    </View>
                    {shortBy(l) > 0 ? <Text style={{ color: color.warn, fontWeight: '600' }}>{`${qty(shortBy(l))} did not arrive`}</Text> : null}
                  </View>
                ))}
                <View style={{ padding: 16, gap: 10 }}>
                  <Soft>{receiveSummary(receiving)}</Soft>
                  <ErrorText>{bad || problem}</ErrorText>
                  <Button title="Confirm: it has arrived" onPress={() => { void act('receive', receiveBody(receiving)); }} busy={busy} disabled={Boolean(bad)} />
                  <Button title="Back" kind="quiet" onPress={() => setReceiving(null)} />
                </View>
              </>
            )}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
