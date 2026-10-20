import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { OFFER_DAYS, OFFER_KINDS, emptyOffer, offerBody, offerProblem, type OfferForm, type OfferKind, type PickedProduct } from '../lib/offerList.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Button, Chips, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

type Category = { category_id: number; name: string };
type Hit = PickedProduct & { selling_price: number };

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>{children}{hint ? <Soft>{t(hint)}</Soft> : null}</View>
);

/* A new offer. Products are found in the till's own copy of the catalogue, so this works without a connection until it is saved. */
export default function OfferEdit() {
  const scope = useScope();
  const [f, setF] = useState<OfferForm>(emptyOffer());
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const mix = f.kind === 'MIX_BUNDLE';

  useEffect(() => { api.get<Category[]>('/categories').then(setCategories).catch(() => {}); }, []);
  useEffect(() => {
    if (!scope || q.trim().length < 2) { setHits([]); return; }
    let alive = true;
    void scope.catalog.search(q, 6).then((r) => { if (alive) setHits(r); });
    return () => { alive = false; };
  }, [scope, q]);

  const save = async () => {
    const problem = offerProblem(f);
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError('');
    try { await api.call('/retail/promotions', { method: 'POST', body: offerBody(f) }); router.back(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const pick = (p: Hit) => { setF((x) => mix ? { ...x, products: x.products.some((v) => v.product_id === p.product_id) ? x.products : [...x.products, { product_id: p.product_id, name: p.name }] } : { ...x, product: { product_id: p.product_id, name: p.name } }); setQ(''); };
  const input = (k: 'name' | 'percent' | 'min_qty' | 'buy_qty' | 'get_qty' | 'bundle_qty' | 'bundle_price' | 'starts_on' | 'ends_on' | 'start_time' | 'end_time', label: string, opts: { hint?: string; keyboard?: 'numeric' | 'decimal-pad' | 'default'; placeholder?: string; max?: number } = {}) => (
    <Field label={label} hint={opts.hint}>
      <TextInput style={s.input} value={f[k]} onChangeText={(v) => set(k, v)} keyboardType={opts.keyboard ?? 'default'} placeholder={opts.placeholder} maxLength={opts.max} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
    </Field>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>New offer</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {input('name', 'Name', { hint: 'Shown on the bill line, so customers see what they got.', placeholder: t('e.g. Milk 3 for ₹140'), max: 80 })}
          <Field label="What kind of offer" hint={OFFER_KINDS.find((k) => k.id === f.kind)?.hint}>
            <Chips items={OFFER_KINDS.map((k) => ({ id: k.id, label: k.label }))} value={f.kind} onChange={(id: OfferKind) => set('kind', id)} />
          </Field>

          {mix ? (
            <Field label="Products in the bundle" hint="Pick two or more. Any of them can make up the bundle.">
              <TextInput style={s.input} value={q} onChangeText={setQ} placeholder={t('Search by name or barcode, then tap to add')} autoCorrect={false} accessibilityLabel={t('Products in the bundle')} />
            </Field>
          ) : (
            <>
              <Field label="Applies to"><Chips items={[{ id: 'product', label: 'One product' }, { id: 'category', label: 'A whole category' }]} value={f.target} onChange={(id: 'product' | 'category') => set('target', id)} /></Field>
              {f.target === 'product' ? (
                f.product
                  ? <Field label="Product"><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: color.ink, fontWeight: '600', flex: 1 }}>{f.product.name}</Text><Button title="Change" kind="quiet" onPress={() => set('product', null)} /></View></Field>
                  : <Field label="Product"><TextInput style={s.input} value={q} onChangeText={setQ} placeholder={t('Search by name or barcode')} autoCorrect={false} accessibilityLabel={t('Product')} /></Field>
              ) : (
                <Field label="Category"><Chips items={categories.map((c) => ({ id: String(c.category_id), label: c.name }))} value={f.category_id} onChange={(id) => set('category_id', id)} /></Field>
              )}
            </>
          )}
          {hits.filter((p) => !mix || !f.products.some((v) => v.product_id === p.product_id)).map((p) => (
            <Pressable key={p.product_id} onPress={() => pick(p)} accessibilityRole="button" style={{ minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12, backgroundColor: color.card, borderWidth: 1, borderColor: color.line }}>
              <Text style={{ color: color.ink, fontWeight: '600' }}>{p.name} · {rupees(toPaise(p.selling_price))}</Text>
            </Pressable>
          ))}
          {mix && f.products.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {f.products.map((p) => (
                <Pressable key={p.product_id} onPress={() => set('products', f.products.filter((v) => v.product_id !== p.product_id))} accessibilityRole="button" accessibilityLabel={`${t('Remove')} ${p.name}`}
                  style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 20, backgroundColor: color.tint }}><Text style={{ color: color.brand, fontWeight: '600' }}>{p.name}  ✕</Text></Pressable>
              ))}
            </View>
          ) : null}

          {f.kind === 'PERCENT_OFF' ? <>{input('percent', 'Percent off', { keyboard: 'decimal-pad' })}{input('min_qty', 'From quantity', { keyboard: 'decimal-pad', hint: '1 means every sale.' })}</> : null}
          {f.kind === 'BUY_X_GET_Y' ? <>{input('buy_qty', 'Customer buys', { keyboard: 'numeric' })}{input('get_qty', 'And gets free', { keyboard: 'numeric' })}</> : null}
          {f.kind === 'BUNDLE_PRICE' || mix ? <>{input('bundle_qty', 'Units in the bundle', { keyboard: 'numeric' })}{input('bundle_price', 'Bundle price (₹)', { keyboard: 'decimal-pad', hint: 'With GST, as on the shelf.' })}</> : null}

          {input('starts_on', 'Starts', { hint: 'Optional.', placeholder: '2026-10-31' })}
          {input('ends_on', 'Ends', { hint: 'Optional. The last day it applies.', placeholder: '2026-10-31' })}
          <Field label="Days" hint="(none ticked means every day)">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {OFFER_DAYS.map((d) => {
                const on = f.days.includes(d.day);
                return (
                  <Pressable key={d.day} onPress={() => set('days', on ? f.days.filter((v) => v !== d.day) : [...f.days, d.day])} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: on ? color.brand : color.card, borderWidth: 1, borderColor: on ? color.brand : color.line }}>
                    <Text style={{ color: on ? '#fff' : color.ink, fontWeight: '600' }}>{t(d.label)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>
          {input('start_time', 'From (time of day)', { hint: 'Optional.', placeholder: '16:00', max: 5 })}
          {input('end_time', 'Until', { hint: 'Both, or neither. An end before the start runs overnight.', placeholder: '18:00', max: 5 })}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ color: color.ink, flex: 1 }}>{t('Only when the bill has a customer on it')}</Text>
            <Switch value={f.members_only} onValueChange={(v) => set('members_only', v)} accessibilityLabel={t('Only when the bill has a customer on it')} />
          </View>
          <Soft>{t('If several offers fit one product, the one that saves the most is used. Offers never add up on top of each other.')}</Soft>
          <ErrorText>{error}</ErrorText>
          <Button title="Save the offer" onPress={() => { void save(); }} busy={busy} />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
