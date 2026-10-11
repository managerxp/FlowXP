import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useSale } from '../lib/sale.ts';
import { useLoad } from '../lib/useLoad.ts';
import { DISPOSITION_LABEL, REASONS, REASON_LABEL, REFUNDS, creditEstimatePaise, editS, salesReturnBody, salesReturnProblem, sentence, startLines, withReason, type Disposition, type InvoiceRow, type Reason, type Returnable, type SLine } from '../lib/returns.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const DISPOSITIONS: Disposition[] = ['RESTOCK', 'DAMAGED', 'EXPIRED', 'NONE'];

/* A shop sends goods back. Choose the shop and the bill, say how many of each item and why, and where the goods go (back on the shelf, damaged, expired, or not coming back). FlowXP makes the credit note, reverses the GST exactly, reduces what they owe, and updates stock. */
export default function ReturnSale() {
  const { invoice: invoiceParam } = useLocalSearchParams<{ invoice?: string }>();
  const { customer } = useSale();
  const [invoiceId, setInvoiceId] = useState<number | null>(invoiceParam ? Number(invoiceParam) : null);
  const bills = useLoad<InvoiceRow[]>(`ret-bills:${customer?.id}`, () => api.get<InvoiceRow[]>(`/wholesale/customers/${customer!.id}/invoices?limit=30`), Boolean(customer) && invoiceId == null);
  const ret = useLoad<Returnable>(`returnable:${invoiceId}`, () => api.get<Returnable>(`/wholesale/invoices/${invoiceId}/returnable`), invoiceId != null);
  const [lines, setLines] = useState<SLine[]>([]);
  const [reason, setReason] = useState<Reason | null>(null);
  const [notes, setNotes] = useState('');
  const [refund, setRefund] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState('');
  const key = useRef(newKey());   // one key for this return: a double tap makes one credit note

  const shown = lines.length ? lines : ret.data ? startLines(ret.data, reason) : [];
  const edit = (itemId: number, patch: Partial<SLine>) => { setLines(editS(shown, itemId, patch)); key.current = newKey(); setProblem(''); };
  const bad = salesReturnProblem(shown, reason);

  const save = async () => {
    if (bad || !ret.data) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const r = await api.post<{ return_number: string; credit_note_total: number; refunded: number; unrefunded: number }>('/wholesale/returns/sales', salesReturnBody(ret.data.invoice_id, shown, reason!, notes, refund || null), { idempotencyKey: key.current });
      setMade(sentence(r, money));
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not make the return'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>A shop returns goods</Title><Soft>{ret.data ? `${ret.data.invoice_number}${customer ? ` · ${customer.name}` : ''}` : customer ? customer.name : 'Choose the shop'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {made ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{made}</Text>
            <Button title="Done" onPress={() => router.replace('/returns')} />
          </View>
        ) : invoiceId == null ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16 }}><Button title={customer ? 'Change shop' : 'Choose the shop'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} /></View>
            {customer ? <SectionTitle>Which bill?</SectionTitle> : null}
            {bills.error && !bills.data ? <Failed message={bills.error} onRetry={() => { void bills.refresh(); }} /> : null}
            {bills.busy && !bills.data ? <Loading /> : null}
            {bills.data && bills.data.length === 0 ? <Empty>This shop has no bills yet.</Empty> : null}
            {(bills.data ?? []).filter((b) => b.status !== 'CANCELLED').map((b) => <Line key={b.invoice_id} left={b.invoice_number} sub={`${String(b.invoice_date).slice(0, 10)}${b.balance_due > 0 ? ` · ${money(b.balance_due)} still owed` : ' · paid'}`} right={money(b.total)} onPress={() => setInvoiceId(b.invoice_id)} />)}
          </ScrollView>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            {ret.busy && !ret.data ? <Loading /> : null}
            {ret.error && !ret.data ? <Failed message={ret.error} onRetry={() => { void ret.refresh(); }} /> : null}
            {ret.data && ret.data.status !== 'ISSUED' ? <Empty>This bill was cancelled, so nothing can be returned from it.</Empty> : null}
            {ret.data && ret.data.status === 'ISSUED' && shown.length === 0 ? <Empty>Everything on this bill has already been returned.</Empty> : null}
            {shown.length ? (
              <>
                <SectionTitle>Why is it coming back?</SectionTitle>
                <Chips<Reason> items={REASONS.map((r) => ({ id: r, label: REASON_LABEL[r] }))} value={reason ?? ('' as Reason)} onChange={(r) => { setLines(withReason(shown, reason, r)); setReason(r); key.current = newKey(); }} />
                <SectionTitle>How many of each?</SectionTitle>
                {shown.map((l) => (
                  <View key={l.item.item_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: Number(l.qty) > 0 ? '#eaf1ff' : color.card }}>
                    <Text style={{ fontSize: 16, color: color.ink }}>{l.item.description}</Text>
                    <Soft>{`${l.item.returnable} ${l.item.unit_name ?? ''} can still be returned · ${money(l.item.unit_price)} each`}</Soft>
                    <TextInput style={[s.input, { width: 120 }]} value={l.qty} onChangeText={(v) => edit(l.item.item_id, { qty: v })} keyboardType="decimal-pad" placeholder="0" accessibilityLabel={`How many ${l.item.description} are coming back`} />
                    {Number(l.qty) > 0 && l.item.tracks_stock ? (
                      <>
                        <Soft>Where do the goods go?</Soft>
                        <Chips<Disposition> items={DISPOSITIONS.map((d) => ({ id: d, label: DISPOSITION_LABEL[d] }))} value={l.disposition} onChange={(d) => edit(l.item.item_id, { disposition: d })} />
                        {l.disposition === 'RESTOCK' && l.item.batches.length > 1 ? <Chips items={l.item.batches.map((b) => ({ id: String(b.batch_id), label: `Batch ${b.batch_no}` }))} value={l.batchId ? String(l.batchId) : ''} onChange={(b) => edit(l.item.item_id, { batchId: Number(b) })} /> : null}
                      </>
                    ) : null}
                  </View>
                ))}
                <View style={{ padding: 16, gap: 10 }}>
                  {creditEstimatePaise(shown) > 0 ? <Soft>{`About ${money(creditEstimatePaise(shown) / 100)} comes off their bill. The exact amount, with discounts and GST, is worked out when you confirm.`}</Soft> : null}
                  <Soft>If they have already paid</Soft>
                  <Chips items={REFUNDS} value={refund} onChange={setRefund} />
                  <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" />
                  <ErrorText>{problem}</ErrorText>
                  <Button title="Confirm the return" onPress={() => { void save(); }} busy={busy} disabled={Boolean(bad)} />
                </View>
              </>
            ) : null}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
