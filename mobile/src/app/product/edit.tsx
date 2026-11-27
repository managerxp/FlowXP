import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../lib/api.ts';
import { api, currentBusiness, useSession } from '../../lib/session.ts';
import { gstView } from '../../lib/gst.ts';
import { syncAll } from '../../lib/sync.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import type { ProductFull } from '../../lib/types.ts';
import ProductPhoto from '../../lib/ProductPhoto.tsx';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s, TextInput } from '../../lib/ui.tsx';

type Category = { category_id: number; name: string };
type TaxRate = { tax_rate_id: number; name: string; rate: number; kind: string };
const GST = ['0', '5', '12', '18', '28'];
const text = (v: unknown) => (v == null ? '' : String(v));

/* Change everything about a product, the same things the website's edit form changes: photo, name, prices, GST, unit, category, stock counting, description, barcode. */
export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const cessOn = gstView(currentBusiness(session)).cess;
  const loaded = useLoad<ProductFull>(`product:${session.businessId}:${session.branchId}:${id}`, () => api.get<ProductFull>(`/products/${id}`));
  const p = loaded.data;
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [inclusive, setInclusive] = useState(false);
  const [track, setTrack] = useState(false);
  const [rateId, setRateId] = useState('');
  const [categoryId, setCategoryId] = useState('0');
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const set = (k: string) => (v: string) => setF((cur) => ({ ...(cur ?? {}), [k]: v }));

  useEffect(() => {
    void api.get<Category[]>('/categories').then(setCategories).catch(() => {});
    void api.get<TaxRate[]>('/tax-rates').then(setRates).catch(() => {});
  }, []);
  useEffect(() => {
    if (!p || f) return;
    setF({ name: p.name, selling_price: text(p.shared_price ?? p.selling_price), purchase_price: p.purchase_price ? text(p.purchase_price) : '', mrp: text(p.mrp), tax_rate: text(p.tax_rate), cess_rate: p.cess_rate ? text(p.cess_rate) : '', unit: text(p.unit), description: text(p.description), min_stock: p.min_stock ? text(p.min_stock) : '', barcode: '' });
    setInclusive(Boolean(p.price_includes_tax)); setTrack(p.track_inventory); setRateId(p.tax_rate_id ? String(p.tax_rate_id) : '');
    setCategoryId(p.category_id ? String(p.category_id) : '0'); setPhoto(p.image_url);
  }, [p, f]);

  const pickRate = (v: string) => { setRateId(v); const r = rates.find((x) => String(x.tax_rate_id) === v); if (r) set('tax_rate')(String(r.rate)); };

  const save = async () => {
    if (!f) return;
    setError(''); setSaved('');
    if (!f.name.trim()) return setError('Give the product a name');
    if (f.selling_price.trim() === '' || !(Number(f.selling_price) >= 0)) return setError('Enter the selling price');
    setBusy(true);
    try {
      await api.call(`/products/${id}`, {
        method: 'PATCH',
        body: {
          name: f.name.trim(), selling_price: Number(f.selling_price), purchase_price: Number(f.purchase_price || 0),
          mrp: f.mrp.trim() ? Number(f.mrp) : null, unit: f.unit.trim() || 'pc', description: f.description.trim() || null,
          tax_rate: Number(f.tax_rate || 0), ...(rateId ? { tax_rate_id: Number(rateId) } : {}), price_includes_tax: inclusive,
          ...(cessOn ? { cess_rate: Number(f.cess_rate || 0) } : {}),
          category_id: categoryId === '0' ? null : Number(categoryId),
          track_inventory: track, min_stock: Number(f.min_stock || 0)
        }
      });
      if (f.barcode.trim()) await api.call(`/products/${id}/barcodes`, { method: 'POST', body: { barcode: f.barcode.trim() } });
      void syncAll(); await loaded.refresh();
      setSaved('Saved.'); setF((cur) => (cur ? { ...cur, barcode: '' } : cur));
    } catch (e) { setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  const field = (k: string, label: string, opts: { keyboard?: 'decimal-pad' | 'number-pad'; multiline?: boolean } = {}) => (
    <View style={{ gap: 4 }}>
      <Soft>{label}</Soft>
      <TextInput style={[s.input, opts.multiline ? { minHeight: 80, textAlignVertical: 'top' } : null]} value={f?.[k] ?? ''} onChangeText={set(k)} keyboardType={opts.keyboard} multiline={opts.multiline} accessibilityLabel={label} />
    </View>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Title>Edit product</Title><Button title="Done" kind="quiet" onPress={() => goBack()} /></View>
          {loaded.error && !p ? <Failed message={loaded.error} onRetry={() => { void loaded.refresh(); }} /> : null}
          {!p || !f ? (!loaded.error ? <Loading what="Loading the product" /> : null) : (
            <>
              <ProductPhoto productId={p.product_id} url={photo} onChange={setPhoto} />
              {field('name', 'Name')}
              {field('selling_price', 'Selling price', { keyboard: 'decimal-pad' })}
              {field('mrp', 'MRP (optional)', { keyboard: 'decimal-pad' })}
              {p.purchase_price !== undefined ? field('purchase_price', 'Cost price (what you pay)', { keyboard: 'decimal-pad' }) : null}
              <SectionTitle>GST</SectionTitle>
              {rates.length
                ? <Chips items={rates.map((r) => ({ id: String(r.tax_rate_id), label: r.name }))} value={rateId} onChange={pickRate} />
                : <Chips items={GST.map((g) => ({ id: g, label: `${g}%` }))} value={f.tax_rate} onChange={set('tax_rate')} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <Text style={{ color: color.ink, flex: 1 }}>Price includes GST</Text>
                <Switch value={inclusive} onValueChange={setInclusive} accessibilityLabel="Price includes GST" />
              </View>
              {cessOn ? field('cess_rate', 'Cess % (optional)', { keyboard: 'decimal-pad' }) : null}
              {field('unit', 'Unit (pc, kg, litre)')}
              {categories.length ? (
                <>
                  <Soft>Category</Soft>
                  <Chips items={[{ id: '0', label: 'None' }, ...categories.map((c) => ({ id: String(c.category_id), label: c.name }))]} value={categoryId} onChange={setCategoryId} />
                </>
              ) : null}
              {field('description', 'Description (optional)', { multiline: true })}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <Text style={{ color: color.ink, flex: 1 }}>Count the stock of this product</Text>
                <Switch value={track} onValueChange={setTrack} accessibilityLabel="Count the stock" />
              </View>
              {track ? field('min_stock', 'Tell me when stock falls to', { keyboard: 'decimal-pad' }) : null}
              {field('barcode', p.barcode ? `Add another barcode (now ${p.barcode})` : 'Add a barcode', { keyboard: 'number-pad' })}
              <ErrorText>{error}</ErrorText>
              {saved ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{saved}</Text> : null}
              <Button title="Save changes" onPress={save} busy={busy} />
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
