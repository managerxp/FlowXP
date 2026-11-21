import { memo, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '../../lib/icons.tsx';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScope } from '../../lib/local.ts';
import { currentBusiness, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { useSyncState } from '../../lib/sync.ts';
import { pname, type Product } from '../../lib/catalog.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page, ColumnList } from '../../lib/responsive.tsx';
import { Hint } from '../../lib/learn.tsx';
import { SearchBox } from '../../lib/SearchBox.tsx';
import { t } from '../../lib/i18n.ts';
import { Button, Chips, Empty, Line, Title, s, color } from '../../lib/ui.tsx';

const PAGE = 60;

/* The extra tools sit under the search as small buttons that wrap on a narrow screen. */
const ToolLink = ({ label, go, icon }: { label: string; go: string; icon: React.ComponentProps<typeof Ionicons>['name'] }) => (
  <Pressable accessibilityRole="button" onPress={() => router.push(go as never)}
    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 22, backgroundColor: color.card, borderWidth: 1, borderColor: color.line }}>
    <Ionicons name={icon} size={18} color={color.brand} />
    <Text style={{ color: color.brand, fontWeight: '600' }}>{t(label)}</Text>
  </Pressable>
);

const ProductRow = memo(({ p }: { p: Product }) => (
  <Line
    left={pname(p)} right={rupees(toPaise(p.selling_price))}
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
    void scope.catalog.search(text, PAGE, cat, rows.length).then((r) => { setRows((cur) => { const seen = new Set(cur.map((p) => p.product_id)); return [...cur, ...r.filter((p) => !seen.has(p.product_id))]; }); setMore(r.length === PAGE); });
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page grid>
        <View style={{ padding: 16, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Products</Title>
          <Button title={pharmacy ? 'Add medicine' : 'Add product'} onPress={() => router.push(pharmacy ? '/medicine/new' : '/product/new')} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <SearchBox value={text} onChange={setText} placeholder={food ? 'Search for an item' : 'Search by name or barcode'} label="Search products" />
        </View>
        <Hint id="products" />
        {food || !pharmacy ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
            {food ? <ToolLink label="Menu on / off" go="/menu-availability" icon="restaurant-outline" /> : null}
            {food ? <ToolLink label="Options & add-ons" go="/option-groups" icon="options-outline" /> : null}
            {!food && !pharmacy ? <ToolLink label="Print labels" go="/labels" icon="print-outline" /> : null}
          </View>
        ) : null}
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
