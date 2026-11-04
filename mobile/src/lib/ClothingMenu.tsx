import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from './session.ts';
import { useLoad } from './useLoad.ts';
import { rupees } from './money.ts';
import { t } from './i18n.ts';
import type { Product } from './catalog.ts';
import { priceText, variantProduct, type StyleDetail, type StyleRow } from './clothing.ts';
import { Button, ErrorText, Soft, color } from './ui.tsx';

/* The clothing till. A style is one tile; a tap opens its sizes and colours as a grid, and tapping a cell puts that exact size and colour on the bill. The grid stays open for the
   next size. Scanning a tag needs none of this (the barcode is the variant). The styles are kept on the phone like other lists, so the tiles show with a weak signal; the grid
   itself needs a connection, and the till's ordinary search and scan still work without one. */

export const useStyles = (search: string) => {
  const session = useSession();
  const key = `clothing-styles:${session.businessId}:${session.branchId}:${search.trim().toLowerCase()}`;
  return useLoad<StyleRow[]>(key, () => api.get<StyleRow[]>(`/clothing/styles?limit=100${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`));
};

const Tile = ({ style, n, cols, onOpen }: { style: StyleRow; n: number; cols: number; onOpen: (s: StyleRow) => void }) => (
  <Pressable
    accessibilityRole="button" accessibilityLabel={`${style.name}, ${style.stock > 0 ? `${style.stock} in stock` : 'sold out'}${n ? `, ${n} on the bill` : ''}`} disabled={style.stock <= 0} onPress={() => onOpen(style)}
    style={({ pressed }) => [{ flex: 1 / cols, minHeight: 88, padding: 10, borderRadius: 12, borderWidth: n ? 2 : 1, borderColor: n ? color.brand : color.line, backgroundColor: n ? color.tint : color.card, opacity: style.stock <= 0 ? 0.5 : 1, justifyContent: 'space-between' }, pressed && { backgroundColor: color.press }]}
  >
    {n ? <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{n}</Text></View> : null}
    <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', color: color.ink, paddingRight: n ? 26 : 0 }}>{style.name}</Text>
    <View>
      <Text style={{ color: color.ink, fontWeight: '600' }}>{priceText(style.price_from_paise, style.price_to_paise, rupees)}</Text>
      <Text style={{ color: style.stock <= 0 ? color.danger : color.soft, fontSize: 12 }}>{style.stock <= 0 ? t('Sold out') : t('{n} in {c} colours', { n: style.stock, c: style.colours.length })}</Text>
    </View>
  </Pressable>
);

/** The tiles. `fallback` is the ordinary category menu, shown when this shop has no styles or they cannot be loaded at all. */
export const ClothingMenu = ({ cols, search, inBill, onOpen, fallback }: { cols: number; search: string; inBill: Map<number, number>; onOpen: (s: StyleRow) => void; fallback: ReactNode }) => {
  const list = useStyles(search);
  if (list.busy && !list.data) return <View style={{ padding: 24 }}><ActivityIndicator color={color.brand} /></View>;
  if (!list.data || (list.data.length === 0 && !search.trim())) return <>{fallback}</>;
  return (
    <FlatList
      key={cols} numColumns={cols} data={list.data} keyExtractor={(s) => String(s.style_id)} contentContainerStyle={{ padding: 8 }} columnWrapperStyle={{ gap: 8 }} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      ListEmptyComponent={<Soft style={{ padding: 16 }}>No style matches that.</Soft>}
      renderItem={({ item }) => <Tile style={item} n={(item.product_ids ?? []).reduce((a, id) => a + (inBill.get(id) ?? 0), 0)} cols={cols} onOpen={onOpen} />}
    />
  );
};

/** The size x colour grid of one style. `inBill` is how many of each variant are on the bill; `onAdd` puts one on. Without `onAdd` it only shows stock (the Styles screen). */
export const StyleGrid = ({ styleId, inBill, onAdd }: { styleId: number; inBill?: Map<number, number>; onAdd?: (p: Product) => void }) => {
  const [style, setStyle] = useState<StyleDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; setStyle(null); setError('');
    api.get<StyleDetail>(`/clothing/styles/${styleId}`).then((s) => { if (alive) setStyle(s); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load'); });
    return () => { alive = false; };
  }, [styleId]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!style) return <View style={{ padding: 24 }}><ActivityIndicator color={color.brand} /></View>;
  const { colours, sizes, grid } = style.matrix;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 96 }} />
          {sizes.map((z) => <Text key={z} style={{ width: 56, textAlign: 'center', fontWeight: '700', color: color.soft, paddingBottom: 6 }}>{z}</Text>)}
        </View>
        {colours.map((c) => (
          <View key={c.name} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ width: 96, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: color.line, backgroundColor: c.hex ?? '#e5e7eb' }} />
              <Text numberOfLines={1} style={{ flex: 1, color: color.ink, fontWeight: '600' }}>{c.name}</Text>
            </View>
            {sizes.map((z) => {
              const cell = grid[c.name]?.[z];
              if (!cell) return <Text key={z} style={{ width: 56, textAlign: 'center', color: color.soft }}>–</Text>;
              const have = inBill?.get(cell.product_id) ?? 0;
              const left = cell.stock - have;
              const out = onAdd ? left <= 0 : false;
              const tone = cell.stock <= 0 ? color.danger : cell.low ? color.warn : color.ink;
              return (
                <Pressable
                  key={z} accessibilityRole={onAdd ? 'button' : 'text'} accessibilityLabel={`${c.name} ${z}, ${cell.stock} in stock`} disabled={!onAdd || out} onPress={() => onAdd?.(variantProduct(style, c.name, z, cell))}
                  style={({ pressed }) => [{ width: 52, height: 48, marginHorizontal: 2, borderRadius: 10, borderWidth: have ? 2 : 1, borderColor: have ? color.brand : color.line, backgroundColor: have ? color.tint : color.card, alignItems: 'center', justifyContent: 'center', opacity: out ? 0.4 : 1 }, pressed && { backgroundColor: color.press }]}
                >
                  <Text style={{ fontWeight: '700', color: tone }}>{onAdd ? left : cell.stock}</Text>
                  {have > 0 ? <View style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{have}</Text></View> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

/** The grid as a sheet over the till. */
export const StyleSheet = ({ style, inBill, onAdd, onClose }: { style: StyleRow; inBill: Map<number, number>; onAdd: (p: Product) => void; onClose: () => void }) => (
  <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg, padding: 16, gap: 12 }}>
      <View><Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>{style.name}</Text><Soft>{style.style_code} · {t('Tap a size to add it to the bill.')}</Soft></View>
      <StyleGrid styleId={style.style_id} inBill={inBill} onAdd={onAdd} />
      <Soft>{t('The number is what is left to sell here. Amber is running low.')}</Soft>
      <View style={{ flex: 1 }} />
      <Button title={t('Done')} onPress={onClose} />
    </SafeAreaView>
  </Modal>
);
