import { useState } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { daysText, type ExpiryRow, type ExpirySummary } from '../lib/retail.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Show = 'expired' | 'expiring' | 'all';

/* What is past its use-by date, and what will be soon. Take expired stock off the shelf here so it is counted as wastage, not as stock. */
export default function Expiry() {
  const session = useSession();
  const [show, setShow] = useState<Show>('expiring');
  const [problem, setProblem] = useState('');
  const list = useLoad<ExpirySummary>(`expiry:${session.businessId}:${session.branchId}:${show}`, () => api.get<ExpirySummary>(`/retail/expiry?state=${show}&days=30`));
  const sm = list.data?.summary;

  const writeOff = (r: ExpiryRow) => Alert.alert('Take this off the shelf?', `${qty(r.qty_on_hand)} ${r.unit ?? ''} of ${r.name} (batch ${r.batch_no}) is counted as wastage. This cannot be undone.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Write it off', style: 'destructive', onPress: () => { void api.call(`/retail/expiry/${r.batch_id}/write-off`, { method: 'POST', body: {}, idempotencyKey: newKey() }).then(() => list.refresh()).catch((e) => setProblem(e instanceof ApiError ? e.message : 'Could not write it off')); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Use-by dates</Title><Soft>Next 30 days and already past</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Show> items={[{ id: 'expiring', label: 'Expiring soon' }, { id: 'expired', label: 'Expired' }, { id: 'all', label: 'Everything' }]} value={show} onChange={(x) => { setShow(x); setProblem(''); }} />
        <SavedNote at={list.savedAt} />
        {sm ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
            <Stat label="Expired" value={String(sm.expired)} note={sm.expired_value > 0 ? `${rupees(toPaise(sm.expired_value))} of stock` : undefined} tone={sm.expired ? color.danger : undefined} />
            <Stat label="Expiring soon" value={String(sm.expiring)} tone={sm.expiring ? color.warn : undefined} />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1 }} data={list.data?.rows ?? []} keyExtractor={(r) => String(r.batch_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>Nothing here. Items with a use-by date appear when stock is received with one.</Empty> : null}
          renderItem={({ item: r }) => <Line left={r.name} sub={`${daysText(r.days_left)} · batch ${r.batch_no} · ${r.expiry_date}`} right={`${qty(r.qty_on_hand)} ${r.unit ?? ''}`} onPress={r.days_left < 0 ? () => writeOff(r) : undefined} />}
        />
        <Soft style={{ textAlign: 'center', padding: 8 }}>Tap an expired line to take it off the shelf.</Soft>
      </Page>
    </SafeAreaView>
  );
}
