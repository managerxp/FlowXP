import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { syncAll } from '../../lib/sync.ts';
import { goBack } from '../../lib/nav.ts';
import { setCaptured, useCaptured } from '../../lib/capture.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Soft, Title, color, s } from '../../lib/ui.tsx';

const GST = ['0', '5', '12', '18', '28'];
type Category = { category_id: number; name: string };

/* A new product: the few things a till needs. More (brand, recipe, photos) is on the FlowXP website. */
export default function NewProduct() {
  const captured = useCaptured();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [gst, setGst] = useState('5');
  const [unit, setUnit] = useState('pc');
  const [barcode, setBarcode] = useState('');
  const [count, setCount] = useState(false);
  const [stock, setStock] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(newKey());   // one key for this form: saving twice (a double tap, a retry) makes one product

  useEffect(() => { void api.get<Category[]>('/categories').then(setCategories).catch(() => {}); }, []);
  useEffect(() => { if (captured) { setBarcode(captured); setCaptured(null); } }, [captured]);

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('Give the product a name');
    if (price.trim() === '' || !(Number(price) >= 0)) return setError('Enter the selling price');
    if (count && stock.trim() !== '' && !(Number(stock) >= 0)) return setError('Stock on hand must be zero or more');
    setBusy(true);
    try {
      await api.call('/products', {
        method: 'POST', idempotencyKey: key,
        body: {
          name: name.trim(), selling_price: Number(price), tax_rate: Number(gst), unit: unit.trim() || 'pc',
          ...(mrp.trim() ? { mrp: Number(mrp) } : {}), ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          ...(categoryId !== '0' ? { category_id: Number(categoryId) } : {}),
          track_inventory: count, ...(count && stock.trim() ? { opening_stock: Number(stock) } : {})
        }
      });
      void syncAll();
      goBack();
    } catch (e) { setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>New product</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name" accessibilityLabel="Name" autoFocus />
          <TextInput style={s.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Selling price" accessibilityLabel="Selling price" />
          <TextInput style={s.input} value={mrp} onChangeText={setMrp} keyboardType="decimal-pad" placeholder="MRP (optional)" accessibilityLabel="MRP" />
          <Soft>GST rate</Soft>
          <Chips items={GST.map((g) => ({ id: g, label: `${g}%` }))} value={gst} onChange={setGst} />
          <TextInput style={s.input} value={unit} onChangeText={setUnit} placeholder="Unit (pc, kg, litre)" accessibilityLabel="Unit" autoCapitalize="none" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[s.input, { flex: 1 }]} value={barcode} onChangeText={setBarcode} placeholder="Barcode (optional)" accessibilityLabel="Barcode" keyboardType="number-pad" />
            <Button title="Scan" kind="quiet" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} />
          </View>
          {categories.length ? (
            <>
              <Soft>Category</Soft>
              <Chips items={[{ id: '0', label: 'None' }, ...categories.map((c) => ({ id: String(c.category_id), label: c.name }))]} value={categoryId} onChange={setCategoryId} />
            </>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
            <Text style={{ color: color.ink }}>Count the stock of this product</Text>
            <Switch value={count} onValueChange={setCount} accessibilityLabel="Count the stock" />
          </View>
          {count ? <TextInput style={s.input} value={stock} onChangeText={setStock} keyboardType="decimal-pad" placeholder="How many do you have now?" accessibilityLabel="Stock on hand" /> : null}
          <ErrorText>{error}</ErrorText>
          <Button title="Save product" onPress={save} busy={busy} />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
