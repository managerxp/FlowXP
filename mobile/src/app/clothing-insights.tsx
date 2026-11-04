import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees } from '../lib/money.ts';
import { t } from '../lib/i18n.ts';
import type { Analytics } from '../lib/clothing.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Failed, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

/* What sells and what sits, from the shop's own bills and stock: the same figures as Clothing insights on the website. */
const Bar = ({ label, hex, pieces, share, note }: { label: string; hex?: string | null; pieces: number; share: number; note?: string }) => (
  <View style={{ paddingVertical: 6 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {hex !== undefined ? <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: color.line, backgroundColor: hex ?? '#e5e7eb' }} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, color: color.ink, fontWeight: '600' }}>{label}</Text>
      </View>
      <Text style={{ color: color.ink }}>{pieces} <Text style={{ color: color.soft }}>· {share}%</Text></Text>
    </View>
    <View style={{ height: 8, borderRadius: 4, backgroundColor: color.wash, marginTop: 4, overflow: 'hidden' }}><View style={{ height: 8, borderRadius: 4, width: `${Math.max(share, pieces ? 2 : 0)}%`, backgroundColor: color.brand }} /></View>
    {note ? <Soft>{note}</Soft> : null}
  </View>
);
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 14, padding: 14, gap: 4 }}>
    <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 16, color: color.ink }}>{title}</Text>{children}
  </View>
);
const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: 12 }}>
    <Soft>{label}</Soft><Text style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>{value}</Text>{note ? <Soft>{note}</Soft> : null}
  </View>
);

export default function ClothingInsights() {
  const session = useSession();
  const type = currentBusiness(session)?.business_type ?? '';
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const a = useLoad<Analytics>(`clothing-analytics:${session.businessId}:${session.branchId}:${days}`, () => api.get<Analytics>(`/clothing/analytics?days=${days}`), type === 'CLOTHING');
  const d = a.data;
  const sold = (e: { stock: number; sell_through_pct: number }) => t('{n} left · {p}% sold', { n: e.stock, p: e.sell_through_pct });

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Clothing insights</Title><Soft>What sells, what earns and what sits</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={a.savedAt} />
        <Chips items={[{ id: '7', label: t('7 days') }, { id: '30', label: t('30 days') }, { id: '90', label: t('90 days') }]} value={days} onChange={setDays} />
        {a.error && !d ? <Failed message={a.error} onRetry={() => { void a.refresh(); }} /> : null}
        {a.busy && !d ? <Loading /> : null}
        {d ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Stat label={t('Pieces sold')} value={String(d.totals.pieces)} note={t('{n} bills', { n: d.bills })} />
              <Stat label={t('Sales before GST')} value={rupees(d.totals.revenue_paise)} />
              <Stat label={t('Margin')} value={d.totals.margin_pct == null ? '—' : `${d.totals.margin_pct}%`} note={rupees(d.totals.margin_paise)} />
              <Stat label={t('Stock at cost')} value={rupees(d.totals.stock_value_paise)} note={t('{n} pieces', { n: d.totals.stock })} />
            </View>
            {d.totals.pieces === 0 ? <Soft style={{ textAlign: 'center' }}>{t('Nothing sold in this time yet.')}</Soft> : null}
            <Card title={t('Sizes')}>{d.sizes.slice(0, 8).map((e) => <Bar key={e.size} label={e.size} pieces={e.pieces} share={e.share_pct} note={sold(e)} />)}</Card>
            <Card title={t('Colours')}>{d.colours.slice(0, 8).map((e) => <Bar key={e.colour} label={e.colour} hex={e.hex} pieces={e.pieces} share={e.share_pct} note={sold(e)} />)}</Card>
            <Card title={t('Best styles')}>{d.styles.slice(0, 6).map((e) => <Bar key={e.style_id} label={e.name} pieces={e.pieces} share={e.share_pct} note={`${e.margin_pct == null ? '' : `${t('Margin')} ${e.margin_pct}% · `}${sold(e)}`} />)}</Card>
            <Card title={t('How long stock has sat')}>
              {d.ageing.map((b) => <View key={b.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: color.ink }}>{t('{d} days', { d: b.label })}</Text><Text style={{ color: color.ink }}>{rupees(b.value_paise)} <Text style={{ color: color.soft }}>· {t('{n} pieces', { n: b.pieces })}</Text></Text></View>)}
            </Card>
            <Card title={t('Dead stock')}>
              {d.dead.length === 0 ? <Soft>{t('Nothing has been sitting this long.')}</Soft> : (
                <>
                  <Soft>{t('{n} pieces worth {v} across {c} sizes and colours.', { n: d.dead_total.pieces, v: rupees(d.dead_total.value_paise), c: d.dead_total.variants })}</Soft>
                  {d.dead.slice(0, 10).map((x) => (
                    <View key={x.product_id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 }}>
                      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: color.ink, fontWeight: '600' }}>{x.style_name} · {x.colour} · {x.size}</Text><Soft>{x.never_sold ? t('Never sold') : t('{n} days', { n: x.days })}</Soft></View>
                      <Text style={{ color: color.ink }}>{rupees(x.value_paise)}</Text>
                    </View>
                  ))}
                </>
              )}
            </Card>
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
