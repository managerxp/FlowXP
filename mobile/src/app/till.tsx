import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, signOut, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { startAutoSync, syncAll, useSyncState } from '../lib/sync.ts';
import { add, clearSale, setKitchen, setOffers, setQty, useSale } from '../lib/sale.ts';
import { KITCHEN_TYPES, lineName, linePricePaise, totals } from '../lib/cart.ts';
import { noOffers, previewOffers } from '../lib/offers.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import type { Product } from '../lib/catalog.ts';
import { Button, ErrorText, Soft, color, s } from '../lib/ui.tsx';

/* One line that says whether the phone and FlowXP are level, and what is waiting. Tapping it opens the list of sales on this phone. */
const SyncBadge = () => {
  const sync = useSyncState();
  let text = 'All sales sent'; let tone = color.ok;
  if (sync.failed > 0) { text = `${sync.failed} sale${sync.failed === 1 ? '' : 's'} need attention`; tone = color.danger; }
  else if (sync.pending > 0) { text = `${sync.pending} sale${sync.pending === 1 ? '' : 's'} waiting to be sent${sync.stopped === 'auth' ? ' · sign in again' : sync.stopped === 'offline' ? ' · no signal' : ''}`; tone = '#b45309'; }
  else if (sync.stopped === 'offline') { text = 'No signal. You can keep billing'; tone = color.soft; }
  else if (sync.stopped === 'server') { text = 'FlowXP is not answering. You can keep billing'; tone = color.soft; }
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/sales')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
      <Text style={{ color: tone, fontWeight: '600', flex: 1 }}>{text}</Text>
      {sync.busy ? <ActivityIndicator size="small" /> : <Text style={{ color: color.brand }}>Sales</Text>}
    </Pressable>
  );
};

export default function Till() {
  const session = useSession();
  const scope = useScope();
  const sync = useSyncState();
  const business = currentBusiness(session);
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const { cart, kitchen, offers } = useSale();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => (scope ? startAutoSync() : undefined), [scope?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the search runs on the phone's own copy, so it works with no signal; products arriving from a sync refresh the list
  useEffect(() => {
    let alive = true;
    if (!scope || !text.trim()) { setResults([]); return; }
    void scope.catalog.search(text).then((r) => { if (alive) setResults(r); });
    return () => { alive = false; };
  }, [scope, text, sync.products, sync.syncedAt]);

  // the server owns the offers: ask what they save on this bill (online only; with no signal the total stays "about")
  useEffect(() => {
    if (!cart.lines.length) return;
    let alive = true;
    const t = setTimeout(() => { previewOffers(api, cart).then((o) => { if (alive) setOffers(o); }).catch(() => { if (alive) setOffers(noOffers()); }); }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [cart]);

  const sum = totals(cart, offers.byKey);
  const kitchenShop = KITCHEN_TYPES.includes(business?.business_type ?? '');
  const empty = sync.products === 0;

  const pick = (p: Product) => {
    if (!p.is_available) { setNote(`${p.name} is not available at this outlet`); return; }
    setNote(''); setText('');
    if (p.modifier_group_ids?.length) router.push({ pathname: '/options', params: { id: String(p.product_id) } });   // size, milk, sugar... first
    else add(p);
  };

  // a scanner or keyboard that ends with Enter: an exact barcode adds straight away
  const submit = async () => {
    const hit = await scope?.catalog.findByBarcode(text);
    if (hit) pick(hit); else if (results.length === 1) pick(results[0]);
  };

  const leave = () => {
    const unsent = sync.pending + sync.failed;
    const go = () => { void signOut().then(() => router.replace('/login')); };
    if (!unsent) return go();
    Alert.alert(`${unsent} sale${unsent === 1 ? ' is' : 's are'} not sent yet`, 'They stay safe on this phone and are sent after you sign in again to this outlet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', onPress: go }]);
  };

  return (
    <SafeAreaView style={[s.screen]}>
      <View style={{ padding: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 17, color: color.ink }}>{business?.name}</Text>
            <Soft>{outlet?.name} · {session.user?.name}</Soft>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.push('/choose')} style={{ padding: 10 }}><Text style={{ color: color.brand, fontWeight: '600' }}>Outlet</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={{ padding: 10 }}><Text style={{ color: color.brand, fontWeight: '600' }}>Settings</Text></Pressable>
        </View>
        <SyncBadge />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={setText} onSubmitEditing={submit} placeholder="Search or scan a barcode" returnKeyType="search" autoCorrect={false} accessibilityLabel="Search products" />
          <Button title="Scan" kind="quiet" onPress={() => router.push('/scan')} />
        </View>
        {empty && sync.busy ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Soft>Getting the products… {sync.progress}</Soft></View> : null}
        {empty && !sync.busy ? <Soft>No products on this phone yet. Connect once so they can be downloaded.</Soft> : null}
        {empty && !sync.busy ? <Button title="Download now" kind="quiet" onPress={() => { void syncAll(); }} /> : null}
        <ErrorText>{sync.error}</ErrorText>
        <ErrorText>{note}</ErrorText>
      </View>

      {text.trim() ? (
        <FlatList
          style={{ flex: 1 }} keyboardShouldPersistTaps="handled" data={results} keyExtractor={(p) => String(p.product_id)}
          ListEmptyComponent={<Soft style={{ padding: 16 }}>{empty ? 'No products yet.' : 'No product matches.'}</Soft>}
          renderItem={({ item }) => (
            <Pressable onPress={() => pick(item)} style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 16, color: color.ink }}>{item.name}</Text>
                <Soft>{item.track_inventory ? `about ${qty(item.current_stock ?? 0)} in stock` : item.category_name || ' '}</Soft>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{rupees(toPaise(item.selling_price))}</Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }} data={cart.lines} keyExtractor={(l) => l.key}
          ListEmptyComponent={<Soft style={{ padding: 16 }}>Scan or search to add items to the bill.</Soft>}
          renderItem={({ item: l }) => (
            <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: color.ink }}>{lineName(l)}</Text>
                <Soft>{rupees(linePricePaise(l))} each</Soft>
              </View>
              <Pressable accessibilityLabel={`One less ${l.product.name}`} onPress={() => setQty(l.key, l.quantity - 1)} style={stepper}><Text style={stepText}>−</Text></Pressable>
              <Text style={{ minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: '600' }}>{qty(l.quantity)}</Text>
              <Pressable accessibilityLabel={`One more ${l.product.name}`} onPress={() => setQty(l.key, l.quantity + 1)} style={stepper}><Text style={stepText}>+</Text></Pressable>
            </View>
          )}
        />
      )}

      <View style={{ padding: 12, gap: 8, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Soft>{qty(sum.itemCount)} items · GST {rupees(sum.taxPaise)}</Soft>
          <Text style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>{rupees(sum.totalPaise)}</Text>
        </View>
        {offers.savingPaise > 0 ? <Text style={{ color: color.ok, fontWeight: '600' }}>Offer: −{rupees(offers.savingPaise)} · {offers.names.join(', ')}</Text> : null}
        {kitchenShop ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: color.ink }}>Send to the kitchen / barista</Text>
            <Switch value={kitchen} onValueChange={setKitchen} accessibilityLabel="Send to the kitchen" />
          </View>
        ) : null}
        <Soft>About: the final bill is worked out by FlowXP (offers, round-off).</Soft>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Clear" kind="quiet" onPress={clearSale} disabled={!cart.lines.length} />
          <Button title="Take payment" onPress={() => router.push('/pay')} disabled={!cart.lines.length} style={{ flex: 1 }} />
        </View>
        <Pressable onPress={leave}><Text style={{ color: color.soft, fontSize: 12, textAlign: 'center' }}>Sign out</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const stepper = { width: 44, height: 44, borderRadius: 22, backgroundColor: '#eaf1ff', alignItems: 'center' as const, justifyContent: 'center' as const };
const stepText = { fontSize: 22, color: color.brand, fontWeight: '600' as const };
