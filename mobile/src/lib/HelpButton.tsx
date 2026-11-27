/* The "Help me find" button that floats over every screen once someone is signed in: tap it, say what you want to do, and it opens the screen. It stays off the screens
   where a person is busy or where it would get in the way (sign in, the till, paying, the receipt, scanning, and the help screen itself). */
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { kvGet, kvSet } from './local.ts';
import { router, usePathname } from 'expo-router';
import { Ionicons } from './icons.tsx';
import { useSession } from './session.ts';
import { t } from './i18n.ts';
import { color } from './ui.tsx';
import { showHelpButton } from './workshopExtras.ts';

/* It can be dragged out of the way and stays where it was put (kept on this phone). A tap still opens the search: only a finger that moves drags it. */
const KEY = 'help_button_at';
const START = { right: 16, bottom: 92 };
export const HelpButton = () => {
  const path = usePathname();
  const { token, ready } = useSession();
  const screen = useWindowDimensions();
  const [at, setAt] = useState(START);
  const size = useRef({ width: 150, height: 48 });
  const from = useRef(START);
  const now = useRef(START); now.current = at;
  const bounds = useRef(screen); bounds.current = screen;
  useEffect(() => { void kvGet(KEY).then((raw) => { const p = JSON.parse(raw || 'null'); if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom)) setAt(p); }).catch(() => {}); }, []);
  /* never off the screen, also after the tablet is turned round */
  const inside = (p: typeof START) => ({ right: Math.max(8, Math.min(bounds.current.width - size.current.width - 8, p.right)), bottom: Math.max(8, Math.min(bounds.current.height - size.current.height - 40, p.bottom)) });
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderGrant: () => { from.current = inside(now.current); },
    onPanResponderMove: (_, g) => setAt(inside({ right: from.current.right - g.dx, bottom: from.current.bottom - g.dy })),
    onPanResponderRelease: (_, g) => { void kvSet(KEY, JSON.stringify(inside({ right: from.current.right - g.dx, bottom: from.current.bottom - g.dy }))).catch(() => {}); },
    onPanResponderTerminationRequest: () => false
  })).current;
  if (!ready || !token || !showHelpButton(path)) return null;
  return (
    <View {...drag.panHandlers} onLayout={(e) => { size.current = e.nativeEvent.layout; }} style={{ position: 'absolute', ...inside(at) }}>
      <Pressable onPress={() => router.push('/help-find')} accessibilityRole="button" accessibilityLabel={t('Help me find')}
        style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 24, backgroundColor: color.brand, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
        <Ionicons name="help-buoy-outline" size={20} color={color.onAction} />
        <Text style={{ color: color.onAction, fontWeight: '700' }}>{t('Help me find')}</Text>
      </Pressable>
    </View>
  );
};
