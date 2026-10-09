import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { kvGet, kvSet, useScope } from '../../lib/local.ts';
import { setCustomer } from '../../lib/sale.ts';
import { dayOf } from '../../lib/till.ts';
import { refreshCounts, syncAll } from '../../lib/sync.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { NO_SALE_OUTCOMES, OUTCOME_LABEL, ensureVisit, type FieldShop, type Outcome } from '../../lib/field.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* The shop in front of you: what they owe, their credit, their last orders and visits. Take an order, collect a payment, or record why there was no sale. */
export default function FieldShopScreen() {
  const { id, beat } = useLocalSearchParams<{ id: string; beat?: string }>();
  const scope = useScope();
  const shop = useLoad<FieldShop>(`field-shop:${id}`, () => api.get<FieldShop>(`/distributor/field/customers/${id}`));
  const [outcome, setOutcome] = useState<Outcome>('NO_ORDER');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const x = shop.data;

  const go = (path: '/field-order' | '/collect') => { if (x) { setCustomer({ id: x.customer.customer_id, name: x.customer.name, phone: x.customer.phone }); router.push({ pathname: path, params: { beat: beat ?? '', field: '1' } }); } };

  const record = async () => {
    if (!scope || !x) return;
    setBusy(true); setProblem(''); setNote('');
    try {
      const v = await ensureVisit({ api, actions: scope.actions, kv: { get: kvGet, set: kvSet } }, { date: dayOf(Date.now()), customerId: x.customer.customer_id, shopName: x.customer.name, outcome, beatId: beat ? Number(beat) : null, notes, nextVisit: next });
      setNote(v.sent ? 'Visit recorded.' : 'Saved on this phone. It is sent by itself when the signal is back.');
      void refreshCounts(); void syncAll();
    } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not record the visit'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{x?.customer.name ?? 'Shop'}</Title>{x ? <Soft>{[x.customer.contact_person, x.customer.phone, x.customer.city].filter(Boolean).join(' · ')}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={shop.savedAt} />
        {shop.busy && !x ? <Loading /> : null}
        {shop.error && !x ? <Failed message={shop.error} onRetry={() => { void shop.refresh(); }} /> : null}
        {x ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button title="Take an order" onPress={() => go('/field-order')} style={{ flex: 1 }} />
              <Button title="Collect payment" kind="quiet" onPress={() => go('/collect')} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
              <Stat label="Owes" value={money(x.credit.outstanding)} tone={x.credit.outstanding > 0 ? color.warn : undefined} />
              <Stat label="Overdue" value={money(x.credit.overdue)} tone={x.credit.overdue > 0 ? color.danger : undefined} />
              {x.credit.limit > 0 ? <Stat label="Credit limit" value={money(x.credit.limit)} note={x.credit.available != null ? `${money(x.credit.available)} left` : undefined} /> : null}
            </View>
            {x.customer.payment_terms_days != null ? <Soft style={{ paddingHorizontal: 16 }}>{`Pays in ${x.customer.payment_terms_days} days`}</Soft> : null}

            <SectionTitle>Not buying today?</SectionTitle>
            <Chips<Outcome> items={NO_SALE_OUTCOMES.map((o) => ({ id: o, label: OUTCOME_LABEL[o] }))} value={outcome} onChange={setOutcome} />
            <View style={{ padding: 16, gap: 10 }}>
              <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" />
              {outcome === 'FOLLOW_UP' ? <TextInput style={s.input} value={next} onChangeText={setNext} placeholder="Come back on, like 2026-10-15" accessibilityLabel="Come back on" autoCapitalize="none" /> : null}
              <ErrorText>{problem}</ErrorText>
              {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}
              <Button title="Record the visit" kind="quiet" onPress={() => { void record(); }} busy={busy} />
            </View>

            <SectionTitle>Bills not yet paid</SectionTitle>
            {x.open_invoices.length === 0 ? <Soft style={{ padding: 16 }}>Nothing is owed.</Soft> : null}
            {x.open_invoices.map((i) => <Line key={i.invoice_id} left={i.invoice_number} sub={`${String(i.invoice_date).slice(0, 10)}${i.due_date ? ` · due ${String(i.due_date).slice(0, 10)}` : ''}${i.overdue ? ' · late' : ''}`} right={money(i.balance)} />)}

            <SectionTitle>Last orders</SectionTitle>
            {x.orders.length === 0 ? <Soft style={{ padding: 16 }}>No orders yet.</Soft> : null}
            {x.orders.map((o) => <Line key={o.order_id} left={o.order_number} sub={`${String(o.order_date).slice(0, 10)} · ${o.status.toLowerCase().replace(/_/g, ' ')}`} right={money(o.total)} />)}

            <SectionTitle>Last visits</SectionTitle>
            {x.visits.length === 0 ? <Soft style={{ padding: 16 }}>No visits yet.</Soft> : null}
            {x.visits.map((v) => <Line key={v.visit_id} left={`${String(v.visit_date).slice(0, 10)} · ${OUTCOME_LABEL[v.outcome]}`} sub={[v.notes, v.order_value > 0 ? `order ${money(v.order_value)}` : null, v.collection > 0 ? `collected ${money(v.collection)}` : null].filter(Boolean).join(' · ') || undefined} />)}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
