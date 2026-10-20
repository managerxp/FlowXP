import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { blankOption, emptyGroup, groupBody, groupForm, groupProblem, previewRule, ruleOf, type Group, type GroupForm, type Ingredient, type OptionForm } from '../lib/menuOptions.ts';
import { Button, Chips, ErrorText, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* A new option group, or one changed: its name, how customers choose, and its options (price change, and an ingredient an option uses up). */
export default function OptionGroupEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [form, setForm] = useState<GroupForm>(emptyGroup());
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [picking, setPicking] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Ingredient[]>('/products?kind=INGREDIENT').then(setIngredients).catch(() => {});
    if (!id) return;
    api.get<Group[]>('/modifier-groups?all=true').then((list) => { const g = list.find((x) => x.group_id === Number(id)) ?? null; setGroup(g); if (g) setForm(groupForm(g)); setLoaded(true); }).catch((e: Error) => { setError(e.message); setLoaded(true); });
  }, [id]);

  const setOption = (i: number, patch: Partial<OptionForm>) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  const save = async () => {
    const problem = groupProblem(form);
    if (problem) { setError(t(problem)); return; }
    setBusy(true); setError('');
    try {
      const saved = await api.call<Group>(group ? `/modifier-groups/${group.group_id}` : '/modifier-groups', { method: group ? 'PUT' : 'POST', body: groupBody(form, group ? group.is_active : true) });
      if (!group && saved.data) router.replace({ pathname: '/option-group', params: { id: String(saved.data.group_id) } }); else router.back();
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };
  const nameOf = (pid: string) => ingredients.find((p) => String(p.product_id) === pid);
  const shown = ingredients.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 30);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{group ? t('Edit') + ' ' + group.name : 'New group'}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!loaded ? <Loading /> : (
            <>
              <View style={{ gap: 4 }}>
                <Text style={{ color: color.soft, fontSize: 13 }}>{t('Group name')}</Text>
                <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} maxLength={60} accessibilityLabel={t('Group name')} />
                <Soft>{t('What the waiter asks: Size, Spice level, Extras')}</Soft>
              </View>
              <View style={{ gap: 4 }}>
                <Text style={{ color: color.soft, fontSize: 13 }}>{t('How customers choose')}</Text>
                <Chips items={[{ id: 'variant', label: 'One of these' }, { id: 'addon', label: 'Add-ons' }]} value={form.kind} onChange={(k: 'variant' | 'addon') => setForm((f) => ({ ...f, kind: k }))} />
                <Soft>{form.kind === 'variant' ? t('A size or a level: Half / Full, Mild / Hot. Always asked.') : t('Add-ons and extras, within the limits you set.')}</Soft>
              </View>
              {form.kind === 'addon' ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('At least')}</Text><TextInput style={s.input} value={form.min_select} onChangeText={(v) => setForm((f) => ({ ...f, min_select: v.replace(/\D/g, '') }))} keyboardType="numeric" accessibilityLabel={t('At least')} /><Soft>{t('0 = optional')}</Soft></View>
                  <View style={{ flex: 1, gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('At most')}</Text><TextInput style={s.input} value={form.max_select} onChangeText={(v) => setForm((f) => ({ ...f, max_select: v.replace(/\D/g, '') }))} keyboardType="numeric" accessibilityLabel={t('At most')} /><Soft>{t('Blank = no limit')}</Soft></View>
                </View>
              ) : null}
              <Text style={{ color: color.brand, fontWeight: '600' }}>{ruleOf(previewRule(form))}</Text>

              <SectionTitle>Options</SectionTitle>
              <Soft>{t("The price change is added to the dish's price. An option can use up an ingredient (extra cheese uses 20 g of cheese), so stock stays right.")}</Soft>
              {form.options.map((o, i) => {
                const ing = nameOf(o.ingredient_product_id);
                return (
                  <View key={o.modifier_id ?? `new${i}`} style={[s.card, { gap: 8 }]}>
                    <TextInput style={s.input} value={o.name} onChangeText={(v) => setOption(i, { name: v })} placeholder={t('e.g. Full plate')} accessibilityLabel={t('Option name')} />
                    <TextInput style={s.input} value={o.price_delta} onChangeText={(v) => setOption(i, { price_delta: v.replace(/[^\d.-]/g, '') })} keyboardType="numbers-and-punctuation" placeholder={t('Price change ₹')} accessibilityLabel={t('Price change ₹')} />
                    {o.ingredient_product_id ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: color.ink, flex: 1 }}>{ing?.name ?? ''}</Text>
                        <TextInput style={[s.input, { width: 100 }]} value={o.ingredient_qty} onChangeText={(v) => setOption(i, { ingredient_qty: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" placeholder={ing?.unit ?? t('How much')} accessibilityLabel={t('How much')} />
                        <Button title="Remove" kind="quiet" onPress={() => setOption(i, { ingredient_product_id: '', ingredient_qty: '' })} />
                      </View>
                    ) : <Button title="Uses ingredient" kind="quiet" onPress={() => { setPicking(picking === i ? null : i); setFilter(''); }} />}
                    {picking === i ? (
                      <View>
                        <TextInput style={s.input} value={filter} onChangeText={setFilter} placeholder={t('Search ingredients')} accessibilityLabel={t('Uses ingredient')} />
                        <Line left={t('Nothing extra')} onPress={() => { setOption(i, { ingredient_product_id: '', ingredient_qty: '' }); setPicking(null); }} />
                        {shown.map((p) => <Line key={p.product_id} left={p.name} right={p.unit ?? ''} onPress={() => { setOption(i, { ingredient_product_id: String(p.product_id) }); setPicking(null); }} />)}
                      </View>
                    ) : null}
                    <Button title="Remove" kind="danger" onPress={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))} />
                  </View>
                );
              })}
              <Button title="Add an option" kind="quiet" onPress={() => setForm((f) => ({ ...f, options: [...f.options, blankOption()] }))} />
              {group ? <Soft>{t('A removed option is kept on old bills; it just stops being offered.')}</Soft> : null}
              <ErrorText>{error}</ErrorText>
              <Button title={group ? 'Save changes' : 'Create group'} onPress={() => { void save(); }} busy={busy} />
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
