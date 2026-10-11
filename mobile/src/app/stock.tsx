import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError, newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { refreshCounts, syncAll } from '../lib/sync.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { StockRow } from '../lib/types.ts';
import { REASONS, STATUS_LABEL, adjustBody, adjustProblem, afterText, counts, statusOf, urgent, visible, type Filter, type Mode, type Status } from '../lib/inventory.ts';
import { WHOLESALE_TYPES } from '../lib/retail.ts';
import { qty } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

const LOOK: Record<Status, { icon: React.ComponentProps<typeof Ionicons>['name']; tone: string }> = {
  out: { icon: 'close-circle', tone: color.danger }, low: { icon: 'warning', tone: color.warn }, in: { icon: 'checkmark-circle', tone: color.ok }
};

const StockRowView = memo(({ r, onOpen }: { r: StockRow; onOpen: (r: StockRow) => void }) => {
  const st = statusOf(r); const look = LOOK[st];
  return (
              <Pressable accessibilityRole="button" accessibilityLabel={`${r.name}, ${STATUS_LABEL[st]}, ${qty(r.current_stock)} ${r.unit ?? ''}`} onPress={() => onOpen(r)} android_ripple={{ color: '#0b57ff22' }}
                style={({ pressed }) => ({ minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: pressed ? '#eaf1ff' : color.card, flexDirection: 'row', alignItems: 'center', gap: 12 })}>
                <Ionicons name={look.icon} size={26} color={look.tone} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, color: color.ink }}>{r.name}</Text>
                  <Text style={{ fontSize: 13, color: look.tone, fontWeight: '600' }}>{STATUS_LABEL[st]}{st !== 'in' && r.min_stock > 0 ? ` · reorder at ${qty(r.min_stock)}` : ''}</Text>
                </View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{qty(r.current_stock)} {r.unit ?? ''}</Text>
              </Pressable>
  );
});

/* Everything you count, worst first, in plain words: out of stock, low, in stock. Tap an item to add what came in, or correct the count. */
export default function Stock() {
  const session = useSession();
  const scope = useScope();
  const business = currentBusiness(session);
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const { data, savedAt, error, busy, refresh } = useLoad<StockRow[]>(`stock:${session.businessId}:${session.branchId}:all`, () => api.get<StockRow[]>('/inventory'));
  const [local, setLocal] = useState<Record<number, number>>({});   // changes kept on this phone while there is no signal
  const rows = useMemo(() => urgent((data ?? []).map((r) => ({ ...r, current_stock: r.current_stock + (local[r.product_id] ?? 0) }))), [data, local]);
  const n = counts(rows);
  const shown = visible(rows, filter, text);

  const [item, setItem] = useState<StockRow | null>(null);
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const key = useRef(newKey());   // one key per change: a double tap, or a retry after a dropped signal, changes the stock once

  const open = (r: StockRow, m: Mode) => { setItem(r); setMode(m); setAmount(''); setReason(''); setProblem(''); key.current = newKey(); };
  const close = () => { setItem(null); setProblem(''); };
  const bad = adjustProblem(mode, amount, reason);

  const save = async () => {
    if (!item) return;
    if (bad) return setProblem(bad);
    setWorking(true); setProblem('');
    const body = adjustBody(item.product_id, mode, amount, reason);
    try {
      try { await api.call('/inventory/adjust', { method: 'POST', body, idempotencyKey: key.current }); setDone(`${item.name}: stock updated.`); void refresh(); }
      catch (e) {
        if (!(e instanceof NetworkError) || !scope) throw e;
        // no signal: kept on this phone with the SAME key, so if the first try did reach the server, sending it again changes the stock only once
        const kept = await scope.actions.add({ id: key.current, label: `Stock of ${item.name}: ${body.quantity > 0 ? '+' : ''}${body.quantity}`, method: 'POST', path: '/inventory/adjust', body });
        if (!kept) throw new Error('Too many changes are waiting on this phone. Connect to the internet so they can be sent.');
        await scope.catalog.setLocal(item.product_id, { stockDelta: body.quantity }); await refreshCounts(); void syncAll();
        setLocal((l) => ({ ...l, [item.product_id]: (l[item.product_id] ?? 0) + body.quantity }));
        setDone(`${item.name}: saved on this phone. It will be sent when you are online.`);
      }
      close();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not change the stock'); }
    finally { setWorking(false); }
  };

  const openRef = useRef(open); openRef.current = open;
  const onOpen = useCallback((r: StockRow) => openRef.current(r, 'add'), []);
  const renderRow = useCallback(({ item }: { item: StockRow }) => <StockRowView r={item} onOpen={onOpen} />, [onOpen]);
  const buy = () => router.push(WHOLESALE_TYPES.includes(business?.business_type ?? '') ? '/purchasing' : '/suppliers');

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Stock</Title><Soft>{n.out || n.low ? `${n.out ? `${n.out} out of stock` : ''}${n.out && n.low ? ', ' : ''}${n.low ? `${n.low} running low` : ''}` : 'Everything is in stock'}</Soft></View>
          <Button title="Order more" kind="quiet" onPress={buy} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search for an item" accessibilityLabel="Search stock" autoCorrect={false} />
        </View>
        <Chips<Filter> items={[{ id: 'all', label: `All ${n.all}` }, { id: 'out', label: `Out ${n.out}` }, { id: 'low', label: `Low ${n.low}` }, { id: 'in', label: `In stock ${n.in}` }]} value={filter} onChange={setFilter} />
        <SavedNote at={savedAt} />
        {done ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600', paddingHorizontal: 16, paddingTop: 6 }}>{done}</Text> : null}
        {error && !data ? <Failed message={error} onRetry={() => { void refresh(); }} /> : null}
        {busy && !data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={shown} keyExtractor={(r) => String(r.product_id)} refreshing={busy} onRefresh={() => { void refresh(); }}
          ListEmptyComponent={data ? <Empty>{filter === 'all' && !text ? 'No stock is being counted yet. Turn on "Count the stock" for an item to see it here.' : 'Nothing here.'}</Empty> : null}
          renderItem={renderRow}
        />
      </Page>

      <Modal visible={item != null} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0f172a88' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1 }} onPress={close} />
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: color.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            {item ? (
              <View style={{ padding: 16, gap: 10 }}>
                <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{item.name}</Text>
                <Soft>{`Now ${qty(item.current_stock + (local[item.product_id] ?? 0))} ${item.unit ?? ''}`}</Soft>
                <Chips<Mode> items={[{ id: 'add', label: 'Add stock' }, { id: 'adjust', label: 'Adjust stock' }]} value={mode} onChange={(m) => { setMode(m); setProblem(''); }} />
                <TextInput style={s.input} value={amount} onChangeText={(v) => { setAmount(v); setProblem(''); }} keyboardType={mode === 'add' ? 'decimal-pad' : 'numbers-and-punctuation'} autoFocus
                  placeholder={mode === 'add' ? 'How many came in?' : 'How many (10 or -3)'} accessibilityLabel="Quantity" />
                {mode === 'adjust' ? (
                  <>
                    <Chips items={REASONS.map((x) => ({ id: x, label: x }))} value={reason} onChange={(x) => { setReason(x); setProblem(''); }} />
                    <TextInput style={s.input} value={reason} onChangeText={(v) => { setReason(v); setProblem(''); }} placeholder="Why? (or choose above)" accessibilityLabel="Reason" />
                  </>
                ) : null}
                <Soft>{afterText(item.current_stock + (local[item.product_id] ?? 0), amount, item.unit)}</Soft>
                <ErrorText>{problem}</ErrorText>
                <Button title={mode === 'add' ? 'Add to stock' : 'Save the change'} onPress={() => { void save(); }} busy={working} disabled={Boolean(bad)} />
                <Button title="More about this item" kind="quiet" onPress={() => { const id = item.product_id; close(); router.push({ pathname: '/product/[id]', params: { id: String(id) } }); }} />
              </View>
            ) : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
