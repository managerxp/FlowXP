import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { useScope } from '../../lib/local.ts';
import { goBack } from '../../lib/nav.ts';
import { useSyncState } from '../../lib/sync.ts';
import type { Product } from '../../lib/catalog.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page, useWide } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Soft, Title, color, s } from '../../lib/ui.tsx';

/* Add items to a running order: tap a tile and it is on the order at once. Tap the same item again and its quantity goes up. */
export default function AddToOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useScope();
  const sync = useSyncState();
  const wide = useWide();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [category, setCategory] = useState('__first__');
  const [tiles, setTiles] = useState<Product[]>([]);
  const [added, setAdded] = useState<Record<number, number>>({});
  const [problem, setProblem] = useState('');
  // what was added in this visit: product -> its order line and quantity, so a second tap raises the quantity instead of making a second line
  const lines = useRef(new Map<number, { itemId: number; qty: number }>());
  // one tap at a time per product, so two quick taps count as two
  const chain = useRef(new Map<number, Promise<void>>());

  useEffect(() => { if (scope) void scope.catalog.categories().then(setCategories); }, [scope, sync.products]);
  const chosen = category === '__first__' ? categories[0]?.name : category;
  useEffect(() => {
    let alive = true;
    if (!scope) return;
    const done = (r: Product[]) => { if (alive) (text.trim() ? setResults : setTiles)(r); };
    if (text.trim()) void scope.catalog.search(text).then(done);
    else if (chosen !== undefined) void scope.catalog.search('', 120, chosen).then(done);
    return () => { alive = false; };
  }, [scope, text, chosen, sync.products]);

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
  const tile = ({ item }: { item: Product }) => (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${item.name}, ${rupees(toPaise(item.selling_price))}`} onPress={() => pick(item)}
      style={({ pressed }) => [{ flex: 1 / cols, minHeight: 84, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: added[item.product_id] ? color.brand : color.line, backgroundColor: item.is_available ? color.card : '#f1f5f9', justifyContent: 'space-between' }, pressed && { backgroundColor: '#eaf1ff' }]}
    >
      <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', color: item.is_available ? color.ink : color.soft }}>{item.name}</Text>
      <Text style={{ color: color.soft }}>{item.is_available ? rupees(toPaise(item.selling_price)) : 'Not available'}{item.modifier_group_ids.length ? ' · options' : ''}{added[item.product_id] ? ` · added ${added[item.product_id]}` : ''}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page max={1000}>
        <View style={{ padding: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title>Add items</Title>
            <Button title={total ? `Done (${total})` : 'Done'} onPress={() => goBack()} />
          </View>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search the menu" autoCorrect={false} accessibilityLabel="Search the menu" />
          <ErrorText>{problem}</ErrorText>
        </View>
        {!text.trim() && categories.length > 1 ? <Chips items={categories.map((c) => ({ id: c.name, label: c.name || 'Other' }))} value={chosen ?? ''} onChange={setCategory} /> : null}
        <FlatList
          key={cols} numColumns={cols} data={text.trim() ? results : tiles} keyExtractor={(p) => String(p.product_id)} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 8 }} columnWrapperStyle={{ gap: 8 }} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<Soft style={{ padding: 16 }}>{sync.products === 0 ? 'No menu on this phone yet. Open Sell once with a connection.' : 'Nothing found.'}</Soft>}
          renderItem={tile}
        />
      </Page>
    </SafeAreaView>
  );
}
