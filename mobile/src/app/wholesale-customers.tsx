import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { WCustomer } from '../lib/wholesale.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, ColumnList } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

type Show = 'all' | 'owing' | 'overdue';
const money = (n: number) => rupees(toPaise(n));

/* The customers who buy on credit: what each owes, what is overdue, and their limit. Tap one for their account. */
export default function WholesaleCustomers() {
  const session = useSession();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const q = `limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}${show === 'owing' ? '&has_balance=1' : ''}${show === 'overdue' ? '&overdue=1' : ''}`;
  const list = useLoad<WCustomer[]>(`wholesale-customers:${session.businessId}:${q}`, () => api.get<WCustomer[]>(`/wholesale/customers?${q}`));

  return (
    <SafeAreaView style={s.screen}>
      <Page grid>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Customers</Title><Soft>Who buys, and who owes</Soft></View>
          <Button title="Add" onPress={() => router.push('/customers')} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search by name, phone or GST number" autoCorrect={false} accessibilityLabel="Search customers" />
        </View>
        <Chips<Show> items={[{ id: 'all', label: 'Everyone' }, { id: 'owing', label: 'Owe money' }, { id: 'overdue', label: 'Overdue' }]} value={show} onChange={setShow} />
        <SavedNote at={list.savedAt} />
        {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {list.busy && !list.data ? <Loading /> : null}
        <ColumnList
          style={{ flex: 1, marginTop: 8 }} data={list.data ?? []} keyExtractor={(c) => String(c.customer_id)} refreshing={list.busy} onRefresh={() => { void list.refresh(); }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={list.data ? <Empty>{show === 'all' ? 'No customer matches.' : 'Nobody here.'}</Empty> : null}
          renderItem={({ item: c }) => (
            <Line left={c.name} sub={[c.city, c.phone, c.credit_limit > 0 ? `limit ${money(c.credit_limit)}` : null, (c.overdue ?? 0) > 0 ? `${money(c.overdue ?? 0)} overdue` : null].filter(Boolean).join(' · ')}
              right={(c.outstanding ?? 0) > 0 ? `Owes ${money(c.outstanding ?? 0)}` : undefined} onPress={() => router.push({ pathname: '/wholesale-customer/[id]', params: { id: String(c.customer_id) } })} />
          )}
        />
      </Page>
    </SafeAreaView>
  );
}
