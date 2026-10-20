import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Logo } from './Logo.tsx';
import { Button, color } from './ui.tsx';

/* The first screen while the phone opens the saved sign-in: the logo and a spinner. If it takes longer than a few seconds the person is told, and can try again, instead of watching nothing happen. */
export function Splash({ onRetry }: { onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return (
    <View accessibilityLiveRegion="polite" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, backgroundColor: color.bg }}>
      <Logo width={220} />
      <ActivityIndicator size="large" color={color.brand} accessibilityLabel="Starting FlowXP" />
      <Text style={{ color: color.soft }}>Starting FlowXP…</Text>
      {slow ? (
        <View style={{ gap: 10, alignItems: 'center' }}>
          <Text style={{ color: color.soft, textAlign: 'center' }}>This is taking longer than usual. Check your internet connection.</Text>
          {onRetry ? <Button title="Try again" kind="quiet" onPress={onRetry} /> : null}
        </View>
      ) : null}
    </View>
  );
}
