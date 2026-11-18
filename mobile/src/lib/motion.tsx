import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type ViewStyle } from 'react-native';
import { color } from './theme.ts';
import { staggerDelay } from './motionRules.ts';

export { staggerDelay };

/* The few movements the app uses, in one place: things fade and rise a little into view, loading shows grey shapes that shimmer instead of a bare spinner.
   Everything stands still for a person who has asked their phone to reduce motion. Built on React Native's own Animated, running on the native side. */

/** True when the phone's "reduce motion" / "remove animations" setting is on. */
export const useReduceMotion = (): boolean => {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduce(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduce;
};

/** Fades its children in while lifting them a few points, once, when they first appear. `index` staggers a row of tiles or a list. */
export const FadeIn = ({ children, index = 0, style, lift = 10 }: { children: ReactNode; index?: number; style?: ViewStyle; lift?: number }) => {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    const run = Animated.timing(v, { toValue: 1, duration: 260, delay: staggerDelay(index), easing: Easing.out(Easing.cubic), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [reduce, index, v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [lift, 0] }) }] }]}>{children}</Animated.View>;
};

/** A grey shape that breathes while something loads. */
export const Shimmer = ({ width = '100%', height = 14, radius = 8, style }: { width?: ViewStyle['width']; height?: number; radius?: number; style?: ViewStyle }) => {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (reduce) { v.setValue(0.6); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.45, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: color.line, opacity: v }, style]} />;
};

/** The shape of a list while it loads: a round icon and two lines, a few times over. */
export const SkeletonRows = ({ rows = 4 }: { rows?: number }) => (
  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: 10, paddingHorizontal: 16 }}>
    {Array.from({ length: rows }, (_, i) => (
      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
        <Shimmer width={36} height={36} radius={18} />
        <View style={{ flex: 1, gap: 8 }}><Shimmer width={`${70 - (i % 3) * 12}%`} height={14} /><Shimmer width={`${45 - (i % 2) * 10}%`} height={11} /></View>
      </View>
    ))}
  </View>
);
