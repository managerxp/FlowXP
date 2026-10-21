/* The "Help me find" button that floats over every screen once someone is signed in: tap it, say what you want to do, and it opens the screen. It stays off the screens
   where a person is busy or where it would get in the way (sign in, the till, paying, the receipt, scanning, and the help screen itself). */
import { Pressable, Text } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from './session.ts';
import { t } from './i18n.ts';
import { color } from './ui.tsx';
import { showHelpButton } from './workshopExtras.ts';

export const HelpButton = () => {
  const path = usePathname();
  const { token, ready } = useSession();
  if (!ready || !token || !showHelpButton(path)) return null;
  return (
    <Pressable onPress={() => router.push('/help-find')} accessibilityRole="button" accessibilityLabel={t('Help me find')}
      style={{ position: 'absolute', right: 16, bottom: 92, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 24, backgroundColor: color.brand, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
      <Ionicons name="help-buoy-outline" size={20} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700' }}>{t('Help me find')}</Text>
    </Pressable>
  );
};
