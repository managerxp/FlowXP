import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { API_URL, api, currentBusiness, sessionStore, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { shareDownload } from '../lib/share.ts';
import {
  canFile, cleanIrn, einvoiceRequest, gstinOptions, gstr1Request, gstr3bRows, irnProblem, limitProblem, monthLabel, pickGstin, recentMonths,
  type EInvoices, type Filings, type FilingSettings, type Gstr1, type Gstr3b
} from '../lib/gstFiling.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

const money = (r: number) => rupees(toPaise(r));
const Warnings = ({ warnings }: { warnings: { message: string }[] }) => warnings.length
  ? <View style={{ gap: 6, paddingHorizontal: 16 }}>{warnings.map((w, i) => <Text key={i} style={{ color: color.ink, backgroundColor: color.warnBg, padding: 10, borderRadius: 10 }}><Text style={{ fontWeight: '700', color: color.warn }}>{t('Check:')} </Text>{w.message}</Text>)}</View>
  : <Text style={{ marginHorizontal: 16, color: color.ok, backgroundColor: color.okBg, padding: 10, borderRadius: 10 }}>{t('Nothing to fix. The file is ready to upload.')}</Text>;

const Part1 = ({ period, gstin }: { period: string; gstin: string }) => {
  const [d, setD] = useState<Gstr1 | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setD(null); setError(''); api.get<Gstr1>(`/gst/gstr1?period=${period}&gstin=${gstin}`).then(setD).catch((e: Error) => setError(e.message)); }, [period, gstin]);
  if (!d) return error ? <Failed message={error} /> : <Loading />;
  const x = d.summary;
  const file = async () => { setBusy(true); setError(''); try { await shareDownload(gstr1Request(API_URL, sessionStore.get(), period, gstin), 'application/json', 'public.json', 'GSTR-1'); } catch (e) { setError(e instanceof Error ? t(e.message) : ''); } finally { setBusy(false); } };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
        <Stat label="B2B invoices" value={String(x.b2b.invoices)} note={t('{customers} customers · {taxable} taxable', { customers: x.b2b.customers, taxable: money(x.b2b.taxable_value) })} />
        <Stat label="B2C large (inter-state)" value={String(x.b2cl.invoices)} note={t('{taxable} taxable', { taxable: money(x.b2cl.taxable_value) })} />
        <Stat label="B2C small (summary rows)" value={String(x.b2cs.rows)} note={t('{taxable} taxable, net of returns', { taxable: money(x.b2cs.taxable_value) })} />
        <Stat label="Credit notes" value={String(x.credit_notes)} note={t('{registered} to registered · {others} to others', { registered: x.credit_notes_registered.notes, others: x.credit_notes_unregistered.notes })} />
      </View>
      <Warnings warnings={d.warnings} />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Button title="Download the GSTR-1 file" onPress={() => { void file(); }} busy={busy} />
        <Soft>{t('Upload it on the GST portal (Returns, GSTR-1, Prepare offline) or give it to your accountant. {hsn_rows} HSN rows included.', { hsn_rows: x.hsn_rows })}</Soft>
        <ErrorText>{error}</ErrorText>
      </View>
    </View>
  );
};

const Part3b = ({ period, gstin }: { period: string; gstin: string }) => {
  const [d, setD] = useState<Gstr3b | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setD(null); setError(''); api.get<Gstr3b>(`/gst/gstr3b?period=${period}&gstin=${gstin}`).then(setD).catch((e: Error) => setError(e.message)); }, [period, gstin]);
  if (!d) return error ? <Failed message={error} /> : <Loading />;
  const rows = gstr3bRows(d);
  return (
    <View>
      {rows.map((r) => {
        const parts = [r.taxable != null ? `${t('Taxable value')} ${money(r.taxable)}` : '', r.igst ? `${t('IGST')} ${money(r.igst)}` : '', r.cgst ? `${t('CGST')} ${money(r.cgst)}` : '', r.sgst ? `${t('SGST/UTGST')} ${money(r.sgst)}` : ''].filter(Boolean);
        const label = r.label.startsWith('3.2 Inter-state') ? t('3.2 Inter-state to unregistered, state {pos}', { pos: r.label.split('state ')[1] }) : t(r.label);
        return <Line key={r.label} left={label} right={money(r.igst + r.cgst + r.sgst)} sub={parts.join(' · ') || undefined} />;
      })}
      <Soft style={{ padding: 16 }}>{t('Purchases from suppliers without a GSTIN carry {amount} of tax that is not claimable.', { amount: money(d.itc.ineligible) })}</Soft>
      {d.notes.map((n, i) => <Soft key={i} style={{ paddingHorizontal: 16, paddingBottom: 6 }}>{`• ${n}`}</Soft>)}
    </View>
  );
};

const Part4 = ({ period, gstin }: { period: string; gstin: string }) => {
  const [d, setD] = useState<EInvoices | null>(null);
  const [error, setError] = useState('');
  const [irn, setIrn] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get<EInvoices>(`/gst/einvoice?period=${period}&gstin=${gstin}`).then(setD).catch((e: Error) => setError(e.message)), [period, gstin]);
  useEffect(() => { setD(null); setError(''); void load(); }, [load]);
  if (!d) return error ? <Failed message={error} /> : <Loading />;
  const ready = d.invoices.filter((i) => i.ready && !i.irn);
  const record = async (id: number) => {
    const problem = irnProblem(irn[id] ?? '');
    if (problem) { setError(t(problem)); return; }
    setError(''); setNote('');
    try { await api.post(`/gst/invoices/${id}/irn`, { irn: cleanIrn(irn[id]) }); setNote(t('IRN saved')); setIrn((x) => ({ ...x, [id]: '' })); void load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); }
  };
  const file = async () => { setBusy(true); setError(''); try { await shareDownload(einvoiceRequest(API_URL, sessionStore.get(), period, gstin), 'application/json', 'public.json', 'E-invoice'); } catch (e) { setError(e instanceof Error ? t(e.message) : ''); } finally { setBusy(false); } };
  return (
    <View style={{ gap: 8 }}>
      <Soft style={{ paddingHorizontal: 16 }}>{t('E-invoicing applies to businesses above a turnover limit and only for sales to customers with a GSTIN. If it does not apply to you, ignore this tab.')}</Soft>
      {d.invoices.length === 0 ? <Empty>No sales to GST-registered customers in this month.</Empty> : d.invoices.map((i) => (
        <View key={i.invoice_id}>
          <Line left={i.invoice_number} right={i.irn ? t('Has IRN') : i.ready ? t('Ready') : ''} sub={i.irn ? `${i.irn.slice(0, 16)}…` : i.ready ? undefined : t('Missing: {what}', { what: i.errors.join(', ') })} />
          {!i.irn && i.ready ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
              <TextInput style={[s.input, { flex: 1, fontFamily: 'monospace', fontSize: 12 }]} value={irn[i.invoice_id] ?? ''} onChangeText={(v) => setIrn((x) => ({ ...x, [i.invoice_id]: v }))} placeholder={t('Paste the IRN from the portal')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Paste the IRN from the portal')} />
              <Button title={t('Save')} kind="quiet" onPress={() => { void record(i.invoice_id); }} disabled={!(irn[i.invoice_id] ?? '').trim()} />
            </View>
          ) : null}
        </View>
      ))}
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {note ? <Text style={{ color: color.ok }}>{note}</Text> : null}
        <ErrorText>{error}</ErrorText>
        {ready.length ? <Button title={t('Download e-invoice file ({n} ready)', { n: ready.length })} onPress={() => { void file(); }} busy={busy} /> : null}
      </View>
    </View>
  );
};

const Settings = () => {
  const [st, setSt] = useState<FilingSettings | null>(null);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { api.get<FilingSettings>('/gst/settings').then((x) => { setSt(x); setLimit(String(x.b2cl_limit)); }).catch(() => {}); }, []);
  if (!st) return null;
  const save = async (patch: object) => { setError(''); setDone(''); try { const x = await api.call<FilingSettings>('/gst/settings', { method: 'PUT', body: patch }); setSt(x.data); setDone(t('Saved')); } catch (e) { setError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); } };
  return (
    <View style={[s.card, { margin: 16, gap: 10 }]}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Filing settings')}</Text>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Large inter-state invoice limit (₹)')}</Text>
      <TextInput style={s.input} value={limit} onChangeText={setLimit} keyboardType="numeric" accessibilityLabel={t('Large inter-state invoice limit (₹)')} />
      <Soft>{t('Inter-state sales to people without a GSTIN above this go in the B2CL table. Confirm the current limit with your accountant.')}</Soft>
      <Button title="Save" kind="quiet" onPress={() => { const p = limitProblem(limit); if (p) setError(t(p)); else void save({ b2cl_limit: Number(limit) }); }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ flex: 1, color: color.ink }}>{t('My business must issue e-invoices')}</Text>
        <Switch value={st.einvoice_enabled} onValueChange={(v) => { void save({ einvoice_enabled: v }); }} accessibilityLabel={t('My business must issue e-invoices')} />
      </View>
      {done ? <Text style={{ color: color.ok }}>{done}</Text> : null}
      <ErrorText>{error}</ErrorText>
      <Soft>{t("Your GSTIN is set in Business settings. Add each customer's state, pincode and GSTIN on the Customers page, and an HSN/SAC code on every product, so the files come out complete.")}</Soft>
    </View>
  );
};

/* GST filing: the GSTR-1 file, the GSTR-3B figures and the e-invoice files for a month, ready to upload on the GST portal. FlowXP prepares; it never files for you. */
export default function GstFiling() {
  const session = useSession();
  const me = currentBusiness(session);
  const may = canFile(me?.role) && allowed(me, 'gst');
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(months[0]);
  const [tab, setTab] = useState<'gstr1' | 'gstr3b' | 'einvoice'>('gstr1');
  const [filings, setFilings] = useState<Filings | null>(null);
  const [gstin, setGstin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!may) return;
    setBusy(true); setError('');
    try { const f = await api.get<Filings>(`/gst/filings?period=${period}`); setFilings(f); setGstin((cur) => pickGstin(cur, f)); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
    finally { setBusy(false); }
  }, [may, period]);
  useEffect(() => { void load(); }, [load]);

  const options = filings ? gstinOptions(filings) : [];
  const usable = Boolean(filings?.gst_enabled && gstin);
  return (
    <SafeAreaView style={s.screen}>
      <Page max={720}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>GST filing</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!may ? <Empty>Only owners and admins can prepare returns.</Empty> : (
          <ScrollView refreshControl={<RefreshControl refreshing={busy && !filings} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
            <Soft style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{t('Prepare your GSTR-1 file, the GSTR-3B figures and e-invoice files. You upload them on the GST portal.')}</Soft>
            <Text style={{ color: color.soft, fontSize: 13, paddingHorizontal: 16 }}>{t('Month')}</Text>
            <Chips items={months.map((m) => ({ id: m, label: monthLabel(m) }))} value={period} onChange={setPeriod} />
            {options.length > 1 ? <><Text style={{ color: color.soft, fontSize: 13, paddingHorizontal: 16, paddingTop: 8 }}>{t('GSTIN')}</Text><Chips items={options.map((g) => ({ id: g, label: g }))} value={gstin} onChange={setGstin} /></> : options.length === 1 ? <Soft style={{ paddingHorizontal: 16, paddingTop: 8 }}>{`${t('GSTIN')} ${gstin}`}</Soft> : null}
            {error && !filings ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
            {busy && !filings ? <Loading /> : null}
            {filings && !filings.gst_enabled ? <Soft style={{ padding: 16 }}>{t('GST is not switched on for this business. Turn it on in Business settings to prepare returns.')}</Soft> : null}
            {filings && filings.gst_enabled && !gstin ? <Soft style={{ padding: 16 }}>{t('Add your GSTIN in Business settings first.')}</Soft> : null}
            {usable ? (
              <View style={{ paddingTop: 12, gap: 8 }}>
                <Chips items={[{ id: 'gstr1', label: 'GSTR-1' }, { id: 'gstr3b', label: 'GSTR-3B' }, { id: 'einvoice', label: t('E-invoice') }]} value={tab} onChange={setTab} />
                {tab === 'gstr1' ? <Part1 period={period} gstin={gstin} /> : tab === 'gstr3b' ? <Part3b period={period} gstin={gstin} /> : <Part4 period={period} gstin={gstin} />}
                <Settings />
              </View>
            ) : null}
            <View style={{ height: 12 }} />
            <Soft style={{ paddingHorizontal: 16 }}>{t('FlowXP prepares the files and numbers; it never files for you.')}</Soft>
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
