import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import {
  COLUMNS, PLATFORMS, PLATFORM_LABEL, STATEMENT_EXAMPLE, STATUS_LABEL, canDelivery, connectBody, disconnectBody, lineSub, missingText, parseRows, statementProblem, summaryText, syncedText, testOrderText,
  type Integration, type Missing, type Settlements
} from '../lib/platforms.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const money = (n: number) => rupees(toPaise(n));
const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

/* ── connections ─────────────────────────────────────────────────────────── */
const Platform = ({ i, onChanged }: { i: Integration; onChanged: () => void }) => {
  const [apiKey, setApiKey] = useState('');
  const [outletId, setOutletId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const run = async (what: string, job: () => Promise<void>) => { setBusy(what); setError(''); setNote(''); try { await job(); } catch (e) { setError(why(e)); } finally { setBusy(''); } };
  return (
    <View style={[s.card, { gap: 8 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontWeight: '700', color: color.ink, fontSize: 16 }}>{PLATFORM_LABEL[i.platform] ?? i.platform}</Text><Text style={{ color: i.is_enabled ? color.ok : color.soft, fontWeight: '600' }}>{i.is_enabled ? t('Connected') : t('Not connected')}</Text></View>
      {i.last_synced_at ? <Soft>{syncedText(i.last_synced_at)}</Soft> : null}
      {!i.is_enabled ? (
        <>
          <TextInput style={s.input} value={apiKey} onChangeText={setApiKey} placeholder={t('Partner API key')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('API key')} />
          <TextInput style={s.input} value={outletId} onChangeText={setOutletId} placeholder={t('Outlet / store ID')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Outlet / store ID')} />
          <Button title={busy === 'save' ? 'Connecting…' : 'Connect'} onPress={() => { void run('save', async () => { await api.call(`/integrations/${i.platform}`, { method: 'PATCH', body: connectBody(apiKey, outletId) }); onChanged(); }); }} busy={busy === 'save'} />
        </>
      ) : (
        <>
          <Button title={busy === 'sync' ? 'Updating…' : 'Update the menu'} kind="quiet" onPress={() => { void run('sync', async () => { await api.call(`/integrations/${i.platform}/sync-menu`, { method: 'POST', body: {} }); setNote(t('Menu updated.')); onChanged(); }); }} busy={busy === 'sync'} />
          <Button title={busy === 'test' ? 'Sending…' : 'Send test order'} kind="quiet" onPress={() => { void run('test', async () => { const r = await api.post<{ order_number: string }>(`/integrations/${i.platform}/simulate-order`, {}); setNote(testOrderText(r.order_number)); }); }} busy={busy === 'test'} />
          <Button title="Disconnect" kind="quiet" onPress={() => { void run('off', async () => { await api.call(`/integrations/${i.platform}`, { method: 'PATCH', body: disconnectBody() }); onChanged(); }); }} busy={busy === 'off'} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
    </View>
  );
};

const Connections = () => {
  const [list, setList] = useState<Integration[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { api.get<Integration[]>('/integrations').then((l) => { setList(l); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, []);
  useEffect(load, [load]);
  if (error && !list) return <Failed message={error} onRetry={load} />;
  if (!list) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Soft>{t('Zomato, Swiggy and other delivery platforms: new orders wait for you to accept or reject before anything reaches the kitchen.')}</Soft>
      {list.map((i) => <Platform key={i.platform} i={i} onChanged={load} />)}
    </ScrollView>
  );
};

/* ── settlements ─────────────────────────────────────────────────────────── */
const Reconcile = () => {
  const [platform, setPlatform] = useState('ZOMATO');
  const [data, setData] = useState<Settlements | null>(null);
  const [missing, setMissing] = useState<Missing | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setData(null); setMissing(null);
    api.get<Settlements>(`/settlements?platform=${platform}`).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.')));
    api.get<Missing>(`/settlements/missing?platform=${platform}`).then(setMissing).catch(() => {});
  }, [platform]);
  useEffect(load, [load]);
  const submit = async () => {
    const bad = statementProblem(text);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError(''); setNote('');
    try { const r = await api.post<{ rows: number }>('/settlements/import', { platform, rows: parseRows(text) }); setNote(r.rows === 1 ? t('Imported 1 row') : t('Imported {n} rows', { n: r.rows })); setText(''); load(); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={false} onRefresh={load} />} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Soft style={{ padding: 16 }}>{t('Check the statement each delivery platform pays against what was billed here.')}</Soft>
      <Chips items={PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABEL[p] }))} value={platform} onChange={setPlatform} />
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ fontWeight: '700', color: color.ink }}>{t('Import a statement')}</Text>
        <Soft>{t('One settled order per line, comma separated, in this order: {columns}. Leave charges blank if the platform does not break them out.', { columns: COLUMNS.map((c) => t(c)).join(', ') })}</Soft>
        <TextInput style={[s.input, { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={text} onChangeText={setText} placeholder={STATEMENT_EXAMPLE} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Paste the statement lines here')} />
        <ErrorText>{error}</ErrorText>
        {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
        <Button title={busy ? 'Importing…' : 'Import'} onPress={() => { void submit(); }} busy={busy} disabled={!text.trim()} />
      </View>
      <SectionTitle>Never settled</SectionTitle>
      <Soft style={{ paddingHorizontal: 16 }}>{t('Billed orders with no matching statement line at all yet: money that should have been paid.')}</Soft>
      {!missing ? null : missing.orders.length === 0 ? <Soft style={{ padding: 16 }}>{t('Nothing unpaid, as far as an imported statement can tell.')}</Soft> : (
        <>
          <Text style={{ color: color.danger, fontWeight: '700', paddingHorizontal: 16, paddingTop: 8 }}>{missingText(missing)}</Text>
          {missing.orders.map((o) => <Line key={o.order_id} left={o.order_number} sub={o.external_order_number || o.external_order_id} right={money(o.total)} />)}
        </>
      )}
      <SectionTitle>Imported lines</SectionTitle>
      {!data ? <Loading /> : data.lines.length === 0 ? <Empty>Nothing imported for this platform yet.</Empty> : (
        <>
          <Soft style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{summaryText(data.summary)}</Soft>
          {data.lines.map((l) => <Line key={l.line_id} left={l.order_number || l.external_order_id} right={t(STATUS_LABEL[l.status])} sub={lineSub(l)} />)}
        </>
      )}
    </ScrollView>
  );
};

/* Delivery platforms (owner and admin, food businesses): connections, and the check of each platform's settlement statement. */
export default function DeliveryPlatforms() {
  const me = currentBusiness(useSession());
  const ok = canDelivery((p) => allowed(me, p));
  const [tab, setTab] = useState<'connect' | 'settle'>('connect');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Delivery integrations</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to delivery settings.</Empty> : (
          <>
            <Chips items={[{ id: 'connect', label: 'Delivery integrations' }, { id: 'settle', label: 'Settlements' }]} value={tab} onChange={setTab} />
            {tab === 'connect' ? <Connections /> : <Reconcile />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
