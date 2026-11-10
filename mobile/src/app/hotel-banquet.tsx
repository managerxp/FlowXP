import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { BANQUET_METHODS, EVENT_TEXT, bankPaymentBody, bankPaymentProblem, paymentKind, rs, type BanquetDetail, type BanquetEvent } from '../lib/hotelOps.ts';
import { PAY_LABEL } from '../lib/hotel.ts';
import { rowsOf } from '../lib/gymMembers.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const dayText = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* Banquet events: what is coming, the halls and guests for each function, what is billed and paid, and taking an advance or the balance. Booking an event stays on the website. */
export default function HotelBanquet() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [filter, setFilter] = useState('ENQUIRY,TENTATIVE,CONFIRMED');
  const list = useLoad<BanquetEvent[]>(`hotel-events:${scope}:${filter}`, () => api.get<BanquetEvent[] | { rows: BanquetEvent[] }>(`/hotel/banquet/events?status=${filter}&limit=50`).then(rowsOf));
  const [open, setOpen] = useState<number | null>(null);
  const one = useLoad<BanquetDetail>(`hotel-event:${scope}:${open}`, () => api.get<BanquetDetail>(`/hotel/banquet/events/${open}`), open !== null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const d = one.data;

  const pay = async () => {
    if (!d) return;
    const kind = paymentKind(d);
    const bad = bankPaymentProblem(Number(amount), d.totals.balance_paise, kind);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { await api.post(`/hotel/banquet/events/${d.event_id}/payments`, bankPaymentBody(Number(amount), method, kind), { idempotencyKey: newKey() }); setAmount(''); await Promise.all([one.refresh(), list.refresh()]); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Banquet events</Title><Soft>Halls, guests and what is paid</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'ENQUIRY,TENTATIVE,CONFIRMED', label: 'Coming up' }, { id: 'COMPLETED', label: 'Done' }, { id: 'CANCELLED', label: 'Cancelled' }]} value={filter} onChange={(v) => { setFilter(v); setOpen(null); }} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>No events here.</Empty> : null}
          {(list.data ?? []).map((e) => (
            <View key={e.event_id}>
              <Line left={e.title} sub={`${e.first_date ? dayText(e.first_date) : ''} · ${e.organiser} · ${t('{n} guests', { n: e.guests })}`} right={t(EVENT_TEXT[e.status])} selected={open === e.event_id} onPress={() => { setOpen(open === e.event_id ? null : e.event_id); setError(''); setAmount(''); }} />
              {open === e.event_id ? (
                <View style={{ padding: 16, gap: 6, backgroundColor: color.card }}>
                  {one.busy && !d ? <Loading /> : null}
                  {d ? (
                    <>
                      {d.functions.map((f) => <Soft key={f.function_id}>{`${dayText(f.event_date)} · ${f.start_time.slice(0, 5)}–${f.end_time.slice(0, 5)} · ${f.hall_name}${f.package_name ? ` · ${f.package_name}` : ''} · ${t('{n} guests', { n: f.guaranteed_guests ?? f.expected_guests })}`}</Soft>)}
                      <Text style={{ color: color.ink, fontWeight: '600' }}>{`${t('Billed')} ${rs(d.totals.charges_paise)} · ${t('Paid')} ${rs(d.totals.paid_paise)}`}</Text>
                      <Text style={{ color: d.totals.balance_paise > 0 ? color.warn : color.ok, fontSize: 18, fontWeight: '700' }}>{d.totals.balance_paise > 0 ? `${t('Still to pay')} ${rs(d.totals.balance_paise)}` : t('Nothing to pay')}</Text>
                      {d.payments.map((p) => <Soft key={p.bp_id}>{`${dayText(p.pay_date)} · ${t(PAY_LABEL[p.method] ?? p.method)} · ${p.kind === 'REFUND' ? '-' : ''}${rs(p.amount_paise)}`}</Soft>)}
                      {d.status !== 'COMPLETED' && d.status !== 'CANCELLED' ? (
                        <View style={{ gap: 8, paddingTop: 6 }}>
                          <SectionTitle>{paymentKind(d) === 'ADVANCE' ? 'Take the advance' : 'Take a payment'}</SectionTitle>
                          <TextInput style={s.input} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Amount (₹)')} accessibilityLabel={t('Amount (₹)')} />
                          <Chips items={BANQUET_METHODS} value={method} onChange={setMethod} />
                          <ErrorText>{error}</ErrorText>
                          <Button title="Save payment" onPress={() => { void pay(); }} busy={busy} />
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
