import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { ranges } from '../lib/ranges.ts';
import { EXPENSE_CATEGORIES, EXPENSE_METHODS, expenseProblem, type Expense } from '../lib/buying.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Stat, Title, s } from '../lib/ui.tsx';

/* Money the shop spent that is not stock: rent, salary, electricity. Written down here, it shows in the profit on the website. */
export default function Expenses() {
  const session = useSession();
  const [rangeId, setRangeId] = useState('month');
  const range = ranges().find((r) => r.id === rangeId)!;
  const list = useLoad<Expense[]>(`expenses:${session.businessId}:${session.branchId}:${range.from}:${range.to}`, () => api.get<Expense[]>(`/expenses?from=${range.from}&to=${range.to}`));
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [key, setKey] = useState(newKey());

  const total = (list.data ?? []).reduce((a, e) => a + toPaise(e.amount), 0);

  const save = async () => {
    const bad = expenseProblem(category, amount);
    if (bad) return setProblem(bad);
    setBusy(true); setProblem('');
    try {
      await api.call('/expenses', { method: 'POST', idempotencyKey: key, body: { category, amount: Number(amount), payment_method: method, ...(note.trim() ? { description: note.trim() } : {}) } });
      setAdding(false); setCategory(''); setAmount(''); setNote(''); setKey(newKey()); void list.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  const remove = (e: Expense) => Alert.alert('Remove this expense?', `${e.category}, ${rupees(toPaise(e.amount))}. It is taken off your costs.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => { void api.call(`/expenses/${e.expense_id}`, { method: 'DELETE' }).then(() => list.refresh()).catch((x: Error) => setProblem(x.message)); } }
  ]);

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Expenses</Title><Soft>Rent, salary, electricity and the like</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips items={ranges().filter((r) => r.id !== 'yesterday').map((r) => ({ id: r.id, label: r.label }))} value={rangeId as never} onChange={(id) => setRangeId(id)} />
        <SavedNote at={list.savedAt} />
        <View style={{ padding: 16, gap: 10 }}>
          <Stat label="Spent" value={rupees(total)} note={`${(list.data ?? []).length} expenses`} />
          <ErrorText>{problem}</ErrorText>
          {!adding ? <Button title="Add an expense" onPress={() => { setAdding(true); setProblem(''); }} /> : (
            <View style={{ gap: 10 }}>
              <Soft>What was it for?</Soft>
              <Chips items={EXPENSE_CATEGORIES.map((c) => ({ id: c, label: c }))} value={category} onChange={setCategory} />
              <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount" accessibilityLabel="Amount" />
              <Soft>Paid by</Soft>
              <Chips items={EXPENSE_METHODS} value={method as never} onChange={setMethod} />
              <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="A note (optional)" accessibilityLabel="Note" />
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
          style={{ flex: 1 }} data={list.data ?? []} keyExtractor={(e) => String(e.expense_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>No expenses in this time. Tap Add an expense when you pay for something.</Empty> : null}
          renderItem={({ item: e }) => <Line left={e.category} sub={`${e.expense_date.slice(0, 10)} · ${e.payment_method.replace('_', ' ').toLowerCase()}${e.description ? ` · ${e.description}` : ''}`} right={rupees(toPaise(e.amount))} onPress={() => remove(e)} />}
        />
      </Page>
    </SafeAreaView>
  );
}
