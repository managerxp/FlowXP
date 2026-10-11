import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { fromSnapshot, type HeldRow } from '../lib/held.ts';
import { clearSale, saleStore, setCustomer } from '../lib/sale.ts';
import { noOffers } from '../lib/offers.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Empty, ErrorText, Failed, Loading, SavedNote, Title, color, s } from '../lib/ui.tsx';

/* Bills put on hold: this outlet's (shared with its other tills) and any kept on this phone. Resume one to put it back on the till. */
export default function Held() {
  const session = useSession();
  const scope = useScope();
  const [local, setLocal] = useState<HeldRow[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');

  const server = useLoad<HeldRow[]>(`held:${session.businessId}:${session.branchId}`, () => api.get<HeldRow[]>('/held-bills'));
  const loadLocal = () => { void scope?.held.list().then(setLocal); };
  useEffect(loadLocal, [scope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...local, ...(server.data ?? [])];

  const resume = async (row: HeldRow) => {
    if (!scope) return;
    setBusy(String(row.hold_id)); setProblem('');
    try {
      // take it off the list first: if someone else resumed it a moment ago, say so rather than make a second copy
      const taken = row.local ? await scope.held.take(String(row.hold_id)) : (await api.call<HeldRow>(`/held-bills/${row.hold_id}`, { method: 'DELETE' })).data;
      if (!taken) { setProblem('That held bill is not here any more.'); return; }
      const resolved = await fromSnapshot(taken.bill, (id) => scope.catalog.byId(id), (p) => scope.catalog.groupsFor(p));
      clearSale();
      for (const line of resolved.cart.lines) saleStore.set((st) => ({ cart: { lines: [...st.cart.lines, line] }, key: null, offers: noOffers() }));
      setCustomer(resolved.customer ? { id: resolved.customer.id, name: resolved.customer.name, phone: null } : null);
      if (resolved.skipped.length) Alert.alert('Some items could not be put back', resolved.skipped.join('\n'));
      router.navigate('/sell');
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not resume the bill'); }
    finally { setBusy(''); loadLocal(); void server.refresh(); }
  };

  const askResume = (row: HeldRow) => {
    if (!saleStore.get().cart.lines.length) return void resume(row);
    Alert.alert('Replace the bill on the till?', 'The bill on the till now will be removed. Hold it first if you want to keep it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', style: 'destructive', onPress: () => { void resume(row); } }]);
  };

  const discard = (row: HeldRow) => Alert.alert('Discard this held bill?', `${row.label || 'This bill'} will be removed for good.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: () => { void (async () => {
      try { if (row.local) await scope?.held.take(String(row.hold_id)); else await api.call(`/held-bills/${row.hold_id}`, { method: 'DELETE' }); }
      catch (e) { setProblem(e instanceof Error ? e.message : 'Could not discard'); }
      loadLocal(); void server.refresh();
    })(); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Bills on hold</Title>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={server.savedAt} />
        {server.error && !server.data ? <Failed message={server.error} onRetry={() => { void server.refresh(); }} /> : null}
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        {server.busy && !server.data && !local.length ? <Loading what="Loading held bills" /> : null}
        <ColumnList
          style={{ flex: 1 }} data={rows} keyExtractor={(r) => String(r.hold_id)} refreshing={server.busy} onRefresh={() => { void server.refresh(); loadLocal(); }}
          ListEmptyComponent={server.data || local.length === 0 ? <Empty>No bills on hold. Hold one from the till when a customer steps away.</Empty> : null}
          renderItem={({ item: r }) => (
            <View style={{ padding: 16, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{r.label || 'Held bill'}</Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>about {rupees(toPaise(r.estimate))}</Text>
              </View>
              <Text style={{ color: color.soft }}>{r.item_count} items{r.bill.customer_name ? ` · ${r.bill.customer_name}` : ''} · {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{r.held_by ? ` · ${r.held_by}` : ''}{r.local ? ' · on this phone only' : ''}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Button title="Resume" onPress={() => askResume(r)} busy={busy === String(r.hold_id)} style={{ flex: 1 }} />
                <Button title="Discard" kind="danger" onPress={() => discard(r)} disabled={Boolean(busy)} />
              </View>
            </View>
          )}
        />
      </Page>
    </SafeAreaView>
  );
}
