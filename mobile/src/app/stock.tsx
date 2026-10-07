import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { StockRow } from '../lib/types.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Title, color, s } from '../lib/ui.tsx';

type Show = 'low' | 'all';

/* What is running low (or everything counted), at this outlet. Tap one to correct its stock. */
export default function Stock() {
  const session = useSession();
  const [show, setShow] = useState<Show>('low');
  const { data, savedAt, error, busy, refresh } = useLoad<StockRow[]>(`stock:${session.businessId}:${session.branchId}:${show}`, () => api.get<StockRow[]>(`/inventory${show === 'low' ? '?low_stock=true' : ''}`));

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Stock</Title>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Show> items={[{ id: 'low', label: 'Running low' }, { id: 'all', label: 'Everything counted' }]} value={show} onChange={setShow} />
        <SavedNote at={savedAt} />
        {error && !data ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}
        {busy && !data ? <Loading /> : null}
        <FlatList
          style={{ flex: 1, marginTop: 8 }} data={data ?? []} keyExtractor={(r) => String(r.product_id)} refreshing={busy} onRefresh={() => { void refresh(); }}
          ListEmptyComponent={data ? <Empty>{show === 'low' ? 'Nothing is running low.' : 'No stock is being counted.'}</Empty> : null}
          renderItem={({ item: r }) => (
            <Line
              left={r.name} right={`${qty(r.current_stock)} ${r.unit ?? ''}`}
              sub={`Reorder at ${qty(r.min_stock)}${r.current_stock < 0 ? ' · below zero: count it' : r.low_stock ? ' · low' : ''}`}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: String(r.product_id) } })}
            />
          )}
        />
        <View style={{ padding: 8 }}><Empty>{show === 'low' ? `Stock value is on the FlowXP website. Tap an item to correct its count.` : `${(data ?? []).length} items. Value ${rupees(toPaise((data ?? []).reduce((a, r) => a + r.stock_value, 0)))}`}</Empty></View>
      </Page>
    </SafeAreaView>
  );
}
