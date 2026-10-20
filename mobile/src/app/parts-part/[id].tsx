import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { rupees } from '../../lib/money.ts';
import { CLASS_LABEL, FIT_LABEL, partSub, pickOrder, stockText, vehicleText, yearsText, type PartDetail, type PartLocations } from '../../lib/parts.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const TONE = { get VERIFIED() { return color.ok; }, get UNVERIFIED() { return color.warn; }, get NOT_FIT() { return color.danger; }, get UNKNOWN() { return color.soft; } } as Record<string, string>;

/* One part: price and stock, the bins it is in, the numbers it is known by, and the vehicles it is recorded to fit (never assumed). */
export default function PartPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const part = useLoad<PartDetail>(`part:${id}`, () => api.get<PartDetail>(`/autoparts/parts/${id}`));
  const where = useLoad<PartLocations>(`part-where:${id}`, () => api.get<PartLocations>(`/autoparts/parts/${id}/locations`));
  const p = part.data;
  const w = where.data;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{p ? p.name : 'Part'}</Title><Soft>{p ? partSub(p) : ' '}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {part.error && !p ? <Failed message={part.error} onRetry={() => { void part.refresh(); }} /> : null}
          {part.busy && !p ? <Loading /> : null}
          {p ? (
            <>
              <View style={{ paddingHorizontal: 16, gap: 2 }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: color.ink }}>{rupees(p.selling_price_paise)}</Text>
                <Soft>{`${p.mrp_paise ? `MRP ${rupees(p.mrp_paise)} · ` : ''}${p.classification ? CLASS_LABEL[p.classification] ?? p.classification : 'No part details yet'}`}</Soft>
                <Text style={{ color: (p.stock ?? 0) > 0 ? color.ok : color.danger, fontWeight: '700' }}>{stockText(p.stock)}</Text>
              </View>

              <SectionTitle>Where it is</SectionTitle>
              {where.error && !w ? <Failed message={where.error} onRetry={() => { void where.refresh(); }} /> : null}
              {w ? (
                <>
                  {pickOrder(w.bins).map((b) => <Line key={b.location_id} left={`${b.code}${b.is_primary ? '  (pick bin)' : ''}`} sub={b.reserved_qty ? `${b.reserved_qty} held for customers` : undefined} right={`${b.qty}`} />)}
                  {w.bins.length === 0 ? <Soft>{'  Not on any shelf yet.'}</Soft> : null}
                  {w.unassigned > 0 ? (
                    <View style={{ padding: 16, gap: 8 }}>
                      <Text style={{ color: color.warn, fontWeight: '600' }}>{`${w.unassigned} waiting for a bin`}</Text>
                      <Button title="Put away" kind="quiet" onPress={() => router.push({ pathname: '/parts-warehouse', params: { tab: 'putaway', product: String(p.product_id) } })} />
                    </View>
                  ) : null}
                  {w.bins.length ? <View style={{ padding: 16 }}><Button title="Move between bins" kind="quiet" onPress={() => router.push({ pathname: '/parts-warehouse', params: { tab: 'move', product: String(p.product_id) } })} /></View> : null}
                </>
              ) : null}

              {p.branches.length > 1 ? (
                <>
                  <SectionTitle>At each outlet</SectionTitle>
                  {p.branches.map((b) => <Line key={b.branch_id} left={b.name} sub={b.reserved ? `${b.reserved} held` : undefined} right={`${b.available} free`} />)}
                </>
              ) : null}

              <SectionTitle>Part numbers</SectionTitle>
              {p.numbers.length === 0 ? <Soft>{'  None recorded.'}</Soft> : p.numbers.map((n) => <Line key={n.pn_id} left={n.number} right={n.kind.toLowerCase()} />)}
              {p.barcodes.length ? <Soft>{`  Barcode: ${p.barcodes.join(', ')}`}</Soft> : null}

              <SectionTitle>Fits these vehicles</SectionTitle>
              {p.fitment.length === 0 ? <Text style={{ color: color.soft, paddingHorizontal: 16 }}>No fitment on record. Do not assume it fits.</Text> : p.fitment.map((f) => (
                <Line key={f.fit_id} left={vehicleText(f)} sub={yearsText(f)} right={FIT_LABEL[f.status]} />
              ))}
              {p.fitment.some((f) => f.status !== 'VERIFIED') ? <Text style={{ color: TONE.UNVERIFIED, padding: 16 }}>Fitment that is not verified must be checked before selling.</Text> : null}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
