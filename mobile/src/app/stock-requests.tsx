import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { isOpen, sendBody, type StockRequest } from '../lib/stockRequests.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
const STATUS: Record<StockRequest['status'], string> = { PENDING: 'Waiting', PARTIAL: 'Part sent', FULFILLED: 'Sent', REJECTED: 'Turned down', CANCELLED: 'Called off', CLOSED: 'Closed' };

function Card({ r, asked, onChanged }: { r: StockRequest; asked: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'' | 'send' | 'reject'>('');
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setProblem(''); try { await fn(); setMode(''); onChanged(); } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not do that.')); } finally { setBusy(false); } };
  return (
    <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ flex: 1, fontWeight: '700', color: color.ink }}>{r.to_name} → {r.from_name} · {when(r.created_at)}</Text>
        <Text style={{ fontWeight: '700', color: isOpen(r) ? color.brand : color.soft }}>{t(STATUS[r.status])}</Text>
      </View>
      {r.notes ? <Soft>{r.notes}</Soft> : null}
      {r.decision_note ? <Text style={{ color: color.warn }}>{r.decision_note}</Text> : null}
      {r.items.map((i) => (
        <View key={i.item_id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 40 }}>
          <Text style={{ flex: 1, color: color.ink }}>{i.name}</Text>
          {mode === 'send' && i.remaining > 0
            ? <TextInput style={[s.input, { width: 96 }]} value={typed[i.item_id] ?? String(i.remaining)} onChangeText={(v) => setTyped((x) => ({ ...x, [i.item_id]: v.replace(/[^0-9.]/g, '') }))} keyboardType="decimal-pad" accessibilityLabel={`${t('How many')} ${i.name}`} />
            : <Text style={{ color: color.soft }}>{i.sent}/{i.requested}{i.unit ? ` ${i.unit}` : ''}</Text>}
        </View>
      ))}
      <ErrorText>{problem}</ErrorText>
      {isOpen(r) ? (
        <View style={{ gap: 8 }}>
          {asked && mode === '' ? <Button title={t('Send stock')} onPress={() => setMode('send')} /> : null}
          {asked && mode === 'send' ? <Button title={t('Send these quantities')} busy={busy} onPress={() => { void act(() => api.post(`/transfer-requests/${r.request_id}/fulfil`, sendBody(r, typed), { idempotencyKey: newKey() })); }} /> : null}
          {asked && mode === 'reject' ? (
            <>
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder={t('Why can’t you send it?')} accessibilityLabel={t('Why can’t you send it?')} />
              <Button title={t('Turn down')} kind="danger" busy={busy} disabled={!reason.trim()} onPress={() => { void act(() => api.post(`/transfer-requests/${r.request_id}/reject`, { reason: reason.trim() })); }} />
            </>
          ) : null}
          {asked && r.status === 'PENDING' && mode === '' ? <Button title={t('Turn down')} kind="quiet" onPress={() => setMode('reject')} /> : null}
          {asked && mode !== '' ? <Button title="Cancel" kind="quiet" onPress={() => { setMode(''); setProblem(''); }} /> : null}
          {!asked ? <Button title={t('Call off')} kind="quiet" busy={busy} onPress={() => { void act(() => api.post(`/transfer-requests/${r.request_id}/cancel`, {})); }} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/* Stock requests between outlets: what other outlets asked this one to send, and what this outlet asked for. */
export default function StockRequests() {
  const session = useSession();
  const several = (currentBusiness(session)?.outlets.length ?? 0) > 1;
  const [box, setBox] = useState<'incoming' | 'outgoing'>('incoming');
  const list = useLoad<StockRequest[]>(`stock-requests:${session.businessId}:${session.branchId}:${box}`, () => api.get<StockRequest[]>(`/transfer-requests?box=${box}`), several);
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{t('Stock requests')}</Title><Soft>{t('Ask another outlet for stock, or send what one asked you for.')}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {!several ? <Empty>{t('Stock requests are for businesses with more than one outlet.')}</Empty> : (
          <ScrollView refreshControl={<RefreshControl refreshing={list.busy} onRefresh={() => { void list.refresh(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><Button title={t('Ask for stock')} onPress={() => router.push('/stock-request-new')} /></View>
            <Chips items={[{ id: 'incoming', label: 'Asked of this outlet' }, { id: 'outgoing', label: 'Asked by this outlet' }]} value={box} onChange={setBox} />
            {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
            {list.busy && !list.data ? <Loading what="Loading the requests" /> : null}
            {list.data && list.data.length === 0 ? <Empty>{box === 'incoming' ? t('No other outlet is asking you for stock.') : t('You have not asked any outlet for stock.')}</Empty> : null}
            {list.data?.map((r) => <Card key={r.request_id} r={r} asked={box === 'incoming'} onChanged={() => { void list.refresh(); }} />)}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
