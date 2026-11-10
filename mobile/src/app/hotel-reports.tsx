import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rs, type Collections, type Figures, type Flash, type HighBalance } from '../lib/hotelOps.ts';
import { PAY_LABEL } from '../lib/hotel.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
type Win = 'day' | 'month' | 'year';

const Block = ({ f }: { f: Figures }) => (
  <>
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      <Stat label="Total earned" value={rs(f.total_revenue_paise)} tone={color.brand} />
      <Stat label="Rooms filled" value={`${f.occupancy_pct}%`} note={t('{a} of {b} rooms', { a: f.rooms_sold, b: f.rooms_available })} />
    </View>
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      <Stat label="Average room rate" value={rs(f.adr_paise)} />
      <Stat label="Per room available" value={rs(f.revpar_paise)} />
    </View>
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      <Stat label="Rooms" value={rs(f.room_revenue_paise)} />
      <Stat label="Food and drink" value={rs(f.fnb_revenue_paise)} />
      <Stat label="Other" value={rs(f.other_revenue_paise)} />
    </View>
  </>
);

/* The manager's figures: how full, how much earned, who has paid how, and who owes the most. */
export default function HotelReports() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [w, setW] = useState<Win>('day');
  const flash = useLoad<Flash>(`hotel-flash:${scope}`, () => api.get<Flash>('/hotel/reports/flash'));
  const f = flash.data;
  const day = f?.date ?? iso(new Date());
  const from = w === 'year' ? `${day.slice(0, 4)}-01-01` : `${day.slice(0, 7)}-01`;
  const col = useLoad<Collections>(`hotel-col:${scope}:${day}:${w}`, () => api.get<Collections>(`/hotel/reports/collections?from=${w === 'day' ? day : from}&to=${day}`), Boolean(f));
  const owe = useLoad<HighBalance[]>(`hotel-owe:${scope}`, async () => (await api.get<{ rows: HighBalance[] }>('/hotel/reports/high-balance')).rows);
  const shown = f ? (w === 'day' ? f.day : w === 'month' ? f.month_to_date : f.year_to_date) : null;

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Hotel figures</Title><Soft>{f ? `${new Date(`${f.date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}${f.provisional ? ` · ${t('today so far')}` : ''}` : ' '}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'day', label: 'That day' }, { id: 'month', label: 'This month' }, { id: 'year', label: 'This year' }]} value={w} onChange={(v) => setW(v as Win)} /></View>
          {flash.busy && !f ? <Loading /> : null}
          {flash.error && !f ? <Failed message={flash.error} onRetry={() => { void flash.refresh(); }} /> : null}
          {shown ? <Block f={shown} /> : f ? <Soft style={{ padding: 16 }}>Nothing recorded for this day yet.</Soft> : null}
          {f ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
              <Stat label="In the house" value={String(f.now.rooms_in_house)} />
              <Stat label="Arriving" value={String(f.now.arrivals_expected)} />
              <Stat label="Leaving" value={String(f.now.departures_expected)} />
            </View>
          ) : null}
          {(col.data?.methods ?? []).length ? <SectionTitle>Money received</SectionTitle> : null}
          {(col.data?.methods ?? []).map((m) => <Line key={m.method} left={t(PAY_LABEL[m.method] ?? m.method)} right={rs(m.net_paise)} />)}
          {col.data && col.data.methods.length ? <Line left="Total received" right={rs(col.data.total_paise)} /> : null}
          {(owe.data ?? []).length ? <SectionTitle>Guests who owe the most</SectionTitle> : null}
          {(owe.data ?? []).slice(0, 10).map((g) => <Line key={g.booking_id} left={g.guest_name} sub={g.rooms ? `${t('Room')} ${g.rooms}` : g.res_no} right={rs(g.balance_paise)} onPress={() => router.push({ pathname: '/hotel-booking/[id]', params: { id: String(g.booking_id) } })} />)}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
