import { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from './api.ts';
import { useScope } from './local.ts';
import { dayOf, unreachable } from './till.ts';
import { refreshCounts, syncAll } from './sync.ts';
import { api } from './session.ts';
import { clearSale, setCustomer, useSale } from './sale.ts';
import { setCaptured, useCaptured } from './capture.ts';
import {
  addMedicine, estimate, expiryText, fromProduct, pharmacyProblem, pickBatch, previewOf, quoteBody, removeLine, roughPaise, rxLines, rxNote, saleBody, sellable, setQuantity, shortBy,
  type Batch, type Medicine, type PharmacyQuote, type PLine
} from './pharmacy.ts';
import { qty, rupees, toPaise } from './money.ts';
import { Page } from './responsive.tsx';
import { Button, Chips, Empty, ErrorText, Line, SectionTitle, Soft, Title, color, s } from './ui.tsx';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const METHODS = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }];

/* The pharmacy till: find a medicine by name, salt or barcode, set how many, and the server picks the earliest-expiry batch for you (or choose one). Medicines that need a prescription are marked and must be checked before the bill. */
export function PharmacyTill() {
  const { customer } = useSale();
  const scope = useScope();
  const [offline, setOffline] = useState(false);   // no answer from the server: the phone's own copy of the medicines is used, and the bill is kept to send later
  const captured = useCaptured();
  const [text, setText] = useState('');
  const [found, setFound] = useState<Medicine[]>([]);
  const [lines, setLines] = useState<PLine[]>([]);
  const [quote, setQuote] = useState<PharmacyQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [choosing, setChoosing] = useState<{ key: string; batches: Batch[] } | null>(null);
  const [rxChecked, setRxChecked] = useState(false);
  const [doctor, setDoctor] = useState('');
  const [patient, setPatient] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const key = useRef(newKey());   // one key for this bill: a retry after a dropped signal returns the same invoice, never a second one
  const changed = () => { key.current = newKey(); setQuote(null); setProblem(''); };

  useEffect(() => { if (captured) { setText(captured); setCaptured(null); } }, [captured]);

  useEffect(() => {
    if (text.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => {
      void api.get<Medicine[]>(`/pharmacy/products/lookup?q=${encodeURIComponent(text.trim())}`, { timeoutMs: 6000 })
        .then((r) => { if (live) { setFound(r); setOffline(false); } })
        .catch(async (e) => {
          if (!live) return;
          if (unreachable(e) && scope) { setOffline(true); setFound((await scope.catalog.search(text.trim(), 12)).map(fromProduct)); }
          else setFound([]);
        });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [text, scope]);   // eslint-disable-line react-hooks/exhaustive-deps

  const bad = pharmacyProblem(lines, rxChecked);
  const notBlocked = lines.length > 0;

  // the quote: the bill exactly as the server would make it (price, GST, which batch), asked again whenever the bill changes
  useEffect(() => {
    if (!notBlocked) { setQuote(null); setQuoteError(''); return; }
    let live = true;
    const t = setTimeout(() => {
      void api.post<PharmacyQuote>('/pharmacy/pos/quote', quoteBody(lines, customer?.id ?? null), { timeoutMs: 6000 })
        .then((q) => { if (live) { setQuote(q); setQuoteError(''); setOffline(false); } })
        .catch((e: Error) => { if (live) { setQuote(null); if (unreachable(e)) { setOffline(true); setQuoteError(''); } else setQuoteError(e.message); } });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [lines, customer?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: PLine[]) => { setLines(next); changed(); };
  const add = (m: Medicine) => { edit(addMedicine(lines, m)); setText(''); setFound([]); };

  const openBatches = async (l: PLine) => {
    try { const all = await api.get<Batch[]>(`/pharmacy/inventory/batches?product_id=${l.product.product_id}&state=active`); setChoosing({ key: l.key, batches: all.filter((b) => sellable(b, today())) }); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'Could not load the batches'); }
  };

  const pay = async () => {
    if (bad) return setProblem(bad);
    if (!quote && !offline) return setProblem(quoteError || 'Wait a moment for the total');
    setBusy(true); setProblem('');
    // the same body for the first try and every retry (the server's duplicate guard compares them), with the total the customer was shown
    const shown = quote ? quote.invoice.total : estimate(lines).totalPaise / 100;
    const body = saleBody(lines, customer?.id ?? null, method, reference, rxNote(lines, doctor, patient), { rxChecked, expectedTotal: shown });
    const finish = () => { clearSale(); setLines([]); setRxChecked(false); setDoctor(''); setPatient(''); key.current = newKey(); };
    try {
      const out = await api.post<PharmacyQuote>('/pharmacy/pos/invoices', body, { idempotencyKey: key.current, timeoutMs: 8000 });
      finish();
      router.replace({ pathname: '/receipt', params: { id: String(out.invoice.invoice_id) } });
    } catch (e) {
      if (unreachable(e) && scope) {
        // no usable connection: keep the sale on this phone, hand over the medicine, and send it later with the same key
        const entry = await scope.outbox.add({ id: key.current, body, preview: previewOf(lines, method), path: '/pharmacy/pos/invoices' });
        if (!entry) { setProblem('Too many bills are waiting to send. Connect to the internet before making more.'); setBusy(false); return; }
        for (const l of lines) if (l.product.track_inventory) await scope.catalog.setLocal(l.product.product_id, { stockDelta: -l.quantity });
        finish(); void refreshCounts(); void syncAll();
        router.replace({ pathname: '/receipt', params: { local: entry.id } });
        setBusy(false); return;
      } setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not take the payment'); }
    finally { setBusy(false); }
  };

  const rx = rxLines(lines);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>New bill</Title><Soft>{customer ? `${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}` : 'No customer chosen'}</Soft></View>
          <Button title="Scan" kind="quiet" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          {offline ? <Text accessibilityLiveRegion="polite" style={{ color: color.warn, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 }}>No internet. Using the medicines saved on this phone. The bill is kept here and sent by itself, and FlowXP picks the batch when it arrives.</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
            <Button title={customer ? 'Change customer' : 'Choose customer'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} style={{ flex: 1 }} />
            {customer ? <Button title="No customer" kind="quiet" onPress={() => { setCustomer(null); changed(); }} /> : null}
          </View>
          <View style={{ padding: 16 }}>
            <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Medicine name, salt or barcode" accessibilityLabel="Search medicines" autoCorrect={false} />
          </View>
          {found.map((m) => (
            <Line key={m.product_id} left={`${m.name}${m.strength ? ` ${m.strength}` : ''}`}
              sub={`${[m.dosage_form, m.manufacturer].filter(Boolean).join(' · ')}${m.prescription_required ? ' · Prescription' : ''} · ${m.available != null ? `${qty(m.available)} in stock` : 'In stock'}`}
              right={rupees(toPaise(m.selling_price))} onPress={() => add(m)} />
          ))}
          {text.trim().length >= 2 && found.length === 0 ? <Empty>No medicine matches.</Empty> : null}

          <SectionTitle>This bill</SectionTitle>
          {lines.length === 0 ? <Empty>Search a medicine above, or tap Scan, and tap it to add it.</Empty> : null}
          {lines.map((l) => {
            const short = shortBy(l);
            return (
              <View key={l.key} style={{ padding: 16, gap: 6, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, color: color.ink }}>{l.product.name}{l.product.strength ? ` ${l.product.strength}` : ''}</Text>
                    <Soft>{l.batch ? `Batch ${l.batch.batch_no} · ${expiryText(l.batch.expiry_date, today())}` : 'Batch: earliest use-by first'}</Soft>
                    {l.product.prescription_required ? <Text style={{ color: color.danger, fontWeight: '700' }}>Prescription medicine</Text> : null}
                    {short > 0 ? <Text style={{ color: color.warn }}>Only {qty(l.product.available ?? 0)} on the shelf</Text> : null}
                  </View>
                  <Text style={{ fontWeight: '600', color: color.ink }}>{rupees(Math.round(toPaise(l.product.selling_price) * l.quantity))}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button title="−" kind="quiet" onPress={() => edit(setQuantity(lines, l.key, l.quantity - 1))} />
                  <Text style={{ minWidth: 28, textAlign: 'center', fontWeight: '700', color: color.ink }}>{qty(l.quantity)}</Text>
                  <Button title="+" kind="quiet" onPress={() => edit(setQuantity(lines, l.key, l.quantity + 1))} />
                  {!offline && (l.product.batch_tracking || l.product.expiry_tracking) ? <Button title={l.batch ? 'Automatic batch' : 'Choose batch'} kind="quiet" onPress={() => { if (l.batch) edit(pickBatch(lines, l.key, null)); else void openBatches(l); }} /> : null}
                  <Button title="Remove" kind="quiet" onPress={() => edit(removeLine(lines, l.key))} />
                </View>
                {choosing?.key === l.key ? (
                  <View style={{ borderWidth: 1, borderColor: color.brand, borderRadius: 12, backgroundColor: '#eaf1ff', overflow: 'hidden' }}>
                    {choosing.batches.length === 0 ? <Soft style={{ padding: 12 }}>No batch can be sold right now.</Soft> : choosing.batches.map((b) => (
                      <Line key={b.batch_id} left={`Batch ${b.batch_no}`} sub={`${expiryText(b.expiry_date, today())}`} right={`${qty(b.qty_on_hand)} left`} onPress={() => { edit(pickBatch(lines, l.key, b)); setChoosing(null); }} />
                    ))}
                    <Button title="Cancel" kind="quiet" onPress={() => setChoosing(null)} />
                  </View>
                ) : null}
              </View>
            );
          })}

          {rx.length ? (
            <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: '#fff7ed' }}>
              <Text style={{ fontWeight: '700', color: color.danger }}>Prescription needed for {rx.map((l) => l.product.name).join(', ')}</Text>
              <TextInput style={s.input} value={doctor} onChangeText={setDoctor} placeholder="Doctor's name (optional)" accessibilityLabel="Doctor name" />
              <TextInput style={s.input} value={patient} onChangeText={setPatient} placeholder="Patient's name (optional)" accessibilityLabel="Patient name" />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <Text style={{ color: color.ink, flex: 1 }}>I have checked the prescription</Text>
                <Switch value={rxChecked} onValueChange={(v) => { setRxChecked(v); setProblem(''); }} accessibilityLabel="I have checked the prescription" />
              </View>
            </View>
          ) : null}

          {lines.length ? (
            <View style={{ padding: 16, gap: 8 }}>
              {quote ? (
                <>
                  <Soft>{`Items ${rupees(toPaise(quote.invoice.subtotal))}${quote.invoice.discount > 0 ? ` · discount ${rupees(toPaise(quote.invoice.discount))}` : ''} · GST ${rupees(toPaise(quote.invoice.tax))}`}</Soft>
                  <Text accessibilityLiveRegion="polite" style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{rupees(toPaise(quote.invoice.total))}</Text>
                </>
              ) : offline ? (
                <>
                  <Soft>{`About: items ${rupees(estimate(lines).subtotalPaise)} · GST ${rupees(estimate(lines).taxPaise)}. FlowXP works out the exact bill when it is sent.`}</Soft>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{`about ${rupees(estimate(lines).totalPaise)}`}</Text>
                </>
              ) : <Soft>{quoteError || `About ${rupees(roughPaise(lines))}. Working out the exact total…`}</Soft>}
              <Soft>How is the customer paying?</Soft>
              <Chips items={METHODS} value={method} onChange={setMethod} />
              {method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Reference number (optional)" accessibilityLabel="Reference number" /> : null}
              <ErrorText>{problem || (bad && lines.length ? bad : '')}</ErrorText>
              <Button title="Take payment" onPress={() => { void pay(); }} busy={busy} disabled={(!quote && !offline) || Boolean(bad)} />
            </View>
          ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
