import { useWindowDimensions, View } from 'react-native';
import type { ReactNode } from 'react';

/** A tablet or a phone turned sideways: wide enough for side-by-side panes and a left navigation rail. */
export const WIDE = 768;
export const useWide = () => useWindowDimensions().width >= WIDE;

/** Keeps a list or form a comfortable width on a tablet instead of stretching edge to edge, centred. */
export const Page = ({ children, max = 760 }: { children: ReactNode; max?: number }) => (
  <View style={{ flex: 1, width: '100%', maxWidth: max, alignSelf: 'center' }}>{children}</View>
);
