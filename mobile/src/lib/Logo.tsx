import { Image } from 'react-native';

/* The FlowXP logo (the F mark and the name), from assets/logo.png. The picture is 720 x 445, so any width keeps its shape. */
export function Logo({ width = 200 }: { width?: number }) {
  return <Image source={require('../../assets/logo.png')} accessibilityLabel="FlowXP" accessibilityRole="image" resizeMode="contain" style={{ width, height: Math.round(width * 445 / 720), alignSelf: 'center' }} />;
}
