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
import type { Product } from '../lib/catalog.ts';
import { addFLine, dropFLine, ensureVisit, estimateOrder, fieldOrderBody, fieldOrderProblem, pieceRupees, sendOrQueue, setFQty, setFUnit, unitFactor, type FLine } from '../lib/field.ts';
import { creditText, previewBody, shortLines, type WPreview } from '../lib/wholesale.ts';
import { qty, rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { SearchBox } from '../lib/SearchBox.tsx';
import { Offers } from '../lib/Offers.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));

/* An order taken in the shop. The products and prices come from the phone's own copy, so it works with no signal; with a signal you also see the shop's real price, what is short and their credit. Sent now, or kept and sent later with the visit. */
export default function FieldOrder() {
  const { beat } = useLocalSearchParams<{ beat?: string }>();
  const scope = useScope();
  const { customer } = useSale();
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<FLine[]>([]);
  const [preview, setPreview] = useState<WPreview | null>(null);
  const [po, setPo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState('');
  const key = useRef(newKey());   // one key for this order: a double tap or a retry makes one order
  const changed = () => { key.current = newKey(); setPreview(null); setProblem(''); };

  useEffect(() => {
    if (!scope || text.trim().length < 2) { setFound([]); return; }
    let live = true;
    void scope.catalog.search(text.trim(), 12).then((r) => { if (live) setFound(r); });
    return () => { live = false; };
  }, [text, scope]);

  // with a signal: the shop's real price, what is short and their credit (silent with none: the estimate stands)
  useEffect(() => {
    if (!customer || !lines.some((l) => Number(l.quantity) > 0)) { setPreview(null); return; }
    let live = true;
    const t = setTimeout(() => {
      const wl = lines.map((l) => ({ key: l.key, product: { product_id: l.product.product_id } as never, unit_name: l.unit_name, quantity: l.quantity }));
      void api.post<WPreview>('/wholesale/orders/preview', previewBody(customer.id, wl), { timeoutMs: 6000 }).then((p) => { if (live) setPreview(p); }).catch(() => { if (live) setPreview(null); });
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [lines, customer?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: FLine[]) => { setLines(next); changed(); };
  const est = estimateOrder(lines);
  const bad = !customer ? 'Choose the shop first' : fieldOrderProblem(lines);
  const credit = preview ? creditText(preview.credit) : null;
  const short = shortLines(preview);

  const send = async () => {
    if (bad || !scope || !customer) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      const deps = { api, actions: scope.actions, kv: { get: kvGet, set: kvSet } };
      const visit = await ensureVisit(deps, { date: dayOf(Date.now()), customerId: customer.id, shopName: customer.name, outcome: 'ORDER', beatId: beat ? Number(beat) : null });
      const shown = preview ? preview.total : est.totalPaise / 100;
      const body = fieldOrderBody(customer.id, lines, visit.ref, shown, { customerPo: po, notes });
      const r = await sendOrQueue<{ order_id: number; order_number: string }>(deps, { id: key.current, label: `Order for ${customer.name} (${lines.filter((l) => Number(l.quantity) > 0).length} products, about ${money(shown)})`, method: 'POST', path: '/wholesale/orders', body });
      if (r.kind === 'full') { setProblem('Too many changes are waiting to send. Connect to the internet before taking more orders.'); return; }
      void refreshCounts(); void syncAll();
      if (r.kind === 'sent') router.replace({ pathname: '/wholesale-order/[id]', params: { id: String(r.data.order_id) } });
      else setSaved(`The order for ${customer.name} is saved on this phone. It is sent by itself when the signal is back, and the office confirms it.`);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not send the order'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Take an order</Title><Soft>{customer ? customer.name : 'No shop chosen'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {saved ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{saved}</Text>
            <Button title="Back to my route" onPress={() => router.replace('/field')} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ padding: 16 }}>
              <SearchBox value={text} onChange={setText} placeholder="Search a product by name, code or barcode" label="Search a product" />
            </View>
            {found.map((p) => (
              <Line key={p.product_id} left={p.name} sub={`${p.current_stock != null ? `${qty(p.current_stock)} in stock` : ''}${(p.wholesale?.moq ?? 1) > 1 ? ` · minimum ${p.wholesale?.moq}` : ''}`.replace(/^ · /, '')} right={money(pieceRupees(p))}
                onPress={() => { edit(addFLine(lines, p)); setText(''); setFound([]); }} />
            ))}

            <SectionTitle>This order</SectionTitle>
            {lines.length === 0 ? <Empty>Search a product above and tap it to add it.</Empty> : null}
            {lines.map((l) => {
              const pl = preview?.lines.find((x) => x.product_id === l.product.product_id && !x.is_free);
              const each = pl ? pl.price : pieceRupees(l.product) * unitFactor(l.product, l.unit_name);
              return (
                <View key={l.key} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ fontSize: 16, color: color.ink, flex: 1 }}>{l.product.name}</Text>
                    <Text style={{ fontWeight: '600', color: color.ink }}>{pl ? money(pl.line_total) : money(each * (Number(l.quantity) || 0))}</Text>
                  </View>
                  <Soft>{`${money(each)} each${pl ? '' : ' (about)'}`}</Soft>
                  {pl && pl.short > 0 ? <Text style={{ color: color.warn, fontWeight: '600' }}>{`${qty(pl.short)} short of stock: it will be a back-order`}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput style={[s.input, { width: 110 }]} value={l.quantity} onChangeText={(v) => edit(setFQty(lines, l.key, v))} keyboardType="decimal-pad" accessibilityLabel={`Quantity of ${l.product.name}`} />
                    <Text style={{ color: color.soft, flex: 1 }}>{l.unit_name ?? l.product.unit ?? ''}</Text>
                    <Button title="Remove" kind="quiet" onPress={() => edit(dropFLine(lines, l.key))} />
                  </View>
                  {(l.product.wholesale?.units ?? []).length > 0 ? <Chips items={[{ id: '', label: l.product.unit ?? 'Piece' }, ...(l.product.wholesale?.units ?? []).map((u) => ({ id: u.unit_name, label: `${u.unit_name} (${u.factor})` }))]} value={l.unit_name ?? ''} onChange={(v) => edit(setFUnit(lines, l.key, v || null))} /> : null}
                </View>
              );
            })}

            <Offers customerId={customer?.id ?? null} lines={lines} />

            {lines.length ? (
              <View style={{ padding: 16, gap: 6 }}>
                {preview ? (
                  <>
                    <Soft>{`Items ${money(preview.subtotal)} · GST ${money(preview.tax)}`}</Soft>
                    <Text accessibilityLiveRegion="polite" style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{money(preview.total)}</Text>
                    {credit && credit.text ? <Text style={{ color: credit.tone === 'bad' ? color.danger : credit.tone === 'warn' ? color.warn : color.soft, fontWeight: '600' }}>{credit.text}</Text> : null}
                    {short.length ? <Text style={{ color: color.warn }}>{`${short.length} product${short.length === 1 ? ' is' : 's are'} short of stock.`}</Text> : null}
                  </>
                ) : (
                  <>
                    <Soft>{`About: items ${money(est.subtotalPaise / 100)} · GST ${money(est.taxPaise / 100)}. FlowXP works out the exact price, with this shop's price list and offers, when it is sent.`}</Soft>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{`about ${money(est.totalPaise / 100)}`}</Text>
                  </>
                )}
                <TextInput style={s.input} value={po} onChangeText={setPo} placeholder="Shop's PO number (optional)" accessibilityLabel="Shop PO number" />
                <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="A note (optional)" accessibilityLabel="Note" />
                <ErrorText>{problem}</ErrorText>
                <Button title="Send the order" onPress={() => { void send(); }} busy={busy} disabled={Boolean(bad)} />
              </View>
            ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
