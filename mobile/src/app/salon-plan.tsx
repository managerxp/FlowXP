import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import {
  APPLIES, DAYS, GST, blankPackage, blankPlan, packageBody, packageChanged, packageFrom, packageProblem, planBody, planChanged, planFrom, planProblem, savingText, valueOf,
  type Package, type PackageDraft, type Plan, type PlanDraft, type ServiceRef
} from '../lib/salonPlans.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
type Row = { service_id: number; qty: string };

/* The services in a plan: tap one to add it, set how many, remove it. */
const ServicesEditor = ({ rows, services, onChange, label }: { rows: Row[]; services: ServiceRef[]; onChange: (r: Row[]) => void; label: string }) => {
  const [q, setQ] = useState('');
  const found = q.trim().length < 1 ? [] : services.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()) && !rows.some((r) => r.service_id === x.service_id)).slice(0, 6);
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r) => (
        <View key={r.service_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <Text style={{ flex: 1, color: color.ink, fontSize: 16 }}>{services.find((x) => x.service_id === r.service_id)?.name ?? `Service ${r.service_id}`}</Text>
          <TextInput style={[s.input, { width: 72, textAlign: 'center' }]} value={r.qty} onChangeText={(v) => onChange(rows.map((x) => (x.service_id === r.service_id ? { ...x, qty: v } : x)))} keyboardType="number-pad" accessibilityLabel={`How many ${services.find((x) => x.service_id === r.service_id)?.name ?? 'visits'}`} />
          <Button title="Remove" kind="quiet" onPress={() => onChange(rows.filter((x) => x.service_id !== r.service_id))} />
        </View>
      ))}
      <TextInput style={s.input} value={q} onChangeText={setQ} placeholder={label} accessibilityLabel={label} autoCorrect={false} />
      {found.map((x) => <Line key={x.service_id} left={x.name} right={money(x.price)} onPress={() => { onChange([...rows, { service_id: x.service_id, qty: '1' }]); setQ(''); }} />)}
    </View>
  );
};

/* One screen for a membership or a package, new or existing: /salon-plan?kind=membership|package&id=. Clients who already hold one keep the terms they bought. */
export default function SalonPlan() {
  const { kind, id } = useLocalSearchParams<{ kind: 'membership' | 'package'; id?: string }>();
  const isPlan = kind !== 'package';
  const plans = useLoad<Plan[]>('salon-plans-form', () => api.get<Plan[]>('/salon/membership-plans'), Boolean(id) && isPlan);
  const packs = useLoad<Package[]>('salon-packages-form', () => api.get<Package[]>('/salon/packages'), Boolean(id) && !isPlan);
  const services = useLoad<ServiceRef[]>('salon-service-refs', () => api.get<{ service_id: number; name: string; price: number }[]>('/salon/services?status=ACTIVE&limit=200'));
  const settings = useLoad<{ default_service_tax_rate?: number }>('salon-settings-gst2', () => api.get('/salon/settings'), !id);
  const existing = id ? (isPlan ? plans.data?.find((p) => String(p.plan_id) === id) : packs.data?.find((p) => String(p.package_id) === id)) : undefined;
  const [pd, setPd] = useState<PlanDraft>(blankPlan());
  const [kd, setKd] = useState<PackageDraft>(blankPackage());
  const [startP, setStartP] = useState<PlanDraft | null>(null);
  const [startK, setStartK] = useState<PackageDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [key] = useState(newKey());   // one key: a double tap on Save makes one

  useEffect(() => {
    if (!existing) return;
    if (isPlan && !startP) { const f = planFrom(existing as Plan); setPd(f); setStartP(f); }
    if (!isPlan && !startK) { const f = packageFrom(existing as Package); setKd(f); setStartK(f); }
  }, [existing, isPlan, startP, startK]);
  useEffect(() => { const g = settings.data?.default_service_tax_rate; if (!id && g != null) { setPd((x) => (x.name || x.price ? x : { ...x, gst: String(g) })); setKd((x) => (x.name || x.price ? x : { ...x, gst: String(g) })); } }, [settings.data, id]);

  const refs = services.data ?? [];
  const bad = isPlan ? planProblem(pd) : packageProblem(kd);
  const body = isPlan ? (id ? (startP ? planChanged(startP, pd) : {}) : planBody(pd)) : (id ? (startK ? packageChanged(startK, kd) : {}) : packageBody(kd));
  const noun = isPlan ? 'membership' : 'package';
  const path = isPlan ? '/salon/membership-plans' : '/salon/packages';

  const save = async () => {
    if (bad) return setProblem(bad);
    if (id && Object.keys(body).length === 0) return goBack();
    setBusy(true); setProblem('');
    try {
      if (id) await api.call(`${path}/${id}`, { method: 'PUT', body }); else await api.post(path, body, { idempotencyKey: key });
      goBack();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not save'); }
    finally { setBusy(false); }
  };

  const setP = (patch: Partial<PlanDraft>) => { setPd((x) => ({ ...x, ...patch })); setProblem(''); };
  const setK = (patch: Partial<PackageDraft>) => { setKd((x) => ({ ...x, ...patch })); setProblem(''); };
  const text = (label: string, value: string, on: (v: string) => void, extra: { placeholder?: string; keyboard?: 'decimal-pad' | 'number-pad'; caps?: 'none' | 'words' } = {}) => (
    <View style={{ gap: 4 }}><Soft>{label}</Soft><TextInput style={s.input} value={value} onChangeText={on} placeholder={extra.placeholder} keyboardType={extra.keyboard} autoCapitalize={extra.caps ?? 'sentences'} accessibilityLabel={label} /></View>
  );
  const toggle = (label: string, value: boolean, on: (v: boolean) => void) => (
    <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ flex: 1, color: color.ink, fontSize: 16 }}>{label}</Text><Switch value={value} onValueChange={on} accessibilityLabel={label} />
    </View>
  );

  const name = isPlan ? pd.name : kd.name;
  const loading = Boolean(id) && !existing;
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{id ? name || (isPlan ? 'Membership' : 'Package') : isPlan ? 'New membership' : 'New package'}</Title></View>
          <Button title="Cancel" kind="quiet" onPress={() => goBack()} />
        </View>
        {loading && (isPlan ? plans : packs).busy ? <Loading /> : null}
        {loading && (isPlan ? plans : packs).error ? <Failed message={(isPlan ? plans : packs).error} onRetry={() => { void (isPlan ? plans : packs).refresh(); }} /> : null}
        {!loading ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
            {isPlan ? (
              <>
                {text('Name', pd.name, (v) => setP({ name: v }), { placeholder: 'For example Gold', caps: 'words' })}
                {text('Price', pd.price, (v) => setP({ price: v }), { keyboard: 'decimal-pad' })}
                <Soft>How long it lasts</Soft>
                <Chips items={DAYS} value={DAYS.some((d) => d.id === pd.days) ? pd.days : ''} onChange={(d) => setP({ days: d })} />
                {text('Or type the days', pd.days, (v) => setP({ days: v }), { keyboard: 'number-pad', caps: 'none' })}
                <Soft>GST rate</Soft>
                <Chips items={GST.map((g) => ({ id: g, label: `${g}%` }))} value={pd.gst} onChange={(g) => setP({ gst: g })} />
                <SectionTitle>What members get</SectionTitle>
                {text('Discount (percent)', pd.discount, (v) => setP({ discount: v }), { keyboard: 'decimal-pad', placeholder: 'For example 10' })}
                <Soft>The discount applies to</Soft>
                <Chips items={APPLIES} value={pd.applies} onChange={(a) => setP({ applies: a })} />
                <Soft>Free services</Soft>
                <ServicesEditor rows={pd.free} services={refs} onChange={(free) => setP({ free: free.map((f) => ({ service_id: f.service_id, qty: f.qty })) })} label="Search for a service to give free" />
                {toggle('Priority booking', pd.priority, (v) => setP({ priority: v }))}
                {toggle('On sale', pd.active, (v) => setP({ active: v }))}
                {id ? <Soft>People who already have this membership keep the terms they bought. A change applies to new members.</Soft> : null}
              </>
            ) : (
              <>
                {text('Name', kd.name, (v) => setK({ name: v }), { placeholder: 'For example Bridal', caps: 'words' })}
                {text('Price', kd.price, (v) => setK({ price: v }), { keyboard: 'decimal-pad' })}
                <Soft>How long it lasts</Soft>
                <Chips items={DAYS} value={DAYS.some((d) => d.id === kd.days) ? kd.days : ''} onChange={(d) => setK({ days: d })} />
                {text('Or type the days', kd.days, (v) => setK({ days: v }), { keyboard: 'number-pad', caps: 'none' })}
                <Soft>GST rate</Soft>
                <Chips items={GST.map((g) => ({ id: g, label: `${g}%` }))} value={kd.gst} onChange={(g) => setK({ gst: g })} />
                <SectionTitle>What is in it</SectionTitle>
                <Soft>Each service, and how many visits</Soft>
                <ServicesEditor rows={kd.items} services={refs} onChange={(items) => setK({ items: items.map((f) => ({ service_id: f.service_id, qty: f.qty })) })} label="Search for a service to add" />
                <Soft>{savingText(kd.price, valueOf(kd.items, refs), money)}</Soft>
                {toggle('On sale', kd.active, (v) => setK({ active: v }))}
                {id ? <Soft>People who already bought this package keep what they bought. A change applies to new sales.</Soft> : null}
              </>
            )}
            <ErrorText>{problem}</ErrorText>
            <Button title={id ? 'Save the changes' : `Add the ${noun}`} onPress={() => { void save(); }} busy={busy} disabled={Boolean(bad)} />
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
