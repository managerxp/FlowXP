import { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from './api.ts';
import { api } from './session.ts';
import { goBack } from './nav.ts';
import { setCaptured, useCaptured } from './capture.ts';
import { useLoad } from './useLoad.ts';
import { FORMS, GST, SCHEDULES, blank, changedBody, fromMedicine, medicineBody, medicineProblem, trackingLocked, withTracking, type MedicineDraft, type MedicineFull } from './medicine.ts';
import { Page } from './responsive.tsx';
import { Button, Chips, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from './ui.tsx';

type Category = { category_id: number; name: string };

/* One form for a new medicine and for changing one: name, strength, form, salt, maker, schedule, prices, GST, and how it is tracked (batches, use-by dates, prescription).
   Stock is not typed in here: it comes in with Receive medicines, batch by batch, so every strip has its date. */
export function MedicineForm({ id }: { id: string | null }) {
  const captured = useCaptured();
  const loaded = useLoad<MedicineFull>(`medicine:${id}`, () => api.get<MedicineFull>(`/pharmacy/products/${id}`), id != null);
  const cats = useLoad<Category[]>('pharmacy-categories', () => api.get<Category[]>('/pharmacy/categories'));
  const m = loaded.data;
  const [d, setD] = useState<MedicineDraft>(blank());
  const [start, setStart] = useState<MedicineDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [key] = useState(newKey());   // one key: a double tap on Save makes one medicine

  useEffect(() => { if (m && !start) { const f = fromMedicine(m); setD(f); setStart(f); } }, [m, start]);
  useEffect(() => { if (captured) { setD((x) => ({ ...x, barcode: captured })); setCaptured(null); } }, [captured]);
  const set = (patch: Partial<MedicineDraft>) => { setD((x) => ({ ...x, ...patch })); setProblem(''); };
  const bad = medicineProblem(d);
  const locked = trackingLocked(m ?? null);
  const body = id == null ? medicineBody(d) : start ? changedBody(start, d) : {};
  const nothing = id != null && Object.keys(body).length === 0;

  const save = async () => {
    if (bad) return setProblem(bad);
    if (nothing) return goBack();
    setBusy(true); setProblem('');
    try {
      if (id == null) { const r = await api.post<{ product_id: number }>('/pharmacy/products', body, { idempotencyKey: key }); setMade(String(r.product_id)); }
      else { await api.call(`/pharmacy/products/${id}`, { method: 'PUT', body }); goBack(); }
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the medicine'); }
    finally { setBusy(false); }
  };
  const remove = () => Alert.alert('Remove this medicine?', `${d.name} is taken off the till. Its past bills and batches stay as they are.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => { void api.call(`/pharmacy/products/${id}`, { method: 'PUT', body: { status: 'ARCHIVED' } }).then(() => router.navigate('/products')).catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'Could not remove it')); } }
  ]);

  const field = (label: string, key: keyof MedicineDraft, extra: { placeholder?: string; keyboard?: 'decimal-pad' | 'number-pad'; caps?: 'none' | 'words' } = {}) => (
    <View style={{ gap: 4 }}>
      <Soft>{label}</Soft>
      <TextInput style={s.input} value={String(d[key])} onChangeText={(v) => set({ [key]: v } as Partial<MedicineDraft>)} placeholder={extra.placeholder} keyboardType={extra.keyboard} autoCapitalize={extra.caps ?? 'sentences'} accessibilityLabel={label} />
    </View>
  );
  const toggle = (label: string, value: boolean, on: (v: boolean) => void, note?: string, disabled = false) => (
    <View style={{ minHeight: 48, justifyContent: 'center', gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: color.ink, flex: 1, fontSize: 16 }}>{label}</Text>
        <Switch value={value} onValueChange={on} disabled={disabled} accessibilityLabel={label} />
      </View>
      {note ? <Soft>{note}</Soft> : null}
    </View>
  );

  if (made) {
    return (
      <SafeAreaView style={s.screen}><Page>
        <View style={{ padding: 16, gap: 12 }}>
          <Title>Medicine added</Title>
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>{`${d.name.trim()} is on the till. It has no stock yet.`}</Text>
          <Soft>Add its stock with Receive medicines, so each batch has its use-by date.</Soft>
          <Button title="Receive stock now" onPress={() => router.replace('/pharmacy-receive')} />
          <Button title="Done" kind="quiet" onPress={() => goBack()} />
        </View>
      </Page></SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{id == null ? 'New medicine' : d.name || 'Medicine'}</Title>{m ? <Soft>{`${m.on_hand ?? 0} in stock here`}</Soft> : null}</View>
          <Button title="Cancel" kind="quiet" onPress={() => goBack()} />
        </View>
        {id != null && loaded.busy && !m ? <Loading /> : null}
        {id != null && loaded.error && !m ? <Failed message={loaded.error} onRetry={() => { void loaded.refresh(); }} /> : null}
        {id == null || m ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
            {field('Name', 'name', { placeholder: 'For example Paracetamol 500', caps: 'words' })}
            {field('Strength', 'strength', { placeholder: 'For example 500 mg', caps: 'none' })}
            <Soft>Form</Soft>
            <Chips items={FORMS.map((f) => ({ id: f, label: f }))} value={FORMS.includes(d.dosage_form) ? d.dosage_form : 'Other'} onChange={(f) => set({ dosage_form: f })} />
            {field('Salt or composition', 'salt_composition', { placeholder: 'For example Paracetamol' })}
            {field('Made by', 'manufacturer', { caps: 'words' })}

            <SectionTitle>Price</SectionTitle>
            {field('Selling price', 'price', { keyboard: 'decimal-pad' })}
            {field('MRP', 'mrp', { keyboard: 'decimal-pad', placeholder: 'Printed on the pack' })}
            {field('Cost price', 'cost', { keyboard: 'decimal-pad', placeholder: 'What you pay (optional)' })}
            <Soft>GST rate</Soft>
            <Chips items={GST.map((g) => ({ id: g, label: `${g}%` }))} value={d.gst} onChange={(g) => set({ gst: g })} />
            {field('Sold by', 'unit', { placeholder: 'strip, bottle, piece', caps: 'none' })}

            <SectionTitle>Rules</SectionTitle>
            <Soft>Schedule</Soft>
            <Chips items={SCHEDULES} value={d.schedule_class} onChange={(c) => set({ schedule_class: c, ...(c ? { prescription_required: true } : {}) })} />
            {toggle('Needs a prescription', d.prescription_required, (v) => set({ prescription_required: v }), d.schedule_class ? 'Scheduled medicines always need one.' : undefined, Boolean(d.schedule_class))}
            {toggle('Keep a use-by date for each batch', d.expiry_tracking, (v) => setD(withTracking(d, { expiry_tracking: v })), locked ? 'Cannot be switched off while there is stock.' : 'Strongly advised for medicines.', locked)}
            {toggle('Track by batch', d.batch_tracking, (v) => setD(withTracking(d, { batch_tracking: v })), undefined, locked || d.expiry_tracking)}

            <SectionTitle>More</SectionTitle>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>{field('Barcode', 'barcode', { keyboard: 'number-pad', caps: 'none' })}</View>
              <Button title="Scan" kind="quiet" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} />
            </View>
            {field('HSN code', 'hsn', { keyboard: 'number-pad', caps: 'none' })}
            {field('Tell me when stock falls to', 'reorder', { keyboard: 'decimal-pad', placeholder: 'Reorder level (optional)' })}
            {cats.data && cats.data.length ? (
              <>
                <Soft>Category</Soft>
                <Chips items={[{ id: '0', label: 'None' }, ...cats.data.map((c) => ({ id: String(c.category_id), label: c.name }))]} value={d.category_id} onChange={(c) => set({ category_id: c })} />
              </>
            ) : null}

            <ErrorText>{problem}</ErrorText>
            <Button title={id == null ? 'Add the medicine' : 'Save the changes'} onPress={() => { void save(); }} busy={busy} disabled={Boolean(bad)} />
            {id != null ? <Button title="Remove this medicine" kind="danger" onPress={remove} /> : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
