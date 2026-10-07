import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, currentBusiness, signOut, useSession } from '../lib/session.ts';
import { kvGet, kvSet, useScope } from '../lib/local.ts';
import { refreshCounts, syncAll, useSyncState } from '../lib/sync.ts';
import { appVersion, reportError } from '../lib/crash.ts';
import { printReceipt, type Paper } from '../lib/print.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

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

  useEffect(() => { void scope?.outbox.device().then(setDevice); }, [scope]);
  useEffect(() => { void kvGet('paper').then((v) => { if (v === '80') setPaper('80'); }); }, []);

  const choosePaper = (p: Paper) => { setPaper(p); void kvSet('paper', p); };
  const say = (m: string, e = '') => { setMessage(m); setError(e); };

  const checkUpdate = async () => {
    if (!Updates.isEnabled) return say('', 'Updates are not switched on in this build.');
    try {
      say('Checking…');
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) return say('You have the latest version.');
      await Updates.fetchUpdateAsync();
      Alert.alert('Update ready', 'Restart FlowXP to use the new version. Sales waiting on this phone are kept.', [{ text: 'Later' }, { text: 'Restart now', onPress: () => { void Updates.reloadAsync(); } }]);
      say('An update is ready.');
    } catch (e) { say('', e instanceof Error ? e.message : 'Could not check for updates'); }
  };

  const clearData = () => {
    if (!scope) return;
    if (sync.pending + sync.failed > 0) { say('', `${sync.pending + sync.failed} sale(s) have not reached FlowXP. Send them (or discard the refused ones) before clearing this phone.`); return; }
    Alert.alert('Clear this phone?', 'Removes the product list and the list of sent sales from this phone. Nothing in FlowXP is deleted; the products download again next time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { void (async () => { await scope.catalog.clear(); await scope.outbox.forgetSent(); await refreshCounts(); say('This phone is cleared. The products download again when you open the till.'); })(); } }
    ]);
  };

  const leave = () => {
    const unsent = sync.pending + sync.failed;
    const go = () => { void signOut().then(() => router.replace('/login')); };
    if (!unsent) return go();
    Alert.alert(`${unsent} sale${unsent === 1 ? ' is' : 's are'} not sent yet`, 'They stay safe on this phone and are sent after you sign in again to this outlet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', onPress: go }]);
  };

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Title>Settings</Title>
        <View style={s.card}>
          <Row label="Signed in as" value={session.user?.email ?? ''} />
          <Row label="Business" value={business?.name ?? ''} />
          <Row label="Outlet" value={business?.outlets.find((o) => o.branch_id === session.branchId)?.name ?? ''} />
          <Row label="Phone code" value={device} />
          <Row label="Products on this phone" value={String(sync.products)} />
          <Row label="Last sync" value={sync.syncedAt ? new Date(sync.syncedAt).toLocaleString() : 'never'} />
          <Row label="Sales waiting / refused" value={`${sync.pending} / ${sync.failed}`} />
          <Row label="App version" value={appVersion()} />
          <Row label="Server" value={API_URL} />
        </View>

        <Text style={{ fontWeight: '700', color: color.ink }}>Receipt printer paper</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="58 mm" kind={paper === '58' ? 'primary' : 'quiet'} onPress={() => choosePaper('58')} style={{ flex: 1 }} />
          <Button title="80 mm" kind={paper === '80' ? 'primary' : 'quiet'} onPress={() => choosePaper('80')} style={{ flex: 1 }} />
        </View>
        <Button title="Print a test receipt" kind="quiet" onPress={() => { printReceipt(TEST_RECEIPT, paper).catch((e: Error) => say('', e.message)); }} />
        <Soft>Printing uses the phone's own print system, so it works with any printer the phone can reach (Wi-Fi, USB, or Bluetooth through the printer maker's app).</Soft>

        <Button title="Send sales now" kind="quiet" onPress={() => { void syncAll(); }} busy={sync.busy} />
        <Button title="Check for an update" kind="quiet" onPress={() => { void checkUpdate(); }} />
        <Button title="Send a test problem report" kind="quiet" onPress={() => { void reportError(new Error(`Test report from ${device || 'a phone'}`), '/settings').then((r) => say(r === 'sent' ? 'Report sent.' : r === 'queued' ? 'No connection: the report will be sent later.' : 'Already sent a moment ago.')); }} />
        <Button title="Clear this phone's data" kind="danger" onPress={clearData} />
        <ErrorText>{error}</ErrorText>
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{message}</Text> : null}
        <Button title="Sign out" kind="quiet" onPress={leave} />
        <Button title="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
