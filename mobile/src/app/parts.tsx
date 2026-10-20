import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees } from '../lib/money.ts';
import { lookupPath, partSub, stockText, type PartRow } from '../lib/parts.ts';
import { Page } from '../lib/responsive.tsx';
import { SearchBox } from '../lib/SearchBox.tsx';
import { Button, Empty, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* Find a part by name, code, barcode or ANY part number (OEM, manufacturer, alternate), typed or scanned, with or without dashes. Tap a part to see where it is and what it fits. */
export default function Parts() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text), 300); return () => clearTimeout(t); }, [text]);
  const path = lookupPath(q);
  const found = useLoad<PartRow[]>(`parts-lookup:${q}`, () => api.get<PartRow[]>(path as string), path !== null);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Find a part</Title><Soft>Name, code, barcode or any part number</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <SearchBox value={text} onChange={setText} placeholder="5551168K00, brake pad, AP-0004" label="Search parts" />
          <Button title="Find parts for a vehicle" kind="quiet" onPress={() => router.push('/parts-vehicle')} />
        </View>
        <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {path === null ? <Empty>Type at least two characters, or scan a barcode.</Empty> : null}
          {found.error && !found.data ? <Failed message={found.error} onRetry={() => { void found.refresh(); }} /> : null}
          {found.busy && !found.data ? <Loading /> : null}
          {found.data && found.data.length === 0 ? <Empty>No part matches that. Check the number, or add the part on the website.</Empty> : null}
          {(found.data ?? []).map((p) => (
            <Line key={p.product_id} left={p.name} sub={`${partSub(p)}${p.matched_on && p.matched_on !== 'search' ? ` · matched ${p.matched_on === 'oem' ? 'OEM number' : p.matched_on === 'mfr' ? 'manufacturer number' : p.matched_on === 'sku' ? 'code' : p.matched_on === 'barcode' ? 'barcode' : 'part number'}` : ''}`}
              right={`${rupees(p.selling_price_paise)}\n${stockText(p.stock)}`} onPress={() => router.push({ pathname: '/parts-part/[id]', params: { id: String(p.product_id) } })} />
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
