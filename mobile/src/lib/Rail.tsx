import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color } from './ui.tsx';
import { useSideways } from './responsive.tsx';

type Route = { key: string; name: string };
type Descriptor = { options: { title?: string; tabBarBadge?: number | string; tabBarIcon?: (p: { focused: boolean; color: string; size: number }) => React.ReactNode } };
export type RailProps = {
  state: { index: number; routes: Route[] };
  descriptors: Record<string, Descriptor>;
  navigation: { navigate: (name: string) => void };
  hidden: string[];
};

/* The navigation rail for a tablet or a phone turned sideways (Material 3): the main places down the left, and More pinned at the bottom, as in the Windows app.
   The chosen place sits in a soft pill; every target is at least 56 wide and 48 tall. */
export function Rail({ state, descriptors, navigation, hidden }: RailProps) {
  const slim = useSideways();   // a phone on its side is only ~400 tall: a slimmer, tighter rail so every place fits without scrolling
  const shown = state.routes.map((r, i) => ({ r, i })).filter(({ r }) => !hidden.includes(r.name));
  const main = shown.filter(({ r }) => r.name !== 'more');
  const more = shown.find(({ r }) => r.name === 'more');

  const item = ({ r, i }: { r: Route; i: number }) => {
    const o = descriptors[r.key].options;
    const on = state.index === i;
    return (
      <Pressable key={r.key} accessibilityRole="tab" accessibilityLabel={o.title} accessibilityState={{ selected: on }} onPress={() => navigation.navigate(r.name)}
        android_ripple={{ color: '#0b57ff22', borderless: true }} style={{ alignItems: 'center', gap: slim ? 1 : 4, paddingVertical: slim ? 2 : 6, minHeight: slim ? 52 : 64, width: slim ? 72 : 88 }}>
        <View style={{ width: slim ? 48 : 56, height: slim ? 28 : 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.press : 'transparent' }}>
          {o.tabBarIcon?.({ focused: on, color: on ? color.brand : color.soft, size: slim ? 22 : 24 })}
          {o.tabBarBadge ? <View style={{ position: 'absolute', top: -2, right: 6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{o.tabBarBadge}</Text></View> : null}
        </View>
        <Text numberOfLines={1} style={{ fontSize: slim ? 11 : 12, fontWeight: on ? '700' : '600', color: on ? color.ink : color.soft }}>{o.title}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top', 'bottom', 'left']} style={{ width: slim ? 76 : 96, height: '100%', alignSelf: 'stretch', backgroundColor: color.card, borderRightWidth: 1, borderColor: color.line }}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: slim ? 4 : 12, gap: slim ? 2 : 8 }} showsVerticalScrollIndicator={false} style={{ flex: 1, flexGrow: 1 }}>{main.map(item)}</ScrollView>
      {more ? <View style={{ alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: color.line }}>{item(more)}</View> : null}
    </SafeAreaView>
  );
}
