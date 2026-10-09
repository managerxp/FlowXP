import { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { REFUND_LABEL, returnBody, returnEstimatePaise, returnProblem, type Refund, type ReturnOptions } from '../lib/buying.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const REASONS = ['Wrong item', 'Damaged', 'Customer changed mind', 'Not as expected'];

/* A customer brings something back: choose the items, say why, and give money back or take it off what they owe. The shop's credit note is made for you. */
export default function Return() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const opts = useLoad<ReturnOptions>(`return:${id}`, () => api.get<ReturnOptions>(`/invoices/${id}/credit-notes/options`));
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<Refund | null>(null);
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const [key] = useState(newKey());   // one key for this return: a double tap makes one credit note

  const o = opts.data;
  const lines = (o?.items ?? []).filter((l) => l.remaining > 0);
  const method: Refund = refund ?? (o && o.refundable > 0 ? 'CASH' : 'NONE');
  const bump = (itemId: number, max: number, by: number) => setChosen((c) => ({ ...c, [itemId]: Math.max(0, Math.min(max, (c[itemId] ?? 0) + by)) }));
  const estimate = o ? returnEstimatePaise(lines, chosen) : 0;

  const save = async () => {
    if (!o) return;
    const bad = returnProblem(lines, chosen, reason);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const note = await api.post<{ cn_number: string; total: number; refunded: number }>(`/invoices/${id}/credit-notes`, returnBody(lines, chosen, reason, method, restock), { idempotencyKey: key });
      setMade(`${note.cn_number}: ${rupees(toPaise(note.total))} credited${note.refunded > 0 ? `, ${rupees(toPaise(note.refunded))} paid back` : ''}.`);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not make the return'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Return items</Title><Soft>Choose what comes back</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {opts.busy && !o ? <Loading /> : null}
        {opts.error && !o ? <Failed message={opts.error} onRetry={() => { void opts.refresh(); }} /> : null}
        {made ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{made}</Text>
            <Button title="Done" onPress={() => goBack()} />
          </View>
        ) : o ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            {!o.can_issue ? <Empty>This bill was cancelled, so nothing can be returned from it.</Empty> : null}
            {o.can_issue && lines.length === 0 ? <Empty>Everything on this bill has already been returned.</Empty> : null}
            {o.can_issue && lines.length ? (
              <>
                <SectionTitle>Tap + on what is coming back</SectionTitle>
                {lines.map((l) => {
                  const n = chosen[l.item_id] ?? 0;
                  return (
                    <View key={l.item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingHorizontal: 16, borderTopWidth: 1, borderColor: color.line, backgroundColor: n ? '#eaf1ff' : color.card }}>
                      <View style={{ flex: 1 }}><Text style={{ fontSize: 16, color: color.ink }}>{l.description}</Text><Soft>{qty(l.remaining)} can still be returned · {rupees(toPaise(l.unit_total))} each</Soft></View>
                      <Button title="−" kind="quiet" onPress={() => bump(l.item_id, l.remaining, -1)} disabled={n === 0} />
                      <Text style={{ minWidth: 24, textAlign: 'center', fontWeight: '700', color: color.ink }}>{n}</Text>
                      <Button title="+" kind="quiet" onPress={() => bump(l.item_id, l.remaining, 1)} disabled={n >= l.remaining} />
                    </View>
                  );
                })}
                <SectionTitle>Why</SectionTitle>
                <Chips items={REASONS.map((r) => ({ id: r, label: r }))} value={REASONS.includes(reason) ? reason : ''} onChange={setReason} />
                <View style={{ padding: 16 }}><TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Or type the reason" accessibilityLabel="Reason" /></View>
                <SectionTitle>Money</SectionTitle>
                {o.balance_due > 0 ? <Soft style={{ paddingHorizontal: 16, paddingBottom: 6 }}>{rupees(toPaise(o.balance_due))} is still owed on this bill. The return comes off that first.</Soft> : null}
                <Chips<Refund> items={(['CASH', 'UPI', 'CARD', 'NONE'] as Refund[]).map((r) => ({ id: r, label: REFUND_LABEL[r] }))} value={method} onChange={setRefund} />
                {lines.some((l) => l.tracks_stock) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 16 }}>
                    <Text style={{ color: color.ink, flex: 1 }}>Put the items back in stock</Text>
                    <Switch value={restock} onValueChange={setRestock} accessibilityLabel="Put the items back in stock" />
                  </View>
                ) : null}
                <View style={{ padding: 16, gap: 8 }}>
                  <Soft>About {rupees(estimate)} comes back. The exact amount, with GST and any discount, is worked out when you confirm.</Soft>
                  <ErrorText>{problem}</ErrorText>
                  <Button title="Confirm the return" onPress={() => { void save(); }} busy={busy} />
                </View>
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
