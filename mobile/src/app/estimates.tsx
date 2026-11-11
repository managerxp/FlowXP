import { useState } from 'react';
import { Alert, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { t } from '../lib/i18n.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { blankLine, draftTotalPaise, estimateBody, estimateProblem, estimateText, type DraftLine, type Estimate } from '../lib/estimates.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

/* Estimates (quotations): a price sent before the sale. Share it, and when the customer agrees, turn it into an invoice in one tap. */
export default function Estimates() {
  const session = useSession();
  const shop = currentBusiness(session)?.name ?? '';
  const list = useLoad<Estimate[]>(`estimates:${session.businessId}:${session.branchId}`, () => api.get<Estimate[]>('/estimates'));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const save = async () => {
    const bad = estimateProblem(lines);
    if (bad) return setProblem(t(bad));
    setBusy(true); setProblem('');
    try {
      await api.call('/estimates', { method: 'POST', idempotencyKey: key, body: estimateBody(name, discount, lines) });
      setAdding(false); setName(''); setDiscount(''); setLines([blankLine()]); setKey(newKey()); void list.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t('Could not save')); }
    finally { setBusy(false); }
  };
  const act = (path: string, then: string) => api.call(path, { method: 'POST', idempotencyKey: newKey(), body: {} })
    .then(() => { setProblem(''); if (then) Alert.alert(then); return list.refresh(); }).catch((e: Error) => setProblem(e.message));
  const makeInvoice = (e: Estimate) => Alert.alert(t('Make an invoice from this estimate?'), `${e.estimate_number} · ${rupees(toPaise(e.total))}`, [
    { text: t('Cancel'), style: 'cancel' }, { text: t('Make invoice'), onPress: () => { void act(`/estimates/${e.estimate_id}/convert`, t('Invoice made')); } }
  ]);
  const cancel = (e: Estimate) => Alert.alert(t('Cancel this estimate?'), e.estimate_number, [
    { text: t('Keep it'), style: 'cancel' }, { text: t('Cancel estimate'), style: 'destructive', onPress: () => { void act(`/estimates/${e.estimate_id}/cancel`, ''); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Estimates</Title><Soft>A price before the sale. Share it, then make the invoice.</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={list.savedAt} />
        <View style={{ padding: 16, gap: 10 }}>
          <ErrorText>{problem}</ErrorText>
          {!adding ? <Button title="New estimate" onPress={() => { setAdding(true); setProblem(''); }} /> : (
            <View style={{ gap: 10 }}>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder={t('Customer name (optional)')} accessibilityLabel={t('Customer name')} />
              {lines.map((l, i) => (
                <View key={i} style={{ gap: 6 }}>
                  <TextInput style={s.input} value={l.description} onChangeText={(v) => setLine(i, { description: v })} placeholder={t('Item or service')} accessibilityLabel={t('Item or service')} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={l.quantity} onChangeText={(v) => setLine(i, { quantity: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" placeholder={t('Qty')} accessibilityLabel={t('Qty')} />
                    <TextInput style={[s.input, { flex: 1 }]} value={l.price} onChangeText={(v) => setLine(i, { price: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" placeholder={t('Price')} accessibilityLabel={t('Price')} />
                  </View>
                </View>
              ))}
              <Button title="Add another item" kind="quiet" onPress={() => setLines((ls) => [...ls, blankLine()])} />
              <TextInput style={s.input} value={discount} onChangeText={(v) => setDiscount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Discount (optional)')} accessibilityLabel={t('Discount')} />
              <Soft>{`${t('Total')}: ${rupees(draftTotalPaise(lines, discount))}`}</Soft>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Save" onPress={() => { void save(); }} busy={busy} style={{ flex: 1 }} />
                <Button title="Cancel" kind="quiet" onPress={() => { setAdding(false); setProblem(''); }} />
              </View>
            </View>
          )}
        </View>
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1 }} data={list.data ?? []} keyExtractor={(e) => String(e.estimate_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>No estimates yet. Tap New estimate to quote a price.</Empty> : null}
          renderItem={({ item: e }) => (
            <View style={{ gap: 6 }}>
              <Line left={`${e.estimate_number}${e.customer_name ? ` · ${e.customer_name}` : ''}`} sub={`${t(e.status === 'OPEN' ? 'Open' : e.status === 'CONVERTED' ? 'Invoiced' : 'Cancelled')}${e.valid_until ? ` · ${t('valid until')} ${e.valid_until}` : ''}`} right={rupees(toPaise(e.total))} />
              {e.status === 'OPEN' ? (
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
                  <Button title="Share" kind="quiet" onPress={() => { void Share.share({ message: estimateText(e, shop) }); }} style={{ flex: 1 }} />
                  <Button title="Make invoice" onPress={() => makeInvoice(e)} style={{ flex: 1 }} />
                  <Button title="Cancel estimate" kind="quiet" onPress={() => cancel(e)} />
                </View>
              ) : null}
            </View>
          )}
        />
      </Page>
    </SafeAreaView>
  );
}
