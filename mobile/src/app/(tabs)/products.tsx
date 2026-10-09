import { memo, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScope } from '../../lib/local.ts';
import { currentBusiness, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { useSyncState } from '../../lib/sync.ts';
import type { Product } from '../../lib/catalog.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page, ColumnList } from '../../lib/responsive.tsx';
import { Hint } from '../../lib/learn.tsx';
import { Button, Chips, Empty, Line, Title, s, color } from '../../lib/ui.tsx';

const PAGE = 60;

const ProductRow = memo(({ p }: { p: Product }) => (
  <Line
    left={p.name} right={rupees(toPaise(p.selling_price))}
    sub={[p.category_name, p.track_inventory ? `about ${qty(p.current_stock ?? 0)} in stock` : null, p.is_available ? null : 'not available here'].filter(Boolean).join(' · ') || ' '}
    onPress={() => router.push({ pathname: '/product/[id]', params: { id: String(p.product_id) } })}
  />
));
const renderProduct = ({ item }: { item: Product }) => <ProductRow p={item} />;

/* The product list is read from the phone's own copy, so it opens at once and works with no signal. Editing needs a connection. */
export default function Products() {
  const scope = useScope();
  const pharmacy = currentBusiness(useSession())?.business_type === 'PHARMACY';
  const food = KITCHEN_TYPES.includes(currentBusiness(useSession())?.business_type ?? '');
  const sync = useSyncState();
  const [text, setText] = useState('');
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [category, setCategory] = useState('__all__');
  const [rows, setRows] = useState<Product[]>([]);
  const [more, setMore] = useState(true);

  useEffect(() => { if (scope) void scope.catalog.categories().then(setCategories); }, [scope, sync.products, sync.syncedAt]);

  const cat = category === '__all__' ? undefined : category;
  useEffect(() => {
    let alive = true;
    if (!scope) return;
    void scope.catalog.search(text, PAGE, cat).then((r) => { if (alive) { setRows(r); setMore(r.length === PAGE); } });
    return () => { alive = false; };
  }, [scope, text, cat, sync.products, sync.syncedAt]);

  const loadMore = () => {
    if (!scope || !more) return;
    void scope.catalog.search(text, PAGE, cat, rows.length).then((r) => { setRows((cur) => [...cur, ...r]); setMore(r.length === PAGE); });
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page grid>
        <View style={{ padding: 16, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Products</Title>
          <Button title={pharmacy ? 'Add medicine' : 'Add product'} onPress={() => router.push(pharmacy ? '/medicine/new' : '/product/new')} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder={pharmacy || food ? (food ? 'Search for an item' : 'Search by name or barcode') : 'Search by name or barcode'} autoCorrect={false} accessibilityLabel="Search products" />
        </View>
        <Hint id="products" />
        {categories.length > 1 ? <Chips items={[{ id: '__all__', label: `All ${sync.products}` }, ...categories.map((c) => ({ id: c.name, label: `${c.name || 'Other'} ${c.count}` }))]} value={category} onChange={setCategory} /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={rows} keyExtractor={(p) => String(p.product_id)} onEndReached={loadMore} onEndReachedThreshold={0.5} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Empty>{sync.products === 0 ? 'No products on this phone yet. Open Sell while you have internet and they download by themselves.' : 'No product matches.'}</Empty>}
          renderItem={renderProduct}
        />
        <Text style={{ textAlign: 'center', color: color.soft, fontSize: 12, padding: 6 }}>{sync.products} products on this phone</Text>
      </Page>
    </SafeAreaView>
  );
}
