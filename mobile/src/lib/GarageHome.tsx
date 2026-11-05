/* The home of a mechanic garage on the phone: what is in the garage and what came in today. Big numbers and the vehicles in the garage; the few things the owner does all day are one tap away. */
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { allowed } from './access.ts';
import { JOB_STATUS_LABEL } from './jobCards.ts';
import { workLine, type GarageToday } from './garage.ts';
import { rupees } from './money.ts';
import { Page } from './responsive.tsx';
import { api, currentBusiness, useSession } from './session.ts';
import { t } from './i18n.ts';
import { SyncBadge } from './SyncBadge.tsx';
import { Button, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from './ui.tsx';

const Tile = ({ label, value, note, tone, go }: { label: string; value: string; note?: string; tone?: string; go?: () => void }) => (
  <Pressable accessibilityRole={go ? 'button' : 'text'} accessibilityLabel={`${t(label)}: ${value}${note ? `, ${note}` : ''}`} onPress={go} disabled={!go}
    style={({ pressed }) => [s.card, { width: '48.5%', minHeight: 84, padding: 12, justifyContent: 'center', gap: 2 }, pressed && { backgroundColor: color.tint }]}>
    <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
    <Text style={{ color: tone ?? color.ink, fontSize: 22, fontWeight: '700' }}>{value}</Text>
    {note ? <Text style={{ color: color.soft, fontSize: 12 }}>{note}</Text> : null}
  </Pressable>
);

export default function GarageHome() {
  const session = useSession();
  const business = currentBusiness(session);
  const can = (...keys: string[]) => allowed(business, ...keys);
  const [d, setD] = useState<GarageToday | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setD(await api.get<GarageToday>('/autoparts/garage/today')); setError(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page max={900}>
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 2 }}>
            <Title>{business?.name || t('Your garage')}</Title>
            <Soft>{t('What is in the garage and what came in today.')}</Soft>
            <SyncBadge />
          </View>
          <View style={{ gap: 8, paddingHorizontal: 16, paddingTop: 12 }}>
            {can('billing') ? <Button title="New job card" onPress={() => router.push({ pathname: '/job-cards', params: { new: '1' } })} style={{ minHeight: 60 }} /> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {can('customers', 'billing') ? <Button title="Add customer" kind="quiet" onPress={() => router.push('/customers')} style={{ flex: 1 }} /> : null}
              {can('grn', 'purchases') ? <Button title="Buy spare parts" kind="quiet" onPress={() => router.push('/parts-receive')} style={{ flex: 1 }} /> : null}
            </View>
            {can('payments', 'expenses') ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Money In" kind="quiet" onPress={() => router.navigate('/money')} style={{ flex: 1 }} />
                <Button title="Money Out" kind="quiet" onPress={() => router.navigate('/money')} style={{ flex: 1 }} />
              </View>
            ) : null}
          </View>
          {error && !d ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
          {!d && !error ? <Loading /> : null}
          {d ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 16 }}>
                <Tile label="Vehicles received today" value={String(d.received_today)} go={() => router.navigate('/jobs')} />
                <Tile label="Work in progress" value={String(d.in_progress)} go={() => router.navigate('/jobs')} />
                <Tile label="Ready for delivery" value={String(d.ready)} tone={d.ready > 0 ? color.ok : undefined} go={() => router.navigate('/jobs')} />
                <Tile label="Delivered today" value={String(d.delivered_today)} />
                <Tile label="Today's collection" value={rupees(d.collected_paise)} note={d.collected_paise > 0 ? t('{cash} in cash', { cash: rupees(d.cash_collected_paise) }) : undefined} />
                <Tile label="Today's expenses" value={rupees(d.spent_paise)} go={can('payments', 'expenses') ? () => router.navigate('/money') : undefined} />
                <Tile label="Cash in hand" value={rupees(d.cash_in_hand_paise)} note={t('Cash taken less cash spent today')} go={can('payments', 'expenses') ? () => router.navigate('/money') : undefined} />
                <Tile label="Customer payments due" value={rupees(d.customer_due_paise)} tone={d.customer_due_paise > 0 ? color.warn : undefined} note={d.customers_owing > 0 ? t('From {n} customers', { n: d.customers_owing }) : undefined} go={() => router.push('/customers')} />
              </View>
              <SectionTitle>{"Today's work"}</SectionTitle>
              {d.work.length === 0 ? <Soft style={{ paddingHorizontal: 16 }}>{t('No vehicles in the garage right now.')}</Soft> : d.work.map((w) => (
                <Line key={w.job_id} left={`${w.vehicle_reg || '—'} · ${t(JOB_STATUS_LABEL[w.status] ?? w.status)}`} sub={[workLine(w), w.promised_on ? t('Promised for {date}', { date: w.promised_on }) : ''].filter(Boolean).join(' · ')}
                  onPress={() => router.push({ pathname: '/job-card/[id]', params: { id: String(w.job_id) } })} />
              ))}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
