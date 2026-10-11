import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { kvGet, kvSet, useScope } from '../lib/local.ts';
import { useSale } from '../lib/sale.ts';
import { dayOf } from '../lib/till.ts';
import { refreshCounts, syncAll } from '../lib/sync.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { Product } from '../lib/catalog.ts';
import { addFLine, dropFLine, ensureVisit, estimateOrder, sendOrQueue, setFQty, setFUnit, unitFactor, type FLine } from '../lib/field.ts';
import { PAY_LABEL, leftOnVan, lineRupees, overVan, pendingOnVan, stockByProduct, vanSaleBody, vanSaleProblem, type PayMode, type VanDetail } from '../lib/van.ts';
import { creditText, previewBody, type WPreview } from '../lib/wholesale.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { SearchBox } from '../lib/SearchBox.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const METHODS = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }];

/* A sale at the shop, from the van: only what the van carries, at the shop's wholesale prices, paid on the spot or left on credit. With no signal it is kept on the phone and sent later, once. */
export default function VanSale() {
  const { vehicle, beat } = useLocalSearchParams<{ vehicle: string; beat?: string }>();
  const scope = useScope();
  const { customer } = useSale();
  const van = useLoad<VanDetail>(`van:${vehicle}`, () => api.get<VanDetail>(`/distributor/vehicles/${vehicle}`));
  const [text, setText] = useState('');
  const [products, setProducts] = useState<Map<number, Product>>(new Map());
  const [pending, setPending] = useState<Map<number, number>>(new Map());
  const [lines, setLines] = useState<FLine[]>([]);
  const [mode, setMode] = useState<PayMode>('FULL');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paid, setPaid] = useState('');
  const [preview, setPreview] = useState<WPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState('');
  const key = useRef(newKey());   // one key for this sale: a double tap or a retry makes one bill
  const changed = () => { key.current = newKey(); setPreview(null); setProblem(''); };
  const vehicleId = Number(vehicle);

  const stock = van.data ? stockByProduct(van.data.stock) : [];
  // the phone's own copy of each product carried (the price, the carton sizes) and what was sold from the van since the last look
  useEffect(() => {
    if (!scope || !van.data) return;
    let live = true;
    void (async () => {
      const m = new Map<number, Product>();
      for (const p of stockByProduct(van.data!.stock)) { const x = await scope.catalog.byId(p.product_id); if (x) m.set(p.product_id, x); }
      const list = await scope.actions.list();
      if (live) { setProducts(m); setPending(pendingOnVan(list, vehicleId, (id, unit) => { const p = m.get(id); return p ? unitFactor(p, unit) : 1; })); }
    })();
    return () => { live = false; };
  }, [scope, van.data, vehicleId]);

  useEffect(() => {
    if (!customer || !lines.some((l) => Number(l.quantity) > 0)) { setPreview(null); return; }
    let live = true;
    const t = setTimeout(() => {
      const wl = lines.map((l) => ({ key: l.key, product: { product_id: l.product.product_id } as never, unit_name: l.unit_name, quantity: l.quantity }));
      void api.post<WPreview>('/wholesale/orders/preview', previewBody(customer.id, wl), { timeoutMs: 6000 }).then((p) => { if (live) setPreview(p); }).catch(() => { if (live) setPreview(null); });
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [lines, customer?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const left = new Map(stock.map((p) => [p.product_id, leftOnVan(p, pending)]));
  const shown = stock.filter((p) => products.has(p.product_id) && (!text.trim() || p.name.toLowerCase().includes(text.trim().toLowerCase())));
  const over = overVan(lines, left);
  const est = estimateOrder(lines);
  const total = preview ? preview.total : est.totalPaise / 100;
  const credit = preview ? creditText(preview.credit) : null;
  const bad = vanSaleProblem(customer?.id ?? null, lines, mode, paid, method, reference);
  const edit = (next: FLine[]) => { setLines(next); changed(); };

  const sell = async () => {
    if (bad || !scope || !customer) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const deps = { api, actions: scope.actions, kv: { get: kvGet, set: kvSet } };
      const visit = await ensureVisit(deps, { date: dayOf(Date.now()), customerId: customer.id, shopName: customer.name, outcome: 'ORDER', beatId: beat ? Number(beat) : null });
      const body = vanSaleBody({ customerId: customer.id, lines, mode, paid, method, reference, expectedTotal: total, visitRef: visit.ref });
      const r = await sendOrQueue<{ invoice_id: number; invoice_number: string; review?: string[] }>(deps, { id: key.current, label: `Van sale to ${customer.name}, about ${money(total)}`, method: 'POST', path: `/distributor/vehicles/${vehicle}/sell`, body });
      if (r.kind === 'full') { setProblem('Too many changes are waiting to send. Connect to the internet before selling more.'); return; }
      void refreshCounts(); void syncAll();
      if (r.kind === 'sent') router.replace({ pathname: '/receipt', params: { id: String(r.data.invoice_id) } });
      else setSaved(`The sale to ${customer.name} (about ${money(total)}) is saved on this phone. It is sent by itself when the signal is back, and gets its real bill number then.`);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not make the sale'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Sell from the van</Title><Soft>{customer ? customer.name : 'No shop chosen'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {saved ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{saved}</Text>
            <Button title="Back to my van" onPress={() => router.replace('/van')} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16 }}>
              <Button title={customer ? 'Change shop' : 'Choose the shop'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} />
            </View>
            <View style={{ padding: 16 }}>
              <SearchBox value={text} onChange={setText} placeholder="Search what the van carries" label="Search the van" />
            </View>
            {shown.slice(0, 12).map((p) => (
              <Line key={p.product_id} left={p.name} sub={`${qty(left.get(p.product_id) ?? 0)} ${p.unit ?? ''} on the van`} right={money(lineRupees(products.get(p.product_id)!, null))}
                onPress={() => { edit(addFLine(lines, products.get(p.product_id)!)); setText(''); }} />
            ))}
            {van.data && stock.length === 0 ? <Empty>The van is empty. Stock is loaded at the warehouse.</Empty> : null}

            <SectionTitle>This sale</SectionTitle>
            {lines.length === 0 ? <Empty>Tap a product above to add it.</Empty> : null}
            {lines.map((l) => (
              <View key={l.key} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontSize: 16, color: color.ink, flex: 1 }}>{l.product.name}</Text>
                  <Text style={{ fontWeight: '600', color: color.ink }}>{money(lineRupees(l.product, l.unit_name) * (Number(l.quantity) || 0))}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput style={[s.input, { width: 110 }]} value={l.quantity} onChangeText={(v) => edit(setFQty(lines, l.key, v))} keyboardType="decimal-pad" accessibilityLabel={`Quantity of ${l.product.name}`} />
                  <Text style={{ color: color.soft, flex: 1 }}>{l.unit_name ?? l.product.unit ?? ''}</Text>
                  <Button title="Remove" kind="quiet" onPress={() => edit(dropFLine(lines, l.key))} />
                </View>
                {(l.product.wholesale?.units ?? []).length > 0 ? <Chips items={[{ id: '', label: l.product.unit ?? 'Piece' }, ...(l.product.wholesale?.units ?? []).map((u) => ({ id: u.unit_name, label: `${u.unit_name} (${u.factor})` }))]} value={l.unit_name ?? ''} onChange={(v) => edit(setFUnit(lines, l.key, v || null))} /> : null}
              </View>
            ))}
            {over.map((o) => <Text key={o.name} style={{ color: color.warn, fontWeight: '600', paddingHorizontal: 16, paddingTop: 8 }}>{`${o.name}: ${qty(o.short)} more than the van holds`}</Text>)}

            {lines.length ? (
              <View style={{ padding: 16, gap: 8 }}>
                {preview ? <Soft>{`Items ${money(preview.subtotal)} · GST ${money(preview.tax)}`}</Soft> : <Soft>{`About: items ${money(est.subtotalPaise / 100)} · GST ${money(est.taxPaise / 100)}. FlowXP works out the exact bill, with this shop's price list and offers, when it is sent.`}</Soft>}
                <Text accessibilityLiveRegion="polite" style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{`${preview ? '' : 'about '}${money(total)}`}</Text>
                {credit && credit.text ? <Text style={{ color: credit.tone === 'bad' ? color.danger : credit.tone === 'warn' ? color.warn : color.soft, fontWeight: '600' }}>{credit.text}</Text> : null}
                <Soft>How is it paid?</Soft>
                <Chips<PayMode> items={(Object.keys(PAY_LABEL) as PayMode[]).map((m) => ({ id: m, label: PAY_LABEL[m] }))} value={mode} onChange={setMode} />
                {mode === 'PART' ? <TextInput style={s.input} value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder="How much was paid" accessibilityLabel="How much was paid" /> : null}
                {mode !== 'CREDIT' ? <Chips items={METHODS} value={method} onChange={setMethod} /> : null}
                {mode !== 'CREDIT' && method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Reference number" accessibilityLabel="Reference number" /> : null}
                <ErrorText>{problem}</ErrorText>
                <Button title="Make the sale" onPress={() => { void sell(); }} busy={busy} disabled={Boolean(bad)} />
              </View>
            ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
