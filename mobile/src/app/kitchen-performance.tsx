import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { KITCHEN_RANGES, canInsights, dishLine, hourLabel, minText, rangeQuery, slowerDishes, slowerText, stationLine, type Kitchen } from '../lib/insights.ts';
import { Button, Chips, Empty, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

/* Kitchen performance: how long dishes take from being sent to the kitchen until it marks them ready, compared with the period just before. */
export default function KitchenPerformance() {
  const me = currentBusiness(useSession());
  const ok = canInsights((p) => allowed(me, p), 'reports');
  const [days, setDays] = useState('14');
  const [data, setData] = useState<Kitchen | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ok) return;
    setData(null); setError('');
    api.get<Kitchen>(`/kitchen/performance?${rangeQuery(Number(days))}`).then(setData).catch((e: unknown) => setError(e instanceof ApiError && e.status === 403 ? t('You need report access to see kitchen performance.') : e instanceof Error ? e.message : t('Could not load.')));
  }, [days, ok]);
  const o = data?.overall; const p = data?.previous;
  const peak = Math.max(...(data?.hours.map((h) => h.avg_minutes) ?? [1]), 1);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Kitchen performance</Title><Soft>How long dishes take from being sent to being ready.</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You need report access to see kitchen performance.</Empty> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Chips items={KITCHEN_RANGES.map((n) => ({ id: String(n), label: t('Last {n} days', { n }) }))} value={days} onChange={setDays} />
            {error ? <Failed message={error} /> : !data || !o || !p ? <Loading what="Reading the tickets…" /> : o.lines === 0 ? <Empty>No finished tickets in this period yet. Times are recorded from when an order is sent to the kitchen until the kitchen marks it ready.</Empty> : (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
                  <Stat label="Average preparation" value={minText(o.avg_minutes)} note={p.lines ? `${minText(p.avg_minutes)} ${t('in the period before')}` : t('no earlier period to compare')} />
                  <Stat label="Slowest 1 in 10" value={minText(o.p90_minutes)} note={t('90% of items were ready by then')} />
                  <Stat label="Ready on time" value={o.on_time_pct == null ? '—' : `${o.on_time_pct}%`} note={p.on_time_pct != null ? `${p.on_time_pct}% ${t('before')}` : t("within each dish's set time")} />
                  <Stat label="Items prepared" value={String(o.lines)} note={t('over {n} days', { n: data.period.days })} />
                </View>
                {slowerDishes(data).length > 0 ? (
                  <>
                    <SectionTitle>Getting slower</SectionTitle>
                    {slowerDishes(data).map((i) => <Soft key={i.name} style={{ paddingHorizontal: 16, paddingBottom: 4 }}>{slowerText(i)}</Soft>)}
                    <Soft style={{ padding: 16 }}>{t('Worth asking: is it staffing at peak, a missing ingredient, a change to how it is made, or does the set time need updating?')}</Soft>
                  </>
                ) : null}
                <SectionTitle>By station</SectionTitle>
                {data.stations.map((st) => <Line key={st.name} left={st.name} right={minText(st.avg_minutes)} sub={stationLine(st)} />)}
                <SectionTitle>Average time by hour sent</SectionTitle>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 4, paddingHorizontal: 16 }}>
                  {data.hours.map((h) => (
                    <View key={h.hour} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
                      <Text style={{ fontSize: 10, color: color.soft }}>{Math.round(h.avg_minutes)}</Text>
                      <View style={{ width: '100%', height: `${(h.avg_minutes / peak) * 70}%`, backgroundColor: h.avg_minutes >= peak * 0.9 ? color.warn : color.brand, opacity: h.avg_minutes >= peak * 0.9 ? 1 : 0.5, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                      <Text style={{ fontSize: 10, color: color.soft }}>{hourLabel(h.hour)}</Text>
                    </View>
                  ))}
                </View>
                <Soft style={{ padding: 16 }}>{t('Busy hours usually run slower; a big gap here is a staffing question.')}</Soft>
                <SectionTitle>By dish</SectionTitle>
                <Soft style={{ paddingHorizontal: 16 }}>{t('Dishes with at least 3 finished items.')}</Soft>
                {data.items.map((i) => <Line key={i.name} left={i.name} right={minText(i.avg_minutes)} sub={dishLine(i)} />)}
              </>
            )}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
