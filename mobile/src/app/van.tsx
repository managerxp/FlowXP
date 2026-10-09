import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useScope } from '../lib/local.ts';
import { useLoad } from '../lib/useLoad.ts';
import { useSyncState } from '../lib/sync.ts';
import { leftOnVan, pendingOnVan, stockByProduct, type VanDetail, type Vehicle } from '../lib/van.ts';
import { unitFactor } from '../lib/field.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

/* The rep's van: what it carries, what has been sold from it today, and Sell from the van. Works with no signal: the stock is what it held at the last look, less what has been sold since on this phone. */
export default function Van() {
  const session = useSession();
  const scope = useScope();
  const sync = useSyncState();
  const vans = useLoad<Vehicle[]>(`vans:${session.businessId}:${session.branchId}`, () => api.get<Vehicle[]>('/distributor/vehicles'));
  const [chosen, setChosen] = useState<number | null>(null);
  const vehicleId = chosen ?? vans.data?.[0]?.vehicle_id ?? null;
  const van = useLoad<VanDetail>(`van:${vehicleId}`, () => api.get<VanDetail>(`/distributor/vehicles/${vehicleId}`), vehicleId != null);
  const [pending, setPending] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (!scope || vehicleId == null) return;
    let live = true;
    void (async () => {
      const list = await scope.actions.list();
      const products = new Map<number, Awaited<ReturnType<typeof scope.catalog.byId>>>();
      for (const a of list) for (const l of ((a.body as { lines?: { product_id: number }[] }).lines ?? [])) if (!products.has(l.product_id)) products.set(l.product_id, await scope.catalog.byId(l.product_id));
      if (live) setPending(pendingOnVan(list, vehicleId, (id, unit) => { const p = products.get(id); return p ? unitFactor(p, unit) : 1; }));
    })();
    return () => { live = false; };
  }, [scope, vehicleId, sync.changesPending, van.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const stock = van.data ? stockByProduct(van.data.stock) : [];
  const d = van.data;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>My van</Title><Soft>{d ? `${d.vehicle_no}${d.route ? ` · ${d.route}` : ''}` : 'What you are carrying'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {sync.changesPending > 0 ? <Text accessibilityLiveRegion="polite" style={{ color: color.warn, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 }}>{`${sync.changesPending} thing${sync.changesPending === 1 ? '' : 's'} saved on this phone, waiting to send.`}</Text> : null}
        {(vans.data?.length ?? 0) > 1 ? <Chips items={(vans.data ?? []).map((v) => ({ id: String(v.vehicle_id), label: v.vehicle_no }))} value={String(vehicleId)} onChange={(v) => setChosen(Number(v))} /> : null}
        <SavedNote at={van.savedAt} />
        <ScrollView refreshControl={<RefreshControl refreshing={van.busy} onRefresh={() => { void vans.refresh(); void van.refresh(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
          {vans.error && !vans.data ? <Failed message={vans.error} onRetry={() => { void vans.refresh(); }} /> : null}
          {vans.data && vans.data.length === 0 ? <Empty>No van is assigned to you. Vans are set up on the FlowXP website.</Empty> : null}
          {van.busy && !d && vehicleId != null ? <Loading /> : null}
          {d ? (
            <>
              <View style={{ paddingHorizontal: 16 }}>
                <Button title="Sell from the van" onPress={() => router.push({ pathname: '/van-sale', params: { vehicle: String(d.vehicle_id) } })} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
                <Stat label="Sold today" value={rupees(toPaise(d.today.value))} note={`${d.today.sales} sales`} tone={color.ok} />
                <Stat label="Products on the van" value={String(stock.length)} note={d.stock_value != null ? `worth ${rupees(toPaise(d.stock_value))}` : undefined} />
              </View>
              <SectionTitle>On the van</SectionTitle>
              {stock.length === 0 ? <Empty>The van is empty. Stock is loaded at the warehouse.</Empty> : null}
              {stock.map((p) => {
                const left = leftOnVan(p, pending);
                const sold = Math.round((p.qty - left) * 1000) / 1000;
                return <Line key={p.product_id} left={p.name} sub={`${p.batches.length > 1 ? `${p.batches.length} batches` : p.batches[0]?.batch_no ? `batch ${p.batches[0].batch_no}` : ''}${sold > 0 ? `${p.batches.length ? ' · ' : ''}${qty(sold)} sold, not yet sent` : ''}`.replace(/^ · /, '')} right={`${qty(left)} ${p.unit ?? ''}`} />;
              })}
              <Soft style={{ padding: 16 }}>Loading the van, taking unsold stock back and the end-of-day count are done by the warehouse on the FlowXP website.</Soft>
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
