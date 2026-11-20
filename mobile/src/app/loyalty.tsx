import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { ApiError } from '../lib/api.ts';
import { Page } from '../lib/responsive.tsx';
import { canLoyalty, couponLine, couponState, todayText, type Coupon } from '../lib/loyalty.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, Title, s } from '../lib/ui.tsx';

const why = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

/* Coupons (owner and admin): offer codes. Stamp and points cards are made on the website and designed under More, Design loyalty cards. */
const Coupons = () => {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await api.get<Coupon[]>('/coupons')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const toggle = async (c: Coupon) => { setProblem(''); try { await api.call(`/coupons/${c.coupon_id}`, { method: 'PUT', body: { is_active: !c.is_active } }); await load(); } catch (e) { setProblem(why(e)); } };
  if (error && !rows) return <Failed message={error} onRetry={() => { void load(); }} />;
  if (!rows) return <Loading />;
  const today = todayText();
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ padding: 16, gap: 8 }}><Button title="New coupon" onPress={() => router.push('/coupon-edit')} /><ErrorText>{problem}</ErrorText></View>
      {rows.length === 0 ? <Empty>No coupons yet. Create one and give the code to a customer; the cashier enters it at billing.</Empty> : null}
      {rows.map((c) => (
        <View key={c.coupon_id}>
          <Line left={c.code} right={t(couponState(c, today))} sub={`${c.description ? `${c.description} · ` : ''}${couponLine(c)}`} onPress={() => router.push({ pathname: '/coupon-edit', params: { id: String(c.coupon_id) } })} />
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Button title={c.is_active ? 'Turn off' : 'Turn on'} kind="quiet" onPress={() => { void toggle(c); }} /></View>
        </View>
      ))}
    </ScrollView>
  );
};

export default function Loyalty() {
  const me = currentBusiness(useSession());
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Loyalty & coupons</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!canLoyalty(me?.role) ? <Empty>Loyalty is set up by owners and admins.</Empty> : <Coupons />}
      </Page>
    </SafeAreaView>
  );
}
