import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { BATCH_LABEL, batchActions, expiryText, type Batch } from '../lib/pharmacy.ts';
import { qty } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Loading, SavedNote, SectionTitle, Soft, Stat, Title, color, s } from '../lib/ui.tsx';

type Show = 'expiring' | 'expired' | 'active' | 'quarantined' | 'recalled' | 'blocked';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const LABEL: Record<Show, string> = { expiring: 'Expiring soon', expired: 'Expired', active: 'On sale', quarantined: 'Held back', recalled: 'Recalled', blocked: 'Blocked' };

/* Every batch on the shelf: what is about to expire or has, and hold back, recall or block a batch so it cannot be sold. */
export default function PharmacyBatches() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [show, setShow] = useState<Show>('expiring');
  const [open, setOpen] = useState<number | null>(null);
  const [problem, setProblem] = useState('');
  const summary = useLoad<{ expired: number; buckets: { days: number; batches: number }[] }>(`pharmacy-expiry:${scope}`, () => api.get('/pharmacy/inventory/expiry'));
  const list = useLoad<Batch[]>(`pharmacy-batches:${scope}:${show}`, () => api.get<Batch[]>(`/pharmacy/inventory/batches?state=${show}`));

  const change = (b: Batch, to: Batch['status'], warn?: string) => Alert.alert(`${b.product}, batch ${b.batch_no}`, warn ?? 'It goes back on sale.', [
    { text: 'No', style: 'cancel' },
    { text: 'Yes', style: to === 'ACTIVE' ? 'default' : 'destructive', onPress: () => { void (async () => {
      setProblem('');
      try { await api.call(`/pharmacy/inventory/batches/${b.batch_id}/status`, { method: 'POST', body: { status: to } }); setOpen(null); await list.refresh(); await summary.refresh(); }
      catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); }
    })(); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Batches and use-by dates</Title><Soft>What is on the shelf, batch by batch</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {summary.data ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
            <Stat label="Expired" value={String(summary.data.expired)} tone={summary.data.expired ? color.danger : undefined} note="batches with stock" />
            {summary.data.buckets.slice(0, 3).map((b) => <Stat key={b.days} label={`Within ${b.days} days`} value={String(b.batches)} tone={b.batches ? color.warn : undefined} />)}
          </View>
        ) : null}
        <Chips<Show> items={(Object.keys(LABEL) as Show[]).map((x) => ({ id: x, label: LABEL[x] }))} value={show} onChange={(x) => { setShow(x); setOpen(null); setProblem(''); }} />
        <SavedNote at={list.savedAt} />
        <View style={{ paddingHorizontal: 16 }}><ErrorText>{problem}</ErrorText></View>
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {list.data && list.data.length === 0 ? <Empty>No batches here.</Empty> : null}
          {list.data && list.data.length ? <SectionTitle>{`${list.data.length} batches`}</SectionTitle> : null}
          {(list.data ?? []).map((b) => (
            <View key={b.batch_id} style={{ borderTopWidth: 1, borderColor: color.line, backgroundColor: open === b.batch_id ? '#eaf1ff' : color.card }}>
              <Pressable accessibilityRole="button" style={{ padding: 16, gap: 2 }} onPress={() => setOpen(open === b.batch_id ? null : b.batch_id)}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink, flex: 1 }}>{b.product}</Text>
                  <Text style={{ fontWeight: '700', color: color.ink }}>{qty(b.qty_on_hand)} {b.unit ?? ''}</Text>
                </View>
                <Soft>{`Batch ${b.batch_no} · ${expiryText(b.expiry_date, today())}${b.status !== 'ACTIVE' ? ` · ${BATCH_LABEL[b.status]}` : ''}`}</Soft>
              </Pressable>
              {open === b.batch_id ? (
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 16 }}>
                  {batchActions(b.status).map((a) => <Button key={a.to} title={a.label} kind={a.to === 'ACTIVE' ? 'primary' : 'quiet'} onPress={() => change(b, a.to, a.warn)} />)}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
