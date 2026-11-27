import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { kvGet, useScope } from '../../lib/local.ts';
import { parseUsage, popular } from '../../lib/billing.ts';
import { cachedShelves, loadShelves } from '../../lib/shelves.ts';
import { goBack } from '../../lib/nav.ts';
import { useSyncState } from '../../lib/sync.ts';
import { pname, type Product } from '../../lib/catalog.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { itemName, liveItems, spoken, type Order } from '../../lib/orders.ts';
import { Page, useWide } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Soft, Title, color, s, TextInput } from '../../lib/ui.tsx';

const ALL = '__all__';
const POPULAR = '__popular__';

/* Add items to a running order: tap a tile and it is on the order at once. Tap the same item again and its quantity goes up. */
export default function AddToOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useScope();
  const sync = useSyncState();
  const wide = useWide();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [category, setCategory] = useState(ALL);
  const [hot, setHot] = useState<number[]>([]);   // what sells most: the server's list, else what this phone sells most
  const session = useSession();
  const [tiles, setTiles] = useState<Product[]>([]);
  const [added, setAdded] = useState<Record<number, number>>({});
  const order = useLoad<Order>(`order-add:${id}`, () => api.get<Order>(`/orders/${id}`));   // what is on the order, shown beside the menu on a tablet
  const [flash, setFlash] = useState<number | null>(null);   // the product just tapped lights up for a moment
  const [problem, setProblem] = useState('');
  // what was added in this visit: product -> its order line and quantity, so a second tap raises the quantity instead of making a second line
  const lines = useRef(new Map<number, { itemId: number; qty: number }>());
  // one tap at a time per product, so two quick taps count as two
  const chain = useRef(new Map<number, Promise<void>>());

  useEffect(() => { if (scope) void scope.catalog.categories().then(setCategories); }, [scope, sync.products]);
  useEffect(() => {
    let alive = true;
    const at = `${session.businessId}:${session.branchId}`;
    void (async () => {
      const local = popular(parseUsage(await kvGet(`popular:${at}`)));
      const kept = (await cachedShelves(`shelves:${at}`)).popular;
      if (alive) setHot(kept.length ? kept : local);
      const fresh = (await loadShelves(`shelves:${at}`))?.popular;
      if (alive && fresh?.length) setHot(fresh);
    })();
    return () => { alive = false; };
  }, [session.businessId, session.branchId]);
  const hotKey = category === POPULAR ? hot.join(',') : '';
  useEffect(() => {
    let alive = true;
    if (!scope) return;
    const done = (r: Product[]) => { if (alive) (text.trim() ? setResults : setTiles)(r); };
    if (text.trim()) void scope.catalog.search(text).then(done);
    else if (category === POPULAR) void Promise.all(hot.map((p) => scope.catalog.byId(p))).then((r) => done(r.filter((x): x is Product => Boolean(x))));
    else void scope.catalog.search('', 2000, category === ALL ? undefined : category).then(done);
    return () => { alive = false; };
  }, [scope, text, category, hotKey, sync.products]);   // eslint-disable-line react-hooks/exhaustive-deps

  const addOne = (p: Product) => {
    const run = async () => {
      setProblem('');
      try {
        const have = lines.current.get(p.product_id);
        if (have) {
          await api.call(`/orders/${id}/items/${have.itemId}`, { method: 'PATCH', body: { quantity: have.qty + 1 } });
          lines.current.set(p.product_id, { ...have, qty: have.qty + 1 });
        } else {
          const made = await api.post<{ order_item_id: number }[]>(`/orders/${id}/items`, { items: [{ product_id: p.product_id, quantity: 1 }] }, { idempotencyKey: newKey() });
          lines.current.set(p.product_id, { itemId: made[0].order_item_id, qty: 1 });
        }
        setAdded((a) => ({ ...a, [p.product_id]: lines.current.get(p.product_id)!.qty }));
        setFlash(p.product_id); setTimeout(() => setFlash((f) => (f === p.product_id ? null : f)), 1400);
        void order.refresh();
      } catch (e) {
        // an item that has since been sent to the kitchen cannot be raised: the next tap makes a new line
        lines.current.delete(p.product_id);
        setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not add that');
      }
    };
    const next = (chain.current.get(p.product_id) ?? Promise.resolve()).then(run);
    chain.current.set(p.product_id, next);
  };

  const pick = (p: Product) => {
    if (!p.is_available) { setProblem(`${p.name} is not available at this outlet`); return; }
    if (p.modifier_group_ids?.length) router.push({ pathname: '/options', params: { id: String(p.product_id), order: String(id) } });
    else addOne(p);
  };

  const cols = wide ? 3 : 2;
  const total = Object.values(added).reduce((a, n) => a + n, 0);
  const tile = ({ item }: { item: Product }) => {
    const n = added[item.product_id] ?? 0;
    return (
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${item.name}, ${rupees(toPaise(item.selling_price))}${n ? `, ${n} added` : ''}`} onPress={() => pick(item)}
        style={({ pressed }) => [{ flex: 1 / cols, minHeight: 84, padding: 10, borderRadius: 12, borderWidth: n ? 2 : 1, borderColor: n ? color.brand : color.line, backgroundColor: n ? color.tint : item.is_available ? color.card : color.wash, justifyContent: 'space-between' }, pressed && { backgroundColor: color.press }]}
      >
        {n ? <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: color.onAction, fontWeight: '800', fontSize: 13 }}>{n}</Text></View> : null}
        <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', color: item.is_available ? color.ink : color.soft, paddingRight: n ? 28 : 0 }}>{pname(item)}</Text>
        <Text style={{ color: color.soft }}>{item.is_available ? rupees(toPaise(item.selling_price)) : 'Not available'}{item.modifier_group_ids.length ? ' · options' : ''}</Text>
      </Pressable>
    );
  };

  // everything on this order, as it would be read back to the table: beside the menu on a wide screen, under it otherwise
  const onOrder = order.data ? spoken(liveItems(order.data)) : [];
  const count = onOrder.reduce((a, i) => a + Number(i.quantity), 0);
  const listRef = useRef<ScrollView>(null);
  useEffect(() => { if (count) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60); }, [count]);
  const Panel = (
    <View accessibilityLabel="On this order" style={[{ borderColor: color.line, backgroundColor: color.card }, wide ? { flex: 2, borderLeftWidth: 1 } : { maxHeight: '40%', borderTopWidth: 2 }]}>
      <Text accessibilityRole="header" style={{ padding: 12, fontSize: 17, fontWeight: '700', color: color.ink }}>{order.data?.table_name ? `On ${order.data.table_name}` : 'On this order'}{count ? ` · ${qty(count)} item${count === 1 ? '' : 's'}` : ''}</Text>
      <ScrollView ref={listRef} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
        {onOrder.length === 0 ? <Soft style={{ paddingHorizontal: 12, paddingBottom: 8 }}>Nothing yet. Tap an item on the menu.</Soft> : null}
        {onOrder.map((i) => (
          <View key={i.order_item_id} style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: i.product_id != null && i.product_id === flash ? color.press : color.card, flexDirection: 'row', gap: 8 }}>
            <Text style={{ minWidth: 36, fontSize: 17, fontWeight: '800', color: color.ink }}>{qty(i.quantity)}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: color.ink, fontSize: 17 }}>{itemName(i)}</Text>
              <Soft>{i.status === 'PENDING' ? 'Not sent to the kitchen yet' : i.status === 'PREPARING' ? 'Cooking' : i.status === 'READY' ? 'Ready' : 'Served'}{i.kitchen_notes ? ` · ${i.kitchen_notes}` : ''}</Soft>
            </View>
            <Text style={{ color: color.ink, fontWeight: '600' }}>{rupees(toPaise(i.line_total))}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page max={wide ? 1200 : 1000}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 3 }}>
        <View style={{ padding: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title>Add items</Title>
            <Button title={total ? `Done (${total})` : 'Done'} onPress={() => goBack()} />
          </View>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search the menu" autoCorrect={false} accessibilityLabel="Search the menu" />
          <ErrorText>{problem}</ErrorText>
        </View>
        {!text.trim() ? <Chips items={[{ id: ALL, label: 'All' }, ...(hot.length ? [{ id: POPULAR, label: 'Popular' }] : []), ...categories.map((c) => ({ id: c.name, label: c.name || 'Other' }))]} value={category} onChange={setCategory} /> : null}
        <FlatList
          style={{ flex: 1 }} key={cols} numColumns={cols} data={text.trim() ? results : tiles} keyExtractor={(p) => String(p.product_id)} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 8 }} columnWrapperStyle={{ gap: 8 }} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<Soft style={{ padding: 16 }}>{sync.products === 0 ? 'No menu on this phone yet. Open Sell once with a connection.' : 'Nothing found.'}</Soft>}
          renderItem={tile}
          extraData={flash}
        />
          {wide ? null : Panel}
        </View>
        {wide ? Panel : null}
        </View>
      </Page>
    </SafeAreaView>
  );
}
