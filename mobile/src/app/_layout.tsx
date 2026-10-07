import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { restoreSession } from '../lib/session.ts';
import { installCrashReporting, reportError } from '../lib/crash.ts';
import { Button, color } from '../lib/ui.tsx';

/* Expo Router shows this instead of a blank screen when a screen throws. The error is reported (technical facts only) and the cashier can
   go on: sales waiting on the phone are untouched, they live in the database, not on the screen. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => { void reportError(error, undefined, false); }, [error]);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: color.bg }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: color.ink }}>Something went wrong</Text>
      <Text style={{ color: color.soft }}>Your sales are safe on this phone. Try again, and if it keeps happening, tell FlowXP support: the problem has been reported.</Text>
      <Button title="Try again" onPress={() => { void retry(); }} />
    </View>
  );
}

export default function Layout() {
  useEffect(() => { installCrashReporting(); void restoreSession(); }, []);
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="options" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
