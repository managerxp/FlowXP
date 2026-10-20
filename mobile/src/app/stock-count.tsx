import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { qty } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import type { Product } from '../lib/catalog.ts';
import {
  QUICK_GST, QUICK_UNITS, appliedText, applyText, canCount, canQuickAdd, emptyQuick, quickBody, quickProblem, itemSub, scanEntry, scanNote, scopeText, signed, statusLabel, typedEntry, varianceText,
  type CountDetail, type CountEntry, type CountedBack, type CountItem, type QuickForm
} from '../lib/stockCount.ts';
import { syncAll } from '../lib/sync.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, Screen, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

/* One stock count: scan or search to count, correct a number by typing it, see the differences, then apply or cancel. */
export default function StockCount() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useScope();
  const me = currentBusiness(useSession());
  const write = canCount((p) => allowed(me, p));
  const [count, setCount] = useState<CountDetail | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [scanning, setScanning] = useState(false);
  const [permission, ask] = useCameraPermissions();
  const [applying, setApplying] = useState(false);
  const [zero, setZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = useRef({ code: '', at: 0 });
  const [unknown, setUnknown] = useState<string | null>(null);   // a scanned barcode that is not in the products
  const [quick, setQuick] = useState<QuickForm>(emptyQuick());
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState('');
  const canAdd = canQuickAdd((p) => allowed(me, p));

  const load = useCallback(async () => {
    try { setCount(await api.get<CountDetail>(`/retail/counts/${id}?limit=500${onlyDiff ? '&variance=true' : ''}`)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
  }, [id, onlyDiff]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!scope || query.trim().length < 2) { setFound([]); return; }
    let live = true;
    void scope.catalog.search(query.trim(), 6).then((r) => { if (live) setFound(r); });
    return () => { live = false; };
  }, [scope, query]);

  const open = count?.status === 'OPEN';
  const record = (entry: CountEntry) => api.post<CountedBack[]>(`/retail/counts/${id}/items`, { items: [entry] }, { idempotencyKey: newKey() });
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

  const countOne = async (p: Product) => {
    setError('');
    try { const [back] = await record(scanEntry(p.product_id)); setNote(scanNote(p.name, back)); setQuery(''); await load(); } catch (e) { fail(e); }
  };
  const onCode = async ({ data }: { data: string }) => {
    const now = Date.now();
    if (data === last.current.code && now - last.current.at < 1200) return;   // the same code twice in a moment is one scan
    last.current = { code: data, at: now };
    const product = await scope?.catalog.findByBarcode(data);
    if (!product) {
      if (canAdd) { setUnknown(data); setQuick(emptyQuick()); setQuickError(''); return; }
      setNote(t('{code} is not in your products. Check the code, or add it under Products.', { code: data })); return;
    }
    try { const [back] = await record(scanEntry(product.product_id)); setNote(scanNote(product.name, back)); } catch (e) { setNote(e instanceof Error ? e.message : ''); }
  };
  const createQuick = async () => {
    const bad = quickProblem(quick);
    if (bad) { setQuickError(t(bad)); return; }
    setQuickBusy(true); setQuickError('');
    try {
      const made = await api.post<{ product_id: number; name: string }>('/products/quick', quickBody(quick, unknown ?? ''), { idempotencyKey: newKey() });
      const [back] = await record(scanEntry(made.product_id));
      setNote(scanNote(made.name, back)); setUnknown(null); void syncAll();
    } catch (e) { setQuickError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setQuickBusy(false); }
  };
  const commit = async (item: CountItem) => {
    const draft = drafts[item.product_id];
    setDrafts((d) => { const { [item.product_id]: _gone, ...rest } = d; return rest; });
    const entry = draft === undefined ? null : typedEntry(item.product_id, draft);
    if (!entry || ('counted' in entry && entry.counted === item.counted_qty)) return;
    try { await record(entry); await load(); } catch (e) { fail(e); }
  };
  const apply = async () => {
    setBusy(true); setError('');
    try { await api.post(`/retail/counts/${id}/apply`, { zero_uncounted: zero }, { idempotencyKey: newKey() }); setApplying(false); setNote(t('Count applied')); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const cancel = () => Alert.alert(t('Cancel this count?'), t('Your counts are discarded. Stock is not changed.'), [
    { text: t('Keep it'), style: 'cancel' },
    { text: t('Cancel this count'), style: 'destructive', onPress: () => { void api.post(`/retail/counts/${id}/cancel`, {}).then(() => { setNote(t('Count cancelled')); router.back(); }).catch(fail); } }
  ]);

  if (scanning) {
    if (!permission) return <Screen><Soft>…</Soft></Screen>;
    if (!permission.granted) {
      return (
        <Screen>
          <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
            <Text style={{ fontSize: 18, color: color.ink }}>{t('Allow the camera so FlowXP can read barcodes. It does not take or keep photos.')}</Text>
            <Button title="Allow the camera" onPress={() => { void ask(); }} />
            <Button title="Not now" kind="quiet" onPress={() => setScanning(false)} />
          </View>
        </Screen>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={onCode} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }} />
        {unknown ? (
          <ScrollView style={{ maxHeight: '70%', backgroundColor: color.card }} contentContainerStyle={{ padding: 16, gap: 8 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontWeight: '700', color: color.ink }}>{t('Add this product')}</Text>
            <Soft>{t('{code} is not in your products. Check the code, or add it under Products.', { code: unknown })}</Soft>
            <Soft>{t('Barcode {code} will be attached to the new product.', { code: unknown })}</Soft>
            <TextInput style={s.input} value={quick.name} onChangeText={(v) => setQuick((q) => ({ ...q, name: v }))} placeholder={t('Product name')} maxLength={160} accessibilityLabel={t('Product name')} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.input, { flex: 1 }]} value={quick.selling_price} onChangeText={(v) => setQuick((q) => ({ ...q, selling_price: v.replace(/[^\d.]/g, '') }))} keyboardType="decimal-pad" placeholder={t('Selling price (₹)')} accessibilityLabel={t('Selling price (₹)')} />
              <TextInput style={[s.input, { flex: 1 }]} value={quick.mrp} onChangeText={(v) => setQuick((q) => ({ ...q, mrp: v.replace(/[^\d.]/g, '') }))} keyboardType="decimal-pad" placeholder={t('MRP (₹)')} accessibilityLabel={t('MRP (₹)')} />
            </View>
            <Text style={{ color: color.soft, fontSize: 13 }}>{t('GST')}</Text>
            <Chips items={QUICK_GST.map((g) => ({ id: g, label: `${g}%` }))} value={quick.tax_rate} onChange={(g) => setQuick((q) => ({ ...q, tax_rate: g }))} />
            <Text style={{ color: color.soft, fontSize: 13 }}>{t('Sold in')}</Text>
            <Chips items={QUICK_UNITS.map((u) => ({ id: u, label: u }))} value={quick.unit} onChange={(u) => setQuick((q) => ({ ...q, unit: u }))} />
            <ErrorText>{quickError}</ErrorText>
            <Button title="Create and count it" onPress={() => { void createQuick(); }} busy={quickBusy} />
            <Button title="Cancel" kind="quiet" onPress={() => setUnknown(null)} />
          </ScrollView>
        ) : (
          <View style={{ padding: 16, gap: 10, backgroundColor: color.card }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, color: color.ink }}>{note || t('Point the camera at the barcode')}</Text>
            <Button title="Stop scanning" onPress={() => { setScanning(false); void load(); }} />
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{count?.name ?? t('Stock counts')}</Title>{count ? <Soft>{statusLabel(count.status)} · {scopeText(count)}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {error && !count ? <Failed message={error} onRetry={() => { void load(); }} /> : !count ? <Loading /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
              <Stat label="Products counted" value={String(count.totals.lines)} /><Stat label="With a difference" value={String(count.totals.variance_lines)} tone={count.totals.variance_lines ? color.warn : undefined} />
              <Stat label="Units short" value={qty(count.totals.short_units)} tone={count.totals.short_units ? color.danger : undefined} /><Stat label="Units extra" value={qty(count.totals.extra_units)} />
              <Stat label="Not counted yet" value={String(count.uncounted)} />
            </View>

            {open && write ? (
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                <Button title="Scan items" onPress={() => { setNote(''); setScanning(true); }} />
                <TextInput style={s.input} value={query} onChangeText={setQuery} placeholder={t('Search a product to count it (+1)')} autoCorrect={false} accessibilityLabel={t('Search a product to count it (+1)')} />
                {found.map((p) => <Line key={p.product_id} left={p.name} sub={[p.sku, p.barcodes?.[0]].filter(Boolean).join(' · ')} onPress={() => { void countOne(p); }} />)}
              </View>
            ) : null}
            {note ? <Soft style={{ padding: 16 }}>{note}</Soft> : null}
            <ErrorText>{error}</ErrorText>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 }}>
              <Switch value={onlyDiff} onValueChange={setOnlyDiff} accessibilityLabel={t('Only products with a difference')} /><Text style={{ color: color.ink, flex: 1 }}>{t('Only products with a difference')}</Text>
            </View>
            {count.items.length === 0 ? <Empty>{onlyDiff ? 'No differences so far.' : 'Nothing counted yet.'}</Empty> : null}
            {count.items.length === 0 && open && !onlyDiff ? <Soft style={{ paddingHorizontal: 16 }}>{t('Press Scan items and scan each product on the shelf, once per unit. Or search above.')}</Soft> : null}
            {count.items.map((it) => (
              <View key={it.product_id}>
                <Line left={it.name} right={varianceText(it.variance)} sub={[itemSub(it), t('System said {n}', { n: qty(it.system_qty) })].filter(Boolean).join(' · ')} />
                {open && write ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 }}>
                    <Text style={{ color: color.soft }}>{t('You counted')}</Text>
                    <TextInput style={[s.input, { width: 110, textAlign: 'right' }]} value={drafts[it.product_id] ?? String(it.counted_qty)} keyboardType="decimal-pad"
                      onChangeText={(v) => setDrafts((d) => ({ ...d, [it.product_id]: v.replace(/[^\d.]/g, '') }))} onBlur={() => { void commit(it); }} onSubmitEditing={() => { void commit(it); }} accessibilityLabel={`${t('You counted')} ${it.name}`} />
                  </View>
                ) : <Soft style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{t('You counted')} {qty(it.counted_qty)}</Soft>}
              </View>
            ))}

            {count.status === 'APPLIED' ? <Soft style={{ padding: 16 }}>{appliedText(count)}</Soft> : null}
            {open && write ? (
              <View style={{ padding: 16, gap: 10 }}>
                {applying ? (
                  <View style={[s.card, { gap: 10 }]}>
                    <Text style={{ fontWeight: '700', color: color.ink }}>{t('Apply this count?')}</Text>
                    <Soft>{applyText(count)}</Soft>
                    {count.uncounted > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Switch value={zero} onValueChange={setZero} accessibilityLabel={t('Set the {n} products I did not count to zero.', { n: count.uncounted })} />
                        <View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t('Set the {n} products I did not count to zero.', { n: count.uncounted })}</Text><Soft>{t('Only tick this if the whole store or category was counted and anything not scanned is truly gone.')}</Soft></View>
                      </View>
                    ) : null}
                    <Button title="Apply count" kind={zero ? 'danger' : 'primary'} onPress={() => { void apply(); }} busy={busy} />
                    <Button title="Keep counting" kind="quiet" onPress={() => setApplying(false)} />
                  </View>
                ) : <Button title="Finish and apply" kind="quiet" onPress={() => setApplying(true)} disabled={!count.totals.lines} />}
                <Button title="Cancel this count" kind="quiet" onPress={cancel} />
              </View>
            ) : null}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
