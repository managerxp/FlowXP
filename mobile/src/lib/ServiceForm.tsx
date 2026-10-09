import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from './api.ts';
import { api } from './session.ts';
import { goBack } from './nav.ts';
import { useLoad } from './useLoad.ts';
import { GST, MINUTES, WHO, blank, changedBody, fromService, serviceBody, serviceProblem, durationText, type MenuService, type ServiceDraft } from './salonMenu.ts';
import { Page } from './responsive.tsx';
import { Button, Chips, ErrorText, Failed, Loading, Soft, Title, color, s } from './ui.tsx';

type Category = { category_id: number; name: string };

/* One form for a new service and for changing one: name, price, how long it takes, GST, category, who it is for. Removing a service takes it off the till and booking list; its past bills stay. */
export function ServiceForm({ id }: { id: string | null }) {
  const loaded = useLoad<MenuService>(`salon-service:${id}`, () => api.get<MenuService>(`/salon/services/${id}`), id != null);
  const cats = useLoad<Category[]>('salon-categories', () => api.get<Category[]>('/salon/categories'));
  const settings = useLoad<{ default_service_tax_rate?: number }>('salon-settings-gst', () => api.get('/salon/settings'), id == null);
  const m = loaded.data;
  const [d, setD] = useState<ServiceDraft>(blank());
  const [start, setStart] = useState<ServiceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [key] = useState(newKey());   // one key: a double tap on Save makes one service

  useEffect(() => { if (m && !start) { const f = fromService(m); setD(f); setStart(f); } }, [m, start]);
  useEffect(() => { const g = settings.data?.default_service_tax_rate; if (id == null && g != null) { setD((x) => (x.name || x.price ? x : { ...x, gst: String(g) })); } }, [settings.data, id]);
  const set = (patch: Partial<ServiceDraft>) => { setD((x) => ({ ...x, ...patch })); setProblem(''); };
  const bad = serviceProblem(d);
  const body = id == null ? serviceBody(d) : start ? changedBody(start, d) : {};
  const removed = m?.status === 'ARCHIVED';

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setProblem('');
    try { await work(); goBack(); } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not save'); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (bad) return setProblem(bad);
    if (id != null && Object.keys(body).length === 0) return goBack();
    void run(() => (id == null ? api.post('/salon/services', body, { idempotencyKey: key }) : api.call(`/salon/services/${id}`, { method: 'PUT', body })));
  };
  const remove = () => Alert.alert('Remove this service?', `${d.name} is taken off the till and the booking list. Its past bills stay.`, [
    { text: 'Keep it', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void run(() => api.post(`/salon/services/${id}/archive`, {})); } }
  ]);

  const field = (label: string, k: keyof ServiceDraft, extra: { placeholder?: string; keyboard?: 'decimal-pad' | 'number-pad'; caps?: 'none' | 'words'; lines?: number } = {}) => (
    <View style={{ gap: 4 }}>
      <Soft>{label}</Soft>
      <TextInput style={[s.input, extra.lines ? { minHeight: 48 * extra.lines } : null]} value={String(d[k])} onChangeText={(v) => set({ [k]: v } as Partial<ServiceDraft>)} placeholder={extra.placeholder} keyboardType={extra.keyboard}
        autoCapitalize={extra.caps ?? 'sentences'} multiline={Boolean(extra.lines)} accessibilityLabel={label} />
    </View>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{id == null ? 'New service' : d.name || 'Service'}</Title>{removed ? <Soft>Removed from the till</Soft> : null}</View>
          <Button title="Cancel" kind="quiet" onPress={() => goBack()} />
        </View>
        {id != null && loaded.busy && !m ? <Loading /> : null}
        {id != null && loaded.error && !m ? <Failed message={loaded.error} onRetry={() => { void loaded.refresh(); }} /> : null}
        {id == null || m ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
            {field('Name', 'name', { placeholder: 'For example Haircut', caps: 'words' })}
            {field('Price', 'price', { keyboard: 'decimal-pad' })}
            <Soft>How long it takes</Soft>
            <Chips items={MINUTES.map((x) => ({ id: x, label: durationText(Number(x)) }))} value={MINUTES.includes(d.minutes) ? d.minutes : ''} onChange={(x) => set({ minutes: x })} />
            {field('Or type the minutes', 'minutes', { keyboard: 'number-pad', caps: 'none' })}
            <Soft>GST rate</Soft>
            <Chips items={GST.map((g) => ({ id: g, label: `${g}%` }))} value={d.gst} onChange={(g) => set({ gst: g })} />
            <Soft>Who it is for</Soft>
            <Chips items={WHO} value={d.gender} onChange={(g) => set({ gender: g })} />
            {cats.data && cats.data.length ? (
              <>
                <Soft>Category</Soft>
                <Chips items={[{ id: '0', label: 'None' }, ...cats.data.map((c) => ({ id: String(c.category_id), label: c.name }))]} value={d.category_id} onChange={(c) => set({ category_id: c })} />
              </>
            ) : null}
            {field('A note for the team (optional)', 'description', { lines: 2 })}
            <ErrorText>{problem}</ErrorText>
            <Button title={id == null ? 'Add the service' : 'Save the changes'} onPress={save} busy={busy} disabled={Boolean(bad)} />
            {id != null && !removed ? <Button title="Remove this service" kind="danger" onPress={remove} /> : null}
            {id != null && removed ? <Button title="Bring it back" kind="quiet" onPress={() => { void run(() => api.post(`/salon/services/${id}/restore`, {})); }} /> : null}
            {id != null ? <Text style={{ color: color.soft, fontSize: 12 }}>Which team member does it, and the products it uses, are set on the FlowXP website.</Text> : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
