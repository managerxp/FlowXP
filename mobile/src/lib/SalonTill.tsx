import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from './api.ts';
import { api, useSession } from './session.ts';
import { clearSale, setCustomer, useSale } from './sale.ts';
import { useLoad } from './useLoad.ts';
import {
  addGiftCard, addPackage, addPlan, addRetail, addService, linesFromAppointment, quoteBody, removeLine, roughPaise, salonProblem, saleBody, setRetailQty, setUse, staffFor, usesFor,
  type AppointmentCart, type Entitlements, type Extras, type RetailItem, type SalonCatalog, type SalonLine, type SalonService
} from './salon.ts';
import { rupees, toPaise } from './money.ts';
import { Page } from './responsive.tsx';
import PayHowPicker from './PayHowPicker.tsx';
import { t } from './i18n.ts';
import { payPlan, type PayHow } from './billing.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from './ui.tsx';

type Quote = { subtotal: number; discount: number; tax: number; round_off: number; total: number; offers: { name: string }[]; membership_discount_pct: number };
type Tab = 'services' | 'products' | 'packages' | 'plans' | 'gift';
type GiftCard = { code: string; balance: number; usable: boolean; expired: boolean; customer_name: string | null };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CREDIT: 'On credit', OTHER: 'Other', BANK_TRANSFER: 'Bank transfer', WALLET: 'Wallet' };

/* The salon till: client, services with who is doing each, retail, packages and memberships. The server prices the bill (offers, membership, GST) and the quote shows exactly what it will charge. */
export function SalonTill() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const { customer } = useSale();
  const { appointment } = useLocalSearchParams<{ appointment?: string }>();
  const catalog = useLoad<SalonCatalog>(`salon-catalog:${scope}`, () => api.get<SalonCatalog>('/salon/pos/catalog'));
  const cat = catalog.data;
  const [lines, setLines] = useState<SalonLine[]>([]);
  const [tab, setTab] = useState<Tab>('services');
  const [category, setCategory] = useState('all');
  const [text, setText] = useState('');
  const [retail, setRetail] = useState<RetailItem[]>([]);
  const [picking, setPicking] = useState<SalonService | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [how, setHow] = useState<PayHow>('FULL');
  const [nowText, setNowText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [apptId, setApptId] = useState<number | null>(null);
  const [offerCode, setOfferCode] = useState('');
  const [points, setPoints] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [gift, setGift] = useState<GiftCard | null>(null);
  const [giftAmount, setGiftAmount] = useState('');
  const [giftNote, setGiftNote] = useState('');
  const extras: Extras = { offerCode, redeemPoints: Number(points) || 0, gift: gift?.usable ? { code: gift.code, balance: gift.balance } : undefined };
  const key = useRef(newKey());   // one key for this bill: a retry after a dropped signal returns the same invoice, never a second one
  const changed = () => { key.current = newKey(); setQuote(null); setProblem(''); };

  // a booking sent here from Appointments: its client and services fill the bill
  useEffect(() => {
    if (!appointment || !cat) return;
    let live = true;
    void api.get<AppointmentCart>(`/salon/appointments/${appointment}/cart`).then((c) => {
      if (!live) return;
      setApptId(c.appointment_id); setLines(linesFromAppointment(c, cat)); changed();
      if (c.customer_id) void api.get<{ name: string; phone: string | null }>(`/customers/${c.customer_id}`).then((x) => setCustomer({ id: c.customer_id!, name: x.name, phone: x.phone })).catch(() => {});
    }).catch((e: Error) => setProblem(e.message));
    return () => { live = false; };
  }, [appointment, cat]);   // eslint-disable-line react-hooks/exhaustive-deps

  // what this client can take free (a package visit, a membership's free service)
  useEffect(() => {
    if (!customer) { setEnt(null); return; }
    let live = true;
    void api.get<Entitlements>(`/salon/pos/entitlements?customer_id=${customer.id}`).then((e) => { if (live) setEnt(e); }).catch(() => { if (live) setEnt(null); });
    return () => { live = false; };
  }, [customer?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // retail products
  useEffect(() => {
    if (tab !== 'products') return;
    let live = true;
    const t = setTimeout(() => { void api.get<RetailItem[]>(`/salon/pos/products?limit=24${text.trim() ? `&q=${encodeURIComponent(text.trim())}` : ''}`).then((r) => { if (live) setRetail(r); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [tab, text]);

  // the quote: the bill exactly as the server would make it, asked again whenever the bill or the client changes
  useEffect(() => {
    if (!lines.length) { setQuote(null); setQuoteError(''); return; }
    if (salonProblem(lines, customer?.id ?? null)) { setQuote(null); return; }
    let live = true;
    const t = setTimeout(() => {
      void api.post<Quote>('/salon/pos/quote', quoteBody(lines, customer?.id ?? null, apptId, extras)).then((q) => { if (live) { setQuote(q); setQuoteError(''); } }).catch((e: Error) => { if (live) { setQuote(null); setQuoteError(e.message); } });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [lines, customer?.id, apptId, offerCode, points]);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: SalonLine[]) => { setLines(next); changed(); };
  const checkGift = async () => {
    setGiftNote('');
    try { const g = await api.get<GiftCard>(`/salon/gift-cards/lookup?code=${encodeURIComponent(giftCode.trim())}`); setGift(g); setGiftNote(g.usable ? `${rupees(toPaise(g.balance))} on this card.` : g.expired ? 'This gift card has expired.' : 'This gift card has nothing left to spend.'); changed(); }
    catch (e) { setGift(null); setGiftNote(e instanceof Error ? e.message : 'Could not check the card'); }
  };
  const chooseStaff = (staffId: number) => { const st = cat?.staff.find((x) => x.staff_id === staffId); if (picking && st) edit(addService(lines, picking, st)); setPicking(null); };
  const methods = (cat?.payment_methods ?? ['CASH', 'UPI', 'CARD']).filter((m) => m !== 'GIFT_CARD');
  const bad = salonProblem(lines, customer?.id ?? null);
  // owing part of a bill is not offered when a gift card pays, or when a gift card is being sold (the server needs those paid in full)
  const mayOwe = !gift?.usable && !lines.some((l) => l.type === 'GIFT_CARD');
  const howNow: PayHow = mayOwe ? how : 'FULL';
  const billPaise = quote ? toPaise(quote.total) : 0;
  const plan = payPlan({ how: howNow, totalPaise: billPaise, now: nowText, hasCustomer: Boolean(customer) });

  const pay = async () => {
    if (bad) return setProblem(bad);
    if (!quote) return setProblem(quoteError || 'Wait a moment for the total');
    if (!plan.ok) return setProblem(plan.problem ? t(plan.problem) : t('Enter how much is being paid now.'));
    setBusy(true); setProblem('');
    try {
      const out = await api.post<{ invoice: { invoice_id: number } }>('/salon/pos/invoices', saleBody(lines, customer?.id ?? null, apptId, quote.total, method, reference, extras, plan.payNowPaise), { idempotencyKey: key.current });
      clearSale(); setLines([]); setApptId(null); setOfferCode(''); setPoints(''); setGift(null); setGiftCode(''); setHow('FULL'); setNowText(''); key.current = newKey();
      router.replace({ pathname: '/receipt', params: { id: String(out.invoice.invoice_id) } });
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not take the payment'); }
    finally { setBusy(false); }
  };

  const services = (cat?.services ?? []).filter((x) => (category === 'all' || String(x.category_id) === category) && (!text.trim() || x.name.toLowerCase().includes(text.trim().toLowerCase())));
  const staff = picking && cat ? staffFor(cat, picking.service_id) : null;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>New bill</Title><Soft>{customer ? `${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}` : 'No client chosen'}</Soft></View>
          <Button title="Appointments" kind="quiet" onPress={() => router.push('/appointments')} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
            <Button title={customer ? 'Change client' : 'Choose client'} kind="quiet" onPress={() => router.push({ pathname: '/customers', params: { pick: '1' } })} style={{ flex: 1 }} />
            {customer ? <Button title="No client" kind="quiet" onPress={() => { setCustomer(null); edit(lines.filter((l) => l.type !== 'PACKAGE' && l.type !== 'MEMBERSHIP').map((l) => (l.type === 'SERVICE' ? { ...l, use: undefined } : l))); }} /> : null}
          </View>
          {ent?.membership ? <Soft style={{ paddingHorizontal: 16, paddingTop: 8 }}>{`${ent.membership.plan_name} member${ent.membership.discount_pct ? `: ${ent.membership.discount_pct}% off` : ''}`}</Soft> : null}
          {ent && ent.packages.length ? <Soft style={{ paddingHorizontal: 16 }}>{`Packages: ${ent.packages.map((p) => p.name).join(', ')}`}</Soft> : null}

          {catalog.busy && !cat ? <Loading /> : null}
          {catalog.error && !cat ? <Failed message={catalog.error} onRetry={() => { void catalog.refresh(); }} /> : null}

          {cat ? (
            <>
              <View style={{ height: 8 }} />
              <Chips<Tab> items={[{ id: 'services', label: 'Services' }, { id: 'products', label: 'Products' }, ...(cat.packages.length ? [{ id: 'packages' as Tab, label: 'Packages' }] : []), ...(cat.membership_plans.length ? [{ id: 'plans' as Tab, label: 'Memberships' }] : []), { id: 'gift' as Tab, label: 'Gift cards' }]} value={tab} onChange={(x) => { setTab(x); setText(''); setPicking(null); }} />
              {tab === 'services' || tab === 'products' ? <View style={{ padding: 16, paddingBottom: 4 }}><TextInput style={s.input} value={text} onChangeText={setText} placeholder={tab === 'services' ? 'Search services' : 'Search products or scan a barcode number'} accessibilityLabel="Search" autoCorrect={false} /></View> : null}

              {tab === 'services' ? (
                <>
                  {cat.categories.length > 1 ? <Chips items={[{ id: 'all', label: 'All' }, ...cat.categories.map((c) => ({ id: String(c.category_id), label: c.name }))]} value={category} onChange={setCategory} /> : null}
                  {picking && staff ? (
                    <View style={{ margin: 16, padding: 12, gap: 8, borderRadius: 12, borderWidth: 1, borderColor: color.brand, backgroundColor: '#eaf1ff' }}>
                      <Text style={{ fontWeight: '700', color: color.ink }}>Who is doing {picking.name}?</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {[...staff.qualified, ...staff.others].map((st) => <Button key={st.staff_id} title={st.name} kind={staff.qualified.includes(st) ? 'primary' : 'quiet'} onPress={() => chooseStaff(st.staff_id)} />)}
                      </View>
                      {cat.staff.length === 0 ? <Soft>No team members are set up for this outlet. Add them on the FlowXP website under Team.</Soft> : null}
                      <Button title="Cancel" kind="quiet" onPress={() => setPicking(null)} />
                    </View>
                  ) : null}
                  {services.map((x) => <Line key={x.service_id} left={x.name} sub={`${x.duration_min} min`} right={rupees(toPaise(x.price))} onPress={() => setPicking(x)} />)}
                  {services.length === 0 ? <Empty>No service matches.</Empty> : null}
                </>
              ) : null}

              {tab === 'products' ? <>{retail.map((p) => <Line key={p.product_id} left={p.name} sub={`${p.brand ? `${p.brand} · ` : ''}${p.stock != null ? `${p.stock} in stock` : 'In stock'}`} right={rupees(toPaise(p.price))} onPress={() => edit(addRetail(lines, p))} />)}{retail.length === 0 ? <Empty>No product matches.</Empty> : null}</> : null}
              {tab === 'packages' ? cat.packages.map((p) => <Line key={p.package_id} left={p.name} sub={p.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')} right={rupees(toPaise(p.price))} onPress={() => edit(addPackage(lines, p))} />) : null}
              {tab === 'gift' ? (
                <View style={{ padding: 16, gap: 10 }}>
                  <Soft>Sell a gift card. Its value goes to the client on this bill when it is paid.</Soft>
                  <Chips items={['500', '1000', '2000', '5000'].map((v) => ({ id: v, label: rupees(toPaise(Number(v))) }))} value={giftAmount} onChange={setGiftAmount} />
                  <TextInput style={s.input} value={giftAmount} onChangeText={setGiftAmount} keyboardType="decimal-pad" placeholder="Or type an amount" accessibilityLabel="Gift card amount" />
                  <Button title="Add the gift card" kind="quiet" disabled={!(Number(giftAmount) >= 100)} onPress={() => { edit(addGiftCard(lines, Number(giftAmount))); setGiftAmount(''); }} />
                  {Number(giftAmount) > 0 && Number(giftAmount) < 100 ? <Soft>A gift card is at least 100 rupees.</Soft> : null}
                </View>
              ) : null}
              {tab === 'plans' ? cat.membership_plans.map((p) => <Line key={p.plan_id} left={p.name} sub={`${p.duration_days} days${p.description ? ` · ${p.description}` : ''}`} right={rupees(toPaise(p.price))} onPress={() => edit(addPlan(lines, p))} />) : null}
            </>
          ) : null}

          <SectionTitle>This bill</SectionTitle>
          {lines.length === 0 ? <Empty>Tap a service to add it, then say who is doing it.</Empty> : null}
          {lines.map((l) => {
            const uses = l.type === 'SERVICE' ? usesFor(ent, l.service_id, lines.filter((x) => x.key !== l.key)) : [];
            return (
              <View key={l.key} style={{ padding: 16, gap: 6, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, color: color.ink }}>{l.name}{l.type === 'PRODUCT' && l.quantity > 1 ? ` × ${l.quantity}` : ''}</Text>
                    <Soft>{l.type === 'SERVICE' ? `By ${l.staff_name}${l.use ? ` · free from ${l.use.label}` : ''}` : l.type === 'PACKAGE' ? 'Package' : l.type === 'MEMBERSHIP' ? 'Membership' : l.type === 'GIFT_CARD' ? 'Gift card' : 'Retail'}</Soft>
                  </View>
                  <Text style={{ fontWeight: '600', color: color.ink }}>{l.type === 'SERVICE' && l.use ? 'Free' : rupees(toPaise(l.price) * (l.type === 'PRODUCT' ? l.quantity : 1))}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {l.type === 'PRODUCT' ? <><Button title="−" kind="quiet" onPress={() => edit(setRetailQty(lines, l.key, l.quantity - 1))} /><Button title="+" kind="quiet" onPress={() => edit(setRetailQty(lines, l.key, l.quantity + 1))} /></> : null}
                  {l.type === 'SERVICE' && l.use ? <Button title="Charge for it" kind="quiet" onPress={() => edit(setUse(lines, l.key, undefined))} /> : null}
                  {l.type === 'SERVICE' && !l.use ? uses.map((u) => <Button key={u.label} title={`Use ${u.label}`} kind="quiet" onPress={() => edit(setUse(lines, l.key, u))} />) : null}
                  <Button title="Remove" kind="quiet" onPress={() => edit(removeLine(lines, l.key))} />
                </View>
              </View>
            );
          })}

          {lines.length ? (
            <View style={{ padding: 16, gap: 8 }}>
              {quote ? (
                <>
                  <Soft>{`Items ${rupees(toPaise(quote.subtotal))}${quote.discount > 0 ? ` · discount ${rupees(toPaise(quote.discount))}` : ''} · GST ${rupees(toPaise(quote.tax))}`}</Soft>
                  {quote.offers.length ? <Soft>{`Offers applied: ${quote.offers.map((o) => o.name).join(', ')}`}</Soft> : null}
                  <Text accessibilityLiveRegion="polite" style={{ fontSize: 28, fontWeight: '800', color: color.ink }}>{rupees(toPaise(quote.total))}</Text>
                </>
              ) : <Soft>{quoteError || bad || `About ${rupees(roughPaise(lines))}. Working out the exact total…`}</Soft>}
              {!lines.some((l) => l.type === 'GIFT_CARD') ? (
                <View style={{ gap: 8 }}>
                  <TextInput style={s.input} value={offerCode} onChangeText={setOfferCode} autoCapitalize="characters" placeholder="Offer code (optional)" accessibilityLabel="Offer code" />
                  {customer && cat?.loyalty.enabled ? <TextInput style={s.input} value={points} onChangeText={setPoints} keyboardType="number-pad" placeholder="Points to spend (optional)" accessibilityLabel="Points to spend" /> : null}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={giftCode} onChangeText={(v) => { setGiftCode(v); setGift(null); setGiftNote(''); }} autoCapitalize="characters" placeholder="Gift card code (optional)" accessibilityLabel="Gift card code" />
                    <Button title="Check" kind="quiet" disabled={giftCode.trim().length < 4} onPress={() => { void checkGift(); }} />
                  </View>
                  {giftNote ? <Soft>{giftNote}</Soft> : null}
                </View>
              ) : null}
              {mayOwe ? <PayHowPicker how={how} onHow={(h) => { setHow(h); setProblem(''); }} nowText={nowText} onNow={setNowText} plan={plan} owes={customer?.name || t('the customer')} totalPaise={billPaise} /> : null}
              {howNow !== 'LATER' ? <Soft>How is the client paying?</Soft> : null}
              {howNow !== 'LATER' ? <Chips items={methods.map((m) => ({ id: m, label: METHOD_LABEL[m] ?? (m.charAt(0) + m.slice(1).toLowerCase().replace('_', ' ')) }))} value={method} onChange={setMethod} /> : null}
              {howNow !== 'LATER' && (method === 'UPI' || method === 'CARD') ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Reference number (optional)" accessibilityLabel="Reference number" /> : null}
              <ErrorText>{problem}</ErrorText>
              <Button title={howNow === 'LATER' ? t('Save the bill, {amount} unpaid', { amount: rupees(billPaise) }) : howNow === 'PART' && plan.ok ? t('Take {now} now, {rest} stays due', { now: rupees(plan.payNowPaise ?? 0), rest: rupees(plan.balancePaise) }) : 'Take payment'} onPress={() => { void pay(); }} busy={busy} disabled={!quote || Boolean(bad)} />
            </View>
          ) : <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
