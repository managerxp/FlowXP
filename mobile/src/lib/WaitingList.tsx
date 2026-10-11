import { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useScope } from './local.ts';
import type { Entry } from './outbox.ts';
import type { Action } from './actions.ts';
import { refreshCounts, syncAll, useSyncState } from './sync.ts';
import { rupees, toPaise } from './money.ts';
import { conflictText, split } from './conflicts.ts';
import { Button, Soft, color } from './ui.tsx';
import { t } from './i18n.ts';

const WHY: Record<string, string> = { offline: 'Waiting for the internet.', server: 'FlowXP is not answering. It will try again soon.', auth: 'You were signed out. Sign in again to send these.' };

/* Every sale on this phone that has not been settled with FlowXP, and the recent ones that have. */
export const WaitingList = () => {
  const scope = useScope();
  const sync = useSyncState();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [changes, setChanges] = useState<Action[]>([]);
  const load = () => { void scope?.outbox.list().then(setEntries); void scope?.actions.list().then(setChanges); };
  useEffect(load, [scope, sync.pending, sync.failed, sync.changesPending, sync.changesFailed, sync.busy]);   // eslint-disable-line react-hooks/exhaustive-deps

  // a change another device got to first: ask which version to keep (once per visit; "Decide later" leaves it on the list)
  const conflicts = changes.filter((c) => c.state === 'conflict');
  const [later, setLater] = useState<string[]>([]);
  const asking = conflicts.find((c) => !later.includes(c.id)) ?? null;
  const mineOf = (c: Action): number => Number(c.body.selling_price ?? 0);
  const keep = async (c: Action, which: 'mine' | 'server') => {
    const server = split(c.body).server ?? 0;
    await scope!.actions.resolve(c.id, which);
    if (which === 'server') { const pid = Number(c.path.split('/')[2]); await scope!.catalog.setLocal(pid, { selling_price: server }); }
    await refreshCounts(); load();
    if (which === 'mine') void syncAll();
  };
  const act = async (fn: () => Promise<void>) => { await fn(); await refreshCounts(); load(); };
  const open = (e: Entry) => router.push(e.invoice_id ? { pathname: '/receipt', params: { id: String(e.invoice_id) } } : { pathname: '/receipt', params: { local: e.id } });

  const q = asking ? conflictText(asking.label, mineOf(asking), split(asking.body).server ?? 0, (n) => rupees(toPaise(n)), t) : null;
  return (
    <View style={{ flex: 1 }}>
      <Modal visible={Boolean(asking)} transparent animationType="fade" onRequestClose={() => asking && setLater((l) => [...l, asking.id])}>
        <View style={{ flex: 1, backgroundColor: '#0f172a99', justifyContent: 'center', padding: 24 }}>
          {asking && q ? (
            <View accessibilityViewIsModal style={{ backgroundColor: color.card, borderRadius: 16, padding: 18, gap: 12 }}>
              <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{q.title}</Text>
              <Text style={{ fontSize: 16, color: color.ink, lineHeight: 23 }}>{q.body}</Text>
              <Button title={q.keepMine} onPress={() => { void keep(asking, 'mine'); }} />
              <Button title={q.keepServer} kind="quiet" onPress={() => { void keep(asking, 'server'); }} />
              <Button title="Decide later" kind="quiet" onPress={() => setLater((l) => [...l, asking.id])} />
            </View>
          ) : null}
        </View>
      </Modal>
      <View style={{ padding: 16, gap: 8 }}>
        <Soft>{sync.pending} waiting · {sync.failed} need a decision{sync.stopped ? ` · ${WHY[sync.stopped]}` : ''}</Soft>
        <Button title="Send now" onPress={() => { void syncAll(); }} busy={sync.busy} />
      </View>
      <FlatList
        ListHeaderComponent={changes.filter((c) => c.state !== 'sent').length ? (
          <View>
            <Text style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, fontWeight: '700', color: color.ink }}>{t('Changes waiting to send')}</Text>
            {changes.filter((c) => c.state !== 'sent').map((c) => (
              <View key={c.id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 4 }}>
                <Text style={{ color: color.ink, fontWeight: '600' }}>{c.label}</Text>
                <Text style={{ color: c.state === 'pending' ? color.warn : color.danger, fontWeight: '600' }}>{c.state === 'conflict' ? 'Changed on another device: you decide' : c.state === 'failed' ? 'FlowXP could not accept it' : 'Waiting to send'}</Text>
                {c.error && c.state !== 'conflict' ? <Text style={{ color: color.danger }}>{c.error}</Text> : null}
                {c.state === 'conflict' ? <Button title="Choose which to keep" kind="quiet" onPress={() => setLater((l) => l.filter((x) => x !== c.id))} /> : null}
                {c.state === 'failed' ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Try again" kind="quiet" onPress={() => { void scope!.actions.retry(c.id).then(() => syncAll()); }} style={{ flex: 1 }} />
                    <Button title="Discard" kind="danger" onPress={() => { void scope!.actions.discard(c.id).then(() => refreshCounts()).then(load); }} style={{ flex: 1 }} />
                  </View>
                ) : null}
              </View>
            ))}
            <Text style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, fontWeight: '700', color: color.ink }}>{t('Bills')}</Text>
          </View>
        ) : null}
        data={entries} keyExtractor={(e) => e.id}
        ListEmptyComponent={<Soft style={{ padding: 16 }}>No bills have been made on this phone yet.</Soft>}
        renderItem={({ item: e }) => (
          <Pressable accessibilityRole="button" onPress={() => open(e)} style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', color: color.ink }}>{e.invoice_number || e.local_no}</Text>
              <Text style={{ fontWeight: '600', color: color.ink }}>{rupees(e.preview.totalPaise)}</Text>
            </View>
            <Soft>{new Date(e.taken_at).toLocaleString()} · {e.preview.lines.length} lines · {e.preview.method}</Soft>
            <Text style={{ color: e.state === 'failed' ? color.danger : e.state === 'sent' ? color.ok : color.warn, fontWeight: '600' }}>
              {e.state === 'sent' ? 'Sent' : e.state === 'failed' ? 'FlowXP could not accept it' : 'Waiting to send'}
            </Text>
            {e.error ? <Text style={{ color: color.danger }}>{e.error}</Text> : null}
            {e.state === 'failed' ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Button title="Try again" kind="quiet" onPress={() => { void act(() => scope!.outbox.retry(e.id)).then(() => syncAll()); }} style={{ flex: 1 }} />
                <Button title="Discard" kind="danger" onPress={() => Alert.alert('Discard this bill?', `${e.local_no} will be removed from this phone and will never reach FlowXP. Do this only if the sale did not really happen, or you have already made the bill again.`, [{ text: 'Keep the bill', style: 'cancel' }, { text: 'Discard bill', style: 'destructive', onPress: () => { void act(() => scope!.outbox.discard(e.id)); } }])} style={{ flex: 1 }} />
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
};
