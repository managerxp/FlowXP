import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api, useSession } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { itemName, liveItems, orderTotals, type Order, type TableRow } from '../../lib/orders.ts';
import { freeTables, otherOrders, splitBody, type Waiter } from '../../lib/floor.ts';
import { qty, rupees } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

type Mode = 'move' | 'merge' | 'split' | 'waiter';

/* Guests change their mind: move the order to another table, join two tables into one bill, split some items off, or hand the table to another waiter. */
export default function TableTools() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const order = useLoad<Order>(`order:${session.businessId}:${session.branchId}:${id}`, () => api.get<Order>(`/orders/${id}`));
  const floor = useLoad<TableRow[]>(`floor:${scope}`, () => api.get<TableRow[]>('/tables'));
  const open = useLoad<Order[]>(`open-orders:${scope}`, () => api.get<Order[]>('/orders?open_only=true'));
  const waiters = useLoad<Waiter[]>(`waiters:${scope}`, () => api.get<Waiter[]>('/tables/waiters'));
  const [mode, setMode] = useState<Mode>('move');
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [key] = useState(newKey());   // one key per screen visit for the move: a double tap moves once
  const o = order.data;

  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(what); setProblem('');
    try { await work(); goBack(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); void floor.refresh(); void open.refresh(); }
    finally { setBusy(''); }
  };

  const free = freeTables(floor.data ?? [], o?.table_id);
  const others = otherOrders(open.data ?? [], Number(id));
  const lines = o ? liveItems(o) : [];
  const picked = lines.filter((i) => (chosen[i.order_item_id] ?? 0) > 0);
  const bump = (itemId: number, max: number, by: number) => setChosen((c) => ({ ...c, [itemId]: Math.max(0, Math.min(max, (c[itemId] ?? 0) + by)) }));

  const move = (tableId: number) => run(`t${tableId}`, async () => { await api.call(`/orders/${id}/transfer`, { method: 'POST', body: { table_id: tableId }, idempotencyKey: key }); });
  const merge = (fromId: number) => run(`m${fromId}`, async () => { await api.call(`/orders/${id}/merge`, { method: 'POST', body: { from_order_id: fromId }, idempotencyKey: key }); });
  const split = (to: { table_id: number } | { to_order_id: number }, what: string) => run(what, async () => { await api.call(`/orders/${id}/split`, { method: 'POST', body: splitBody(lines, chosen, to), idempotencyKey: key }); });
  const handOver = (userId: number | null) => run(`w${userId}`, async () => { await api.call(`/orders/${id}/waiter`, { method: 'PATCH', body: { waiter_user_id: userId } }); });

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Change the table</Title>{o ? <Soft>{o.table_name ?? o.order_number}{o.customer_name ? ` · ${o.customer_name}` : ''}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Mode> items={[{ id: 'move', label: 'Move' }, { id: 'merge', label: 'Join' }, { id: 'split', label: 'Split' }, { id: 'waiter', label: 'Waiter' }]} value={mode} onChange={(m) => { setMode(m); setProblem(''); }} />
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><ErrorText>{problem}</ErrorText></View>
        {(order.busy && !o) || (floor.busy && !floor.data) ? <Loading /> : null}
        {o && o.order_type !== 'DINE_IN' && mode !== 'waiter' ? <Empty>Only an order at a table can be moved, joined or split.</Empty> : null}

        {o && (o.order_type === 'DINE_IN' || mode === 'waiter') ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            {mode === 'move' ? (
              <>
                <SectionTitle>Move this order to a free table</SectionTitle>
                {free.length === 0 ? <Empty>No free table right now.</Empty> : free.map((t) => (
                  <Line key={t.table_id} left={t.name} sub={`${t.zone ? `${t.zone} · ` : ''}${t.seats ? `${t.seats} seats` : 'Free'}`} right={busy === `t${t.table_id}` ? '…' : 'Move here'} onPress={busy ? undefined : () => { void move(t.table_id); }} />
                ))}
              </>
            ) : null}

            {mode === 'merge' ? (
              <>
                <SectionTitle>Join another table's order into this one</SectionTitle>
                <Soft style={{ paddingHorizontal: 16, paddingBottom: 6 }}>Everything on that table comes here and ends up on one bill. That table becomes free.</Soft>
                {others.length === 0 ? <Empty>No other table has an order right now.</Empty> : others.map((x) => (
                  <Line key={x.order_id} left={x.table_name ?? x.order_number} sub={x.summary ? `${x.summary.items} items · about ${rupees(Math.round(x.summary.estimate * 100))}` : x.order_number} right={busy === `m${x.order_id}` ? '…' : 'Join'} onPress={busy ? undefined : () => { void merge(x.order_id); }} />
                ))}
              </>
            ) : null}

            {mode === 'split' ? (
              <>
                <SectionTitle>Tap + on what moves, then choose where</SectionTitle>
                {lines.length === 0 ? <Empty>Nothing on this order to move.</Empty> : lines.map((i) => {
                  const n = chosen[i.order_item_id] ?? 0;
                  return (
                    <View key={i.order_item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingHorizontal: 16, borderTopWidth: 1, borderColor: color.line, backgroundColor: n ? '#eaf1ff' : color.card }}>
                      <View style={{ flex: 1 }}><Text style={{ fontSize: 16, color: color.ink }}>{itemName(i)}</Text><Soft>{qty(i.quantity)} on the table</Soft></View>
                      <Button title="−" kind="quiet" onPress={() => bump(i.order_item_id, i.quantity, -1)} disabled={n === 0} />
                      <Text style={{ minWidth: 24, textAlign: 'center', fontWeight: '700', color: color.ink }}>{n}</Text>
                      <Button title="+" kind="quiet" onPress={() => bump(i.order_item_id, i.quantity, 1)} disabled={n >= i.quantity} />
                    </View>
                  );
                })}
                {picked.length ? (
                  <>
                    <SectionTitle>Move the {picked.reduce((a, i) => a + chosen[i.order_item_id], 0)} chosen to</SectionTitle>
                    {free.map((t) => <Line key={`t${t.table_id}`} left={t.name} sub="Free table" right={busy === `st${t.table_id}` ? '…' : 'Move here'} onPress={busy ? undefined : () => { void split({ table_id: t.table_id }, `st${t.table_id}`); }} />)}
                    {others.map((x) => <Line key={`o${x.order_id}`} left={x.table_name ?? x.order_number} sub="Add to their order" right={busy === `so${x.order_id}` ? '…' : 'Move here'} onPress={busy ? undefined : () => { void split({ to_order_id: x.order_id }, `so${x.order_id}`); }} />)}
                    {free.length + others.length === 0 ? <Empty>No other table to move them to.</Empty> : null}
                  </>
                ) : null}
                {o ? <Soft style={{ padding: 16 }}>Order total now about {rupees(orderTotals(o).totalPaise)}.</Soft> : null}
              </>
            ) : null}

            {mode === 'waiter' ? (
              <>
                <SectionTitle>Who looks after this table</SectionTitle>
                {waiters.data && waiters.data.length === 0 ? <Empty>No waiters are set up for this outlet. Add them on the FlowXP website under Team.</Empty> : null}
                {(waiters.data ?? []).map((w) => <Line key={w.user_id} left={w.name} sub={w.role === 'WAITER' ? 'Waiter' : w.role.toLowerCase()} right={busy === `w${w.user_id}` ? '…' : 'Assign'} onPress={busy ? undefined : () => { void handOver(w.user_id); }} />)}
                {waiters.data?.length ? <Line left="No one" sub="Take the waiter off this table" onPress={busy ? undefined : () => { void handOver(null); }} /> : null}
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
