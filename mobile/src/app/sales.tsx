import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useScope } from '../lib/local.ts';
import type { Entry } from '../lib/outbox.ts';
import { refreshCounts, syncAll, useSyncState } from '../lib/sync.ts';
import { rupees } from '../lib/money.ts';
import { Button, Soft, Title, color, s } from '../lib/ui.tsx';

const WHY: Record<string, string> = { offline: 'Waiting for a signal.', server: 'FlowXP is not answering. Trying again soon.', auth: 'Your sign-in ended. Sign in again to send these.' };

/* Every sale on this phone that has not been settled with FlowXP, and the recent ones that have. */
export default function Sales() {
  const scope = useScope();
  const sync = useSyncState();
  const [entries, setEntries] = useState<Entry[]>([]);
  const load = () => { void scope?.outbox.list().then(setEntries); };
  useEffect(load, [scope, sync.pending, sync.failed, sync.busy]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<void>) => { await fn(); await refreshCounts(); load(); };
  const open = (e: Entry) => router.push(e.invoice_id ? { pathname: '/receipt', params: { id: String(e.invoice_id) } } : { pathname: '/receipt', params: { local: e.id } });

  return (
    <SafeAreaView style={s.screen}>
      <View style={{ padding: 16, gap: 8 }}>
        <Title>Sales on this phone</Title>
        <Soft>{sync.pending} waiting · {sync.failed} need attention{sync.stopped ? ` · ${WHY[sync.stopped]}` : ''}</Soft>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Send now" onPress={() => { void syncAll(); }} busy={sync.busy} style={{ flex: 1 }} />
          <Button title="Back" kind="quiet" onPress={() => router.back()} />
        </View>
      </View>
      <FlatList
        data={entries} keyExtractor={(e) => e.id}
        ListEmptyComponent={<Soft style={{ padding: 16 }}>No sales yet.</Soft>}
        renderItem={({ item: e }) => (
          <Pressable onPress={() => open(e)} style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', color: color.ink }}>{e.invoice_number || e.local_no}</Text>
              <Text style={{ fontWeight: '600', color: color.ink }}>{rupees(e.preview.totalPaise)}</Text>
            </View>
            <Soft>{new Date(e.taken_at).toLocaleString()} · {e.preview.lines.length} lines · {e.preview.method}</Soft>
            <Text style={{ color: e.state === 'failed' ? color.danger : e.state === 'sent' ? color.ok : '#b45309', fontWeight: '600' }}>
              {e.state === 'sent' ? 'Sent to FlowXP' : e.state === 'failed' ? 'Refused by FlowXP' : 'Waiting to be sent'}
            </Text>
            {e.error ? <Text style={{ color: color.danger }}>{e.error}</Text> : null}
            {e.state === 'failed' ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Button title="Try again" kind="quiet" onPress={() => { void act(() => scope!.outbox.retry(e.id)).then(() => syncAll()); }} style={{ flex: 1 }} />
                <Button title="Discard" kind="danger" onPress={() => Alert.alert('Discard this sale?', `${e.local_no} will be removed from this phone and never reach FlowXP. Do this only if the sale did not really happen, or you have billed it again.`, [{ text: 'Keep it', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void act(() => scope!.outbox.discard(e.id)); } }])} style={{ flex: 1 }} />
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
