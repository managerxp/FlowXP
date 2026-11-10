import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { auditBlocked, auditBody, type AuditPreview } from '../lib/hotelOps.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const dayText = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/* Closing the day. Everyone who should have arrived is checked in or marked as not come; then each room in the house is charged for the night and the hotel's date moves on. */
export default function HotelAudit() {
  const session = useSession();
  const p = useLoad<AuditPreview>(`hotel-audit:${session.businessId}:${session.branchId}`, () => api.get<AuditPreview>('/hotel/night-audit'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const d = p.data;

  const run = async (noShowAll: boolean) => {
    setBusy(true); setError('');
    try { await api.post('/hotel/night-audit', auditBody(noShowAll)); setDone(t('The day is closed. It is now {date}.', { date: dayText(d?.next_date ?? '') })); await p.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not close the day. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const confirm = (noShowAll: boolean) => Alert.alert(t('Close {date}?', { date: dayText(d?.business_date ?? '') }), noShowAll ? t('Everyone who has not arrived is marked as not come, each room in the house is charged for tonight, and the date moves on. This cannot be undone.') : t('Each room in the house is charged for tonight and the date moves on. This cannot be undone.'), [{ text: t('Not yet'), style: 'cancel' }, { text: t('Yes, close the day'), style: 'destructive', onPress: () => { void run(noShowAll); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Close the day</Title><Soft>Night audit</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {p.busy && !d ? <Loading /> : null}
          {p.error && !d ? <Failed message={p.error} onRetry={() => { void p.refresh(); }} /> : null}
          {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 }}>{done}</Text> : null}
          {d ? (
            <>
              <View style={[s.card, { marginHorizontal: 16, gap: 4 }]}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>{dayText(d.business_date)}</Text>
                <Soft>{t('{n} rooms in the house tonight', { n: d.rooms_in_house })}</Soft>
                {d.last_audit ? <Soft>{t('Last closed: {date}', { date: dayText(d.last_audit.audit_date) })}</Soft> : null}
              </View>
              {d.pending_arrivals.length ? (
                <>
                  <SectionTitle>Not arrived yet</SectionTitle>
                  <Soft style={{ paddingHorizontal: 16 }}>Check these guests in, or mark them as not come, before closing the day.</Soft>
                  {d.pending_arrivals.map((b) => <Line key={b.booking_id} left={b.guest_name} sub={`${b.res_no} · ${t('{n} rooms', { n: b.rooms })}`} onPress={() => router.push({ pathname: '/hotel-booking/[id]', params: { id: String(b.booking_id) } })} />)}
                </>
              ) : null}
              {d.overdue_departures.length ? (
                <>
                  <SectionTitle>Should have left</SectionTitle>
                  <Soft style={{ paddingHorizontal: 16 }}>They are kept on and charged for another night unless you check them out first.</Soft>
                  {d.overdue_departures.map((b) => <Line key={b.booking_id} left={b.guest_name} sub={`${b.res_no} · ${t('Room')} ${b.rooms}`} onPress={() => router.push({ pathname: '/hotel-booking/[id]', params: { id: String(b.booking_id) } })} />)}
                </>
              ) : null}
              <View style={{ padding: 16, gap: 8 }}>
                <ErrorText>{error}</ErrorText>
                {auditBlocked(d) ? <Button title="Mark them all as not come, then close the day" kind="danger" onPress={() => confirm(true)} busy={busy} /> : null}
                <Button title="Close the day" onPress={() => confirm(false)} busy={busy} disabled={auditBlocked(d)} />
              </View>
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
