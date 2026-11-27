import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { SearchBox } from '../lib/SearchBox.tsx';
import { membersPath } from '../lib/gym.ts';
import { METHODS, rowsOf, type Pay } from '../lib/gymMembers.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, ErrorText, Group, Line, Loading, SectionTitle, Soft, Title, color, s, TextInput } from '../lib/ui.tsx';

type Product = { product_id: number; name: string; sku: string | null; selling_price: number | string; stock: number; track_inventory: boolean };
type Found = { member_id: number; name: string; member_code: string; phone: string | null };
type Done = { invoice_id: number; invoice_number: string; total: number; wallet_paid: number; still_owed: number };

/* Selling supplements and other products at the desk, to a member or a walk-in. What can be sold is the business's own product list (added with its stock first);
   a member who pays only part, or nothing, is simply owed the rest, and it shows on their page. A walk-in must pay in full. */
export default function GymShop() {
  const params = useLocalSearchParams<{ member_id?: string; name?: string }>();
  const [member, setMember] = useState<Found | null>(params.member_id ? { member_id: Number(params.member_id), name: params.name ?? '', member_code: '', phone: null } : null);
  const [mText, setMText] = useState('');
  const [mq, setMq] = useState('');
  const [mFound, setMFound] = useState<Found[]>([]);
  const [pText, setPText] = useState('');
  const [pq, setPq] = useState('');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cart, setCart] = useState<Record<number, { p: Product; qty: number }>>({});
  const [pay, setPay] = useState<Pay>('FULL');
  const [method, setMethod] = useState('CASH');
  const [part, setPart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const key = useRef(newKey());

  useEffect(() => { const x = setTimeout(() => setMq(mText.trim()), 300); return () => clearTimeout(x); }, [mText]);
  useEffect(() => { const x = setTimeout(() => setPq(pText.trim()), 300); return () => clearTimeout(x); }, [pText]);
  useEffect(() => { const p = membersPath(mq, 5); if (!p) { setMFound([]); return; } let live = true; void api.get<Found[] | { rows: Found[] }>(p).then((r) => { if (live) setMFound(rowsOf(r)); }).catch(() => {}); return () => { live = false; }; }, [mq]);
  useEffect(() => { let live = true; setProducts(null); void api.get<Product[]>(`/gym/shop/products?limit=40${pq ? `&q=${encodeURIComponent(pq)}` : ''}`).then((r) => { if (live) setProducts(rowsOf(r as Product[])); }).catch((e) => { if (live) { setProducts([]); setError(e instanceof Error ? e.message : ''); } }); return () => { live = false; }; }, [pq]);

  const lines = Object.values(cart);
  const total = lines.reduce((a, l) => a + Number(l.p.selling_price) * l.qty, 0);
  const paidNow = pay === 'FULL' ? total : pay === 'PART' ? Math.min(total, Number(part || 0)) : 0;
  const owed = Math.max(0, total - paidNow);
  const bump = (p: Product, d: number) => setCart((c) => { const q = (c[p.product_id]?.qty ?? 0) + d; const next = { ...c }; if (q <= 0) delete next[p.product_id]; else next[p.product_id] = { p, qty: q }; return next; });

  const save = async () => {
    setError('');
    if (!lines.length) { setError(t('Add at least one product.')); return; }
    if (!member && pay !== 'FULL') { setError(t('A walk-in must pay in full. Choose the member to leave a balance.')); return; }
    if (pay === 'PART' && !(Number(part) > 0)) { setError(t('Type how much was paid now.')); return; }
    setBusy(true);
    try {
      const body = { items: lines.map((l) => ({ product_id: l.p.product_id, quantity: l.qty })), ...(member ? { member_id: member.member_id } : {}), method, ...(pay === 'FULL' ? { amount: 'FULL' } : pay === 'PART' ? { amount: Number(part) } : {}) };
      setDone(await api.post<Done>('/gym/shop/sale', body, { idempotencyKey: key.current }));
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <SafeAreaView style={s.screen}>
        <Page max={640}>
          <View style={{ padding: 16, gap: 12 }}>
            <Title>Sale done</Title>
            <View style={[s.card, { gap: 4 }]}>
              <Text style={{ color: color.ink, fontWeight: '700' }}>{done.invoice_number}</Text>
              <Text style={{ color: color.ink }}>{t('Total')}: {rupees(toPaise(done.total))}</Text>
              {done.still_owed > 0 ? <Text style={{ color: color.danger, fontWeight: '700' }}>{t('Still owed')}: {rupees(toPaise(done.still_owed))}{member ? ` · ${t('shown on {name}’s page', { name: member.name })}` : ''}</Text> : <Text style={{ color: color.ok, fontWeight: '700' }}>{t('Paid in full')}</Text>}
            </View>
            {member ? <Button title="Open the member" onPress={() => router.replace({ pathname: '/gym-member/[id]', params: { id: String(member.member_id) } })} /> : null}
            <Button title="Sell something else" kind="quiet" onPress={() => { setDone(null); setCart({}); setPart(''); setPay('FULL'); key.current = newKey(); }} />
            <Button title="Back" kind="quiet" onPress={() => goBack()} />
          </View>
        </Page>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Sell supplements</Title><Soft>Protein, shakers and other things from your product list</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 60, gap: 8 }} keyboardShouldPersistTaps="handled">
          <SectionTitle>Who is buying</SectionTitle>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {member ? (
              <View style={[s.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <Text style={{ color: color.ink, fontWeight: '700', flex: 1 }}>{member.name}{member.member_code ? ` · ${member.member_code}` : ''}</Text>
                <Button title="Change" kind="quiet" onPress={() => setMember(null)} style={{ minHeight: 44 }} />
              </View>
            ) : (
              <>
                <Soft>Walk-in customer. Search to choose a member instead.</Soft>
                <SearchBox value={mText} onChange={setMText} placeholder="Member name, phone or number" label="Find a member" />
                <Group>{mFound.map((m) => <Line key={m.member_id} left={m.name} sub={[m.member_code, m.phone].filter(Boolean).join(' · ')} onPress={() => { setMember(m); setMText(''); }} />)}</Group>
              </>
            )}
          </View>

          <SectionTitle>Products</SectionTitle>
          <View style={{ paddingHorizontal: 16 }}><SearchBox value={pText} onChange={setPText} placeholder="Search products" label="Search products" /></View>
          {products === null ? <Loading /> : null}
          {products && products.length === 0 ? <Soft style={{ padding: 16 }}>No product matches. Add products to your product list first, with their stock.</Soft> : null}
          <Group>{(products ?? []).map((p) => <Line key={p.product_id} left={p.name} sub={`${rupees(toPaise(p.selling_price))}${p.track_inventory ? ` · ${p.stock} ${t('in stock')}` : ''}`} right={cart[p.product_id] ? `× ${cart[p.product_id]!.qty}` : t('Add')} selected={Boolean(cart[p.product_id])} onPress={() => bump(p, 1)} />)}</Group>

          {lines.length ? (
            <>
              <SectionTitle>This sale</SectionTitle>
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {lines.map((l) => (
                  <View key={l.p.product_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{l.p.name}</Text><Soft>{rupees(toPaise(Number(l.p.selling_price) * l.qty))}</Soft></View>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('One fewer')} onPress={() => bump(l.p, -1)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.wash, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20, color: color.ink }}>−</Text></Pressable>
                    <Text style={{ minWidth: 24, textAlign: 'center', color: color.ink, fontWeight: '700' }}>{l.qty}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('One more')} onPress={() => bump(l.p, 1)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.wash, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20, color: color.ink }}>+</Text></Pressable>
                  </View>
                ))}
                <Text style={{ color: color.ink, fontSize: 18, fontWeight: '700' }}>{t('About')} {rupees(toPaise(total))}</Text>
                <Soft>GST and the exact total are worked out when you save.</Soft>
                <Chips items={[{ id: 'FULL', label: 'Paid in full' }, { id: 'PART', label: 'Part paid' }, { id: 'LATER', label: 'Pay later' }]} value={pay} onChange={(v) => setPay(v as Pay)} />
                {pay === 'PART' ? <TextInput style={s.input} value={part} onChangeText={(v) => setPart(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Amount paid now ₹')} accessibilityLabel={t('Amount paid now ₹')} /> : null}
                {pay !== 'LATER' ? <Chips items={METHODS} value={method} onChange={setMethod} /> : null}
                {owed > 0 ? <Text style={{ color: color.danger, fontWeight: '600' }}>{t('Will be owed')}: {rupees(toPaise(owed))}</Text> : null}
                <ErrorText>{error}</ErrorText>
                <Button title="Complete sale" onPress={() => { void save(); }} busy={busy} />
              </View>
            </>
          ) : <ErrorText>{error}</ErrorText>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
