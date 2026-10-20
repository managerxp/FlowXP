import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { couponBody, couponForm, couponProblem, emptyCoupon, type Coupon, type CouponForm } from '../lib/loyalty.ts';
import { Button, Chips, ErrorText, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

/* A new coupon, or one changed. A blank limit means no limit. */
export default function CouponEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [form, setForm] = useState<CouponForm>(emptyCoupon());
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof CouponForm>(k: K, v: CouponForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!id) return;
    api.get<Coupon[]>('/coupons').then((list) => { const c = list.find((x) => x.coupon_id === Number(id)) ?? null; setCoupon(c); if (c) setForm(couponForm(c)); setLoaded(true); }).catch((e: Error) => { setError(e.message); setLoaded(true); });
  }, [id]);

  const save = async () => {
    const problem = couponProblem(form);
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError('');
    try { await api.call(coupon ? `/coupons/${coupon.coupon_id}` : '/coupons', { method: coupon ? 'PUT' : 'POST', body: couponBody(form) }); router.back(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const field = (k: Exclude<keyof CouponForm, 'kind'>, label: string, o: { hint?: string; keyboard?: 'numeric' | 'decimal-pad' | 'default'; placeholder?: string; max?: number; upper?: boolean } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={form[k]} onChangeText={(v) => set(k, o.upper ? v.toUpperCase() : v)} keyboardType={o.keyboard ?? 'default'} placeholder={o.placeholder} maxLength={o.max} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />
      {o.hint ? <Soft>{t(o.hint)}</Soft> : null}
    </View>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{coupon ? t('Edit {code}', { code: coupon.code }) : t('New coupon')}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!loaded ? <Loading /> : null}
          {loaded && id && !coupon ? <ErrorText>{error || t('Not found')}</ErrorText> : null}
          {loaded && (!id || coupon) ? (
            <>
              {field('code', 'Code', { hint: 'What the customer says or types.', placeholder: 'WELCOME10', max: 24, upper: true })}
              <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Type')}</Text><Chips items={[{ id: 'PERCENT', label: 'Percent off' }, { id: 'FLAT', label: 'Flat amount off' }]} value={form.kind} onChange={(v: 'PERCENT' | 'FLAT') => set('kind', v)} /></View>
              {field('value', form.kind === 'PERCENT' ? 'Percent' : 'Amount (₹)', { keyboard: 'decimal-pad' })}
              {field('description', 'Note for staff', { hint: 'Optional', max: 160 })}
              {field('min_bill', 'Minimum bill (₹)', { keyboard: 'decimal-pad' })}
              {form.kind === 'PERCENT' ? field('max_discount', 'Most it can take off (₹)', { keyboard: 'decimal-pad' }) : null}
              {field('valid_from', 'Starts', { hint: 'Optional', placeholder: '2026-10-31', max: 10 })}
              {field('valid_to', 'Ends', { hint: 'Optional', placeholder: '2026-10-31', max: 10 })}
              {field('max_uses', 'Total uses', { hint: 'Blank = unlimited', keyboard: 'numeric' })}
              {field('max_uses_per_customer', 'Uses per customer', { hint: 'Needs the customer’s mobile at billing', keyboard: 'numeric' })}
              <ErrorText>{error}</ErrorText>
              <Button title={coupon ? 'Save changes' : 'Create coupon'} onPress={() => { void save(); }} busy={busy} />
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
