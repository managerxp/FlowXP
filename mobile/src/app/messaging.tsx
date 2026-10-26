import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import {
  CHANNELS, LAPSED_DAYS, MAX_OFFER, STATUS_FILTERS, TOGGLES, campaignBody, canMessaging, canRetry, canSend, messageSub, messageTitle, messagesPath, previewText, progressText, resendText, statusLabel,
  type Channel, type Message, type MessagingSettings, type Preview, type Progress, type SettingsData, type Template
} from '../lib/messaging.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ── settings ────────────────────────────────────────────────────────────── */
const Settings = () => {
  const me = currentBusiness(useSession());
  const [data, setData] = useState<SettingsData | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => { api.get<SettingsData>('/messaging/settings').then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const save = async (patch: Partial<MessagingSettings>) => {
    setError(''); setSaved(false);
    try { const r = await api.call<SettingsData>('/messaging/settings', { method: 'PUT', body: patch }); if (r.data) setData(r.data); setSaved(true); } catch (e) { setError(why(e)); }
  };
  if (!data) return error ? <Failed message={error} onRetry={load} /> : <Loading />;
  const { settings, provider } = data;
  const off = settings.channel === 'OFF';
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      {!provider.connected ? <Soft>{t('No messaging service is connected on the server yet, so messages are only recorded as skipped. Ask whoever runs the server to set it up.')}</Soft> : <Soft>{t('Connected: {name}', { name: provider.name ?? '' })}</Soft>}
      <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Send messages by')}</Text><Chips items={CHANNELS} value={settings.channel} onChange={(c: Channel) => { void save({ channel: c }); }} /></View>
      {TOGGLES.filter((x) => x.key !== 'job_updates' || me?.business_type === 'AUTO_PARTS').map((x) => (
        <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: off ? 0.5 : 1 }}>
          <View style={{ flex: 1, gap: 2 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(x.label)}</Text><Soft>{t(x.hint)}</Soft></View>
          <Switch value={settings[x.key]} disabled={off} onValueChange={(v) => { void save({ [x.key]: v }); }} accessibilityLabel={t(x.label)} />
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
      {saved ? <Soft>{t('Saved')}</Soft> : null}
      <Soft>{t('Offers and reminders only go to customers who have not opted out. Bills and booking messages are service messages and are sent regardless.')}</Soft>
      <Button title={templates ? 'Hide the WhatsApp templates' : 'Show the WhatsApp templates to create in Meta'} kind="quiet" onPress={() => { if (templates) setTemplates(null); else api.get<Template[]>('/messaging/templates').then(setTemplates).catch((e: Error) => setError(e.message)); }} />
      {templates ? (
        <>
          <Soft>{t('WhatsApp only lets a business start a chat with pre-approved templates. Create each one once in Meta Business Manager (category: Utility for bills and bookings, Marketing for offers), using exactly this name and text.')}</Soft>
          {templates.map((x) => <Line key={x.kind} left={x.name} right={x.promo ? t('Marketing') : ''} sub={x.body} />)}
        </>
      ) : null}
    </ScrollView>
  );
};

/* ── send an offer ───────────────────────────────────────────────────────── */
const SendOffer = () => {
  const [segments, setSegments] = useState<Record<string, string>>({});
  const [segment, setSegment] = useState('ALL');
  const [days, setDays] = useState('30');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => { api.get<SettingsData>('/messaging/settings').then((d) => setSegments(d.segments)).catch(() => {}); }, []);
  useEffect(() => {
    setPreview(null);
    api.post<Preview>('/messaging/campaigns/preview', { segment, days: Number(days) }).then(setPreview).catch((e: Error) => setPreview({ count: 0, error: e.message }));
  }, [segment, days]);
  useEffect(() => {
    if (!batch) return undefined;
    const tick = () => { api.get<Progress>(`/messaging/campaigns/${batch}`).then(setProgress).catch(() => {}); };
    tick(); const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [batch]);

  const go = async () => {
    setBusy(true); setError('');
    try { const r = await api.post<{ batch: string; recipients: number }>('/messaging/campaigns', campaignBody(segment, Number(days), text)); setBatch(r.batch); setText(''); }
    catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const confirm = () => {
    if (!preview) return;
    Alert.alert(preview.count === 1 ? t('Send to {n} customer?', { n: preview.count }) : t('Send to {n} customers?', { n: preview.count }), t('Messages go out straight away and cannot be recalled.'), [
      { text: t('Cancel'), style: 'cancel' }, { text: t('Send offer'), onPress: () => { void go(); } }
    ]);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Send to')}</Text><Chips items={Object.entries(segments).map(([k, label]) => ({ id: k, label }))} value={segment} onChange={setSegment} /></View>
      {segment === 'LAPSED' ? <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Not visited in the last (days)')}</Text><Chips items={LAPSED_DAYS.map((d) => ({ id: String(d), label: String(d) }))} value={days} onChange={setDays} /></View> : null}
      <Text style={{ color: color.ink }}>{previewText(preview)}</Text>
      <View style={{ gap: 4 }}>
        <Text style={{ color: color.soft, fontSize: 13 }}>{t('Your offer')}</Text>
        <TextInput style={[s.input, { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }]} multiline maxLength={MAX_OFFER} value={text} onChangeText={setText} placeholder={t('Flat 10% off on dinner this weekend. Show this message at the counter.')} accessibilityLabel={t('Your offer')} />
        <Soft>{t('{n}/300. Sent as: "Hi <name>, <your business>: <your text> Reply STOP to opt out."', { n: text.length })}</Soft>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Send offer" onPress={confirm} busy={busy} disabled={!canSend(text, preview, busy)} />
      {progress ? <Soft>{progressText(progress)}</Soft> : null}
      <Soft>{t('One offer per hour, so customers are not flooded. Customers who opted out are left out automatically.')}</Soft>
    </ScrollView>
  );
};

/* ── the log ─────────────────────────────────────────────────────────────── */
const Log = () => {
  const [status, setStatus] = useState<'' | 'failed' | 'skipped' | 'sent'>('');
  const [rows, setRows] = useState<Message[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await api.get<Message[]>(messagesPath(status))); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, [status]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  const resend = async (m: Message) => { setNote(''); try { const r = await api.post<{ status: string }>(`/messaging/messages/${m.message_id}/resend`, {}); setNote(resendText(r.status)); await load(); } catch (e) { setError(why(e)); } };
  return (
    <>
      <Chips items={STATUS_FILTERS} value={status} onChange={setStatus} />
      {error && !rows ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
      {!rows && !error ? <Loading /> : null}
      {rows ? (
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
          {note ? <Soft style={{ padding: 16 }}>{note}</Soft> : null}
          {rows.length === 0 ? <Empty>No messages yet.</Empty> : null}
          {rows.map((m) => (
            <View key={m.message_id}>
              <Line left={messageTitle(m)} right={statusLabel(m.status)} sub={messageSub(m, when(m.created_at))} />
              {canRetry(m) ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Button title="Retry" kind="quiet" onPress={() => { void resend(m); }} /></View> : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </>
  );
};

/* Messaging (owner and admin): the channel and what goes out on its own, an offer to a group of customers, and every message sent. */
export default function Messaging() {
  const me = currentBusiness(useSession());
  const [tab, setTab] = useState<'settings' | 'offer' | 'log'>('settings');
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Messaging</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!canMessaging(me?.role) ? <Empty>Messaging is for owners and admins.</Empty> : (
          <>
            <Chips items={[{ id: 'settings', label: 'Settings' }, { id: 'offer', label: 'Send an offer' }, { id: 'log', label: 'Message log' }]} value={tab} onChange={setTab} />
            {tab === 'settings' ? <Settings /> : tab === 'offer' ? <SendOffer /> : <Log />}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
