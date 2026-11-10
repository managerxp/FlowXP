import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { pname } from '../lib/catalog.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Empty, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Item = { product_id: number; name: string; name_i18n?: Record<string, string>; category_name: string | null; is_available: boolean };

/* Menu on / off: one big switch per dish for THIS outlet. Switch a dish off when it runs out: it greys out on the till and cannot be added to a bill. Switch it on when it is back. Prices and stock are never touched. */
export default function MenuAvailability() {
  const load = useLoad<{ items: Item[] }>('menu-availability', () => api.get<{ items: Item[] }>('/products/availability'));
  const [local, setLocal] = useState<Record<number, boolean>>({});   // a switch moves at once, before the server answers
  const [text, setText] = useState('');
  const [offOnly, setOffOnly] = useState(false);
  const [problem, setProblem] = useState('');

  const items = (load.data?.items ?? []).map((i) => ({ ...i, is_available: local[i.product_id] ?? i.is_available }));
  const off = items.filter((i) => !i.is_available).length;
  const q = text.trim().toLowerCase();
  const shown = items.filter((i) => (!offOnly || !i.is_available) && (!q || i.name.toLowerCase().includes(q) || pname(i as never).toLowerCase().includes(q)));
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of shown) { const c = i.category_name || t('Other'); if (!m.has(c)) m.set(c, []); m.get(c)!.push(i); }
    return [...m.entries()];
  }, [shown.length, text, offOnly, load.data, local]);   // eslint-disable-line react-hooks/exhaustive-deps

  const flip = async (i: Item) => {
    const next = !i.is_available; setProblem('');
    setLocal((l) => ({ ...l, [i.product_id]: next }));
    try { await api.call(`/products/${i.product_id}/availability`, { method: 'PATCH', body: { is_available: next } }); }
    catch (e) { setLocal((l) => ({ ...l, [i.product_id]: !next })); setProblem(e instanceof Error ? e.message : t('Could not change it.')); }
  };
  const chip = (on: boolean) => ({ minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' as const, borderRadius: 22, borderWidth: 1, borderColor: on ? color.brand : color.line, backgroundColor: on ? color.brand : color.card });

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
          <Title>{t('Menu on / off')}</Title>
          <Soft>{t('Switch a dish off when it runs out. It stops being sold at this outlet until you switch it back on.')}</Soft>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder={t('Search dishes')} autoCorrect={false} accessibilityLabel={t('Search dishes')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: !offOnly }} onPress={() => setOffOnly(false)} style={chip(!offOnly)}><Text style={{ fontWeight: '600', color: !offOnly ? '#fff' : color.ink }}>{t('All dishes')} {items.length}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: offOnly }} onPress={() => setOffOnly(true)} style={chip(offOnly)}><Text style={{ fontWeight: '600', color: offOnly ? '#fff' : color.ink }}>{t('Switched off')} {off}</Text></Pressable>
          </View>
          <ErrorText>{problem}</ErrorText>
          {load.error && !load.data ? <Failed message={load.error} onRetry={() => { void load.refresh(); }} /> : null}
          {load.busy && !load.data ? <Loading what="Loading the menu" /> : null}
          {load.data && items.length === 0 ? <Empty>{t('No dishes yet. Add them under Products first.')}</Empty> : null}
          {load.data && items.length > 0 && shown.length === 0 ? <Empty>{offOnly && !q ? t('Everything is switched on.') : t('No dish matches.')}</Empty> : null}
          {groups.map(([name, list]) => (
            <View key={name}>
              <SectionTitle>{name}</SectionTitle>
              {list.map((i) => (
                <Pressable key={i.product_id} accessibilityRole="switch" accessibilityState={{ checked: i.is_available }} accessibilityLabel={pname(i as never)} onPress={() => { void flip(i); }}
                  style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: color.line }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: i.is_available ? color.ink : color.soft, textDecorationLine: i.is_available ? 'none' : 'line-through' }}>{pname(i as never)}</Text>
                    {!i.is_available ? <Text style={{ color: color.warn, fontWeight: '600' }}>{t('Off at this outlet')}</Text> : null}
                  </View>
                  <Switch value={i.is_available} onValueChange={() => { void flip(i); }} />
                </Pressable>
              ))}
            </View>
          ))}
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
