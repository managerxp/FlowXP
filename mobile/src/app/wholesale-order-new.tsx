import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useSale } from '../lib/sale.ts';
import { addLine, creditText, dropLine, orderBody, orderProblem, previewBody, setQty, setUnit, shortLines, type WLine, type WPreview, type WProduct } from '../lib/wholesale.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { SearchBox } from '../lib/SearchBox.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* Take an order for a customer: choose them, add products (in a carton or by the piece), and see the price they get, what is short, and where they stand on credit before sending it. */
export default function NewWholesaleOrder() {
  const { customer } = useSale();
  const [text, setText] = useState('');
  const [found, setFound] = useState<WProduct[]>([]);
  const [lines, setLines] = useState<WLine[]>([]);
  const [preview, setPreview] = useState<WPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [po, setPo] = useState('');
  const [notes, setNotes] = useState('');
  const [wanted, setWanted] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [key, setKey] = useState(newKey());   // one key per order: a double tap makes one order
  const changed = () => { setKey(newKey()); setPreview(null); setProblem(''); };

  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => { void api.get<WProduct[]>(`/wholesale/products/lookup?q=${encodeURIComponent(text.trim())}`).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text]);

  // the price this customer gets (their price list, schemes), what is short, and their credit: asked again whenever the order changes
  useEffect(() => {
    if (!customer || !lines.some((l) => Number(l.quantity) > 0)) { setPreview(null); setPreviewError(''); return; }
    let live = true;
    const t = setTimeout(() => {
      void api.post<WPreview>('/wholesale/orders/preview', previewBody(customer.id, lines)).then((p) => { if (live) { setPreview(p); setPreviewError(''); } }).catch((e: Error) => { if (live) { setPreview(null); setPreviewError(e.message); } });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [lines, customer?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: WLine[]) => { setLines(next); changed(); };
  const bad = orderProblem(customer?.id ?? null, lines);
  const short = shortLines(preview);
  const credit = preview ? creditText(preview.credit) : null;

  const save = async (submit: boolean) => {
    if (bad) return setProblem(bad);
    setBusy(submit ? 'submit' : 'draft'); setProblem('');
    try {
      const o = await api.post<{ order_id: number }>('/wholesale/orders', orderBody(customer!.id, lines, { submit, customerPo: po, notes, expectedDelivery: wanted }), { idempotencyKey: key });
      router.replace({ pathname: '/wholesale-order/[id]', params: { id: String(o.order_id) } });
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the order'); }
    finally { setBusy(''); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>New order</Title><Soft>{customer ? customer.name : 'No customer chosen'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ paddingHorizontal: 16 }}>
            <Button title={customer ? 'Change customer' : 'Choose customer'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} />
          </View>
          <View style={{ padding: 16 }}>
            <SearchBox value={text} onChange={setText} placeholder="Search a product by name, code or barcode" label="Search a product" />
          </View>
          {found.map((p) => (
            <Line key={p.product_id} left={p.name} sub={`${p.available != null ? `${qty(p.available)} ${p.unit ?? ''} free` : ''}${p.moq > 1 ? ` · minimum ${p.moq}` : ''}${p.pack_size ? ` · ${p.pack_size}` : ''}`.replace(/^ · /, '')} right={money(p.wholesale_price || p.selling_price)}
              onPress={() => { edit(addLine(lines, p)); setText(''); setFound([]); }} />
          ))}

          <SectionTitle>This order</SectionTitle>
          {lines.length === 0 ? <Empty>Search a product above and tap it to add it.</Empty> : null}
          {lines.map((l) => {
            const pl = preview?.lines.find((x) => x.product_id === l.product.product_id && x.is_free === false);
            return (
              <View key={l.key} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontSize: 16, color: color.ink, flex: 1 }}>{l.product.name}</Text>
                  {pl ? <Text style={{ fontWeight: '600', color: color.ink }}>{money(pl.line_total)}</Text> : null}
                </View>
                {pl ? <Soft>{`${money(pl.price)} each${pl.discount_pct ? ` · ${pl.discount_pct}% off` : ''}${pl.price_source && pl.price_source !== 'BASE' && pl.price_source !== 'DEFAULT' ? ` · ${pl.price_source.toLowerCase().replace(/_/g, ' ')} price` : ''} · GST ${pl.tax_rate}%`}</Soft> : null}
                {pl && pl.short > 0 ? <Text style={{ color: color.warn, fontWeight: '600' }}>{`${qty(pl.short)} short of stock: it will be a back-order`}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput style={[s.input, { width: 110 }]} value={l.quantity} onChangeText={(v) => edit(setQty(lines, l.key, v))} keyboardType="decimal-pad" accessibilityLabel={`Quantity of ${l.product.name}`} />
                  <Text style={{ color: color.soft, flex: 1 }}>{l.unit_name ?? l.product.unit ?? ''}</Text>
                  <Button title="Remove" kind="quiet" onPress={() => edit(dropLine(lines, l.key))} />
                </View>
                {(l.product.units ?? []).length > 0 ? (
                  <Chips items={[{ id: '', label: l.product.unit ?? 'Piece' }, ...(l.product.units ?? []).map((u) => ({ id: u.unit_name, label: `${u.unit_name} (${u.factor})` }))]} value={l.unit_name ?? ''} onChange={(v) => edit(setUnit(lines, l.key, v || null))} />
                ) : null}
              </View>
            );
          })}

          {preview ? (
            <View style={{ padding: 16, gap: 6 }}>
              {preview.schemes.length ? <Soft>{`Offers applied: ${preview.schemes.map((x) => x.scheme).join(', ')}`}</Soft> : null}
              {(preview.scheme_hints ?? []).map((h) => <Soft key={h}>{h}</Soft>)}
              <Soft>{`Items ${money(preview.subtotal)} · GST ${money(preview.tax)}`}</Soft>
              <Text accessibilityLiveRegion="polite" style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{money(preview.total)}</Text>
              {credit && credit.text ? <Text style={{ color: credit.tone === 'bad' ? color.danger : credit.tone === 'warn' ? color.warn : color.soft, fontWeight: '600' }}>{credit.text}</Text> : null}
              {preview.credit.limit > 0 ? <Soft>{`Owes ${money(preview.credit.outstanding)} of a ${money(preview.credit.limit)} limit`}</Soft> : null}
              {preview.approval_needed ? <Soft>This order needs a manager's approval.</Soft> : null}
              {short.length ? <Text style={{ color: color.warn }}>{`${short.length} product${short.length === 1 ? ' is' : 's are'} short of stock.`}</Text> : null}
            </View>
          ) : previewError ? <View style={{ paddingHorizontal: 16 }}><Text style={{ color: color.danger }}>{previewError}</Text></View> : null}

          {lines.length ? (
            <View style={{ padding: 16, gap: 10 }}>
              <TextInput style={s.input} value={po} onChangeText={setPo} placeholder="Customer's PO number (optional)" accessibilityLabel="Customer PO number" />
              <TextInput style={s.input} value={wanted} onChangeText={setWanted} placeholder="Wanted by, like 2026-10-20 (optional)" accessibilityLabel="Wanted by" autoCapitalize="none" />
              <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" />
              <ErrorText>{problem}</ErrorText>
              <Button title="Submit the order" onPress={() => { void save(true); }} busy={busy === 'submit'} disabled={Boolean(bad)} />
              <Button title="Save as draft" kind="quiet" onPress={() => { void save(false); }} busy={busy === 'draft'} disabled={Boolean(bad)} />
            </View>
          ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
