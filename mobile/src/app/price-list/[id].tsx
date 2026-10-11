import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import type { WProduct } from '../../lib/wholesale.ts';
import { KIND_LABEL, listSummary, ruleBody, ruleProblem, ruleText, type PriceList, type PriceRule, type RuleDraft } from '../../lib/pricing.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* One price list: switch it on or off, make it the list for everyone, set the dates of an offer, and add, change or remove its prices. */
export default function PriceListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lists = useLoad<PriceList[]>(`price-lists-one:${id}`, () => api.get<PriceList[]>('/wholesale/price-lists'));
  const rules = useLoad<PriceRule[]>(`price-rules:${id}`, () => api.get<PriceRule[]>(`/wholesale/price-lists/${id}/items?limit=300`));
  const list = lists.data?.find((l) => String(l.list_id) === id);
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [text, setText] = useState('');
  const [found, setFound] = useState<WProduct[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  useEffect(() => { if (list && !loaded.current) { loaded.current = true; setStarts(list.starts_on ? String(list.starts_on).slice(0, 10) : ''); setEnds(list.ends_on ? String(list.ends_on).slice(0, 10) : ''); } }, [list]);
  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { void api.get<WProduct[]>(`/wholesale/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text]);

  const run = async (what: () => Promise<unknown>, after: () => void = () => {}) => {
    setBusy(true); setProblem('');
    try { await what(); after(); } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not save'); }
    finally { setBusy(false); }
  };
  const change = (body: object) => run(() => api.call(`/wholesale/price-lists/${id}`, { method: 'PUT', body }), () => { void lists.refresh(); });

  const pick = (p: WProduct) => {
    setUnits([p.unit ?? 'piece', ...(p.units ?? []).map((u) => u.unit_name)].filter((u, i, a) => a.indexOf(u) === i));
    setDraft({ product_id: p.product_id, name: p.name, unit_name: null, min_qty: '1', mode: 'price', value: '' });
    setText(''); setFound([]); setProblem('');
  };
  const edit = (patch: Partial<RuleDraft>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setProblem(''); };
  const bad = ruleProblem(draft);
  const addRule = () => {
    if (bad || !draft) return setProblem(bad);
    void run(() => api.call(`/wholesale/price-lists/${id}/items`, { method: 'PUT', body: ruleBody(draft) }), () => { setDraft(null); void rules.refresh(); void lists.refresh(); });
  };
  const remove = (r: PriceRule) => Alert.alert(`Remove the price for ${r.product ?? r.category}?`, 'The customers on this list pay the normal price for it again.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => { void run(() => api.call(`/wholesale/price-lists/${id}/items/${r.item_id}`, { method: 'DELETE' }), () => { void rules.refresh(); void lists.refresh(); }); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{list?.name ?? 'Price list'}</Title>{list ? <Soft>{listSummary(list)}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {lists.busy && !list ? <Loading /> : null}
        {lists.error && !list ? <Failed message={lists.error} onRetry={() => { void lists.refresh(); }} /> : null}
        {list ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
              <Button title={list.is_active ? 'Switch off' : 'Switch on'} kind="quiet" busy={busy} onPress={() => { void change({ is_active: !list.is_active }); }} />
              {list.is_default ? <Button title="Not for everyone" kind="quiet" busy={busy} onPress={() => { void change({ make_default: false }); }} /> : <Button title="Use for everyone" kind="quiet" busy={busy} onPress={() => { void change({ make_default: true }); }} />}
            </View>
            {list.kind === 'PROMOTION' ? (
              <View style={{ padding: 16, gap: 8 }}>
                <Soft>{`${KIND_LABEL.PROMOTION} run between two dates. Leave a date empty for no limit.`}</Soft>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[s.input, { flex: 1 }]} value={starts} onChangeText={setStarts} placeholder="From (2026-11-01)" accessibilityLabel="Starts on" autoCapitalize="none" />
                  <TextInput style={[s.input, { flex: 1 }]} value={ends} onChangeText={setEnds} placeholder="Until (2026-11-30)" accessibilityLabel="Ends on" autoCapitalize="none" />
                </View>
                <Button title="Save the dates" kind="quiet" busy={busy} onPress={() => { void change({ starts_on: starts.trim() || null, ends_on: ends.trim() || null }); }} />
              </View>
            ) : null}

            <SectionTitle>Add or change a price</SectionTitle>
            {draft ? (
              <View style={{ padding: 16, gap: 10, backgroundColor: '#eaf1ff' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: color.ink }}>{draft.name}</Text>
                <Soft>Sold by</Soft>
                <Chips items={units.map((u, i) => ({ id: i === 0 ? '' : u, label: u }))} value={draft.unit_name ?? ''} onChange={(u) => edit({ unit_name: u || null })} />
                <Chips<'price' | 'percent'> items={[{ id: 'price', label: 'A fixed price' }, { id: 'percent', label: 'A percentage off' }]} value={draft.mode} onChange={(m) => edit({ mode: m, value: '' })} />
                <TextInput style={s.input} value={draft.value} onChangeText={(v) => edit({ value: v })} keyboardType="decimal-pad" placeholder={draft.mode === 'price' ? 'Price of one' : 'Percent off'} accessibilityLabel={draft.mode === 'price' ? 'Price' : 'Percent off'} />
                <Soft>They get this price when they buy at least</Soft>
                <TextInput style={[s.input, { width: 140 }]} value={draft.min_qty} onChangeText={(v) => edit({ min_qty: v })} keyboardType="decimal-pad" accessibilityLabel="Smallest quantity" />
                <ErrorText>{problem}</ErrorText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Save this price" onPress={addRule} busy={busy} disabled={Boolean(bad)} style={{ flex: 1 }} />
                  <Button title="Cancel" kind="quiet" onPress={() => { setDraft(null); setProblem(''); }} />
                </View>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search for an item" accessibilityLabel="Search for an item" autoCorrect={false} />
                {found.map((p) => <Line key={p.product_id} left={p.name} sub={`Shelf wholesale price ${money(p.wholesale_price)}`} onPress={() => pick(p)} />)}
                <ErrorText>{problem}</ErrorText>
              </View>
            )}

            <SectionTitle>Prices on this list</SectionTitle>
            {rules.busy && !rules.data ? <Loading /> : null}
            {rules.data && rules.data.length === 0 ? <Soft style={{ padding: 16 }}>No price yet. Customers on this list pay the normal price.</Soft> : null}
            {(rules.data ?? []).map((r) => <Line key={r.item_id} left={r.product ?? `Everything in ${r.category}`} sub={ruleText(r, money)} right="Remove" onPress={() => remove(r)} />)}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
