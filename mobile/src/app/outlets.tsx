import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, loadMe, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { canManageTeam, seriesText, topOutlet, type CompareRow, type Outlet } from '../lib/team.ts';
import { Button, Chips, Empty, Failed, Line, Loading, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const OutletList = () => {
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setOutlets(await api.get<Outlet[]>('/outlets?include_closed=true')); void loadMe(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const shown = (outlets ?? []).filter((o) => showClosed || o.status === 'ACTIVE');
  return (
    <>
      {error && !outlets ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
      {busy && !outlets ? <Loading /> : null}
      {outlets ? (
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ padding: 16, gap: 8 }}>
            <Button title="Add outlet" onPress={() => router.push('/outlet-edit')} />
            {outlets.some((o) => o.status !== 'ACTIVE') ? <Button title={showClosed ? t('Hide closed outlets') : t('Show closed outlets')} kind="quiet" onPress={() => setShowClosed((v) => !v)} /> : null}
          </View>
          {shown.length === 0 ? <Empty>No outlets yet.</Empty> : null}
          {shown.map((o) => (
            <Line key={o.branch_id} left={`${o.name}${o.code ? ` · ${o.code}` : ''}${o.is_primary ? ` (${t('Main')})` : ''}`} right={o.status === 'ACTIVE' ? t('Open') : t('Closed')}
              sub={[[o.city, o.state].filter(Boolean).join(', '), o.gstin ?? t('Business GSTIN'), (o.invoice_prefix ? t('{series} next', { series: seriesText(o).replace(' next', '') }) : t('Business series'))].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/outlet-edit', params: { id: String(o.branch_id) } })} />
          ))}
          <Soft style={{ padding: 16 }}>{t('Closing an outlet needs its stock moved out and its open orders settled first.')}</Soft>
        </ScrollView>
      ) : null}
    </>
  );
};

const Compare = () => {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<{ outlets: CompareRow[]; totals: { orders: number; net_revenue: number; estimated_net: number } } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null); setError('');
    api.get<{ outlets: CompareRow[]; totals: { orders: number; net_revenue: number; estimated_net: number } }>(`/outlets/compare?from=${daysAgo(Number(days) - 1)}&to=${daysAgo(0)}`)
      .then(setData).catch((e) => setError(e instanceof ApiError && e.status === 403 ? t('Comparing outlets is for owners and group managers.') : e instanceof Error ? e.message : t('Could not load.')));
  }, [days]);
  const best = data ? topOutlet(data.outlets) : null;
  return (
    <>
      <Chips items={[{ id: '7', label: t('7 days') }, { id: '30', label: t('30 days') }, { id: '90', label: t('90 days') }]} value={days} onChange={setDays} />
      {error ? <Failed message={error} /> : null}
      {!data && !error ? <Loading what="Adding up each outlet" /> : null}
      {data ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
            <Stat label="Net revenue" value={money(data.totals.net_revenue)} /><Stat label="Orders" value={String(data.totals.orders)} /><Stat label="Estimated net" value={money(data.totals.estimated_net)} tone={data.totals.estimated_net < 0 ? color.danger : undefined} />
          </View>
          {data.outlets.map((r) => (
            <Line key={r.branch_id} left={r.name} right={money(r.net_revenue)}
              sub={[`${r.orders} ${t('Orders')}`, r.average_order != null ? `${t('Avg order')} ${money(r.average_order)}` : '', `${t('Estimated net')} ${money(r.estimated_net)}`, best === r.branch_id ? t('The best outlet this period') : ''].filter(Boolean).join(' · ')} />
          ))}
        </ScrollView>
      ) : null}
    </>
  );
};

/* Outlets (owner and admin): the places the business trades from, and how they compare. Stock, tables, orders and staff belong to each outlet; the menu is shared. */
export default function Outlets() {
  const me = currentBusiness(useSession());
  const allowed = canManageTeam(me?.role);
  const [tab, setTab] = useState<'outlets' | 'compare'>('outlets');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Outlets</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!allowed ? <Empty>Only owners and admins can manage this.</Empty> : (
          <>
            <Chips items={[{ id: 'outlets', label: t('Outlets') }, { id: 'compare', label: t('Compare') }]} value={tab} onChange={setTab} />
            {tab === 'outlets' ? <OutletList /> : <Compare />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
