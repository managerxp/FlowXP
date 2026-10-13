import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees } from '../lib/money.ts';
import { FIT_LABEL, stockText, vehiclePartsPath, type VehicleMake, type VehiclePart } from '../lib/parts.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Parts for a vehicle: only parts with a fitment record are listed, each labelled verified or not verified. A part recorded as not fitting is left out. */
export default function PartsVehicle() {
  const tree = useLoad<VehicleMake[]>('parts-vehicles', () => api.get<VehicleMake[]>('/autoparts/vehicles'));
  const [makeId, setMakeId] = useState(0);
  const [modelId, setModelId] = useState(0);
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const make = (tree.data ?? []).find((m) => m.make_id === makeId);
  const res = useLoad<VehiclePart[]>(`parts-for:${modelId}:${year}:${search}`, () => api.get<VehiclePart[]>(vehiclePartsPath(modelId, year, search)), modelId > 0);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Parts for a vehicle</Title><Soft>Choose the make, then the model</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {tree.error && !tree.data ? <Failed message={tree.error} onRetry={() => { void tree.refresh(); }} /> : null}
          {tree.busy && !tree.data ? <Loading /> : null}
          {tree.data && tree.data.length === 0 ? <Empty>No vehicles are set up yet. Add makes and models on the website.</Empty> : null}
          {tree.data?.length ? (
            <>
              <SectionTitle>Make</SectionTitle>
              <Chips<string> items={tree.data.map((m) => ({ id: String(m.make_id), label: m.name }))} value={String(makeId || '')} onChange={(v) => { setMakeId(Number(v)); setModelId(0); }} />
            </>
          ) : null}
          {make ? (
            <>
              <SectionTitle>Model</SectionTitle>
              <Chips<string> items={make.models.map((m) => ({ id: String(m.model_id), label: m.name }))} value={String(modelId || '')} onChange={(v) => setModelId(Number(v))} />
            </>
          ) : null}
          {modelId ? (
            <View style={{ padding: 16, flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.input, { width: 110 }]} value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} placeholder="Year" accessibilityLabel="Year" />
              <TextInput style={[s.input, { flex: 1 }]} value={search} onChangeText={setSearch} placeholder="Part, like brake pad" accessibilityLabel="Part" />
            </View>
          ) : null}
          {res.error && !res.data ? <Failed message={res.error} onRetry={() => { void res.refresh(); }} /> : null}
          {res.busy && !res.data ? <Loading /> : null}
          {res.data && res.data.length === 0 ? <Empty>No part is recorded for this vehicle. Do not assume one fits.</Empty> : null}
          {(res.data ?? []).map((p) => (
            <View key={p.product_id}>
              <Line left={p.name} sub={`${p.oem_part_no ? `OEM ${p.oem_part_no} · ` : ''}${p.sku ?? ''}${p.brand_name ? ` · ${p.brand_name}` : ''}`} right={`${rupees(p.selling_price_paise)}\n${stockText(p.stock)}`} onPress={() => router.push({ pathname: '/parts-part/[id]', params: { id: String(p.product_id) } })} />
              <Text style={{ paddingHorizontal: 16, paddingBottom: 8, color: p.fitment === 'VERIFIED' ? color.ok : color.warn, fontWeight: '600' }}>{FIT_LABEL[p.fitment]}{p.warning ? `. ${p.warning}` : ''}</Text>
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
