import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { Supplier } from '../lib/buying.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Empty, ErrorText, Failed, Line, Loading, SavedNote, Soft, Title, color, s } from '../lib/ui.tsx';

/* Who you buy from and what you owe them. Receive stock when a delivery arrives. */
export default function Suppliers() {
  const list = useLoad<Supplier[]>('suppliers', () => api.get<Supplier[]>('/suppliers'));
  const type = currentBusiness(useSession())?.business_type ?? '';
  const pharmacy = type === 'PHARMACY';
  const wholesale = type === 'WHOLESALE' || type === 'DISTRIBUTOR';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());
  const owed = (list.data ?? []).reduce((a, x) => a + toPaise(x.payable_balance), 0);

  const save = async () => {
    if (!name.trim()) return setProblem('Enter the supplier name');
    setBusy(true); setProblem('');
    try {
      await api.call('/suppliers', { method: 'POST', idempotencyKey: key, body: { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) } });
      setAdding(false); setName(''); setPhone(''); setKey(newKey()); void list.refresh();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Suppliers</Title><Soft>{owed > 0 ? `You owe ${rupees(owed)} in all` : 'Who you buy from'}</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <SavedNote at={list.savedAt} />
        <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
          <Button title="Receive stock" onPress={() => router.push(pharmacy ? '/pharmacy-receive' : wholesale ? '/goods-received' : '/receive')} />
          <ErrorText>{problem}</ErrorText>
          {!adding ? <Button title="Add a supplier" kind="quiet" onPress={() => { setAdding(true); setProblem(''); }} /> : (
            <View style={{ gap: 10 }}>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Supplier name" accessibilityLabel="Supplier name" autoFocus />
              <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Mobile number (optional)" accessibilityLabel="Mobile number" />
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
          style={{ flex: 1 }} data={list.data ?? []} keyExtractor={(x) => String(x.supplier_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }}
          ListEmptyComponent={list.data ? <Empty>No suppliers yet. Add one, or receive stock without naming a supplier.</Empty> : null}
          renderItem={({ item: x }) => <Line left={x.name} sub={`${x.phone ?? 'No phone'}${x.open_orders ? ` · ${x.open_orders} orders on the way` : ''}${x.last_po_date ? ` · last ${x.last_po_date.slice(0, 10)}` : ''}`} right={x.payable_balance > 0 ? `Owe ${rupees(toPaise(x.payable_balance))}` : undefined} />}
        />
        <View style={{ padding: 8 }}><Soft style={{ textAlign: 'center', color: color.soft }}>Paying a supplier is on the FlowXP website.</Soft></View>
      </Page>
    </SafeAreaView>
  );
}
