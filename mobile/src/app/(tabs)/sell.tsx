import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../../lib/session.ts';
import { kvGet, kvSet, useScope } from '../../lib/local.ts';
import { bump, parseUsage, popular, trim, type Usage } from '../../lib/billing.ts';
import { startAutoSync, syncAll, useSyncState } from '../../lib/sync.ts';
import { add, clearSale, setCustomer, setKitchen, setOffers, setQty, useSale } from '../../lib/sale.ts';
import { KITCHEN_TYPES, lineName, linePricePaise, totals, type Line } from '../../lib/cart.ts';
import { noOffers, previewOffers } from '../../lib/offers.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import type { Product } from '../../lib/catalog.ts';
import { SyncBadge } from '../../lib/SyncBadge.tsx';
import { Hint, markDone } from '../../lib/learn.tsx';
import { t } from '../../lib/i18n.ts';
import { ApiError, newKey } from '../../lib/api.ts';
import { estimateOf, holdBill, toSnapshot, type HeldRow } from '../../lib/held.ts';
import { useWide } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Soft, Title, color, s } from '../../lib/ui.tsx';
import { WholesaleHome } from '../../lib/WholesaleHome.tsx';
import { SalonTill } from '../../lib/SalonTill.tsx';
import { PharmacyTill } from '../../lib/PharmacyTill.tsx';

/* The till. On a phone: search or scan at the top, then the Menu (tap a tile) or the Bill, with the total and Take payment always at the bottom.
   On a tablet: the menu on the left and the bill on the right, so nothing is a screen away. */
const MenuTile = memo(({ item, n, cols, onPick }: { item: Product; n: number; cols: number; onPick: (p: Product) => void }) => (
  <Pressable
    accessibilityRole="button" accessibilityLabel={`${item.name}, ${rupees(toPaise(item.selling_price))}${n ? `, ${qty(n)} on the bill` : ''}`} onPress={() => onPick(item)}
    style={({ pressed }) => [{ flex: 1 / cols, minHeight: 84, padding: 10, borderRadius: 12, borderWidth: n ? 2 : 1, borderColor: n ? color.brand : color.line, backgroundColor: n ? '#eaf1ff' : item.is_available ? color.card : '#f1f5f9', justifyContent: 'space-between' }, pressed && { backgroundColor: '#dbe7ff' }]}
  >
    {n ? <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{qty(n)}</Text></View> : null}
    <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', color: item.is_available ? color.ink : color.soft, paddingRight: n ? 28 : 0 }}>{item.name}</Text>
    <Text style={{ color: color.soft }}>{item.is_available ? rupees(toPaise(item.selling_price)) : 'Not available'}{item.modifier_group_ids.length ? ' · options' : ''}</Text>
  </Pressable>
));

const POPULAR = '__popular__';

export default function Sell() {
  const session = useSession();
  const scope = useScope();
  const sync = useSyncState();
  const wide = useWide();
  const business = currentBusiness(session);
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const { cart, kitchen, offers, customer } = useSale();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [category, setCategory] = useState<string>('__first__');
  const [tiles, setTiles] = useState<Product[]>([]);
  const [view, setView] = useState<'menu' | 'bill'>('menu');
  const [note, setNote] = useState('');
  const [holding, setHolding] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [heldCount, setHeldCount] = useState(0);
  const [usage, setUsage] = useState<Usage>({});
  const billRef = useRef<FlatList<Line>>(null);
  const stripRef = useRef<ScrollView>(null);
  const before = useRef<Map<string, number>>(new Map());
  const [flash, setFlash] = useState('');   // the bill line that was just added or changed
  const usageKey = `popular:${session.businessId}:${session.branchId}`;
  const holdKey = useRef(newKey());   // one key for this Hold: a double tap holds the bill once

  useEffect(() => { void kvGet(usageKey).then((r) => setUsage(parseUsage(r))); }, [usageKey]);
  useEffect(() => (scope ? startAutoSync() : undefined), [scope?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the search runs on the phone's own copy, so it works with no signal; products arriving from a sync refresh the lists
  useEffect(() => {
    let alive = true;
    if (!scope || !text.trim()) { setResults([]); return; }
    void scope.catalog.search(text).then((r) => { if (alive) setResults(r); });
    return () => { alive = false; };
  }, [scope, text, sync.products, sync.syncedAt]);

  useEffect(() => { if (scope) void scope.catalog.categories().then(setCategories); }, [scope, sync.products, sync.syncedAt]);
  const hot = popular(usage);
  const hasPopular = hot.length > 0;
  const chosen = category === '__first__' ? (hasPopular ? POPULAR : categories[0]?.name) : category;
  useEffect(() => {
    let alive = true;
    if (!scope || chosen === undefined) { setTiles([]); return; }
    if (chosen === POPULAR) {
      void Promise.all(hot.map((id) => scope.catalog.byId(id))).then((r) => { if (alive) setTiles(r.filter((x): x is Product => Boolean(x))); });
      return () => { alive = false; };
    }
    void scope.catalog.search('', 120, chosen).then((r) => { if (alive) setTiles(r); });
    return () => { alive = false; };
  }, [scope, chosen, sync.products, sync.syncedAt, hasPopular && chosen === POPULAR ? hot.join(',') : '']);   // eslint-disable-line react-hooks/exhaustive-deps

  // the server owns the offers: ask what they save on this bill (online only; with no signal the total stays "about")
  useEffect(() => {
    if (!cart.lines.length) return;
    let alive = true;
    const t = setTimeout(() => { previewOffers(api, cart).then((o) => { if (alive) setOffers(o); }).catch(() => { if (alive) setOffers(noOffers()); }); }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [cart]);

  // how many bills are on hold: the outlet's (on the server) plus any kept on this phone
  const countHeld = () => {
    if (!scope) return;
    void (async () => {
      const local = await scope.held.count();
      const remote = await api.get<HeldRow[]>('/held-bills').then((r) => r.length).catch(() => 0);
      setHeldCount(local + remote);
    })();
  };
  useEffect(countHeld, [scope, cart.lines.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const hold = async () => {
    if (!scope || !cart.lines.length) return;
    try {
      const where = await holdBill({ api, held: scope.held, bill: toSnapshot(cart, customer), label: holdLabel.trim() || null, estimate: estimateOf(cart), key: holdKey.current }); holdKey.current = newKey();
      markDone('first_hold'); setHolding(false); setHoldLabel(''); clearSale();
      setNote(where === 'server' ? 'Bill held. Any till at this outlet can carry on with it.' : 'No internet: the bill is held on this phone only.');
      countHeld();
    } catch (e) { setHolding(false); setNote(e instanceof ApiError ? e.message : 'Could not hold the bill'); }
  };

  const sum = totals(cart, offers.byKey);
  const inBill = useMemo(() => { const m = new Map<number, number>(); for (const l of cart.lines) m.set(l.product.product_id, (m.get(l.product.product_id) ?? 0) + l.quantity); return m; }, [cart]);
  // an item added or changed lights up in the bill for a moment, and the bill scrolls to it, so a tap is always seen
  useEffect(() => {
    const prev = before.current; let changed = ''; let added = false;
    for (const l of cart.lines) { if (prev.get(l.key) !== l.quantity) { changed = l.key; if (!prev.has(l.key)) added = true; } }
    before.current = new Map(cart.lines.map((l) => [l.key, l.quantity]));
    if (!changed) return;
    setFlash(changed);
    if (added) setTimeout(() => { billRef.current?.scrollToEnd({ animated: true }); stripRef.current?.scrollToEnd({ animated: true }); }, 60);
    const timer = setTimeout(() => setFlash(''), 1400);
    return () => clearTimeout(timer);
  }, [cart]);
  const kitchenShop = KITCHEN_TYPES.includes(business?.business_type ?? '');
  const empty = sync.products === 0;

  const pick = (p: Product) => {
    if (!p.is_available) { setNote(`${p.name} is not available at this outlet`); return; }
    setNote(''); setText('');
    const next = trim(bump(usage, p.product_id, Date.now())); setUsage(next); void kvSet(usageKey, JSON.stringify(next));
    if (p.modifier_group_ids?.length) router.push({ pathname: '/options', params: { id: String(p.product_id) } });   // size, milk, sugar... first
    else add(p);
  };

  // a scanner or keyboard that ends with Enter: an exact barcode adds straight away
  const submit = async () => {
    const hit = await scope?.catalog.findByBarcode(text);
    if (hit) pick(hit); else if (results.length === 1) pick(results[0]);
  };

  const Header = (
    <View style={{ padding: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 17, color: color.ink }}>{outlet?.name}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })}
          style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 22, backgroundColor: customer ? '#eaf1ff' : color.card, borderWidth: 1, borderColor: color.line }}>
          <Text style={{ color: color.brand, fontWeight: '600' }}>{customer ? customer.name : 'Add customer'}</Text>
        </Pressable>
      </View>
      <SyncBadge />
      <Hint id="sell" />
      {sync.stopped === 'offline' || sync.pending > 0 ? <Hint id="offline" /> : null}
      {heldCount > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/held')} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: color.brand, fontWeight: '600' }}>{heldCount} bill{heldCount === 1 ? '' : 's'} on hold. Tap to resume.</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={setText} onSubmitEditing={submit} placeholder={kitchenShop ? 'Search for an item' : 'Search or scan a barcode'} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search products" />
        {kitchenShop ? null : <Button title="Scan" kind="quiet" onPress={() => router.push('/scan')} />}
      </View>
      {empty && sync.busy ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Soft>Getting the products… {sync.progress}</Soft></View> : null}
      {empty && !sync.busy ? <Soft>No products on this phone yet. Connect once so they can be downloaded.</Soft> : null}
      {empty && !sync.busy ? <Button title="Download now" kind="quiet" onPress={() => { void syncAll(); }} /> : null}
      <ErrorText>{sync.error}</ErrorText>
      <ErrorText>{note}</ErrorText>
    </View>
  );

  const SearchResults = (
    <FlatList
      style={{ flex: 1 }} keyboardShouldPersistTaps="handled" data={results} keyExtractor={(p) => String(p.product_id)}
      ListEmptyComponent={<Soft style={{ padding: 16 }}>{empty ? 'No products yet.' : 'No product matches.'}</Soft>}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${rupees(toPaise(item.selling_price))}`} onPress={() => pick(item)} style={{ minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: inBill.get(item.product_id) ? '#eaf1ff' : color.card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontSize: 16, color: color.ink }}>{item.name}{inBill.get(item.product_id) ? `  ·  ${qty(inBill.get(item.product_id) ?? 0)} on the bill` : ''}</Text>
            <Soft>{item.track_inventory ? `about ${qty(item.current_stock ?? 0)} in stock` : item.category_name || ' '}</Soft>
          </View>
          <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{rupees(toPaise(item.selling_price))}</Text>
        </Pressable>
      )}
    />
  );

  const cols = wide ? 3 : 2;
  const pickRef = useRef(pick); pickRef.current = pick;
  const onPick = useCallback((p: Product) => pickRef.current(p), []);
  const renderTile = useCallback(({ item }: { item: Product }) => <MenuTile item={item} n={inBill.get(item.product_id) ?? 0} cols={cols} onPick={onPick} />, [inBill, cols, onPick]);
  const Menu = (
    <View style={{ flex: 1 }}>
      {categories.length > 1 || hasPopular ? (
        <Chips items={[...(hasPopular ? [{ id: POPULAR, label: 'Popular' }] : []), ...categories.map((c) => ({ id: c.name, label: c.name || 'Other' }))]} value={chosen ?? ''} onChange={setCategory} />
      ) : null}
      <FlatList
        key={cols} numColumns={cols} data={tiles} keyExtractor={(p) => String(p.product_id)} initialNumToRender={16} maxToRenderPerBatch={12} windowSize={7} removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={{ padding: 8 }} columnWrapperStyle={{ gap: 8 }} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={<Soft style={{ padding: 16 }}>{empty ? '' : 'Nothing in this category.'}</Soft>}
        renderItem={renderTile} extraData={inBill}
      />
    </View>
  );

  const Bill = (
    <FlatList
      ref={billRef} style={{ flex: 1 }} data={cart.lines} keyExtractor={(l) => l.key} extraData={flash}
      ListEmptyComponent={<View style={{ padding: 24, gap: 8, alignItems: 'center' }}><Text style={{ fontSize: 17, fontWeight: '600', color: color.ink }}>{t('This bill is empty')}</Text><Soft style={{ textAlign: 'center' }}>{t('Tap an item on the Menu, search above, or tap Scan to read a barcode.')}</Soft><Button title="Back to the menu" kind="quiet" onPress={() => setView('menu')} /></View>}
      renderItem={({ item: l }) => (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: l.key === flash ? '#dbe7ff' : color.card, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, color: color.ink, fontWeight: l.key === flash ? '700' : '400' }}>{lineName(l)}</Text>
            <Soft>{rupees(linePricePaise(l))} each</Soft>
          </View>
          <Text style={{ minWidth: 64, textAlign: 'right', fontSize: 15, fontWeight: '600', color: color.ink }}>{rupees(Math.round(linePricePaise(l) * l.quantity))}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`One less ${l.product.name}`} onPress={() => setQty(l.key, l.quantity - 1)} style={stepper}><Text style={stepText}>−</Text></Pressable>
          <Text style={{ minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: '600' }}>{qty(l.quantity)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`One more ${l.product.name}`} onPress={() => setQty(l.key, l.quantity + 1)} style={stepper}><Text style={stepText}>+</Text></Pressable>
        </View>
      )}
    />
  );

  // under the menu when the bill is not beside it: every item on the bill, the one just added lit, so a tap is always seen. Tap it to open the bill.
  const Strip = cart.lines.length ? (
    <View accessibilityLabel="On the bill" style={{ borderTopWidth: 1, borderColor: color.line, backgroundColor: '#f1f5f9' }}>
      <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 8 }}>
        {cart.lines.map((l) => (
          <Pressable key={l.key} accessibilityRole="button" accessibilityLabel={`${qty(l.quantity)} ${lineName(l)} on the bill. Open the bill`} onPress={() => setView('bill')}
            style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 24, borderWidth: l.key === flash ? 2 : 1, borderColor: l.key === flash ? color.brand : color.line, backgroundColor: l.key === flash ? '#dbe7ff' : color.card }}>
            <Text style={{ color: color.ink, fontWeight: l.key === flash ? '800' : '600' }}>{qty(l.quantity)}× {lineName(l)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  ) : null;

  const Footer = (
    <View style={{ padding: 12, gap: 8, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Soft>{t(sum.itemCount === 1 ? '{n} item · GST {gst}' : '{n} items · GST {gst}', { n: qty(sum.itemCount), gst: rupees(sum.taxPaise) })}</Soft>
        <Text accessibilityLabel={`About ${rupees(sum.totalPaise)}`} style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>≈ {rupees(sum.totalPaise)}</Text>
      </View>
      {offers.savingPaise > 0 ? <Text style={{ color: color.ok, fontWeight: '600' }}>{t('Offer')}: −{rupees(offers.savingPaise)} · {offers.names.join(', ')}</Text> : null}
      {kitchenShop ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          <Text style={{ color: color.ink }}>{t('Send to the kitchen / barista')}</Text>
          <Switch value={kitchen} onValueChange={setKitchen} accessibilityLabel="Send to the kitchen" />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Hold bill" kind="quiet" onPress={() => setHolding(true)} disabled={!cart.lines.length} />
        <Button title="Clear bill" kind="quiet" onPress={() => { if (cart.lines.length > 2) Alert.alert(t('Clear this bill?'), t('All {n} items will be removed.', { n: cart.lines.length }), [{ text: t('Keep the bill'), style: 'cancel' }, { text: t('Clear bill'), style: 'destructive', onPress: clearSale }]); else clearSale(); }} disabled={!cart.lines.length && !customer} />
        <Button title={cart.lines.length ? `${t('Take payment')} · ${rupees(sum.totalPaise)}` : 'Take payment'} onPress={() => router.push('/pay')} disabled={!cart.lines.length} style={{ flex: 1 }} />
      </View>
      {customer ? <Pressable accessibilityRole="button" onPress={() => setCustomer(null)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.soft, textAlign: 'center' }}>{t('Customer: {name}. Tap to remove.', { name: customer.name })}</Text></Pressable> : null}
    </View>
  );

  const HoldDialog = (
    <Modal visible={holding} transparent animationType="fade" onRequestClose={() => setHolding(false)}>
      <View style={{ flex: 1, backgroundColor: '#0f172a99', justifyContent: 'center', padding: 24 }}>
        <View style={[s.card, { gap: 12, padding: 18 }]}>
          <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{t('Hold this bill')}</Text>
          <Soft>Give it a name to find it later, like a person or a table.</Soft>
          <TextInput style={s.input} value={holdLabel} onChangeText={setHoldLabel} placeholder="For example: Ravi" accessibilityLabel="Name for the held bill" autoFocus onSubmitEditing={() => { void hold(); }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Cancel" kind="quiet" onPress={() => setHolding(false)} style={{ flex: 1 }} />
            <Button title="Hold" onPress={() => { void hold(); }} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );

  if (business?.business_type === 'SALON') return <SalonTill />;
  if (business?.business_type === 'PHARMACY') return <PharmacyTill />;

  if (business?.business_type === 'WHOLESALE' || business?.business_type === 'DISTRIBUTOR') return <WholesaleHome />;

  if (wide) {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'right', 'bottom']}>
        {Header}
        {HoldDialog}
        <View style={{ flex: 1, flexDirection: 'row', borderTopWidth: 1, borderColor: color.line }}>
          <View style={{ flex: 3 }}>{text.trim() ? SearchResults : Menu}</View>
          <View style={{ flex: 2, borderLeftWidth: 1, borderColor: color.line }}>
            <Text style={{ padding: 12, fontWeight: '700', color: color.ink }}>Bill{cart.lines.length ? ` · ${cart.lines.length} lines` : ''}</Text>
            {Bill}
            {Footer}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      {Header}
      {HoldDialog}
      {text.trim() ? SearchResults : (
        <>
          <Chips items={[{ id: 'menu', label: t('Menu') }, { id: 'bill', label: `${t('Bill')} (${qty(sum.itemCount)})` }]} value={view} onChange={setView} />
          {view === 'menu' ? Menu : Bill}
        </>
      )}
      {view === 'menu' || text.trim() ? Strip : null}
      {Footer}
    </SafeAreaView>
  );
}

const stepper = { width: 48, height: 48, borderRadius: 24, backgroundColor: '#eaf1ff', alignItems: 'center' as const, justifyContent: 'center' as const };
const stepText = { fontSize: 22, color: color.brand, fontWeight: '600' as const };
