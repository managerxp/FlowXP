import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, useSession } from '../lib/session.ts';
import { KITCHEN_TYPES } from '../lib/cart.ts';
import { goBack } from '../lib/nav.ts';
import { resetLearning } from '../lib/learn.tsx';
import { guide } from '../lib/guide.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';
import { t } from '../lib/i18n.ts';

/* How to do the things people do most, in a few plain steps each. Tap a task to open it. */
export default function Help() {
  const session = useSession();
  const food = KITCHEN_TYPES.includes(currentBusiness(session)?.business_type ?? '');
  const tasks = guide(food);
  const [open, setOpen] = useState<string | null>(tasks[0]?.id ?? null);
  const [again, setAgain] = useState(false);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title>Help</Title>
            <Button title="Back" kind="quiet" onPress={() => goBack()} />
          </View>
          <Soft style={{ paddingHorizontal: 16 }}>{t('Tap what you want to do.')}</Soft>
          <SectionTitle>How do I…</SectionTitle>
          {tasks.map((task) => {
            const on = open === task.id;
            return (
              <View key={task.id} style={{ borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setOpen(on ? null : task.id)} style={{ minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons name={task.icon as never} size={22} color={color.brand} />
                  <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: color.ink }}>{t(task.title)}</Text>
                  <Ionicons name={on ? 'chevron-up' : 'chevron-down'} size={20} color={color.soft} />
                </Pressable>
                {on ? (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
                    {task.steps.map((st, i) => (
                      <View key={st} style={{ flexDirection: 'row', gap: 10 }}>
                        <Text style={{ color: color.brand, fontWeight: '700', minWidth: 20 }}>{i + 1}.</Text>
                        <Text style={{ flex: 1, color: color.ink, fontSize: 16, lineHeight: 23 }}>{t(st)}</Text>
                      </View>
                    ))}
                    {task.go ? <Button title={task.goLabel ?? 'Try it now'} kind="quiet" onPress={() => router.push(task.go as never)} /> : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          <SectionTitle>Learning the app</SectionTitle>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Button title="Watch the one-minute tour again" kind="quiet" onPress={() => router.push('/welcome')} />
            <Button title="Show the tips and checklist again" kind="quiet" onPress={() => { resetLearning(); setAgain(true); }} />
            {again ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{t('Done. The tips will appear again as you use each screen.')}</Text> : null}
          </View>

          <SectionTitle>Still stuck?</SectionTitle>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Soft>Visit the FlowXP website for guides and to contact us.</Soft>
            <Button title="Open flowxp.in" kind="quiet" onPress={() => { void Linking.openURL('https://flowxp.in'); }} />
          </View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
