import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '../lib/icons.tsx';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, loadMe, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { hasFeature } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { FadeIn } from '../lib/motion.tsx';
import {
  ACCENTS, COPY_LABELS, KITCHEN_TOGGLE, TOKEN_TOGGLE, NUMBER_KINDS, TAX_INVOICE_TYPES, TERMS_TOGGLE, OPTION_ROWS, PROFILE_FIELDS, SHOW_OPTIONS, TOGGLES, gstOf, gstPatch, numberExample, numbersOf, numbersPatch, printOf, printPatch, profileOf, profilePatch, receiptOf, receiptPatch, stateFromGstin, stateSuggestions,
  type BusinessRecord, type Gst, type Profile, type Receipt
} from '../lib/bizSettings.ts';
import type { GstOptions } from '../lib/gst.ts';
import type { PrintSettings } from '../lib/taxInvoice.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, Soft, Title, color, s, Group, TextInput } from '../lib/ui.tsx';
import LogoSetting from '../lib/LogoSetting.tsx';
import { logoUrlOf } from '../lib/logo.ts';

const LABEL: Record<string, string> = { name: 'Business name', phone: 'Phone', email: 'Email', address: 'Address', city: 'City', state: 'State', postal_code: 'PIN code', gstin: 'GSTIN' };

const TextField = ({ label, value, onChange, big = false, max, keyboard, caps }: { label: string; value: string; onChange: (v: string) => void; big?: boolean; max?: number; keyboard?: 'default' | 'phone-pad' | 'email-address' | 'numeric'; caps?: boolean }) => (
  <View style={{ gap: 4 }}>
    <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
    <TextInput style={[s.input, big ? { minHeight: 72, textAlignVertical: 'top' } : null]} multiline={big} maxLength={max} value={value} onChangeText={onChange} keyboardType={keyboard} autoCapitalize={caps ? 'characters' : 'none'} autoCorrect={false} accessibilityLabel={t(label)} />
  </View>
);

const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
    <Text style={{ flex: 1, color: color.ink }}>{t(label)}</Text>
    <Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} />
  </View>
);

/* One part of the settings: its fields, and a Save that sends only what changed, then shows the server's own message if it refuses. */
const Card = ({ title, hint, children, save }: { title: string; hint?: string; children: React.ReactNode; save: () => Promise<string | null> }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const run = async () => {
    setBusy(true); setError(''); setDone('');
    try { const nothing = await save(); setDone(nothing ?? t('Saved')); }
    catch (e) { setError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={[s.card, { gap: 10 }]}>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{t(title)}</Text>
      {hint ? <Soft>{t(hint)}</Soft> : null}
      {children}
      <ErrorText>{error}</ErrorText>
      {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{done}</Text> : null}
      <Button title={t('Save')} onPress={() => { void run(); }} busy={busy} />
    </View>
  );
};

const patch = async (body: object) => { await api.call('/businesses/current', { method: 'PATCH', body }); };

const Details = ({ rec, reload }: { rec: BusinessRecord; reload: () => Promise<void> }) => {
  const before = profileOf(rec);
  const [p, setP] = useState<Profile>(before);
  const set = (k: keyof Profile) => (v: string) => setP((o) => ({ ...o, [k]: v, ...(k === 'gstin' && stateFromGstin(v) ? { state: stateFromGstin(v) as string } : {}) }));   // a GSTIN fixes the state
  const hints = stateSuggestions(p.state);
  return (
    <Card title="Business details" save={async () => { const d = profilePatch(before, p); if (!d) return t('Nothing changed.'); await patch(d); await reload(); void loadMe(); return null; }}>
      {PROFILE_FIELDS.map((k) => (
        <View key={k} style={{ gap: 4 }}>
          <TextField label={LABEL[k]} value={p[k]} onChange={set(k)} big={k === 'address'} caps={k === 'gstin'} keyboard={k === 'phone' ? 'phone-pad' : k === 'email' ? 'email-address' : k === 'postal_code' ? 'numeric' : 'default'} max={k === 'gstin' ? 15 : undefined} />
          <Group>{k === 'state' ? hints.map((h) => <Line key={h} left={h} onPress={() => set('state')(h)} />) : null}</Group>
          {k === 'gstin' ? <Soft>{t('Optional. Only needed if you charge GST.')}</Soft> : null}
        </View>
      ))}
    </Card>
  );
};

/** The receipt switches in groups, so the list reads by where a line prints. */
const RECEIPT_SECTIONS: [string, string[]][] = [
  ['Top of the bill', ['show_logo', 'show_phone', 'show_gstin']],
  ['Items and totals', ['show_total_qty', 'show_tax_lines', 'show_amount_words']],
  ['Payment and customer', ['show_upi_qr', 'show_loyalty']],
  ['Bottom of the bill', ['show_terms', 'show_powered_by']],
  ['Printer', ['auto_cut', 'print_token', 'kitchen_screen']]
];
const ReceiptCard = ({ rec, reload, food, tokenOk }: { rec: BusinessRecord; reload: () => Promise<void>; food: boolean; tokenOk: boolean }) => {
  const before = receiptOf(rec);
  const [r, setR] = useState<Receipt>(before);
  const set = <K extends keyof Receipt>(k: K, v: Receipt[K]) => setR((o) => ({ ...o, [k]: v }));
  const text = (k: keyof Receipt, label: string, extra: { big?: boolean; max?: number; caps?: boolean; keyboard?: 'email-address' } = {}) => <TextField key={k} label={label} value={String(r[k] ?? '')} onChange={(v) => set(k, v as never)} {...extra} />;
  return (
    <Card title="Receipt and tax invoice details" hint="What prints on receipts, and the PAN, bank details and terms a tax invoice carries." save={async () => { const d = receiptPatch(before, r); if (!d) return t('Nothing changed.'); await patch(d); await reload(); return null; }}>
      <LogoSetting url={logoUrlOf(rec.receipt_settings)} onChange={() => { void reload(); }} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Paper width')}</Text>
      <Chips items={[{ id: '58', label: '58 mm' }, { id: '80', label: '80 mm' }]} value={String(r.paper_width)} onChange={(v) => set('paper_width', Number(v) as 58 | 80)} />
      {text('footer', 'Footer message', { max: 200, big: true })}
      {text('header_text', 'Line under the business name', { max: 80 })}
      {RECEIPT_SECTIONS.map(([title, keys]) => {
        const rows = [...TOGGLES, ...(food ? [KITCHEN_TOGGLE, ...(tokenOk ? [TOKEN_TOGGLE] : [])] : [TERMS_TOGGLE])].filter(([k]) => keys.includes(k));
        return rows.length ? <View key={title} style={{ gap: 6 }}><Text style={{ color: color.soft, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{t(title)}</Text>{rows.map(([k, label]) => <Toggle key={k} label={label} value={Boolean(r[k])} onChange={(v) => set(k, v as never)} />)}</View> : null;
      })}
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Copies of each receipt')}</Text>
      <Chips items={['1', '2', '3', '4', '5'].map((n) => ({ id: n, label: n }))} value={String(r.copies)} onChange={(v) => set('copies', Number(v))} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Blank lines after the receipt')}</Text>
      <Chips items={['0', '1', '2', '3', '5', '8'].map((n) => ({ id: n, label: n }))} value={String(r.extra_lines)} onChange={(v) => set('extra_lines', Number(v))} />
      {food ? null : <>
        {text('pan', 'PAN', { max: 10, caps: true })}
        {text('bank_name', 'Bank name', { max: 80 })}
        {text('bank_account', 'Account number', { max: 24 })}
        {text('bank_ifsc', 'IFSC', { max: 11, caps: true })}
        {text('bank_branch', 'Bank branch', { max: 80 })}
        {text('accountant_email', 'Accountant email', { keyboard: 'email-address', max: 160 })}
        {text('terms', 'Terms and conditions', { big: true, max: 1000 })}
      </>}
    </Card>
  );
};

const GstCard = ({ rec, reload }: { rec: BusinessRecord; reload: () => Promise<void> }) => {
  const [g, setG] = useState<Gst>(gstOf(rec));
  const opt = (patchOpt: Partial<GstOptions>) => setG((o) => ({ ...o, options: { ...o.options, ...patchOpt } }));
  return (
    <Card title="GST options" hint="Enable only what applies to your business. Everything is disabled until you switch it on, and your bills stay as they are until then." save={async () => { await patch(gstPatch(g)); await reload(); void loadMe(); return null; }}>
      <Toggle label="Charge GST" value={g.gst_enabled} onChange={(v) => setG((o) => ({ ...o, gst_enabled: v }))} />
      {g.gst_enabled ? OPTION_ROWS.map((o) => (
        <View key={o.key} style={{ gap: 4, borderTopWidth: 1, borderColor: color.line, paddingTop: 8 }}>
          <Toggle label={o.label} value={Boolean(g.options[o.key])} onChange={(v) => opt({ [o.key]: v })} />
          <Soft>{t(o.text)}</Soft>
          {o.rate && g.options[o.key] ? <TextField label={o.rateLabel!} value={String(g.options[o.rate])} onChange={(v) => opt({ [o.rate!]: v as never })} keyboard="numeric" /> : null}
        </View>
      )) : null}
    </Card>
  );
};

const NumbersCard = ({ rec, reload }: { rec: BusinessRecord; reload: () => Promise<void> }) => {
  const before = numbersOf(rec);
  const [n, setN] = useState(before);
  return (
    <Card title="Document numbers" hint="The letters before each number. Changing one keeps the numbering going; documents already made keep their number." save={async () => { const d = numbersPatch(before, n); if (!d) return t('Nothing changed.'); await patch(d); await reload(); return null; }}>
      {NUMBER_KINDS.map(([k, label, fallback]) => (
        <View key={k}>
          <TextField label={label} value={n[k]} onChange={(v) => setN((o) => ({ ...o, [k]: v }))} max={12} caps />
          <Soft>{numberExample(n[k], fallback)}</Soft>
        </View>
      ))}
    </Card>
  );
};

const PrintCard = ({ rec, reload, trade }: { rec: BusinessRecord; reload: () => Promise<void>; trade: boolean }) => {
  const before = printOf(rec);
  const [p, setP] = useState<PrintSettings>(before);
  const set = (patchP: Partial<PrintSettings>) => setP((o) => ({ ...o, ...patchP }));
  return (
    <Card title="Invoice print" hint="How your A4 and A5 invoices look." save={async () => { const d = printPatch(before, p); if (!d) return t('Nothing changed.'); await patch(d); await reload(); return null; }}>
      {trade || p.layout === 'tally' ? <>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t('Layout')}</Text>
        <Chips items={[{ id: 'auto', label: 'Automatic' }, { id: 'standard', label: 'Standard bill' }, { id: 'tally', label: 'Tax invoice (Tally style)' }]} value={p.layout} onChange={(v) => set({ layout: v })} />
      </> : null}
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Paper')}</Text>
      <Chips items={[{ id: 'A4', label: 'A4' }, { id: 'A5', label: 'A5' }]} value={p.paper} onChange={(v) => set({ paper: v as 'A4' | 'A5' })} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Text size')}</Text>
      <Chips items={[{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }]} value={p.text_size} onChange={(v) => set({ text_size: v as PrintSettings['text_size'] })} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Colour')}</Text>
      <Chips items={ACCENTS.map(([hex, name]) => ({ id: hex, label: name }))} value={p.accent} onChange={(v) => set({ accent: v })} />
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Copies')}</Text>
      {COPY_LABELS.map((c) => <Toggle key={c} label={c} value={p.copies.includes(c)} onChange={(on) => set({ copies: on ? [...p.copies, c] : p.copies.filter((x) => x !== c) })} />)}
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Show on the invoice')}</Text>
      {SHOW_OPTIONS.map(([k, label]) => <Toggle key={k} label={label} value={Boolean(p.show[k])} onChange={(on) => set({ show: { ...p.show, [k]: on } })} />)}
      <TextField label="Declaration" value={p.declaration} onChange={(v) => set({ declaration: v })} big max={400} />
      <TextField label="Signature line" value={p.signature_text} onChange={(v) => set({ signature_text: v })} max={60} />
      <TextField label="Footer line" value={p.footer_note} onChange={(v) => set({ footer_note: v })} max={120} />
    </Card>
  );
};

/* Settings > Business on the phone (owner only): the same details, receipt, GST and invoice settings as the website, each saved on its own. */
export default function BusinessSettingsScreen() {
  const session = useSession();
  const owner = currentBusiness(session)?.role === 'OWNER';
  const food = hasFeature(currentBusiness(session), 'kitchen');   // a restaurant, cafe or cloud kitchen: kitchen settings, no A4 tax invoice
  const trade = TAX_INVOICE_TYPES.includes(currentBusiness(session)?.business_type ?? '');
  const [rec, setRec] = useState<BusinessRecord | null>(null);
  const [error, setError] = useState('');
  const params = useLocalSearchParams<{ open?: string }>();
  const [open, setOpen] = useState<string | null>(params.open ?? null);   // one section open at a time; ?open=gst opens GST straight away
  const [version, setVersion] = useState(0);   // a new copy from the server starts each card again, so it shows what was really saved
  const reload = async () => { const r = await api.get<BusinessRecord>('/businesses/current'); setRec(r); setVersion((v) => v + 1); };
  useEffect(() => { if (owner) reload().catch((e: Error) => setError(e.message)); }, [owner]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sections = rec ? [
    { id: 'details', title: 'Business details', sub: 'Name, address, GSTIN, contact', icon: 'business-outline' as const, node: <Details key={`d${version}`} rec={rec} reload={reload} /> },
    { id: 'receipt', title: 'Receipt', sub: 'What the till receipt says', icon: 'receipt-outline' as const, node: <ReceiptCard key={`r${version}`} rec={rec} reload={reload} food={food} tokenOk={hasFeature(currentBusiness(session), 'counter_token')} /> },
    { id: 'gst', title: 'GST', sub: 'Charge GST and the options that go with it', icon: 'document-text-outline' as const, node: <GstCard key={`g${version}`} rec={rec} reload={reload} /> },
    ...(food ? [] : [{ id: 'print', title: 'Invoice print', sub: 'How your A4 and A5 invoices look', icon: 'print-outline' as const, node: <PrintCard key={`p${version}`} rec={rec} reload={reload} trade={trade} /> }]),
    { id: 'numbers', title: 'Document numbers', sub: 'The letters before each number', icon: 'list-outline' as const, node: <NumbersCard key={`n${version}`} rec={rec} reload={reload} /> }
  ] : [];

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Business settings</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!owner ? <Empty>Only the owner can change business settings.</Empty> : null}
        {owner && error && !rec ? <Failed message={error} onRetry={() => { setError(''); reload().catch((e: Error) => setError(e.message)); }} /> : null}
        {owner && !rec && !error ? <Loading /> : null}
        {owner && rec ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            {sections.map((sec, i) => (
              <FadeIn key={sec.id} index={i}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === sec.id }} onPress={() => setOpen(open === sec.id ? null : sec.id)}
                  style={({ pressed }) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }, pressed && { backgroundColor: color.press }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={sec.icon} size={20} color={color.brand} /></View>
                  <View style={{ flex: 1 }}><Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{t(sec.title)}</Text><Text style={{ fontSize: 13, color: color.soft }}>{t(sec.sub)}</Text></View>
                  <Ionicons name={open === sec.id ? 'chevron-up' : 'chevron-down'} size={20} color={color.soft} />
                </Pressable>
                {open === sec.id ? <View style={{ marginTop: 10 }}>{sec.node}</View> : null}
              </FadeIn>
            ))}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
