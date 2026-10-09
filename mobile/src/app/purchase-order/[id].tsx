import { useRef, useState } from 'react';
import { Alert, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { PO_LABEL, payBody, payProblem, poActions, type PO, type PayMethod } from '../../lib/purchasing.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const METHODS: { id: PayMethod; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'BANK_TRANSFER', label: 'Bank' }, { id: 'CHEQUE', label: 'Cheque' }];

/* One order to a supplier: what was ordered and what has arrived, the goods received so far, and what is paid. Approve it, send it to the supplier, receive goods against it, close it short, cancel it, or pay. */
export default function PurchaseOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const po = useLoad<PO>(`po:${id}`, () => api.get<PO>(`/wholesale/purchase-orders/${id}`));
  const p = po.data;
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [reference, setReference] = useState('');
  const keys = useRef<Record<string, string>>({});
  const keyFor = (what: string) => (keys.current[what] ??= newKey());

  const act = async (what: string, path: string, body: object = {}) => {
    setBusy(what); setProblem(''); setNote('');
    try { const r = await api.post<unknown>(`/wholesale/purchase-orders/${id}/${path}`, body, { idempotencyKey: keyFor(what) }); await po.refresh(); return r; }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); return null; }
    finally { setBusy(''); }
  };

  const run = (what: 'approve' | 'send' | 'receive' | 'close' | 'cancel') => {
    if (what === 'receive') return router.push({ pathname: '/goods-received', params: { po: String(id) } });
    if (what === 'send') return void (async () => { const r = await act('send', 'send', { email: true }) as { message?: string; emailed?: boolean } | null; if (r?.message) { setNote(r.emailed ? 'Emailed to the supplier.' : 'The message is ready to share.'); void Share.share({ message: r.message }); } })();
    if (what === 'close') return Alert.alert('Close this order?', 'No more goods are expected on it. What arrived stays.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Close it', onPress: () => { void act('close', 'close-short'); } }]);
    if (what === 'cancel') return Alert.alert('Cancel this order?', 'The supplier is not told by FlowXP: let them know.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel order', style: 'destructive', onPress: () => { void act('cancel', 'cancel', { reason: 'Cancelled from the phone' }); } }]);
    return void act('approve', 'approve');
  };

  const pay = async () => {
    const bad = payProblem(amount, p?.balance ?? 0) || (['UPI', 'BANK_TRANSFER', 'CHEQUE'].includes(method) && !reference.trim() ? 'Enter the payment reference' : '');
    if (bad) return setProblem(bad);
    const r = await act('pay', 'payments', payBody(amount, method, reference));
    if (r) { setPaying(false); setAmount(''); setReference(''); setNote('Payment recorded.'); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{p?.po_number ?? 'Order'}</Title>{p ? <Soft>{`${p.supplier} · ${String(p.po_date).slice(0, 10)}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {po.busy && !p ? <Loading /> : null}
        {po.error && !p ? <Failed message={po.error} onRetry={() => { void po.refresh(); }} /> : null}
        {p ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16, gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: p.status === 'CANCELLED' ? color.danger : color.ink }}>{PO_LABEL[p.status]}</Text>
              <Text style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{money(p.total)}</Text>
              <Soft>{`Items ${money(p.subtotal)} · GST ${money(p.tax)}${p.paid > 0 ? ` · paid ${money(p.paid)}` : ''}`}</Soft>
              {p.balance > 0 && ['PARTIAL', 'RECEIVED'].includes(p.status) ? <Text style={{ color: color.warn, fontWeight: '700' }}>{`You owe ${money(p.balance)}${p.due_date ? `, due ${String(p.due_date).slice(0, 10)}` : ''}`}</Text> : null}
              {p.expected_date ? <Soft>{`Expected ${String(p.expected_date).slice(0, 10)}`}</Soft> : null}
              {p.supplier_invoice_no ? <Soft>{`Supplier's bill ${p.supplier_invoice_no}`}</Soft> : null}
              {p.notes ? <Soft>{p.notes}</Soft> : null}
            </View>

            <SectionTitle>Products</SectionTitle>
            {(p.items ?? []).map((i) => (
              <Line key={i.item_id} left={i.description} sub={`${qty(i.ordered)} ${i.unit_name} ordered · ${qty(i.received)} arrived${i.outstanding > 0 && p.status !== 'DRAFT' ? ` · ${qty(i.outstanding)} still due` : ''}`} right={i.unit_cost ? money(i.unit_cost) : undefined} />
            ))}

            {(p.grns ?? []).length ? <SectionTitle>Goods received</SectionTitle> : null}
            {(p.grns ?? []).map((g) => <Line key={g.grn_id} left={g.grn_number} sub={`${String(g.grn_date).slice(0, 10)}${g.supplier_invoice_no ? ` · bill ${g.supplier_invoice_no}` : ''}`} right={money(g.total_cost)} />)}
            {(p.payments ?? []).length ? <SectionTitle>Paid</SectionTitle> : null}
            {(p.payments ?? []).map((x) => <Line key={x.payment_id} left={`${x.method.replace('_', ' ').toLowerCase()}${x.reference ? ` · ${x.reference}` : ''}`} sub={String(x.date).slice(0, 10)} right={money(x.amount)} />)}

            <View style={{ padding: 16, gap: 8 }}>
              <ErrorText>{problem}</ErrorText>
              {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}
              {poActions(p.status).map((a) => <Button key={a.id} title={a.label} kind={a.id === 'cancel' ? 'danger' : a.id === 'approve' || a.id === 'receive' ? 'primary' : 'quiet'} busy={busy === a.id || (a.id === 'close' && busy === 'close') || (a.id === 'send' && busy === 'send')} onPress={() => run(a.id)} />)}
              {p.balance > 0 && ['PARTIAL', 'RECEIVED'].includes(p.status) ? (
                paying ? (
                  <View style={{ gap: 8 }}>
                    <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount paid" accessibilityLabel="Amount paid" />
                    <Button title={`All of it (${money(p.balance)})`} kind="quiet" onPress={() => setAmount(String(p.balance))} />
                    <Chips<PayMethod> items={METHODS} value={method} onChange={setMethod} />
                    {method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Payment reference" accessibilityLabel="Payment reference" /> : null}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button title="Record the payment" onPress={() => { void pay(); }} busy={busy === 'pay'} style={{ flex: 1 }} />
                      <Button title="Not now" kind="quiet" onPress={() => { setPaying(false); setProblem(''); }} />
                    </View>
                  </View>
                ) : <Button title="Pay the supplier" kind="quiet" onPress={() => setPaying(true)} />
              ) : null}
              {p.status === 'DRAFT' ? <Soft>Approving needs the purchase manager's right. Without it, the order stays a draft for them.</Soft> : null}
            </View>
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
