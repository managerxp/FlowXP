import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError, newKey } from '../../lib/api.ts';
import { useScope } from '../../lib/local.ts';
import { api, useSession } from '../../lib/session.ts';
import { refreshCounts, syncAll } from '../../lib/sync.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import type { ProductFull } from '../../lib/types.ts';
import { qty, rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, ErrorText, Failed, Line, Loading, SavedNote, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));

/* One product: what it costs and sells for, how much is on the shelf, and the two things done most: change the price, correct the stock. */
export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const scope = useScope();
  const loaded = useLoad<ProductFull>(`product:${session.businessId}:${session.branchId}:${id}`, () => api.get<ProductFull>(`/products/${id}`));
  const { savedAt, error, refresh } = loaded;
  // never seen on this phone and no internet: the phone's own copy of the product is enough to change its price or fix its stock
  const [fromPhone, setFromPhone] = useState<ProductFull | null>(null);
  useEffect(() => {
    if (!(loaded.error && !loaded.data) || !scope) return;
    void scope.catalog.byId(Number(id)).then((c) => { if (c) setFromPhone({ product_id: c.product_id, name: c.name, sku: c.sku, barcode: c.barcodes[0] ?? null, unit: c.unit, category_name: c.category_name, selling_price: c.selling_price, mrp: c.mrp, purchase_price: 0, tax_rate: c.tax_rate, track_inventory: c.track_inventory, current_stock: c.current_stock ?? 0, min_stock: 0, status: 'ACTIVE', kind: 'DISH' }); });
  }, [loaded.error, loaded.data, scope, id]);
  const p = loaded.data ?? fromPhone;
  const [price, setPrice] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [adjustKey, setAdjustKey] = useState(newKey());

  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(what); setProblem(''); setMessage('');
    try { await work(); void syncAll(); await refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(''); }
  };

  const savePrice = () => run('price', async () => {
    const v = Number(price);
    if (!(v >= 0) || price.trim() === '') throw new Error('Enter the new selling price');
    const body = { selling_price: v };
    try { await api.call(`/products/${id}`, { method: 'PATCH', body }); setPrice(''); setMessage('Price saved.'); await scope?.catalog.setLocal(Number(id), { selling_price: v }); }
    catch (e) {
      if (!(e instanceof NetworkError) || !scope) throw e;
      // no internet: keep the change on this phone, show it on the till at once, and send it later
      const kept = await scope.actions.add({ id: newKey(), label: `Price of ${p?.name ?? 'item'} to ${v}`, method: 'PATCH', path: `/products/${id}`, body });
      if (!kept) throw new Error('Too many changes are waiting on this phone. Connect to the internet so they can be sent.');
      await scope.catalog.setLocal(Number(id), { selling_price: v }); await refreshCounts();
      setPrice(''); setMessage('No internet. The new price is saved on this phone and used on new bills. It will be sent when you are online.');
    }
  });

  const saveStock = () => run('stock', async () => {
    const v = Number(delta);
    if (!Number.isFinite(v) || v === 0 || delta.trim() === '') throw new Error('Enter how many to add (like 10) or take away (like -3)');
    if (!reason.trim()) throw new Error('Say why you are changing the stock');
    const body = { product_id: Number(id), quantity: v, reason: reason.trim() };
    try { await api.call('/inventory/adjust', { method: 'POST', body, idempotencyKey: adjustKey }); setMessage('Stock updated.'); }
    catch (e) {
      if (!(e instanceof NetworkError) || !scope) throw e;
      // the SAME key is kept, so if the first try did reach the server before the signal dropped, sending it again changes the stock only once
      const kept = await scope.actions.add({ id: adjustKey, label: `Stock of ${p?.name ?? 'item'}: ${v > 0 ? '+' : ''}${v}`, method: 'POST', path: '/inventory/adjust', body });
      if (!kept) throw new Error('Too many changes are waiting on this phone. Connect to the internet so they can be sent.');
      await scope.catalog.setLocal(Number(id), { stockDelta: v }); await refreshCounts();
      setMessage('No internet. The stock change is saved on this phone and will be sent when you are online.');
    }
    setDelta(''); setReason(''); setAdjustKey(newKey());
  });

  const archive = () => Alert.alert('Remove this product?', `${p?.name} is taken off the menu and the till. Its past bills stay as they are.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => { void run('archive', async () => { await api.call(`/products/${id}/archive`, { method: 'POST', body: {} }); goBack(); }); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}><Title>{p?.name ?? 'Product'}</Title>{p ? <Soft>{[p.category_name, p.sku].filter(Boolean).join(' · ')}</Soft> : null}</View>
            <Button title="Back" kind="quiet" onPress={() => goBack()} />
          </View>
          <SavedNote at={savedAt} />
          {error && !p ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}
          {p ? (
            <>
              <Line left="Selling price" right={money(p.selling_price)} sub={`GST ${p.tax_rate}%${p.mrp ? ` · MRP ${money(p.mrp)}` : ''}`} />
              {p.purchase_price > 0 ? <Line left="Cost price" right={money(p.purchase_price)} /> : null}
              {p.track_inventory ? <Line left="In stock here" right={`${qty(p.current_stock)} ${p.unit ?? ''}`} sub={`Reorder level ${qty(p.min_stock)}`} /> : <Line left="Stock" right="Not counted" />}
              {p.barcode ? <Line left="Barcode" right={p.barcode} /> : null}

              <SectionTitle>Change the price</SectionTitle>
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                <TextInput style={s.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder={`New selling price (now ${p.selling_price})`} accessibilityLabel="New selling price" />
                <Button title="Save price" kind="quiet" onPress={savePrice} busy={busy === 'price'} disabled={!price.trim()} />
              </View>

              {p.track_inventory ? (
                <>
                  <SectionTitle>Correct the stock</SectionTitle>
                  <View style={{ paddingHorizontal: 16, gap: 8 }}>
                    <Soft>Add or take away from what the system shows. Use a minus to take away.</Soft>
                    <TextInput style={s.input} value={delta} onChangeText={setDelta} keyboardType="numbers-and-punctuation" placeholder="How many (10 or -3)" accessibilityLabel="Stock change" />
                    <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Why (counted, damaged, received…)" accessibilityLabel="Reason" />
                    <Button title="Update stock" kind="quiet" onPress={saveStock} busy={busy === 'stock'} disabled={!delta.trim() || !reason.trim()} />
                  </View>
                </>
              ) : null}

              <View style={{ padding: 16, gap: 8 }}>
                <ErrorText>{problem}</ErrorText>
                {message ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{message}</Text> : null}
                <Button title="Remove this product" kind="danger" onPress={archive} busy={busy === 'archive'} />
              </View>
            </>
          ) : !error ? <Loading what="Loading the product" /> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
