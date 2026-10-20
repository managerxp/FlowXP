import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import {
  CONFIG_LABEL, KIND_LABEL, METHOD_LABEL, SEGMENT_CHOICES, WEEKDAYS, audienceText, automationBody, automationDirty, automationProblem, bookingLink, campaignProblem, canSalonSetup, cleanSlug, hoursBody, hoursForm, hoursProblem, loyaltyBody, loyaltyForm, loyaltyProblem, onlineBody, onlineForm, onlineProblem,
  outletLine, outletOffBody, outletOnBody, ownHours, profileBody, profileForm, profileProblem, programText, segmentBody, segmentForm, segmentProblem, summaryNote, taxBody, taxForm, taxProblem, toggleDay, toggleMethod,
  type Automation, type Automations, type HoursForm, type LoyaltyData, type LoyaltyForm, type LoyaltySummary, type OnlineForm, type ProfileForm, type SalonBranch, type SegmentForm, type SettingsData, type TaxForm
} from '../lib/salonSetup.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>{children}{hint ? <Soft>{t(hint)}</Soft> : null}</View>
);
const Input = ({ label, value, onChange, hint, numeric, max, placeholder, multiline, upper }: { label: string; value: string; onChange: (v: string) => void; hint?: string; numeric?: boolean; max?: number; placeholder?: string; multiline?: boolean; upper?: boolean }) => (
  <Field label={label} hint={hint}>
    <TextInput style={[s.input, multiline ? { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 } : null]} multiline={multiline} value={value} onChangeText={(v) => onChange(numeric ? v.replace(/[^\d.]/g, '') : upper ? v.toUpperCase() : v)} keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={max} placeholder={placeholder} autoCapitalize={upper ? 'characters' : 'none'} autoCorrect={false} accessibilityLabel={t(label)} />
  </Field>
);
const Row = ({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(label)}</Text>{hint ? <Soft>{t(hint)}</Soft> : null}</View><Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} /></View>
);
const Days = ({ label, value, onChange }: { label: string; value: number[]; onChange: (v: number[]) => void }) => (
  <Field label={label}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {WEEKDAYS.map(([d, name]) => {
        const on = value.includes(d);
        return <Pressable key={d} onPress={() => onChange(toggleDay(value, d))} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ minHeight: 44, minWidth: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: on ? color.brand : color.card, borderWidth: 1, borderColor: on ? color.brand : color.line }}><Text style={{ color: on ? '#fff' : color.ink, fontWeight: '600' }}>{t(name)}</Text></Pressable>;
      })}
    </View>
  </Field>
);
const Panel = ({ children }: { children: React.ReactNode }) => <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
const Saved = ({ note, error }: { note: string; error: string }) => <><ErrorText>{error}</ErrorText>{note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}</>;

/** Run a save: report the result, never throw. */
const useSave = () => {
  const [error, setError] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (problem: string, job: () => Promise<unknown>, done = 'Saved') => {
    if (problem) { setError(t(problem)); setNote(''); return false; }
    setBusy(true); setError(''); setNote('');
    try { await job(); setNote(t(done)); return true; } catch (e) { setError(why(e)); return false; } finally { setBusy(false); }
  };
  return { error, note, busy, run, setNote, setError };
};
const put = (body: object) => api.call('/salon/settings', { method: 'PUT', body });

/* ── profile ─────────────────────────────────────────────────────────────── */
const Profile = ({ d, reload }: { d: SettingsData; reload: () => void }) => {
  const [f, setF] = useState<ProfileForm>(profileForm(d.settings));
  const [outlets, setOutlets] = useState<SalonBranch[]>(d.branches);
  const sv = useSave(); const ov = useSave();
  const saveOutlet = async (b: SalonBranch, patch: Partial<SalonBranch>) => { if (await ov.run('', () => api.call(`/salon/branches/${b.branch_id}/settings`, { method: 'PUT', body: patch }))) setOutlets((l) => l.map((x) => (x.branch_id === b.branch_id ? { ...x, ...patch } : x))); };
  return (
    <Panel>
      <SectionTitle>Business profile</SectionTitle>
      <Soft>{t('These print on your tax invoices.')}</Soft>
      <Soft>{t('The business name, address, GSTIN, logo and invoice numbering are in Business settings.')}</Soft>
      <Input label="PAN" hint="Like ABCDE1234F" value={f.pan} onChange={(v) => setF((x) => ({ ...x, pan: v }))} max={10} upper />
      <Input label="Registration type" hint="e.g. Shops & Establishments" value={f.registration_type} onChange={(v) => setF((x) => ({ ...x, registration_type: v }))} max={60} />
      <Input label="Registration number" value={f.registration_no} onChange={(v) => setF((x) => ({ ...x, registration_no: v }))} max={40} />
      <Saved note={sv.note} error={sv.error} />
      <Button title="Save changes" onPress={() => { void sv.run(profileProblem(f), async () => { await put(profileBody(f)); reload(); }); }} busy={sv.busy} />
      {outlets.length > 1 ? (
        <>
          <SectionTitle>Outlets</SectionTitle>
          <Soft>{t('Mark outlets you run yourself or that a franchisee runs. Add outlets under Outlets.')}</Soft>
          {outlets.map((b) => (
            <View key={b.branch_id} style={[s.card, { gap: 8 }]}>
              <Text style={{ fontWeight: '700', color: color.ink }}>{b.name}{b.is_primary ? ` · ${t('Main')}` : ''}</Text>
              <Soft>{outletLine(b)}</Soft>
              <Chips items={[{ id: 'OWNED', label: 'Owned' }, { id: 'FRANCHISE', label: 'Franchise' }]} value={b.ownership} onChange={(v: 'OWNED' | 'FRANCHISE') => { void saveOutlet(b, { ownership: v }); }} />
              {b.ownership === 'FRANCHISE' ? <TextInput style={s.input} defaultValue={b.franchisee_name ?? ''} placeholder={t('Franchisee name')} onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v !== (b.franchisee_name ?? '')) void saveOutlet(b, { franchisee_name: v || null }); }} accessibilityLabel={t('Franchisee name')} /> : null}
            </View>
          ))}
          <Saved note={ov.note} error={ov.error} />
        </>
      ) : null}
    </Panel>
  );
};

/* ── hours and booking ───────────────────────────────────────────────────── */
const Hours = ({ d, reload }: { d: SettingsData; reload: () => void }) => {
  const [f, setF] = useState<HoursForm>(hoursForm(d.settings));
  const [o, setO] = useState<OnlineForm>(onlineForm(d.settings));
  const [outlets, setOutlets] = useState<SalonBranch[]>(d.branches);
  const sv = useSave(); const ob = useSave(); const ov = useSave();
  const set = <K extends keyof HoursForm>(k: K, v: HoursForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const saveOutlet = async (b: SalonBranch, patch: Partial<SalonBranch>, done = 'Outlet hours saved') => { if (await ov.run('', () => api.call(`/salon/branches/${b.branch_id}/settings`, { method: 'PUT', body: patch }), done)) setOutlets((l) => l.map((x) => (x.branch_id === b.branch_id ? { ...x, ...patch } : x))); };
  const link = bookingLink(API_URL, o.slug);
  return (
    <Panel>
      <SectionTitle>Opening hours</SectionTitle>
      <Soft>{t('The default for every outlet. Each person can have their own hours under Team.')}</Soft>
      <Days label="Open on" value={f.working_days} onChange={(v) => set('working_days', v)} />
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="Opens" value={f.open_time} onChange={(v) => set('open_time', v)} max={5} placeholder="10:00" /></View><View style={{ flex: 1 }}><Input label="Closes" value={f.close_time} onChange={(v) => set('close_time', v)} max={5} placeholder="20:00" /></View></View>
      <Field label="Booking slots every"><Chips items={d.choices.slot_minutes.map((m) => ({ id: String(m), label: t('{n} minutes', { n: m }) }))} value={f.slot_minutes} onChange={(v) => set('slot_minutes', v)} /></Field>
      <SectionTitle>Booking rules</SectionTitle>
      <Input label="Shortest notice (minutes)" hint="0 lets clients book right now" numeric value={f.min_advance_minutes} onChange={(v) => set('min_advance_minutes', v)} max={5} />
      <Input label="Book up to (days ahead)" numeric value={f.max_advance_days} onChange={(v) => set('max_advance_days', v)} max={4} />
      <Input label="Gap between clients (minutes)" hint="Kept free after every booking" numeric value={f.buffer_minutes} onChange={(v) => set('buffer_minutes', v)} max={4} />
      <SectionTitle>Cancellations and no-shows</SectionTitle>
      <Soft>{t('Shown to the team when it happens. Nothing is charged automatically.')}</Soft>
      <Input label="Free cancellation until (hours before)" numeric value={f.cancel_hours} onChange={(v) => set('cancel_hours', v)} max={4} />
      <Input label="Late cancellation fee (%)" numeric value={f.cancel_fee} onChange={(v) => set('cancel_fee', v)} max={5} />
      <Input label="Cancellation policy wording" multiline value={f.cancel_text} onChange={(v) => set('cancel_text', v)} max={300} />
      <Input label="No-show fee (%)" numeric value={f.noshow_fee} onChange={(v) => set('noshow_fee', v)} max={5} />
      <Input label="No-show policy wording" multiline value={f.noshow_text} onChange={(v) => set('noshow_text', v)} max={300} />
      <Saved note={sv.note} error={sv.error} />
      <Button title="Save changes" onPress={() => { void sv.run(hoursProblem(f), async () => { await put(hoursBody(f)); reload(); }); }} busy={sv.busy} />

      {outlets.length > 1 ? (
        <>
          <SectionTitle>Different hours at an outlet</SectionTitle>
          <Soft>{t('Leave an outlet as it is to use the default hours above.')}</Soft>
          {outlets.map((b) => (
            <View key={b.branch_id} style={[s.card, { gap: 8 }]}>
              <Row label={b.name} value={ownHours(b)} onChange={(on) => { void saveOutlet(b, on ? (outletOnBody(f) as Partial<SalonBranch>) : (outletOffBody() as Partial<SalonBranch>)); }} />
              {ownHours(b) ? (
                <>
                  <Soft>{t('Its own hours')}</Soft>
                  <Days label="Open on" value={b.working_days ?? f.working_days} onChange={(v) => { void saveOutlet(b, { working_days: v }); }} />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><Input label="Opens" value={b.open_time ?? f.open_time} onChange={(v) => setOutlets((l) => l.map((x) => (x.branch_id === b.branch_id ? { ...x, open_time: v } : x)))} max={5} /></View>
                    <View style={{ flex: 1 }}><Input label="Closes" value={b.close_time ?? f.close_time} onChange={(v) => setOutlets((l) => l.map((x) => (x.branch_id === b.branch_id ? { ...x, close_time: v } : x)))} max={5} /></View>
                  </View>
                  <Button title="Save changes" kind="quiet" onPress={() => { void saveOutlet(b, { open_time: b.open_time ?? f.open_time, close_time: b.close_time ?? f.close_time }); }} />
                </>
              ) : null}
            </View>
          ))}
          <Saved note={ov.note} error={ov.error} />
        </>
      ) : null}

      <SectionTitle>Online booking</SectionTitle>
      <Soft>{t('A page clients can use to book themselves, without calling. It follows your opening hours, team hours, leave and booking rules.')}</Soft>
      <Row label="Let clients book online" hint="Needs the Appointments feature on your plan." value={o.enabled} onChange={(v) => setO((x) => ({ ...x, enabled: v }))} />
      <Input label="Your booking address" hint="Letters, numbers and dashes. This becomes part of the link." value={o.slug} onChange={(v) => setO((x) => ({ ...x, slug: cleanSlug(v) }))} max={40} placeholder="glow-salon" />
      <Input label="Message at the top of the page" hint="Optional — parking, what to bring, a festive notice." value={o.notice} onChange={(v) => setO((x) => ({ ...x, notice: v }))} max={300} />
      {d.settings.online_booking_enabled && link ? <><Soft>{link}</Soft><Button title="Share link" kind="quiet" onPress={() => { void Share.share({ message: link }); }} /></> : null}
      <Soft>{t('Online bookings arrive as Booked appointments marked Online. One mobile number can hold up to three upcoming online bookings.')}</Soft>
      <Saved note={ob.note} error={ob.error} />
      <Button title="Save changes" onPress={() => { void ob.run(onlineProblem(o), async () => { await put(onlineBody(o)); reload(); }, o.enabled ? 'Online booking is on' : 'Saved'); }} busy={ob.busy} />
    </Panel>
  );
};

/* ── tax and payments ────────────────────────────────────────────────────── */
const Tax = ({ d, reload }: { d: SettingsData; reload: () => void }) => {
  const [f, setF] = useState<TaxForm>(taxForm(d.settings));
  const sv = useSave();
  const set = <K extends keyof TaxForm>(k: K, v: TaxForm[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Panel>
      <SectionTitle>GST</SectionTitle>
      <Soft>{t('Whether GST applies at all is set in Business settings. Rates can be different on each service and product.')}</Soft>
      <Field label="Prices are" hint={f.tax_inclusive ? 'The price you type is what the client pays; GST is worked out from inside it.' : 'GST is added on top of the price you type.'}>
        <Chips items={[{ id: 'ex', label: 'Before GST — tax added on top' }, { id: 'in', label: 'Including GST — tax is inside the price' }]} value={f.tax_inclusive ? 'in' : 'ex'} onChange={(v) => set('tax_inclusive', v === 'in')} />
      </Field>
      <Input label="New services start at (%)" numeric value={f.default_service_tax_rate} onChange={(v) => set('default_service_tax_rate', v)} max={5} />
      <Input label="New products start at (%)" numeric value={f.default_product_tax_rate} onChange={(v) => set('default_product_tax_rate', v)} max={5} />
      <Input label="Default SAC code" value={f.default_service_sac} onChange={(v) => set('default_service_sac', v)} max={10} />
      <SectionTitle>Payment methods at the till</SectionTitle>
      <Soft>{t('Gift cards and pay-later follow what you sell and who the client is.')}</Soft>
      {d.choices.payment_methods.map((m) => <Row key={m} label={METHOD_LABEL[m] ?? m} value={f.payment_methods.includes(m)} onChange={() => set('payment_methods', toggleMethod(f.payment_methods, m))} />)}
      <SectionTitle>Commission rules</SectionTitle>
      <Field label="Commission is worked out on" hint="Either way, GST is never part of it."><Chips items={[{ id: 'NET', label: 'What the client paid (after discounts)' }, { id: 'GROSS', label: 'The price before discounts' }]} value={f.commission_base} onChange={(v: 'NET' | 'GROSS') => set('commission_base', v)} /></Field>
      <Row label="Pay commission when a service is used from a package or membership" hint="Worked out on the service’s list price, since nothing is charged at the time." value={f.commission_on_package_use} onChange={(v) => set('commission_on_package_use', v)} />
      <Saved note={sv.note} error={sv.error} />
      <Button title="Save changes" onPress={() => { void sv.run(taxProblem(f), async () => { await put(taxBody(f)); reload(); }); }} busy={sv.busy} />
    </Panel>
  );
};

/* ── loyalty ─────────────────────────────────────────────────────────────── */
const Loyalty = () => {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [sum, setSum] = useState<LoyaltySummary | null>(null);
  const [f, setF] = useState<LoyaltyForm | null>(null);
  const [error, setError] = useState('');
  const sv = useSave();
  const load = useCallback(() => {
    api.get<LoyaltyData>('/salon/loyalty').then((d) => { setData(d); setF(loyaltyForm(d)); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.')));
    api.get<LoyaltySummary>('/salon/loyalty/summary?days=30').then(setSum).catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (error && !data) return <Failed message={error} onRetry={load} />;
  if (!data || !f) return <Loading />;
  const setRule = (k: string, patch: Partial<LoyaltyForm['rules'][string]>) => setF((x) => (x ? { ...x, rules: { ...x.rules, [k]: { ...x.rules[k], ...patch } } } : x));
  const expireNow = () => Alert.alert(t('Expire old points now?'), t('Points older than the expiry period are taken off clients’ balances. Running it twice changes nothing more.'), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Expire points'), style: 'destructive', onPress: () => { void api.post<{ points?: number; expired?: number }>('/salon/loyalty/expire', {}).then((r) => { sv.setNote(t('{n} points expired', { n: r.points ?? r.expired ?? 0 })); load(); }).catch((e) => sv.setError(why(e))); } }
  ]);
  return (
    <Panel>
      <SectionTitle>The programme</SectionTitle>
      <Soft>{t('Points per ₹100, what a point is worth, and the most a bill can be paid with points.')}</Soft>
      <Text style={{ color: color.ink }}>{programText(data)}</Text>
      <Button title="Loyalty & coupons" kind="quiet" onPress={() => router.push('/loyalty')} />
      <Soft>{t('Set the programme and tiers on the Loyalty screen.')}</Soft>
      <SectionTitle>Earning rates by kind of sale</SectionTitle>
      <Soft>{t('Leave the rate empty to use the programme’s rate. Turn a kind off and it earns nothing. Gift cards never earn.')}</Soft>
      {Object.keys(f.rules).filter((k) => k !== 'GIFT_CARD').map((k) => (
        <View key={k} style={[s.card, { gap: 6 }]}>
          <Text style={{ fontWeight: '700', color: color.ink }}>{t(KIND_LABEL[k] ?? k)}</Text>
          <Input label="Points per ₹100" numeric value={f.rules[k].earn_per_100} onChange={(v) => setRule(k, { earn_per_100: v })} max={6} />
          <Row label="Earns points" value={f.rules[k].is_enabled} onChange={(v) => setRule(k, { is_enabled: v })} />
        </View>
      ))}
      <SectionTitle>Expiry</SectionTitle>
      <Soft>{t('How long points last. Empty means they never expire.')}</Soft>
      <Input label="Points expire after (days)" numeric value={f.expiry_days} onChange={(v) => setF((x) => (x ? { ...x, expiry_days: v } : x))} max={5} />
      {data.expiry_days ? <Button title="Expire old points now" kind="quiet" onPress={expireNow} /> : null}
      <Soft>{t('Points expire on their own once a day. Clients are warned first if the Loyalty points expiry message is on under Messages.')}</Soft>
      <Saved note={sv.note} error={sv.error} />
      <Button title="Save loyalty rules" onPress={() => { void sv.run(loyaltyProblem(f), async () => { await api.call('/salon/loyalty', { method: 'PUT', body: loyaltyBody(f) }); load(); }, 'Loyalty rules saved'); }} busy={sv.busy} />
      {sum ? (
        <>
          <SectionTitle>Last 30 days</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Stat label="Issued" value={String(sum.issued)} /><Stat label="Used" value={String(sum.redeemed)} /><Stat label="Expired" value={String(sum.expired)} /><Stat label="Owed to clients" value={String(sum.outstanding_points)} note={summaryNote(sum)} />
          </View>
        </>
      ) : null}
    </Panel>
  );
};

/* ── clients and stock ───────────────────────────────────────────────────── */
const Segments = ({ d, reload }: { d: SettingsData; reload: () => void }) => {
  const [f, setF] = useState<SegmentForm>(segmentForm(d.settings));
  const sv = useSave();
  const set = <K extends keyof SegmentForm>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Panel>
      <SectionTitle>What the client segments mean</SectionTitle>
      <Soft>{t('Used by the client list, reminders and campaigns.')}</Soft>
      <Input label="New client for (days)" hint="After their first visit" numeric value={f.new_days} onChange={(v) => set('new_days', v)} max={4} />
      <Input label="VIP: spent at least (₹)" numeric value={f.vip_spend} onChange={(v) => set('vip_spend', v)} max={8} />
      <Input label="VIP: visits at least" numeric value={f.vip_visits} onChange={(v) => set('vip_visits', v)} max={4} />
      <Input label="High spender: average bill at least (₹)" numeric value={f.high_spender} onChange={(v) => set('high_spender', v)} max={8} />
      <Input label="Frequent: visits in 90 days" numeric value={f.frequent_visits_90d} onChange={(v) => set('frequent_visits_90d', v)} max={3} />
      <Input label="Inactive after (days, up to three)" hint="e.g. 30, 60, 90" value={f.inactive_days} onChange={(v) => set('inactive_days', v.replace(/[^\d, ]/g, ''))} max={20} />
      <SectionTitle>Stock alerts</SectionTitle>
      <Input label="Warn about expiry (days before)" numeric value={f.expiry_alert_days} onChange={(v) => set('expiry_alert_days', v)} max={4} />
      <Input label="Flag unusual use at (× the usual)" hint="Compares this week with the previous four" numeric value={f.consumption_alert_factor} onChange={(v) => set('consumption_alert_factor', v)} max={5} />
      <Saved note={sv.note} error={sv.error} />
      <Button title="Save changes" onPress={() => { void sv.run(segmentProblem(f), async () => { await put(segmentBody(f)); reload(); }); }} busy={sv.busy} />
    </Panel>
  );
};

/* ── messages ────────────────────────────────────────────────────────────── */
const AutomationRow = ({ a, onSaved }: { a: Automation; onSaved: () => void }) => {
  const [on, setOn] = useState(a.is_enabled);
  const [config, setConfig] = useState(a.config);
  const sv = useSave();
  const dirty = automationDirty(a, on, config);
  return (
    <View style={[s.card, { gap: 8 }]}>
      <Row label={a.label} hint={a.description} value={on} onChange={setOn} />
      {a.internal ? <Soft>{t('Team only')}</Soft> : null}
      {on ? Object.keys(a.defaults).map((k) => (
        <Input key={k} label={CONFIG_LABEL[k] ?? k} numeric={k !== 'offer_text'} multiline={k === 'offer_text'} value={String(config[k] ?? '')} onChange={(v) => setConfig((c) => ({ ...c, [k]: v }))} max={k === 'offer_text' ? 200 : 4} />
      )) : null}
      <Saved note={sv.note} error={sv.error} />
      {dirty ? <Button title="Save" kind="quiet" onPress={() => { void sv.run(on ? automationProblem(config) : '', async () => { await api.call(`/salon/automations/${a.key}`, { method: 'PUT', body: automationBody(on, config) }); onSaved(); }); }} busy={sv.busy} /> : null}
    </View>
  );
};

const Messages = () => {
  const [data, setData] = useState<Automations | null>(null);
  const [error, setError] = useState('');
  const [segment, setSegment] = useState('INACTIVE_60');
  const [offer, setOffer] = useState('');
  const [audience, setAudience] = useState<{ count: number; sample: string[] } | null>(null);
  const sv = useSave(); const cp = useSave();
  const load = useCallback(() => { api.get<Automations>('/salon/automations').then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, []);
  useEffect(load, [load]);
  useEffect(() => {
    let live = true; setAudience(null);
    api.get<{ count: number; sample: string[] }>(`/salon/campaigns/audience?segment=${segment}`).then((a) => live && setAudience(a)).catch(() => live && setAudience({ count: 0, sample: [] }));
    return () => { live = false; };
  }, [segment]);
  if (error && !data) return <Failed message={error} onRetry={load} />;
  if (!data) return <Loading />;
  const send = () => {
    const bad = campaignProblem(offer, audience?.count);
    if (bad) { cp.setError(t(bad)); return; }
    Alert.alert(t('Send to {n} people?', { n: audience?.count ?? 0 }), t('This goes out now and cannot be recalled.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Send campaign'), onPress: () => { void cp.run('', async () => { const r = await api.post<{ recipients: number }>('/salon/campaigns', { segment, offer: offer.trim() }); cp.setNote(t('Sent to {n} people', { n: r.recipients })); setOffer(''); }, 'Saved'); } }
    ]);
  };
  return (
    <Panel>
      {!data.channel_on ? <Soft>{t('Messages are switched off, so nothing will be sent yet. Choose a channel under Messaging: WhatsApp, SMS or both, through the provider you use.')}</Soft> : null}
      <SectionTitle>Automatic messages</SectionTitle>
      <Soft>{t('They go out by themselves, only to clients who have a mobile number and have not opted out.')}</Soft>
      <Button title="Check now" kind="quiet" onPress={() => { void sv.run('', () => api.post('/salon/automations/run', {}), 'Checked — anything due has been sent'); }} busy={sv.busy} />
      <Saved note={sv.note} error={sv.error} />
      {data.automations.map((a) => <AutomationRow key={`${a.key}-${a.is_enabled}`} a={{ ...a, label: t(a.label), description: t(a.description), config: Object.fromEntries(Object.entries(a.config).map(([k, v]) => [k, k === 'offer_text' ? t(String(v)) : v])) }} onSaved={load} />)}
      <SectionTitle>Send a campaign</SectionTitle>
      <Soft>{t('One message to a group of clients. One campaign an hour.')}</Soft>
      <Field label="Who"><Chips items={SEGMENT_CHOICES.map(([v, l]) => ({ id: v, label: l }))} value={segment} onChange={setSegment} /></Field>
      <Text style={{ color: color.ink }}>{audienceText(audience)}</Text>
      <Input label="Message" hint="Your salon’s name is added. 5–300 characters." multiline value={offer} onChange={setOffer} max={300} placeholder={t('Come in this week and enjoy 15% off any service.')} />
      <Saved note={cp.note} error={cp.error} />
      <Button title="Send campaign" onPress={send} busy={cp.busy} disabled={!audience?.count || offer.trim().length < 5} />
    </Panel>
  );
};

/* Salon settings (owner and admin): how the salon works, in six tabs. */
export default function SalonSettingsScreen() {
  const me = currentBusiness(useSession());
  const ok = canSalonSetup(me?.role);
  const [d, setD] = useState<SettingsData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'profile' | 'hours' | 'tax' | 'loyalty' | 'clients' | 'messages'>('profile');
  const load = useCallback(() => { api.get<SettingsData>('/salon/settings').then((x) => { setD(x); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, []);
  useEffect(() => { if (ok) load(); }, [load, ok]);
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Salon settings</Title><Soft>How your salon works. Every rule here is yours to change.</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>Only owners and admins can change salon settings.</Empty> : error && !d ? <Failed message={error} onRetry={load} /> : !d ? <Loading /> : (
          <>
            <Chips items={[{ id: 'profile', label: 'Profile' }, { id: 'hours', label: 'Hours & booking' }, { id: 'tax', label: 'Tax & payments' }, { id: 'loyalty', label: 'Loyalty' }, { id: 'clients', label: 'Clients & stock' }, { id: 'messages', label: 'Messages' }]} value={tab} onChange={setTab} />
            {tab === 'profile' ? <Profile key="p" d={d} reload={load} /> : tab === 'hours' ? <Hours key="h" d={d} reload={load} /> : tab === 'tax' ? <Tax key="t" d={d} reload={load} /> : tab === 'loyalty' ? <Loyalty /> : tab === 'clients' ? <Segments key="c" d={d} reload={load} /> : <Messages />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
