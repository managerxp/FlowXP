import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { KIND_LABEL, listSummary, newListBody, newListProblem, type PriceList } from '../lib/pricing.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

/* The price lists: everyday prices for a kind of customer, and offer prices for a time. Tap one to see and change its prices. */
export default function PriceLists() {
  const session = useSession();
  const lists = useLoad<PriceList[]>(`price-lists:${session.businessId}`, () => api.get<PriceList[]>('/wholesale/price-lists'));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PriceList['kind']>('STANDARD');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  const create = async () => {
    const bad = newListProblem(name);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const l = await api.post<PriceList>('/wholesale/price-lists', newListBody(name, kind), { idempotencyKey: key.current });
      key.current = newKey(); setName(''); setAdding(false); void lists.refresh();
      router.push({ pathname: '/price-list/[id]', params: { id: String(l.list_id) } });
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not make the list'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Price lists</Title><Soft>Who pays what</Soft></View>
          <Button title="New list" onPress={() => setAdding((a) => !a)} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {adding ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
            <TextInput style={s.input} value={name} onChangeText={(v) => { setName(v); setProblem(''); }} placeholder="Name, for example Dealers" accessibilityLabel="Name of the list" />
            <Chips<PriceList['kind']> items={(['STANDARD', 'PROMOTION'] as const).map((k) => ({ id: k, label: KIND_LABEL[k] }))} value={kind} onChange={setKind} />
            <ErrorText>{problem}</ErrorText>
            <Button title="Make the list" onPress={() => { void create(); }} busy={busy} />
          </View>
        ) : null}
        <SavedNote at={lists.savedAt} />
        {lists.error && !lists.data ? <Failed message={lists.error} onRetry={() => { void lists.refresh(); }} /> : null}
        {lists.busy && !lists.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1 }} data={lists.data ?? []} keyExtractor={(l) => String(l.list_id)} refreshing={lists.busy} onRefresh={() => { void lists.refresh(); }}
          ListEmptyComponent={lists.data ? <Empty>No price list yet. Everyone pays the shelf wholesale price.</Empty> : null}
          renderItem={({ item: l }) => <Line left={l.name} sub={listSummary(l)} onPress={() => router.push({ pathname: '/price-list/[id]', params: { id: String(l.list_id) } })} />}
        />
      </Page>
    </SafeAreaView>
  );
}
