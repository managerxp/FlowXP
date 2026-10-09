import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { goBack } from '../lib/nav.ts';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, currentBusiness, signOut, useSession } from '../lib/session.ts';
import { kvGet, kvSet, useScope } from '../lib/local.ts';
import { refreshCounts, syncAll, useSyncState } from '../lib/sync.ts';
import { appVersion, reportError } from '../lib/crash.ts';
import { printReceipt, type Paper } from '../lib/print.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';
import { LanguagePicker } from '../lib/lang.tsx';
import { t } from '../lib/i18n.ts';
import { readChoice, turnOff, turnOn } from '../lib/push.ts';
import type { AlertChoice } from '../lib/alerts.ts';

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
    <Soft>{label}</Soft><Text selectable style={{ color: color.ink, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
  </View>
);

const TEST_RECEIPT = ['FlowXP', 'Test receipt', '-'.repeat(32), '12345678901234567890123456789012', 'Total                     ₹1.00', '-'.repeat(32), 'If this lines up, the printer is set.'].join('\n');

export default function Settings() {
  const session = useSession();
  const scope = useScope();
  const sync = useSyncState();
  const business = currentBusiness(session);
  const [device, setDevice] = useState('');
  const [paper, setPaper] = useState<Paper>('58');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<AlertChoice>('unasked');
  const [blocked, setBlocked] = useState(false);

  useEffect(() => { void readChoice().then(setAlerts); }, []);
  useEffect(() => { void scope?.outbox.device().then(setDevice); }, [scope]);
  useEffect(() => { void kvGet('paper').then((v) => { if (v === '80') setPaper('80'); }); }, []);

  const choosePaper = (p: Paper) => { setPaper(p); void kvSet('paper', p); };
  const say = (m: string, e = '') => { setMessage(m); setError(e); };
  const toggleAlerts = async () => {
    if (alerts === 'on') { await turnOff(); setAlerts('off'); setBlocked(false); say(t('Alerts are off on this phone.')); return; }
    const result = await turnOn();
    setBlocked(result === 'blocked');
    if (result === 'on') { setAlerts('on'); say(t('Alerts are on. Choose which ones on the FlowXP website, under Notifications.')); }
    else if (result === 'blocked') say('', t("Alerts are blocked for FlowXP in this phone's settings."));
    else say('', t('Alerts are not available on this phone or in this build of the app.'));
  };

  const clearData = () => {
    if (!scope) return;
    if (sync.pending + sync.failed > 0) { say('', `${sync.pending + sync.failed} bill(s) have not reached FlowXP yet. Send them, or discard the ones FlowXP could not accept, before clearing this phone.`); return; }
    Alert.alert('Clear this phone?', 'This removes the product list and the list of sent bills from this phone. Nothing in FlowXP is deleted. The products download again next time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { void (async () => { await scope.catalog.clear(); await scope.outbox.forgetSent(); await refreshCounts(); say('This phone is cleared. The products download again when you open the till.'); })(); } }
    ]);
  };

  const leave = () => {
    const unsent = sync.pending + sync.failed;
    const go = () => { void signOut().then(() => router.replace('/login')); };
    if (!unsent) return go();
    Alert.alert(`${unsent} bill${unsent === 1 ? ' has' : 's have'} not been sent yet`, 'They stay safe on this phone. They are sent after you sign in again at this outlet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', onPress: go }]);
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Title>Settings</Title>
        <View style={s.card}>
          <Row label="Signed in as" value={session.user?.email ?? ''} />
          <Row label="Business" value={business?.name ?? ''} />
          <Row label="Outlet" value={business?.outlets.find((o) => o.branch_id === session.branchId)?.name ?? ''} />
          <Row label="Phone code" value={device} />
          <Row label="Products on this phone" value={String(sync.products)} />
          <Row label="Products last updated" value={sync.syncedAt ? new Date(sync.syncedAt).toLocaleString() : 'never'} />
          <Row label="Bills waiting / need a decision" value={`${sync.pending} / ${sync.failed}`} />
          <Row label="App version" value={appVersion()} />
          <Row label="Server" value={API_URL} />
        </View>

        <Text style={{ fontWeight: '700', color: color.ink }}>{t('Language')}</Text>
        <LanguagePicker />
        <Text style={{ fontWeight: '700', color: color.ink }}>Receipt printer paper</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="58 mm" kind={paper === '58' ? 'primary' : 'quiet'} onPress={() => choosePaper('58')} style={{ flex: 1 }} />
          <Button title="80 mm" kind={paper === '80' ? 'primary' : 'quiet'} onPress={() => choosePaper('80')} style={{ flex: 1 }} />
        </View>
        <Button title="Print a test receipt" kind="quiet" onPress={() => { printReceipt(TEST_RECEIPT, paper).catch((e: Error) => say('', e.message)); }} />
        <Soft>Printing uses the phone's own print system, so it works with any printer the phone can reach (Wi-Fi, USB, or Bluetooth through the printer maker's app).</Soft>

        <Text style={{ fontWeight: '700', color: color.ink }}>{t('Alerts on this phone')}</Text>
        <Soft>{t('A new order, a dish ready for your table, stock running out. Choose which ones on the FlowXP website, under Notifications.')}</Soft>
        <Button title={alerts === 'on' ? t('Turn alerts off') : t('Turn alerts on')} kind={alerts === 'on' ? 'quiet' : 'primary'} onPress={() => { void toggleAlerts(); }} />
        {blocked ? <Button title={t("Open this phone's settings")} kind="quiet" onPress={() => { void Linking.openSettings(); }} /> : null}

        <Button title="Send waiting bills now" kind="quiet" onPress={() => { void syncAll(); }} busy={sync.busy} />
        <Button title="Refresh the product list" kind="quiet" onPress={() => { void (async () => { if (!scope) return; say('Refreshing…'); try { await scope.catalog.rebuild(); await syncAll(); say('The product list was refreshed.'); } catch (e) { say('', e instanceof Error ? e.message : 'Could not refresh'); } })(); }} busy={sync.busy} />
        <Button title="Send a test report to FlowXP" kind="quiet" onPress={() => { void reportError(new Error(`Test report from ${device || 'a phone'}`), '/settings').then((r) => say(r === 'sent' ? 'Report sent.' : r === 'queued' ? 'No connection: the report will be sent later.' : 'Already sent a moment ago.')); }} />
        <Button title="Clear this phone's data" kind="danger" onPress={clearData} />
        <ErrorText>{error}</ErrorText>
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{message}</Text> : null}
        <Button title="Sign out" kind="quiet" onPress={leave} />
        <Button title={t('Delete my account')} kind="quiet" onPress={() => { void Linking.openURL('https://flowxp.in/delete-account'); }} />
        <Soft>{t('Opens the FlowXP website, where you can delete your account or ask us to. Your business keeps its bills.')}</Soft>
        <Button title="Back" onPress={() => goBack()} />
      </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
