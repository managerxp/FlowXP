import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { pname, type Product } from '../lib/catalog.ts';
import { ALERT_GROUPS, addStockBody, addStockProblem, alertTotal, expiryText, type SalonAlerts, type SalonBatch } from '../lib/shopExtras.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Salon stock: what needs attention, which batches are on the shelf and when they expire, and adding stock with a batch and expiry date. */
export default function SalonStock() {
  const session = useSession();
  const scopeKey = `${session.businessId}:${session.branchId}`;
  const scope = useScope();
  const [tab, setTab] = useState<'alerts' | 'batches' | 'add'>('alerts');
  const alerts = useLoad<SalonAlerts>(`salon-alerts:${scopeKey}`, () => api.get<SalonAlerts>('/salon/alerts'));
  const batches = useLoad<SalonBatch[]>(`salon-batches:${scopeKey}`, () => api.get<SalonBatch[]>('/salon/stock/batches'), tab === 'batches');
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [item, setItem] = useState<Product | null>(null);
  const [qty, setQty] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { let live = true; if (!scope || !text.trim() || item) { setFound([]); return; } void scope.catalog.search(text).then((r) => { if (live) setFound(r.slice(0, 8)); }); return () => { live = false; }; }, [scope, text, item]);

  const save = async () => {
    const bad = addStockProblem(item?.product_id ?? null, Number(qty), expiry);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError(''); setNote('');
    try {
      await api.post('/salon/stock/in', addStockBody((item as Product).product_id, Number(qty), batchNo, expiry, cost), { idempotencyKey: newKey() });
      setNote(t('Added {n} of {name}.', { n: Number(qty), name: pname(item as Product) }));
      setItem(null); setText(''); setQty(''); setBatchNo(''); setExpiry(''); setCost('');
      await Promise.all([alerts.refresh(), batches.refresh()]);
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const a = alerts.data; const total = alertTotal(a);
  const field = (label: string, v: string, on: (x: string) => void, o: { numeric?: boolean; hint?: string } = {}) => (
    <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text><TextInput style={s.input} value={v} onChangeText={on} keyboardType={o.numeric ? 'decimal-pad' : 'default'} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t(label)} />{o.hint ? <Soft>{t(o.hint)}</Soft> : null}</View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Salon stock</Title><Soft>{a ? (total ? t('{n} things need attention', { n: total }) : t('Nothing needs attention')) : ' '}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16 }}><Chips items={[{ id: 'alerts', label: 'Needs attention' }, { id: 'batches', label: 'On the shelf' }, { id: 'add', label: 'Add stock' }]} value={tab} onChange={(v) => setTab(v as typeof tab)} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {tab === 'alerts' ? (
            <>
              {alerts.busy && !a ? <Loading /> : null}
              {alerts.error && !a ? <Failed message={alerts.error} onRetry={() => { void alerts.refresh(); }} /> : null}
              {a && total === 0 ? <Empty>All stocked and in date.</Empty> : null}
              {a ? ALERT_GROUPS.filter((g) => a[g.key].length).map((g) => (
                <View key={g.key}>
                  <SectionTitle>{`${t(g.title)} (${a[g.key].length})`}</SectionTitle>
                  {a[g.key].map((x, i) => <Line key={`${x.product_id}-${i}`} left={x.name} sub={x.batch_no ? `${t('Batch')} ${x.batch_no}` : undefined} right={x.expiry_date ? t(expiryText(x.days_to_expiry)) : `${x.stock ?? 0}${x.unit ? ` ${x.unit}` : ''}`} />)}
                </View>
              )) : null}
            </>
          ) : null}
          {tab === 'batches' ? (
            <>
              {batches.busy && !batches.data ? <Loading /> : null}
              {batches.error && !batches.data ? <Failed message={batches.error} onRetry={() => { void batches.refresh(); }} /> : null}
              {batches.data && batches.data.length === 0 ? <Empty>No batches yet. Add stock with an expiry date to see it here.</Empty> : null}
              {(batches.data ?? []).map((b) => <Line key={b.batch_id} left={b.product} sub={[b.batch_no ? `${t('Batch')} ${b.batch_no}` : '', b.expiry_date ? t(expiryText(b.days_to_expiry)) : ''].filter(Boolean).join(' · ')} right={`${b.remaining}${b.unit ? ` ${b.unit}` : ''}`} />)}
            </>
          ) : null}
          {tab === 'add' ? (
            <View style={{ padding: 16, gap: 12 }}>
              {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}
              {item ? <Line left={pname(item)} right={t('Change')} onPress={() => setItem(null)} /> : (
                <>
                  <TextInput style={s.input} value={text} onChangeText={setText} placeholder={t('Search for an item')} accessibilityLabel={t('Search for an item')} autoCorrect={false} />
                  {found.map((p) => <Line key={p.product_id} left={pname(p)} onPress={() => { setItem(p); setText(''); }} />)}
                </>
              )}
              {field('How many came in', qty, (v) => setQty(v.replace(/[^\d.]/g, '')), { numeric: true })}
              {field('Batch number (optional)', batchNo, setBatchNo)}
              {field('Expiry date (optional)', expiry, setExpiry, { hint: 'Write it like 2026-12-31' })}
              {field('Cost of one (₹, optional)', cost, (v) => setCost(v.replace(/[^\d.]/g, '')), { numeric: true })}
              <ErrorText>{error}</ErrorText>
              <Button title="Add to stock" onPress={() => { void save(); }} busy={busy} />
            </View>
          ) : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
