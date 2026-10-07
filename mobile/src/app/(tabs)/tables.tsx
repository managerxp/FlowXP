import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { STATE_LABEL, byZone, tableState, type Order, type TableRow, type TableState } from '../../lib/orders.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { ago } from '../../lib/ranges.ts';
import { Page, useWide } from '../../lib/responsive.tsx';
import { Hint, markDone } from '../../lib/learn.tsx';
import { Button, Empty, ErrorText, Failed, Loading, SavedNote, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const TONE: Record<TableState, { bg: string; border: string; ink: string }> = {
  free: { bg: color.card, border: color.line, ink: color.ink },
  reserved: { bg: '#fffbeb', border: '#fcd34d', ink: color.warn },
  new: { bg: '#eaf1ff', border: color.brand, ink: color.brand },
  cooking: { bg: '#eaf1ff', border: color.brand, ink: color.brand },
  ready: { bg: '#ecfdf5', border: '#34d399', ink: color.ok },
  served: { bg: '#f1f5f9', border: color.soft, ink: color.soft }
};

/* The floor: every table, free or busy, and what the kitchen has done for each. Tap a free table to open an order, a busy one to carry on. */
export default function Tables() {
  const session = useSession();
  const wide = useWide();
  const scopeKey = `${session.businessId}:${session.branchId}`;
  const floor = useLoad<TableRow[]>(`floor:${scopeKey}`, () => api.get<TableRow[]>('/tables'));
  const open = useLoad<Order[]>(`open-orders:${scopeKey}`, () => api.get<Order[]>('/orders?open_only=true'));
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [problem, setProblem] = useState('');
  const [zone, setZone] = useState<string | null>(null);

  // the kitchen moves while you stand there: refresh every 15 seconds while this tab is showing
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    if (!focused) return;
    const t = setInterval(() => { void floor.refresh(); void open.refresh(); }, 15000);
    return () => clearInterval(t);
  }, [focused]);   // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id: number) => { markDone('first_table'); router.push({ pathname: '/order/[id]', params: { id: String(id) } }); };

  const tap = async (t: TableRow) => {
    if (t.open_order_id) return go(t.open_order_id);
    setBusy(t.table_id); setProblem('');
    try {
      const order = await api.post<{ order_id: number }>('/orders', { order_type: 'DINE_IN', table_id: t.table_id }, { idempotencyKey: newKey() });
      void floor.refresh(); go(order.order_id);
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not open the table'); void floor.refresh(); }
    finally { setBusy(null); }
  };

  const takeaway = async () => {
    setBusy('new'); setProblem('');
    try { const order = await api.post<{ order_id: number }>('/orders', { order_type: 'TAKEAWAY' }, { idempotencyKey: newKey() }); void open.refresh(); go(order.order_id); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'Could not start the order'); }
    finally { setBusy(null); }
  };

  const groups = byZone(floor.data ?? []);
  const shown = zone === null ? groups : groups.filter((g) => g.zone === zone);
  const cols = wide ? 4 : 2;
  const away = (open.data ?? []).filter((o) => !o.table_id);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page max={1000}>
        <ScrollView refreshControl={<RefreshControl refreshing={floor.busy} onRefresh={() => { void floor.refresh(); void open.refresh(); }} />} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}><Title>Tables</Title><Soft>Updates by itself</Soft></View>
            <Button title="Takeaway order" kind="quiet" onPress={() => { void takeaway(); }} busy={busy === 'new'} />
          </View>
          <SavedNote at={floor.savedAt} />
          <Hint id="tables" />
          {floor.error && !floor.data ? <Failed message={floor.error} onRetry={() => { void floor.refresh(); }} /> : null}
          <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
          {floor.busy && !floor.data ? <Loading what="Loading the floor" /> : null}

          {groups.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }} style={{ flexGrow: 0 }}>
              {[{ id: null as string | null, label: 'All' }, ...groups.map((g) => ({ id: g.zone as string | null, label: g.zone || 'Main' }))].map((z) => (
                <Pressable key={String(z.id)} accessibilityRole="button" accessibilityState={{ selected: zone === z.id }} onPress={() => setZone(z.id)}
                  style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: zone === z.id ? color.brand : color.line, backgroundColor: zone === z.id ? color.brand : color.card }}>
                  <Text style={{ fontWeight: '600', color: zone === z.id ? '#fff' : color.ink }}>{z.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {floor.data && floor.data.length === 0 ? <Empty>No tables are set up at this outlet yet. Add them on the FlowXP website under Tables, then pull down here to refresh.</Empty> : null}
          {shown.map((g) => (
            <View key={g.zone}>
              {groups.length > 1 ? <SectionTitle>{g.zone || 'Main'}</SectionTitle> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
                {g.tables.map((t) => {
                  const st = tableState(t); const tone = TONE[st]; const o = t.open_order;
                  return (
                    <Pressable
                      key={t.table_id} accessibilityRole="button" accessibilityLabel={`${t.name}, ${STATE_LABEL[st]}${o ? `, ${o.items} items, ${rupees(toPaise(o.estimate))}` : ''}`}
                      onPress={() => { void tap(t); }} disabled={busy !== null}
                      style={({ pressed }) => ({ width: `${100 / cols - 2}%`, flexGrow: 1, minWidth: 140, minHeight: 100, padding: 12, borderRadius: 14, borderWidth: st === 'free' ? 1 : 2, borderColor: tone.border, backgroundColor: pressed ? '#dbeafe' : tone.bg, justifyContent: 'space-between', opacity: busy !== null && busy !== t.table_id ? 0.6 : 1 })}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{t.name}</Text>
                        {t.seats ? <Text style={{ color: color.soft }}>{t.seats} seats</Text> : null}
                      </View>
                      <View>
                        <Text style={{ fontWeight: '700', color: tone.ink }}>{busy === t.table_id ? 'Opening…' : STATE_LABEL[st]}</Text>
                        {o ? <Text style={{ color: color.soft }}>{o.items} items · {rupees(toPaise(o.estimate))} · {ago(new Date(o.opened_at).getTime())}</Text> : null}
                        {o && o.ready > 0 ? <Text style={{ color: color.ok, fontWeight: '600' }}>{o.ready} ready to serve</Text> : null}
                        {!o && t.next_reservation ? <Text style={{ color: color.warn }}>{t.next_reservation.guest_name ?? 'Booked'} at {new Date(t.next_reservation.reserved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {away.length ? (
            <>
              <SectionTitle>Takeaway and delivery, open now</SectionTitle>
              {away.map((o) => (
                <Pressable key={o.order_id} accessibilityRole="button" onPress={() => go(o.order_id)} style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: pressed ? '#eaf1ff' : color.card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' })}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, color: color.ink }}>{o.order_number} · {o.order_type === 'DELIVERY' ? 'Delivery' : 'Takeaway'}</Text>
                    <Soft>{o.summary ? `${o.summary.items} items${o.summary.ready ? ` · ${o.summary.ready} ready` : ''}${o.summary.not_sent ? ` · ${o.summary.not_sent} not sent` : ''}` : o.status}{o.customer_name ? ` · ${o.customer_name}` : ''}</Soft>
                  </View>
                  <Text style={{ fontWeight: '600', color: color.ink }}>{o.summary ? rupees(toPaise(o.summary.estimate)) : ''}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
