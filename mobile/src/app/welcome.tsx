import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, useSession } from '../lib/session.ts';
import { KITCHEN_TYPES } from '../lib/cart.ts';
import { markDone } from '../lib/learn.tsx';
import { tour } from '../lib/onboarding.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, color, s } from '../lib/ui.tsx';
import { t } from '../lib/i18n.ts';

/* A one-minute tour, three screens, shown once and always skippable. It ends at a real action (make a bill), not at a "finish" button.
   Replay it from More > Help. */
export default function Welcome() {
  const session = useSession();
  const food = KITCHEN_TYPES.includes(currentBusiness(session)?.business_type ?? '');
  const slides = tour(food);
  const [at, setAt] = useState(0);
  const last = at === slides.length - 1;
  const slide = slides[at];

  const finish = (go?: string) => { markDone('tour_done'); if (go) router.replace(go as never); else router.back(); };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={560}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <Text style={{ color: color.soft }}>{t('{at} of {total}', { at: at + 1, total: slides.length })}</Text>
          <Pressable accessibilityRole="button" onPress={() => finish()} style={{ minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'flex-end' }}>
            <Text style={{ color: color.brand, fontWeight: '700', fontSize: 16 }}>{t('Skip')}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 20 }} accessibilityLiveRegion="polite">
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#eaf1ff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={slide.icon as never} size={48} color={color.brand} />
          </View>
          <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', color: color.ink, textAlign: 'center' }}>{t(slide.title)}</Text>
          <View style={{ gap: 8 }}>
            {slide.lines.map((l, i) => <Text key={l} style={{ fontSize: 18, color: color.ink, textAlign: 'center', lineHeight: 26 }}>{at === 0 ? `${i + 1}. ${t(l)}` : t(l)}</Text>)}
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 12 }}>
          {slides.map((_, i) => <View key={i} style={{ width: i === at ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === at ? color.brand : color.line }} />)}
        </View>
        <View style={{ padding: 16, gap: 8 }}>
          {last ? <Button title="Make my first bill" onPress={() => finish('/sell')} /> : <Button title="Next" onPress={() => setAt(at + 1)} />}
          {last ? <Button title="Not now" kind="quiet" onPress={() => finish()} /> : at > 0 ? <Button title="Back" kind="quiet" onPress={() => setAt(at - 1)} /> : null}
        </View>
      </Page>
    </SafeAreaView>
  );
}
