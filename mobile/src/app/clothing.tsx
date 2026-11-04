import { useState } from 'react';
import { Modal, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../lib/nav.ts';
import { rupees } from '../lib/money.ts';
import { t } from '../lib/i18n.ts';
import { priceText, type StyleRow } from '../lib/clothing.ts';
import { StyleGrid, useStyles } from '../lib/ClothingMenu.tsx';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

/* Styles and sizes: every style with its stock, and a tap shows the size x colour grid. Making styles, prices, barcodes and price tags are on the website. */
export default function Clothing() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<StyleRow | null>(null);
  const list = useStyles(search);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Styles and sizes</Title><Soft>Each product with every size and colour</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={list.savedAt} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder="Name, style code or barcode" accessibilityLabel="Search styles" autoCorrect={false} autoCapitalize="none" />
        </View>
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1 }} data={list.data ?? []} keyExtractor={(x) => String(x.style_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>No styles yet. Add your first style on the website.</Empty> : null}
          renderItem={({ item: x }) => (
            <Line
              left={x.name} sub={`${x.style_code} · ${x.stock > 0 ? t('{n} in stock', { n: x.stock }) : t('Sold out')}${x.sold_out > 0 && x.stock > 0 ? ` · ${t('{n} sold out', { n: x.sold_out })}` : ''}`}
              right={priceText(x.price_from_paise, x.price_to_paise, rupees)} onPress={() => setOpen(x)}
            />
          )}
        />
        <View style={{ padding: 8 }}><Soft style={{ textAlign: 'center' }}>Making styles, changing prices and printing price tags are on the FlowXP website.</Soft></View>
      </Page>
      {open ? (
        <Modal visible animationType="slide" onRequestClose={() => setOpen(null)}>
          <SafeAreaView style={[s.screen, { padding: 16, gap: 12 }]}>
            <View><Title>{open.name}</Title><Soft>{open.style_code}</Soft></View>
            <StyleGrid styleId={open.style_id} />
            <Soft>{t('The number is the stock here. Amber is running low, red is sold out.')}</Soft>
            <View style={{ flex: 1 }} />
            <Button title={t('Done')} onPress={() => setOpen(null)} />
          </SafeAreaView>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}
