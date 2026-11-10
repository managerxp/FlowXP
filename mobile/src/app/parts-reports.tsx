import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { MOVER_TEXT, type AgeBucket, type Mover, type Reorder, type Valuation } from '../lib/shopExtras.ts';
import { rs } from '../lib/hotelOps.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Tab = 'buy' | 'movers' | 'age' | 'value';

/* Parts reports: what to buy, what sells and what sits, how old the stock is, and what it is worth. Suggestions come from your own sales and stock, with the reason. */
export default function PartsReports() {
  const session = useSession();
  const k = `${session.businessId}:${session.branchId}`;
  const [tab, setTab] = useState<Tab>('buy');
  const buy = useLoad<{ note?: string; parts: Reorder[] }>(`pr-buy:${k}`, () => api.get('/autoparts/reports/reorder'), tab === 'buy');
  const movers = useLoad<{ parts: Mover[] }>(`pr-mov:${k}`, () => api.get('/autoparts/reports/movers?limit=60'), tab === 'movers');
  const age = useLoad<{ basis?: string; buckets: AgeBucket[] }>(`pr-age:${k}`, () => api.get('/autoparts/reports/ageing'), tab === 'age');
  const val = useLoad<Valuation>(`pr-val:${k}`, () => api.get<Valuation>('/autoparts/reports/valuation'), tab === 'value');
  const open = (id: number) => router.push({ pathname: '/parts-part/[id]', params: { id: String(id) } });
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Parts reports</Title><Soft>Read only</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'buy', label: 'What to buy' }, { id: 'movers', label: 'Fast and slow' }, { id: 'age', label: 'Stock age' }, { id: 'value', label: 'Stock value' }]} value={tab} onChange={(v) => setTab(v as Tab)} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {tab === 'buy' ? (
            <>
              {buy.busy && !buy.data ? <Loading /> : null}
              {buy.error && !buy.data ? <Failed message={buy.error} onRetry={() => { void buy.refresh(); }} /> : null}
              {buy.data && buy.data.parts.length === 0 ? <Empty>Nothing needs buying right now.</Empty> : null}
              {buy.data?.parts.length ? <Soft style={{ padding: 16 }}>A suggestion, not an order. Nothing is bought until you make a purchase order.</Soft> : null}
              {(buy.data?.parts ?? []).map((p) => <Line key={p.product_id} left={p.name} sub={`${p.supplier ?? t('No supplier')} · ${t('have')} ${p.on_hand}${p.on_order ? ` · ${t('on order')} ${p.on_order}` : ''}`} right={`${t('Buy')} ${p.suggested_qty}`} onPress={() => open(p.product_id)} />)}
            </>
          ) : null}
          {tab === 'movers' ? (
            <>
              {movers.busy && !movers.data ? <Loading /> : null}
              {movers.error && !movers.data ? <Failed message={movers.error} onRetry={() => { void movers.refresh(); }} /> : null}
              {(movers.data?.parts ?? []).map((p) => <Line key={p.product_id} left={p.name} sub={`${t(MOVER_TEXT[p.class] ?? p.class)} · ${t('sold in 30 days')} ${p.sold_30} · ${t('have')} ${p.on_hand}`} right={rs(p.stock_cost_paise)} onPress={() => open(p.product_id)} />)}
            </>
          ) : null}
          {tab === 'age' ? (
            <>
              {age.busy && !age.data ? <Loading /> : null}
              {age.error && !age.data ? <Failed message={age.error} onRetry={() => { void age.refresh(); }} /> : null}
              {(age.data?.buckets ?? []).map((b) => <Line key={b.label} left={t('{label} days', { label: b.label })} sub={t('{a} parts · {b} units', { a: b.parts, b: b.units })} right={rs(b.cost_paise)} />)}
              {age.data ? <Soft style={{ padding: 16 }}>How long the stock has been on the shelf, valued at what you paid.</Soft> : null}
            </>
          ) : null}
          {tab === 'value' ? (
            <>
              {val.busy && !val.data ? <Loading /> : null}
              {val.error && !val.data ? <Failed message={val.error} onRetry={() => { void val.refresh(); }} /> : null}
              {val.data ? (
                <>
                  <View style={[s.card, { margin: 16, gap: 4 }]}>
                    <Text style={{ color: color.soft }}>{t('At what you paid')}</Text><Text style={{ fontSize: 22, fontWeight: '700', color: color.ink }}>{rs(val.data.total_cost_paise)}</Text>
                    <Text style={{ color: color.soft }}>{t('At selling price')}</Text><Text style={{ fontSize: 18, fontWeight: '600', color: color.ink }}>{rs(val.data.total_sell_paise)}</Text>
                  </View>
                  <SectionTitle>By category</SectionTitle>
                  {val.data.categories.map((c) => <Line key={c.category} left={c.category} sub={t('{a} parts · {b} units', { a: c.parts, b: c.units })} right={rs(c.cost_paise)} />)}
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
