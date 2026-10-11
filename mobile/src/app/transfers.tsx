import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { STATUS_LABEL, transferText, type Transfer } from '../lib/transfers.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

type Show = 'open' | 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED';
const FILTER: Record<Show, string> = { open: 'DRAFT,IN_TRANSIT', DRAFT: 'DRAFT', IN_TRANSIT: 'IN_TRANSIT', RECEIVED: 'RECEIVED,CANCELLED' };

/* Goods moving between your warehouses: what is waiting to go, what is on the way, and what has arrived. */
export default function Transfers() {
  const session = useSession();
  const [show, setShow] = useState<Show>('open');
  const list = useLoad<Transfer[]>(`transfers:${session.businessId}:${session.branchId}:${show}`, () => api.get<Transfer[]>(`/wholesale/transfers?status=${FILTER[show]}&limit=100`));
  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Moving stock</Title><Soft>Between your warehouses</Soft></View>
          <Button title="New" onPress={() => router.push('/transfer-new')} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Show> items={[{ id: 'open', label: 'Not finished' }, { id: 'DRAFT', label: 'Not sent yet' }, { id: 'IN_TRANSIT', label: 'On the way' }, { id: 'RECEIVED', label: 'Done' }]} value={show} onChange={setShow} />
        <SavedNote at={list.savedAt} />
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={list.data ?? []} keyExtractor={(t) => String(t.transfer_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>{show === 'open' ? 'Nothing is being moved right now.' : 'Nothing here.'}</Empty> : null}
          renderItem={({ item: t }) => <Line left={`${t.transfer_number} · ${STATUS_LABEL[t.status]}`} sub={`${transferText(t)} · ${String(t.created_at).slice(0, 10)}`} onPress={() => router.push({ pathname: '/transfer/[id]', params: { id: String(t.transfer_id) } })} />}
        />
      </Page>
    </SafeAreaView>
  );
}
