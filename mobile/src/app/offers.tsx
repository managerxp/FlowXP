import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { canOffers, offerLine, offerState, type Offer } from '../lib/offerList.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* Offers the till applies by itself. Switch one on or off, remove it, or add a new one. */
export default function Offers() {
  const me = currentBusiness(useSession());
  const ok = canOffers((p) => allowed(me, p));
  const [rows, setRows] = useState<Offer[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setRows(await api.get<Offer[]>('/retail/promotions')); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (ok) void load(); }, [load, ok]));

  const act = async (run: () => Promise<unknown>) => { setProblem(''); try { await run(); await load(); } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } };
  const toggle = (o: Offer) => act(() => api.call(`/retail/promotions/${o.promo_id}`, { method: 'PUT', body: { is_active: !o.is_active } }));
  const remove = (o: Offer) => Alert.alert(t('Remove “{name}”?', { name: o.name }), t('Bills already made keep what they were charged.'), [
    { text: t('Cancel'), style: 'cancel' }, { text: t('Remove'), style: 'destructive', onPress: () => { void act(() => api.call(`/retail/promotions/${o.promo_id}`, { method: 'DELETE' })); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Offers</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to offers.</Empty> : (
          <>
            {error && !rows ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
            {busy && !rows ? <Loading /> : null}
            {rows ? (
              <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
                <View style={{ padding: 16, gap: 8 }}>
                  <Soft>{t('Offers the till applies by itself: percentage off, buy some get some free, or a bundle price.')}</Soft>
                  <Button title="New offer" onPress={() => router.push('/offer-edit')} />
                  <ErrorText>{problem}</ErrorText>
                </View>
                {rows.length === 0 ? <Empty>No offers yet</Empty> : null}
                {rows.map((o) => (
                  <View key={o.promo_id}>
                    <Line left={o.name} right={t(offerState(o))} sub={offerLine(o)} icon="pricetag-outline" />
                    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
                      <View style={{ flex: 1 }}><Button title={o.is_active ? 'Switch off' : 'Switch on'} kind="quiet" onPress={() => { void toggle(o); }} /></View>
                      <View style={{ flex: 1 }}><Button title="Remove" kind="danger" onPress={() => remove(o)} /></View>
                    </View>
                  </View>
                ))}
                <Soft style={{ padding: 16 }}>{t('If several offers fit one product, the one that saves the most is used. Offers never add up on top of each other.')}</Soft>
              </ScrollView>
            ) : null}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
