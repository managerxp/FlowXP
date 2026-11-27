import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { newKey } from './api.ts';
import { api, useSession } from './session.ts';
import { useLoad } from './useLoad.ts';
import { rupees } from './money.ts';
import { dmy } from './gymApp.ts';
import { paymentBody, paymentProblem, type PayMethod } from './customers.ts';
import { shareTaxInvoicePdf } from './share.ts';
import { t } from './i18n.ts';
import { Button, Chips, ErrorText, Group, Line, SectionTitle, Soft, Stat, color, s, TextInput } from './ui.tsx';

type Bill = { invoice_id: number; invoice_number: string; invoice_date: string; total_paise: number; credited_paise: number; amount_paid_paise: number; balance_due_paise: number; is_membership: boolean };
type Pay = { payment_id: number; payment_method: string; amount_paise: number; created_at: string; invoice_number: string };
type Finance = { summary: { billed_paise: number; paid_paise: number; owing_paise: number }; invoices: Bill[]; payments: Pay[] };
const METHODS: { id: PayMethod; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }];

/* A member's money: what they were billed, paid and still owe, each bill with Add payment and Share invoice, and the payments taken. */
export default function GymMemberBills({ memberId, onChange }: { memberId: string; onChange?: () => void }) {
  const session = useSession();
  const f = useLoad<Finance>(`gym-finance:${session.businessId}:${session.branchId}:${memberId}`, () => api.get<Finance>(`/gym/members/${memberId}/finance?limit=30`));
  const [paying, setPaying] = useState<Bill | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const key = useRef(newKey());
  const d = f.data;
  if (!d) return null;

  const start = (b: Bill) => { setPaying(b); setAmount(String(Number(b.balance_due_paise) / 100)); setReference(''); setError(''); setNote(''); key.current = newKey(); };
  const save = async () => {
    if (!paying) return;
    const bad = paymentProblem(amount, Number(paying.balance_due_paise) / 100);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/invoices/${paying.invoice_id}/payments`, paymentBody(amount, method, reference), { idempotencyKey: key.current });
      setNote(t('{amount} received for {bill}.', { amount: rupees(Math.round(Number(amount) * 100)), bill: paying.invoice_number }));
      setPaying(null); await f.refresh(); onChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : t('The payment did not go through. Your data is safe. Try again.')); } finally { setBusy(false); }
  };
  const share = async (b: Bill) => { setError(''); try { await shareTaxInvoicePdf(api, b.invoice_id); } catch (e) { setError(e instanceof Error ? e.message : t('Could not share the invoice.')); } };

  return (
    <View>
      <SectionTitle>Bills and payments</SectionTitle>
      {Number(d.summary.owing_paise) > 0 ? <View style={{ marginHorizontal: 16, padding: 14, borderRadius: 12, backgroundColor: color.dangerBg }}><Text style={{ color: color.danger, fontWeight: '700', fontSize: 16 }}>{t('Pending balance')}: {rupees(Number(d.summary.owing_paise))}</Text><Text style={{ color: color.danger, fontSize: 13 }}>{t('Memberships and shop purchases this member has not fully paid for.')}</Text></View> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
        <Stat label="Billed" value={rupees(Number(d.summary.billed_paise))} />
        <Stat label="Paid" value={rupees(Number(d.summary.paid_paise))} tone={color.ok} />
        <Stat label="Still to pay" value={rupees(Number(d.summary.owing_paise))} tone={Number(d.summary.owing_paise) > 0 ? color.danger : undefined} />
      </View>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, padding: 16, fontWeight: '600' }}>{note}</Text> : null}
      {d.invoices.length === 0 ? <Soft style={{ padding: 16 }}>No bills yet.</Soft> : null}
      {d.invoices.map((b) => (
        <View key={b.invoice_id} style={[s.card, { marginHorizontal: 16, marginTop: 8, gap: 6 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: color.ink }}>{b.invoice_number}</Text>
            <Text style={{ color: color.soft }}>{dmy(b.invoice_date)}</Text>
          </View>
          <Text style={{ color: color.ink }}>{`${rupees(Number(b.total_paise) - Number(b.credited_paise))} · ${t('paid')} ${rupees(Number(b.amount_paid_paise))}`}</Text>
          {Number(b.balance_due_paise) > 0 ? <Text style={{ color: color.danger, fontWeight: '600' }}>{t('Due')}: {rupees(Number(b.balance_due_paise))}</Text> : <Text style={{ color: color.ok, fontWeight: '600' }}>{t('Paid in full')}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Number(b.balance_due_paise) > 0 ? <Button title="Add payment" onPress={() => start(b)} style={{ flex: 1, minHeight: 44 }} selected={paying?.invoice_id === b.invoice_id} /> : null}
            <Button title="Share invoice" kind="quiet" onPress={() => { void share(b); }} style={{ flex: 1, minHeight: 44 }} />
          </View>
          {paying?.invoice_id === b.invoice_id ? (
            <View style={{ gap: 8 }}>
              <TextInput style={s.input} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" accessibilityLabel={t('Amount received (₹)')} placeholder={t('Amount received (₹)')} />
              <Chips items={METHODS} value={method} onChange={setMethod} />
              {method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} accessibilityLabel={t('Reference (optional)')} placeholder={t('Reference (optional)')} maxLength={60} /> : null}
              <ErrorText>{error}</ErrorText>
              <Button title="Save payment" onPress={() => { void save(); }} busy={busy} />
            </View>
          ) : null}
        </View>
      ))}
      {!paying && error ? <ErrorText>{error}</ErrorText> : null}
      {d.payments.length ? <><SectionTitle>Payments taken</SectionTitle><Group>{d.payments.slice(0, 10).map((p) => <Line key={p.payment_id} left={rupees(Number(p.amount_paise))} sub={`${p.invoice_number} · ${p.payment_method}`} right={dmy(p.created_at)} />)}</Group></> : null}
    </View>
  );
}
