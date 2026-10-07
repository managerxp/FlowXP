import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScope } from '../lib/local.ts';
import { add } from '../lib/sale.ts';
import type { Product } from '../lib/catalog.ts';
import { initialChoice, missing, picked, toggle, type Chosen, type Group } from '../lib/options.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Button, Soft, Title, color, s } from '../lib/ui.tsx';

const delta = (n: number) => (n === 0 ? '' : `${n > 0 ? '+' : '−'}${rupees(Math.abs(toPaise(n)))}`);

/* Size, milk, sugar, add-ons: the choices for one drink, read from the phone's own copy so it works with no signal. */
export default function Options() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useScope();
  const [product, setProduct] = useState<Product | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [chosen, setChosen] = useState<Chosen>({});

  useEffect(() => {
    if (!scope) return;
    void scope.catalog.byId(Number(id)).then(async (p) => {
      if (!p) return;
      const g = await scope.catalog.groupsFor(p);
      setProduct(p); setGroups(g); setChosen(initialChoice(g));
    });
  }, [scope, id]);

  if (!product) return <SafeAreaView style={s.screen}><Soft style={{ padding: 16 }}>Loading…</Soft></SafeAreaView>;

  const pick = picked(groups, chosen);
  const still = missing(groups, chosen);
  const price = toPaise(product.selling_price) + pick.deltaPaise;

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <Title>{product.name}</Title>
        {groups.length === 0 ? <Soft>This drink has options that are not on this phone yet. Connect once so they can be downloaded.</Soft> : null}
        {groups.map((g) => (
          <View key={g.group_id} style={{ gap: 8 }}>
            <Text style={{ fontWeight: '700', color: color.ink }}>
              {g.name}
              <Text style={{ fontWeight: '400', color: color.soft }}>{`  ${g.min_select >= 1 ? 'Required' : 'Optional'}${g.max_select != null && g.max_select > 1 ? ` · up to ${g.max_select}` : ''}`}</Text>
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {g.modifiers.map((m) => {
                const on = (chosen[g.group_id] || []).includes(m.modifier_id);
                return (
                  <Pressable
                    key={m.modifier_id} accessibilityRole="button" accessibilityState={{ selected: on }}
                    onPress={() => setChosen((c) => toggle(g, c, m.modifier_id))}
                    style={{ minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: on ? color.brand : color.line, backgroundColor: on ? '#eaf1ff' : color.card }}
                  >
                    <Text style={{ color: on ? color.brand : color.ink, fontWeight: on ? '700' : '400' }}>{m.name}{m.price_delta ? `  ${delta(m.price_delta)}` : ''}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 12, gap: 8, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line }}>
        {still ? <Text style={{ color: color.danger }}>Choose {still.name.toLowerCase()} to continue</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" kind="quiet" onPress={() => router.back()} />
          <Button title={`Add · ${rupees(price)}`} disabled={Boolean(still) || groups.length === 0} onPress={() => { add(product, 1, pick); router.back(); }} style={{ flex: 1 }} />
        </View>
      </View>
    </SafeAreaView>
  );
}
