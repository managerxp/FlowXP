import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { setCustomer } from '../lib/sale.ts';
import { useLoad } from '../lib/useLoad.ts';
import { REASON_LABEL, type ReturnRow } from '../lib/returns.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

type Show = 'SALE' | 'PURCHASE';
const money = (n: number) => rupees(toPaise(n));

/* Returns, both ways: goods a shop sent back (a credit note on their bill) and goods sent back to a supplier (a debit note). */
export default function Returns() {
  const session = useSession();
  const [show, setShow] = useState<Show>('SALE');
  const list = useLoad<ReturnRow[]>(`returns:${session.businessId}:${show}`, () => api.get<ReturnRow[]>(`/wholesale/returns?kind=${show}&limit=100`));

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Returns</Title><Soft>Goods that came back, and goods sent back</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', gap: 8 }}>
          <Button title="A shop returns goods" onPress={() => { setCustomer(null); router.push('/return-sale'); }} style={{ flex: 1 }} />
          <Button title="Send back to a supplier" kind="quiet" onPress={() => router.push('/return-purchase')} style={{ flex: 1 }} />
        </View>
        <Chips<Show> items={[{ id: 'SALE', label: 'From shops' }, { id: 'PURCHASE', label: 'To suppliers' }]} value={show} onChange={setShow} />
        <SavedNote at={list.savedAt} />
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={list.data ?? []} keyExtractor={(r) => String(r.return_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>No returns here yet.</Empty> : null}
          renderItem={({ item: r }) => (
            <Line left={`${r.return_number} · ${r.customer ?? r.supplier ?? ''}`} sub={`${String(r.created_at).slice(0, 10)} · ${REASON_LABEL[r.reason]} · ${r.invoice_number ?? r.po_number ?? ''}${r.cn_number ? ` · ${r.cn_number}` : r.dn_number ? ` · ${r.dn_number}` : ''}`}
              right={money(r.cn_total ?? r.dn_total ?? 0)} onPress={() => router.push({ pathname: '/wh-return/[id]', params: { id: String(r.return_id) } })} />
          )}
        />
      </Page>
    </SafeAreaView>
  );
}
