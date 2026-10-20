import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { shareTextFile } from '../lib/share.ts';
import { MODES, canEway, cleanNumber, emptyEway, ewayBody, fileName, fileText, formProblem, numberProblem, recordBody, savedText, type EwayForm, type EwayResult, type Mode } from '../lib/ewayBill.ts';
import { Button, Chips, Empty, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* The e-way bill for one invoice: how the goods travel, the file for the e-way bill portal (shared from the phone), and the number the portal returns. */
export default function EwayBill() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = currentBusiness(useSession());
  const [f, setF] = useState<EwayForm>(emptyEway());
  const [result, setResult] = useState<EwayResult | null>(null);
  const [number, setNumber] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const set = <K extends keyof EwayForm>(k: K, v: EwayForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const allowed = canEway(me?.role, true);

  const prepare = async () => {
    const problem = formProblem(f);
    if (problem) { setError(t(problem)); return; }
    setBusy('prepare'); setError(''); setResult(null);
    try { setResult(await api.post<EwayResult>('/gst/eway-bill', ewayBody(Number(id), f))); } catch (e) { setError(e instanceof Error ? e.message : t('Could not prepare the file. Check the connection and try again.')); } finally { setBusy(''); }
  };
  const share = async () => {
    if (!result) return;
    setError('');
    try { await shareTextFile(fileName(result.invoice_number), fileText(result), 'application/json', 'public.json', t('Share the e-way bill file (JSON)')); } catch (e) { setError(e instanceof Error ? e.message : t('Could not prepare the file. Check the connection and try again.')); }
  };
  const record = async () => {
    const problem = numberProblem(number);
    if (problem) { setError(t(problem)); return; }
    setBusy('save'); setError('');
    try { await api.post(`/gst/invoices/${id}/eway-bill`, recordBody(number, today())); setSaved(savedText(cleanNumber(number))); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(''); }
  };
  const field = (k: 'distance_km' | 'vehicle_no' | 'transporter_id' | 'transporter_name', label: string, o: { hint?: string; keyboard?: 'numeric'; upper?: boolean; max?: number; placeholder?: string } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={f[k]} onChangeText={(v) => set(k, o.upper ? v.toUpperCase() : v)} keyboardType={o.keyboard ?? 'default'} maxLength={o.max} placeholder={o.placeholder} autoCapitalize={o.upper ? 'characters' : 'none'} autoCorrect={false} accessibilityLabel={t(label)} />
      {o.hint ? <Soft>{t(o.hint)}</Soft> : null}
    </View>
  );

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>E-way bill</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
          {!allowed ? <Empty>Only owners and admins can prepare e-way bills.</Empty> : (
            <>
              <Soft>{t("Needed for goods (not services) moved for more than ₹50,000. The customer's state, pincode and GSTIN, your address and pincode, and an HSN on every product must be filled in.")}</Soft>
              <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Transport')}</Text><Chips items={MODES} value={f.mode} onChange={(m: Mode) => set('mode', m)} /></View>
              {field('distance_km', 'Distance (km)', { keyboard: 'numeric', max: 4 })}
              {field('vehicle_no', 'Vehicle number', { hint: "Or the transporter's ID below", upper: true, max: 12, placeholder: 'KA01AB1234' })}
              {field('transporter_id', 'Transporter GSTIN (optional)', { upper: true, max: 15 })}
              {field('transporter_name', 'Transporter name (optional)', { max: 60 })}
              <Button title={busy === 'prepare' ? 'Preparing…' : 'Prepare the file'} onPress={() => { void prepare(); }} busy={busy === 'prepare'} />
              <ErrorText>{error}</ErrorText>

              {result ? (
                <View style={{ gap: 10 }}>
                  {result.errors.length > 0 ? (
                    <View style={[s.card, { gap: 4 }]}><Text style={{ color: color.danger, fontWeight: '700' }}>{t('Fix these first:')}</Text>{result.errors.map((e, i) => <Text key={i} style={{ color: color.danger }}>• {e}</Text>)}</View>
                  ) : null}
                  {result.warnings.map((w, i) => <Soft key={i}>{w.message}</Soft>)}
                  {result.ready ? (
                    <>
                      <Button title="Share the e-way bill file (JSON)" kind="quiet" onPress={() => { void share(); }} />
                      <Soft>{t('Upload it on the e-way bill portal (Generate in bulk). The portal gives you a 12-digit number: save it here.')}</Soft>
                      <View style={{ gap: 4 }}>
                        <Text style={{ color: color.soft, fontSize: 13 }}>{t('E-way bill number')}</Text>
                        <TextInput style={s.input} value={number} onChangeText={(v) => setNumber(v.replace(/[^\d ]/g, ''))} keyboardType="numeric" maxLength={14} accessibilityLabel={t('E-way bill number')} />
                      </View>
                      <Button title="Save number" onPress={() => { void record(); }} busy={busy === 'save'} disabled={cleanNumber(number).length !== 12} />
                      {saved ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{saved}</Text> : null}
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
