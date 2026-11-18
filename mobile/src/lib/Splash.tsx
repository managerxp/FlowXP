import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { Logo } from './Logo.tsx';
import { useReduceMotion } from './motion.tsx';
import { Button, color } from './ui.tsx';

/* The first screen while the phone opens the saved sign-in: the logo settles into place and a thin bar runs beneath it. If it takes longer than a few seconds the person is told, and can try again, instead of watching nothing happen. */
export function Splash({ onRetry }: { onRetry?: () => void }) {
  const reduce = useReduceMotion();
  const [slow, setSlow] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (reduce) { pop.setValue(1); return; }
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.timing(run, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce, pop, run]);
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel="Starting FlowXP" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, padding: 24, backgroundColor: color.bg }}>
      <Animated.View style={{ opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }}><Logo width={220} /></Animated.View>
      <View style={{ width: 120, height: 4, borderRadius: 2, backgroundColor: color.line, overflow: 'hidden' }}>
        <Animated.View style={{ width: 60, height: 4, borderRadius: 2, backgroundColor: color.brand, transform: [{ translateX: run.interpolate({ inputRange: [0, 1], outputRange: [-60, 120] }) }] }} />
      </View>
      {slow ? (
        <View style={{ gap: 10, alignItems: 'center' }}>
          <Text style={{ color: color.soft, textAlign: 'center' }}>This is taking longer than usual. Check your internet connection.</Text>
          {onRetry ? <Button title="Try again" kind="quiet" onPress={onRetry} /> : null}
        </View>
      ) : null}
    </View>
  );
}
