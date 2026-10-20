import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { activeOptions, chosenText, dishesByCategory, ingredientLine, priceText, productsBody, ruleOf, toggleBody, toggleIds, type Dish, type Group, type Ingredient } from '../lib/menuOptions.ts';
import { Button, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* One option group: its rule, options and the dishes that offer it. Edit it, turn it off, or choose its dishes. */
export default function OptionGroup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [groups, ing] = await Promise.all([api.get<Group[]>('/modifier-groups?all=true'), api.get<Ingredient[]>('/products?kind=INGREDIENT')]);
      setGroup(groups.find((g) => g.group_id === Number(id)) ?? null); setIngredients(ing); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { if (picking && !dishes) api.get<Dish[]>('/products?kind=DISH').then(setDishes).catch((e: Error) => setError(e.message)); }, [picking, dishes]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
  const toggle = async () => { if (!group) return; setError(''); try { await api.call(`/modifier-groups/${group.group_id}`, { method: 'PUT', body: toggleBody(group) }); await load(); } catch (e) { fail(e); } };
  const startPicking = () => { if (group) { setChosen(new Set(group.products.map((p) => p.product_id))); setSearch(''); setPicking(true); } };
  const saveDishes = async () => {
    if (!group) return;
    setBusy(true); setError('');
    try { await api.call(`/modifier-groups/${group.group_id}/products`, { method: 'PUT', body: productsBody(chosen) }); setPicking(false); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  if (error && !group) return <SafeAreaView style={s.screen}><Failed message={error} onRetry={() => { void load(); }} /></SafeAreaView>;
  if (!group) return <SafeAreaView style={s.screen}><Loading /></SafeAreaView>;

  if (picking) {
    const sections = dishesByCategory(dishes ?? [], search);
    return (
      <SafeAreaView style={s.screen}>
        <Page max={640}>
          <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Title>{t('Which dishes offer {name}?', { name: group.name })}</Title></View><Button title="Cancel" kind="quiet" onPress={() => setPicking(false)} /></View>
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder={t('Search dishes')} autoCorrect={false} accessibilityLabel={t('Search dishes')} />
              <Soft>{chosenText(chosen.size)}</Soft>
              <ErrorText>{error}</ErrorText>
            </View>
            {!dishes ? <Loading /> : sections.length === 0 ? <Soft style={{ padding: 16 }}>{search.trim() ? t('No dishes match.') : t('No dishes on the menu yet.')}</Soft> : null}
            {sections.map(([category, list]) => {
              const ids = list.map((d) => d.product_id);
              const all = ids.every((i) => chosen.has(i));
              return (
                <View key={category || 'none'}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}><SectionTitle>{category || t('No category')}</SectionTitle><Button title={all ? 'None' : 'All'} kind="quiet" onPress={() => setChosen(toggleIds(chosen, ids, !all))} /></View>
                  {list.map((d) => <Line key={d.product_id} left={d.name} right={rupees(toPaise(d.selling_price))} selected={chosen.has(d.product_id)} onPress={() => setChosen(toggleIds(chosen, [d.product_id], !chosen.has(d.product_id)))} />)}
                </View>
              );
            })}
            <View style={{ padding: 16 }}><Button title="Save" onPress={() => { void saveDishes(); }} busy={busy} disabled={!dishes} /></View>
          </ScrollView>
        </Page>
      </SafeAreaView>
    );
  }

  const options = activeOptions(group);
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{group.name}</Title><Soft>{[group.is_variant ? t('One of these') : t('Add-ons'), ruleOf(group), group.is_active ? '' : t('Off')].filter(Boolean).join(' · ')}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ padding: 16, gap: 8 }}>
            <Button title="Edit" onPress={() => router.push({ pathname: '/option-group-edit', params: { id: String(group.group_id) } })} />
            <Button title="Choose dishes" kind="quiet" onPress={startPicking} />
            <Button title={group.is_active ? 'Turn off' : 'Turn on'} kind="quiet" onPress={() => { void toggle(); }} />
            {!group.is_active ? <Soft>{t('Off: the till does not offer it and bills do not ask for it. Turn it on to offer it again on the same dishes.')}</Soft> : null}
            <ErrorText>{error}</ErrorText>
          </View>
          <SectionTitle>{`${t('Options')} · ${options.length}`}</SectionTitle>
          {options.map((m) => <Line key={m.modifier_id ?? m.name} left={m.name} right={priceText(m.price_delta)} sub={ingredientLine(m, ingredients)} />)}
          <SectionTitle>{`${t('Offered on')} · ${group.products.length}`}</SectionTitle>
          {group.products.length === 0 ? <Soft style={{ paddingHorizontal: 16 }}>{t('Not on any dish yet, so no one is asked.')}</Soft> : <Text style={{ color: color.ink, paddingHorizontal: 16, lineHeight: 22 }}>{group.products.map((p) => p.name).join(', ')}</Text>}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
