import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { kvGet, kvSet, useScope } from '../lib/local.ts';
import { dayOf } from '../lib/till.ts';
import { refreshCounts, syncAll } from '../lib/sync.ts';
import { ensureVisit, fieldReceiptBody, sendOrQueue } from '../lib/field.ts';
import { goBack } from '../lib/nav.ts';
import { useSale } from '../lib/sale.ts';
import { useLoad } from '../lib/useLoad.ts';
import { METHOD_LABEL, collectBody, collectProblem, needsReference, spread, type Method, type OpenInvoice } from '../lib/wholesale.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const METHODS = (Object.keys(METHOD_LABEL) as Method[]).map((m) => ({ id: m, label: METHOD_LABEL[m] }));

/* A customer pays: the amount and how, then it settles their oldest bills first (or one bill you choose), and anything extra is kept as their advance. Sent once, even if you tap twice. */
export default function Collect() {
  const { customer } = useSale();
  const { field, beat } = useLocalSearchParams<{ field?: string; beat?: string }>();   // opened from a shop on the route: the payment is tied to the visit and kept for later when there is no signal
  const scope = useScope();
  const open = useLoad<{ advance: number; invoices: OpenInvoice[] }>(`wopen:${customer?.id}`, () => api.get(`/wholesale/customers/${customer!.id}/open-invoices`), Boolean(customer));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('CASH');
  const [reference, setReference] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [bank, setBank] = useState('');
  const [note, setNote] = useState('');
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const [key] = useState(newKey());   // one key for this receipt: a double tap or a retry makes one receipt

  const invoices = open.data?.invoices ?? [];
  const owed = invoices.reduce((a, i) => a + Math.round(i.balance * 100), 0) / 100;
  const plan = Number(amount) > 0 ? spread(invoiceId ? invoices.filter((i) => i.invoice_id === invoiceId) : invoices, Number(amount)) : [];

  const save = async () => {
    const bad = collectProblem(customer?.id ?? null, amount, method, reference);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      if (field && scope) {
        const deps = { api, actions: scope.actions, kv: { get: kvGet, set: kvSet } };
        const visit = await ensureVisit(deps, { date: dayOf(Date.now()), customerId: customer!.id, shopName: customer!.name, outcome: 'COLLECTION', beatId: beat ? Number(beat) : null });
        const sent = await sendOrQueue<{ receipt_number: string; allocated: number; advance: number }>(deps, { id: key, label: `Payment from ${customer!.name}: ${money(Number(amount))}`, method: 'POST', path: '/wholesale/receipts', body: fieldReceiptBody(customer!.id, amount, method, reference, visit.ref, note) });
        if (sent.kind === 'full') { setProblem('Too many changes are waiting to send. Connect to the internet before collecting more.'); return; }
        void refreshCounts(); void syncAll();
        setMade(sent.kind === 'sent' ? `${sent.data.receipt_number}: ${money(Number(amount))} received${sent.data.allocated > 0 ? `, ${money(sent.data.allocated)} put against bills` : ''}${sent.data.advance > 0 ? `, ${money(sent.data.advance)} kept as advance` : ''}.` : `${money(Number(amount))} from ${customer!.name} is saved on this phone. It is sent by itself when the signal is back.`);
        return;
      }
      const r = await api.post<{ receipt_number: string; allocated: number; advance: number }>('/wholesale/receipts', collectBody(customer!.id, amount, method, reference, { chequeDate, bank, notes: note, invoiceId }), { idempotencyKey: key });
      setMade(`${r.receipt_number}: ${money(Number(amount))} received${r.allocated > 0 ? `, ${money(r.allocated)} put against bills` : ''}${r.advance > 0 ? `, ${money(r.advance)} kept as advance` : ''}.`);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not record the payment'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Collect payment</Title><Soft>{customer ? customer.name : 'No customer chosen'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {made ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{made}</Text>
            <Button title="Done" onPress={() => goBack()} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <Button title={customer ? 'Change customer' : 'Choose customer'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} />
            </View>
            {customer && open.data ? <Soft style={{ padding: 16 }}>{owed > 0 ? `Owes ${money(owed)} on ${invoices.length} bill${invoices.length === 1 ? '' : 's'}.${open.data.advance > 0 ? ` Already paid ${money(open.data.advance)} in advance.` : ''}` : 'Nothing is owed right now. A payment will be kept as their advance.'}</Soft> : null}
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount received" accessibilityLabel="Amount received" />
              {owed > 0 ? <Button title={`Full amount owed (${money(owed)})`} kind="quiet" onPress={() => setAmount(String(owed))} /> : null}
            </View>
            <SectionTitle>How was it paid?</SectionTitle>
            <Chips<Method> items={METHODS} value={method} onChange={(m) => { setMethod(m); setProblem(''); }} />
            <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
              {needsReference(method) ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder={method === 'CHEQUE' ? 'Cheque number' : 'Transaction reference'} accessibilityLabel="Reference" autoCapitalize="characters" /> : null}
              {method === 'CHEQUE' ? (
                <>
                  <TextInput style={s.input} value={chequeDate} onChangeText={setChequeDate} placeholder="Cheque date, like 2026-10-20 (optional)" accessibilityLabel="Cheque date" autoCapitalize="none" />
                  <TextInput style={s.input} value={bank} onChangeText={setBank} placeholder="Bank (optional)" accessibilityLabel="Bank" />
                </>
              ) : null}
              <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="A note (optional)" accessibilityLabel="Note" />
            </View>

            {invoices.length > 1 ? (
              <>
                <SectionTitle>Put it against</SectionTitle>
                <Chips items={[{ id: '0', label: 'Oldest bills first' }, ...invoices.slice(0, 8).map((i) => ({ id: String(i.invoice_id), label: i.invoice_number }))]} value={String(invoiceId ?? 0)} onChange={(v) => setInvoiceId(v === '0' ? null : Number(v))} />
              </>
            ) : null}
            {plan.length > 0 ? (
              <>
                <SectionTitle>This will settle</SectionTitle>
                {plan.map((p) => <Line key={p.invoice.invoice_id} left={p.invoice.invoice_number} sub={`${money(p.invoice.balance)} owed`} right={money(p.pay)} />)}
                {(plan.advance ?? 0) > 0 ? <Soft style={{ padding: 16 }}>{`${money(plan.advance ?? 0)} more is kept as their advance for later bills.`}</Soft> : null}
              </>
            ) : null}
            {customer && open.data && invoices.length === 0 && Number(amount) > 0 ? <Empty>No unpaid bills: all of it is kept as their advance.</Empty> : null}

            <View style={{ padding: 16, gap: 8 }}>
              <ErrorText>{problem}</ErrorText>
              <Button title="Record the payment" onPress={() => { void save(); }} busy={busy} />
            </View>
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
