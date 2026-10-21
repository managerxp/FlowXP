import { useEffect, useRef } from 'react';
import { Text, View, useColorScheme } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { restoreSession, useSession } from '../lib/session.ts';
import { OfflineBar } from '../lib/OfflineBar.tsx';
import { HelpButton } from '../lib/HelpButton.tsx';
import { Logo } from '../lib/Logo.tsx';
import { flushBugReports } from '../lib/bugsend.ts';
import { installAlerts, syncAlerts } from '../lib/push.ts';
import { installCrashReporting, reportError } from '../lib/crash.ts';
import { installLocation } from '../lib/locate.ts';
import { Button, color, rebuildStyles } from '../lib/ui.tsx';
import { applyPalette } from '../lib/theme.ts';
import { loadDisplay, resolveTheme, useDisplay } from '../lib/display.ts';
import { kvGet, kvSet } from '../lib/local.ts';
import { loadLanguage } from '../lib/lang.tsx';
import { t, useLang } from '../lib/i18n.ts';

/* Expo Router shows this instead of a blank screen when a screen throws. The error is reported (technical facts only) and the cashier can
   go on: sales waiting on the phone are untouched, they live in the database, not on the screen. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => { void reportError(error, undefined, false); }, [error]);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: color.bg }}>
      <Logo width={160} />
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: color.ink }}>Something went wrong</Text>
      <Text style={{ color: color.soft }}>Your bills are safe on this phone. Tap Try again. If it keeps happening, tell FlowXP: this problem has already been reported.</Text>
      <Button title="Try again" onPress={() => { void retry(); }} />
      <Button title="Report a problem" kind="quiet" onPress={() => router.push('/report')} />
    </View>
  );
}

/* The app always starts at index (which sends a signed-out person to sign in). Without this the first screen listed below would open first. */
export const unstable_settings = { initialRouteName: 'index' };

export default function Layout() {
  const lang = useLang();
  // this phone's display choices (Settings > Display): the theme is applied BEFORE the screens draw, and a change starts the stack again so every screen picks it up
  const display = useDisplay();
  const theme = resolveTheme(display.theme, useColorScheme());
  const applied = useRef('');
  if (applied.current !== theme) { applyPalette(theme); rebuildStyles(); applied.current = theme; }
  const { ready, token } = useSession();
  // once someone is signed in: keep this phone on the list for alerts, or ask once
  useEffect(() => { if (ready && token) { void syncAlerts(); void flushBugReports(); } }, [ready, token]);
  useEffect(() => { installCrashReporting(); installLocation(); installAlerts(); void loadLanguage(); void loadDisplay({ get: kvGet, set: kvSet }); void restoreSession(); }, []);
  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <OfflineBar />
      {/* a new language re-draws every screen: the key makes the whole stack start again, so nothing keeps the old words */}
      <Stack key={`${lang}-${theme}-${display.date}-${display.decimals}`} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="options" options={{ presentation: 'modal' }} />
      </Stack>
      <HelpButton />
    </>
  );
}
