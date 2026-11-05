import { formatDate } from '../lib/display.ts';
import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ranges } from '../lib/ranges.ts';
import { INCOME_CATEGORIES, INCOME_METHODS, incomeBody, incomeProblem, incomeUrl, type Income, type IncomeList } from '../lib/otherIncome.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Stat, Title, s } from '../lib/ui.tsx';

/* Money received that is not a sale: interest, rent received, scrap. It is added to the income in the profit report on the website. */
export default function OtherIncome() {
  const session = useSession();
  const [rangeId, setRangeId] = useState('month');
  const range = ranges().find((r) => r.id === rangeId)!;
  const list = useLoad<IncomeList>(`other-income:${session.businessId}:${session.branchId}:${range.from}:${range.to}`, () => api.get<IncomeList>(incomeUrl(range.from, range.to)));
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [key, setKey] = useState(newKey());   // one key per entry: a double tap saves it once
  const rows = list.data?.rows ?? [];

  const save = async () => {
    const bad = incomeProblem(category, amount);
    if (bad) return setProblem(t(bad));
    setBusy(true); setProblem('');
    try {
      await api.call('/other-income', { method: 'POST', idempotencyKey: key, body: incomeBody(category, amount, method, note) });
      setAdding(false); setCategory(''); setAmount(''); setNote(''); setKey(newKey()); void list.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };

  const remove = (r: Income) => Alert.alert(t('Remove this income?'), `${t(r.category)}, ${rupees(toPaise(r.amount))}. ${t('It is taken off your income.')}`, [
    { text: t('Keep it'), style: 'cancel' },
    { text: t('Remove'), style: 'destructive', onPress: () => { void api.call(`/other-income/${r.income_id}`, { method: 'DELETE' }).then(() => list.refresh()).catch((x: Error) => setProblem(x.message)); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Other income</Title><Soft>Interest, rent received, scrap: money in that is not from a bill</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips items={ranges().filter((r) => r.id !== 'yesterday').map((r) => ({ id: r.id, label: r.label }))} value={rangeId as never} onChange={(id) => setRangeId(id)} />
        <SavedNote at={list.savedAt} />
        <View style={{ padding: 16, gap: 10 }}>
          <Stat label="Received" value={rupees(toPaise(list.data?.total ?? 0))} note={`${rows.length}`} />
          <ErrorText>{problem}</ErrorText>
          {!adding ? <Button title="Add income" onPress={() => { setAdding(true); setProblem(''); }} /> : (
            <View style={{ gap: 10 }}>
              <Soft>What was it for?</Soft>
              <Chips items={INCOME_CATEGORIES.map((c) => ({ id: c, label: c }))} value={category} onChange={setCategory} />
              <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={t('Amount')} accessibilityLabel={t('Amount')} />
              <Soft>Received by</Soft>
              <Chips items={INCOME_METHODS} value={method as never} onChange={setMethod} />
              <TextInput style={s.input} value={note} onChangeText={setNote} placeholder={t('A note (optional)')} accessibilityLabel={t('A note (optional)')} />
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
          style={{ flex: 1 }} data={rows} keyExtractor={(r) => String(r.income_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>No income in this time. Tap Add income when you receive money that is not from a bill.</Empty> : null}
          renderItem={({ item: r }) => <Line left={t(r.category)} sub={`${formatDate(r.income_date)} · ${t(INCOME_METHODS.find((m) => m.id === r.payment_method)?.label ?? 'Other')}${r.description ? ` · ${r.description}` : ''}`} right={rupees(toPaise(r.amount))} onPress={() => remove(r)} />}
        />
      </Page>
    </SafeAreaView>
  );
}
