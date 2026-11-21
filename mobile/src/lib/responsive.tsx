import { FlatList, Platform, useWindowDimensions, View, type FlatListProps } from 'react-native';
import { Children, type ReactNode } from 'react';
import { GRID, WIDE, columnsFor, isSideways, isWide, pageMax } from './layout.ts';
import { color, radius, shadow } from './theme.ts';

export { GRID, WIDE };

/** A tablet or a phone turned sideways: wide enough for side-by-side panes and a left navigation rail. */
export const useWide = () => isWide(useWindowDimensions().width);

/** A phone turned sideways: wide but short, so the rail is slim and pages use the width instead of a centred column. */
export const useSideways = () => { const { width, height } = useWindowDimensions(); return isSideways(width, height); };

/** Wide enough for two columns of rows: a tablet on its side, or a phone on its side. */
export const useColumns = () => { const { width, height } = useWindowDimensions(); return columnsFor(width, height); };

/** Keeps a list or form a comfortable width on a tablet instead of stretching edge to edge, centred. A `grid` page opens up to fit two columns of rows when the screen is wide enough. */
export const Page = ({ children, max = 760, grid = false }: { children: ReactNode; max?: number; grid?: boolean }) => {
  const { width, height } = useWindowDimensions();
  return <View style={{ flex: 1, width: '100%', maxWidth: pageMax(width, max, grid, height), alignSelf: 'center' }}>{children}</View>;
};

/** A FlatList that shows its rows in two columns on a wide screen and one on a phone. Everything else is a FlatList's. */
export function ColumnList<T>({ renderItem, ...rest }: FlatListProps<T>) {
  const cols = useColumns();
  // on a phone the rows sit together in one rounded card, like Group; an empty list stays a plain message, and a caller's own contentContainerStyle wins
  const card = cols === 1 && (rest.data?.length ?? 0) > 0 ? { marginHorizontal: 16, marginBottom: 16, borderRadius: radius.card, borderCurve: 'continuous' as const, borderWidth: 1, borderColor: color.line, backgroundColor: color.card, overflow: 'hidden' as const, boxShadow: shadow.card } : null;
  return <FlatList initialNumToRender={14} maxToRenderPerBatch={10} windowSize={7} removeClippedSubviews={Platform.OS === 'android'} contentContainerStyle={card} {...rest} key={cols} numColumns={cols} renderItem={cols === 1 ? renderItem : (info) => <View style={{ flex: 1 / cols }}>{renderItem?.(info)}</View>} />;
}

/** A list of rows: one column on a phone, two on a tablet so a long menu does not become a long scroll. */
export const Rows = ({ children }: { children: ReactNode }) => {
  const wide = useWide();
  const rows = Children.toArray(children);
  if (!wide) return <>{rows}</>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{rows.map((c, i) => <View key={i} style={{ width: '50%' }}>{c}</View>)}</View>;
};
