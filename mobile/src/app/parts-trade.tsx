import { useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { priceListBody, priceListProblem, type PriceList, type Reservation } from '../lib/shopExtras.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* Trade prices and held parts: a price list gives a group of customers a discount on everything; a hold keeps parts back for a customer until they are sold or released. */
export default function PartsTrade() {
  const session = useSession();
  const k = `${session.businessId}:${session.branchId}`;
  const [tab, setTab] = useState<'lists' | 'holds'>('lists');
  const lists = useLoad<PriceList[]>(`pt-lists:${k}`, () => api.get<PriceList[]>('/autoparts/price-lists'), tab === 'lists');
  const holds = useLoad<Reservation[]>(`pt-holds:${k}`, () => api.get<Reservation[]>('/autoparts/reservations'), tab === 'holds');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [pct, setPct] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async () => {
    const bad = priceListProblem(name, pct);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { await api.post('/autoparts/price-lists', priceListBody(name, pct)); setName(''); setPct(''); setAdding(false); await lists.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const release = (r: Reservation) => Alert.alert(t('Release this hold?'), `${r.part} · ${r.open_qty}${r.customer ? ` · ${r.customer}` : ''}`, [{ text: t('No'), style: 'cancel' }, { text: t('Yes, release it'), onPress: () => { void (async () => { try { await api.post(`/autoparts/reservations/${r.reservation_id}/release`, {}); await holds.refresh(); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } })(); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Trade prices</Title><Soft>Price lists and held parts</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'lists', label: 'Price lists' }, { id: 'holds', label: 'Held for customers' }]} value={tab} onChange={(v) => setTab(v as typeof tab)} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <ErrorText>{error}</ErrorText>
          {tab === 'lists' ? (
            <>
              <View style={{ padding: 16, gap: 8 }}>
                <Button title={adding ? 'Cancel' : 'Add a price list'} kind="quiet" onPress={() => { setAdding(!adding); setError(''); }} />
                {adding ? (
                  <>
                    <TextInput style={s.input} value={name} onChangeText={setName} placeholder={t('Name, like Garage trade')} accessibilityLabel={t('Name')} />
                    <TextInput style={s.input} value={pct} onChangeText={(v) => setPct(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Discount (%)')} accessibilityLabel={t('Discount (%)')} />
                    <Button title="Save price list" onPress={() => { void add(); }} busy={busy} />
                  </>
                ) : null}
              </View>
              {lists.busy && !lists.data ? <Loading /> : null}
              {lists.error && !lists.data ? <Failed message={lists.error} onRetry={() => { void lists.refresh(); }} /> : null}
              {lists.data && lists.data.length === 0 ? <Empty>No price lists yet.</Empty> : null}
              {(lists.data ?? []).map((l) => <Line key={l.price_list_id} left={l.name} sub={t('{a} customers · {b} special prices', { a: l.customers, b: l.items })} right={`${l.discount_pct}% ${t('off')}`} />)}
              {lists.data?.length ? <Soft style={{ padding: 16 }}>Set a customer's price list, and special prices for single parts, on the website.</Soft> : null}
            </>
          ) : (
            <>
              {holds.busy && !holds.data ? <Loading /> : null}
              {holds.error && !holds.data ? <Failed message={holds.error} onRetry={() => { void holds.refresh(); }} /> : null}
              {holds.data && holds.data.length === 0 ? <Empty>Nothing is being held.</Empty> : null}
              {(holds.data ?? []).map((r) => <Line key={r.reservation_id} left={r.part} sub={r.customer ?? undefined} right={`${r.open_qty}`} onPress={() => release(r)} />)}
              {holds.data?.length ? <Soft style={{ padding: 16 }}>Tap a hold to release it.</Soft> : null}
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
